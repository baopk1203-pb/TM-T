import { describe, it, expect } from 'vitest'
import { checkCapacity, getWeekStartMonday } from '@/lib/domain/capacity'

describe('Domain: checkCapacity (Mục 3.4 & Test Case 7.7)', () => {
  it('Test Case 7.7: max 500kg, đã đặt 420kg, đơn mới 100kg thì lỗi "còn 80 kg"', () => {
    const result = checkCapacity({
      maxGrams: 500000,      // 500 kg
      existingGrams: 420000, // 420 kg
      newGrams: 100000,      // 100 kg
      productName: 'Sầu riêng Ri6',
    })

    expect(result.allowed).toBe(false)
    expect(result.remainingGrams).toBe(80000) // còn 80 kg
    expect(result.error).toContain('chỉ còn 80 kg khả dụng')
  })

  it('hợp lệ khi đơn mới vừa đúng phần còn lại (80kg)', () => {
    const result = checkCapacity({
      maxGrams: 500000,
      existingGrams: 420000,
      newGrams: 80000, // đúng 80 kg
    })

    expect(result.allowed).toBe(true)
    expect(result.remainingGrams).toBe(0)
    expect(result.error).toBeUndefined()
  })

  it('hợp lệ khi chưa thiết lập maxGrams (không giới hạn sản lượng demo)', () => {
    const result = checkCapacity({
      maxGrams: null,
      existingGrams: 1000000,
      newGrams: 500000,
    })

    expect(result.allowed).toBe(true)
    expect(result.remainingGrams).toBe(Infinity)
  })

  it('tính đúng thứ Hai đầu tuần getWeekStartMonday', () => {
    // 2026-10-14 (Thứ Tư) -> Thứ Hai là 2026-10-12
    const wednesday = new Date('2026-10-14T10:00:00Z')
    const monday = getWeekStartMonday(wednesday)
    expect(monday.getUTCDate()).toBe(12)
    expect(monday.getUTCDay()).toBe(1) // Thứ Hai

    // 2026-10-18 (Chủ Nhật) -> Thứ Hai là 2026-10-12
    const sunday = new Date('2026-10-18T10:00:00Z')
    const mondayOfSunday = getWeekStartMonday(sunday)
    expect(mondayOfSunday.getUTCDate()).toBe(12)
    expect(mondayOfSunday.getUTCDay()).toBe(1)
  })
})
