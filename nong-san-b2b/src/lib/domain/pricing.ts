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

/**
 * Tìm bậc giá áp dụng dựa trên tổng khối lượng (gram)
 * Quy tắc: Bậc có minGrams lớn nhất thỏa mãn minGrams <= totalGrams
 */
export function findTier<T extends { minGrams: number; pricePerKg: number }>(
  tiers: T[],
  totalGrams: number
): T | undefined {
  if (!tiers || tiers.length === 0) return undefined
  const sorted = [...tiers].sort((a, b) => a.minGrams - b.minGrams)
  let matched: T | undefined = undefined
  for (const tier of sorted) {
    if (totalGrams >= tier.minGrams) {
      matched = tier
    } else {
      break
    }
  }
  return matched
}

export interface PriceTierData {
  id?: string
  minGrams: number
  pricePerKg: number
}

export interface PackagingData {
  id: string
  name: string
  weightGrams: number
  isSample: boolean
  samplePrice?: number | null
}

export interface ProductPricingData {
  id: string
  name: string
  moqGrams: number
  priceTiers: PriceTierData[]
  packagings: PackagingData[]
}

export interface CartLineItemInput {
  productId: string
  packagingId: string
  quantity: number
}

export interface NextTierInfo {
  minGrams: number
  pricePerKg: number
  missingGrams: number
}

export interface ProductSummary {
  productId: string
  productName: string
  totalGrams: number
  meetsMoq: boolean
  missingGramsForMoq: number
  basePricePerKg: number
  unitPricePerKg: number
  nextTier?: NextTierInfo
}

export interface PricedLineItem {
  productId: string
  packagingId: string
  productName: string
  packagingName: string
  quantity: number
  weightGrams: number
  totalGrams: number
  unitPricePerKg: number
  lineTotal: number
  isSample: false
}

export interface PricedSampleLineItem {
  productId: string
  packagingId: string
  productName: string
  packagingName: string
  quantity: number
  weightGrams: number
  samplePrice: number
  lineTotal: number
  isSample: true
}

export interface PriceCartInput {
  lines: CartLineItemInput[]
  products: ProductPricingData[]
  groupDiscountPercent: number
}

export interface PriceCartResult {
  productSummaries: ProductSummary[]
  lines: PricedLineItem[]
  sampleLines: PricedSampleLineItem[]
  subtotal: number
  errors: string[]
  isValid: boolean
}

/**
 * Tính toán toàn bộ giỏ hàng B2B theo công thức chuẩn:
 * - Nhóm các dòng theo sản phẩm
 * - Tách riêng hàng mẫu (isSample = true): không áp MOQ, không cộng dồn kg, không chiết khấu nhóm
 * - Các quy cách thường: cộng dồn tổng gram để xác định bậc giá
 * - Áp chiết khấu nhóm khách hàng lên đơn giá bậc: round(basePricePerKg * (100 - discount) / 100)
 * - Tính lineTotal cho từng dòng: round(unitPricePerKg * itemGrams / 1000)
 * - Xác định bậc tiếp theo (nextTier) để gợi ý mua thêm
 */
export function priceCart({
  lines,
  products,
  groupDiscountPercent,
}: PriceCartInput): PriceCartResult {
  const errors: string[] = []
  const productSummaries: ProductSummary[] = []
  const pricedLines: PricedLineItem[] = []
  const pricedSampleLines: PricedSampleLineItem[] = []
  let subtotal = 0

  const productMap = new Map<string, ProductPricingData>()
  for (const p of products) {
    productMap.set(p.id, p)
  }

  // Nhóm các dòng theo productId
  const linesByProduct = new Map<string, CartLineItemInput[]>()
  for (const line of lines) {
    if (line.quantity <= 0) continue
    const current = linesByProduct.get(line.productId) || []
    current.push(line)
    linesByProduct.set(line.productId, current)
  }

  for (const [productId, productLines] of linesByProduct.entries()) {
    const product = productMap.get(productId)
    if (!product) {
      errors.push(`Không tìm thấy thông tin sản phẩm (ID: ${productId})`)
      continue
    }

    const packagingMap = new Map<string, PackagingData>()
    for (const pkg of product.packagings) {
      packagingMap.set(pkg.id, pkg)
    }

    // Tách dòng thường và dòng mẫu
    const regularLines: { line: CartLineItemInput; pkg: PackagingData }[] = []
    const sampleLines: { line: CartLineItemInput; pkg: PackagingData }[] = []

    for (const item of productLines) {
      const pkg = packagingMap.get(item.packagingId)
      if (!pkg) {
        errors.push(
          `Không tìm thấy quy cách đóng gói (ID: ${item.packagingId}) của sản phẩm ${product.name}`
        )
        continue
      }
      if (pkg.isSample) {
        sampleLines.push({ line: item, pkg })
      } else {
        regularLines.push({ line: item, pkg })
      }
    }

    // Xử lý dòng mẫu
    for (const { line, pkg } of sampleLines) {
      const samplePrice = pkg.samplePrice || 0
      const lineTotal = line.quantity * samplePrice
      subtotal += lineTotal
      pricedSampleLines.push({
        productId: product.id,
        packagingId: pkg.id,
        productName: product.name,
        packagingName: pkg.name,
        quantity: line.quantity,
        weightGrams: pkg.weightGrams,
        samplePrice,
        lineTotal,
        isSample: true,
      })
    }

    // Xử lý dòng thường nếu có
    if (regularLines.length > 0) {
      const totalGrams = regularLines.reduce(
        (sum, { line, pkg }) => sum + line.quantity * pkg.weightGrams,
        0
      )

      const meetsMoq = totalGrams >= product.moqGrams
      const missingGramsForMoq = meetsMoq ? 0 : product.moqGrams - totalGrams

      if (!meetsMoq) {
        const missingKg = missingGramsForMoq / 1000
        errors.push(
          `Sản phẩm "${product.name}" chưa đạt mức đặt tối thiểu MOQ (${missingKg} kg còn thiếu)`
        )
      }

      // Sắp xếp các bậc giá tăng dần
      const sortedTiers = [...product.priceTiers].sort((a, b) => a.minGrams - b.minGrams)
      const matchedTier = findTier(sortedTiers, totalGrams)

      // Nếu chưa đạt MOQ hoặc chưa chạm bậc nào, dùng bậc thấp nhất làm tham chiếu giá
      const effectiveTier = matchedTier || sortedTiers[0]
      const basePricePerKg = effectiveTier?.pricePerKg || 0
      const unitPricePerKg = calculateCustomerUnitPrice(
        basePricePerKg,
        groupDiscountPercent
      )

      // Tìm bậc tiếp theo cao hơn totalGrams
      let nextTier: NextTierInfo | undefined = undefined
      const higherTiers = sortedTiers.filter((t) => t.minGrams > totalGrams)
      if (higherTiers.length > 0) {
        const next = higherTiers[0]
        nextTier = {
          minGrams: next.minGrams,
          pricePerKg: next.pricePerKg,
          missingGrams: next.minGrams - totalGrams,
        }
      }

      productSummaries.push({
        productId: product.id,
        productName: product.name,
        totalGrams,
        meetsMoq,
        missingGramsForMoq,
        basePricePerKg,
        unitPricePerKg,
        nextTier,
      })

      // Tính tiền từng dòng thường
      for (const { line, pkg } of regularLines) {
        const itemGrams = line.quantity * pkg.weightGrams
        const lineTotal = Math.round((unitPricePerKg * itemGrams) / 1000)
        subtotal += lineTotal

        pricedLines.push({
          productId: product.id,
          packagingId: pkg.id,
          productName: product.name,
          packagingName: pkg.name,
          quantity: line.quantity,
          weightGrams: pkg.weightGrams,
          totalGrams: itemGrams,
          unitPricePerKg,
          lineTotal,
          isSample: false,
        })
      }
    }
  }

  const isValid = errors.length === 0

  return {
    productSummaries,
    lines: pricedLines,
    sampleLines: pricedSampleLines,
    subtotal,
    errors,
    isValid,
  }
}

