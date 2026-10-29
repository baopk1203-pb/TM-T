import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  VIETNAMESE_TIER_NAMES,
  getTierDisplayName,
  getTierStatusLabel,
  formatQuarterDisplayName,
  getMembershipBenefitsTable,
  getNextEvaluationSchedule,
  formatEvaluationLogItem,
} from '@/lib/domain/membership-presentation'
import { MembershipTier } from '@/lib/domain/membership'
import { createVnDate } from '@/lib/domain/membership-evaluation'

// Mock database for Server Query tests
const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    membershipEvaluationLog: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}))

vi.mock('@/lib/db', () => ({
  db: mockDb,
}))

import { getMembershipDashboardData } from '@/lib/server/membership-dashboard'

describe('F04-04 — Membership Dashboard & Safe Data Access Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('TC01 - TC04: Hiển thị tên 4 hạng bằng tiếng Việt', () => {
    it('TC01: Hiển thị hạng BRONZE là "Đồng"', () => {
      expect(VIETNAMESE_TIER_NAMES[MembershipTier.BRONZE]).toBe('Đồng')
      expect(getTierDisplayName(MembershipTier.BRONZE)).toBe('Đồng')
      expect(getTierStatusLabel(MembershipTier.BRONZE, true)).toBe('Hạng Đồng')
    })

    it('TC02: Hiển thị hạng SILVER là "Bạc"', () => {
      expect(VIETNAMESE_TIER_NAMES[MembershipTier.SILVER]).toBe('Bạc')
      expect(getTierDisplayName(MembershipTier.SILVER)).toBe('Bạc')
      expect(getTierStatusLabel(MembershipTier.SILVER, true)).toBe('Hạng Bạc')
    })

    it('TC03: Hiển thị hạng GOLD là "Vàng"', () => {
      expect(VIETNAMESE_TIER_NAMES[MembershipTier.GOLD]).toBe('Vàng')
      expect(getTierDisplayName(MembershipTier.GOLD)).toBe('Vàng')
      expect(getTierStatusLabel(MembershipTier.GOLD, true)).toBe('Hạng Vàng')
    })

    it('TC04: Hiển thị hạng DIAMOND là "Kim Cương"', () => {
      expect(VIETNAMESE_TIER_NAMES[MembershipTier.DIAMOND]).toBe('Kim Cương')
      expect(getTierDisplayName(MembershipTier.DIAMOND)).toBe('Kim Cương')
      expect(getTierStatusLabel(MembershipTier.DIAMOND, true)).toBe('Hạng Kim Cương')
    })
  })

  describe('TC05 - TC08: Bảng quyền lợi & Điều kiện chính sách PO đã duyệt', () => {
    const table = getMembershipBenefitsTable(MembershipTier.SILVER)

    it('TC05: Hiển thị chính xác quyền lợi chiết khấu và giảm phí ship từng hạng', () => {
      const bronze = table.find((r) => r.tier === MembershipTier.BRONZE)!
      expect(bronze.name).toBe('Đồng')
      expect(bronze.productDiscountPercent).toBe(2)
      expect(bronze.shippingDiscountPercent).toBe(5)
      expect(bronze.scoreRange).toBe('0 – 39 điểm')

      const silver = table.find((r) => r.tier === MembershipTier.SILVER)!
      expect(silver.name).toBe('Bạc')
      expect(silver.productDiscountPercent).toBe(3)
      expect(silver.shippingDiscountPercent).toBe(10)
      expect(silver.scoreRange).toBe('40 – 69 điểm')

      const gold = table.find((r) => r.tier === MembershipTier.GOLD)!
      expect(gold.name).toBe('Vàng')
      expect(gold.productDiscountPercent).toBe(4)
      expect(gold.shippingDiscountPercent).toBe(15)
      expect(gold.scoreRange).toBe('70 – 89 điểm')

      const diamond = table.find((r) => r.tier === MembershipTier.DIAMOND)!
      expect(diamond.name).toBe('Kim Cương')
      expect(diamond.productDiscountPercent).toBe(5)
      expect(diamond.shippingDiscountPercent).toBe(20)
      expect(diamond.scoreRange).toBe('90 – 100 điểm')
    })

    it('TC06: Đánh dấu đúng hạng hiện tại của khách hàng trong bảng quyền lợi', () => {
      const silverRow = table.find((r) => r.tier === MembershipTier.SILVER)!
      expect(silverRow.isCurrent).toBe(true)
      const bronzeRow = table.find((r) => r.tier === MembershipTier.BRONZE)!
      expect(bronzeRow.isCurrent).toBe(false)
    })

    it('TC07: Định dạng quý hiển thị tiếng Việt chính xác', () => {
      expect(formatQuarterDisplayName('2027-Q1')).toBe('Quý I/2027')
      expect(formatQuarterDisplayName('2027-Q2')).toBe('Quý II/2027')
      expect(formatQuarterDisplayName('2027-Q3')).toBe('Quý III/2027')
      expect(formatQuarterDisplayName('2027-Q4')).toBe('Quý IV/2027')
    })

    it('TC08: Mốc xét hạng tiếp theo và thông báo bảo lưu 15 ngày cuối quý', () => {
      // Khách đăng ký giữa quý (10/02/2027) -> Kỳ tiếp theo là 01/04/2027
      const scheduleNormal = getNextEvaluationSchedule(
        createVnDate(2027, 2, 15),
        createVnDate(2027, 2, 10),
        false
      )
      expect(scheduleNormal.nextEvaluationDateText).toBe('01/04/2027')
      expect(scheduleNormal.isCarryoverUser).toBe(false)

      // Khách đăng ký trong 15 ngày cuối Q1 (20/03/2027) -> Kỳ tiếp theo là 01/07/2027
      const scheduleCarryover = getNextEvaluationSchedule(
        createVnDate(2027, 3, 25),
        createVnDate(2027, 3, 20),
        false
      )
      expect(scheduleCarryover.isCarryoverUser).toBe(true)
      expect(scheduleCarryover.nextEvaluationDateText).toBe('01/07/2027')
      expect(scheduleCarryover.carryoverMessage).toContain('bảo lưu sang kỳ đánh giá ngày 01/07/2027')
    })
  })

  describe('TC09 - TC14: Server Read-Only Query & Security Controls', () => {
    it('TC09: Khách chưa được đánh giá không thấy điểm KPI giả (latestEvaluation = null)', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        id: 'user-new',
        fullName: 'Nguyễn Văn Mới',
        createdAt: createVnDate(2027, 2, 10),
        membershipTier: null,
        tierUpdatedAt: null,
      })
      mockDb.membershipEvaluationLog.findMany.mockResolvedValue([])

      const data = await getMembershipDashboardData('user-new')
      expect(data).not.toBeNull()
      expect(data?.latestEvaluation).toBeNull() // KHÔNG hiển thị điểm KPI giả
      expect(data?.history).toEqual([]) // Lịch sử rỗng
      expect(data?.tierDisplayName).toBe('Đồng') // Mặc định hiển thị Đồng
      expect(data?.tierStatusLabel).toContain('Chờ kỳ xét hạng đầu tiên')
    })

    it('TC10: Lịch sử đánh giá được sắp xếp đúng thời gian mới nhất trước', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        id: 'user-vip',
        fullName: 'Công Ty Nông Sản VIP',
        createdAt: createVnDate(2026, 1, 1),
        membershipTier: MembershipTier.GOLD,
        tierUpdatedAt: createVnDate(2027, 4, 1),
      })
      mockDb.membershipEvaluationLog.findMany.mockResolvedValue([
        {
          id: 'log-q1',
          userId: 'user-vip',
          evaluationQuarter: '2027-Q1',
          score: 85,
          previousTier: MembershipTier.SILVER,
          newTier: MembershipTier.GOLD,
          evaluatedAt: createVnDate(2027, 4, 1),
        },
        {
          id: 'log-q4',
          userId: 'user-vip',
          evaluationQuarter: '2026-Q4',
          score: 55,
          previousTier: MembershipTier.BRONZE,
          newTier: MembershipTier.SILVER,
          evaluatedAt: createVnDate(2027, 1, 1),
        },
      ])

      const data = await getMembershipDashboardData('user-vip')
      expect(data).not.toBeNull()
      expect(data?.latestEvaluation?.score).toBe(85)
      expect(data?.latestEvaluation?.quarterName).toBe('Quý I/2027')
      expect(data?.history.length).toBe(2)
      // Log đầu tiên là mới nhất
      expect(data?.history[0].quarterCode).toBe('2027-Q1')
      expect(data?.history[0].newTierName).toBe('Vàng')
      expect(data?.history[0].previousTierName).toBe('Bạc')
      // Log thứ hai là kỳ trước
      expect(data?.history[1].quarterCode).toBe('2026-Q4')
      expect(data?.history[1].newTierName).toBe('Bạc')
      expect(data?.history[1].previousTierName).toBe('Đồng')
    })

    it('TC11: Phân quyền chặt chẽ ở server: chỉ truy vấn dữ liệu của đúng userId', async () => {
      mockDb.user.findUnique.mockResolvedValue(null)

      // Khi client truyền userId rỗng hoặc không hợp lệ -> trả về null ngay
      const resNull = await getMembershipDashboardData('')
      expect(resNull).toBeNull()
      // @ts-expect-error test invalid type
      const resInvalid = await getMembershipDashboardData(undefined)
      expect(resInvalid).toBeNull()

      // Truy vấn DB đúng với userId được truyền vào từ server session
      await getMembershipDashboardData('user-specific-123')
      expect(mockDb.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-specific-123' },
      })
    })

    it('TC12: User không tồn tại trả về null; User mới không có log trả về mảng history rỗng []', async () => {
      mockDb.user.findUnique.mockResolvedValue(null)
      const nonExistent = await getMembershipDashboardData('non-existent-id')
      expect(nonExistent).toBeNull()

      mockDb.user.findUnique.mockResolvedValue({
        id: 'new-user-no-history',
        fullName: 'Khách Hàng Mới Chưa Có Lịch Sử',
        createdAt: createVnDate(2027, 2, 1),
        membershipTier: MembershipTier.BRONZE,
        tierUpdatedAt: null,
      })
      mockDb.membershipEvaluationLog.findMany.mockResolvedValue([])

      const result = await getMembershipDashboardData('new-user-no-history')
      expect(result).not.toBeNull()
      expect(result?.latestEvaluation).toBeNull()
      expect(result?.history).toEqual([])
    })

    it('TC13: Dữ liệu Membership nullable không gây lỗi hoặc crash', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        id: 'user-null-fields',
        fullName: 'Khách Hàng Null',
        createdAt: createVnDate(2027, 1, 1),
        membershipTier: null,
        tierUpdatedAt: null,
      })
      mockDb.membershipEvaluationLog.findMany.mockResolvedValue([
        {
          id: 'log-initial',
          userId: 'user-null-fields',
          evaluationQuarter: '2027-Q1',
          score: 30,
          previousTier: null, // Kỳ đầu tiên previousTier là null
          newTier: MembershipTier.BRONZE,
          evaluatedAt: createVnDate(2027, 4, 1),
        },
      ])

      const data = await getMembershipDashboardData('user-null-fields')
      expect(data).not.toBeNull()
      expect(data?.tierDisplayName).toBe('Đồng')
      expect(data?.history[0].previousTierName).toBe('Khởi tạo') // Null previousTier hiển thị là "Khởi tạo"
      expect(data?.history[0].newTierName).toBe('Đồng')
    })

    it('TC14: Không thực hiện bất kỳ thao tác ghi/sửa dữ liệu nào khi xem Dashboard', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        id: 'user-ro',
        fullName: 'Read Only User',
        createdAt: createVnDate(2027, 1, 1),
        membershipTier: MembershipTier.BRONZE,
        tierUpdatedAt: null,
      })
      mockDb.membershipEvaluationLog.findMany.mockResolvedValue([])

      await getMembershipDashboardData('user-ro')

      // Chỉ có findUnique và findMany được gọi, tuyệt đối không gọi update hoặc create
      expect(mockDb.user.update).not.toHaveBeenCalled()
      expect(mockDb.membershipEvaluationLog.create).not.toHaveBeenCalled()
    })

    it('TC16: Fail-safe resilience khi bảng MembershipEvaluationLog chưa tồn tại trên DB chưa migrate', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        id: 'user-unmigrated',
        fullName: 'Unmigrated User',
        createdAt: createVnDate(2027, 1, 1),
        membershipTier: MembershipTier.BRONZE,
        tierUpdatedAt: null,
      })
      // Giả lập lỗi PostgreSQL relation MembershipEvaluationLog does not exist
      mockDb.membershipEvaluationLog.findMany.mockRejectedValue(
        new Error('relation "MembershipEvaluationLog" does not exist')
      )

      const data = await getMembershipDashboardData('user-unmigrated')
      expect(data).not.toBeNull()
      expect(data?.history).toEqual([])
      expect(data?.latestEvaluation).toBeNull()
    })
  })

  describe('TC15: Định dạng bản ghi log lịch sử (formatEvaluationLogItem)', () => {
    it('chuyển đổi chuẩn xác log item với ngày giờ Việt Nam', () => {
      const item = formatEvaluationLogItem({
        id: 'log-item-1',
        evaluationQuarter: '2027-Q2',
        score: 74.8,
        previousTier: MembershipTier.BRONZE,
        newTier: MembershipTier.GOLD,
        evaluatedAt: createVnDate(2027, 7, 1),
      })

      expect(item.quarterName).toBe('Quý II/2027')
      expect(item.score).toBe(75) // Math.round
      expect(item.previousTierName).toBe('Đồng')
      expect(item.newTierName).toBe('Vàng')
      expect(item.evaluatedAtText).toBe('01/07/2027')
    })
  })
})
