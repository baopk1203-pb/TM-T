import { describe, it, expect } from 'vitest'
import {
  MembershipTier,
  MEMBERSHIP_TIER_CONFIG,
  MIN_MEMBERSHIP_SCORE,
  MAX_MEMBERSHIP_SCORE,
  MAX_COMBINED_PRODUCT_DISCOUNT_PERCENT,
  MAX_MEMBERSHIP_SHIPPING_DISCOUNT_AMOUNT,
  validateMembershipScore,
  getMembershipTierFromScore,
  getMembershipBenefits,
  calculateCombinedProductDiscount,
  calculateMembershipShippingDiscount,
} from '@/lib/domain/membership'

describe('F04 — Membership Foundation Domain Tests', () => {
  describe('Policy Constants (PAR-10, PAR-14)', () => {
    it('khai báo đúng trần tổng chiết khấu sản phẩm cộng dồn là 10% (PAR-10)', () => {
      expect(MAX_COMBINED_PRODUCT_DISCOUNT_PERCENT).toBe(10)
    })

    it('khai báo đúng mức giảm phí vận chuyển tối đa 100.000 VND/đơn (PAR-14)', () => {
      expect(MAX_MEMBERSHIP_SHIPPING_DISCOUNT_AMOUNT).toBe(100_000)
    })

    it('khai báo đúng thang điểm từ 0 đến 100', () => {
      expect(MIN_MEMBERSHIP_SCORE).toBe(0)
      expect(MAX_MEMBERSHIP_SCORE).toBe(100)
    })
  })

  describe('Score Validation (validateMembershipScore)', () => {
    it('chấp nhận điểm biên 0 và 100', () => {
      expect(validateMembershipScore(0).valid).toBe(true)
      expect(validateMembershipScore(100).valid).toBe(true)
    })

    it('chấp nhận các điểm hợp lệ trong khoảng 0-100', () => {
      expect(validateMembershipScore(39).valid).toBe(true)
      expect(validateMembershipScore(40).valid).toBe(true)
      expect(validateMembershipScore(69.5).valid).toBe(true)
      expect(validateMembershipScore(70).valid).toBe(true)
      expect(validateMembershipScore(89).valid).toBe(true)
      expect(validateMembershipScore(90).valid).toBe(true)
    })

    it('từ chối điểm âm (< 0)', () => {
      const res = validateMembershipScore(-1)
      expect(res.valid).toBe(false)
      expect(res.error).toMatch(/không được nhỏ hơn 0/)
    })

    it('từ chối điểm vượt trần (> 100)', () => {
      const res = validateMembershipScore(100.1)
      expect(res.valid).toBe(false)
      expect(res.error).toMatch(/không được vượt quá 100/)
    })

    it('từ chối NaN và các giá trị không phải số hữu hạn', () => {
      expect(validateMembershipScore(NaN).valid).toBe(false)
      expect(validateMembershipScore(Infinity).valid).toBe(false)
      expect(validateMembershipScore(-Infinity).valid).toBe(false)
      expect(validateMembershipScore('85').valid).toBe(false)
      expect(validateMembershipScore(null).valid).toBe(false)
      expect(validateMembershipScore(undefined).valid).toBe(false)
      expect(validateMembershipScore({}).valid).toBe(false)
    })
  })

  describe('Tier Determination by Score (PAR-11)', () => {
    it('Score 0 -> BRONZE (Đồng)', () => {
      expect(getMembershipTierFromScore(0)).toBe(MembershipTier.BRONZE)
    })

    it('Score 39 -> BRONZE (Đồng)', () => {
      expect(getMembershipTierFromScore(39)).toBe(MembershipTier.BRONZE)
    })

    it('Score 40 -> SILVER (Bạc)', () => {
      expect(getMembershipTierFromScore(40)).toBe(MembershipTier.SILVER)
    })

    it('Score 69 -> SILVER (Bạc)', () => {
      expect(getMembershipTierFromScore(69)).toBe(MembershipTier.SILVER)
    })

    it('Score 70 -> GOLD (Vàng)', () => {
      expect(getMembershipTierFromScore(70)).toBe(MembershipTier.GOLD)
    })

    it('Score 89 -> GOLD (Vàng)', () => {
      expect(getMembershipTierFromScore(89)).toBe(MembershipTier.GOLD)
    })

    it('Score 90 -> DIAMOND (Kim Cương)', () => {
      expect(getMembershipTierFromScore(90)).toBe(MembershipTier.DIAMOND)
    })

    it('Score 100 -> DIAMOND (Kim Cương)', () => {
      expect(getMembershipTierFromScore(100)).toBe(MembershipTier.DIAMOND)
    })

    it('ném lỗi khi truyền score âm, > 100 hoặc NaN vào getMembershipTierFromScore', () => {
      expect(() => getMembershipTierFromScore(-5)).toThrow()
      expect(() => getMembershipTierFromScore(105)).toThrow()
      expect(() => getMembershipTierFromScore(NaN)).toThrow()
    })
  })

  describe('Tier Benefits & Policy (PAR-12, PAR-13)', () => {
    it('BRONZE: Chiết khấu sản phẩm 2%, giảm phí ship 5%', () => {
      const benefits = getMembershipBenefits(MembershipTier.BRONZE)
      expect(benefits.name).toBe('Đồng')
      expect(benefits.minScore).toBe(0)
      expect(benefits.maxScore).toBe(39)
      expect(benefits.productDiscountPercent).toBe(2)
      expect(benefits.shippingDiscountPercent).toBe(5)
    })

    it('SILVER: Chiết khấu sản phẩm 3%, giảm phí ship 10%', () => {
      const benefits = getMembershipBenefits(MembershipTier.SILVER)
      expect(benefits.name).toBe('Bạc')
      expect(benefits.minScore).toBe(40)
      expect(benefits.maxScore).toBe(69)
      expect(benefits.productDiscountPercent).toBe(3)
      expect(benefits.shippingDiscountPercent).toBe(10)
    })

    it('GOLD: Chiết khấu sản phẩm 4%, giảm phí ship 15%', () => {
      const benefits = getMembershipBenefits(MembershipTier.GOLD)
      expect(benefits.name).toBe('Vàng')
      expect(benefits.minScore).toBe(70)
      expect(benefits.maxScore).toBe(89)
      expect(benefits.productDiscountPercent).toBe(4)
      expect(benefits.shippingDiscountPercent).toBe(15)
    })

    it('DIAMOND: Chiết khấu sản phẩm 5%, giảm phí ship 20%', () => {
      const benefits = getMembershipBenefits(MembershipTier.DIAMOND)
      expect(benefits.name).toBe('Kim Cương')
      expect(benefits.minScore).toBe(90)
      expect(benefits.maxScore).toBe(100)
      expect(benefits.productDiscountPercent).toBe(5)
      expect(benefits.shippingDiscountPercent).toBe(20)
    })

    it('tất cả 4 hạng trong MEMBERSHIP_TIER_CONFIG đều được cấu hình chuẩn xác', () => {
      expect(MEMBERSHIP_TIER_CONFIG[MembershipTier.BRONZE].productDiscountPercent).toBe(2)
      expect(MEMBERSHIP_TIER_CONFIG[MembershipTier.SILVER].productDiscountPercent).toBe(3)
      expect(MEMBERSHIP_TIER_CONFIG[MembershipTier.GOLD].productDiscountPercent).toBe(4)
      expect(MEMBERSHIP_TIER_CONFIG[MembershipTier.DIAMOND].productDiscountPercent).toBe(5)

      expect(MEMBERSHIP_TIER_CONFIG[MembershipTier.BRONZE].shippingDiscountPercent).toBe(5)
      expect(MEMBERSHIP_TIER_CONFIG[MembershipTier.SILVER].shippingDiscountPercent).toBe(10)
      expect(MEMBERSHIP_TIER_CONFIG[MembershipTier.GOLD].shippingDiscountPercent).toBe(15)
      expect(MEMBERSHIP_TIER_CONFIG[MembershipTier.DIAMOND].shippingDiscountPercent).toBe(20)
    })
  })

  describe('Combined Product Discount Capping (PAR-10)', () => {
    it('cộng đúng khi tổng chiết khấu chưa chạm trần 10%', () => {
      // Khách nhóm 0% (SMALL_SHOP) + hạng Đồng 2% = 2%
      expect(calculateCombinedProductDiscount(0, 2)).toBe(2)
      // Khách nhóm 3% (SUPERMARKET) + hạng Bạc 3% = 6%
      expect(calculateCombinedProductDiscount(3, 3)).toBe(6)
      // Khách nhóm 5% (TIER1_AGENT) + hạng Vàng 4% = 9%
      expect(calculateCombinedProductDiscount(5, 4)).toBe(9)
      // Khách nhóm 5% (TIER1_AGENT) + hạng Kim Cương 5% = 10%
      expect(calculateCombinedProductDiscount(5, 5)).toBe(10)
    })

    it('khống chế trần 10% khi tổng chiết khấu vượt quá 10%', () => {
      // Khách nhóm đặc thù 8% + hạng Vàng 4% = 12% -> khống chế 10%
      expect(calculateCombinedProductDiscount(8, 4)).toBe(10)
      // Khách nhóm 10% + hạng Kim Cương 5% = 15% -> khống chế 10%
      expect(calculateCombinedProductDiscount(10, 5)).toBe(10)
    })

    it('xử lý an toàn khi đầu vào âm hoặc null/undefined', () => {
      expect(calculateCombinedProductDiscount(-5, 3)).toBe(3)
      expect(calculateCombinedProductDiscount(3, -2)).toBe(3)
      // @ts-expect-error test invalid inputs
      expect(calculateCombinedProductDiscount(null, undefined)).toBe(0)
    })
  })

  describe('Membership Shipping Discount Calculation & Capping (PAR-13, PAR-14)', () => {
    it('tính đúng số tiền giảm giá phí ship theo % của từng hạng', () => {
      const baseFee = 200_000
      // Đồng 5% của 200.000 = 10.000 VND
      expect(calculateMembershipShippingDiscount(baseFee, 5)).toBe(10_000)
      // Bạc 10% của 200.000 = 20.000 VND
      expect(calculateMembershipShippingDiscount(baseFee, 10)).toBe(20_000)
      // Vàng 15% của 200.000 = 30.000 VND
      expect(calculateMembershipShippingDiscount(baseFee, 15)).toBe(30_000)
      // Kim Cương 20% của 200.000 = 40.000 VND
      expect(calculateMembershipShippingDiscount(baseFee, 20)).toBe(40_000)
    })

    it('khống chế trần tối đa 100.000 VND/đơn khi số tiền giảm vượt quá trần', () => {
      // Đơn hàng lớn có cước vận chuyển 800.000 VND, Kim Cương 20% = 160.000 VND -> trần 100.000 VND
      expect(calculateMembershipShippingDiscount(800_000, 20)).toBe(100_000)
      // Cước vận chuyển 1.500.000 VND, Vàng 15% = 225.000 VND -> trần 100.000 VND
      expect(calculateMembershipShippingDiscount(1_500_000, 15)).toBe(100_000)
    })

    it('trả về 0 khi cước vận chuyển hoặc tỷ lệ giảm <= 0', () => {
      expect(calculateMembershipShippingDiscount(0, 10)).toBe(0)
      expect(calculateMembershipShippingDiscount(-50_000, 10)).toBe(0)
      expect(calculateMembershipShippingDiscount(200_000, 0)).toBe(0)
      expect(calculateMembershipShippingDiscount(200_000, -5)).toBe(0)
    })
  })
})
