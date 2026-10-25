import {
  BatchStatus,
  InventoryLedgerType,
  PrismaClient,
} from '@prisma/client'
import {
  calculateAvailableStock,
  calculateStockFromLedger,
  evaluateBatchEligibility,
  LedgerEntry,
  toVietnamCalendarDate,
  verifyInventoryInvariants,
} from '../src/lib/domain/inventory'

export interface DemoBatchSpec {
  productSlug: 'sau-rieng-ri6' | 'buoi-da-xanh-ben-tre' | 'bo-034-tay-nguyen'
  batchCode: string
  importGrams: number
  harvestOffsetDays: number
  expiryOffsetDays: number
  note: string
}

export const HISTORICAL_UNVERIFIED_BATCH_CODES = [
  'LO-261013-001',
  'LO-261013-002',
  'LO-261013-003',
] as const

export const TARGET_DEMO_PRODUCT_SLUGS = [
  'sau-rieng-ri6',
  'buoi-da-xanh-ben-tre',
  'bo-034-tay-nguyen',
] as const

export const EXPECTED_PRODUCT_TOTAL_GRAMS: Record<
  (typeof TARGET_DEMO_PRODUCT_SLUGS)[number],
  number
> = {
  'sau-rieng-ri6': 200_000, // 60 kg + 140 kg = 200 kg
  'buoi-da-xanh-ben-tre': 200_000, // 80 kg + 120 kg = 200 kg
  'bo-034-tay-nguyen': 150_000, // 50 kg + 100 kg = 150 kg
}

export const F01C_DEMO_BATCH_SPECS: readonly DemoBatchSpec[] = [
  {
    productSlug: 'sau-rieng-ri6',
    batchCode: 'LO-FEFO-RI6-01',
    importGrams: 60_000, // 60 kg
    harvestOffsetDays: -3,
    expiryOffsetDays: 7,
    note: 'Lô demo FEFO Sầu riêng Ri6 #1 (Hạn gần - 60 kg)',
  },
  {
    productSlug: 'sau-rieng-ri6',
    batchCode: 'LO-FEFO-RI6-02',
    importGrams: 140_000, // 140 kg
    harvestOffsetDays: -1,
    expiryOffsetDays: 15,
    note: 'Lô demo FEFO Sầu riêng Ri6 #2 (Hạn xa - 140 kg)',
  },
  {
    productSlug: 'buoi-da-xanh-ben-tre',
    batchCode: 'LO-FEFO-BDX-01',
    importGrams: 80_000, // 80 kg
    harvestOffsetDays: -5,
    expiryOffsetDays: 20,
    note: 'Lô demo FEFO Bưởi da xanh #1 (Hạn gần - 80 kg)',
  },
  {
    productSlug: 'buoi-da-xanh-ben-tre',
    batchCode: 'LO-FEFO-BDX-02',
    importGrams: 120_000, // 120 kg
    harvestOffsetDays: -2,
    expiryOffsetDays: 35,
    note: 'Lô demo FEFO Bưởi da xanh #2 (Hạn xa - 120 kg)',
  },
  {
    productSlug: 'bo-034-tay-nguyen',
    batchCode: 'LO-FEFO-BO034-01',
    importGrams: 50_000, // 50 kg
    harvestOffsetDays: -2,
    expiryOffsetDays: 6,
    note: 'Lô demo FEFO Bơ 034 #1 (Hạn gần - 50 kg)',
  },
  {
    productSlug: 'bo-034-tay-nguyen',
    batchCode: 'LO-FEFO-BO034-02',
    importGrams: 100_000, // 100 kg
    harvestOffsetDays: -1,
    expiryOffsetDays: 13,
    note: 'Lô demo FEFO Bơ 034 #2 (Hạn xa - 100 kg)',
  },
] as const

export interface SafetyGateInput {
  connectionUrl: string
  expectedHost?: string
  gitBranch: string
  mode: 'DRY_RUN' | 'APPLY'
  confirmPreviewBeta?: boolean
}

/**
 * Kiểm tra an toàn Fail-Closed trước khi kết nối hoặc ghi dữ liệu:
 * - Chặn tuyệt đối nhánh main/master hoặc URL Production.
 * - Khi ở chế độ APPLY, bắt buộc xác nhận --confirm-preview-beta và khớp --expected-host.
 */
export function verifyDemoScriptSafetyGates(input: SafetyGateInput): {
  host: string
  isSafe: true
} {
  const branch = (input.gitBranch || '').trim()
  if (branch !== 'beta') {
    throw new Error(
      `[SAFETY GATE FAILED] Chỉ cho phép chạy trên nhánh Git "beta" (hiện tại: "${branch || 'unknown'}").`
    )
  }

  if (!input.connectionUrl || !input.connectionUrl.trim()) {
    throw new Error('[SAFETY GATE FAILED] Thiếu chuỗi kết nối cơ sở dữ liệu (DIRECT_URL / DATABASE_URL).')
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(input.connectionUrl)
  } catch {
    throw new Error('[SAFETY GATE FAILED] Chuỗi kết nối cơ sở dữ liệu không hợp lệ.')
  }

  const host = parsedUrl.hostname.toLowerCase()
  if (!host) {
    throw new Error('[SAFETY GATE FAILED] Không xác định được hostname từ chuỗi kết nối.')
  }

  // Chặn các dấu hiệu Production hoặc Pooled connection khi ghi dữ liệu
  const forbiddenPatterns = ['prod', 'production', 'main-db', 'ep-calm-', 'ep-billowing-']
  for (const pattern of forbiddenPatterns) {
    if (host.includes(pattern)) {
      throw new Error(
        `[SAFETY GATE FAILED] Host "${host}" chứa dấu hiệu môi trường Production ("${pattern}"). Chặn thực thi!`
      )
    }
  }

  if (input.expectedHost) {
    const normalizedExpected = input.expectedHost.trim().toLowerCase()
    if (host !== normalizedExpected) {
      throw new Error(
        `[SAFETY GATE FAILED] Host thực tế "${host}" không khớp với ExpectedHost "${normalizedExpected}".`
      )
    }
  }

  if (input.mode === 'APPLY') {
    if (!input.confirmPreviewBeta) {
      throw new Error(
        '[SAFETY GATE FAILED] Chế độ APPLY yêu cầu cờ xác nhận minh thị (--confirm-preview-beta).'
      )
    }
    if (!input.expectedHost || !input.expectedHost.trim()) {
      throw new Error(
        '[SAFETY GATE FAILED] Chế độ APPLY bắt buộc truyền --expected-host của Neon preview-beta.'
      )
    }
  }

  return { host, isSafe: true }
}

export function buildDemoBatchDates(
  referenceDate: Date,
  harvestOffsetDays: number,
  expiryOffsetDays: number
): { harvestDate: Date; expiryDate: Date } {
  const baseYmd = toVietnamCalendarDate(referenceDate)
  const baseUtcNoon = new Date(`${baseYmd}T00:00:00.000Z`)

  const harvestDate = new Date(
    baseUtcNoon.getTime() + harvestOffsetDays * 24 * 60 * 60 * 1000
  )
  const expiryDate = new Date(
    baseUtcNoon.getTime() + expiryOffsetDays * 24 * 60 * 60 * 1000
  )

  if (harvestDate.getTime() >= expiryDate.getTime()) {
    throw new Error('harvestDate phải nhỏ hơn expiryDate')
  }

  return { harvestDate, expiryDate }
}

export interface DemoBatchStorageAdapter {
  findProducts(): Promise<
    Array<{
      id: string
      slug: string
      name: string
      farmId: string
      inventoryTrackingEnabled: boolean
    }>
  >
  findBatchesByCodes(codes: string[]): Promise<
    Array<{
      id: string
      code: string
      productId: string
      farmId: string
      harvestDate: Date
      expiryDate: Date | null
      status: BatchStatus
      isFefoEligible: boolean
      quantityGrams: number
      ledgerEntries: Array<{
        id: string
        type: InventoryLedgerType
        quantityGrams: number
        idempotencyKey: string | null
      }>
    }>
  >
  upsertDemoBatchAndImportInTx(params: {
    spec: DemoBatchSpec
    productId: string
    farmId: string
    harvestDate: Date
    expiryDate: Date
    idempotencyKey: string
  }): Promise<{
    batchId: string
    batchCode: string
    createdBatch: boolean
    createdLedgerImport: boolean
    physicalStockGrams: number
    reservedGrams: number
    availableGrams: number
  }>
  enableTrackingForProducts(productIds: string[]): Promise<number>
}

export interface PrepareDemoBatchesResult {
  mode: 'DRY_RUN' | 'APPLY'
  referenceDateYmd: string
  historicalUnverifiedPreserved: boolean
  untouchedProductsCount: number
  batchesSummary: Array<{
    batchCode: string
    productSlug: string
    productId: string
    harvestDate: string
    expiryDate: string
    targetImportGrams: number
    availableGramsAfter: number
    action: 'WOULD_CREATE' | 'ALREADY_READY' | 'CREATED_AND_IMPORTED' | 'IDEMPOTENT_SKIPPED'
  }>
  enabledTrackingProductSlugs: string[]
}

/**
 * Thực thi chuẩn bị 6 lô FEFO demo (Hỗ trợ cả DRY_RUN và APPLY idempotent).
 * - Không tự động chạy khi import.
 * - Bảo toàn 3 lô lịch sử UNVERIFIED.
 * - Bảo toàn 5 sản phẩm ngoài phạm vi.
 * - Chỉ bật inventoryTrackingEnabled cho 3 sản phẩm mục tiêu sau khi kiểm chứng tổng tồn kho hợp lệ.
 */
export async function executePrepareF01CDemoBatches(
  adapter: DemoBatchStorageAdapter,
  options: {
    mode: 'DRY_RUN' | 'APPLY'
    referenceDate?: Date
  }
): Promise<PrepareDemoBatchesResult> {
  const refDate = options.referenceDate ?? new Date()
  const refDateYmd = toVietnamCalendarDate(refDate)

  const allProducts = await adapter.findProducts()
  const targetProductsMap = new Map<
    string,
    { id: string; slug: string; name: string; farmId: string; inventoryTrackingEnabled: boolean }
  >()

  for (const slug of TARGET_DEMO_PRODUCT_SLUGS) {
    const found = allProducts.find((p) => p.slug === slug)
    if (!found) {
      throw new Error(`Không tìm thấy sản phẩm mục tiêu với slug "${slug}" trong cơ sở dữ liệu.`)
    }
    targetProductsMap.set(slug, found)
  }

  const nonTargetProducts = allProducts.filter(
    (p) => !TARGET_DEMO_PRODUCT_SLUGS.includes(p.slug as (typeof TARGET_DEMO_PRODUCT_SLUGS)[number])
  )

  // Kiểm tra 3 lô lịch sử UNVERIFIED và 6 lô demo
  const allCodesToInspect = [
    ...HISTORICAL_UNVERIFIED_BATCH_CODES,
    ...F01C_DEMO_BATCH_SPECS.map((s) => s.batchCode),
  ]
  const existingBatches = await adapter.findBatchesByCodes(allCodesToInspect)

  // Xác minh 3 lô lịch sử UNVERIFIED không bị biến đổi thành ACTIVE / FEFO eligible
  for (const histCode of HISTORICAL_UNVERIFIED_BATCH_CODES) {
    const histBatch = existingBatches.find((b) => b.code === histCode)
    if (histBatch) {
      if (histBatch.status !== BatchStatus.UNVERIFIED || histBatch.isFefoEligible !== false) {
        throw new Error(
          `Lô lịch sử "${histCode}" có trạng thái bất thường (status=${histBatch.status}, isFefoEligible=${histBatch.isFefoEligible}). Dừng thực thi để bảo vệ dữ liệu truy xuất QR!`
        )
      }
    }
  }

  const batchesSummary: PrepareDemoBatchesResult['batchesSummary'] = []

  for (const spec of F01C_DEMO_BATCH_SPECS) {
    const product = targetProductsMap.get(spec.productSlug)!
    const { harvestDate, expiryDate } = buildDemoBatchDates(
      refDate,
      spec.harvestOffsetDays,
      spec.expiryOffsetDays
    )
    const idempotencyKey = `LEDGER:DEMO:IMPORT:${spec.batchCode}`
    const existing = existingBatches.find((b) => b.code === spec.batchCode)

    // Kiểm tra điều kiện FEFO hợp lệ bằng pure domain function trước khi thao tác
    const eligibilityPreview = evaluateBatchEligibility(
      {
        id: existing?.id ?? `preview-${spec.batchCode}`,
        code: spec.batchCode,
        productId: product.id,
        farmId: product.farmId,
        harvestDate,
        expiryDate,
        status: 'ACTIVE',
        isFefoEligible: true,
        physicalStockGrams: spec.importGrams,
        reservedGrams: 0,
      },
      { targetProductId: product.id, referenceDate: refDate }
    )

    if (!eligibilityPreview.eligible) {
      throw new Error(
        `Cấu hình lô demo "${spec.batchCode}" không hợp lệ FEFO tại ngày ${refDateYmd}: ${eligibilityPreview.reason}`
      )
    }

    if (options.mode === 'DRY_RUN') {
      const hasImportEntry = existing?.ledgerEntries.some(
        (l) => l.idempotencyKey === idempotencyKey || l.type === InventoryLedgerType.IMPORT
      )
      const currentStock = existing
        ? calculateStockFromLedger(
            existing.ledgerEntries.map((l) => ({
              type: l.type as unknown as LedgerEntry['type'],
              quantityGrams: l.quantityGrams,
            }))
          )
        : null

      batchesSummary.push({
        batchCode: spec.batchCode,
        productSlug: spec.productSlug,
        productId: product.id,
        harvestDate: toVietnamCalendarDate(harvestDate),
        expiryDate: toVietnamCalendarDate(expiryDate),
        targetImportGrams: spec.importGrams,
        availableGramsAfter:
          hasImportEntry && currentStock ? currentStock.availableGrams : spec.importGrams,
        action: existing && hasImportEntry ? 'ALREADY_READY' : 'WOULD_CREATE',
      })
      continue
    }

    // Chế độ APPLY: Upsert Batch + Idempotent IMPORT Ledger Entry
    const applyRes = await adapter.upsertDemoBatchAndImportInTx({
      spec,
      productId: product.id,
      farmId: product.farmId,
      harvestDate,
      expiryDate,
      idempotencyKey,
    })

    const invariantCheck = verifyInventoryInvariants({
      physicalStockGrams: applyRes.physicalStockGrams,
      reservedGrams: applyRes.reservedGrams,
      availableGrams: applyRes.availableGrams,
      dispatchedGrams: 0,
      shrinkageGrams: 0,
      importGrams: spec.importGrams,
      rawPhysicalStockGrams: applyRes.physicalStockGrams,
      rawReservedGrams: applyRes.reservedGrams,
      rawAvailableGrams: applyRes.availableGrams,
      hasDeficit: false,
      warnings: [],
    })

    if (!invariantCheck.valid) {
      throw new Error(
        `Vi phạm bất biến tồn kho sau khi chuẩn bị lô "${spec.batchCode}": ${invariantCheck.violations.join('; ')}`
      )
    }

    batchesSummary.push({
      batchCode: spec.batchCode,
      productSlug: spec.productSlug,
      productId: product.id,
      harvestDate: toVietnamCalendarDate(harvestDate),
      expiryDate: toVietnamCalendarDate(expiryDate),
      targetImportGrams: spec.importGrams,
      availableGramsAfter: applyRes.availableGrams,
      action:
        applyRes.createdBatch || applyRes.createdLedgerImport
          ? 'CREATED_AND_IMPORTED'
          : 'IDEMPOTENT_SKIPPED',
    })
  }

  // Xác minh tổng lượng tồn khả dụng của 3 sản phẩm trước khi bật inventoryTrackingEnabled
  for (const slug of TARGET_DEMO_PRODUCT_SLUGS) {
    const product = targetProductsMap.get(slug)!
    const productBatchSummaries = batchesSummary.filter((b) => b.productSlug === slug)
    const availability = calculateAvailableStock(
      productBatchSummaries.map((b) => ({
        id: b.batchCode,
        code: b.batchCode,
        productId: product.id,
        harvestDate: b.harvestDate,
        expiryDate: b.expiryDate,
        status: 'ACTIVE',
        isFefoEligible: true,
        physicalStockGrams: b.availableGramsAfter,
        reservedGrams: 0,
      })),
      { targetProductId: product.id, referenceDate: refDate }
    )

    const expectedTotal = EXPECTED_PRODUCT_TOTAL_GRAMS[slug]
    if (availability.totalAvailableGrams < expectedTotal) {
      throw new Error(
        `Tổng tồn khả dụng FEFO của "${slug}" (${availability.totalAvailableGrams} g) thấp hơn mức yêu cầu (${expectedTotal} g). Không bật inventoryTrackingEnabled!`
      )
    }
  }

  const enabledTrackingProductSlugs: string[] = []
  if (options.mode === 'APPLY') {
    const targetIds = Array.from(targetProductsMap.values()).map((p) => p.id)
    await adapter.enableTrackingForProducts(targetIds)
    enabledTrackingProductSlugs.push(...TARGET_DEMO_PRODUCT_SLUGS)
  }

  return {
    mode: options.mode,
    referenceDateYmd: refDateYmd,
    historicalUnverifiedPreserved: true,
    untouchedProductsCount: nonTargetProducts.length,
    batchesSummary,
    enabledTrackingProductSlugs,
  }
}

export function createPrismaDemoBatchAdapter(prisma: PrismaClient): DemoBatchStorageAdapter {
  return {
    async findProducts() {
      return await prisma.product.findMany({
        select: {
          id: true,
          slug: true,
          name: true,
          farmId: true,
          inventoryTrackingEnabled: true,
        },
      })
    },
    async findBatchesByCodes(codes: string[]) {
      return await prisma.batch.findMany({
        where: { code: { in: codes } },
        select: {
          id: true,
          code: true,
          productId: true,
          farmId: true,
          harvestDate: true,
          expiryDate: true,
          status: true,
          isFefoEligible: true,
          quantityGrams: true,
          ledgerEntries: {
            select: {
              id: true,
              type: true,
              quantityGrams: true,
              idempotencyKey: true,
            },
          },
        },
      })
    },
    async upsertDemoBatchAndImportInTx(params) {
      return await prisma.$transaction(async (tx) => {
        let batch = await tx.batch.findUnique({
          where: { code: params.spec.batchCode },
          include: { ledgerEntries: true },
        })

        let createdBatch = false
        if (!batch) {
          batch = await tx.batch.create({
            data: {
              code: params.spec.batchCode,
              productId: params.productId,
              farmId: params.farmId,
              harvestDate: params.harvestDate,
              expiryDate: params.expiryDate,
              status: BatchStatus.ACTIVE,
              isFefoEligible: true,
              quantityGrams: params.spec.importGrams,
              note: params.spec.note,
            },
            include: { ledgerEntries: true },
          })
          createdBatch = true
        }

        const existingImport = batch.ledgerEntries.find(
          (l) =>
            l.idempotencyKey === params.idempotencyKey ||
            l.type === InventoryLedgerType.IMPORT
        )

        let createdLedgerImport = false
        if (!existingImport) {
          const newEntry = await tx.inventoryLedger.create({
            data: {
              batchId: batch.id,
              type: InventoryLedgerType.IMPORT,
              quantityGrams: params.spec.importGrams,
              referenceCode: `DEMO-SEED:${params.spec.batchCode}`,
              notes: params.spec.note,
              idempotencyKey: params.idempotencyKey,
            },
          })
          batch.ledgerEntries.push(newEntry)
          createdLedgerImport = true
        }

        const stock = calculateStockFromLedger(
          batch.ledgerEntries.map((l) => ({
            type: l.type as unknown as LedgerEntry['type'],
            quantityGrams: l.quantityGrams,
          }))
        )

        await tx.batch.update({
          where: { id: batch.id },
          data: {
            status: BatchStatus.ACTIVE,
            isFefoEligible: true,
            harvestDate: params.harvestDate,
            expiryDate: params.expiryDate,
            quantityGrams: stock.availableGrams,
          },
        })

        return {
          batchId: batch.id,
          batchCode: batch.code,
          createdBatch,
          createdLedgerImport,
          physicalStockGrams: stock.physicalStockGrams,
          reservedGrams: stock.reservedGrams,
          availableGrams: stock.availableGrams,
        }
      })
    },
    async enableTrackingForProducts(productIds: string[]) {
      const res = await prisma.product.updateMany({
        where: { id: { in: productIds } },
        data: { inventoryTrackingEnabled: true },
      })
      return res.count
    },
  }
}
