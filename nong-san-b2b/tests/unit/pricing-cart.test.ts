import { describe, it, expect } from 'vitest'
import {
  findTier,
  priceCart,
  ProductPricingData,
} from '@/lib/domain/pricing'

describe('Domain: Pricing Engine & Cart (Test cases P1 - P7)', () => {
  // Dữ liệu mẫu chuẩn: Sầu riêng Ri6 (Mục 7.1)
  const productRi6: ProductPricingData = {
    id: 'prod-ri6',
    name: 'Sầu Riêng Ri6 Cai Lậy',
    moqGrams: 50000, // 50kg
    priceTiers: [
      { minGrams: 50000, pricePerKg: 80000 },
      { minGrams: 200000, pricePerKg: 75000 },
    ],
    packagings: [
      {
        id: 'pkg-thung-10kg',
        name: 'Thùng carton 10kg',
        weightGrams: 10000,
        isSample: false,
      },
      {
        id: 'pkg-ro-20kg',
        name: 'Rổ nhựa 20kg',
        weightGrams: 20000,
        isSample: false,
      },
      {
        id: 'pkg-mau-2kg',
        name: 'Gói mẫu thử 2kg',
        weightGrams: 2000,
        isSample: true,
        samplePrice: 200000, // 200.000 đ cố định
      },
    ],
  }

  const products = [productRi6]

  describe('findTier', () => {
    const tiers = productRi6.priceTiers

    it('trả về undefined nếu totalGrams < MOQ (bậc thấp nhất)', () => {
      expect(findTier(tiers, 30000)).toBeUndefined()
    })

    it('trả về bậc 1 khi totalGrams bằng đúng minGrams của bậc 1 (50kg)', () => {
      const tier = findTier(tiers, 50000)
      expect(tier?.pricePerKg).toBe(80000)
    })

    it('trả về bậc 1 khi totalGrams nằm giữa bậc 1 và bậc 2 (160kg)', () => {
      const tier = findTier(tiers, 160000)
      expect(tier?.pricePerKg).toBe(80000)
    })

    it('trả về bậc 2 khi totalGrams chạm biên bậc 2 (200kg)', () => {
      const tier = findTier(tiers, 200000)
      expect(tier?.pricePerKg).toBe(75000)
    })

    it('trả về bậc 2 khi totalGrams vượt bậc 2 (210kg)', () => {
      const tier = findTier(tiers, 210000)
      expect(tier?.pricePerKg).toBe(75000)
    })
  })

  // P1: 3 thùng (30kg), nhóm 0% -> meetsMoq = false, missingGramsForMoq = 20000
  it('P1: 3 thùng (30kg), nhóm 0% -> meetsMoq = false, missingGramsForMoq = 20000', () => {
    const result = priceCart({
      lines: [{ productId: 'prod-ri6', packagingId: 'pkg-thung-10kg', quantity: 3 }],
      products,
      groupDiscountPercent: 0,
    })

    expect(result.isValid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.productSummaries).toHaveLength(1)

    const summary = result.productSummaries[0]
    expect(summary.totalGrams).toBe(30000)
    expect(summary.meetsMoq).toBe(false)
    expect(summary.missingGramsForMoq).toBe(20000)
  })

  // P2: 5 thùng (50kg), 0% -> bậc 80.000, unit 80.000, line 4.000.000
  it('P2: 5 thùng (50kg), 0% -> bậc 80.000, unit 80.000, line 4.000.000', () => {
    const result = priceCart({
      lines: [{ productId: 'prod-ri6', packagingId: 'pkg-thung-10kg', quantity: 5 }],
      products,
      groupDiscountPercent: 0,
    })

    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)

    const summary = result.productSummaries[0]
    expect(summary.meetsMoq).toBe(true)
    expect(summary.totalGrams).toBe(50000)
    expect(summary.basePricePerKg).toBe(80000)
    expect(summary.unitPricePerKg).toBe(80000)

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].lineTotal).toBe(4000000)
    expect(result.subtotal).toBe(4000000)
  })

  // P3: 16 thùng (160kg), Siêu thị 3% -> unit 77.600, subtotal 12.416.000, nextTier: thiếu 40.000g -> 75.000
  it('P3: 16 thùng (160kg), Siêu thị 3% -> unit 77.600, subtotal 12.416.000, nextTier: thiếu 40.000g -> 75.000', () => {
    const result = priceCart({
      lines: [{ productId: 'prod-ri6', packagingId: 'pkg-thung-10kg', quantity: 16 }],
      products,
      groupDiscountPercent: 3,
    })

    expect(result.isValid).toBe(true)
    const summary = result.productSummaries[0]
    expect(summary.totalGrams).toBe(160000)
    expect(summary.basePricePerKg).toBe(80000)
    expect(summary.unitPricePerKg).toBe(77600)
    expect(summary.nextTier).toBeDefined()
    expect(summary.nextTier?.minGrams).toBe(200000)
    expect(summary.nextTier?.pricePerKg).toBe(75000)
    expect(summary.nextTier?.missingGrams).toBe(40000)

    expect(result.lines[0].lineTotal).toBe(12416000)
    expect(result.subtotal).toBe(12416000)
  })

  // P4: 15 thùng + 3 rổ (210kg), Siêu thị 3% -> unit 72.750, subtotal 15.277.500
  it('P4: 15 thùng + 3 rổ (210kg), Siêu thị 3% -> unit 72.750, subtotal 15.277.500', () => {
    const result = priceCart({
      lines: [
        { productId: 'prod-ri6', packagingId: 'pkg-thung-10kg', quantity: 15 }, // 150kg
        { productId: 'prod-ri6', packagingId: 'pkg-ro-20kg', quantity: 3 },     // 60kg
      ],
      products,
      groupDiscountPercent: 3,
    })

    expect(result.isValid).toBe(true)
    const summary = result.productSummaries[0]
    expect(summary.totalGrams).toBe(210000)
    expect(summary.basePricePerKg).toBe(75000)
    expect(summary.unitPricePerKg).toBe(72750)
    expect(summary.nextTier).toBeUndefined() // đã đạt bậc cao nhất

    expect(result.lines).toHaveLength(2)
    // 150kg * 72.750 = 10.912.500
    expect(result.lines[0].lineTotal).toBe(10912500)
    // 60kg * 72.750 = 4.365.000
    expect(result.lines[1].lineTotal).toBe(4365000)
    // Tổng = 15.277.500 đ
    expect(result.subtotal).toBe(15277500)
  })

  // P5: 20 thùng (200kg) đúng biên, 0% -> bậc 75.000 (biên tính là >=)
  it('P5: 20 thùng (200kg) đúng biên, 0% -> bậc 75.000 (biên tính là >=)', () => {
    const result = priceCart({
      lines: [{ productId: 'prod-ri6', packagingId: 'pkg-thung-10kg', quantity: 20 }],
      products,
      groupDiscountPercent: 0,
    })

    expect(result.isValid).toBe(true)
    const summary = result.productSummaries[0]
    expect(summary.totalGrams).toBe(200000)
    expect(summary.basePricePerKg).toBe(75000)
    expect(summary.unitPricePerKg).toBe(75000)
    expect(result.subtotal).toBe(15000000)
  })

  // P6: 1 gói mẫu + 0 thùng, Đại lý 5% -> không lỗi MOQ, subtotal 200.000 (mẫu không chiết khấu)
  it('P6: 1 gói mẫu + 0 thùng, Đại lý 5% -> không lỗi MOQ, subtotal 200.000 (mẫu không chiết khấu)', () => {
    const result = priceCart({
      lines: [{ productId: 'prod-ri6', packagingId: 'pkg-mau-2kg', quantity: 1 }],
      products,
      groupDiscountPercent: 5,
    })

    expect(result.isValid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.productSummaries).toHaveLength(0) // không có sản phẩm thường
    expect(result.sampleLines).toHaveLength(1)
    expect(result.sampleLines[0].samplePrice).toBe(200000)
    expect(result.sampleLines[0].lineTotal).toBe(200000)
    expect(result.subtotal).toBe(200000)
  })

  // P7: 5 thùng + 1 mẫu -> totalGrams = 50.000 (không cộng mẫu), subtotal 4.200.000
  it('P7: 5 thùng + 1 mẫu -> totalGrams = 50.000 (không cộng mẫu), subtotal 4.200.000', () => {
    const result = priceCart({
      lines: [
        { productId: 'prod-ri6', packagingId: 'pkg-thung-10kg', quantity: 5 }, // 50kg
        { productId: 'prod-ri6', packagingId: 'pkg-mau-2kg', quantity: 1 },    // 1 mẫu 200k
      ],
      products,
      groupDiscountPercent: 0,
    })

    expect(result.isValid).toBe(true)
    const summary = result.productSummaries[0]
    expect(summary.totalGrams).toBe(50000) // mẫu không cộng vào totalGrams
    expect(summary.unitPricePerKg).toBe(80000)

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].lineTotal).toBe(4000000)
    expect(result.sampleLines).toHaveLength(1)
    expect(result.sampleLines[0].lineTotal).toBe(200000)
    expect(result.subtotal).toBe(4200000)
  })

  it('xử lý giỏ hàng rỗng an toàn', () => {
    const result = priceCart({
      lines: [],
      products,
      groupDiscountPercent: 3,
    })

    expect(result.isValid).toBe(true)
    expect(result.lines).toHaveLength(0)
    expect(result.sampleLines).toHaveLength(0)
    expect(result.subtotal).toBe(0)
    expect(result.errors).toHaveLength(0)
  })
})
