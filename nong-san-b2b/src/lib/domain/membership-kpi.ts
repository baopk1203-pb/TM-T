/**
 * Domain Logic: Model B — Balanced B2B Scorecard (F04 — Membership KPI Engine)
 * Tuân thủ bộ tham số đã được Product Owner phê duyệt chính thức.
 *
 * Bộ 4 trọng số Model B:
 * 1. Net Revenue (Doanh thu thuần): 40% (Benchmark: 80.000.000 VND/quý)
 * 2. Transaction Volume (Sản lượng giao dịch): 30% (Benchmark: 2.000 kg/quý)
 * 3. Purchase Frequency (Tần suất mua hàng): 20% (Benchmark: 8 tuần active/quý)
 * 4. Payment Reliability (Kỷ luật thanh toán): 10% (Điểm kỷ luật gốc: 100)
 *
 * Điểm kỷ luật:
 * - Hủy đơn do khách: -20 điểm/lần
 * - Quá hạn thanh toán do khách (10 phút): -10 điểm/lần
 * - disciplineScore = max(0, 100 - cancelledOrders * 20 - expiredPayments * 10)
 * - reliabilityScore = disciplineScore * 0.10
 *
 * Tổng điểm:
 * totalScore = Math.round(revenueScore + volumeScore + frequencyScore + reliabilityScore)
 * Giới hạn trong [0, 100].
 */

import { MembershipTier, getMembershipTierFromScore } from './membership'

export const BENCHMARK_NET_REVENUE_VND = 80_000_000
export const BENCHMARK_VOLUME_KG = 2_000
export const BENCHMARK_ACTIVE_WEEKS = 8

export const MAX_REVENUE_SCORE = 40
export const MAX_VOLUME_SCORE = 30
export const MAX_FREQUENCY_SCORE = 20
export const MAX_RELIABILITY_SCORE = 10

export const BASE_DISCIPLINE_SCORE = 100
export const PENALTY_CUSTOMER_CANCELLED_ORDER = 20
export const PENALTY_PAYMENT_EXPIRATION = 10

export interface QuarterlyKpiInput {
  netRevenueVnd: number
  eligibleVolumeKg: number
  activeWeeks: number
  customerCancelledOrders: number
  customerPaymentExpirations: number
}

export interface KpiValidationResult {
  valid: boolean
  error?: string
}

export interface QuarterlyKpiResult {
  revenueScore: number
  volumeScore: number
  frequencyScore: number
  disciplineScore: number
  reliabilityScore: number
  rawTotalScore: number
  totalScore: number
  tier: MembershipTier
}

/**
 * Kiểm tra tính toàn vẹn và hợp lệ của dữ liệu KPI đầu vào:
 * - Không cho phép null, undefined hoặc thiếu trường dữ liệu.
 * - Từ chối NaN, Infinity, -Infinity.
 * - Từ chối các giá trị âm (< 0).
 * - Doanh thu VND phải là số nguyên an toàn (safe integer).
 * - Số tuần active và số lần vi phạm phải là số nguyên không âm.
 */
export function validateKpiInput(input: unknown): KpiValidationResult {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'Dữ liệu đầu vào KPI phải là một đối tượng hợp lệ' }
  }

  const kpi = input as Record<string, unknown>

  const requiredFields = [
    'netRevenueVnd',
    'eligibleVolumeKg',
    'activeWeeks',
    'customerCancelledOrders',
    'customerPaymentExpirations',
  ]

  for (const field of requiredFields) {
    if (kpi[field] === undefined || kpi[field] === null) {
      return { valid: false, error: `Thiếu trường dữ liệu bắt buộc: ${field}` }
    }
    const val = kpi[field]
    if (typeof val !== 'number' || Number.isNaN(val) || !Number.isFinite(val)) {
      return { valid: false, error: `Trường ${field} phải là số hữu hạn hợp lệ` }
    }
    if (val < 0) {
      return { valid: false, error: `Trường ${field} không được là số âm` }
    }
  }

  const netRevenue = kpi.netRevenueVnd as number
  if (!Number.isSafeInteger(netRevenue)) {
    return { valid: false, error: 'Doanh thu thuần netRevenueVnd phải là số nguyên an toàn' }
  }

  const activeWeeks = kpi.activeWeeks as number
  if (!Number.isInteger(activeWeeks)) {
    return { valid: false, error: 'Số tuần activeWeeks phải là số nguyên' }
  }

  const cancelled = kpi.customerCancelledOrders as number
  if (!Number.isInteger(cancelled)) {
    return { valid: false, error: 'Số đơn khách hủy customerCancelledOrders phải là số nguyên' }
  }

  const expired = kpi.customerPaymentExpirations as number
  if (!Number.isInteger(expired)) {
    return { valid: false, error: 'Số đơn quá hạn thanh toán customerPaymentExpirations phải là số nguyên' }
  }

  return { valid: true }
}

/**
 * Tính điểm Doanh thu thuần (Trọng số 40%):
 * revenueScore = 40 * min(1, netRevenue / 80_000_000)
 */
export function calculateRevenueScore(netRevenueVnd: number): number {
  if (netRevenueVnd <= 0) return 0
  const ratio = Math.min(1, netRevenueVnd / BENCHMARK_NET_REVENUE_VND)
  return MAX_REVENUE_SCORE * ratio
}

/**
 * Tính điểm Sản lượng giao dịch (Trọng số 30%):
 * volumeScore = 30 * min(1, eligibleVolumeKg / 2_000)
 */
export function calculateVolumeScore(eligibleVolumeKg: number): number {
  if (eligibleVolumeKg <= 0) return 0
  const ratio = Math.min(1, eligibleVolumeKg / BENCHMARK_VOLUME_KG)
  return MAX_VOLUME_SCORE * ratio
}

/**
 * Tính điểm Tần suất mua hàng (Trọng số 20%):
 * frequencyScore = 20 * min(1, activeWeeks / 8)
 */
export function calculateFrequencyScore(activeWeeks: number): number {
  if (activeWeeks <= 0) return 0
  const ratio = Math.min(1, activeWeeks / BENCHMARK_ACTIVE_WEEKS)
  return MAX_FREQUENCY_SCORE * ratio
}

/**
 * Tính Điểm kỷ luật thanh toán (Thang điểm gốc 100, không âm):
 * disciplineScore = max(0, 100 - cancelledOrders * 20 - expiredPayments * 10)
 */
export function calculateDisciplineScore(
  customerCancelledOrders: number,
  customerPaymentExpirations: number
): number {
  const penalty =
    customerCancelledOrders * PENALTY_CUSTOMER_CANCELLED_ORDER +
    customerPaymentExpirations * PENALTY_PAYMENT_EXPIRATION
  return Math.max(0, BASE_DISCIPLINE_SCORE - penalty)
}

/**
 * Tính điểm Độ tin cậy thanh toán (Trọng số 10%):
 * reliabilityScore = disciplineScore * 0.10
 */
export function calculateReliabilityScore(disciplineScore: number): number {
  return disciplineScore * (MAX_RELIABILITY_SCORE / BASE_DISCIPLINE_SCORE)
}

/**
 * Tính toán toàn diện Thẻ điểm cân bằng Model B (Balanced B2B Scorecard):
 * - Hàm thuần (pure function), không đọc ghi database, không side effects.
 * - Không tự ý áp hệ số khách hàng mới (chờ PO phê duyệt quy tắc cụ thể ở F04-03).
 */
export function calculateQuarterlyKpi(input: QuarterlyKpiInput): QuarterlyKpiResult {
  const validation = validateKpiInput(input)
  if (!validation.valid) {
    throw new Error(validation.error || 'Dữ liệu đầu vào KPI không hợp lệ')
  }

  const revenueScore = calculateRevenueScore(input.netRevenueVnd)
  const volumeScore = calculateVolumeScore(input.eligibleVolumeKg)
  const frequencyScore = calculateFrequencyScore(input.activeWeeks)
  const disciplineScore = calculateDisciplineScore(
    input.customerCancelledOrders,
    input.customerPaymentExpirations
  )
  const reliabilityScore = calculateReliabilityScore(disciplineScore)

  const rawTotalScore = revenueScore + volumeScore + frequencyScore + reliabilityScore
  const totalScore = Math.min(100, Math.max(0, Math.round(rawTotalScore)))

  const tier = getMembershipTierFromScore(totalScore)

  return {
    revenueScore,
    volumeScore,
    frequencyScore,
    disciplineScore,
    reliabilityScore,
    rawTotalScore,
    totalScore,
    tier,
  }
}

/**
 * Quy đổi hạng thành viên trực tiếp từ điểm tổng kết Model B
 */
export function resolveMembershipTierFromKpi(totalScore: number): MembershipTier {
  return getMembershipTierFromScore(totalScore)
}
