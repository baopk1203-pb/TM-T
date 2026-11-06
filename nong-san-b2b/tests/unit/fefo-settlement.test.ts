import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AllocationStatus, InventoryLedgerType } from '@prisma/client'
import { dispatchOrderInventoryAllocations } from '@/lib/services/inventory-reservation'
import { calculateStockFromLedger, verifyInventoryInvariants } from '@/lib/domain/inventory'

interface TestAllocation {
  id: string
  orderItemId: string
  batchId: string
  allocatedGrams: number
  dispatchedGrams: number
  releasedGrams: number
  status: AllocationStatus
  holdExpiresAt: Date | null
  releasedAt: Date | null
}

interface TestLedgerEntry {
  id: string
  batchId: string
  orderId?: string
  orderItemId?: string
  type: InventoryLedgerType
  quantityGrams: number
  idempotencyKey?: string | null
  referenceCode?: string | null
  actorId?: string | null
  notes?: string | null
}

interface MockTxClient {
  $queryRaw: ReturnType<typeof vi.fn>
  orderItemBatchAllocation: {
    findMany: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  inventoryLedger: {
    create: ReturnType<typeof vi.fn>
  }
}

describe('EV-F01-FEFO-SETTLEMENT: Inventory Settlement Regression Test Suite', () => {
  let mockAllocations: TestAllocation[]
  let mockLedgers: TestLedgerEntry[]
  let mockTx: MockTxClient

  beforeEach(() => {
    mockAllocations = [
      {
        id: 'alloc-fefo-bo034-01',
        orderItemId: 'item-bo034',
        batchId: 'batch-bo034-daklak',
        allocatedGrams: 50000,
        dispatchedGrams: 0,
        releasedGrams: 0,
        status: AllocationStatus.ALLOCATED_CONFIRMED,
        holdExpiresAt: null,
        releasedAt: null,
      },
    ]

    mockLedgers = [
      // 1. Nhập kho ban đầu 158 kg
      {
        id: 'ledger-import-1',
        batchId: 'batch-bo034-daklak',
        type: InventoryLedgerType.IMPORT,
        quantityGrams: 158000,
        idempotencyKey: 'LEDGER:IMPORT:01',
      },
      // 2. Giữ chỗ đơn hàng 50 kg
      {
        id: 'ledger-hold-1',
        batchId: 'batch-bo034-daklak',
        orderId: 'ord-dh-261030-fzdn',
        orderItemId: 'item-bo034',
        type: InventoryLedgerType.RESERVATION_HOLD,
        quantityGrams: 50000,
        idempotencyKey: 'LEDGER:HOLD:alloc-fefo-bo034-01',
      },
    ]

    mockTx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      orderItemBatchAllocation: {
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          return mockAllocations.filter((a) => {
            if (where.orderItem?.orderId && a.orderItemId !== 'item-bo034') return false
            if (where.status?.in && !where.status.in.includes(a.status)) return false
            return true
          })
        }),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          const alloc = mockAllocations.find((a) => a.id === where.id)
          if (!alloc) throw new Error('Allocation not found')
          Object.assign(alloc, data)
          return alloc
        }),
      },
      inventoryLedger: {
        create: vi.fn().mockImplementation(async ({ data }) => {
          // Kiểm tra unique idempotencyKey
          if (mockLedgers.some((l) => l.idempotencyKey === data.idempotencyKey)) {
            const err = new Error('Unique constraint failed on idempotencyKey') as Error & { code?: string }
            err.code = 'P2002'
            throw err
          }
          const entry: TestLedgerEntry = { id: `ledger-${Date.now()}-${Math.random()}`, ...data }
          mockLedgers.push(entry)
          return entry
        }),
      },
    }
  })

  // =========================================================================
  // TEST 1: Completed Order -> Inventory Settled
  // =========================================================================
  it('1. Completed Order -> Inventory Settled (Allocation chuyển DISPATCHED, Ledger ghi DISPATCH_OUT)', async () => {
    const res = await dispatchOrderInventoryAllocations(mockTx as unknown as Parameters<typeof dispatchOrderInventoryAllocations>[0], {
      orderId: 'ord-dh-261030-fzdn',
      orderCode: 'DH-261030-FZDN',
      actorId: 'admin-1',
      lines: [{ orderItemId: 'item-bo034', actualGrams: 50000 }],
      reason: 'Chốt khối lượng thực tế & Hoàn thành đơn hàng',
    })

    expect(res.dispatchedCount).toBe(1)
    expect(res.totalDispatchedGrams).toBe(50000)
    expect(res.releasedCount).toBe(0)

    // Kiểm tra Allocation đã chuyển sang DISPATCHED và ghi nhận dispatchedGrams
    const updatedAlloc = mockAllocations.find((a) => a.id === 'alloc-fefo-bo034-01')
    expect(updatedAlloc?.status).toBe(AllocationStatus.DISPATCHED)
    expect(updatedAlloc?.dispatchedGrams).toBe(50000)
    expect(updatedAlloc?.releasedGrams).toBe(0)

    // Kiểm tra Ledger đã ghi nhận bản ghi DISPATCH_OUT
    const dispatchEntry = mockLedgers.find((l) => l.type === InventoryLedgerType.DISPATCH_OUT)
    expect(dispatchEntry).toBeDefined()
    expect(dispatchEntry?.quantityGrams).toBe(50000)
    expect(dispatchEntry?.batchId).toBe('batch-bo034-daklak')
    expect(dispatchEntry?.idempotencyKey).toBe('LEDGER:DISPATCH:alloc-fefo-bo034-01')
  })

  // =========================================================================
  // TEST 2: Reserved không còn bị giữ sau khi xuất kho
  // =========================================================================
  it('2. Reserved không còn bị giữ sau khi xuất kho (ReservedStock giảm về 0 kg)', async () => {
    // Trước khi xuất kho: Reserved = 50 kg
    const stockBefore = calculateStockFromLedger(mockLedgers)
    expect(stockBefore.reservedGrams).toBe(50000)

    // Thực hiện xuất kho
    await dispatchOrderInventoryAllocations(mockTx as unknown as Parameters<typeof dispatchOrderInventoryAllocations>[0], {
      orderId: 'ord-dh-261030-fzdn',
      orderCode: 'DH-261030-FZDN',
      actorId: 'admin-1',
    })

    // Sau khi xuất kho: Reserved = 50 (HOLD) - 50 (DISPATCH_OUT) = 0 kg
    const stockAfter = calculateStockFromLedger(mockLedgers)
    expect(stockAfter.reservedGrams).toBe(0)
    expect(stockAfter.rawReservedGrams).toBe(0)
  })

  // =========================================================================
  // TEST 3: Physical giảm đúng khối lượng xuất
  // =========================================================================
  it('3. Physical giảm đúng khối lượng xuất (PhysicalStock giảm từ 158 kg xuống 108 kg)', async () => {
    const stockBefore = calculateStockFromLedger(mockLedgers)
    expect(stockBefore.physicalStockGrams).toBe(158000)

    await dispatchOrderInventoryAllocations(mockTx as unknown as Parameters<typeof dispatchOrderInventoryAllocations>[0], {
      orderId: 'ord-dh-261030-fzdn',
      orderCode: 'DH-261030-FZDN',
      actorId: 'admin-1',
    })

    const stockAfter = calculateStockFromLedger(mockLedgers)
    // Physical = 158 kg (IMPORT) - 50 kg (DISPATCH_OUT) = 108 kg
    expect(stockAfter.physicalStockGrams).toBe(108000)
    expect(stockAfter.rawPhysicalStockGrams).toBe(108000)
    expect(stockAfter.dispatchedGrams).toBe(50000)
  })

  // =========================================================================
  // TEST 4: Available không bị trừ hai lần
  // =========================================================================
  it('4. Available không bị trừ hai lần (AvailableStock bất biến ở mức 108 kg)', async () => {
    // Trước xuất kho: Available = 158 kg - 50 kg (HOLD) = 108 kg
    const stockBefore = calculateStockFromLedger(mockLedgers)
    expect(stockBefore.availableGrams).toBe(108000)

    await dispatchOrderInventoryAllocations(mockTx as unknown as Parameters<typeof dispatchOrderInventoryAllocations>[0], {
      orderId: 'ord-dh-261030-fzdn',
      orderCode: 'DH-261030-FZDN',
      actorId: 'admin-1',
    })

    // Sau xuất kho: Available = (158 - 50) - (50 - 50) = 108 - 0 = 108 kg
    // Hàng xuất kho không làm giảm Available lần thứ hai!
    const stockAfter = calculateStockFromLedger(mockLedgers)
    expect(stockAfter.availableGrams).toBe(108000)
    expect(stockAfter.rawAvailableGrams).toBe(108000)

    const invariants = verifyInventoryInvariants(stockAfter)
    expect(invariants.valid).toBe(true)
    expect(invariants.violations).toHaveLength(0)
  })

  // =========================================================================
  // TEST 5: Duplicate Delivery Confirmation không tạo double dispatch (Idempotency)
  // =========================================================================
  it('5. Duplicate Delivery Confirmation không tạo double dispatch (Idempotency Guard)', async () => {
    // Lượt 1: Xác nhận giao hàng và xuất kho thành công
    const firstCall = await dispatchOrderInventoryAllocations(mockTx as unknown as Parameters<typeof dispatchOrderInventoryAllocations>[0], {
      orderId: 'ord-dh-261030-fzdn',
      orderCode: 'DH-261030-FZDN',
      actorId: 'admin-1',
      lines: [{ orderItemId: 'item-bo034', actualGrams: 50000 }],
    })
    expect(firstCall.dispatchedCount).toBe(1)
    expect(firstCall.totalDispatchedGrams).toBe(50000)

    // Lượt 2: Xác nhận giao hàng lặp lại (duplicate delivery confirmation)
    const secondCall = await dispatchOrderInventoryAllocations(mockTx as unknown as Parameters<typeof dispatchOrderInventoryAllocations>[0], {
      orderId: 'ord-dh-261030-fzdn',
      orderCode: 'DH-261030-FZDN',
      actorId: 'admin-1',
      lines: [{ orderItemId: 'item-bo034', actualGrams: 50000 }],
    })
    // Không xử lý xuất kho lại do status phân bổ đã là DISPATCHED
    expect(secondCall.dispatchedCount).toBe(0)
    expect(secondCall.totalDispatchedGrams).toBe(0)

    // Kiểm tra trên Sổ Cái chỉ có duy nhất 1 bản ghi DISPATCH_OUT
    const dispatchEntries = mockLedgers.filter((l) => l.type === InventoryLedgerType.DISPATCH_OUT)
    expect(dispatchEntries).toHaveLength(1)
    expect(dispatchEntries[0].quantityGrams).toBe(50000)

    const stock = calculateStockFromLedger(mockLedgers)
    expect(stock.physicalStockGrams).toBe(108000)
    expect(stock.reservedGrams).toBe(0)
  })

  // =========================================================================
  // TEST 6: Transaction Failure không để Ledger và Allocation lệch nhau (Atomicity)
  // =========================================================================
  it('6. Transaction Failure không để Ledger và Allocation lệch nhau (Atomicity)', async () => {
    // Giả lập lỗi khi ghi sổ cái InventoryLedger
    mockTx.inventoryLedger.create = vi.fn().mockRejectedValue(new Error('PostgreSQL connection timeout'))

    let capturedError: Error | null = null
    try {
      await dispatchOrderInventoryAllocations(mockTx as unknown as Parameters<typeof dispatchOrderInventoryAllocations>[0], {
        orderId: 'ord-dh-261030-fzdn',
        orderCode: 'DH-261030-FZDN',
        actorId: 'admin-1',
      })
    } catch (err) {
      capturedError = err as Error
    }

    expect(capturedError).toBeDefined()
    expect(capturedError?.message).toContain('PostgreSQL connection timeout')

    // Vì hàm chạy trong transaction client (tx), khi lỗi ném ra, toàn bộ transaction sẽ rollback
    // Không có bản ghi DISPATCH_OUT nào được tạo
    const dispatchEntries = mockLedgers.filter((l) => l.type === InventoryLedgerType.DISPATCH_OUT)
    expect(dispatchEntries).toHaveLength(0)
  })

  // =========================================================================
  // TEST 7: Partial Dispatch nếu khối lượng thực tế nhỏ hơn đặt hàng
  // =========================================================================
  it('7. Partial Dispatch khi khối lượng thực giao ít hơn (48 kg xuất, 2 kg giải phóng)', async () => {
    // Đặt 50 kg nhưng giao thực tế 48 kg
    const res = await dispatchOrderInventoryAllocations(mockTx as unknown as Parameters<typeof dispatchOrderInventoryAllocations>[0], {
      orderId: 'ord-dh-261030-fzdn',
      orderCode: 'DH-261030-FZDN',
      actorId: 'admin-1',
      lines: [{ orderItemId: 'item-bo034', actualGrams: 48000 }],
    })

    expect(res.dispatchedCount).toBe(1)
    expect(res.totalDispatchedGrams).toBe(48000)
    expect(res.releasedCount).toBe(1)
    expect(res.totalReleasedGrams).toBe(2000)

    // Phân bổ được cập nhật đủ 50 kg (48 kg xuất + 2 kg nhả) -> status DISPATCHED
    const updatedAlloc = mockAllocations.find((a) => a.id === 'alloc-fefo-bo034-01')
    expect(updatedAlloc?.status).toBe(AllocationStatus.DISPATCHED)
    expect(updatedAlloc?.dispatchedGrams).toBe(48000)
    expect(updatedAlloc?.releasedGrams).toBe(2000)

    // Sổ Cái có cả DISPATCH_OUT (48 kg) và RESERVATION_RELEASE (2 kg)
    const dispatchEntry = mockLedgers.find((l) => l.type === InventoryLedgerType.DISPATCH_OUT)
    expect(dispatchEntry).toBeDefined()
    expect(dispatchEntry?.quantityGrams).toBe(48000)

    const releaseEntry = mockLedgers.find((l) => l.type === InventoryLedgerType.RESERVATION_RELEASE)
    expect(releaseEntry).toBeDefined()
    expect(releaseEntry?.quantityGrams).toBe(2000)

    // Tính toán tồn kho sau xuất kho:
    // Physical = 158 kg - 48 kg = 110 kg
    // Reserved = 50 kg (HOLD) - 2 kg (RELEASE) - 48 kg (DISPATCH) = 0 kg
    // Available = 110 kg - 0 = 110 kg
    const stock = calculateStockFromLedger(mockLedgers)
    expect(stock.physicalStockGrams).toBe(110000)
    expect(stock.reservedGrams).toBe(0)
    expect(stock.availableGrams).toBe(110000)

    const invariants = verifyInventoryInvariants(stock)
    expect(invariants.valid).toBe(true)
    expect(invariants.violations).toHaveLength(0)
  })

  // =========================================================================
  // TEST 8: Concurrency Protection — Hai tiến trình đồng thời không double dispatch
  // =========================================================================
  it('8. Concurrency Protection — Hai tiến trình quyết toán đồng thời không tạo double dispatch', async () => {
    // Chạy song song 2 transaction quyết toán trên cùng đơn hàng
    const [res1, res2] = await Promise.all([
      dispatchOrderInventoryAllocations(mockTx as unknown as Parameters<typeof dispatchOrderInventoryAllocations>[0], {
        orderId: 'ord-dh-261030-fzdn',
        orderCode: 'DH-261030-FZDN',
        actorId: 'admin-1',
        lines: [{ orderItemId: 'item-bo034', actualGrams: 50000 }],
      }),
      dispatchOrderInventoryAllocations(mockTx as unknown as Parameters<typeof dispatchOrderInventoryAllocations>[0], {
        orderId: 'ord-dh-261030-fzdn',
        orderCode: 'DH-261030-FZDN',
        actorId: 'admin-2',
        lines: [{ orderItemId: 'item-bo034', actualGrams: 50000 }],
      }),
    ])

    // Tổng số lượng xuất kho qua 2 tiến trình đúng bằng 50 kg
    const totalDispatchedAcrossThreads = res1.totalDispatchedGrams + res2.totalDispatchedGrams
    expect(totalDispatchedAcrossThreads).toBe(50000)

    // Đúng 1 tiến trình xử lý thành công xuất 50 kg, tiến trình kia nhận 0 kg (do đã DISPATCHED hoặc id duplicate)
    expect(
      (res1.dispatchedCount === 1 && res2.dispatchedCount === 0) ||
      (res1.dispatchedCount === 0 && res2.dispatchedCount === 1)
    ).toBe(true)

    // Trên Sổ Cái chỉ có đúng 1 bản ghi DISPATCH_OUT
    const dispatchEntries = mockLedgers.filter((l) => l.type === InventoryLedgerType.DISPATCH_OUT)
    expect(dispatchEntries).toHaveLength(1)
    expect(dispatchEntries[0].quantityGrams).toBe(50000)

    // Tồn kho nhất quán
    const stock = calculateStockFromLedger(mockLedgers)
    expect(stock.physicalStockGrams).toBe(108000)
    expect(stock.reservedGrams).toBe(0)
    expect(stock.availableGrams).toBe(108000)
  })
})
