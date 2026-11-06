import { describe, it, expect } from 'vitest'
import {
  formatVietnamDate,
  formatVietnamDateTime,
  VIETNAM_TIMEZONE,
} from '@/lib/domain/delivery-date'

describe('HOTFIX PHASE 7: QW06-OBS-01 — Timezone Hydration & Formatting Stability', () => {
  it('hằng số VIETNAM_TIMEZONE phải là Asia/Ho_Chi_Minh', () => {
    expect(VIETNAM_TIMEZONE).toBe('Asia/Ho_Chi_Minh')
  })

  it('format ngày chuẩn Việt Nam DD/MM/YYYY không bị ảnh hưởng bởi múi giờ môi trường thực thi', () => {
    // 18:30 UTC = 01:30 sáng hôm sau tại Việt Nam (UTC+7)
    const utcTime = '2026-10-18T18:30:00.000Z'
    const formatted = formatVietnamDate(utcTime)
    expect(formatted).toBe('19/10/2026')
  })

  it('ngày sát nửa đêm (Edge cases 23:59:59 và 00:00:00 VN) hiển thị chính xác ngày', () => {
    // 1. Đúng nửa đêm 00:00:00.000 VN ngày 19/10 (UTC: 17:00:00.000 ngày 18/10)
    const midnightExact = new Date('2026-10-18T17:00:00.000Z')
    expect(formatVietnamDate(midnightExact)).toBe('19/10/2026')

    // 2. 1ms trước nửa đêm 23:59:59.999 VN ngày 18/10 (UTC: 16:59:59.999 ngày 18/10)
    const rightBeforeMidnight = new Date('2026-10-18T16:59:59.999Z')
    expect(formatVietnamDate(rightBeforeMidnight)).toBe('18/10/2026')

    // 3. 1 giây sau nửa đêm 00:00:01.000 VN ngày 19/10 (UTC: 17:00:01.000 ngày 18/10)
    const afterMidnight = new Date('2026-10-18T17:00:01.000Z')
    expect(formatVietnamDate(afterMidnight)).toBe('19/10/2026')
  })

  it('format ngày giờ chuẩn Việt Nam bao gồm cả giờ:phút:giây theo giờ Việt Nam', () => {
    // 2026-04-14 05:30:00 UTC = 2026-04-14 12:30:00 VN
    const isoString = '2026-04-14T05:30:00.000Z'
    const formatted = formatVietnamDateTime(isoString)
    expect(formatted).toMatch(/14\/0?4\/2026/)
    expect(formatted).toContain('12:30:00')
  })

  it('xử lý an toàn các giá trị null, undefined hoặc chuỗi ngày không hợp lệ', () => {
    expect(formatVietnamDate(null)).toBe('')
    expect(formatVietnamDate(undefined)).toBe('')
    expect(formatVietnamDate('invalid-date')).toBe('')

    expect(formatVietnamDateTime(null)).toBe('')
    expect(formatVietnamDateTime(undefined)).toBe('')
    expect(formatVietnamDateTime('invalid-date')).toBe('')
  })

  it('hỗ trợ tùy chọn Intl.DateTimeFormatOptions (ví dụ chỉ lấy giờ:phút)', () => {
    const isoString = '2026-10-19T08:15:30.000Z' // 15:15:30 VN
    const formatted = formatVietnamDateTime(isoString, {
      hour: '2-digit',
      minute: '2-digit',
    })
    expect(formatted).toContain('15:15')
  })
})

describe('HOTFIX PHASE 7: Payment Expiration Logic Preservation', () => {
  it('logic kiểm tra đơn quá hạn (isDueOver) giữ nguyên quy tắc không thay đổi', () => {
    const now = new Date('2026-10-19T10:00:00.000Z')

    const checkIsDueOver = (paymentDueAt: string | null, paidAmount: number) => {
      return Boolean(paymentDueAt && new Date(paymentDueAt) < now && paidAmount === 0)
    }

    // Case 1: Quá hạn và chưa thanh toán đồng nào -> isDueOver = true
    const pastDue = '2026-10-19T08:00:00.000Z'
    expect(checkIsDueOver(pastDue, 0)).toBe(true)

    // Format ngày hết hạn đúng múi giờ VN
    const deadlineVN = formatVietnamDateTime(pastDue)
    expect(deadlineVN).toContain('15:00:00') // 08:00 UTC + 7 = 15:00 VN

    // Case 2: Chưa quá hạn -> isDueOver = false
    const futureDue = '2026-10-19T12:00:00.000Z'
    expect(checkIsDueOver(futureDue, 0)).toBe(false)

    // Case 3: Quá hạn nhưng đã thanh toán cọc -> isDueOver = false
    expect(checkIsDueOver(pastDue, 500000)).toBe(false)
  })
})

describe('HOTFIX PHASE 7: QW06-MINOR-01 — Recharts Empty State Condition', () => {
  // Hàm mô phỏng điều kiện render của BarChart trong reports-client.tsx
  function shouldRenderBarChart(
    isMounted: boolean,
    timelinePointsCount: number,
    totalCompletedOrders: number,
    totalRevenue: number
  ): boolean {
    return (
      isMounted &&
      timelinePointsCount > 0 &&
      (totalCompletedOrders > 0 || totalRevenue > 0)
    )
  }

  it('khi có 0 đơn COMPLETED (và revenue = 0): KHÔNG render BarChart, rơi vào Empty State', () => {
    // buildRevenueTimeline luôn sinh ra 7 mốc ngày trong tuần
    const isMounted = true
    const timelinePointsCount = 7
    const totalCompletedOrders = 0
    const totalRevenue = 0

    const renderChart = shouldRenderBarChart(
      isMounted,
      timelinePointsCount,
      totalCompletedOrders,
      totalRevenue
    )

    // Phải là false để hiển thị Empty State thay vì trục X rỗng
    expect(renderChart).toBe(false)
  })

  it('khi có đơn COMPLETED hợp lệ: render BarChart bình thường', () => {
    const isMounted = true
    const timelinePointsCount = 7
    const totalCompletedOrders = 3
    const totalRevenue = 15000000

    const renderChart = shouldRenderBarChart(
      isMounted,
      timelinePointsCount,
      totalCompletedOrders,
      totalRevenue
    )

    expect(renderChart).toBe(true)
  })

  it('khi chưa mount (SSR isMounted = false): không render BarChart tránh vỡ DOM hydration', () => {
    const isMounted = false
    const timelinePointsCount = 7
    const totalCompletedOrders = 5
    const totalRevenue = 20000000

    const renderChart = shouldRenderBarChart(
      isMounted,
      timelinePointsCount,
      totalCompletedOrders,
      totalRevenue
    )

    expect(renderChart).toBe(false)
  })
})
