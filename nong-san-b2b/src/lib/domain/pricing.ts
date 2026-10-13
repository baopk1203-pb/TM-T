/**
 * Domain Logic: Quản lý và kiểm tra bậc giá sỉ (Pricing Tiers)
 * Tuân thủ quy tắc nghiệp vụ B2B Nông sản (Mục 3.2 & Test P8)
 */

export interface PriceTierInput {
  minGrams: number
  pricePerKg: number
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * Kiểm tra tính hợp lệ của danh sách bậc giá sỉ khi Admin tạo/sửa sản phẩm:
 * 1. Phải có ít nhất 1 bậc giá.
 * 2. minGrams và pricePerKg phải lớn hơn 0.
 * 3. Bậc giá thấp nhất (minGrams nhỏ nhất) phải đúng bằng moqGrams của sản phẩm.
 * 4. Không được có các bậc giá trùng nhau về minGrams.
 * 5. Đơn giá (pricePerKg) phải giảm dần khi sản lượng (minGrams) tăng dần.
 */
export function validatePriceTiers(
  moqGrams: number,
  tiers: PriceTierInput[]
): ValidationResult {
  const errors: string[] = []

  if (!tiers || tiers.length === 0) {
    return {
      valid: false,
      errors: ['Sản phẩm phải có ít nhất một bậc giá sỉ'],
    }
  }

  if (moqGrams <= 0) {
    errors.push('Mức đặt tối thiểu (MOQ) phải lớn hơn 0 gram')
  }

  // Sắp xếp các bậc theo minGrams tăng dần
  const sortedTiers = [...tiers].sort((a, b) => a.minGrams - b.minGrams)

  // Kiểm tra từng bậc có giá trị dương
  for (let i = 0; i < sortedTiers.length; i++) {
    const tier = sortedTiers[i]
    if (tier.minGrams <= 0) {
      errors.push(`Bậc ${i + 1}: Khối lượng tối thiểu phải lớn hơn 0`)
    }
    if (tier.pricePerKg <= 0) {
      errors.push(`Bậc ${i + 1}: Đơn giá theo kg phải lớn hơn 0`)
    }
  }

  // 1. Bậc thấp nhất phải bằng moqGrams
  if (sortedTiers[0].minGrams !== moqGrams) {
    errors.push(
      `Bậc giá đầu tiên phải bắt đầu từ mức MOQ (${sortedTiers[0].minGrams}g ≠ ${moqGrams}g)`
    )
  }

  // 2. Kiểm tra trùng minGrams và giá phải giảm dần
  for (let i = 1; i < sortedTiers.length; i++) {
    const prev = sortedTiers[i - 1]
    const curr = sortedTiers[i]

    if (curr.minGrams === prev.minGrams) {
      errors.push(`Trùng mức khối lượng tối thiểu tại mốc ${curr.minGrams}g`)
    }

    if (curr.pricePerKg >= prev.pricePerKg) {
      errors.push(
        `Đơn giá bậc cao (${curr.minGrams}g: ${curr.pricePerKg.toLocaleString('vi-VN')} đ) phải rẻ hơn bậc trước (${prev.minGrams}g: ${prev.pricePerKg.toLocaleString('vi-VN')} đ)`
      )
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Tính đơn giá theo kg sau chiết khấu nhóm khách hàng
 * Công thức: round(basePricePerKg * (100 - discountPercent) / 100)
 */
export function calculateCustomerUnitPrice(
  basePricePerKg: number,
  discountPercent: number
): number {
  if (discountPercent <= 0) return basePricePerKg
  return Math.round((basePricePerKg * (100 - discountPercent)) / 100)
}
