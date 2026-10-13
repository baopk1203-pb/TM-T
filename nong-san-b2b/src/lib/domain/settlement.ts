import { TxType, TxStatus, OrderStatus, CancelActor } from '@prisma/client'

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
 * Suy ra trạng thái thanh toán từ các giao dịch thực tế (Mục 3.6)
 * - paid = Σ PAYMENT(DONE) - Σ REFUND(DONE)
 * - targetTotal = finalTotal ?? total
 */
export function derivePaymentStatus(
  order: OrderPaymentTarget,
  transactions: PaymentTransactionData[]
): {
  status: DerivedPaymentStatus
  paidAmount: number
  targetTotal: number
  remainingAmount: number
} {
  const targetTotal = order.finalTotal ?? order.total

  let totalPaymentDone = 0
  let totalRefundDone = 0
  let hasPendingRefund = false

  for (const tx of transactions) {
    if (tx.type === TxType.PAYMENT && tx.status === TxStatus.DONE) {
      totalPaymentDone += tx.amount
    } else if (tx.type === TxType.REFUND) {
      if (tx.status === TxStatus.DONE) {
        totalRefundDone += tx.amount
      } else if (tx.status === TxStatus.PENDING) {
        hasPendingRefund = true
      }
    }
  }

  const paidAmount = Math.max(0, totalPaymentDone - totalRefundDone)
  const remainingAmount = Math.max(0, targetTotal - paidAmount)

  // Nếu có giao dịch hoàn tiền đang chờ
  if (hasPendingRefund) {
    return {
      status: 'REFUND_PENDING',
      paidAmount,
      targetTotal,
      remainingAmount,
    }
  }

  // Đã từng có hoàn tiền thành công
  if (totalRefundDone > 0) {
    if (paidAmount === 0) {
      return {
        status: 'REFUNDED',
        paidAmount,
        targetTotal,
        remainingAmount,
      }
    }
    return {
      status: 'PARTIALLY_REFUNDED',
      paidAmount,
      targetTotal,
      remainingAmount,
    }
  }

  // Luồng thanh toán thông thường
  if (paidAmount === 0) {
    return {
      status: 'AWAITING_PAYMENT',
      paidAmount,
      targetTotal,
      remainingAmount,
    }
  }

  if (paidAmount >= targetTotal) {
    return {
      status: 'PAID',
      paidAmount,
      targetTotal,
      remainingAmount: 0,
    }
  }

  return {
    status: 'DEPOSIT_PAID',
    paidAmount,
    targetTotal,
    remainingAmount,
  }
}

/**
 * Tính toán tiền phạt/hoàn khi hủy đơn hàng (Mục 3.7 & Test Cases S2-S5)
 * - Khách hủy ở PROCESSING: Mất cọc (forfeit = min(paid, depositAmount)), hoàn paid - forfeit
 * - Bên bán (SELLER/ADMIN) hoặc SYSTEM hủy: Hoàn 100% (forfeit = 0, hoàn paid)
 * - Khách hủy ở PENDING_CONFIRMATION: Hoàn 100%
 */
export function computeCancellation(
  order: { status: OrderStatus; depositAmount: number },
  paid: number,
  cancelledBy: CancelActor | 'CUSTOMER' | 'SELLER' | 'SYSTEM'
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

  // Khách hủy khi đơn đang ở trạng thái PROCESSING
  if (
    cancelledBy === CancelActor.CUSTOMER &&
    order.status === OrderStatus.PROCESSING
  ) {
    const forfeit = Math.min(paid, order.depositAmount)
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
    const forfeit = Math.min(paid, order.depositAmount)
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
