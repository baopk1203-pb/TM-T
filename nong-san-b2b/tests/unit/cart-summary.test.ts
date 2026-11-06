import { describe, it, expect } from 'vitest'
import {
  getCartDiscountDisplay,
  getCheckoutDiscountNotice,
  calculateCartSavings,
} from '@/lib/cart-summary'

describe('WEB-UX-SAMPLE: Cart & Checkout Discount Text Verification', () => {
  it('1. Giỏ chỉ có hàng mẫu: không thông báo sai rằng đã trừ chiết khấu đối tác', () => {
    const result = getCartDiscountDisplay({
      userDiscount: 5,
      regularLineCount: 0,
      sampleLineCount: 1,
    })

    expect(result.text).toBe('0%')
    expect(result.subtext).toBe('Không áp dụng cho hàng mẫu')
  })

  it('2. Giỏ chỉ có hàng sỉ: hiển thị đúng chiết khấu đối tác', () => {
    const result = getCartDiscountDisplay({
      userDiscount: 5,
      regularLineCount: 2,
      sampleLineCount: 0,
    })

    expect(result.text).toBe('Đã trừ 5%')
    expect(result.subtext).toBeUndefined()
  })

  it('3. Giỏ hỗn hợp (cả hàng sỉ và hàng mẫu): giải thích rõ chiết khấu chỉ áp dụng cho hàng sỉ', () => {
    const result = getCartDiscountDisplay({
      userDiscount: 5,
      regularLineCount: 1,
      sampleLineCount: 1,
    })

    expect(result.text).toBe('Đã trừ 5%')
    expect(result.subtext).toBe('Chỉ áp dụng cho hàng sỉ')
  })

  it('4. Giỏ rỗng: không bị nhận nhầm là giỏ chỉ có hàng mẫu', () => {
    const result = getCartDiscountDisplay({
      userDiscount: 5,
      regularLineCount: 0,
      sampleLineCount: 0,
    })

    expect(result.text).toBe('0%')
    expect(result.subtext).toBeUndefined() // Không có subtext "Không áp dụng cho hàng mẫu"
  })

  it('5. Khách vãng lai / không có chiết khấu (userDiscount = 0): luôn hiển thị 0%', () => {
    const emptyResult = getCartDiscountDisplay({
      userDiscount: 0,
      regularLineCount: 0,
      sampleLineCount: 0,
    })
    expect(emptyResult.text).toBe('0%')

    const regularResult = getCartDiscountDisplay({
      userDiscount: 0,
      regularLineCount: 2,
      sampleLineCount: 0,
    })
    expect(regularResult.text).toBe('0%')

    const sampleResult = getCartDiscountDisplay({
      userDiscount: 0,
      regularLineCount: 0,
      sampleLineCount: 1,
    })
    expect(sampleResult.text).toBe('0%')
  })

  it('6. Thông báo checkout header phản ánh chính xác cấu trúc giỏ hàng', () => {
    // Chỉ có hàng mẫu
    const sampleNotice = getCheckoutDiscountNotice({
      userDiscount: 5,
      regularLineCount: 0,
      sampleLineCount: 1,
    })
    expect(sampleNotice).toContain('không áp dụng chiết khấu đối tác')

    // Chỉ có hàng sỉ
    const regularNotice = getCheckoutDiscountNotice({
      userDiscount: 5,
      regularLineCount: 2,
      sampleLineCount: 0,
    })
    expect(regularNotice).toContain('đã được áp dụng tự động')

    // Giỏ hỗn hợp
    const mixedNotice = getCheckoutDiscountNotice({
      userDiscount: 5,
      regularLineCount: 1,
      sampleLineCount: 1,
    })
    expect(mixedNotice).toContain('chỉ áp dụng cho hàng sỉ')

    // Không có chiết khấu
    const noDiscountNotice = getCheckoutDiscountNotice({
      userDiscount: 0,
      regularLineCount: 2,
      sampleLineCount: 1,
    })
    expect(noDiscountNotice).toBe('')
  })

  describe('Dựa trên dữ liệu quote thực tế & Khắc phục tuyên bố sai lệch', () => {
    it('7. calculateCartSavings() tính chuẩn xác số tiền tiết kiệm được từ quote', () => {
      const quote = {
        productSummaries: [
          { productId: 'prod-1', basePricePerKg: 100000 },
        ],
        lines: [
          // 10kg = 10,000g. Giá gốc: 100k*10 = 1,000,000. Giá sau chiết khấu 5%: 95k*10 = 950,000.
          { productId: 'prod-1', totalGrams: 10000, lineTotal: 950000 },
        ],
      }

      expect(calculateCartSavings(quote)).toBe(50000)
    })

    it('8. calculateCartSavings() trả về 0 khi không có dòng sỉ hoặc giá không đổi', () => {
      expect(calculateCartSavings(undefined)).toBe(0)
      expect(calculateCartSavings({ lines: [], productSummaries: [] })).toBe(0)

      const quoteNoDiscount = {
        productSummaries: [{ productId: 'prod-1', basePricePerKg: 100000 }],
        lines: [{ productId: 'prod-1', totalGrams: 10000, lineTotal: 1000000 }],
      }
      expect(calculateCartSavings(quoteNoDiscount)).toBe(0)
    })

    it('9. Khi userDiscount > 0 nhưng quote thực tế không giảm (actualSavings = 0), UI hiển thị 0% thay vì "Đã trừ X%"', () => {
      const result = getCartDiscountDisplay({
        userDiscount: 5,
        regularLineCount: 1,
        sampleLineCount: 0,
        actualSavings: 0,
      })

      expect(result.text).toBe('0%')
      expect(result.subtext).toBe('Chưa áp dụng giảm giá')
    })

    it('10. Giỏ hỗn hợp khi có actualSavings > 0 hiển thị rõ phạm vi "Đã trừ X% cho hàng sỉ" và "Không áp dụng cho hàng mẫu"', () => {
      const result = getCartDiscountDisplay({
        userDiscount: 5,
        regularLineCount: 1,
        sampleLineCount: 1,
        actualSavings: 50000,
      })

      expect(result.text).toBe('Đã trừ 5% cho hàng sỉ')
      expect(result.subtext).toBe('Không áp dụng cho hàng mẫu')
    })

    it('11. Checkout notice khi actualSavings = 0 không tuyên bố đã áp dụng tự động', () => {
      const noticeRegular = getCheckoutDiscountNotice({
        userDiscount: 5,
        regularLineCount: 1,
        sampleLineCount: 0,
        actualSavings: 0,
      })
      expect(noticeRegular).toBe('')

      const noticeMixed = getCheckoutDiscountNotice({
        userDiscount: 5,
        regularLineCount: 1,
        sampleLineCount: 1,
        actualSavings: 0,
      })
      expect(noticeMixed).toContain('không áp dụng chiết khấu đối tác')
    })
  })

  describe('CC-01: Membership & Combined Discount Display Verification', () => {
    it('12. CC-01: Hiển thị đúng chiết khấu kết hợp 7% (Nhóm 5% + Hạng Đồng 2%)', () => {
      const result = getCartDiscountDisplay({
        userDiscount: 5,
        regularLineCount: 2,
        sampleLineCount: 0,
        membershipDiscount: 2,
        combinedDiscount: 7,
        membershipTierName: 'Đồng',
      })

      expect(result.label).toBe('Ưu đãi đối tác & thành viên:')
      expect(result.text).toBe('Đã trừ 7%')
      expect(result.subtext).toBe('Nhóm đối tác: -5% • Hạng Đồng: -2% (tối đa 10%)')
    })

    it('13. CC-01 Giỏ hỗn hợp: Hiển thị phạm vi cho hàng sỉ và chi tiết breakdown nhóm + hạng', () => {
      const result = getCartDiscountDisplay({
        userDiscount: 5,
        regularLineCount: 1,
        sampleLineCount: 1,
        actualSavings: 50000,
        membershipDiscount: 2,
        combinedDiscount: 7,
        membershipTierName: 'Đồng',
      })

      expect(result.label).toBe('Ưu đãi đối tác & thành viên:')
      expect(result.text).toBe('Đã trừ 7% cho hàng sỉ')
      expect(result.subtext).toContain('Nhóm đối tác: -5% • Hạng Đồng: -2%')
      expect(result.subtext).toContain('Không áp dụng cho hàng mẫu')
    })

    it('14. CC-01 Checkout notice: Hiển thị rõ ràng % kết hợp và breakdown nhóm + hạng', () => {
      const notice = getCheckoutDiscountNotice({
        userDiscount: 5,
        regularLineCount: 2,
        sampleLineCount: 0,
        membershipDiscount: 2,
        combinedDiscount: 7,
        membershipTierName: 'Đồng',
      })

      expect(notice).toBe(' • Ưu đãi kết hợp 7% (Nhóm: -5%, Hạng Đồng: -2%) đã được áp dụng tự động')
    })

    it('15. CC-01 Checkout notice giỏ hỗn hợp: Nêu rõ chỉ áp dụng cho hàng sỉ', () => {
      const notice = getCheckoutDiscountNotice({
        userDiscount: 5,
        regularLineCount: 1,
        sampleLineCount: 1,
        actualSavings: 50000,
        membershipDiscount: 2,
        combinedDiscount: 7,
        membershipTierName: 'Đồng',
      })

      expect(notice).toBe(' • Ưu đãi kết hợp 7% (Nhóm: -5%, Hạng Đồng: -2%) chỉ áp dụng cho hàng sỉ')
    })
  })
})
