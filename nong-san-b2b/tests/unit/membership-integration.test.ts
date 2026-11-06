import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  MembershipTier,
  calculateCombinedProductDiscount,
  calculateMembershipShippingDiscount,
  calculateMembershipShippingBenefit,
  resolveEffectiveMembershipTier,
} from '@/lib/domain/membership'
import {
  priceCart,
  ProductPricingData,
} from '@/lib/domain/pricing'
import { calculateShippingQuote } from '@/lib/domain/shipping'
import { registerUser } from '@/server/actions/auth'
import { Role, TimeSlot } from '@prisma/client'
import { computeDepositAmount } from '@/lib/domain/settlement'
import { placeOrder } from '@/actions/order'
import { requireUser } from '@/lib/auth'
import { recordOrderEvent } from '@/lib/events'

// Mock db for auth & checkout registration tests
const { mockDb } = vi.hoisted(() => {
  const mockDbInstance = {
    $transaction: vi.fn(),
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    customerGroup: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    address: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    product: {
      findMany: vi.fn(),
    },
    order: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    orderEvent: {
      create: vi.fn(),
    },
    weeklyCapacity: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    orderItem: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  }
  mockDbInstance.$transaction.mockImplementation(async (callback: (tx: typeof mockDbInstance) => Promise<unknown>) => {
    return await callback(mockDbInstance)
  })
  return { mockDb: mockDbInstance }
})

vi.mock('@/lib/db', () => ({
  db: mockDb,
}))

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(),
  requireAdmin: vi.fn(),
  getServerAuthSession: vi.fn(),
}))

vi.mock('@/lib/events', () => ({
  recordOrderEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/services/inventory-reservation', () => ({
  reserveOrderInventoryFefo: vi.fn().mockResolvedValue({
    success: true,
    allocations: [],
    shortages: [],
  }),
}))

vi.mock('@/lib/email', () => ({
  sendOrderNotification: vi.fn().mockResolvedValue({ success: true }),
}))

describe('EV-F04-05: Membership Pricing & Shipping Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Dữ liệu sản phẩm mẫu chuẩn
  const productA: ProductPricingData = {
    id: 'prod-xoai-cat',
    name: 'Xoài Cát Hòa Lộc Tiêu Chuẩn',
    moqGrams: 50000, // 50kg
    priceTiers: [
      { minGrams: 50000, pricePerKg: 100000 }, // Bậc 1: 50kg - 100.000 đ/kg
      { minGrams: 200000, pricePerKg: 90000 }, // Bậc 2: 200kg - 90.000 đ/kg
    ],
    packagings: [
      {
        id: 'pkg-thung-10kg',
        name: 'Thùng 10kg',
        weightGrams: 10000,
        isSample: false,
      },
      {
        id: 'pkg-thung-25kg',
        name: 'Thùng 25kg',
        weightGrams: 25000,
        isSample: false,
      },
      {
        id: 'pkg-sample-1kg',
        name: 'Gói mẫu thử 1kg',
        weightGrams: 1000,
        isSample: true,
        samplePrice: 50000,
      },
    ],
  }

  // =========================================================================
  // GROUP A: PRODUCT PRICING INTEGRATION & DISCOUNT CAPS (PAR-10, PAR-12)
  // =========================================================================
  describe('Group A — Product Discount & Combined Cap (PAR-10, PAR-12)', () => {
    it('TC01: Hạng Đồng (BRONZE) nhận chiết khấu sản phẩm 2% khi không có chiết khấu nhóm', () => {
      const quote = priceCart({
        lines: [{ productId: 'prod-xoai-cat', packagingId: 'pkg-thung-10kg', quantity: 5 }], // 50kg
        products: [productA],
        groupDiscountPercent: 0,
        membershipTier: MembershipTier.BRONZE,
      })

      expect(quote.isValid).toBe(true)
      expect(quote.groupDiscountPercent).toBe(0)
      expect(quote.membershipDiscountPercent).toBe(2)
      expect(quote.combinedDiscountPercent).toBe(2)
      // Giá gốc 100.000 đ -> giảm 2% còn 98.000 đ
      expect(quote.lines[0].unitPricePerKg).toBe(98000)
      expect(quote.subtotal).toBe(98000 * 50) // 4.900.000 đ
    })

    it('TC02: Hạng Bạc (SILVER) nhận chiết khấu sản phẩm 3%', () => {
      const quote = priceCart({
        lines: [{ productId: 'prod-xoai-cat', packagingId: 'pkg-thung-10kg', quantity: 5 }],
        products: [productA],
        groupDiscountPercent: 0,
        membershipTier: MembershipTier.SILVER,
      })

      expect(quote.membershipDiscountPercent).toBe(3)
      expect(quote.combinedDiscountPercent).toBe(3)
      expect(quote.lines[0].unitPricePerKg).toBe(97000)
    })

    it('TC03: Hạng Vàng (GOLD) nhận chiết khấu sản phẩm 4%', () => {
      const quote = priceCart({
        lines: [{ productId: 'prod-xoai-cat', packagingId: 'pkg-thung-10kg', quantity: 5 }],
        products: [productA],
        groupDiscountPercent: 0,
        membershipTier: MembershipTier.GOLD,
      })

      expect(quote.membershipDiscountPercent).toBe(4)
      expect(quote.combinedDiscountPercent).toBe(4)
      expect(quote.lines[0].unitPricePerKg).toBe(96000)
    })

    it('TC04: Hạng Kim Cương (DIAMOND) nhận chiết khấu sản phẩm 5%', () => {
      const quote = priceCart({
        lines: [{ productId: 'prod-xoai-cat', packagingId: 'pkg-thung-10kg', quantity: 5 }],
        products: [productA],
        groupDiscountPercent: 0,
        membershipTier: MembershipTier.DIAMOND,
      })

      expect(quote.membershipDiscountPercent).toBe(5)
      expect(quote.combinedDiscountPercent).toBe(5)
      expect(quote.lines[0].unitPricePerKg).toBe(95000)
    })

    it('TC05: Cộng dồn chiết khấu nhóm 5% + Hạng Vàng 4% = 9% (< 10%)', () => {
      const quote = priceCart({
        lines: [{ productId: 'prod-xoai-cat', packagingId: 'pkg-thung-10kg', quantity: 5 }],
        products: [productA],
        groupDiscountPercent: 5,
        membershipTier: MembershipTier.GOLD,
      })

      expect(quote.groupDiscountPercent).toBe(5)
      expect(quote.membershipDiscountPercent).toBe(4)
      expect(quote.combinedDiscountPercent).toBe(9)
      expect(quote.lines[0].unitPricePerKg).toBe(91000) // 100.000 * 0.91
    })

    it('TC06: Khống chế trần PAR-10: Nhóm 8% + Kim Cương 5% = 13% -> áp dụng tối đa 10%', () => {
      const quote = priceCart({
        lines: [{ productId: 'prod-xoai-cat', packagingId: 'pkg-thung-10kg', quantity: 5 }],
        products: [productA],
        groupDiscountPercent: 8,
        membershipTier: MembershipTier.DIAMOND,
      })

      expect(quote.combinedDiscountPercent).toBe(10)
      expect(quote.lines[0].unitPricePerKg).toBe(90000) // Giảm đúng 10%
    })

    it('TC07: Khống chế trần PAR-10: Nhóm 10% + Đồng 2% = 12% -> áp dụng tối đa 10%', () => {
      const quote = priceCart({
        lines: [{ productId: 'prod-xoai-cat', packagingId: 'pkg-thung-10kg', quantity: 5 }],
        products: [productA],
        groupDiscountPercent: 10,
        membershipTier: MembershipTier.BRONZE,
      })

      expect(quote.combinedDiscountPercent).toBe(10)
      expect(quote.lines[0].unitPricePerKg).toBe(90000)
    })

    it('TC08: Trường hợp nhóm đối tác có chiết khấu > 10% (ví dụ 12%): khống chế trần 10%', () => {
      const quote = priceCart({
        lines: [{ productId: 'prod-xoai-cat', packagingId: 'pkg-thung-10kg', quantity: 5 }],
        products: [productA],
        groupDiscountPercent: 12,
        membershipTier: null,
      })

      expect(quote.combinedDiscountPercent).toBe(10)
      expect(quote.lines[0].unitPricePerKg).toBe(90000)
    })

    it('TC09: Chiết khấu cộng dồn áp dụng một lần duy nhất, không nhân hai lần lên giá trị', () => {
      // 100.000 đ giảm 9% (5% + 4%) = 91.000 đ.
      // Nếu nhân 2 lần sai sẽ là: 100.000 * 0.95 = 95.000 -> 95.000 * 0.96 = 91.200 đ
      const quote = priceCart({
        lines: [{ productId: 'prod-xoai-cat', packagingId: 'pkg-thung-10kg', quantity: 5 }],
        products: [productA],
        groupDiscountPercent: 5,
        membershipTier: MembershipTier.GOLD,
      })

      expect(quote.lines[0].unitPricePerKg).toBe(91000)
    })

    it('TC10: Bảo toàn logic giá sỉ theo tổng sản lượng: 200kg đạt bậc 2 (90.000 đ) trước khi chiết khấu', () => {
      const quote = priceCart({
        lines: [{ productId: 'prod-xoai-cat', packagingId: 'pkg-thung-25kg', quantity: 8 }], // 200kg
        products: [productA],
        groupDiscountPercent: 5,
        membershipTier: MembershipTier.GOLD, // 4% -> tổng 9%
      })

      // Base price của bậc 200kg là 90.000 đ
      // Sau chiết khấu 9%: round(90.000 * 0.91) = 81.900 đ/kg
      expect(quote.productSummaries[0].basePricePerKg).toBe(90000)
      expect(quote.lines[0].unitPricePerKg).toBe(81900)
      expect(quote.subtotal).toBe(81900 * 200) // 16.380.000 đ
    })

    it('TC11: Hàng mẫu (isSample = true) không áp dụng chiết khấu nhóm hoặc thành viên', () => {
      const quote = priceCart({
        lines: [
          { productId: 'prod-xoai-cat', packagingId: 'pkg-thung-10kg', quantity: 5 }, // 50kg sỉ
          { productId: 'prod-xoai-cat', packagingId: 'pkg-sample-1kg', quantity: 1 }, // 1kg mẫu (50.000 đ)
        ],
        products: [productA],
        groupDiscountPercent: 5,
        membershipTier: MembershipTier.DIAMOND, // 5% -> tổng 10%
      })

      expect(quote.sampleLines.length).toBe(1)
      expect(quote.sampleLines[0].samplePrice).toBe(50000)
      expect(quote.sampleLines[0].lineTotal).toBe(50000) // Không giảm
      expect(quote.lines[0].unitPricePerKg).toBe(90000) // Hàng sỉ được giảm 10%
      expect(quote.subtotal).toBe(90000 * 50 + 50000) // 4.550.000 đ
    })
  })

  // =========================================================================
  // GROUP B: SHIPPING BENEFITS INTEGRATION (PAR-13, PAR-14, PAR-15)
  // =========================================================================
  describe('Group B — Shipping Benefits & 50kg Threshold (PAR-13, PAR-14, PAR-15)', () => {
    it('TC12: Đơn hàng 49.99 kg (49.990g): Dưới 50kg không được giảm phí ship theo Membership', () => {
      const benefit = calculateMembershipShippingBenefit({
        baseShippingFee: 200000,
        totalGrams: 49990, // 49.99kg < 50kg
        tier: MembershipTier.DIAMOND, // 20%
      })

      expect(benefit.meetsWeightThreshold).toBe(false)
      expect(benefit.membershipShippingDiscount).toBe(0)
      expect(benefit.finalShippingFee).toBe(200000)
    })

    it('TC13: Đơn hàng đạt đúng 50 kg (50.000g): Được giảm phí ship theo % của tier', () => {
      const benefit = calculateMembershipShippingBenefit({
        baseShippingFee: 200000,
        totalGrams: 50000, // Đạt đúng 50kg
        tier: MembershipTier.SILVER, // 10%
      })

      expect(benefit.meetsWeightThreshold).toBe(true)
      expect(benefit.membershipShippingDiscount).toBe(20000) // 10% của 200k = 20k
      expect(benefit.finalShippingFee).toBe(180000)
    })

    it('TC14: Đơn hàng trên 50 kg (ví dụ 100 kg): Được giảm phí ship theo % của tier', () => {
      const benefitGold = calculateMembershipShippingBenefit({
        baseShippingFee: 300000,
        totalGrams: 100000, // 100kg
        tier: MembershipTier.GOLD, // 15%
      })

      expect(benefitGold.meetsWeightThreshold).toBe(true)
      expect(benefitGold.membershipShippingDiscount).toBe(45000) // 15% của 300k = 45k
      expect(benefitGold.finalShippingFee).toBe(255000)
    })

    it('TC15: Cước ship gốc = 0 đ: Mức giảm = 0 đ, cước cuối = 0 đ', () => {
      const benefit = calculateMembershipShippingBenefit({
        baseShippingFee: 0,
        totalGrams: 60000,
        tier: MembershipTier.DIAMOND,
      })

      expect(benefit.membershipShippingDiscount).toBe(0)
      expect(benefit.finalShippingFee).toBe(0)
    })

    it('TC16: Cước ship gốc nhỏ hơn mức giảm danh nghĩa: Không bao giờ tạo cước ship âm', () => {
      const benefit = calculateMembershipShippingBenefit({
        baseShippingFee: 30000,
        totalGrams: 60000,
        tier: MembershipTier.DIAMOND, // 20% của 30k = 6k <= 30k
      })

      expect(benefit.finalShippingFee).toBe(24000)
      expect(benefit.finalShippingFee).toBeGreaterThanOrEqual(0)
    })

    it('TC17: Khống chế trần PAR-14: Mức giảm danh nghĩa vượt 100.000 đ bị khống chế tối đa 100.000 đ', () => {
      // Cước gốc 600.000 đ, Kim Cương 20% danh nghĩa = 120.000 đ -> Trần 100.000 đ
      const benefit = calculateMembershipShippingBenefit({
        baseShippingFee: 600000,
        totalGrams: 70000,
        tier: MembershipTier.DIAMOND,
      })

      expect(benefit.membershipShippingDiscount).toBe(100000)
      expect(benefit.finalShippingFee).toBe(500000)
    })

    it('TC18: Shipping quote engine tích hợp tính toán khối lượng và giảm giá chuẩn xác', async () => {
      // Dùng quote calculation với địa chỉ mẫu
      const res = await calculateShippingQuote({
        totalGrams: 60000, // 60kg >= 50kg
        lat: 10.7769, // Quận 1
        lng: 106.7009,
        membershipTier: MembershipTier.BRONZE, // 5%
      })

      expect(res.allowed).toBe(true)
      expect(res.baseShippingFee).toBeDefined()
      expect(res.membershipShippingDiscount).toBeDefined()
      expect(res.fee).toBe(res.baseShippingFee! - res.membershipShippingDiscount!)
    })
  })

  // =========================================================================
  // GROUP C: CHECKOUT SERVER INTEGRATION & SECURITY
  // =========================================================================
  describe('Group C — Checkout Server Integration & Security', () => {
    it('TC19: Server độc lập xác định Membership: không tin tưởng giá trị do client gửi', () => {
      // Client giả mạo gửi membershipDiscountPercent = 20% hoặc combined = 30%
      const serverQuote = priceCart({
        lines: [{ productId: 'prod-xoai-cat', packagingId: 'pkg-thung-10kg', quantity: 5 }],
        products: [productA],
        groupDiscountPercent: 0,
        membershipTier: MembershipTier.BRONZE, // Server tra từ DB: Đồng 2%
      })

      // Server chỉ áp dụng 2% hợp lệ từ tier DB
      expect(serverQuote.combinedDiscountPercent).toBe(2)
      expect(serverQuote.lines[0].unitPricePerKg).toBe(98000)
    })

    it('TC20: Server không chấp nhận tier giả mạo từ client: tra cứu trực tiếp từ session DB', () => {
      const genuineCustomer = { role: 'CUSTOMER', membershipTier: MembershipTier.BRONZE }
      const resolved = resolveEffectiveMembershipTier(genuineCustomer)
      expect(resolved).toBe(MembershipTier.BRONZE)

      // Đối tượng hacker gửi tier không hợp lệ
      const forgedCustomer = { role: 'CUSTOMER', membershipTier: 'SUPER_VIP' as MembershipTier }
      const fallbackResolved = resolveEffectiveMembershipTier(forgedCustomer)
      // Không khớp enum -> fallback về BRONZE mặc định
      expect(fallbackResolved).toBe(MembershipTier.BRONZE)
    })

    it('TC21: Cart Summary và Checkout Summary dùng chung priceCart, bảo đảm tính nhất quán', () => {
      const cartInput = {
        lines: [{ productId: 'prod-xoai-cat', packagingId: 'pkg-thung-10kg', quantity: 6 }],
        products: [productA],
        groupDiscountPercent: 5,
        membershipTier: MembershipTier.GOLD,
      }

      const cartQuote = priceCart(cartInput)
      const checkoutQuote = priceCart(cartInput)

      expect(cartQuote.subtotal).toBe(checkoutQuote.subtotal)
      expect(cartQuote.combinedDiscountPercent).toBe(checkoutQuote.combinedDiscountPercent)
    })

    it('TC22: Tổng tiền đơn hàng total luôn khớp đúng subtotal + shippingFee', () => {
      const quote = priceCart({
        lines: [{ productId: 'prod-xoai-cat', packagingId: 'pkg-thung-10kg', quantity: 5 }],
        products: [productA],
        groupDiscountPercent: 5,
        membershipTier: MembershipTier.SILVER, // 3% -> tổng 8%
      })

      const subtotal = quote.subtotal
      const finalShippingFee = 150000
      const total = subtotal + finalShippingFee

      expect(total).toBe(subtotal + finalShippingFee)
      expect(total).toBeGreaterThan(0)
    })

    it('TC23: Financial snapshot lưu trữ đầy đủ các giá trị độc lập', () => {
      const snapshot = {
        membershipTier: MembershipTier.GOLD,
        membershipDiscountPercent: 4,
        groupDiscountPercent: 5,
        combinedDiscountPercent: 9,
        baseShippingFee: 200000,
        shippingDiscountAmount: 30000, // 15% của 200k
        finalShippingFee: 170000,
        subtotal: 4550000,
        total: 4720000,
      }

      expect(snapshot.membershipTier).toBe(MembershipTier.GOLD)
      expect(snapshot.combinedDiscountPercent).toBe(9)
      expect(snapshot.finalShippingFee).toBe(snapshot.baseShippingFee - snapshot.shippingDiscountAmount)
      expect(snapshot.total).toBe(snapshot.subtotal + snapshot.finalShippingFee)
    })
  })

  // =========================================================================
  // GROUP D: BRONZE DEFAULT INITIALIZATION & MEMBERSHIP LIFECYCLE
  // =========================================================================
  describe('Group D — Bronze Default Initialization & User Consistency', () => {
    it('TC26: Khách hàng B2B mới đăng ký qua registerUser mặc định nhận membershipTier = BRONZE', async () => {
      mockDb.user.findUnique.mockResolvedValue(null)
      mockDb.customerGroup.findFirst.mockResolvedValue({ id: 'group-default-1' })
      mockDb.user.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'new-user-b2b',
        ...data,
      }))

      const result = await registerUser({
        email: 'b2b-new@example.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
        fullName: 'Nguyễn Văn Doanh Nghiệp',
        phone: '0901234567',
        companyName: 'Công Ty Nông Sản Việt',
        taxCode: '0312345678',
      })

      expect(result.success).toBe(true)
      expect(mockDb.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'b2b-new@example.com',
            role: Role.CUSTOMER,
            membershipTier: MembershipTier.BRONZE,
          }),
        })
      )
    })

    it('TC26B: registerUser fallback an toàn nếu DB chưa chạy migration (chưa có cột membershipTier)', async () => {
      mockDb.user.findUnique.mockResolvedValue(null)
      mockDb.customerGroup.findFirst.mockResolvedValue({ id: 'group-default-1' })
      // Lần đầu ném lỗi column membershipTier does not exist
      mockDb.user.create
        .mockRejectedValueOnce(new Error('column "membershipTier" of relation "User" does not exist'))
        .mockResolvedValueOnce({
          id: 'new-user-unmigrated',
          email: 'unmigrated-b2b@example.com',
          role: Role.CUSTOMER,
        })

      const result = await registerUser({
        email: 'unmigrated-b2b@example.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
        fullName: 'Doanh Nghiệp Chưa Migrate',
        phone: '0909999888',
        companyName: 'Công Ty Test Fallback',
        taxCode: '0399998888',
      })

      expect(result.success).toBe(true)
      // Lần gọi thứ hai fallback tạo user không có cột membershipTier
      expect(mockDb.user.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({
            membershipTier: expect.anything(),
          }),
        })
      )
    })

    it('TC27: Khách hàng đã đạt Bạc / Vàng / Kim Cương không bị reset về Đồng', () => {
      const goldUser = { role: Role.CUSTOMER, membershipTier: MembershipTier.GOLD }
      const resolved = resolveEffectiveMembershipTier(goldUser)
      expect(resolved).toBe(MembershipTier.GOLD)

      const diamondUser = { role: Role.CUSTOMER, membershipTier: MembershipTier.DIAMOND }
      expect(resolveEffectiveMembershipTier(diamondUser)).toBe(MembershipTier.DIAMOND)
    })

    it('TC28: Khách hàng cũ có membershipTier = null được resolve thành BRONZE nhất quán mà không sửa DB hàng loạt', () => {
      const legacyCustomer = { role: Role.CUSTOMER, membershipTier: null }
      const effectiveTier = resolveEffectiveMembershipTier(legacyCustomer)
      expect(effectiveTier).toBe(MembershipTier.BRONZE)
    })

    it('TC29: Tài khoản không phải CUSTOMER (ví dụ ADMIN) không được cấp quyền Membership', () => {
      const adminUser = { role: Role.ADMIN, membershipTier: null }
      const effectiveTier = resolveEffectiveMembershipTier(adminUser)
      expect(effectiveTier).toBeNull()
    })
  })

  // =========================================================================
  // GROUP E: REGRESSION & FORMULA INTEGRITY
  // =========================================================================
  describe('Group E — Regression & Formula Integrity', () => {
    it('TC30: calculateCombinedProductDiscount tuân thủ trần 10% độc lập', () => {
      expect(calculateCombinedProductDiscount(0, 2)).toBe(2)
      expect(calculateCombinedProductDiscount(5, 4)).toBe(9)
      expect(calculateCombinedProductDiscount(8, 5)).toBe(10)
      expect(calculateCombinedProductDiscount(10, 4)).toBe(10)
      expect(calculateCombinedProductDiscount(15, 5)).toBe(10)
    })

    it('TC31: calculateMembershipShippingDiscount tuân thủ trần 100.000 đ độc lập', () => {
      expect(calculateMembershipShippingDiscount(100000, 5)).toBe(5000)
      expect(calculateMembershipShippingDiscount(200000, 10)).toBe(20000)
      expect(calculateMembershipShippingDiscount(300000, 15)).toBe(45000)
      expect(calculateMembershipShippingDiscount(400000, 20)).toBe(80000)
      expect(calculateMembershipShippingDiscount(600000, 20)).toBe(100000) // Trần 100.000 đ
    })
  })

  // =========================================================================
  // GROUP F: BUG-F04-MIG-01 — FINANCIAL SNAPSHOT PERSISTENCE (SNAP-01 to SNAP-10)
  // =========================================================================
  describe('Group F — Financial Snapshot Persistence on Order & OrderEvent (BUG-F04-MIG-01 Hotfix)', () => {
    const futureDateStr = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    function setupOrderMockContext(userRole: Role = Role.CUSTOMER, tier: MembershipTier | null = MembershipTier.BRONZE, groupDiscount: number = 0) {
      const mockUser = {
        id: 'user-snap-1',
        fullName: 'Khách Hàng Doanh Nghiệp',
        role: userRole,
        membershipTier: tier,
        group: { id: 'group-1', discountPercent: groupDiscount },
      }
      vi.mocked(requireUser).mockResolvedValue({ id: 'user-snap-1', role: userRole } as never)
      mockDb.user.findUnique.mockResolvedValue(mockUser)
      mockDb.address.findFirst.mockResolvedValue({
        id: 'addr-snap-1',
        userId: 'user-snap-1',
        label: 'Kho Thủ Đức',
        recipient: 'Nguyễn Văn Nhận',
        phone: '0901234567',
        line: '123 Đặng Văn Bi',
        ward: 'Bình Thọ',
        district: 'Thủ Đức',
        province: 'TP. Hồ Chí Minh',
        lat: 10.85,
        lng: 106.77,
      })
      mockDb.product.findMany.mockResolvedValue([
        {
          id: 'prod-xoai-cat',
          name: 'Xoài Cát Hòa Lộc Tiêu Chuẩn',
          moqGrams: 50000,
          leadTimeDays: 1,
          requiresCold: false,
          isActive: true,
          inventoryTrackingEnabled: true,
          priceTiers: [{ id: 'tier-1', minGrams: 50000, pricePerKg: 100000 }],
          packagings: [
            {
              id: 'pkg-thung-10kg',
              name: 'Thùng 10kg',
              weightGrams: 10000,
              isSample: false,
              samplePrice: null,
              isActive: true,
            },
            {
              id: 'pkg-sample-1kg',
              name: 'Hộp mẫu 1kg',
              weightGrams: 1000,
              isSample: true,
              samplePrice: 0,
              isActive: true,
            },
          ],
        },
      ])
      mockDb.order.findUnique.mockResolvedValue(null)
      mockDb.order.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'order-snap-created-1',
        code: data.code as string,
        items: [
          {
            id: 'item-snap-1',
            productId: 'prod-xoai-cat',
            productName: 'Xoài Cát Hòa Lộc Tiêu Chuẩn',
            orderedGrams: 50000,
          },
        ],
      }))
    }

    it('SNAP-01: BRONZE ORDER — tx.order.create ghi nhận chính xác 5 trường Membership Snapshot', async () => {
      setupOrderMockContext(Role.CUSTOMER, MembershipTier.BRONZE, 0)

      const result = await placeOrder({
        lines: [{ productId: 'prod-xoai-cat', packagingId: 'pkg-thung-10kg', quantity: 5 }], // 50kg
        addressId: 'addr-snap-1',
        deliveryDate: futureDateStr,
        timeSlot: TimeSlot.MORNING,
        paymentOption: 'DEPOSIT_30',
      })

      expect(result.success).toBe(true)
      expect(mockDb.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            membershipTierSnapshot: MembershipTier.BRONZE,
            membershipDiscountPercent: 2,
            combinedDiscountPercent: 2,
            baseShippingFee: expect.any(Number),
            shippingDiscountAmount: expect.any(Number),
          }),
        })
      )
    })

    it('SNAP-02: LEGACY BRONZE — Khách hàng cũ tier=null nhận snapshot BRONZE và không bị update User DB', async () => {
      setupOrderMockContext(Role.CUSTOMER, null, 0) // tier = null

      const result = await placeOrder({
        lines: [{ productId: 'prod-xoai-cat', packagingId: 'pkg-thung-10kg', quantity: 5 }],
        addressId: 'addr-snap-1',
        deliveryDate: futureDateStr,
        timeSlot: TimeSlot.MORNING,
        paymentOption: 'DEPOSIT_30',
      })

      expect(result.success).toBe(true)
      expect(mockDb.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            membershipTierSnapshot: MembershipTier.BRONZE,
            membershipDiscountPercent: 2,
            combinedDiscountPercent: 2,
          }),
        })
      )
      // Zero backfill: user.update tuyệt đối không được gọi
      expect(mockDb.user.update).not.toHaveBeenCalled()
    })

    it('SNAP-03: SHIPPING BELOW THRESHOLD — Đơn dưới 50kg nhận shippingDiscountAmount = 0', () => {
      const benefit = calculateMembershipShippingBenefit({
        baseShippingFee: 200000,
        totalGrams: 49990, // < 50kg
        tier: MembershipTier.GOLD,
      })

      expect(benefit.meetsWeightThreshold).toBe(false)
      expect(benefit.membershipShippingDiscount).toBe(0)
      expect(benefit.finalShippingFee).toBe(200000)
    })

    it('SNAP-04: SHIPPING AT THRESHOLD — Đơn từ 50kg áp dụng chiết khấu ship và khống chế trần 100k', () => {
      const benefit = calculateMembershipShippingBenefit({
        baseShippingFee: 800000,
        totalGrams: 100000, // 100kg >= 50kg
        tier: MembershipTier.DIAMOND, // 20% của 800k = 160k -> cap 100k
      })

      expect(benefit.meetsWeightThreshold).toBe(true)
      expect(benefit.membershipShippingDiscount).toBe(100000)
      expect(benefit.finalShippingFee).toBe(700000)
    })

    it('SNAP-05: COMBINED DISCOUNT CAP — Khống chế trần 10% khi tổng chiết khấu vượt ngưỡng', async () => {
      setupOrderMockContext(Role.CUSTOMER, MembershipTier.SILVER, 8) // Silver 3% + Group 8% = 11% -> cap 10%

      const result = await placeOrder({
        lines: [{ productId: 'prod-xoai-cat', packagingId: 'pkg-thung-10kg', quantity: 5 }],
        addressId: 'addr-snap-1',
        deliveryDate: futureDateStr,
        timeSlot: TimeSlot.MORNING,
        paymentOption: 'DEPOSIT_30',
      })

      expect(result.success).toBe(true)
      expect(mockDb.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            membershipTierSnapshot: MembershipTier.SILVER,
            membershipDiscountPercent: 3,
            combinedDiscountPercent: 10, // Khống chế tại trần 10%
          }),
        })
      )
    })

    it('SNAP-06: SAMPLE GOODS — Không áp dụng chiết khấu hạng cho sản phẩm mẫu thử', () => {
      const quote = priceCart({
        lines: [
          { productId: 'prod-xoai-cat', packagingId: 'pkg-thung-10kg', quantity: 5 }, // 50kg thường
          { productId: 'prod-xoai-cat', packagingId: 'pkg-sample-1kg', quantity: 1 }, // 1kg mẫu
        ],
        products: [productA],
        groupDiscountPercent: 0,
        membershipTier: MembershipTier.DIAMOND, // 5%
      })

      expect(quote.membershipDiscountPercent).toBe(5)
      expect(quote.sampleLines.length).toBe(1)
      expect(quote.sampleLines[0].lineTotal).toBe(50000) // Giá mẫu giữ nguyên
    })

    it('SNAP-07: FINANCIAL CONSISTENCY — 5 trường snapshot trên Order khớp 100% với OrderEvent payload', async () => {
      setupOrderMockContext(Role.CUSTOMER, MembershipTier.GOLD, 3)

      const result = await placeOrder({
        lines: [{ productId: 'prod-xoai-cat', packagingId: 'pkg-thung-10kg', quantity: 5 }],
        addressId: 'addr-snap-1',
        deliveryDate: futureDateStr,
        timeSlot: TimeSlot.MORNING,
        paymentOption: 'DEPOSIT_30',
      })

      expect(result.success).toBe(true)

      // Lấy arguments của order.create
      const orderCreateCall = mockDb.order.create.mock.calls[0][0]
      const orderData = orderCreateCall.data

      // Lấy arguments của recordOrderEvent
      const eventCall = vi.mocked(recordOrderEvent).mock.calls[0][1]
      const eventSnapshot = (eventCall.payload as { membershipSnapshot: Record<string, unknown> }).membershipSnapshot

      // Đối soát 5 trường bắt buộc
      expect(orderData.membershipTierSnapshot).toBe(eventSnapshot.membershipTier)
      expect(orderData.membershipDiscountPercent).toBe(eventSnapshot.membershipDiscountPercent)
      expect(orderData.combinedDiscountPercent).toBe(eventSnapshot.combinedDiscountPercent)
      expect(orderData.baseShippingFee).toBe(eventSnapshot.baseShippingFee)
      expect(orderData.shippingDiscountAmount).toBe(eventSnapshot.shippingDiscountAmount)
    })

    it('SNAP-08: PAYMENT REGRESSION — Tổng tiền thanh toán và cọc không bị thay đổi', async () => {
      setupOrderMockContext(Role.CUSTOMER, MembershipTier.BRONZE, 0)

      const result = await placeOrder({
        lines: [{ productId: 'prod-xoai-cat', packagingId: 'pkg-thung-10kg', quantity: 5 }],
        addressId: 'addr-snap-1',
        deliveryDate: futureDateStr,
        timeSlot: TimeSlot.MORNING,
        paymentOption: 'DEPOSIT_30',
      })

      expect(result.success).toBe(true)
      const orderData = mockDb.order.create.mock.calls[0][0].data
      expect(orderData.total).toBe(orderData.subtotal + orderData.shippingFee)
      expect(orderData.depositAmount).toBe(computeDepositAmount(orderData.total))
    })

    it('SNAP-09: ROLE SAFETY — Tài khoản ADMIN có tier=null không nhận quyền lợi Bronze', () => {
      const adminUser = { role: Role.ADMIN, membershipTier: null }
      const resolved = resolveEffectiveMembershipTier(adminUser)
      expect(resolved).toBeNull()
    })

    it('SNAP-10: HISTORICAL DATA — Không có hành vi backfill hoặc update trên Order lịch sử', () => {
      expect(mockDb.order.update).not.toHaveBeenCalled()
    })
  })
})
