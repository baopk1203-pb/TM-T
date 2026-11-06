import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import EmbeddedPostgres from 'embedded-postgres'
import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'
import {
  AllocationStatus,
  BatchStatus,
  CancelActor,
  InventoryLedgerType,
  OrderStatus,
  OrderType,
  PaymentOption,
  PrismaClient,
  Role,
  TxMethod,
  TxStatus,
  TxType,
} from '@prisma/client'

import {
  reserveOrderInventoryFefo,
  releaseOrderInventoryAllocations,
  expireOverdueOrderInTx,
} from '@/lib/services/inventory-reservation'
import { confirmPayment } from '@/actions/admin-order'
import {
  calculateStockFromLedger,
  verifyInventoryInvariants,
  computeOrderPaymentDueAt,
} from '@/lib/domain/inventory'
import { requireAdmin, requireUser } from '@/lib/auth'

// Mock authentication and Server Action side effects while DB runs against real PostgreSQL
vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(),
  requireUser: vi.fn(),
  getServerAuthSession: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendOrderNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/db', () => ({
  db: new Proxy({} as object, {
    get(_target, prop: string | symbol) {
      const p = (globalThis as unknown as { prisma: Record<string | symbol, unknown> }).prisma
      if (!p) throw new Error('Real PostgreSQL prisma client not yet initialized')
      const val = p[prop]
      if (typeof val === 'function') {
        return (val as (...args: unknown[]) => unknown).bind(p)
      }
      return val
    },
  }),
}))

const TEST_DB_PORT = 5433
const TEST_DB_NAME = 'evibe_f01c_test'
const TEST_DB_USER = 'test_postgres'
const TEST_DB_PASS = 'test_password123'
const TEST_DB_DIR = path.resolve(process.cwd(), '.test-pg-data-f01c')
const TEST_DB_URL = `postgresql://${TEST_DB_USER}:${TEST_DB_PASS}@localhost:${TEST_DB_PORT}/${TEST_DB_NAME}?schema=public&sslmode=disable`

// Safety fail-closed guard
if (
  TEST_DB_URL.includes('neon.tech') ||
  TEST_DB_URL.includes('ep-square-scene') ||
  TEST_DB_URL.includes('ep-fancy-waterfall')
) {
  throw new Error('FAIL-CLOSED: Integration test must NEVER target Neon or Production!')
}

let pgCluster: InstanceType<typeof EmbeddedPostgres> | null = null
let prisma: PrismaClient

// Global fixture IDs
let farmId: string
let customerUserId: string
let adminUserId: string
let trackedProductId: string
let trackedPackagingId: string

describe('EV-IMP-01C — Real PostgreSQL Integration Tests (PG-01 to PG-20)', () => {
  beforeAll(async () => {
    // 1. Dọn dẹp thư mục cụm nếu tồn tại từ lần chạy trước
    if (fs.existsSync(TEST_DB_DIR)) {
      try {
        fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
      } catch {
        // bỏ qua nếu file bị lock
      }
    }

    // 2. Khởi tạo cụm PostgreSQL 18 cô lập
    pgCluster = new EmbeddedPostgres({
      databaseDir: TEST_DB_DIR,
      port: TEST_DB_PORT,
      user: TEST_DB_USER,
      password: TEST_DB_PASS,
      persistent: false,
      initdbFlags: ['--locale=C'],
    })

    await pgCluster.initialise()
    await pgCluster.start()
    await pgCluster.createDatabase(TEST_DB_NAME)

    // 3. Thiết lập biến môi trường trỏ vào local test database
    process.env.DATABASE_URL = TEST_DB_URL
    process.env.DIRECT_URL = TEST_DB_URL

    // 4. Áp dụng migrations
    execSync('npx prisma migrate deploy', {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: TEST_DB_URL,
        DIRECT_URL: TEST_DB_URL,
      },
      encoding: 'utf-8',
    })

    // 5. Khởi tạo PrismaClient kết nối vào test DB
    prisma = new PrismaClient({
      datasources: { db: { url: TEST_DB_URL } },
    })
    ;(globalThis as unknown as { prisma: PrismaClient }).prisma = prisma

    // 6. Seed fixture cơ bản
    const farm = await prisma.farm.create({
      data: {
        slug: 'farm-pg-test',
        name: 'Nông Trại Test PostgreSQL',
        province: 'Tiền Giang',
        addressText: 'Xã Ngũ Hiệp, Huyện Cai Lậy',
        description: 'Trang trại test tích hợp',
        lat: 10.35,
        lng: 106.05,
      },
    })
    farmId = farm.id

    const customerUser = await prisma.user.create({
      data: {
        email: 'customer-pg@test.com',
        fullName: 'Nguyễn Văn Test',
        phone: '0901234567',
        role: Role.CUSTOMER,
        passwordHash: 'dummyhash',
      },
    })
    customerUserId = customerUser.id

    const adminUser = await prisma.user.create({
      data: {
        email: 'admin-pg@test.com',
        fullName: 'Quản Trị Viên Test',
        phone: '0909999999',
        role: Role.ADMIN,
        passwordHash: 'dummyhash',
      },
    })
    adminUserId = adminUser.id

    // Mock auth trả về adminUser / customerUser
    vi.mocked(requireAdmin).mockResolvedValue({
      id: adminUserId,
      email: 'admin-pg@test.com',
      role: Role.ADMIN,
      name: 'Admin Test',
    } as never)

    vi.mocked(requireUser).mockResolvedValue({
      id: customerUserId,
      email: 'customer-pg@test.com',
      role: Role.CUSTOMER,
      name: 'Customer Test',
    } as never)

    // Sản phẩm BẬT tracking (Sầu riêng Ri6)
    const trackedProd = await prisma.product.create({
      data: {
        slug: 'sau-rieng-ri6-pg',
        name: 'Sầu Riêng Ri6 Test',
        description: 'Sầu riêng test',
        farmId,
        moqGrams: 50_000,
        leadTimeDays: 1,
        seasonStatus: 'HARVESTING',
        inventoryTrackingEnabled: true,
        packagings: {
          create: [{ name: 'Thùng 10kg', weightGrams: 10_000, isActive: true }],
        },
        priceTiers: {
          create: [{ minGrams: 50_000, pricePerKg: 150_000 }],
        },
      },
      include: { packagings: true },
    })
    trackedProductId = trackedProd.id
    trackedPackagingId = trackedProd.packagings[0].id
  }, 60_000)

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect()
    }
    if (pgCluster) {
      await pgCluster.stop()
    }
    if (fs.existsSync(TEST_DB_DIR)) {
      try {
        fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  })

  // Helper tạo sản phẩm riêng biệt cho các kịch bản test để tránh rò rỉ tồn kho chéo
  const createTestProduct = async (slug: string, name: string) => {
    const prod = await prisma.product.create({
      data: {
        slug,
        name,
        description: 'Test product',
        farmId,
        moqGrams: 50_000,
        leadTimeDays: 1,
        seasonStatus: 'HARVESTING',
        inventoryTrackingEnabled: true,
        packagings: {
          create: [{ name: 'Thùng 10kg', weightGrams: 10_000, isActive: true }],
        },
        priceTiers: {
          create: [{ minGrams: 50_000, pricePerKg: 150_000 }],
        },
      },
      include: { packagings: true },
    })
    return {
      productId: prod.id,
      packagingId: prod.packagings[0].id,
      name: prod.name,
    }
  }

  // ==========================================================================
  // GROUP A — FEFO Allocation
  // ==========================================================================

  it('PG-01: Đặt hàng đúng MOQ và đủ tồn kho -> Tạo Allocation HOLD_PENDING và Ledger RESERVATION_HOLD', async () => {
    const now = new Date('2026-10-25T10:00:00.000Z')

    // 1. Tạo lô hàng 100 kg
    const batch = await prisma.batch.create({
      data: {
        code: 'LO-PG01-01',
        productId: trackedProductId,
        farmId,
        harvestDate: new Date('2026-10-23T00:00:00.000Z'),
        expiryDate: new Date('2026-11-05T00:00:00.000Z'),
        quantityGrams: 100_000,
        status: BatchStatus.ACTIVE,
        isFefoEligible: true,
        ledgerEntries: {
          create: {
            type: InventoryLedgerType.IMPORT,
            quantityGrams: 100_000,
            idempotencyKey: 'LEDGER:PG01:IMPORT',
            referenceCode: 'IMPORT:PG01',
          },
        },
      },
    })

    // 2. Tạo đơn hàng 50 kg trong transaction
    const order = await prisma.$transaction(async (tx) => {
      const ord = await tx.order.create({
        data: {
          code: 'ORD-PG01-01',
          userId: customerUserId,
          type: OrderType.STANDARD,
          status: OrderStatus.PENDING_CONFIRMATION,
          paymentOption: PaymentOption.DEPOSIT_30,
          groupDiscountPercent: 0,
          addressSnapshot: { line: '123 Đường Test', province: 'Tiền Giang' },
          subtotal: 7_500_000,
          total: 7_500_000,
          depositAmount: 2_250_000,
          paymentDueAt: computeOrderPaymentDueAt(now),
          items: {
            create: [
              {
                productId: trackedProductId,
                packagingId: trackedPackagingId,
                productName: 'Sầu Riêng Ri6 Test',
                packagingName: 'Thùng 10kg',
                isSample: false,
                quantity: 5,
                orderedGrams: 50_000,
                unitPricePerKg: 150_000,
                lineTotal: 7_500_000,
              },
            ],
          },
        },
        include: { items: true },
      })

      await reserveOrderInventoryFefo(tx, {
        orderId: ord.id,
        orderCode: ord.code,
        userId: customerUserId,
        items: ord.items,
        products: [{ id: trackedProductId, name: 'Sầu Riêng Ri6 Test', inventoryTrackingEnabled: true }],
        holdExpiresAt: ord.paymentDueAt!,
        now,
      })

      return ord
    })

    // 3. Đối chiếu SQL thực tế trên PostgreSQL
    const allocations = await prisma.orderItemBatchAllocation.findMany({
      where: { orderItem: { orderId: order.id } },
    })
    expect(allocations).toHaveLength(1)
    expect(allocations[0].batchId).toBe(batch.id)
    expect(allocations[0].allocatedGrams).toBe(50_000)
    expect(allocations[0].status).toBe(AllocationStatus.HOLD_PENDING)

    const holdLedger = await prisma.inventoryLedger.findFirst({
      where: { batchId: batch.id, type: InventoryLedgerType.RESERVATION_HOLD },
    })
    expect(holdLedger).not.toBeNull()
    expect(holdLedger?.quantityGrams).toBe(50_000)

    // Kiểm tra số dư tồn khả dụng
    const allLedgers = await prisma.inventoryLedger.findMany({ where: { batchId: batch.id } })
    const stock = calculateStockFromLedger(allLedgers.map((l) => ({ type: l.type, quantityGrams: l.quantityGrams })))
    expect(stock.physicalStockGrams).toBe(100_000)
    expect(stock.reservedGrams).toBe(50_000)
    expect(stock.availableGrams).toBe(50_000)
  })

  it('PG-02: Đặt hàng vượt tồn kho -> Ném lỗi và Rollback toàn bộ đơn hàng', async () => {
    const now = new Date('2026-10-25T10:00:00.000Z')
    const prod = await createTestProduct('prod-pg02', 'Sầu Riêng Ri6 PG02')

    // Tạo lô có 30 kg
    await prisma.batch.create({
      data: {
        code: 'LO-PG02-01',
        productId: prod.productId,
        farmId,
        harvestDate: new Date('2026-10-23T00:00:00.000Z'),
        expiryDate: new Date('2026-11-05T00:00:00.000Z'),
        quantityGrams: 30_000,
        status: BatchStatus.ACTIVE,
        isFefoEligible: true,
        ledgerEntries: {
          create: {
            type: InventoryLedgerType.IMPORT,
            quantityGrams: 30_000,
            idempotencyKey: 'LEDGER:PG02:IMPORT',
          },
        },
      },
    })

    // Đặt 50 kg -> Phải thất bại và rollback
    let errorCaught = false
    try {
      await prisma.$transaction(async (tx) => {
        const ord = await tx.order.create({
          data: {
            code: 'ORD-PG02-FAIL',
            userId: customerUserId,
            type: OrderType.STANDARD,
            status: OrderStatus.PENDING_CONFIRMATION,
            paymentOption: PaymentOption.DEPOSIT_30,
            groupDiscountPercent: 0,
            addressSnapshot: { line: '123 Test' },
            subtotal: 7_500_000,
            total: 7_500_000,
            depositAmount: 2_250_000,
            items: {
              create: [
                {
                  productId: prod.productId,
                  packagingId: prod.packagingId,
                  productName: prod.name,
                  packagingName: 'Thùng 10kg',
                  isSample: false,
                  quantity: 5,
                  orderedGrams: 50_000,
                  unitPricePerKg: 150_000,
                  lineTotal: 7_500_000,
                },
              ],
            },
          },
          include: { items: true },
        })

        await reserveOrderInventoryFefo(tx, {
          orderId: ord.id,
          orderCode: ord.code,
          userId: customerUserId,
          items: ord.items,
          products: [{ id: prod.productId, name: prod.name, inventoryTrackingEnabled: true }],
          holdExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
          now,
        })
      })
    } catch (err: unknown) {
      errorCaught = true
      const msg = err instanceof Error ? err.message : String(err)
      expect(msg).toMatch(/không đủ hàng khả dụng/i)
    }

    expect(errorCaught).toBe(true)

    // Xác minh Rollback trên PostgreSQL: Đơn hàng không tồn tại
    const rolledBackOrder = await prisma.order.findUnique({ where: { code: 'ORD-PG02-FAIL' } })
    expect(rolledBackOrder).toBeNull()

    const allocations = await prisma.orderItemBatchAllocation.findMany({
      where: { orderItem: { productName: 'ORD-PG02-FAIL' } },
    })
    expect(allocations).toHaveLength(0)
  })

  it('PG-03: Đặt hàng qua hai lô FEFO -> Phân bổ lô gần hạn trước, lô xa hạn sau', async () => {
    const now = new Date('2026-10-25T10:00:00.000Z')
    const prod = await createTestProduct('prod-pg03', 'Sầu Riêng Ri6 PG03')

    // Lô gần hạn: 40 kg (Hạn: 30/10)
    const bNear = await prisma.batch.create({
      data: {
        code: 'LO-PG03-NEAR',
        productId: prod.productId,
        farmId,
        harvestDate: new Date('2026-10-20T00:00:00.000Z'),
        expiryDate: new Date('2026-10-30T00:00:00.000Z'),
        quantityGrams: 40_000,
        status: BatchStatus.ACTIVE,
        isFefoEligible: true,
        ledgerEntries: {
          create: { type: InventoryLedgerType.IMPORT, quantityGrams: 40_000, idempotencyKey: 'LEDGER:PG03:IMPORT:NEAR' },
        },
      },
    })

    // Lô xa hạn: 60 kg (Hạn: 15/11)
    const bFar = await prisma.batch.create({
      data: {
        code: 'LO-PG03-FAR',
        productId: prod.productId,
        farmId,
        harvestDate: new Date('2026-10-22T00:00:00.000Z'),
        expiryDate: new Date('2026-11-15T00:00:00.000Z'),
        quantityGrams: 60_000,
        status: BatchStatus.ACTIVE,
        isFefoEligible: true,
        ledgerEntries: {
          create: { type: InventoryLedgerType.IMPORT, quantityGrams: 60_000, idempotencyKey: 'LEDGER:PG03:IMPORT:FAR' },
        },
      },
    })

    // Đặt 70 kg
    const order = await prisma.$transaction(async (tx) => {
      const ord = await tx.order.create({
        data: {
          code: 'ORD-PG03-FEFO',
          userId: customerUserId,
          type: OrderType.STANDARD,
          status: OrderStatus.PENDING_CONFIRMATION,
          paymentOption: PaymentOption.DEPOSIT_30,
          groupDiscountPercent: 0,
          addressSnapshot: { line: '123 Test' },
          subtotal: 10_500_000,
          total: 10_500_000,
          depositAmount: 3_150_000,
          items: {
            create: [
              {
                productId: prod.productId,
                packagingId: prod.packagingId,
                productName: prod.name,
                packagingName: 'Thùng 10kg',
                isSample: false,
                quantity: 7,
                orderedGrams: 70_000,
                unitPricePerKg: 150_000,
                lineTotal: 10_500_000,
              },
            ],
          },
        },
        include: { items: true },
      })

      await reserveOrderInventoryFefo(tx, {
        orderId: ord.id,
        orderCode: ord.code,
        userId: customerUserId,
        items: ord.items,
        products: [{ id: prod.productId, name: prod.name, inventoryTrackingEnabled: true }],
        holdExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
        now,
      })

      return ord
    })

    const allocations = await prisma.orderItemBatchAllocation.findMany({
      where: { orderItem: { orderId: order.id } },
      orderBy: { batch: { expiryDate: 'asc' } },
    })

    expect(allocations).toHaveLength(2)
    // Lô gần hạn được phân bổ hết 40 kg
    expect(allocations[0].batchId).toBe(bNear.id)
    expect(allocations[0].allocatedGrams).toBe(40_000)
    // Lô xa hạn phân bổ phần còn lại 30 kg
    expect(allocations[1].batchId).toBe(bFar.id)
    expect(allocations[1].allocatedGrams).toBe(30_000)
  })

  it('PG-04: Bỏ qua lô UNVERIFIED hoặc không đủ điều kiện FEFO', async () => {
    const now = new Date('2026-10-25T10:00:00.000Z')
    const prod = await createTestProduct('prod-pg04', 'Sầu Riêng Ri6 PG04')

    // Lô UNVERIFIED không đủ điều kiện FEFO (100 kg)
    const bUnverified = await prisma.batch.create({
      data: {
        code: 'LO-PG04-UNVERIFIED',
        productId: prod.productId,
        farmId,
        harvestDate: new Date('2026-10-15T00:00:00.000Z'),
        expiryDate: null,
        quantityGrams: 100_000,
        status: BatchStatus.UNVERIFIED,
        isFefoEligible: false,
      },
    })

    // Lô HỢP LỆ (50 kg)
    const bEligible = await prisma.batch.create({
      data: {
        code: 'LO-PG04-ELIGIBLE',
        productId: prod.productId,
        farmId,
        harvestDate: new Date('2026-10-23T00:00:00.000Z'),
        expiryDate: new Date('2026-11-10T00:00:00.000Z'),
        quantityGrams: 50_000,
        status: BatchStatus.ACTIVE,
        isFefoEligible: true,
        ledgerEntries: {
          create: { type: InventoryLedgerType.IMPORT, quantityGrams: 50_000, idempotencyKey: 'LEDGER:PG04:IMPORT' },
        },
      },
    })

    const order = await prisma.$transaction(async (tx) => {
      const ord = await tx.order.create({
        data: {
          code: 'ORD-PG04-CHECK',
          userId: customerUserId,
          type: OrderType.STANDARD,
          status: OrderStatus.PENDING_CONFIRMATION,
          paymentOption: PaymentOption.DEPOSIT_30,
          groupDiscountPercent: 0,
          addressSnapshot: { line: '123' },
          subtotal: 7_500_000,
          total: 7_500_000,
          depositAmount: 2_250_000,
          items: {
            create: [
              {
                productId: prod.productId,
                packagingId: prod.packagingId,
                productName: prod.name,
                packagingName: 'Thùng 10kg',
                isSample: false,
                quantity: 5,
                orderedGrams: 50_000,
                unitPricePerKg: 150_000,
                lineTotal: 7_500_000,
              },
            ],
          },
        },
        include: { items: true },
      })

      await reserveOrderInventoryFefo(tx, {
        orderId: ord.id,
        orderCode: ord.code,
        userId: customerUserId,
        items: ord.items,
        products: [{ id: prod.productId, name: prod.name, inventoryTrackingEnabled: true }],
        holdExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
        now,
      })

      return ord
    })

    const allocations = await prisma.orderItemBatchAllocation.findMany({
      where: { orderItem: { orderId: order.id } },
    })
    expect(allocations).toHaveLength(1)
    expect(allocations[0].batchId).toBe(bEligible.id)
    expect(allocations[0].batchId).not.toBe(bUnverified.id)
  })

  // ==========================================================================
  // GROUP B — Concurrency & Transaction
  // ==========================================================================

  it('PG-05: Hai checkout đồng thời cùng tranh chấp tồn kho giới hạn -> Một thành công, một thất bại (Chống Overselling)', async () => {
    const now = new Date('2026-10-25T10:00:00.000Z')
    const prod = await createTestProduct('prod-pg05', 'Sầu Riêng Ri6 PG05')

    // Tạo lô có đúng 50 kg
    const batch = await prisma.batch.create({
      data: {
        code: 'LO-PG05-CONCURRENT',
        productId: prod.productId,
        farmId,
        harvestDate: new Date('2026-10-23T00:00:00.000Z'),
        expiryDate: new Date('2026-11-20T00:00:00.000Z'),
        quantityGrams: 50_000,
        status: BatchStatus.ACTIVE,
        isFefoEligible: true,
        ledgerEntries: {
          create: { type: InventoryLedgerType.IMPORT, quantityGrams: 50_000, idempotencyKey: 'LEDGER:PG05:IMPORT' },
        },
      },
    })

    // Hai hàm checkout đồng thời mỗi bên đòi 40 kg
    const runCheckout = async (code: string) => {
      return await prisma.$transaction(async (tx) => {
        const ord = await tx.order.create({
          data: {
            code,
            userId: customerUserId,
            type: OrderType.STANDARD,
            status: OrderStatus.PENDING_CONFIRMATION,
            paymentOption: PaymentOption.DEPOSIT_30,
            groupDiscountPercent: 0,
            addressSnapshot: { line: '123' },
            subtotal: 6_000_000,
            total: 6_000_000,
            depositAmount: 1_800_000,
            items: {
              create: [
                {
                  productId: prod.productId,
                  packagingId: prod.packagingId,
                  productName: prod.name,
                  packagingName: 'Thùng 10kg',
                  isSample: false,
                  quantity: 4,
                  orderedGrams: 40_000,
                  unitPricePerKg: 150_000,
                  lineTotal: 6_000_000,
                },
              ],
            },
          },
          include: { items: true },
        })

        await reserveOrderInventoryFefo(tx, {
          orderId: ord.id,
          orderCode: ord.code,
          userId: customerUserId,
          items: ord.items,
          products: [{ id: prod.productId, name: prod.name, inventoryTrackingEnabled: true }],
          holdExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
          now,
        })

        return ord
      })
    }

    // Chạy song song thực tế trên 2 transaction PostgreSQL
    const results = await Promise.allSettled([
      runCheckout('ORD-PG05-CLASH-A'),
      runCheckout('ORD-PG05-CLASH-B'),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    // Bắt buộc đúng 1 transaction thành công, 1 transaction bị chặn do thiếu tồn
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    // Kiểm tra số liệu thực tế trên PostgreSQL
    const allAllocations = await prisma.orderItemBatchAllocation.findMany({
      where: { batchId: batch.id },
    })
    expect(allAllocations).toHaveLength(1)
    expect(allAllocations[0].allocatedGrams).toBe(40_000)

    const ledgers = await prisma.inventoryLedger.findMany({ where: { batchId: batch.id } })
    const stock = calculateStockFromLedger(ledgers.map((l) => ({ type: l.type, quantityGrams: l.quantityGrams })))
    expect(stock.physicalStockGrams).toBe(50_000)
    expect(stock.reservedGrams).toBe(40_000)
    expect(stock.availableGrams).toBe(10_000) // Còn 10kg, không bị âm
  })

  it('PG-06: Lỗi giữa chừng khi ghi Ledger -> Rollback toàn bộ Order và Allocation', async () => {
    let errorOccurred = false
    try {
      await prisma.$transaction(async (tx) => {
        await tx.order.create({
          data: {
            code: 'ORD-PG06-ROLLBACK',
            userId: customerUserId,
            type: OrderType.STANDARD,
            status: OrderStatus.PENDING_CONFIRMATION,
            paymentOption: PaymentOption.FULL,
            groupDiscountPercent: 0,
            addressSnapshot: { line: '123' },
            subtotal: 1_000_000,
            total: 1_000_000,
            depositAmount: 300_000,
            items: {
              create: [
                {
                  productId: trackedProductId,
                  packagingId: trackedPackagingId,
                  productName: 'Sầu Riêng Ri6 Test',
                  packagingName: 'Thùng 10kg',
                  isSample: false,
                  quantity: 1,
                  orderedGrams: 10_000,
                  unitPricePerKg: 100_000,
                  lineTotal: 1_000_000,
                },
              ],
            },
          },
          include: { items: true },
        })

        // Giả lập lỗi ở bước ghi nhận kế tiếp
        throw new Error('SIMULATED_NETWORK_FAILURE_MID_TRANSACTION')
      })
    } catch {
      errorOccurred = true
    }

    expect(errorOccurred).toBe(true)
    const checkOrder = await prisma.order.findUnique({ where: { code: 'ORD-PG06-ROLLBACK' } })
    expect(checkOrder).toBeNull()
  })

  it('PG-07: Khóa bi quan SELECT ... FOR UPDATE trên PostgreSQL hoạt động tuần tự an toàn không Deadlock', async () => {
    const testBatch = await prisma.batch.create({
      data: {
        code: 'LO-PG07-LOCK',
        productId: trackedProductId,
        farmId,
        harvestDate: new Date('2026-10-23T00:00:00.000Z'),
        expiryDate: new Date('2026-11-20T00:00:00.000Z'),
        quantityGrams: 100_000,
        status: BatchStatus.ACTIVE,
        isFefoEligible: true,
      },
    })

    let tx1Locked = false
    let tx2ExecutedAfterTx1 = false

    const p1 = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Batch" WHERE id = ${testBatch.id} FOR UPDATE`
      tx1Locked = true
      await new Promise((r) => setTimeout(r, 200)) // giữ lock 200ms
      return 'TX1_DONE'
    })

    const p2 = prisma.$transaction(async (tx) => {
      await new Promise((r) => setTimeout(r, 50)) // chạy sau Tx1
      await tx.$queryRaw`SELECT id FROM "Batch" WHERE id = ${testBatch.id} FOR UPDATE`
      expect(tx1Locked).toBe(true) // Tx2 chỉ lock được khi Tx1 đã lock và xong
      tx2ExecutedAfterTx1 = true
      return 'TX2_DONE'
    })

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toBe('TX1_DONE')
    expect(r2).toBe('TX2_DONE')
    expect(tx2ExecutedAfterTx1).toBe(true)
  })

  // ==========================================================================
  // GROUP C — Payment Threshold
  // ==========================================================================

  it('PG-08: Thanh toán đúng ngưỡng 30% (DEPOSIT_30) -> Xác nhận thành công và chuyển PROCESSING', async () => {
    const now = new Date()

    // Tạo đơn 1,000,000đ, cọc 300,000đ
    const order = await prisma.order.create({
      data: {
        code: 'ORD-PG08-DEP30',
        userId: customerUserId,
        type: OrderType.STANDARD,
        status: OrderStatus.PENDING_CONFIRMATION,
        paymentOption: PaymentOption.DEPOSIT_30,
        groupDiscountPercent: 0,
        addressSnapshot: { line: '123' },
        subtotal: 1_000_000,
        total: 1_000_000,
        depositAmount: 300_000,
        paymentDueAt: new Date(now.getTime() + 10 * 60 * 1000), // còn hạn
      },
    })

    // Tạo allocation đang ở HOLD_PENDING
    const b = await prisma.batch.create({
      data: {
        code: 'LO-PG08',
        productId: trackedProductId,
        farmId,
        harvestDate: new Date('2026-10-20'),
        expiryDate: new Date('2026-11-20'),
        quantityGrams: 50_000,
        status: BatchStatus.ACTIVE,
        isFefoEligible: true,
      },
    })
    const oi = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: trackedProductId,
        packagingId: trackedPackagingId,
        productName: 'Ri6',
        packagingName: 'Thùng',
        isSample: false,
        quantity: 1,
        orderedGrams: 10_000,
        unitPricePerKg: 100_000,
        lineTotal: 1_000_000,
      },
    })
    await prisma.orderItemBatchAllocation.create({
      data: {
        orderItemId: oi.id,
        batchId: b.id,
        allocatedGrams: 10_000,
        status: AllocationStatus.HOLD_PENDING,
      },
    })

    const res = await confirmPayment({
      orderId: order.id,
      amount: 300_000, // Đúng 30%
      method: TxMethod.BANK_TRANSFER,
      reference: 'REF-PG08-OK',
    })

    expect(res.success).toBe(true)

    // Xác minh trạng thái trên PostgreSQL
    const updated = await prisma.order.findUnique({
      where: { id: order.id },
      include: { transactions: true },
    })
    expect(updated?.status).toBe(OrderStatus.PROCESSING)
    expect(updated?.transactions).toHaveLength(1)
    expect(updated?.transactions[0].amount).toBe(300_000)
    expect(updated?.transactions[0].status).toBe(TxStatus.DONE)

    const updatedAlloc = await prisma.orderItemBatchAllocation.findFirst({
      where: { orderItemId: oi.id },
    })
    expect(updatedAlloc?.status).toBe(AllocationStatus.ALLOCATED_CONFIRMED)
  })

  it('PG-09: Thanh toán dưới ngưỡng 30% -> Từ chối, không tạo giao dịch DONE', async () => {
    const now = new Date()
    const order = await prisma.order.create({
      data: {
        code: 'ORD-PG09-UNDER',
        userId: customerUserId,
        type: OrderType.STANDARD,
        status: OrderStatus.PENDING_CONFIRMATION,
        paymentOption: PaymentOption.DEPOSIT_30,
        groupDiscountPercent: 0,
        addressSnapshot: { line: '123' },
        subtotal: 1_000_000,
        total: 1_000_000,
        depositAmount: 300_000,
        paymentDueAt: new Date(now.getTime() + 10 * 60 * 1000),
      },
    })

    const res = await confirmPayment({
      orderId: order.id,
      amount: 100_000, // Chỉ 10%, dưới ngưỡng 30% (300,000)
      method: TxMethod.BANK_TRANSFER,
      reference: 'REF-PG09-UNDER',
    })

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/chưa đạt ngưỡng tối thiểu/i)

    const checkOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: { transactions: true },
    })
    expect(checkOrder?.status).toBe(OrderStatus.PENDING_CONFIRMATION)
    expect(checkOrder?.transactions).toHaveLength(0)
  })

  it('PG-10: Thanh toán FULL nhưng thiếu tiền -> Từ chối', async () => {
    const now = new Date()
    const order = await prisma.order.create({
      data: {
        code: 'ORD-PG10-FULL-FAIL',
        userId: customerUserId,
        type: OrderType.STANDARD,
        status: OrderStatus.PENDING_CONFIRMATION,
        paymentOption: PaymentOption.FULL,
        groupDiscountPercent: 0,
        addressSnapshot: { line: '123' },
        subtotal: 1_000_000,
        total: 1_000_000,
        depositAmount: 300_000,
        paymentDueAt: new Date(now.getTime() + 10 * 60 * 1000),
      },
    })

    const res = await confirmPayment({
      orderId: order.id,
      amount: 900_000, // Thiếu 100,000đ cho đơn FULL
      method: TxMethod.BANK_TRANSFER,
    })

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/chưa đạt ngưỡng tối thiểu/i)
  })

  it('PG-11: Thanh toán FULL đủ tiền 100% -> Xác nhận thành công', async () => {
    const now = new Date()
    const order = await prisma.order.create({
      data: {
        code: 'ORD-PG11-FULL-OK',
        userId: customerUserId,
        type: OrderType.STANDARD,
        status: OrderStatus.PENDING_CONFIRMATION,
        paymentOption: PaymentOption.FULL,
        groupDiscountPercent: 0,
        addressSnapshot: { line: '123' },
        subtotal: 1_000_000,
        total: 1_000_000,
        depositAmount: 300_000,
        paymentDueAt: new Date(now.getTime() + 10 * 60 * 1000),
      },
    })

    const res = await confirmPayment({
      orderId: order.id,
      amount: 1_000_000,
      method: TxMethod.BANK_TRANSFER,
    })

    expect(res.success).toBe(true)
    const checkOrder = await prisma.order.findUnique({ where: { id: order.id } })
    expect(checkOrder?.status).toBe(OrderStatus.PROCESSING)
  })

  it('PG-12: Xác nhận thanh toán trùng mã tham chiếu -> Chặn trùng lặp (Idempotent)', async () => {
    const now = new Date()
    const order = await prisma.order.create({
      data: {
        code: 'ORD-PG12-IDEM',
        userId: customerUserId,
        type: OrderType.STANDARD,
        status: OrderStatus.PENDING_CONFIRMATION,
        paymentOption: PaymentOption.FULL,
        groupDiscountPercent: 0,
        addressSnapshot: { line: '123' },
        subtotal: 500_000,
        total: 500_000,
        depositAmount: 150_000,
        paymentDueAt: new Date(now.getTime() + 10 * 60 * 1000),
      },
    })

    // Lần 1: Thành công
    const r1 = await confirmPayment({
      orderId: order.id,
      amount: 500_000,
      method: TxMethod.BANK_TRANSFER,
      reference: 'TXN-SAME-REF-12',
    })
    expect(r1.success).toBe(true)

    // Lần 2: Cùng mã tham chiếu
    const r2 = await confirmPayment({
      orderId: order.id,
      amount: 500_000,
      method: TxMethod.BANK_TRANSFER,
      reference: 'TXN-SAME-REF-12',
    })
    expect(r2.success).toBe(false)
    expect(r2.error).toMatch(/đã được xác nhận trước đó/i)
  })

  // ==========================================================================
  // GROUP D — Expiration
  // ==========================================================================

  it('PG-13: Đơn chưa thanh toán quá hạn 10 phút -> Giải phóng giữ chỗ và chuyển CANCELLED', async () => {
    const now = new Date('2026-10-25T10:15:00.000Z')

    // Lô 50 kg
    const batch = await prisma.batch.create({
      data: {
        code: 'LO-PG13-EXP',
        productId: trackedProductId,
        farmId,
        harvestDate: new Date('2026-10-20'),
        expiryDate: new Date('2026-11-20'),
        quantityGrams: 50_000,
        status: BatchStatus.ACTIVE,
        isFefoEligible: true,
        ledgerEntries: {
          create: { type: InventoryLedgerType.IMPORT, quantityGrams: 50_000, idempotencyKey: 'LEDGER:PG13:IMPORT' },
        },
      },
    })

    // Đơn tạo lúc 10:00 (hết hạn lúc 10:10), hiện tại là 10:15
    const order = await prisma.order.create({
      data: {
        code: 'ORD-PG13-EXPIRED',
        userId: customerUserId,
        type: OrderType.STANDARD,
        status: OrderStatus.PENDING_CONFIRMATION,
        paymentOption: PaymentOption.FULL,
        groupDiscountPercent: 0,
        addressSnapshot: { line: '123' },
        subtotal: 1_000_000,
        total: 1_000_000,
        depositAmount: 300_000,
        createdAt: new Date('2026-10-25T10:00:00.000Z'),
        paymentDueAt: new Date('2026-10-25T10:10:00.000Z'),
      },
    })

    const oi = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: trackedProductId,
        packagingId: trackedPackagingId,
        productName: 'Ri6',
        packagingName: 'Thùng',
        isSample: false,
        quantity: 1,
        orderedGrams: 20_000,
        unitPricePerKg: 100_000,
        lineTotal: 1_000_000,
      },
    })

    await prisma.orderItemBatchAllocation.create({
      data: {
        orderItemId: oi.id,
        batchId: batch.id,
        allocatedGrams: 20_000,
        status: AllocationStatus.HOLD_PENDING,
      },
    })

    await prisma.inventoryLedger.create({
      data: {
        batchId: batch.id,
        orderId: order.id,
        orderItemId: oi.id,
        type: InventoryLedgerType.RESERVATION_HOLD,
        quantityGrams: 20_000,
        idempotencyKey: 'LEDGER:HOLD:ORD-PG13',
      },
    })

    // Kích hoạt xử lý quá hạn
    const expResult = await prisma.$transaction(async (tx) => {
      return await expireOverdueOrderInTx(tx, order.id, now)
    })

    expect(expResult.expired).toBe(true)
    expect(expResult.orderCancelled).toBe(true)
    expect(expResult.releasedCount).toBe(1)
    expect(expResult.totalReleasedGrams).toBe(20_000)

    // Xác minh trên PostgreSQL: Đơn thành CANCELLED bởi SYSTEM
    const checkOrder = await prisma.order.findUnique({ where: { id: order.id } })
    expect(checkOrder?.status).toBe(OrderStatus.CANCELLED)
    expect(checkOrder?.cancelledBy).toBe(CancelActor.SYSTEM)

    // Allocation thành RELEASED
    const checkAlloc = await prisma.orderItemBatchAllocation.findFirst({ where: { orderItemId: oi.id } })
    expect(checkAlloc?.status).toBe(AllocationStatus.RELEASED)

    // Có bút toán RESERVATION_RELEASE
    const relLedger = await prisma.inventoryLedger.findFirst({
      where: { batchId: batch.id, type: InventoryLedgerType.RESERVATION_RELEASE },
    })
    expect(relLedger).not.toBeNull()
    expect(relLedger?.quantityGrams).toBe(20_000)

    // Tồn khả dụng hồi phục
    const ledgers = await prisma.inventoryLedger.findMany({ where: { batchId: batch.id } })
    const stock = calculateStockFromLedger(ledgers.map((l) => ({ type: l.type, quantityGrams: l.quantityGrams })))
    expect(stock.reservedGrams).toBe(0)
    expect(stock.availableGrams).toBe(50_000)
  })

  it('PG-14: Giải phóng tồn kho hai lần -> Idempotent, không cộng trả tồn lặp lại', async () => {
    const now = new Date('2026-10-25T10:15:00.000Z')
    const order = await prisma.order.findUnique({ where: { code: 'ORD-PG13-EXPIRED' } })
    expect(order).not.toBeNull()

    // Chạy lại hàm giải phóng trên đơn đã giải phóng ở PG-13
    const secondRelease = await prisma.$transaction(async (tx) => {
      return await releaseOrderInventoryAllocations(tx, {
        orderId: order!.id,
        reason: 'Giải phóng lần 2 kiểm tra lũy thừa',
        now,
      })
    })

    expect(secondRelease.releasedCount).toBe(0)
    expect(secondRelease.totalReleasedGrams).toBe(0)
  })

  it('PG-15: Thanh toán sau thời hạn (10 phút) -> Từ chối và không hồi sinh reservation', async () => {
    const now = new Date()
    const order = await prisma.order.create({
      data: {
        code: 'ORD-PG15-LATE',
        userId: customerUserId,
        type: OrderType.STANDARD,
        status: OrderStatus.PENDING_CONFIRMATION,
        paymentOption: PaymentOption.FULL,
        groupDiscountPercent: 0,
        addressSnapshot: { line: '123' },
        subtotal: 1_000_000,
        total: 1_000_000,
        depositAmount: 300_000,
        createdAt: new Date(now.getTime() - 20 * 60 * 1000), // 20 phút trước
        paymentDueAt: new Date(now.getTime() - 10 * 60 * 1000), // đã hết hạn 10 phút trước
      },
    })

    const res = await confirmPayment({
      orderId: order.id,
      amount: 1_000_000,
      method: TxMethod.BANK_TRANSFER,
    })

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/quá thời hạn giữ chỗ thanh toán/i)

    const checkOrder = await prisma.order.findUnique({ where: { id: order.id } })
    expect(checkOrder?.status).toBe(OrderStatus.CANCELLED)
  })

  it('PG-16: Đơn lịch sử đã có một phần tiền dưới ngưỡng -> Quá hạn giải phóng kho, bảo toàn tiền đã nhận', async () => {
    const now = new Date('2026-10-25T10:15:00.000Z')

    const batch = await prisma.batch.create({
      data: {
        code: 'LO-PG16-PARTIAL',
        productId: trackedProductId,
        farmId,
        harvestDate: new Date('2026-10-20'),
        expiryDate: new Date('2026-11-20'),
        quantityGrams: 50_000,
        status: BatchStatus.ACTIVE,
        isFefoEligible: true,
        ledgerEntries: {
          create: { type: InventoryLedgerType.IMPORT, quantityGrams: 50_000, idempotencyKey: 'LEDGER:PG16:IMPORT' },
        },
      },
    })

    const order = await prisma.order.create({
      data: {
        code: 'ORD-PG16-PARTIAL-PAID',
        userId: customerUserId,
        type: OrderType.STANDARD,
        status: OrderStatus.PENDING_CONFIRMATION,
        paymentOption: PaymentOption.DEPOSIT_30,
        groupDiscountPercent: 0,
        addressSnapshot: { line: '123' },
        subtotal: 1_000_000,
        total: 1_000_000,
        depositAmount: 300_000,
        paymentDueAt: new Date('2026-10-25T10:10:00.000Z'), // Đã quá hạn
        transactions: {
          create: {
            type: TxType.PAYMENT,
            status: TxStatus.DONE,
            method: TxMethod.BANK_TRANSFER,
            amount: 100_000, // Đã nhận 100k (< ngưỡng 300k)
          },
        },
      },
    })

    const oi = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: trackedProductId,
        packagingId: trackedPackagingId,
        productName: 'Ri6',
        packagingName: 'Thùng',
        isSample: false,
        quantity: 1,
        orderedGrams: 15_000,
        unitPricePerKg: 100_000,
        lineTotal: 1_000_000,
      },
    })

    await prisma.orderItemBatchAllocation.create({
      data: {
        orderItemId: oi.id,
        batchId: batch.id,
        allocatedGrams: 15_000,
        status: AllocationStatus.HOLD_PENDING,
      },
    })

    await prisma.inventoryLedger.create({
      data: {
        batchId: batch.id,
        orderId: order.id,
        orderItemId: oi.id,
        type: InventoryLedgerType.RESERVATION_HOLD,
        quantityGrams: 15_000,
        idempotencyKey: 'LEDGER:HOLD:ORD-PG16',
      },
    })

    // Xử lý hết hạn đơn có tiền một phần
    const res = await prisma.$transaction(async (tx) => {
      return await expireOverdueOrderInTx(tx, order.id, now)
    })

    expect(res.expired).toBe(true)
    expect(res.orderCancelled).toBe(false) // Không tự hủy đơn của khách khi đã nhận tiền!
    expect(res.releasedCount).toBe(1)
    expect(res.totalReleasedGrams).toBe(15_000)

    // Xác minh trên PostgreSQL:
    const checkOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: { transactions: true },
    })
    // Trạng thái giữ nguyên để Admin đối soát hoàn tiền
    expect(checkOrder?.status).toBe(OrderStatus.PENDING_CONFIRMATION)
    expect(checkOrder?.transactions).toHaveLength(1)
    expect(checkOrder?.transactions[0].amount).toBe(100_000)

    // Quyền giữ kho đã được giải phóng
    const checkAlloc = await prisma.orderItemBatchAllocation.findFirst({ where: { orderItemId: oi.id } })
    expect(checkAlloc?.status).toBe(AllocationStatus.RELEASED)

    // Tồn khả dụng đã trả lại kho
    const ledgers = await prisma.inventoryLedger.findMany({ where: { batchId: batch.id } })
    const stock = calculateStockFromLedger(ledgers.map((l) => ({ type: l.type, quantityGrams: l.quantityGrams })))
    expect(stock.reservedGrams).toBe(0)
    expect(stock.availableGrams).toBe(50_000)
  })

  // ==========================================================================
  // GROUP E — Inventory Integrity
  // ==========================================================================

  it('PG-17: Tính toán tồn kho Ledger theo hợp đồng toán học chuẩn xác', async () => {
    const entries = [
      { type: 'IMPORT' as const, quantityGrams: 100_000 },
      { type: 'RESERVATION_HOLD' as const, quantityGrams: 40_000 },
      { type: 'RESERVATION_RELEASE' as const, quantityGrams: 10_000 },
      { type: 'DISPATCH_OUT' as const, quantityGrams: 30_000 },
    ]

    const stock = calculateStockFromLedger(entries)
    // Physical = 100 - 30 = 70 kg
    expect(stock.physicalStockGrams).toBe(70_000)
    // Reserved = 40 - 10 - 30 = 0 kg
    expect(stock.reservedGrams).toBe(0)
    // Available = 70 - 0 = 70 kg
    expect(stock.availableGrams).toBe(70_000)

    const inv = verifyInventoryInvariants(stock)
    expect(inv.valid).toBe(true)
    expect(inv.violations).toHaveLength(0)
  })

  it('PG-18: Không cho phép giải phóng vượt quá số lượng hợp lệ', async () => {
    const now = new Date()
    const order = await prisma.order.create({
      data: {
        code: 'ORD-PG18-CLAMP',
        userId: customerUserId,
        type: OrderType.STANDARD,
        status: OrderStatus.PENDING_CONFIRMATION,
        paymentOption: PaymentOption.FULL,
        groupDiscountPercent: 0,
        addressSnapshot: { line: '123' },
        subtotal: 100_000,
        total: 100_000,
        depositAmount: 30_000,
      },
    })
    const oi = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: trackedProductId,
        packagingId: trackedPackagingId,
        productName: 'Ri6',
        packagingName: 'Thùng',
        isSample: false,
        quantity: 1,
        orderedGrams: 10_000,
        unitPricePerKg: 100_000,
        lineTotal: 100_000,
      },
    })

    // Đã phân bổ 10,000g, đã xuất 10,000g -> unreleased = 0g
    await prisma.orderItemBatchAllocation.create({
      data: {
        orderItemId: oi.id,
        batchId: (await prisma.batch.findFirst())!.id,
        allocatedGrams: 10_000,
        dispatchedGrams: 10_000,
        status: AllocationStatus.DISPATCHED,
      },
    })

    const res = await prisma.$transaction(async (tx) => {
      return await releaseOrderInventoryAllocations(tx, {
        orderId: order.id,
        reason: 'Thử giải phóng hàng đã xuất kho',
        now,
      })
    })

    expect(res.releasedCount).toBe(0)
    expect(res.totalReleasedGrams).toBe(0)
  })

  it('PG-19: UNIQUE constraint trên idempotencyKey và batch code hoạt động đúng trên PostgreSQL (Lỗi P2002)', async () => {
    const batch = await prisma.batch.findFirst()!
    expect(batch).not.toBeNull()

    // 1. Kiểm tra unique idempotencyKey trên InventoryLedger
    await prisma.inventoryLedger.create({
      data: {
        batchId: batch!.id,
        type: InventoryLedgerType.IMPORT,
        quantityGrams: 10_000,
        idempotencyKey: 'UNIQUE:KEY:PG19',
      },
    })

    let p2002Caught = false
    try {
      await prisma.inventoryLedger.create({
        data: {
          batchId: batch!.id,
          type: InventoryLedgerType.IMPORT,
          quantityGrams: 10_000,
          idempotencyKey: 'UNIQUE:KEY:PG19', // Trùng lặp
        },
      })
    } catch (err: unknown) {
      p2002Caught = true
      // Mã lỗi Prisma cho Unique Constraint Violation trên PostgreSQL
      expect((err as { code?: string }).code).toBe('P2002')
    }
    expect(p2002Caught).toBe(true)

    // 2. Kiểm tra unique code trên Batch
    let batchUniqueCaught = false
    try {
      await prisma.batch.create({
        data: {
          code: batch!.code, // Trùng mã lô
          productId: trackedProductId,
          farmId,
          harvestDate: new Date(),
          quantityGrams: 10_000,
        },
      })
    } catch (err: unknown) {
      batchUniqueCaught = true
      expect((err as { code?: string }).code).toBe('P2002')
    }
    expect(batchUniqueCaught).toBe(true)
  })

  it('PG-20: Rà soát cơ sở dữ liệu xác nhận không có bản ghi mồ côi hay dữ liệu dở dang sau chuỗi test', async () => {
    // 1. Không có allocation nào trỏ vào OrderItem không tồn tại
    const orphanAllocations = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`
      SELECT a.id FROM "OrderItemBatchAllocation" a
      LEFT JOIN "OrderItem" oi ON a."orderItemId" = oi.id
      WHERE oi.id IS NULL;
    `)
    expect(orphanAllocations).toHaveLength(0)

    // 2. Không có ledger nào có số lượng âm
    const negativeLedgers = await prisma.inventoryLedger.findMany({
      where: { quantityGrams: { lt: 0 } },
    })
    expect(negativeLedgers).toHaveLength(0)

    // 3. Toàn bộ đơn hàng COMPLETED hoặc PROCESSING không có allocation ở trạng thái RELEASED
    const invalidConfirmedOrders = await prisma.order.findMany({
      where: {
        status: { in: [OrderStatus.PROCESSING, OrderStatus.COMPLETED] },
        items: {
          some: {
            allocations: {
              some: {
                status: AllocationStatus.HOLD_PENDING, // Đã xác nhận thì không được còn HOLD_PENDING
              },
            },
          },
        },
      },
    })
    expect(invalidConfirmedOrders).toHaveLength(0)
  })
})
