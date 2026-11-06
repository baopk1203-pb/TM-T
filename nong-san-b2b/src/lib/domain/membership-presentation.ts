/**
 * Domain Logic: Định dạng và hiển thị thông tin thành viên (F04-04 — Membership Presentation)
 * Bắt buộc sử dụng 100% tiếng Việt trên giao diện người dùng theo chỉ thị PO.
 * - Tên hạng: Đồng, Bạc, Vàng, Kim Cương
 * - Quyền lợi chiết khấu và ưu đãi vận chuyển (PAR-10, PAR-12, PAR-13, PAR-14, PAR-15)
 * - Mốc xét hạng tiếp theo và thông báo bảo lưu 15 ngày cuối quý
 */

import { MembershipTier } from './membership'
import { getVietnamDateParts } from './delivery-date'
import {
  createVnDate,
  isRegistrationInCarryoverWindow,
  getQuarterDateRange,
} from './membership-evaluation'

export const VIETNAMESE_TIER_NAMES: Record<MembershipTier, string> = {
  [MembershipTier.BRONZE]: 'Đồng',
  [MembershipTier.SILVER]: 'Bạc',
  [MembershipTier.GOLD]: 'Vàng',
  [MembershipTier.DIAMOND]: 'Kim Cương',
}

export const TIER_BADGE_COLORS: Record<
  MembershipTier,
  { bg: string; text: string; border: string; badgeClass: string }
> = {
  [MembershipTier.BRONZE]: {
    bg: 'bg-amber-50',
    text: 'text-amber-900',
    border: 'border-amber-300',
    badgeClass: 'bg-amber-100 text-amber-900 border-amber-300',
  },
  [MembershipTier.SILVER]: {
    bg: 'bg-slate-50',
    text: 'text-slate-800',
    border: 'border-slate-300',
    badgeClass: 'bg-slate-100 text-slate-800 border-slate-300',
  },
  [MembershipTier.GOLD]: {
    bg: 'bg-yellow-50',
    text: 'text-yellow-800',
    border: 'border-yellow-300',
    badgeClass: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  },
  [MembershipTier.DIAMOND]: {
    bg: 'bg-cyan-50',
    text: 'text-cyan-900',
    border: 'border-cyan-300',
    badgeClass: 'bg-cyan-100 text-cyan-900 border-cyan-300',
  },
}

/**
 * Lấy tên hiển thị tiếng Việt của hạng thành viên
 */
export function getTierDisplayName(tier?: MembershipTier | null): string {
  if (!tier) return 'Đồng'
  return VIETNAMESE_TIER_NAMES[tier] || 'Đồng'
}

/**
 * Lấy nhãn trạng thái hạng (dùng cho trường hợp tài khoản chưa đánh giá kỳ nào)
 */
export function getTierStatusLabel(tier?: MembershipTier | null, hasEvaluations = false): string {
  if (!hasEvaluations && !tier) {
    return 'Đồng (Chờ kỳ xét hạng đầu tiên)'
  }
  return `Hạng ${getTierDisplayName(tier)}`
}

/**
 * Định dạng mã quý thành tên hiển thị tiếng Việt
 * Ví dụ: '2027-Q1' -> 'Quý I/2027'
 */
export function formatQuarterDisplayName(quarterCode: string): string {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarterCode.trim())
  if (!match) return quarterCode

  const year = match[1]
  const quarterNum = match[2]
  const romanMap: Record<string, string> = {
    '1': 'I',
    '2': 'II',
    '3': 'III',
    '4': 'IV',
  }
  return `Quý ${romanMap[quarterNum] || quarterNum}/${year}`
}

export interface TierBenefitRow {
  tier: MembershipTier
  name: string
  productDiscountPercent: number
  shippingDiscountPercent: number
  scoreRange: string
  isCurrent: boolean
}

/**
 * Lấy danh sách bảng chính sách quyền lợi 4 hạng thành viên theo quyết định PO
 */
export function getMembershipBenefitsTable(currentTier?: MembershipTier | null): TierBenefitRow[] {
  const effectiveTier = currentTier || MembershipTier.BRONZE

  return [
    {
      tier: MembershipTier.BRONZE,
      name: 'Đồng',
      productDiscountPercent: 2,
      shippingDiscountPercent: 5,
      scoreRange: '0 – 39 điểm',
      isCurrent: effectiveTier === MembershipTier.BRONZE,
    },
    {
      tier: MembershipTier.SILVER,
      name: 'Bạc',
      productDiscountPercent: 3,
      shippingDiscountPercent: 10,
      scoreRange: '40 – 69 điểm',
      isCurrent: effectiveTier === MembershipTier.SILVER,
    },
    {
      tier: MembershipTier.GOLD,
      name: 'Vàng',
      productDiscountPercent: 4,
      shippingDiscountPercent: 15,
      scoreRange: '70 – 89 điểm',
      isCurrent: effectiveTier === MembershipTier.GOLD,
    },
    {
      tier: MembershipTier.DIAMOND,
      name: 'Kim Cương',
      productDiscountPercent: 5,
      shippingDiscountPercent: 20,
      scoreRange: '90 – 100 điểm',
      isCurrent: effectiveTier === MembershipTier.DIAMOND,
    },
  ]
}

export interface NextEvaluationInfo {
  nextEvaluationDate: Date
  nextEvaluationDateText: string // dd/mm/yyyy
  quarterBeingEvaluated: string // Mã quý ví dụ 2027-Q1
  quarterBeingEvaluatedText: string // Tên quý ví dụ Quý I/2027
  isCarryoverUser: boolean
  carryoverMessage?: string
}

/**
 * Tính toán mốc xét hạng dự kiến tiếp theo và phát hiện trường hợp bảo lưu 15 ngày cuối quý
 */
export function getNextEvaluationSchedule(
  now: Date = new Date(),
  userCreatedAt?: Date | null,
  hasEvaluations = false
): NextEvaluationInfo {
  const nowParts = getVietnamDateParts(now)
  const currentMonth = nowParts.month
  const currentYear = nowParts.year

  // Các mốc xét hạng: 01/01, 01/04, 01/07, 01/10
  // Xác định mốc tiếp theo sắp diễn ra
  let nextEvalYear = currentYear
  let nextEvalMonth = 4 // Mặc định 01/04
  let targetQuarterCode = `${currentYear}-Q1`

  if (currentMonth >= 1 && currentMonth < 4) {
    nextEvalYear = currentYear
    nextEvalMonth = 4
    targetQuarterCode = `${currentYear}-Q1`
  } else if (currentMonth >= 4 && currentMonth < 7) {
    nextEvalYear = currentYear
    nextEvalMonth = 7
    targetQuarterCode = `${currentYear}-Q2`
  } else if (currentMonth >= 7 && currentMonth < 10) {
    nextEvalYear = currentYear
    nextEvalMonth = 10
    targetQuarterCode = `${currentYear}-Q3`
  } else {
    // Tháng 10, 11, 12 -> 01/01 năm sau
    nextEvalYear = currentYear + 1
    nextEvalMonth = 1
    targetQuarterCode = `${currentYear}-Q4`
  }

  let nextEvaluationDate = createVnDate(nextEvalYear, nextEvalMonth, 1, 0, 0, 0)

  // Kiểm tra điều kiện bảo lưu 15 ngày cuối quý của khách mới
  let isCarryoverUser = false
  let carryoverMessage: string | undefined = undefined

  if (userCreatedAt && !hasEvaluations) {
    const userParts = getVietnamDateParts(userCreatedAt)
    const userQuarter = Math.floor((userParts.month - 1) / 3) + 1
    const inWindow = isRegistrationInCarryoverWindow(userCreatedAt, userParts.year, userQuarter)

    if (inWindow) {
      isCarryoverUser = true
      const qRange = getQuarterDateRange(userParts.year, userQuarter)
      const qText = formatQuarterDisplayName(qRange.quarterCode)

      // Kỳ xét đầu tiên bị hoãn 1 quý
      // Ví dụ đăng ký 15 ngày cuối Q1 -> kỳ đầu tiên là 01/07 (xét cho Q2 + bảo lưu Q1)
      let deferredYear = nextEvalYear
      let deferredMonth = nextEvalMonth + 3
      if (deferredMonth > 12) {
        deferredYear++
        deferredMonth -= 12
      }
      nextEvaluationDate = createVnDate(deferredYear, deferredMonth, 1, 0, 0, 0)

      carryoverMessage = `Tài khoản của bạn đăng ký trong 15 ngày cuối ${qText}. Toàn bộ doanh số và sản lượng từ ngày đăng ký đến hết quý được bảo lưu sang kỳ đánh giá ngày 01/${String(deferredMonth).padStart(2, '0')}/${deferredYear} với hệ số ưu đãi ×1.2.`
    }
  }

  const nextParts = getVietnamDateParts(nextEvaluationDate)
  const nextDateText = `${String(nextParts.day).padStart(2, '0')}/${String(nextParts.month).padStart(2, '0')}/${nextParts.year}`

  return {
    nextEvaluationDate,
    nextEvaluationDateText: nextDateText,
    quarterBeingEvaluated: targetQuarterCode,
    quarterBeingEvaluatedText: formatQuarterDisplayName(targetQuarterCode),
    isCarryoverUser,
    carryoverMessage,
  }
}

export interface FormattedEvaluationHistoryItem {
  id: string
  quarterCode: string
  quarterName: string
  score: number
  previousTier: MembershipTier | null
  previousTierName: string
  newTier: MembershipTier
  newTierName: string
  evaluatedAt: Date
  evaluatedAtText: string
}

/**
 * Chuyển đổi bản ghi MembershipEvaluationLog thành cấu trúc hiển thị tiếng Việt an toàn
 */
export function formatEvaluationLogItem(log: {
  id: string
  evaluationQuarter: string
  score: number
  previousTier?: MembershipTier | null
  newTier: MembershipTier
  evaluatedAt: Date
}): FormattedEvaluationHistoryItem {
  const parts = getVietnamDateParts(log.evaluatedAt)
  const evaluatedAtText = `${String(parts.day).padStart(2, '0')}/${String(parts.month).padStart(2, '0')}/${parts.year}`

  return {
    id: log.id,
    quarterCode: log.evaluationQuarter,
    quarterName: formatQuarterDisplayName(log.evaluationQuarter),
    score: Math.round(log.score),
    previousTier: log.previousTier ?? null,
    previousTierName: log.previousTier ? getTierDisplayName(log.previousTier) : 'Khởi tạo',
    newTier: log.newTier,
    newTierName: getTierDisplayName(log.newTier),
    evaluatedAt: log.evaluatedAt,
    evaluatedAtText,
  }
}
