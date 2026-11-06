import { describe, it, expect } from 'vitest'
import {
  OrderStatus,
  OrderType,
  PaymentOption,
  ComplaintStatus,
  ComplaintResolutionType,
  Resolution,
  TxType,
  TxStatus,
} from '@prisma/client'
import {
  getOrderEligibleRevenue,
  isOrderEligibleForRevenue,
  computeCashflowMetrics,
} from '@/lib/domain/reports'

describe('EV-F02-QA-GAPS-01 — Financial Integrity Verification (FIN-GAP-01 to FIN-GAP-10)', () => {
  it('FIN-GAP-01: Đơn hàng hoàn thành, không có khiếu nại -> Doanh thu ghi nhận đúng bằng (finalTotal ?? total)', () => {
    const orderWithFinalTotal = {
      total: 1000000,
      finalTotal: 980000,
      status: OrderStatus.COMPLETED,
      complaints: [],
    }
    expect(isOrderEligibleForRevenue(orderWithFinalTotal)).toBe(true)
    expect(getOrderEligibleRevenue(orderWithFinalTotal)).toBe(980000)

    const orderWithoutFinalTotal = {
      total: 500000,
      finalTotal: null,
      status: OrderStatus.COMPLETED,
      complaints: [],
    }
    expect(isOrderEligibleForRevenue(orderWithoutFinalTotal)).toBe(true)
    expect(getOrderEligibleRevenue(orderWithoutFinalTotal)).toBe(500000)
  })

  it('FIN-GAP-02: Đơn có khiếu nại đang OPEN -> Toàn bộ doanh thu bị đóng băng (không đủ điều kiện ghi nhận)', () => {
    const order = {
      total: 1500000,
      finalTotal: 1500000,
      status: OrderStatus.COMPLETED, // Kể cả trạng thái đơn là COMPLETED
      complaints: [
        {
          id: 'c1',
          status: ComplaintStatus.OPEN,
          compensation: 0,
        },
      ],
    }
    // PH9-00 / BR-04: Đang có khiếu nại OPEN -> loại khỏi doanh thu
    expect(isOrderEligibleForRevenue(order)).toBe(false)
  })

  it('FIN-GAP-03: Đơn có đề xuất bồi thường nhưng khách chưa chấp nhận (PROPOSED) -> Doanh thu bị đóng băng', () => {
    const order = {
      total: 2000000,
      finalTotal: 2000000,
      status: OrderStatus.COMPLETED,
      complaints: [
        {
          id: 'c2',
          status: ComplaintStatus.PROPOSED,
          proposalType: ComplaintResolutionType.REFUND_MONEY,
          proposalAmount: 300000,
          compensation: null,
        },
      ],
    }
    expect(isOrderEligibleForRevenue(order)).toBe(false)
  })

  it('FIN-GAP-04: Khách chấp nhận hoàn tiền, refund vẫn PENDING -> Đơn giữ trạng thái COMPLAINT -> Doanh thu đóng băng', () => {
    const order = {
      total: 1200000,
      finalTotal: 1200000,
      status: OrderStatus.COMPLAINT, // Đơn ở COMPLAINT khi refund PENDING
      complaints: [
        {
          id: 'c3',
          status: ComplaintStatus.CUSTOMER_ACCEPTED,
          proposalType: ComplaintResolutionType.REFUND_MONEY,
          resolution: Resolution.REFUND,
          compensation: 200000,
        },
      ],
    }
    expect(isOrderEligibleForRevenue(order)).toBe(false)
  })

  it('FIN-GAP-05: Admin xác nhận refund DONE -> Đơn chuyển COMPLETED -> Doanh thu được ghi nhận đúng sau khi trừ bồi thường', () => {
    const order = {
      total: 1200000,
      finalTotal: 1200000,
      status: OrderStatus.COMPLETED, // Sau khi confirmRefundDone(), đơn chuyển COMPLETED
      complaints: [
        {
          id: 'c3',
          status: ComplaintStatus.CUSTOMER_ACCEPTED,
          proposalType: ComplaintResolutionType.REFUND_MONEY,
          resolution: Resolution.REFUND,
          compensation: 200000,
        },
      ],
    }
    expect(isOrderEligibleForRevenue(order)).toBe(true)
    // 1.200.000 - 200.000 = 1.000.000 đ
    expect(getOrderEligibleRevenue(order)).toBe(1000000)
  })

  it('FIN-GAP-06: Khách rút khiếu nại (WITHDRAWN), bồi thường 0 VND -> Doanh thu không bị trừ', () => {
    const order = {
      total: 800000,
      finalTotal: 800000,
      status: OrderStatus.COMPLETED,
      complaints: [
        {
          id: 'c4',
          status: ComplaintStatus.WITHDRAWN,
          compensation: 0,
          resolution: null,
        },
      ],
    }
    expect(isOrderEligibleForRevenue(order)).toBe(true)
    expect(getOrderEligibleRevenue(order)).toBe(800000)
  })

  it('FIN-GAP-07: Khiếu nại tự động hết hạn 48h (WITHDRAWN), không phát sinh refund -> Doanh thu không bị trừ', () => {
    const order = {
      total: 1500000,
      finalTotal: 1450000,
      status: OrderStatus.COMPLETED,
      complaints: [
        {
          id: 'c5',
          status: ComplaintStatus.WITHDRAWN,
          compensation: 0,
        },
      ],
    }
    expect(isOrderEligibleForRevenue(order)).toBe(true)
    expect(getOrderEligibleRevenue(order)).toBe(1450000)
  })

  it('FIN-GAP-08: Đơn có 2 khiếu nại (1 CUSTOMER_ACCEPTED, 1 PROPOSED) -> Đơn giữ COMPLAINT -> Doanh thu tiếp tục bị đóng băng', () => {
    const order = {
      total: 3000000,
      finalTotal: 3000000,
      status: OrderStatus.COMPLAINT,
      complaints: [
        {
          id: 'c6a',
          status: ComplaintStatus.CUSTOMER_ACCEPTED,
          compensation: 200000,
          proposalType: ComplaintResolutionType.REFUND_MONEY,
        },
        {
          id: 'c6b',
          status: ComplaintStatus.PROPOSED,
          proposalType: ComplaintResolutionType.REFUND_MONEY,
          proposalAmount: 150000,
        },
      ],
    }
    expect(isOrderEligibleForRevenue(order)).toBe(false)
  })

  it('FIN-GAP-09: Đơn có finalTotal khác total do cơ chế cân hàng/tất toán -> baseTotal ưu tiên finalTotal', () => {
    // Đặt hàng 10 kg giá 100.000 đ/kg = 1.000.000 đ (total)
    // Cân thực tế giao 9.5 kg = 950.000 đ (finalTotal)
    // Khách khiếu nại dập úng 1 kg, bồi thường 100.000 đ
    const order = {
      total: 1000000,
      finalTotal: 950000,
      status: OrderStatus.COMPLETED,
      complaints: [
        {
          id: 'c7',
          status: ComplaintStatus.RESOLVED,
          resolution: Resolution.REFUND,
          compensation: 100000,
        },
      ],
    }
    expect(isOrderEligibleForRevenue(order)).toBe(true)
    // Doanh thu = 950.000 - 100.000 = 850.000 đ (không lấy 1.000.000 đ)
    expect(getOrderEligibleRevenue(order)).toBe(850000)
  })

  it('FIN-GAP-10: Đơn có nhiều khoản giảm trừ thuộc các nghiệp vụ khác nhau (Cân hàng shortfall + Khiếu nại) -> Không bị trừ 2 lần', () => {
    // Đơn đặt 1.000.000 đ. Đã thanh toán trước 1.000.000 đ (PAYMENT DONE).
    // Giao thực tế cân được 950.000 đ -> finalTotal = 950.000 đ.
    // Phát sinh giao dịch hoàn tiền thiếu cân 50.000 đ (REFUND DONE, reference: SHORTFALL_...).
    // Sau khi nhận hàng, khách khiếu nại dập úng được bồi thường 30.000 đ (REFUND DONE, reference: COMPLAINT_...).
    const order = {
      id: 'ord-10',
      total: 1000000,
      finalTotal: 950000,
      status: OrderStatus.COMPLETED,
      complaints: [
        {
          id: 'c8',
          status: ComplaintStatus.CUSTOMER_ACCEPTED,
          proposalType: ComplaintResolutionType.REFUND_MONEY,
          resolution: Resolution.REFUND,
          compensation: 30000,
        },
      ],
    }

    const transactions = [
      {
        id: 'tx-1',
        orderId: 'ord-10',
        type: TxType.PAYMENT,
        status: TxStatus.DONE,
        amount: 1000000,
        createdAt: new Date(),
      },
      {
        id: 'tx-2',
        orderId: 'ord-10',
        type: TxType.REFUND,
        status: TxStatus.DONE,
        amount: 50000, // Shortfall refund từ cân hàng
        createdAt: new Date(),
      },
      {
        id: 'tx-3',
        orderId: 'ord-10',
        type: TxType.REFUND,
        status: TxStatus.DONE,
        amount: 30000, // Complaint refund từ bồi thường
        createdAt: new Date(),
      },
    ]

    // 1. Kiểm tra Doanh thu ròng được ghi nhận (Doanh thu bán hàng thực tế):
    // finalTotal (950.000) - complaint compensation (30.000) = 920.000 đ
    const netRevenue = getOrderEligibleRevenue(order)
    expect(netRevenue).toBe(920000)

    // 2. Kiểm tra Dòng tiền thực nhận (Cashflow):
    // Tiền vào (1.000.000) - Tiền hoàn (50.000 + 30.000) = 920.000 đ
    const cashflow = computeCashflowMetrics(
      [
        {
          id: order.id,
          total: order.total,
          finalTotal: order.finalTotal,
          status: order.status,
          complaints: order.complaints,
          code: 'ORD-10',
          type: OrderType.STANDARD,
          depositAmount: 0,
          paymentOption: PaymentOption.FULL,
          cancelledBy: null,
          cancelReason: null,
          createdAt: new Date(),
          user: {
            id: 'u1',
            fullName: 'Test Customer',
            companyName: null,
            group: null,
          },
          items: [],
        },
      ],
      transactions
    )

    expect(cashflow.completedRevenue).toBe(920000)
    expect(cashflow.totalPaid).toBe(1000000)
    expect(cashflow.totalRefunded).toBe(80000)
    expect(cashflow.netCashReceived).toBe(920000)
    // Chứng minh tính đồng nhất: Dòng tiền thực nhận (Net Cash) khớp 100% với Doanh thu ròng (Net Revenue)!
    expect(cashflow.netCashReceived).toBe(cashflow.completedRevenue)
  })
})
