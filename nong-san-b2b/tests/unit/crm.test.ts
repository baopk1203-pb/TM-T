import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OrderStatus, Role } from '@prisma/client'
import {
  validateDiscountPercent,
  computeCustomerOrderStats,
  buildCustomerGroupChangeAuditEntry,
  resolveCustomerGroupContext,
  formatCustomerGroupBadge,
  filterCustomers,
} from '@/lib/domain/crm'
import { priceCart } from '@/lib/domain/pricing'

// Mock next/cache, @/lib/db, and @/lib/auth for Server Action integration tests (CRM-02, CRM-03, CRM-04, CRM-06, CRM-07)
const { mockDb, mockRequireAdmin, mockRevalidatePath } = vi.hoisted(() => ({
  mockDb: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    customerGroup: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    order: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    orderItem: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    orderEvent: {
      create: vi.fn(),
    },
  },
  mockRequireAdmin: vi.fn(),
  mockRevalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}))

vi.mock('@/lib/db', () => ({
  db: mockDb,
}))

vi.mock('@/lib/auth', () => ({
  requireAdmin: mockRequireAdmin,
}))

import {
  updateCustomerGroup,
  updateCustomerGroupDiscount,
} from '@/actions/admin-crm'

describe('Phase 7 — Batch 7A: CRM Khách hàng & Nhóm chiết khấu (CRM-01..CRM-07)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAdmin.mockResolvedValue({
      id: 'admin-01',
      email: 'admin@nongsan.vn',
      role: Role.ADMIN,
    })
  })

  describe('CRM-01: Danh sách khách hàng & Thống kê đơn hàng / doanh thu COMPLETED', () => {
    it('tính đúng tổng số đơn (không tính DRAFT) và tổng doanh thu chỉ từ đơn COMPLETED theo (finalTotal ?? total)', () => {
      const sampleOrders = [
        // Đơn COMPLETED có finalTotal sau tất toán cân thực tế
        {
          status: OrderStatus.COMPLETED,
          total: 5000000,
          finalTotal: 4850000,
        },
        // Đơn COMPLETED không có finalTotal -> fallback về total
        {
          status: OrderStatus.COMPLETED,
          total: 3200000,
          finalTotal: null,
        },
        // Đơn đang xử lý / chờ xác nhận -> tính vào orderCount nhưng KHÔNG cộng vào completedRevenue
        {
          status: OrderStatus.PROCESSING,
          total: 2000000,
          finalTotal: null,
        },
        {
          status: OrderStatus.PENDING_CONFIRMATION,
          total: 1500000,
          finalTotal: null,
        },
        {
          status: OrderStatus.PREORDER_WAITING,
          total: 4000000,
          finalTotal: null,
        },
        // Đơn đã hủy -> tính vào orderCount nhưng KHÔNG cộng vào completedRevenue
        {
          status: OrderStatus.CANCELLED,
          total: 1800000,
          finalTotal: null,
        },
        // Đơn DRAFT định kỳ chưa xác nhận -> KHÔNG tính vào orderCount và KHÔNG cộng vào completedRevenue
        {
          status: OrderStatus.DRAFT,
          total: 2500000,
          finalTotal: null,
        },
        {
          status: OrderStatus.DRAFT,
          total: 900000,
          finalTotal: null,
        },
      ]

      const stats = computeCustomerOrderStats(sampleOrders)

      // 8 records trừ 2 đơn DRAFT = 6 đơn thực tế
      expect(stats.orderCount).toBe(6)
      expect(stats.draftOrderCount).toBe(2)
      expect(stats.completedOrderCount).toBe(2)
      expect(stats.activeOrderCount).toBe(3)
      expect(stats.cancelledOrderCount).toBe(1)

      // Doanh thu COMPLETED = 4,850,000 + 3,200,000 = 8,050,000 đ
      expect(stats.completedRevenue).toBe(8050000)
    })

    it('trả về 0 cho tất cả chỉ số khi khách hàng chưa có đơn hàng nào', () => {
      const stats = computeCustomerOrderStats([])
      expect(stats).toEqual({
        orderCount: 0,
        completedOrderCount: 0,
        completedRevenue: 0,
        activeOrderCount: 0,
        cancelledOrderCount: 0,
        draftOrderCount: 0,
      })
    })

    it('hỗ trợ tìm kiếm theo tên, công ty, MST, SĐT, email và lọc theo nhóm khách hàng', () => {
      const customers = [
        {
          id: 'c1',
          fullName: 'Nguyễn Văn Đại Lý',
          email: 'daily1@demo.vn',
          phone: '0901112222',
          companyName: 'Công ty Nông Sản Miền Nam',
          taxCode: '0312345678',
          groupCode: 'TIER1_AGENT',
        },
        {
          id: 'c2',
          fullName: 'Trần Thị Siêu Thị',
          email: 'sieuthi@demo.vn',
          phone: '0903334444',
          companyName: 'Chuỗi Bách Hóa Xanh',
          taxCode: '0399887766',
          groupCode: 'SUPERMARKET',
        },
        {
          id: 'c3',
          fullName: 'Lê Văn Cửa Hàng',
          email: 'cuahang@demo.vn',
          phone: '0905556666',
          companyName: null,
          taxCode: null,
          groupCode: 'SMALL_SHOP',
        },
      ]

      expect(filterCustomers(customers, { search: '0399887766' })).toHaveLength(1)
      expect(filterCustomers(customers, { search: 'Bách Hóa' })[0].id).toBe('c2')
      expect(filterCustomers(customers, { groupCode: 'TIER1_AGENT' })).toHaveLength(1)
      expect(
        filterCustomers(customers, { search: '090', groupCode: 'SMALL_SHOP' })[0].id
      ).toBe('c3')
    })
  })

  describe('CRM-02: Admin đổi nhóm khách SMALL_SHOP -> SUPERMARKET', () => {
    it('cập nhật user.groupId sang nhóm mới và ghi structured server audit log (không chạm OrderEvent)', async () => {
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      mockDb.user.findUnique.mockResolvedValue({
        id: 'cust-shop-01',
        role: Role.CUSTOMER,
        groupId: 'grp-small-shop',
        group: {
          id: 'grp-small-shop',
          code: 'SMALL_SHOP',
          name: 'Cửa hàng nhỏ',
          discountPercent: 0,
        },
      })

      mockDb.customerGroup.findUnique.mockResolvedValue({
        id: 'grp-supermarket',
        code: 'SUPERMARKET',
        name: 'Siêu thị',
        discountPercent: 3,
      })

      mockDb.user.update.mockResolvedValue({
        id: 'cust-shop-01',
        groupId: 'grp-supermarket',
      })

      const result = await updateCustomerGroup({
        customerId: 'cust-shop-01',
        groupId: 'grp-supermarket',
        reason: 'Đạt sản lượng nhập 2 tấn/tháng',
      })

      expect(result.success).toBe(true)
      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'cust-shop-01' },
        data: { groupId: 'grp-supermarket' },
      })

      // Tuyệt đối không gắn vào OrderEvent hay sửa Order lịch sử
      expect(mockDb.orderEvent.create).not.toHaveBeenCalled()
      expect(mockDb.order.update).not.toHaveBeenCalled()
      expect(mockDb.order.updateMany).not.toHaveBeenCalled()

      // Kiểm tra structured audit log
      expect(result.auditLog).toBeDefined()
      expect(result.auditLog?.event).toBe('CUSTOMER_GROUP_CHANGED')
      expect(result.auditLog?.actorId).toBe('admin-01')
      expect(result.auditLog?.customerId).toBe('cust-shop-01')
      expect(result.auditLog?.fromGroup.code).toBe('SMALL_SHOP')
      expect(result.auditLog?.toGroup.code).toBe('SUPERMARKET')
      expect(result.auditLog?.toGroup.discountPercent).toBe(3)
      expect(result.auditLog?.reason).toBe('Đạt sản lượng nhập 2 tấn/tháng')
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        '[CRM_AUDIT]',
        expect.stringContaining('"CUSTOMER_GROUP_CHANGED"')
      )

      consoleInfoSpy.mockRestore()
    })
  })

  describe('CRM-03: Validate discountPercent (0..50 số nguyên)', () => {
    it('chấp nhận các giá trị số nguyên biên và hợp lệ trong khoảng 0..50', () => {
      expect(validateDiscountPercent(0)).toEqual({ valid: true, value: 0 })
      expect(validateDiscountPercent(3)).toEqual({ valid: true, value: 3 })
      expect(validateDiscountPercent(5)).toEqual({ valid: true, value: 5 })
      expect(validateDiscountPercent(50)).toEqual({ valid: true, value: 50 })
    })

    it('từ chối số âm, số thập phân, giá trị > 50, NaN, Infinity và kiểu không phải number', () => {
      expect(validateDiscountPercent(-1).valid).toBe(false)
      expect(validateDiscountPercent(-10).valid).toBe(false)
      expect(validateDiscountPercent(3.5).valid).toBe(false)
      expect(validateDiscountPercent(0.1).valid).toBe(false)
      expect(validateDiscountPercent(51).valid).toBe(false)
      expect(validateDiscountPercent(100).valid).toBe(false)
      expect(validateDiscountPercent(Number.NaN).valid).toBe(false)
      expect(validateDiscountPercent(Number.POSITIVE_INFINITY).valid).toBe(false)
      expect(validateDiscountPercent('5').valid).toBe(false)
      expect(validateDiscountPercent(null).valid).toBe(false)
    })

    it('Server Action updateCustomerGroupDiscount từ chối lưu DB khi discountPercent không hợp lệ', async () => {
      const negRes = await updateCustomerGroupDiscount({
        groupId: 'grp-supermarket',
        discountPercent: -5,
      })
      expect(negRes.success).toBe(false)

      const floatRes = await updateCustomerGroupDiscount({
        groupId: 'grp-supermarket',
        discountPercent: 4.5,
      })
      expect(floatRes.success).toBe(false)

      const overRes = await updateCustomerGroupDiscount({
        groupId: 'grp-supermarket',
        discountPercent: 55,
      })
      expect(overRes.success).toBe(false)

      expect(mockDb.customerGroup.update).not.toHaveBeenCalled()
    })
  })

  describe('CRM-04: Admin sửa chiết khấu nhóm (3% -> 4%) chỉ áp dụng cho đơn mới, bảo toàn snapshot đơn cũ', () => {
    it('cập nhật discountPercent của nhóm lên 4%, giữ nguyên snapshot đơn cũ (3%) và áp dụng 4% cho báo giá/đơn mới', async () => {
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      // Snapshot đơn hàng lịch sử đã tạo lúc nhóm Siêu thị hưởng 3%
      const historicalConfirmedOrderSnapshot = Object.freeze({
        id: 'ord-hist-01',
        code: 'ORD-20261010-001',
        status: OrderStatus.COMPLETED,
        groupDiscountPercent: 3,
        subtotal: 970000,
        total: 970000,
        items: [
          Object.freeze({
            productId: 'prod-xoai',
            basePricePerKg: 50000,
            discountPercent: 3,
            unitPricePerKg: 48500, // 50,000 * 97%
            weightGrams: 20000,
            lineTotal: 970000,
          }),
        ],
      })

      mockDb.customerGroup.findUnique.mockResolvedValue({
        id: 'grp-supermarket',
        code: 'SUPERMARKET',
        name: 'Siêu thị',
        discountPercent: 3,
      })

      mockDb.customerGroup.update.mockResolvedValue({
        id: 'grp-supermarket',
        code: 'SUPERMARKET',
        name: 'Siêu thị',
        discountPercent: 4,
      })

      const updateRes = await updateCustomerGroupDiscount({
        groupId: 'grp-supermarket',
        discountPercent: 4,
      })

      expect(updateRes.success).toBe(true)
      expect(updateRes.group?.discountPercent).toBe(4)

      // Server Action tuyệt đối KHÔNG đụng chạm bảng Order hay OrderItem lịch sử
      expect(mockDb.order.update).not.toHaveBeenCalled()
      expect(mockDb.order.updateMany).not.toHaveBeenCalled()
      expect(mockDb.orderItem.update).not.toHaveBeenCalled()
      expect(mockDb.orderItem.updateMany).not.toHaveBeenCalled()

      // Snapshot đơn cũ vẫn giữ nguyên 3% và đơn giá 48,500 đ/kg
      expect(historicalConfirmedOrderSnapshot.groupDiscountPercent).toBe(3)
      expect(historicalConfirmedOrderSnapshot.items[0].unitPricePerKg).toBe(48500)

      // Báo giá / đơn hàng mới tạo sau khi đổi chiết khấu sang 4% sẽ tính theo 4%
      const newCartQuote = priceCart({
        lines: [
          {
            productId: 'prod-xoai',
            packagingId: 'pkg-20kg',
            quantity: 1,
          },
        ],
        products: [
          {
            id: 'prod-xoai',
            name: 'Xoài Cát Hòa Lộc',
            moqGrams: 10000,
            priceTiers: [{ minGrams: 10000, pricePerKg: 50000 }],
            packagings: [
              {
                id: 'pkg-20kg',
                name: 'Thùng 20kg',
                weightGrams: 20000,
                isSample: false,
                samplePrice: null,
              },
            ],
          },
        ],
        groupDiscountPercent: updateRes.group!.discountPercent,
      })

      expect(newCartQuote.productSummaries[0].basePricePerKg).toBe(50000)
      expect(newCartQuote.lines[0].unitPricePerKg).toBe(48000) // 50,000 * 96% = 48,000 đ/kg
      expect(newCartQuote.subtotal).toBe(960000)

      consoleInfoSpy.mockRestore()
    })
  })

  describe('CRM-05: Đồng bộ DB-to-UI không phụ thuộc giá trị cứng trong JWT cũ', () => {
    it('resolveCustomerGroupContext luôn ưu tiên nhóm và % chiết khấu mới nhất từ DB thay vì JWT cũ', () => {
      // Giả sử JWT lúc đăng nhập đang lưu SMALL_SHOP (0%)
      const staleJwtSessionUser = {
        id: 'cust-01',
        name: 'Siêu Thị Mini Xanh',
        role: Role.CUSTOMER,
        groupId: 'grp-small-shop',
        groupCode: 'SMALL_SHOP',
        groupName: 'Cửa hàng nhỏ',
        discountPercent: 0,
      }

      // Admin vừa nâng hạng khách lên SUPERMARKET và sửa chiết khấu nhóm thành 4% trong DB
      const freshDbUser = {
        id: 'cust-01',
        fullName: 'Siêu Thị Mini Xanh',
        companyName: 'Công ty Xanh Mini',
        phone: '0909123456',
        role: Role.CUSTOMER,
        groupId: 'grp-supermarket',
        group: {
          id: 'grp-supermarket',
          code: 'SUPERMARKET',
          name: 'Siêu thị',
          discountPercent: 4,
        },
      }

      const resolved = resolveCustomerGroupContext(freshDbUser, staleJwtSessionUser)

      expect(resolved.groupId).toBe('grp-supermarket')
      expect(resolved.groupCode).toBe('SUPERMARKET')
      expect(resolved.groupName).toBe('Siêu thị')
      expect(resolved.discountPercent).toBe(4)

      // Kiểm tra hiển thị badge trên Header / Account Layout không bị hardcode vào 5% hay 3%
      const badge = formatCustomerGroupBadge({
        code: resolved.groupCode,
        name: resolved.groupName,
        discountPercent: resolved.discountPercent,
      })

      expect(badge.label).toBe('Siêu thị (-4%)')
      expect(badge.groupName).toBe('Siêu thị')
      expect(badge.discountPercent).toBe(4)
    })

    it('fallback an toàn về session hiện tại nếu dbUser không tồn tại', () => {
      const fallback = resolveCustomerGroupContext(null, {
        id: 'cust-02',
        name: 'Đại Lý A',
        role: Role.CUSTOMER,
        groupId: 'grp-tier1',
        groupCode: 'TIER1_AGENT',
        groupName: 'Đại lý cấp 1',
        discountPercent: 5,
      })

      expect(fallback.groupCode).toBe('TIER1_AGENT')
      expect(fallback.discountPercent).toBe(5)
    })
  })

  describe('CRM-06: Khách chưa có đơn hàng nào (0 đơn) vẫn đổi nhóm thành công', () => {
    it('cho phép đổi nhóm khách hàng mới đăng ký có 0 đơn hàng và ghi structured audit log đầy đủ', async () => {
      const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      mockDb.user.findUnique.mockResolvedValue({
        id: 'cust-zero-order',
        role: Role.CUSTOMER,
        groupId: 'grp-small-shop',
        group: {
          id: 'grp-small-shop',
          code: 'SMALL_SHOP',
          name: 'Cửa hàng nhỏ',
          discountPercent: 0,
        },
      })

      mockDb.customerGroup.findUnique.mockResolvedValue({
        id: 'grp-tier1',
        code: 'TIER1_AGENT',
        name: 'Đại lý cấp 1',
        discountPercent: 5,
      })

      mockDb.user.update.mockResolvedValue({
        id: 'cust-zero-order',
        groupId: 'grp-tier1',
      })

      const result = await updateCustomerGroup({
        customerId: 'cust-zero-order',
        groupId: 'grp-tier1',
        reason: 'Ký hợp đồng đại lý phân phối độc quyền ngay khi mở tài khoản',
      })

      expect(result.success).toBe(true)
      expect(result.auditLog).toMatchObject({
        event: 'CUSTOMER_GROUP_CHANGED',
        actorId: 'admin-01',
        customerId: 'cust-zero-order',
        fromGroup: {
          code: 'SMALL_SHOP',
          discountPercent: 0,
        },
        toGroup: {
          code: 'TIER1_AGENT',
          discountPercent: 5,
        },
        reason: 'Ký hợp đồng đại lý phân phối độc quyền ngay khi mở tài khoản',
      })

      // Không cần bất kỳ bản ghi Order hay OrderEvent nào
      expect(mockDb.orderEvent.create).not.toHaveBeenCalled()

      // Kiểm tra trực tiếp hàm buildCustomerGroupChangeAuditEntry không lộ thông tin nhạy cảm
      const pureAuditEntry = buildCustomerGroupChangeAuditEntry({
        actorId: 'admin-01',
        customerId: 'cust-zero-order',
        fromGroup: null,
        toGroup: {
          id: 'grp-tier1',
          code: 'TIER1_AGENT',
          name: 'Đại lý cấp 1',
          discountPercent: 5,
        },
        reason: '   Nâng hạng trực tiếp   ',
      })
      expect(pureAuditEntry.reason).toBe('Nâng hạng trực tiếp')
      expect(pureAuditEntry.fromGroup.code).toBeNull()

      const auditKeys = Object.keys(result.auditLog!)
      expect(auditKeys).toEqual([
        'event',
        'actorId',
        'customerId',
        'fromGroup',
        'toGroup',
        'reason',
        'timestamp',
      ])
      expect(JSON.stringify(result.auditLog)).not.toContain('passwordHash')

      consoleInfoSpy.mockRestore()
    })
  })

  describe('CRM-07: Bảo vệ quyền truy cập Admin (Non-admin gọi action CRM bị từ chối)', () => {
    it('từ chối thực thi updateCustomerGroup khi người gọi không có quyền ADMIN', async () => {
      mockRequireAdmin.mockRejectedValueOnce(
        new Error('Forbidden: Chỉ quản trị viên mới có quyền thực hiện thao tác này.')
      )

      const res = await updateCustomerGroup({
        customerId: 'cust-01',
        groupId: 'grp-tier1',
      })

      expect(res.success).toBe(false)
      expect(res.error).toContain('Forbidden')
      expect(mockDb.user.update).not.toHaveBeenCalled()
    })

    it('từ chối thực thi updateCustomerGroupDiscount khi người gọi không có quyền ADMIN', async () => {
      mockRequireAdmin.mockRejectedValueOnce(
        new Error('Unauthorized: Bạn cần đăng nhập để thực hiện thao tác này.')
      )

      const res = await updateCustomerGroupDiscount({
        groupId: 'grp-tier1',
        discountPercent: 10,
      })

      expect(res.success).toBe(false)
      expect(res.error).toContain('Unauthorized')
      expect(mockDb.customerGroup.update).not.toHaveBeenCalled()
    })
  })
})
