import { TxType, TxStatus, OrderStatus, CancelActor, PaymentOption } from '@prisma/client'

export type DerivedPaymentStatus =
  | 'AWAITING_PAYMENT'
  | 'DEPOSIT_PAID'
  | 'PAID'
  | 'REFUND_PENDING'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED'

export interface OrderPaymentTarget {
  total: number
  finalTotal?: number | null
  status: OrderStatus
}

export interface PaymentTransactionData {
  type: TxType
  status: TxStatus
  amount: number
  reference?: string | null
  note?: string | null
  isShortfall?: boolean
}

/**
 * Kiểm tra xem giao dịch hoàn tiền có phải là hoàn cọc do thiếu hụt sản lượng Pre-order hay không (DEV-TASK-20-FIX01 / PH8A-FIN-01)
 */
export function isShortfallRefund(tx: PaymentTransactionData): boolean {
  if (tx.type !== TxType.REFUND) return false
  if (tx.isShortfall) return true
  if (tx.reference === 'REFUND_SHORTFALL' || tx.reference?.startsWith('SHORTFALL')) return true
  if (tx.note) {
    const lower = tx.note.toLowerCase()
    if ((lower.includes('thiếu hụt') || lower.includes('shortfall')) && !lower.includes('khiếu nại')) {
      return true
    }
  }
  return false
}

export interface DerivedPaymentResult {
  status: DerivedPaymentStatus
  paidAmount: number // Doanh thu thực thu ròng (netPaid = grossPaid - refundedAmount)
  grossPaid: number // Tổng tiền khách đã thanh toán
  netPaid: number // Doanh thu thực thu ròng
  refundedAmount: number // Tổng tiền đã hoàn trả cho khách
  targetTotal: number
  remainingAmount: number // Nghĩa vụ nợ còn lại của khách (Math.max(0, targetTotal - effectivePaid))
  isSettled: boolean // Khách đã hoàn thành nghĩa vụ thanh toán đơn hàng
  hasPendingRefund: boolean
}

/**
 * Tính số tiền cọc 30% làm tròn lên tới nghìn đồng (Mục 3.6 & Test Case S1)
 * Công thức: ceil(total * 30 / 100 / 1000) * 1000
 */
export function computeDepositAmount(total: number): number {
  if (total <= 0) return 0
  return Math.ceil((total * 30) / 100 / 1000) * 1000
}

/**
 * Suy ra trạng thái thanh toán từ các giao dịch thực tế (Mục 3.6 & DEV-TASK-20-FIX01)
 * - grossPaid = Σ PAYMENT(DONE)
 * - refundedAmount = Σ REFUND(DONE)
 * - netPaid = grossPaid - refundedAmount
 * - targetTotal = finalTotal ?? total
 * - effectivePaid = grossPaid - totalShortfallRefundDone (tiền cọc thực giữ)
 * - remainingAmount = max(0, targetTotal - effectivePaid)
 */
export function derivePaymentStatus(
  order: OrderPaymentTarget,
  transactions: PaymentTransactionData[]
): DerivedPaymentResult {
  const targetTotal = order.finalTotal ?? order.total

  let totalPaymentDone = 0
  let totalRefundDone = 0
  let totalShortfallRefundDone = 0
  let hasPendingRefund = false

  for (const tx of transactions) {
    if (tx.type === TxType.PAYMENT && tx.status === TxStatus.DONE) {
      totalPaymentDone += tx.amount
    } else if (tx.type === TxType.REFUND) {
      if (tx.status === TxStatus.DONE) {
        totalRefundDone += tx.amount
        if (isShortfallRefund(tx)) {
          totalShortfallRefundDone += tx.amount
        }
      } else if (tx.status === TxStatus.PENDING) {
        hasPendingRefund = true
      }
    }
  }

  const grossPaid = totalPaymentDone
  const refundedAmount = totalRefundDone
  const netPaid = Math.max(0, grossPaid - refundedAmount)
  const paidAmount = netPaid

  // Số tiền khách đã thanh toán còn giữ cho đơn hàng (sau khi trừ các khoản cọc đã hoàn trả do hụt sản lượng)
  // Lưu ý: Tiền bồi hoàn khiếu nại (complaint compensation) không trừ vào effectivePaid để không gây nợ giả cho khách (SRC-FIN-02).
  const effectivePaid = Math.max(0, grossPaid - totalShortfallRefundDone)

  // Nghĩa vụ thanh toán còn lại của khách:
  const remainingAmount = Math.max(0, targetTotal - effectivePaid)
  const isSettled = remainingAmount === 0 && !hasPendingRefund

  // Nếu có giao dịch hoàn tiền đang chờ
  if (hasPendingRefund) {
    return {
      status: 'REFUND_PENDING',
      paidAmount,
      grossPaid,
      netPaid,
      refundedAmount,
      targetTotal,
      remainingAmount,
      isSettled: false,
      hasPendingRefund: true,
    }
  }

  // Đã từng có hoàn tiền thành công
  if (refundedAmount > 0) {
    if (netPaid === 0) {
      return {
        status: 'REFUNDED',
        paidAmount,
        grossPaid,
        netPaid,
        refundedAmount,
        targetTotal,
        remainingAmount,
        isSettled,
        hasPendingRefund: false,
      }
    }
    return {
      status: 'PARTIALLY_REFUNDED',
      paidAmount,
      grossPaid,
      netPaid,
      refundedAmount,
      targetTotal,
      remainingAmount,
      isSettled,
      hasPendingRefund: false,
    }
  }

  // Luồng thanh toán thông thường
  if (grossPaid === 0) {
    return {
      status: 'AWAITING_PAYMENT',
      paidAmount,
      grossPaid,
      netPaid,
      refundedAmount,
      targetTotal,
      remainingAmount,
      isSettled: false,
      hasPendingRefund: false,
    }
  }

  if (grossPaid >= targetTotal) {
    return {
      status: 'PAID',
      paidAmount,
      grossPaid,
      netPaid,
      refundedAmount,
      targetTotal,
      remainingAmount: 0,
      isSettled: true,
      hasPendingRefund: false,
    }
  }

  return {
    status: 'DEPOSIT_PAID',
    paidAmount,
    grossPaid,
    netPaid,
    refundedAmount,
    targetTotal,
    remainingAmount,
    isSettled: false,
    hasPendingRefund: false,
  }
}

/**
 * Tính toán tiền phạt/hoàn khi hủy đơn hàng (Mục 3.7 & Test Cases S2-S5)
 * - Khách hủy ở PROCESSING: Mất cọc (forfeit = min(paid, depositAmount)), hoàn paid - forfeit
 * - Bên bán (SELLER/ADMIN) hoặc SYSTEM hủy: Hoàn 100% (forfeit = 0, hoàn paid)
 * - Khách hủy ở PENDING_CONFIRMATION: Hoàn 100%
 */
export function computeCancellation(
  order: {
    status: OrderStatus
    depositAmount: number
    total?: number
    paymentOption?: PaymentOption | string
  },
  paid: number,
  cancelledBy: CancelActor | 'CUSTOMER' | 'SELLER' | 'SYSTEM',
  isOutOfBandRejection: boolean = false
): {
  forfeitAmount: number
  refundAmount: number
  isDepositForfeited: boolean
} {
  if (paid <= 0) {
    return {
      forfeitAmount: 0,
      refundAmount: 0,
      isDepositForfeited: false,
    }
  }

  // Xác định mức tiền cọc chính sách 30%
  // Tương thích ngược: Đơn cũ có depositAmount = total hoặc paymentOption = FULL mà depositAmount chưa tính 30%
  let policyDeposit = order.depositAmount
  if (
    order.total &&
    order.total > 0 &&
    (order.depositAmount >= order.total || order.paymentOption === 'FULL' || order.paymentOption === PaymentOption.FULL)
  ) {
    const calculatedDeposit = computeDepositAmount(order.total)
    if (order.depositAmount > calculatedDeposit) {
      policyDeposit = calculatedDeposit
    }
  }

  // Khách hủy khi đơn đang ở trạng thái PROCESSING
  if (
    cancelledBy === CancelActor.CUSTOMER &&
    order.status === OrderStatus.PROCESSING
  ) {
    const forfeit = Math.min(paid, policyDeposit)
    const refund = Math.max(0, paid - forfeit)
    return {
      forfeitAmount: forfeit,
      refundAmount: refund,
      isDepositForfeited: forfeit > 0,
    }
  }

  // Trường hợp khách hủy khi PREORDER_WAITING (mục 3.10)
  if (
    cancelledBy === CancelActor.CUSTOMER &&
    order.status === OrderStatus.PREORDER_WAITING
  ) {
    if (isOutOfBandRejection) {
      return {
        forfeitAmount: 0,
        refundAmount: paid,
        isDepositForfeited: false,
      }
    }
    const forfeit = Math.min(paid, policyDeposit)
    const refund = Math.max(0, paid - forfeit)
    return {
      forfeitAmount: forfeit,
      refundAmount: refund,
      isDepositForfeited: forfeit > 0,
    }
  }

  // Mọi trường hợp khác: bên bán hủy (hết hàng, thiên tai, xe hỏng), hoặc khách hủy khi PENDING_CONFIRMATION
  return {
    forfeitAmount: 0,
    refundAmount: paid,
    isDepositForfeited: false,
  }
}

export interface WeightSettlementLineInput {
  id: string
  orderedGrams: number
  actualGrams: number
  unitPricePerKg: number
  isSample?: boolean
  lineTotal?: number
}

export interface WeightSettlementLineOutput {
  id: string
  actualGrams: number
  finalLineTotal: number
}

export interface WeightSettlementResult {
  lines: WeightSettlementLineOutput[]
  finalSubtotal: number
  finalTotal: number
  balance: number
  customerToPay: number
  refundAmount: number
}

/**
 * Chốt khối lượng thực giao cho từng dòng (Mục 3.8 & Test Cases W1-W3)
 * finalLineTotal = round(unitPricePerKg × actualGrams / 1000) (giữ nguyên đơn giá đã chốt)
 * finalSubtotal  = Σ finalLineTotal (+ dòng mẫu giữ nguyên giá)
 * finalTotal     = finalSubtotal + shippingFee
 * balance        = finalTotal − paid
 * balance > 0 → khách thanh toán khi nhận (customerToPay)
 * balance < 0 → tạo khoản hoàn |balance| (refundAmount)
 *
 * Ràng buộc: actualGrams không được vượt quá orderedGrams × 105%.
 */
export function computeWeightSettlement(input: {
  lines: WeightSettlementLineInput[]
  shippingFee: number
  paid: number
}): WeightSettlementResult {
  const lineOutputs: WeightSettlementLineOutput[] = []
  let finalSubtotal = 0

  for (const line of input.lines) {
    if (line.actualGrams < 0) {
      throw new Error(`Khối lượng thực tế của dòng ${line.id} không được âm`)
    }

    // Kiểm tra giới hạn 105% (áp dụng cho hàng thường, không áp dụng cho mẫu)
    if (!line.isSample) {
      const maxAllowedGrams = Math.floor(line.orderedGrams * 1.05)
      if (line.actualGrams > maxAllowedGrams) {
        throw new Error(
          `Khối lượng thực giao (${(line.actualGrams / 1000).toLocaleString('vi-VN')} kg) vượt quá 105% khối lượng đặt hàng (${(maxAllowedGrams / 1000).toLocaleString('vi-VN')} kg)`
        )
      }
    }

    let finalLineTotal: number
    if (line.isSample) {
      // Hàng mẫu giữ nguyên giá gói mẫu
      finalLineTotal = line.lineTotal ?? Math.round((line.unitPricePerKg * line.actualGrams) / 1000)
    } else {
      finalLineTotal = Math.round((line.unitPricePerKg * line.actualGrams) / 1000)
    }

    lineOutputs.push({
      id: line.id,
      actualGrams: line.actualGrams,
      finalLineTotal,
    })

    finalSubtotal += finalLineTotal
  }

  const finalTotal = finalSubtotal + input.shippingFee
  const balance = finalTotal - input.paid

  let customerToPay = 0
  let refundAmount = 0

  if (balance > 0) {
    customerToPay = balance
  } else if (balance < 0) {
    refundAmount = Math.abs(balance)
  }

  return {
    lines: lineOutputs,
    finalSubtotal,
    finalTotal,
    balance,
    customerToPay,
    refundAmount,
  }
}

/**
 * Tính toán bồi hoàn khiếu nại hao hụt nông sản (Mục 3.9 & Test Cases C1-C3)
 * allowedGrams = floor(actualGrams × 3 / 100) (hao hụt tự nhiên cho phép 3%)
 * excessGrams  = max(0, damagedGrams − allowedGrams)
 * compensation = round(unitPricePerKg × excessGrams / 1000)
 *
 * Ràng buộc: Khiếu nại phải được gửi trong vòng 24h kể từ deliveredAt.
 */
export function computeComplaintCompensation(input: {
  actualGrams: number
  damagedGrams: number
  unitPricePerKg: number
  deliveredAt?: Date
  submittedAt?: Date
}): {
  allowedGrams: number
  excessGrams: number
  compensation: number
  isExpired: boolean
} {
  // Kiểm tra hạn 24h
  let isExpired = false
  if (input.deliveredAt && input.submittedAt) {
    const diffMs = input.submittedAt.getTime() - input.deliveredAt.getTime()
    if (diffMs > 24 * 60 * 60 * 1000) {
      isExpired = true
    }
  }

  if (isExpired) {
    throw new Error('Đã quá thời hạn khiếu nại 24h kể từ thời điểm giao hàng')
  }

  const allowedGrams = Math.floor((input.actualGrams * 3) / 100)
  const excessGrams = Math.max(0, input.damagedGrams - allowedGrams)
  const compensation = Math.round((input.unitPricePerKg * excessGrams) / 1000)

  return {
    allowedGrams,
    excessGrams,
    compensation,
    isExpired: false,
  }
}

export interface PayableAmountResult {
  isPayable: boolean
  amountToPay: number
  grossPaid: number
  reason?: string
}

/**
 * Tính số tiền cần thanh toán hiện tại cho mã QR / cổng thanh toán (Mục 3.6 & 3.7)
 * - Đơn CANCELLED: không thể thanh toán (trả về isPayable: false)
 * - Đơn COMPLETED: đã hoàn tất, không còn nợ (trả về isPayable: false)
 * - Đơn DRAFT / PREORDER_WAITING: chưa đến bước thanh toán (trả về isPayable: false)
 * - Đơn PENDING_CONFIRMATION:
 *     Mục tiêu: hoàn thành ngưỡng thanh toán để xác nhận đơn:
 *     FULL: 100% (order.total)
 *     DEPOSIT_30: 30% (order.depositAmount)
 *     amountToPay = max(0, target - grossPaid)
 *     Nếu grossPaid >= target: isPayable: false (đã thanh toán đủ ngưỡng xác nhận)
 * - Đơn PROCESSING / SHIPPING / DELIVERED:
 *     Mục tiêu: thanh toán phần còn lại của đơn hàng (sau cọc hoặc theo sản lượng):
 *     targetTotal = finalTotal ?? total
 *     amountToPay = max(0, targetTotal - grossPaid)
 *     Nếu grossPaid >= targetTotal: isPayable: false (đã tất toán)
 * - grossPaid tính từ tất cả giao dịch: type === PAYMENT && status === DONE
 */
export function computePayableAmount(
  order: {
    status: OrderStatus
    paymentOption: PaymentOption
    total: number
    depositAmount: number
    finalTotal?: number | null
  },
  transactions: PaymentTransactionData[]
): PayableAmountResult {
  let grossPaid = 0
  let totalShortfallRefundDone = 0

  for (const tx of transactions) {
    if (tx.type === TxType.PAYMENT && tx.status === TxStatus.DONE) {
      grossPaid += tx.amount
    } else if (tx.type === TxType.REFUND && tx.status === TxStatus.DONE) {
      if (isShortfallRefund(tx)) {
        totalShortfallRefundDone += tx.amount
      }
    }
  }

  if (order.status === OrderStatus.CANCELLED) {
    return {
      isPayable: false,
      amountToPay: 0,
      grossPaid,
      reason: 'Đơn hàng đã ở trạng thái hủy (CANCELLED), không thể thanh toán',
    }
  }

  if (order.status === OrderStatus.COMPLETED) {
    return {
      isPayable: false,
      amountToPay: 0,
      grossPaid,
      reason: 'Đơn hàng đã hoàn tất (COMPLETED), không còn khoản cần thanh toán',
    }
  }

  if (
    order.status === OrderStatus.DRAFT ||
    order.status === OrderStatus.PREORDER_WAITING
  ) {
    return {
      isPayable: false,
      amountToPay: 0,
      grossPaid,
      reason: 'Đơn hàng chưa đến bước thanh toán xác nhận',
    }
  }

  if (order.status === OrderStatus.PENDING_CONFIRMATION) {
    const targetConfirmation =
      order.paymentOption === PaymentOption.FULL ? order.total : order.depositAmount
    const remaining = Math.max(0, targetConfirmation - grossPaid)

    if (remaining === 0) {
      return {
        isPayable: false,
        amountToPay: 0,
        grossPaid,
        reason: 'Đơn hàng đã thanh toán đủ khoản cần xác nhận',
      }
    }

    return {
      isPayable: true,
      amountToPay: remaining,
      grossPaid,
    }
  }

  // PROCESSING, SHIPPING, DELIVERED, COMPLAINT
  const targetTotal = order.finalTotal ?? order.total
  const effectivePaid = Math.max(0, grossPaid - totalShortfallRefundDone)
  const remaining = Math.max(0, targetTotal - effectivePaid)

  if (remaining === 0) {
    return {
      isPayable: false,
      amountToPay: 0,
      grossPaid,
      reason: 'Đơn hàng đã thanh toán toàn bộ giá trị',
    }
  }
  return {
    isPayable: true,
    amountToPay: remaining,
    grossPaid,
  }
}
