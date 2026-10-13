/**
 * Tiện ích chuyển đổi tiền tệ và khối lượng theo quy chuẩn dự án TMĐT B2B Nông sản.
 * Quy ước:
 * - Tiền tệ: Số nguyên VND (Int).
 * - Khối lượng: Số nguyên Gram (Int) khi lưu trữ; quy đổi ra kg khi hiển thị.
 */

/**
 * Format số nguyên VND sang chuỗi hiển thị theo định dạng Việt Nam.
 * Ví dụ: 15277500 -> "15.277.500 đ"
 */
export function formatVND(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return '0 đ'
  }
  const rounded = Math.round(amount)
  const formatted = new Intl.NumberFormat('vi-VN').format(rounded)
  return `${formatted} đ`
}

/**
 * Quy đổi từ gram (Int) sang kg (số thực).
 * Ví dụ: 50000 -> 50, 205500 -> 205.5
 */
export function gramsToKg(grams: number): number {
  if (!grams || Number.isNaN(grams)) return 0
  return grams / 1000
}

/**
 * Quy đổi từ kg (số thực hoặc số nguyên) sang gram (Int làm tròn).
 * Ví dụ: 50 -> 50000, 205.5 -> 205500
 */
export function kgToGrams(kg: number): number {
  if (!kg || Number.isNaN(kg)) return 0
  return Math.round(kg * 1000)
}

/**
 * Format số gram sang chuỗi text kg thân thiện cho người dùng.
 * Ví dụ: 50000 -> "50 kg", 205500 -> "205,5 kg"
 */
export function gramsToKgText(grams: number): string {
  const kg = gramsToKg(grams)
  const formatted = new Intl.NumberFormat('vi-VN', {
    maximumFractionDigits: 2,
  }).format(kg)
  return `${formatted} kg`
}

/**
 * Format tỷ lệ chiết khấu %.
 * Ví dụ: 5 -> "5%"
 */
export function formatPercent(percent: number): string {
  return `${percent}%`
}
