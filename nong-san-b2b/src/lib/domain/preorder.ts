import { computeDepositAmount } from './settlement'

export interface PriceBandResult {
  inBand: boolean
  diffPercent: number
  minAllowed: number
  maxAllowed: number
}

/**
 * Kiểm tra xem đơn giá chốt vụ thực tế có nằm trong biên độ thỏa thuận hay không (Mục 3.10)
 * - Mặc định biên độ là ±10%
 * - R1: 70.000 -> 76.000 (10%): chênh lệch 8.57% -> Trong biên độ (inBand: true)
 * - R2: 70.000 -> 78.000 (10%): chênh lệch 11.43% -> Ngoài biên độ (inBand: false)
 * - Biên: 70.000 -> 77.000 (10%): chênh lệch 10.0% -> Trong biên độ (inBand: true)
 */
export function checkPriceBand(
  preorderPricePerKg: number,
  finalPricePerKg: number,
  bandPercent: number = 10
): PriceBandResult {
  if (preorderPricePerKg <= 0) {
    throw new Error('Đơn giá đặt trước phải lớn hơn 0')
  }

  const minAllowed = Math.round(preorderPricePerKg * (1 - bandPercent / 100))
  const maxAllowed = Math.round(preorderPricePerKg * (1 + bandPercent / 100))

  const rawDiff = ((finalPricePerKg - preorderPricePerKg) / preorderPricePerKg) * 100
  const diffPercent = Math.round(Math.abs(rawDiff) * 100) / 100

  const inBand = finalPricePerKg >= minAllowed && finalPricePerKg <= maxAllowed

  return {
    inBand,
    diffPercent,
    minAllowed,
    maxAllowed,
  }
}

export interface ShortfallRefundInput {
  depositAmount: number
  orderedGrams: number
  fulfilledGrams: number
}

/**
 * Tính số tiền cọc hoàn trả do sản lượng thu hoạch thiếu hụt (Mục 3.10)
 * - R3: cọc 3.000.000 đ, đặt 100kg (100.000g), giao 60kg (60.000g) -> hoàn 1.200.000 đ (40% cọc)
 * - Mất mùa 100% (giao 0g) -> hoàn 100% tiền cọc (3.000.000 đ)
 * - Thu hoạch đủ hoặc dư (giao >= đặt) -> không hoàn cọc (0 đ)
 */
export function computePreorderShortfallRefund({
  depositAmount,
  orderedGrams,
  fulfilledGrams,
}: ShortfallRefundInput): number {
  if (depositAmount <= 0 || orderedGrams <= 0) {
    return 0
  }

  if (fulfilledGrams >= orderedGrams) {
    return 0
  }

  if (fulfilledGrams <= 0) {
    return depositAmount
  }

  const shortfallGrams = orderedGrams - fulfilledGrams
  const refund = Math.round(depositAmount * (shortfallGrams / orderedGrams))

  return refund
}

export interface PreorderPricingInput {
  preorderPricePerKg: number
  groupDiscountPercent?: number
  packagingWeightGrams: number
  quantity: number
}

export interface PreorderPricingResult {
  discountedPricePerKg: number
  totalGrams: number
  lineTotal: number
  subtotal: number
  total: number
  depositAmount: number
}

/**
 * Tính toán đơn giá và tiền cọc đặt trước
 * - Áp dụng chiết khấu nhóm đối tác vào đơn giá đặt trước
 * - Tiền cọc bắt buộc là 30% tổng tiền (computeDepositAmount)
 */
export function calculatePreorderPricing({
  preorderPricePerKg,
  groupDiscountPercent = 0,
  packagingWeightGrams,
  quantity,
}: PreorderPricingInput): PreorderPricingResult {
  if (preorderPricePerKg <= 0) {
    throw new Error('Đơn giá đặt trước phải lớn hơn 0')
  }
  if (packagingWeightGrams <= 0 || quantity <= 0) {
    throw new Error('Quy cách đóng gói và số lượng phải lớn hơn 0')
  }

  const validDiscount = Math.max(0, Math.min(100, groupDiscountPercent))
  const discountedPricePerKg = Math.round(preorderPricePerKg * (1 - validDiscount / 100))
  const totalGrams = packagingWeightGrams * quantity
  const lineTotal = Math.round((discountedPricePerKg * totalGrams) / 1000)
  const subtotal = lineTotal
  const total = subtotal
  const depositAmount = computeDepositAmount(total)

  return {
    discountedPricePerKg,
    totalGrams,
    lineTotal,
    subtotal,
    total,
    depositAmount,
  }
}

export interface OutOfBandCancellationRefundInput {
  paidAmount: number
  shortfallRefundAmount?: number
}

/**
 * Tính tiền hoàn trả còn lại khi khách hàng từ chối giá chốt ngoài biên độ
 * - Khách được hoàn 100% số tiền đã đóng
 * - Tránh hoàn trùng (double refund) nếu trước đó đã tạo lệnh hoàn thiếu hụt sản lượng
 */
export function computeOutOfBandCancellationRefund({
  paidAmount,
  shortfallRefundAmount = 0,
}: OutOfBandCancellationRefundInput): number {
  if (paidAmount <= 0) {
    return 0
  }
  const remainingRefund = Math.max(0, paidAmount - shortfallRefundAmount)
  return remainingRefund
}
