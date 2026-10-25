import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  AllocationStatus,
  BatchStatus,
  InventoryLedgerType,
  OrderStatus,
  OrderType,
  PaymentOption,
  Role,
  TimeSlot,
  TxMethod,
  TxStatus,
  TxType,
} from '@prisma/client'
import {
  calculateStockFromLedger,
  computeOrderPaymentDueAt,
  isOrderPaymentExpired,
  RESERVATION_TIMEOUT_MS,
} from '@/lib/domain/inventory'
import {
  confirmOrderInventoryAllocations,
  expireOverdueOrderInTx,
  releaseOrderInventoryAllocations,
  reserveOrderInventoryFefo,
  ReservationTxClient,
} from '@/lib/services/inventory-reservation'
import { placeOrder } from '@/actions/order'
import { confirmPayment } from '@/actions/admin-order'
import { cancelOrder } from '@/actions/order-lifecycle'
import { processExpiredOrders } from '@/lib/services/order-expiration'
import {
  executePrepareF01CDemoBatches,
  F01C_DEMO_BATCH_SPECS,
  HISTORICAL_UNVERIFIED_BATCH_CODES,
  verifyDemoScriptSafetyGates,
  DemoBatchStorageAdapter,
} from '../../scripts/prepare-f01c-demo-batches'
import { db } from '@/lib/db'
import { getServerAuthSession, requireAdmin, requireUser } from '@/lib/auth'

vi.mock('@/lib/db', () => ({
  db: {
    $transaction: vi.fn(),
    order: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(),
  requireAdmin: vi.fn(),
  getServerAuthSession: vi.fn(),
}))

vi.mock('@/lib/events', () => ({
  recordOrderEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/email', () => ({
  sendOrderNotification: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/services/shipping-config', () => ({
  createDynamicShippingCalculator: () => ({
    quote: vi.fn().mockResolvedValue({
      allowed: true,
      fee: 0,
      distanceKm: 10,
      vehicleType: 'STANDARD',
    }),
  }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

/**
 * Bộ mô phỏng kho dữ liệu trong bộ nhớ (In-memory Stateful Ledger & Allocation Store)
 * Dùng để kiểm chứng tính nguyên tử, khóa tuần tự chống overselling và tính bất biến của sổ cái.
 */
function createInMemoryInventoryState() {
  const batches = [
    {
      id: 'batch-hist-qr',
      code: 'LO-261013-001',
      productId: 'prod-ri6',
      farmId: 'farm-1',
      harvestDate: new Date('2026-10-13T00:00:00.000Z'),
      expiryDate: null,
      quantityGrams: 5000000, // Lô lịch sử 5 tấn chỉ dùng QR, KHÔNG được phép cấp phát FEFO
      status: BatchStatus.UNVERIFIED,
      isFefoEligible: false,
    },
    {
      id: 'batch-fefo-early',
      code: 'LO-RI6-FEFO-01',
      productId: 'prod-ri6',
      farmId: 'farm-1',
      harvestDate: new Date('2026-10-20T00:00:00.000Z'),
      expiryDate: new Date('2026-10-28T00:00:00.000Z'), // Hết hạn sớm hơn (28/10)
      quantityGrams: 40000,
      status: BatchStatus.ACTIVE,
      isFefoEligible: true,
    },
    {
      id: 'batch-fefo-later',
      code: 'LO-RI6-FEFO-02',
      productId: 'prod-ri6',
      farmId: 'farm-1',
      harvestDate: new Date('2026-10-22T00:00:00.000Z'),
      expiryDate: new Date('2026-11-05T00:00:00.000Z'), // Hết hạn muộn hơn (05/11)
      quantityGrams: 60000,
      status: BatchStatus.ACTIVE,
      isFefoEligible: true,
    },
  ]

  const ledgerEntries: Array<{
    id: string
    batchId: string
    orderId: string | null
    orderItemId: string | null
    type: InventoryLedgerType
    quantityGrams: number
    idempotencyKey: string | null
    referenceCode: string | null
  }> = [
    // Tồn kho thực nhập ban đầu: Lô 01 có 40kg, Lô 02 có 60kg (Tổng khả dụng = 100kg)
    {
      id: 'led-imp-1',
      batchId: 'batch-fefo-early',
      orderId: null,
      orderItemId: null,
      type: InventoryLedgerType.IMPORT,
      quantityGrams: 40000,
      idempotencyKey: 'INIT:IMPORT:batch-fefo-early',
      referenceCode: 'PNK-DEMO-01',
    },
    {
      id: 'led-imp-2',
      batchId: 'batch-fefo-later',
      orderId: null,
      orderItemId: null,
      type: InventoryLedgerType.IMPORT,
      quantityGrams: 60000,
      idempotencyKey: 'INIT:IMPORT:batch-fefo-later',
      referenceCode: 'PNK-DEMO-02',
    },
  ]

  const allocations: Array<{
    id: string
    orderItemId: string
    orderId: string
    batchId: string
    allocatedGrams: number
    dispatchedGrams: number
    releasedGrams: number
    status: AllocationStatus
    holdExpiresAt: Date | null
    releasedAt: Date | null
    idempotencyKey: string | null
  }> = []

  const orders: Array<{
    id: string
    code: string
    status: OrderStatus
    type: OrderType
    paymentOption: PaymentOption
    total: number
    depositAmount: number
    paymentDueAt: Date | null
    cancelledBy?: string | null
    cancelReason?: string | null
    items: Array<{
      id: string
      orderId: string
      productId: string
      productName: string
      orderedGrams: number
    }>
    transactions: Array<{
      id: string
      type: TxType
      status: TxStatus
      amount: number
      reference?: string | null
    }>
  }> = []

  function buildTxClient(): ReservationTxClient {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      batch: {
        findMany: vi.fn().mockImplementation(async ({ where }: { where?: { productId?: { in?: string[] } } }) => {
          const targetIds = where?.productId?.in
          return batches
            .filter((b) => (!targetIds ? true : targetIds.includes(b.productId)))
            .map((b) => ({
              ...b,
              ledgerEntries: ledgerEntries
                .filter((l) => l.batchId === b.id)
                .map((l) => ({ type: l.type, quantityGrams: l.quantityGrams })),
            }))
        }),
      },
      orderItemBatchAllocation: {
        create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          const idempotencyKey = (data.idempotencyKey as string) || null
          if (idempotencyKey && allocations.some((a) => a.idempotencyKey === idempotencyKey)) {
            throw new Error(`Unique constraint failed on idempotencyKey: ${idempotencyKey}`)
          }
          // Tìm orderId từ orderItemId
          const ownerOrder = orders.find((o) => o.items.some((i) => i.id === data.orderItemId))
          const record = {
            id: `alloc-${allocations.length + 1}`,
            orderItemId: data.orderItemId as string,
            orderId: ownerOrder?.id ?? 'order-unknown',
            batchId: data.batchId as string,
            allocatedGrams: data.allocatedGrams as number,
            dispatchedGrams: (data.dispatchedGrams as number) ?? 0,
            releasedGrams: (data.releasedGrams as number) ?? 0,
            status: (data.status as AllocationStatus) ?? AllocationStatus.HOLD_PENDING,
            holdExpiresAt: (data.holdExpiresAt as Date | null) ?? null,
            releasedAt: null,
            idempotencyKey,
          }
          allocations.push(record)
          return record
        }),
        findMany: vi.fn().mockImplementation(
          async ({
            where,
          }: {
            where?: {
              orderItem?: { orderId?: string }
              status?: { in?: AllocationStatus[] }
            }
          }) => {
            return allocations
              .filter((a) => {
                if (where?.orderItem?.orderId && a.orderId !== where.orderItem.orderId) {
                  return false
                }
                if (where?.status?.in && !where.status.in.includes(a.status)) {
                  return false
                }
                return true
              })
              .map((a) => ({ ...a }))
          }
        ),
        updateMany: vi.fn().mockImplementation(
          async ({
            where,
            data,
          }: {
            where: {
              id?: string
              orderItem?: { orderId?: string }
              status?: AllocationStatus
              releasedGrams?: number
            }
            data: Partial<{
              releasedGrams: number
              status: AllocationStatus
              releasedAt: Date | null
              holdExpiresAt: Date | null
            }>
          }) => {
            let count = 0
            for (const alloc of allocations) {
              if (where.id && alloc.id !== where.id) continue
              if (where.orderItem?.orderId && alloc.orderId !== where.orderItem.orderId) continue
              if (where.status && alloc.status !== where.status) continue
              if (where.releasedGrams !== undefined && alloc.releasedGrams !== where.releasedGrams) continue

              if (data.releasedGrams !== undefined) alloc.releasedGrams = data.releasedGrams
              if (data.status !== undefined) alloc.status = data.status
              if (data.releasedAt !== undefined) alloc.releasedAt = data.releasedAt
              if (data.holdExpiresAt !== undefined) alloc.holdExpiresAt = data.holdExpiresAt
              count++
            }
            return { count }
          }
        ),
      },
      inventoryLedger: {
        create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          const idempotencyKey = (data.idempotencyKey as string) || null
          if (idempotencyKey && ledgerEntries.some((l) => l.idempotencyKey === idempotencyKey)) {
            throw new Error(`Unique constraint failed on InventoryLedger.idempotencyKey: ${idempotencyKey}`)
          }
          const entry = {
            id: `led-${ledgerEntries.length + 1}`,
            batchId: data.batchId as string,
            orderId: (data.orderId as string) ?? null,
            orderItemId: (data.orderItemId as string) ?? null,
            type: data.type as InventoryLedgerType,
            quantityGrams: data.quantityGrams as number,
            idempotencyKey,
            referenceCode: (data.referenceCode as string) ?? null,
          }
          ledgerEntries.push(entry)
          return entry
        }),
      },
      order: {
        findMany: vi.fn().mockImplementation(
          async ({
            where,
          }: {
            where?: {
              status?: OrderStatus
              paymentDueAt?: { lt?: Date }
              items?: { some?: { productId?: { in?: string[] } } }
            }
          }) => {
            return orders.filter((o) => {
              if (where?.status && o.status !== where.status) return false
              if (where?.paymentDueAt?.lt && (!o.paymentDueAt || o.paymentDueAt >= where.paymentDueAt.lt)) {
                return false
              }
              const prodIds = where?.items?.some?.productId?.in
              if (prodIds && !o.items.some((i) => prodIds.includes(i.productId))) {
                return false
              }
              return true
            })
          }
        ),
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id?: string; code?: string } }) => {
          return orders.find((o) => (where.id ? o.id === where.id : o.code === where.code)) ?? null
        }),
        update: vi.fn().mockImplementation(
          async ({
            where,
            data,
          }: {
            where: { id: string }
            data: Partial<{ status: OrderStatus; cancelledBy: string; cancelReason: string }>
          }) => {
            const ord = orders.find((o) => o.id === where.id)
            if (ord) {
              if (data.status) ord.status = data.status
              if (data.cancelledBy) ord.cancelledBy = data.cancelledBy
              if (data.cancelReason) ord.cancelReason = data.cancelReason
            }
            return ord
          }
        ),
        updateMany: vi.fn().mockImplementation(
          async ({
            where,
            data,
          }: {
            where: { id: string; status?: OrderStatus }
            data: Partial<{ status: OrderStatus; cancelledBy: string; cancelReason: string }>
          }) => {
            const ord = orders.find((o) => o.id === where.id)
            if (!ord || (where.status && ord.status !== where.status)) {
              return { count: 0 }
            }
            if (data.status) ord.status = data.status
            if (data.cancelledBy) ord.cancelledBy = data.cancelledBy
            if (data.cancelReason) ord.cancelReason = data.cancelReason
            return { count: 1 }
          }
        ),
      },
      shipment: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      paymentTransaction: {
        create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          const ord = orders.find((o) => o.id === data.orderId)
          const txRecord = {
            id: `tx-${Date.now()}-${Math.random()}`,
            type: data.type as TxType,
            status: data.status as TxStatus,
            amount: data.amount as number,
            reference: (data.reference as string | null) ?? null,
          }
          if (ord) {
            ord.transactions.push(txRecord)
          }
          return txRecord
        }),
      },
    }

    return tx as unknown as ReservationTxClient
  }

  function getBatchStock(batchId: string) {
    const entries = ledgerEntries
      .filter((l) => l.batchId === batchId)
      .map((l) => ({ type: l.type, quantityGrams: l.quantityGrams }))
    return calculateStockFromLedger(entries)
  }

  return {
    batches,
    ledgerEntries,
    allocations,
    orders,
    buildTxClient,
    getBatchStock,
  }
}

describe('EV-IMP-01C: Checkout FEFO Reservation & 10-Minute Payment Timeout', () => {
  const fixedNow = new Date('2026-10-25T10:00:00.000Z')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1. Đủ tồn -> Giữ hàng FEFO thành công qua nhiều lô, đặt đúng paymentDueAt = createdAt + 10 phút và bảo toàn lô lịch sử QR', async () => {
    const state = createInMemoryInventoryState()
    const tx = state.buildTxClient()

    const paymentDueAt = computeOrderPaymentDueAt(fixedNow)
    expect(paymentDueAt.getTime() - fixedNow.getTime()).toBe(RESERVATION_TIMEOUT_MS)
    expect(paymentDueAt.toISOString()).toBe('2026-10-25T10:10:00.000Z')

    state.orders.push({
      id: 'order-1',
      code: 'DH-261025-0001',
      status: OrderStatus.PENDING_CONFIRMATION,
      type: OrderType.STANDARD,
      paymentOption: PaymentOption.DEPOSIT_30,
      total: 8000000,
      depositAmount: 2400000,
      paymentDueAt,
      items: [
        {
          id: 'item-1',
          orderId: 'order-1',
          productId: 'prod-ri6',
          productName: 'Sầu Riêng Ri6 Cai Lậy',
          orderedGrams: 70000, // Đặt 70 kg: cần bốc 40kg từ lô sớm (28/10) + 30kg từ lô muộn (05/11)
        },
      ],
      transactions: [],
    })

    const res = await reserveOrderInventoryFefo(tx, {
      orderId: 'order-1',
      orderCode: 'DH-261025-0001',
      userId: 'user-1',
      items: state.orders[0].items,
      products: [{ id: 'prod-ri6', name: 'Sầu Riêng Ri6 Cai Lậy', inventoryTrackingEnabled: true }],
      holdExpiresAt: paymentDueAt,
      now: fixedNow,
    })

    expect(res.reserved).toBe(true)
    expect(res.allocations).toHaveLength(2)

    // Lô 1 (hết hạn 28/10) được bốc hết 40kg trước
    expect(res.allocations[0]).toEqual({
      orderItemId: 'item-1',
      batchId: 'batch-fefo-early',
      batchCode: 'LO-RI6-FEFO-01',
      allocatedGrams: 40000,
    })
    // Lô 2 (hết hạn 05/11) được bốc tiếp 30kg còn thiếu
    expect(res.allocations[1]).toEqual({
      orderItemId: 'item-1',
      batchId: 'batch-fefo-later',
      batchCode: 'LO-RI6-FEFO-02',
      allocatedGrams: 30000,
    })

    // Kiểm tra sổ cái InventoryLedger
    const stockEarly = state.getBatchStock('batch-fefo-early')
    expect(stockEarly.physicalStockGrams).toBe(40000)
    expect(stockEarly.reservedGrams).toBe(40000)
    expect(stockEarly.availableGrams).toBe(0)

    const stockLater = state.getBatchStock('batch-fefo-later')
    expect(stockLater.physicalStockGrams).toBe(60000)
    expect(stockLater.reservedGrams).toBe(30000)
    expect(stockLater.availableGrams).toBe(30000)

    // Lô lịch sử UNVERIFIED (LO-261013-001) tuyệt đối không bị đụng tới
    expect(state.allocations.some((a) => a.batchId === 'batch-hist-qr')).toBe(false)
    expect(state.batches.find((b) => b.id === 'batch-hist-qr')?.quantityGrams).toBe(5000000)
  })

  it('2. Thiếu tồn -> Từ chối đặt hàng (placeOrder trả về success: false) khi yêu cầu vượt tồn khả dụng FEFO', async () => {
    const state = createInMemoryInventoryState()

    vi.mocked(requireUser).mockResolvedValue({
      id: 'user-1',
      email: 'buyer@example.com',
      role: Role.CUSTOMER,
      name: 'Khách Sỉ A',
      groupId: null,
      discountPercent: 0,
      companyName: 'Công ty A',
      phone: '0901234567',
    })

    vi.mocked(db.$transaction).mockImplementation(async (callback) => {
      const baseTx = state.buildTxClient()
      const fullTx = {
        ...baseTx,
        user: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'user-1',
            fullName: 'Khách Sỉ A',
            group: null,
          }),
        },
        address: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'addr-1',
            userId: 'user-1',
            label: 'Kho Quận 1',
            recipient: 'Khách Sỉ A',
            phone: '0901234567',
            line: '123 Lê Lợi',
            ward: 'Bến Nghé',
            district: 'Quận 1',
            province: 'TP. Hồ Chí Minh',
            lat: 10.77,
            lng: 106.7,
          }),
        },
        product: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'prod-ri6',
              name: 'Sầu Riêng Ri6 Cai Lậy',
              moqGrams: 50000,
              leadTimeDays: 1,
              requiresCold: false,
              isActive: true,
              inventoryTrackingEnabled: true,
              priceTiers: [{ id: 'tier-1', minGrams: 50000, pricePerKg: 120000 }],
              packagings: [
                {
                  id: 'pkg-20kg',
                  name: 'Rổ nhựa 20kg',
                  weightGrams: 20000,
                  isSample: false,
                  samplePrice: null,
                  isActive: true,
                },
              ],
            },
          ]),
        },
        weeklyCapacity: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
        order: {
          ...baseTx.order,
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
            id: 'order-shortage',
            code: data.code as string,
            items: [
              {
                id: 'item-shortage-1',
                productId: 'prod-ri6',
                productName: 'Sầu Riêng Ri6 Cai Lậy',
                orderedGrams: 120000, // Yêu cầu 120 kg trong khi tổng FEFO chỉ có 100 kg
              },
            ],
          })),
        },
      }
      return await (callback as unknown as (tx: typeof fullTx) => unknown)(fullTx)
    })

    // Ngày giao hợp lệ (sau 5 ngày)
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    const deliveryDateStr = futureDate.toISOString().slice(0, 10)

    const result = await placeOrder({
      lines: [
        {
          productId: 'prod-ri6',
          packagingId: 'pkg-20kg',
          quantity: 6, // 6 rổ 20kg = 120 kg > 100 kg khả dụng
        },
      ],
      addressId: 'addr-1',
      deliveryDate: deliveryDateStr,
      timeSlot: TimeSlot.MORNING,
      paymentOption: PaymentOption.DEPOSIT_30,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Không đủ hàng khả dụng theo FEFO')
    // Không có bất kỳ dòng giữ chỗ nào được ghi vào sổ cái
    expect(state.allocations).toHaveLength(0)
    expect(state.ledgerEntries.filter((l) => l.type === InventoryLedgerType.RESERVATION_HOLD)).toHaveLength(0)
  })

  it('3. Hai đơn cạnh tranh cùng một lượng tồn -> Không overselling, không double reservation', async () => {
    const state = createInMemoryInventoryState()
    const tx = state.buildTxClient()
    const paymentDueAt = computeOrderPaymentDueAt(fixedNow)

    // Tổng khả dụng của prod-ri6 là 100kg (40kg + 60kg).
    // Đơn A đặt 60kg, Đơn B cũng đặt 60kg cùng lúc.
    state.orders.push(
      {
        id: 'order-a',
        code: 'DH-RACE-A',
        status: OrderStatus.PENDING_CONFIRMATION,
        type: OrderType.STANDARD,
        paymentOption: PaymentOption.FULL,
        total: 7200000,
        depositAmount: 2160000,
        paymentDueAt,
        items: [
          {
            id: 'item-race-a',
            orderId: 'order-a',
            productId: 'prod-ri6',
            productName: 'Sầu Riêng Ri6 Cai Lậy',
            orderedGrams: 60000,
          },
        ],
        transactions: [],
      },
      {
        id: 'order-b',
        code: 'DH-RACE-B',
        status: OrderStatus.PENDING_CONFIRMATION,
        type: OrderType.STANDARD,
        paymentOption: PaymentOption.FULL,
        total: 7200000,
        depositAmount: 2160000,
        paymentDueAt,
        items: [
          {
            id: 'item-race-b',
            orderId: 'order-b',
            productId: 'prod-ri6',
            productName: 'Sầu Riêng Ri6 Cai Lậy',
            orderedGrams: 60000,
          },
        ],
        transactions: [],
      }
    )

    // Đơn A chiếm khóa FOR UPDATE trước -> Giữ thành công 60kg (40kg lô 1 + 20kg lô 2), chỉ còn lại 40kg khả dụng
    const resA = await reserveOrderInventoryFefo(tx, {
      orderId: 'order-a',
      orderCode: 'DH-RACE-A',
      userId: 'user-a',
      items: state.orders[0].items,
      products: [{ id: 'prod-ri6', name: 'Sầu Riêng Ri6 Cai Lậy', inventoryTrackingEnabled: true }],
      holdExpiresAt: paymentDueAt,
      now: fixedNow,
    })
    expect(resA.reserved).toBe(true)

    // Đơn B vào ngay sau khi khóa giải phóng -> Yêu cầu 60kg nhưng chỉ còn 40kg -> Bị từ chối!
    await expect(
      reserveOrderInventoryFefo(tx, {
        orderId: 'order-b',
        orderCode: 'DH-RACE-B',
        userId: 'user-b',
        items: state.orders[1].items,
        products: [{ id: 'prod-ri6', name: 'Sầu Riêng Ri6 Cai Lậy', inventoryTrackingEnabled: true }],
        holdExpiresAt: paymentDueAt,
        now: fixedNow,
      })
    ).rejects.toThrow(/Không đủ hàng khả dụng theo FEFO/)

    // Tổng lượng giữ chỗ trên toàn kho đúng bằng 60kg của Đơn A, không bao giờ vượt 100kg
    const totalHoldGrams = state.ledgerEntries
      .filter((l) => l.type === InventoryLedgerType.RESERVATION_HOLD)
      .reduce((s, l) => s + l.quantityGrams, 0)
    expect(totalHoldGrams).toBe(60000)
  })

  it('4. Thanh toán được xác nhận trước hạn 10 phút -> Chuyển đơn sang PROCESSING và giữ phân bổ ALLOCATED_CONFIRMED', async () => {
    const state = createInMemoryInventoryState()
    const tx = state.buildTxClient()
    const paymentDueAt = computeOrderPaymentDueAt(new Date()) // Còn hạn 10 phút kể từ hiện tại

    state.orders.push({
      id: 'order-valid-pay',
      code: 'DH-VALID-PAY',
      status: OrderStatus.PENDING_CONFIRMATION,
      type: OrderType.STANDARD,
      paymentOption: PaymentOption.DEPOSIT_30,
      total: 6000000,
      depositAmount: 1800000,
      paymentDueAt,
      items: [
        {
          id: 'item-valid-pay',
          orderId: 'order-valid-pay',
          productId: 'prod-ri6',
          productName: 'Sầu Riêng Ri6 Cai Lậy',
          orderedGrams: 50000,
        },
      ],
      transactions: [],
    })

    await reserveOrderInventoryFefo(tx, {
      orderId: 'order-valid-pay',
      orderCode: 'DH-VALID-PAY',
      userId: 'user-1',
      items: state.orders[0].items,
      products: [{ id: 'prod-ri6', name: 'Sầu Riêng Ri6 Cai Lậy', inventoryTrackingEnabled: true }],
      holdExpiresAt: paymentDueAt,
      now: fixedNow,
    })

    expect(state.allocations.every((a) => a.status === AllocationStatus.HOLD_PENDING)).toBe(true)

    vi.mocked(requireAdmin).mockResolvedValue({
      id: 'admin-1',
      email: 'admin@evibe.vn',
      role: Role.ADMIN,
      name: 'Admin',
      groupId: null,
      discountPercent: 0,
      companyName: null,
      phone: '0900000000',
    })

    vi.mocked(db.$transaction).mockImplementation(async (callback) => {
      return await (callback as unknown as (t: ReservationTxClient) => unknown)(tx)
    })

    const confirmRes = await confirmPayment({
      orderId: 'order-valid-pay',
      amount: 1800000,
      method: TxMethod.BANK_TRANSFER,
      reference: 'FT-BEFORE-10MIN',
    })

    expect(confirmRes.success).toBe(true)
    expect(state.orders[0].status).toBe(OrderStatus.PROCESSING)
    // Toàn bộ phân bổ của đơn chuyển sang ALLOCATED_CONFIRMED và xóa holdExpiresAt
    expect(state.allocations.every((a) => a.status === AllocationStatus.ALLOCATED_CONFIRMED)).toBe(true)
    expect(state.allocations.every((a) => a.holdExpiresAt === null)).toBe(true)
  })

  it('5. Quá 10 phút -> Từ chối Admin xác nhận thanh toán, tự động hủy đơn và giải phóng giữ chỗ đúng 1 lần', async () => {
    const state = createInMemoryInventoryState()
    const tx = state.buildTxClient()

    // Đơn tạo trước đây 15 phút -> paymentDueAt đã quá hạn 5 phút
    const createdAt = new Date(Date.now() - 15 * 60 * 1000)
    const expiredDueAt = computeOrderPaymentDueAt(createdAt)

    state.orders.push({
      id: 'order-overdue',
      code: 'DH-OVERDUE-10M',
      status: OrderStatus.PENDING_CONFIRMATION,
      type: OrderType.STANDARD,
      paymentOption: PaymentOption.DEPOSIT_30,
      total: 6000000,
      depositAmount: 1800000,
      paymentDueAt: expiredDueAt,
      items: [
        {
          id: 'item-overdue',
          orderId: 'order-overdue',
          productId: 'prod-ri6',
          productName: 'Sầu Riêng Ri6 Cai Lậy',
          orderedGrams: 50000,
        },
      ],
      transactions: [],
    })

    await reserveOrderInventoryFefo(tx, {
      orderId: 'order-overdue',
      orderCode: 'DH-OVERDUE-10M',
      userId: 'user-1',
      items: state.orders[0].items,
      products: [{ id: 'prod-ri6', name: 'Sầu Riêng Ri6 Cai Lậy', inventoryTrackingEnabled: true }],
      holdExpiresAt: expiredDueAt,
      now: createdAt,
    })

    // Trước khi hết hạn: 40kg lô 1 + 10kg lô 2 đang bị giữ
    expect(state.getBatchStock('batch-fefo-early').availableGrams).toBe(0)
    expect(state.getBatchStock('batch-fefo-later').availableGrams).toBe(50000)

    vi.mocked(requireAdmin).mockResolvedValue({
      id: 'admin-1',
      email: 'admin@evibe.vn',
      role: Role.ADMIN,
      name: 'Admin',
      groupId: null,
      discountPercent: 0,
      companyName: null,
      phone: '0900000000',
    })

    vi.mocked(db.$transaction).mockImplementation(async (callback) => {
      return await (callback as unknown as (t: ReservationTxClient) => unknown)(tx)
    })

    // Admin cố bấm xác nhận thanh toán khi đơn đã quá 10 phút
    const confirmRes = await confirmPayment({
      orderId: 'order-overdue',
      amount: 1800000,
      method: TxMethod.BANK_TRANSFER,
      reference: 'FT-TOO-LATE',
    })

    expect(confirmRes.success).toBe(false)
    expect(confirmRes.error).toContain('quá thời hạn giữ chỗ thanh toán (10 phút)')

    // Đơn đã chuyển sang CANCELLED và tồn kho của cả 2 lô đã được khôi phục 100%
    expect(state.orders[0].status).toBe(OrderStatus.CANCELLED)
    expect(state.allocations.every((a) => a.status === AllocationStatus.RELEASED)).toBe(true)
    expect(state.getBatchStock('batch-fefo-early').availableGrams).toBe(40000)
    expect(state.getBatchStock('batch-fefo-later').availableGrams).toBe(60000)
  })

  it('6. Gọi giải phóng lặp lại (processExpiredOrders / releaseOrderInventoryAllocations) -> Idempotent, KHÔNG cộng tồn hai lần và bảo vệ hàng đã xuất', async () => {
    const state = createInMemoryInventoryState()
    const tx = state.buildTxClient()
    const createdAt = new Date('2026-10-25T09:00:00.000Z')
    const expiredDueAt = computeOrderPaymentDueAt(createdAt) // 09:10:00Z
    const checkNow = new Date('2026-10-25T09:20:00.000Z') // Đã quá hạn 10 phút

    state.orders.push({
      id: 'order-idem',
      code: 'DH-IDEM-01',
      status: OrderStatus.PENDING_CONFIRMATION,
      type: OrderType.STANDARD,
      paymentOption: PaymentOption.FULL,
      total: 4800000,
      depositAmount: 1440000,
      paymentDueAt: expiredDueAt,
      items: [
        {
          id: 'item-idem',
          orderId: 'order-idem',
          productId: 'prod-ri6',
          productName: 'Sầu Riêng Ri6 Cai Lậy',
          orderedGrams: 40000,
        },
      ],
      transactions: [],
    })

    await reserveOrderInventoryFefo(tx, {
      orderId: 'order-idem',
      orderCode: 'DH-IDEM-01',
      userId: 'user-1',
      items: state.orders[0].items,
      products: [{ id: 'prod-ri6', name: 'Sầu Riêng Ri6 Cai Lậy', inventoryTrackingEnabled: true }],
      holdExpiresAt: expiredDueAt,
      now: createdAt,
    })

    expect(state.getBatchStock('batch-fefo-early').availableGrams).toBe(0)

    // Gọi giải phóng lần 1
    const release1 = await expireOverdueOrderInTx(tx, 'order-idem', checkNow)
    expect(release1.expired).toBe(true)
    expect(release1.totalReleasedGrams).toBe(40000)
    expect(state.getBatchStock('batch-fefo-early').availableGrams).toBe(40000)

    // Gọi giải phóng lần 2 và lần 3 lặp lại trên cùng đơn hàng
    const release2 = await expireOverdueOrderInTx(tx, 'order-idem', checkNow)
    const release3 = await releaseOrderInventoryAllocations(tx, {
      orderId: 'order-idem',
      orderCode: 'DH-IDEM-01',
      reason: 'Retry release',
      now: checkNow,
    })

    expect(release2.expired).toBe(false)
    expect(release2.totalReleasedGrams).toBe(0)
    expect(release3.releasedCount).toBe(0)
    expect(release3.totalReleasedGrams).toBe(0)

    // Tồn khả dụng vẫn đúng bằng 40kg (không bao giờ bị cộng hai lần thành 80kg)
    const finalStock = state.getBatchStock('batch-fefo-early')
    expect(finalStock.physicalStockGrams).toBe(40000)
    expect(finalStock.reservedGrams).toBe(0)
    expect(finalStock.availableGrams).toBe(40000)

    const releaseLedgerRows = state.ledgerEntries.filter(
      (l) => l.type === InventoryLedgerType.RESERVATION_RELEASE
    )
    expect(releaseLedgerRows).toHaveLength(1)
  })

  it('7. Server-time Lazy Expiration: Khách mới đặt hàng sau khi đơn cũ quá hạn 10 phút (chưa chạy Cron) -> Tự động thu hồi giữ chỗ đơn cũ và cấp phát cho đơn mới', async () => {
    const state = createInMemoryInventoryState()
    const tx = state.buildTxClient()

    const t0 = new Date('2026-10-25T10:00:00.000Z')
    const dueOrder1 = computeOrderPaymentDueAt(t0) // 10:10:00Z

    // Đơn 1 đặt toàn bộ 100kg lúc 10:00
    state.orders.push({
      id: 'order-old-hold',
      code: 'DH-OLD-HOLD',
      status: OrderStatus.PENDING_CONFIRMATION,
      type: OrderType.STANDARD,
      paymentOption: PaymentOption.DEPOSIT_30,
      total: 12000000,
      depositAmount: 3600000,
      paymentDueAt: dueOrder1,
      items: [
        {
          id: 'item-old-hold',
          orderId: 'order-old-hold',
          productId: 'prod-ri6',
          productName: 'Sầu Riêng Ri6 Cai Lậy',
          orderedGrams: 100000,
        },
      ],
      transactions: [],
    })

    await reserveOrderInventoryFefo(tx, {
      orderId: 'order-old-hold',
      orderCode: 'DH-OLD-HOLD',
      userId: 'user-old',
      items: state.orders[0].items,
      products: [{ id: 'prod-ri6', name: 'Sầu Riêng Ri6 Cai Lậy', inventoryTrackingEnabled: true }],
      holdExpiresAt: dueOrder1,
      now: t0,
    })

    // Toàn bộ 100kg đã bị giữ
    expect(state.getBatchStock('batch-fefo-early').availableGrams).toBe(0)
    expect(state.getBatchStock('batch-fefo-later').availableGrams).toBe(0)

    // Lúc 10:11:00Z (đã quá 10 phút), Cron chưa chạy nhưng Khách 2 vào đặt 50kg
    const tLater = new Date('2026-10-25T10:11:00.000Z')
    const dueOrder2 = computeOrderPaymentDueAt(tLater)

    state.orders.push({
      id: 'order-new-buyer',
      code: 'DH-NEW-BUYER',
      status: OrderStatus.PENDING_CONFIRMATION,
      type: OrderType.STANDARD,
      paymentOption: PaymentOption.DEPOSIT_30,
      total: 6000000,
      depositAmount: 1800000,
      paymentDueAt: dueOrder2,
      items: [
        {
          id: 'item-new-buyer',
          orderId: 'order-new-buyer',
          productId: 'prod-ri6',
          productName: 'Sầu Riêng Ri6 Cai Lậy',
          orderedGrams: 50000,
        },
      ],
      transactions: [],
    })

    const resNew = await reserveOrderInventoryFefo(tx, {
      orderId: 'order-new-buyer',
      orderCode: 'DH-NEW-BUYER',
      userId: 'user-new',
      items: state.orders[1].items,
      products: [{ id: 'prod-ri6', name: 'Sầu Riêng Ri6 Cai Lậy', inventoryTrackingEnabled: true }],
      holdExpiresAt: dueOrder2,
      now: tLater,
    })

    // Đơn cũ tự động bị hủy và giải phóng; Đơn mới được cấp phát 50kg thành công!
    expect(state.orders[0].status).toBe(OrderStatus.CANCELLED)
    expect(resNew.reserved).toBe(true)
    expect(resNew.allocations).toHaveLength(2)
    expect(state.getBatchStock('batch-fefo-early').availableGrams).toBe(0) // Đã giữ 40kg cho đơn mới
    expect(state.getBatchStock('batch-fefo-later').availableGrams).toBe(50000) // Đã giữ 10kg cho đơn mới, còn 50kg
  })

  it('8. Kiểm tra hàm thuần isOrderPaymentExpired và confirmOrderInventoryAllocations', async () => {
    const now = new Date('2026-10-25T10:10:01.000Z')
    expect(
      isOrderPaymentExpired(
        {
          status: 'PENDING_CONFIRMATION',
          paymentDueAt: '2026-10-25T10:10:00.000Z',
          paidAmount: 0,
        },
        now
      )
    ).toBe(true)

    // Đã thanh toán cọc -> không coi là quá hạn
    expect(
      isOrderPaymentExpired(
        {
          status: 'PENDING_CONFIRMATION',
          paymentDueAt: '2026-10-25T10:10:00.000Z',
          paidAmount: 1000000,
        },
        now
      )
    ).toBe(false)

    // Đã chuyển sang PROCESSING -> không coi là quá hạn
    expect(
      isOrderPaymentExpired(
        {
          status: 'PROCESSING',
          paymentDueAt: '2026-10-25T10:10:00.000Z',
          paidAmount: 0,
        },
        now
      )
    ).toBe(false)

    // Kiểm tra processExpiredOrders tích hợp giải phóng giữ chỗ
    const state = createInMemoryInventoryState()
    const tx = state.buildTxClient()
    const dueAt = new Date('2026-10-25T10:00:00.000Z')
    state.orders.push({
      id: 'order-cron-exp',
      code: 'DH-CRON-EXP',
      status: OrderStatus.PENDING_CONFIRMATION,
      type: OrderType.STANDARD,
      paymentOption: PaymentOption.FULL,
      total: 4800000,
      depositAmount: 1440000,
      paymentDueAt: dueAt,
      items: [
        {
          id: 'item-cron-exp',
          orderId: 'order-cron-exp',
          productId: 'prod-ri6',
          productName: 'Sầu Riêng Ri6 Cai Lậy',
          orderedGrams: 40000,
        },
      ],
      transactions: [],
    })

    await reserveOrderInventoryFefo(tx, {
      orderId: 'order-cron-exp',
      orderCode: 'DH-CRON-EXP',
      userId: 'user-1',
      items: state.orders[0].items,
      products: [{ id: 'prod-ri6', name: 'Sầu Riêng Ri6 Cai Lậy', inventoryTrackingEnabled: true }],
      holdExpiresAt: dueAt,
      now: new Date('2026-10-25T09:50:00.000Z'),
    })

    vi.mocked(db.order.findMany).mockResolvedValue(
      state.orders as unknown as Awaited<ReturnType<typeof db.order.findMany>>
    )
    vi.mocked(db.$transaction).mockImplementation(async (callback) => {
      return await (callback as unknown as (t: ReservationTxClient) => unknown)(tx)
    })

    const expRes = await processExpiredOrders(now)
    expect(expRes.success).toBe(true)
    expect(expRes.expiredCount).toBe(1)
    expect(state.orders[0].status).toBe(OrderStatus.CANCELLED)
    expect(state.orders[0].cancelReason).toBe(
      'Quá hạn giữ chỗ thanh toán 10 phút mà hệ thống chưa nhận được tiền'
    )
    expect(state.orders[0].cancelReason).not.toContain('24h')
    expect(state.getBatchStock('batch-fefo-early').availableGrams).toBe(40000)

    const confirmRes = await confirmOrderInventoryAllocations(tx, 'order-cron-exp')
    expect(confirmRes.confirmedCount).toBe(0) // Đã RELEASED nên không thể confirm
  })

  it('9. Bộ Regression Tests bắt buộc PAY-01 đến PAY-12 (EV-IMP-01C Payment Threshold & Hardening)', async () => {
    const state = createInMemoryInventoryState()
    const tx = state.buildTxClient()

    vi.mocked(db.$transaction).mockImplementation(async (callback) => {
      return await (callback as unknown as (t: ReservationTxClient) => unknown)(tx)
    })

    const createdAt = new Date('2026-10-25T10:00:00.000Z')
    const dueAt = computeOrderPaymentDueAt(createdAt) // 10:10:00Z
    const afterDue = new Date('2026-10-25T10:15:00.000Z')
    const futureDue = new Date(Date.now() + 5 * 60 * 1000)

    // =========================================================================
    // PAY-01 & PAY-12: Đơn cọc 30%, thanh toán dưới ngưỡng -> từ chối, không ghi DONE, dữ liệu nhất quán
    // =========================================================================
    state.orders.push({
      id: 'order-pay-01',
      code: 'DH-PAY-01',
      status: OrderStatus.PENDING_CONFIRMATION,
      type: OrderType.STANDARD,
      paymentOption: PaymentOption.DEPOSIT_30,
      total: 6000000,
      depositAmount: 1800000, // 30% = 1.800.000đ
      paymentDueAt: futureDue,
      items: [
        {
          id: 'item-pay-01',
          orderId: 'order-pay-01',
          productId: 'prod-ri6',
          productName: 'Sầu Riêng Ri6 Cai Lậy',
          orderedGrams: 10000,
        },
      ],
      transactions: [],
    })

    await reserveOrderInventoryFefo(tx, {
      orderId: 'order-pay-01',
      orderCode: 'DH-PAY-01',
      userId: 'user-1',
      items: state.orders[0].items,
      products: [{ id: 'prod-ri6', name: 'Sầu Riêng Ri6 Cai Lậy', inventoryTrackingEnabled: true }],
      holdExpiresAt: futureDue,
      now: createdAt,
    })

    const pay01Res = await confirmPayment({
      orderId: 'order-pay-01',
      amount: 500000, // < 1.800.000đ
      method: TxMethod.BANK_TRANSFER,
      reference: 'FT-PAY-01',
    })
    expect(pay01Res.success).toBe(false)
    expect(pay01Res.error).toContain('1.800.000')
    expect(pay01Res.error).toContain('1.300.000')
    // Không tạo PaymentTransaction(DONE), giữ nguyên trạng thái đơn & phân bổ HOLD_PENDING (PAY-12)
    expect(state.orders[0].transactions).toHaveLength(0)
    expect(state.orders[0].status).toBe(OrderStatus.PENDING_CONFIRMATION)
    expect(state.allocations.find((a) => a.orderId === 'order-pay-01')?.status).toBe(
      AllocationStatus.HOLD_PENDING
    )

    // =========================================================================
    // PAY-02 & PAY-07: Đơn cọc 30%, thanh toán đúng ngưỡng -> xác nhận thành công & không bị expiration hủy nhầm
    // =========================================================================
    const pay02Res = await confirmPayment({
      orderId: 'order-pay-01',
      amount: 1800000,
      method: TxMethod.BANK_TRANSFER,
      reference: 'FT-PAY-02',
    })
    expect(pay02Res.success).toBe(true)
    expect(state.orders[0].status).toBe(OrderStatus.PROCESSING)
    expect(state.orders[0].transactions).toHaveLength(1)
    expect(state.allocations.find((a) => a.orderId === 'order-pay-01')?.status).toBe(
      AllocationStatus.ALLOCATED_CONFIRMED
    )

    // PAY-07: Dù thời gian vượt qua paymentDueAt, đơn đã PROCESSING không bao giờ bị expiration hủy nhầm
    state.orders[0].paymentDueAt = dueAt
    vi.mocked(db.order.findMany).mockResolvedValue(
      [state.orders[0]] as unknown as Awaited<ReturnType<typeof db.order.findMany>>
    )
    const expPay07 = await processExpiredOrders(afterDue)
    expect(expPay07.expiredCount).toBe(0)
    expect(state.orders[0].status).toBe(OrderStatus.PROCESSING)
    expect(state.allocations.find((a) => a.orderId === 'order-pay-01')?.status).toBe(
      AllocationStatus.ALLOCATED_CONFIRMED
    )

    // =========================================================================
    // PAY-03 & PAY-04: Đơn FULL — trả 30% bị từ chối (PAY-03), trả 100% thành công (PAY-04)
    // =========================================================================
    state.orders.push({
      id: 'order-pay-full',
      code: 'DH-PAY-FULL',
      status: OrderStatus.PENDING_CONFIRMATION,
      type: OrderType.STANDARD,
      paymentOption: PaymentOption.FULL,
      total: 6000000,
      depositAmount: 1800000,
      paymentDueAt: futureDue,
      items: [
        {
          id: 'item-pay-full',
          orderId: 'order-pay-full',
          productId: 'prod-ri6',
          productName: 'Sầu Riêng Ri6 Cai Lậy',
          orderedGrams: 10000,
        },
      ],
      transactions: [],
    })

    await reserveOrderInventoryFefo(tx, {
      orderId: 'order-pay-full',
      orderCode: 'DH-PAY-FULL',
      userId: 'user-1',
      items: state.orders[1].items,
      products: [{ id: 'prod-ri6', name: 'Sầu Riêng Ri6 Cai Lậy', inventoryTrackingEnabled: true }],
      holdExpiresAt: futureDue,
      now: createdAt,
    })

    // PAY-03: Trả 30% (1.800.000đ) cho đơn FULL -> Từ chối
    const pay03Res = await confirmPayment({
      orderId: 'order-pay-full',
      amount: 1800000,
      method: TxMethod.BANK_TRANSFER,
      reference: 'FT-PAY-03',
    })
    expect(pay03Res.success).toBe(false)
    expect(pay03Res.error).toContain('6.000.000')
    expect(pay03Res.error).toContain('4.200.000')
    expect(state.orders[1].transactions).toHaveLength(0)
    expect(state.orders[1].status).toBe(OrderStatus.PENDING_CONFIRMATION)

    // PAY-04: Trả 100% (6.000.000đ) cho đơn FULL -> Thành công
    const pay04Res = await confirmPayment({
      orderId: 'order-pay-full',
      amount: 6000000,
      method: TxMethod.BANK_TRANSFER,
      reference: 'FT-PAY-04',
    })
    expect(pay04Res.success).toBe(true)
    expect(state.orders[1].status).toBe(OrderStatus.PROCESSING)
    expect(state.allocations.find((a) => a.orderId === 'order-pay-full')?.status).toBe(
      AllocationStatus.ALLOCATED_CONFIRMED
    )

    // =========================================================================
    // PAY-05, PAY-06, PAY-10, PAY-11:
    // - Giao dịch PENDING/FAILED không được tính là đã trả (PAY-11)
    // - Quá hạn 10 phút tự hủy & giải phóng tồn (PAY-05)
    // - Admin xác nhận sau hạn 10 phút -> từ chối, không hồi sinh reservation (PAY-06)
    // - Chạy lặp expiration/hủy -> không double-release (PAY-10)
    // =========================================================================
    state.orders.push({
      id: 'order-pay-overdue',
      code: 'DH-PAY-OVERDUE',
      status: OrderStatus.PENDING_CONFIRMATION,
      type: OrderType.STANDARD,
      paymentOption: PaymentOption.DEPOSIT_30,
      total: 6000000,
      depositAmount: 1800000,
      paymentDueAt: dueAt,
      items: [
        {
          id: 'item-pay-overdue',
          orderId: 'order-pay-overdue',
          productId: 'prod-ri6',
          productName: 'Sầu Riêng Ri6 Cai Lậy',
          orderedGrams: 10000,
        },
      ],
      transactions: [
        {
          id: 'tx-pending-ignore',
          type: TxType.PAYMENT,
          status: TxStatus.PENDING,
          amount: 1800000,
        },
        {
          id: 'tx-refund-ignore',
          type: TxType.REFUND,
          status: TxStatus.DONE,
          amount: 1800000,
        },
      ],
    })

    await reserveOrderInventoryFefo(tx, {
      orderId: 'order-pay-overdue',
      orderCode: 'DH-PAY-OVERDUE',
      userId: 'user-1',
      items: state.orders[2].items,
      products: [{ id: 'prod-ri6', name: 'Sầu Riêng Ri6 Cai Lậy', inventoryTrackingEnabled: true }],
      holdExpiresAt: dueAt,
      now: createdAt,
    })

    // PAY-06: Admin cố xác nhận đủ tiền sau hạn 10 phút -> Từ chối, tự động hủy và giải phóng kho, không hồi sinh reservation
    const pay06Res = await confirmPayment({
      orderId: 'order-pay-overdue',
      amount: 1800000,
      method: TxMethod.BANK_TRANSFER,
      reference: 'FT-PAY-06',
    })
    expect(pay06Res.success).toBe(false)
    expect(state.orders[2].status).toBe(OrderStatus.CANCELLED)
    expect(state.allocations.find((a) => a.orderId === 'order-pay-overdue')?.status).toBe(
      AllocationStatus.RELEASED
    )

    // PAY-10: Chạy lặp processExpiredOrders và releaseOrderInventoryAllocations -> không double-release
    vi.mocked(db.order.findMany).mockResolvedValue(
      [state.orders[2]] as unknown as Awaited<ReturnType<typeof db.order.findMany>>
    )
    await processExpiredOrders(afterDue)
    const repeatRelease = await releaseOrderInventoryAllocations(tx, {
      orderId: 'order-pay-overdue',
      orderCode: 'DH-PAY-OVERDUE',
      reason: 'Repeat test',
      now: afterDue,
    })
    expect(repeatRelease.releasedCount).toBe(0)
    const releaseLedgersOverdue = state.ledgerEntries.filter(
      (l) => l.orderId === 'order-pay-overdue' && l.type === InventoryLedgerType.RESERVATION_RELEASE
    )
    expect(releaseLedgersOverdue).toHaveLength(1)

    // =========================================================================
    // PAY-08: Đơn lịch sử có thanh toán một phần dưới ngưỡng (0 < paidAmount < requiredThreshold)
    // 1. Khi quá hạn 10 phút: Giải phóng giữ chỗ tồn kho (HOLD_PENDING -> RELEASED), không giữ kho vô hạn.
    // 2. Bảo toàn giao dịch tiền đã nhận (PaymentTransaction DONE), không tự tạo hoàn tiền, không tự hủy bằng SYSTEM.
    // 3. Chặn confirmPayment sau hạn 10 phút hồi sinh quyền giữ kho.
    // 4. Khi Admin thực hiện quy trình đối soát hủy đơn (cancelOrder): chuyển CANCELLED và tạo lệnh REFUND(PENDING) đúng số tiền đã nhận.
    // =========================================================================
    state.orders.push({
      id: 'order-pay-08-legacy',
      code: 'DH-PAY-08',
      status: OrderStatus.PENDING_CONFIRMATION,
      type: OrderType.STANDARD,
      paymentOption: PaymentOption.DEPOSIT_30,
      total: 6000000,
      depositAmount: 1800000,
      paymentDueAt: dueAt,
      items: [
        {
          id: 'item-pay-08',
          orderId: 'order-pay-08-legacy',
          productId: 'prod-ri6',
          productName: 'Sầu Riêng Ri6 Cai Lậy',
          orderedGrams: 10000,
        },
      ],
      transactions: [
        {
          id: 'tx-legacy-partial',
          type: TxType.PAYMENT,
          status: TxStatus.DONE,
          amount: 500000, // Đã nhận 500.000đ (< 1.800.000đ) trước Hotfix
          reference: 'FT-LEGACY-500K',
        },
      ],
    })

    await reserveOrderInventoryFefo(tx, {
      orderId: 'order-pay-08-legacy',
      orderCode: 'DH-PAY-08',
      userId: 'user-1',
      items: state.orders[3].items,
      products: [{ id: 'prod-ri6', name: 'Sầu Riêng Ri6 Cai Lậy', inventoryTrackingEnabled: true }],
      holdExpiresAt: dueAt,
      now: createdAt,
    })

    // Trước khi quét hết hạn: lô đang bị giữ thêm 10kg (20kg từ 2 đơn PROCESSING + 10kg của đơn legacy = 30kg reserved, còn 10kg available)
    expect(state.getBatchStock('batch-fefo-early').availableGrams).toBe(10000)

    // Quét hết hạn: giải phóng ngay 10kg của đơn lịch sử, nhưng giữ nguyên Order ở PENDING_CONFIRMATION và giữ nguyên 500.000đ
    vi.mocked(db.order.findMany).mockResolvedValue(
      [state.orders[3]] as unknown as Awaited<ReturnType<typeof db.order.findMany>>
    )
    const expPay08 = await processExpiredOrders(afterDue)
    expect(expPay08.success).toBe(true)
    expect(state.allocations.find((a) => a.orderId === 'order-pay-08-legacy')?.status).toBe(
      AllocationStatus.RELEASED
    )
    expect(state.getBatchStock('batch-fefo-early').availableGrams).toBe(20000) // Đã trả lại 10kg!
    expect(state.orders[3].status).toBe(OrderStatus.PENDING_CONFIRMATION)
    expect(state.orders[3].transactions).toHaveLength(1) // Không tự tạo REFUND và không mất giao dịch 500k

    // Nếu Admin cố bấm confirmPayment bù 1.300.000đ sau khi đã quá hạn 10 phút -> bị từ chối, không hồi sinh reservation
    const lateTopupRes = await confirmPayment({
      orderId: 'order-pay-08-legacy',
      amount: 1300000,
      method: TxMethod.BANK_TRANSFER,
      reference: 'FT-LATE-TOPUP',
    })
    expect(lateTopupRes.success).toBe(false)
    expect(lateTopupRes.error).toContain('Quyền giữ kho đã hết hạn')
    expect(state.allocations.find((a) => a.orderId === 'order-pay-08-legacy')?.status).toBe(
      AllocationStatus.RELEASED
    )

    // Admin thực hiện đối soát thủ công qua cancelOrder -> chuyển CANCELLED (SELLER) và tạo lệnh REFUND(PENDING) 500.000đ
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: {
        id: 'admin-fefo',
        email: 'admin@evibe.vn',
        role: Role.ADMIN,
        name: 'Admin E Vibe',
      },
    } as unknown as Awaited<ReturnType<typeof getServerAuthSession>>)
    vi.mocked(db.order.findUnique).mockResolvedValue({
      ...state.orders[3],
      userId: 'user-1',
      finalTotal: null,
      deliveredAt: null,
    } as unknown as Awaited<ReturnType<typeof db.order.findUnique>>)

    const cancelLegacyRes = await cancelOrder({
      orderId: 'order-pay-08-legacy',
      reason: 'Đối soát đơn quá hạn thanh toán thiếu: hủy đơn và hoàn trả 500.000đ',
    })
    expect(cancelLegacyRes.success).toBe(true)
    expect(state.orders[3].status).toBe(OrderStatus.CANCELLED)
    const refundTx = state.orders[3].transactions.find((t) => t.type === TxType.REFUND)
    expect(refundTx).toBeDefined()
    expect(refundTx?.status).toBe(TxStatus.PENDING)
    expect(refundTx?.amount).toBe(500000)

    // =========================================================================
    // PAY-09: Hai yêu cầu xác nhận thanh toán đồng thời -> không ghi nhận trùng tiền hoặc chuyển trạng thái sai
    // =========================================================================
    state.orders.push({
      id: 'order-pay-09-concurrent',
      code: 'DH-PAY-09',
      status: OrderStatus.PENDING_CONFIRMATION,
      type: OrderType.STANDARD,
      paymentOption: PaymentOption.DEPOSIT_30,
      total: 6000000,
      depositAmount: 1800000,
      paymentDueAt: futureDue,
      items: [
        {
          id: 'item-pay-09',
          orderId: 'order-pay-09-concurrent',
          productId: 'prod-ri6',
          productName: 'Sầu Riêng Ri6 Cai Lậy',
          orderedGrams: 10000,
        },
      ],
      transactions: [],
    })

    await reserveOrderInventoryFefo(tx, {
      orderId: 'order-pay-09-concurrent',
      orderCode: 'DH-PAY-09',
      userId: 'user-1',
      items: state.orders[4].items,
      products: [{ id: 'prod-ri6', name: 'Sầu Riêng Ri6 Cai Lậy', inventoryTrackingEnabled: true }],
      holdExpiresAt: futureDue,
      now: createdAt,
    })

    const [conc1, conc2] = await Promise.all([
      confirmPayment({
        orderId: 'order-pay-09-concurrent',
        amount: 1800000,
        method: TxMethod.BANK_TRANSFER,
        reference: 'FT-CONC-09',
      }),
      confirmPayment({
        orderId: 'order-pay-09-concurrent',
        amount: 1800000,
        method: TxMethod.BANK_TRANSFER,
        reference: 'FT-CONC-09',
      }),
    ])

    const successCount = [conc1, conc2].filter((r) => r.success).length
    const failCount = [conc1, conc2].filter((r) => !r.success).length
    expect(successCount).toBe(1)
    expect(failCount).toBe(1)
    expect(state.orders[4].transactions).toHaveLength(1)
    expect(state.orders[4].status).toBe(OrderStatus.PROCESSING)
  })

  it('10. Kiểm thử Script chuẩn bị 6 lô FEFO Demo (Dry Run, Idempotent Apply, Safety Gates & Bảo toàn UNVERIFIED)', async () => {
    // 1. Safety Gates: Chặn nhánh khác beta hoặc host Production
    expect(() =>
      verifyDemoScriptSafetyGates({
        connectionUrl: 'postgresql://user:pass@ep-prod-main.ap-southeast-1.aws.neon.tech/neondb',
        expectedHost: 'ep-prod-main.ap-southeast-1.aws.neon.tech',
        gitBranch: 'beta',
        mode: 'DRY_RUN',
      })
    ).toThrow(/Production/i)

    // Chặn trực diện Production Endpoint ID (ep-square-scene-b5ddgxil)
    expect(() =>
      verifyDemoScriptSafetyGates({
        connectionUrl: 'postgresql://user:pass@ep-square-scene-b5ddgxil.c-7.us-east-2.aws.neon.tech/neondb',
        expectedHost: 'ep-square-scene-b5ddgxil.c-7.us-east-2.aws.neon.tech',
        gitBranch: 'beta',
        mode: 'DRY_RUN',
      })
    ).toThrow(/Production/i)

    // Chặn kết nối Pooled connection (-pooler)
    expect(() =>
      verifyDemoScriptSafetyGates({
        connectionUrl: 'postgresql://user:pass@ep-fancy-waterfall-b5f117np-pooler.c-7.us-east-2.aws.neon.tech/neondb',
        expectedHost: 'ep-fancy-waterfall-b5f117np-pooler.c-7.us-east-2.aws.neon.tech',
        gitBranch: 'beta',
        mode: 'DRY_RUN',
      })
    ).toThrow(/Pooler/i)

    // Chặn sai lệch ExpectedHost trong APPLY mode
    expect(() =>
      verifyDemoScriptSafetyGates({
        connectionUrl: 'postgresql://user:pass@ep-other-branch.c-7.us-east-2.aws.neon.tech/neondb',
        expectedHost: 'ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech',
        gitBranch: 'beta',
        mode: 'APPLY',
        confirmPreviewBeta: true,
      })
    ).toThrow(/không khớp/i)

    expect(() =>
      verifyDemoScriptSafetyGates({
        connectionUrl: 'postgresql://user:pass@ep-preview-beta.ap-southeast-1.aws.neon.tech/neondb',
        expectedHost: 'ep-preview-beta.ap-southeast-1.aws.neon.tech',
        gitBranch: 'main',
        mode: 'DRY_RUN',
      })
    ).toThrow(/Chỉ cho phép chạy trên nhánh Git "beta"/i)

    expect(() =>
      verifyDemoScriptSafetyGates({
        connectionUrl: 'postgresql://user:pass@ep-preview-beta.ap-southeast-1.aws.neon.tech/neondb',
        expectedHost: 'ep-preview-beta.ap-southeast-1.aws.neon.tech',
        gitBranch: 'beta',
        mode: 'APPLY',
        confirmPreviewBeta: false,
      })
    ).toThrow(/--confirm-preview-beta/i)

    const validGate = verifyDemoScriptSafetyGates({
      connectionUrl: 'postgresql://user:pass@ep-preview-beta.ap-southeast-1.aws.neon.tech/neondb',
      expectedHost: 'ep-preview-beta.ap-southeast-1.aws.neon.tech',
      gitBranch: 'beta',
      mode: 'APPLY',
      confirmPreviewBeta: true,
    })
    expect(validGate.isSafe).toBe(true)

    // 2. Giả lập In-Memory Adapter cho 8 sản phẩm (3 sản phẩm mục tiêu + 5 sản phẩm ngoài phạm vi) & 3 lô lịch sử UNVERIFIED
    const mockProducts = [
      { id: 'p-ri6', slug: 'sau-rieng-ri6', name: 'Sầu Riêng Ri6', farmId: 'f-1', inventoryTrackingEnabled: false },
      { id: 'p-bdx', slug: 'buoi-da-xanh-ben-tre', name: 'Bưởi Da Xanh', farmId: 'f-1', inventoryTrackingEnabled: false },
      { id: 'p-bo', slug: 'bo-034-tay-nguyen', name: 'Bơ 034', farmId: 'f-2', inventoryTrackingEnabled: false },
      { id: 'p-4', slug: 'xoai-cat-hoa-loc', name: 'Xoài Cát Hòa Lộc', farmId: 'f-2', inventoryTrackingEnabled: false },
      { id: 'p-5', slug: 'cam-sanh-ha-giang', name: 'Cam Sành', farmId: 'f-2', inventoryTrackingEnabled: false },
      { id: 'p-6', slug: 'thanh-long-ruot-do', name: 'Thanh Long', farmId: 'f-3', inventoryTrackingEnabled: false },
      { id: 'p-7', slug: 'nhan-xuong-com-vang', name: 'Nhãn Xuồng', farmId: 'f-3', inventoryTrackingEnabled: false },
      { id: 'p-8', slug: 'dua-xiem-xanh', name: 'Dừa Xiêm', farmId: 'f-3', inventoryTrackingEnabled: false },
    ]

    const mockBatches: Array<{
      id: string
      code: string
      productId: string
      farmId: string
      harvestDate: Date
      expiryDate: Date | null
      status: BatchStatus
      isFefoEligible: boolean
      quantityGrams: number
      physicalStockGrams: number
      reservedGrams: number
      ledgerEntries: Array<{
        id: string
        type: InventoryLedgerType
        quantityGrams: number
        idempotencyKey: string | null
      }>
    }> = HISTORICAL_UNVERIFIED_BATCH_CODES.map((code, idx) => ({
      id: `hist-${idx + 1}`,
      code,
      productId: mockProducts[idx].id,
      farmId: mockProducts[idx].farmId,
      harvestDate: new Date('2026-10-13T00:00:00.000Z'),
      expiryDate: null,
      status: BatchStatus.UNVERIFIED,
      isFefoEligible: false,
      quantityGrams: 3000000,
      physicalStockGrams: 0,
      reservedGrams: 0,
      ledgerEntries: [],
    }))

    const adapter: DemoBatchStorageAdapter = {
      async findProducts() {
        return mockProducts.map((p) => ({ ...p }))
      },
      async findBatchesByCodes(codes) {
        return mockBatches.filter((b) => codes.includes(b.code))
      },
      async upsertDemoBatchAndImportInTx(params) {
        let batch = mockBatches.find((b) => b.code === params.spec.batchCode)
        let createdBatch = false
        if (!batch) {
          batch = {
            id: `demo-${mockBatches.length + 1}`,
            code: params.spec.batchCode,
            productId: params.productId,
            farmId: params.farmId,
            harvestDate: params.harvestDate,
            expiryDate: params.expiryDate,
            status: BatchStatus.ACTIVE,
            isFefoEligible: true,
            quantityGrams: params.spec.importGrams,
            physicalStockGrams: params.spec.importGrams,
            reservedGrams: 0,
            ledgerEntries: [],
          }
          mockBatches.push(batch)
          createdBatch = true
        }

        let createdLedgerImport = false
        const hasImport = batch.ledgerEntries.some(
          (l) => l.idempotencyKey === params.idempotencyKey || l.type === InventoryLedgerType.IMPORT
        )
        if (!hasImport) {
          batch.ledgerEntries.push({
            id: `led-${batch.ledgerEntries.length + 1}`,
            type: InventoryLedgerType.IMPORT,
            quantityGrams: params.spec.importGrams,
            idempotencyKey: params.idempotencyKey,
          })
          createdLedgerImport = true
        }

        const stock = calculateStockFromLedger(
          batch.ledgerEntries.map((l) => ({
            type: l.type,
            quantityGrams: l.quantityGrams,
          }))
        )
        batch.physicalStockGrams = stock.physicalStockGrams
        batch.reservedGrams = stock.reservedGrams
        batch.quantityGrams = stock.availableGrams

        return {
          batchId: batch.id,
          batchCode: batch.code,
          createdBatch,
          createdLedgerImport,
          physicalStockGrams: stock.physicalStockGrams,
          reservedGrams: stock.reservedGrams,
          availableGrams: stock.availableGrams,
        }
      },
      async enableTrackingForProducts(productIds) {
        let count = 0
        for (const p of mockProducts) {
          if (productIds.includes(p.id)) {
            p.inventoryTrackingEnabled = true
            count++
          }
        }
        return count
      },
    }

    const demoNow = new Date('2026-10-25T10:00:00.000Z')

    // 3. Chạy DRY_RUN: không tạo lô mới, không bật tracking
    const dryRunRes = await executePrepareF01CDemoBatches(adapter, {
      mode: 'DRY_RUN',
      referenceDate: demoNow,
    })
    expect(dryRunRes.mode).toBe('DRY_RUN')
    expect(dryRunRes.batchesSummary).toHaveLength(6)
    expect(dryRunRes.batchesSummary.every((b) => b.action === 'WOULD_CREATE')).toBe(true)
    expect(mockBatches).toHaveLength(3) // Chỉ có 3 lô lịch sử
    expect(mockProducts.every((p) => p.inventoryTrackingEnabled === false)).toBe(true)

    // 4. Chạy APPLY lần 1: tạo đủ 6 lô ACTIVE + IMPORT và bật tracking cho đúng 3 sản phẩm
    const apply1 = await executePrepareF01CDemoBatches(adapter, {
      mode: 'APPLY',
      referenceDate: demoNow,
    })
    expect(apply1.batchesSummary).toHaveLength(6)
    expect(apply1.batchesSummary.every((b) => b.action === 'CREATED_AND_IMPORTED')).toBe(true)
    expect(apply1.enabledTrackingProductSlugs).toEqual([
      'sau-rieng-ri6',
      'buoi-da-xanh-ben-tre',
      'bo-034-tay-nguyen',
    ])

    // 5. Chạy APPLY lần 2 (Idempotency): KHÔNG tạo trùng IMPORT, KHÔNG nhân đôi tồn kho
    const apply2 = await executePrepareF01CDemoBatches(adapter, {
      mode: 'APPLY',
      referenceDate: demoNow,
    })
    expect(apply2.batchesSummary.every((b) => b.action === 'IDEMPOTENT_SKIPPED')).toBe(true)

    for (const spec of F01C_DEMO_BATCH_SPECS) {
      const b = mockBatches.find((x) => x.code === spec.batchCode)!
      expect(b.ledgerEntries).toHaveLength(1)
      expect(b.physicalStockGrams).toBe(spec.importGrams)
      expect(b.quantityGrams).toBe(spec.importGrams)
    }

    // 6. Xác minh 3 lô lịch sử vẫn UNVERIFIED và 5 sản phẩm còn lại vẫn inventoryTrackingEnabled = false
    for (const histCode of HISTORICAL_UNVERIFIED_BATCH_CODES) {
      const hb = mockBatches.find((x) => x.code === histCode)!
      expect(hb.status).toBe(BatchStatus.UNVERIFIED)
      expect(hb.isFefoEligible).toBe(false)
    }
    expect(mockProducts.filter((p) => p.inventoryTrackingEnabled)).toHaveLength(3)
    expect(mockProducts.filter((p) => !p.inventoryTrackingEnabled)).toHaveLength(5)
  })
})
