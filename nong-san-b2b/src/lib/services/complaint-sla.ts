/**
 * F02 — COMPLAINT SLA & AUTO-WITHDRAW SERVICE
 *
 * Chịu trách nhiệm quét và tự động xử lý khiếu nại quá hạn phản hồi 48 giờ (SLA 48h):
 * - Điều kiện: status = 'PROPOSED' và reviewDueAt <= now
 * - Hành động: chuyển sang WITHDRAWN, compensation = 0 đ, autoClosedAt = now
 * - Giải phóng doanh thu: nếu không còn khiếu nại active nào khác và không còn pending refund,
 *   đơn hàng chuyển sang COMPLETED, ghi nhận 100% doanh thu gốc.
 * - Chống Race Condition: sử dụng conditional updateMany để chỉ cập nhật khi status vẫn là PROPOSED.
 */

import { db } from '@/lib/db'
import { recordOrderEvent } from '@/lib/events'
import {
  ComplaintStatus,
  OrderStatus,
  TxType,
  TxStatus,
} from '@prisma/client'

export interface ProcessExpiredResult {
  processedCount: number
  complaintIds: string[]
}

/**
 * Quét và tự động rút toàn bộ khiếu nại đã quá hạn phản hồi 48 giờ.
 * Idempotent và an toàn tuyệt đối khi chạy đồng thời hoặc chạy lại nhiều lần.
 */
export async function processExpiredComplaintProposals(
  now: Date = new Date()
): Promise<ProcessExpiredResult> {
  const expiredCandidates = await db.complaint.findMany({
    where: {
      status: ComplaintStatus.PROPOSED,
      reviewDueAt: { lte: now },
    },
    select: {
      id: true,
      orderId: true,
      reviewDueAt: true,
    },
  })

  if (expiredCandidates.length === 0) {
    return { processedCount: 0, complaintIds: [] }
  }

  const processedIds: string[] = []

  for (const item of expiredCandidates) {
    try {
      await db.$transaction(async (tx) => {
        // Concurrency Guard: Chỉ cập nhật nếu trạng thái vẫn là PROPOSED và reviewDueAt <= now
        const updateRes = await tx.complaint.updateMany({
          where: {
            id: item.id,
            status: ComplaintStatus.PROPOSED,
            reviewDueAt: { lte: now },
          },
          data: {
            status: ComplaintStatus.WITHDRAWN,
            compensation: 0,
            autoClosedAt: now,
          },
        })

        if (updateRes.count === 0) {
          // Trạng thái đã thay đổi do khách vừa tương tác (ACCEPT/APPEAL/WITHDRAW) hoặc job khác đã quét
          return
        }

        // Kiểm tra xem đơn hàng còn khiếu nại active nào khác hoặc khoản refund pending nào không
        const [remainingActiveComplaints, remainingPendingRefunds] = await Promise.all([
          tx.complaint.count({
            where: {
              orderId: item.orderId,
              id: { not: item.id },
              status: {
                in: [
                  ComplaintStatus.OPEN,
                  ComplaintStatus.PROPOSED,
                  ComplaintStatus.UNDER_REVIEW,
                ],
              },
            },
          }),
          tx.paymentTransaction.count({
            where: {
              orderId: item.orderId,
              type: TxType.REFUND,
              status: TxStatus.PENDING,
            },
          }),
        ])

        // Nếu tất cả khiếu nại đã xong và không còn khoản hoàn tiền treo, chuyển đơn về COMPLETED
        if (remainingActiveComplaints === 0 && remainingPendingRefunds === 0) {
          await tx.order.update({
            where: { id: item.orderId },
            data: { status: OrderStatus.COMPLETED },
          })
        }

        // Ghi Audit Event
        await recordOrderEvent(tx, {
          orderId: item.orderId,
          type: 'COMPLAINT_AUTO_WITHDRAWN',
          note: 'Khiếu nại tự động rút (WITHDRAWN) do khách hàng không phản hồi trước thời hạn 48 giờ. Khoản bồi thường: 0 đ.',
          payload: {
            complaintId: item.id,
            reviewDueAt: item.reviewDueAt ? item.reviewDueAt.toISOString() : null,
            autoClosedAt: now.toISOString(),
          },
        })

        processedIds.push(item.id)
      })
    } catch (err) {
      console.error(`[processExpiredComplaintProposals] Lỗi khi xử lý khiếu nại ${item.id}:`, err)
    }
  }

  return {
    processedCount: processedIds.length,
    complaintIds: processedIds,
  }
}
