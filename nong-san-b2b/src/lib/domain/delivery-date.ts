/**
 * Domain Logic: Tính toán ngày giao hàng sớm nhất (Earliest Delivery Date)
 * Tuân thủ quy tắc nghiệp vụ B2B Nông sản (Mục 3.5 & Test Case 7.7)
 * - Múi giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7)
 * - Giờ chốt đơn hàng ngày: 17:00 (5:00 PM)
 * - Ngày giao sớm nhất = hôm nay + max(leadTimeDays).
 * - Nếu đặt từ 17:00 trở đi thì cộng thêm 1 ngày chuẩn bị.
 */

export const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh'
export const CUTOFF_HOUR = 17 // 17h00 hàng ngày

/**
 * Lấy các thành phần ngày giờ hiện tại theo múi giờ Việt Nam
 */
export function getVietnamDateParts(date: Date) {
  // Dùng Intl.DateTimeFormat để trích xuất chính xác theo múi giờ VN bất kể máy chủ đặt ở đâu
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: VIETNAM_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  })

  const parts = formatter.formatToParts(date)
  let year = 0,
    month = 0,
    day = 0,
    hour = 0,
    minute = 0,
    second = 0

  for (const part of parts) {
    if (part.type === 'year') year = parseInt(part.value, 10)
    if (part.type === 'month') month = parseInt(part.value, 10)
    if (part.type === 'day') day = parseInt(part.value, 10)
    if (part.type === 'hour') hour = parseInt(part.value, 10)
    if (part.type === 'minute') minute = parseInt(part.value, 10)
    if (part.type === 'second') second = parseInt(part.value, 10)
  }

  // Chú ý: một số môi trường có thể format hour là 24 khi nửa đêm
  if (hour === 24) hour = 0

  return { year, month, day, hour, minute, second }
}

/**
 * Tính ngày giao hàng sớm nhất
 * @param now Thời điểm đặt hàng (Date)
 * @param leadTimes Mảng thời gian chuẩn bị (leadTimeDays) của các sản phẩm trong giỏ
 * @returns Date bắt đầu từ 00:00:00 (theo ngày chuẩn) của ngày giao sớm nhất
 */
export function earliestDeliveryDate(now: Date, leadTimes: number[]): Date {
  const validLeadTimes = leadTimes.filter((t) => t > 0)
  const maxLeadTime = validLeadTimes.length > 0 ? Math.max(...validLeadTimes) : 1

  const vnParts = getVietnamDateParts(now)

  // Kiểm tra giờ chốt: nếu từ 17:00:00 trở đi thì cộng thêm 1 ngày
  const isPastCutoff =
    vnParts.hour > CUTOFF_HOUR ||
    (vnParts.hour === CUTOFF_HOUR && (vnParts.minute > 0 || vnParts.second > 0))

  const addedDays = maxLeadTime + (isPastCutoff ? 1 : 0)

  // Tạo Date cho ngày giao sớm nhất tại 00:00:00 giờ Việt Nam (UTC+7 tương ứng UTC 17:00 ngày hôm trước)
  // Để lưu @db.Date trong Prisma, ta chuẩn hóa theo UTC date:
  const targetDate = new Date(Date.UTC(vnParts.year, vnParts.month - 1, vnParts.day + addedDays))
  return targetDate
}

/**
 * Kiểm tra xem ngày người dùng chọn có hợp lệ không (phải >= ngày sớm nhất)
 */
export function isDeliveryDateValid(selectedDate: Date, minDate: Date): boolean {
  const selUtc = Date.UTC(
    selectedDate.getUTCFullYear(),
    selectedDate.getUTCMonth(),
    selectedDate.getUTCDate()
  )
  const minUtc = Date.UTC(
    minDate.getUTCFullYear(),
    minDate.getUTCMonth(),
    minDate.getUTCDate()
  )
  return selUtc >= minUtc
}

/**
 * Chuẩn hóa format ngày theo định dạng Việt Nam (DD/MM/YYYY) tại múi giờ Asia/Ho_Chi_Minh (UTC+7)
 * Đảm bảo tính nhất quán tuyệt đối giữa SSR (Node UTC) và Client (Trình duyệt)
 */
export function formatVietnamDate(
  date: Date | string | number | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (!date) return ''
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('vi-VN', {
    timeZone: VIETNAM_TIMEZONE,
    ...options,
  })
}

/**
 * Chuẩn hóa format ngày giờ theo định dạng Việt Nam tại múi giờ Asia/Ho_Chi_Minh (UTC+7)
 * Đảm bảo tính nhất quán tuyệt đối giữa SSR (Node UTC) và Client (Trình duyệt)
 */
export function formatVietnamDateTime(
  date: Date | string | number | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (!date) return ''
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('vi-VN', {
    timeZone: VIETNAM_TIMEZONE,
    ...options,
  })
}

export type DeliveryTimeSlot = 'MORNING' | 'AFTERNOON' | 'EVENING'

export interface DeliverySlotOption {
  slot: DeliveryTimeSlot
  label: string
  timeRange: string
  fullLabel: string
}

export const DELIVERY_TIME_SLOTS: readonly DeliverySlotOption[] = [
  {
    slot: 'MORNING',
    label: 'Sáng',
    timeRange: '07:00 - 11:30',
    fullLabel: 'Buổi sáng (07:00 - 11:30)',
  },
  {
    slot: 'AFTERNOON',
    label: 'Chiều',
    timeRange: '13:30 - 17:30',
    fullLabel: 'Buổi chiều (13:30 - 17:30)',
  },
  {
    slot: 'EVENING',
    label: 'Tối',
    timeRange: '18:00 - 21:00',
    fullLabel: 'Buổi tối (18:00 - 21:00)',
  },
] as const

export const DELIVERY_SLOT_MAP: Record<DeliveryTimeSlot, DeliverySlotOption> = {
  MORNING: DELIVERY_TIME_SLOTS[0],
  AFTERNOON: DELIVERY_TIME_SLOTS[1],
  EVENING: DELIVERY_TIME_SLOTS[2],
}

/**
 * Format nhãn hiển thị khung giờ giao hàng chuẩn hóa
 * @param slot Mã khung giờ ('MORNING' | 'AFTERNOON' | 'EVENING' | null | undefined)
 * @param style 'full' | 'short' (default: 'full')
 *  - 'full': 'Buổi sáng (07:00 - 11:30)', 'Buổi chiều (13:30 - 17:30)', 'Buổi tối (18:00 - 21:00)'
 *  - 'short': 'Sáng (07:00 - 11:30)', 'Chiều (13:30 - 17:30)', 'Tối (18:00 - 21:00)'
 */
export function formatDeliveryTimeSlot(
  slot: string | null | undefined,
  style: 'full' | 'short' = 'full'
): string {
  if (!slot) return 'Cả ngày'
  const found = DELIVERY_SLOT_MAP[slot as DeliveryTimeSlot]
  if (!found) return 'Cả ngày'
  return style === 'short'
    ? `${found.label} (${found.timeRange})`
    : found.fullLabel
}
