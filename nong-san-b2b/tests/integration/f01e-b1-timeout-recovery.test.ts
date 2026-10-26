import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import EmbeddedPostgres from 'embedded-postgres'
import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'
import {
  BatchStatus,
  InventoryLedgerType,
  PrismaClient,
  Role,
  SeasonStatus,
} from '@prisma/client'

import {
  F01E_EXPECTED_NEW_BATCH_COUNT,
  F01E_EXPECTED_NEW_STOCK_GRAMS,
  F01E_EXPECTED_TOTAL_CATALOG_PHYSICAL_GRAMS,
  F01E_EXPECTED_TOTAL_CATALOG_SELLABLE_GRAMS,
  PRESERVED_QA_LOCKED_BATCH_CODE,
  prepareF01EDemoBatches,
} from '../../scripts/prepare-f01e-demo-batches'
import {
  getAdminInventoryDashboardData,
  getPublicStockByProductIds,
} from '@/lib/services/inventory-read'

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

const TEST_DB_PORT = 5437
const TEST_DB_NAME = 'evibe_f01e_b1_test'
const TEST_DB_USER = 'test_postgres'
const TEST_DB_PASS = 'test_password123'
const TEST_DB_DIR = path.resolve(process.cwd(), '.test-pg-data-f01e-b1')
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

describe('EV-IMP-01E-B1 — Transaction Timeout Recovery & Query Optimization Regression Suite', () => {
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
      log: [{ emit: 'event', level: 'query' }],
    })
    await prisma.$connect()
    ;(globalThis as unknown as { prisma: PrismaClient }).prisma = prisma

    // Seed baseline matching Neon preview-beta before F01E rollout
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

    await prisma.user.create({
      data: {
        email: 'customer-b1@nongsanb2b.vn',
        passwordHash: 'hashed_pw',
        fullName: 'Khách hàng B1',
        phone: '0900000002',
        role: Role.CUSTOMER,
      },
    })

    // Seed 3 Farms
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

    // Seed 3 F01C products
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

    // Seed 5 untracked target products
    await prisma.product.createMany({
      data: [
        {
          id: 'cmv6htm0k00158pzsv6q7xfpc',
          name: 'Xoài Cát Hòa Lộc Tiền Giang Chuẩn Xuất Khẩu',
          slug: 'xoai-cat-hoa-loc',
          description: 'Xoài Cát',
          images: [],
          farmId: 'cmv6htcxt000d8pzsor2nhhig',
          moqGrams: 30_000,
          leadTimeDays: 1,
          seasonStatus: SeasonStatus.HARVESTING,
          isActive: true,
          inventoryTrackingEnabled: false,
        },
        {
          id: 'cmv6htj60000s8pzs4fk2la63',
          name: 'Sầu Riêng Monthong Dona Tây Nguyên',
          slug: 'sau-rieng-monthong-dona',
          description: 'Monthong',
          images: [],
          farmId: 'cmv6htfz2000i8pzsnvqlpzhq',
          moqGrams: 50_000,
          leadTimeDays: 1,
          seasonStatus: SeasonStatus.HARVESTING,
          isActive: true,
          inventoryTrackingEnabled: false,
        },
        {
          id: 'cmv6htogh001h8pzsmnmkmk2a',
          name: 'Thanh Long Ruột Đỏ Chợ Gạo (Tai Xanh Quả To)',
          slug: 'thanh-long-ruot-do',
          description: 'Thanh long',
          images: [],
          farmId: 'cmv6htcxt000d8pzsor2nhhig',
          moqGrams: 50_000,
          leadTimeDays: 1,
          seasonStatus: SeasonStatus.HARVESTING,
          isActive: true,
          inventoryTrackingEnabled: false,
        },
        {
          id: 'cmv6htpp9001n8pzsy7il33ne',
          name: 'Chôm Chôm Nhãn Đường Phù Sa (Tróc Vỏ Cùi Dày)',
          slug: 'chom-chom-nhan',
          description: 'Chôm chôm',
          images: [],
          farmId: 'cmv6htcxt000d8pzsor2nhhig',
          moqGrams: 30_000,
          leadTimeDays: 1,
          seasonStatus: SeasonStatus.HARVESTING,
          isActive: true,
          inventoryTrackingEnabled: false,
        },
        {
          id: 'cmv6htqyq001t8pzsiruc41oe',
          name: 'Măng Cụt Cổ Thụ Mỏ Cày (Mở Đặt Trước Vụ Mùa)',
          slug: 'mang-cut-ben-tre',
          description: 'Măng cụt',
          images: [],
          farmId: 'cmv6htepv000g8pzscryhm5r5',
          moqGrams: 50_000,
          leadTimeDays: 1,
          seasonStatus: SeasonStatus.UPCOMING,
          preorderOpen: true,
          isActive: true,
          inventoryTrackingEnabled: false,
        },
      ],
    })

    // Seed 3 historical UNVERIFIED batches
    await prisma.batch.createMany({
      data: [
        {
          code: 'LO-261013-001',
          productId: 'cmv6hth16000l8pzs91wi2yof',
          farmId: 'cmv6htcxt000d8pzsor2nhhig',
          harvestDate: new Date('2026-10-10'),
          expiryDate: new Date('2026-10-25'),
          harvestGrams: 5_000_000,
          quantityGrams: 5_000_000,
          status: BatchStatus.UNVERIFIED,
          isFefoEligible: false,
        },
        {
          code: 'LO-261013-002',
          productId: 'cmv6htksu000y8pzsu8jvwgdr',
          farmId: 'cmv6htepv000g8pzscryhm5r5',
          harvestDate: new Date('2026-10-11'),
          expiryDate: new Date('2026-10-26'),
          harvestGrams: 3_000_000,
          quantityGrams: 3_000_000,
          status: BatchStatus.UNVERIFIED,
          isFefoEligible: false,
        },
        {
          code: 'LO-261013-003',
          productId: 'cmv6htn8q001b8pzsdcnag5bi',
          farmId: 'cmv6htfz2000i8pzsnvqlpzhq',
          harvestDate: new Date('2026-10-12'),
          expiryDate: new Date('2026-10-27'),
          harvestGrams: 2_000_000,
          quantityGrams: 2_000_000,
          status: BatchStatus.UNVERIFIED,
          isFefoEligible: false,
        },
      ],
    })

    // Seed 6 F01C batches (total 550kg)
    const f01cBatches = [
      { code: 'LO-FEFO-RI6-01', productId: 'cmv6hth16000l8pzs91wi2yof', farmId: 'cmv6htcxt000d8pzsor2nhhig', expiryDate: new Date('2026-11-01'), grams: 60_000 },
      { code: 'LO-FEFO-RI6-02', productId: 'cmv6hth16000l8pzs91wi2yof', farmId: 'cmv6htcxt000d8pzsor2nhhig', expiryDate: new Date('2026-11-08'), grams: 140_000 },
      { code: 'LO-FEFO-BDX-01', productId: 'cmv6htksu000y8pzsu8jvwgdr', farmId: 'cmv6htepv000g8pzscryhm5r5', expiryDate: new Date('2026-11-03'), grams: 80_000 },
      { code: 'LO-FEFO-BDX-02', productId: 'cmv6htksu000y8pzsu8jvwgdr', farmId: 'cmv6htepv000g8pzscryhm5r5', expiryDate: new Date('2026-11-12'), grams: 120_000 },
      { code: 'LO-FEFO-BO034-01', productId: 'cmv6htn8q001b8pzsdcnag5bi', farmId: 'cmv6htfz2000i8pzsnvqlpzhq', expiryDate: new Date('2026-11-02'), grams: 50_000 },
      { code: 'LO-FEFO-BO034-02', productId: 'cmv6htn8q001b8pzsdcnag5bi', farmId: 'cmv6htfz2000i8pzsnvqlpzhq', expiryDate: new Date('2026-11-10'), grams: 100_000 },
    ]

    for (const b of f01cBatches) {
      const created = await prisma.batch.create({
        data: {
          code: b.code,
          productId: b.productId,
          farmId: b.farmId,
          harvestDate: new Date('2026-10-20'),
          expiryDate: b.expiryDate,
          harvestGrams: b.grams,
          quantityGrams: b.grams,
          status: BatchStatus.ACTIVE,
          isFefoEligible: true,
          verifiedAt: new Date('2026-10-26'),
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

    // Seed 1 QA LOCKED_QC batch (10kg IMPORT - 2kg SHRINKAGE = 8kg physical)
    const qaBatch = await prisma.batch.create({
      data: {
        code: PRESERVED_QA_LOCKED_BATCH_CODE,
        productId: 'cmv6htn8q001b8pzsdcnag5bi',
        farmId: 'cmv6htfz2000i8pzsnvqlpzhq',
        harvestDate: new Date('2026-10-20'),
        expiryDate: new Date('2026-11-15'),
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

  it('Regression A & Performance: Atomic APPLY executes with batched queries, records query count & latency', async () => {
    let transactionQueryCount = 0
    let insideTransaction = false

    // Attach query listener to record queries inside transaction
    // @ts-expect-error Prisma event type
    prisma.$on('query', (e: { query: string }) => {
      if (e.query.includes('BEGIN') || e.query.includes('START TRANSACTION')) {
        insideTransaction = true
      }
      if (insideTransaction) {
        transactionQueryCount++
      }
      if (e.query.includes('COMMIT') || e.query.includes('ROLLBACK')) {
        insideTransaction = false
      }
    })

    const startTime = Date.now()
    const report = await prepareF01EDemoBatches(prisma, {
      mode: 'APPLY',
      referenceDate: new Date('2026-10-26T12:00:00.000Z'),
    })
    const durationMs = Date.now() - startTime

    expect(report.mode).toBe('APPLY')
    expect(report.batches).toHaveLength(F01E_EXPECTED_NEW_BATCH_COUNT)
    expect(report.batches.every((b) => b.action === 'CREATED')).toBe(true)
    expect(report.catalogTotals.trackedProductsBefore).toBe(3)
    expect(report.catalogTotals.trackedProductsAfter).toBe(8)
    expect(report.catalogTotals.newRolloutGrams).toBe(F01E_EXPECTED_NEW_STOCK_GRAMS)
    expect(report.catalogTotals.newRolloutKg).toBe(1300)
    expect(report.catalogTotals.catalogSellableGramsAfter).toBe(F01E_EXPECTED_TOTAL_CATALOG_SELLABLE_GRAMS)
    expect(report.catalogTotals.catalogPhysicalGramsAfter).toBe(F01E_EXPECTED_TOTAL_CATALOG_PHYSICAL_GRAMS)

    console.log(`\n[PERFORMANCE EVIDENCE] Batched APPLY Transaction Duration: ${durationMs}ms`)
    console.log(`[PERFORMANCE EVIDENCE] Queries inside Transaction: ${transactionQueryCount}`)

    // Query count inside transaction must be substantially reduced (down to 43 from 66 previously)
    expect(transactionQueryCount).toBeLessThanOrEqual(45)
  })

  it('Regression B: Mid-flight failure rolls back 100% atomically (zero partial batches, zero tracking flipped)', async () => {
    // Reset test database state for rollback test
    // Delete the 10 demo batches to reset to baseline
    await prisma.inventoryLedger.deleteMany({
      where: { idempotencyKey: { contains: 'F01E' } },
    })
    await prisma.batch.deleteMany({
      where: { code: { startsWith: 'LO-F01E' } },
    })
    await prisma.product.updateMany({
      where: {
        slug: {
          in: [
            'xoai-cat-hoa-loc',
            'sau-rieng-monthong-dona',
            'thanh-long-ruot-do',
            'chom-chom-nhan',
            'mang-cut-ben-tre',
          ],
        },
      },
      data: { inventoryTrackingEnabled: false },
    })

    const batchCountBefore = await prisma.batch.count()
    const ledgerCountBefore = await prisma.inventoryLedger.count()
    const trackedCountBefore = await prisma.product.count({
      where: { inventoryTrackingEnabled: true },
    })
    expect(trackedCountBefore).toBe(3)

    // Simulate error after batch #5
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

  it('Regression C: Idempotent re-run after successful APPLY creates 0 extra batches, 0 extra imports, 0 extra stock', async () => {
    // First apply cleanly
    await prepareF01EDemoBatches(prisma, {
      mode: 'APPLY',
      referenceDate: new Date('2026-10-26T12:00:00.000Z'),
    })

    const batchCountBefore = await prisma.batch.count()
    const ledgerCountBefore = await prisma.inventoryLedger.count()

    // Second apply must be strictly idempotent
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

  it('Regression D: Simulated timeout / connection abort fails closed and read-only reconciliation proves 0 mutations', async () => {
    // We simulate a timeout abort by running a transaction with a tiny timeout (1ms) and doing work
    let errorCaught: unknown
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_sleep(0.05)`
          await tx.product.updateMany({
            where: { slug: 'xoai-cat-hoa-loc' },
            data: { name: 'MUTATION_SHOULD_ROLLBACK' },
          })
        },
        {
          timeout: 10, // 10ms timeout forces abort
          maxWait: 50,
        }
      )
    } catch (err) {
      errorCaught = err
    }

    expect(errorCaught).toBeDefined()

    // Read-only reconciliation verifies the mutation was 100% rolled back
    const p = await prisma.product.findUniqueOrThrow({
      where: { slug: 'xoai-cat-hoa-loc' },
    })
    expect(p.name).not.toBe('MUTATION_SHOULD_ROLLBACK')
  })

  it('Regression E & F: FEFO picking, preserved historical & QA batches, and 8/8 inventory dashboard visibility', async () => {
    // Verify 8/8 products tracked
    const allProducts = await prisma.product.findMany()
    expect(allProducts).toHaveLength(8)
    expect(allProducts.every((p) => p.inventoryTrackingEnabled)).toBe(true)

    // Verify Dashboard metrics
    const dashboard = await getAdminInventoryDashboardData(new Date('2026-10-26T12:00:00.000Z'))
    expect(dashboard.kpis.totalProductsCount).toBe(8)
    expect(dashboard.kpis.trackedProductsCount).toBe(8)
    expect(dashboard.kpis.totalBatchesCount).toBe(20)
    expect(dashboard.kpis.eligibleActiveBatchesCount).toBe(16)
    expect(dashboard.kpis.unverifiedBatchesCount).toBe(3)
    expect(dashboard.kpis.totalPhysicalStockGrams).toBe(1_858_000)
    expect(dashboard.kpis.totalAvailableStockGrams).toBe(1_850_000)
    expect(dashboard.kpis.totalIneligibleStockGrams).toBe(8_000)

    // Verify Public stock
    const publicStockMap = await getPublicStockByProductIds(
      allProducts.map((p) => p.id),
      new Date('2026-10-26T12:00:00.000Z')
    )
    expect(publicStockMap['cmv6htm0k00158pzsv6q7xfpc'].availableKg).toBe(260) // Xoài
    expect(publicStockMap['cmv6htj60000s8pzs4fk2la63'].availableKg).toBe(300) // Monthong
    expect(publicStockMap['cmv6htogh001h8pzsmnmkmk2a'].availableKg).toBe(280) // Thanh long
    expect(publicStockMap['cmv6htpp9001n8pzsy7il33ne'].availableKg).toBe(240) // Chôm chôm
    expect(publicStockMap['cmv6htqyq001t8pzsiruc41oe'].availableKg).toBe(220) // Măng cụt
  })
})
