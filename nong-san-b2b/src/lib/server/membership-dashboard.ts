/**
 * Server Data Access: Membership Dashboard (F04-04)
 * Module đọc dữ liệu an toàn, chỉ đọc (Read-only), phân quyền chặt chẽ theo session.userId.
 * Tuyệt đối không nhận userId tùy ý từ client và không thực hiện bất kỳ thao tác ghi/sửa dữ liệu nào.
 */

import { db } from '@/lib/db'
import { MembershipTier } from '@/lib/domain/membership'
import {
  getTierDisplayName,
  getTierStatusLabel,
  TIER_BADGE_COLORS,
  getMembershipBenefitsTable,
  getNextEvaluationSchedule,
  formatEvaluationLogItem,
  FormattedEvaluationHistoryItem,
  TierBenefitRow,
  NextEvaluationInfo,
} from '@/lib/domain/membership-presentation'

export interface MembershipDashboardData {
  userId: string
  userName: string
  currentTier: MembershipTier | null
  tierDisplayName: string
  tierStatusLabel: string
  tierBadgeColor: string
  tierUpdatedAt: Date | null
  tierUpdatedAtText: string | null
  latestEvaluation: {
    score: number
    quarterName: string
    evaluatedAtText: string
  } | null
  nextEvaluation: NextEvaluationInfo
  benefitsTable: TierBenefitRow[]
  history: FormattedEvaluationHistoryItem[]
}

interface RawDbUser {
  id: string
  fullName: string
  createdAt: Date
  membershipTier?: MembershipTier | null
  tierUpdatedAt?: Date | null
}

interface RawEvaluationLog {
  id: string
  userId: string
  evaluationQuarter: string
  score: number
  previousTier?: MembershipTier | null
  newTier: MembershipTier
  evaluatedAt: Date
}

/**
 * Lấy toàn bộ dữ liệu hiển thị cho Membership Dashboard của một người dùng đã xác thực
 */
export async function getMembershipDashboardData(
  userId: string,
  now: Date = new Date()
): Promise<MembershipDashboardData | null> {
  if (!userId || typeof userId !== 'string') {
    return null
  }

  // 1. Truy vấn thông tin người dùng
  const user = (await (db.user as unknown as {
    findUnique: (args: { where: { id: string } }) => Promise<RawDbUser | null>
  }).findUnique({
    where: { id: userId },
  }))

  if (!user) {
    return null
  }

  // 2. Truy vấn lịch sử đánh giá sắp xếp theo thời gian mới nhất trước (kèm fallback an toàn)
  let rawLogs: RawEvaluationLog[] = []
  try {
    const delegate = (db as unknown as {
      membershipEvaluationLog?: {
        findMany: (args: {
          where: { userId: string }
          orderBy: { evaluatedAt: 'desc' }
        }) => Promise<RawEvaluationLog[]>
      }
    }).membershipEvaluationLog

    if (delegate && typeof delegate.findMany === 'function') {
      rawLogs = await delegate.findMany({
        where: { userId },
        orderBy: { evaluatedAt: 'desc' },
      })
    }
  } catch {
    // Fail-safe: Nếu bảng MembershipEvaluationLog chưa tồn tại trên DB chưa migrate, trả về mảng rỗng
    rawLogs = []
  }

  const history = rawLogs.map(formatEvaluationLogItem)

  // 3. Thông tin kỳ đánh giá gần nhất (nếu đã có lịch sử)
  let latestEvaluation: MembershipDashboardData['latestEvaluation'] = null
  if (history.length > 0) {
    const latest = history[0]
    latestEvaluation = {
      score: latest.score,
      quarterName: latest.quarterName,
      evaluatedAtText: latest.evaluatedAtText,
    }
  }

  // 4. Mốc đánh giá tiếp theo và bảo lưu 15 ngày
  const hasEvaluations = history.length > 0
  const nextEvaluation = getNextEvaluationSchedule(now, user.createdAt, hasEvaluations)

  // 5. Bảng quyền lợi
  const currentTier = user.membershipTier ?? null
  const benefitsTable = getMembershipBenefitsTable(currentTier)

  // 6. Nhãn và màu sắc
  const tierDisplayName = getTierDisplayName(currentTier)
  const tierStatusLabel = getTierStatusLabel(currentTier, hasEvaluations)
  const tierColors = TIER_BADGE_COLORS[currentTier || MembershipTier.BRONZE]

  let tierUpdatedAtText: string | null = null
  if (user.tierUpdatedAt) {
    const date = new Date(user.tierUpdatedAt)
    tierUpdatedAtText = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`
  }

  return {
    userId: user.id,
    userName: user.fullName,
    currentTier,
    tierDisplayName,
    tierStatusLabel,
    tierBadgeColor: tierColors.badgeClass,
    tierUpdatedAt: user.tierUpdatedAt ?? null,
    tierUpdatedAtText,
    latestEvaluation,
    nextEvaluation,
    benefitsTable,
    history,
  }
}
