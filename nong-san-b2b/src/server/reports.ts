'use server'

import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import {
  DateRangePreset,
  ReportGrouping,
  resolveDateRange,
  computeRevenueTimeline,
  computeTopProducts,
  computeCancellationAndComplaintRates,
  computeShrinkageStats,
  computeRevenueByCustomerGroup,
  computeCashflowMetrics,
  computeAdminDashboardKpis,
  formatVietnamDateString,
  RevenueTimelineResult,
  TopProductsResult,
  CancellationAndComplaintStats,
  ShrinkageStats,
  RevenueByCustomerGroupResult,
  CashflowSummary,
  AdminDashboardKpis,
} from '@/lib/domain/reports'
import { ComplaintStatus } from '@prisma/client'

export interface GetBusinessReportsInput {
  preset?: DateRangePreset
  customFrom?: string | null
  customTo?: string | null
  grouping?: ReportGrouping
}

export interface BusinessReportData {
  range: {
    preset: DateRangePreset
    fromText: string
    toText: string
    startDateIso: string
    endDateIso: string
  }
  grouping: ReportGrouping
  timeline: RevenueTimelineResult
  topProducts: TopProductsResult
  cancellationAndComplaints: CancellationAndComplaintStats
  shrinkage: ShrinkageStats
  revenueByGroup: RevenueByCustomerGroupResult
  cashflow: CashflowSummary
}

/**
 * Server Action: Lấy dữ liệu báo cáo kinh doanh tổng hợp
 * - Bắt buộc quyền ADMIN qua requireAdmin()
 * - Lọc theo Order.createdAt trong khoảng ngày chọn
 * - Tính toán 5 nhóm thống kê cốt lõi + dòng tiền
 */
export async function getBusinessReports(
  input?: GetBusinessReportsInput
): Promise<{ success: boolean; data?: BusinessReportData; error?: string }> {
  try {
    await requireAdmin()

    const preset = input?.preset || '7D'
    const grouping = input?.grouping || 'DAY'
    const dateRange = resolveDateRange(preset, input?.customFrom, input?.customTo)

    const [orders, transactions] = await Promise.all([
      db.order.findMany({
        where: {
          createdAt: {
            gte: dateRange.startDate,
            lte: dateRange.endDate,
          },
        },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              companyName: true,
              group: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                },
              },
            },
          },
          items: true,
          complaints: {
            select: {
              id: true,
              status: true,
              resolution: true,
              compensation: true,
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      }),
      db.paymentTransaction.findMany({
        where: {
          createdAt: {
            gte: dateRange.startDate,
            lte: dateRange.endDate,
          },
        },
        select: {
          id: true,
          orderId: true,
          type: true,
          status: true,
          amount: true,
          createdAt: true,
        },
      }),
    ])

    const timeline = computeRevenueTimeline(orders, dateRange.startDate, dateRange.endDate, grouping)
    const topProducts = computeTopProducts(orders, 10)
    const cancellationAndComplaints = computeCancellationAndComplaintRates(orders)
    const shrinkage = computeShrinkageStats(orders)
    const revenueByGroup = computeRevenueByCustomerGroup(orders)
    const cashflow = computeCashflowMetrics(orders, transactions)

    return {
      success: true,
      data: {
        range: {
          preset: dateRange.preset,
          fromText: dateRange.fromText,
          toText: dateRange.toText,
          startDateIso: dateRange.startDate.toISOString(),
          endDateIso: dateRange.endDate.toISOString(),
        },
        grouping,
        timeline,
        topProducts,
        cancellationAndComplaints,
        shrinkage,
        revenueByGroup,
        cashflow,
      },
    }
  } catch (error) {
    console.error('Error fetching business reports:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Không thể tải báo cáo kinh doanh',
    }
  }
}

/**
 * Lấy 4 KPI vận hành thời gian thực cho trang Admin Dashboard (`/admin`)
 * - Đơn mới hôm nay (không tính DRAFT)
 * - Đơn chờ xác nhận tiền
 * - Đơn giao hôm nay
 * - Khiếu nại đang mở
 */
export async function getAdminDashboardKpis(now: Date = new Date()): Promise<AdminDashboardKpis> {
  const todayYmd = formatVietnamDateString(now)
  const range = resolveDateRange('7D', null, null, now) // Lấy tối thiểu khoảng ngày gần nhất để tính đơn hôm nay

  const [orders, openComplaintsCount] = await Promise.all([
    db.order.findMany({
      select: {
        createdAt: true,
        status: true,
        deliveryDate: true,
      },
      where: {
        OR: [
          { status: 'PENDING_CONFIRMATION' },
          { createdAt: { gte: range.startDate } },
          { deliveryDate: { not: null } },
        ],
      },
    }),
    db.complaint.count({
      where: {
        status: ComplaintStatus.OPEN,
      },
    }),
  ])

  return computeAdminDashboardKpis({
    todayYmd,
    orders,
    openComplaintsCount,
  })
}
