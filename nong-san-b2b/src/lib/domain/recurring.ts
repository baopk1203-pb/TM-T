/**
 * Domain Logic: Đơn hàng định kỳ (Recurring Orders) — Phase 6A
 * Tuân thủ quy tắc nghiệp vụ Mục 3.11 & Phase 6 (docs/KE_HOACH_TRIEN_KHAI.md):
 * - weekdays: 1 = Thứ Hai ... 7 = Chủ Nhật (theo chuẩn ISO-8601)
 * - Múi giờ chuẩn: Asia/Ho_Chi_Minh (UTC+7)
 * - Khoảng sinh đơn nháp: [today + leadTimeDays, today + leadTimeDays + 7 ngày]
 * - Chống tạo trùng đơn nháp theo cặp (recurringScheduleId, deliveryDate)
 * - Quá hạn xác nhận đơn nháp khi: today > deliveryDate - leadTimeDays (theo ngày VN)
 */

import { getVietnamDateParts } from './delivery-date'

export interface RecurringScheduleDomainInput {
  id?: string
  isActive: boolean
  weekdays: number[]
}

export interface ExistingRecurringOrderRef {
  recurringScheduleId: string | null
  deliveryDate: Date | string | null
}

export interface ShouldCreateDraftParams {
  scheduleId: string
  deliveryDate: Date | string
  existingOrders: ExistingRecurringOrderRef[]
}

/**
 * Chuẩn hóa thời điểm `now` về ngày 00:00:00 UTC tương ứng với ngày lịch tại Việt Nam (Asia/Ho_Chi_Minh)
 */
export function getVietnamTodayUtc(now: Date): Date {
  const vn = getVietnamDateParts(now)
  return new Date(Date.UTC(vn.year, vn.month - 1, vn.day))
}

/**
 * Chuẩn hóa một giá trị Date (hoặc chuỗi YYYY-MM-DD / ISO) về Date 00:00:00 UTC
 */
export function normalizeToUtcDate(dateInput: Date | string): Date {
  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim()
    const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
    if (ymdMatch) {
      const year = parseInt(ymdMatch[1], 10)
      const month = parseInt(ymdMatch[2], 10)
      const day = parseInt(ymdMatch[3], 10)
      return new Date(Date.UTC(year, month - 1, day))
    }
    const parsed = new Date(trimmed)
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()))
  }

  return new Date(
    Date.UTC(dateInput.getUTCFullYear(), dateInput.getUTCMonth(), dateInput.getUTCDate())
  )
}

/**
 * Chuyển Date sang khóa chuỗi YYYY-MM-DD theo UTC (phù hợp với cột @db.Date của Prisma)
 */
export function toUtcDateKey(dateInput: Date | string): string {
  const utc = normalizeToUtcDate(dateInput)
  const y = utc.getUTCFullYear()
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0')
  const d = String(utc.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Lấy thứ trong tuần theo quy ước nghiệp vụ: 1 = Thứ Hai ... 7 = Chủ Nhật
 */
export function getIsoWeekday(utcDate: Date): number {
  const day = utcDate.getUTCDay()
  return day === 0 ? 7 : day
}

/**
 * Tính các ngày giao hàng sắp tới trong khoảng [today + leadTimeDays, today + leadTimeDays + 7 ngày]
 * khớp với `schedule.weekdays` (1 = Thứ Hai ... 7 = Chủ Nhật).
 */
export function upcomingDeliveryDates(
  schedule: RecurringScheduleDomainInput,
  today: Date,
  leadTimeDays: number = 1
): Date[] {
  if (!schedule.isActive || !Array.isArray(schedule.weekdays) || schedule.weekdays.length === 0) {
    return []
  }

  const validWeekdays = new Set(
    schedule.weekdays.filter((w) => Number.isInteger(w) && w >= 1 && w <= 7)
  )
  if (validWeekdays.size === 0) {
    return []
  }

  const effectiveLeadTime = Math.max(1, Math.floor(leadTimeDays))
  const todayVnUtc = getVietnamTodayUtc(today)

  const dates: Date[] = []
  for (let offset = effectiveLeadTime; offset <= effectiveLeadTime + 7; offset++) {
    const candidate = new Date(
      Date.UTC(
        todayVnUtc.getUTCFullYear(),
        todayVnUtc.getUTCMonth(),
        todayVnUtc.getUTCDate() + offset
      )
    )
    const weekday = getIsoWeekday(candidate)
    if (validWeekdays.has(weekday)) {
      dates.push(candidate)
    }
  }

  return dates
}

/**
 * Kiểm tra xem có nên tạo đơn nháp mới cho cặp (scheduleId, deliveryDate) hay không.
 * Đảm bảo idempotent: nếu đã tồn tại bất kỳ đơn nào thuộc cùng `recurringScheduleId`
 * và cùng `deliveryDate` (theo ngày UTC YYYY-MM-DD), trả về `false`.
 */
export function shouldCreateDraft(
  scheduleIdOrParams: string | ShouldCreateDraftParams,
  deliveryDateArg?: Date | string,
  existingOrdersArg?: ExistingRecurringOrderRef[]
): boolean {
  let scheduleId: string
  let deliveryDate: Date | string
  let existingOrders: ExistingRecurringOrderRef[]

  if (typeof scheduleIdOrParams === 'object' && scheduleIdOrParams !== null) {
    scheduleId = scheduleIdOrParams.scheduleId
    deliveryDate = scheduleIdOrParams.deliveryDate
    existingOrders = scheduleIdOrParams.existingOrders
  } else {
    scheduleId = scheduleIdOrParams
    deliveryDate = deliveryDateArg!
    existingOrders = existingOrdersArg ?? []
  }

  if (!scheduleId || !deliveryDate) {
    return false
  }

  const targetDateKey = toUtcDateKey(deliveryDate)

  const alreadyExists = existingOrders.some((order) => {
    if (!order.recurringScheduleId || !order.deliveryDate) return false
    return (
      order.recurringScheduleId === scheduleId &&
      toUtcDateKey(order.deliveryDate) === targetDateKey
    )
  })

  return !alreadyExists
}

/**
 * Kiểm tra đơn nháp đã quá hạn xác nhận chưa:
 * Quá hạn khi `today > deliveryDate - leadTimeDays` (tính theo ngày lịch Việt Nam).
 */
export function isDraftExpired(
  deliveryDate: Date | string,
  today: Date,
  leadTimeDays: number = 1
): boolean {
  const effectiveLeadTime = Math.max(1, Math.floor(leadTimeDays))
  const deliveryUtc = normalizeToUtcDate(deliveryDate)
  const todayVnUtc = getVietnamTodayUtc(today)

  const deadlineUtcMs = Date.UTC(
    deliveryUtc.getUTCFullYear(),
    deliveryUtc.getUTCMonth(),
    deliveryUtc.getUTCDate() - effectiveLeadTime
  )

  return todayVnUtc.getTime() > deadlineUtcMs
}
