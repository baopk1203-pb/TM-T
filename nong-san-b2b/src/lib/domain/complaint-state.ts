/**
 * F02 — TWO-WAY COMPLAINTS & 48-HOUR SLA STATE MACHINE (PURE DOMAIN FUNCTIONS)
 *
 * Quản lý máy trạng thái khiếu nại hai chiều:
 * 1. Khách mở khiếu nại trong vòng 24h sau DELIVERED.
 * 2. Admin đưa ra đề xuất bồi thường (PROPOSED) với hạn phản hồi 48h (reviewDueAt).
 * 3. Khách phản hồi:
 *    - Đồng ý (CUSTOMER_ACCEPTED) -> Chờ quyết toán tài chính (Batch B2).
 *    - Yêu cầu phúc tra (UNDER_REVIEW) -> Tối đa 1 lần (reReviewCount = 0 -> 1).
 *    - Rút khiếu nại (WITHDRAWN).
 * 4. Admin phúc tra và gửi đề xuất cuối cùng (isFinalProposal = true) -> Hạn mới 48h.
 * 5. Quá hạn 48h (reviewDueAt <= now): từ chối phản hồi của khách, sẵn sàng cho job tự động rút.
 */

import { ComplaintStatus, ComplaintResolutionType, OrderStatus } from '@prisma/client'

export const COMPLAINT_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 giờ kể từ khi nhận hàng
export const PROPOSAL_REVIEW_WINDOW_MS = 48 * 60 * 60 * 1000 // 48 giờ phản hồi đề xuất
export const MAX_RE_REVIEW_COUNT = 1 // Phúc tra tối đa 1 lần duy nhất

export type ComplaintActor = 'CUSTOMER' | 'ADMIN' | 'SYSTEM'

export interface ComplaintStateSnapshot {
  id?: string
  status: ComplaintStatus
  reReviewCount: number
  isFinalProposal: boolean
  reviewDueAt?: Date | null
  proposedAt?: Date | null
  customerAcceptedAt?: Date | null
  autoClosedAt?: Date | null
  orderDeliveredAt?: Date | null
  orderStatus?: OrderStatus | string
}

export interface ComplaintTransitionResult {
  ok: boolean
  reason?: string
}

export interface ComplaintTransitionContext {
  now?: Date
  reason?: string
  proposalType?: ComplaintResolutionType
  proposalAmount?: number
  verifiedGrams?: number
  photosCount?: number
}

/**
 * Kiểm tra khiếu nại có đang trong trạng thái kích hoạt (chưa giải quyết xong) hay không.
 * Trong suốt thời gian này, doanh thu đơn hàng PHẢI bị đóng băng 100%.
 */
export function isActiveComplaintStatus(status: ComplaintStatus | string): boolean {
  return (
    status === ComplaintStatus.OPEN ||
    status === ComplaintStatus.PROPOSED ||
    status === ComplaintStatus.UNDER_REVIEW
  )
}

/**
 * Kiểm tra hạn mở khiếu nại 24h kể từ khi giao hàng thành công (DELIVERED).
 */
export function isComplaintSubmissionWindowValid(
  deliveredAt: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!deliveredAt) return false
  const deliveredDate = new Date(deliveredAt)
  const diffMs = now.getTime() - deliveredDate.getTime()
  return diffMs >= 0 && diffMs < COMPLAINT_WINDOW_MS
}

/**
 * Tính hạn chót phản hồi đề xuất bồi thường (48 giờ từ thời điểm đề xuất).
 */
export function calculateReviewDeadline(proposedAt: Date = new Date()): Date {
  return new Date(proposedAt.getTime() + PROPOSAL_REVIEW_WINDOW_MS)
}

/**
 * Kiểm tra xem đề xuất bồi thường của Admin đã quá hạn 48 giờ hay chưa.
 */
export function isComplaintProposalExpired(
  reviewDueAt: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!reviewDueAt) return false
  const dueDate = new Date(reviewDueAt)
  return now.getTime() >= dueDate.getTime()
}

/**
 * Máy trạng thái chuyển đổi khiếu nại (Pure Function).
 * Đảm bảo tính toàn vẹn và bất biến của quy tắc nghiệp vụ F02.
 */
export function canTransitionComplaint(
  current: ComplaintStateSnapshot,
  toStatus: ComplaintStatus,
  actor: ComplaintActor,
  context?: ComplaintTransitionContext
): ComplaintTransitionResult {
  const now = context?.now ?? new Date()
  const fromStatus = current.status

  // 1. Không cho phép chuyển trạng thái nếu đã ở trạng thái kết thúc (Terminal states)
  if (
    fromStatus === ComplaintStatus.WITHDRAWN ||
    fromStatus === ComplaintStatus.RESOLVED ||
    fromStatus === ComplaintStatus.REJECTED
  ) {
    return {
      ok: false,
      reason: `Khiếu nại đã kết thúc ở trạng thái ${fromStatus}, không thể thay đổi nữa.`,
    }
  }

  // 2. Không được phép chuyển sang chính trạng thái hiện tại
  if (fromStatus === toStatus) {
    return {
      ok: false,
      reason: `Khiếu nại hiện đã ở trạng thái ${fromStatus}.`,
    }
  }

  switch (fromStatus) {
    case ComplaintStatus.OPEN: {
      // Admin đưa ra đề xuất bồi thường lần đầu (OPEN -> PROPOSED)
      if (toStatus === ComplaintStatus.PROPOSED) {
        if (actor !== 'ADMIN') {
          return { ok: false, reason: 'Chỉ Quản trị viên (Admin) mới có quyền đưa ra đề xuất bồi thường.' }
        }
        if (!context?.proposalType) {
          return { ok: false, reason: 'Bắt buộc phải chọn hình thức bồi thường (proposalType).' }
        }
        if (context.proposalType === ComplaintResolutionType.REFUND_MONEY) {
          if (context.proposalAmount === undefined || context.proposalAmount < 0) {
            return { ok: false, reason: 'Số tiền hoàn bồi thường không hợp lệ.' }
          }
        }
        return { ok: true }
      }

      // Khách tự rút khiếu nại khi đang mở (OPEN -> WITHDRAWN)
      if (toStatus === ComplaintStatus.WITHDRAWN) {
        if (actor !== 'CUSTOMER' && actor !== 'ADMIN') {
          return { ok: false, reason: 'Chỉ khách hàng sở hữu đơn hoặc Admin mới có quyền rút khiếu nại.' }
        }
        return { ok: true }
      }

      // Khóa luồng giải quyết đơn phương cũ
      if (toStatus === ComplaintStatus.RESOLVED || toStatus === ComplaintStatus.REJECTED) {
        return {
          ok: false,
          reason: 'Quy trình giải quyết đơn phương đã bị khóa. Vui lòng gửi đề xuất bồi thường (PROPOSED) để khách hàng phản hồi trong 48h.',
        }
      }

      return { ok: false, reason: `Không thể chuyển khiếu nại từ OPEN sang ${toStatus}.` }
    }

    case ComplaintStatus.PROPOSED: {
      // A. Khách hàng yêu cầu phúc tra (PROPOSED -> UNDER_REVIEW)
      if (toStatus === ComplaintStatus.UNDER_REVIEW) {
        if (actor !== 'CUSTOMER') {
          return { ok: false, reason: 'Chỉ khách hàng mới có quyền yêu cầu phúc tra.' }
        }
        // Kiểm tra hạn 48h
        if (isComplaintProposalExpired(current.reviewDueAt, now)) {
          return {
            ok: false,
            reason: 'Đã quá thời hạn 48 giờ để phản hồi đề xuất bồi thường.',
          }
        }
        // Kiểm tra cờ đề xuất cuối cùng
        if (current.isFinalProposal) {
          return {
            ok: false,
            reason: 'Đây là phương án bồi thường cuối cùng từ Ban Quản Trị, không thể yêu cầu phúc tra thêm.',
          }
        }
        // Kiểm tra số lần phúc tra (tối đa 1 lần)
        if (current.reReviewCount >= MAX_RE_REVIEW_COUNT) {
          return {
            ok: false,
            reason: `Mỗi khiếu nại chỉ được yêu cầu phúc tra tối đa ${MAX_RE_REVIEW_COUNT} lần.`,
          }
        }
        // Lý do phúc tra
        if (!context?.reason || context.reason.trim().length === 0) {
          return {
            ok: false,
            reason: 'Vui lòng cung cấp lý do yêu cầu phúc tra.',
          }
        }
        return { ok: true }
      }

      // B. Khách hàng chấp thuận đề xuất (PROPOSED -> CUSTOMER_ACCEPTED)
      if (toStatus === ComplaintStatus.CUSTOMER_ACCEPTED) {
        if (actor !== 'CUSTOMER') {
          return { ok: false, reason: 'Chỉ khách hàng mới có quyền chấp thuận đề xuất bồi thường.' }
        }
        // Kiểm tra hạn 48h
        if (isComplaintProposalExpired(current.reviewDueAt, now)) {
          return {
            ok: false,
            reason: 'Đã quá thời hạn 48 giờ để chấp thuận đề xuất bồi thường.',
          }
        }
        return { ok: true }
      }

      // C. Rút khiếu nại (PROPOSED -> WITHDRAWN)
      if (toStatus === ComplaintStatus.WITHDRAWN) {
        if (actor === 'CUSTOMER') {
          // Khách chủ động rút khi chưa hết hạn
          return { ok: true }
        }
        if (actor === 'SYSTEM' || actor === 'ADMIN') {
          // Hệ thống tự động rút khi quá hạn 48h
          if (!isComplaintProposalExpired(current.reviewDueAt, now)) {
            return {
              ok: false,
              reason: 'Chưa hết thời hạn 48 giờ phản hồi của khách hàng.',
            }
          }
          return { ok: true }
        }
        return { ok: false, reason: 'Tác tử không có quyền rút khiếu nại.' }
      }

      return { ok: false, reason: `Không thể chuyển khiếu nại từ PROPOSED sang ${toStatus}.` }
    }

    case ComplaintStatus.UNDER_REVIEW: {
      // Admin đưa ra đề xuất sau phúc tra (UNDER_REVIEW -> PROPOSED)
      if (toStatus === ComplaintStatus.PROPOSED) {
        if (actor !== 'ADMIN') {
          return { ok: false, reason: 'Chỉ Quản trị viên (Admin) mới có quyền đưa ra quyết định phúc tra.' }
        }
        if (!context?.proposalType) {
          return { ok: false, reason: 'Bắt buộc phải chọn hình thức bồi thường cho phương án phúc tra.' }
        }
        return { ok: true }
      }

      // Khách rút khiếu nại khi đang phúc tra (UNDER_REVIEW -> WITHDRAWN)
      if (toStatus === ComplaintStatus.WITHDRAWN) {
        if (actor !== 'CUSTOMER' && actor !== 'ADMIN') {
          return { ok: false, reason: 'Chỉ khách hàng hoặc Admin mới có quyền rút khiếu nại khi đang phúc tra.' }
        }
        return { ok: true }
      }

      return { ok: false, reason: `Không thể chuyển khiếu nại từ UNDER_REVIEW sang ${toStatus}.` }
    }

    case ComplaintStatus.CUSTOMER_ACCEPTED: {
      // Khi đã được khách chấp thuận, chỉ chuyển sang RESOLVED khi hoàn tất quyết toán (Batch B2)
      if (toStatus === ComplaintStatus.RESOLVED) {
        if (actor !== 'ADMIN' && actor !== 'SYSTEM') {
          return { ok: false, reason: 'Chỉ hệ thống quyết toán hoặc Admin mới có thể đánh dấu đã giải quyết.' }
        }
        return { ok: true }
      }
      return { ok: false, reason: `Không thể chuyển khiếu nại từ CUSTOMER_ACCEPTED sang ${toStatus}.` }
    }

    default:
      return { ok: false, reason: `Trạng thái khiếu nại không hợp lệ: ${fromStatus}` }
  }
}
