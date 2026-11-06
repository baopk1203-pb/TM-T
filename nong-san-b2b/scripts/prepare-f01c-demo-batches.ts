import {
  BatchStatus,
  InventoryLedgerType,
  Prisma,
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

export const KNOWN_PRODUCTION_ENDPOINT_HOST = 'ep-square-scene-b5ddgxil'
export const KNOWN_PREVIEW_BETA_HOST = 'ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech'

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
 * - Chặn trực diện Production Endpoint ID ('ep-square-scene-b5ddgxil').
 * - Chặn kết nối Pooled connection ('-pooler').
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
  const forbiddenPatterns = [
    'prod',
    'production',
    'main-db',
    'ep-calm-',
    'ep-billowing-',
    KNOWN_PRODUCTION_ENDPOINT_HOST,
    'ep-square-scene',
    '-pooler',
  ]
  for (const pattern of forbiddenPatterns) {
    if (host.includes(pattern)) {
      throw new Error(
        `[SAFETY GATE FAILED] Host "${host}" chứa dấu hiệu môi trường Production hoặc Pooler ("${pattern}"). Chặn thực thi!`
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
    const normalizedHost = host.trim().toLowerCase()
    const normalizedExpected = input.expectedHost.trim().toLowerCase()
    if (normalizedHost !== normalizedExpected) {
      throw new Error(
        `[SAFETY GATE FAILED] Chế độ APPLY: Host "${normalizedHost}" không khớp với ExpectedHost "${normalizedExpected}".`
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

export interface ExistingBatchRecord {
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
}

/**
 * FIX-02: Kiểm tra xung đột dữ liệu đối với lô đã tồn tại.
 * - Đối chiếu productId, farmId, harvestDate, expiryDate, status, isFefoEligible.
 * - Đối chiếu bút toán IMPORT và số lượng nhập.
 * - Kiểm tra số dư và không ghi đè lô đang được sử dụng trong đơn hàng.
 * - Ném lỗi fail-closed nếu phát hiện bất kỳ xung đột nào.
 */
export function validateExistingDemoBatchConflict(params: {
  spec: DemoBatchSpec
  productId: string
  farmId: string
  expectedHarvestDate: Date
  expectedExpiryDate: Date
  existingBatch: ExistingBatchRecord
}): {
  isAlreadySeededClean: boolean
  stock: ReturnType<typeof calculateStockFromLedger>
} {
  const { spec, productId, farmId, expectedHarvestDate, expectedExpiryDate, existingBatch } = params

  if (existingBatch.productId !== productId) {
    throw new Error(
      `[CONFLICT] Lô "${spec.batchCode}" đã tồn tại nhưng sai productId (hiện tại: "${existingBatch.productId}", kỳ vọng: "${productId}"). Không tự ý ghi đè!`
    )
  }

  if (existingBatch.farmId !== farmId) {
    throw new Error(
      `[CONFLICT] Lô "${spec.batchCode}" đã tồn tại nhưng sai farmId (hiện tại: "${existingBatch.farmId}", kỳ vọng: "${farmId}"). Không tự ý ghi đè!`
    )
  }

  const actualHarvestYmd = toVietnamCalendarDate(existingBatch.harvestDate)
  const expectedHarvestYmd = toVietnamCalendarDate(expectedHarvestDate)
  if (actualHarvestYmd !== expectedHarvestYmd) {
    throw new Error(
      `[CONFLICT] Lô "${spec.batchCode}" đã tồn tại nhưng sai ngày thu hoạch (hiện tại: "${actualHarvestYmd}", kỳ vọng: "${expectedHarvestYmd}"). Không tự ý ghi đè!`
    )
  }

  if (!existingBatch.expiryDate) {
    throw new Error(
      `[CONFLICT] Lô "${spec.batchCode}" đã tồn tại nhưng thiếu hạn sử dụng (null). Không tự ý ghi đè!`
    )
  }

  const actualExpiryYmd = toVietnamCalendarDate(existingBatch.expiryDate)
  const expectedExpiryYmd = toVietnamCalendarDate(expectedExpiryDate)
  if (actualExpiryYmd !== expectedExpiryYmd) {
    throw new Error(
      `[CONFLICT] Lô "${spec.batchCode}" đã tồn tại nhưng sai hạn sử dụng (hiện tại: "${actualExpiryYmd}", kỳ vọng: "${expectedExpiryYmd}"). Không tự ý ghi đè!`
    )
  }

  if (existingBatch.status !== BatchStatus.ACTIVE) {
    throw new Error(
      `[CONFLICT] Lô "${spec.batchCode}" đã tồn tại nhưng có trạng thái không hợp lệ (status: "${existingBatch.status}", kỳ vọng: "ACTIVE"). Không tự ý ghi đè!`
    )
  }

  if (existingBatch.isFefoEligible !== true) {
    throw new Error(
      `[CONFLICT] Lô "${spec.batchCode}" đã tồn tại nhưng isFefoEligible=false (kỳ vọng: true). Không tự ý ghi đè!`
    )
  }

  // Kiểm tra bút toán IMPORT trong sổ cái
  const importEntries = existingBatch.ledgerEntries.filter(
    (l) => l.type === InventoryLedgerType.IMPORT
  )

  if (importEntries.length > 1) {
    throw new Error(
      `[CONFLICT] Lô "${spec.batchCode}" có nhiều hơn 1 bút toán IMPORT (${importEntries.length} bút toán). Dữ liệu sổ cái không hợp lệ!`
    )
  }

  if (importEntries.length === 1) {
    const existingImport = importEntries[0]
    if (existingImport.quantityGrams !== spec.importGrams) {
      throw new Error(
        `[CONFLICT] Bút toán IMPORT của lô "${spec.batchCode}" đã tồn tại nhưng khối lượng nhập không khớp (hiện tại: ${existingImport.quantityGrams} g, kỳ vọng: ${spec.importGrams} g). Không tự ý bù chênh lệch!`
      )
    }
  }

  const stock = calculateStockFromLedger(
    existingBatch.ledgerEntries.map((l) => ({
      type: l.type as unknown as LedgerEntry['type'],
      quantityGrams: l.quantityGrams,
    }))
  )

  if (stock.hasDeficit) {
    throw new Error(
      `[CONFLICT] Lô "${spec.batchCode}" bị âm tồn kho khả dụng (${stock.availableGrams} g). Dữ liệu sổ cái không hợp lệ!`
    )
  }

  return {
    isAlreadySeededClean:
      importEntries.length === 1 && importEntries[0].quantityGrams === spec.importGrams,
    stock,
  }
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

  // Xác minh không có mã lô demo trùng nhau và không trùng với mã lô lịch sử
  const demoCodes = F01C_DEMO_BATCH_SPECS.map((s) => s.batchCode)
  const uniqueDemoCodes = new Set(demoCodes)
  if (uniqueDemoCodes.size !== demoCodes.length) {
    throw new Error('Phát hiện mã lô trùng lặp trong danh sách cấu hình F01C_DEMO_BATCH_SPECS.')
  }
  for (const histCode of HISTORICAL_UNVERIFIED_BATCH_CODES) {
    if (uniqueDemoCodes.has(histCode)) {
      throw new Error(`Mã lô demo trùng với mã lô lịch sử "${histCode}".`)
    }
  }

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

    // FIX-02: Kiểm tra xung đột dữ liệu nếu lô đã tồn tại
    let isAlreadySeededClean = false
    let currentStockFromLedger: ReturnType<typeof calculateStockFromLedger> | null = null

    if (existing) {
      const conflictRes = validateExistingDemoBatchConflict({
        spec,
        productId: product.id,
        farmId: product.farmId,
        expectedHarvestDate: harvestDate,
        expectedExpiryDate: expiryDate,
        existingBatch: existing,
      })
      isAlreadySeededClean = conflictRes.isAlreadySeededClean
      currentStockFromLedger = conflictRes.stock
    }

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
      batchesSummary.push({
        batchCode: spec.batchCode,
        productSlug: spec.productSlug,
        productId: product.id,
        harvestDate: toVietnamCalendarDate(harvestDate),
        expiryDate: toVietnamCalendarDate(expiryDate),
        targetImportGrams: spec.importGrams,
        availableGramsAfter:
          isAlreadySeededClean && currentStockFromLedger
            ? currentStockFromLedger.availableGrams
            : spec.importGrams,
        action: isAlreadySeededClean ? 'ALREADY_READY' : 'WOULD_CREATE',
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

export function createPrismaDemoBatchAdapter(
  prisma: PrismaClient | Prisma.TransactionClient
): DemoBatchStorageAdapter {
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
      const runner = async (tx: Prisma.TransactionClient) => {
        let batch = await tx.batch.findUnique({
          where: { code: params.spec.batchCode },
          include: { ledgerEntries: true },
        })

        let createdBatch = false
        let createdLedgerImport = false

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
        } else {
          // Lô đã tồn tại -> Kiểm tra xung đột trước khi tiếp tục
          const conflictCheck = validateExistingDemoBatchConflict({
            spec: params.spec,
            productId: params.productId,
            farmId: params.farmId,
            expectedHarvestDate: params.harvestDate,
            expectedExpiryDate: params.expiryDate,
            existingBatch: batch,
          })

          // Nếu đã seed chuẩn và có đúng 1 IMPORT -> Idempotent skip, không ghi đè bất kỳ trường nào
          if (conflictCheck.isAlreadySeededClean) {
            return {
              batchId: batch.id,
              batchCode: batch.code,
              createdBatch: false,
              createdLedgerImport: false,
              physicalStockGrams: conflictCheck.stock.physicalStockGrams,
              reservedGrams: conflictCheck.stock.reservedGrams,
              availableGrams: conflictCheck.stock.availableGrams,
            }
          }
        }

        const existingImport = batch.ledgerEntries.find(
          (l) =>
            l.idempotencyKey === params.idempotencyKey ||
            l.type === InventoryLedgerType.IMPORT
        )

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

        // Chỉ cập nhật batch khi vừa tạo mới hoặc vừa ghi IMPORT mới, KHÔNG ghi đè khi đã tồn tại đúng
        if (createdBatch || createdLedgerImport) {
          await tx.batch.update({
            where: { id: batch.id },
            data: {
              quantityGrams: stock.availableGrams,
            },
          })
        }

        return {
          batchId: batch.id,
          batchCode: batch.code,
          createdBatch,
          createdLedgerImport,
          physicalStockGrams: stock.physicalStockGrams,
          reservedGrams: stock.reservedGrams,
          availableGrams: stock.availableGrams,
        }
      }

      if ('$transaction' in prisma && typeof prisma.$transaction === 'function') {
        return await (prisma as PrismaClient).$transaction(runner)
      }
      return await runner(prisma as Prisma.TransactionClient)
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

export interface RunDemoBatchesOptions {
  mode: 'DRY_RUN' | 'APPLY'
  referenceDate?: Date
  transactionTimeoutMs?: number
}

/**
 * FIX-01: Single Atomic Transaction Runner.
 * - DRY_RUN: Chạy truy vấn đọc an toàn, 0 thao tác ghi database.
 * - APPLY: BẮT BUỘC thực thi toàn bộ quy trình bên trong 1 single PostgreSQL transaction duy nhất.
 *   Nếu bất kỳ lô nào thất bại hoặc bật tracking thất bại -> ROLLBACK toàn bộ.
 */
export async function runPrepareF01CDemoBatchesInTx(
  prisma: PrismaClient,
  options: RunDemoBatchesOptions
): Promise<PrepareDemoBatchesResult> {
  const timeout = options.transactionTimeoutMs ?? 30_000

  if (options.mode === 'DRY_RUN') {
    const adapter = createPrismaDemoBatchAdapter(prisma)
    return await executePrepareF01CDemoBatches(adapter, {
      mode: 'DRY_RUN',
      referenceDate: options.referenceDate,
    })
  }

  // Chế độ APPLY: Bắt buộc Single Atomic Transaction
  return await prisma.$transaction(
    async (tx) => {
      const adapter = createPrismaDemoBatchAdapter(tx)
      return await executePrepareF01CDemoBatches(adapter, {
        mode: 'APPLY',
        referenceDate: options.referenceDate,
      })
    },
    {
      timeout,
    }
  )
}

export interface CliArgs {
  mode: 'DRY_RUN' | 'APPLY'
  confirmPreviewBeta: boolean
  expectedHost?: string
  help?: boolean
}

export function parseCliArgs(argv: string[]): CliArgs {
  let mode: 'DRY_RUN' | 'APPLY' = 'DRY_RUN'
  let confirmPreviewBeta = false
  let expectedHost: string | undefined
  let help = false

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      help = true
    } else if (arg === '--apply' || arg === '--mode=apply') {
      mode = 'APPLY'
    } else if (arg === '--dry-run' || arg === '--mode=dry-run') {
      mode = 'DRY_RUN'
    } else if (arg === '--confirm-preview-beta') {
      confirmPreviewBeta = true
    } else if (arg.startsWith('--expected-host=')) {
      expectedHost = arg.slice('--expected-host='.length).trim()
    }
  }

  return { mode, confirmPreviewBeta, expectedHost, help }
}

function loadEnvSilently(): void {
  if (process.env.DIRECT_URL || process.env.DATABASE_URL) {
    return
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path')
    const candidates = [
      path.resolve(process.cwd(), '.env'),
      path.resolve(process.cwd(), '..', '.env'),
      path.resolve(__dirname, '..', '.env'),
    ]
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const lines = fs.readFileSync(p, 'utf-8').split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          const eqIdx = trimmed.indexOf('=')
          if (eqIdx > 0) {
            const k = trimmed.slice(0, eqIdx).trim()
            let v = trimmed.slice(eqIdx + 1).trim()
            if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
            else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1)
            if (!process.env[k]) process.env[k] = v
          }
        }
        if (process.env.DIRECT_URL || process.env.DATABASE_URL) break
      }
    }
  } catch {
    // fallback
  }
}

/**
 * FIX-03: Safe CLI Entrypoint Runner
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseCliArgs(argv)

  if (args.help) {
    console.log(`
=== HƯỚNG DẪN SỬ DỤNG FEFO DEMO BATCHES RUNNER (EV-IMP-01C) ===

Cách dùng:
  npx tsx scripts/prepare-f01c-demo-batches.ts [options]

Các tùy chọn:
  --mode=dry-run           Chạy chế độ kiểm tra không ghi (MẶC ĐỊNH)
  --mode=apply             Chạy chế độ nạp dữ liệu (yêu cầu xác nhận PO)
  --confirm-preview-beta   Bắt buộc khi APPLY: Xác nhận chủ động nạp vào Neon preview-beta
  --expected-host=<host>   Bắt buộc khi APPLY: Hostname Neon preview-beta mong đợi
  --help, -h               Hiển thị trợ giúp này
`)
    return 0
  }

  console.log('=== [FEFO DEMO BATCHES RUNNER - EV-IMP-01C] ===')
  console.log(`Chế độ thực thi: ${args.mode}`)

  loadEnvSilently()
  const connectionUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!connectionUrl) {
    console.error('[CLI ERROR] Thiếu biến môi trường DIRECT_URL hoặc DATABASE_URL.')
    return 1
  }

  let currentBranch = 'beta'
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync } = require('child_process')
    currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    // fallback
  }

  try {
    const gateRes = verifyDemoScriptSafetyGates({
      connectionUrl,
      expectedHost: args.expectedHost,
      gitBranch: currentBranch,
      mode: args.mode,
      confirmPreviewBeta: args.confirmPreviewBeta,
    })
    console.log(`[SAFETY GATE PASS] Target Host: ${gateRes.host} (Branch: ${currentBranch})`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[SAFETY GATE FAILED] ${msg}`)
    return 1
  }

  const prisma = new PrismaClient()
  try {
    console.log(`[CLI] Bắt đầu chuẩn bị lô FEFO (chế độ: ${args.mode})...`)
    const result = await runPrepareF01CDemoBatchesInTx(prisma, {
      mode: args.mode,
    })

    console.log(`[CLI] Ngày đối chiếu (VN): ${result.referenceDateYmd}`)
    console.log(`[CLI] Bảo toàn 3 lô lịch sử UNVERIFIED: ${result.historicalUnverifiedPreserved}`)
    console.log(`[CLI] Số sản phẩm ngoài phạm vi giữ nguyên: ${result.untouchedProductsCount}`)
    console.log(`\n--- BẢNG KẾT QUẢ 6 LÔ DEMO FEFO ---`)
    console.table(
      result.batchesSummary.map((b, idx) => ({
        '#': idx + 1,
        'Mã Lô': b.batchCode,
        'Sản Phẩm': b.productSlug,
        'Thu Hoạch': b.harvestDate,
        'Hạn Dùng': b.expiryDate,
        'Khối Lượng Nhập': `${b.targetImportGrams / 1000} kg`,
        'Khả Dụng': `${b.availableGramsAfter / 1000} kg`,
        'Hành Động': b.action,
      }))
    )

    if (args.mode === 'DRY_RUN') {
      console.log(`\n[CLI SUCCESS] DRY-RUN HOÀN TẤT THÀNH CÔNG (0 database writes).`)
    } else {
      console.log(
        `\n[CLI SUCCESS] APPLY HOÀN TẤT THÀNH CÔNG trong Single Atomic Transaction.`
      )
      console.log(`Đã bật tracking cho: ${result.enabledTrackingProductSlugs.join(', ')}`)
    }
    return 0
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`\n[CLI EXECUTION FAILED] ${msg}`)
    return 1
  } finally {
    await prisma.$disconnect()
  }
}

// Chặn tự chạy khi file được import bởi vitest hoặc module khác
const isCliEntrypoint =
  typeof process !== 'undefined' &&
  process.argv &&
  process.argv[1] &&
  (process.argv[1].endsWith('prepare-f01c-demo-batches.ts') ||
    process.argv[1].endsWith('prepare-f01c-demo-batches.js') ||
    process.argv[1].includes('prepare-f01c-demo-batches')) &&
  !process.argv.some((arg) => arg.includes('vitest'))

if (isCliEntrypoint) {
  main().then((code) => {
    if (code !== 0) {
      process.exit(code)
    }
  })
}
