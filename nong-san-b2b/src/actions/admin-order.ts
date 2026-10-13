'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { recordOrderEvent } from '@/lib/events'
import {
  OrderStatus,
  TxType,
  TxStatus,
  TxMethod,
  CancelActor,
} from '@prisma/client'

export interface ConfirmPaymentInput {
  orderId: string
  amount: number
  method: TxMethod
  reference?: string
  note?: string
}

/**
 * Server Action: Admin xác nhận đã nhận tiền (Mục 3.6 & Phase 4)
 * - Tạo PaymentTransaction(type=PAYMENT, status=DONE)
 * - Ghi OrderEvent PAYMENT_CONFIRMED
 * - Nếu số tiền đã trả >= depositAmount và đơn đang ở PENDING_CONFIRMATION,
 *   tự động chuyển trạng thái đơn hàng sang PROCESSING
 */
export async function confirmPayment(input: ConfirmPaymentInput) {
  try {
    const admin = await requireAdmin()

    if (input.amount <= 0) {
      return { success: false, error: 'Số tiền thanh toán phải lớn hơn 0' }
    }

    const result = await db.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        include: {
          transactions: true,
        },
      })

      if (!order) {
        throw new Error('Không tìm thấy đơn hàng')
      }

      // Tạo giao dịch thanh toán thành công
      const transaction = await tx.paymentTransaction.create({
        data: {
          orderId: order.id,
          type: TxType.PAYMENT,
          status: TxStatus.DONE,
          method: input.method,
          amount: input.amount,
          reference: input.reference?.trim() || null,
          note: input.note?.trim() || null,
          completedAt: new Date(),
        },
      })

      // Ghi OrderEvent: PAYMENT_CONFIRMED
      await recordOrderEvent(tx, {
        orderId: order.id,
        type: 'PAYMENT_CONFIRMED',
        actorId: admin.id,
        note: `Admin xác nhận đã nhận ${input.amount.toLocaleString('vi-VN')} đ qua ${input.method}${input.reference ? ` (Mã GD: ${input.reference})` : ''}`,
        payload: {
          transactionId: transaction.id,
          amount: input.amount,
          method: input.method,
          reference: input.reference,
        },
      })

      // Tính tổng tiền đã nhận sau giao dịch này
      const allTx = [...order.transactions, transaction]
      const totalPaid = allTx
        .filter((t) => t.type === TxType.PAYMENT && t.status === TxStatus.DONE)
        .reduce((sum, t) => sum + t.amount, 0)

      // Nếu đơn đang PENDING_CONFIRMATION và đã nhận đủ tiền cọc (hoặc 100%)
      const requiredThreshold = order.depositAmount
      let statusChanged = false

      if (order.status === OrderStatus.PENDING_CONFIRMATION && totalPaid >= requiredThreshold) {
        await tx.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.PROCESSING },
        })

        await recordOrderEvent(tx, {
          orderId: order.id,
          type: 'STATUS_CHANGED',
          fromStatus: OrderStatus.PENDING_CONFIRMATION,
          toStatus: OrderStatus.PROCESSING,
          actorId: admin.id,
          note: `Đã nhận đủ tiền thanh toán/cọc (${totalPaid.toLocaleString('vi-VN')} đ ≥ ${requiredThreshold.toLocaleString('vi-VN')} đ) -> Chuyển sang Đang xử lý`,
        })

        statusChanged = true
      }

      return {
        success: true,
        transactionId: transaction.id,
        statusChanged,
      }
    })

    revalidatePath(`/admin/don-hang/${input.orderId}`)
    revalidatePath('/admin/don-hang')

    return {
      success: true,
      message: result.statusChanged
        ? 'Đã xác nhận thanh toán & chuyển đơn hàng sang ĐANG XỬ LÝ (PROCESSING)'
        : 'Đã ghi nhận thanh toán thành công',
    }
  } catch (error) {
    console.error('Error confirming payment:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Xác nhận thanh toán thất bại',
    }
  }
}

/**
 * Quét và hủy các đơn PENDING_CONFIRMATION quá hạn 24h mà chưa thanh toán (paid = 0)
 */
export async function expireOrdersJob() {
  const now = new Date()

  // Tìm các đơn PENDING_CONFIRMATION có paymentDueAt < now
  const overdueOrders = await db.order.findMany({
    where: {
      status: OrderStatus.PENDING_CONFIRMATION,
      paymentDueAt: { lt: now },
    },
    include: {
      transactions: {
        where: {
          type: TxType.PAYMENT,
          status: TxStatus.DONE,
        },
      },
    },
  })

  let expiredCount = 0

  for (const order of overdueOrders) {
    // Chỉ hủy nếu chưa thanh toán đồng nào (paid = 0)
    const paid = order.transactions.reduce((sum, tx) => sum + tx.amount, 0)
    if (paid === 0) {
      await db.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.CANCELLED,
            cancelledBy: CancelActor.SYSTEM,
            cancelReason: 'Quá hạn thanh toán 24h mà hệ thống chưa nhận được tiền',
          },
        })

        await recordOrderEvent(tx, {
          orderId: order.id,
          type: 'PAYMENT_EXPIRED',
          fromStatus: OrderStatus.PENDING_CONFIRMATION,
          toStatus: OrderStatus.CANCELLED,
          note: 'Hệ thống tự động hủy đơn do quá hạn thanh toán 24h',
        })
      })

      expiredCount++
    }
  }

  revalidatePath('/admin/don-hang')
  return { success: true, expiredCount }
}
