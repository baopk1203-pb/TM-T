import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import EmbeddedPostgres from 'embedded-postgres'
import * as path from 'path'
import * as fs from 'fs'
import { execSync } from 'child_process'
import { AsyncLocalStorage } from 'async_hooks'
import {
  ComplaintResolutionType,
  ComplaintStatus,
  OrderStatus,
  OrderType,
  PaymentOption,
  PrismaClient,
  Resolution,
  Role,
  SeasonStatus,
  TxMethod,
  TxStatus,
  TxType,
} from '@prisma/client'

import {
  respondToComplaintProposal,
  confirmRefundDone,
} from '@/actions/order-lifecycle'
import { processExpiredComplaintProposals } from '@/lib/services/complaint-sla'
import { isOrderEligibleForRevenue, getOrderEligibleRevenue } from '@/lib/domain/reports'
import { recordOrderEvent } from '@/lib/events'

// ============================================================================
// ASYNC LOCAL STORAGE & PROXY MOCK FOR REAL MULTI-CONNECTION CONCURRENCY
// ============================================================================
const asyncLocalStorage = new AsyncLocalStorage<PrismaClient>()

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(),
  requireAdmin: vi.fn(),
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
      const scopedClient = asyncLocalStorage.getStore()
      const p = (scopedClient || (globalThis as unknown as { prisma: Record<string | symbol, unknown> }).prisma) as Record<
        string | symbol,
        unknown
      >
      if (!p) throw new Error('Real PostgreSQL prisma client not yet initialized')
      const val = p[prop]
      if (typeof val === 'function') {
        return (val as (...args: unknown[]) => unknown).bind(p)
      }
      return val
    },
  }),
}))

// ============================================================================
// EMBEDDED POSTGRESQL 18.4 & FAIL-CLOSED GUARDS
// ============================================================================
const TEST_DB_PORT = 5438
const TEST_DB_NAME = 'evibe_f02_concurrency_test'
const TEST_DB_USER = 'test_f02_user'
const TEST_DB_PASS = 'test_f02_password123'
const TEST_DB_DIR = path.resolve(process.cwd(), '.test-pg-data-f02')
const TEST_DB_URL = `postgresql://${TEST_DB_USER}:${TEST_DB_PASS}@127.0.0.1:${TEST_DB_PORT}/${TEST_DB_NAME}?schema=public&sslmode=disable`

function assertSafeTestDatabase(url: string, expectedDbName: string) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('FAIL-CLOSED: Invalid database connection URL')
  }
  const allowedHosts = ['localhost', '127.0.0.1', '::1', '[::1]']
  if (!allowedHosts.includes(parsed.hostname)) {
    throw new Error(`FAIL-CLOSED: Host "${parsed.hostname}" is forbidden! Only loopback test databases are permitted.`)
  }
  const dbPath = parsed.pathname.replace(/^\//, '')
  if (dbPath !== expectedDbName || !dbPath.includes('f02')) {
    throw new Error(`FAIL-CLOSED: Database name "${dbPath}" does not match authorized F02 test database!`)
  }
  if (
    url.includes('neon.tech') ||
    url.includes('ep-square-scene') ||
    url.includes('ep-fancy-waterfall') ||
    url.includes('pooler.supabase')
  ) {
    throw new Error('FAIL-CLOSED: Remote/production host signature detected in test connection URL!')
  }
}

let pgCluster: InstanceType<typeof EmbeddedPostgres> | null = null
let prismaClient1: PrismaClient
let prismaClient2: PrismaClient

let adminUserId: string
let customerUserId: string
let defaultFarmId: string
let defaultProductId: string
let defaultPackagingId: string

describe('EV-F02-PG-CONCURRENCY-TEST-01 — Embedded PostgreSQL Concurrency & Financial Integrity (CON-01 to CON-06)', () => {
  beforeAll(async () => {
    // 1. Fail-closed guard check before touching any database
    assertSafeTestDatabase(TEST_DB_URL, TEST_DB_NAME)

    // 2. Clean previous test folder if it exists
    if (fs.existsSync(TEST_DB_DIR)) {
      try {
        fs.rmSync(TEST_DB_DIR, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }

    // 3. Initialize and start Embedded PostgreSQL cluster
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

    // 4. Push Prisma schema onto the isolated local test database
    const appDir = fs.existsSync(path.resolve(process.cwd(), 'prisma/schema.prisma'))
      ? process.cwd()
      : path.resolve(process.cwd(), 'nong-san-b2b')

    execSync('npx prisma db push --skip-generate --accept-data-loss', {
      cwd: appDir,
      env: {
        ...process.env,
        DATABASE_URL: TEST_DB_URL,
        DIRECT_URL: TEST_DB_URL,
      },
      stdio: 'pipe',
    })

    // 5. Initialize TWO independent PrismaClients with distinct connection pools
    prismaClient1 = new PrismaClient({
      datasources: { db: { url: TEST_DB_URL } },
    })
    prismaClient2 = new PrismaClient({
      datasources: { db: { url: TEST_DB_URL } },
    })

    await prismaClient1.$connect()
    await prismaClient2.$connect()
    ;(globalThis as unknown as { prisma: PrismaClient }).prisma = prismaClient1

    // 6. Seed Baseline Users and Catalog Fixtures
    const admin = await prismaClient1.user.create({
      data: {
        email: 'admin-f02-concur@nongsanb2b.vn',
        passwordHash: 'hashed_pw',
        fullName: 'Admin F02 Concurrency',
        phone: '0901111111',
        role: Role.ADMIN,
      },
    })
    adminUserId = admin.id

    const customer = await prismaClient1.user.create({
      data: {
        email: 'customer-f02-concur@nongsanb2b.vn',
        passwordHash: 'hashed_pw',
        fullName: 'Khách hàng F02 Concurrency',
        phone: '0902222222',
        role: Role.CUSTOMER,
      },
    })
    customerUserId = customer.id

    const farm = await prismaClient1.farm.create({
      data: {
        slug: 'farm-f02-concur',
        name: 'Nông trại F02 Concurrency',
        province: 'Tiền Giang',
        addressText: 'Xã Tân Phong, Huyện Cai Lậy',
        description: 'Vườn sầu riêng mẫu thử',
        lat: 10.35,
        lng: 106.12,
        images: [],
      },
    })
    defaultFarmId = farm.id

    const product = await prismaClient1.product.create({
      data: {
        slug: 'sau-rieng-f02-concur',
        name: 'Sầu Riêng Ri6 F02 Concur',
        description: 'Sầu riêng sạch xuất khẩu',
        farmId: defaultFarmId,
        moqGrams: 10000,
        leadTimeDays: 1,
        seasonStatus: SeasonStatus.HARVESTING,
        images: [],
      },
    })
    defaultProductId = product.id

    const packaging = await prismaClient1.packaging.create({
      data: {
        productId: defaultProductId,
        name: 'Thùng 10kg',
        weightGrams: 10000,
        isSample: false,
      },
    })
    defaultPackagingId = packaging.id
  }, 90_000)

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

  // ==========================================================================
  // HELPER FACTORIES
  // ==========================================================================
  function createMockSession(userId: string, role: Role = Role.CUSTOMER) {
    return {
      user: {
        id: userId,
        role,
        groupId: null,
        discountPercent: 0,
        email: `${userId}@nongsanb2b.vn`,
        name: `User ${userId}`,
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    }
  }

  async function createTestOrderWithComplaint(opts: {
    code: string
    orderStatus?: OrderStatus
    total?: number
    complaintStatus?: ComplaintStatus
    proposalType?: ComplaintResolutionType
    proposalAmount?: number
    proposedAt?: Date
    reviewDueAt?: Date
    reReviewCount?: number
    isFinalProposal?: boolean
  }) {
    const total = opts.total ?? 1000000
    const now = new Date()

    const order = await prismaClient1.order.create({
      data: {
        code: opts.code,
        userId: customerUserId,
        type: OrderType.STANDARD,
        status: opts.orderStatus ?? OrderStatus.DELIVERED,
        paymentOption: PaymentOption.FULL,
        groupDiscountPercent: 0,
        addressSnapshot: { street: '123 Test St', city: 'HCM' },
        subtotal: total,
        total,
        finalTotal: total,
        depositAmount: total,
        deliveredAt: new Date(now.getTime() - 2 * 3600 * 1000),
        items: {
          create: [
            {
              productId: defaultProductId,
              packagingId: defaultPackagingId,
              productName: 'Sầu Riêng Ri6 F02 Concur',
              packagingName: 'Thùng 10kg',
              isSample: false,
              quantity: 1,
              orderedGrams: 10000,
              unitPricePerKg: 100000,
              lineTotal: total,
            },
          ],
        },
        transactions: {
          create: [
            {
              type: TxType.PAYMENT,
              status: TxStatus.DONE,
              method: TxMethod.BANK_TRANSFER,
              amount: total,
              reference: `INIT_PAY_${opts.code}`,
              completedAt: new Date(now.getTime() - 3 * 3600 * 1000),
            },
          ],
        },
      },
      include: {
        items: true,
        transactions: true,
      },
    })

    const complaint = await prismaClient1.complaint.create({
      data: {
        orderId: order.id,
        orderItemId: order.items[0].id,
        description: 'Hàng dập nát khi nhận',
        photos: ['https://storage.example.com/photo1.jpg'],
        reportedGrams: 2000,
        status: opts.complaintStatus ?? ComplaintStatus.PROPOSED,
        proposalType: opts.proposalType ?? ComplaintResolutionType.REFUND_MONEY,
        proposalAmount: opts.proposalAmount ?? 200000,
        proposalNotes: 'Đề xuất bồi thường qua hoàn tiền ngân hàng',
        proposedAt: opts.proposedAt ?? now,
        reviewDueAt: opts.reviewDueAt ?? new Date(now.getTime() + 48 * 3600 * 1000),
        reReviewCount: opts.reReviewCount ?? 0,
        isFinalProposal: opts.isFinalProposal ?? false,
      },
    })

    return { order, complaint }
  }

  // ==========================================================================
  // CON-01: CONCURRENT ACCEPT
  // ==========================================================================
  it('CON-01 — Concurrent ACCEPT on same proposal: Exactly one succeeds, zero duplicate refund, revenue frozen', async () => {
    const { requireUser, getServerAuthSession } = await import('@/lib/auth')
    vi.mocked(requireUser).mockResolvedValue({
      id: customerUserId,
      role: Role.CUSTOMER,
      groupId: null,
      discountPercent: 0,
    })
    vi.mocked(getServerAuthSession).mockResolvedValue(createMockSession(customerUserId, Role.CUSTOMER))

    const { order, complaint } = await createTestOrderWithComplaint({
      code: 'DH-CON-01',
      proposalAmount: 200000,
      proposalType: ComplaintResolutionType.REFUND_MONEY,
    })

    // Execute concurrently across two independent PostgreSQL connections
    const [res1, res2] = await Promise.all([
      asyncLocalStorage.run(prismaClient1, () =>
        respondToComplaintProposal({
          complaintId: complaint.id,
          decision: 'ACCEPT',
        })
      ),
      asyncLocalStorage.run(prismaClient2, () =>
        respondToComplaintProposal({
          complaintId: complaint.id,
          decision: 'ACCEPT',
        })
      ),
    ])

    // Assertions on API Results
    const successCount = [res1.success, res2.success].filter(Boolean).length
    const failCount = [res1.success, res2.success].filter((s) => !s).length
    expect(successCount).toBe(1)
    expect(failCount).toBe(1)

    // Direct Database Assertions via real PostgreSQL
    const freshComplaint = await prismaClient1.complaint.findUnique({
      where: { id: complaint.id },
    })
    expect(freshComplaint?.status).toBe(ComplaintStatus.CUSTOMER_ACCEPTED)
    expect(freshComplaint?.resolution).toBe(Resolution.REFUND)
    expect(freshComplaint?.compensation).toBe(200000)

    const refunds = await prismaClient1.paymentTransaction.findMany({
      where: {
        orderId: order.id,
        type: TxType.REFUND,
        reference: `COMPLAINT_${complaint.id}`,
      },
    })
    expect(refunds).toHaveLength(1)
    expect(refunds[0].status).toBe(TxStatus.PENDING)
    expect(refunds[0].amount).toBe(200000)

    // Order status must NOT prematurely transition to COMPLETED while refund is PENDING
    const freshOrder = await prismaClient1.order.findUnique({
      where: { id: order.id },
      include: { complaints: true },
    })
    expect(freshOrder?.status).toBe(OrderStatus.DELIVERED)

    // Revenue freeze check (BR-04): revenue is strictly NOT eligible
    expect(isOrderEligibleForRevenue(freshOrder!)).toBe(false)
  })

  // ==========================================================================
  // CON-02: ACCEPT VS AUTO-WITHDRAW
  // ==========================================================================
  it('CON-02 — ACCEPT vs Auto-withdraw race condition: Exactly one final state committed, zero conflicting refund', async () => {
    const { getServerAuthSession } = await import('@/lib/auth')
    vi.mocked(getServerAuthSession).mockResolvedValue(createMockSession(customerUserId, Role.CUSTOMER))

    const targetDeadline = new Date(Date.now() - 1000) // already reached deadline
    const { order, complaint } = await createTestOrderWithComplaint({
      code: 'DH-CON-02',
      proposalAmount: 300000,
      proposalType: ComplaintResolutionType.REFUND_MONEY,
      reviewDueAt: targetDeadline,
    })

    const testNow = new Date()

    // Concurrently trigger Customer ACCEPT vs Cron SLA Auto-withdraw on separate clients
    const [acceptRes, autoWithdrawRes] = await Promise.all([
      asyncLocalStorage.run(prismaClient1, () =>
        respondToComplaintProposal({
          complaintId: complaint.id,
          decision: 'ACCEPT',
        })
      ),
      asyncLocalStorage.run(prismaClient2, () => processExpiredComplaintProposals(testNow)),
    ])

    expect(autoWithdrawRes).toBeDefined()

    // Direct Database Assertions
    const freshComplaint = await prismaClient1.complaint.findUnique({
      where: { id: complaint.id },
    })
    const refunds = await prismaClient1.paymentTransaction.findMany({
      where: {
        orderId: order.id,
        type: TxType.REFUND,
        reference: `COMPLAINT_${complaint.id}`,
      },
    })

    // Must be either CUSTOMER_ACCEPTED (with 1 refund) OR WITHDRAWN (with 0 refunds)
    if (freshComplaint?.status === ComplaintStatus.CUSTOMER_ACCEPTED) {
      expect(acceptRes.success).toBe(true)
      expect(freshComplaint.compensation).toBe(300000)
      expect(refunds).toHaveLength(1)
      expect(refunds[0].status).toBe(TxStatus.PENDING)
    } else {
      expect(freshComplaint?.status).toBe(ComplaintStatus.WITHDRAWN)
      expect(freshComplaint?.compensation).toBe(0)
      expect(refunds).toHaveLength(0) // Crucial: ZERO refunds created if auto-withdrawn
    }

    // Never contradictory
    expect([ComplaintStatus.CUSTOMER_ACCEPTED, ComplaintStatus.WITHDRAWN]).toContain(freshComplaint?.status)
  })

  // ==========================================================================
  // CON-03: REQUEST_REVIEW VS AUTO-WITHDRAW & MAX 1 RE-REVIEW
  // ==========================================================================
  it('CON-03 — REQUEST_REVIEW vs Auto-withdraw: Re-review strictly limited to max 1, zero conflicting state', async () => {
    const { getServerAuthSession } = await import('@/lib/auth')
    vi.mocked(getServerAuthSession).mockResolvedValue(createMockSession(customerUserId, Role.CUSTOMER))

    const targetDeadline = new Date(Date.now() - 500)
    const { complaint } = await createTestOrderWithComplaint({
      code: 'DH-CON-03',
      proposalAmount: 150000,
      reReviewCount: 0,
      reviewDueAt: targetDeadline,
    })

    const testNow = new Date()

    // Concurrent race: Customer requests review while auto-withdraw scans
    await Promise.all([
      asyncLocalStorage.run(prismaClient1, () =>
        respondToComplaintProposal({
          complaintId: complaint.id,
          decision: 'REQUEST_REVIEW',
          reason: 'Muốn xem xét lại tỷ lệ bồi thường',
        })
      ),
      asyncLocalStorage.run(prismaClient2, () => processExpiredComplaintProposals(testNow)),
    ])

    const freshComplaint = await prismaClient1.complaint.findUnique({
      where: { id: complaint.id },
    })

    // Re-review count can NEVER exceed 1
    expect(freshComplaint?.reReviewCount).toBeLessThanOrEqual(1)

    if (freshComplaint?.status === ComplaintStatus.UNDER_REVIEW) {
      expect(freshComplaint.reReviewCount).toBe(1)
      expect(freshComplaint.reReviewReason).toBe('Muốn xem xét lại tỷ lệ bồi thường')
    } else {
      expect(freshComplaint?.status).toBe(ComplaintStatus.WITHDRAWN)
      expect(freshComplaint?.compensation).toBe(0)
    }

    // Subsequent 2nd re-review attempt must be blocked by business rules and conditional update
    if (freshComplaint?.status === ComplaintStatus.UNDER_REVIEW) {
      // Simulate admin proposing 2nd offer with isFinalProposal = true
      await prismaClient1.complaint.update({
        where: { id: complaint.id },
        data: {
          status: ComplaintStatus.PROPOSED,
          isFinalProposal: true,
          reReviewCount: 1,
          reviewDueAt: new Date(Date.now() + 48 * 3600 * 1000),
        },
      })

      const secondReviewRes = await respondToComplaintProposal({
        complaintId: complaint.id,
        decision: 'REQUEST_REVIEW',
        reason: 'Xin phúc tra lần 2',
      })

      expect(secondReviewRes.success).toBe(false)
      expect(secondReviewRes.error).toContain('vượt quá số lần')

      const finalCheck = await prismaClient1.complaint.findUnique({
        where: { id: complaint.id },
      })
      expect(finalCheck?.reReviewCount).toBe(1)
    }
  })

  // ==========================================================================
  // CON-04: DUPLICATE REFUND PROTECTION (IDEMPOTENCY)
  // ==========================================================================
  it('CON-04 — Duplicate Refund Protection: Idempotent acceptance and retry guarantees exactly 1 refund record', async () => {
    const { getServerAuthSession } = await import('@/lib/auth')
    vi.mocked(getServerAuthSession).mockResolvedValue(createMockSession(customerUserId, Role.CUSTOMER))

    const { order, complaint } = await createTestOrderWithComplaint({
      code: 'DH-CON-04',
      proposalAmount: 250000,
      proposalType: ComplaintResolutionType.REFUND_MONEY,
    })

    // 1. First ACCEPT call
    const res1 = await asyncLocalStorage.run(prismaClient1, () =>
      respondToComplaintProposal({
        complaintId: complaint.id,
        decision: 'ACCEPT',
      })
    )
    expect(res1.success).toBe(true)

    // 2. Client retry: Send ACCEPT again (simulating network timeout retry)
    const res2 = await asyncLocalStorage.run(prismaClient2, () =>
      respondToComplaintProposal({
        complaintId: complaint.id,
        decision: 'ACCEPT',
      })
    )
    // Should be rejected gracefully because status is already CUSTOMER_ACCEPTED
    expect(res2.success).toBe(false)

    // 3. Database assertion: Exactly ONE refund transaction exists
    const refunds = await prismaClient1.paymentTransaction.findMany({
      where: {
        orderId: order.id,
        type: TxType.REFUND,
        reference: `COMPLAINT_${complaint.id}`,
      },
    })
    expect(refunds).toHaveLength(1)
    expect(refunds[0].amount).toBe(250000)
    expect(refunds[0].status).toBe(TxStatus.PENDING)
  })

  // ==========================================================================
  // CON-05: TRANSACTION ROLLBACK INTEGRITY
  // ==========================================================================
  it('CON-05 — Transaction Rollback: Mid-flight failure leaves zero dirty records in real PostgreSQL', async () => {
    const { order, complaint } = await createTestOrderWithComplaint({
      code: 'DH-CON-05',
      proposalAmount: 400000,
    })

    const initialComplaint = await prismaClient1.complaint.findUnique({
      where: { id: complaint.id },
    })
    const initialRefundCount = await prismaClient1.paymentTransaction.count({
      where: { orderId: order.id },
    })
    const initialEventCount = await prismaClient1.orderEvent.count({
      where: { orderId: order.id },
    })

    // Intentional failure inside database transaction
    await expect(
      prismaClient1.$transaction(async (tx) => {
        // Step 1: Update complaint
        await tx.complaint.update({
          where: { id: complaint.id },
          data: {
            status: ComplaintStatus.CUSTOMER_ACCEPTED,
            compensation: 400000,
          },
        })

        // Step 2: Insert refund transaction
        await tx.paymentTransaction.create({
          data: {
            orderId: order.id,
            type: TxType.REFUND,
            status: TxStatus.PENDING,
            method: TxMethod.BANK_TRANSFER,
            amount: 400000,
            reference: `COMPLAINT_${complaint.id}`,
          },
        })

        // Step 3: Record audit event
        await recordOrderEvent(tx, {
          orderId: order.id,
          type: 'COMPLAINT_ACCEPTED',
          note: 'Temporary audit event before rollback',
        })

        // Step 4: Intentional catastrophic abort
        throw new Error('SIMULATED_TRANSACTION_FAILURE_BEFORE_COMMIT')
      })
    ).rejects.toThrow('SIMULATED_TRANSACTION_FAILURE_BEFORE_COMMIT')

    // Verify complete all-or-nothing rollback in PostgreSQL
    const freshComplaint = await prismaClient1.complaint.findUnique({
      where: { id: complaint.id },
    })
    expect(freshComplaint?.status).toBe(initialComplaint?.status)
    expect(freshComplaint?.compensation).toBe(initialComplaint?.compensation)

    const freshRefundCount = await prismaClient1.paymentTransaction.count({
      where: { orderId: order.id },
    })
    expect(freshRefundCount).toBe(initialRefundCount)

    const freshEventCount = await prismaClient1.orderEvent.count({
      where: { orderId: order.id },
    })
    expect(freshEventCount).toBe(initialEventCount)
  })

  // ==========================================================================
  // CON-06: CONCURRENT CRON EXECUTION
  // ==========================================================================
  it('CON-06 — Concurrent Cron Execution: Multiple workers process expired batch with zero duplicate operations', async () => {
    const expiredTime = new Date(Date.now() - 3600 * 1000)

    // Seed 3 expired complaints across 3 distinct orders
    const batchOrders = await Promise.all([
      createTestOrderWithComplaint({ code: 'DH-CRON-01', reviewDueAt: expiredTime }),
      createTestOrderWithComplaint({ code: 'DH-CRON-02', reviewDueAt: expiredTime }),
      createTestOrderWithComplaint({ code: 'DH-CRON-03', reviewDueAt: expiredTime }),
    ])

    const now = new Date()

    // Concurrently trigger 2 SLA worker instances on distinct PostgreSQL clients
    const [worker1Res, worker2Res] = await Promise.all([
      asyncLocalStorage.run(prismaClient1, () => processExpiredComplaintProposals(now)),
      asyncLocalStorage.run(prismaClient2, () => processExpiredComplaintProposals(now)),
    ])

    // Total complaints processed across both workers must exactly equal 3
    const totalProcessed = worker1Res.processedCount + worker2Res.processedCount
    expect(totalProcessed).toBe(3)

    // No overlaps in processed IDs
    const unionIds = new Set([...worker1Res.complaintIds, ...worker2Res.complaintIds])
    expect(unionIds.size).toBe(3)

    // Database state assertions: All 3 complaints are WITHDRAWN with 0 compensation
    const batchComplaintIds = batchOrders.map((b) => b.complaint.id)
    const freshComplaints = await prismaClient1.complaint.findMany({
      where: { id: { in: batchComplaintIds } },
    })

    expect(freshComplaints).toHaveLength(3)
    for (const c of freshComplaints) {
      expect(c.status).toBe(ComplaintStatus.WITHDRAWN)
      expect(c.compensation).toBe(0)
      expect(c.autoClosedAt).not.toBeNull()
    }

    // Zero refund records created for any of the 3 auto-withdrawn complaints
    const refundCount = await prismaClient1.paymentTransaction.count({
      where: {
        orderId: { in: batchOrders.map((b) => b.order.id) },
        type: TxType.REFUND,
      },
    })
    expect(refundCount).toBe(0)

    // Audit events: Exactly 3 COMPLAINT_AUTO_WITHDRAWN events
    const eventCount = await prismaClient1.orderEvent.count({
      where: {
        orderId: { in: batchOrders.map((b) => b.order.id) },
        type: 'COMPLAINT_AUTO_WITHDRAWN',
      },
    })
    expect(eventCount).toBe(3)

    // Orders without active complaints or refunds transition safely to COMPLETED
    const freshOrders = await prismaClient1.order.findMany({
      where: { id: { in: batchOrders.map((b) => b.order.id) } },
    })
    for (const o of freshOrders) {
      expect(o.status).toBe(OrderStatus.COMPLETED)
      // Revenue is eligible now that orders are completed without active complaints
      expect(isOrderEligibleForRevenue(o)).toBe(true)
    }
  })

  // ==========================================================================
  // FINANCIAL SAFETY & CONFIRM REFUND FLOW
  // ==========================================================================
  it('Financial Safety — Revenue release only after confirmRefundDone confirms settlement', async () => {
    const { requireAdmin } = await import('@/lib/auth')
    vi.mocked(requireAdmin).mockResolvedValue({
      id: adminUserId,
      role: Role.ADMIN,
      groupId: null,
      discountPercent: 0,
    })

    const { order, complaint } = await createTestOrderWithComplaint({
      code: 'DH-FIN-SAFETY',
      proposalAmount: 200000,
    })

    // Simulate customer accepted with refund transaction created
    await prismaClient1.complaint.update({
      where: { id: complaint.id },
      data: {
        status: ComplaintStatus.CUSTOMER_ACCEPTED,
        resolution: Resolution.REFUND,
        compensation: 200000,
      },
    })

    const refundTx = await prismaClient1.paymentTransaction.create({
      data: {
        orderId: order.id,
        type: TxType.REFUND,
        status: TxStatus.PENDING,
        method: TxMethod.BANK_TRANSFER,
        amount: 200000,
        reference: `COMPLAINT_${complaint.id}`,
      },
    })

    // 1. While refund is PENDING, order is not eligible for revenue
    const orderBeforeConfirm = await prismaClient1.order.findUnique({
      where: { id: order.id },
      include: { complaints: true },
    })
    expect(isOrderEligibleForRevenue(orderBeforeConfirm!)).toBe(false)

    // 2. Admin performs manual bank transfer and calls confirmRefundDone
    const confirmRes = await confirmRefundDone({
      transactionId: refundTx.id,
    })
    expect(confirmRes.success).toBe(true)

    // 3. Database assertion: refund is DONE and Order transitions to COMPLETED
    const refundAfterConfirm = await prismaClient1.paymentTransaction.findUnique({
      where: { id: refundTx.id },
    })
    expect(refundAfterConfirm?.status).toBe(TxStatus.DONE)

    const orderAfterConfirm = await prismaClient1.order.findUnique({
      where: { id: order.id },
      include: { complaints: true },
    })
    expect(orderAfterConfirm?.status).toBe(OrderStatus.COMPLETED)

    // 4. Revenue eligible calculation: 1,000,000 - 200,000 = 800,000 đ
    expect(isOrderEligibleForRevenue(orderAfterConfirm!)).toBe(true)
    const netRevenue = getOrderEligibleRevenue(orderAfterConfirm!)
    expect(netRevenue).toBe(800000)
  })
})
