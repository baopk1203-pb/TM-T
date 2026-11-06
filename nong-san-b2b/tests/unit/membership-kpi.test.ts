import { describe, it, expect } from 'vitest'
import {
  BENCHMARK_NET_REVENUE_VND,
  BENCHMARK_VOLUME_KG,
  BENCHMARK_ACTIVE_WEEKS,
  MAX_REVENUE_SCORE,
  MAX_VOLUME_SCORE,
  MAX_FREQUENCY_SCORE,
  MAX_RELIABILITY_SCORE,
  BASE_DISCIPLINE_SCORE,
  PENALTY_CUSTOMER_CANCELLED_ORDER,
  PENALTY_PAYMENT_EXPIRATION,
  validateKpiInput,
  calculateRevenueScore,
  calculateVolumeScore,
  calculateFrequencyScore,
  calculateDisciplineScore,
  calculateReliabilityScore,
  calculateQuarterlyKpi,
  resolveMembershipTierFromKpi,
} from '@/lib/domain/membership-kpi'
import { MembershipTier } from '@/lib/domain/membership'

describe('F04 — Model B KPI Engine Domain Tests', () => {
  describe('Approved Benchmarks and Weights', () => {
    it('khai báo đúng các trọng số và benchmark PO đã phê duyệt', () => {
      expect(MAX_REVENUE_SCORE).toBe(40)
      expect(MAX_VOLUME_SCORE).toBe(30)
      expect(MAX_FREQUENCY_SCORE).toBe(20)
      expect(MAX_RELIABILITY_SCORE).toBe(10)

      expect(BENCHMARK_NET_REVENUE_VND).toBe(80_000_000)
      expect(BENCHMARK_VOLUME_KG).toBe(2_000)
      expect(BENCHMARK_ACTIVE_WEEKS).toBe(8)

      expect(BASE_DISCIPLINE_SCORE).toBe(100)
      expect(PENALTY_CUSTOMER_CANCELLED_ORDER).toBe(20)
      expect(PENALTY_PAYMENT_EXPIRATION).toBe(10)
    })
  })

  describe('Core Test Cases (TC01 - TC12)', () => {
    // TC01 — Perfect Score
    it('TC01: Đạt chỉ số hoàn hảo (100 điểm) -> Hạng Kim Cương (DIAMOND)', () => {
      const result = calculateQuarterlyKpi({
        netRevenueVnd: 80_000_000,
        eligibleVolumeKg: 2_000,
        activeWeeks: 8,
        customerCancelledOrders: 0,
        customerPaymentExpirations: 0,
      })

      expect(result.revenueScore).toBe(40)
      expect(result.volumeScore).toBe(30)
      expect(result.frequencyScore).toBe(20)
      expect(result.disciplineScore).toBe(100)
      expect(result.reliabilityScore).toBe(10)
      expect(result.rawTotalScore).toBe(100)
      expect(result.totalScore).toBe(100)
      expect(result.tier).toBe(MembershipTier.DIAMOND)
    })

    // TC02 — Partial Performance
    it('TC02: Đạt 50% chỉ số (40tr, 1.000kg, 4 tuần, 0 vi phạm) -> 55 điểm -> Hạng Bạc (SILVER)', () => {
      const result = calculateQuarterlyKpi({
        netRevenueVnd: 40_000_000,
        eligibleVolumeKg: 1_000,
        activeWeeks: 4,
        customerCancelledOrders: 0,
        customerPaymentExpirations: 0,
      })

      expect(result.revenueScore).toBe(20) // 40 * 0.5
      expect(result.volumeScore).toBe(15) // 30 * 0.5
      expect(result.frequencyScore).toBe(10) // 20 * 0.5
      expect(result.disciplineScore).toBe(100)
      expect(result.reliabilityScore).toBe(10) // 100 * 0.1
      expect(result.totalScore).toBe(55)
      expect(result.tier).toBe(MembershipTier.SILVER)
    })

    // TC03 — Revenue Above Benchmark
    it('TC03: Doanh thu vượt định mức (120tr > 80tr) thì điểm doanh thu không vượt quá 40', () => {
      const score = calculateRevenueScore(120_000_000)
      expect(score).toBe(40)

      const result = calculateQuarterlyKpi({
        netRevenueVnd: 250_000_000,
        eligibleVolumeKg: 1_000,
        activeWeeks: 4,
        customerCancelledOrders: 0,
        customerPaymentExpirations: 0,
      })
      expect(result.revenueScore).toBe(40)
    })

    // TC04 — Volume Above Benchmark
    it('TC04: Sản lượng vượt định mức (5.000kg > 2.000kg) thì điểm sản lượng không vượt quá 30', () => {
      const score = calculateVolumeScore(5_000)
      expect(score).toBe(30)

      const result = calculateQuarterlyKpi({
        netRevenueVnd: 40_000_000,
        eligibleVolumeKg: 10_000,
        activeWeeks: 4,
        customerCancelledOrders: 0,
        customerPaymentExpirations: 0,
      })
      expect(result.volumeScore).toBe(30)
    })

    // TC05 — Frequency Above Benchmark
    it('TC05: Tần suất vượt định mức (12 tuần active > 8) thì điểm tần suất không vượt quá 20', () => {
      const score = calculateFrequencyScore(12)
      expect(score).toBe(20)

      const result = calculateQuarterlyKpi({
        netRevenueVnd: 40_000_000,
        eligibleVolumeKg: 1_000,
        activeWeeks: 13,
        customerCancelledOrders: 0,
        customerPaymentExpirations: 0,
      })
      expect(result.frequencyScore).toBe(20)
    })

    // TC06 — Cancel Penalty
    it('TC06: Mỗi đơn khách hủy làm giảm 20 điểm kỷ luật', () => {
      const discipline = calculateDisciplineScore(1, 0)
      expect(discipline).toBe(80) // 100 - 20
      expect(calculateReliabilityScore(discipline)).toBe(8)

      const discipline2 = calculateDisciplineScore(2, 0)
      expect(discipline2).toBe(60) // 100 - 40
      expect(calculateReliabilityScore(discipline2)).toBe(6)
    })

    // TC07 — Payment Expiration Penalty
    it('TC07: Mỗi đơn quá hạn thanh toán làm giảm 10 điểm kỷ luật', () => {
      const discipline = calculateDisciplineScore(0, 1)
      expect(discipline).toBe(90) // 100 - 10
      expect(calculateReliabilityScore(discipline)).toBe(9)

      const discipline3 = calculateDisciplineScore(0, 3)
      expect(discipline3).toBe(70) // 100 - 30
      expect(calculateReliabilityScore(discipline3)).toBe(7)
    })

    // TC08 — Multiple Violations
    it('TC08: Nhiều vi phạm kết hợp không làm điểm kỷ luật bị âm (kẹp tối thiểu là 0)', () => {
      // 5 đơn hủy (-100) + 2 đơn quá hạn (-20) -> tổng phạt 120 điểm
      const discipline = calculateDisciplineScore(5, 2)
      expect(discipline).toBe(0)
      expect(calculateReliabilityScore(discipline)).toBe(0)

      // Vi phạm cực lớn: 10 đơn hủy và 20 đơn quá hạn
      const disciplineSevere = calculateDisciplineScore(10, 20)
      expect(disciplineSevere).toBe(0)
      expect(calculateReliabilityScore(disciplineSevere)).toBe(0)

      const result = calculateQuarterlyKpi({
        netRevenueVnd: 80_000_000,
        eligibleVolumeKg: 2_000,
        activeWeeks: 8,
        customerCancelledOrders: 10,
        customerPaymentExpirations: 10,
      })
      expect(result.disciplineScore).toBe(0)
      expect(result.reliabilityScore).toBe(0)
      expect(result.totalScore).toBe(90) // 40 + 30 + 20 + 0
      expect(result.tier).toBe(MembershipTier.DIAMOND)
    })

    // TC09 — Invalid Input
    it('TC09: Từ chối các dữ liệu âm, NaN, Infinity và dữ liệu thiếu', () => {
      // Giá trị âm
      expect(
        validateKpiInput({
          netRevenueVnd: -10_000,
          eligibleVolumeKg: 100,
          activeWeeks: 1,
          customerCancelledOrders: 0,
          customerPaymentExpirations: 0,
        }).valid
      ).toBe(false)

      expect(
        validateKpiInput({
          netRevenueVnd: 10_000,
          eligibleVolumeKg: -5,
          activeWeeks: 1,
          customerCancelledOrders: 0,
          customerPaymentExpirations: 0,
        }).valid
      ).toBe(false)

      // NaN hoặc Infinity
      expect(
        validateKpiInput({
          netRevenueVnd: NaN,
          eligibleVolumeKg: 100,
          activeWeeks: 1,
          customerCancelledOrders: 0,
          customerPaymentExpirations: 0,
        }).valid
      ).toBe(false)

      expect(
        validateKpiInput({
          netRevenueVnd: 10_000,
          eligibleVolumeKg: Infinity,
          activeWeeks: 1,
          customerCancelledOrders: 0,
          customerPaymentExpirations: 0,
        }).valid
      ).toBe(false)

      // Thiếu trường dữ liệu
      expect(
        validateKpiInput({
          netRevenueVnd: 10_000,
          eligibleVolumeKg: 100,
          activeWeeks: 1,
        }).valid
      ).toBe(false)

      // Số thập phân ở trường yêu cầu số nguyên (activeWeeks, cancelledOrders)
      expect(
        validateKpiInput({
          netRevenueVnd: 10_000,
          eligibleVolumeKg: 100,
          activeWeeks: 2.5,
          customerCancelledOrders: 0,
          customerPaymentExpirations: 0,
        }).valid
      ).toBe(false)

      // Hàm calculateQuarterlyKpi phải ném lỗi khi input không hợp lệ
      expect(() =>
        calculateQuarterlyKpi({
          netRevenueVnd: -500,
          eligibleVolumeKg: 100,
          activeWeeks: 1,
          customerCancelledOrders: 0,
          customerPaymentExpirations: 0,
        })
      ).toThrow()
    })

    // TC10 — Tier Boundary
    it('TC10: Kiểm tra chuyển hạng chính xác tại các ngưỡng biên (39, 40, 69, 70, 89, 90)', () => {
      // 39 điểm -> Bronze
      expect(resolveMembershipTierFromKpi(39)).toBe(MembershipTier.BRONZE)
      // 40 điểm -> Silver
      expect(resolveMembershipTierFromKpi(40)).toBe(MembershipTier.SILVER)
      // 69 điểm -> Silver
      expect(resolveMembershipTierFromKpi(69)).toBe(MembershipTier.SILVER)
      // 70 điểm -> Gold
      expect(resolveMembershipTierFromKpi(70)).toBe(MembershipTier.GOLD)
      // 89 điểm -> Gold
      expect(resolveMembershipTierFromKpi(89)).toBe(MembershipTier.GOLD)
      // 90 điểm -> Diamond
      expect(resolveMembershipTierFromKpi(90)).toBe(MembershipTier.DIAMOND)

      // Mô phỏng input chính xác để rơi vào ngưỡng 39 và 40
      // 40tr (20đ) + 800kg (12đ) + 0 tuần (0đ) + kỷ luật 70 (7đ) = 39 điểm -> BRONZE
      const result39 = calculateQuarterlyKpi({
        netRevenueVnd: 40_000_000,
        eligibleVolumeKg: 800,
        activeWeeks: 0,
        customerCancelledOrders: 1,
        customerPaymentExpirations: 1, // 100 - 20 - 10 = 70 -> 7đ
      })
      expect(result39.totalScore).toBe(39)
      expect(result39.tier).toBe(MembershipTier.BRONZE)

      // Tăng thêm 1 tuần active (2.5đ) -> 20 + 12 + 2.5 + 7 = 41.5 -> round = 42 -> SILVER
      // Để đạt đúng 40 điểm: 20tr (10đ) + 1.000kg (15đ) + 2 tuần (5đ) + kỷ luật 100 (10đ) = 40đ -> SILVER
      const result40 = calculateQuarterlyKpi({
        netRevenueVnd: 20_000_000,
        eligibleVolumeKg: 1_000,
        activeWeeks: 2,
        customerCancelledOrders: 0,
        customerPaymentExpirations: 0,
      })
      expect(result40.totalScore).toBe(40)
      expect(result40.tier).toBe(MembershipTier.SILVER)
    })

    // TC11 — Deterministic Calculation
    it('TC11: Tính toán có tính đơn định (Deterministic) — cùng input luôn ra cùng kết quả', () => {
      const input = {
        netRevenueVnd: 55_000_000,
        eligibleVolumeKg: 1_450,
        activeWeeks: 6,
        customerCancelledOrders: 1,
        customerPaymentExpirations: 2,
      }

      const res1 = calculateQuarterlyKpi(input)
      const res2 = calculateQuarterlyKpi(input)

      expect(res1).toEqual(res2)
      expect(res1.totalScore).toBe(res2.totalScore)
      expect(res1.tier).toBe(res2.tier)
    })

    // TC12 — No Database Side Effects
    it('TC12: Hàm tính điểm thuần túy không làm thay đổi (mutate) đối tượng input', () => {
      const input = Object.freeze({
        netRevenueVnd: 60_000_000,
        eligibleVolumeKg: 1_500,
        activeWeeks: 5,
        customerCancelledOrders: 0,
        customerPaymentExpirations: 1,
      })

      // Object.freeze đảm bảo nếu hàm có bất kỳ phép ghi đè thuộc tính nào sẽ ném TypeError
      expect(() => calculateQuarterlyKpi(input)).not.toThrow()
      const res = calculateQuarterlyKpi(input)
      expect(res.totalScore).toBeGreaterThan(0)
    })
  })

  describe('Edge Cases and Rounding', () => {
    it('làm tròn đúng quy tắc Math.round cho tổng điểm số thực', () => {
      // 10tr (5đ) + 333kg (4.995đ) + 1 tuần (2.5đ) + kỷ luật 100 (10đ) = 22.495 -> round = 22
      const resLow = calculateQuarterlyKpi({
        netRevenueVnd: 10_000_000,
        eligibleVolumeKg: 333,
        activeWeeks: 1,
        customerCancelledOrders: 0,
        customerPaymentExpirations: 0,
      })
      expect(resLow.totalScore).toBe(22)

      // 10tr (5đ) + 340kg (5.1đ) + 1 tuần (2.5đ) + kỷ luật 100 (10đ) = 22.6 -> round = 23
      const resHigh = calculateQuarterlyKpi({
        netRevenueVnd: 10_000_000,
        eligibleVolumeKg: 340,
        activeWeeks: 1,
        customerCancelledOrders: 0,
        customerPaymentExpirations: 0,
      })
      expect(resHigh.totalScore).toBe(23)
    })

    it('xử lý khách hàng mới chưa có đơn nào (0 doanh thu, 0 kg, 0 tuần, 0 vi phạm) -> 10 điểm (kỷ luật) -> Hạng Đồng', () => {
      const resZero = calculateQuarterlyKpi({
        netRevenueVnd: 0,
        eligibleVolumeKg: 0,
        activeWeeks: 0,
        customerCancelledOrders: 0,
        customerPaymentExpirations: 0,
      })
      expect(resZero.revenueScore).toBe(0)
      expect(resZero.volumeScore).toBe(0)
      expect(resZero.frequencyScore).toBe(0)
      expect(resZero.disciplineScore).toBe(100)
      expect(resZero.reliabilityScore).toBe(10)
      expect(resZero.totalScore).toBe(10)
      expect(resZero.tier).toBe(MembershipTier.BRONZE)
    })
  })
})
