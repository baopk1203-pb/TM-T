/**
 * Domain Logic: Quarterly Evaluation & Membership Automation (F04-03)
 * Tuân thủ chính sách phê duyệt của PO:
 * - Chu kỳ xét hạng: 01/01, 01/04, 01/07, 01/10 (Múi giờ Asia/Ho_Chi_Minh).
 * - Sử dụng dữ liệu quý dương lịch liền kề trước đó: [quarterStart, nextQuarterStart).
 * - Hệ số khách hàng mới (New Customer Multiplier):
 *   + Tháng đầu quý: ×1.0
 *   + Tháng giữa quý: ×1.1
 *   + Tháng cuối quý: ×1.2
 *   (Cố định trong quý đầu tiên; chỉ áp dụng cho doanh thu & sản lượng hợp lệ, không nhân vào kỷ luật).
 * - Cơ chế bảo lưu 15 ngày cuối quý (Carryover 15 Days):
 *   + Khách đăng ký trong 15 ngày dương lịch cuối cùng của quý được bảo lưu sang quý tiếp theo.
 *   + Không xét hạng ở mốc ngay sau quý đăng ký; bảo lưu dữ liệu (nhân ×1.2 cho phần quý cũ)
 *     kết hợp với dữ liệu quý mới (nhân ×1.0) cho lần xét hạng đầu tiên ở mốc kế tiếp.
 */

import { MembershipTier } from './membership'
import {
  QuarterlyKpiInput,
  QuarterlyKpiResult,
  calculateQuarterlyKpi,
} from './membership-kpi'
import { getVietnamDateParts, VIETNAM_TIMEZONE } from './delivery-date'
import { OrderStatus, CancelActor, ComplaintStatus, ComplaintResolutionType, Resolution } from '@prisma/client'

export { VIETNAM_TIMEZONE }

export interface QuarterDateRange {
  quarterCode: string // Ví dụ: '2027-Q1'
  year: number
  quarter: number // 1, 2, 3, 4
  startDate: Date // Bắt đầu quý lúc 00:00:00.000 giờ VN
  endDate: Date // Bắt đầu quý tiếp theo (half-open nextQuarterStart) lúc 00:00:00.000 giờ VN
  carryoverStartDate: Date // Bắt đầu 15 ngày cuối quý (00:00:00.000 giờ VN)
}

/**
 * Tạo mốc Date theo múi giờ Việt Nam (UTC+7)
 */
export function createVnDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0
): Date {
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - 7 * 60 * 60 * 1000
  )
}

/**
 * Số ngày trong tháng (hỗ trợ năm nhuận chính xác)
 */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Parse chuỗi mã quý 'YYYY-QX' thành { year, quarter }
 */
export function parseQuarterCode(quarterCode: string): { year: number; quarter: number } {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarterCode.trim())
  if (!match) {
    throw new Error(`Mã quý không hợp lệ: "${quarterCode}". Định dạng chuẩn: YYYY-QX (ví dụ 2027-Q1)`)
  }
  return {
    year: parseInt(match[1], 10),
    quarter: parseInt(match[2], 10),
  }
}

/**
 * Định dạng mã quý từ năm và số quý
 */
export function formatQuarterCode(year: number, quarter: number): string {
  if (quarter < 1 || quarter > 4) {
    throw new Error(`Quý không hợp lệ: ${quarter} (chỉ chấp nhận 1..4)`)
  }
  return `${year}-Q${quarter}`
}

/**
 * Xác định mã quý liền trước từ một thời điểm bất kỳ theo giờ Việt Nam
 * Ví dụ:
 * - 01/04/2027 -> 2027-Q1
 * - 01/07/2027 -> 2027-Q2
 * - 01/10/2027 -> 2027-Q3
 * - 01/01/2028 -> 2027-Q4
 */
export function getPrecedingQuarterCode(now: Date = new Date()): string {
  const parts = getVietnamDateParts(now)
  const currentMonth = parts.month
  const currentYear = parts.year

  const currentQuarter = Math.floor((currentMonth - 1) / 3) + 1
  if (currentQuarter === 1) {
    return formatQuarterCode(currentYear - 1, 4)
  }
  return formatQuarterCode(currentYear, currentQuarter - 1)
}

/**
 * Tính toán khoảng thời gian của một quý theo chuẩn giờ Việt Nam (UTC+7):
 * - Q1: 01/01 -> 01/04 (Tháng 1, 2, 3)
 * - Q2: 01/04 -> 01/07 (Tháng 4, 5, 6)
 * - Q3: 01/07 -> 01/10 (Tháng 7, 8, 9)
 * - Q4: 01/10 -> 01/01 năm sau (Tháng 10, 11, 12)
 * Khoảng thời gian half-open [startDate, endDate) ngăn chặn việc tính trùng ranh giới.
 * Mốc carryoverStartDate là 15 ngày dương lịch cuối cùng của quý:
 * ngày cuối quý - 15 + 1 (ví dụ tháng 3 có 31 ngày -> carryover bắt đầu từ ngày 17).
 */
export function getQuarterDateRange(year: number, quarter: number): QuarterDateRange {
  if (quarter < 1 || quarter > 4) {
    throw new Error(`Quý không hợp lệ: ${quarter}`)
  }

  const startMonth = (quarter - 1) * 3 + 1
  const endMonth = quarter * 3
  const daysInLastMonth = getDaysInMonth(year, endMonth)

  const startDate = createVnDate(year, startMonth, 1, 0, 0, 0, 0)

  // Ngày kết thúc của quý (half-open nextQuarterStart)
  let nextQuarterYear = year
  let nextQuarterStartMonth = endMonth + 1
  if (nextQuarterStartMonth > 12) {
    nextQuarterYear = year + 1
    nextQuarterStartMonth = 1
  }
  const endDate = createVnDate(nextQuarterYear, nextQuarterStartMonth, 1, 0, 0, 0, 0)

  // 15 ngày dương lịch cuối cùng: daysInLastMonth - 15 + 1
  const carryoverStartDay = daysInLastMonth - 14
  const carryoverStartDate = createVnDate(year, endMonth, carryoverStartDay, 0, 0, 0, 0)

  return {
    quarterCode: formatQuarterCode(year, quarter),
    year,
    quarter,
    startDate,
    endDate,
    carryoverStartDate,
  }
}

/**
 * Lấy khoảng thời gian của quý từ chuỗi mã quý
 */
export function getQuarterDateRangeFromCode(quarterCode: string): QuarterDateRange {
  const { year, quarter } = parseQuarterCode(quarterCode)
  return getQuarterDateRange(year, quarter)
}

/**
 * Kiểm tra xem thời điểm đăng ký (User.createdAt) có rơi vào 15 ngày cuối của quý hay không
 */
export function isRegistrationInCarryoverWindow(
  createdAt: Date,
  year: number,
  quarter: number
): boolean {
  const range = getQuarterDateRange(year, quarter)
  const time = createdAt.getTime()
  return time >= range.carryoverStartDate.getTime() && time < range.endDate.getTime()
}

/**
 * Tính hệ số ưu đãi khách hàng mới theo tháng đăng ký trong quý:
 * - Tháng đầu quý (tháng 1, 4, 7, 10): ×1.0
 * - Tháng giữa quý (tháng 2, 5, 8, 11): ×1.1
 * - Tháng cuối quý (tháng 3, 6, 9, 12): ×1.2
 *
 * Chỉ áp dụng cho các giao dịch trong quý đăng ký đầu tiên.
 * Nếu quý đánh giá (targetYear, targetQuarter) khác quý đăng ký (createdAt), hệ số luôn là ×1.0.
 */
export function getNewCustomerMultiplier(
  createdAt: Date,
  targetYear: number,
  targetQuarter: number
): number {
  const userParts = getVietnamDateParts(createdAt)
  const regYear = userParts.year
  const regQuarter = Math.floor((userParts.month - 1) / 3) + 1

  // Không phải quý đăng ký -> hệ số tiêu chuẩn ×1.0
  if (regYear !== targetYear || regQuarter !== targetQuarter) {
    return 1.0
  }

  // Tháng thứ mấy trong quý: 1, 2, hoặc 3
  const monthInQuarter = ((userParts.month - 1) % 3) + 1

  if (monthInQuarter === 1) return 1.0
  if (monthInQuarter === 2) return 1.1
  return 1.2 // monthInQuarter === 3
}

/**
 * Lấy khóa nhận diện tuần (Thứ Hai đầu tuần theo múi giờ Việt Nam)
 * Dùng để tính toán số tuần hoạt động (activeWeeks) không bị trùng lặp.
 */
export function getVietnamMondayWeekKey(date: Date): string {
  const vnParts = getVietnamDateParts(date)
  const dateUtc = new Date(Date.UTC(vnParts.year, vnParts.month - 1, vnParts.day))
  const dayOfWeek = dateUtc.getUTCDay() // 0 = Chủ Nhật, 1 = Thứ Hai, ...
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const mondayUtc = new Date(dateUtc.getTime() + diffToMonday * 24 * 60 * 60 * 1000)
  const mYear = mondayUtc.getUTCFullYear()
  const mMonth = String(mondayUtc.getUTCMonth() + 1).padStart(2, '0')
  const mDay = String(mondayUtc.getUTCDate()).padStart(2, '0')
  return `${mYear}-${mMonth}-${mDay}`
}

export interface CandidateOrderItem {
  isSample: boolean
  orderedGrams: number
  actualGrams?: number | null
}

export interface CandidateComplaint {
  status: ComplaintStatus | string
  resolution?: Resolution | string | null
  proposalType?: ComplaintResolutionType | string | null
  compensation?: number | null
}

export interface CandidateOrder {
  id: string
  code?: string
  status: OrderStatus | string
  createdAt: Date
  total: number
  finalTotal?: number | null
  cancelledBy?: CancelActor | string | null
  cancelReason?: string | null
  items: CandidateOrderItem[]
  complaints?: CandidateComplaint[]
  events?: Array<{ type: string }>
}

/**
 * Kiểm tra đơn hàng có đủ điều kiện ghi nhận doanh thu và sản lượng không:
 * - Trạng thái COMPLETED.
 * - Không có khiếu nại đang ở trạng thái OPEN.
 */
export function isOrderEligibleForKpi(order: CandidateOrder): boolean {
  if (order.status !== OrderStatus.COMPLETED) {
    return false
  }
  if (
    order.complaints &&
    order.complaints.some(
      (c) =>
        c.status === ComplaintStatus.OPEN ||
        c.status === ComplaintStatus.PROPOSED ||
        c.status === ComplaintStatus.UNDER_REVIEW
    )
  ) {
    return false
  }
  return true
}

/**
 * Tính doanh thu thuần đủ điều kiện (trừ bồi thường hoàn tiền khiếu nại nếu có)
 */
export function getOrderNetRevenue(order: CandidateOrder): number {
  if (!isOrderEligibleForKpi(order)) return 0
  const baseTotal = order.finalTotal ?? order.total

  let refundCompensation = 0
  if (order.complaints) {
    for (const c of order.complaints) {
      if (
        (c.status === ComplaintStatus.RESOLVED || c.status === ComplaintStatus.CUSTOMER_ACCEPTED) &&
        (c.resolution === Resolution.REFUND || c.proposalType === ComplaintResolutionType.REFUND_MONEY) &&
        typeof c.compensation === 'number' &&
        c.compensation > 0
      ) {
        refundCompensation += c.compensation
      }
    }
  }

  return Math.max(0, baseTotal - refundCompensation)
}

/**
 * Tính sản lượng khối lượng kg hợp lệ từ các mặt hàng thường (bỏ qua hàng mẫu)
 */
export function getOrderEligibleVolumeKg(order: CandidateOrder): number {
  if (!isOrderEligibleForKpi(order)) return 0
  let totalGrams = 0
  for (const item of order.items) {
    if (!item.isSample) {
      totalGrams += item.actualGrams ?? item.orderedGrams
    }
  }
  return totalGrams / 1000
}

/**
 * Kiểm tra xem một đơn hàng có phải đơn hủy do khách hay không
 */
export function isCustomerCancelledOrder(order: CandidateOrder): boolean {
  return (
    order.status === OrderStatus.CANCELLED &&
    order.cancelledBy === CancelActor.CUSTOMER
  )
}

/**
 * Kiểm tra xem một đơn hàng có phải bị hủy do quá hạn thanh toán 10 phút hay không
 */
export function isPaymentExpiredOrder(order: CandidateOrder): boolean {
  if (order.status !== OrderStatus.CANCELLED) return false

  // Kiểm tra qua event hoặc cancelReason
  if (order.events && order.events.some((e) => e.type === 'PAYMENT_EXPIRED')) {
    return true
  }

  const reason = (order.cancelReason || '').toLowerCase()
  return (
    reason.includes('quá hạn giữ chỗ') ||
    reason.includes('quá hạn thanh toán') ||
    reason.includes('payment_expired')
  )
}

export interface RawQuarterMetrics {
  rawRevenueVnd: number
  rawVolumeKg: number
  activeWeekKeys: Set<string>
  customerCancelledOrders: number
  customerPaymentExpirations: number
}

/**
 * Tổng hợp số liệu thô trong một khoảng thời gian [start, end)
 */
export function aggregateRawMetrics(
  orders: CandidateOrder[],
  startDate: Date,
  endDate: Date
): RawQuarterMetrics {
  const startTime = startDate.getTime()
  const endTime = endDate.getTime()

  let rawRevenueVnd = 0
  let rawVolumeKg = 0
  const activeWeekKeys = new Set<string>()
  let customerCancelledOrders = 0
  let customerPaymentExpirations = 0

  for (const order of orders) {
    const orderTime = order.createdAt.getTime()
    if (orderTime < startTime || orderTime >= endTime) {
      continue
    }

    if (isOrderEligibleForKpi(order)) {
      rawRevenueVnd += getOrderNetRevenue(order)
      rawVolumeKg += getOrderEligibleVolumeKg(order)
      activeWeekKeys.add(getVietnamMondayWeekKey(order.createdAt))
    }

    if (isCustomerCancelledOrder(order)) {
      customerCancelledOrders++
    }

    if (isPaymentExpiredOrder(order)) {
      customerPaymentExpirations++
    }
  }

  return {
    rawRevenueVnd,
    rawVolumeKg,
    activeWeekKeys,
    customerCancelledOrders,
    customerPaymentExpirations,
  }
}

export interface CustomerEvaluationInput {
  userId: string
  userCreatedAt: Date
  currentTier: MembershipTier | null
  hasPriorEvaluationLogs: boolean
  orders: CandidateOrder[]
  targetQuarterCode: string // Quý đang được xét đánh giá, ví dụ '2027-Q2'
}

export interface CustomerEvaluationDecision {
  userId: string
  targetQuarterCode: string
  action: 'EVALUATE' | 'CARRYOVER_SKIP'
  reason: string
  multiplierApplied?: number
  kpiInput?: QuarterlyKpiInput
  kpiResult?: QuarterlyKpiResult
  previousTier: MembershipTier | null
  newTier: MembershipTier
}

/**
 * Engine ra quyết định và tính toán xét hạng cho một khách hàng B2B (F04-03):
 * 1. Nếu khách hàng đăng ký trong 15 ngày cuối của quý đang xét VÀ chưa từng có log:
 *    -> BẢO LƯU (CARRYOVER_SKIP), không xét ở quý này.
 * 2. Nếu khách hàng thuộc diện bảo lưu từ quý liền trước (đăng ký 15 ngày cuối quý trước, chưa có log):
 *    -> XÉT HẠNG LẦN ĐẦU với dữ liệu kết hợp:
 *       (Dữ liệu quý trước * 1.2) + (Dữ liệu quý này * 1.0).
 * 3. Khách hàng thông thường:
 *    -> Nếu là quý đầu tiên: áp hệ số tháng đăng ký (×1.0, ×1.1, ×1.2).
 *    -> Nếu là các quý tiếp theo: áp hệ số chuẩn ×1.0.
 */
export function evaluateCustomerQuarterlyMembership(
  candidate: CustomerEvaluationInput
): CustomerEvaluationDecision {
  const { year, quarter } = parseQuarterCode(candidate.targetQuarterCode)
  const currentQuarterRange = getQuarterDateRange(year, quarter)
  const regParts = getVietnamDateParts(candidate.userCreatedAt)
  const regYear = regParts.year
  const regQuarter = Math.floor((regParts.month - 1) / 3) + 1

  const defaultTier = candidate.currentTier || MembershipTier.BRONZE

  // 1. KIỂM TRA BẢO LƯU 15 NGÀY CUỐI QUÝ CỦA CHÍNH QUÝ ĐANG XÉT
  // Khách mới đăng ký trong 15 ngày cuối của chính quý này -> HOÃN / BẢO LƯU
  if (
    !candidate.hasPriorEvaluationLogs &&
    regYear === year &&
    regQuarter === quarter &&
    isRegistrationInCarryoverWindow(candidate.userCreatedAt, year, quarter)
  ) {
    return {
      userId: candidate.userId,
      targetQuarterCode: candidate.targetQuarterCode,
      action: 'CARRYOVER_SKIP',
      reason: `Khách hàng đăng ký trong 15 ngày cuối quý ${candidate.targetQuarterCode}. Tự động bảo lưu dữ liệu sang kỳ đánh giá tiếp theo.`,
      previousTier: candidate.currentTier,
      newTier: defaultTier,
    }
  }

  // 2. KIỂM TRA KHÁCH THUỘC DIỆN BẢO LƯU TỪ QUÝ LIỀN TRƯỚC (Lần xét hạng đầu tiên)
  let prevYear = year
  let prevQuarter = quarter - 1
  if (prevQuarter < 1) {
    prevQuarter = 4
    prevYear = year - 1
  }

  const isCarriedOverFromPrevQuarter =
    !candidate.hasPriorEvaluationLogs &&
    regYear === prevYear &&
    regQuarter === prevQuarter &&
    isRegistrationInCarryoverWindow(candidate.userCreatedAt, prevYear, prevQuarter)

  if (isCarriedOverFromPrevQuarter) {
    // Dữ liệu giai đoạn 1: từ lúc đăng ký đến hết quý trước
    const prevQuarterRange = getQuarterDateRange(prevYear, prevQuarter)
    const carryoverMetrics = aggregateRawMetrics(
      candidate.orders,
      candidate.userCreatedAt,
      prevQuarterRange.endDate
    )

    // Dữ liệu giai đoạn 2: trong quý đang xét hiện tại
    const currentMetrics = aggregateRawMetrics(
      candidate.orders,
      currentQuarterRange.startDate,
      currentQuarterRange.endDate
    )

    // Áp dụng hệ số: phần bảo lưu tháng cuối quý trước là ×1.2; phần quý mới là ×1.0
    const netRevenueVnd = Math.round(
      carryoverMetrics.rawRevenueVnd * 1.2 + currentMetrics.rawRevenueVnd * 1.0
    )
    const eligibleVolumeKg =
      carryoverMetrics.rawVolumeKg * 1.2 + currentMetrics.rawVolumeKg * 1.0

    // Gộp các tuần active duy nhất (không cộng trùng)
    const combinedWeeks = new Set<string>([
      ...carryoverMetrics.activeWeekKeys,
      ...currentMetrics.activeWeekKeys,
    ])

    const customerCancelledOrders =
      carryoverMetrics.customerCancelledOrders + currentMetrics.customerCancelledOrders
    const customerPaymentExpirations =
      carryoverMetrics.customerPaymentExpirations + currentMetrics.customerPaymentExpirations

    const kpiInput: QuarterlyKpiInput = {
      netRevenueVnd,
      eligibleVolumeKg,
      activeWeeks: combinedWeeks.size,
      customerCancelledOrders,
      customerPaymentExpirations,
    }

    const kpiResult = calculateQuarterlyKpi(kpiInput)

    return {
      userId: candidate.userId,
      targetQuarterCode: candidate.targetQuarterCode,
      action: 'EVALUATE',
      reason: `Đánh giá lần đầu với dữ liệu bảo lưu 15 ngày cuối ${formatQuarterCode(prevYear, prevQuarter)} (×1.2) kết hợp quý ${candidate.targetQuarterCode} (×1.0).`,
      multiplierApplied: 1.2,
      kpiInput,
      kpiResult,
      previousTier: candidate.currentTier,
      newTier: kpiResult.tier,
    }
  }

  // 3. ĐÁNH GIÁ THÔNG THƯỜNG TRONG PHẠM VI 1 QUÝ
  const metrics = aggregateRawMetrics(
    candidate.orders,
    currentQuarterRange.startDate,
    currentQuarterRange.endDate
  )

  let multiplier = 1.0
  // Nếu là quý đầu tiên của khách (đăng ký trong quý này)
  if (!candidate.hasPriorEvaluationLogs && regYear === year && regQuarter === quarter) {
    multiplier = getNewCustomerMultiplier(candidate.userCreatedAt, year, quarter)
  }

  const netRevenueVnd = Math.round(metrics.rawRevenueVnd * multiplier)
  const eligibleVolumeKg = metrics.rawVolumeKg * multiplier

  const kpiInput: QuarterlyKpiInput = {
    netRevenueVnd,
    eligibleVolumeKg,
    activeWeeks: metrics.activeWeekKeys.size,
    customerCancelledOrders: metrics.customerCancelledOrders,
    customerPaymentExpirations: metrics.customerPaymentExpirations,
  }

  const kpiResult = calculateQuarterlyKpi(kpiInput)

  return {
    userId: candidate.userId,
    targetQuarterCode: candidate.targetQuarterCode,
    action: 'EVALUATE',
    reason: `Đánh giá quý ${candidate.targetQuarterCode} (Hệ số: ×${multiplier}).`,
    multiplierApplied: multiplier,
    kpiInput,
    kpiResult,
    previousTier: candidate.currentTier,
    newTier: kpiResult.tier,
  }
}
