/**
 * Domain Logic: Customer Dashboard Metrics & Helpers — Phase 6C
 * Tuân thủ quy tắc nghiệp vụ:
 * 1. Đơn đang xử lý: PROCESSING, SHIPPING, DELIVERED, COMPLAINT
 * 2. Đơn chờ thanh toán: PENDING_CONFIRMATION chưa hoàn tất thanh toán
 * 3. Đơn nháp định kỳ: DRAFT chờ khách xác nhận
 * 4. Đơn Pre-order: PREORDER_WAITING (gồm chờ vụ mùa và cần bạn quyết định)
 *
 * Đảm bảo tính loại trừ lẫn nhau (mutually exclusive) - không đếm trùng giữa 4 thẻ KPI.
 */

import { OrderStatus, OrderType } from '@prisma/client'
import { isPreorderAwaitingCustomerDecision, PreorderDecisionCheckInput } from './preorder'
import { normalizeToUtcDate } from './recurring'

export interface DashboardOrderItem extends PreorderDecisionCheckInput {
  id: string
  code: string
  type: OrderType | string
  status: OrderStatus
  total: number
  finalTotal?: number | null
  deliveryDate?: Date | string | null
  timeSlot?: string | null
  createdAt?: Date | string
  paymentDueAt?: Date | string | null
}

export interface DashboardKpiMetrics {
  processingCount: number
  pendingPaymentCount: number
  draftRecurringCount: number
  preorderCount: number
  preorderAwaitingDecisionCount: number
  preorderWaitingHarvestCount: number
}

/**
 * Trạng thái thuộc nhóm "Đang xử lý"
 */
export const PROCESSING_STATUSES: OrderStatus[] = [
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPING,
  OrderStatus.DELIVERED,
  OrderStatus.COMPLAINT,
]

/**
 * Tính toán các chỉ số KPI hiển thị trên Customer Dashboard
 * Đảm bảo 4 nhóm KPI là hoàn toàn tách biệt, không đếm trùng lặp bất kỳ đơn nào:
 * - DRAFT: Nhóm Đơn nháp định kỳ
 * - PREORDER_WAITING: Nhóm Đơn Pre-order
 * - PENDING_CONFIRMATION: Nhóm Chờ thanh toán
 * - PROCESSING / SHIPPING / DELIVERED / COMPLAINT: Nhóm Đang xử lý
 */
export function getDashboardKpiMetrics(orders: DashboardOrderItem[]): DashboardKpiMetrics {
  let processingCount = 0
  let pendingPaymentCount = 0
  let draftRecurringCount = 0
  let preorderCount = 0
  let preorderAwaitingDecisionCount = 0

  for (const order of orders) {
    if (order.status === OrderStatus.DRAFT) {
      draftRecurringCount++
    } else if (order.status === OrderStatus.PREORDER_WAITING) {
      preorderCount++
      if (isPreorderAwaitingCustomerDecision(order)) {
        preorderAwaitingDecisionCount++
      }
    } else if (order.status === OrderStatus.PENDING_CONFIRMATION) {
      pendingPaymentCount++
    } else if (PROCESSING_STATUSES.includes(order.status)) {
      processingCount++
    }
  }

  const preorderWaitingHarvestCount = preorderCount - preorderAwaitingDecisionCount

  return {
    processingCount,
    pendingPaymentCount,
    draftRecurringCount,
    preorderCount,
    preorderAwaitingDecisionCount,
    preorderWaitingHarvestCount,
  }
}

/**
 * Tính hạn chót xác nhận đơn nháp định kỳ (DRAFT)
 * - Ưu tiên paymentDueAt nếu có
 * - Nếu không, tính lùi leadTimeDays từ deliveryDate (tối thiểu 1 ngày trước ngày giao)
 */
export function getDraftConfirmationDeadline(
  deliveryDate?: Date | string | null,
  paymentDueAt?: Date | string | null,
  leadTimeDays: number = 1
): Date | null {
  if (paymentDueAt) {
    return new Date(paymentDueAt)
  }

  if (!deliveryDate) {
    return null
  }

  const deliveryUtc = normalizeToUtcDate(deliveryDate)
  const effectiveLeadTime = Math.max(1, Math.floor(leadTimeDays))

  // Deadline là trước ngày giao hàng leadTimeDays (theo UTC date)
  return new Date(
    Date.UTC(
      deliveryUtc.getUTCFullYear(),
      deliveryUtc.getUTCMonth(),
      deliveryUtc.getUTCDate() - effectiveLeadTime,
      17, // 17:00 giờ chốt đơn Việt Nam
      0,
      0
    )
  )
}
