import {
  OrderStatus,
  OrderType,
  PaymentOption,
  CancelActor,
  ComplaintStatus,
  ComplaintResolutionType,
  Resolution,
  TxType,
  TxStatus,
} from '@prisma/client'
import { getVietnamDateParts, VIETNAM_TIMEZONE } from './delivery-date'

export { VIETNAM_TIMEZONE }

export type DateRangePreset = '7D' | '30D' | 'THIS_MONTH' | 'CUSTOM'
export type ReportGrouping = 'DAY' | 'WEEK'

export interface ResolvedDateRange {
  startDate: Date
  endDate: Date
  fromText: string // YYYY-MM-DD (theo giờ VN)
  toText: string // YYYY-MM-DD (theo giờ VN)
  preset: DateRangePreset
}

/**
 * Tạo mốc thời gian bắt đầu ngày 00:00:00.000 theo múi giờ Việt Nam (UTC+7)
 */
export function createVietnamDateStart(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) - 7 * 60 * 60 * 1000)
}

/**
 * Tạo mốc thời gian kết thúc ngày 23:59:59.999 theo múi giờ Việt Nam (UTC+7)
 */
export function createVietnamDateEnd(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) - 7 * 60 * 60 * 1000)
}

/**
 * Chuyển đổi Date sang chuỗi ngày YYYY-MM-DD theo múi giờ Việt Nam (Asia/Ho_Chi_Minh)
 */
export function formatVietnamDateString(date: Date): string {
  const parts = getVietnamDateParts(date)
  const mm = String(parts.month).padStart(2, '0')
  const dd = String(parts.day).padStart(2, '0')
  return `${parts.year}-${mm}-${dd}`
}

/**
 * Parse chuỗi YYYY-MM-DD thành { year, month, day }
 */
export function parseYmdString(ymd: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim())
  if (!match) return null
  return {
    year: parseInt(match[1], 10),
    month: parseInt(match[2], 10),
    day: parseInt(match[3], 10),
  }
}

/**
 * Giải quyết khoảng thời gian lọc báo cáo theo chuẩn giờ Việt Nam (Asia/Ho_Chi_Minh)
 * - '7D': 7 ngày gần nhất (hôm nay và 6 ngày trước)
 * - '30D': 30 ngày gần nhất (hôm nay và 29 ngày trước)
 * - 'THIS_MONTH': từ ngày 1 của tháng hiện tại đến hết hôm nay
 * - 'CUSTOM': từ customFrom đến customTo
 */
export function resolveDateRange(
  preset: DateRangePreset,
  customFrom?: string | null,
  customTo?: string | null,
  now: Date = new Date()
): ResolvedDateRange {
  const nowParts = getVietnamDateParts(now)
  const currentYmd = `${nowParts.year}-${String(nowParts.month).padStart(2, '0')}-${String(nowParts.day).padStart(2, '0')}`

  if (preset === 'CUSTOM' && customFrom && customTo) {
    const fromParsed = parseYmdString(customFrom)
    const toParsed = parseYmdString(customTo)
    if (fromParsed && toParsed) {
      const start = createVietnamDateStart(fromParsed.year, fromParsed.month, fromParsed.day)
      const end = createVietnamDateEnd(toParsed.year, toParsed.month, toParsed.day)
      // Đảm bảo start <= end
      if (start.getTime() <= end.getTime()) {
        return {
          startDate: start,
          endDate: end,
          fromText: customFrom,
          toText: customTo,
          preset: 'CUSTOM',
        }
      }
    }
  }

  if (preset === 'THIS_MONTH') {
    const start = createVietnamDateStart(nowParts.year, nowParts.month, 1)
    const end = createVietnamDateEnd(nowParts.year, nowParts.month, nowParts.day)
    return {
      startDate: start,
      endDate: end,
      fromText: `${nowParts.year}-${String(nowParts.month).padStart(2, '0')}-01`,
      toText: currentYmd,
      preset: 'THIS_MONTH',
    }
  }

  const daysToSubtract = preset === '30D' ? 29 : 6
  // Tính ngày bắt đầu bằng cách lùi n ngày theo UTC của ngày VN
  const targetDateUtc = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day - daysToSubtract))
  const startYear = targetDateUtc.getUTCFullYear()
  const startMonth = targetDateUtc.getUTCMonth() + 1
  const startDay = targetDateUtc.getUTCDate()

  const start = createVietnamDateStart(startYear, startMonth, startDay)
  const end = createVietnamDateEnd(nowParts.year, nowParts.month, nowParts.day)
  const fromYmd = `${startYear}-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`

  return {
    startDate: start,
    endDate: end,
    fromText: fromYmd,
    toText: currentYmd,
    preset: preset === '30D' ? '30D' : '7D',
  }
}

// -------------------------------------------------------------
// DỮ LIỆU ĐẦU VÀO VÀ THỰC THI THỐNG KÊ
// -------------------------------------------------------------

export interface ReportOrderItemInput {
  id: string
  productId: string
  productName: string
  isSample: boolean
  quantity: number
  orderedGrams: number
  actualGrams: number | null
  unitPricePerKg: number
  lineTotal: number
  finalLineTotal: number | null
}

export interface ReportOrderInput {
  id: string
  code: string
  status: OrderStatus
  type: OrderType
  createdAt: Date
  total: number
  finalTotal: number | null
  depositAmount: number
  paymentOption: PaymentOption
  cancelledBy: CancelActor | null
  cancelReason: string | null
  user: {
    id: string
    fullName: string
    companyName: string | null
    group: {
      id: string
      code: string
      name: string
    } | null
  }
  items: ReportOrderItemInput[]
  complaints?: Array<{
    id: string
    status: ComplaintStatus
    resolution?: Resolution | null
    compensation?: number | null
  }>
}

export interface PaymentTransactionInput {
  id: string
  orderId: string
  type: TxType
  status: TxStatus
  amount: number
  createdAt: Date
}

/**
 * Kiểm tra xem một đơn hàng có đủ điều kiện để ghi nhận vào doanh thu và sản lượng hay không (BR-01, BR-04, BR-05)
 * - Điều kiện 1: Đơn hàng đã ở trạng thái COMPLETED
 * - Điều kiện 2: Không có khiếu nại nào đang mở (OPEN)
 */
export function isOrderEligibleForRevenue(order: {
  status: OrderStatus | string
  complaints?: Array<{
    id?: string
    status: ComplaintStatus | string
    resolution?: Resolution | string | null
    compensation?: number | null
  }>
}): boolean {
  if (order.status !== OrderStatus.COMPLETED) {
    return false
  }

  // BR-04: Đang có khiếu nại chưa giải quyết -> loại khỏi doanh thu đủ điều kiện
  if (order.complaints && order.complaints.some((c) => c.status === ComplaintStatus.OPEN || c.status === ComplaintStatus.PROPOSED || c.status === ComplaintStatus.UNDER_REVIEW)) {
    return false
  }

  return true
}

/**
 * Tính doanh thu thực tế được ghi nhận của đơn hàng sau khi trừ các khoản bồi hoàn khiếu nại đã giải quyết (BR-02, BR-05)
 */
export function getOrderEligibleRevenue(order: {
  total: number
  finalTotal?: number | null
  complaints?: Array<{
    id?: string
    status: ComplaintStatus | string
    resolution?: Resolution | string | null
    proposalType?: ComplaintResolutionType | string | null
    compensation?: number | null
  }>
}): number {
  const baseTotal =
    order.finalTotal !== null && order.finalTotal !== undefined ? order.finalTotal : order.total

  let refundCompensation = 0
  if (order.complaints) {
    for (const c of order.complaints) {
      if (
        (c.status === ComplaintStatus.RESOLVED || c.status === ComplaintStatus.CUSTOMER_ACCEPTED) &&
        (c.resolution === Resolution.REFUND || c.proposalType === ComplaintResolutionType.REFUND_MONEY) &&
        c.compensation &&
        c.compensation > 0
      ) {
        refundCompensation += c.compensation
      }
    }
  }

  return Math.max(0, baseTotal - refundCompensation)
}

// 1. DOANH THU THEO NGÀY / TUẦN
export interface RevenuePoint {
  periodKey: string // YYYY-MM-DD hoặc Tuần WW
  displayLabel: string // 19/10 hoặc Tuần 42
  revenue: number // Đơn COMPLETED, sum(finalTotal ?? total)
  orderCount: number // Số đơn COMPLETED
  totalKg: number // Sản lượng kg thực giao / đặt của đơn COMPLETED
}

export interface RevenueTimelineResult {
  points: RevenuePoint[]
  totalRevenue: number
  totalCompletedOrders: number
  totalKg: number
}

/**
 * Tính doanh thu theo ngày/tuần từ các đơn tạo trong kỳ và hiện đã COMPLETED
 * - Chỉ tính đơn status === OrderStatus.COMPLETED
 * - Lấy finalTotal ?? total (kể cả khi finalTotal === 0)
 * - Không cộng trùng cọc 30% và thanh toán còn lại
 */
export function computeRevenueTimeline(
  orders: ReportOrderInput[],
  startDate: Date,
  endDate: Date,
  grouping: ReportGrouping = 'DAY'
): RevenueTimelineResult {
  const completedOrders = orders.filter(isOrderEligibleForRevenue)

  if (grouping === 'DAY') {
    // Tạo danh sách tất cả các ngày liên tục trong khoảng
    const dayMap = new Map<string, { revenue: number; orderCount: number; totalGrams: number }>()

    const currentCursor = new Date(startDate.getTime())
    while (currentCursor.getTime() <= endDate.getTime()) {
      const ymd = formatVietnamDateString(currentCursor)
      if (!dayMap.has(ymd)) {
        dayMap.set(ymd, { revenue: 0, orderCount: 0, totalGrams: 0 })
      }
      currentCursor.setTime(currentCursor.getTime() + 24 * 60 * 60 * 1000)
    }

    for (const order of completedOrders) {
      const ymd = formatVietnamDateString(order.createdAt)
      const existing = dayMap.get(ymd)
      const effectiveTotal = getOrderEligibleRevenue(order)

      let orderGrams = 0
      for (const item of order.items) {
        if (!item.isSample) {
          orderGrams += item.actualGrams !== null && item.actualGrams !== undefined ? item.actualGrams : item.orderedGrams
        }
      }

      if (existing) {
        existing.revenue += effectiveTotal
        existing.orderCount += 1
        existing.totalGrams += orderGrams
      } else {
        dayMap.set(ymd, {
          revenue: effectiveTotal,
          orderCount: 1,
          totalGrams: orderGrams,
        })
      }
    }

    const points: RevenuePoint[] = []
    let totalRevenue = 0
    let totalCompletedOrders = 0
    let totalGramsAll = 0

    const sortedKeys = Array.from(dayMap.keys()).sort()
    for (const ymd of sortedKeys) {
      const data = dayMap.get(ymd)!
      const parts = ymd.split('-')
      const displayLabel = parts.length === 3 ? `${parts[2]}/${parts[1]}` : ymd

      points.push({
        periodKey: ymd,
        displayLabel,
        revenue: data.revenue,
        orderCount: data.orderCount,
        totalKg: Math.round((data.totalGrams / 1000) * 10) / 10,
      })

      totalRevenue += data.revenue
      totalCompletedOrders += data.orderCount
      totalGramsAll += data.totalGrams
    }

    return {
      points,
      totalRevenue,
      totalCompletedOrders,
      totalKg: Math.round((totalGramsAll / 1000) * 10) / 10,
    }
  }

  // Grouping by WEEK
  const weekMap = new Map<string, { revenue: number; orderCount: number; totalGrams: number; label: string }>()

  for (const order of completedOrders) {
    const vnParts = getVietnamDateParts(order.createdAt)
    // Tính ngày thứ 2 đầu tuần theo VN
    const dateUtc = new Date(Date.UTC(vnParts.year, vnParts.month - 1, vnParts.day))
    const dayOfWeek = dateUtc.getUTCDay() // 0 = Sun, 1 = Mon ...
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    const mondayUtc = new Date(dateUtc.getTime() + diffToMonday * 24 * 60 * 60 * 1000)
    const mYear = mondayUtc.getUTCFullYear()
    const mMonth = String(mondayUtc.getUTCMonth() + 1).padStart(2, '0')
    const mDay = String(mondayUtc.getUTCDate()).padStart(2, '0')
    const weekKey = `${mYear}-${mMonth}-${mDay}`
    const label = `Tuần ${mDay}/${mMonth}`

    const effectiveTotal = getOrderEligibleRevenue(order)
    let orderGrams = 0
    for (const item of order.items) {
      if (!item.isSample) {
        orderGrams += item.actualGrams !== null && item.actualGrams !== undefined ? item.actualGrams : item.orderedGrams
      }
    }

    const existing = weekMap.get(weekKey)
    if (existing) {
      existing.revenue += effectiveTotal
      existing.orderCount += 1
      existing.totalGrams += orderGrams
    } else {
      weekMap.set(weekKey, {
        revenue: effectiveTotal,
        orderCount: 1,
        totalGrams: orderGrams,
        label,
      })
    }
  }

  const sortedWeekKeys = Array.from(weekMap.keys()).sort()
  const points: RevenuePoint[] = []
  let totalRevenue = 0
  let totalCompletedOrders = 0
  let totalGramsAll = 0

  for (const k of sortedWeekKeys) {
    const data = weekMap.get(k)!
    points.push({
      periodKey: k,
      displayLabel: data.label,
      revenue: data.revenue,
      orderCount: data.orderCount,
      totalKg: Math.round((data.totalGrams / 1000) * 10) / 10,
    })
    totalRevenue += data.revenue
    totalCompletedOrders += data.orderCount
    totalGramsAll += data.totalGrams
  }

  return {
    points,
    totalRevenue,
    totalCompletedOrders,
    totalKg: Math.round((totalGramsAll / 1000) * 10) / 10,
  }
}

// 2. TOP 10 SẢN PHẨM (THEO KHỐI LƯỢNG KG VÀ DOANH THU)
export interface ProductPerformanceItem {
  productId: string
  productName: string
  totalKg: number
  totalRevenue: number
  orderCount: number
}

export interface TopProductsResult {
  topByKg: ProductPerformanceItem[]
  topByRevenue: ProductPerformanceItem[]
  sampleProductsCount: number
}

/**
 * Thống kê Top 10 sản phẩm bán chạy nhất từ các đơn COMPLETED
 * - Ưu tiên actualGrams khi đã cân thực tế, fallback về orderedGrams
 * - Lấy finalLineTotal ?? lineTotal cho doanh thu từng dòng
 * - Tách biệt dòng hàng mẫu (isSample = true) để không bóp méo hiệu quả thương mại
 * - Loại trừ hoàn toàn đơn hủy, đơn nháp, đơn chưa hoàn thành
 */
export function computeTopProducts(
  orders: ReportOrderInput[],
  topN: number = 10
): TopProductsResult {
  const completedOrders = orders.filter(isOrderEligibleForRevenue)
  const productMap = new Map<
    string,
    {
      productId: string
      productName: string
      totalGrams: number
      totalRevenue: number
      orderIds: Set<string>
    }
  >()

  let sampleProductsCount = 0

  for (const order of completedOrders) {
    for (const item of order.items) {
      if (item.isSample) {
        sampleProductsCount += item.quantity
        continue
      }

      const grams = item.actualGrams !== null && item.actualGrams !== undefined ? item.actualGrams : item.orderedGrams
      const revenue = item.finalLineTotal !== null && item.finalLineTotal !== undefined ? item.finalLineTotal : item.lineTotal

      const existing = productMap.get(item.productId)
      if (existing) {
        existing.totalGrams += grams
        existing.totalRevenue += revenue
        existing.orderIds.add(order.id)
      } else {
        const orderIds = new Set<string>()
        orderIds.add(order.id)
        productMap.set(item.productId, {
          productId: item.productId,
          productName: item.productName,
          totalGrams: grams,
          totalRevenue: revenue,
          orderIds,
        })
      }
    }
  }

  const allItems: ProductPerformanceItem[] = Array.from(productMap.values()).map((p) => ({
    productId: p.productId,
    productName: p.productName,
    totalKg: Math.round((p.totalGrams / 1000) * 10) / 10,
    totalRevenue: p.totalRevenue,
    orderCount: p.orderIds.size,
  }))

  const topByKg = [...allItems]
    .sort((a, b) => b.totalKg - a.totalKg || b.totalRevenue - a.totalRevenue)
    .slice(0, topN)

  const topByRevenue = [...allItems]
    .sort((a, b) => b.totalRevenue - a.totalRevenue || b.totalKg - a.totalKg)
    .slice(0, topN)

  return {
    topByKg,
    topByRevenue,
    sampleProductsCount,
  }
}

// 3. TỶ LỆ HỦY ĐƠN & KHIẾU NẠI
export interface CancellationAndComplaintStats {
  totalOrders: number // Mẫu số thương mại (loại trừ DRAFT chưa xác nhận)
  cancelledOrdersCount: number
  cancellationRate: number // % (0..100)
  byCustomerCount: number
  byCustomerRate: number
  bySellerCount: number
  bySellerRate: number
  bySystemCount: number
  bySystemRate: number
  unspecifiedCancelCount: number
  complaintOrdersCount: number // Số đơn phát sinh ít nhất 1 khiếu nại (không đếm trùng)
  complaintRate: number // % tính trên totalOrders
  totalComplaintsCount: number // Tổng số bản ghi Complaint
}

/**
 * Tính tỷ lệ hủy đơn (phân loại theo CUSTOMER/SELLER/SYSTEM) và tỷ lệ khiếu nại
 * - Loại trừ đơn DRAFT chưa xác nhận khỏi mẫu số thương mại
 * - Một đơn có nhiều khiếu nại chỉ tính là 1 đơn phát sinh khiếu nại
 * - Xử lý an toàn khi totalOrders === 0 (tránh chia cho 0)
 */
export function computeCancellationAndComplaintRates(
  orders: ReportOrderInput[]
): CancellationAndComplaintStats {
  // Loại trừ đơn DRAFT định kỳ chưa xác nhận
  const commercialOrders = orders.filter((o) => o.status !== OrderStatus.DRAFT)
  const totalOrders = commercialOrders.length

  if (totalOrders === 0) {
    return {
      totalOrders: 0,
      cancelledOrdersCount: 0,
      cancellationRate: 0,
      byCustomerCount: 0,
      byCustomerRate: 0,
      bySellerCount: 0,
      bySellerRate: 0,
      bySystemCount: 0,
      bySystemRate: 0,
      unspecifiedCancelCount: 0,
      complaintOrdersCount: 0,
      complaintRate: 0,
      totalComplaintsCount: 0,
    }
  }

  let cancelledOrdersCount = 0
  let byCustomerCount = 0
  let bySellerCount = 0
  let bySystemCount = 0
  let unspecifiedCancelCount = 0

  let complaintOrdersCount = 0
  let totalComplaintsCount = 0

  for (const order of commercialOrders) {
    if (order.status === OrderStatus.CANCELLED) {
      cancelledOrdersCount++
      if (order.cancelledBy === CancelActor.CUSTOMER) {
        byCustomerCount++
      } else if (order.cancelledBy === CancelActor.SELLER) {
        bySellerCount++
      } else if (order.cancelledBy === CancelActor.SYSTEM) {
        bySystemCount++
      } else {
        unspecifiedCancelCount++
      }
    }

    if (order.complaints && order.complaints.length > 0) {
      complaintOrdersCount++
      totalComplaintsCount += order.complaints.length
    }
  }

  const roundPercent = (count: number) => Math.round((count / totalOrders) * 1000) / 10

  return {
    totalOrders,
    cancelledOrdersCount,
    cancellationRate: roundPercent(cancelledOrdersCount),
    byCustomerCount,
    byCustomerRate: roundPercent(byCustomerCount),
    bySellerCount,
    bySellerRate: roundPercent(bySellerCount),
    bySystemCount,
    bySystemRate: roundPercent(bySystemCount),
    unspecifiedCancelCount,
    complaintOrdersCount,
    complaintRate: roundPercent(complaintOrdersCount),
    totalComplaintsCount,
  }
}

// 4. TỶ LỆ HAO HỤT TRUNG BÌNH (SHRINKAGE)
export interface ShrinkageStats {
  measuredItemsCount: number
  totalOrderedGrams: number
  totalActualGrams: number
  shrinkageGrams: number // ordered - actual
  shrinkageRate: number // % = (1 - actual / ordered) * 100
  hasMeasuredData: boolean
}

/**
 * Tính tỷ lệ hao hụt trung bình thực tế
 * Công thức: 1 - SUM(actualGrams) / SUM(orderedGrams)
 * - Chỉ lấy các dòng hàng của đơn COMPLETED có actualGrams > 0 và orderedGrams > 0
 * - Bỏ qua hàng mẫu (isSample = true)
 * - Tính theo tổng trọng lượng (weighted aggregate), KHÔNG tính trung bình số học các tỷ lệ
 */
export function computeShrinkageStats(orders: ReportOrderInput[]): ShrinkageStats {
  const completedOrders = orders.filter(isOrderEligibleForRevenue)

  let totalOrderedGrams = 0
  let totalActualGrams = 0
  let measuredItemsCount = 0

  for (const order of completedOrders) {
    for (const item of order.items) {
      if (item.isSample) continue
      if (
        item.actualGrams !== null &&
        item.actualGrams !== undefined &&
        item.actualGrams > 0 &&
        item.orderedGrams > 0
      ) {
        totalOrderedGrams += item.orderedGrams
        totalActualGrams += item.actualGrams
        measuredItemsCount++
      }
    }
  }

  if (totalOrderedGrams === 0 || measuredItemsCount === 0) {
    return {
      measuredItemsCount: 0,
      totalOrderedGrams: 0,
      totalActualGrams: 0,
      shrinkageGrams: 0,
      shrinkageRate: 0,
      hasMeasuredData: false,
    }
  }

  const shrinkageGrams = totalOrderedGrams - totalActualGrams
  // Tính tỷ lệ chính xác bằng phép nhân nguyên trước khi chia: (shrinkageGrams * 1000) / totalOrderedGrams
  const shrinkageRate = Math.round((shrinkageGrams * 1000) / totalOrderedGrams) / 10

  return {
    measuredItemsCount,
    totalOrderedGrams,
    totalActualGrams,
    shrinkageGrams,
    shrinkageRate,
    hasMeasuredData: true,
  }
}

// 5. DOANH THU THEO NHÓM KHÁCH HÀNG HIỆN TẠI
export interface CustomerGroupRevenueItem {
  groupId: string
  groupCode: string
  groupName: string
  revenue: number
  orderCount: number
  percentage: number // % tổng doanh thu
}

export interface RevenueByCustomerGroupResult {
  groups: CustomerGroupRevenueItem[]
  totalRevenue: number
  groupCount: number
}

/**
 * Gom doanh thu đơn COMPLETED theo nhóm khách hàng HIỆN TẠI
 * Bắt buộc ghi chú UI: "Doanh thu theo nhóm khách hàng hiện tại"
 * Tuyệt đối không thay đổi hay ghi đè snapshot nhóm cũ của đơn hàng
 */
export function computeRevenueByCustomerGroup(
  orders: ReportOrderInput[]
): RevenueByCustomerGroupResult {
  const completedOrders = orders.filter(isOrderEligibleForRevenue)
  const groupMap = new Map<
    string,
    {
      groupId: string
      groupCode: string
      groupName: string
      revenue: number
      orderCount: number
    }
  >()

  let totalRevenue = 0

  for (const order of completedOrders) {
    const effectiveTotal = getOrderEligibleRevenue(order)
    totalRevenue += effectiveTotal

    const group = order.user.group
    const groupId = group?.id || 'UNASSIGNED'
    const groupCode = group?.code || 'UNASSIGNED'
    const groupName = group?.name || 'Chưa phân nhóm'

    const existing = groupMap.get(groupId)
    if (existing) {
      existing.revenue += effectiveTotal
      existing.orderCount += 1
    } else {
      groupMap.set(groupId, {
        groupId,
        groupCode,
        groupName,
        revenue: effectiveTotal,
        orderCount: 1,
      })
    }
  }

  const groups: CustomerGroupRevenueItem[] = Array.from(groupMap.values())
    .map((g) => ({
      ...g,
      percentage: totalRevenue > 0 ? Math.round((g.revenue / totalRevenue) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  return {
    groups,
    totalRevenue,
    groupCount: groups.length,
  }
}

// 6. PHÂN TÍCH DÒNG TIỀN (CASHFLOW)
export interface CashflowSummary {
  completedRevenue: number // Doanh thu ghi nhận từ đơn COMPLETED
  totalPaid: number // Tiền đã thanh toán (TxType = PAYMENT, TxStatus = DONE)
  totalRefunded: number // Tiền đã hoàn trả xong (TxType = REFUND, TxStatus = DONE)
  pendingRefund: number // Tiền hoàn đang chờ xử lý (TxType = REFUND, TxStatus = PENDING)
  netCashReceived: number // totalPaid - totalRefunded
}

/**
 * Phân tích dòng tiền thực nhận tách biệt với doanh thu đơn hoàn thành
 * - Doanh thu = tổng (finalTotal ?? total) của đơn COMPLETED
 * - Tiền đã thanh toán = tổng transaction PAYMENT thành công
 * - Tiền đã hoàn = tổng transaction REFUND thành công
 * - Tiền chờ hoàn = tổng transaction REFUND đang PENDING
 */
export function computeCashflowMetrics(
  orders: ReportOrderInput[],
  transactions: PaymentTransactionInput[] = []
): CashflowSummary {
  const completedRevenue = orders
    .filter(isOrderEligibleForRevenue)
    .reduce((sum, o) => sum + getOrderEligibleRevenue(o), 0)

  let totalPaid = 0
  let totalRefunded = 0
  let pendingRefund = 0

  for (const tx of transactions) {
    if (tx.type === TxType.PAYMENT && tx.status === TxStatus.DONE) {
      totalPaid += tx.amount
    } else if (tx.type === TxType.REFUND) {
      if (tx.status === TxStatus.DONE) {
        totalRefunded += tx.amount
      } else if (tx.status === TxStatus.PENDING) {
        pendingRefund += tx.amount
      }
    }
  }

  return {
    completedRevenue,
    totalPaid,
    totalRefunded,
    pendingRefund,
    netCashReceived: totalPaid - totalRefunded,
  }
}

// 7. ADMIN DASHBOARD OPERATIONAL KPIS
export interface AdminDashboardKpis {
  newOrdersToday: number // Đơn tạo hôm nay (không tính DRAFT)
  awaitingPaymentConfirmation: number // Đơn đang chờ xác nhận tiền (status = PENDING_CONFIRMATION)
  deliveriesToday: number // Đơn có ngày giao là hôm nay (đang xử lý/giao/hoàn thành)
  openComplaints: number // Khiếu nại đang mở (status = OPEN)
}

/**
 * Tính toán 4 KPI vận hành Admin từ dữ liệu thuần
 */
export function computeAdminDashboardKpis(input: {
  todayYmd: string
  orders: Array<{
    createdAt: Date
    status: OrderStatus
    deliveryDate: Date | null
  }>
  openComplaintsCount: number
}): AdminDashboardKpis {
  let newOrdersToday = 0
  let awaitingPaymentConfirmation = 0
  let deliveriesToday = 0

  for (const o of input.orders) {
    const createdYmd = formatVietnamDateString(o.createdAt)
    if (createdYmd === input.todayYmd && o.status !== OrderStatus.DRAFT) {
      newOrdersToday++
    }

    if (o.status === OrderStatus.PENDING_CONFIRMATION) {
      awaitingPaymentConfirmation++
    }

    if (o.deliveryDate) {
      const deliveryYmd = formatVietnamDateString(o.deliveryDate)
      if (
        deliveryYmd === input.todayYmd &&
        o.status !== OrderStatus.CANCELLED &&
        o.status !== OrderStatus.DRAFT
      ) {
        deliveriesToday++
      }
    }
  }

  return {
    newOrdersToday,
    awaitingPaymentConfirmation,
    deliveriesToday,
    openComplaints: input.openComplaintsCount,
  }
}
