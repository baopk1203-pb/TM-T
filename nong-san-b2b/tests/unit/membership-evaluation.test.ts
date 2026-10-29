import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseQuarterCode,
  formatQuarterCode,
  getPrecedingQuarterCode,
  getQuarterDateRange,
  getQuarterDateRangeFromCode,
  isRegistrationInCarryoverWindow,
  getNewCustomerMultiplier,
  getVietnamMondayWeekKey,
  createVnDate,
  getDaysInMonth,
  isOrderEligibleForKpi,
  getOrderNetRevenue,
  getOrderEligibleVolumeKg,
  aggregateRawMetrics,
  evaluateCustomerQuarterlyMembership,
  CandidateOrder,
} from '@/lib/domain/membership-evaluation'
import { MembershipTier } from '@/lib/domain/membership'
import { OrderStatus, CancelActor, ComplaintStatus, Resolution, Prisma } from '@prisma/client'

// Hoist mock objects for Service tests
const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    user: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    membershipEvaluationLog: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({
  db: mockDb,
}))

import { runQuarterlyEvaluation } from '@/lib/services/membership-evaluation'

describe('F04-03 — Quarterly Evaluation & Membership Automation Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Group A — Quarter Boundaries & Date Math', () => {
    it('parseQuarterCode & formatQuarterCode hoạt động chính xác', () => {
      expect(parseQuarterCode('2027-Q1')).toEqual({ year: 2027, quarter: 1 })
      expect(parseQuarterCode('2027-Q4')).toEqual({ year: 2027, quarter: 4 })
      expect(() => parseQuarterCode('invalid')).toThrow(/Mã quý không hợp lệ/)
      expect(formatQuarterCode(2027, 2)).toBe('2027-Q2')
      expect(() => formatQuarterCode(2027, 5)).toThrow(/Quý không hợp lệ/)
    })

    it('getPrecedingQuarterCode xác định đúng quý liền trước theo giờ Việt Nam', () => {
      // 01/04/2027 -> 2027-Q1
      const aprilFirst = createVnDate(2027, 4, 1, 10, 0, 0)
      expect(getPrecedingQuarterCode(aprilFirst)).toBe('2027-Q1')

      // 01/07/2027 -> 2027-Q2
      const julyFirst = createVnDate(2027, 7, 1, 9, 30, 0)
      expect(getPrecedingQuarterCode(julyFirst)).toBe('2027-Q2')

      // 01/10/2027 -> 2027-Q3
      const octoberFirst = createVnDate(2027, 10, 1, 0, 1, 0)
      expect(getPrecedingQuarterCode(octoberFirst)).toBe('2027-Q3')

      // 01/01/2028 chuyển năm -> 2027-Q4
      const januaryFirst = createVnDate(2028, 1, 1, 0, 0, 0)
      expect(getPrecedingQuarterCode(januaryFirst)).toBe('2027-Q4')
    })

    it('xử lý năm nhuận chính xác (tháng 2 năm 2028 có 29 ngày)', () => {
      expect(getDaysInMonth(2027, 2)).toBe(28)
      expect(getDaysInMonth(2028, 2)).toBe(29)
      expect(getDaysInMonth(2024, 2)).toBe(29)
    })

    it('getQuarterDateRange & getQuarterDateRangeFromCode thiết lập khoảng thời gian half-open [start, end) và carryoverStart chuẩn xác', () => {
      const q1 = getQuarterDateRange(2027, 1)
      const q1FromCode = getQuarterDateRangeFromCode('2027-Q1')
      expect(q1.quarterCode).toBe(q1FromCode.quarterCode)
      expect(q1.startDate.getTime()).toBe(q1FromCode.startDate.getTime())
      expect(q1.endDate.getTime()).toBe(q1FromCode.endDate.getTime())
      expect(q1.quarterCode).toBe('2027-Q1')
      // Q1/2027: 01/01 đến 01/04
      expect(q1.startDate.toISOString()).toBe(createVnDate(2027, 1, 1, 0, 0, 0).toISOString())
      expect(q1.endDate.toISOString()).toBe(createVnDate(2027, 4, 1, 0, 0, 0).toISOString())
      // 15 ngày cuối Q1: tháng 3 có 31 ngày -> 31 - 15 + 1 = 17 -> ngày 17/03
      expect(q1.carryoverStartDate.toISOString()).toBe(createVnDate(2027, 3, 17, 0, 0, 0).toISOString())

      // Kiểm tra hàm helper getVietnamMondayWeekKey
      const testWed = createVnDate(2027, 4, 14) // Thứ Tư ngày 14/04/2027
      expect(getVietnamMondayWeekKey(testWed)).toBe('2027-04-12') // Thứ Hai là 12/04/2027

      // Q4 chuyển năm: 01/10/2027 đến 01/01/2028
      const q4 = getQuarterDateRange(2027, 4)
      expect(q4.startDate.toISOString()).toBe(createVnDate(2027, 10, 1, 0, 0, 0).toISOString())
      expect(q4.endDate.toISOString()).toBe(createVnDate(2028, 1, 1, 0, 0, 0).toISOString())
      // 15 ngày cuối Q4: tháng 12 có 31 ngày -> 17/12
      expect(q4.carryoverStartDate.toISOString()).toBe(createVnDate(2027, 12, 17, 0, 0, 0).toISOString())
    })

    it('không tính trùng giao dịch tại ranh giới quý (half-open [start, end))', () => {
      const q1 = getQuarterDateRange(2027, 1)
      // Giao dịch đúng 00:00:00 ngày 01/04/2027 thuộc về Q2, KHÔNG thuộc về Q1
      const boundaryOrder: CandidateOrder = {
        id: 'ord-bound',
        status: OrderStatus.COMPLETED,
        createdAt: q1.endDate, // 01/04/2027 00:00:00 VN
        total: 10_000_000,
        items: [{ isSample: false, orderedGrams: 50_000 }],
      }
      const metricsQ1 = aggregateRawMetrics([boundaryOrder], q1.startDate, q1.endDate)
      expect(metricsQ1.rawRevenueVnd).toBe(0) // Bị loại khỏi Q1 vì orderTime >= endTime

      const q2 = getQuarterDateRange(2027, 2)
      const metricsQ2 = aggregateRawMetrics([boundaryOrder], q2.startDate, q2.endDate)
      expect(metricsQ2.rawRevenueVnd).toBe(10_000_000) // Được nhận vào Q2 vì orderTime >= startTime
    })
  })

  describe('Group B — New Customer Multiplier', () => {
    it('áp dụng đúng hệ số theo tháng đăng ký trong quý đầu tiên', () => {
      // Quý I: Tháng 1 -> 1.0, Tháng 2 -> 1.1, Tháng 3 -> 1.2
      const regJan = createVnDate(2027, 1, 15)
      const regFeb = createVnDate(2027, 2, 10)
      const regMar = createVnDate(2027, 3, 5)

      expect(getNewCustomerMultiplier(regJan, 2027, 1)).toBe(1.0)
      expect(getNewCustomerMultiplier(regFeb, 2027, 1)).toBe(1.1)
      expect(getNewCustomerMultiplier(regMar, 2027, 1)).toBe(1.2)

      // Quý II: Tháng 4 -> 1.0, Tháng 5 -> 1.1, Tháng 6 -> 1.2
      const regApr = createVnDate(2027, 4, 2)
      const regMay = createVnDate(2027, 5, 20)
      const regJun = createVnDate(2027, 6, 1)

      expect(getNewCustomerMultiplier(regApr, 2027, 2)).toBe(1.0)
      expect(getNewCustomerMultiplier(regMay, 2027, 2)).toBe(1.1)
      expect(getNewCustomerMultiplier(regJun, 2027, 2)).toBe(1.2)
    })

    it('hệ số cố định trong toàn bộ quý đăng ký, không tăng khi bước sang tháng tiếp theo', () => {
      // Khách đăng ký tháng 1 (tháng đầu quý)
      const regJan = createVnDate(2027, 1, 20)
      // Cho dù xét đơn ở tháng 2 hay tháng 3 trong quý I, hệ số vẫn là 1.0
      expect(getNewCustomerMultiplier(regJan, 2027, 1)).toBe(1.0)
    })

    it('giao dịch ở quý tiếp theo trở về hệ số chuẩn ×1.0 (không kéo dài ưu đãi)', () => {
      const regJan = createVnDate(2027, 1, 15)
      // Sang quý II/2027, hệ số trở về 1.0
      expect(getNewCustomerMultiplier(regJan, 2027, 2)).toBe(1.0)
    })

    it('hệ số nhân vào doanh thu và sản lượng nhưng KHÔNG nhân vào điểm kỷ luật', () => {
      const userCreatedAt = createVnDate(2027, 2, 15) // Tháng 2 -> ×1.1
      const order: CandidateOrder = {
        id: 'ord-1',
        status: OrderStatus.COMPLETED,
        createdAt: createVnDate(2027, 2, 20),
        total: 20_000_000,
        items: [{ isSample: false, orderedGrams: 500_000 }],
      }
      const cancelOrder: CandidateOrder = {
        id: 'ord-cancel',
        status: OrderStatus.CANCELLED,
        cancelledBy: CancelActor.CUSTOMER,
        createdAt: createVnDate(2027, 2, 25),
        total: 5_000_000,
        items: [],
      }

      const decision = evaluateCustomerQuarterlyMembership({
        userId: 'user-new',
        userCreatedAt,
        currentTier: null,
        hasPriorEvaluationLogs: false,
        orders: [order, cancelOrder],
        targetQuarterCode: '2027-Q1',
      })

      expect(decision.action).toBe('EVALUATE')
      expect(decision.multiplierApplied).toBe(1.1)
      // Doanh thu nhân 1.1: 20tr * 1.1 = 22tr
      expect(decision.kpiInput?.netRevenueVnd).toBe(22_000_000)
      // Sản lượng nhân 1.1: 500kg * 1.1 = 550kg
      expect(decision.kpiInput?.eligibleVolumeKg).toBe(550)
      // Điểm kỷ luật: phạt đúng 20 điểm (100 - 20 = 80 -> reliability 8đ, không bị nhân 1.1)
      expect(decision.kpiResult?.disciplineScore).toBe(80)
      expect(decision.kpiResult?.reliabilityScore).toBe(8)
    })
  })

  describe('Group C — Carryover 15 Days Policy', () => {
    it('kiểm tra chính xác mốc 15 ngày cuối của quý (tháng 3 có 31 ngày)', () => {
      // 16/03: ngày thứ 16 tính từ đầu tháng -> còn 16 ngày -> KHÔNG bảo lưu
      expect(isRegistrationInCarryoverWindow(createVnDate(2027, 3, 16, 23, 59, 59), 2027, 1)).toBe(false)

      // 17/03: ngày bắt đầu của 15 ngày cuối (31 - 15 + 1 = 17) -> BẢO LƯU
      expect(isRegistrationInCarryoverWindow(createVnDate(2027, 3, 17, 0, 0, 0), 2027, 1)).toBe(true)

      // 20/03 -> BẢO LƯU
      expect(isRegistrationInCarryoverWindow(createVnDate(2027, 3, 20, 14, 0, 0), 2027, 1)).toBe(true)

      // 31/03 -> BẢO LƯU
      expect(isRegistrationInCarryoverWindow(createVnDate(2027, 3, 31, 23, 59, 59), 2027, 1)).toBe(true)
    })

    it('tính đúng 15 ngày cuối cho các quý có độ dài khác nhau (Q2 kết thúc 30/06)', () => {
      // Tháng 6 có 30 ngày: 30 - 15 + 1 = 16 -> 16/06 là mốc bắt đầu
      expect(isRegistrationInCarryoverWindow(createVnDate(2027, 6, 15, 23, 59), 2027, 2)).toBe(false)
      expect(isRegistrationInCarryoverWindow(createVnDate(2027, 6, 16, 0, 0), 2027, 2)).toBe(true)
      expect(isRegistrationInCarryoverWindow(createVnDate(2027, 6, 30, 20, 0), 2027, 2)).toBe(true)
    })

    it('Khách A đăng ký 20/03/2027: Bị bỏ qua xét hạng vào 01/04/2027 (CARRYOVER_SKIP)', () => {
      const userCreatedAt = createVnDate(2027, 3, 20, 10, 0, 0)
      const q1Order: CandidateOrder = {
        id: 'ord-q1',
        status: OrderStatus.COMPLETED,
        createdAt: createVnDate(2027, 3, 22),
        total: 10_000_000,
        items: [{ isSample: false, orderedGrams: 200_000 }],
      }

      const decision = evaluateCustomerQuarterlyMembership({
        userId: 'user-a',
        userCreatedAt,
        currentTier: null,
        hasPriorEvaluationLogs: false,
        orders: [q1Order],
        targetQuarterCode: '2027-Q1', // Đang xét vào ngày 01/04/2027
      })

      expect(decision.action).toBe('CARRYOVER_SKIP')
      expect(decision.reason).toContain('Tự động bảo lưu dữ liệu sang kỳ đánh giá tiếp theo')
      expect(decision.newTier).toBe(MembershipTier.BRONZE) // Giữ nguyên Bronze
    })

    it('Khách A đăng ký 20/03/2027: Được xét hạng lần đầu vào 01/07/2027 với dữ liệu Q1 (×1.2) + Q2 (×1.0)', () => {
      const userCreatedAt = createVnDate(2027, 3, 20, 10, 0, 0)

      // Giai đoạn 1: Q1 (20/03 - 31/03)
      const q1Order: CandidateOrder = {
        id: 'ord-q1',
        status: OrderStatus.COMPLETED,
        createdAt: createVnDate(2027, 3, 25), // Tuần 1
        total: 20_000_000,
        items: [{ isSample: false, orderedGrams: 500_000 }], // 500kg
      }

      // Giai đoạn 2: Q2 (01/04 - 30/06)
      const q2Order1: CandidateOrder = {
        id: 'ord-q2-1',
        status: OrderStatus.COMPLETED,
        createdAt: createVnDate(2027, 4, 10), // Tuần 2
        total: 30_000_000,
        items: [{ isSample: false, orderedGrams: 800_000 }], // 800kg
      }
      const q2Order2: CandidateOrder = {
        id: 'ord-q2-2',
        status: OrderStatus.COMPLETED,
        createdAt: createVnDate(2027, 5, 12), // Tuần 3
        total: 20_000_000,
        items: [{ isSample: false, orderedGrams: 500_000 }], // 500kg
      }

      const decision = evaluateCustomerQuarterlyMembership({
        userId: 'user-a',
        userCreatedAt,
        currentTier: MembershipTier.BRONZE,
        hasPriorEvaluationLogs: false, // Chưa từng có log nào trước đó
        orders: [q1Order, q2Order1, q2Order2],
        targetQuarterCode: '2027-Q2', // Xét vào ngày 01/07/2027
      })

      expect(decision.action).toBe('EVALUATE')
      expect(decision.reason).toContain('Đánh giá lần đầu với dữ liệu bảo lưu 15 ngày cuối 2027-Q1 (×1.2)')

      // Doanh thu kết hợp = (20tr * 1.2) + ((30tr + 20tr) * 1.0) = 24tr + 50tr = 74.000.000 VND
      expect(decision.kpiInput?.netRevenueVnd).toBe(74_000_000)

      // Sản lượng kết hợp = (500kg * 1.2) + ((800kg + 500kg) * 1.0) = 600kg + 1300kg = 1.900 kg
      expect(decision.kpiInput?.eligibleVolumeKg).toBe(1900)

      // Tuần active kết hợp: 3 tuần riêng biệt
      expect(decision.kpiInput?.activeWeeks).toBe(3)

      // Điểm kỷ luật: 100 điểm gốc duy nhất (không cộng trùng)
      expect(decision.kpiResult?.disciplineScore).toBe(100)
      expect(decision.kpiResult?.reliabilityScore).toBe(10)
    })
  })

  describe('Group D — Membership Tier Evaluation & Transitions', () => {
    it('chuyển hạng từ Bronze lên Silver khi điểm từ 40 đến 69', () => {
      // 40tr (20đ) + 1.000kg (15đ) + 4 tuần (10đ) + kỷ luật 100 (10đ) = 55đ -> SILVER
      const decision = evaluateCustomerQuarterlyMembership({
        userId: 'u1',
        userCreatedAt: createVnDate(2026, 1, 1),
        currentTier: MembershipTier.BRONZE,
        hasPriorEvaluationLogs: true,
        orders: [
          {
            id: 'o1',
            status: OrderStatus.COMPLETED,
            createdAt: createVnDate(2027, 4, 10),
            total: 40_000_000,
            items: [{ isSample: false, orderedGrams: 1_000_000 }],
          },
        ],
        targetQuarterCode: '2027-Q2',
      })
      expect(decision.newTier).toBe(MembershipTier.SILVER)
    })

    it('chuyển hạng từ Gold lên Diamond khi điểm >= 90', () => {
      // 80tr (40đ) + 2.000kg (30đ) + 8 tuần (20đ) + kỷ luật 100 (10đ) = 100đ -> DIAMOND
      const orders: CandidateOrder[] = []
      // Tạo 8 đơn trong 8 tuần khác nhau
      for (let w = 1; w <= 8; w++) {
        orders.push({
          id: `ord-w${w}`,
          status: OrderStatus.COMPLETED,
          createdAt: createVnDate(2027, 4, w * 7),
          total: 10_000_000,
          items: [{ isSample: false, orderedGrams: 250_000 }],
        })
      }

      const decision = evaluateCustomerQuarterlyMembership({
        userId: 'u2',
        userCreatedAt: createVnDate(2025, 1, 1),
        currentTier: MembershipTier.GOLD,
        hasPriorEvaluationLogs: true,
        orders,
        targetQuarterCode: '2027-Q2',
      })
      expect(decision.kpiResult?.totalScore).toBe(100)
      expect(decision.newTier).toBe(MembershipTier.DIAMOND)
    })

    it('giáng hạng từ Diamond xuống Bronze khi không phát sinh đơn trong quý', () => {
      const decision = evaluateCustomerQuarterlyMembership({
        userId: 'u3',
        userCreatedAt: createVnDate(2025, 1, 1),
        currentTier: MembershipTier.DIAMOND,
        hasPriorEvaluationLogs: true,
        orders: [], // 0 đơn trong quý
        targetQuarterCode: '2027-Q2',
      })
      // Điểm: 0 + 0 + 0 + 10 (kỷ luật) = 10đ -> BRONZE
      expect(decision.kpiResult?.totalScore).toBe(10)
      expect(decision.newTier).toBe(MembershipTier.BRONZE)
    })
  })

  describe('Group E — Service Idempotency & Concurrency Safety', () => {
    it('không đánh giá trùng lặp nếu người dùng đã có log trong quý đó', async () => {
      mockDb.user.findMany.mockResolvedValue([
        {
          id: 'user-already',
          role: 'CUSTOMER',
          createdAt: createVnDate(2026, 1, 1),
          membershipTier: 'SILVER',
          orders: [],
          membershipLogs: [
            {
              id: 'log-1',
              evaluationQuarter: '2027-Q1',
              evaluatedAt: new Date(),
            },
          ],
        },
      ])

      const result = await runQuarterlyEvaluation({
        evaluationQuarter: '2027-Q1',
      })

      expect(result.success).toBe(true)
      expect(result.alreadyEvaluatedCount).toBe(1)
      expect(result.evaluatedCount).toBe(0)
      expect(mockDb.$transaction).not.toHaveBeenCalled()
    })

    it('xử lý an toàn khi xảy ra race condition (P2002 Unique Constraint Violation)', async () => {
      mockDb.user.findMany.mockResolvedValue([
        {
          id: 'user-race',
          role: 'CUSTOMER',
          createdAt: createVnDate(2026, 1, 1),
          membershipTier: 'BRONZE',
          orders: [],
          membershipLogs: [],
        },
      ])

      // Giả lập transaction ném lỗi P2002 do tiến trình song song vừa insert log trước
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (userId, evaluationQuarter)',
        { code: 'P2002', clientVersion: '6.4.1' }
      )
      mockDb.$transaction.mockRejectedValue(p2002Error)

      const result = await runQuarterlyEvaluation({
        evaluationQuarter: '2027-Q1',
      })

      expect(result.success).toBe(true)
      expect(result.alreadyEvaluatedCount).toBe(1)
      expect(result.evaluatedCount).toBe(0)
    })

    it('không để kết quả đánh giá của quý cũ ghi đè lên hạng của quý mới hơn', async () => {
      mockDb.user.findMany.mockResolvedValue([
        {
          id: 'user-older-eval',
          role: 'CUSTOMER',
          createdAt: createVnDate(2026, 1, 1),
          membershipTier: 'DIAMOND', // Đã lên Diamond ở Q2
          orders: [],
          membershipLogs: [
            {
              id: 'log-q2',
              evaluationQuarter: '2027-Q2',
              evaluatedAt: new Date(),
            },
          ],
        },
      ])

      let userUpdated = false
      mockDb.$transaction.mockImplementation(async (callback) => {
        const txMock = {
          membershipEvaluationLog: {
            findUnique: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue([{ id: 'log-q2', evaluationQuarter: '2027-Q2' }]), // Có log Q2 mới hơn
            create: vi.fn().mockResolvedValue({ id: 'new-log' }),
          },
          user: {
            update: vi.fn().mockImplementation(() => {
              userUpdated = true
            }),
          },
        }
        return callback(txMock)
      })

      const result = await runQuarterlyEvaluation({
        evaluationQuarter: '2027-Q1', // Chạy bù quý 1 cũ
      })

      expect(result.success).toBe(true)
      expect(result.evaluatedCount).toBe(1)
      // Log Q1 được ghi nhận nhưng user.update KHÔNG được gọi để giữ nguyên hạng Diamond của Q2
      expect(userUpdated).toBe(false)
    })
  })

  describe('Group F — Financial Integrity & Business Edge Cases', () => {
    it('đơn hàng CANCELLED hoàn toàn không được tính vào doanh thu hoặc sản lượng', () => {
      const cancelledOrder: CandidateOrder = {
        id: 'ord-canc',
        status: OrderStatus.CANCELLED,
        cancelledBy: CancelActor.CUSTOMER,
        createdAt: createVnDate(2027, 4, 15),
        total: 50_000_000,
        items: [{ isSample: false, orderedGrams: 1_000_000 }],
      }

      expect(isOrderEligibleForKpi(cancelledOrder)).toBe(false)
      expect(getOrderNetRevenue(cancelledOrder)).toBe(0)
      expect(getOrderEligibleVolumeKg(cancelledOrder)).toBe(0)
    })

    it('đơn hàng đang có khiếu nại OPEN bị tạm giữ, không được ghi nhận KPI', () => {
      const openDisputeOrder: CandidateOrder = {
        id: 'ord-dispute',
        status: OrderStatus.COMPLETED,
        createdAt: createVnDate(2027, 4, 15),
        total: 30_000_000,
        items: [{ isSample: false, orderedGrams: 500_000 }],
        complaints: [{ status: ComplaintStatus.OPEN }],
      }

      expect(isOrderEligibleForKpi(openDisputeOrder)).toBe(false)
      expect(getOrderNetRevenue(openDisputeOrder)).toBe(0)
      expect(getOrderEligibleVolumeKg(openDisputeOrder)).toBe(0)
    })

    it('đơn hàng có khiếu nại RESOLVED bồi hoàn tiền (REFUND) được trừ chính xác', () => {
      const resolvedRefundOrder: CandidateOrder = {
        id: 'ord-refund',
        status: OrderStatus.COMPLETED,
        createdAt: createVnDate(2027, 4, 15),
        total: 10_000_000,
        items: [{ isSample: false, orderedGrams: 200_000 }],
        complaints: [
          {
            status: ComplaintStatus.RESOLVED,
            resolution: Resolution.REFUND,
            compensation: 2_000_000, // Đã bồi hoàn 2 triệu
          },
        ],
      }

      expect(isOrderEligibleForKpi(resolvedRefundOrder)).toBe(true)
      // Doanh thu thuần = 10tr - 2tr = 8tr
      expect(getOrderNetRevenue(resolvedRefundOrder)).toBe(8_000_000)
    })

    it('đơn hàng hủy do quá hạn thanh toán 10 phút bị nhận diện chính xác và trừ điểm kỷ luật', () => {
      const expiredOrder: CandidateOrder = {
        id: 'ord-exp',
        status: OrderStatus.CANCELLED,
        cancelledBy: CancelActor.SYSTEM,
        cancelReason: 'Quá hạn giữ chỗ thanh toán 10 phút mà hệ thống chưa nhận được tiền',
        createdAt: createVnDate(2027, 4, 15),
        total: 10_000_000,
        items: [],
      }

      const metrics = aggregateRawMetrics([expiredOrder], createVnDate(2027, 4, 1), createVnDate(2027, 7, 1))
      expect(metrics.customerPaymentExpirations).toBe(1)
      expect(metrics.rawRevenueVnd).toBe(0)
    })
  })
})
