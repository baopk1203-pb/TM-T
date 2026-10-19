import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import {
  upcomingDeliveryDates,
  shouldCreateDraft,
  isDraftExpired,
  toUtcDateKey,
  getIsoWeekday,
} from '@/lib/domain/recurring'
import { processRecurringSchedules } from '@/lib/services/recurring-generator'
import {
  confirmRecurringDraft,
  runRecurringGeneratorJob,
  createRecurringFromOrder,
} from '@/actions/recurring'
import { GET as cronRecurringGet } from '@/app/api/cron/recurring/route'
import { db } from '@/lib/db'
import { requireUser, requireAdmin } from '@/lib/auth'
import { recordOrderEvent } from '@/lib/events'
import {
  OrderStatus,
  OrderType,
  PaymentOption,
  TimeSlot,
  SeasonStatus,
  Role,
} from '@prisma/client'

vi.mock('@/lib/db', () => ({
  db: {
    recurringSchedule: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    recurringItem: {
      deleteMany: vi.fn(),
    },
    address: {
      findFirst: vi.fn(),
    },
    product: {
      findMany: vi.fn(),
    },
    weeklyCapacity: {
      findUnique: vi.fn(),
    },
    orderItem: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    order: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(),
  requireAdmin: vi.fn(),
}))

vi.mock('@/lib/events', () => ({
  recordOrderEvent: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

describe('Phase 6A — Recurring Orders (Domain, Generator, Confirmation & Cron)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('1. Pure Domain: upcomingDeliveryDates()', () => {
    it('Lịch [1, 4] (Thứ Hai, Thứ Năm) trả về đúng các ngày khớp trong khoảng [today + leadTimeDays, today + leadTimeDays + 7 ngày]', () => {
      // Giả sử hôm nay là Chủ Nhật 2026-10-18 (giờ VN), leadTimeDays = 1
      // Khoảng [2026-10-19 (T2) .. 2026-10-26 (T2 tuần kế)]
      const today = new Date('2026-10-18T03:00:00Z') // 10:00 sáng Chủ Nhật giờ VN
      const schedule = { isActive: true, weekdays: [1, 4] }

      const dates = upcomingDeliveryDates(schedule, today, 1)
      const dateKeys = dates.map((d) => toUtcDateKey(d))

      // 2026-10-19 là Thứ 2 (1), 2026-10-22 là Thứ 5 (4), 2026-10-26 là Thứ 2 tuần kế (1)
      expect(dateKeys).toEqual(['2026-10-19', '2026-10-22', '2026-10-26'])
      for (const d of dates) {
        expect([1, 4]).toContain(getIsoWeekday(d))
      }
    })

    it('Lịch đang tắt (isActive = false) hoặc weekdays rỗng trả về mảng rỗng []', () => {
      const today = new Date('2026-10-18T03:00:00Z')
      expect(upcomingDeliveryDates({ isActive: false, weekdays: [1, 4] }, today, 1)).toEqual([])
      expect(upcomingDeliveryDates({ isActive: true, weekdays: [] }, today, 1)).toEqual([])
    })

    it('Tôn trọng leadTimeDays: dịch chuyển cửa sổ bắt đầu sang today + leadTimeDays', () => {
      // Hôm nay: Chủ Nhật 2026-10-18. Nếu leadTimeDays = 2 -> bắt đầu từ Thứ Ba 2026-10-20 đến Thứ Ba 2026-10-27
      // Thứ Hai 2026-10-19 nằm trước today + 2 nên KHÔNG được trả về!
      const today = new Date('2026-10-18T03:00:00Z')
      const dates = upcomingDeliveryDates({ isActive: true, weekdays: [1, 4] }, today, 2)
      const dateKeys = dates.map((d) => toUtcDateKey(d))

      expect(dateKeys).toEqual(['2026-10-22', '2026-10-26'])
      expect(dateKeys).not.toContain('2026-10-19')
    })

    it('Xử lý đúng biên tuần (Thứ Bảy 6 / Chủ Nhật 7 sang Thứ Hai 1) theo múi giờ Việt Nam (UTC+7)', () => {
      // 2026-10-18T18:30:00Z tương ứng 01:30 sáng Thứ Hai 2026-10-19 theo giờ Việt Nam (UTC+7)
      const nowUtc = new Date('2026-10-18T18:30:00Z')
      const dates = upcomingDeliveryDates({ isActive: true, weekdays: [7] }, nowUtc, 1)
      const dateKeys = dates.map((d) => toUtcDateKey(d))

      // Ngày VN là 2026-10-19 (T2), khoảng [2026-10-20 .. 2026-10-27] có Chủ Nhật là 2026-10-25
      expect(dateKeys).toEqual(['2026-10-25'])
    })
  })

  describe('2. Pure Domain: shouldCreateDraft()', () => {
    it('Chặn tạo trùng khi đã có đơn thuộc cùng recurringScheduleId và deliveryDate', () => {
      const existingOrders = [
        {
          recurringScheduleId: 'sched-1',
          deliveryDate: new Date('2026-10-22T00:00:00.000Z'),
        },
      ]

      expect(
        shouldCreateDraft({
          scheduleId: 'sched-1',
          deliveryDate: new Date('2026-10-22T00:00:00.000Z'),
          existingOrders,
        })
      ).toBe(false)

      // Hỗ trợ cả chữ ký truyền tham số rời
      expect(shouldCreateDraft('sched-1', '2026-10-22', existingOrders)).toBe(false)
    })

    it('Cho phép tạo khi khác ngày giao hoặc khác recurringScheduleId', () => {
      const existingOrders = [
        {
          recurringScheduleId: 'sched-1',
          deliveryDate: new Date('2026-10-19T00:00:00.000Z'),
        },
      ]

      expect(
        shouldCreateDraft({
          scheduleId: 'sched-1',
          deliveryDate: new Date('2026-10-22T00:00:00.000Z'),
          existingOrders,
        })
      ).toBe(true)

      expect(
        shouldCreateDraft({
          scheduleId: 'sched-2',
          deliveryDate: new Date('2026-10-19T00:00:00.000Z'),
          existingOrders,
        })
      ).toBe(true)
    })
  })

  describe('3. Pure Domain: isDraftExpired()', () => {
    it('Đơn nháp trước hoặc đúng ngày hạn xác nhận (deliveryDate - leadTimeDays) thì KHÔNG bị coi là quá hạn', () => {
      const deliveryDate = new Date('2026-10-22T00:00:00.000Z') // Thứ 5
      const leadTimeDays = 2 // Hạn cuối xác nhận: hết ngày 2026-10-20 (giờ VN)

      // Ngày 2026-10-19 (trước hạn 1 ngày)
      expect(isDraftExpired(deliveryDate, new Date('2026-10-19T08:00:00Z'), leadTimeDays)).toBe(
        false
      )
      // Ngày 2026-10-20 (đúng ngày hạn xác nhận)
      expect(isDraftExpired(deliveryDate, new Date('2026-10-20T08:00:00Z'), leadTimeDays)).toBe(
        false
      )
    })

    it('Đơn nháp đã qua ngày (deliveryDate - leadTimeDays) theo giờ VN thì bị coi là quá hạn (true)', () => {
      const deliveryDate = new Date('2026-10-22T00:00:00.000Z')
      const leadTimeDays = 2 // Hạn cuối là ngày 2026-10-20

      // Sang ngày 2026-10-21 giờ VN -> quá hạn!
      expect(isDraftExpired(deliveryDate, new Date('2026-10-21T01:00:00Z'), leadTimeDays)).toBe(
        true
      )
    })
  })

  describe('4. Service: processRecurringSchedules() — Idempotency khi chạy job 2 lần liên tiếp (Mục 7.7)', () => {
    it('Lịch [1, 4] (T2, T5): chạy job 2 lần liên tiếp thì lần 2 không sinh thêm đơn nháp nào', async () => {
      const fixedNow = new Date('2026-10-18T03:00:00Z') // Chủ Nhật 2026-10-18

      const simulatedOrdersInDb: Array<{
        id: string
        code: string
        recurringScheduleId: string
        deliveryDate: Date
        status: OrderStatus
      }> = []

      vi.mocked(db.recurringSchedule.findMany).mockResolvedValue([
        { id: 'sched-ri6' },
      ] as unknown as Awaited<ReturnType<typeof db.recurringSchedule.findMany>>)

      const txMock = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        recurringSchedule: {
          findUnique: vi.fn().mockImplementation(async () => ({
            id: 'sched-ri6',
            userId: 'user-supermarket',
            name: 'Lịch Ri6 T2 & T5',
            weekdays: [1, 4],
            timeSlot: TimeSlot.MORNING,
            addressId: 'addr-1',
            paymentOption: PaymentOption.DEPOSIT_30,
            isActive: true,
            user: {
              id: 'user-supermarket',
              group: { discountPercent: 3 },
            },
            items: [
              {
                id: 'ri-1',
                scheduleId: 'sched-ri6',
                productId: 'prod-ri6',
                packagingId: 'pkg-10kg',
                quantity: 21, // 210kg -> bậc 200kg (75.000), CK 3% -> 72.750đ/kg -> 15.277.500đ
              },
            ],
            orders: [...simulatedOrdersInDb],
          })),
        },
        address: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'addr-1',
            userId: 'user-supermarket',
            label: 'Kho Tổng Quận 7',
            recipient: 'Nguyễn Văn A',
            phone: '0909123456',
            street: '123 Nguyễn Văn Linh',
            ward: 'Tân Phong',
            district: 'Quận 7',
            province: 'TP. Hồ Chí Minh',
            lat: null,
            lng: null,
            note: null,
          }),
        },
        product: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'prod-ri6',
              name: 'Sầu riêng Ri6',
              moqGrams: 50000,
              leadTimeDays: 2, // Khoảng [2026-10-20 .. 2026-10-27] -> khớp T5 (22/10) và T2 (26/10) = 2 đơn
              requiresCold: false,
              seasonStatus: SeasonStatus.HARVESTING,
              isActive: true,
              packagings: [
                {
                  id: 'pkg-10kg',
                  name: 'Thùng 10kg',
                  weightGrams: 10000,
                  isSample: false,
                  samplePrice: null,
                  isActive: true,
                },
              ],
              priceTiers: [
                { minGrams: 50000, pricePerKg: 80000 },
                { minGrams: 200000, pricePerKg: 75000 },
              ],
            },
          ]),
        },
        order: {
          findFirst: vi.fn().mockImplementation(async ({ where }) => {
            return (
              simulatedOrdersInDb.find(
                (o) =>
                  o.recurringScheduleId === where.recurringScheduleId &&
                  toUtcDateKey(o.deliveryDate) === toUtcDateKey(where.deliveryDate)
              ) ?? null
            )
          }),
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(async ({ data }) => {
            const created = {
              id: `order-${simulatedOrdersInDb.length + 1}`,
              code: data.code,
              recurringScheduleId: data.recurringScheduleId,
              deliveryDate: data.deliveryDate,
              status: data.status,
              total: data.total,
              depositAmount: data.depositAmount,
            }
            simulatedOrdersInDb.push(created)
            return created
          }),
        },
      }

      vi.mocked(db.$transaction).mockImplementation(async (cb) => {
        return await (cb as unknown as (tx: typeof txMock) => unknown)(txMock)
      })

      // Lần chạy 1: tạo đúng 2 đơn nháp (2026-10-22 và 2026-10-26)
      const run1 = await processRecurringSchedules(fixedNow)
      expect(run1.success).toBe(true)
      expect(run1.createdCount).toBe(2)
      expect(run1.skippedDuplicates).toBe(0)
      expect(simulatedOrdersInDb).toHaveLength(2)
      expect(recordOrderEvent).toHaveBeenCalledTimes(2)

      // Kiểm tra giá tính qua priceCart & Shipping Engine (Phase 8A):
      // subtotal: 15.277.500đ, shippingFee: 302.000đ -> total: 15.579.500đ, cọc 30%: 4.674.000đ
      expect(txMock.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: OrderType.RECURRING,
            status: OrderStatus.DRAFT,
            subtotal: 15277500,
            shippingFee: 302000,
            total: 15579500,
            depositAmount: 4674000,
          }),
        })
      )

      // Lần chạy 2 liên tiếp: không tạo thêm đơn nào, tổng số đơn nháp không đổi (= 2)
      const run2 = await processRecurringSchedules(fixedNow)
      expect(run2.success).toBe(true)
      expect(run2.createdCount).toBe(0)
      expect(run2.skippedDuplicates).toBe(2)
      expect(simulatedOrdersInDb).toHaveLength(2)
      expect(recordOrderEvent).toHaveBeenCalledTimes(2)
    })
  })

  describe('5. Cron Route /api/cron/recurring & Admin Action Security', () => {
    const originalEnv = process.env.CRON_SECRET

    afterEach(() => {
      process.env.CRON_SECRET = originalEnv
    })

    it('Từ chối 401 Fail-closed khi CRON_SECRET chưa được cấu hình', async () => {
      delete process.env.CRON_SECRET
      const req = new NextRequest('http://localhost:3000/api/cron/recurring', {
        headers: { authorization: 'Bearer any-secret' },
      })
      const res = await cronRecurringGet(req)
      expect(res.status).toBe(401)
    })

    it('Từ chối 401 khi Authorization Bearer token sai', async () => {
      process.env.CRON_SECRET = 'secret-phase6a'
      const req = new NextRequest('http://localhost:3000/api/cron/recurring', {
        headers: { authorization: 'Bearer wrong-token' },
      })
      const res = await cronRecurringGet(req)
      expect(res.status).toBe(401)
    })

    it('Cho phép 200 khi Authorization Bearer token hợp lệ', async () => {
      process.env.CRON_SECRET = 'secret-phase6a'
      vi.mocked(db.recurringSchedule.findMany).mockResolvedValue([])

      const req = new NextRequest('http://localhost:3000/api/cron/recurring', {
        headers: { authorization: 'Bearer secret-phase6a' },
      })
      const res = await cronRecurringGet(req)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.success).toBe(true)
      expect(json.createdCount).toBe(0)
    })

    it('runRecurringGeneratorJob() chặn người dùng không phải ADMIN', async () => {
      vi.mocked(requireAdmin).mockRejectedValue(new Error('Bạn không có quyền truy cập'))
      const res = await runRecurringGeneratorJob()
      expect(res.success).toBe(false)
      expect(res.error).toContain('Bạn không có quyền')
    })
  })

  describe('6. Server Actions: createRecurringFromOrder() & confirmRecurringDraft()', () => {
    it('createRecurringFromOrder() từ chối nếu đơn gốc chưa ở trạng thái COMPLETED', async () => {
      vi.mocked(requireUser).mockResolvedValue({
        id: 'user-1',
        email: 'customer@demo.vn',
        role: Role.CUSTOMER,
        name: 'Khách Sỉ',
        groupId: 'grp-1',
        discountPercent: 3,
        companyName: null,
        phone: '0909000111',
      })

      const txMock = {
        order: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'ord-processing',
            code: 'DH-261018-1111',
            userId: 'user-1',
            status: OrderStatus.PROCESSING,
            items: [],
          }),
        },
      }

      vi.mocked(db.$transaction).mockImplementation(async (cb) => {
        return await (cb as unknown as (tx: typeof txMock) => unknown)(txMock)
      })

      const res = await createRecurringFromOrder({
        orderId: 'ord-processing',
        name: 'Lịch từ đơn chưa hoàn tất',
        weekdays: [1, 4],
      })

      expect(res.success).toBe(false)
      expect(res.error).toContain('COMPLETED')
    })

    it('confirmRecurringDraft() tính lại giá server-side, kiểm tra MOQ/Capacity và chuyển nguyên tử DRAFT -> PENDING_CONFIRMATION', async () => {
      vi.mocked(requireUser).mockResolvedValue({
        id: 'user-1',
        email: 'customer@demo.vn',
        role: Role.CUSTOMER,
        name: 'Siêu Thị Demo',
        groupId: 'grp-supermarket',
        discountPercent: 3,
        companyName: 'Siêu Thị Demo',
        phone: '0909000111',
      })

      // Ngày giao cách hiện tại 5 ngày để luôn hợp lệ với leadTimeDays = 1
      const futureDelivery = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
      const futureDeliveryUtc = new Date(
        Date.UTC(
          futureDelivery.getUTCFullYear(),
          futureDelivery.getUTCMonth(),
          futureDelivery.getUTCDate()
        )
      )

      const txMock = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        order: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'draft-1',
            code: 'DH-261018-9999',
            userId: 'user-1',
            status: OrderStatus.DRAFT,
            paymentOption: PaymentOption.DEPOSIT_30,
            subtotal: 4000000,
            shippingFee: 0,
            total: 4000000,
            depositAmount: 1200000,
            deliveryDate: futureDeliveryUtc,
            addressSnapshot: {
              id: 'addr-1',
              recipient: 'Siêu Thị Demo',
              phone: '0909000111',
              street: '123 Lê Lợi',
              ward: 'Bến Thành',
              district: 'Quận 1',
              province: 'TP.HCM',
            },
            customerNote: 'Đơn nháp định kỳ',
            user: {
              id: 'user-1',
              group: { discountPercent: 3 },
            },
            items: [],
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        product: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'prod-ri6',
              name: 'Sầu riêng Ri6',
              moqGrams: 50000,
              leadTimeDays: 1,
              requiresCold: false,
              seasonStatus: SeasonStatus.HARVESTING,
              isActive: true,
              packagings: [
                {
                  id: 'pkg-10kg',
                  name: 'Thùng 10kg',
                  weightGrams: 10000,
                  isSample: false,
                  samplePrice: null,
                  isActive: true,
                },
              ],
              priceTiers: [
                { minGrams: 50000, pricePerKg: 80000 },
                { minGrams: 200000, pricePerKg: 75000 },
              ],
            },
          ]),
        },
        weeklyCapacity: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'cap-1',
            productId: 'prod-ri6',
            maxGrams: 500000,
          }),
        },
        orderItem: {
          findMany: vi.fn().mockResolvedValue([{ orderedGrams: 100000 }]),
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          createMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      }

      vi.mocked(db.$transaction).mockImplementation(async (cb) => {
        return await (cb as unknown as (tx: typeof txMock) => unknown)(txMock)
      })

      const res = await confirmRecurringDraft({
        orderId: 'draft-1',
        paymentOption: PaymentOption.DEPOSIT_30,
        items: [
          {
            productId: 'prod-ri6',
            packagingId: 'pkg-10kg',
            quantity: 21, // Khách tăng lên 21 thùng (210kg) -> tổng 15.277.500đ, cọc 4.584.000đ
          },
        ],
      })

      expect(res.success).toBe(true)
      expect(res.orderCode).toBe('DH-261018-9999')
      expect(txMock.order.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'draft-1',
          status: OrderStatus.DRAFT,
        },
        data: expect.objectContaining({
          status: OrderStatus.PENDING_CONFIRMATION,
          paymentOption: PaymentOption.DEPOSIT_30,
          subtotal: 15277500,
          shippingFee: 270000,
          total: 15547500,
          depositAmount: 4665000,
          paymentDueAt: expect.any(Date),
        }),
      })
      expect(recordOrderEvent).toHaveBeenCalledWith(
        txMock,
        expect.objectContaining({
          orderId: 'draft-1',
          type: 'STATUS_CHANGED',
          fromStatus: OrderStatus.DRAFT,
          toStatus: OrderStatus.PENDING_CONFIRMATION,
        })
      )
    })
  })
})
