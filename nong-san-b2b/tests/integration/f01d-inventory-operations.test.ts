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
} from '@prisma/client'

import {
  receiveStockInTx,
  adjustStockInTx,
  updateBatchStatusInTx,
  getBatchStatusAuditTrail,
} from '@/lib/services/inventory-write'
import {
  adminReceiveStock,
  adminAdjustStock,
  adminUpdateBatchStatus,
} from '@/server/actions/inventory-operations'
import {
  reserveOrderInventoryFefo,
  expireOverdueOrderInTx,
} from '@/lib/services/inventory-reservation'
import {
  getAdminBatchesInventoryView,
  getPublicStockByProductIds,
} from '@/lib/services/inventory-read'
import { requireAdmin, requireUser } from '@/lib/auth'

// Mock authentication and Next.js revalidation while DB runs against real isolated PostgreSQL
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

const TEST_DB_PORT = 5434
const TEST_DB_NAME = 'evibe_f01d_test'
const TEST_DB_USER = 'test_postgres'
const TEST_DB_PASS = 'test_password123'
const TEST_DB_DIR = path.resolve(process.cwd(), '.test-pg-data-f01d')
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

let farmId: string
let customerUserId: string
let adminUserId: string
let trackedProductId: string
let trackedPackagingId: string

describe('EV-IMP-01D-P2 — Real PostgreSQL Controlled Inventory Operations (Groups A to F)', () => {
  beforeAll(async () => {
    // 1. Dọn dẹp thư mục cụm nếu tồn tại từ lần chạy trước
    if (fs.existsSync(TEST_DB_DIR)) {
      try {
        fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
      } catch {
        // bỏ qua
      }
    }

    // 2. Khởi tạo cụm PostgreSQL cô lập
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
    process.env.ENABLE_ADMIN_INVENTORY_WRITES = 'true'

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

    // 5. Khởi tạo PrismaClient
    prisma = new PrismaClient({
      datasources: { db: { url: TEST_DB_URL } },
    })
    ;(globalThis as unknown as { prisma: PrismaClient }).prisma = prisma

    // 6. Fixtures
    const farm = await prisma.farm.create({
      data: {
        slug: 'farm-pg-f01d',
        name: 'Nông Trại F01D Cai Lậy',
        province: 'Tiền Giang',
        addressText: 'Xã Ngũ Hiệp, Cai Lậy',
        description: 'Trang trại test F01D',
        lat: 10.35,
        lng: 106.05,
      },
    })
    farmId = farm.id

    const customerUser = await prisma.user.create({
      data: {
        email: 'customer-f01d@test.com',
        fullName: 'Nguyễn Văn Mua',
        phone: '0901234567',
        role: Role.CUSTOMER,
        passwordHash: 'dummyhash',
      },
    })
    customerUserId = customerUser.id

    const adminUser = await prisma.user.create({
      data: {
        email: 'admin-f01d@test.com',
        fullName: 'Quản Trị Viên Kho',
        phone: '0909999999',
        role: Role.ADMIN,
        passwordHash: 'dummyhash',
      },
    })
    adminUserId = adminUser.id

    vi.mocked(requireAdmin).mockResolvedValue({
      id: adminUserId,
      email: 'admin-f01d@test.com',
      role: Role.ADMIN,
      name: 'Quản Trị Viên Kho',
    } as never)

    vi.mocked(requireUser).mockResolvedValue({
      id: customerUserId,
      email: 'customer-f01d@test.com',
      role: Role.CUSTOMER,
      name: 'Nguyễn Văn Mua',
    } as never)

    const product = await prisma.product.create({
      data: {
        slug: 'sau-rieng-ri6-f01d',
        name: 'Sầu Riêng Ri6 F01D',
        description: 'Sầu riêng test F01D',
        farmId,
        inventoryTrackingEnabled: true,
        moqGrams: 20000, // 20 kg
        isActive: true,
        leadTimeDays: 1,
        seasonStatus: 'HARVESTING',
        packagings: {
          create: [{ name: 'Thùng 10kg', weightGrams: 10_000, isActive: true }],
        },
        priceTiers: {
          create: [{ minGrams: 20_000, pricePerKg: 100_000 }],
        },
      },
      include: { packagings: true },
    })
    trackedProductId = product.id
    trackedPackagingId = product.packagings[0].id
  }, 90000)

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
        // bỏ qua
      }
    }
  }, 30000)

  // ==========================================================================
  // GROUP A — STOCK RECEIPT / NHẬP KHO
  // ==========================================================================
  describe('Group A — Stock Receipt', () => {
    it('A1. Nhập kho hợp lệ: tạo Batch và IMPORT Ledger atomic trên PostgreSQL', async () => {
      const code = 'LO-F01D-REC-01'
      const harvestDate = new Date('2026-10-25')
      const expiryDate = new Date('2026-11-15')
      const quantityKg = 250 // 250,000 g

      const result = await prisma.$transaction(async (tx) => {
        return await receiveStockInTx(tx, {
          productId: trackedProductId,
          farmId,
          code,
          harvestDate,
          expiryDate,
          quantityKg,
          status: BatchStatus.ACTIVE,
          isFefoEligible: true,
          qcNotes: 'Đạt chuẩn xuất khẩu VietGAP loại 1',
          actorId: adminUserId,
        })
      })

      expect(result.batch.code).toBe(code)
      expect(result.batch.quantityGrams).toBe(250000)
      expect(result.batch.status).toBe(BatchStatus.ACTIVE)
      expect(result.batch.isFefoEligible).toBe(true)

      expect(result.ledgerEntry.type).toBe(InventoryLedgerType.IMPORT)
      expect(result.ledgerEntry.quantityGrams).toBe(250000)
      expect(result.stockSummary.physicalStockGrams).toBe(250000)
      expect(result.stockSummary.availableGrams).toBe(250000)
      expect(result.stockSummary.reservedGrams).toBe(0)

      // Kiểm tra trực tiếp trong PostgreSQL DB
      const dbBatch = await prisma.batch.findUnique({
        where: { code },
        include: { ledgerEntries: true },
      })
      expect(dbBatch).not.toBeNull()
      expect(dbBatch?.ledgerEntries).toHaveLength(1)
      expect(dbBatch?.ledgerEntries[0].type).toBe(InventoryLedgerType.IMPORT)
      expect(dbBatch?.ledgerEntries[0].quantityGrams).toBe(250000)
    })

    it('A2. Từ chối tạo mã lô trùng lặp (Batch Code Duplication)', async () => {
      const code = 'LO-F01D-REC-01' // Đã tồn tại ở A1

      await expect(
        prisma.$transaction(async (tx) => {
          return await receiveStockInTx(tx, {
            productId: trackedProductId,
            farmId,
            code,
            harvestDate: new Date('2026-10-25'),
            expiryDate: new Date('2026-11-15'),
            quantityKg: 100,
            actorId: adminUserId,
            idempotencyKey: 'DIFFERENT_KEY_123',
          })
        })
      ).rejects.toThrow('đã tồn tại trong hệ thống')
    })

    it('A3. Idempotent Retry: gửi lại cùng idempotencyKey trả về an toàn, không tạo thêm dòng Ledger', async () => {
      const code = 'LO-F01D-IDEMP-01'
      const key = 'IDEMP_KEY_REC_A3'

      // Lần 1: Nhập kho
      const res1 = await prisma.$transaction(async (tx) => {
        return await receiveStockInTx(tx, {
          productId: trackedProductId,
          farmId,
          code,
          harvestDate: new Date('2026-10-25'),
          expiryDate: new Date('2026-11-15'),
          quantityKg: 100,
          actorId: adminUserId,
          idempotencyKey: key,
        })
      })

      // Lần 2: Retry với cùng key
      const res2 = await prisma.$transaction(async (tx) => {
        return await receiveStockInTx(tx, {
          productId: trackedProductId,
          farmId,
          code,
          harvestDate: new Date('2026-10-25'),
          expiryDate: new Date('2026-11-15'),
          quantityKg: 100,
          actorId: adminUserId,
          idempotencyKey: key,
        })
      })

      expect(res2.batch.id).toBe(res1.batch.id)
      expect(res2.ledgerEntry.id).toBe(res1.ledgerEntry.id)

      // Kiểm tra số lượng Ledger trong DB đúng bằng 1
      const count = await prisma.inventoryLedger.count({
        where: { batchId: res1.batch.id },
      })
      expect(count).toBe(1)
    })

    it('A4. Transaction Rollback: lỗi ở bất kỳ bước nào sẽ không để lại Batch mồ côi', async () => {
      const code = 'LO-F01D-ROLLBACK-01'

      await expect(
        prisma.$transaction(async (tx) => {
          await receiveStockInTx(tx, {
            productId: trackedProductId,
            farmId,
            code,
            harvestDate: new Date('2026-10-25'),
            expiryDate: new Date('2026-11-15'),
            quantityKg: 100,
            actorId: adminUserId,
          })
          // Cố tình ném lỗi sau khi tạo để kích hoạt rollback
          throw new Error('SIMULATED_TRANSACTION_FAILURE')
        })
      ).rejects.toThrow('SIMULATED_TRANSACTION_FAILURE')

      // Kiểm tra DB sạch, không có batch mồ côi
      const batch = await prisma.batch.findUnique({ where: { code } })
      expect(batch).toBeNull()
    })

    it('A5. Lô nhập UNVERIFIED không được phép bật FEFO', async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          return await receiveStockInTx(tx, {
            productId: trackedProductId,
            farmId,
            code: 'LO-F01D-UNVER-FEFO',
            harvestDate: new Date('2026-10-25'),
            expiryDate: new Date('2026-11-15'),
            quantityKg: 50,
            status: BatchStatus.UNVERIFIED,
            isFefoEligible: true, // Không hợp lệ
            actorId: adminUserId,
          })
        })
      ).rejects.toThrow('không được phép bật cờ FEFO')
    })
  })

  // ==========================================================================
  // GROUP C — STOCK ADJUSTMENT / ĐIỀU CHỈNH KHO & HAO HỤT
  // ==========================================================================
  describe('Group C — Stock Adjustment', () => {
    let testBatchId: string

    beforeAll(async () => {
      // Tạo lô hàng phục vụ kiểm thử điều chỉnh tồn: 200 kg
      const batchRes = await prisma.$transaction(async (tx) => {
        return await receiveStockInTx(tx, {
          productId: trackedProductId,
          farmId,
          code: 'LO-F01D-ADJUST-BASE',
          harvestDate: new Date('2026-10-25'),
          expiryDate: new Date('2026-11-20'),
          quantityKg: 200, // 200,000 g
          status: BatchStatus.ACTIVE,
          isFefoEligible: true,
          actorId: adminUserId,
        })
      })
      testBatchId = batchRes.batch.id
    })

    it('C1. Điều chỉnh giảm hao hụt tự nhiên (SHRINKAGE_LOSS) hợp lệ', async () => {
      const res = await prisma.$transaction(async (tx) => {
        return await adjustStockInTx(tx, {
          batchId: testBatchId,
          type: 'SHRINKAGE_LOSS',
          quantityKg: 20, // 20 kg
          reason: 'Hao hụt tự nhiên do bay hơi kho lạnh 1 tuần',
          actorId: adminUserId,
        })
      })

      expect(res.impact.deltaGrams).toBe(-20000)
      expect(res.newStockSummary.physicalStockGrams).toBe(180000)
      expect(res.newStockSummary.availableGrams).toBe(180000)
      expect(res.ledgerEntry.type).toBe(InventoryLedgerType.SHRINKAGE_LOSS)

      // Kiểm tra DB có đúng 2 dòng ledger (1 IMPORT 200kg + 1 SHRINKAGE 20kg)
      const ledgers = await prisma.inventoryLedger.findMany({
        where: { batchId: testBatchId },
        orderBy: { createdAt: 'asc' },
      })
      expect(ledgers).toHaveLength(2)
      expect(ledgers[1].type).toBe(InventoryLedgerType.SHRINKAGE_LOSS)
      expect(ledgers[1].quantityGrams).toBe(20000)
    })

    it('C2. Điều chỉnh kiểm kê thực tế (QC_ADJUSTMENT_SUB & QC_ADJUSTMENT_ADD)', async () => {
      // Giảm 10 kg kiểm kê
      const subRes = await prisma.$transaction(async (tx) => {
        return await adjustStockInTx(tx, {
          batchId: testBatchId,
          type: 'QC_ADJUSTMENT_SUB',
          quantityKg: 10,
          reason: 'Kiểm kê thực tế cân hụt 10 kg',
          actorId: adminUserId,
        })
      })
      expect(subRes.newStockSummary.physicalStockGrams).toBe(170000) // 180 - 10 = 170 kg

      // Tăng 5 kg kiểm kê
      const addRes = await prisma.$transaction(async (tx) => {
        return await adjustStockInTx(tx, {
          batchId: testBatchId,
          type: 'QC_ADJUSTMENT_ADD',
          quantityKg: 5,
          reason: 'Kiểm kê bù thừa 5 kg quả sót rổ',
          actorId: adminUserId,
        })
      })
      expect(addRes.newStockSummary.physicalStockGrams).toBe(175000) // 170 + 5 = 175 kg
    })

    it('C3. Từ chối điều chỉnh làm âm tồn vật lý (Negative Physical Stock Violation)', async () => {
      // Hiện tại còn 175 kg, yêu cầu giảm 200 kg
      await expect(
        prisma.$transaction(async (tx) => {
          return await adjustStockInTx(tx, {
            batchId: testBatchId,
            type: 'SHRINKAGE_LOSS',
            quantityKg: 200,
            reason: 'Hủy toàn bộ',
            actorId: adminUserId,
          })
        })
      ).rejects.toThrow('sẽ làm âm kho vật lý')
    })

    it('C4. Từ chối điều chỉnh giảm chạm vào phần RESERVED của đơn hàng', async () => {
      // 1. Tạo đơn hàng giữ chỗ 150 kg trên lô này (Tồn 175 kg, giữ 150 kg, khả dụng 25 kg)
      const order = await prisma.order.create({
        data: {
          code: 'DH-F01D-HOLD-01',
          userId: customerUserId,
          type: OrderType.STANDARD,
          status: OrderStatus.PENDING_CONFIRMATION,
          paymentOption: PaymentOption.FULL,
          subtotal: 15000000,
          total: 15000000,
          depositAmount: 15000000,
          groupDiscountPercent: 0,
          addressSnapshot: { line: '123' },
          paymentDueAt: new Date(Date.now() + 10 * 60 * 1000),
          items: {
            create: {
              productId: trackedProductId,
              packagingId: trackedPackagingId,
              productName: 'Sầu Riêng Ri6 F01D',
              packagingName: 'Thùng 10kg',
              isSample: false,
              quantity: 15,
              orderedGrams: 150000,
              unitPricePerKg: 100000,
              lineTotal: 15000000,
            },
          },
        },
        include: { items: true },
      })

      // Ghi nhận giữ chỗ trên lô
      await prisma.orderItemBatchAllocation.create({
        data: {
          orderItemId: order.items[0].id,
          batchId: testBatchId,
          allocatedGrams: 150000,
          status: AllocationStatus.HOLD_PENDING,
          holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
          idempotencyKey: `ALLOC:F01D:HOLD:${order.id}`,
        },
      })
      await prisma.inventoryLedger.create({
        data: {
          batchId: testBatchId,
          orderId: order.id,
          type: InventoryLedgerType.RESERVATION_HOLD,
          quantityGrams: 150000,
          idempotencyKey: `LEDGER:F01D:HOLD:${order.id}`,
          actorId: customerUserId,
        },
      })

      // 2. Thử điều chỉnh giảm 50 kg (Khả dụng chỉ còn 25 kg) -> Phải bị từ chối
      await expect(
        prisma.$transaction(async (tx) => {
          return await adjustStockInTx(tx, {
            batchId: testBatchId,
            type: 'SHRINKAGE_LOSS',
            quantityKg: 50,
            reason: 'Hao hụt giảm mạnh',
            actorId: adminUserId,
          })
        })
      ).rejects.toThrow('được giữ chỗ cho các đơn hàng')

      // 3. Giải phóng đơn hàng để dọn dẹp
      await prisma.orderItemBatchAllocation.deleteMany({
        where: { orderItemId: order.items[0].id },
      })
      await prisma.inventoryLedger.deleteMany({
        where: { orderId: order.id },
      })
      await prisma.order.delete({ where: { id: order.id } })
    })
  })

  // ==========================================================================
  // GROUP D — BATCH STATUS & AUDIT TRAIL
  // ==========================================================================
  describe('Group D — Batch Status & Audit Trail', () => {
    let statusBatchId: string

    beforeAll(async () => {
      // Tạo một lô UNVERIFIED để test chuyển trạng thái
      const batchRes = await prisma.$transaction(async (tx) => {
        return await receiveStockInTx(tx, {
          productId: trackedProductId,
          farmId,
          code: 'LO-F01D-STATUS-01',
          harvestDate: new Date('2026-10-25'),
          expiryDate: new Date('2026-11-25'),
          quantityKg: 100,
          status: BatchStatus.UNVERIFIED,
          isFefoEligible: false,
          actorId: adminUserId,
        })
      })
      statusBatchId = batchRes.batch.id
    })

    it('D1. Chuyển trạng thái hợp lệ UNVERIFIED -> ACTIVE và ghi Audit Trail vào AppSetting', async () => {
      const reason = 'Đạt chuẩn kiểm định độ ngọt Brix >= 16 độ sau ủ nhiệt'

      const res = await prisma.$transaction(async (tx) => {
        return await updateBatchStatusInTx(tx, {
          batchId: statusBatchId,
          targetStatus: BatchStatus.ACTIVE,
          targetEligibility: true,
          reason,
          qcNotes: 'Brix 16.5, múi ráo vàng óng',
          actorId: adminUserId,
        })
      })

      expect(res.batch.status).toBe(BatchStatus.ACTIVE)
      expect(res.batch.isFefoEligible).toBe(true)
      expect(res.auditEntry.oldStatus).toBe(BatchStatus.UNVERIFIED)
      expect(res.auditEntry.newStatus).toBe(BatchStatus.ACTIVE)
      expect(res.auditEntry.reason).toBe(reason)

      // Kiểm tra DB
      const dbBatch = await prisma.batch.findUnique({ where: { id: statusBatchId } })
      expect(dbBatch?.status).toBe(BatchStatus.ACTIVE)
      expect(dbBatch?.isFefoEligible).toBe(true)

      // Kiểm tra Audit Trail đọc được từ AppSetting
      const history = await getBatchStatusAuditTrail(prisma, statusBatchId)
      expect(history.length).toBeGreaterThanOrEqual(1)
      expect(history[0].newStatus).toBe(BatchStatus.ACTIVE)
      expect(history[0].actorId).toBe(adminUserId)
    })

    it('D2. Từ chối chuyển đổi vi phạm máy trạng thái (DEPLETED -> ACTIVE)', async () => {
      // Đặt tạm trạng thái lô sang DEPLETED
      await prisma.batch.update({
        where: { id: statusBatchId },
        data: { status: BatchStatus.DEPLETED, isFefoEligible: false },
      })

      await expect(
        prisma.$transaction(async (tx) => {
          return await updateBatchStatusInTx(tx, {
            batchId: statusBatchId,
            targetStatus: BatchStatus.ACTIVE,
            targetEligibility: true,
            reason: 'Muốn mở lại bán',
            actorId: adminUserId,
          })
        })
      ).rejects.toThrow('Không thể chuyển trạng thái lô hàng từ DEPLETED sang ACTIVE')

      // Hoàn lại trạng thái ACTIVE để test tiếp
      await prisma.batch.update({
        where: { id: statusBatchId },
        data: { status: BatchStatus.ACTIVE, isFefoEligible: true },
      })
    })

    it('D3. Từ chối phong tỏa LOCKED_QC hoặc tắt FEFO khi lô đang có hàng giữ chỗ (Reservation Hold Protection)', async () => {
      // Tạo 1 allocation giữ chỗ 50 kg
      const order = await prisma.order.create({
        data: {
          code: 'DH-F01D-HOLD-D3',
          userId: customerUserId,
          type: OrderType.STANDARD,
          status: OrderStatus.PENDING_CONFIRMATION,
          paymentOption: PaymentOption.FULL,
          subtotal: 5000000,
          total: 5000000,
          depositAmount: 5000000,
          groupDiscountPercent: 0,
          addressSnapshot: { line: '123' },
          paymentDueAt: new Date(Date.now() + 10 * 60 * 1000),
          items: {
            create: {
              productId: trackedProductId,
              packagingId: trackedPackagingId,
              productName: 'Sầu Riêng Ri6 F01D',
              packagingName: 'Thùng 10kg',
              isSample: false,
              quantity: 5,
              orderedGrams: 50000,
              unitPricePerKg: 100000,
              lineTotal: 5000000,
            },
          },
        },
        include: { items: true },
      })

      await prisma.orderItemBatchAllocation.create({
        data: {
          orderItemId: order.items[0].id,
          batchId: statusBatchId,
          allocatedGrams: 50000,
          status: AllocationStatus.HOLD_PENDING,
          holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
          idempotencyKey: `ALLOC:D3:${order.id}`,
        },
      })

      // Thử khóa lô sang LOCKED_QC -> Phải bị chặn
      await expect(
        prisma.$transaction(async (tx) => {
          return await updateBatchStatusInTx(tx, {
            batchId: statusBatchId,
            targetStatus: BatchStatus.LOCKED_QC,
            targetEligibility: false,
            reason: 'Kiểm định đột xuất',
            actorId: adminUserId,
          })
        })
      ).rejects.toThrow('CẢNH BÁO BẢO VỆ RESERVATION')

      // Dọn dẹp
      await prisma.orderItemBatchAllocation.deleteMany({
        where: { orderItemId: order.items[0].id },
      })
      await prisma.order.delete({ where: { id: order.id } })
    })
  })

  // ==========================================================================
  // GROUP E — F01C REGRESSION & CONSISTENCY
  // ==========================================================================
  describe('Group E — F01C Checkout Reservation Regression & Visibility Consistency', () => {
    it('E1. Khách đặt đơn FEFO: phân bổ chính xác theo lô gần hết hạn nhất', async () => {
      // Kiểm tra số dư công khai của sản phẩm trước khi đặt
      const stockBefore = await getPublicStockByProductIds([trackedProductId])
      const availBefore = stockBefore[trackedProductId]?.availableGrams || 0
      expect(availBefore).toBeGreaterThanOrEqual(100000)

      // Đặt đơn 30 kg
      const order = await prisma.order.create({
        data: {
          code: 'DH-F01D-REGRESS-01',
          userId: customerUserId,
          type: OrderType.STANDARD,
          status: OrderStatus.PENDING_CONFIRMATION,
          paymentOption: PaymentOption.FULL,
          subtotal: 3000000,
          total: 3000000,
          depositAmount: 3000000,
          groupDiscountPercent: 0,
          addressSnapshot: { line: '123' },
          paymentDueAt: new Date(Date.now() + 10 * 60 * 1000),
          items: {
            create: {
              productId: trackedProductId,
              packagingId: trackedPackagingId,
              productName: 'Sầu Riêng Ri6 F01D',
              packagingName: 'Thùng 10kg',
              isSample: false,
              quantity: 3,
              orderedGrams: 30000,
              unitPricePerKg: 100000,
              lineTotal: 3000000,
            },
          },
        },
        include: { items: true },
      })

      const reserveRes = await prisma.$transaction(async (tx) => {
        return await reserveOrderInventoryFefo(tx, {
          orderId: order.id,
          orderCode: order.code,
          userId: customerUserId,
          items: [
            {
              id: order.items[0].id,
              productId: trackedProductId,
              productName: 'Sầu Riêng Ri6 F01D',
              orderedGrams: 30000,
            },
          ],
          products: [{ id: trackedProductId, name: 'Sầu Riêng Ri6 F01D', inventoryTrackingEnabled: true }],
          holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        })
      })

      expect(reserveRes.reserved).toBe(true)
      expect(reserveRes.allocations).toHaveLength(1)
      expect(reserveRes.allocations[0].allocatedGrams).toBe(30000)

      // Kiểm tra tính nhất quán Storefront: khả dụng giảm đúng 30 kg
      const stockAfter = await getPublicStockByProductIds([trackedProductId])
      const availAfter = stockAfter[trackedProductId]?.availableGrams || 0
      expect(availAfter).toBe(availBefore - 30000)

      // Kiểm tra tính nhất quán Admin Dashboard
      const adminViews = await getAdminBatchesInventoryView()
      const batchView = adminViews.find((v) => v.batch.id === reserveRes.allocations[0].batchId)
      expect(batchView?.batch.reservedGrams).toBe(30000)
    })

    it('E2. Tự động giải phóng khi quá hạn 10 phút (Server-time Lazy Expiration)', async () => {
      // Tìm đơn hàng vừa tạo ở E1
      const order = await prisma.order.findUnique({
        where: { code: 'DH-F01D-REGRESS-01' },
      })
      expect(order).not.toBeNull()

      // Giả lập thời gian server 11 phút sau
      const futureTime = new Date(Date.now() + 11 * 60 * 1000)

      const expireRes = await prisma.$transaction(async (tx) => {
        return await expireOverdueOrderInTx(tx, order!.id, futureTime)
      })

      expect(expireRes.expired).toBe(true)
      expect(expireRes.orderCancelled).toBe(true)
      expect(expireRes.totalReleasedGrams).toBe(30000)

      // Kiểm tra tồn kho khả dụng được hoàn trả đầy đủ
      const stockRestored = await getPublicStockByProductIds([trackedProductId])
      const availRestored = stockRestored[trackedProductId]?.availableGrams || 0
      expect(availRestored).toBeGreaterThanOrEqual(100000)

      // Admin Dashboard không còn giữ chỗ
      const adminViews = await getAdminBatchesInventoryView()
      const totalReserved = adminViews
        .filter((v) => v.batch.productId === trackedProductId)
        .reduce((sum, v) => sum + v.batch.reservedGrams, 0)
      expect(totalReserved).toBe(0)
    })
  })

  // ==========================================================================
  // GROUP F — AUTHORIZATION & SECURITY
  // ==========================================================================
  describe('Group F — Authorization & Security', () => {
    it('F1. Non-Admin gọi Server Action bị từ chối bằng lỗi phân quyền', async () => {
      vi.mocked(requireAdmin).mockRejectedValueOnce(
        new Error('Bạn không có quyền truy cập trang quản trị')
      )

      const res = await adminReceiveStock({
        productId: trackedProductId,
        farmId,
        code: 'LO-NON-ADMIN',
        harvestDate: new Date(),
        quantityKg: 10,
      })

      expect(res.success).toBe(false)
      expect(res.error).toContain('không có quyền truy cập')
    })

    it('F2. Feature Flag OFF: từ chối mọi thao tác ghi kho (Fail-closed Guard)', async () => {
      // Tắt cờ tính năng ghi kho
      process.env.ENABLE_ADMIN_INVENTORY_WRITES = 'false'

      const resReceive = await adminReceiveStock({
        productId: trackedProductId,
        farmId,
        code: 'LO-FLAG-OFF',
        harvestDate: new Date(),
        quantityKg: 50,
      })
      expect(resReceive.success).toBe(false)
      expect(resReceive.code).toBe('FEATURE_DISABLED')

      const resAdjust = await adminAdjustStock({
        batchId: 'any-batch',
        type: 'SHRINKAGE_LOSS',
        quantityKg: 10,
        reason: 'Hao hụt',
      })
      expect(resAdjust.success).toBe(false)
      expect(resAdjust.code).toBe('FEATURE_DISABLED')

      const resStatus = await adminUpdateBatchStatus({
        batchId: 'any-batch',
        targetStatus: BatchStatus.LOCKED_QC,
        targetEligibility: false,
        reason: 'Khóa lô',
      })
      expect(resStatus.success).toBe(false)
      expect(resStatus.code).toBe('FEATURE_DISABLED')

      // Khôi phục cờ để không ảnh hưởng
      process.env.ENABLE_ADMIN_INVENTORY_WRITES = 'true'
    })
  })
})
