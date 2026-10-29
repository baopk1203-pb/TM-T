import { describe, it, expect } from 'vitest'
import {
  DELIVERY_TIME_SLOTS,
  DELIVERY_SLOT_MAP,
  formatDeliveryTimeSlot,
  type DeliveryTimeSlot,
} from '@/lib/domain/delivery-date'
import { TimeSlot } from '@prisma/client'

describe('QA05-UI-01: Delivery Slot Single Source of Truth & Harmonization', () => {
  it('cung cấp chính xác 3 khung giờ giao hàng tương thích 100% với Prisma TimeSlot enum', () => {
    expect(DELIVERY_TIME_SLOTS).toHaveLength(3)

    const expectedSlots: DeliveryTimeSlot[] = ['MORNING', 'AFTERNOON', 'EVENING']
    DELIVERY_TIME_SLOTS.forEach((opt, idx) => {
      expect(opt.slot).toBe(expectedSlots[idx])
      // Khớp enum Prisma
      expect(TimeSlot[opt.slot]).toBe(opt.slot)
    })
  })

  it('DELIVERY_SLOT_MAP ánh xạ chính xác từng mã slot với nhãn và khoảng giờ chuẩn', () => {
    expect(DELIVERY_SLOT_MAP.MORNING).toEqual({
      slot: 'MORNING',
      label: 'Sáng',
      timeRange: '07:00 - 11:30',
      fullLabel: 'Buổi sáng (07:00 - 11:30)',
    })

    expect(DELIVERY_SLOT_MAP.AFTERNOON).toEqual({
      slot: 'AFTERNOON',
      label: 'Chiều',
      timeRange: '13:30 - 17:30',
      fullLabel: 'Buổi chiều (13:30 - 17:30)',
    })

    expect(DELIVERY_SLOT_MAP.EVENING).toEqual({
      slot: 'EVENING',
      label: 'Tối',
      timeRange: '18:00 - 21:00',
      fullLabel: 'Buổi tối (18:00 - 21:00)',
    })
  })

  it('formatDeliveryTimeSlot(slot, "full") định dạng chuẩn hóa cho Customer & Admin Order Detail', () => {
    expect(formatDeliveryTimeSlot('MORNING')).toBe('Buổi sáng (07:00 - 11:30)')
    expect(formatDeliveryTimeSlot('AFTERNOON')).toBe('Buổi chiều (13:30 - 17:30)')
    expect(formatDeliveryTimeSlot('EVENING')).toBe('Buổi tối (18:00 - 21:00)')
  })

  it('formatDeliveryTimeSlot(slot, "short") định dạng ngắn gọn cho Order List & Shipping Management', () => {
    expect(formatDeliveryTimeSlot('MORNING', 'short')).toBe('Sáng (07:00 - 11:30)')
    expect(formatDeliveryTimeSlot('AFTERNOON', 'short')).toBe('Chiều (13:30 - 17:30)')
    expect(formatDeliveryTimeSlot('EVENING', 'short')).toBe('Tối (18:00 - 21:00)')
  })

  it('an toàn khi slot là null, undefined hoặc mã lạ (fallback Cả ngày)', () => {
    expect(formatDeliveryTimeSlot(null)).toBe('Cả ngày')
    expect(formatDeliveryTimeSlot(undefined)).toBe('Cả ngày')
    expect(formatDeliveryTimeSlot('INVALID_SLOT' as unknown as string)).toBe('Cả ngày')
    expect(formatDeliveryTimeSlot('')).toBe('Cả ngày')
  })

  it('khắc phục triệt để lỗi EVENING bị hiển thị sai thành Cả ngày', () => {
    // Không một format nào được phép biến EVENING thành Cả ngày
    expect(formatDeliveryTimeSlot('EVENING')).not.toBe('Cả ngày')
    expect(formatDeliveryTimeSlot('EVENING', 'full')).toBe('Buổi tối (18:00 - 21:00)')
    expect(formatDeliveryTimeSlot('EVENING', 'short')).toBe('Tối (18:00 - 21:00)')
  })

  it('bảo đảm tính nhất quán (Harmonization Invariant) giữa Checkout và Customer Order Detail', () => {
    // Kịch bản demo DH-261029-ASRT: Khách chọn MORNING tại Checkout
    const checkoutMorning = DELIVERY_SLOT_MAP.MORNING
    const orderDetailMorning = formatDeliveryTimeSlot(checkoutMorning.slot)

    // Khoảng giờ hiển thị tại Checkout sub-label (07:00 - 11:30) phải nằm trọn vẹn trong nhãn Order Detail
    expect(orderDetailMorning).toContain(checkoutMorning.timeRange)
    expect(orderDetailMorning.toLowerCase()).toContain(checkoutMorning.label.toLowerCase())
    // Không còn hiện tượng lệch "6h – 11h" vs "07:00 - 11:30"
    expect(checkoutMorning.timeRange).toBe('07:00 - 11:30')
    expect(checkoutMorning.timeRange).not.toContain('6h')
  })
})
