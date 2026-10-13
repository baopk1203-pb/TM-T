import { getVietnamDateParts } from '@/lib/domain/delivery-date'

/**
 * Sinh mã đơn hàng chuẩn B2B: DH-YYMMDD-XXXX
 * ví dụ: DH-261013-A8F2
 */
export function generateOrderCode(date = new Date()): string {
  const parts = getVietnamDateParts(date)
  const yy = String(parts.year).slice(-2)
  const mm = String(parts.month).padStart(2, '0')
  const dd = String(parts.day).padStart(2, '0')

  // Sinh 4 ký tự ngẫu nhiên chữ hoa và số (loại trừ ký tự dễ nhầm lẫn như O, 0, I, 1)
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  let randomPart = ''
  for (let i = 0; i < 4; i++) {
    const idx = Math.floor(Math.random() * chars.length)
    randomPart += chars[idx]
  }

  return `DH-${yy}${mm}${dd}-${randomPart}`
}
