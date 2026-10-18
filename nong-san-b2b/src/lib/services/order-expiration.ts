import { db } from '@/lib/db'
import { recordOrderEvent } from '@/lib/events'
import { OrderStatus, TxType, TxStatus, CancelActor } from '@prisma/client'

export interface ExpireOrdersResult {
  success: boolean
  expiredCount: number
  error?: string
}

/**
 * Service nội bộ: Quét và hủy các đơn PENDING_CONFIRMATION quá hạn mà chưa thanh toán (paid = 0)
 * - Tách biệt hoàn toàn khỏi Server Action công khai (SRC-SEC-07)
 * - Đảm bảo tính Idempotent: kiểm tra trạng thái và thanh toán nguyên tử trong transaction
 * - Tránh duplicate cancel và duplicate OrderEvent khi chạy lặp hoặc chạy đồng thời
 */
export async function processExpiredOrders(now: Date = new Date()): Promise<ExpireOrdersResult> {
  try {
    // 1. Tìm danh sách đơn PENDING_CONFIRMATION có hạn thanh toán trước mốc thời gian 'now'
    // Loại trừ ngay từ đầu các đơn đã có giao dịch thanh toán thành công (DONE)
    const candidateOrders = await db.order.findMany({
      where: {
        status: OrderStatus.PENDING_CONFIRMATION,
        paymentDueAt: { lt: now },
        transactions: {
          none: {
            type: TxType.PAYMENT,
            status: TxStatus.DONE,
          },
        },
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

    // 2. Duyệt từng đơn và thực thi cập nhật an toàn nguyên tử
    for (const candidate of candidateOrders) {
      const didExpire = await db.$transaction(async (tx) => {
        // Khóa dòng nếu database hỗ trợ (PostgreSQL SELECT ... FOR UPDATE)
        try {
          await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${candidate.id} FOR UPDATE`
        } catch {
          // Bỏ qua nếu môi trường test / driver không hỗ trợ raw query
        }

        // Kiểm tra lại trạng thái hiện hành và danh sách thanh toán bên trong transaction
        const current = await tx.order.findUnique({
          where: { id: candidate.id },
          include: {
            transactions: {
              where: {
                type: TxType.PAYMENT,
                status: TxStatus.DONE,
              },
            },
          },
        })

        // Nếu đơn không còn PENDING_CONFIRMATION (đã được thanh toán/hủy trước đó), bỏ qua
        if (!current || current.status !== OrderStatus.PENDING_CONFIRMATION) {
          return false
        }

        // Nếu hạn thanh toán chưa tới (do cập nhật gia hạn), bỏ qua
        if (!current.paymentDueAt || current.paymentDueAt >= now) {
          return false
        }

        // Tuyệt đối không hủy đơn đã có thanh toán dù là một phần (paid > 0)
        const totalPaid = current.transactions
          .filter((t) => t.type === TxType.PAYMENT && t.status === TxStatus.DONE)
          .reduce((sum, t) => sum + t.amount, 0)
        if (totalPaid > 0) {
          return false
        }

        // Cập nhật nguyên tử trạng thái đơn sang CANCELLED với điều kiện status vẫn là PENDING_CONFIRMATION
        const updateResult = await tx.order.updateMany({
          where: {
            id: current.id,
            status: OrderStatus.PENDING_CONFIRMATION,
          },
          data: {
            status: OrderStatus.CANCELLED,
            cancelledBy: CancelActor.SYSTEM,
            cancelReason: 'Quá hạn thanh toán 24h mà hệ thống chưa nhận được tiền',
          },
        })

        // Nếu count === 0 nghĩa là đã có một tác vụ khác (Cron/Admin) cập nhật trạng thái ngay trước đó
        if (updateResult.count === 0) {
          return false
        }

        // Ghi nhận sự kiện PAYMENT_EXPIRED đúng 1 lần khi tác vụ này thực sự chuyển trạng thái thành công
        await recordOrderEvent(tx, {
          orderId: current.id,
          type: 'PAYMENT_EXPIRED',
          fromStatus: OrderStatus.PENDING_CONFIRMATION,
          toStatus: OrderStatus.CANCELLED,
          note: 'Hệ thống tự động hủy đơn do quá hạn thanh toán 24h',
        })

        return true
      })

      if (didExpire) {
        expiredCount++
      }
    }

    return { success: true, expiredCount }
  } catch (error) {
    console.error('Error in processExpiredOrders:', error)
    return {
      success: false,
      expiredCount: 0,
      error: error instanceof Error ? error.message : 'Lỗi hệ thống khi quét đơn quá hạn',
    }
  }
}
