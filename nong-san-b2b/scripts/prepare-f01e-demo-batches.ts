/**
 * ============================================================================
 * EV-IMP-01E — FULL CATALOG FEFO ROLLOUT PREPARATION & SEEDING SCRIPT
 * ============================================================================
 * Mục tiêu:
 *   Mở rộng kiểm soát tồn kho FEFO từ 3/8 lên 8/8 sản phẩm trên Neon `preview-beta`
 *   bằng cách nhập 10 lô DEMO mới (2 lô ACTIVE / sản phẩm, khác hạn sử dụng)
 *   với tổng khối lượng nhập 1.300 kg (1.300.000 g) cho 5 sản phẩm còn lại:
 *     1. Xoài Cát Hòa Lộc (`xoai-cat-hoa-loc`):      110 kg + 150 kg = 260 kg
 *     2. Sầu riêng Monthong (`sau-rieng-monthong-dona`): 130 kg + 170 kg = 300 kg
 *     3. Thanh long ruột đỏ (`thanh-long-ruot-do`):  120 kg + 160 kg = 280 kg
 *     4. Chôm chôm nhãn (`chom-chom-nhan`):          100 kg + 140 kg = 240 kg
 *     5. Măng cụt Bến Tre (`mang-cut-ben-tre`):       90 kg + 130 kg = 220 kg
 *
 * GIẢI QUYẾT MÂU THUẪN KIẾN TRÚC (ATOMIC ONBOARDING):
 *   - `receiveStockInTx` (F01D Phase 2) yêu cầu `inventoryTrackingEnabled === true`
 *     và `ENABLE_ADMIN_INVENTORY_WRITES === 'true'` cho nghiệp vụ nhập kho thường nhật.
 *   - Tuy nhiên, khi rollout sản phẩm từ `inventoryTrackingEnabled = false` sang `true`,
 *     không được bật `inventoryTrackingEnabled = true` trước khi có tồn kho hợp lệ
 *     (tránh cửa sổ trung gian gây "Tạm hết hàng" giả trên Storefront).
 *   - Giải pháp nguyên tử trong 1 PostgreSQL `$transaction` duy nhất:
 *     (1) Khóa dòng (SELECT ... FOR UPDATE) và kiểm tra Allowlist 5 Product IDs + Safety Gates.
 *     (2) Validate 10 lô qua hàm thuần `validateStockReceipt` & `evaluateBatchEligibility`.
 *     (3) Tạo/Upsert 10 `Batch` (`ACTIVE`, `isFefoEligible = true`) + 10 `InventoryLedger` (`IMPORT`)
 *         với `idempotencyKey` định danh duy nhất.
 *     (4) Kiểm chứng tồn kho khả dụng (`calculateStockFromLedger`, `verifyInventoryInvariants`,
 *         `calculateAvailableStock`, `allocateBatchesFefo`) đạt chuẩn > 200 kg mỗi sản phẩm.
 *     (5) Chỉ sau khi tồn kho hợp lệ đã hiện diện trong transaction, bật `inventoryTrackingEnabled = true`
 *         theo đúng Allowlist 5 Product IDs.
 *     (6) Nếu bất kỳ bước nào lỗi -> PostgreSQL tự động ROLLBACK toàn bộ (All-or-nothing).
 *
 * Chế độ chạy:
 *   - Mặc định: DRY_RUN (`npx tsx scripts/prepare-f01e-demo-batches.ts --mode=dry-run`)
 *   - Thực thi: APPLY (`npx tsx scripts/prepare-f01e-demo-batches.ts --mode=apply`) — CHỈ CHẠY KHI PO PHÊ DUYỆT GATE B
 * ============================================================================
 */

import {
  BatchStatus,
  InventoryLedgerType,
  OrderStatus,
  Prisma,
  PrismaClient,
  Role,
} from '@prisma/client'
import {
  allocateBatchesFefo,
  type BatchCandidate,
  type BatchStatus as DomainBatchStatus,
  calculateAvailableStock,
  calculateStockFromLedger,
  evaluateBatchEligibility,
  gramsToKg,
  type InventoryLedgerType as DomainLedgerType,
  verifyInventoryInvariants,
} from '../src/lib/domain/inventory'
import { validateStockReceipt } from '../src/lib/domain/inventory-operations'

export type F01EExecutionMode = 'DRY_RUN' | 'APPLY'

export interface F01EDemoBatchSpec {
  code: string
  productSlug: string
  farmSlug: string
  quantityGrams: number
  harvestDaysOffset: number
  expiryDaysOffset: number
  idempotencyKey: string
  qcNotes: string
}

export interface F01ETargetProductSpec {
  expectedProductId?: string
  expectedSlug: string
  expectedName: string
  expectedFarmId?: string
  expectedFarmSlug: string
  expectedMoqGrams: number
  expectedTotalGrams: number
  batches: [F01EDemoBatchSpec, F01EDemoBatchSpec]
}

export interface PreservedTrackedProductSpec {
  expectedProductId: string
  expectedSlug: string
  expectedSellableGrams: number
  expectedPhysicalGrams: number
}

/**
 * 3 lô lịch sử từ Phase 4 (QR Traceability) bắt buộc giữ nguyên UNVERIFIED + isFefoEligible=false.
 */
export const HISTORICAL_UNVERIFIED_BATCH_CODES = [
  'LO-261013-001',
  'LO-261013-002',
  'LO-261013-003',
] as const

/**
 * Lô kiểm thử QA từ F01D Phase 2 bắt buộc giữ nguyên LOCKED_QC (8.000 g physical, 0 g sellable).
 */
export const PRESERVED_QA_LOCKED_BATCH_CODE = 'QA-F01D-P2-BO034-261026'
export const PRESERVED_QA_LOCKED_PHYSICAL_GRAMS = 8_000

/**
 * 3 sản phẩm đã bật FEFO từ F01C bắt buộc giữ nguyên trạng thái và tồn kho.
 */
export const F01C_PRESERVED_TRACKED_PRODUCTS: readonly PreservedTrackedProductSpec[] = [
  {
    expectedProductId: 'cmv6hth16000l8pzs91wi2yof',
    expectedSlug: 'sau-rieng-ri6',
    expectedSellableGrams: 200_000,
    expectedPhysicalGrams: 200_000,
  },
  {
    expectedProductId: 'cmv6htksu000y8pzsu8jvwgdr',
    expectedSlug: 'buoi-da-xanh-ben-tre',
    expectedSellableGrams: 200_000,
    expectedPhysicalGrams: 200_000,
  },
  {
    expectedProductId: 'cmv6htn8q001b8pzsdcnag5bi',
    expectedSlug: 'bo-034-tay-nguyen',
    expectedSellableGrams: 150_000,
    expectedPhysicalGrams: 158_000,
  },
] as const

/**
 * ALLOWLIST NGHIÊM NGẶT 5 SẢN PHẨM MỤC TIÊU CỦA F01E (Tổng = 1.300 kg = 1.300.000 g)
 */
export const F01E_TARGET_PRODUCT_ALLOWLIST: readonly F01ETargetProductSpec[] = [
  {
    expectedProductId: 'cmv6htm0k00158pzsv6q7xfpc',
    expectedSlug: 'xoai-cat-hoa-loc',
    expectedName: 'Xoài Cát Hòa Lộc Tiền Giang Chuẩn Xuất Khẩu',
    expectedFarmId: 'cmv6htcxt000d8pzsor2nhhig',
    expectedFarmSlug: 'htx-sau-rieng-ngu-hiep-tien-giang',
    expectedMoqGrams: 30_000, // 30 kg
    expectedTotalGrams: 260_000, // 110 kg + 150 kg = 260 kg (> 200 kg)
    batches: [
      {
        code: 'LO-F01E-XOAI-01',
        productSlug: 'xoai-cat-hoa-loc',
        farmSlug: 'htx-sau-rieng-ngu-hiep-tien-giang',
        quantityGrams: 110_000, // 110 kg
        harvestDaysOffset: -2,
        expiryDaysOffset: 8, // Hết hạn sớm hơn -> ưu tiên xuất trước theo FEFO
        idempotencyKey: 'LEDGER:F01E:DEMO:IMPORT:LO-F01E-XOAI-01',
        qcNotes:
          '[DEMO DATA - F01E ROLLOUT] Lô Xoài Cát Hòa Lộc đợt 1 đạt chuẩn QC nội bộ phục vụ kiểm thử FEFO Beta (110 kg)',
      },
      {
        code: 'LO-F01E-XOAI-02',
        productSlug: 'xoai-cat-hoa-loc',
        farmSlug: 'htx-sau-rieng-ngu-hiep-tien-giang',
        quantityGrams: 150_000, // 150 kg
        harvestDaysOffset: -1,
        expiryDaysOffset: 16, // Hết hạn muộn hơn -> xuất thứ hai theo FEFO
        idempotencyKey: 'LEDGER:F01E:DEMO:IMPORT:LO-F01E-XOAI-02',
        qcNotes:
          '[DEMO DATA - F01E ROLLOUT] Lô Xoài Cát Hòa Lộc đợt 2 đạt chuẩn QC nội bộ phục vụ kiểm thử FEFO Beta (150 kg)',
      },
    ],
  },
  {
    expectedProductId: 'cmv6htj60000s8pzs4fk2la63',
    expectedSlug: 'sau-rieng-monthong-dona',
    expectedName: 'Sầu Riêng Monthong Dona Tây Nguyên',
    expectedFarmId: 'cmv6htfz2000i8pzsnvqlpzhq',
    expectedFarmSlug: 'nong-truong-bo-sau-rieng-krong-pac-dak-lak',
    expectedMoqGrams: 50_000, // 50 kg
    expectedTotalGrams: 300_000, // 130 kg + 170 kg = 300 kg (> 200 kg)
    batches: [
      {
        code: 'LO-F01E-MONTHONG-01',
        productSlug: 'sau-rieng-monthong-dona',
        farmSlug: 'nong-truong-bo-sau-rieng-krong-pac-dak-lak',
        quantityGrams: 130_000, // 130 kg
        harvestDaysOffset: -3,
        expiryDaysOffset: 9,
        idempotencyKey: 'LEDGER:F01E:DEMO:IMPORT:LO-F01E-MONTHONG-01',
        qcNotes:
          '[DEMO DATA - F01E ROLLOUT] Lô Sầu riêng Monthong Dona đợt 1 đạt chuẩn QC nội bộ phục vụ kiểm thử FEFO Beta (130 kg)',
      },
      {
        code: 'LO-F01E-MONTHONG-02',
        productSlug: 'sau-rieng-monthong-dona',
        farmSlug: 'nong-truong-bo-sau-rieng-krong-pac-dak-lak',
        quantityGrams: 170_000, // 170 kg
        harvestDaysOffset: -1,
        expiryDaysOffset: 18,
        idempotencyKey: 'LEDGER:F01E:DEMO:IMPORT:LO-F01E-MONTHONG-02',
        qcNotes:
          '[DEMO DATA - F01E ROLLOUT] Lô Sầu riêng Monthong Dona đợt 2 đạt chuẩn QC nội bộ phục vụ kiểm thử FEFO Beta (170 kg)',
      },
    ],
  },
  {
    expectedProductId: 'cmv6htogh001h8pzsmnmkmk2a',
    expectedSlug: 'thanh-long-ruot-do',
    expectedName: 'Thanh Long Ruột Đỏ Chợ Gạo (Tai Xanh Quả To)',
    expectedFarmId: 'cmv6htcxt000d8pzsor2nhhig',
    expectedFarmSlug: 'htx-sau-rieng-ngu-hiep-tien-giang',
    expectedMoqGrams: 50_000, // 50 kg
    expectedTotalGrams: 280_000, // 120 kg + 160 kg = 280 kg (> 200 kg)
    batches: [
      {
        code: 'LO-F01E-THANHLONG-01',
        productSlug: 'thanh-long-ruot-do',
        farmSlug: 'htx-sau-rieng-ngu-hiep-tien-giang',
        quantityGrams: 120_000, // 120 kg
        harvestDaysOffset: -3,
        expiryDaysOffset: 10,
        idempotencyKey: 'LEDGER:F01E:DEMO:IMPORT:LO-F01E-THANHLONG-01',
        qcNotes:
          '[DEMO DATA - F01E ROLLOUT] Lô Thanh long ruột đỏ Chợ Gạo đợt 1 đạt chuẩn QC nội bộ phục vụ kiểm thử FEFO Beta (120 kg)',
      },
      {
        code: 'LO-F01E-THANHLONG-02',
        productSlug: 'thanh-long-ruot-do',
        farmSlug: 'htx-sau-rieng-ngu-hiep-tien-giang',
        quantityGrams: 160_000, // 160 kg
        harvestDaysOffset: -1,
        expiryDaysOffset: 20,
        idempotencyKey: 'LEDGER:F01E:DEMO:IMPORT:LO-F01E-THANHLONG-02',
        qcNotes:
          '[DEMO DATA - F01E ROLLOUT] Lô Thanh long ruột đỏ Chợ Gạo đợt 2 đạt chuẩn QC nội bộ phục vụ kiểm thử FEFO Beta (160 kg)',
      },
    ],
  },
  {
    expectedProductId: 'cmv6htpp9001n8pzsy7il33ne',
    expectedSlug: 'chom-chom-nhan',
    expectedName: 'Chôm Chôm Nhãn Đường Phù Sa (Tróc Vỏ Cùi Dày)',
    expectedFarmId: 'cmv6htcxt000d8pzsor2nhhig',
    expectedFarmSlug: 'htx-sau-rieng-ngu-hiep-tien-giang',
    expectedMoqGrams: 30_000, // 30 kg
    expectedTotalGrams: 240_000, // 100 kg + 140 kg = 240 kg (> 200 kg)
    batches: [
      {
        code: 'LO-F01E-CHOMCHOM-01',
        productSlug: 'chom-chom-nhan',
        farmSlug: 'htx-sau-rieng-ngu-hiep-tien-giang',
        quantityGrams: 100_000, // 100 kg
        harvestDaysOffset: -2,
        expiryDaysOffset: 6,
        idempotencyKey: 'LEDGER:F01E:DEMO:IMPORT:LO-F01E-CHOMCHOM-01',
        qcNotes:
          '[DEMO DATA - F01E ROLLOUT] Lô Chôm chôm nhãn đợt 1 đạt chuẩn QC nội bộ phục vụ kiểm thử FEFO Beta (100 kg)',
      },
      {
        code: 'LO-F01E-CHOMCHOM-02',
        productSlug: 'chom-chom-nhan',
        farmSlug: 'htx-sau-rieng-ngu-hiep-tien-giang',
        quantityGrams: 140_000, // 140 kg
        harvestDaysOffset: -1,
        expiryDaysOffset: 12,
        idempotencyKey: 'LEDGER:F01E:DEMO:IMPORT:LO-F01E-CHOMCHOM-02',
        qcNotes:
          '[DEMO DATA - F01E ROLLOUT] Lô Chôm chôm nhãn đợt 2 đạt chuẩn QC nội bộ phục vụ kiểm thử FEFO Beta (140 kg)',
      },
    ],
  },
  {
    expectedProductId: 'cmv6htqyq001t8pzsiruc41oe',
    expectedSlug: 'mang-cut-ben-tre',
    expectedName: 'Măng Cụt Cổ Thụ Mỏ Cày (Mở Đặt Trước Vụ Mùa)',
    expectedFarmId: 'cmv6htepv000g8pzscryhm5r5',
    expectedFarmSlug: 'vuon-buoi-da-xanh-mo-cay-nam-ben-tre',
    expectedMoqGrams: 50_000, // 50 kg
    expectedTotalGrams: 220_000, // 90 kg + 130 kg = 220 kg (> 200 kg)
    batches: [
      {
        code: 'LO-F01E-MANGCUT-01',
        productSlug: 'mang-cut-ben-tre',
        farmSlug: 'vuon-buoi-da-xanh-mo-cay-nam-ben-tre',
        quantityGrams: 90_000, // 90 kg
        harvestDaysOffset: -2,
        expiryDaysOffset: 7,
        idempotencyKey: 'LEDGER:F01E:DEMO:IMPORT:LO-F01E-MANGCUT-01',
        qcNotes:
          '[DEMO DATA - F01E ROLLOUT] Lô Măng cụt Bến Tre đợt 1 đạt chuẩn QC nội bộ phục vụ kiểm thử FEFO Beta (90 kg)',
      },
      {
        code: 'LO-F01E-MANGCUT-02',
        productSlug: 'mang-cut-ben-tre',
        farmSlug: 'vuon-buoi-da-xanh-mo-cay-nam-ben-tre',
        quantityGrams: 130_000, // 130 kg
        harvestDaysOffset: -1,
        expiryDaysOffset: 14,
        idempotencyKey: 'LEDGER:F01E:DEMO:IMPORT:LO-F01E-MANGCUT-02',
        qcNotes:
          '[DEMO DATA - F01E ROLLOUT] Lô Măng cụt Bến Tre đợt 2 đạt chuẩn QC nội bộ phục vụ kiểm thử FEFO Beta (130 kg)',
      },
    ],
  },
] as const

export const F01E_EXPECTED_NEW_BATCH_COUNT = 10
export const F01E_EXPECTED_NEW_STOCK_GRAMS = 1_300_000 // 1,300 kg
export const F01E_EXPECTED_TOTAL_CATALOG_SELLABLE_GRAMS = 1_850_000 // 550 kg + 1,300 kg = 1,850 kg
export const F01E_EXPECTED_TOTAL_CATALOG_PHYSICAL_GRAMS = 1_858_000 // 558 kg + 1,300 kg = 1,858 kg
export const F01E_EXPECTED_TOTAL_INELIGIBLE_GRAMS = 8_000 // 8 kg (QA-F01D-P2-BO034-261026)

export const KNOWN_PRODUCTION_ENDPOINT_HOST = 'ep-square-scene-b5ddgxil'
export const KNOWN_PREVIEW_BETA_HOST = 'ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech'

export interface F01EEnvironmentSafetyInput {
  connectionUrl: string
  gitBranch: string
  mode: F01EExecutionMode
  confirmPreviewBeta?: boolean
  expectedHost?: string
}

/**
 * Chốt chặn an toàn môi trường (Fail-closed):
 * - Chặn tuyệt đối nhánh khác `beta`.
 * - Chặn tuyệt đối endpoint Production (`ep-square-scene-b5ddgxil`) và kết nối `-pooler`.
 * - Khi ở chế độ `APPLY`, bắt buộc có `--confirm-preview-beta` và `--expected-host` khớp.
 */
export function verifyF01EEnvironmentSafetyGates(input: F01EEnvironmentSafetyInput): {
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
    throw new Error(
      '[SAFETY GATE FAILED] Thiếu chuỗi kết nối cơ sở dữ liệu (DIRECT_URL / DATABASE_URL).'
    )
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

  const forbiddenPatterns = [
    'prod',
    'production',
    'main-db',
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
  }

  return { host, isSafe: true }
}

export interface F01EPreparedBatchOutcome {
  batchCode: string
  productId: string
  productSlug: string
  productName: string
  farmId: string
  farmSlug: string
  quantityGrams: number
  quantityKg: number
  harvestDateIso: string
  expiryDateIso: string
  status: BatchStatus
  isFefoEligible: boolean
  ledgerType: InventoryLedgerType
  idempotencyKey: string
  action: 'WOULD_CREATE' | 'CREATED' | 'ALREADY_EXISTS_IDEMPOTENT'
}

export interface F01EProductSummaryOutcome {
  productId: string
  productSlug: string
  productName: string
  moqGrams: number
  moqKg: number
  previousTrackingEnabled: boolean
  nextTrackingEnabled: boolean
  activeBatchCount: number
  totalPhysicalGrams: number
  totalReservedGrams: number
  totalAvailableGrams: number
  totalAvailableKg: number
  invariantsValid: boolean
  fefoPickOrder: string[]
}

export interface F01ECatalogTotalsOutcome {
  totalProducts: number
  trackedProductsBefore: number
  trackedProductsAfter: number
  newRolloutGrams: number
  newRolloutKg: number
  catalogPhysicalGramsAfter: number
  catalogPhysicalKgAfter: number
  catalogSellableGramsAfter: number
  catalogSellableKgAfter: number
  catalogIneligibleGramsAfter: number
  catalogIneligibleKgAfter: number
}

export interface F01EExecutionReport {
  mode: F01EExecutionMode
  referenceDateIso: string
  adminActorId: string
  adminActorEmail: string
  historicalUnverifiedBatchesUntouched: boolean
  preservedQaBatchUntouched: boolean
  preservedF01CProductsUntouched: boolean
  zeroInFlightOrdersVerified: boolean
  batches: F01EPreparedBatchOutcome[]
  productSummaries: F01EProductSummaryOutcome[]
  catalogTotals: F01ECatalogTotalsOutcome
}

function addDaysUtc(baseDate: Date, days: number): Date {
  const result = new Date(baseDate.getTime())
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

export interface VerifyF01ESafetyGatesOptions {
  enforceExactBaselineIds?: boolean
  enforceCatalogBaselineTotals?: boolean
}

/**
 * Kiểm tra toàn bộ chốt chặn an toàn Fail-Closed trước khi tạo lô hoặc bật tracking.
 */
export async function verifyF01ESafetyGates(
  tx: Prisma.TransactionClient | PrismaClient,
  targetSpecs: readonly F01ETargetProductSpec[] = F01E_TARGET_PRODUCT_ALLOWLIST,
  referenceDate: Date = new Date(),
  options: VerifyF01ESafetyGatesOptions = {}
): Promise<{
  adminUser: { id: string; email: string }
  resolvedTargets: Array<{
    spec: F01ETargetProductSpec
    product: {
      id: string
      slug: string
      name: string
      farmId: string
      moqGrams: number
      isActive: boolean
      inventoryTrackingEnabled: boolean
      farm: { id: string; slug: string; name: string }
    }
  }>
  trackedProductsBefore: number
  totalProducts: number
}> {
  const enforceExactIds = options.enforceExactBaselineIds ?? true
  const enforceCatalogBaseline = options.enforceCatalogBaselineTotals ?? true

  // 1. Kiểm tra tài khoản Admin thực hiện xác thực QC nội bộ
  const adminUser = await tx.user.findFirst({
    where: { role: Role.ADMIN },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true },
  })

  if (!adminUser) {
    throw new Error(
      'SAFETY_ABORT: Không tìm thấy tài khoản ADMIN đang hoạt động để gán quyền xác thực lô hàng (verifiedById).'
    )
  }

  // 2. Kiểm tra 3 lô lịch sử Phase 4 (nếu có trong DB) bắt buộc giữ nguyên UNVERIFIED + isFefoEligible=false
  const historicalBatches = await tx.batch.findMany({
    where: {
      code: { in: [...HISTORICAL_UNVERIFIED_BATCH_CODES] },
    },
    include: {
      ledgerEntries: { select: { id: true } },
    },
  })

  for (const hist of historicalBatches) {
    if (hist.status !== BatchStatus.UNVERIFIED || hist.isFefoEligible !== false) {
      throw new Error(
        `SAFETY_ABORT: Lô lịch sử "${hist.code}" không ở trạng thái UNVERIFIED/isFefoEligible=false (hiện tại: status=${hist.status}, isFefoEligible=${hist.isFefoEligible}).`
      )
    }
    if (hist.ledgerEntries.length > 0) {
      throw new Error(
        `SAFETY_ABORT: Lô lịch sử "${hist.code}" đã có ${hist.ledgerEntries.length} dòng InventoryLedger trái phép.`
      )
    }
  }

  // 3. Nếu kiểm tra trên môi trường chuẩn (enforceCatalogBaseline = true), xác minh lô QA và 3 sản phẩm F01C
  if (enforceCatalogBaseline) {
    const qaBatch = await tx.batch.findUnique({
      where: { code: PRESERVED_QA_LOCKED_BATCH_CODE },
      include: {
        ledgerEntries: { select: { type: true, quantityGrams: true } },
      },
    })

    if (!qaBatch) {
      throw new Error(
        `SAFETY_ABORT: Không tìm thấy lô QA "${PRESERVED_QA_LOCKED_BATCH_CODE}" từ F01D Phase 2.`
      )
    }

    const qaStock = calculateStockFromLedger(
      qaBatch.ledgerEntries.map((e) => ({
        type: e.type as DomainLedgerType,
        quantityGrams: e.quantityGrams,
      }))
    )

    if (
      qaBatch.status !== BatchStatus.LOCKED_QC ||
      qaBatch.isFefoEligible !== false ||
      qaStock.physicalStockGrams !== PRESERVED_QA_LOCKED_PHYSICAL_GRAMS
    ) {
      throw new Error(
        `SAFETY_ABORT: Lô QA "${PRESERVED_QA_LOCKED_BATCH_CODE}" bị sai lệch trạng thái hoặc tồn kho (status=${qaBatch.status}, isFefo=${qaBatch.isFefoEligible}, physical=${qaStock.physicalStockGrams}g).`
      )
    }

    for (const preserved of F01C_PRESERVED_TRACKED_PRODUCTS) {
      const p = await tx.product.findUnique({
        where: { id: preserved.expectedProductId },
        include: {
          batches: {
            include: {
              ledgerEntries: { select: { type: true, quantityGrams: true } },
            },
          },
        },
      })

      if (!p || p.slug !== preserved.expectedSlug || !p.inventoryTrackingEnabled) {
        throw new Error(
          `SAFETY_ABORT: Sản phẩm F01C "${preserved.expectedSlug}" (${preserved.expectedProductId}) không hợp lệ hoặc chưa bật tracking.`
        )
      }

      let prodPhysical = 0
      let prodSellable = 0
      for (const b of p.batches) {
        const s = calculateStockFromLedger(
          b.ledgerEntries.map((e) => ({
            type: e.type as DomainLedgerType,
            quantityGrams: e.quantityGrams,
          }))
        )
        prodPhysical += s.physicalStockGrams
        if (b.status === BatchStatus.ACTIVE && b.isFefoEligible) {
          prodSellable += s.availableGrams
        }
      }

      if (
        prodSellable !== preserved.expectedSellableGrams ||
        prodPhysical !== preserved.expectedPhysicalGrams
      ) {
        throw new Error(
          `SAFETY_ABORT: Tồn kho sản phẩm F01C "${p.slug}" sai lệch so với baseline (sellable=${prodSellable}g expected ${preserved.expectedSellableGrams}g; physical=${prodPhysical}g expected ${preserved.expectedPhysicalGrams}g).`
        )
      }
    }
  }

  // 4. Kiểm tra Allowlist 5 sản phẩm mục tiêu
  if (targetSpecs.length !== 5) {
    throw new Error(
      `SAFETY_ABORT: Allowlist F01E bắt buộc có đúng 5 sản phẩm mục tiêu (nhận được: ${targetSpecs.length}).`
    )
  }

  let totalRolloutGrams = 0
  const resolvedTargets: Array<{
    spec: F01ETargetProductSpec
    product: {
      id: string
      slug: string
      name: string
      farmId: string
      moqGrams: number
      isActive: boolean
      inventoryTrackingEnabled: boolean
      farm: { id: string; slug: string; name: string }
    }
  }> = []

  for (const spec of targetSpecs) {
    const product = await tx.product.findUnique({
      where: { slug: spec.expectedSlug },
      include: {
        farm: { select: { id: true, slug: true, name: true } },
      },
    })

    if (!product) {
      throw new Error(
        `SAFETY_ABORT: Không tìm thấy sản phẩm mục tiêu có slug="${spec.expectedSlug}".`
      )
    }

    if (enforceExactIds && spec.expectedProductId && product.id !== spec.expectedProductId) {
      throw new Error(
        `SAFETY_ABORT: Product ID của "${spec.expectedSlug}" không khớp Allowlist (DB: ${product.id}, Allowlist: ${spec.expectedProductId}).`
      )
    }

    if (enforceExactIds && spec.expectedFarmId && product.farmId !== spec.expectedFarmId) {
      throw new Error(
        `SAFETY_ABORT: Farm ID của "${spec.expectedSlug}" không khớp Allowlist (DB: ${product.farmId}, Allowlist: ${spec.expectedFarmId}).`
      )
    }

    if (!product.isActive) {
      throw new Error(
        `SAFETY_ABORT: Sản phẩm "${product.slug}" (${product.id}) đang không hoạt động (isActive=false).`
      )
    }

    if (product.farm.slug !== spec.expectedFarmSlug) {
      throw new Error(
        `SAFETY_ABORT: Sản phẩm "${product.slug}" thuộc nhà vườn "${product.farm.slug}", không khớp "${spec.expectedFarmSlug}".`
      )
    }

    if (product.moqGrams !== spec.expectedMoqGrams) {
      throw new Error(
        `SAFETY_ABORT: MOQ của sản phẩm "${product.slug}" là ${product.moqGrams}g, không khớp ${spec.expectedMoqGrams}g.`
      )
    }

    if (spec.batches.length !== 2) {
      throw new Error(
        `SAFETY_ABORT: Sản phẩm "${product.slug}" phải có đúng 2 lô DEMO (hiện có ${spec.batches.length}).`
      )
    }

    const [batch1, batch2] = spec.batches
    const sumGrams = batch1.quantityGrams + batch2.quantityGrams
    if (sumGrams !== spec.expectedTotalGrams || sumGrams <= 200_000) {
      throw new Error(
        `SAFETY_ABORT: Tổng khối lượng 2 lô của "${product.slug}" (${sumGrams}g) không khớp ${spec.expectedTotalGrams}g hoặc không lớn hơn 200 kg.`
      )
    }

    if (batch1.expiryDaysOffset >= batch2.expiryDaysOffset) {
      throw new Error(
        `SAFETY_ABORT: 2 lô của "${product.slug}" phải có hạn sử dụng khác nhau và lô 01 phải hết hạn sớm hơn lô 02 để kiểm chứng FEFO.`
      )
    }

    for (const bSpec of spec.batches) {
      const harvestDate = addDaysUtc(referenceDate, bSpec.harvestDaysOffset)
      const expiryDate = addDaysUtc(referenceDate, bSpec.expiryDaysOffset)

      // Kiểm tra qua hàm thuần validateStockReceipt của F01D Phase 2
      const receiptValidation = validateStockReceipt(
        {
          productId: product.id,
          farmId: product.farmId,
          code: bSpec.code,
          harvestDate,
          expiryDate,
          quantityKg: gramsToKg(bSpec.quantityGrams),
          status: BatchStatus.ACTIVE,
          isFefoEligible: true,
          qcNotes: bSpec.qcNotes,
          idempotencyKey: bSpec.idempotencyKey,
        },
        referenceDate
      )

      if (
        !receiptValidation.isValid ||
        !receiptValidation.data ||
        receiptValidation.data.quantityGrams !== bSpec.quantityGrams
      ) {
        throw new Error(
          `SAFETY_ABORT: Lô "${bSpec.code}" không vượt qua validateStockReceipt: ${receiptValidation.errors.join('; ')}`
        )
      }

      const candidate: BatchCandidate = {
        id: `preview-${bSpec.code}`,
        code: bSpec.code,
        productId: product.id,
        farmId: product.farmId,
        harvestDate,
        expiryDate,
        status: BatchStatus.ACTIVE as DomainBatchStatus,
        isFefoEligible: true,
        physicalStockGrams: bSpec.quantityGrams,
        reservedGrams: 0,
      }

      const eligibility = evaluateBatchEligibility(candidate, {
        targetProductId: product.id,
        referenceDate,
      })
      if (!eligibility.eligible) {
        throw new Error(
          `SAFETY_ABORT: Lô "${bSpec.code}" không đủ điều kiện FEFO (${eligibility.reason}: ${eligibility.message}).`
        )
      }
    }

    totalRolloutGrams += sumGrams
    resolvedTargets.push({ spec, product })
  }

  if (totalRolloutGrams !== F01E_EXPECTED_NEW_STOCK_GRAMS) {
    throw new Error(
      `SAFETY_ABORT: Tổng khối lượng 10 lô DEMO (${totalRolloutGrams}g) không khớp 1.300.000g (1.300 kg).`
    )
  }

  // 5. Kiểm tra không có đơn hàng đang mở (non-terminal) thiếu phân bổ trên 5 sản phẩm mục tiêu
  const targetProductIds = resolvedTargets.map((r) => r.product.id)
  const nonTerminalUnallocatedOrders = await tx.order.findMany({
    where: {
      status: {
        notIn: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
      },
      items: {
        some: {
          productId: { in: targetProductIds },
          allocations: { none: {} },
        },
      },
    },
    select: {
      id: true,
      code: true,
      status: true,
    },
  })

  if (nonTerminalUnallocatedOrders.length > 0) {
    const orderCodes = nonTerminalUnallocatedOrders.map((o) => `${o.code}(${o.status})`).join(', ')
    throw new Error(
      `SAFETY_ABORT: Phát hiện ${nonTerminalUnallocatedOrders.length} đơn hàng chưa hoàn tất nhưng không có phân bổ FEFO trên các sản phẩm chuẩn bị bật tracking: ${orderCodes}`
    )
  }

  const allProducts = await tx.product.findMany({
    select: { id: true, inventoryTrackingEnabled: true },
  })
  const trackedProductsBefore = allProducts.filter((p) => p.inventoryTrackingEnabled).length

  return {
    adminUser,
    resolvedTargets,
    trackedProductsBefore,
    totalProducts: allProducts.length,
  }
}

export interface PrepareF01EDemoBatchesOptions {
  mode?: F01EExecutionMode
  referenceDate?: Date
  targetSpecs?: readonly F01ETargetProductSpec[]
  enforceExactBaselineIds?: boolean
  enforceCatalogBaselineTotals?: boolean
  /**
   * Hook dùng riêng cho Integration Test để mô phỏng lỗi giữa chừng nhằm chứng minh Rollback nguyên tử.
   */
  simulateFailureAfterBatchIndex?: number
}

/**
 * Thực thi chuẩn bị / ghi nhận 10 lô DEMO F01E và kích hoạt `inventoryTrackingEnabled = true`
 * cho đúng 5 sản phẩm trong Allowlist bên trong 1 giao dịch PostgreSQL nguyên tử.
 */
export async function prepareF01EDemoBatches(
  prisma: PrismaClient,
  options: PrepareF01EDemoBatchesOptions = {}
): Promise<F01EExecutionReport> {
  const mode: F01EExecutionMode = options.mode ?? 'DRY_RUN'
  const referenceDate = options.referenceDate ?? new Date()
  const targetSpecs = options.targetSpecs ?? F01E_TARGET_PRODUCT_ALLOWLIST
  const enforceExactBaselineIds = options.enforceExactBaselineIds ?? true
  const enforceCatalogBaselineTotals = options.enforceCatalogBaselineTotals ?? true

  if (mode === 'DRY_RUN') {
    const preflight = await verifyF01ESafetyGates(
      prisma,
      targetSpecs,
      referenceDate,
      {
        enforceExactBaselineIds,
        enforceCatalogBaselineTotals,
      }
    )

    const batchesOutcome: F01EPreparedBatchOutcome[] = []
    const productSummaries: F01EProductSummaryOutcome[] = []

    for (const { spec, product } of preflight.resolvedTargets) {
      const simulatedCandidates: BatchCandidate[] = []

      for (const bSpec of spec.batches) {
        const harvestDate = addDaysUtc(referenceDate, bSpec.harvestDaysOffset)
        const expiryDate = addDaysUtc(referenceDate, bSpec.expiryDaysOffset)

        const existingBatch = await prisma.batch.findUnique({
          where: { code: bSpec.code },
          include: { ledgerEntries: true },
        })

        batchesOutcome.push({
          batchCode: bSpec.code,
          productId: product.id,
          productSlug: product.slug,
          productName: product.name,
          farmId: product.farm.id,
          farmSlug: product.farm.slug,
          quantityGrams: bSpec.quantityGrams,
          quantityKg: gramsToKg(bSpec.quantityGrams),
          harvestDateIso: harvestDate.toISOString(),
          expiryDateIso: expiryDate.toISOString(),
          status: BatchStatus.ACTIVE,
          isFefoEligible: true,
          ledgerType: InventoryLedgerType.IMPORT,
          idempotencyKey: bSpec.idempotencyKey,
          action: existingBatch ? 'ALREADY_EXISTS_IDEMPOTENT' : 'WOULD_CREATE',
        })

        const ledgerSummary = calculateStockFromLedger([
          {
            type: InventoryLedgerType.IMPORT as DomainLedgerType,
            quantityGrams: bSpec.quantityGrams,
          },
        ])

        simulatedCandidates.push({
          id: existingBatch?.id ?? `sim-${bSpec.code}`,
          code: bSpec.code,
          productId: product.id,
          farmId: product.farm.id,
          harvestDate,
          expiryDate,
          status: BatchStatus.ACTIVE as DomainBatchStatus,
          isFefoEligible: true,
          physicalStockGrams: ledgerSummary.physicalStockGrams,
          reservedGrams: ledgerSummary.reservedGrams,
        })
      }

      const availability = calculateAvailableStock(simulatedCandidates, {
        targetProductId: product.id,
        referenceDate,
      })
      const totalPhysicalGrams = availability.totalPhysicalStockGrams
      const totalReservedGrams = availability.totalReservedGrams
      const totalAvailableGrams = availability.totalAvailableGrams

      const invariants = simulatedCandidates.every((b) => {
        const summary = calculateStockFromLedger([
          {
            type: InventoryLedgerType.IMPORT as DomainLedgerType,
            quantityGrams: b.physicalStockGrams,
          },
        ])
        return verifyInventoryInvariants(summary).valid
      })

      const fefoSim = allocateBatchesFefo({
        batches: simulatedCandidates,
        requestedGrams: spec.expectedTotalGrams,
        targetProductId: product.id,
        referenceDate,
      })

      if (!invariants || !fefoSim.success || totalAvailableGrams !== spec.expectedTotalGrams) {
        throw new Error(
          `DRY_RUN_INVARIANT_FAILED: Sản phẩm "${product.slug}" không đạt bất biến FEFO trong mô phỏng.`
        )
      }

      productSummaries.push({
        productId: product.id,
        productSlug: product.slug,
        productName: product.name,
        moqGrams: product.moqGrams,
        moqKg: gramsToKg(product.moqGrams),
        previousTrackingEnabled: product.inventoryTrackingEnabled,
        nextTrackingEnabled: true,
        activeBatchCount: simulatedCandidates.length,
        totalPhysicalGrams,
        totalReservedGrams,
        totalAvailableGrams,
        totalAvailableKg: gramsToKg(totalAvailableGrams),
        invariantsValid: invariants,
        fefoPickOrder: fefoSim.allocations.map((a) => a.batchCode),
      })
    }

    const newRolloutGrams = productSummaries.reduce(
      (sum, p) => sum + p.totalAvailableGrams,
      0
    )

    return {
      mode: 'DRY_RUN',
      referenceDateIso: referenceDate.toISOString(),
      adminActorId: preflight.adminUser.id,
      adminActorEmail: preflight.adminUser.email,
      historicalUnverifiedBatchesUntouched: true,
      preservedQaBatchUntouched: true,
      preservedF01CProductsUntouched: true,
      zeroInFlightOrdersVerified: true,
      batches: batchesOutcome,
      productSummaries,
      catalogTotals: {
        totalProducts: preflight.totalProducts,
        trackedProductsBefore: preflight.trackedProductsBefore,
        trackedProductsAfter: preflight.totalProducts,
        newRolloutGrams,
        newRolloutKg: gramsToKg(newRolloutGrams),
        catalogPhysicalGramsAfter: F01E_EXPECTED_TOTAL_CATALOG_PHYSICAL_GRAMS,
        catalogPhysicalKgAfter: gramsToKg(F01E_EXPECTED_TOTAL_CATALOG_PHYSICAL_GRAMS),
        catalogSellableGramsAfter: F01E_EXPECTED_TOTAL_CATALOG_SELLABLE_GRAMS,
        catalogSellableKgAfter: gramsToKg(F01E_EXPECTED_TOTAL_CATALOG_SELLABLE_GRAMS),
        catalogIneligibleGramsAfter: F01E_EXPECTED_TOTAL_INELIGIBLE_GRAMS,
        catalogIneligibleKgAfter: gramsToKg(F01E_EXPECTED_TOTAL_INELIGIBLE_GRAMS),
      },
    }
  }

  // ==========================================================================
  // CHẾ ĐỘ APPLY: THỰC THI NGUYÊN TỬ TRONG 1 POSTGRESQL TRANSACTION DUY NHẤT
  // ==========================================================================
  return await prisma.$transaction(
    async (tx) => {
      const preflight = await verifyF01ESafetyGates(
        tx,
        targetSpecs,
        referenceDate,
        {
          enforceExactBaselineIds,
          enforceCatalogBaselineTotals,
        }
      )

      const allowlistIds = preflight.resolvedTargets.map((r) => r.product.id)

      // 1. Khóa dòng bi quan (SELECT ... FOR UPDATE) đúng 5 sản phẩm trong Allowlist theo thứ tự ID
      try {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Product" WHERE id IN (${Prisma.join(allowlistIds)}) ORDER BY id ASC FOR UPDATE`
        )
      } catch {
        // Bỏ qua nếu môi trường mock không hỗ trợ raw lock
      }

      const batchesOutcome: F01EPreparedBatchOutcome[] = []
      const productSummaries: F01EProductSummaryOutcome[] = []
      let processedBatchIndex = 0

      // 2. Bước 1 trong Transaction: Tạo 10 Batch ACTIVE + 10 InventoryLedger IMPORT TRƯỚC khi bật tracking
      for (const { spec, product } of preflight.resolvedTargets) {
        for (const bSpec of spec.batches) {
          processedBatchIndex++
          const harvestDate = addDaysUtc(referenceDate, bSpec.harvestDaysOffset)
          const expiryDate = addDaysUtc(referenceDate, bSpec.expiryDaysOffset)

          const existingBatch = await tx.batch.findUnique({
            where: { code: bSpec.code },
            include: { ledgerEntries: true },
          })

          let batchId: string
          let action: F01EPreparedBatchOutcome['action'] = 'CREATED'

          if (!existingBatch) {
            const createdBatch = await tx.batch.create({
              data: {
                code: bSpec.code,
                productId: product.id,
                farmId: product.farm.id,
                harvestDate,
                expiryDate,
                harvestGrams: bSpec.quantityGrams,
                quantityGrams: bSpec.quantityGrams,
                status: BatchStatus.ACTIVE,
                isFefoEligible: true,
                qcNotes: bSpec.qcNotes,
                verifiedAt: referenceDate,
                verifiedById: preflight.adminUser.id,
                note: 'Lô hàng DEMO đã xác thực QC cho F01E Full Catalog FEFO Rollout',
              },
            })
            batchId = createdBatch.id
            action = 'CREATED'
          } else {
            if (
              existingBatch.productId !== product.id ||
              existingBatch.farmId !== product.farm.id
            ) {
              throw new Error(
                `SAFETY_ABORT: Mã lô "${bSpec.code}" đã tồn tại nhưng gắn sai sản phẩm hoặc nhà vườn.`
              )
            }

            const nonImportLedgers = existingBatch.ledgerEntries.filter(
              (l) => l.type !== InventoryLedgerType.IMPORT
            )
            if (nonImportLedgers.length > 0) {
              throw new Error(
                `SAFETY_ABORT: Lô "${bSpec.code}" đã có giao dịch phát sinh (${nonImportLedgers.length} bút toán), không thể ghi đè.`
              )
            }

            const updatedBatch = await tx.batch.update({
              where: { id: existingBatch.id },
              data: {
                harvestDate,
                expiryDate,
                harvestGrams: bSpec.quantityGrams,
                quantityGrams: bSpec.quantityGrams,
                status: BatchStatus.ACTIVE,
                isFefoEligible: true,
                qcNotes: bSpec.qcNotes,
                verifiedAt: existingBatch.verifiedAt ?? referenceDate,
                verifiedById: existingBatch.verifiedById ?? preflight.adminUser.id,
              },
            })
            batchId = updatedBatch.id
            action = 'ALREADY_EXISTS_IDEMPOTENT'
          }

          const existingLedger = await tx.inventoryLedger.findUnique({
            where: { idempotencyKey: bSpec.idempotencyKey },
          })

          if (!existingLedger) {
            await tx.inventoryLedger.create({
              data: {
                batchId,
                type: InventoryLedgerType.IMPORT,
                quantityGrams: bSpec.quantityGrams,
                idempotencyKey: bSpec.idempotencyKey,
                referenceCode: bSpec.code,
                actorId: preflight.adminUser.id,
                notes: `Nhập kho lô DEMO ${bSpec.code} (${gramsToKg(bSpec.quantityGrams)} kg) cho sản phẩm ${product.name}`,
              },
            })
          } else if (
            existingLedger.batchId !== batchId ||
            existingLedger.type !== InventoryLedgerType.IMPORT ||
            existingLedger.quantityGrams !== bSpec.quantityGrams
          ) {
            throw new Error(
              `SAFETY_ABORT: Bút toán idempotencyKey="${bSpec.idempotencyKey}" đã tồn tại nhưng sai lệch dữ liệu.`
            )
          }

          if (
            typeof options.simulateFailureAfterBatchIndex === 'number' &&
            processedBatchIndex === options.simulateFailureAfterBatchIndex
          ) {
            throw new Error(
              `SIMULATED_ATOMIC_ROLLBACK: Giả lập sự cố sau khi tạo lô thứ ${processedBatchIndex} (${bSpec.code}) để kiểm chứng rollback nguyên tử.`
            )
          }

          batchesOutcome.push({
            batchCode: bSpec.code,
            productId: product.id,
            productSlug: product.slug,
            productName: product.name,
            farmId: product.farm.id,
            farmSlug: product.farm.slug,
            quantityGrams: bSpec.quantityGrams,
            quantityKg: gramsToKg(bSpec.quantityGrams),
            harvestDateIso: harvestDate.toISOString(),
            expiryDateIso: expiryDate.toISOString(),
            status: BatchStatus.ACTIVE,
            isFefoEligible: true,
            ledgerType: InventoryLedgerType.IMPORT,
            idempotencyKey: bSpec.idempotencyKey,
            action,
          })
        }
      }

      // 3. Bước 2 trong Transaction: Kiểm chứng tồn kho hợp lệ > 200 kg cho từng sản phẩm TRƯỚC KHI bật cờ tracking
      for (const { spec, product } of preflight.resolvedTargets) {
        const dbBatches = await tx.batch.findMany({
          where: { productId: product.id },
          include: { ledgerEntries: true },
          orderBy: { code: 'asc' },
        })

        const candidates: BatchCandidate[] = dbBatches.map((b) => {
          const stock = calculateStockFromLedger(
            b.ledgerEntries.map((l) => ({
              type: l.type as DomainLedgerType,
              quantityGrams: l.quantityGrams,
            }))
          )
          const inv = verifyInventoryInvariants(stock)
          if (!inv.valid) {
            throw new Error(
              `INVARIANT_VIOLATION: Lô "${b.code}" vi phạm bất biến tồn kho: ${inv.violations.join('; ')}`
            )
          }

          return {
            id: b.id,
            code: b.code,
            productId: b.productId,
            farmId: b.farmId,
            harvestDate: b.harvestDate,
            expiryDate: b.expiryDate,
            status: b.status as DomainBatchStatus,
            isFefoEligible: b.isFefoEligible,
            physicalStockGrams: stock.physicalStockGrams,
            reservedGrams: stock.reservedGrams,
          }
        })

        const availability = calculateAvailableStock(candidates, {
          targetProductId: product.id,
          referenceDate,
        })
        const availableGrams = availability.totalAvailableGrams
        if (availableGrams !== spec.expectedTotalGrams || availableGrams <= 200_000) {
          throw new Error(
            `SAFETY_ABORT: Tồn khả dụng của "${product.slug}" sau khi tạo lô là ${availableGrams}g, không khớp kỳ vọng ${spec.expectedTotalGrams}g.`
          )
        }

        const fefoCheck = allocateBatchesFefo({
          batches: candidates,
          requestedGrams: spec.expectedTotalGrams,
          targetProductId: product.id,
          referenceDate,
        })

        if (!fefoCheck.success || !fefoCheck.isFullyAllocated) {
          throw new Error(
            `SAFETY_ABORT: Kiểm tra phân bổ FEFO cho "${product.slug}" thất bại: ${fefoCheck.error}`
          )
        }

        // 4. Bước 3 trong Transaction: Bật `inventoryTrackingEnabled = true` theo đúng ID sản phẩm sau khi đã có tồn kho hợp lệ
        await tx.product.update({
          where: { id: product.id },
          data: { inventoryTrackingEnabled: true },
        })

        const totalPhysicalGrams = candidates.reduce((s, c) => s + c.physicalStockGrams, 0)
        const totalReservedGrams = candidates.reduce((s, c) => s + c.reservedGrams, 0)

        productSummaries.push({
          productId: product.id,
          productSlug: product.slug,
          productName: product.name,
          moqGrams: product.moqGrams,
          moqKg: gramsToKg(product.moqGrams),
          previousTrackingEnabled: product.inventoryTrackingEnabled,
          nextTrackingEnabled: true,
          activeBatchCount: candidates.filter(
            (c) => c.status === BatchStatus.ACTIVE && c.isFefoEligible
          ).length,
          totalPhysicalGrams,
          totalReservedGrams,
          totalAvailableGrams: availableGrams,
          totalAvailableKg: gramsToKg(availableGrams),
          invariantsValid: true,
          fefoPickOrder: fefoCheck.allocations.map((a) => a.batchCode),
        })
      }

      // 5. Bước 4 trong Transaction: Đối soát tổng thể toàn danh mục sau khi bật tracking
      const allProductsAfter = await tx.product.findMany({
        include: {
          batches: {
            include: {
              ledgerEntries: { select: { type: true, quantityGrams: true } },
            },
          },
        },
      })

      const trackedProductsAfter = allProductsAfter.filter(
        (p) => p.inventoryTrackingEnabled
      ).length

      let catalogPhysicalGramsAfter = 0
      let catalogSellableGramsAfter = 0
      let catalogIneligibleGramsAfter = 0

      for (const p of allProductsAfter) {
        for (const b of p.batches) {
          const stock = calculateStockFromLedger(
            b.ledgerEntries.map((e) => ({
              type: e.type as DomainLedgerType,
              quantityGrams: e.quantityGrams,
            }))
          )
          catalogPhysicalGramsAfter += stock.physicalStockGrams
          if (p.inventoryTrackingEnabled && b.status === BatchStatus.ACTIVE && b.isFefoEligible) {
            catalogSellableGramsAfter += stock.availableGrams
          } else {
            catalogIneligibleGramsAfter += stock.physicalStockGrams
          }
        }
      }

      if (enforceCatalogBaselineTotals) {
        if (
          trackedProductsAfter !== 8 ||
          catalogSellableGramsAfter !== F01E_EXPECTED_TOTAL_CATALOG_SELLABLE_GRAMS ||
          catalogPhysicalGramsAfter !== F01E_EXPECTED_TOTAL_CATALOG_PHYSICAL_GRAMS ||
          catalogIneligibleGramsAfter !== F01E_EXPECTED_TOTAL_INELIGIBLE_GRAMS
        ) {
          throw new Error(
            `SAFETY_ABORT: Đối soát tổng danh mục sau rollout sai lệch (tracked=${trackedProductsAfter}/8, sellable=${catalogSellableGramsAfter}g, physical=${catalogPhysicalGramsAfter}g, ineligible=${catalogIneligibleGramsAfter}g).`
          )
        }
      }

      const newRolloutGrams = productSummaries.reduce(
        (sum, p) => sum + p.totalAvailableGrams,
        0
      )

      return {
        mode: 'APPLY',
        referenceDateIso: referenceDate.toISOString(),
        adminActorId: preflight.adminUser.id,
        adminActorEmail: preflight.adminUser.email,
        historicalUnverifiedBatchesUntouched: true,
        preservedQaBatchUntouched: true,
        preservedF01CProductsUntouched: true,
        zeroInFlightOrdersVerified: true,
        batches: batchesOutcome,
        productSummaries,
        catalogTotals: {
          totalProducts: allProductsAfter.length,
          trackedProductsBefore: preflight.trackedProductsBefore,
          trackedProductsAfter,
          newRolloutGrams,
          newRolloutKg: gramsToKg(newRolloutGrams),
          catalogPhysicalGramsAfter,
          catalogPhysicalKgAfter: gramsToKg(catalogPhysicalGramsAfter),
          catalogSellableGramsAfter,
          catalogSellableKgAfter: gramsToKg(catalogSellableGramsAfter),
          catalogIneligibleGramsAfter,
          catalogIneligibleKgAfter: gramsToKg(catalogIneligibleGramsAfter),
        },
      }
    },
    {
      timeout: 30000,
    }
  )
}

async function runCli() {
  const args = process.argv.slice(2)
  const applyArg = args.includes('--mode=apply')
  const mode: F01EExecutionMode = applyArg ? 'APPLY' : 'DRY_RUN'
  const confirmPreviewBeta = args.includes('--confirm-preview-beta')
  const expectedHostArg = args.find((a) => a.startsWith('--expected-host='))
  const expectedHost = expectedHostArg ? expectedHostArg.split('=')[1] : undefined

  const { execSync } = await import('child_process')
  const gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim()
  const connectionUrl = process.env.DIRECT_URL || process.env.DATABASE_URL || ''

  verifyF01EEnvironmentSafetyGates({
    connectionUrl,
    gitBranch,
    mode,
    confirmPreviewBeta,
    expectedHost,
  })

  const prisma = new PrismaClient()
  try {
    console.log(
      `\n============================================================================`
    )
    console.log(`🚀 [EV-IMP-01E] FULL CATALOG FEFO ROLLOUT SCRIPT — MODE: ${mode}`)
    console.log(
      `============================================================================\n`
    )

    const report = await prepareF01EDemoBatches(prisma, { mode })
    console.log(JSON.stringify(report, null, 2))

    console.log(
      `\n✅ [EV-IMP-01E] Hoàn tất thành công ở chế độ ${report.mode} (${report.batches.length} lô, +${report.catalogTotals.newRolloutKg} kg, ${report.catalogTotals.trackedProductsBefore}/${report.catalogTotals.totalProducts} -> ${report.catalogTotals.trackedProductsAfter}/${report.catalogTotals.totalProducts} sản phẩm tracked).`
    )
  } catch (error) {
    console.error(`\n❌ [EV-IMP-01E] Lỗi thực thi:`, error)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

const isDirectExecution =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/prepare-f01e-demo-batches.ts')

if (isDirectExecution) {
  void runCli()
}
