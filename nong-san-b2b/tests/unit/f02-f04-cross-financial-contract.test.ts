import { describe, it, expect } from 'vitest'
import {
  OrderStatus,
  ComplaintStatus,
  ComplaintResolutionType,
  Resolution,
  CancelActor,
} from '@prisma/client'
import {
  isOrderEligibleForKpi,
  getOrderNetRevenue,
  getOrderEligibleVolumeKg,
  isCustomerCancelledOrder,
  isPaymentExpiredOrder,
  type CandidateOrder,
} from '@/lib/domain/membership-evaluation'
import { isActiveComplaintStatus } from '@/lib/domain/complaint-state'

/**
 * EV-F02-F04-INTEGRATION-01 — GATE 4 CROSS-FEATURE FINANCIAL CONTRACT TEST
 *
 * Kiểm chứng tính tương thích và bảo đảm hợp đồng tài chính giữa:
 * - F02: Two-Way Complaints & 48-Hour SLA (Đóng băng doanh thu, trạng thái OPEN/PROPOSED/UNDER_REVIEW/CUSTOMER_ACCEPTED)
 * - F04: Membership & Quarterly KPI (Doanh thu thuần, sản lượng hợp lệ, Metric 4 kỷ luật thanh toán)
 */
describe('EV-F02-F04 Cross-Feature Financial Contract Verification', () => {
  const baseOrderItems = [
    { isSample: false, orderedGrams: 50_000, actualGrams: 48_000 }, // 48 kg thực tế
    { isSample: true, orderedGrams: 2_000, actualGrams: 2_000 },    // Hàng mẫu: bỏ qua khỏi sản lượng
  ]

  describe('Contract 1 — Đóng băng KPI khi khiếu nại đang Active (OPEN, PROPOSED, UNDER_REVIEW)', () => {
    it('1.1. Khiếu nại OPEN -> KPI bị đóng băng hoàn toàn (0 đ, 0 kg)', () => {
      const order: CandidateOrder = {
        id: 'ord-open',
        status: OrderStatus.COMPLETED, // Kể cả trạng thái đơn COMPLETED
        total: 5_000_000,
        finalTotal: 4_800_000,
        createdAt: new Date('2027-02-15'),
        items: baseOrderItems,
        complaints: [
          {
            status: ComplaintStatus.OPEN,
            compensation: null,
          },
        ],
      }

      expect(isActiveComplaintStatus(ComplaintStatus.OPEN)).toBe(true)
      expect(isOrderEligibleForKpi(order)).toBe(false)
      expect(getOrderNetRevenue(order)).toBe(0)
      expect(getOrderEligibleVolumeKg(order)).toBe(0)
    })

    it('1.2. Đề xuất bồi thường PROPOSED chờ khách phản hồi 48h -> KPI tiếp tục bị đóng băng', () => {
      const order: CandidateOrder = {
        id: 'ord-proposed',
        status: OrderStatus.COMPLETED,
        total: 5_000_000,
        finalTotal: 4_800_000,
        createdAt: new Date('2027-02-15'),
        items: baseOrderItems,
        complaints: [
          {
            status: ComplaintStatus.PROPOSED,
            proposalType: ComplaintResolutionType.REFUND_MONEY,
            compensation: 500_000,
          },
        ],
      }

      expect(isActiveComplaintStatus(ComplaintStatus.PROPOSED)).toBe(true)
      expect(isOrderEligibleForKpi(order)).toBe(false)
      expect(getOrderNetRevenue(order)).toBe(0)
      expect(getOrderEligibleVolumeKg(order)).toBe(0)
    })

    it('1.3. Khách yêu cầu phúc tra UNDER_REVIEW -> KPI tiếp tục bị đóng băng', () => {
      const order: CandidateOrder = {
        id: 'ord-under-review',
        status: OrderStatus.COMPLETED,
        total: 5_000_000,
        finalTotal: 4_800_000,
        createdAt: new Date('2027-02-15'),
        items: baseOrderItems,
        complaints: [
          {
            status: ComplaintStatus.UNDER_REVIEW,
            proposalType: ComplaintResolutionType.REFUND_MONEY,
            compensation: null,
          },
        ],
      }

      expect(isActiveComplaintStatus(ComplaintStatus.UNDER_REVIEW)).toBe(true)
      expect(isOrderEligibleForKpi(order)).toBe(false)
      expect(getOrderNetRevenue(order)).toBe(0)
      expect(getOrderEligibleVolumeKg(order)).toBe(0)
    })
  })

  describe('Contract 2 — Refund PENDING không được ghi nhận sớm (Đơn giữ trạng thái COMPLAINT)', () => {
    it('2.1. Khách CUSTOMER_ACCEPTED hoàn tiền, Refund PENDING -> Đơn giữ COMPLAINT -> KPI đóng băng', () => {
      // Theo luồng F02 order-lifecycle: khi khách chấp thuận hoàn tiền nhưng Admin chưa confirmRefundDone(),
      // đơn hàng giữ nguyên status = COMPLAINT để chờ tất toán tiền mặt / ngân hàng.
      const order: CandidateOrder = {
        id: 'ord-pending-refund',
        status: OrderStatus.COMPLAINT,
        total: 5_000_000,
        finalTotal: 4_800_000,
        createdAt: new Date('2027-02-15'),
        items: baseOrderItems,
        complaints: [
          {
            status: ComplaintStatus.CUSTOMER_ACCEPTED,
            proposalType: ComplaintResolutionType.REFUND_MONEY,
            resolution: Resolution.REFUND,
            compensation: 800_000,
          },
        ],
      }

      expect(isOrderEligibleForKpi(order)).toBe(false)
      expect(getOrderNetRevenue(order)).toBe(0)
      expect(getOrderEligibleVolumeKg(order)).toBe(0)
    })
  })

  describe('Contract 3 — Quyết toán Refund DONE -> Đơn chuyển COMPLETED -> Doanh thu thuần trừ bồi thường', () => {
    it('3.1. Admin xác nhận hoàn tiền DONE (hoặc RESOLVED) -> Trừ bồi thường chính xác 1 lần', () => {
      // Đơn hàng hoàn tất: finalTotal 4.800.000 đ, bồi thường hoàn tiền 800.000 đ
      // Doanh thu thuần ghi nhận: 4.800.000 - 800.000 = 4.000.000 đ
      // Sản lượng ghi nhận: 48 kg (bỏ qua 2 kg hàng mẫu)
      const order: CandidateOrder = {
        id: 'ord-refund-done',
        status: OrderStatus.COMPLETED,
        total: 5_000_000,
        finalTotal: 4_800_000,
        createdAt: new Date('2027-02-15'),
        items: baseOrderItems,
        complaints: [
          {
            status: ComplaintStatus.CUSTOMER_ACCEPTED,
            proposalType: ComplaintResolutionType.REFUND_MONEY,
            resolution: Resolution.REFUND,
            compensation: 800_000,
          },
        ],
      }

      expect(isOrderEligibleForKpi(order)).toBe(true)
      expect(getOrderNetRevenue(order)).toBe(4_000_000)
      expect(getOrderEligibleVolumeKg(order)).toBe(48)
    })

    it('3.2. Khiếu nại kết thúc RESOLVED với REFUND -> Trừ đúng số tiền bồi thường', () => {
      const order: CandidateOrder = {
        id: 'ord-resolved-refund',
        status: OrderStatus.COMPLETED,
        total: 3_000_000,
        finalTotal: null, // Không cân lại -> dùng total gốc 3.000.000 đ
        createdAt: new Date('2027-02-20'),
        items: [{ isSample: false, orderedGrams: 30_000 }],
        complaints: [
          {
            status: ComplaintStatus.RESOLVED,
            resolution: Resolution.REFUND,
            compensation: 300_000,
          },
        ],
      }

      expect(isOrderEligibleForKpi(order)).toBe(true)
      expect(getOrderNetRevenue(order)).toBe(2_700_000)
      expect(getOrderEligibleVolumeKg(order)).toBe(30)
    })
  })

  describe('Contract 4 — Khách rút khiếu nại (WITHDRAWN) -> Doanh thu nguyên vẹn, không bị khấu trừ', () => {
    it('4.1. Khiếu nại WITHDRAWN -> compensation = 0 -> Doanh thu ghi nhận 100%', () => {
      const order: CandidateOrder = {
        id: 'ord-withdrawn',
        status: OrderStatus.COMPLETED,
        total: 2_000_000,
        finalTotal: 1_950_000,
        createdAt: new Date('2027-02-10'),
        items: [{ isSample: false, orderedGrams: 20_000, actualGrams: 19_500 }],
        complaints: [
          {
            status: ComplaintStatus.WITHDRAWN,
            compensation: 0,
            resolution: null,
          },
        ],
      }

      expect(isOrderEligibleForKpi(order)).toBe(true)
      expect(getOrderNetRevenue(order)).toBe(1_950_000)
      expect(getOrderEligibleVolumeKg(order)).toBe(19.5)
    })
  })

  describe('Contract 5 — Metric 4 (Kỷ luật thanh toán & Tỷ lệ hủy) KHÔNG bị phạt bởi khiếu nại', () => {
    it('5.1. Đơn có khiếu nại (kể cả đang tranh chấp) KHÔNG bị coi là đơn hủy do khách (isCustomerCancelledOrder = false)', () => {
      const complaintOrder: CandidateOrder = {
        id: 'ord-complaint-metric4',
        status: OrderStatus.COMPLAINT,
        total: 10_000_000,
        createdAt: new Date(),
        items: [],
        complaints: [{ status: ComplaintStatus.OPEN }],
      }

      expect(isCustomerCancelledOrder(complaintOrder)).toBe(false)
      expect(isPaymentExpiredOrder(complaintOrder)).toBe(false)
    })

    it('5.2. Đơn hoàn tất sau khiếu nại KHÔNG bị coi là vi phạm thanh toán', () => {
      const settledOrder: CandidateOrder = {
        id: 'ord-settled-metric4',
        status: OrderStatus.COMPLETED,
        total: 10_000_000,
        createdAt: new Date(),
        items: [],
        complaints: [{ status: ComplaintStatus.RESOLVED, resolution: Resolution.REFUND, compensation: 500_000 }],
      }

      expect(isCustomerCancelledOrder(settledOrder)).toBe(false)
      expect(isPaymentExpiredOrder(settledOrder)).toBe(false)
    })

    it('5.3. Chỉ đơn thực sự bị CANCELLED bởi CUSTOMER mới bị tính phạt vào Metric 4', () => {
      const cancelledOrder: CandidateOrder = {
        id: 'ord-cancelled',
        status: OrderStatus.CANCELLED,
        cancelledBy: CancelActor.CUSTOMER,
        total: 5_000_000,
        createdAt: new Date(),
        items: [],
      }

      expect(isCustomerCancelledOrder(cancelledOrder)).toBe(true)
    })
  })
})
