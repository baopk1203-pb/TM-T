import { describe, it, expect } from 'vitest'
import {
  priceCart,
  calculateCustomerUnitPrice,
  ProductPricingData,
} from '@/lib/domain/pricing'
import {
  calculateCombinedProductDiscount,
  MEMBERSHIP_TIER_CONFIG,
  MembershipTier,
  resolveEffectiveMembershipTier,
} from '@/lib/domain/membership'
import { getCartDiscountDisplay, getCheckoutDiscountNotice } from '@/lib/cart-summary'

describe('EV-BETA-CC01-HOTFIX-02: PDP Pricing Preview & Pipeline Invariant Verification', () => {
  // Sầu riêng Ri6 fixture matching Beta test scenario
  const ri6Product: ProductPricingData = {
    id: 'prod-ri6',
    name: 'Sầu riêng Ri6',
    moqGrams: 50_000, // 50 kg
    priceTiers: [
      { minGrams: 50_000, pricePerKg: 80_000 },
      { minGrams: 200_000, pricePerKg: 75_000 },
    ],
    packagings: [
      { id: 'pkg-10kg', name: 'Thùng carton 10 kg', weightGrams: 10_000, isSample: false },
      { id: 'pkg-20kg', name: 'Rổ nhựa 20 kg', weightGrams: 20_000, isSample: false },
    ],
  }

  // Đại lý cấp 1, Membership Đồng
  const dealerUser = {
    name: 'Đại lý Test',
    role: 'CUSTOMER',
    groupName: 'Đại lý cấp 1',
    discountPercent: 5,
    membershipTier: MembershipTier.BRONZE,
    membershipTierName: 'Đồng',
    membershipDiscountPercent: 2,
    combinedDiscountPercent: 7,
  }

  it('1. PDP Table Calculation: Đơn giá sau chiết khấu kết hợp 7% là 74.400 đ/kg và bậc tiếp theo là 69.750 đ/kg', () => {
    const tier1UnitPrice = calculateCustomerUnitPrice(
      ri6Product.priceTiers[0].pricePerKg,
      dealerUser.combinedDiscountPercent
    )
    expect(tier1UnitPrice).toBe(74_400) // 80.000 * (100 - 7) / 100 = 74.400

    const tier2UnitPrice = calculateCustomerUnitPrice(
      ri6Product.priceTiers[1].pricePerKg,
      dealerUser.combinedDiscountPercent
    )
    expect(tier2UnitPrice).toBe(69_750) // 75.000 * (100 - 7) / 100 = 69.750
  })

  it('2. PDP Realtime Preview (ProductOrderBox): Tính đúng 74.400 đ/kg và tạm tính 3.720.000 đ cho 50 kg', () => {
    // 5 thùng 10kg = 50kg
    const lines = [{ productId: ri6Product.id, packagingId: 'pkg-10kg', quantity: 5 }]

    const quoteResult = priceCart({
      lines,
      products: [ri6Product],
      groupDiscountPercent: dealerUser.discountPercent,
      membershipTier: dealerUser.membershipTier,
      membershipDiscountPercent: dealerUser.membershipDiscountPercent,
    })

    expect(quoteResult.isValid).toBe(true)
    expect(quoteResult.combinedDiscountPercent).toBe(7)
    expect(quoteResult.subtotal).toBe(3_720_000)

    const summary = quoteResult.productSummaries[0]
    expect(summary.totalGrams).toBe(50_000)
    expect(summary.meetsMoq).toBe(true)
    expect(summary.basePricePerKg).toBe(80_000)
    expect(summary.unitPricePerKg).toBe(74_400)

    // Next tier suggestion calculation in ProductOrderBox
    expect(summary.nextTier).toBeDefined()
    expect(summary.nextTier?.minGrams).toBe(200_000)
    expect(summary.nextTier?.pricePerKg).toBe(75_000)

    const nextTierSuggestedPrice = calculateCustomerUnitPrice(
      summary.nextTier!.pricePerKg,
      dealerUser.combinedDiscountPercent
    )
    expect(nextTierSuggestedPrice).toBe(69_750)
  })

  it('3. Invariant Rule: PDP TABLE = PDP PREVIEW = CART QUOTE = CHECKOUT QUOTE', () => {
    const lines = [{ productId: ri6Product.id, packagingId: 'pkg-10kg', quantity: 5 }]

    // 1. Table
    const tableUnitPrice = calculateCustomerUnitPrice(
      ri6Product.priceTiers[0].pricePerKg,
      dealerUser.combinedDiscountPercent
    )

    // 2. PDP Preview
    const previewQuote = priceCart({
      lines,
      products: [ri6Product],
      groupDiscountPercent: dealerUser.discountPercent,
      membershipTier: dealerUser.membershipTier,
      membershipDiscountPercent: dealerUser.membershipDiscountPercent,
    })

    // 3. Cart Quote
    const cartQuote = priceCart({
      lines,
      products: [ri6Product],
      groupDiscountPercent: dealerUser.discountPercent,
      membershipTier: dealerUser.membershipTier,
      membershipDiscountPercent: dealerUser.membershipDiscountPercent,
    })

    // 4. Checkout Quote
    const checkoutQuote = priceCart({
      lines,
      products: [ri6Product],
      groupDiscountPercent: dealerUser.discountPercent,
      membershipTier: dealerUser.membershipTier,
      membershipDiscountPercent: dealerUser.membershipDiscountPercent,
    })

    // TẤT CẢ 4 NƠI PHẢI KHỚP CHÍNH XÁC:
    expect(tableUnitPrice).toBe(74_400)
    expect(previewQuote.productSummaries[0].unitPricePerKg).toBe(tableUnitPrice)
    expect(cartQuote.productSummaries[0].unitPricePerKg).toBe(tableUnitPrice)
    expect(checkoutQuote.productSummaries[0].unitPricePerKg).toBe(tableUnitPrice)

    expect(previewQuote.subtotal).toBe(3_720_000)
    expect(cartQuote.subtotal).toBe(3_720_000)
    expect(checkoutQuote.subtotal).toBe(3_720_000)
  })

  it('4. Discount Breakdown Labels: Phản ánh đầy đủ Nhóm 5% + Hạng Đồng 2% = 7%', () => {
    const display = getCartDiscountDisplay({
      userDiscount: dealerUser.discountPercent,
      regularLineCount: 1,
      sampleLineCount: 0,
      membershipDiscount: dealerUser.membershipDiscountPercent,
      combinedDiscount: dealerUser.combinedDiscountPercent,
      membershipTierName: dealerUser.membershipTierName,
    })

    expect(display.label).toBe('Ưu đãi đối tác & thành viên:')
    expect(display.text).toBe('Đã trừ 7%')
    expect(display.subtext).toContain('Nhóm đối tác: -5%')
    expect(display.subtext).toContain('Hạng Đồng: -2%')

    const notice = getCheckoutDiscountNotice({
      userDiscount: dealerUser.discountPercent,
      regularLineCount: 1,
      sampleLineCount: 0,
      membershipDiscount: dealerUser.membershipDiscountPercent,
      combinedDiscount: dealerUser.combinedDiscountPercent,
      membershipTierName: dealerUser.membershipTierName,
    })
    expect(notice).toContain('7%')
    expect(notice).toContain('Nhóm: -5%')
    expect(notice).toContain('Hạng Đồng: -2%')
  })

  it('5. Cap Constraint (PAR-10): Chiết khấu cộng dồn khống chế tối đa 10%', () => {
    const highGroupUser = {
      discountPercent: 8,
      membershipDiscountPercent: 4, // Hạng Vàng
    }
    const combined = calculateCombinedProductDiscount(
      highGroupUser.discountPercent,
      highGroupUser.membershipDiscountPercent
    )
    expect(combined).toBe(10) // 8 + 4 = 12 -> cap at 10

    const unitPrice = calculateCustomerUnitPrice(80_000, combined)
    expect(unitPrice).toBe(72_000) // 80.000 * 0.9 = 72.000
  })

  it('6. Legacy / Khách hàng chưa xét hạng (Role CUSTOMER): Tự động gán mặc định Bronze (2%)', () => {
    const legacyCustomer = {
      role: 'CUSTOMER',
      membershipTier: null,
    }
    const effectiveTier = resolveEffectiveMembershipTier(legacyCustomer)
    expect(effectiveTier).toBe(MembershipTier.BRONZE)

    const benefits = MEMBERSHIP_TIER_CONFIG[effectiveTier!]
    expect(benefits.productDiscountPercent).toBe(2)
  })
})
