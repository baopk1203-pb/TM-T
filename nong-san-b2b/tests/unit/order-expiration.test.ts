import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processExpiredOrders } from '@/lib/services/order-expiration'
import { expireOrdersJob } from '@/actions/admin-order'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { recordOrderEvent } from '@/lib/events'
import { OrderStatus, TxType, TxStatus, Role } from '@prisma/client'

vi.mock('@/lib/db', () => ({
  db: {
    order: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(),
}))

vi.mock('@/lib/events', () => ({
  recordOrderEvent: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

interface MockExpiredOrder {
  id: string
  status: OrderStatus
  paymentDueAt: Date | null
  transactions: Array<{
    id: string
    type: TxType
    status: TxStatus
    amount: number
  }>
}

describe('Service & Server Action: Order Expiration & Concurrency Safety (Revision 01)', () => {
  const fixedNow = new Date('2026-10-18T12:00:00Z')
  const overdueTime = new Date('2026-10-17T10:00:00Z') // Quá hạn 26 tiếng

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Service: processExpiredOrders()', () => {
    it('1. Hủy đơn quá hạn 24h chưa thanh toán (paid = 0), gọi updateMany nguyên tử và ghi OrderEvent PAYMENT_EXPIRED', async () => {
      const mockOrder: MockExpiredOrder = {
        id: 'order-expired-1',
        status: OrderStatus.PENDING_CONFIRMATION,
        paymentDueAt: overdueTime,
        transactions: [],
      }

      vi.mocked(db.order.findMany).mockResolvedValue([mockOrder] as unknown as Awaited<ReturnType<typeof db.order.findMany>>)

      const txMock = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        order: {
          findUnique: vi.fn().mockResolvedValue(mockOrder),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      }

      vi.mocked(db.$transaction).mockImplementation(async (callback) => {
        return await (callback as unknown as (tx: typeof txMock) => unknown)(txMock)
      })

      const result = await processExpiredOrders(fixedNow)

      expect(result.success).toBe(true)
      expect(result.expiredCount).toBe(1)
      expect(txMock.order.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'order-expired-1',
          status: OrderStatus.PENDING_CONFIRMATION,
        },
        data: expect.objectContaining({
          status: OrderStatus.CANCELLED,
          cancelledBy: 'SYSTEM',
        }),
      })
      expect(recordOrderEvent).toHaveBeenCalledWith(
        txMock,
        expect.objectContaining({
          orderId: 'order-expired-1',
          type: 'PAYMENT_EXPIRED',
          fromStatus: OrderStatus.PENDING_CONFIRMATION,
          toStatus: OrderStatus.CANCELLED,
        })
      )
    })

    it('2. Case A — Hai Cron chạy đồng thời trên cùng một đơn quá hạn: Chỉ 1 Cron chuyển trạng thái và ghi OrderEvent đúng 1 lần', async () => {
      const mockOrder: MockExpiredOrder = {
        id: 'order-concurrent-1',
        status: OrderStatus.PENDING_CONFIRMATION,
        paymentDueAt: overdueTime,
        transactions: [],
      }

      // Cả hai Cron ban đầu đều quét thấy đơn candidate
      vi.mocked(db.order.findMany).mockResolvedValue([mockOrder] as unknown as Awaited<ReturnType<typeof db.order.findMany>>)

      let executionCount = 0
      vi.mocked(db.$transaction).mockImplementation(async (callback) => {
        executionCount++
        if (executionCount === 1) {
          // Cron 1 chạy trước: updateMany thành công (count: 1)
          const txMock1 = {
            $queryRaw: vi.fn().mockResolvedValue([]),
            order: {
              findUnique: vi.fn().mockResolvedValue(mockOrder),
              updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            },
          }
          return await (callback as unknown as (tx: typeof txMock1) => unknown)(txMock1)
        } else {
          // Cron 2 chạy sau hoặc song song: updateMany trả về count: 0 do status không còn PENDING_CONFIRMATION
          const txMock2 = {
            $queryRaw: vi.fn().mockResolvedValue([]),
            order: {
              findUnique: vi.fn().mockResolvedValue(mockOrder),
              updateMany: vi.fn().mockResolvedValue({ count: 0 }),
            },
          }
          return await (callback as unknown as (tx: typeof txMock2) => unknown)(txMock2)
        }
      })

      // Giả lập hai Cron chạy đồng thời
      const [result1, result2] = await Promise.all([
        processExpiredOrders(fixedNow),
        processExpiredOrders(fixedNow),
      ])

      // Cron 1 thành công đếm 1, Cron 2 không tăng count
      expect(result1.success).toBe(true)
      expect(result1.expiredCount).toBe(1)
      expect(result2.success).toBe(true)
      expect(result2.expiredCount).toBe(0)

      // OrderEvent chỉ được ghi đúng 1 lần duy nhất trên toàn hệ thống
      expect(recordOrderEvent).toHaveBeenCalledTimes(1)
    })

    it('3. Case B — Cron chạy đồng thời với Admin xác nhận thanh toán đủ (FULL): Đơn đã sang PROCESSING, Cron bỏ qua', async () => {
      const mockCandidate: MockExpiredOrder = {
        id: 'order-case-b',
        status: OrderStatus.PENDING_CONFIRMATION,
        paymentDueAt: overdueTime,
        transactions: [],
      }

      vi.mocked(db.order.findMany).mockResolvedValue([mockCandidate] as unknown as Awaited<ReturnType<typeof db.order.findMany>>)

      // Khi Cron vào transaction, Admin vừa hoàn tất confirmPayment() làm đơn chuyển sang PROCESSING
      const orderAlreadyProcessing: MockExpiredOrder = {
        id: 'order-case-b',
        status: OrderStatus.PROCESSING,
        paymentDueAt: overdueTime,
        transactions: [
          {
            id: 'tx-full',
            type: TxType.PAYMENT,
            status: TxStatus.DONE,
            amount: 15277500,
          },
        ],
      }

      const txMock = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        order: {
          findUnique: vi.fn().mockResolvedValue(orderAlreadyProcessing),
          updateMany: vi.fn(),
        },
      }

      vi.mocked(db.$transaction).mockImplementation(async (callback) => {
        return await (callback as unknown as (tx: typeof txMock) => unknown)(txMock)
      })

      const result = await processExpiredOrders(fixedNow)

      expect(result.success).toBe(true)
      expect(result.expiredCount).toBe(0)
      expect(txMock.order.updateMany).not.toHaveBeenCalled()
      expect(recordOrderEvent).not.toHaveBeenCalled()
    })

    it('4. Case C — Cron chạy đồng thời với Admin xác nhận thanh toán một phần: Đơn vẫn ở PENDING_CONFIRMATION nhưng paid > 0, Cron KHÔNG hủy', async () => {
      const mockCandidate: MockExpiredOrder = {
        id: 'order-case-c',
        status: OrderStatus.PENDING_CONFIRMATION,
        paymentDueAt: overdueTime,
        transactions: [],
      }

      vi.mocked(db.order.findMany).mockResolvedValue([mockCandidate] as unknown as Awaited<ReturnType<typeof db.order.findMany>>)

      // Admin vừa ghi nhận cọc 2.000.000đ (< 4.584.000đ), đơn vẫn là PENDING_CONFIRMATION
      const orderPartiallyPaid: MockExpiredOrder = {
        id: 'order-case-c',
        status: OrderStatus.PENDING_CONFIRMATION,
        paymentDueAt: overdueTime,
        transactions: [
          {
            id: 'tx-partial',
            type: TxType.PAYMENT,
            status: TxStatus.DONE,
            amount: 2000000,
          },
        ],
      }

      const txMock = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        order: {
          findUnique: vi.fn().mockResolvedValue(orderPartiallyPaid),
          updateMany: vi.fn(),
        },
      }

      vi.mocked(db.$transaction).mockImplementation(async (callback) => {
        return await (callback as unknown as (tx: typeof txMock) => unknown)(txMock)
      })

      const result = await processExpiredOrders(fixedNow)

      expect(result.success).toBe(true)
      expect(result.expiredCount).toBe(0)
      // Tuyệt đối không được gọi updateMany hoặc ghi OrderEvent
      expect(txMock.order.updateMany).not.toHaveBeenCalled()
      expect(recordOrderEvent).not.toHaveBeenCalled()
    })

    it('5. Tuyệt đối KHÔNG hủy đơn chưa quá hạn (paymentDueAt >= now)', async () => {
      // findMany lọc paymentDueAt < now nên không có đơn nào
      vi.mocked(db.order.findMany).mockResolvedValue([])

      const result = await processExpiredOrders(fixedNow)

      expect(result.success).toBe(true)
      expect(result.expiredCount).toBe(0)
      expect(db.$transaction).not.toHaveBeenCalled()
    })

    it('6. Case E — Cron chạy lại lần thứ hai (Idempotency check): Không hủy thêm và không ghi trùng sự kiện', async () => {
      const alreadyCancelledOrder: MockExpiredOrder = {
        id: 'order-already-cancelled',
        status: OrderStatus.CANCELLED,
        paymentDueAt: overdueTime,
        transactions: [],
      }

      // Giả sử findMany đọc được hoặc có candidate từ trước
      vi.mocked(db.order.findMany).mockResolvedValue([alreadyCancelledOrder] as unknown as Awaited<ReturnType<typeof db.order.findMany>>)

      const txMock = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        order: {
          findUnique: vi.fn().mockResolvedValue(alreadyCancelledOrder),
          updateMany: vi.fn(),
        },
      }

      vi.mocked(db.$transaction).mockImplementation(async (callback) => {
        return await (callback as unknown as (tx: typeof txMock) => unknown)(txMock)
      })

      const result = await processExpiredOrders(fixedNow)

      expect(result.success).toBe(true)
      expect(result.expiredCount).toBe(0)
      expect(txMock.order.updateMany).not.toHaveBeenCalled()
      expect(recordOrderEvent).not.toHaveBeenCalled()
    })

    it('7. Phase 6A — Hủy đơn nháp định kỳ (DRAFT) đã quá hạn xác nhận (today > deliveryDate - leadTimeDays), cancelledBy = SYSTEM', async () => {
      // fixedNow = 2026-10-18T12:00:00Z (ngày 2026-10-18 giờ VN)
      // deliveryDate = 2026-10-19, leadTimeDays = 2 -> hạn cuối xác nhận là 2026-10-17 -> đã quá hạn!
      const overdueDraft = {
        id: 'draft-overdue-1',
        status: OrderStatus.DRAFT,
        paymentDueAt: null,
        deliveryDate: new Date('2026-10-19T00:00:00.000Z'),
        transactions: [],
        items: [
          {
            packaging: {
              product: { leadTimeDays: 2 },
            },
          },
        ],
      }

      vi.mocked(db.order.findMany).mockResolvedValue(
        [overdueDraft] as unknown as Awaited<ReturnType<typeof db.order.findMany>>
      )

      const txMock = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        order: {
          findUnique: vi.fn().mockResolvedValue(overdueDraft),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      }

      vi.mocked(db.$transaction).mockImplementation(async (callback) => {
        return await (callback as unknown as (tx: typeof txMock) => unknown)(txMock)
      })

      const result = await processExpiredOrders(fixedNow)

      expect(result.success).toBe(true)
      expect(result.expiredCount).toBe(1)
      expect(result.expiredDraftCount).toBe(1)
      expect(txMock.order.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'draft-overdue-1',
          status: OrderStatus.DRAFT,
        },
        data: expect.objectContaining({
          status: OrderStatus.CANCELLED,
          cancelledBy: 'SYSTEM',
        }),
      })
      expect(recordOrderEvent).toHaveBeenCalledWith(
        txMock,
        expect.objectContaining({
          orderId: 'draft-overdue-1',
          type: 'DRAFT_EXPIRED',
          fromStatus: OrderStatus.DRAFT,
          toStatus: OrderStatus.CANCELLED,
        })
      )
    })

    it('8. Phase 6A — KHÔNG hủy đơn nháp định kỳ (DRAFT) chưa quá hạn xác nhận (today <= deliveryDate - leadTimeDays)', async () => {
      // fixedNow = 2026-10-18, deliveryDate = 2026-10-22, leadTimeDays = 2 -> hạn cuối là 2026-10-20 -> chưa quá hạn
      const validDraft = {
        id: 'draft-valid-1',
        status: OrderStatus.DRAFT,
        paymentDueAt: null,
        deliveryDate: new Date('2026-10-22T00:00:00.000Z'),
        transactions: [],
        items: [
          {
            packaging: {
              product: { leadTimeDays: 2 },
            },
          },
        ],
      }

      vi.mocked(db.order.findMany).mockResolvedValue(
        [validDraft] as unknown as Awaited<ReturnType<typeof db.order.findMany>>
      )

      const result = await processExpiredOrders(fixedNow)

      expect(result.success).toBe(true)
      expect(result.expiredCount).toBe(0)
      expect(db.$transaction).not.toHaveBeenCalled()
      expect(recordOrderEvent).not.toHaveBeenCalled()
    })
  })

  describe('Server Action: expireOrdersJob() - Phân quyền Admin (SRC-SEC-07)', () => {
    it('1. Từ chối thực thi khi người dùng chưa đăng nhập (anonymous)', async () => {
      vi.mocked(requireAdmin).mockRejectedValue(new Error('Yêu cầu đăng nhập để thực hiện chức năng này'))

      const result = await expireOrdersJob()

      expect(result.success).toBe(false)
      expect(result.expiredCount).toBe(0)
      expect(result.error).toContain('Yêu cầu đăng nhập')
      expect(db.order.findMany).not.toHaveBeenCalled()
    })

    it('2. Từ chối thực thi khi người dùng là CUSTOMER', async () => {
      vi.mocked(requireAdmin).mockRejectedValue(new Error('Bạn không có quyền truy cập trang quản trị'))

      const result = await expireOrdersJob()

      expect(result.success).toBe(false)
      expect(result.expiredCount).toBe(0)
      expect(result.error).toContain('Bạn không có quyền truy cập trang quản trị')
      expect(db.order.findMany).not.toHaveBeenCalled()
    })

    it('3. Cho phép thực thi khi người dùng là ADMIN', async () => {
      vi.mocked(requireAdmin).mockResolvedValue({
        id: 'admin-1',
        email: 'admin@nongsanb2b.vn',
        role: Role.ADMIN,
        name: 'Admin User',
        groupId: null,
        discountPercent: 0,
        companyName: null,
        phone: '0123456789',
      })

      vi.mocked(db.order.findMany).mockResolvedValue([])

      const result = await expireOrdersJob()

      expect(result.success).toBe(true)
      expect(requireAdmin).toHaveBeenCalledTimes(1)
    })
  })
})
