import { describe, it, expect } from 'vitest'
import {
  validatePriceTiers,
  calculateCustomerUnitPrice,
} from '@/lib/domain/pricing'

describe('Domain: validatePriceTiers (Test Case P8 & Business Rules 3.2)', () => {
  const moqRi6 = 50000 // 50kg

  it('hợp lệ với 1 bậc giá bằng đúng MOQ', () => {
    const result = validatePriceTiers(moqRi6, [
      { minGrams: 50000, pricePerKg: 80000 },
    ])
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('hợp lệ với nhiều bậc giá giảm dần theo khối lượng', () => {
    const result = validatePriceTiers(moqRi6, [
      { minGrams: 50000, pricePerKg: 80000 },
      { minGrams: 200000, pricePerKg: 75000 },
      { minGrams: 500000, pricePerKg: 70000 },
    ])
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('hợp lệ khi thứ tự nhập vào chưa được sắp xếp (hàm tự sắp xếp)', () => {
    const result = validatePriceTiers(moqRi6, [
      { minGrams: 200000, pricePerKg: 75000 },
      { minGrams: 50000, pricePerKg: 80000 },
    ])
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('báo lỗi khi danh sách bậc rỗng', () => {
    const result = validatePriceTiers(moqRi6, [])
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('ít nhất một bậc giá sỉ')
  })

  it('báo lỗi khi bậc thấp nhất không bằng MOQ (P8: bậc thấp nhất ≠ MOQ)', () => {
    const result = validatePriceTiers(moqRi6, [
      { minGrams: 30000, pricePerKg: 85000 },
      { minGrams: 200000, pricePerKg: 75000 },
    ])
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('bắt đầu từ mức MOQ'))).toBe(true)
  })

  it('báo lỗi khi trùng minGrams (P8: trùng minGrams)', () => {
    const result = validatePriceTiers(moqRi6, [
      { minGrams: 50000, pricePerKg: 80000 },
      { minGrams: 200000, pricePerKg: 75000 },
      { minGrams: 200000, pricePerKg: 72000 },
    ])
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('Trùng mức khối lượng'))).toBe(true)
  })

  it('báo lỗi khi giá tăng dần hoặc bằng nhau (P8: giá không giảm)', () => {
    // Giá bậc sau cao hơn bậc trước
    const result1 = validatePriceTiers(moqRi6, [
      { minGrams: 50000, pricePerKg: 80000 },
      { minGrams: 200000, pricePerKg: 85000 },
    ])
    expect(result1.valid).toBe(false)
    expect(result1.errors.some((e) => e.includes('phải rẻ hơn bậc trước'))).toBe(true)

    // Giá bậc sau bằng bậc trước
    const result2 = validatePriceTiers(moqRi6, [
      { minGrams: 50000, pricePerKg: 80000 },
      { minGrams: 200000, pricePerKg: 80000 },
    ])
    expect(result2.valid).toBe(false)
    expect(result2.errors.some((e) => e.includes('phải rẻ hơn bậc trước'))).toBe(true)
  })
})

describe('Domain: calculateCustomerUnitPrice', () => {
  it('giữ nguyên giá khi nhóm 0% (Khách lẻ / SMALL_SHOP)', () => {
    expect(calculateCustomerUnitPrice(80000, 0)).toBe(80000)
  })

  it('áp chiết khấu 5% cho Đại lý cấp 1 (TIER1_AGENT)', () => {
    expect(calculateCustomerUnitPrice(80000, 5)).toBe(76000)
  })

  it('áp chiết khấu 3% cho Siêu thị (SUPERMARKET)', () => {
    expect(calculateCustomerUnitPrice(80000, 3)).toBe(77600)
    expect(calculateCustomerUnitPrice(75000, 3)).toBe(72750)
  })
})
