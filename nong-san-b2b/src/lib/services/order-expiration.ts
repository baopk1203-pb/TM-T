import { db } from '@/lib/db'
import { recordOrderEvent } from '@/lib/events'
import { isDraftExpired } from '@/lib/domain/recurring'
import { releaseOrderInventoryAllocations } from '@/lib/services/inventory-reservation'
import { OrderStatus, TxType, TxStatus, CancelActor } from '@prisma/client'

export interface ExpireOrdersResult {
  success: boolean
  expiredCount: number
  expiredPaymentCount?: number
  expiredDraftCount?: number
  error?: string
}

interface CandidateItemWithLeadTime {
  packaging?: {
    product?: {
      leadTimeDays?: number
    } | null
  } | null
}

function resolveMaxLeadTimeDays(items?: CandidateItemWithLeadTime[] | null): number {
  if (!Array.isArray(items) || items.length === 0) {
    return 1
  }
  const leadTimes = items
    .map((item) => item?.packaging?.product?.leadTimeDays ?? 1)
    .filter((days) => typeof days === 'number' && days > 0)
  return leadTimes.length > 0 ? Math.max(...leadTimes) : 1
}

/**
 * Service nội bộ:
 * 1. Quét và hủy các đơn PENDING_CONFIRMATION quá hạn 24h mà chưa thanh toán (paid = 0)
 * 2. Quét và hủy các đơn nháp định kỳ DRAFT quá hạn xác nhận (today > deliveryDate - leadTimeDays)
 * - Tách biệt hoàn toàn khỏi Server Action công khai (SRC-SEC-07)
 * - Đảm bảo tính Idempotent: kiểm tra trạng thái nguyên tử trong transaction
 * - Tránh duplicate cancel và duplicate OrderEvent khi chạy lặp hoặc chạy đồng thời
 */
export async function processExpiredOrders(now: Date = new Date()): Promise<ExpireOrdersResult> {
  try {
    const candidateOrders = await db.order.findMany({
      where: {
        OR: [
          {
            status: OrderStatus.PENDING_CONFIRMATION,
            paymentDueAt: { lt: now },
            transactions: {
              none: {
                type: TxType.PAYMENT,
                status: TxStatus.DONE,
              },
            },
          },
          {
            status: OrderStatus.DRAFT,
            deliveryDate: { not: null },
          },
        ],
      },
      include: {
        transactions: {
          where: {
            type: TxType.PAYMENT,
            status: TxStatus.DONE,
          },
        },
        items: {
          include: {
            packaging: {
              include: {
                product: {
                  select: { leadTimeDays: true },
                },
              },
            },
          },
        },
      },
    })

    let expiredCount = 0
    let expiredPaymentCount = 0
    let expiredDraftCount = 0

    for (const candidate of candidateOrders) {
      if (candidate.status === OrderStatus.DRAFT) {
        if (!candidate.deliveryDate) {
          continue
        }
        const candidateLeadTime = resolveMaxLeadTimeDays(
          (candidate as unknown as { items?: CandidateItemWithLeadTime[] }).items
        )
        if (!isDraftExpired(candidate.deliveryDate, now, candidateLeadTime)) {
          continue
        }

        const didExpireDraft = await db.$transaction(async (tx) => {
          try {
            await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${candidate.id} FOR UPDATE`
          } catch {
            // Bỏ qua nếu môi trường test / driver không hỗ trợ raw query
          }

          const current = await tx.order.findUnique({
            where: { id: candidate.id },
            include: {
              items: {
                include: {
                  packaging: {
                    include: {
                      product: {
                        select: { leadTimeDays: true },
                      },
                    },
                  },
                },
              },
            },
          })

          if (!current || current.status !== OrderStatus.DRAFT || !current.deliveryDate) {
            return false
          }

          const currentLeadTime = resolveMaxLeadTimeDays(
            (current as unknown as { items?: CandidateItemWithLeadTime[] }).items ??
              (candidate as unknown as { items?: CandidateItemWithLeadTime[] }).items
          )

          if (!isDraftExpired(current.deliveryDate, now, currentLeadTime)) {
            return false
          }

          const updateResult = await tx.order.updateMany({
            where: {
              id: current.id,
              status: OrderStatus.DRAFT,
            },
            data: {
              status: OrderStatus.CANCELLED,
              cancelledBy: CancelActor.SYSTEM,
              cancelReason:
                'Quá hạn xác nhận đơn nháp định kỳ (trước ngày giao - thời gian chuẩn bị)',
            },
          })

          if (updateResult.count === 0) {
            return false
          }

          await recordOrderEvent(tx, {
            orderId: current.id,
            type: 'DRAFT_EXPIRED',
            fromStatus: OrderStatus.DRAFT,
            toStatus: OrderStatus.CANCELLED,
            note: 'Hệ thống tự động hủy đơn nháp định kỳ do quá hạn xác nhận',
          })

          return true
        })

        if (didExpireDraft) {
          expiredCount++
          expiredDraftCount++
        }
        continue
      }

      // Nhánh xử lý đơn PENDING_CONFIRMATION quá hạn thanh toán 24h
      const didExpirePayment = await db.$transaction(async (tx) => {
        try {
          await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${candidate.id} FOR UPDATE`
        } catch {
          // Bỏ qua nếu môi trường test / driver không hỗ trợ raw query
        }

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

        if (!current || current.status !== OrderStatus.PENDING_CONFIRMATION) {
          return false
        }

        if (!current.paymentDueAt || current.paymentDueAt >= now) {
          return false
        }

        const totalPaid = current.transactions
          .filter((t) => t.type === TxType.PAYMENT && t.status === TxStatus.DONE)
          .reduce((sum, t) => sum + t.amount, 0)
        if (totalPaid > 0) {
          return false
        }

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

        if (updateResult.count === 0) {
          return false
        }

        // Giải phóng tồn kho đang giữ chỗ (HOLD_PENDING) đúng 1 lần (EV-IMP-01C)
        await releaseOrderInventoryAllocations(tx, {
          orderId: current.id,
          orderCode: (current as unknown as { code?: string | null }).code ?? null,
          reason: 'Giải phóng giữ chỗ FEFO do đơn quá hạn thanh toán 10 phút',
          now,
        })

        await recordOrderEvent(tx, {
          orderId: current.id,
          type: 'PAYMENT_EXPIRED',
          fromStatus: OrderStatus.PENDING_CONFIRMATION,
          toStatus: OrderStatus.CANCELLED,
          note: 'Hệ thống tự động hủy đơn do quá hạn thanh toán 24h',
        })

        return true
      })

      if (didExpirePayment) {
        expiredCount++
        expiredPaymentCount++
      }
    }

    return {
      success: true,
      expiredCount,
      expiredPaymentCount,
      expiredDraftCount,
    }
  } catch (error) {
    console.error('Error in processExpiredOrders:', error)
    return {
      success: false,
      expiredCount: 0,
      error: error instanceof Error ? error.message : 'Lỗi hệ thống khi quét đơn quá hạn',
    }
  }
}
