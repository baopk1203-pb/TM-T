import { describe, expect, it } from 'vitest'
import { BatchStatus, InventoryLedgerType } from '@prisma/client'
import {
  buildPublicStockView,
  evaluateBatchExpiryAlert,
  evaluateBatchInventory,
  evaluateCartItemStockWarning,
  evaluateProductInventory,
  evaluateProductStockAlert,
  formatAvailableKgNumber,
  formatAvailableKgWithUnit,
  getLedgerTypePresentation,
  gramsToSafeDisplayKg,
  sortEvaluatedBatchesForAdmin,
  type BatchInventorySnapshotInput,
} from '@/lib/domain/inventory-view'

const REF_DATE = new Date('2026-10-25T15:00:00.000Z') // 22:00 ngày 25/10/2026 GMT+7

function createBaseBatchInput(
  overrides: Partial<BatchInventorySnapshotInput> = {}
): BatchInventorySnapshotInput {
  return {
    id: 'batch-1',
    code: 'F01C-SR6-202610-A',
    productId: 'prod-sr6',
    productName: 'Sầu riêng Ri6 Cai Lậy',
    productSlug: 'sau-rieng-ri6',
    productTrackingEnabled: true,
    farmId: 'farm-1',
    farmName: 'Vườn Sầu Riêng Ba Tuấn',
    harvestDate: new Date('2026-10-24T00:00:00.000Z'),
    expiryDate: new Date('2026-11-05T00:00:00.000Z'),
    receivedAt: new Date('2026-10-25T00:00:00.000Z'),
    status: BatchStatus.ACTIVE,
    isFefoEligible: true,
    initialQuantityGrams: 120_000,
    harvestGrams: 120_000,
    qcNotes: 'Đạt chuẩn VietGAP',
    createdAt: new Date('2026-10-25T00:00:00.000Z'),
    ledgerEntries: [
      {
        type: InventoryLedgerType.IMPORT,
        quantityGrams: 120_000,
      },
    ],
    allocations: [],
    ...overrides,
  }
}

describe('EV-IMP-01D — Group A: Stock Calculation & Shared Read Engine', () => {
  it('A1. 1 lô ACTIVE có IMPORT -> Physical = Available, Reserved = 0', () => {
    const evaluated = evaluateBatchInventory(createBaseBatchInput(), REF_DATE)
    expect(evaluated.physicalStockGrams).toBe(120_000)
    expect(evaluated.reservedGrams).toBe(0)
    expect(evaluated.sellableAvailableGrams).toBe(120_000)
    expect(evaluated.ineligibleStockGrams).toBe(0)
    expect(evaluated.fefoEligibility.eligible).toBe(true)
  })

  it('A2. Lô có RESERVATION_HOLD -> Reserved tăng, Available giảm tương ứng', () => {
    const evaluated = evaluateBatchInventory(
      createBaseBatchInput({
        ledgerEntries: [
          { type: InventoryLedgerType.IMPORT, quantityGrams: 120_000 },
          { type: InventoryLedgerType.RESERVATION_HOLD, quantityGrams: 70_000 },
        ],
        allocations: [
          {
            allocatedGrams: 70_000,
            dispatchedGrams: 0,
            releasedGrams: 0,
            status: 'HOLD_PENDING',
            holdExpiresAt: new Date('2026-10-25T15:10:00.000Z'),
          },
        ],
      }),
      REF_DATE
    )

    expect(evaluated.physicalStockGrams).toBe(120_000)
    expect(evaluated.reservedGrams).toBe(70_000)
    expect(evaluated.sellableAvailableGrams).toBe(50_000)
    expect(evaluated.anomalies).toHaveLength(0)
  })

  it('A3. Lô có RESERVATION_RELEASE -> Reserved giảm, Available phục hồi về 100%', () => {
    const evaluated = evaluateBatchInventory(
      createBaseBatchInput({
        ledgerEntries: [
          { type: InventoryLedgerType.IMPORT, quantityGrams: 120_000 },
          { type: InventoryLedgerType.RESERVATION_HOLD, quantityGrams: 70_000 },
          { type: InventoryLedgerType.RESERVATION_RELEASE, quantityGrams: 70_000 },
        ],
        allocations: [
          {
            allocatedGrams: 70_000,
            dispatchedGrams: 0,
            releasedGrams: 70_000,
            status: 'RELEASED',
          },
        ],
      }),
      REF_DATE
    )

    expect(evaluated.physicalStockGrams).toBe(120_000)
    expect(evaluated.reservedGrams).toBe(0)
    expect(evaluated.sellableAvailableGrams).toBe(120_000)
    expect(evaluated.anomalies).toHaveLength(0)
  })

  it('A4. Lô có DISPATCH_OUT -> Physical giảm, Reserved giảm', () => {
    const evaluated = evaluateBatchInventory(
      createBaseBatchInput({
        ledgerEntries: [
          { type: InventoryLedgerType.IMPORT, quantityGrams: 120_000 },
          { type: InventoryLedgerType.RESERVATION_HOLD, quantityGrams: 50_000 },
          { type: InventoryLedgerType.DISPATCH_OUT, quantityGrams: 50_000 },
        ],
        allocations: [
          {
            allocatedGrams: 50_000,
            dispatchedGrams: 50_000,
            releasedGrams: 0,
            status: 'DISPATCHED',
          },
        ],
      }),
      REF_DATE
    )

    expect(evaluated.physicalStockGrams).toBe(70_000)
    expect(evaluated.reservedGrams).toBe(0)
    expect(evaluated.dispatchedGrams).toBe(50_000)
    expect(evaluated.sellableAvailableGrams).toBe(70_000)
  })

  it('A5. Lô UNVERIFIED -> Không được tính vào Available Stock', () => {
    const evaluated = evaluateBatchInventory(
      createBaseBatchInput({
        code: 'LO-261013-001',
        status: BatchStatus.UNVERIFIED,
        isFefoEligible: false,
        expiryDate: null,
        ledgerEntries: [],
        harvestGrams: 500_000,
      }),
      REF_DATE
    )

    expect(evaluated.fefoEligibility.eligible).toBe(false)
    expect(evaluated.sellableAvailableGrams).toBe(0)
  })

  it('A6. Lô EXPIRED (theo trạng thái hoặc ngày hết hạn) -> Không được tính vào Available Stock', () => {
    const evaluated = evaluateBatchInventory(
      createBaseBatchInput({
        expiryDate: new Date('2026-10-20T00:00:00.000Z'), // Đã quá hạn trước 25/10/2026
        ledgerEntries: [{ type: InventoryLedgerType.IMPORT, quantityGrams: 100_000 }],
      }),
      REF_DATE
    )

    expect(evaluated.physicalStockGrams).toBe(100_000)
    expect(evaluated.fefoEligibility.eligible).toBe(false)
    expect(evaluated.fefoEligibility.reason).toBe('BATCH_EXPIRED')
    expect(evaluated.sellableAvailableGrams).toBe(0)
    expect(evaluated.ineligibleStockGrams).toBe(100_000)
  })

  it('A7. Lô isFefoEligible = false -> Không được tính vào Available Stock dù có tồn sổ cái', () => {
    const evaluated = evaluateBatchInventory(
      createBaseBatchInput({
        isFefoEligible: false,
        ledgerEntries: [{ type: InventoryLedgerType.IMPORT, quantityGrams: 80_000 }],
      }),
      REF_DATE
    )

    expect(evaluated.physicalStockGrams).toBe(80_000)
    expect(evaluated.sellableAvailableGrams).toBe(0)
    expect(evaluated.ineligibleStockGrams).toBe(80_000)
  })

  it('A8. Sản phẩm nhiều lô -> Available Stock bằng tổng các lô ACTIVE hợp lệ', () => {
    const productInv = evaluateProductInventory({
      productId: 'prod-sr6',
      name: 'Sầu riêng Ri6 Cai Lậy',
      slug: 'sau-rieng-ri6',
      category: 'Sầu riêng',
      farmId: 'farm-1',
      farmName: 'Vườn Ba Tuấn',
      inventoryTrackingEnabled: true,
      moqGrams: 50_000,
      isActive: true,
      referenceDate: REF_DATE,
      batches: [
        createBaseBatchInput({
          id: 'b-a',
          code: 'F01C-SR6-202610-A',
          expiryDate: new Date('2026-11-02T00:00:00.000Z'),
          ledgerEntries: [{ type: InventoryLedgerType.IMPORT, quantityGrams: 120_000 }],
        }),
        createBaseBatchInput({
          id: 'b-b',
          code: 'F01C-SR6-202610-B',
          expiryDate: new Date('2026-11-08T00:00:00.000Z'),
          ledgerEntries: [{ type: InventoryLedgerType.IMPORT, quantityGrams: 180_000 }],
        }),
        createBaseBatchInput({
          id: 'b-hist',
          code: 'LO-261013-001',
          status: BatchStatus.UNVERIFIED,
          isFefoEligible: false,
          expiryDate: null,
          ledgerEntries: [],
          harvestGrams: 500_000,
        }),
      ],
    })

    expect(productInv.eligibleActiveBatchesCount).toBe(2)
    expect(productInv.unverifiedBatchesCount).toBe(1)
    expect(productInv.physicalStockGrams).toBe(300_000)
    expect(productInv.reservedStockGrams).toBe(0)
    expect(productInv.availableStockGrams).toBe(300_000)
    expect(productInv.publicStock.availableGrams).toBe(300_000)
    expect(productInv.publicStock.availableKg).toBe(300)
  })
})

describe('EV-IMP-01D — Group B: Expiry & Low-Stock Alert Classification', () => {
  it('B1. Lô có expiryDate < hôm nay -> Đã hết hạn (EXPIRED)', () => {
    const alert = evaluateBatchExpiryAlert(new Date('2026-10-24T00:00:00.000Z'), REF_DATE)
    expect(alert.level).toBe('EXPIRED')
    expect(alert.isExpired).toBe(true)
    expect(alert.daysRemaining).toBe(-1)
  })

  it('B2. Lô còn hạn trong 3 ngày -> Sắp hết hạn khẩn (EXPIRING_3_DAYS)', () => {
    const alert = evaluateBatchExpiryAlert(new Date('2026-10-27T00:00:00.000Z'), REF_DATE)
    expect(alert.level).toBe('EXPIRING_3_DAYS')
    expect(alert.isExpiringSoon).toBe(true)
    expect(alert.daysRemaining).toBe(2)
  })

  it('B3. Lô còn hạn trong 4..7 ngày -> Cảnh báo sắp hết hạn (EXPIRING_7_DAYS)', () => {
    const alert = evaluateBatchExpiryAlert(new Date('2026-10-31T00:00:00.000Z'), REF_DATE)
    expect(alert.level).toBe('EXPIRING_7_DAYS')
    expect(alert.isExpiringSoon).toBe(true)
    expect(alert.daysRemaining).toBe(6)
  })

  it('B4. Lô có expiryDate = null -> Không xác định hạn dùng (UNKNOWN_EXPIRY)', () => {
    const alert = evaluateBatchExpiryAlert(null, REF_DATE)
    expect(alert.level).toBe('UNKNOWN_EXPIRY')
    expect(alert.daysRemaining).toBeNull()
  })

  it('B5. Sản phẩm có available = 0 -> Hết tồn khả dụng (OUT_OF_STOCK)', () => {
    const alert = evaluateProductStockAlert({
      inventoryTrackingEnabled: true,
      availableGrams: 0,
      moqGrams: 50_000,
    })
    expect(alert.level).toBe('OUT_OF_STOCK')
    expect(alert.label).toBe('Hết tồn khả dụng')
  })

  it('B6. Sản phẩm có 0 < available < moqGrams -> Tồn thấp dưới MOQ (BELOW_MOQ)', () => {
    const alert = evaluateProductStockAlert({
      inventoryTrackingEnabled: true,
      availableGrams: 15_000,
      moqGrams: 20_000,
    })
    expect(alert.level).toBe('BELOW_MOQ')
    expect(alert.label).toBe('Tồn thấp (Dưới MOQ)')
  })
})

describe('EV-IMP-01D — Group C: Public Stock View (Storefront Contract)', () => {
  it('C1. Sản phẩm bật tracking có 300,000 g -> Hiển thị "Còn 300 kg trong kho" & đặt hàng được', () => {
    const view = buildPublicStockView({
      productId: 'prod-sr6',
      inventoryTrackingEnabled: true,
      availableGrams: 300_000,
      moqGrams: 50_000,
      observedAt: REF_DATE,
    })

    expect(view.tracked).toBe(true)
    expect(view.status).toBe('IN_STOCK')
    expect(view.availableGrams).toBe(300_000)
    expect(view.availableKg).toBe(300)
    expect(view.isOrderable).toBe(true)
    expect(view.detailLabel).toBe('Còn 300 kg trong kho')
    expect(view.cardBadgeLabel).toBe('Còn 300 kg')
  })

  it('C2. Sản phẩm bật tracking có 0 g -> Hiển thị "Hết hàng — 0 kg khả dụng" & không cho đặt', () => {
    const view = buildPublicStockView({
      productId: 'prod-sr6',
      inventoryTrackingEnabled: true,
      availableGrams: 0,
      moqGrams: 50_000,
      observedAt: REF_DATE,
    })

    expect(view.tracked).toBe(true)
    expect(view.status).toBe('OUT_OF_STOCK')
    expect(view.availableGrams).toBe(0)
    expect(view.availableKg).toBe(0)
    expect(view.isOrderable).toBe(false)
    expect(view.detailLabel).toBe('Hết hàng — 0 kg khả dụng')
    expect(view.cardBadgeLabel).toBe('Hết hàng')
  })

  it('C3. Sản phẩm bật tracking có available < MOQ -> Hiển thị rõ tồn thực tế & chưa đủ MOQ', () => {
    const view = buildPublicStockView({
      productId: 'prod-bo',
      inventoryTrackingEnabled: true,
      availableGrams: 15_000,
      moqGrams: 20_000,
      observedAt: REF_DATE,
    })

    expect(view.tracked).toBe(true)
    expect(view.status).toBe('BELOW_MOQ')
    expect(view.availableGrams).toBe(15_000)
    expect(view.availableKg).toBe(15)
    expect(view.isOrderable).toBe(false)
    expect(view.detailLabel).toBe('Hiện còn 15 kg, chưa đủ số lượng đặt tối thiểu 20 kg')
    expect(view.cardBadgeLabel).toBe('Còn 15 kg')
  })

  it('C4. Sản phẩm chưa bật tracking (5 sản phẩm còn lại) -> Không hiển thị 0 kg giả tạo, cho đặt bình thường', () => {
    const view = buildPublicStockView({
      productId: 'prod-xoai',
      inventoryTrackingEnabled: false,
      availableGrams: 0,
      moqGrams: 50_000,
      observedAt: REF_DATE,
    })

    expect(view.tracked).toBe(false)
    expect(view.status).toBe('UNTRACKED')
    expect(view.availableGrams).toBeNull()
    expect(view.availableKg).toBeNull()
    expect(view.isOrderable).toBe(true)
    expect(view.detailLabel).toBeNull()
    expect(view.cardBadgeLabel).toBeNull()
  })

  it('C5. Quy đổi gram sang kg chính xác và TUYỆT ĐỐI KHÔNG làm tròn lên (Math.ceil bị cấm)', () => {
    expect(gramsToSafeDisplayKg(135_500)).toBe(135.5)
    expect(formatAvailableKgNumber(135_500)).toBe('135.5')
    expect(formatAvailableKgWithUnit(135_500)).toBe('135.5 kg')

    // 135,999 gram = 135.999 kg -> phải làm tròn xuống 135.99 kg, tuyệt đối không làm tròn lên 136 kg
    expect(gramsToSafeDisplayKg(135_999)).toBe(135.99)
    expect(formatAvailableKgNumber(135_999)).toBe('135.99')
  })
})

describe('EV-IMP-01D — Group D: Admin & Storefront 100% Consistency on Beta Baseline (550 kg)', () => {
  it('D1. Cùng bộ dữ liệu 3 sản phẩm FEFO (300 kg + 170 kg + 80 kg = 550 kg) cho kết quả khớp tuyệt đối giữa Admin và Storefront', () => {
    const sr6 = evaluateProductInventory({
      productId: 'prod-sr6',
      name: 'Sầu riêng Ri6 Cai Lậy',
      slug: 'sau-rieng-ri6',
      category: 'Sầu riêng',
      farmId: 'farm-1',
      farmName: 'Vườn Ba Tuấn',
      inventoryTrackingEnabled: true,
      moqGrams: 50_000,
      isActive: true,
      referenceDate: REF_DATE,
      batches: [
        createBaseBatchInput({
          id: 'sr6-a',
          code: 'F01C-SR6-202610-A',
          ledgerEntries: [{ type: InventoryLedgerType.IMPORT, quantityGrams: 120_000 }],
        }),
        createBaseBatchInput({
          id: 'sr6-b',
          code: 'F01C-SR6-202610-B',
          ledgerEntries: [{ type: InventoryLedgerType.IMPORT, quantityGrams: 180_000 }],
        }),
        createBaseBatchInput({
          id: 'sr6-hist',
          code: 'LO-261013-001',
          status: BatchStatus.UNVERIFIED,
          isFefoEligible: false,
          expiryDate: null,
          ledgerEntries: [],
        }),
      ],
    })

    const bdx = evaluateProductInventory({
      productId: 'prod-bdx',
      name: 'Bưởi da xanh Bến Tre',
      slug: 'buoi-da-xanh-ben-tre',
      category: 'Bưởi',
      farmId: 'farm-2',
      farmName: 'HTX Bến Tre',
      inventoryTrackingEnabled: true,
      moqGrams: 50_000,
      isActive: true,
      referenceDate: REF_DATE,
      batches: [
        createBaseBatchInput({
          id: 'bdx-a',
          code: 'F01C-BDX-202610-A',
          ledgerEntries: [{ type: InventoryLedgerType.IMPORT, quantityGrams: 80_000 }],
        }),
        createBaseBatchInput({
          id: 'bdx-b',
          code: 'F01C-BDX-202610-B',
          ledgerEntries: [{ type: InventoryLedgerType.IMPORT, quantityGrams: 90_000 }],
        }),
        createBaseBatchInput({
          id: 'bdx-hist',
          code: 'LO-261013-002',
          status: BatchStatus.UNVERIFIED,
          isFefoEligible: false,
          expiryDate: null,
          ledgerEntries: [],
        }),
      ],
    })

    const bo034 = evaluateProductInventory({
      productId: 'prod-bo',
      name: 'Bơ 034 Tây Nguyên',
      slug: 'bo-034-tay-nguyen',
      category: 'Bơ',
      farmId: 'farm-3',
      farmName: 'Nông Trại Đắk Lắk',
      inventoryTrackingEnabled: true,
      moqGrams: 20_000,
      isActive: true,
      referenceDate: REF_DATE,
      batches: [
        createBaseBatchInput({
          id: 'bo-a',
          code: 'F01C-BO034-202610-A',
          ledgerEntries: [{ type: InventoryLedgerType.IMPORT, quantityGrams: 30_000 }],
        }),
        createBaseBatchInput({
          id: 'bo-b',
          code: 'F01C-BO034-202610-B',
          ledgerEntries: [{ type: InventoryLedgerType.IMPORT, quantityGrams: 50_000 }],
        }),
        createBaseBatchInput({
          id: 'bo-hist',
          code: 'LO-261013-003',
          status: BatchStatus.UNVERIFIED,
          isFefoEligible: false,
          expiryDate: null,
          ledgerEntries: [],
        }),
      ],
    })

    // Đối chiếu Admin Available vs Storefront PublicStock Available
    expect(sr6.availableStockGrams).toBe(300_000)
    expect(sr6.publicStock.availableGrams).toBe(sr6.availableStockGrams)
    expect(sr6.publicStock.detailLabel).toBe('Còn 300 kg trong kho')

    expect(bdx.availableStockGrams).toBe(170_000)
    expect(bdx.publicStock.availableGrams).toBe(bdx.availableStockGrams)
    expect(bdx.publicStock.detailLabel).toBe('Còn 170 kg trong kho')

    expect(bo034.availableStockGrams).toBe(80_000)
    expect(bo034.publicStock.availableGrams).toBe(bo034.availableStockGrams)
    expect(bo034.publicStock.detailLabel).toBe('Còn 80 kg trong kho')

    const totalAvailableGrams =
      sr6.availableStockGrams + bdx.availableStockGrams + bo034.availableStockGrams
    expect(totalAvailableGrams).toBe(550_000)
  })

  it('D2. Sắp xếp lô trong Admin ưu tiên lô FEFO theo expiryDate ASC -> harvestDate ASC -> code ASC và tách lô UNVERIFIED xuống cuối', () => {
    const bLate = evaluateBatchInventory(
      createBaseBatchInput({
        id: '2',
        code: 'F01C-SR6-202610-B',
        expiryDate: new Date('2026-11-10T00:00:00.000Z'),
      }),
      REF_DATE
    )
    const bEarly = evaluateBatchInventory(
      createBaseBatchInput({
        id: '1',
        code: 'F01C-SR6-202610-A',
        expiryDate: new Date('2026-11-03T00:00:00.000Z'),
      }),
      REF_DATE
    )
    const bUnverified = evaluateBatchInventory(
      createBaseBatchInput({
        id: '3',
        code: 'LO-261013-001',
        status: BatchStatus.UNVERIFIED,
        isFefoEligible: false,
        expiryDate: null,
        ledgerEntries: [],
      }),
      REF_DATE
    )

    const sorted = sortEvaluatedBatchesForAdmin([bLate, bUnverified, bEarly])
    expect(sorted.map((b) => b.code)).toEqual([
      'F01C-SR6-202610-A',
      'F01C-SR6-202610-B',
      'LO-261013-001',
    ])
  })
})

describe('EV-IMP-01D — Group E: Cart Stock Warnings & Data Anomaly Detection', () => {
  it('E1. Giỏ hàng đặt vượt tồn khả dụng trả về đúng thông báo chuẩn mà không tự sửa số lượng', () => {
    const publicStock = buildPublicStockView({
      productId: 'prod-bo',
      inventoryTrackingEnabled: true,
      availableGrams: 80_000,
      moqGrams: 20_000,
      observedAt: REF_DATE,
    })

    const okCheck = evaluateCartItemStockWarning({
      productName: 'Bơ 034 Tây Nguyên',
      requestedGrams: 80_000,
      publicStock,
    })
    expect(okCheck.exceedsStock).toBe(false)
    expect(okCheck.warningMessage).toBeNull()

    const exceedCheck = evaluateCartItemStockWarning({
      productName: 'Bơ 034 Tây Nguyên',
      requestedGrams: 90_000,
      publicStock,
    })
    expect(exceedCheck.exceedsStock).toBe(true)
    expect(exceedCheck.warningMessage).toBe(
      'Kho hiện chỉ còn 80 kg Bơ 034 Tây Nguyên. Vui lòng giảm số lượng đặt.'
    )
  })

  it('E2. Phát hiện bất thường khi tổng OrderItemBatchAllocation không khớp số dư giữ chỗ trên InventoryLedger', () => {
    const evaluated = evaluateBatchInventory(
      createBaseBatchInput({
        ledgerEntries: [
          { type: InventoryLedgerType.IMPORT, quantityGrams: 100_000 },
          { type: InventoryLedgerType.RESERVATION_HOLD, quantityGrams: 40_000 },
        ],
        allocations: [
          {
            allocatedGrams: 20_000, // Lệch với 40_000 trên sổ cái
            dispatchedGrams: 0,
            releasedGrams: 0,
            status: 'HOLD_PENDING',
          },
        ],
      }),
      REF_DATE
    )

    expect(evaluated.anomalies.some((a) => a.code === 'ALLOCATION_LEDGER_MISMATCH')).toBe(true)
  })

  it('E3. Hiển thị đúng nhãn giao dịch cho mọi loại InventoryLedgerType', () => {
    expect(getLedgerTypePresentation(InventoryLedgerType.IMPORT).sign).toBe('+')
    expect(getLedgerTypePresentation(InventoryLedgerType.RESERVATION_HOLD).sign).toBe('HOLD')
    expect(getLedgerTypePresentation(InventoryLedgerType.RESERVATION_RELEASE).sign).toBe('RELEASE')
    expect(getLedgerTypePresentation(InventoryLedgerType.DISPATCH_OUT).sign).toBe('-')
  })
})
