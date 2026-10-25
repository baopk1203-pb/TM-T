/**
 * MODULE F — SHARED INVENTORY READ SERVICE (F01D)
 *
 * Nguồn đọc tồn kho duy nhất (Single Shared Inventory Read Service) dùng chung cho:
 * 1. Storefront Public Stock Visibility (/san-pham, /san-pham/[slug], /gio-hang, /thanh-toan)
 * 2. Admin Inventory Dashboard (/admin/ton-kho)
 * 3. Admin FEFO Batch Management (/admin/lo-hang)
 * 4. Admin Inventory Ledger History (/admin/ton-kho/lich-su)
 *
 * CAM KẾT AN TOÀN DỮ LIỆU:
 * - STRICT READ-ONLY: Chỉ thực hiện truy vấn đọc (SELECT / findMany / findUnique / count).
 * - Không bao giờ tạo mutation qua GET request hoặc hàm đọc.
 * - Không gây N+1 query khi tải danh sách sản phẩm hay lô hàng.
 */

import { BatchStatus, InventoryLedgerType, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  buildPublicStockView,
  evaluateBatchInventory,
  evaluateProductInventory,
  sortEvaluatedBatchesForAdmin,
  type BatchInventorySnapshotInput,
  type EvaluatedBatchInventory,
  type EvaluatedProductInventory,
  type PublicStockView,
} from '@/lib/domain/inventory-view'

// ============================================================================
// 1. STOREFRONT & SHARED PUBLIC STOCK READS (BULK, NO N+1)
// ============================================================================

/**
 * Lấy thông tin tồn kho công khai (`PublicStockView`) cho danh sách `productIds` trong 1 lượt truy vấn.
 * Đảm bảo không phát sinh N+1 query trên trang danh sách sản phẩm, trang chủ, giỏ hàng và checkout.
 */
export async function getPublicStockByProductIds(
  productIds: string[],
  referenceDate: Date = new Date()
): Promise<Record<string, PublicStockView>> {
  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)))
  if (uniqueIds.length === 0) {
    return {}
  }

  const products = await db.product.findMany({
    where: { id: { in: uniqueIds } },
    select: {
      id: true,
      name: true,
      slug: true,
      farmId: true,
      inventoryTrackingEnabled: true,
      moqGrams: true,
      isActive: true,
      farm: {
        select: { name: true },
      },
      batches: {
        where: {
          status: BatchStatus.ACTIVE,
          isFefoEligible: true,
        },
        select: {
          id: true,
          code: true,
          harvestDate: true,
          expiryDate: true,
          status: true,
          isFefoEligible: true,
          quantityGrams: true,
          harvestGrams: true,
          qcNotes: true,
          createdAt: true,
          ledgerEntries: {
            select: {
              type: true,
              quantityGrams: true,
            },
          },
          allocations: {
            where: {
              status: { in: ['HOLD_PENDING', 'ALLOCATED_CONFIRMED', 'DISPATCHED'] },
            },
            select: {
              allocatedGrams: true,
              dispatchedGrams: true,
              releasedGrams: true,
              status: true,
              holdExpiresAt: true,
            },
          },
        },
      },
    },
  })

  const result: Record<string, PublicStockView> = {}

  for (const product of products) {
    if (!product.inventoryTrackingEnabled) {
      result[product.id] = buildPublicStockView({
        productId: product.id,
        inventoryTrackingEnabled: false,
        availableGrams: null,
        moqGrams: product.moqGrams,
        observedAt: referenceDate,
      })
      continue
    }

    const batchInputs: BatchInventorySnapshotInput[] = product.batches.map((b) => ({
      id: b.id,
      code: b.code,
      productId: product.id,
      productName: product.name,
      productSlug: product.slug,
      productTrackingEnabled: product.inventoryTrackingEnabled,
      farmId: product.farmId,
      farmName: product.farm.name,
      harvestDate: b.harvestDate,
      expiryDate: b.expiryDate,
      receivedAt: b.createdAt,
      status: b.status,
      isFefoEligible: b.isFefoEligible,
      initialQuantityGrams: b.quantityGrams,
      harvestGrams: b.harvestGrams,
      qcNotes: b.qcNotes,
      createdAt: b.createdAt,
      ledgerEntries: b.ledgerEntries,
      allocations: b.allocations,
    }))

    const evaluatedProduct = evaluateProductInventory({
      productId: product.id,
      name: product.name,
      slug: product.slug,
      farmId: product.farmId,
      farmName: product.farm.name,
      inventoryTrackingEnabled: product.inventoryTrackingEnabled,
      moqGrams: product.moqGrams,
      isActive: product.isActive,
      batches: batchInputs,
      referenceDate,
    })

    result[product.id] = evaluatedProduct.publicStock
  }

  return result
}

/**
 * Lấy thông tin tồn kho công khai cho 1 sản phẩm đơn lẻ.
 */
export async function getPublicStockForProduct(
  productId: string,
  referenceDate: Date = new Date()
): Promise<PublicStockView | null> {
  const map = await getPublicStockByProductIds([productId], referenceDate)
  return map[productId] ?? null
}

// ============================================================================
// 2. ADMIN INVENTORY DASHBOARD READ SERVICE (MODULE A & D)
// ============================================================================

export interface AdminInventoryDashboardData {
  observedAt: string
  kpis: {
    totalProductsCount: number
    trackedProductsCount: number
    untrackedProductsCount: number
    totalBatchesCount: number
    eligibleActiveBatchesCount: number
    unverifiedBatchesCount: number
    totalPhysicalStockGrams: number
    totalReservedStockGrams: number
    totalAvailableStockGrams: number
    totalIneligibleStockGrams: number
    totalDispatchedStockGrams: number
    expiringWithin3DaysBatchesCount: number
    expiringWithin7DaysBatchesCount: number
    expiredBatchesCount: number
    batchesWithAnomaliesCount: number
    lowStockProductsCount: number
  }
  products: EvaluatedProductInventory[]
  expiringAndExpiredBatches: EvaluatedBatchInventory[]
  batchesWithAnomalies: EvaluatedBatchInventory[]
}

/**
 * Truy vấn dữ liệu tổng quan tồn kho cho trang `/admin/ton-kho`.
 * Khớp 100% với công thức của Storefront Public Stock Visibility.
 */
export async function getAdminInventoryDashboardData(
  referenceDate: Date = new Date()
): Promise<AdminInventoryDashboardData> {
  const products = await db.product.findMany({
    orderBy: [{ inventoryTrackingEnabled: 'desc' }, { name: 'asc' }],
    include: {
      farm: {
        select: { id: true, name: true },
      },
      batches: {
        include: {
          ledgerEntries: {
            select: {
              type: true,
              quantityGrams: true,
            },
          },
          allocations: {
            select: {
              id: true,
              allocatedGrams: true,
              dispatchedGrams: true,
              releasedGrams: true,
              status: true,
              holdExpiresAt: true,
            },
          },
        },
      },
    },
  })

  const evaluatedProducts: EvaluatedProductInventory[] = []
  const allEvaluatedBatches: EvaluatedBatchInventory[] = []

  let totalPhysicalStockGrams = 0
  let totalReservedStockGrams = 0
  let totalAvailableStockGrams = 0
  let totalIneligibleStockGrams = 0
  let totalDispatchedStockGrams = 0

  let trackedProductsCount = 0
  let untrackedProductsCount = 0
  let eligibleActiveBatchesCount = 0
  let unverifiedBatchesCount = 0
  let expiringWithin3DaysBatchesCount = 0
  let expiringWithin7DaysBatchesCount = 0
  let expiredBatchesCount = 0
  let batchesWithAnomaliesCount = 0
  let lowStockProductsCount = 0

  for (const product of products) {
    if (product.inventoryTrackingEnabled) {
      trackedProductsCount += 1
    } else {
      untrackedProductsCount += 1
    }

    const batchInputs: BatchInventorySnapshotInput[] = product.batches.map((b) => ({
      id: b.id,
      code: b.code,
      productId: product.id,
      productName: product.name,
      productSlug: product.slug,
      productTrackingEnabled: product.inventoryTrackingEnabled,
      farmId: product.farm.id,
      farmName: product.farm.name,
      harvestDate: b.harvestDate,
      expiryDate: b.expiryDate,
      receivedAt: b.createdAt,
      status: b.status,
      isFefoEligible: b.isFefoEligible,
      initialQuantityGrams: b.quantityGrams,
      harvestGrams: b.harvestGrams,
      qcNotes: b.qcNotes,
      createdAt: b.createdAt,
      ledgerEntries: b.ledgerEntries,
      allocations: b.allocations,
    }))

    const evaluatedProduct = evaluateProductInventory({
      productId: product.id,
      name: product.name,
      slug: product.slug,
      farmId: product.farm.id,
      farmName: product.farm.name,
      inventoryTrackingEnabled: product.inventoryTrackingEnabled,
      moqGrams: product.moqGrams,
      isActive: product.isActive,
      batches: batchInputs,
      referenceDate,
    })

    evaluatedProducts.push(evaluatedProduct)

    if (product.inventoryTrackingEnabled) {
      totalPhysicalStockGrams += evaluatedProduct.physicalStockGrams
      totalReservedStockGrams += evaluatedProduct.reservedStockGrams
      totalAvailableStockGrams += evaluatedProduct.availableStockGrams
      totalIneligibleStockGrams += evaluatedProduct.ineligibleStockGrams
      totalDispatchedStockGrams += evaluatedProduct.dispatchedStockGrams

      if (
        evaluatedProduct.stockAlert.level === 'OUT_OF_STOCK' ||
        evaluatedProduct.stockAlert.level === 'BELOW_MOQ' ||
        evaluatedProduct.stockAlert.level === 'LOW_STOCK'
      ) {
        lowStockProductsCount += 1
      }
    }

    for (const batch of evaluatedProduct.batches) {
      allEvaluatedBatches.push(batch)
      if (batch.fefoEligibility.eligible) {
        eligibleActiveBatchesCount += 1
      }
      if (batch.status === 'UNVERIFIED') {
        unverifiedBatchesCount += 1
      }
      if (batch.isFefoEligible && batch.expiryAlert.level === 'EXPIRING_3_DAYS') {
        expiringWithin3DaysBatchesCount += 1
      }
      if (
        batch.isFefoEligible &&
        (batch.expiryAlert.level === 'EXPIRING_3_DAYS' ||
          batch.expiryAlert.level === 'EXPIRING_7_DAYS')
      ) {
        expiringWithin7DaysBatchesCount += 1
      }
      if (batch.isFefoEligible && batch.expiryAlert.isExpired) {
        expiredBatchesCount += 1
      }
      if (batch.anomalies.length > 0) {
        batchesWithAnomaliesCount += 1
      }
    }
  }

  const expiringAndExpiredBatches = sortEvaluatedBatchesForAdmin(
    allEvaluatedBatches.filter(
      (b) =>
        b.isFefoEligible &&
        (b.expiryAlert.isExpired ||
          b.expiryAlert.isExpiringSoon ||
          b.expiryAlert.level === 'UNKNOWN_EXPIRY')
    )
  )

  const batchesWithAnomalies = allEvaluatedBatches.filter((b) => b.anomalies.length > 0)

  return {
    observedAt: referenceDate.toISOString(),
    kpis: {
      totalProductsCount: products.length,
      trackedProductsCount,
      untrackedProductsCount,
      totalBatchesCount: allEvaluatedBatches.length,
      eligibleActiveBatchesCount,
      unverifiedBatchesCount,
      totalPhysicalStockGrams,
      totalReservedStockGrams,
      totalAvailableStockGrams,
      totalIneligibleStockGrams,
      totalDispatchedStockGrams,
      expiringWithin3DaysBatchesCount,
      expiringWithin7DaysBatchesCount,
      expiredBatchesCount,
      batchesWithAnomaliesCount,
      lowStockProductsCount,
    },
    products: evaluatedProducts,
    expiringAndExpiredBatches,
    batchesWithAnomalies,
  }
}

// ============================================================================
// 3. ADMIN BATCHES & BATCH DETAIL READ SERVICE (MODULE B)
// ============================================================================

export interface AdminBatchDetailView {
  batch: EvaluatedBatchInventory
  ledgerEntries: Array<{
    id: string
    type: InventoryLedgerType
    quantityGrams: number
    referenceCode: string | null
    idempotencyKey: string | null
    notes: string | null
    orderId: string | null
    orderCode: string | null
    createdAt: string
  }>
  allocations: Array<{
    id: string
    orderId: string
    orderCode: string
    orderStatus: string
    orderItemId: string
    allocatedGrams: number
    dispatchedGrams: number
    releasedGrams: number
    unreleasedGrams: number
    status: string
    holdExpiresAt: string | null
    releasedAt: string | null
    createdAt: string
  }>
}

/**
 * Lấy danh sách toàn bộ lô hàng kèm số dư FEFO và lịch sử sổ cái / giữ chỗ cho `/admin/lo-hang`.
 */
export async function getAdminBatchesInventoryView(
  referenceDate: Date = new Date()
): Promise<AdminBatchDetailView[]> {
  const batches = await db.batch.findMany({
    include: {
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          inventoryTrackingEnabled: true,
        },
      },
      farm: {
        select: {
          id: true,
          name: true,
        },
      },
      ledgerEntries: {
        orderBy: { createdAt: 'desc' },
        include: {
          order: {
            select: {
              id: true,
              code: true,
            },
          },
        },
      },
      allocations: {
        orderBy: { createdAt: 'desc' },
        include: {
          orderItem: {
            select: {
              id: true,
              orderId: true,
              order: {
                select: {
                  id: true,
                  code: true,
                  status: true,
                },
              },
            },
          },
        },
      },
    },
  })

  const evaluatedMap = new Map<string, AdminBatchDetailView>()
  const evaluatedList: EvaluatedBatchInventory[] = []

  for (const b of batches) {
    const evaluated = evaluateBatchInventory(
      {
        id: b.id,
        code: b.code,
        productId: b.product.id,
        productName: b.product.name,
        productSlug: b.product.slug,
        productTrackingEnabled: b.product.inventoryTrackingEnabled,
        farmId: b.farm.id,
        farmName: b.farm.name,
        harvestDate: b.harvestDate,
        expiryDate: b.expiryDate,
        receivedAt: b.createdAt,
        status: b.status,
        isFefoEligible: b.isFefoEligible,
        initialQuantityGrams: b.quantityGrams,
        harvestGrams: b.harvestGrams,
        qcNotes: b.qcNotes,
        createdAt: b.createdAt,
        ledgerEntries: b.ledgerEntries.map((l) => ({
          type: l.type,
          quantityGrams: l.quantityGrams,
        })),
        allocations: b.allocations.map((a) => ({
          id: a.id,
          orderId: a.orderItem.orderId,
          orderCode: a.orderItem.order.code,
          allocatedGrams: a.allocatedGrams,
          dispatchedGrams: a.dispatchedGrams,
          releasedGrams: a.releasedGrams,
          status: a.status,
          holdExpiresAt: a.holdExpiresAt,
          createdAt: a.createdAt,
        })),
      },
      referenceDate
    )

    evaluatedList.push(evaluated)

    evaluatedMap.set(b.id, {
      batch: evaluated,
      ledgerEntries: b.ledgerEntries.map((l) => ({
        id: l.id,
        type: l.type,
        quantityGrams: l.quantityGrams,
        referenceCode: l.referenceCode,
        idempotencyKey: l.idempotencyKey,
        notes: l.notes,
        orderId: l.orderId,
        orderCode: l.order?.code ?? null,
        createdAt: l.createdAt.toISOString(),
      })),
      allocations: b.allocations.map((a) => ({
        id: a.id,
        orderId: a.orderItem.orderId,
        orderCode: a.orderItem.order.code,
        orderStatus: a.orderItem.order.status,
        orderItemId: a.orderItemId,
        allocatedGrams: a.allocatedGrams,
        dispatchedGrams: a.dispatchedGrams,
        releasedGrams: a.releasedGrams,
        unreleasedGrams: Math.max(
          0,
          a.allocatedGrams - a.dispatchedGrams - a.releasedGrams
        ),
        status: a.status,
        holdExpiresAt: a.holdExpiresAt ? a.holdExpiresAt.toISOString() : null,
        releasedAt: a.releasedAt ? a.releasedAt.toISOString() : null,
        createdAt: a.createdAt.toISOString(),
      })),
    })
  }

  const sortedBatches = sortEvaluatedBatchesForAdmin(evaluatedList)
  return sortedBatches.map((sb) => evaluatedMap.get(sb.id)!).filter(Boolean)
}

// ============================================================================
// 4. ADMIN INVENTORY LEDGER HISTORY READ SERVICE (MODULE C)
// ============================================================================

export interface AdminLedgerHistoryFilter {
  productId?: string
  batchId?: string
  type?: InventoryLedgerType | 'ALL'
  dateFrom?: string
  dateTo?: string
  search?: string
  page?: number
  pageSize?: number
}

export interface AdminLedgerRecordView {
  id: string
  createdAt: string
  type: InventoryLedgerType
  quantityGrams: number
  batchId: string
  batchCode: string
  batchStatus: BatchStatus
  productId: string
  productName: string
  productSlug: string
  orderId: string | null
  orderCode: string | null
  orderStatus: string | null
  referenceCode: string | null
  idempotencyKey: string | null
  notes: string | null
}

export interface AdminLedgerHistoryResult {
  items: AdminLedgerRecordView[]
  pagination: {
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
  }
  filterOptions: {
    products: Array<{ id: string; name: string; trackingEnabled: boolean }>
    batches: Array<{ id: string; code: string; productName: string }>
  }
}

/**
 * Truy vấn lịch sử sổ cái kho (`InventoryLedger`) có phân trang và bộ lọc phía server cho `/admin/ton-kho/lich-su`.
 */
export async function getAdminInventoryLedgerHistory(
  filter: AdminLedgerHistoryFilter = {}
): Promise<AdminLedgerHistoryResult> {
  const page = Math.max(1, Math.trunc(filter.page || 1))
  const pageSize = Math.min(100, Math.max(10, Math.trunc(filter.pageSize || 25)))

  const where: Prisma.InventoryLedgerWhereInput = {}

  if (filter.batchId && filter.batchId !== 'ALL') {
    where.batchId = filter.batchId
  }

  if (filter.productId && filter.productId !== 'ALL') {
    where.batch = {
      productId: filter.productId,
    }
  }

  if (filter.type && filter.type !== 'ALL') {
    where.type = filter.type
  }

  if (filter.dateFrom || filter.dateTo) {
    const createdAtFilter: Prisma.DateTimeFilter = {}
    if (filter.dateFrom) {
      // Múi giờ Việt Nam UTC+7: đầu ngày 00:00:00+07:00
      const fromDate = new Date(`${filter.dateFrom}T00:00:00+07:00`)
      if (!Number.isNaN(fromDate.getTime())) {
        createdAtFilter.gte = fromDate
      }
    }
    if (filter.dateTo) {
      // Cuối ngày 23:59:59.999+07:00
      const toDate = new Date(`${filter.dateTo}T23:59:59.999+07:00`)
      if (!Number.isNaN(toDate.getTime())) {
        createdAtFilter.lte = toDate
      }
    }
    if (Object.keys(createdAtFilter).length > 0) {
      where.createdAt = createdAtFilter
    }
  }

  const trimmedSearch = filter.search?.trim()
  if (trimmedSearch) {
    where.OR = [
      { idempotencyKey: { contains: trimmedSearch, mode: 'insensitive' } },
      { referenceCode: { contains: trimmedSearch, mode: 'insensitive' } },
      { notes: { contains: trimmedSearch, mode: 'insensitive' } },
      { batch: { code: { contains: trimmedSearch, mode: 'insensitive' } } },
      { batch: { product: { name: { contains: trimmedSearch, mode: 'insensitive' } } } },
      { order: { code: { contains: trimmedSearch, mode: 'insensitive' } } },
    ]
  }

  const [totalItems, records, products, batches] = await Promise.all([
    db.inventoryLedger.count({ where }),
    db.inventoryLedger.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        batch: {
          select: {
            id: true,
            code: true,
            status: true,
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
        order: {
          select: {
            id: true,
            code: true,
            status: true,
          },
        },
      },
    }),
    db.product.findMany({
      orderBy: [{ inventoryTrackingEnabled: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        inventoryTrackingEnabled: true,
      },
    }),
    db.batch.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        code: true,
        product: {
          select: { name: true },
        },
      },
    }),
  ])

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))

  return {
    items: records.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      type: r.type,
      quantityGrams: r.quantityGrams,
      batchId: r.batch.id,
      batchCode: r.batch.code,
      batchStatus: r.batch.status,
      productId: r.batch.product.id,
      productName: r.batch.product.name,
      productSlug: r.batch.product.slug,
      orderId: r.order?.id ?? null,
      orderCode: r.order?.code ?? null,
      orderStatus: r.order?.status ?? null,
      referenceCode: r.referenceCode,
      idempotencyKey: r.idempotencyKey,
      notes: r.notes,
    })),
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
    },
    filterOptions: {
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        trackingEnabled: p.inventoryTrackingEnabled,
      })),
      batches: batches.map((b) => ({
        id: b.id,
        code: b.code,
        productName: b.product.name,
      })),
    },
  }
}
