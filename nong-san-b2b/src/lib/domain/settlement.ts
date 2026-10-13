import { TxType, TxStatus, OrderStatus } from '@prisma/client'

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
