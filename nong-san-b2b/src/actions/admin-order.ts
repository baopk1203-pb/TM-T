'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { recordOrderEvent } from '@/lib/events'
import { sendOrderNotification } from '@/lib/email'
import {
  OrderStatus,
  OrderType,
  TxType,
  TxStatus,
  TxMethod,
} from '@prisma/client'
import {
  canTransition,
  getRequiredConfirmationPayment,
} from '@/lib/domain/order-state'
import { isOrderPaymentExpired } from '@/lib/domain/inventory'
import {
  confirmOrderInventoryAllocations,
  expireOverdueOrderInTx,
} from '@/lib/services/inventory-reservation'

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

      const now = new Date()
      const donePayments = (order.transactions ?? []).filter(
        (t) => t.type === TxType.PAYMENT && t.status === TxStatus.DONE
      )
      const paidBefore = donePayments.reduce((sum, t) => sum + t.amount, 0)

      // Chống ghi nhận trùng giao dịch theo mã tham chiếu (PAY-09)
      const normalizedRef = input.reference?.trim() || null
      if (
        normalizedRef &&
        donePayments.some((t) => t.reference && t.reference.trim() === normalizedRef)
      ) {
        return {
          success: false as const,
          expiredAndReleased: false as const,
          error: `Mã giao dịch tham chiếu "${normalizedRef}" đã được xác nhận trước đó cho đơn hàng này.`,
        }
      }

      const targetTotal = order.finalTotal ?? order.total
      const requiredThreshold = getRequiredConfirmationPayment(order)

      // Kiểm tra hạn giữ chỗ 10 phút theo thời gian Server (EV-IMP-01C — PAY-06, PAY-08):
      // Nếu đơn đang ở PENDING_CONFIRMATION mà đã quá hạn 10 phút, từ chối xác nhận thanh toán và giải phóng kho (không hồi sinh reservation).
      if (
        isOrderPaymentExpired(
          {
            status: order.status,
            paymentDueAt: (order as unknown as { paymentDueAt?: Date | null }).paymentDueAt,
            paidAmount: paidBefore,
            requiredAmount: requiredThreshold,
          },
          now
        )
      ) {
        const expResult = await expireOverdueOrderInTx(tx, order.id, now, admin.id)
        return {
          success: false as const,
          expiredAndReleased: true as const,
          error: expResult.orderCancelled
            ? 'Đơn hàng đã quá thời hạn giữ chỗ thanh toán (10 phút). Hệ thống đã tự động hủy đơn và giải phóng tồn kho.'
            : 'Đơn hàng đã quá thời hạn giữ chỗ thanh toán (10 phút). Quyền giữ kho đã hết hạn và được giải phóng; vui lòng thực hiện hủy đơn để đối soát hoàn trả khoản tiền đã nhận.',
        }
      }

      const projectedTotalPaid = paidBefore + input.amount

      // Phương án A (PO Decision — PAY-01, PAY-02, PAY-03, PAY-04, PAY-12):
      // Trong PENDING_CONFIRMATION, chỉ cho phép xác nhận khi tổng số tiền thanh toán hợp lệ đạt ngưỡng yêu cầu.
      if (order.status === OrderStatus.PENDING_CONFIRMATION) {
        if (projectedTotalPaid < requiredThreshold) {
          const shortfall = requiredThreshold - projectedTotalPaid
          return {
            success: false as const,
            expiredAndReleased: false as const,
            error: `Số tiền xác nhận chưa đạt ngưỡng tối thiểu để duyệt đơn (${projectedTotalPaid.toLocaleString('vi-VN')} đ < cần tối thiểu ${requiredThreshold.toLocaleString('vi-VN')} đ, còn thiếu ${shortfall.toLocaleString('vi-VN')} đ). Không ghi nhận giao dịch DONE khi chưa đủ điều kiện xác nhận đơn.`,
          }
        }
      } else {
        // Đơn đã rời PENDING_CONFIRMATION (đã xác nhận cọc trước đó): chống ghi nhận trùng tiền cọc hoặc vượt tổng đơn (PAY-09)
        if (paidBefore >= targetTotal) {
          return {
            success: false as const,
            expiredAndReleased: false as const,
            error: 'Đơn hàng đã được thanh toán đủ 100%, không thể ghi nhận thêm thanh toán.',
          }
        }
        if (order.status === OrderStatus.PREORDER_WAITING) {
          return {
            success: false as const,
            expiredAndReleased: false as const,
            error: 'Đơn đặt trước đã xác nhận đủ tiền cọc và đang chờ thu hoạch, không thể ghi nhận trùng tiền cọc.',
          }
        }
        if (projectedTotalPaid < targetTotal) {
          const remaining = targetTotal - projectedTotalPaid
          return {
            success: false as const,
            expiredAndReleased: false as const,
            error: `Đơn hàng đã qua bước xác nhận cọc; khoản thanh toán tiếp theo phải tất toán đủ số tiền còn lại (còn thiếu ${remaining.toLocaleString('vi-VN')} đ).`,
          }
        }
      }

      if (projectedTotalPaid > targetTotal) {
        return {
          success: false as const,
          expiredAndReleased: false as const,
          error: `Tổng số tiền thanh toán (${projectedTotalPaid.toLocaleString('vi-VN')} đ) vượt quá tổng giá trị đơn hàng (${targetTotal.toLocaleString('vi-VN')} đ).`,
        }
      }

      // Kiểm tra và cập nhật trạng thái nguyên tử trước khi ghi giao dịch để chống race condition đồng thời (PAY-09, PAY-12)
      let statusChanged = false
      let targetStatus: OrderStatus | null = null
      let statusNote = ''

      if (order.status === OrderStatus.PENDING_CONFIRMATION) {
        if (order.type === OrderType.PREORDER) {
          const transitionCheck = canTransition(
            order,
            OrderStatus.PREORDER_WAITING,
            'SELLER',
            { paidAmount: projectedTotalPaid }
          )

          if (!transitionCheck.ok) {
            return {
              success: false as const,
              expiredAndReleased: false as const,
              error: transitionCheck.reason || 'Chưa đủ điều kiện xác nhận cọc đơn đặt trước',
            }
          }
          targetStatus = OrderStatus.PREORDER_WAITING
          statusNote = `Đã nhận đủ tiền cọc đặt trước (${projectedTotalPaid.toLocaleString('vi-VN')} đ ≥ ${order.depositAmount.toLocaleString('vi-VN')} đ) -> Chuyển sang Chờ thu hoạch (PREORDER_WAITING)`
        } else {
          const transitionCheck = canTransition(
            order,
            OrderStatus.PROCESSING,
            'SELLER',
            { paidAmount: projectedTotalPaid }
          )

          if (!transitionCheck.ok) {
            return {
              success: false as const,
              expiredAndReleased: false as const,
              error: transitionCheck.reason || 'Chưa đủ điều kiện chuyển đơn sang Đang xử lý',
            }
          }
          targetStatus = OrderStatus.PROCESSING
          statusNote = `Đã nhận đủ tiền thanh toán (${projectedTotalPaid.toLocaleString('vi-VN')} đ ≥ ${requiredThreshold.toLocaleString('vi-VN')} đ, hình thức: ${order.paymentOption}) -> Chuyển sang Đang xử lý`
        }

        const orderDelegate = tx.order as unknown as {
          updateMany?: (args: {
            where: { id: string; status: OrderStatus }
            data: { status: OrderStatus }
          }) => Promise<{ count: number }>
          update: (args: {
            where: { id: string }
            data: { status: OrderStatus }
          }) => Promise<unknown>
        }

        if (typeof orderDelegate.updateMany === 'function') {
          const updateRes = await orderDelegate.updateMany({
            where: {
              id: order.id,
              status: OrderStatus.PENDING_CONFIRMATION,
            },
            data: { status: targetStatus },
          })
          if (updateRes.count === 0) {
            throw new Error(
              'Đơn hàng đã được xác nhận hoặc thay đổi trạng thái bởi một yêu cầu đồng thời khác'
            )
          }
        } else {
          await orderDelegate.update({
            where: { id: order.id },
            data: { status: targetStatus },
          })
        }

        statusChanged = true
      }

      // Tạo giao dịch thanh toán thành công
      const transaction = await tx.paymentTransaction.create({
        data: {
          orderId: order.id,
          type: TxType.PAYMENT,
          status: TxStatus.DONE,
          method: input.method,
          amount: input.amount,
          reference: normalizedRef,
          note: input.note?.trim() || null,
          completedAt: now,
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

      if (statusChanged && targetStatus) {
        await recordOrderEvent(tx, {
          orderId: order.id,
          type: 'STATUS_CHANGED',
          fromStatus: OrderStatus.PENDING_CONFIRMATION,
          toStatus: targetStatus,
          actorId: admin.id,
          note: statusNote,
        })

        await confirmOrderInventoryAllocations(tx, order.id)
      }

      return {
        success: true as const,
        expiredAndReleased: false as const,
        transactionId: transaction.id,
        statusChanged,
      }
    })

    if (!result.success) {
      revalidatePath(`/admin/don-hang/${input.orderId}`)
      revalidatePath('/admin/don-hang')
      return {
        success: false,
        error: result.error,
      }
    }

    if (result.success) {
      try {
        await sendOrderNotification({
          type: 'PAYMENT_CONFIRMED',
          orderId: input.orderId,
          transactionId: result.transactionId,
        })
      } catch (err) {
        console.error('[confirmPayment] Failed to send payment confirmation notification:', err)
      }
    }

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
