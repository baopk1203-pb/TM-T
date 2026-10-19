import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  OrderStatus,
  OrderType,
  PaymentOption,
  CancelActor,
  ComplaintStatus,
  TxType,
  TxStatus,
  Role,
} from '@prisma/client'
import {
  createVietnamDateStart,
  createVietnamDateEnd,
  formatVietnamDateString,
  resolveDateRange,
  computeRevenueTimeline,
  computeTopProducts,
  computeCancellationAndComplaintRates,
  computeShrinkageStats,
  computeRevenueByCustomerGroup,
  computeCashflowMetrics,
  computeAdminDashboardKpis,
  ReportOrderInput,
} from '@/lib/domain/reports'

// Mock next/cache, @/lib/db, and @/lib/auth for Server Action security check (Case 11)
const { mockDb, mockRequireAdmin } = vi.hoisted(() => ({
  mockDb: {
    order: {
      findMany: vi.fn(),
    },
    paymentTransaction: {
      findMany: vi.fn(),
    },
    complaint: {
      count: vi.fn(),
    },
  },
  mockRequireAdmin: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: mockDb,
}))

vi.mock('@/lib/auth', () => ({
  requireAdmin: mockRequireAdmin,
}))

import { getBusinessReports, getAdminDashboardKpis } from '@/server/reports'

describe('Phase 7 — Batch 7B: Báo cáo Doanh thu & Admin Dashboard KPI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAdmin.mockResolvedValue({
      id: 'admin-01',
      email: 'admin@nongsan.vn',
      role: Role.ADMIN,
    })
  })

  // -------------------------------------------------------------------
  // BỘ DỮ LIỆU FIXTURE CHUẨN ĐÃ ĐỐI CHIẾU PHÉP TÍNH TAY
  // -------------------------------------------------------------------
  const sampleOrdersFixture: ReportOrderInput[] = [
    // ORD-01: COMPLETED, giờ VN: 2026-10-19 00:30:00 (17:30 UTC 18/10). cọc 30%, có 2 khiếu nại
    {
      id: 'ord-01',
      code: 'ORD-20261019-001',
      status: OrderStatus.COMPLETED,
      type: OrderType.STANDARD,
      createdAt: new Date('2026-10-18T17:30:00.000Z'), // VN: 2026-10-19 00:30
      total: 5000000,
      finalTotal: 4800000, // finalTotal ưu tiên hơn total
      depositAmount: 1500000,
      paymentOption: PaymentOption.DEPOSIT_30,
      cancelledBy: null,
      cancelReason: null,
      user: {
        id: 'user-01',
        fullName: 'Siêu Thị Xanh An',
        companyName: 'Công ty Siêu Thị Xanh',
        group: { id: 'grp-super', code: 'SUPERMARKET', name: 'Siêu thị' },
      },
      items: [
        {
          id: 'item-01',
          productId: 'prod-xoai',
          productName: 'Xoài Cát Chu',
          isSample: false,
          quantity: 5,
          orderedGrams: 100000,
          actualGrams: 95000, // hao hụt 5kg
          unitPricePerKg: 30000,
          lineTotal: 3000000,
          finalLineTotal: 2850000,
        },
        {
          id: 'item-02',
          productId: 'prod-thanhlong',
          productName: 'Thanh Long Đỏ',
          isSample: false,
          quantity: 2,
          orderedGrams: 50000,
          actualGrams: 48000, // hao hụt 2kg
          unitPricePerKg: 40000,
          lineTotal: 2000000,
          finalLineTotal: 1950000,
        },
      ],
      complaints: [
        { id: 'comp-01', status: ComplaintStatus.RESOLVED },
        { id: 'comp-02', status: ComplaintStatus.RESOLVED },
      ],
    },

    // ORD-02: COMPLETED, giờ VN: 2026-10-19 10:00:00. finalTotal = 0 (khuyến mãi 100%), có hàng mẫu
    {
      id: 'ord-02',
      code: 'ORD-20261019-002',
      status: OrderStatus.COMPLETED,
      type: OrderType.STANDARD,
      createdAt: new Date('2026-10-19T03:00:00.000Z'), // VN: 2026-10-19 10:00
      total: 2000000,
      finalTotal: 0, // finalTotal = 0 phải được ưu tiên, KHÔNG fallback về 2,000,000
      depositAmount: 0,
      paymentOption: PaymentOption.FULL,
      cancelledBy: null,
      cancelReason: null,
      user: {
        id: 'user-02',
        fullName: 'Đại Lý Miền Tây',
        companyName: 'Đại Lý Cấp 1 Nam Bộ',
        group: { id: 'grp-tier1', code: 'TIER1_AGENT', name: 'Đại lý cấp 1' },
      },
      items: [
        {
          id: 'item-03',
          productId: 'prod-xoai',
          productName: 'Xoài Cát Chu',
          isSample: false,
          quantity: 2,
          orderedGrams: 40000,
          actualGrams: 38000,
          unitPricePerKg: 30000,
          lineTotal: 1200000,
          finalLineTotal: 0,
        },
        {
          id: 'item-04',
          productId: 'prod-mit-sample',
          productName: 'Mít Sấy Mẫu Thử',
          isSample: true, // Hàng mẫu: không tính vào khối lượng thương mại
          quantity: 2,
          orderedGrams: 4000,
          actualGrams: null,
          unitPricePerKg: 0,
          lineTotal: 100000,
          finalLineTotal: 0,
        },
      ],
      complaints: [],
    },

    // ORD-03: COMPLETED, giờ VN: 2026-10-19 12:00:00. finalTotal = null -> fallback về total = 3,000,000 đ
    {
      id: 'ord-03',
      code: 'ORD-20261019-003',
      status: OrderStatus.COMPLETED,
      type: OrderType.RECURRING,
      createdAt: new Date('2026-10-19T05:00:00.000Z'), // VN: 2026-10-19 12:00
      total: 3000000,
      finalTotal: null,
      depositAmount: 0,
      paymentOption: PaymentOption.FULL,
      cancelledBy: null,
      cancelReason: null,
      user: {
        id: 'user-03',
        fullName: 'Cửa Hàng Hoa Quả Sạch',
        companyName: null,
        group: { id: 'grp-small', code: 'SMALL_SHOP', name: 'Cửa hàng nhỏ' },
      },
      items: [
        {
          id: 'item-05',
          productId: 'prod-ri6',
          productName: 'Sầu Riêng Ri6',
          isSample: false,
          quantity: 3,
          orderedGrams: 30000,
          actualGrams: null, // Chưa cân thực tế -> KHÔNG tính vào tỷ lệ hao hụt
          unitPricePerKg: 100000,
          lineTotal: 3000000,
          finalLineTotal: null,
        },
      ],
      complaints: [],
    },

    // ORD-04: CANCELLED bởi CUSTOMER
    {
      id: 'ord-04',
      code: 'ORD-20261019-004',
      status: OrderStatus.CANCELLED,
      type: OrderType.STANDARD,
      createdAt: new Date('2026-10-19T06:00:00.000Z'),
      total: 1500000,
      finalTotal: null,
      depositAmount: 0,
      paymentOption: PaymentOption.FULL,
      cancelledBy: CancelActor.CUSTOMER,
      cancelReason: 'Đổi kế hoạch nhập hàng',
      user: {
        id: 'user-01',
        fullName: 'Siêu Thị Xanh An',
        companyName: 'Công ty Siêu Thị Xanh',
        group: { id: 'grp-super', code: 'SUPERMARKET', name: 'Siêu thị' },
      },
      items: [],
      complaints: [],
    },

    // ORD-05: CANCELLED bởi SELLER
    {
      id: 'ord-05',
      code: 'ORD-20261019-005',
      status: OrderStatus.CANCELLED,
      type: OrderType.STANDARD,
      createdAt: new Date('2026-10-19T07:00:00.000Z'),
      total: 2500000,
      finalTotal: null,
      depositAmount: 0,
      paymentOption: PaymentOption.FULL,
      cancelledBy: CancelActor.SELLER,
      cancelReason: 'Nhà vườn thiếu hàng sau bão',
      user: {
        id: 'user-02',
        fullName: 'Đại Lý Miền Tây',
        companyName: 'Đại Lý Cấp 1 Nam Bộ',
        group: { id: 'grp-tier1', code: 'TIER1_AGENT', name: 'Đại lý cấp 1' },
      },
      items: [],
      complaints: [],
    },

    // ORD-06: CANCELLED bởi SYSTEM
    {
      id: 'ord-06',
      code: 'ORD-20261019-006',
      status: OrderStatus.CANCELLED,
      type: OrderType.STANDARD,
      createdAt: new Date('2026-10-19T08:00:00.000Z'),
      total: 800000,
      finalTotal: null,
      depositAmount: 0,
      paymentOption: PaymentOption.FULL,
      cancelledBy: CancelActor.SYSTEM,
      cancelReason: 'Quá hạn thanh toán 2 giờ',
      user: {
        id: 'user-03',
        fullName: 'Cửa Hàng Hoa Quả Sạch',
        companyName: null,
        group: { id: 'grp-small', code: 'SMALL_SHOP', name: 'Cửa hàng nhỏ' },
      },
      items: [],
      complaints: [],
    },

    // ORD-07: PREORDER_WAITING (đang chờ vụ mùa, chưa hoàn thành)
    {
      id: 'ord-07',
      code: 'ORD-20261019-007',
      status: OrderStatus.PREORDER_WAITING,
      type: OrderType.PREORDER,
      createdAt: new Date('2026-10-19T09:00:00.000Z'),
      total: 4000000,
      finalTotal: null,
      depositAmount: 1200000,
      paymentOption: PaymentOption.DEPOSIT_30,
      cancelledBy: null,
      cancelReason: null,
      user: {
        id: 'user-01',
        fullName: 'Siêu Thị Xanh An',
        companyName: 'Công ty Siêu Thị Xanh',
        group: { id: 'grp-super', code: 'SUPERMARKET', name: 'Siêu thị' },
      },
      items: [],
      complaints: [],
    },

    // ORD-08: DRAFT (Đơn nháp định kỳ chưa xác nhận)
    {
      id: 'ord-08',
      code: 'ORD-20261019-008',
      status: OrderStatus.DRAFT,
      type: OrderType.RECURRING,
      createdAt: new Date('2026-10-19T10:00:00.000Z'),
      total: 1000000,
      finalTotal: null,
      depositAmount: 0,
      paymentOption: PaymentOption.FULL,
      cancelledBy: null,
      cancelReason: null,
      user: {
        id: 'user-03',
        fullName: 'Cửa Hàng Hoa Quả Sạch',
        companyName: null,
        group: { id: 'grp-small', code: 'SMALL_SHOP', name: 'Cửa hàng nhỏ' },
      },
      items: [],
      complaints: [],
    },

    // ORD-09: COMPLETED, giờ VN: 2026-10-18 23:59:00 (16:59 UTC 18/10) - Sát nửa đêm ngày hôm trước
    {
      id: 'ord-09',
      code: 'ORD-20261018-009',
      status: OrderStatus.COMPLETED,
      type: OrderType.STANDARD,
      createdAt: new Date('2026-10-18T16:59:00.000Z'), // VN: 2026-10-18 23:59
      total: 1000000,
      finalTotal: 1000000,
      depositAmount: 0,
      paymentOption: PaymentOption.FULL,
      cancelledBy: null,
      cancelReason: null,
      user: {
        id: 'user-01',
        fullName: 'Siêu Thị Xanh An',
        companyName: 'Công ty Siêu Thị Xanh',
        group: { id: 'grp-super', code: 'SUPERMARKET', name: 'Siêu thị' },
      },
      items: [
        {
          id: 'item-06',
          productId: 'prod-ri6',
          productName: 'Sầu Riêng Ri6',
          isSample: false,
          quantity: 1,
          orderedGrams: 10000,
          actualGrams: 9500, // hao hụt 0.5kg
          unitPricePerKg: 100000,
          lineTotal: 1000000,
          finalLineTotal: 950000,
        },
      ],
      complaints: [],
    },
  ]

  // ===================================================================
  // 12 TEST CASES BẮT BUỘC THEO ĐẶC TẢ
  // ===================================================================

  it('1. Revenue: COMPLETED được cộng, DRAFT, CANCELLED, PREORDER_WAITING bị loại trừ hoàn toàn', () => {
    const startOct19 = createVietnamDateStart(2026, 10, 19)
    const endOct19 = createVietnamDateEnd(2026, 10, 19)

    // Lọc các đơn tạo trong ngày 19/10
    const oct19Orders = sampleOrdersFixture.filter(
      (o) => o.createdAt >= startOct19 && o.createdAt <= endOct19
    )

    const timeline = computeRevenueTimeline(oct19Orders, startOct19, endOct19, 'DAY')

    // Trong ngày 19/10:
    // ORD-01 (COMPLETED): 4,800,000
    // ORD-02 (COMPLETED): 0
    // ORD-03 (COMPLETED): 3,000,000
    // Tổng = 7,800,000 đ
    // ORD-04..06 (CANCELLED), ORD-07 (PREORDER_WAITING), ORD-08 (DRAFT) bị loại
    expect(timeline.totalRevenue).toBe(7800000)
    expect(timeline.totalCompletedOrders).toBe(3)
  })

  it('2. Order finalTotal được ưu tiên hơn total, kể cả khi finalTotal bằng 0', () => {
    // ORD-02 có total = 2,000,000 nhưng finalTotal = 0
    const ord02Only = sampleOrdersFixture.filter((o) => o.id === 'ord-02')
    const start = createVietnamDateStart(2026, 10, 19)
    const end = createVietnamDateEnd(2026, 10, 19)

    const timeline = computeRevenueTimeline(ord02Only, start, end, 'DAY')
    expect(timeline.totalRevenue).toBe(0) // Phải ghi nhận 0 đ, không được fallback về 2,000,000 đ
    expect(timeline.totalCompletedOrders).toBe(1)
  })

  it('3. Đơn cọc 30% không bị cộng trùng vào doanh thu', () => {
    // ORD-01: cọc 1,500,000 đ, finalTotal 4,800,000 đ
    const ord01Only = sampleOrdersFixture.filter((o) => o.id === 'ord-01')
    const start = createVietnamDateStart(2026, 10, 19)
    const end = createVietnamDateEnd(2026, 10, 19)

    const timeline = computeRevenueTimeline(ord01Only, start, end, 'DAY')
    // Doanh thu chỉ tính đúng 1 lần 4,800,000 đ, không cộng thêm 1,500,000 đ cọc
    expect(timeline.totalRevenue).toBe(4800000)
  })

  it('4. Tổng kg và doanh thu Top 10 đúng, tách biệt hàng mẫu (isSample = true)', () => {
    const top = computeTopProducts(sampleOrdersFixture, 10)

    // Kiểm tra hàng mẫu Mít được đếm riêng, không lọt vào bảng thương mại
    expect(top.sampleProductsCount).toBe(2)
    const sampleInTop = top.topByKg.find((p) => p.productId === 'prod-mit-sample')
    expect(sampleInTop).toBeUndefined()

    // Xoài Cát Chu:
    // ORD-01: 95kg (actual) - 2,850,000 đ
    // ORD-02: 38kg (actual) - 0 đ
    // Tổng = 133 kg, doanh thu = 2,850,000 đ
    const xoai = top.topByKg.find((p) => p.productId === 'prod-xoai')
    expect(xoai).toBeDefined()
    expect(xoai?.totalKg).toBe(133)
    expect(xoai?.totalRevenue).toBe(2850000)
    expect(xoai?.orderCount).toBe(2)

    // Thanh Long Đỏ: ORD-01: 48kg (actual) - 1,950,000 đ
    const thanhlong = top.topByKg.find((p) => p.productId === 'prod-thanhlong')
    expect(thanhlong).toBeDefined()
    expect(thanhlong?.totalKg).toBe(48)
    expect(thanhlong?.totalRevenue).toBe(1950000)

    // Sầu Riêng Ri6:
    // ORD-03: fallback ordered 30kg - 3,000,000 đ
    // ORD-09: 9.5kg (actual) - 950,000 đ
    // Tổng = 39.5 kg, doanh thu = 3,950,000 đ
    const ri6 = top.topByRevenue.find((p) => p.productId === 'prod-ri6')
    expect(ri6).toBeDefined()
    expect(ri6?.totalKg).toBe(39.5)
    expect(ri6?.totalRevenue).toBe(3950000)

    // Top 1 doanh thu là Sầu Riêng Ri6 (3,950,000 đ), Top 1 sản lượng là Xoài (133 kg)
    expect(top.topByRevenue[0].productId).toBe('prod-ri6')
    expect(top.topByKg[0].productId).toBe('prod-xoai')
  })

  it('5. Hủy đơn được phân loại chính xác theo cancelledBy (CUSTOMER, SELLER, SYSTEM)', () => {
    const stats = computeCancellationAndComplaintRates(sampleOrdersFixture)

    // Tổng số đơn thương mại = 9 trừ 1 đơn DRAFT (ORD-08) = 8 đơn
    expect(stats.totalOrders).toBe(8)
    expect(stats.cancelledOrdersCount).toBe(3)
    // Tỷ lệ hủy = 3/8 = 37.5%
    expect(stats.cancellationRate).toBe(37.5)

    expect(stats.byCustomerCount).toBe(1)
    expect(stats.byCustomerRate).toBe(12.5) // 1/8 = 12.5%

    expect(stats.bySellerCount).toBe(1)
    expect(stats.bySellerRate).toBe(12.5) // 1/8 = 12.5%

    expect(stats.bySystemCount).toBe(1)
    expect(stats.bySystemRate).toBe(12.5) // 1/8 = 12.5%
  })

  it('6. Một đơn có nhiều khiếu nại không bị đếm trùng', () => {
    const stats = computeCancellationAndComplaintRates(sampleOrdersFixture)

    // ORD-01 có 2 khiếu nại nhưng chỉ tính là 1 đơn phát sinh khiếu nại
    expect(stats.complaintOrdersCount).toBe(1)
    // Tổng số bản ghi khiếu nại = 2
    expect(stats.totalComplaintsCount).toBe(2)
    // Tỷ lệ khiếu nại = 1 / 8 = 12.5%
    expect(stats.complaintRate).toBe(12.5)
  })

  it('7. Tỷ lệ hao hụt tính đúng theo tổng trọng lượng (weighted), không phải trung bình đơn giản các tỷ lệ', () => {
    // Thử nghiệm trực tiếp với fixture không đối xứng để chứng minh phép tính có trọng số:
    // Đơn A: đặt 100kg, thực tế 90kg -> hao hụt 10kg (10.0%)
    // Đơn B: đặt 10kg, thực tế 8kg -> hao hụt 2kg (20.0%)
    // Nếu tính trung bình đơn giản: (10% + 20%) / 2 = 15.0%
    // Tính đúng theo tổng trọng lượng: (1 - (90 + 8) / (100 + 10)) = (1 - 98/110) = 12/110 = 10.9%
    const asymmetricFixture: ReportOrderInput[] = [
      {
        id: 'asym-1',
        code: 'ORD-ASYM-1',
        status: OrderStatus.COMPLETED,
        type: OrderType.STANDARD,
        createdAt: new Date(),
        total: 1000000,
        finalTotal: null,
        depositAmount: 0,
        paymentOption: PaymentOption.FULL,
        cancelledBy: null,
        cancelReason: null,
        user: { id: 'u1', fullName: 'Khách 1', companyName: null, group: null },
        items: [
          {
            id: 'it-1',
            productId: 'p1',
            productName: 'Cam Sành',
            isSample: false,
            quantity: 5,
            orderedGrams: 100000, // 100kg
            actualGrams: 90000, // 90kg (10% hao hụt)
            unitPricePerKg: 10000,
            lineTotal: 1000000,
            finalLineTotal: null,
          },
        ],
      },
      {
        id: 'asym-2',
        code: 'ORD-ASYM-2',
        status: OrderStatus.COMPLETED,
        type: OrderType.STANDARD,
        createdAt: new Date(),
        total: 100000,
        finalTotal: null,
        depositAmount: 0,
        paymentOption: PaymentOption.FULL,
        cancelledBy: null,
        cancelReason: null,
        user: { id: 'u2', fullName: 'Khách 2', companyName: null, group: null },
        items: [
          {
            id: 'it-2',
            productId: 'p1',
            productName: 'Cam Sành',
            isSample: false,
            quantity: 1,
            orderedGrams: 10000, // 10kg
            actualGrams: 8000, // 8kg (20% hao hụt)
            unitPricePerKg: 10000,
            lineTotal: 100000,
            finalLineTotal: null,
          },
        ],
      },
    ]

    const stats = computeShrinkageStats(asymmetricFixture)
    expect(stats.shrinkageRate).toBe(10.9)
    expect(stats.shrinkageRate).not.toBe(15.0)

    // Đồng thời kiểm tra trên bộ fixture chính (ORD-01, ORD-02, ORD-09 đã cân, ORD-03 chưa cân bị bỏ qua)
    // Các dòng có cân:
    // Item 1 (ORD-01): 100kg ordered, 95kg actual
    // Item 2 (ORD-01): 50kg ordered, 48kg actual
    // Item 3 (ORD-02): 40kg ordered, 38kg actual
    // Item 6 (ORD-09): 10kg ordered, 9.5kg actual
    // Tổng ordered = 200,000g (200kg)
    // Tổng actual = 190,500g (190.5kg)
    // Hao hụt = 9,500g / 200,000g = 4.75% -> làm tròn 4.8%
    const sampleStats = computeShrinkageStats(sampleOrdersFixture)
    expect(sampleStats.measuredItemsCount).toBe(4)
    expect(sampleStats.totalOrderedGrams).toBe(200000)
    expect(sampleStats.totalActualGrams).toBe(190500)
    expect(sampleStats.shrinkageGrams).toBe(9500)
    expect(sampleStats.shrinkageRate).toBe(4.8)
  })

  it('8. Doanh thu theo nhóm khách hàng hiện tại đúng và không làm thay đổi snapshot đơn cũ', () => {
    const groupRevenue = computeRevenueByCustomerGroup(sampleOrdersFixture)

    // Các đơn COMPLETED:
    // ORD-01 (SUPERMARKET): 4,800,000 đ
    // ORD-09 (SUPERMARKET): 1,000,000 đ -> Nhóm Siêu thị = 5,800,000 đ (65.9%)
    // ORD-02 (TIER1_AGENT): 0 đ -> Nhóm Đại lý cấp 1 = 0 đ (0%)
    // ORD-03 (SMALL_SHOP): 3,000,000 đ -> Nhóm Cửa hàng nhỏ = 3,000,000 đ (34.1%)
    // Tổng = 8,800,000 đ
    expect(groupRevenue.totalRevenue).toBe(8800000)
    expect(groupRevenue.groupCount).toBe(3)

    const superMarket = groupRevenue.groups.find((g) => g.groupCode === 'SUPERMARKET')
    expect(superMarket).toBeDefined()
    expect(superMarket?.revenue).toBe(5800000)
    expect(superMarket?.orderCount).toBe(2)
    expect(superMarket?.percentage).toBe(65.9)

    const smallShop = groupRevenue.groups.find((g) => g.groupCode === 'SMALL_SHOP')
    expect(smallShop).toBeDefined()
    expect(smallShop?.revenue).toBe(3000000)
    expect(smallShop?.orderCount).toBe(1)
    expect(smallShop?.percentage).toBe(34.1)

    // Khẳng định snapshot đơn hàng lịch sử không bị biến đổi
    expect(sampleOrdersFixture[0].total).toBe(5000000)
    expect(sampleOrdersFixture[0].finalTotal).toBe(4800000)
  })

  it('9. Ngày/tuần theo giờ Việt Nam, gồm thời điểm sát nửa đêm', () => {
    // 2026-10-18T16:59:00.000Z tương ứng với 2026-10-18 23:59:00 tại Việt Nam (thuộc ngày 18/10)
    const date1 = new Date('2026-10-18T16:59:00.000Z')
    expect(formatVietnamDateString(date1)).toBe('2026-10-18')

    // 2026-10-18T17:00:01.000Z tương ứng với 2026-10-19 00:00:01 tại Việt Nam (thuộc ngày 19/10)
    const date2 = new Date('2026-10-18T17:00:01.000Z')
    expect(formatVietnamDateString(date2)).toBe('2026-10-19')

    // Kiểm tra resolveDateRange cho preset 7D
    const range = resolveDateRange('7D', null, null, new Date('2026-10-19T05:00:00.000Z'))
    expect(range.toText).toBe('2026-10-19')
    expect(range.fromText).toBe('2026-10-13')
    expect(range.preset).toBe('7D')
  })

  it('10. Trường hợp dữ liệu rỗng hoặc mẫu số bằng 0 không gây crash hoặc NaN', () => {
    const emptyTimeline = computeRevenueTimeline([], new Date(), new Date(), 'DAY')
    expect(emptyTimeline.totalRevenue).toBe(0)
    expect(emptyTimeline.totalCompletedOrders).toBe(0)

    const emptyTop = computeTopProducts([], 10)
    expect(emptyTop.topByKg).toEqual([])
    expect(emptyTop.topByRevenue).toEqual([])
    expect(emptyTop.sampleProductsCount).toBe(0)

    const emptyCancel = computeCancellationAndComplaintRates([])
    expect(emptyCancel.totalOrders).toBe(0)
    expect(emptyCancel.cancellationRate).toBe(0)
    expect(emptyCancel.complaintRate).toBe(0)

    const emptyShrinkage = computeShrinkageStats([])
    expect(emptyShrinkage.shrinkageRate).toBe(0)
    expect(emptyShrinkage.hasMeasuredData).toBe(false)

    const emptyCashflow = computeCashflowMetrics([])
    expect(emptyCashflow.completedRevenue).toBe(0)
    expect(emptyCashflow.netCashReceived).toBe(0)
  })

  it('11. Chặn truy cập báo cáo nếu không phải Admin', async () => {
    mockRequireAdmin.mockRejectedValueOnce(
      new Error('Forbidden: Chỉ quản trị viên mới có quyền xem báo cáo kinh doanh.')
    )

    const res = await getBusinessReports({ preset: '7D' })
    expect(res.success).toBe(false)
    expect(res.error).toContain('Forbidden')
    expect(mockDb.order.findMany).not.toHaveBeenCalled()
  })

  it('12. Bốn KPI Admin đúng với bộ dữ liệu mẫu', async () => {
    const kpis = computeAdminDashboardKpis({
      todayYmd: '2026-10-19',
      orders: [
        // Đơn 1: tạo hôm nay, status PENDING_CONFIRMATION
        {
          createdAt: new Date('2026-10-19T02:00:00.000Z'),
          status: OrderStatus.PENDING_CONFIRMATION,
          deliveryDate: new Date('2026-10-20T00:00:00.000Z'),
        },
        // Đơn 2: tạo hôm nay, status PROCESSING, giao hôm nay (2026-10-19)
        {
          createdAt: new Date('2026-10-19T04:00:00.000Z'),
          status: OrderStatus.PROCESSING,
          deliveryDate: new Date('2026-10-18T17:00:00.000Z'), // VN: 2026-10-19 00:00
        },
        // Đơn 3: tạo hôm qua, status PENDING_CONFIRMATION
        {
          createdAt: new Date('2026-10-18T10:00:00.000Z'),
          status: OrderStatus.PENDING_CONFIRMATION,
          deliveryDate: null,
        },
        // Đơn 4: tạo hôm nay nhưng status DRAFT (không tính vào đơn mới hôm nay)
        {
          createdAt: new Date('2026-10-19T06:00:00.000Z'),
          status: OrderStatus.DRAFT,
          deliveryDate: null,
        },
      ],
      openComplaintsCount: 3,
    })

    // 1. Đơn mới hôm nay: Đơn 1 + Đơn 2 = 2 đơn (Đơn 3 tạo hôm qua, Đơn 4 là DRAFT)
    expect(kpis.newOrdersToday).toBe(2)

    // 2. Chờ xác nhận tiền: Đơn 1 + Đơn 3 = 2 đơn
    expect(kpis.awaitingPaymentConfirmation).toBe(2)

    // 3. Đơn giao hôm nay: Đơn 2 = 1 đơn
    expect(kpis.deliveriesToday).toBe(1)

    // 4. Khiếu nại đang mở = 3
    expect(kpis.openComplaints).toBe(3)

    // Kiểm tra Server Action getAdminDashboardKpis với mock db
    mockDb.order.findMany.mockResolvedValueOnce([
      {
        createdAt: new Date('2026-10-19T02:00:00.000Z'),
        status: OrderStatus.PENDING_CONFIRMATION,
        deliveryDate: null,
      },
    ])
    mockDb.complaint.count.mockResolvedValueOnce(1)

    const serverKpis = await getAdminDashboardKpis(new Date('2026-10-19T05:00:00.000Z'))
    expect(serverKpis.newOrdersToday).toBe(1)
    expect(serverKpis.awaitingPaymentConfirmation).toBe(1)
    expect(serverKpis.openComplaints).toBe(1)
  })

  it('13. Phân biệt rõ ràng doanh thu và các thành phần dòng tiền (tiền đã nhận, đã hoàn, chờ hoàn)', () => {
    const transactions = [
      {
        id: 'tx-1',
        orderId: 'ord-01',
        type: TxType.PAYMENT,
        status: TxStatus.DONE,
        amount: 1500000,
        createdAt: new Date(),
      },
      {
        id: 'tx-2',
        orderId: 'ord-01',
        type: TxType.PAYMENT,
        status: TxStatus.DONE,
        amount: 3300000,
        createdAt: new Date(),
      },
      {
        id: 'tx-3',
        orderId: 'ord-04',
        type: TxType.REFUND,
        status: TxStatus.DONE,
        amount: 1500000,
        createdAt: new Date(),
      },
      {
        id: 'tx-4',
        orderId: 'ord-05',
        type: TxType.REFUND,
        status: TxStatus.PENDING,
        amount: 500000,
        createdAt: new Date(),
      },
    ]

    const cashflow = computeCashflowMetrics(sampleOrdersFixture, transactions)
    expect(cashflow.completedRevenue).toBe(8800000) // Đơn COMPLETED
    expect(cashflow.totalPaid).toBe(4800000) // 1.5M + 3.3M
    expect(cashflow.totalRefunded).toBe(1500000) // Đã hoàn
    expect(cashflow.pendingRefund).toBe(500000) // Đang chờ hoàn (chưa trừ lần 2)
    expect(cashflow.netCashReceived).toBe(3300000) // 4.8M - 1.5M
  })
})
