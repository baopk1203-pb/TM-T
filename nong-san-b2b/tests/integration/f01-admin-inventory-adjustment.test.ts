/**
 * ============================================================================
 * EV-F01-ADMIN-INVENTORY-ADJUSTMENT-01 — POSTGRESQL INTEGRATION TEST SUITE
 * ============================================================================
 * Kiểm thử toàn diện 12 kịch bản bắt buộc theo đặc tả Section VIII:
 * 1. Admin tăng tồn 1 kg.
 * 2. Admin giảm tồn 1 kg.
 * 3. Physical và Available cập nhật chính xác.
 * 4. Reserved không bị thay đổi sai.
 * 5. Ledger có đúng một bút toán.
 * 6. Double Submit không tạo giao dịch trùng (Idempotency).
 * 7. Người dùng không phải Admin bị từ chối (Authorization).
 * 8. Feature Flag OFF → không cho phép ghi (Fail-closed).
 * 9. Feature Flag ON (ENABLE_ADMIN_INVENTORY_ADJUSTMENTS="true") → chỉ cho phép đúng phạm vi.
 * 10. Điều chỉnh giảm vượt số lượng hợp lệ → bị từ chối.
 * 11. Transaction Failure → rollback.
 * 12. Concurrent Adjustments → không phá vỡ bất biến tồn kho.
 * ============================================================================
 */

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
  adjustStockInTx,
  receiveStockInTx,
} from '@/lib/services/inventory-write'
import {
  adminAdjustStock,
  adminReceiveStock,
  adminUpdateBatchStatus,
} from '@/server/actions/inventory-operations'
import { requireAdmin, requireUser } from '@/lib/auth'

// Mock authentication và Next.js cache
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

const TEST_DB_PORT = 5436
const TEST_DB_NAME = 'evibe_adj_test'
const TEST_DB_USER = 'test_postgres'
const TEST_DB_PASS = 'test_password123'
const TEST_DB_DIR = path.resolve(process.cwd(), '.test-pg-data-adj')
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
let adminUserId: string
let customerUserId: string
let trackedProductId: string
let untrackedProductId: string
let packagingId: string
let testBatchId: string
let testBatchCode: string

describe('EV-F01-ADMIN-INVENTORY-ADJUSTMENT-01 — PostgreSQL Targeted Suite', () => {
  beforeAll(async () => {
    // 1. Dọn dẹp thư mục cụm nếu tồn tại
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

    // 3. Thiết lập biến môi trường
    process.env.DATABASE_URL = TEST_DB_URL
    process.env.DIRECT_URL = TEST_DB_URL
    process.env.ENABLE_ADMIN_INVENTORY_WRITES = 'true'
    process.env.ENABLE_ADMIN_INVENTORY_ADJUSTMENTS = 'true'

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

    // 6. Tạo fixtures
    const farm = await prisma.farm.create({
      data: {
        name: 'Nông trường Sầu Riêng Bến Tre Demo',
        slug: 'nong-truong-sau-rieng-ben-tre-demo',
        province: 'Bến Tre',
        addressText: 'Chợ Lách, Bến Tre',
        description: 'Vườn sầu riêng mẫu phục vụ kiểm thử',
        lat: 10.25,
        lng: 106.35,
      },
    })
    farmId = farm.id

    const adminUser = await prisma.user.create({
      data: {
        email: 'admin.f01.adj@evibe.vn',
        fullName: 'Admin F01 Adjustment Tester',
        role: Role.ADMIN,
        phone: '0900000001',
        passwordHash: 'dummyhash',
      },
    })
    adminUserId = adminUser.id

    const customerUser = await prisma.user.create({
      data: {
        email: 'customer.f01.adj@evibe.vn',
        fullName: 'Customer F01 Tester',
        role: Role.CUSTOMER,
        phone: '0900000002',
        passwordHash: 'dummyhash',
      },
    })
    customerUserId = customerUser.id

    const trackedProduct = await prisma.product.create({
      data: {
        name: 'Sầu Riêng Chín Cây Bến Tre',
        slug: 'sau-rieng-chin-cay-ben-tre',
        farmId,
        description: 'Sản phẩm có theo dõi kho',
        inventoryTrackingEnabled: true,
        isActive: true,
        moqGrams: 10000,
        leadTimeDays: 1,
        seasonStatus: 'HARVESTING',
        packagings: {
          create: [{
            name: 'Thùng 10kg',
            weightGrams: 10000,
            isActive: true,
          }],
        },
        priceTiers: {
          create: [{ minGrams: 10000, pricePerKg: 100000 }],
        },
      },
      include: { packagings: true },
    })
    trackedProductId = trackedProduct.id
    packagingId = trackedProduct.packagings[0].id

    const untrackedProduct = await prisma.product.create({
      data: {
        name: 'Rau Sạch Demo Chưa Bật Kho',
        slug: 'rau-sach-demo-chua-bat-kho',
        farmId,
        description: 'Sản phẩm không quản lý tồn kho sổ cái',
        inventoryTrackingEnabled: false,
        isActive: true,
        moqGrams: 5000,
        leadTimeDays: 1,
        seasonStatus: 'HARVESTING',
      },
    })
    untrackedProductId = untrackedProduct.id

    // Tạo một lô hàng ban đầu 100 kg
    testBatchCode = 'LO-DEMO-ADJ-001'
    const batchRes = await prisma.$transaction(async (tx) => {
      return await receiveStockInTx(tx, {
        productId: trackedProductId,
        farmId,
        code: testBatchCode,
        harvestDate: new Date(),
        expiryDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        quantityKg: 100,
        status: BatchStatus.ACTIVE,
        isFefoEligible: true,
        actorId: adminUserId,
      })
    })
    testBatchId = batchRes.batch.id

    // Default mock admin
    vi.mocked(requireAdmin).mockResolvedValue({
      id: adminUserId,
      email: 'admin.f01.adj@evibe.vn',
      role: Role.ADMIN,
      fullName: 'Admin F01 Adjustment Tester',
      phone: '0900000001',
    } as never)
    vi.mocked(requireUser).mockResolvedValue({
      id: adminUserId,
      email: 'admin.f01.adj@evibe.vn',
      role: Role.ADMIN,
      fullName: 'Admin F01 Adjustment Tester',
      phone: '0900000001',
    } as never)
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
  })

  // ==========================================================================
  // CASE 1, 3, 4, 5: ADMIN TĂNG TỒN 1 KG
  // ==========================================================================
  it('1. Admin tăng tồn 1 kg (QC_ADJUSTMENT_ADD): Physical và Available cập nhật chính xác, Reserved không đổi, tạo đúng 1 Ledger', async () => {
    const initialLedgerCount = await prisma.inventoryLedger.count({
      where: { batchId: testBatchId },
    })

    const res = await adminAdjustStock({
      batchId: testBatchId,
      type: 'QC_ADJUSTMENT_ADD',
      quantityKg: 1,
      reason: 'Kiểm kê thực tế bù thừa 1 kg sầu riêng',
      referenceCode: 'BB-KK-ADD-01',
      idempotencyKey: 'IDEMP:ADD:1KG:001',
    })

    expect(res.success).toBe(true)
    expect(res.data).toBeDefined()

    // 3. Physical & Available cập nhật chính xác: 100kg + 1kg = 101kg (101000g)
    const data = res.data as { newStockSummary: { physicalStockGrams: number; availableGrams: number; reservedGrams: number } }
    expect(data.newStockSummary.physicalStockGrams).toBe(101000)
    expect(data.newStockSummary.availableGrams).toBe(101000)

    // 4. Reserved không bị thay đổi sai (vẫn là 0g)
    expect(data.newStockSummary.reservedGrams).toBe(0)

    // 5. Ledger có đúng một bút toán mới
    const currentLedgerCount = await prisma.inventoryLedger.count({
      where: { batchId: testBatchId },
    })
    expect(currentLedgerCount).toBe(initialLedgerCount + 1)

    const createdLedger = await prisma.inventoryLedger.findUnique({
      where: { idempotencyKey: 'IDEMP:ADD:1KG:001' },
    })
    expect(createdLedger).not.toBeNull()
    expect(createdLedger?.type).toBe(InventoryLedgerType.QC_ADJUSTMENT_ADD)
    expect(createdLedger?.quantityGrams).toBe(1000)
    expect(createdLedger?.actorId).toBe(adminUserId)
    expect(createdLedger?.referenceCode).toBe('BB-KK-ADD-01')
  })

  // ==========================================================================
  // CASE 2, 3, 4, 5: ADMIN GIẢM TỒN 1 KG
  // ==========================================================================
  it('2. Admin giảm tồn 1 kg (QC_ADJUSTMENT_SUB): Physical và Available cập nhật chính xác, Reserved không đổi, tạo đúng 1 Ledger', async () => {
    const initialLedgerCount = await prisma.inventoryLedger.count({
      where: { batchId: testBatchId },
    })

    const res = await adminAdjustStock({
      batchId: testBatchId,
      type: 'QC_ADJUSTMENT_SUB',
      quantityKg: 1,
      reason: 'Kiểm kê thực tế giảm hụt 1 kg do phân loại dập',
      referenceCode: 'BB-KK-SUB-01',
      idempotencyKey: 'IDEMP:SUB:1KG:001',
    })

    expect(res.success).toBe(true)

    // 3. Physical & Available: 101kg - 1kg = 100kg (100000g)
    const data = res.data as { newStockSummary: { physicalStockGrams: number; availableGrams: number; reservedGrams: number } }
    expect(data.newStockSummary.physicalStockGrams).toBe(100000)
    expect(data.newStockSummary.availableGrams).toBe(100000)

    // 4. Reserved vẫn là 0g
    expect(data.newStockSummary.reservedGrams).toBe(0)

    // 5. Ledger có đúng 1 bút toán mới
    const currentLedgerCount = await prisma.inventoryLedger.count({
      where: { batchId: testBatchId },
    })
    expect(currentLedgerCount).toBe(initialLedgerCount + 1)

    const createdLedger = await prisma.inventoryLedger.findUnique({
      where: { idempotencyKey: 'IDEMP:SUB:1KG:001' },
    })
    expect(createdLedger?.type).toBe(InventoryLedgerType.QC_ADJUSTMENT_SUB)
    expect(createdLedger?.quantityGrams).toBe(1000)
  })

  // ==========================================================================
  // CASE 6: DOUBLE SUBMIT / IDEMPOTENCY
  // ==========================================================================
  it('6. Double Submit cùng idempotencyKey không tạo giao dịch trùng lặp', async () => {
    const fixedKey = 'IDEMP:DOUBLE:SUBMIT:KEY:001'
    const initialLedgerCount = await prisma.inventoryLedger.count({
      where: { batchId: testBatchId },
    })

    // Lần gọi 1
    const res1 = await adminAdjustStock({
      batchId: testBatchId,
      type: 'SHRINKAGE_LOSS',
      quantityKg: 2,
      reason: 'Hao hụt tự nhiên do bảo quản lạnh',
      idempotencyKey: fixedKey,
    })
    expect(res1.success).toBe(true)
    const countAfterFirst = await prisma.inventoryLedger.count({
      where: { batchId: testBatchId },
    })
    expect(countAfterFirst).toBe(initialLedgerCount + 1)

    // Lần gọi 2 (Double submit gửi lại đúng key)
    const res2 = await adminAdjustStock({
      batchId: testBatchId,
      type: 'SHRINKAGE_LOSS',
      quantityKg: 2,
      reason: 'Hao hụt tự nhiên do bảo quản lạnh',
      idempotencyKey: fixedKey,
    })
    expect(res2.success).toBe(true)

    // Không sinh thêm bản ghi Ledger thứ hai
    const countAfterSecond = await prisma.inventoryLedger.count({
      where: { batchId: testBatchId },
    })
    expect(countAfterSecond).toBe(countAfterFirst)
  })

  it('6b. Bắt buộc cung cấp idempotencyKey hợp lệ (>= 8 ký tự), từ chối request thiếu key', async () => {
    // 1. Không truyền idempotencyKey
    const resNoKey = await adminAdjustStock({
      batchId: testBatchId,
      type: 'QC_ADJUSTMENT_ADD',
      quantityKg: 1,
      reason: 'Thiếu key hoàn toàn',
    })
    expect(resNoKey.success).toBe(false)
    expect(resNoKey.code).toBe('INVALID_IDEMPOTENCY_KEY')

    // 2. Key rỗng hoặc quá ngắn (< 8 ký tự)
    const resShortKey = await adminAdjustStock({
      batchId: testBatchId,
      type: 'QC_ADJUSTMENT_ADD',
      quantityKg: 1,
      reason: 'Key quá ngắn',
      idempotencyKey: 'SHORT',
    })
    expect(resShortKey.success).toBe(false)
    expect(resShortKey.code).toBe('INVALID_IDEMPOTENCY_KEY')
  })

  it('6c. Chặn tái sử dụng idempotencyKey với payload khác (Payload Mismatch Protection)', async () => {
    const mismatchKey = 'IDEMP:MISMATCH:TEST:001'

    // Lần 1: Thực hiện điều chỉnh giảm 1 kg SHRINKAGE_LOSS
    const resInitial = await adminAdjustStock({
      batchId: testBatchId,
      type: 'SHRINKAGE_LOSS',
      quantityKg: 1,
      reason: 'Hao hụt ban đầu hợp lệ',
      idempotencyKey: mismatchKey,
    })
    expect(resInitial.success).toBe(true)

    // Lần 2: Cố tình gửi lại đúng key mismatchKey nhưng đổi quantity thành 5 kg
    const resDifferentQty = await adminAdjustStock({
      batchId: testBatchId,
      type: 'SHRINKAGE_LOSS',
      quantityKg: 5,
      reason: 'Thử đổi khối lượng cùng key',
      idempotencyKey: mismatchKey,
    })
    expect(resDifferentQty.success).toBe(false)
    expect(resDifferentQty.error).toContain('Payload mismatch')

    // Lần 3: Cố tình gửi lại đúng key mismatchKey nhưng đổi type thành QC_ADJUSTMENT_ADD
    const resDifferentType = await adminAdjustStock({
      batchId: testBatchId,
      type: 'QC_ADJUSTMENT_ADD',
      quantityKg: 1,
      reason: 'Thử đổi loại giao dịch cùng key',
      idempotencyKey: mismatchKey,
    })
    expect(resDifferentType.success).toBe(false)
    expect(resDifferentType.error).toContain('Payload mismatch')
  })

  it('6d. Retry thao tác khi request đầu đã commit nhưng phản hồi bị mất không tạo ledger mới', async () => {
    const retryKey = 'IDEMP:RETRY:SIMULATION:001'
    const initialLedgerCount = await prisma.inventoryLedger.count({
      where: { batchId: testBatchId },
    })

    // Request 1: Gửi thành công đến server và đã commit vào DB
    const res1 = await adminAdjustStock({
      batchId: testBatchId,
      type: 'QC_ADJUSTMENT_ADD',
      quantityKg: 2,
      reason: 'Bổ sung kiểm kê thực tế',
      idempotencyKey: retryKey,
    })
    expect(res1.success).toBe(true)
    const ledgerAfter1 = await prisma.inventoryLedger.count({
      where: { batchId: testBatchId },
    })
    expect(ledgerAfter1).toBe(initialLedgerCount + 1)

    // Giả lập client bị rớt mạng / mất response, client retry gửi lại đúng retryKey
    const resRetry = await adminAdjustStock({
      batchId: testBatchId,
      type: 'QC_ADJUSTMENT_ADD',
      quantityKg: 2,
      reason: 'Bổ sung kiểm kê thực tế',
      idempotencyKey: retryKey,
    })
    expect(resRetry.success).toBe(true)
    expect(resRetry.data).toBeDefined()

    // Kiểm tra số lượng Ledger: Tuyệt đối KHÔNG tạo thêm Ledger thứ hai
    const ledgerAfterRetry = await prisma.inventoryLedger.count({
      where: { batchId: testBatchId },
    })
    expect(ledgerAfterRetry).toBe(ledgerAfter1)

    // Khối lượng tồn kho không bị cộng dồn lần 2
    const data = resRetry.data as { ledgerEntry: { id: string } }
    const firstData = res1.data as { ledgerEntry: { id: string } }
    expect(data.ledgerEntry.id).toBe(firstData.ledgerEntry.id)
  })

  // ==========================================================================
  // CASE 7: NON-ADMIN AUTHORIZATION
  // ==========================================================================
  it('7. Người dùng không phải Admin bị từ chối fail-closed', async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(
      new Error('Bạn không có quyền truy cập trang quản trị')
    )

    const res = await adminAdjustStock({
      batchId: testBatchId,
      type: 'QC_ADJUSTMENT_ADD',
      quantityKg: 5,
      reason: 'Hack tồn kho',
    })

    expect(res.success).toBe(false)
    expect(res.error).toContain('không có quyền truy cập')
  })

  // ==========================================================================
  // CASE 8: FEATURE FLAG OFF
  // ==========================================================================
  it('8. Feature Flag OFF (cả WRITES lẫn ADJUSTMENTS đều tắt) → từ chối ghi', async () => {
    process.env.ENABLE_ADMIN_INVENTORY_WRITES = 'false'
    process.env.ENABLE_ADMIN_INVENTORY_ADJUSTMENTS = 'false'

    const res = await adminAdjustStock({
      batchId: testBatchId,
      type: 'QC_ADJUSTMENT_ADD',
      quantityKg: 2,
      reason: 'Thử ghi khi cờ tắt',
    })

    expect(res.success).toBe(false)
    expect(res.code).toBe('FEATURE_DISABLED')
    expect(res.error).toContain('chính sách an toàn (Fail-closed)')

    // Khôi phục cờ
    process.env.ENABLE_ADMIN_INVENTORY_ADJUSTMENTS = 'true'
  })

  // ==========================================================================
  // CASE 9: FEATURE FLAG SCOPE ISOLATION (CHỈ MỞ ADJUSTMENT, KHÓA MODULE A & D)
  // ==========================================================================
  it('9. Feature Flag ON (ADJUSTMENTS=true, WRITES=false) → Chỉ cho phép Adjustment, khóa Nhập kho & Đổi trạng thái', async () => {
    process.env.ENABLE_ADMIN_INVENTORY_WRITES = 'false'
    process.env.ENABLE_ADMIN_INVENTORY_ADJUSTMENTS = 'true'

    // 1. Thao tác Điều chỉnh tồn kho: PHẢI THÀNH CÔNG
    const resAdjust = await adminAdjustStock({
      batchId: testBatchId,
      type: 'QC_ADJUSTMENT_ADD',
      quantityKg: 2,
      reason: 'Điều chỉnh trong chế độ Demo được kích hoạt',
      idempotencyKey: 'IDEMP:DEMO:SCOPE:001',
    })
    expect(resAdjust.success).toBe(true)

    // 2. Thao tác Nhập kho (Module A): PHẢI BỊ KHÓA
    const resReceive = await adminReceiveStock({
      productId: trackedProductId,
      farmId,
      code: 'LO-FAIL-CLOSED-01',
      harvestDate: new Date(),
      quantityKg: 50,
    })
    expect(resReceive.success).toBe(false)
    expect(resReceive.code).toBe('FEATURE_DISABLED')

    // 3. Thao tác Cập nhật trạng thái lô (Module D): PHẢI BỊ KHÓA
    const resStatus = await adminUpdateBatchStatus({
      batchId: testBatchId,
      targetStatus: BatchStatus.LOCKED_QC,
      targetEligibility: false,
      reason: 'Khóa lô demo',
    })
    expect(resStatus.success).toBe(false)
    expect(resStatus.code).toBe('FEATURE_DISABLED')
  })

  // ==========================================================================
  // CASE 10: TỪ CHỐI GIẢM VƯỢT QUÁ SỐ LƯỢNG HỢP LỆ HOẶC XÂM PHẠM RESERVED
  // ==========================================================================
  it('10. Điều chỉnh giảm vượt số lượng hợp lệ hoặc xâm phạm Reserved bị từ chối', async () => {
    // 1. Tạo một đơn hàng giữ chỗ 90 kg trên lô này
    const order = await prisma.order.create({
      data: {
        code: 'DH-ADJ-RESERVED-01',
        userId: customerUserId,
        type: OrderType.STANDARD,
        status: OrderStatus.PENDING_CONFIRMATION,
        paymentOption: PaymentOption.FULL,
        subtotal: 9000000,
        total: 9000000,
        depositAmount: 9000000,
        groupDiscountPercent: 0,
        addressSnapshot: { line: '123' },
        paymentDueAt: new Date(Date.now() + 10 * 60 * 1000),
        items: {
          create: {
            productId: trackedProductId,
            packagingId,
            productName: 'Sầu Riêng Chín Cây',
            packagingName: 'Thùng 10kg',
            isSample: false,
            quantity: 9,
            orderedGrams: 90000,
            unitPricePerKg: 100000,
            lineTotal: 9000000,
          },
        },
      },
      include: { items: true },
    })

    await prisma.orderItemBatchAllocation.create({
      data: {
        orderItemId: order.items[0].id,
        batchId: testBatchId,
        allocatedGrams: 90000,
        status: AllocationStatus.HOLD_PENDING,
        holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        idempotencyKey: `ALLOC:ADJ:${order.id}`,
      },
    })
    await prisma.inventoryLedger.create({
      data: {
        batchId: testBatchId,
        orderId: order.id,
        type: InventoryLedgerType.RESERVATION_HOLD,
        quantityGrams: 90000,
        idempotencyKey: `LEDGER:ADJ:HOLD:${order.id}`,
        actorId: customerUserId,
      },
    })

    // Hiện tại: Tồn vật lý ~100 kg, Reserved = 90 kg, Khả dụng ~10 kg.
    // Thử giảm 20 kg (vượt tồn khả dụng 10 kg) -> Phải bị từ chối
    const resExceed = await adminAdjustStock({
      batchId: testBatchId,
      type: 'QC_ADJUSTMENT_SUB',
      quantityKg: 20,
      reason: 'Giảm vượt mức khả dụng đang giữ chỗ',
      idempotencyKey: 'IDEMP:TEST:EXCEED:001',
    })

    expect(resExceed.success).toBe(false)
    expect(resExceed.error).toContain('được giữ chỗ cho các đơn hàng')

    // Thử giảm 200 kg (vượt cả tồn vật lý) -> Phải bị từ chối
    const resNegative = await adminAdjustStock({
      batchId: testBatchId,
      type: 'SHRINKAGE_LOSS',
      quantityKg: 200,
      reason: 'Hủy toàn bộ vượt tồn',
      idempotencyKey: 'IDEMP:TEST:NEGATIVE:001',
    })
    expect(resNegative.success).toBe(false)
    expect(resNegative.error).toContain('làm âm kho vật lý')

    // Dọn dẹp đơn giữ chỗ
    await prisma.orderItemBatchAllocation.deleteMany({
      where: { orderItemId: order.items[0].id },
    })
    await prisma.inventoryLedger.deleteMany({
      where: { orderId: order.id },
    })
    await prisma.order.delete({ where: { id: order.id } })
  })

  // ==========================================================================
  // CASE 11: TRANSACTION ROLLBACK ON FAILURE
  // ==========================================================================
  it('11. Transaction Failure → Rollback hoàn toàn, không lưu Ledger mồ côi', async () => {
    const initialCount = await prisma.inventoryLedger.count({
      where: { batchId: testBatchId },
    })

    await expect(
      prisma.$transaction(async (tx) => {
        await adjustStockInTx(tx, {
          batchId: testBatchId,
          type: 'QC_ADJUSTMENT_ADD',
          quantityKg: 3,
          reason: 'Giao dịch thử nghiệm sẽ bị ném lỗi sau đó',
          actorId: adminUserId,
          idempotencyKey: 'IDEMP:TX:FAIL:001',
        })

        // Giả lập lỗi ở bước tiếp theo trong cùng transaction
        throw new Error('SIMULATED_NETWORK_FAILURE_AFTER_ADJUST')
      })
    ).rejects.toThrow('SIMULATED_NETWORK_FAILURE_AFTER_ADJUST')

    // Xác nhận không có bản ghi nào bị ghi lại
    const afterCount = await prisma.inventoryLedger.count({
      where: { batchId: testBatchId },
    })
    expect(afterCount).toBe(initialCount)

    const leakedEntry = await prisma.inventoryLedger.findUnique({
      where: { idempotencyKey: 'IDEMP:TX:FAIL:001' },
    })
    expect(leakedEntry).toBeNull()
  })

  // ==========================================================================
  // CASE 12: CONCURRENT ADJUSTMENTS & INVARIANT INTEGRITY
  // ==========================================================================
  it('12. Concurrent Adjustments không phá vỡ bất biến tồn kho', async () => {
    // Chạy song song 5 giao dịch điều chỉnh tăng/giảm cùng lúc
    const concurrentPromises = [
      adminAdjustStock({
        batchId: testBatchId,
        type: 'QC_ADJUSTMENT_ADD',
        quantityKg: 2,
        reason: 'Concurrent add 2kg 1',
        idempotencyKey: 'CONCURRENT:01',
      }),
      adminAdjustStock({
        batchId: testBatchId,
        type: 'QC_ADJUSTMENT_ADD',
        quantityKg: 3,
        reason: 'Concurrent add 3kg 2',
        idempotencyKey: 'CONCURRENT:02',
      }),
      adminAdjustStock({
        batchId: testBatchId,
        type: 'QC_ADJUSTMENT_SUB',
        quantityKg: 1,
        reason: 'Concurrent sub 1kg 3',
        idempotencyKey: 'CONCURRENT:03',
      }),
      adminAdjustStock({
        batchId: testBatchId,
        type: 'SHRINKAGE_LOSS',
        quantityKg: 2,
        reason: 'Concurrent loss 2kg 4',
        idempotencyKey: 'CONCURRENT:04',
      }),
      adminAdjustStock({
        batchId: testBatchId,
        type: 'QC_ADJUSTMENT_ADD',
        quantityKg: 1,
        reason: 'Concurrent add 1kg 5',
        idempotencyKey: 'CONCURRENT:05',
      }),
    ]

    const results = await Promise.all(concurrentPromises)
    for (const r of results) {
      expect(r.success).toBe(true)
    }

    // Đọc lại toàn bộ Ledger từ PostgreSQL
    const allLedgers = await prisma.inventoryLedger.findMany({
      where: { batchId: testBatchId },
    })

    let calcPhysical = 0
    for (const l of allLedgers) {
      if (l.type === InventoryLedgerType.IMPORT || l.type === InventoryLedgerType.QC_ADJUSTMENT_ADD) {
        calcPhysical += l.quantityGrams
      } else if (l.type === InventoryLedgerType.SHRINKAGE_LOSS || l.type === InventoryLedgerType.QC_ADJUSTMENT_SUB) {
        calcPhysical -= l.quantityGrams
      }
    }

    expect(calcPhysical).toBeGreaterThan(0)
  })

  // ==========================================================================
  // DEFENSE-IN-DEPTH: UNTRACKED PRODUCT & DEPLETED BATCH
  // ==========================================================================
  describe('Defense-in-Depth Server Guards', () => {
    it('SEC-01: Chặn điều chỉnh trên sản phẩm chưa bật quản lý kho (inventoryTrackingEnabled = false)', async () => {
      // Tạo lô trên sản phẩm untracked
      const untrackedBatch = await prisma.batch.create({
        data: {
          code: 'LO-UNTRACKED-001',
          productId: untrackedProductId,
          farmId,
          harvestDate: new Date(),
          quantityGrams: 0,
          status: BatchStatus.UNVERIFIED,
          isFefoEligible: false,
        },
      })

      const res = await adminAdjustStock({
        batchId: untrackedBatch.id,
        type: 'QC_ADJUSTMENT_ADD',
        quantityKg: 10,
        reason: 'Cố tình điều chỉnh sản phẩm không theo dõi kho',
        idempotencyKey: 'IDEMP:TEST:UNTRACKED:001',
      })

      expect(res.success).toBe(false)
      expect(res.error).toContain('chưa bật tính năng quản lý tồn kho')
    })

    it('SEC-02: Chặn điều chỉnh trên lô hàng đã DEPLETED', async () => {
      const depletedBatch = await prisma.batch.create({
        data: {
          code: 'LO-DEPLETED-001',
          productId: trackedProductId,
          farmId,
          harvestDate: new Date(),
          quantityGrams: 0,
          status: BatchStatus.DEPLETED,
          isFefoEligible: false,
        },
      })

      const res = await adminAdjustStock({
        batchId: depletedBatch.id,
        type: 'QC_ADJUSTMENT_ADD',
        quantityKg: 5,
        reason: 'Cố tình điều chỉnh lô đã cạn',
        idempotencyKey: 'IDEMP:TEST:DEPLETED:001',
      })

      expect(res.success).toBe(false)
      expect(res.error).toContain('DEPLETED')
    })

    it('SEC-03: Chặn điều chỉnh trên lô lịch sử QR (0 kg và 0 ledger)', async () => {
      const qrOnlyBatch = await prisma.batch.create({
        data: {
          code: 'LO-QR-HISTORICAL-001',
          productId: trackedProductId,
          farmId,
          harvestDate: new Date(),
          quantityGrams: 0,
          status: BatchStatus.UNVERIFIED,
          isFefoEligible: false,
        },
      })

      const res = await adminAdjustStock({
        batchId: qrOnlyBatch.id,
        type: 'QC_ADJUSTMENT_ADD',
        quantityKg: 5,
        reason: 'Cố tình điều chỉnh lô QR',
        idempotencyKey: 'IDEMP:TEST:QRONLY:001',
      })

      expect(res.success).toBe(false)
      expect(res.error).toContain('lô lịch sử chỉ phục vụ truy xuất QR')
    })
  })
})
