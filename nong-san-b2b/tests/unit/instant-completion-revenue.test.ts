import { describe, it, expect } from 'vitest'
import {
  OrderStatus,
  OrderType,
  PaymentOption,
  ComplaintStatus,
  Resolution,
} from '@prisma/client'
import {
  canTransition,
  OrderStateSnapshot,
} from '@/lib/domain/order-state'
import {
  isOrderEligibleForRevenue,
  getOrderEligibleRevenue,
  computeRevenueTimeline,
  computeTopProducts,
  computeCashflowMetrics,
  ReportOrderInput,
} from '@/lib/domain/reports'
import {
  computeCustomerOrderStats,
  CustomerOrderSummaryInput,
} from '@/lib/domain/crm'
import { computeComplaintCompensation } from '@/lib/domain/settlement'

describe('PH9-00: Instant Order Completion & Complaint-Aware Revenue Tests (T1 - T11)', () => {
  const baseOrder: OrderStateSnapshot = {
    status: OrderStatus.SHIPPING,
    paymentOption: PaymentOption.FULL,
    total: 10000000,
    depositAmount: 10000000,
    finalTotal: 10000000,
    deliveredAt: null,
  }

  // T1. Xác nhận giao hàng -> Order hoàn thành ngay (COMPLETED)
  describe('T1: Instant Completion on Delivery Confirmation', () => {
    it('Admin chuyển từ SHIPPING sang COMPLETED trực tiếp khi đã nhập khối lượng thực tế', () => {
      const shippingOrder: OrderStateSnapshot = {
        ...baseOrder,
        status: OrderStatus.SHIPPING,
      }

      const res = canTransition(shippingOrder, OrderStatus.COMPLETED, 'SELLER', {
        hasActualGramsForAllLines: true,
      })
      expect(res.ok).toBe(true)
    })

    it('Chặn nếu chưa có khối lượng thực tế của các dòng khi hoàn thành từ SHIPPING', () => {
      const shippingOrder: OrderStateSnapshot = {
        ...baseOrder,
        status: OrderStatus.SHIPPING,
      }

      const res = canTransition(shippingOrder, OrderStatus.COMPLETED, 'SELLER', {
        hasActualGramsForAllLines: false,
      })
      expect(res.ok).toBe(false)
      expect(res.reason).toContain('khối lượng thực giao')
    })

    it('Admin chuyển từ DELIVERED sang COMPLETED ngay lập tức mà không phải chờ 24 giờ', () => {
      const deliveredAt = new Date('2026-10-20T10:00:00Z')
      const now = new Date('2026-10-20T10:05:00Z') // Chỉ mới 5 phút sau giao
      const deliveredOrder: OrderStateSnapshot = {
        ...baseOrder,
        status: OrderStatus.DELIVERED,
        deliveredAt,
      }

      const res = canTransition(deliveredOrder, OrderStatus.COMPLETED, 'SELLER', {
        now,
        paidAmount: 10000000,
        hasPendingRefund: false,
      })
      expect(res.ok).toBe(true)
    })
  })

  // T2. Đơn giao thành công -> xuất hiện trong báo cáo doanh thu ngay
  describe('T2: Immediate Revenue Recognition for Delivered/Completed Orders', () => {
    it('Đơn vừa COMPLETED không có khiếu nại được tính ngay vào doanh thu và timeline', () => {
      const order: ReportOrderInput = {
        id: 'ord-1',
        code: 'ORD-001',
        status: OrderStatus.COMPLETED,
        type: OrderType.STANDARD,
        createdAt: new Date('2026-10-20T08:00:00Z'),
        total: 5000000,
        finalTotal: 5000000,
        depositAmount: 5000000,
        paymentOption: PaymentOption.FULL,
        cancelledBy: null,
        cancelReason: null,
        user: {
          id: 'u-1',
          fullName: 'Khách Hàng Test',
          companyName: 'Công Ty ABC',
          group: { id: 'g-1', code: 'VIP', name: 'Khách VIP' },
        },
        items: [
          {
            id: 'item-1',
            productId: 'p-1',
            productName: 'Sầu riêng Ri6',
            isSample: false,
            quantity: 5,
            orderedGrams: 50000,
            actualGrams: 50000,
            unitPricePerKg: 100000,
            lineTotal: 5000000,
            finalLineTotal: 5000000,
          },
        ],
        complaints: [],
      }

      expect(isOrderEligibleForRevenue(order)).toBe(true)
      expect(getOrderEligibleRevenue(order)).toBe(5000000)

      const start = new Date('2026-10-20T00:00:00+07:00')
      const end = new Date('2026-10-20T23:59:59+07:00')
      const timeline = computeRevenueTimeline([order], start, end, 'DAY')

      expect(timeline.totalRevenue).toBe(5000000)
      expect(timeline.totalCompletedOrders).toBe(1)
      expect(timeline.totalKg).toBe(50)
    })
  })

  // T3. Đơn COMPLETED vẫn được khiếu nại trong 24 giờ
  describe('T3: COMPLETED Order Can Be Complained Within 24 Hours', () => {
    it('Đơn đã COMPLETED nhưng trong vòng 24h thì khách hàng vẫn được phép tạo khiếu nại', () => {
      const deliveredAt = new Date('2026-10-20T06:00:00Z')
      const now = new Date('2026-10-20T12:00:00Z') // 6h sau giao hàng
      const completedOrder: OrderStateSnapshot = {
        ...baseOrder,
        status: OrderStatus.COMPLETED,
        deliveredAt,
      }

      const res = canTransition(completedOrder, OrderStatus.COMPLAINT, 'CUSTOMER', {
        now,
        photosCount: 2,
      })
      expect(res.ok).toBe(true)
    })
  })

  // T4. Khiếu nại mở trước hạn (< 24h) -> hợp lệ
  describe('T4: Complaint Before 24h Deadline is Valid', () => {
    it('Khiếu nại gửi lúc 23 giờ 50 phút sau giao hàng -> hợp lệ', () => {
      const deliveredAt = new Date('2026-10-20T00:00:00Z')
      const now = new Date('2026-10-20T23:50:00Z') // 23.83h
      const completedOrder: OrderStateSnapshot = {
        ...baseOrder,
        status: OrderStatus.COMPLETED,
        deliveredAt,
      }

      const res = canTransition(completedOrder, OrderStatus.COMPLAINT, 'CUSTOMER', {
        now,
        photosCount: 1,
      })
      expect(res.ok).toBe(true)
    })
  })

  // T5. Hết 24 giờ (>= 24h) -> không nhận khiếu nại mới
  describe('T5: Complaint at or After 24h Deadline is Rejected', () => {
    it('Khiếu nại gửi lúc 24 giờ 05 phút sau giao hàng -> bị từ chối với lý do quá hạn 24h', () => {
      const deliveredAt = new Date('2026-10-20T00:00:00Z')
      const now = new Date('2026-10-21T00:05:00Z') // 24.08h
      const completedOrder: OrderStateSnapshot = {
        ...baseOrder,
        status: OrderStatus.COMPLETED,
        deliveredAt,
      }

      const res = canTransition(completedOrder, OrderStatus.COMPLAINT, 'CUSTOMER', {
        now,
        photosCount: 1,
      })
      expect(res.ok).toBe(false)
      expect(res.reason).toContain('quá thời hạn khiếu nại 24h')
    })
  })

  // DEV-TASK-41: EXACT 24-HOUR COMPLAINT BOUNDARY (PO SPECIFICATION)
  describe('DEV-TASK-41: Exact 24-Hour Complaint Boundary (23h59m59s ACCEPT, 24h00m00s REJECT, 24h00m01s REJECT)', () => {
    const deliveredAt = new Date('2026-10-20T10:00:00.000Z')
    const completedOrder: OrderStateSnapshot = {
      ...baseOrder,
      status: OrderStatus.COMPLETED,
      deliveredAt,
    }
    const deliveredOrder: OrderStateSnapshot = {
      ...baseOrder,
      status: OrderStatus.DELIVERED,
      deliveredAt,
    }

    const t23h59m59s = new Date(deliveredAt.getTime() + (23 * 3600 + 59 * 60 + 59) * 1000)
    const t24h00m00s = new Date(deliveredAt.getTime() + 24 * 3600 * 1000)
    const t24h00m01s = new Date(deliveredAt.getTime() + (24 * 3600 + 1) * 1000)

    it('23h59m59s -> ACCEPT cho cả đơn COMPLETED và DELIVERED', () => {
      const resCompleted = canTransition(completedOrder, OrderStatus.COMPLAINT, 'CUSTOMER', {
        now: t23h59m59s,
        photosCount: 1,
      })
      expect(resCompleted.ok).toBe(true)

      const resDelivered = canTransition(deliveredOrder, OrderStatus.COMPLAINT, 'CUSTOMER', {
        now: t23h59m59s,
        photosCount: 1,
      })
      expect(resDelivered.ok).toBe(true)
    })

    it('24h00m00s -> REJECT cho cả đơn COMPLETED và DELIVERED', () => {
      const resCompleted = canTransition(completedOrder, OrderStatus.COMPLAINT, 'CUSTOMER', {
        now: t24h00m00s,
        photosCount: 1,
      })
      expect(resCompleted.ok).toBe(false)
      expect(resCompleted.reason).toContain('quá thời hạn khiếu nại 24h')

      const resDelivered = canTransition(deliveredOrder, OrderStatus.COMPLAINT, 'CUSTOMER', {
        now: t24h00m00s,
        photosCount: 1,
      })
      expect(resDelivered.ok).toBe(false)
      expect(resDelivered.reason).toContain('quá thời hạn khiếu nại 24h')
    })

    it('24h00m01s -> REJECT cho cả đơn COMPLETED và DELIVERED', () => {
      const resCompleted = canTransition(completedOrder, OrderStatus.COMPLAINT, 'CUSTOMER', {
        now: t24h00m01s,
        photosCount: 1,
      })
      expect(resCompleted.ok).toBe(false)
      expect(resCompleted.reason).toContain('quá thời hạn khiếu nại 24h')

      const resDelivered = canTransition(deliveredOrder, OrderStatus.COMPLAINT, 'CUSTOMER', {
        now: t24h00m01s,
        photosCount: 1,
      })
      expect(resDelivered.ok).toBe(false)
      expect(resDelivered.reason).toContain('quá thời hạn khiếu nại 24h')
    })

    it('computeComplaintCompensation xác minh chính xác 3 mốc thời gian', () => {
      // 23h59m59s -> ACCEPT
      const resValid = computeComplaintCompensation({
        actualGrams: 100000,
        damagedGrams: 10000,
        unitPricePerKg: 100000,
        deliveredAt,
        submittedAt: t23h59m59s,
      })
      expect(resValid.isExpired).toBe(false)
      expect(resValid.compensation).toBeGreaterThan(0)

      // 24h00m00s -> REJECT
      expect(() =>
        computeComplaintCompensation({
          actualGrams: 100000,
          damagedGrams: 10000,
          unitPricePerKg: 100000,
          deliveredAt,
          submittedAt: t24h00m00s,
        })
      ).toThrow('quá thời hạn khiếu nại 24h')

      // 24h00m01s -> REJECT
      expect(() =>
        computeComplaintCompensation({
          actualGrams: 100000,
          damagedGrams: 10000,
          unitPricePerKg: 100000,
          deliveredAt,
          submittedAt: t24h00m01s,
        })
      ).toThrow('quá thời hạn khiếu nại 24h')
    })

    it('UI canComplaint boolean logic: hiển thị tại 23h59m59s và ẩn nút tại 24h00m00s & 24h00m01s', () => {
      const checkUiCanComplaint = (now: Date) => {
        const diffMs = now.getTime() - deliveredAt.getTime()
        return diffMs >= 0 && diffMs < 24 * 60 * 60 * 1000
      }

      expect(checkUiCanComplaint(t23h59m59s)).toBe(true)
      expect(checkUiCanComplaint(t24h00m00s)).toBe(false)
      expect(checkUiCanComplaint(t24h00m01s)).toBe(false)
    })
  })

  // T6. Khiếu nại đang xử lý (OPEN) -> đơn bị loại khỏi doanh thu đủ điều kiện
  describe('T6: Disputed Order Excluded from Eligible Revenue', () => {
    it('Đơn COMPLAINT hoặc COMPLETED có khiếu nại OPEN bị loại trừ 100% khỏi báo cáo doanh thu', () => {
      const disputedOrder: ReportOrderInput = {
        id: 'ord-disputed',
        code: 'ORD-DISPUTED',
        status: OrderStatus.COMPLAINT,
        type: OrderType.STANDARD,
        createdAt: new Date('2026-10-20T08:00:00Z'),
        total: 10000000,
        finalTotal: 10000000,
        depositAmount: 10000000,
        paymentOption: PaymentOption.FULL,
        cancelledBy: null,
        cancelReason: null,
        user: {
          id: 'u-1',
          fullName: 'Khách A',
          companyName: null,
          group: null,
        },
        items: [
          {
            id: 'it-1',
            productId: 'p-1',
            productName: 'Cam sành Tiền Giang',
            isSample: false,
            quantity: 10,
            orderedGrams: 100000,
            actualGrams: 100000,
            unitPricePerKg: 100000,
            lineTotal: 10000000,
            finalLineTotal: 10000000,
          },
        ],
        complaints: [
          {
            id: 'c-1',
            status: ComplaintStatus.OPEN,
          },
        ],
      }

      expect(isOrderEligibleForRevenue(disputedOrder)).toBe(false)

      const start = new Date('2026-10-20T00:00:00+07:00')
      const end = new Date('2026-10-20T23:59:59+07:00')

      // 1. Timeline
      const timeline = computeRevenueTimeline([disputedOrder], start, end, 'DAY')
      expect(timeline.totalRevenue).toBe(0)
      expect(timeline.totalCompletedOrders).toBe(0)
      expect(timeline.totalKg).toBe(0)

      // 2. Top Products
      const topProducts = computeTopProducts([disputedOrder])
      expect(topProducts.topByKg.length).toBe(0)
      expect(topProducts.topByRevenue.length).toBe(0)

      // 3. Cashflow
      const cashflow = computeCashflowMetrics([disputedOrder], [])
      expect(cashflow.completedRevenue).toBe(0)
    })
  })

  // T7. Khiếu nại bị từ chối (REJECTED) -> đơn được ghi nhận trở lại khi phù hợp
  describe('T7: Rejected Complaint Restores Revenue', () => {
    it('Khiếu nại bị từ chối (REJECTED) và đơn trở lại COMPLETED -> tính đủ doanh thu', () => {
      const orderAfterRejection: ReportOrderInput = {
        id: 'ord-rejected',
        code: 'ORD-REJECTED',
        status: OrderStatus.COMPLETED,
        type: OrderType.STANDARD,
        createdAt: new Date('2026-10-20T08:00:00Z'),
        total: 8000000,
        finalTotal: 8000000,
        depositAmount: 8000000,
        paymentOption: PaymentOption.FULL,
        cancelledBy: null,
        cancelReason: null,
        user: {
          id: 'u-1',
          fullName: 'Khách B',
          companyName: null,
          group: null,
        },
        items: [
          {
            id: 'it-1',
            productId: 'p-1',
            productName: 'Xoài Cát Hòa Lộc',
            isSample: false,
            quantity: 8,
            orderedGrams: 80000,
            actualGrams: 80000,
            unitPricePerKg: 100000,
            lineTotal: 8000000,
            finalLineTotal: 8000000,
          },
        ],
        complaints: [
          {
            id: 'c-1',
            status: ComplaintStatus.REJECTED,
          },
        ],
      }

      expect(isOrderEligibleForRevenue(orderAfterRejection)).toBe(true)
      expect(getOrderEligibleRevenue(orderAfterRejection)).toBe(8000000)

      const start = new Date('2026-10-20T00:00:00+07:00')
      const end = new Date('2026-10-20T23:59:59+07:00')
      const timeline = computeRevenueTimeline([orderAfterRejection], start, end, 'DAY')
      expect(timeline.totalRevenue).toBe(8000000)
      expect(timeline.totalCompletedOrders).toBe(1)
    })
  })

  // T8. Khiếu nại được chấp nhận -> điều chỉnh doanh thu theo kết quả tài chính thực tế
  describe('T8: Accepted Complaint Adjusts Revenue Based on Actual Settlement', () => {
    it('Khiếu nại REFUND đã giải quyết: doanh thu được ghi nhận bằng tổng tiền trừ tiền bồi hoàn', () => {
      const orderRefundCompensated: ReportOrderInput = {
        id: 'ord-resolved-refund',
        code: 'ORD-RESOLVED',
        status: OrderStatus.COMPLETED,
        type: OrderType.STANDARD,
        createdAt: new Date('2026-10-20T08:00:00Z'),
        total: 10000000,
        finalTotal: 10000000,
        depositAmount: 10000000,
        paymentOption: PaymentOption.FULL,
        cancelledBy: null,
        cancelReason: null,
        user: {
          id: 'u-1',
          fullName: 'Khách C',
          companyName: null,
          group: null,
        },
        items: [
          {
            id: 'it-1',
            productId: 'p-1',
            productName: 'Mít Thái',
            isSample: false,
            quantity: 10,
            orderedGrams: 100000,
            actualGrams: 100000,
            unitPricePerKg: 100000,
            lineTotal: 10000000,
            finalLineTotal: 10000000,
          },
        ],
        complaints: [
          {
            id: 'c-1',
            status: ComplaintStatus.RESOLVED,
            resolution: Resolution.REFUND,
            compensation: 1500000, // Bồi hoàn 1.500.000 đ
          },
        ],
      }

      expect(isOrderEligibleForRevenue(orderRefundCompensated)).toBe(true)
      // Doanh thu thực tế = 10.000.000 - 1.500.000 = 8.500.000 đ
      expect(getOrderEligibleRevenue(orderRefundCompensated)).toBe(8500000)

      const start = new Date('2026-10-20T00:00:00+07:00')
      const end = new Date('2026-10-20T23:59:59+07:00')
      const timeline = computeRevenueTimeline([orderRefundCompensated], start, end, 'DAY')
      expect(timeline.totalRevenue).toBe(8500000)
    })

    it('Khiếu nại REPLACE (bù hàng chuyến sau): doanh thu đơn hiện tại vẫn được giữ nguyên đầy đủ', () => {
      const orderReplaceCompensated: ReportOrderInput = {
        id: 'ord-resolved-replace',
        code: 'ORD-REPLACE',
        status: OrderStatus.COMPLETED,
        type: OrderType.STANDARD,
        createdAt: new Date('2026-10-20T08:00:00Z'),
        total: 10000000,
        finalTotal: 10000000,
        depositAmount: 10000000,
        paymentOption: PaymentOption.FULL,
        cancelledBy: null,
        cancelReason: null,
        user: {
          id: 'u-1',
          fullName: 'Khách D',
          companyName: null,
          group: null,
        },
        items: [
          {
            id: 'it-1',
            productId: 'p-1',
            productName: 'Thanh Long',
            isSample: false,
            quantity: 10,
            orderedGrams: 100000,
            actualGrams: 100000,
            unitPricePerKg: 100000,
            lineTotal: 10000000,
            finalLineTotal: 10000000,
          },
        ],
        complaints: [
          {
            id: 'c-1',
            status: ComplaintStatus.RESOLVED,
            resolution: Resolution.REPLACE,
            compensation: null,
          },
        ],
      }

      expect(isOrderEligibleForRevenue(orderReplaceCompensated)).toBe(true)
      expect(getOrderEligibleRevenue(orderReplaceCompensated)).toBe(10000000)
    })
  })

  // T9. Khiếu nại chưa giải quyết sau 24 giờ -> tiếp tục bị loại
  describe('T9: Unresolved Complaint Past 24h Remains Excluded', () => {
    it('Đơn có khiếu nại OPEN dù đã giao quá 48h vẫn bị loại khỏi doanh thu', () => {
      const oldDisputedOrder: ReportOrderInput = {
        id: 'ord-old-dispute',
        code: 'ORD-OLD',
        status: OrderStatus.COMPLAINT,
        type: OrderType.STANDARD,
        createdAt: new Date('2026-10-15T08:00:00Z'),
        total: 15000000,
        finalTotal: 15000000,
        depositAmount: 15000000,
        paymentOption: PaymentOption.FULL,
        cancelledBy: null,
        cancelReason: null,
        user: { id: 'u-1', fullName: 'Khách E', companyName: null, group: null },
        items: [],
        complaints: [
          {
            id: 'c-1',
            status: ComplaintStatus.OPEN,
          },
        ],
      }

      expect(isOrderEligibleForRevenue(oldDisputedOrder)).toBe(false)
    })
  })

  // T10. Không phát sinh tính doanh thu hai lần
  describe('T10: Zero Double Counting of Revenue Components', () => {
    it('Đơn hàng cọc 30% và thanh toán nốt 70% chỉ tính doanh thu đúng 1 lần theo finalTotal', () => {
      const depositOrder: ReportOrderInput = {
        id: 'ord-deposit',
        code: 'ORD-DEP',
        status: OrderStatus.COMPLETED,
        type: OrderType.STANDARD,
        createdAt: new Date('2026-10-20T08:00:00Z'),
        total: 10000000,
        finalTotal: 9500000, // Sau chốt cân giảm xuống 9.5tr
        depositAmount: 3000000,
        paymentOption: PaymentOption.DEPOSIT_30,
        cancelledBy: null,
        cancelReason: null,
        user: { id: 'u-1', fullName: 'Khách F', companyName: null, group: null },
        items: [],
      }

      // Doanh thu chỉ tính đúng 9.500.000 đ, không cộng thêm 3.000.000 tiền cọc
      expect(getOrderEligibleRevenue(depositOrder)).toBe(9500000)
    })
  })

  // T11. Dashboard và báo cáo dùng logic thống nhất
  describe('T11: Cross-Module Metric Consistency (Reports & CRM)', () => {
    it('Reports và CRM cho ra cùng kết quả doanh thu và số đơn hoàn thành trên cùng một tập đơn', () => {
      const sampleOrders: ReportOrderInput[] = [
        {
          id: 'o-1',
          code: 'O1',
          status: OrderStatus.COMPLETED,
          type: OrderType.STANDARD,
          createdAt: new Date('2026-10-20T08:00:00Z'),
          total: 10000000,
          finalTotal: 10000000,
          depositAmount: 10000000,
          paymentOption: PaymentOption.FULL,
          cancelledBy: null,
          cancelReason: null,
          user: { id: 'u-1', fullName: 'User 1', companyName: null, group: null },
          items: [],
          complaints: [],
        },
        {
          id: 'o-2',
          code: 'O2',
          status: OrderStatus.COMPLAINT, // Có khiếu nại OPEN -> loại trừ
          type: OrderType.STANDARD,
          createdAt: new Date('2026-10-20T08:00:00Z'),
          total: 5000000,
          finalTotal: 5000000,
          depositAmount: 5000000,
          paymentOption: PaymentOption.FULL,
          cancelledBy: null,
          cancelReason: null,
          user: { id: 'u-1', fullName: 'User 1', companyName: null, group: null },
          items: [],
          complaints: [{ id: 'c-open', status: ComplaintStatus.OPEN }],
        },
        {
          id: 'o-3',
          code: 'O3',
          status: OrderStatus.COMPLETED, // Khiếu nại đã giải quyết refund 1tr
          type: OrderType.STANDARD,
          createdAt: new Date('2026-10-20T08:00:00Z'),
          total: 6000000,
          finalTotal: 6000000,
          depositAmount: 6000000,
          paymentOption: PaymentOption.FULL,
          cancelledBy: null,
          cancelReason: null,
          user: { id: 'u-1', fullName: 'User 1', companyName: null, group: null },
          items: [],
          complaints: [
            {
              id: 'c-res',
              status: ComplaintStatus.RESOLVED,
              resolution: Resolution.REFUND,
              compensation: 1000000,
            },
          ],
        },
      ]

      // 1. Tính qua Reports Domain
      const start = new Date('2026-10-20T00:00:00+07:00')
      const end = new Date('2026-10-20T23:59:59+07:00')
      const timeline = computeRevenueTimeline(sampleOrders, start, end, 'DAY')
      const cashflow = computeCashflowMetrics(sampleOrders, [])

      // Kỳ vọng: O1 (10tr) + O3 (6tr - 1tr = 5tr) = 15.000.000 đ. O2 bị loại trừ hoàn toàn.
      expect(timeline.totalRevenue).toBe(15000000)
      expect(timeline.totalCompletedOrders).toBe(2)
      expect(cashflow.completedRevenue).toBe(15000000)

      // 2. Tính qua CRM Domain
      const crmOrders: CustomerOrderSummaryInput[] = sampleOrders.map((o) => ({
        id: o.id,
        status: o.status,
        total: o.total,
        finalTotal: o.finalTotal,
        complaints: o.complaints,
      }))
      const crmStats = computeCustomerOrderStats(crmOrders)

      expect(crmStats.completedRevenue).toBe(15000000)
      expect(crmStats.completedOrderCount).toBe(2)
      expect(crmStats.activeOrderCount).toBe(1) // O2 đang tranh chấp tính vào active
    })
  })
})
