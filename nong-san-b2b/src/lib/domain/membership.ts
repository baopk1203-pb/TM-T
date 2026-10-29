/**
 * Domain Logic: Quản lý hạng thành viên & chính sách ưu đãi (F04 — Membership Foundation)
 * Tuân thủ nghiêm ngặt các quyết định PO: PAR-10, PAR-11, PAR-12, PAR-13, PAR-14.
 */

export const MembershipTier = {
  BRONZE: 'BRONZE',
  SILVER: 'SILVER',
  GOLD: 'GOLD',
  DIAMOND: 'DIAMOND',
} as const

export type MembershipTier = (typeof MembershipTier)[keyof typeof MembershipTier]

export const MIN_MEMBERSHIP_SCORE = 0
export const MAX_MEMBERSHIP_SCORE = 100

/**
 * PAR-10: Trần tổng chiết khấu sản phẩm cộng dồn tối đa 10%
 * (chiết khấu nhóm khách hàng + chiết khấu hạng thành viên <= 10%)
 */
export const MAX_COMBINED_PRODUCT_DISCOUNT_PERCENT = 10

/**
 * PAR-14: Mức giảm phí vận chuyển tối đa 100.000 VND / đơn hàng
 */
export const MAX_MEMBERSHIP_SHIPPING_DISCOUNT_AMOUNT = 100_000

/**
 * PAR-15: Ngưỡng khối lượng đơn hàng tối thiểu (50 kg = 50.000 gram)
 * để được hưởng ưu đãi giảm phí vận chuyển theo hạng thành viên.
 */
export const MIN_ORDER_WEIGHT_GRAMS_FOR_SHIPPING_DISCOUNT = 50_000

export interface MembershipTierBenefits {
  tier: MembershipTier
  name: string
  minScore: number
  maxScore: number
  productDiscountPercent: number
  shippingDiscountPercent: number
}

/**
 * Bảng cấu hình 4 hạng thành viên theo quyết định PO:
 * - PAR-11: Thang điểm 0–100 (Đồng 0–39, Bạc 40–69, Vàng 70–89, Kim Cương 90–100)
 * - PAR-12: Chiết khấu sản phẩm (Đồng 2%, Bạc 3%, Vàng 4%, Kim Cương 5%)
 * - PAR-13: Giảm phí vận chuyển (Đồng 5%, Bạc 10%, Vàng 15%, Kim Cương 20%)
 */
export const MEMBERSHIP_TIER_CONFIG: Record<MembershipTier, MembershipTierBenefits> = {
  [MembershipTier.BRONZE]: {
    tier: MembershipTier.BRONZE,
    name: 'Đồng',
    minScore: 0,
    maxScore: 39,
    productDiscountPercent: 2,
    shippingDiscountPercent: 5,
  },
  [MembershipTier.SILVER]: {
    tier: MembershipTier.SILVER,
    name: 'Bạc',
    minScore: 40,
    maxScore: 69,
    productDiscountPercent: 3,
    shippingDiscountPercent: 10,
  },
  [MembershipTier.GOLD]: {
    tier: MembershipTier.GOLD,
    name: 'Vàng',
    minScore: 70,
    maxScore: 89,
    productDiscountPercent: 4,
    shippingDiscountPercent: 15,
  },
  [MembershipTier.DIAMOND]: {
    tier: MembershipTier.DIAMOND,
    name: 'Kim Cương',
    minScore: 90,
    maxScore: 100,
    productDiscountPercent: 5,
    shippingDiscountPercent: 20,
  },
}

export interface ScoreValidationResult {
  valid: boolean
  error?: string
}

/**
 * Kiểm tra tính hợp lệ của điểm xếp hạng thành viên:
 * - Phải là số hợp lệ, hữu hạn, không phải NaN.
 * - Phải nằm trong khoảng [0, 100].
 */
export function validateMembershipScore(score: unknown): ScoreValidationResult {
  if (typeof score !== 'number' || Number.isNaN(score) || !Number.isFinite(score)) {
    return {
      valid: false,
      error: 'Điểm xếp hạng phải là một số hợp lệ',
    }
  }

  if (score < MIN_MEMBERSHIP_SCORE) {
    return {
      valid: false,
      error: `Điểm xếp hạng không được nhỏ hơn ${MIN_MEMBERSHIP_SCORE}`,
    }
  }

  if (score > MAX_MEMBERSHIP_SCORE) {
    return {
      valid: false,
      error: `Điểm xếp hạng không được vượt quá ${MAX_MEMBERSHIP_SCORE}`,
    }
  }

  return {
    valid: true,
  }
}

/**
 * Xác định hạng thành viên dựa trên điểm chuẩn hóa (PAR-11):
 * - 0 .. 39: BRONZE
 * - 40 .. 69: SILVER
 * - 70 .. 89: GOLD
 * - 90 .. 100: DIAMOND
 */
export function getMembershipTierFromScore(score: number): MembershipTier {
  const validation = validateMembershipScore(score)
  if (!validation.valid) {
    throw new Error(validation.error || 'Điểm xếp hạng không hợp lệ')
  }

  if (score >= 90) return MembershipTier.DIAMOND
  if (score >= 70) return MembershipTier.GOLD
  if (score >= 40) return MembershipTier.SILVER
  return MembershipTier.BRONZE
}

/**
 * Tra cứu quyền lợi và chính sách ưu đãi của hạng thành viên (PAR-12, PAR-13)
 */
export function getMembershipBenefits(tier: MembershipTier): MembershipTierBenefits {
  const benefits = MEMBERSHIP_TIER_CONFIG[tier]
  if (!benefits) {
    throw new Error(`Hạng thành viên không hợp lệ: ${tier}`)
  }
  return benefits
}

/**
 * Tính tổng tỷ lệ chiết khấu sản phẩm cộng dồn (PAR-10):
 * - Cộng chiết khấu nhóm (CustomerGroup) và chiết khấu hạng thành viên.
 * - Khống chế trần tối đa không vượt quá MAX_COMBINED_PRODUCT_DISCOUNT_PERCENT (10%).
 */
export function calculateCombinedProductDiscount(
  groupDiscountPercent: number,
  tierDiscountPercent: number
): number {
  const safeGroup = Math.max(0, groupDiscountPercent || 0)
  const safeTier = Math.max(0, tierDiscountPercent || 0)
  return Math.min(MAX_COMBINED_PRODUCT_DISCOUNT_PERCENT, safeGroup + safeTier)
}

/**
 * Tính số tiền giảm giá vận chuyển theo hạng thành viên (PAR-13, PAR-14):
 * - Giảm theo % tương ứng của hạng trên cước gốc.
 * - Khống chế trần tối đa không vượt quá MAX_MEMBERSHIP_SHIPPING_DISCOUNT_AMOUNT (100.000 VND/đơn).
 */
export function calculateMembershipShippingDiscount(
  baseShippingFee: number,
  shippingDiscountPercent: number
): number {
  if (baseShippingFee <= 0 || shippingDiscountPercent <= 0) return 0
  const discountAmount = Math.round((baseShippingFee * shippingDiscountPercent) / 100)
  return Math.min(MAX_MEMBERSHIP_SHIPPING_DISCOUNT_AMOUNT, discountAmount)
}

export interface MembershipShippingBenefitResult {
  baseShippingFee: number
  membershipShippingDiscount: number
  finalShippingFee: number
  meetsWeightThreshold: boolean
  shippingDiscountPercent: number
}

/**
 * Tính toán đầy đủ quyền lợi phí vận chuyển theo hạng thành viên (PAR-13, PAR-14, PAR-15):
 * - Đơn hàng từ 50 kg (50.000 gram) trở lên mới được hưởng ưu đãi giảm phí ship.
 * - Mức giảm = min(round(baseShippingFee * tierPercent / 100), 100_000, baseShippingFee).
 * - Cước ship cuối = max(0, baseShippingFee - membershipShippingDiscount).
 * - Đảm bảo: cước không âm, không giảm quá cước gốc, không vượt 100.000 đ.
 */
export function calculateMembershipShippingBenefit(params: {
  baseShippingFee: number
  totalGrams: number
  tier?: MembershipTier | null
}): MembershipShippingBenefitResult {
  const baseShippingFee = Math.max(0, Math.round(params.baseShippingFee || 0))
  const totalGrams = Math.max(0, params.totalGrams || 0)
  const meetsWeightThreshold = totalGrams >= MIN_ORDER_WEIGHT_GRAMS_FOR_SHIPPING_DISCOUNT

  if (!params.tier || !meetsWeightThreshold || baseShippingFee <= 0) {
    const tierPercent = params.tier ? MEMBERSHIP_TIER_CONFIG[params.tier]?.shippingDiscountPercent ?? 0 : 0
    return {
      baseShippingFee,
      membershipShippingDiscount: 0,
      finalShippingFee: baseShippingFee,
      meetsWeightThreshold,
      shippingDiscountPercent: tierPercent,
    }
  }

  const benefits = MEMBERSHIP_TIER_CONFIG[params.tier]
  const shippingDiscountPercent = benefits?.shippingDiscountPercent ?? 0
  const nominalDiscount = Math.round((baseShippingFee * shippingDiscountPercent) / 100)
  const membershipShippingDiscount = Math.min(
    nominalDiscount,
    MAX_MEMBERSHIP_SHIPPING_DISCOUNT_AMOUNT,
    baseShippingFee
  )
  const finalShippingFee = Math.max(0, baseShippingFee - membershipShippingDiscount)

  return {
    baseShippingFee,
    membershipShippingDiscount,
    finalShippingFee,
    meetsWeightThreshold,
    shippingDiscountPercent,
  }
}

/**
 * Xác định hạng thành viên hiệu lực (Effective Membership Tier) an toàn và nhất quán:
 * - Nếu user đã có membershipTier hợp lệ trong DB (BRONZE, SILVER, GOLD, DIAMOND): sử dụng trực tiếp.
 * - Nếu user.membershipTier là null/undefined nhưng là khách hàng (Role.CUSTOMER):
 *   mặc định áp dụng BRONZE (Đồng) để bảo đảm quyền lợi nhất quán giữa Dashboard và Checkout (PO approved).
 * - Nếu user không phải CUSTOMER (ví dụ ADMIN): trả về null (không cấp quyền lợi Membership).
 */
export function resolveEffectiveMembershipTier(user?: {
  role?: string | null
  membershipTier?: MembershipTier | string | null
} | null): MembershipTier | null {
  if (!user) return null
  if (
    user.membershipTier &&
    Object.values(MembershipTier).includes(user.membershipTier as MembershipTier)
  ) {
    return user.membershipTier as MembershipTier
  }
  if (user.role === 'CUSTOMER') {
    return MembershipTier.BRONZE
  }
  return null
}
