import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import EmbeddedPostgres from 'embedded-postgres'
import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'
import {
  AllocationStatus,
  BatchStatus,
  InventoryLedgerType,
  OrderStatus,
  OrderType,
  PaymentOption,
  PrismaClient,
  Role,
  SeasonStatus,
  TimeSlot,
} from '@prisma/client'

import {
  prepareF01EDemoBatches,
} from '../../scripts/prepare-f01e-demo-batches'
import {
  reserveOrderInventoryFefo,
} from '@/lib/services/inventory-reservation'
import { placeOrder } from '@/actions/order'
import { computeOrderPaymentDueAt } from '@/lib/domain/inventory'

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(),
  requireAdmin: vi.fn(),
  getServerAuthSession: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
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

const TEST_DB_PORT = 5436
const TEST_DB_NAME = 'evibe_concurrency_test'
const TEST_DB_USER = 'test_postgres'
const TEST_DB_PASS = 'test_password123'
const TEST_DB_DIR = path.resolve(process.cwd(), '.test-pg-data-concurrency')
const TEST_DB_URL = `postgresql://${TEST_DB_USER}:${TEST_DB_PASS}@localhost:${TEST_DB_PORT}/${TEST_DB_NAME}?schema=public&sslmode=disable`

if (
  TEST_DB_URL.includes('neon.tech') ||
  TEST_DB_URL.includes('ep-square-scene') ||
  TEST_DB_URL.includes('ep-fancy-waterfall')
) {
  throw new Error('FAIL-CLOSED: Concurrency integration test must NEVER target Neon or Production!')
}

let pgCluster: InstanceType<typeof EmbeddedPostgres> | null = null
let prismaClient1: PrismaClient
let prismaClient2: PrismaClient

let adminUserId: string
let customerUserId: string
let userAddressId: string

let xoaiProductId: string
let xoaiPackagingId: string

let ri6ProductId: string
let ri6PackagingId: string

describe('EV-IMP-01E-A1 — PostgreSQL Concurrency & Checkout Synchronization (Cases A to D)', () => {
  beforeAll(async () => {
    if (fs.existsSync(TEST_DB_DIR)) {
      try {
        fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }

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

    process.env.DATABASE_URL = TEST_DB_URL
    process.env.DIRECT_URL = TEST_DB_URL

    execSync('npx prisma db push --skip-generate --accept-data-loss', {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: TEST_DB_URL,
        DIRECT_URL: TEST_DB_URL,
      },
      stdio: 'pipe',
    })

    prismaClient1 = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } })
    prismaClient2 = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } })

    await prismaClient1.$connect()
    await prismaClient2.$connect()
    ;(globalThis as unknown as { prisma: PrismaClient }).prisma = prismaClient1

    // Seed Admin & Customer
    const admin = await prismaClient1.user.create({
      data: {
        email: 'admin-concurrency@nongsanb2b.vn',
        passwordHash: 'hashed_pw',
        fullName: 'Admin Concurrency',
        phone: '0901111111',
        role: Role.ADMIN,
      },
    })
    adminUserId = admin.id

    const customer = await prismaClient1.user.create({
      data: {
        email: 'customer-concurrency@nongsanb2b.vn',
        passwordHash: 'hashed_pw',
        fullName: 'Khách hàng Concurrency Test',
        phone: '0902222222',
        role: Role.CUSTOMER,
      },
    })
    customerUserId = customer.id

    const address = await prismaClient1.address.create({
      data: {
        userId: customerUserId,
        label: 'Kho B2B Quận 7',
        recipient: 'Trưởng kho Nguyễn Văn A',
        phone: '0902222222',
        line: 'Số 123 Đường Số 7',
        ward: 'Tân Phú',
        district: 'Quận 7',
        province: 'Hồ Chí Minh',
        lat: 10.73,
        lng: 106.72,
        isDefault: true,
      },
    })
    userAddressId = address.id

    // Seed Farms
    const farmTienGiang = await prismaClient1.farm.create({
      data: {
        id: 'cmv6htcxt000d8pzsor2nhhig',
        name: 'HTX Sầu Riêng Ngũ Hiệp Tiền Giang',
        slug: 'htx-sau-rieng-ngu-hiep-tien-giang',
        province: 'Tiền Giang',
        addressText: 'Xã Ngũ Hiệp, Cai Lậy',
        lat: 10.3,
        lng: 106.1,
        description: 'HTX Tiền Giang',
      },
    })

    const farmBenTre = await prismaClient1.farm.create({
      data: {
        id: 'cmv6htepv000g8pzscryhm5r5',
        name: 'Vườn Bưởi Da Xanh Mỏ Cày Nam Bến Tre',
        slug: 'vuon-buoi-da-xanh-mo-cay-nam-ben-tre',
        province: 'Bến Tre',
        addressText: 'Mỏ Cày Nam',
        lat: 10.1,
        lng: 106.3,
        description: 'Vườn Bưởi Bến Tre',
      },
    })

    const farmDakLak = await prismaClient1.farm.create({
      data: {
        id: 'cmv6htfz2000i8pzsnvqlpzhq',
        name: 'Nông Trường Bơ & Sầu Riêng Krông Pắc Đắk Lắk',
        slug: 'nong-truong-bo-sau-rieng-krong-pac-dak-lak',
        province: 'Đắk Lắk',
        addressText: 'Krông Pắc',
        lat: 12.7,
        lng: 108.3,
        description: 'Nông Trường Krông Pắc',
      },
    })

    // Seed 1 already-tracked product: Sầu Riêng Ri6
    const ri6 = await prismaClient1.product.create({
      data: {
        id: 'cmv6hth16000l8pzs91wi2yof',
        name: 'Sầu Riêng Ri6 Cai Lậy (Cơm Vàng Hạt Lép)',
        slug: 'sau-rieng-ri6',
        description: 'Sầu riêng Ri6',
        images: [],
        farmId: farmTienGiang.id,
        moqGrams: 50_000,
        leadTimeDays: 1,
        seasonStatus: SeasonStatus.HARVESTING,
        isActive: true,
        inventoryTrackingEnabled: true,
        packagings: {
          create: [
            {
              name: 'Thùng 10kg',
              weightGrams: 10_000,
              isSample: false,
              isActive: true,
            },
          ],
        },
        priceTiers: {
          create: [
            { minGrams: 50_000, pricePerKg: 100_000 },
          ],
        },
      },
      include: { packagings: true },
    })
    ri6ProductId = ri6.id
    ri6PackagingId = ri6.packagings[0].id

    // Seed active batch for Ri6 (200 kg)
    const ri6Batch = await prismaClient1.batch.create({
      data: {
        code: 'LO-CONCURRENCY-RI6-01',
        productId: ri6.id,
        farmId: farmTienGiang.id,
        harvestDate: new Date('2026-10-23T00:00:00.000Z'),
        expiryDate: new Date('2026-11-10T00:00:00.000Z'),
        harvestGrams: 200_000,
        quantityGrams: 200_000,
        status: BatchStatus.ACTIVE,
        isFefoEligible: true,
      },
    })
    await prismaClient1.inventoryLedger.create({
      data: {
        batchId: ri6Batch.id,
        type: InventoryLedgerType.IMPORT,
        quantityGrams: 200_000,
        idempotencyKey: 'IMPORT:RI6:CONCURRENCY',
        actorId: adminUserId,
      },
    })

    // Seed untracked product: Xoài Cát Hòa Lộc (F01E Target #1)
    const xoai = await prismaClient1.product.create({
      data: {
        id: 'cmv6htm0k00158pzsv6q7xfpc',
        name: 'Xoài Cát Hòa Lộc Tiền Giang Chuẩn Xuất Khẩu',
        slug: 'xoai-cat-hoa-loc',
        description: 'Xoài Cát',
        images: [],
        farmId: farmTienGiang.id,
        moqGrams: 30_000,
        leadTimeDays: 1,
        seasonStatus: SeasonStatus.HARVESTING,
        isActive: true,
        inventoryTrackingEnabled: false,
        packagings: {
          create: [
            {
              name: 'Thùng 10kg',
              weightGrams: 10_000,
              isSample: false,
              isActive: true,
            },
          ],
        },
        priceTiers: {
          create: [
            { minGrams: 30_000, pricePerKg: 50_000 },
          ],
        },
      },
      include: { packagings: true },
    })
    xoaiProductId = xoai.id
    xoaiPackagingId = xoai.packagings[0].id

    // Seed remaining untracked products to satisfy allowlist
    const otherTargets = [
      {
        id: 'cmv6htj60000s8pzs4fk2la63',
        slug: 'sau-rieng-monthong-dona',
        name: 'Sầu Riêng Monthong Dona Tây Nguyên',
        farmId: farmDakLak.id,
        moqGrams: 50_000,
      },
      {
        id: 'cmv6htogh001h8pzsmnmkmk2a',
        slug: 'thanh-long-ruot-do',
        name: 'Thanh Long Ruột Đỏ Chợ Gạo (Tai Xanh Quả To)',
        farmId: farmTienGiang.id,
        moqGrams: 50_000,
      },
      {
        id: 'cmv6htpp9001n8pzsy7il33ne',
        slug: 'chom-chom-nhan',
        name: 'Chôm Chôm Nhãn Đường Phù Sa (Tróc Vỏ Cùi Dày)',
        farmId: farmTienGiang.id,
        moqGrams: 30_000,
      },
      {
        id: 'cmv6htqyq001t8pzsiruc41oe',
        slug: 'mang-cut-ben-tre',
        name: 'Măng Cụt Cổ Thụ Mỏ Cày (Mở Đặt Trước Vụ Mùa)',
        farmId: farmBenTre.id,
        moqGrams: 50_000,
      },
    ]

    for (const ot of otherTargets) {
      await prismaClient1.product.create({
        data: {
          id: ot.id,
          name: ot.name,
          slug: ot.slug,
          description: ot.name,
          images: [],
          farmId: ot.farmId,
          moqGrams: ot.moqGrams,
          leadTimeDays: 1,
          seasonStatus: SeasonStatus.HARVESTING,
          isActive: true,
          inventoryTrackingEnabled: false,
          packagings: {
            create: [
              { name: 'Thùng 10kg', weightGrams: 10_000, isSample: false, isActive: true },
            ],
          },
          priceTiers: {
            create: [
              { minGrams: ot.moqGrams, pricePerKg: 60_000 },
            ],
          },
        },
      })
    }
  }, 60_000)

  afterAll(async () => {
    if (prismaClient1) await prismaClient1.$disconnect()
    if (prismaClient2) await prismaClient2.$disconnect()
    if (pgCluster) {
      try {
        await pgCluster.stop()
      } catch {
        // ignore
      }
    }
    if (fs.existsSync(TEST_DB_DIR)) {
      try {
        fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  }, 30_000)

  it('Case A — Rollout locks first (FOR UPDATE), Checkout runs concurrently (FOR SHARE) and reads tracking=true after commit', async () => {
    const { requireUser } = await import('@/lib/auth')
    vi.mocked(requireUser).mockResolvedValue({
      id: customerUserId,
      name: 'Khách hàng Concurrency Test',
      email: 'customer-concurrency@nongsanb2b.vn',
      role: Role.CUSTOMER,
      groupId: null,
      discountPercent: 0,
    })

    // Coordination triggers
    let rolloutLockedSignal: () => void = () => {}
    const rolloutLockedPromise = new Promise<void>((resolve) => {
      rolloutLockedSignal = resolve
    })

    let checkoutWaitStartedSignal: () => void = () => {}
    const checkoutWaitStartedPromise = new Promise<void>((resolve) => {
      checkoutWaitStartedSignal = resolve
    })

    let allowRolloutCommitSignal: () => void = () => {}
    const allowRolloutCommitPromise = new Promise<void>((resolve) => {
      allowRolloutCommitSignal = resolve
    })

    // Transaction 1: Rollout
    const t1Promise = prismaClient1.$transaction(async (tx1) => {
      // T1 locks Xoai Product row with FOR UPDATE
      await tx1.$queryRaw`SELECT id FROM "Product" WHERE id = ${xoaiProductId} FOR UPDATE`
      rolloutLockedSignal()

      // Wait until Checkout has started and is blocked waiting for FOR SHARE
      await checkoutWaitStartedPromise

      // Now create batches and set tracking = true
      const batch1 = await tx1.batch.create({
        data: {
          code: 'LO-CASE-A-XOAI-01',
          productId: xoaiProductId,
          farmId: 'cmv6htcxt000d8pzsor2nhhig',
          harvestDate: new Date('2026-10-24T00:00:00.000Z'),
          expiryDate: new Date('2026-11-04T00:00:00.000Z'),
          harvestGrams: 110_000,
          quantityGrams: 110_000,
          status: BatchStatus.ACTIVE,
          isFefoEligible: true,
        },
      })
      await tx1.inventoryLedger.create({
        data: {
          batchId: batch1.id,
          type: InventoryLedgerType.IMPORT,
          quantityGrams: 110_000,
          idempotencyKey: 'IMPORT:CASE-A:XOAI-01',
          actorId: adminUserId,
        },
      })

      const batch2 = await tx1.batch.create({
        data: {
          code: 'LO-CASE-A-XOAI-02',
          productId: xoaiProductId,
          farmId: 'cmv6htcxt000d8pzsor2nhhig',
          harvestDate: new Date('2026-10-25T00:00:00.000Z'),
          expiryDate: new Date('2026-11-12T00:00:00.000Z'),
          harvestGrams: 150_000,
          quantityGrams: 150_000,
          status: BatchStatus.ACTIVE,
          isFefoEligible: true,
        },
      })
      await tx1.inventoryLedger.create({
        data: {
          batchId: batch2.id,
          type: InventoryLedgerType.IMPORT,
          quantityGrams: 150_000,
          idempotencyKey: 'IMPORT:CASE-A:XOAI-02',
          actorId: adminUserId,
        },
      })

      await tx1.product.update({
        where: { id: xoaiProductId },
        data: { inventoryTrackingEnabled: true },
      })

      await allowRolloutCommitPromise
      return { rolledOut: true }
    })

    // Transaction 2: Checkout via placeOrder
    const t2Promise = (async () => {
      // Wait for T1 to acquire the lock
      await rolloutLockedPromise

      // Set global db to client2 so checkout runs on connection 2
      ;(globalThis as unknown as { prisma: PrismaClient }).prisma = prismaClient2

      // Signal that checkout is now starting (which will block at SELECT ... FOR SHARE on xoaiProductId)
      setTimeout(() => {
        checkoutWaitStartedSignal()
        // Wait 100ms then let T1 commit
        setTimeout(() => {
          allowRolloutCommitSignal()
        }, 100)
      }, 50)

      // Place order for 40 kg (4 thùng x 10kg) of Xoài Cát Hòa Lộc
      const orderRes = await placeOrder({
        lines: [
          {
            productId: xoaiProductId,
            packagingId: xoaiPackagingId,
            quantity: 4, // 40,000 g >= 30,000 g MOQ
          },
        ],
        addressId: userAddressId,
        deliveryDate: '2026-10-30',
        timeSlot: TimeSlot.MORNING,
        vehicleType: 'NORMAL' as unknown as import('@prisma/client').VehicleType,
        paymentOption: PaymentOption.FULL,
      })

      return orderRes
    })()

    const [t1Res, t2Res] = await Promise.all([t1Promise, t2Promise])

    expect(t1Res.rolledOut).toBe(true)
    expect(t2Res.success).toBe(true)
    expect(t2Res.orderCode).toBeDefined()

    // Verify order was created WITH FEFO allocation
    const createdOrder = await prismaClient1.order.findUnique({
      where: { code: t2Res.orderCode },
      include: {
        items: {
          include: {
            allocations: true,
          },
        },
      },
    })

    expect(createdOrder).not.toBeNull()
    expect(createdOrder!.items).toHaveLength(1)
    const item = createdOrder!.items[0]
    expect(item.orderedGrams).toBe(40_000)

    // MUST HAVE ALLOCATIONS from LO-CASE-A-XOAI-01 (earliest expiry)
    expect(item.allocations).toHaveLength(1)
    const alloc = item.allocations[0]
    expect(alloc.allocatedGrams).toBe(40_000)
    expect(alloc.status).toBe(AllocationStatus.HOLD_PENDING)

    const holdLedger = await prismaClient1.inventoryLedger.findFirst({
      where: {
        orderId: createdOrder!.id,
        type: InventoryLedgerType.RESERVATION_HOLD,
      },
    })
    expect(holdLedger).not.toBeNull()
    expect(holdLedger!.quantityGrams).toBe(40_000)

    // Reset Xoai product tracking back to false and cancel order for Case B
    await prismaClient1.order.update({
      where: { id: createdOrder!.id },
      data: { status: OrderStatus.CANCELLED },
    })
    await prismaClient1.product.update({
      where: { id: xoaiProductId },
      data: { inventoryTrackingEnabled: false },
    })
  })

  it('Case B — Checkout locks first (FOR SHARE) on untracked product, Rollout waits (FOR UPDATE) and aborts on committed unallocated order', async () => {
    // Ensure product is untracked
    await prismaClient1.product.update({
      where: { id: xoaiProductId },
      data: { inventoryTrackingEnabled: false },
    })

    let checkoutLockedSignal: () => void = () => {}
    const checkoutLockedPromise = new Promise<void>((resolve) => {
      checkoutLockedSignal = resolve
    })

    let rolloutWaitStartedSignal: () => void = () => {}
    const rolloutWaitStartedPromise = new Promise<void>((resolve) => {
      rolloutWaitStartedSignal = resolve
    })

    let allowCheckoutCommitSignal: () => void = () => {}
    const allowCheckoutCommitPromise = new Promise<void>((resolve) => {
      allowCheckoutCommitSignal = resolve
    })

    // T1: Checkout transaction holding FOR SHARE on untracked product
    const t1Checkout = prismaClient1.$transaction(async (tx1) => {
      await tx1.$queryRaw`SELECT id, "inventoryTrackingEnabled" FROM "Product" WHERE id = ${xoaiProductId} FOR SHARE`
      checkoutLockedSignal()

      // Wait until Rollout has attempted FOR UPDATE and is waiting
      await rolloutWaitStartedPromise

      // Create an unallocated order (because product was untracked)
      const order = await tx1.order.create({
        data: {
          code: 'DH-CASE-B-UNTRACKED',
          userId: customerUserId,
          type: OrderType.STANDARD,
          status: OrderStatus.PENDING_CONFIRMATION,
          paymentOption: PaymentOption.FULL,
          groupDiscountPercent: 0,
          addressSnapshot: {},
          deliveryDate: new Date('2026-10-29T00:00:00.000Z'),
          timeSlot: TimeSlot.MORNING,
          subtotal: 2_000_000,
          shippingFee: 0,
          total: 2_000_000,
          depositAmount: 600_000,
          items: {
            create: [
              {
                productId: xoaiProductId,
                packagingId: xoaiPackagingId,
                productName: 'Xoài Cát Hòa Lộc',
                packagingName: 'Thùng 10kg',
                isSample: false,
                quantity: 4,
                orderedGrams: 40_000,
                unitPricePerKg: 50_000,
                lineTotal: 2_000_000,
              },
            ],
          },
        },
      })

      await allowCheckoutCommitPromise
      return order
    })

    // T2: Rollout transaction attempting to lock target products with FOR UPDATE
    const t2Rollout = (async () => {
      await checkoutLockedPromise

      setTimeout(() => {
        rolloutWaitStartedSignal()
        setTimeout(() => {
          allowCheckoutCommitSignal()
        }, 100)
      }, 50)

      // prepareF01EDemoBatches on client 2
      return await prepareF01EDemoBatches(prismaClient2, {
        mode: 'APPLY',
        referenceDate: new Date('2026-10-26T12:00:00.000Z'),
        enforceCatalogBaselineTotals: false,
      })
    })()

    // T1 commits successfully
    const createdCheckoutOrder = await t1Checkout
    expect(createdCheckoutOrder.code).toBe('DH-CASE-B-UNTRACKED')

    // T2 MUST ABORT because it detects the pending order DH-CASE-B-UNTRACKED without allocations
    await expect(t2Rollout).rejects.toThrow(/đơn hàng chưa hoàn tất nhưng không có phân bổ FEFO/)

    // Clean up order
    await prismaClient1.order.update({
      where: { id: createdCheckoutOrder.id },
      data: { status: OrderStatus.CANCELLED },
    })
  })

  it('Case C — Mixed Cart: 1 already-tracked product + 1 newly-tracked product both reserved accurately without double hold', async () => {
    // Set both products to tracked
    await prismaClient1.product.update({
      where: { id: xoaiProductId },
      data: { inventoryTrackingEnabled: true },
    })
    await prismaClient1.product.update({
      where: { id: ri6ProductId },
      data: { inventoryTrackingEnabled: true },
    })

    // Check existing batches
    const now = new Date('2026-10-26T12:00:00.000Z')
    const dueAt = computeOrderPaymentDueAt(now)

    const mixedOrder = await prismaClient1.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          code: 'DH-CASE-C-MIXED',
          userId: customerUserId,
          type: OrderType.STANDARD,
          status: OrderStatus.PENDING_CONFIRMATION,
          paymentOption: PaymentOption.FULL,
          groupDiscountPercent: 0,
          addressSnapshot: {},
          deliveryDate: new Date('2026-10-29T00:00:00.000Z'),
          timeSlot: TimeSlot.MORNING,
          subtotal: 7_000_000,
          shippingFee: 0,
          total: 7_000_000,
          depositAmount: 2_100_000,
          paymentDueAt: dueAt,
          items: {
            create: [
              {
                productId: ri6ProductId,
                packagingId: ri6PackagingId,
                productName: 'Sầu Riêng Ri6',
                packagingName: 'Thùng 10kg',
                isSample: false,
                quantity: 5, // 50,000 g
                orderedGrams: 50_000,
                unitPricePerKg: 100_000,
                lineTotal: 5_000_000,
              },
              {
                productId: xoaiProductId,
                packagingId: xoaiPackagingId,
                productName: 'Xoài Cát Hòa Lộc',
                packagingName: 'Thùng 10kg',
                isSample: false,
                quantity: 4, // 40,000 g
                orderedGrams: 40_000,
                unitPricePerKg: 50_000,
                lineTotal: 2_000_000,
              },
            ],
          },
        },
        include: { items: true },
      })

      const reserveRes = await reserveOrderInventoryFefo(tx, {
        orderId: order.id,
        orderCode: order.code,
        userId: customerUserId,
        items: order.items,
        products: [
          { id: ri6ProductId, name: 'Sầu Riêng Ri6', inventoryTrackingEnabled: true },
          { id: xoaiProductId, name: 'Xoài Cát Hòa Lộc', inventoryTrackingEnabled: true },
        ],
        holdExpiresAt: dueAt,
        now,
      })

      expect(reserveRes.reserved).toBe(true)
      expect(reserveRes.allocations).toHaveLength(2)

      return order
    })

    const allocations = await prismaClient1.orderItemBatchAllocation.findMany({
      where: { orderItem: { orderId: mixedOrder.id } },
      include: { batch: true },
    })

    expect(allocations).toHaveLength(2)
    const ri6Alloc = allocations.find((a) => a.batch.productId === ri6ProductId)
    const xoaiAlloc = allocations.find((a) => a.batch.productId === xoaiProductId)

    expect(ri6Alloc).toBeDefined()
    expect(ri6Alloc!.allocatedGrams).toBe(50_000)

    expect(xoaiAlloc).toBeDefined()
    expect(xoaiAlloc!.allocatedGrams).toBe(40_000)

    const holdLedgers = await prismaClient1.inventoryLedger.findMany({
      where: { orderId: mixedOrder.id, type: InventoryLedgerType.RESERVATION_HOLD },
    })
    expect(holdLedgers).toHaveLength(2)
  })

  it('Case D — Rollback on mid-flight failure leaves zero orphan allocations, zero ledger entries, and zero deadlocks', async () => {
    const allocationsBefore = await prismaClient1.orderItemBatchAllocation.count()
    const ledgerBefore = await prismaClient1.inventoryLedger.count()
    const ordersBefore = await prismaClient1.order.count()

    const now = new Date('2026-10-26T12:00:00.000Z')
    const dueAt = computeOrderPaymentDueAt(now)

    await expect(
      prismaClient1.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            code: 'DH-CASE-D-FAIL',
            userId: customerUserId,
            type: OrderType.STANDARD,
            status: OrderStatus.PENDING_CONFIRMATION,
            paymentOption: PaymentOption.FULL,
            groupDiscountPercent: 0,
            addressSnapshot: {},
            deliveryDate: new Date('2026-10-29T00:00:00.000Z'),
            timeSlot: TimeSlot.MORNING,
            subtotal: 5_000_000,
            shippingFee: 0,
            total: 5_000_000,
            depositAmount: 1_500_000,
            items: {
              create: [
                {
                  productId: ri6ProductId,
                  packagingId: ri6PackagingId,
                  productName: 'Sầu Riêng Ri6',
                  packagingName: 'Thùng 10kg',
                  isSample: false,
                  quantity: 5,
                  orderedGrams: 50_000,
                  unitPricePerKg: 100_000,
                  lineTotal: 5_000_000,
                },
              ],
            },
          },
          include: { items: true },
        })

        await reserveOrderInventoryFefo(tx, {
          orderId: order.id,
          orderCode: order.code,
          userId: customerUserId,
          items: order.items,
          products: [{ id: ri6ProductId, name: 'Sầu Riêng Ri6', inventoryTrackingEnabled: true }],
          holdExpiresAt: dueAt,
          now,
        })

        // Force intentional transaction abort
        throw new Error('SIMULATED_CHECKOUT_FAILURE_AFTER_ALLOCATION')
      })
    ).rejects.toThrow('SIMULATED_CHECKOUT_FAILURE_AFTER_ALLOCATION')

    // Verify complete rollback
    const allocationsAfter = await prismaClient1.orderItemBatchAllocation.count()
    const ledgerAfter = await prismaClient1.inventoryLedger.count()
    const ordersAfter = await prismaClient1.order.count()

    expect(allocationsAfter).toBe(allocationsBefore)
    expect(ledgerAfter).toBe(ledgerBefore)
    expect(ordersAfter).toBe(ordersBefore)
  })
})
