/**
 * Cart Summary & Discount Display Utility (WEB-UX-SAMPLE)
 * Định dạng nhãn và thông tin chiết khấu giỏ hàng chuẩn xác theo cơ cấu sản phẩm (mẫu thử vs hàng sỉ)
 * và số tiền chiết khấu thực tế đã áp dụng trong báo giá (quote).
 * Hỗ trợ hiển thị phân rã chiết khấu nhóm đối tác và hạng thành viên F04 (CC-01).
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
  membershipDiscount?: number
  combinedDiscount?: number
  membershipTierName?: string
}

export interface CheckoutDiscountNoticeInput {
  userDiscount: number
  regularLineCount: number
  sampleLineCount: number
  actualSavings?: number
  membershipDiscount?: number
  combinedDiscount?: number
  membershipTierName?: string
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
 * - userDiscount <= 0 và membershipDiscount <= 0: 0%
 * - Giỏ chỉ có hàng mẫu: 0% kèm giải thích "Không áp dụng cho hàng mẫu"
 * - Khi actualSavings được cung cấp và bằng 0 (quote không thực tế giảm giá): 0% kèm giải thích rõ ràng
 * - Giỏ hỗn hợp (cả sỉ và mẫu) có chiết khấu: thông báo rõ phạm vi "Đã trừ X% cho hàng sỉ" kèm "Không áp dụng cho hàng mẫu"
 * - Giỏ chỉ có hàng sỉ: "Đã trừ X%"
 * - Khi có chiết khấu thành viên (F04 CC-01): hiển thị chiết khấu kết hợp và phân rã nhóm đối tác + hạng thành viên.
 */
export function getCartDiscountDisplay({
  userDiscount,
  regularLineCount,
  sampleLineCount,
  actualSavings,
  membershipDiscount,
  combinedDiscount,
  membershipTierName,
}: CartDiscountDisplayInput): CartDiscountDisplay {
  const hasMembership = typeof membershipDiscount === 'number' && membershipDiscount > 0
  const effectiveDiscount = hasMembership
    ? (combinedDiscount ?? Math.min(10, userDiscount + membershipDiscount))
    : userDiscount

  const label = hasMembership
    ? 'Ưu đãi đối tác & thành viên:'
    : 'Chiết khấu nhóm đối tác:'

  const isEmpty = regularLineCount === 0 && sampleLineCount === 0

  if (isEmpty || effectiveDiscount <= 0) {
    return {
      label,
      text: '0%',
    }
  }

  const hasOnlySamples = sampleLineCount > 0 && regularLineCount === 0
  const hasMixed = sampleLineCount > 0 && regularLineCount > 0

  if (hasOnlySamples) {
    return {
      label,
      text: '0%',
      subtext: 'Không áp dụng cho hàng mẫu',
    }
  }

  // Nếu đã truyền actualSavings và thực tế không giảm được đồng nào
  if (actualSavings !== undefined && actualSavings <= 0) {
    return {
      label,
      text: '0%',
      subtext: hasMixed ? 'Không áp dụng cho hàng mẫu' : 'Chưa áp dụng giảm giá',
    }
  }

  const breakdownNote = hasMembership
    ? `Nhóm đối tác: -${userDiscount}% • Hạng ${membershipTierName || 'Thành viên'}: -${membershipDiscount}% (tối đa 10%)`
    : undefined

  if (hasMixed) {
    if (actualSavings !== undefined && actualSavings > 0) {
      return {
        label,
        text: `Đã trừ ${effectiveDiscount}% cho hàng sỉ`,
        subtext: hasMembership
          ? `${breakdownNote} • Không áp dụng cho hàng mẫu`
          : 'Không áp dụng cho hàng mẫu',
      }
    }

    return {
      label,
      text: `Đã trừ ${effectiveDiscount}%`,
      subtext: hasMembership
        ? `${breakdownNote} • Chỉ áp dụng cho hàng sỉ`
        : 'Chỉ áp dụng cho hàng sỉ',
    }
  }

  // Giỏ chỉ có hàng sỉ
  return {
    label,
    text: `Đã trừ ${effectiveDiscount}%`,
    subtext: breakdownNote,
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
  membershipDiscount,
  combinedDiscount,
  membershipTierName,
}: CheckoutDiscountNoticeInput): string {
  const hasMembership = typeof membershipDiscount === 'number' && membershipDiscount > 0
  const effectiveDiscount = hasMembership
    ? (combinedDiscount ?? Math.min(10, userDiscount + membershipDiscount))
    : userDiscount

  if (effectiveDiscount <= 0) return ''

  const hasOnlySamples = sampleLineCount > 0 && regularLineCount === 0
  const hasMixed = sampleLineCount > 0 && regularLineCount > 0

  if (hasOnlySamples) {
    return hasMembership
      ? ' • Đơn hàng mẫu không áp dụng ưu đãi đối tác & thành viên'
      : ' • Đơn hàng mẫu không áp dụng chiết khấu đối tác'
  }

  if (actualSavings !== undefined && actualSavings <= 0) {
    if (hasMixed) {
      return hasMembership
        ? ' • Đơn hàng mẫu không áp dụng ưu đãi đối tác & thành viên'
        : ' • Đơn hàng mẫu không áp dụng chiết khấu đối tác'
    }
    return ''
  }

  const breakdown = hasMembership
    ? ` (Nhóm: -${userDiscount}%, Hạng ${membershipTierName || 'Thành viên'}: -${membershipDiscount}%)`
    : ` (${userDiscount}%)`

  if (hasMixed) {
    return hasMembership
      ? ` • Ưu đãi kết hợp ${effectiveDiscount}%${breakdown} chỉ áp dụng cho hàng sỉ`
      : ` • Chiết khấu đối tác (${userDiscount}%) chỉ áp dụng cho hàng sỉ`
  }

  return hasMembership
    ? ` • Ưu đãi kết hợp ${effectiveDiscount}%${breakdown} đã được áp dụng tự động`
    : ` • Chiết khấu đối tác (${userDiscount}%) đã được áp dụng tự động`
}
