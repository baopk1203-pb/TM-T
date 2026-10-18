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
} from '@prisma/client'
import {
  canTransition,
  getRequiredConfirmationPayment,
} from '@/lib/domain/order-state'

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
      // Khóa dòng nếu database hỗ trợ (PostgreSQL SELECT ... FOR UPDATE)
      try {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`
      } catch {
        // Bỏ qua nếu môi trường test / driver không hỗ trợ raw query
      }

      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        include: {
          transactions: true,
        },
      })

      if (!order) {
        throw new Error('Không tìm thấy đơn hàng')
      }

      // Kiểm tra trạng thái: Không ghi nhận thanh toán vào đơn đã hủy hoặc đã hoàn tất
      if (order.status === OrderStatus.CANCELLED) {
        throw new Error('Đơn hàng đã ở trạng thái hủy (CANCELLED), không thể ghi nhận thanh toán')
      }

      if (order.status === OrderStatus.COMPLETED) {
        throw new Error('Đơn hàng đã hoàn tất (COMPLETED), không thể ghi nhận thanh toán')
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

      // Nếu đơn đang PENDING_CONFIRMATION, kiểm tra điều kiện chuyển PROCESSING theo domain order-state
      let statusChanged = false

      if (order.status === OrderStatus.PENDING_CONFIRMATION) {
        const transitionCheck = canTransition(
          order,
          OrderStatus.PROCESSING,
          'SELLER',
          { paidAmount: totalPaid }
        )

        if (transitionCheck.ok) {
          const requiredThreshold = getRequiredConfirmationPayment(order)
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
            note: `Đã nhận đủ tiền thanh toán (${totalPaid.toLocaleString('vi-VN')} đ ≥ ${requiredThreshold.toLocaleString('vi-VN')} đ, hình thức: ${order.paymentOption}) -> Chuyển sang Đang xử lý`,
          })

          statusChanged = true
        }
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

import { processExpiredOrders } from '@/lib/services/order-expiration'

/**
 * Server Action: Quét và hủy các đơn PENDING_CONFIRMATION quá hạn 24h mà chưa thanh toán (paid = 0)
 * - Bảo vệ bằng requireAdmin() ở server-side (SRC-SEC-07)
 * - Nút "Quét đơn quá hạn" tại trang Admin tiếp tục sử dụng action này an toàn
 */
export async function expireOrdersJob() {
  try {
    await requireAdmin()
    const result = await processExpiredOrders()
    revalidatePath('/admin/don-hang')
    return result
  } catch (error) {
    console.error('Error running expireOrdersJob action:', error)
    return {
      success: false,
      expiredCount: 0,
      error: error instanceof Error ? error.message : 'Bạn không có quyền thực hiện thao tác này',
    }
  }
}
