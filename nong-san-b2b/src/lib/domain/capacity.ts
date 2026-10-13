/**
 * Domain Logic: Kiểm tra sản lượng khả dụng theo tuần (Weekly Capacity)
 * Tuân thủ quy tắc nghiệp vụ B2B Nông sản (Mục 3.4 & Test Case 7.7)
 * - Khi maxGrams không xác định (null/undefined): Không giới hạn sản lượng.
 * - Khi có maxGrams: remainingGrams = max(0, maxGrams - existingGrams)
 *   Nếu newGrams > remainingGrams: Báo lỗi vượt sản lượng khả dụng và trả về số kg còn lại.
 */

export interface CapacityCheckInput {
  maxGrams?: number | null
  existingGrams: number
  newGrams: number
  productName?: string
}

export interface CapacityCheckResult {
  allowed: boolean
  remainingGrams: number
  error?: string
}

/**
 * Tính ngày thứ Hai đầu tuần (00:00:00 UTC) cho một ngày bất kỳ
 */
export function getWeekStartMonday(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() // 0 = CN, 1 = T2, ..., 6 = T7
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1) // Chuyển về T2
  d.setUTCDate(diff)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

/**
 * Kiểm tra năng lực cung ứng theo tuần
 */
export function checkCapacity({
  maxGrams,
  existingGrams,
  newGrams,
  productName = 'Sản phẩm',
}: CapacityCheckInput): CapacityCheckResult {
  // Tuần chưa thiết lập giới hạn sản lượng -> Cho phép đặt (không giới hạn)
  if (maxGrams === undefined || maxGrams === null || maxGrams <= 0) {
    return {
      allowed: true,
      remainingGrams: Infinity,
    }
  }

  const remainingGrams = Math.max(0, maxGrams - existingGrams)

  if (newGrams > remainingGrams) {
    const remainingKg = remainingGrams / 1000
    const requestedKg = newGrams / 1000
    return {
      allowed: false,
      remainingGrams,
      error: `Sản lượng tuần giao của "${productName}" không đủ đáp ứng (yêu cầu ${requestedKg} kg, nhà vườn chỉ còn ${remainingKg} kg khả dụng)`,
    }
  }

  return {
    allowed: true,
    remainingGrams: remainingGrams - newGrams,
  }
}
