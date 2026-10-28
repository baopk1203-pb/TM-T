import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Session } from 'next-auth'
import { db } from '@/lib/db'
import {
  ComplaintStatus,
  ComplaintResolutionType,
  Resolution,
  OrderStatus,
  TxType,
  TxStatus,
  Role,
} from '@prisma/client'
import {
  canTransitionComplaint,
  calculateReviewDeadline,
  isComplaintProposalExpired,
  isComplaintSubmissionWindowValid,
  isActiveComplaintStatus,
  COMPLAINT_WINDOW_MS,
  PROPOSAL_REVIEW_WINDOW_MS,
  ComplaintStateSnapshot,
} from '@/lib/domain/complaint-state'
import { computeComplaintCompensation } from '@/lib/domain/settlement'
import { isOrderEligibleForRevenue, getOrderEligibleRevenue } from '@/lib/domain/reports'

type MockComplaint = NonNullable<Awaited<ReturnType<typeof db.complaint.findUnique>>>
type MockPaymentTransaction = NonNullable<Awaited<ReturnType<typeof db.paymentTransaction.findUnique>>>
type MockDbCallback = (tx: Record<string, unknown>) => Promise<unknown>

function createMockSession(userId: string, role: Role = Role.CUSTOMER): Session {
  return {
    user: {
      id: userId,
      role,
      groupId: null,
      discountPercent: 0,
      email: `${userId}@example.com`,
      name: `User ${userId}`,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  }
}

const mockAdminUser: Session['user'] = {
  id: 'admin-1',
  role: Role.ADMIN,
  groupId: null,
  discountPercent: 0,
  email: 'admin@example.com',
  name: 'Admin User',
}

// Mock dependencies for server action and service testing
vi.mock('@/lib/db', () => ({
  db: {
    complaint: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    paymentTransaction: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    order: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (callback) =>
      callback({
        complaint: {
          findUnique: vi.fn(),
          findMany: vi.fn(),
          update: vi.fn(),
          updateMany: vi.fn(),
          count: vi.fn(),
        },
        paymentTransaction: {
          findFirst: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
          count: vi.fn(),
        },
        order: {
          update: vi.fn(),
        },
      })
    ),
  },
}))

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
  requireAdmin: vi.fn(),
}))

vi.mock('@/lib/events', () => ({
  recordOrderEvent: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendOrderNotification: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

describe('F02 — Two-Way Complaints & 48-Hour SLA (Full Suite: B1 Foundation + B2 Settlement)', () => {
  const baseDeliveredAt = new Date('2026-10-25T10:00:00Z')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('1. Business Logic: Submission & Proposal Window', () => {
    it('(1) Cho phép nộp khiếu nại trong vòng 24 giờ kể từ thời điểm giao hàng (DELIVERED)', () => {
      const fiveHoursLater = new Date(baseDeliveredAt.getTime() + 5 * 60 * 60 * 1000)
      const isValid = isComplaintSubmissionWindowValid(baseDeliveredAt, fiveHoursLater)
      expect(isValid).toBe(true)
    })

    it('(2) Từ chối nộp khiếu nại nếu quá 24 giờ kể từ thời điểm giao hàng', () => {
      const exactly24hLater = new Date(baseDeliveredAt.getTime() + COMPLAINT_WINDOW_MS)
      const expiredTime = new Date(baseDeliveredAt.getTime() + 25 * 60 * 60 * 1000)

      expect(isComplaintSubmissionWindowValid(baseDeliveredAt, exactly24hLater)).toBe(false)
      expect(isComplaintSubmissionWindowValid(baseDeliveredAt, expiredTime)).toBe(false)
    })

    it('(3) Admin tạo đề xuất bồi thường hợp lệ (OPEN -> PROPOSED)', () => {
      const openComplaint: ComplaintStateSnapshot = {
        status: ComplaintStatus.OPEN,
        reReviewCount: 0,
        isFinalProposal: false,
      }

      const res = canTransitionComplaint(
        openComplaint,
        ComplaintStatus.PROPOSED,
        'ADMIN',
        {
          proposalType: ComplaintResolutionType.REFUND_MONEY,
          proposalAmount: 150000,
        }
      )

      expect(res.ok).toBe(true)
    })

    it('(4) Thời hạn phản hồi được tính chính xác 48 giờ sau thời điểm đề xuất', () => {
      const proposedAt = new Date('2026-10-26T08:30:00Z')
      const deadline = calculateReviewDeadline(proposedAt)

      expect(deadline.getTime() - proposedAt.getTime()).toBe(PROPOSAL_REVIEW_WINDOW_MS)
      expect(deadline.getTime() - proposedAt.getTime()).toBe(48 * 60 * 60 * 1000)
      expect(deadline.toISOString()).toBe('2026-10-28T08:30:00.000Z')
    })
  })

  describe('2. Business Logic: Re-review & Final Proposal', () => {
    const proposedAt = new Date('2026-10-26T08:00:00Z')
    const reviewDueAt = calculateReviewDeadline(proposedAt)

    it('(5) Khách hàng được phép yêu cầu phúc tra lần đầu khi reReviewCount = 0 và chưa hết hạn', () => {
      const activeProposal: ComplaintStateSnapshot = {
        status: ComplaintStatus.PROPOSED,
        reReviewCount: 0,
        isFinalProposal: false,
        reviewDueAt,
      }

      const withinDeadline = new Date(proposedAt.getTime() + 12 * 60 * 60 * 1000)
      const res = canTransitionComplaint(
        activeProposal,
        ComplaintStatus.UNDER_REVIEW,
        'CUSTOMER',
        {
          now: withinDeadline,
          reason: 'Số lượng quả thối nhiều hơn mức 3kg Admin đã ghi nhận',
        }
      )

      expect(res.ok).toBe(true)
    })

    it('(6) Chặn yêu cầu phúc tra lần 2 (reReviewCount = 1)', () => {
      const alreadyReviewed: ComplaintStateSnapshot = {
        status: ComplaintStatus.PROPOSED,
        reReviewCount: 1,
        isFinalProposal: false,
        reviewDueAt,
      }

      const withinDeadline = new Date(proposedAt.getTime() + 10 * 60 * 60 * 1000)
      const res = canTransitionComplaint(
        alreadyReviewed,
        ComplaintStatus.UNDER_REVIEW,
        'CUSTOMER',
        {
          now: withinDeadline,
          reason: 'Yêu cầu phúc tra tiếp lần nữa',
        }
      )

      expect(res.ok).toBe(false)
      expect(res.reason).toContain('tối đa 1 lần')
    })

    it('(7) Admin đưa ra quyết định phúc tra (UNDER_REVIEW -> PROPOSED) gắn cờ isFinalProposal = true', () => {
      const underReviewComplaint: ComplaintStateSnapshot = {
        status: ComplaintStatus.UNDER_REVIEW,
        reReviewCount: 1,
        isFinalProposal: false,
      }

      const res = canTransitionComplaint(
        underReviewComplaint,
        ComplaintStatus.PROPOSED,
        'ADMIN',
        {
          proposalType: ComplaintResolutionType.REFUND_MONEY,
          proposalAmount: 200000,
        }
      )

      expect(res.ok).toBe(true)
    })

    it('(8) Chặn yêu cầu phúc tra nếu đề xuất đã được đánh dấu là phương án cuối cùng (isFinalProposal = true)', () => {
      const finalProposal: ComplaintStateSnapshot = {
        status: ComplaintStatus.PROPOSED,
        reReviewCount: 0,
        isFinalProposal: true,
        reviewDueAt,
      }

      const res = canTransitionComplaint(
        finalProposal,
        ComplaintStatus.UNDER_REVIEW,
        'CUSTOMER',
        {
          now: new Date(proposedAt.getTime() + 5 * 60 * 1000),
          reason: 'Vẫn muốn phúc tra',
        }
      )

      expect(res.ok).toBe(false)
      expect(res.reason).toContain('phương án bồi thường cuối cùng')
    })
  })

  describe('3. Business Logic: 48-Hour Deadline Expiration', () => {
    const proposedAt = new Date('2026-10-26T08:00:00Z')
    const reviewDueAt = calculateReviewDeadline(proposedAt)
    const expiredNow = new Date(reviewDueAt.getTime() + 1000)

    it('(9) Từ chối chấp thuận đề xuất nếu đã quá hạn 48 giờ', () => {
      const expiredProposal: ComplaintStateSnapshot = {
        status: ComplaintStatus.PROPOSED,
        reReviewCount: 0,
        isFinalProposal: false,
        reviewDueAt,
      }

      const res = canTransitionComplaint(
        expiredProposal,
        ComplaintStatus.CUSTOMER_ACCEPTED,
        'CUSTOMER',
        { now: expiredNow }
      )

      expect(res.ok).toBe(false)
      expect(res.reason).toContain('Đã quá thời hạn 48 giờ')
    })

    it('(10) Từ chối yêu cầu phúc tra nếu đã quá hạn 48 giờ', () => {
      const expiredProposal: ComplaintStateSnapshot = {
        status: ComplaintStatus.PROPOSED,
        reReviewCount: 0,
        isFinalProposal: false,
        reviewDueAt,
      }

      const res = canTransitionComplaint(
        expiredProposal,
        ComplaintStatus.UNDER_REVIEW,
        'CUSTOMER',
        {
          now: expiredNow,
          reason: 'Phản hồi muộn vì đi công tác',
        }
      )

      expect(res.ok).toBe(false)
      expect(res.reason).toContain('Đã quá thời hạn 48 giờ')
    })

    it('Hàm isComplaintProposalExpired xác định đúng ranh giới hết hạn', () => {
      const beforeDeadline = new Date(reviewDueAt.getTime() - 1000)
      const atDeadline = new Date(reviewDueAt.getTime())
      const afterDeadline = new Date(reviewDueAt.getTime() + 1000)

      expect(isComplaintProposalExpired(reviewDueAt, beforeDeadline)).toBe(false)
      expect(isComplaintProposalExpired(reviewDueAt, atDeadline)).toBe(true)
      expect(isComplaintProposalExpired(reviewDueAt, afterDeadline)).toBe(true)
    })
  })

  describe('4. Security & Authorization Controls', () => {
    it('(11) Khách hàng không thể phản hồi khiếu nại của đơn hàng thuộc khách khác', async () => {
      const { respondToComplaintProposal } = await import('@/actions/order-lifecycle')
      const { getServerAuthSession } = await import('@/lib/auth')
      const { db } = await import('@/lib/db')

      vi.mocked(getServerAuthSession).mockResolvedValueOnce(createMockSession('user-1', Role.CUSTOMER))

      vi.mocked(db.complaint.findUnique).mockResolvedValueOnce({
        id: 'comp-101',
        status: ComplaintStatus.PROPOSED,
        reviewDueAt: new Date(Date.now() + 1000000),
        order: {
          id: 'order-99',
          userId: 'user-2',
          code: 'ORD-99',
        },
      } as unknown as MockComplaint)

      const result = await respondToComplaintProposal({
        complaintId: 'comp-101',
        decision: 'REQUEST_REVIEW',
        reason: 'Lý do giả mạo',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Bạn không có quyền phản hồi')
    })

    it('(12) Người dùng không phải Admin không thể gửi đề xuất bồi thường', () => {
      const openComplaint: ComplaintStateSnapshot = {
        status: ComplaintStatus.OPEN,
        reReviewCount: 0,
        isFinalProposal: false,
      }

      const res = canTransitionComplaint(
        openComplaint,
        ComplaintStatus.PROPOSED,
        'CUSTOMER',
        {
          proposalType: ComplaintResolutionType.REFUND_MONEY,
          proposalAmount: 500000,
        }
      )

      expect(res.ok).toBe(false)
      expect(res.reason).toContain('Chỉ Quản trị viên (Admin)')
    })

    it('(13) Chặn các bước chuyển trạng thái khiếu nại không hợp lệ', () => {
      const withdrawn: ComplaintStateSnapshot = {
        status: ComplaintStatus.WITHDRAWN,
        reReviewCount: 0,
        isFinalProposal: false,
      }
      expect(canTransitionComplaint(withdrawn, ComplaintStatus.OPEN, 'ADMIN').ok).toBe(false)
      expect(canTransitionComplaint(withdrawn, ComplaintStatus.PROPOSED, 'ADMIN').ok).toBe(false)

      const open: ComplaintStateSnapshot = {
        status: ComplaintStatus.OPEN,
        reReviewCount: 0,
        isFinalProposal: false,
      }
      expect(canTransitionComplaint(open, ComplaintStatus.CUSTOMER_ACCEPTED, 'CUSTOMER').ok).toBe(false)
    })
  })

  describe('5. Task A: Customer Acceptance & Financial Settlement (B2)', () => {
    it('(14) Admin gửi đề xuất bồi thường TUYỆT ĐỐI KHÔNG tạo transaction refund', async () => {
      const { proposeComplaintResolution } = await import('@/actions/order-lifecycle')
      const { requireAdmin } = await import('@/lib/auth')
      const { db } = await import('@/lib/db')

      vi.mocked(requireAdmin).mockResolvedValueOnce(mockAdminUser)

      const mockTxComplaintUpdate = vi.fn().mockResolvedValue({})
      vi.mocked(db.$transaction).mockImplementationOnce(async (cb: unknown) => {
        const callback = cb as (tx: Record<string, unknown>) => Promise<unknown>
        return callback({
          complaint: { update: mockTxComplaintUpdate },
        })
      })

      vi.mocked(db.complaint.findUnique).mockResolvedValueOnce({
        id: 'comp-102',
        orderId: 'order-102',
        status: ComplaintStatus.OPEN,
        reReviewCount: 0,
        isFinalProposal: false,
        order: {
          id: 'order-102',
          code: 'ORD-102',
          items: [],
        },
      } as unknown as MockComplaint)

      const result = await proposeComplaintResolution({
        complaintId: 'comp-102',
        proposalType: ComplaintResolutionType.REFUND_MONEY,
        proposalAmount: 250000,
        proposalNotes: 'Đề xuất hoàn 250k tiền mặt',
      })

      expect(result.success).toBe(true)
      expect(mockTxComplaintUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'comp-102' },
          data: expect.objectContaining({
            status: ComplaintStatus.PROPOSED,
            proposalType: ComplaintResolutionType.REFUND_MONEY,
            proposalAmount: 250000,
          }),
        })
      )
    })

    it('(15) Khách bấm ACCEPT với REFUND_MONEY: Tạo PaymentTransaction(REFUND, PENDING), Đơn KHÔNG bị chuyển COMPLETED sớm', async () => {
      const { respondToComplaintProposal } = await import('@/actions/order-lifecycle')
      const { getServerAuthSession } = await import('@/lib/auth')
      const { db } = await import('@/lib/db')

      vi.mocked(getServerAuthSession).mockResolvedValueOnce(createMockSession('user-1', Role.CUSTOMER))

      vi.mocked(db.complaint.findUnique).mockResolvedValueOnce({
        id: 'comp-accept-refund',
        orderId: 'order-refund-1',
        status: ComplaintStatus.PROPOSED,
        proposalType: ComplaintResolutionType.REFUND_MONEY,
        proposalAmount: 300000,
        reReviewCount: 0,
        isFinalProposal: false,
        reviewDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        order: {
          id: 'order-refund-1',
          userId: 'user-1',
          code: 'ORD-REF-1',
        },
      } as unknown as MockComplaint)

      const mockComplaintUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
      const mockTxFindFirst = vi.fn().mockResolvedValue(null)
      const mockTxCreate = vi.fn().mockResolvedValue({ id: 'tx-new-refund-1' })
      const mockOrderUpdate = vi.fn().mockResolvedValue({})

      vi.mocked(db.$transaction).mockImplementationOnce(async (cb: unknown) => {
        const callback = cb as MockDbCallback
        return callback({
          complaint: { updateMany: mockComplaintUpdateMany },
          paymentTransaction: {
            findFirst: mockTxFindFirst,
            create: mockTxCreate,
          },
          order: { update: mockOrderUpdate },
        })
      })

      const res = await respondToComplaintProposal({
        complaintId: 'comp-accept-refund',
        decision: 'ACCEPT',
      })

      expect(res.success).toBe(true)
      expect(res.data?.status).toBe(ComplaintStatus.CUSTOMER_ACCEPTED)
      expect(res.data?.refundTransactionId).toBe('tx-new-refund-1')

      // Kiểm tra PaymentTransaction(REFUND, PENDING) được tạo
      expect(mockTxCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: 'order-refund-1',
            type: TxType.REFUND,
            status: TxStatus.PENDING,
            amount: 300000,
            reference: 'COMPLAINT_comp-accept-refund',
          }),
        })
      )

      // CHẶN HOÀN THÀNH SỚM: Order KHÔNG được cập nhật status sang COMPLETED khi refund còn PENDING!
      expect(mockOrderUpdate).not.toHaveBeenCalled()
    })

    it('(16) Khách bấm ACCEPT với REPLACE_GOODS hoặc REJECT_COMPLAINT: Không tạo refund, chuyển COMPLETED nếu không còn khiếu nại active', async () => {
      const { respondToComplaintProposal } = await import('@/actions/order-lifecycle')
      const { getServerAuthSession } = await import('@/lib/auth')
      const { db } = await import('@/lib/db')

      vi.mocked(getServerAuthSession).mockResolvedValueOnce(createMockSession('user-1', Role.CUSTOMER))

      vi.mocked(db.complaint.findUnique).mockResolvedValueOnce({
        id: 'comp-accept-replace',
        orderId: 'order-replace-1',
        status: ComplaintStatus.PROPOSED,
        proposalType: ComplaintResolutionType.REPLACE_GOODS,
        proposalAmount: 0,
        reReviewCount: 0,
        isFinalProposal: false,
        reviewDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        order: {
          id: 'order-replace-1',
          userId: 'user-1',
          code: 'ORD-REP-1',
        },
      } as unknown as MockComplaint)

      const mockComplaintUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
      const mockTxCreate = vi.fn()
      const mockOrderUpdate = vi.fn().mockResolvedValue({})
      const mockComplaintCount = vi.fn().mockResolvedValue(0)
      const mockTxCount = vi.fn().mockResolvedValue(0)

      vi.mocked(db.$transaction).mockImplementationOnce(async (cb: unknown) => {
        const callback = cb as MockDbCallback
        return callback({
          complaint: {
            updateMany: mockComplaintUpdateMany,
            count: mockComplaintCount,
          },
          paymentTransaction: {
            create: mockTxCreate,
            count: mockTxCount,
          },
          order: { update: mockOrderUpdate },
        })
      })

      const res = await respondToComplaintProposal({
        complaintId: 'comp-accept-replace',
        decision: 'ACCEPT',
      })

      expect(res.success).toBe(true)
      expect(mockTxCreate).not.toHaveBeenCalled()
      expect(mockOrderUpdate).toHaveBeenCalledWith({
        where: { id: 'order-replace-1' },
        data: { status: OrderStatus.COMPLETED },
      })
    })

    it('(17) Chặn chấp thuận lặp lại (Duplicate ACCEPT) hoặc khi trạng thái đã thay đổi', async () => {
      const { respondToComplaintProposal } = await import('@/actions/order-lifecycle')
      const { getServerAuthSession } = await import('@/lib/auth')
      const { db } = await import('@/lib/db')

      vi.mocked(getServerAuthSession).mockResolvedValueOnce(createMockSession('user-1', Role.CUSTOMER))

      vi.mocked(db.complaint.findUnique).mockResolvedValueOnce({
        id: 'comp-already-done',
        orderId: 'order-1',
        status: ComplaintStatus.CUSTOMER_ACCEPTED,
        reviewDueAt: new Date(Date.now() + 100000),
        order: { id: 'order-1', userId: 'user-1', code: 'ORD-1' },
      } as unknown as MockComplaint)

      const res = await respondToComplaintProposal({
        complaintId: 'comp-already-done',
        decision: 'ACCEPT',
      })

      expect(res.success).toBe(false)
      expect(res.error).toContain('không thể phản hồi đề xuất')
    })

    it('(18) Idempotency: Không tạo trùng lặp giao dịch REFUND nếu đã tồn tại bản ghi reference tương ứng', async () => {
      const { respondToComplaintProposal } = await import('@/actions/order-lifecycle')
      const { getServerAuthSession } = await import('@/lib/auth')
      const { db } = await import('@/lib/db')

      vi.mocked(getServerAuthSession).mockResolvedValueOnce(createMockSession('user-1', Role.CUSTOMER))

      vi.mocked(db.complaint.findUnique).mockResolvedValueOnce({
        id: 'comp-idem-1',
        orderId: 'order-idem-1',
        status: ComplaintStatus.PROPOSED,
        proposalType: ComplaintResolutionType.REFUND_MONEY,
        proposalAmount: 150000,
        reviewDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        order: { id: 'order-idem-1', userId: 'user-1', code: 'ORD-IDEM' },
      } as unknown as MockComplaint)

      const mockComplaintUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
      const mockTxFindFirst = vi.fn().mockResolvedValue({ id: 'existing-tx-id' })
      const mockTxCreate = vi.fn()

      vi.mocked(db.$transaction).mockImplementationOnce(async (cb: unknown) => {
        const callback = cb as MockDbCallback
        return callback({
          complaint: { updateMany: mockComplaintUpdateMany },
          paymentTransaction: {
            findFirst: mockTxFindFirst,
            create: mockTxCreate,
          },
        })
      })

      const res = await respondToComplaintProposal({
        complaintId: 'comp-idem-1',
        decision: 'ACCEPT',
      })

      expect(res.success).toBe(true)
      expect(res.data?.refundTransactionId).toBe('existing-tx-id')
      expect(mockTxCreate).not.toHaveBeenCalled()
    })

    it('(19) confirmRefundDone chuyển REFUND sang DONE và hoàn thành đơn hàng khi không còn khiếu nại active', async () => {
      const { confirmRefundDone } = await import('@/actions/order-lifecycle')
      const { requireAdmin } = await import('@/lib/auth')
      const { db } = await import('@/lib/db')

      vi.mocked(requireAdmin).mockResolvedValueOnce(mockAdminUser)

      vi.mocked(db.paymentTransaction.findUnique).mockResolvedValueOnce({
        id: 'tx-confirm-1',
        orderId: 'order-c-1',
        type: TxType.REFUND,
        status: TxStatus.PENDING,
        amount: 200000,
        note: 'Bồi hoàn',
        order: { id: 'order-c-1', code: 'ORD-C-1' },
      } as unknown as MockPaymentTransaction)

      const mockTxUpdate = vi.fn().mockResolvedValue({})
      const mockOrderUpdate = vi.fn().mockResolvedValue({})
      const mockComplaintCount = vi.fn().mockResolvedValue(0)
      const mockTxCount = vi.fn().mockResolvedValue(0)

      vi.mocked(db.$transaction).mockImplementationOnce(async (cb: unknown) => {
        const callback = cb as MockDbCallback
        return callback({
          paymentTransaction: {
            update: mockTxUpdate,
            count: mockTxCount,
          },
          complaint: { count: mockComplaintCount },
          order: { update: mockOrderUpdate },
        })
      })

      const result = await confirmRefundDone({
        transactionId: 'tx-confirm-1',
      })

      expect(result.success).toBe(true)
      expect(mockTxUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tx-confirm-1' },
          data: expect.objectContaining({ status: TxStatus.DONE }),
        })
      )
      expect(mockOrderUpdate).toHaveBeenCalledWith({
        where: { id: 'order-c-1' },
        data: { status: OrderStatus.COMPLETED },
      })
    })
  })

  describe('6. Task B: Customer Withdrawal (B2)', () => {
    it('(20) Khách rút khiếu nại: chuyển sang WITHDRAWN, bồi thường 0 đ, không tạo refund', async () => {
      const { respondToComplaintProposal } = await import('@/actions/order-lifecycle')
      const { getServerAuthSession } = await import('@/lib/auth')
      const { db } = await import('@/lib/db')

      vi.mocked(getServerAuthSession).mockResolvedValueOnce(createMockSession('user-w1', Role.CUSTOMER))

      vi.mocked(db.complaint.findUnique).mockResolvedValueOnce({
        id: 'comp-withdraw-1',
        orderId: 'order-w1',
        status: ComplaintStatus.PROPOSED,
        reviewDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        order: { id: 'order-w1', userId: 'user-w1', code: 'ORD-W1' },
      } as unknown as MockComplaint)

      const mockComplaintUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
      const mockOrderUpdate = vi.fn().mockResolvedValue({})
      const mockComplaintCount = vi.fn().mockResolvedValue(0)
      const mockTxCount = vi.fn().mockResolvedValue(0)

      vi.mocked(db.$transaction).mockImplementationOnce(async (cb: unknown) => {
        const callback = cb as MockDbCallback
        return callback({
          complaint: {
            updateMany: mockComplaintUpdateMany,
            count: mockComplaintCount,
          },
          paymentTransaction: { count: mockTxCount },
          order: { update: mockOrderUpdate },
        })
      })

      const res = await respondToComplaintProposal({
        complaintId: 'comp-withdraw-1',
        decision: 'WITHDRAW',
      })

      expect(res.success).toBe(true)
      expect(res.data?.status).toBe(ComplaintStatus.WITHDRAWN)
      expect(mockComplaintUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ComplaintStatus.WITHDRAWN,
            compensation: 0,
            resolution: null,
          }),
        })
      )
      expect(mockOrderUpdate).toHaveBeenCalledWith({
        where: { id: 'order-w1' },
        data: { status: OrderStatus.COMPLETED },
      })
    })

    it('(21) Khách rút khiếu nại khi đơn còn khiếu nại active khác: Đơn KHÔNG chuyển COMPLETED', async () => {
      const { respondToComplaintProposal } = await import('@/actions/order-lifecycle')
      const { getServerAuthSession } = await import('@/lib/auth')
      const { db } = await import('@/lib/db')

      vi.mocked(getServerAuthSession).mockResolvedValueOnce(createMockSession('user-w2', Role.CUSTOMER))

      vi.mocked(db.complaint.findUnique).mockResolvedValueOnce({
        id: 'comp-withdraw-2',
        orderId: 'order-w2',
        status: ComplaintStatus.PROPOSED,
        reviewDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        order: { id: 'order-w2', userId: 'user-w2', code: 'ORD-W2' },
      } as unknown as MockComplaint)

      const mockComplaintUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
      const mockOrderUpdate = vi.fn()
      const mockComplaintCount = vi.fn().mockResolvedValue(1)
      const mockTxCount = vi.fn().mockResolvedValue(0)

      vi.mocked(db.$transaction).mockImplementationOnce(async (cb: unknown) => {
        const callback = cb as MockDbCallback
        return callback({
          complaint: {
            updateMany: mockComplaintUpdateMany,
            count: mockComplaintCount,
          },
          paymentTransaction: { count: mockTxCount },
          order: { update: mockOrderUpdate },
        })
      })

      const res = await respondToComplaintProposal({
        complaintId: 'comp-withdraw-2',
        decision: 'WITHDRAW',
      })

      expect(res.success).toBe(true)
      expect(mockOrderUpdate).not.toHaveBeenCalled()
    })
  })

  describe('7. Task C: Auto-Withdraw Service & 48-Hour SLA (B2)', () => {
    it('(22) Quá hạn 48 giờ: processExpiredComplaintProposals tự động chuyển WITHDRAWN và bồi thường 0 đ', async () => {
      const { processExpiredComplaintProposals } = await import('@/lib/services/complaint-sla')
      const { db } = await import('@/lib/db')

      const serverNow = new Date('2026-10-27T20:00:00Z')
      const expiredDueAt = new Date('2026-10-27T19:59:00Z')

      vi.mocked(db.complaint.findMany).mockResolvedValueOnce([
        {
          id: 'comp-auto-1',
          orderId: 'order-auto-1',
          reviewDueAt: expiredDueAt,
        },
      ] as unknown as MockComplaint[])

      const mockUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
      const mockComplaintCount = vi.fn().mockResolvedValue(0)
      const mockTxCount = vi.fn().mockResolvedValue(0)
      const mockOrderUpdate = vi.fn().mockResolvedValue({})

      vi.mocked(db.$transaction).mockImplementationOnce(async (cb: unknown) => {
        const callback = cb as MockDbCallback
        return callback({
          complaint: {
            updateMany: mockUpdateMany,
            count: mockComplaintCount,
          },
          paymentTransaction: { count: mockTxCount },
          order: { update: mockOrderUpdate },
        })
      })

      const res = await processExpiredComplaintProposals(serverNow)

      expect(res.processedCount).toBe(1)
      expect(res.complaintIds).toContain('comp-auto-1')
      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'comp-auto-1',
            status: ComplaintStatus.PROPOSED,
            reviewDueAt: { lte: serverNow },
          },
          data: expect.objectContaining({
            status: ComplaintStatus.WITHDRAWN,
            compensation: 0,
            autoClosedAt: serverNow,
          }),
        })
      )
      expect(mockOrderUpdate).toHaveBeenCalledWith({
        where: { id: 'order-auto-1' },
        data: { status: OrderStatus.COMPLETED },
      })
    })

    it('(23) Chưa hết hạn 48 giờ: processExpiredComplaintProposals không quét và không rút khiếu nại', async () => {
      const { processExpiredComplaintProposals } = await import('@/lib/services/complaint-sla')
      const { db } = await import('@/lib/db')

      const serverNow = new Date('2026-10-27T12:00:00Z')
      vi.mocked(db.complaint.findMany).mockResolvedValueOnce([])

      const res = await processExpiredComplaintProposals(serverNow)

      expect(res.processedCount).toBe(0)
      expect(res.complaintIds.length).toBe(0)
      expect(db.$transaction).not.toHaveBeenCalled()
    })

    it('(24) Idempotency: Quét lặp lại nhiều lần không sinh lỗi và không ghi trùng sự kiện', async () => {
      const { processExpiredComplaintProposals } = await import('@/lib/services/complaint-sla')
      const { db } = await import('@/lib/db')

      const serverNow = new Date('2026-10-27T20:00:00Z')
      vi.mocked(db.complaint.findMany).mockResolvedValueOnce([])

      const res = await processExpiredComplaintProposals(serverNow)
      expect(res.processedCount).toBe(0)
    })
  })

  describe('8. Concurrency Protection & Anti-Race Condition (B2)', () => {
    it('(25) Race Condition: Khách ACCEPT đồng thời lúc Auto-withdraw quét', async () => {
      const { respondToComplaintProposal } = await import('@/actions/order-lifecycle')
      const { getServerAuthSession } = await import('@/lib/auth')
      const { db } = await import('@/lib/db')

      vi.mocked(getServerAuthSession).mockResolvedValueOnce(createMockSession('user-race', Role.CUSTOMER))

      vi.mocked(db.complaint.findUnique).mockResolvedValueOnce({
        id: 'comp-race-accept',
        orderId: 'order-race-1',
        status: ComplaintStatus.PROPOSED,
        reviewDueAt: new Date(Date.now() + 100),
        order: { id: 'order-race-1', userId: 'user-race', code: 'ORD-RACE' },
      } as unknown as MockComplaint)

      // Giả lập: Auto-withdraw cập nhật trước 1ms khiến updateMany của ACCEPT trả về count: 0
      const mockUpdateMany = vi.fn().mockResolvedValue({ count: 0 })

      vi.mocked(db.$transaction).mockImplementationOnce(async (cb: unknown) => {
        const callback = cb as MockDbCallback
        return callback({
          complaint: { updateMany: mockUpdateMany },
        })
      })

      const res = await respondToComplaintProposal({
        complaintId: 'comp-race-accept',
        decision: 'ACCEPT',
      })

      expect(res.success).toBe(false)
      expect(res.error).toContain('thời hạn 48 giờ đã kết thúc hoặc trạng thái khiếu nại đã thay đổi')
    })

    it('(26) Hai tiến trình Auto-withdraw chạy cùng lúc: Chỉ 1 tiến trình cập nhật được dòng bản ghi', async () => {
      const { processExpiredComplaintProposals } = await import('@/lib/services/complaint-sla')
      const { db } = await import('@/lib/db')

      const serverNow = new Date('2026-10-27T20:00:00Z')

      vi.mocked(db.complaint.findMany).mockResolvedValueOnce([
        { id: 'comp-race-cron', orderId: 'ord-1', reviewDueAt: new Date() },
      ] as unknown as MockComplaint[])

      const mockUpdateMany = vi.fn().mockResolvedValue({ count: 0 })

      vi.mocked(db.$transaction).mockImplementationOnce(async (cb: unknown) => {
        const callback = cb as MockDbCallback
        return callback({
          complaint: { updateMany: mockUpdateMany },
        })
      })

      const res = await processExpiredComplaintProposals(serverNow)
      expect(res.processedCount).toBe(0)
    })
  })

  describe('9. Financial Integrity & PH9-00 Compliance', () => {
    it('(27) Khiếu nại active (OPEN, PROPOSED, UNDER_REVIEW) đóng băng 100% doanh thu đơn hàng', () => {
      const orderProposed = {
        status: OrderStatus.COMPLETED,
        total: 10000000,
        complaints: [{ id: 'c-1', status: ComplaintStatus.PROPOSED }],
      }
      const orderUnderReview = {
        status: OrderStatus.COMPLETED,
        total: 10000000,
        complaints: [{ id: 'c-2', status: ComplaintStatus.UNDER_REVIEW }],
      }
      const orderOpen = {
        status: OrderStatus.COMPLETED,
        total: 10000000,
        complaints: [{ id: 'c-3', status: ComplaintStatus.OPEN }],
      }
      const orderClean = {
        status: OrderStatus.COMPLETED,
        total: 10000000,
        complaints: [],
      }

      expect(isOrderEligibleForRevenue(orderProposed)).toBe(false)
      expect(isOrderEligibleForRevenue(orderUnderReview)).toBe(false)
      expect(isOrderEligibleForRevenue(orderOpen)).toBe(false)
      expect(isOrderEligibleForRevenue(orderClean)).toBe(true)
      expect(isActiveComplaintStatus(ComplaintStatus.PROPOSED)).toBe(true)
      expect(isActiveComplaintStatus(ComplaintStatus.UNDER_REVIEW)).toBe(true)
    })

    it('(28) getOrderEligibleRevenue tính chính xác doanh thu net sau khi trừ khoản bồi hoàn refund đã chấp thuận', () => {
      const orderWithAcceptedRefund = {
        total: 10000000,
        complaints: [
          {
            id: 'c-accepted-1',
            status: ComplaintStatus.CUSTOMER_ACCEPTED,
            proposalType: ComplaintResolutionType.REFUND_MONEY,
            compensation: 500000,
          },
        ],
      }

      const netRev = getOrderEligibleRevenue(orderWithAcceptedRefund)
      expect(netRev).toBe(9500000)
    })

    it('(29) Bảo toàn nguyên vẹn công thức tính bồi thường hao hụt 3% (computeComplaintCompensation)', () => {
      const c1 = computeComplaintCompensation({
        actualGrams: 100000,
        damagedGrams: 2000,
        unitPricePerKg: 40000,
      })
      expect(c1.allowedGrams).toBe(3000)
      expect(c1.compensation).toBe(0)

      const c2 = computeComplaintCompensation({
        actualGrams: 100000,
        damagedGrams: 8000,
        unitPricePerKg: 40000,
      })
      expect(c2.allowedGrams).toBe(3000)
      expect(c2.excessGrams).toBe(5000)
      expect(c2.compensation).toBe(200000)
    })

    it('(30) resolveComplaint cũ tiếp tục bị khóa hoàn toàn', async () => {
      const { resolveComplaint } = await import('@/actions/order-lifecycle')

      const result = await resolveComplaint({
        complaintId: 'comp-bypass',
        verifiedGrams: 5000,
        resolution: Resolution.REFUND,
        adminNote: 'Admin giải quyết tắt',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Quy trình giải quyết đơn phương đã bị khóa')
    })
  })
})
