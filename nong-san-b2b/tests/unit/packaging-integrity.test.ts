import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  updateProduct,
  getStorefrontProducts,
  getProductBySlug,
} from '@/server/actions/product'
import { placeOrder } from '@/actions/order'
import { db } from '@/lib/db'
import { requireAdmin, requireUser, getServerAuthSession } from '@/lib/auth'
import { SeasonStatus, PaymentOption, TimeSlot, Role } from '@prisma/client'

vi.mock('@/lib/db', () => ({
  db: {
    product: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    packaging: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    priceTier: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    order: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    orderItem: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    address: {
      findFirst: vi.fn(),
    },
    weeklyCapacity: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(),
  requireUser: vi.fn(),
  getServerAuthSession: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

describe('SRC-DATA-03: Packaging Data Integrity & Stable Sync', () => {
  const adminUser = {
    id: 'admin-1',
    role: Role.ADMIN,
    email: 'admin@b2b.vn',
    name: 'Admin User',
    groupId: null,
    discountPercent: 0,
    companyName: null,
    phone: '0123456789',
  }
  const customerUser = {
    id: 'user-1',
    role: Role.CUSTOMER,
    email: 'buyer@b2b.vn',
    name: 'Buyer User',
    groupId: null,
    discountPercent: 0,
    companyName: 'Nha Hang 1',
    phone: '0987654321',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdmin).mockResolvedValue(adminUser)
    vi.mocked(requireUser).mockResolvedValue(customerUser)
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: customerUser,
      expires: new Date(Date.now() + 86400000).toISOString(),
    })
  })

  const existingProduct = {
    id: 'prod-1',
    name: 'Xoài Cát Hòa Lộc',
    slug: 'xoai-cat-hoa-loc',
    description: 'Xoài chuẩn xuất khẩu chất lượng cao loại 1',
    images: ['https://example.com/xoai.jpg'],
    farmId: 'farm-1',
    moqGrams: 50000,
    leadTimeDays: 1,
    seasonStatus: SeasonStatus.HARVESTING,
    requiresCold: false,
    isActive: true,
    inventoryTrackingEnabled: false,
    preorderOpen: false,
    preorderPricePerKg: null,
    preorderBandPercent: 10,
    expectedHarvestFrom: null,
    expectedHarvestTo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const existingPackagings = [
    {
      id: 'pkg-1',
      productId: 'prod-1',
      name: 'Thùng carton 10kg',
      weightGrams: 10000,
      isSample: false,
      samplePrice: null,
      isActive: true,
    },
    {
      id: 'pkg-2',
      productId: 'prod-1',
      name: 'Rổ nhựa 20kg',
      weightGrams: 20000,
      isSample: false,
      samplePrice: null,
      isActive: true,
    },
    {
      id: 'pkg-sample',
      productId: 'prod-1',
      name: 'Gói mẫu thử 1kg',
      weightGrams: 1000,
      isSample: true,
      samplePrice: 50000,
      isActive: true,
    },
  ]

  const validPriceTiers = [
    { minGrams: 50000, pricePerKg: 80000 },
    { minGrams: 200000, pricePerKg: 75000 },
  ]

  const basePayload = {
    name: 'Xoài Cát Hòa Lộc',
    slug: 'xoai-cat-hoa-loc',
    description: 'Mô tả cập nhật mới chuẩn xuất khẩu',
    images: ['https://example.com/xoai.jpg'],
    farmId: 'farm-1',
    moqGrams: 50000,
    leadTimeDays: 1,
    seasonStatus: SeasonStatus.HARVESTING,
    requiresCold: false,
    isActive: true,
    inventoryTrackingEnabled: false,
    preorderOpen: false,
    preorderPricePerKg: null,
    preorderBandPercent: 10,
    expectedHarvestFrom: null,
    expectedHarvestTo: null,
    priceTiers: validPriceTiers,
  }

  it('1 & 2. Giữ ổn định Packaging ID khi cập nhật sản phẩm có OrderItem tham chiếu (không deleteMany)', async () => {
    vi.mocked(db.product.findUnique).mockResolvedValue(existingProduct)

    const updatedMock = { ...existingProduct, name: 'Xoài Cát Hòa Lộc VIP' }

    const txMock = {
      packaging: {
        findMany: vi.fn().mockResolvedValue(existingPackagings),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn(),
      },
      priceTier: {
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      product: {
        update: vi.fn().mockResolvedValue(updatedMock),
      },
    }

    vi.mocked(db.$transaction).mockImplementation(async (callback) => {
      return await (callback as unknown as (tx: typeof txMock) => unknown)(txMock)
    })

    const payload = {
      ...basePayload,
      name: 'Xoài Cát Hòa Lộc VIP',
      packagings: [
        {
          id: 'pkg-1',
          name: 'Thùng carton 10kg Loại A',
          weightGrams: 10000,
          isSample: false,
        },
        {
          id: 'pkg-2',
          name: 'Rổ nhựa 20kg',
          weightGrams: 20000,
          isSample: false,
        },
      ],
    }

    const res = await updateProduct('prod-1', payload)

    expect(res.success).toBe(true)
    expect(txMock.packaging.deleteMany).not.toHaveBeenCalled()

    expect(txMock.packaging.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pkg-1' },
        data: expect.objectContaining({
          name: 'Thùng carton 10kg Loại A',
          isActive: true,
        }),
      })
    )
  })

  it('3. Soft-deactivate quy cách bị Admin loại khỏi form (isActive = false, không xóa vật lý)', async () => {
    vi.mocked(db.product.findUnique).mockResolvedValue(existingProduct)

    const txMock = {
      packaging: {
        findMany: vi.fn().mockResolvedValue(existingPackagings),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn(),
      },
      priceTier: {
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      product: {
        update: vi.fn().mockResolvedValue(existingProduct),
      },
    }

    vi.mocked(db.$transaction).mockImplementation(async (callback) => {
      return await (callback as unknown as (tx: typeof txMock) => unknown)(txMock)
    })

    const payload = {
      ...basePayload,
      packagings: [
        {
          id: 'pkg-1',
          name: 'Thùng carton 10kg',
          weightGrams: 10000,
          isSample: false,
        },
      ],
    }

    const res = await updateProduct('prod-1', payload)

    expect(res.success).toBe(true)
    expect(txMock.packaging.deleteMany).not.toHaveBeenCalled()

    expect(txMock.packaging.update).toHaveBeenCalledWith({
      where: { id: 'pkg-2' },
      data: { isActive: false },
    })
    expect(txMock.packaging.update).toHaveBeenCalledWith({
      where: { id: 'pkg-sample' },
      data: { isActive: false },
    })
  })

  it('4. Storefront (getStorefrontProducts & getProductBySlug) chỉ truy vấn Packaging isActive = true', async () => {
    vi.mocked(db.product.findMany).mockResolvedValue([existingProduct] as unknown as Awaited<ReturnType<typeof db.product.findMany>>)
    vi.mocked(db.product.findUnique).mockResolvedValue(existingProduct as unknown as Awaited<ReturnType<typeof db.product.findUnique>>)

    await getStorefrontProducts()
    expect(db.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          packagings: expect.objectContaining({
            where: { isActive: true },
          }),
        }),
      })
    )

    await getProductBySlug('xoai-cat-hoa-loc')
    expect(db.product.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          packagings: expect.objectContaining({
            where: { isActive: true },
          }),
        }),
      })
    )
  })

  it('5. Thêm Packaging mới trong lúc cập nhật sản phẩm', async () => {
    vi.mocked(db.product.findUnique).mockResolvedValue(existingProduct)

    const txMock = {
      packaging: {
        findMany: vi.fn().mockResolvedValue(existingPackagings),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({ id: 'pkg-new-3' }),
        deleteMany: vi.fn(),
      },
      priceTier: {
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      product: {
        update: vi.fn().mockResolvedValue(existingProduct),
      },
    }

    vi.mocked(db.$transaction).mockImplementation(async (callback) => {
      return await (callback as unknown as (tx: typeof txMock) => unknown)(txMock)
    })

    const payload = {
      ...basePayload,
      packagings: [
        {
          id: 'pkg-1',
          name: 'Thùng carton 10kg',
          weightGrams: 10000,
          isSample: false,
        },
        {
          name: 'Thùng gỗ xuất khẩu 25kg',
          weightGrams: 25000,
          isSample: false,
        },
      ],
    }

    const res = await updateProduct('prod-1', payload)

    expect(res.success).toBe(true)
    expect(txMock.packaging.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: 'prod-1',
        name: 'Thùng gỗ xuất khẩu 25kg',
        weightGrams: 25000,
        isActive: true,
      }),
    })
  })

  it('6. Từ chối Packaging ID không thuộc sản phẩm đang chỉnh sửa', async () => {
    vi.mocked(db.product.findUnique).mockResolvedValue(existingProduct)

    const txMock = {
      packaging: {
        findMany: vi.fn().mockResolvedValue(existingPackagings),
        update: vi.fn(),
        create: vi.fn(),
        deleteMany: vi.fn(),
      },
      priceTier: { deleteMany: vi.fn() },
      product: { update: vi.fn() },
    }

    vi.mocked(db.$transaction).mockImplementation(async (callback) => {
      return await (callback as unknown as (tx: typeof txMock) => unknown)(txMock)
    })

    const payload = {
      ...basePayload,
      packagings: [
        {
          id: 'foreign-pkg-999',
          name: 'Hộp lạ 5kg',
          weightGrams: 5000,
          isSample: false,
        },
      ],
    }

    const res = await updateProduct('prod-1', payload)

    expect(res.success).toBe(false)
    expect(res.error).toContain('không tồn tại hoặc không thuộc sản phẩm đang chỉnh sửa')
    expect(txMock.product.update).not.toHaveBeenCalled()
  })

  it('7. Từ chối ID trùng lặp bất thường trong payload', async () => {
    vi.mocked(db.product.findUnique).mockResolvedValue(existingProduct)

    const txMock = {
      packaging: {
        findMany: vi.fn().mockResolvedValue(existingPackagings),
        update: vi.fn(),
        create: vi.fn(),
        deleteMany: vi.fn(),
      },
      priceTier: { deleteMany: vi.fn() },
      product: { update: vi.fn() },
    }

    vi.mocked(db.$transaction).mockImplementation(async (callback) => {
      return await (callback as unknown as (tx: typeof txMock) => unknown)(txMock)
    })

    const payload = {
      ...basePayload,
      packagings: [
        {
          id: 'pkg-1',
          name: 'Thùng carton 10kg',
          weightGrams: 10000,
          isSample: false,
        },
        {
          id: 'pkg-1',
          name: 'Thùng carton 10kg nhân bản',
          weightGrams: 10000,
          isSample: false,
        },
      ],
    }

    const res = await updateProduct('prod-1', payload)

    expect(res.success).toBe(false)
    expect(res.error).toContain('ID trùng lặp')
    expect(txMock.product.update).not.toHaveBeenCalled()
  })

  it('8. Checkout server từ chối đặt hàng với Packaging đã bị vô hiệu hóa (isActive = false)', async () => {
    vi.mocked(db.address.findFirst).mockResolvedValue({
      id: 'addr-1',
      userId: 'user-1',
      isDefault: true,
      label: 'Kho A',
      recipient: 'Nguyễn Văn A',
      phone: '0901234567',
      line: '123 Đường B2B',
      ward: 'Phường 1',
      district: 'Quận 1',
      province: 'TP. Hồ Chí Minh',
      lat: 10.7769,
      lng: 106.7009,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const productWithOnlyActivePackaging = {
      id: 'prod-1',
      name: 'Xoài Cát Hòa Lộc',
      moqGrams: 50000,
      requiresCold: false,
      priceTiers: [{ id: 'pt-1', minGrams: 50000, pricePerKg: 80000 }],
      packagings: [
        {
          id: 'pkg-1',
          name: 'Thùng carton 10kg',
          weightGrams: 10000,
          isSample: false,
          samplePrice: null,
          isActive: true,
        },
      ],
    }

    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'user-1',
          role: Role.CUSTOMER,
          group: null,
        }),
      },
      address: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'addr-1',
          userId: 'user-1',
          isDefault: true,
          label: 'Kho A',
          recipient: 'Nguyễn Văn A',
          phone: '0901234567',
          line: '123 Đường B2B',
          ward: 'Phường 1',
          district: 'Quận 1',
          province: 'TP. Hồ Chí Minh',
          lat: 10.7769,
          lng: 106.7009,
        }),
      },
      product: {
        findMany: vi.fn().mockResolvedValue([productWithOnlyActivePackaging]),
      },
      order: {
        create: vi.fn(),
      },
    }

    vi.mocked(db.$transaction).mockImplementation(async (callback) => {
      return await (callback as unknown as (tx: typeof txMock) => unknown)(txMock)
    })

    const result = await placeOrder({
      addressId: 'addr-1',
      deliveryDate: '2026-10-25',
      timeSlot: TimeSlot.MORNING,
      paymentOption: PaymentOption.FULL,
      lines: [
        {
          productId: 'prod-1',
          packagingId: 'pkg-inactive-999',
          quantity: 5,
        },
      ],
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Không tìm thấy quy cách đóng gói')
    expect(txMock.order.create).not.toHaveBeenCalled()
  })

  it('9. PACK-REG-01: Tất cả Packaging đều inactive -> Admin sửa mô tả -> các Packaging vẫn inactive', async () => {
    vi.mocked(db.product.findUnique).mockResolvedValue(existingProduct)

    const allInactivePackagings = [
      {
        id: 'pkg-inact-1',
        productId: 'prod-1',
        name: 'Thùng carton cũ 10kg',
        weightGrams: 10000,
        isSample: false,
        samplePrice: null,
        isActive: false,
      },
      {
        id: 'pkg-inact-2',
        productId: 'prod-1',
        name: 'Rổ nhựa cũ 20kg',
        weightGrams: 20000,
        isSample: false,
        samplePrice: null,
        isActive: false,
      },
    ]

    const txMock = {
      packaging: {
        findMany: vi.fn().mockResolvedValue(allInactivePackagings),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn(),
        deleteMany: vi.fn(),
      },
      priceTier: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      product: { update: vi.fn().mockResolvedValue(existingProduct) },
    }

    vi.mocked(db.$transaction).mockImplementation(async (callback) => {
      return await (callback as unknown as (tx: typeof txMock) => unknown)(txMock)
    })

    // Admin chỉ sửa mô tả, nạp lại packagings nhưng không kích hoạt
    const payload = {
      ...basePayload,
      description: 'Mô tả mới được Admin chỉnh sửa',
      packagings: [
        {
          id: 'pkg-inact-1',
          name: 'Thùng carton cũ 10kg',
          weightGrams: 10000,
          isSample: false,
          isActive: false,
        },
        {
          id: 'pkg-inact-2',
          name: 'Rổ nhựa cũ 20kg',
          weightGrams: 20000,
          isSample: false,
          // Không truyền isActive: không được suy luận bật lại
        },
      ],
    }

    const res = await updateProduct('prod-1', payload)
    expect(res.success).toBe(true)

    // Cả 2 packaging đều PHẢI duy trì isActive: false
    expect(txMock.packaging.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pkg-inact-1' },
        data: expect.objectContaining({
          isActive: false,
        }),
      })
    )
    expect(txMock.packaging.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pkg-inact-2' },
        data: expect.objectContaining({
          isActive: false,
        }),
      })
    )
  })

  it('10. PACK-REG-01: Có cả active và inactive -> chỉnh sửa sản phẩm không làm bật lại Packaging inactive', async () => {
    vi.mocked(db.product.findUnique).mockResolvedValue(existingProduct)

    const mixedPackagings = [
      {
        id: 'pkg-act',
        productId: 'prod-1',
        name: 'Thùng carton đang bán 10kg',
        weightGrams: 10000,
        isSample: false,
        samplePrice: null,
        isActive: true,
      },
      {
        id: 'pkg-inact',
        productId: 'prod-1',
        name: 'Rổ nhựa đã ngừng bán 20kg',
        weightGrams: 20000,
        isSample: false,
        samplePrice: null,
        isActive: false,
      },
    ]

    const txMock = {
      packaging: {
        findMany: vi.fn().mockResolvedValue(mixedPackagings),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn(),
        deleteMany: vi.fn(),
      },
      priceTier: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      product: { update: vi.fn().mockResolvedValue(existingProduct) },
    }

    vi.mocked(db.$transaction).mockImplementation(async (callback) => {
      return await (callback as unknown as (tx: typeof txMock) => unknown)(txMock)
    })

    const payload = {
      ...basePayload,
      description: 'Cập nhật thông tin mùa vụ sản phẩm',
      packagings: [
        {
          id: 'pkg-act',
          name: 'Thùng carton đang bán 10kg',
          weightGrams: 10000,
          isSample: false,
          isActive: true,
        },
        {
          id: 'pkg-inact',
          name: 'Rổ nhựa đã ngừng bán 20kg',
          weightGrams: 20000,
          isSample: false,
          isActive: false,
        },
      ],
    }

    const res = await updateProduct('prod-1', payload)
    expect(res.success).toBe(true)

    // pkg-act giữ nguyên true
    expect(txMock.packaging.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pkg-act' },
        data: expect.objectContaining({
          isActive: true,
        }),
      })
    )

    // pkg-inact KHÔNG bị bật lại true, giữ nguyên false
    expect(txMock.packaging.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pkg-inact' },
        data: expect.objectContaining({
          isActive: false,
        }),
      })
    )
  })

  it('11. PACK-REG-01: Admin chủ động kích hoạt lại Packaging (isActive: true) -> quy cách chuyển active đúng quy tắc', async () => {
    vi.mocked(db.product.findUnique).mockResolvedValue(existingProduct)

    const inactivePackagingInDB = [
      {
        id: 'pkg-was-inactive',
        productId: 'prod-1',
        name: 'Thùng gỗ tái xuất xưởng',
        weightGrams: 15000,
        isSample: false,
        samplePrice: null,
        isActive: false,
      },
    ]

    const txMock = {
      packaging: {
        findMany: vi.fn().mockResolvedValue(inactivePackagingInDB),
        update: vi.fn().mockResolvedValue({}),
        create: vi.fn(),
        deleteMany: vi.fn(),
      },
      priceTier: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      product: { update: vi.fn().mockResolvedValue(existingProduct) },
    }

    vi.mocked(db.$transaction).mockImplementation(async (callback) => {
      return await (callback as unknown as (tx: typeof txMock) => unknown)(txMock)
    })

    // Admin chủ động đánh dấu mở bán lại (isActive: true)
    const payload = {
      ...basePayload,
      packagings: [
        {
          id: 'pkg-was-inactive',
          name: 'Thùng gỗ tái xuất xưởng',
          weightGrams: 15000,
          isSample: false,
          isActive: true, // Hành động kích hoạt lại rõ ràng
        },
      ],
    }

    const res = await updateProduct('prod-1', payload)
    expect(res.success).toBe(true)

    // Packaging được chuyển sang isActive: true theo chỉ định của Admin
    expect(txMock.packaging.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pkg-was-inactive' },
        data: expect.objectContaining({
          isActive: true,
        }),
      })
    )
  })
})
