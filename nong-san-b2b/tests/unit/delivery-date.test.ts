import { describe, it, expect } from 'vitest'
import {
  earliestDeliveryDate,
  getVietnamDateParts,
  isDeliveryDateValid,
} from '@/lib/domain/delivery-date'

describe('Domain: earliestDeliveryDate (Mục 3.5 & Test Case 7.7)', () => {
  // Test case 7.7: leadTimes [1, 2]
  const leadTimes = [1, 2] // max = 2 ngày

  it('đặt lúc 16:59:00 VN (trước giờ chốt 17h) -> ngày giao sớm nhất là hôm nay + 2', () => {
    // 2026-10-15 16:59:00 VN (UTC: 2026-10-15 09:59:00Z)
    const orderTime = new Date('2026-10-15T09:59:00Z')
    const vnParts = getVietnamDateParts(orderTime)
    expect(vnParts.hour).toBe(16)
    expect(vnParts.minute).toBe(59)

    const earliest = earliestDeliveryDate(orderTime, leadTimes)
    // Hôm nay là ngày 15 -> sớm nhất là ngày 17 (+2 ngày)
    expect(earliest.getUTCDate()).toBe(17)
    expect(earliest.getUTCMonth()).toBe(9) // tháng 10 (0-indexed: 9)
    expect(earliest.getUTCFullYear()).toBe(2026)
  })

  it('đặt lúc 17:00:00 VN (đúng giờ chốt 17h) -> ngày giao sớm nhất là hôm nay + 2', () => {
    // 2026-10-15 17:00:00 VN (UTC: 2026-10-15 10:00:00Z)
    const orderTime = new Date('2026-10-15T10:00:00Z')
    const vnParts = getVietnamDateParts(orderTime)
    expect(vnParts.hour).toBe(17)
    expect(vnParts.minute).toBe(0)
    expect(vnParts.second).toBe(0)

    const earliest = earliestDeliveryDate(orderTime, leadTimes)
    expect(earliest.getUTCDate()).toBe(17)
  })

  it('đặt lúc 17:00:01 VN (sau 17h) -> ngày giao sớm nhất là hôm nay + 3', () => {
    // 2026-10-15 17:00:01 VN (UTC: 2026-10-15 10:00:01Z)
    const orderTime = new Date('2026-10-15T10:00:01Z')
    const earliest = earliestDeliveryDate(orderTime, leadTimes)
    // Hôm nay là 15 -> sang ngày 18 (+3 ngày)
    expect(earliest.getUTCDate()).toBe(18)
    expect(earliest.getUTCMonth()).toBe(9)
    expect(earliest.getUTCFullYear()).toBe(2026)
  })

  it('đặt lúc 20:30 VN (buổi tối) -> ngày giao sớm nhất là hôm nay + 3', () => {
    // 2026-10-15 20:30:00 VN (UTC: 2026-10-15 13:30:00Z)
    const orderTime = new Date('2026-10-15T13:30:00Z')
    const earliest = earliestDeliveryDate(orderTime, leadTimes)
    expect(earliest.getUTCDate()).toBe(18)
  })

  it('khi leadTimes rỗng thì mặc định maxLeadTime = 1', () => {
    // 2026-10-15 10:00:00 VN (sáng) -> +1 ngày = ngày 16
    const orderTime = new Date('2026-10-15T03:00:00Z')
    const earliest = earliestDeliveryDate(orderTime, [])
    expect(earliest.getUTCDate()).toBe(16)
  })

  describe('isDeliveryDateValid', () => {
    const minDate = new Date(Date.UTC(2026, 9, 17)) // 2026-10-17

    it('hợp lệ khi chọn đúng ngày sớm nhất hoặc sau đó', () => {
      const sameDay = new Date(Date.UTC(2026, 9, 17))
      const futureDay = new Date(Date.UTC(2026, 9, 20))
      expect(isDeliveryDateValid(sameDay, minDate)).toBe(true)
      expect(isDeliveryDateValid(futureDay, minDate)).toBe(true)
    })

    it('không hợp lệ khi chọn ngày trong quá khứ hoặc trước ngày sớm nhất', () => {
      const pastDay = new Date(Date.UTC(2026, 9, 16))
      expect(isDeliveryDateValid(pastDay, minDate)).toBe(false)
    })
  })
})
