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
  F01C_PRESERVED_TRACKED_PRODUCTS,
  F01E_EXPECTED_NEW_BATCH_COUNT,
  F01E_EXPECTED_NEW_STOCK_GRAMS,
  F01E_EXPECTED_TOTAL_CATALOG_PHYSICAL_GRAMS,
  F01E_EXPECTED_TOTAL_CATALOG_SELLABLE_GRAMS,
  F01E_TARGET_PRODUCT_ALLOWLIST,
  HISTORICAL_UNVERIFIED_BATCH_CODES,
  KNOWN_PREVIEW_BETA_HOST,
  KNOWN_PRODUCTION_ENDPOINT_HOST,
  PRESERVED_QA_LOCKED_BATCH_CODE,
  prepareF01EDemoBatches,
  verifyF01EEnvironmentSafetyGates,
  verifyF01ESafetyGates,
} from '../../scripts/prepare-f01e-demo-batches'
import {
  getAdminInventoryDashboardData,
  getPublicStockByProductIds,
} from '@/lib/services/inventory-read'
import {
  expireOverdueOrderInTx,
  reserveOrderInventoryFefo,
} from '@/lib/services/inventory-reservation'
import { computeOrderPaymentDueAt } from '@/lib/domain/inventory'

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(),
  requireUser: vi.fn(),
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

const TEST_DB_PORT = 5435
const TEST_DB_NAME = 'evibe_f01e_test'
const TEST_DB_USER = 'test_postgres'
const TEST_DB_PASS = 'test_password123'
const TEST_DB_DIR = path.resolve(process.cwd(), '.test-pg-data-f01e')
const TEST_DB_URL = `postgresql://${TEST_DB_USER}:${TEST_DB_PASS}@localhost:${TEST_DB_PORT}/${TEST_DB_NAME}?schema=public&sslmode=disable`

if (
  TEST_DB_URL.includes('neon.tech') ||
  TEST_DB_URL.includes('ep-square-scene') ||
  TEST_DB_URL.includes('ep-fancy-waterfall')
) {
  throw new Error('FAIL-CLOSED: Integration test must NEVER target Neon or Production!')
}

let pgCluster: InstanceType<typeof EmbeddedPostgres> | null = null
let prisma: PrismaClient
let adminUserId: string
let customerUserId: string

describe('EV-IMP-01E-A — Real PostgreSQL Full Catalog FEFO Rollout (3/8 -> 8/8 Products)', () => {
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
    delete process.env.ENABLE_ADMIN_INVENTORY_WRITES

    execSync('npx prisma db push --skip-generate --accept-data-loss', {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: TEST_DB_URL,
        DIRECT_URL: TEST_DB_URL,
      },
      stdio: 'pipe',
    })

    prisma = new PrismaClient({
      datasources: {
        db: { url: TEST_DB_URL },
      },
    })
    await prisma.$connect()
    ;(globalThis as unknown as { prisma: PrismaClient }).prisma = prisma

    // Seed exact baseline matching Neon preview-beta before F01E rollout
    const admin = await prisma.user.create({
      data: {
        id: 'cmv6ht8mn00038pzsawlfm81d',
        email: 'admin@nongsanb2b.vn',
        passwordHash: 'hashed_pw',
        fullName: 'Quản trị viên Hệ thống',
        phone: '0900000001',
        role: Role.ADMIN,
      },
    })
    adminUserId = admin.id

    const customer = await prisma.user.create({
      data: {
        email: 'customer-f01e@nongsanb2b.vn',
        passwordHash: 'hashed_pw',
        fullName: 'Đối tác B2B Kiểm thử F01E',
        phone: '0900000002',
        role: Role.CUSTOMER,
      },
    })
    customerUserId = customer.id

    // Seed 3 Farms with exact IDs and slugs from Neon preview-beta
    await prisma.farm.createMany({
      data: [
        {
          id: 'cmv6htcxt000d8pzsor2nhhig',
          name: 'HTX Sầu Riêng Ngũ Hiệp Tiền Giang',
          slug: 'htx-sau-rieng-ngu-hiep-tien-giang',
          province: 'Tiền Giang',
          addressText: 'Xã Ngũ Hiệp, Huyện Cai Lậy, Tiền Giang',
          lat: 10.3,
          lng: 106.1,
          description: 'HTX Ngũ Hiệp',
        },
        {
          id: 'cmv6htepv000g8pzscryhm5r5',
          name: 'Vườn Bưởi Da Xanh Mỏ Cày Nam Bến Tre',
          slug: 'vuon-buoi-da-xanh-mo-cay-nam-ben-tre',
          province: 'Bến Tre',
          addressText: 'Huyện Mỏ Cày Nam, Bến Tre',
          lat: 10.1,
          lng: 106.3,
          description: 'Vườn Bưởi Bến Tre',
        },
        {
          id: 'cmv6htfz2000i8pzsnvqlpzhq',
          name: 'Nông Trường Bơ & Sầu Riêng Krông Pắc Đắk Lắk',
          slug: 'nong-truong-bo-sau-rieng-krong-pac-dak-lak',
          province: 'Đắk Lắk',
          addressText: 'Huyện Krông Pắc, Đắk Lắk',
          lat: 12.7,
          lng: 108.3,
          description: 'Nông trường Krông Pắc',
        },
      ],
    })

    // Seed 3 already-tracked products from F01C
    await prisma.product.createMany({
      data: [
        {
          id: 'cmv6hth16000l8pzs91wi2yof',
          name: 'Sầu Riêng Ri6 Cai Lậy (Cơm Vàng Hạt Lép)',
          slug: 'sau-rieng-ri6',
          description: 'Sầu riêng Ri6',
          images: [],
          farmId: 'cmv6htcxt000d8pzsor2nhhig',
          moqGrams: 50_000,
          leadTimeDays: 1,
          seasonStatus: SeasonStatus.HARVESTING,
          isActive: true,
          inventoryTrackingEnabled: true,
        },
        {
          id: 'cmv6htksu000y8pzsu8jvwgdr',
          name: 'Bưởi Da Xanh Ruột Hồng Bến Tre (Loại 1: 1.4kg - 1.8kg)',
          slug: 'buoi-da-xanh-ben-tre',
          description: 'Bưởi da xanh',
          images: [],
          farmId: 'cmv6htepv000g8pzscryhm5r5',
          moqGrams: 40_000,
          leadTimeDays: 1,
          seasonStatus: SeasonStatus.HARVESTING,
          isActive: true,
          inventoryTrackingEnabled: true,
        },
        {
          id: 'cmv6htn8q001b8pzsdcnag5bi',
          name: 'Bơ Sáp 034 Đắk Lắk (Quả Dài Cơm Vàng Dẻo)',
          slug: 'bo-034-tay-nguyen',
          description: 'Bơ 034',
          images: [],
          farmId: 'cmv6htfz2000i8pzsnvqlpzhq',
          moqGrams: 30_000,
          leadTimeDays: 1,
          seasonStatus: SeasonStatus.HARVESTING,
          isActive: true,
          inventoryTrackingEnabled: true,
        },
      ],
    })

    // Seed 5 untracked target products matching Neon preview-beta
    for (const target of F01E_TARGET_PRODUCT_ALLOWLIST) {
      await prisma.product.create({
        data: {
          id: target.expectedProductId!,
          name: target.expectedName,
          slug: target.expectedSlug,
          description: target.expectedName,
          images: [],
          farmId: target.expectedFarmId!,
          moqGrams: target.expectedMoqGrams,
          leadTimeDays: 1,
          seasonStatus:
            target.expectedSlug === 'mang-cut-ben-tre'
              ? SeasonStatus.UPCOMING
              : SeasonStatus.HARVESTING,
          isActive: true,
          inventoryTrackingEnabled: false,
        },
      })
    }

    const now = new Date('2026-10-26T12:00:00.000Z')
    const harvestPast = new Date('2026-10-23T00:00:00.000Z')
    const expiryNear = new Date('2026-11-02T00:00:00.000Z')
    const expiryFar = new Date('2026-11-10T00:00:00.000Z')

    // Seed 3 historical UNVERIFIED batches (Phase 4 QR)
    const histSpecs = [
      {
        code: 'LO-261013-001',
        productId: 'cmv6hth16000l8pzs91wi2yof',
        farmId: 'cmv6htcxt000d8pzsor2nhhig',
      },
      {
        code: 'LO-261013-002',
        productId: 'cmv6htksu000y8pzsu8jvwgdr',
        farmId: 'cmv6htepv000g8pzscryhm5r5',
      },
      {
        code: 'LO-261013-003',
        productId: 'cmv6htn8q001b8pzsdcnag5bi',
        farmId: 'cmv6htfz2000i8pzsnvqlpzhq',
      },
    ]
    for (const h of histSpecs) {
      await prisma.batch.create({
        data: {
          code: h.code,
          productId: h.productId,
          farmId: h.farmId,
          harvestDate: harvestPast,
          expiryDate: null,
          harvestGrams: 500_000,
          quantityGrams: 500_000,
          status: BatchStatus.UNVERIFIED,
          isFefoEligible: false,
        },
      })
    }

    // Seed 6 F01C ACTIVE batches (200kg Ri6, 200kg BDX, 150kg Bo034 = 550kg sellable)
    const f01cBatches = [
      {
        code: 'LO-FEFO-RI6-01',
        productId: 'cmv6hth16000l8pzs91wi2yof',
        farmId: 'cmv6htcxt000d8pzsor2nhhig',
        grams: 60_000,
        expiryDate: expiryNear,
      },
      {
        code: 'LO-FEFO-RI6-02',
        productId: 'cmv6hth16000l8pzs91wi2yof',
        farmId: 'cmv6htcxt000d8pzsor2nhhig',
        grams: 140_000,
        expiryDate: expiryFar,
      },
      {
        code: 'LO-FEFO-BDX-01',
        productId: 'cmv6htksu000y8pzsu8jvwgdr',
        farmId: 'cmv6htepv000g8pzscryhm5r5',
        grams: 80_000,
        expiryDate: expiryNear,
      },
      {
        code: 'LO-FEFO-BDX-02',
        productId: 'cmv6htksu000y8pzsu8jvwgdr',
        farmId: 'cmv6htepv000g8pzscryhm5r5',
        grams: 120_000,
        expiryDate: expiryFar,
      },
      {
        code: 'LO-FEFO-BO034-01',
        productId: 'cmv6htn8q001b8pzsdcnag5bi',
        farmId: 'cmv6htfz2000i8pzsnvqlpzhq',
        grams: 50_000,
        expiryDate: expiryNear,
      },
      {
        code: 'LO-FEFO-BO034-02',
        productId: 'cmv6htn8q001b8pzsdcnag5bi',
        farmId: 'cmv6htfz2000i8pzsnvqlpzhq',
        grams: 100_000,
        expiryDate: expiryFar,
      },
    ]

    for (const b of f01cBatches) {
      const created = await prisma.batch.create({
        data: {
          code: b.code,
          productId: b.productId,
          farmId: b.farmId,
          harvestDate: harvestPast,
          expiryDate: b.expiryDate,
          harvestGrams: b.grams,
          quantityGrams: b.grams,
          status: BatchStatus.ACTIVE,
          isFefoEligible: true,
          verifiedAt: now,
          verifiedById: adminUserId,
        },
      })
      await prisma.inventoryLedger.create({
        data: {
          batchId: created.id,
          type: InventoryLedgerType.IMPORT,
          quantityGrams: b.grams,
          idempotencyKey: `LEDGER:F01C:IMPORT:${b.code}`,
          referenceCode: b.code,
          actorId: adminUserId,
        },
      })
    }

    // Seed 1 QA LOCKED_QC batch from F01D Phase 2 (10kg IMPORT - 2kg SHRINKAGE = 8kg physical)
    const qaBatch = await prisma.batch.create({
      data: {
        code: PRESERVED_QA_LOCKED_BATCH_CODE,
        productId: 'cmv6htn8q001b8pzsdcnag5bi',
        farmId: 'cmv6htfz2000i8pzsnvqlpzhq',
        harvestDate: harvestPast,
        expiryDate: expiryFar,
        harvestGrams: 10_000,
        quantityGrams: 10_000,
        status: BatchStatus.LOCKED_QC,
        isFefoEligible: false,
      },
    })
    await prisma.inventoryLedger.createMany({
      data: [
        {
          batchId: qaBatch.id,
          type: InventoryLedgerType.IMPORT,
          quantityGrams: 10_000,
          idempotencyKey: 'F01D-P2-ACT-IMPORT-BO034-261026',
          referenceCode: PRESERVED_QA_LOCKED_BATCH_CODE,
          actorId: adminUserId,
        },
        {
          batchId: qaBatch.id,
          type: InventoryLedgerType.SHRINKAGE_LOSS,
          quantityGrams: 2_000,
          idempotencyKey: 'F01D-P2-ACT-SHRINK-BO034-261026',
          referenceCode: 'QA-F01D-P2-SHRINK-01',
          actorId: adminUserId,
        },
      ],
    })
  }, 60_000)

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect()
    }
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

  it('Scenario 1: Environment & Allowlist safety gates fail closed on Production/Pooler/Non-beta or unallocated active orders', async () => {
    expect(() =>
      verifyF01EEnvironmentSafetyGates({
        connectionUrl: `postgresql://user:pass@${KNOWN_PREVIEW_BETA_HOST}/neondb`,
        gitBranch: 'main',
        mode: 'DRY_RUN',
      })
    ).toThrow(/Chỉ cho phép chạy trên nhánh Git "beta"/)

    expect(() =>
      verifyF01EEnvironmentSafetyGates({
        connectionUrl: `postgresql://user:pass@${KNOWN_PRODUCTION_ENDPOINT_HOST}.c-7.us-east-2.aws.neon.tech/neondb`,
        gitBranch: 'beta',
        mode: 'DRY_RUN',
      })
    ).toThrow(/Production hoặc Pooler/)

    expect(() =>
      verifyF01EEnvironmentSafetyGates({
        connectionUrl: `postgresql://user:pass@ep-fancy-waterfall-b5f117np-pooler.c-7.us-east-2.aws.neon.tech/neondb`,
        gitBranch: 'beta',
        mode: 'DRY_RUN',
      })
    ).toThrow(/Pooler/)

    expect(() =>
      verifyF01EEnvironmentSafetyGates({
        connectionUrl: `postgresql://user:pass@${KNOWN_PREVIEW_BETA_HOST}/neondb`,
        gitBranch: 'beta',
        mode: 'APPLY',
        confirmPreviewBeta: false,
      })
    ).toThrow(/--confirm-preview-beta/)

    expect(
      verifyF01EEnvironmentSafetyGates({
        connectionUrl: `postgresql://user:pass@${KNOWN_PREVIEW_BETA_HOST}/neondb`,
        gitBranch: 'beta',
        mode: 'APPLY',
        confirmPreviewBeta: true,
        expectedHost: KNOWN_PREVIEW_BETA_HOST,
      }).isSafe
    ).toBe(true)

    // Test fail-closed when an in-flight PENDING_CONFIRMATION order exists without allocations on a target product
    const pkg = await prisma.packaging.create({
      data: {
        productId: 'cmv6htm0k00158pzsv6q7xfpc', // xoai-cat-hoa-loc
        name: 'Thùng 10kg',
        weightGrams: 10_000,
        isSample: false,
        isActive: true,
      },
    })

    const inFlightOrder = await prisma.order.create({
      data: {
        code: 'DH-INFLIGHT-TEST',
        userId: customerUserId,
        type: OrderType.STANDARD,
        status: OrderStatus.PENDING_CONFIRMATION,
        paymentOption: PaymentOption.FULL,
        groupDiscountPercent: 0,
        addressSnapshot: {},
        deliveryDate: new Date('2026-10-28T00:00:00.000Z'),
        timeSlot: TimeSlot.MORNING,
        subtotal: 1_500_000,
        shippingFee: 0,
        total: 1_500_000,
        depositAmount: 450_000,
        items: {
          create: [
            {
              productId: 'cmv6htm0k00158pzsv6q7xfpc',
              packagingId: pkg.id,
              productName: 'Xoài Cát Hòa Lộc Tiền Giang Chuẩn Xuất Khẩu',
              packagingName: 'Thùng 10kg',
              isSample: false,
              quantity: 3,
              orderedGrams: 30_000,
              unitPricePerKg: 50_000,
              lineTotal: 1_500_000,
            },
          ],
        },
      },
    })

    await expect(
      verifyF01ESafetyGates(prisma, F01E_TARGET_PRODUCT_ALLOWLIST, new Date('2026-10-26T12:00:00.000Z'))
    ).rejects.toThrow(/đơn hàng chưa hoàn tất nhưng không có phân bổ FEFO/)

    // Transition order to terminal CANCELLED (matching Neon preview-beta historical state)
    await prisma.order.update({
      where: { id: inFlightOrder.id },
      data: { status: OrderStatus.CANCELLED },
    })
  })

  it('Scenario 2: DRY_RUN validates all 10 batches (+1,300 kg) and 3/8 -> 8/8 transition with ZERO database mutations', async () => {
    const batchCountBefore = await prisma.batch.count()
    const ledgerCountBefore = await prisma.inventoryLedger.count()
    const trackedCountBefore = await prisma.product.count({
      where: { inventoryTrackingEnabled: true },
    })

    const report = await prepareF01EDemoBatches(prisma, {
      mode: 'DRY_RUN',
      referenceDate: new Date('2026-10-26T12:00:00.000Z'),
    })

    expect(report.mode).toBe('DRY_RUN')
    expect(report.batches).toHaveLength(F01E_EXPECTED_NEW_BATCH_COUNT)
    expect(report.batches.every((b) => b.action === 'WOULD_CREATE')).toBe(true)
    expect(report.catalogTotals.trackedProductsBefore).toBe(3)
    expect(report.catalogTotals.trackedProductsAfter).toBe(8)
    expect(report.catalogTotals.newRolloutGrams).toBe(F01E_EXPECTED_NEW_STOCK_GRAMS)
    expect(report.catalogTotals.newRolloutKg).toBe(1300)
    expect(report.catalogTotals.catalogSellableGramsAfter).toBe(
      F01E_EXPECTED_TOTAL_CATALOG_SELLABLE_GRAMS
    )
    expect(report.catalogTotals.catalogPhysicalGramsAfter).toBe(
      F01E_EXPECTED_TOTAL_CATALOG_PHYSICAL_GRAMS
    )

    // Verify 0 writes occurred in DB
    const batchCountAfter = await prisma.batch.count()
    const ledgerCountAfter = await prisma.inventoryLedger.count()
    const trackedCountAfter = await prisma.product.count({
      where: { inventoryTrackingEnabled: true },
    })

    expect(batchCountAfter).toBe(batchCountBefore)
    expect(ledgerCountAfter).toBe(ledgerCountBefore)
    expect(trackedCountAfter).toBe(trackedCountBefore)
    expect(trackedCountAfter).toBe(3)
  })

  it('Scenario 3: Atomic PostgreSQL rollback when an error occurs mid-rollout (zero partial batches, zero tracking flipped)', async () => {
    const batchCountBefore = await prisma.batch.count()
    const ledgerCountBefore = await prisma.inventoryLedger.count()

    await expect(
      prepareF01EDemoBatches(prisma, {
        mode: 'APPLY',
        referenceDate: new Date('2026-10-26T12:00:00.000Z'),
        simulateFailureAfterBatchIndex: 5,
      })
    ).rejects.toThrow(/SIMULATED_ATOMIC_ROLLBACK/)

    const batchCountAfter = await prisma.batch.count()
    const ledgerCountAfter = await prisma.inventoryLedger.count()
    const trackedCountAfter = await prisma.product.count({
      where: { inventoryTrackingEnabled: true },
    })

    expect(batchCountAfter).toBe(batchCountBefore)
    expect(ledgerCountAfter).toBe(ledgerCountBefore)
    expect(trackedCountAfter).toBe(3)
  })

  it('Scenario 4 & 5: Atomic APPLY transitions 3/8 -> 8/8 products, creates 10 ACTIVE batches (+1,300 kg) with distinct expiry dates & FEFO pick order', async () => {
    const report = await prepareF01EDemoBatches(prisma, {
      mode: 'APPLY',
      referenceDate: new Date('2026-10-26T12:00:00.000Z'),
    })

    expect(report.mode).toBe('APPLY')
    expect(report.batches).toHaveLength(10)
    expect(report.batches.every((b) => b.action === 'CREATED')).toBe(true)
    expect(report.catalogTotals.trackedProductsBefore).toBe(3)
    expect(report.catalogTotals.trackedProductsAfter).toBe(8)
    expect(report.catalogTotals.newRolloutGrams).toBe(1_300_000)
    expect(report.catalogTotals.newRolloutKg).toBe(1300)
    expect(report.catalogTotals.catalogSellableGramsAfter).toBe(1_850_000)
    expect(report.catalogTotals.catalogPhysicalGramsAfter).toBe(1_858_000)
    expect(report.catalogTotals.catalogIneligibleGramsAfter).toBe(8_000)

    const expectedBySlug: Record<string, { grams: number; order: [string, string] }> = {
      'xoai-cat-hoa-loc': {
        grams: 260_000,
        order: ['LO-F01E-XOAI-01', 'LO-F01E-XOAI-02'],
      },
      'sau-rieng-monthong-dona': {
        grams: 300_000,
        order: ['LO-F01E-MONTHONG-01', 'LO-F01E-MONTHONG-02'],
      },
      'thanh-long-ruot-do': {
        grams: 280_000,
        order: ['LO-F01E-THANHLONG-01', 'LO-F01E-THANHLONG-02'],
      },
      'chom-chom-nhan': {
        grams: 240_000,
        order: ['LO-F01E-CHOMCHOM-01', 'LO-F01E-CHOMCHOM-02'],
      },
      'mang-cut-ben-tre': {
        grams: 220_000,
        order: ['LO-F01E-MANGCUT-01', 'LO-F01E-MANGCUT-02'],
      },
    }

    for (const summary of report.productSummaries) {
      const exp = expectedBySlug[summary.productSlug]
      expect(exp).toBeDefined()
      expect(summary.previousTrackingEnabled).toBe(false)
      expect(summary.nextTrackingEnabled).toBe(true)
      expect(summary.activeBatchCount).toBe(2)
      expect(summary.totalAvailableGrams).toBe(exp.grams)
      expect(summary.invariantsValid).toBe(true)
      expect(summary.fefoPickOrder).toEqual(exp.order)
    }

    // Verify all 8 products in DB have inventoryTrackingEnabled = true
    const allProducts = await prisma.product.findMany()
    expect(allProducts).toHaveLength(8)
    expect(allProducts.every((p) => p.inventoryTrackingEnabled === true)).toBe(true)
  })

  it('Scenario 6: Idempotent retry (running APPLY a second time creates 0 duplicate batches or ledger entries)', async () => {
    const batchCountBefore = await prisma.batch.count()
    const ledgerCountBefore = await prisma.inventoryLedger.count()

    const retryReport = await prepareF01EDemoBatches(prisma, {
      mode: 'APPLY',
      referenceDate: new Date('2026-10-26T12:00:00.000Z'),
    })

    expect(retryReport.batches).toHaveLength(10)
    expect(retryReport.batches.every((b) => b.action === 'ALREADY_EXISTS_IDEMPOTENT')).toBe(true)
    expect(retryReport.catalogTotals.trackedProductsBefore).toBe(8)
    expect(retryReport.catalogTotals.trackedProductsAfter).toBe(8)
    expect(retryReport.catalogTotals.catalogSellableGramsAfter).toBe(1_850_000)
    expect(retryReport.catalogTotals.catalogPhysicalGramsAfter).toBe(1_858_000)

    const batchCountAfter = await prisma.batch.count()
    const ledgerCountAfter = await prisma.inventoryLedger.count()
    expect(batchCountAfter).toBe(batchCountBefore)
    expect(ledgerCountAfter).toBe(ledgerCountBefore)
  })

  it('Scenario 7: Preserves 3 F01C tracked products, QA LOCKED_QC batch (8 kg), and 3 historical UNVERIFIED batches', async () => {
    // 1. Historical QR batches
    const histBatches = await prisma.batch.findMany({
      where: { code: { in: [...HISTORICAL_UNVERIFIED_BATCH_CODES] } },
      include: { ledgerEntries: true },
    })
    expect(histBatches).toHaveLength(3)
    for (const h of histBatches) {
      expect(h.status).toBe(BatchStatus.UNVERIFIED)
      expect(h.isFefoEligible).toBe(false)
      expect(h.ledgerEntries).toHaveLength(0)
    }

    // 2. QA batch from F01D Phase 2
    const qaBatch = await prisma.batch.findUnique({
      where: { code: PRESERVED_QA_LOCKED_BATCH_CODE },
      include: { ledgerEntries: true },
    })
    expect(qaBatch).not.toBeNull()
    expect(qaBatch!.status).toBe(BatchStatus.LOCKED_QC)
    expect(qaBatch!.isFefoEligible).toBe(false)
    expect(qaBatch!.ledgerEntries).toHaveLength(2)

    // 3. F01C tracked products
    for (const pSpec of F01C_PRESERVED_TRACKED_PRODUCTS) {
      const p = await prisma.product.findUnique({
        where: { id: pSpec.expectedProductId },
      })
      expect(p?.inventoryTrackingEnabled).toBe(true)
    }
  })

  it('Scenario 8: Admin Inventory Overview & Storefront Public Stock Visibility reflect 8/8 tracked products accurately', async () => {
    const dashboard = await getAdminInventoryDashboardData(new Date('2026-10-26T12:00:00.000Z'))

    expect(dashboard.kpis.totalProductsCount).toBe(8)
    expect(dashboard.kpis.trackedProductsCount).toBe(8)
    expect(dashboard.kpis.untrackedProductsCount).toBe(0)
    expect(dashboard.kpis.totalBatchesCount).toBe(20) // 10 baseline + 10 F01E
    expect(dashboard.kpis.eligibleActiveBatchesCount).toBe(16) // 6 F01C + 10 F01E
    expect(dashboard.kpis.unverifiedBatchesCount).toBe(3)
    expect(dashboard.kpis.totalPhysicalStockGrams).toBe(1_858_000)
    expect(dashboard.kpis.totalReservedStockGrams).toBe(0)
    expect(dashboard.kpis.totalAvailableStockGrams).toBe(1_850_000)
    expect(dashboard.kpis.totalIneligibleStockGrams).toBe(8_000)
    expect(dashboard.kpis.batchesWithAnomaliesCount).toBe(0)

    const allProducts = await prisma.product.findMany({ select: { id: true, slug: true } })
    const publicStockMap = await getPublicStockByProductIds(
      allProducts.map((p) => p.id),
      new Date('2026-10-26T12:00:00.000Z')
    )

    const expectedAvailableKgBySlug: Record<string, number> = {
      'sau-rieng-ri6': 200,
      'buoi-da-xanh-ben-tre': 200,
      'bo-034-tay-nguyen': 150,
      'xoai-cat-hoa-loc': 260,
      'sau-rieng-monthong-dona': 300,
      'thanh-long-ruot-do': 280,
      'chom-chom-nhan': 240,
      'mang-cut-ben-tre': 220,
    }

    for (const p of allProducts) {
      const view = publicStockMap[p.id]
      expect(view).toBeDefined()
      expect(view.tracked).toBe(true)
      expect(view.status).toBe('IN_STOCK')
      expect(view.isOrderable).toBe(true)
      expect(view.availableKg).toBe(expectedAvailableKgBySlug[p.slug])
    }
  })

  it('Scenario 9: F01C Checkout Reservation spans 2 FEFO batches on newly tracked product and releases cleanly on 10-min expiration', async () => {
    const now = new Date('2026-10-26T12:00:00.000Z')
    const xoaiProduct = await prisma.product.findUniqueOrThrow({
      where: { slug: 'xoai-cat-hoa-loc' },
      include: { packagings: true },
    })

    const pkg = xoaiProduct.packagings[0]

    // Place an order for 180 kg (180,000 g) of Xoài Cát Hòa Lộc:
    // Should allocate 110,000 g from LO-F01E-XOAI-01 (earliest expiry) + 70,000 g from LO-F01E-XOAI-02
    const dueAt = computeOrderPaymentDueAt(now)
    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          code: 'DH-F01E-FEFO-01',
          userId: customerUserId,
          type: OrderType.STANDARD,
          status: OrderStatus.PENDING_CONFIRMATION,
          paymentOption: PaymentOption.FULL,
          groupDiscountPercent: 0,
          addressSnapshot: {},
          deliveryDate: new Date('2026-10-28T00:00:00.000Z'),
          timeSlot: TimeSlot.MORNING,
          subtotal: 9_000_000,
          shippingFee: 0,
          total: 9_000_000,
          depositAmount: 2_700_000,
          paymentDueAt: dueAt,
          items: {
            create: [
              {
                productId: xoaiProduct.id,
                packagingId: pkg.id,
                productName: xoaiProduct.name,
                packagingName: pkg.name,
                isSample: false,
                quantity: 18,
                orderedGrams: 180_000,
                unitPricePerKg: 50_000,
                lineTotal: 9_000_000,
              },
            ],
          },
        },
        include: { items: true },
      })

      const reserveRes = await reserveOrderInventoryFefo(tx, {
        orderId: created.id,
        orderCode: created.code,
        userId: customerUserId,
        items: created.items,
        products: [xoaiProduct],
        holdExpiresAt: dueAt,
        now,
      })

      expect(reserveRes.reserved).toBe(true)
      expect(reserveRes.allocations).toEqual([
        expect.objectContaining({
          batchCode: 'LO-F01E-XOAI-01',
          allocatedGrams: 110_000,
        }),
        expect.objectContaining({
          batchCode: 'LO-F01E-XOAI-02',
          allocatedGrams: 70_000,
        }),
      ])

      return created
    })

    // Check public stock after 180 kg reservation: 260 kg - 180 kg = 80 kg
    const stockDuringHold = await getPublicStockByProductIds([xoaiProduct.id], now)
    expect(stockDuringHold[xoaiProduct.id].availableGrams).toBe(80_000)
    expect(stockDuringHold[xoaiProduct.id].availableKg).toBe(80)

    // Expire order after 11 minutes
    const after11Minutes = new Date(now.getTime() + 11 * 60 * 1000)
    const expireRes = await prisma.$transaction((tx) =>
      expireOverdueOrderInTx(tx, order.id, after11Minutes)
    )

    expect(expireRes.expired).toBe(true)
    expect(expireRes.orderCancelled).toBe(true)
    expect(expireRes.releasedCount).toBe(2)
    expect(expireRes.totalReleasedGrams).toBe(180_000)

    // Check public stock restored to 260 kg
    const stockAfterRelease = await getPublicStockByProductIds([xoaiProduct.id], after11Minutes)
    expect(stockAfterRelease[xoaiProduct.id].availableGrams).toBe(260_000)
    expect(stockAfterRelease[xoaiProduct.id].availableKg).toBe(260)

    const allocationsAfter = await prisma.orderItemBatchAllocation.findMany({
      where: { orderItem: { orderId: order.id } },
    })
    expect(allocationsAfter.every((a) => a.status === AllocationStatus.RELEASED)).toBe(true)
  })
})
