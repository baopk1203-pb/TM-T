/**
 * Cart Summary & Discount Display Utility (WEB-UX-SAMPLE)
 * Định dạng nhãn và thông tin chiết khấu giỏ hàng chuẩn xác theo cơ cấu sản phẩm (mẫu thử vs hàng sỉ)
 * và số tiền chiết khấu thực tế đã áp dụng trong báo giá (quote).
 */

export interface CartDiscountDisplay {
  label: string
  text: string
  subtext?: string
}

export interface CartDiscountDisplayInput {
  userDiscount: number
  regularLineCount: number
  sampleLineCount: number
  actualSavings?: number
}

export interface CheckoutDiscountNoticeInput {
  userDiscount: number
  regularLineCount: number
  sampleLineCount: number
  actualSavings?: number
}

/**
 * Tính số tiền thực tế tiết kiệm được từ chiết khấu đối tác
 * So sánh thành tiền trước chiết khấu (theo basePricePerKg) và thành tiền thực tế (theo unitPricePerKg)
 */
export function calculateCartSavings(quote?: {
  lines?: { productId: string; totalGrams: number; lineTotal: number }[]
  productSummaries?: { productId: string; basePricePerKg: number }[]
}): number {
  if (!quote?.lines?.length || !quote?.productSummaries?.length) return 0

  const basePriceMap = new Map<string, number>()
  for (const s of quote.productSummaries) {
    basePriceMap.set(s.productId, s.basePricePerKg)
  }

  let rawTotal = 0
  let actualTotal = 0

  for (const line of quote.lines) {
    const basePrice = basePriceMap.get(line.productId) ?? 0
    rawTotal += Math.round((basePrice * line.totalGrams) / 1000)
    actualTotal += line.lineTotal
  }

  return Math.max(0, rawTotal - actualTotal)
}

/**
 * Xác định nội dung hiển thị chiết khấu đối tác cho giỏ hàng
 * - Giỏ rỗng: 0% (không nhầm là giỏ chỉ có hàng mẫu)
 * - userDiscount <= 0: 0%
 * - Giỏ chỉ có hàng mẫu: 0% kèm giải thích "Không áp dụng cho hàng mẫu"
 * - Khi actualSavings được cung cấp và bằng 0 (quote không thực tế giảm giá): 0% kèm giải thích rõ ràng
 * - Giỏ hỗn hợp (cả sỉ và mẫu) có chiết khấu: thông báo rõ phạm vi "Đã trừ X% cho hàng sỉ" kèm "Không áp dụng cho hàng mẫu"
 * - Giỏ chỉ có hàng sỉ: "Đã trừ X%"
 */
export function getCartDiscountDisplay({
  userDiscount,
  regularLineCount,
  sampleLineCount,
  actualSavings,
}: CartDiscountDisplayInput): CartDiscountDisplay {
  const isEmpty = regularLineCount === 0 && sampleLineCount === 0

  if (isEmpty || userDiscount <= 0) {
    return {
      label: 'Chiết khấu nhóm đối tác:',
      text: '0%',
    }
  }

  const hasOnlySamples = sampleLineCount > 0 && regularLineCount === 0
  const hasMixed = sampleLineCount > 0 && regularLineCount > 0

  if (hasOnlySamples) {
    return {
      label: 'Chiết khấu nhóm đối tác:',
      text: '0%',
      subtext: 'Không áp dụng cho hàng mẫu',
    }
  }

  // Nếu đã truyền actualSavings và thực tế không giảm được đồng nào
  if (actualSavings !== undefined && actualSavings <= 0) {
    return {
      label: 'Chiết khấu nhóm đối tác:',
      text: '0%',
      subtext: hasMixed ? 'Không áp dụng cho hàng mẫu' : 'Chưa áp dụng giảm giá',
    }
  }

  if (hasMixed) {
    if (actualSavings !== undefined && actualSavings > 0) {
      return {
        label: 'Chiết khấu nhóm đối tác:',
        text: `Đã trừ ${userDiscount}% cho hàng sỉ`,
        subtext: 'Không áp dụng cho hàng mẫu',
      }
    }

    return {
      label: 'Chiết khấu nhóm đối tác:',
      text: `Đã trừ ${userDiscount}%`,
      subtext: 'Chỉ áp dụng cho hàng sỉ',
    }
  }

  // Giỏ chỉ có hàng sỉ
  return {
    label: 'Chiết khấu nhóm đối tác:',
    text: `Đã trừ ${userDiscount}%`,
  }
}

/**
 * Định dạng thông điệp chiết khấu tại trang Checkout
 */
export function getCheckoutDiscountNotice({
  userDiscount,
  regularLineCount,
  sampleLineCount,
  actualSavings,
}: CheckoutDiscountNoticeInput): string {
  if (userDiscount <= 0) return ''

  const hasOnlySamples = sampleLineCount > 0 && regularLineCount === 0
  const hasMixed = sampleLineCount > 0 && regularLineCount > 0

  if (hasOnlySamples) {
    return ' • Đơn hàng mẫu không áp dụng chiết khấu đối tác'
  }

  if (actualSavings !== undefined && actualSavings <= 0) {
    if (hasMixed) {
      return ' • Đơn hàng mẫu không áp dụng chiết khấu đối tác'
    }
    return ''
  }

  if (hasMixed) {
    return ` • Chiết khấu đối tác (${userDiscount}%) chỉ áp dụng cho hàng sỉ`
  }

  return ` • Chiết khấu đối tác (${userDiscount}%) đã được áp dụng tự động`
}
