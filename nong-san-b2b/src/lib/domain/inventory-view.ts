/**
 * MODULE F & D — SHARED INVENTORY VIEW & PRESENTATION DOMAIN (F01D)
 *
 * Pure functions and contracts shared between:
 * - Admin Inventory Dashboard (/admin/ton-kho)
 * - Admin FEFO Batch Management (/admin/lo-hang)
 * - Admin Inventory Ledger History (/admin/ton-kho/lich-su)
 * - Storefront Public Stock Visibility (/san-pham, /san-pham/[slug], /gio-hang, /thanh-toan)
 *
 * Strictly adheres to F01A FEFO Core (`src/lib/domain/inventory.ts`):
 * - All internal calculations use integer grams (`Int`).
 * - Conversion to kg is for display only and NEVER rounds up (`Math.ceil` is forbidden).
 * - Only ACTIVE + isFefoEligible + non-expired batches with expiryDate contribute to sellable Available Stock.
 */

import { BatchStatus, InventoryLedgerType } from '@prisma/client'
import {
  calculateStockFromLedger,
  calculateUnreleasedAllocationGrams,
  evaluateBatchEligibility,
  sortBatchesByFefo,
  toVietnamCalendarDate,
  verifyInventoryInvariants,
  type AllocationStateInput,
  type BatchCandidate,
  type BatchStockSummary,
  type LedgerEntry,
} from './inventory'

// ============================================================================
// 1. CONSTANTS & LOW STOCK RULE DEFINITION
// ============================================================================

/**
 * Ngưỡng cảnh báo hạn sử dụng (tính theo ngày lịch Asia/Ho_Chi_Minh).
 */
export const EXPIRY_URGENT_DAYS = 3
export const EXPIRY_WARNING_DAYS = 7

/**
 * Quy tắc cảnh báo tồn kho thấp (Module D — Mục 8.2):
 * Trong B2B Nông sản, mỗi sản phẩm có mức đặt hàng tối thiểu `moqGrams`.
 * - OUT_OF_STOCK: `availableGrams === 0` (Hết tồn khả dụng)
 * - BELOW_MOQ: `0 < availableGrams < moqGrams` (Tồn kho thấp dưới ngưỡng MOQ — khách sỉ không thể đặt đơn tiêu chuẩn)
 * - LOW_STOCK: `moqGrams <= availableGrams < moqGrams * 2` (Tồn kho chạm vùng cảnh báo — chỉ còn đủ khoảng 1 đơn MOQ)
 * - NORMAL: `availableGrams >= moqGrams * 2` (Tồn kho an toàn)
 */
export const LOW_STOCK_MOQ_MULTIPLIER = 2

// ============================================================================
// 2. TYPES & CONTRACTS
// ============================================================================

export type ExpiryAlertLevel =
  | 'EXPIRED'
  | 'EXPIRING_3_DAYS'
  | 'EXPIRING_7_DAYS'
  | 'NORMAL'
  | 'UNKNOWN_EXPIRY'

export interface BatchExpiryAlert {
  level: ExpiryAlertLevel
  label: string
  daysRemaining: number | null
  isExpired: boolean
  isExpiringSoon: boolean
}

export type ProductStockAlertLevel =
  | 'UNTRACKED'
  | 'OUT_OF_STOCK'
  | 'BELOW_MOQ'
  | 'LOW_STOCK'
  | 'NORMAL'
  | 'DATA_ERROR'

export interface ProductStockAlert {
  level: ProductStockAlertLevel
  label: string
  description: string
}

export type BatchAnomalyCode =
  | 'NEGATIVE_PHYSICAL_STOCK'
  | 'NEGATIVE_RESERVED_STOCK'
  | 'RESERVED_EXCEEDS_PHYSICAL'
  | 'ALLOCATION_LEDGER_MISMATCH'
  | 'ACTIVE_FEFO_MISSING_EXPIRY'
  | 'ACTIVE_FEFO_EMPTY_LEDGER'
  | 'OVERDUE_HOLD_PENDING'

export interface BatchAnomaly {
  code: BatchAnomalyCode
  severity: 'CRITICAL' | 'WARNING'
  message: string
}

export interface BatchInventorySnapshotInput {
  id: string
  code: string
  productId: string
  productName: string
  productSlug: string
  productTrackingEnabled: boolean
  farmId: string
  farmName: string
  harvestDate: Date | string
  expiryDate: Date | string | null
  receivedAt?: Date | string | null
  status: BatchStatus
  isFefoEligible: boolean
  initialQuantityGrams: number | null
  harvestGrams: number | null
  qcNotes: string | null
  createdAt: Date | string
  ledgerEntries: LedgerEntry[]
  allocations?: Array<
    AllocationStateInput & {
      id?: string
      orderId?: string
      orderCode?: string
      holdExpiresAt?: Date | string | null
      createdAt?: Date | string
    }
  >
}

export interface EvaluatedBatchInventory {
  id: string
  code: string
  productId: string
  productName: string
  productSlug: string
  productTrackingEnabled: boolean
  farmId: string
  farmName: string
  harvestDate: string
  expiryDate: string | null
  receivedAt: string | null
  status: BatchStatus
  isFefoEligible: boolean
  initialQuantityGrams: number
  harvestGrams: number | null
  qcNotes: string | null
  createdAt: string
  /** Số dư tính từ InventoryLedger */
  stockSummary: BatchStockSummary
  /** Tồn vật lý trong kho của lô (gram) */
  physicalStockGrams: number
  /** Tồn đang giữ chỗ của lô (gram) */
  reservedGrams: number
  /** Tồn khả dụng thô từ sổ cái (Physical - Reserved) */
  ledgerAvailableGrams: number
  /** Tồn khả dụng thực tế được phép bán theo FEFO (chỉ > 0 khi lô đủ điều kiện FEFO) */
  sellableAvailableGrams: number
  /** Tồn không đủ điều kiện bán (lô hết hạn, UNVERIFIED, LOCKED_QC, tắt FEFO...) */
  ineligibleStockGrams: number
  /** Đã xuất kho thực tế */
  dispatchedGrams: number
  /** Hao hụt */
  shrinkageLossGrams: number
  /** Điều chỉnh QC ròng */
  netQcAdjustmentGrams: number
  /** Kết quả đánh giá điều kiện FEFO */
  fefoEligibility: {
    eligible: boolean
    reason: string | null
    label: string
  }
  /** Cảnh báo hạn dùng */
  expiryAlert: BatchExpiryAlert
  /** Đối soát bất thường dữ liệu */
  anomalies: BatchAnomaly[]
  /** Số lượng giữ chỗ đang quá hạn chờ thu hồi (nếu có) */
  overdueHoldGrams: number
  ledgerCount: number
}

export type PublicStockStatus =
  | 'UNTRACKED'
  | 'IN_STOCK'
  | 'BELOW_MOQ'
  | 'OUT_OF_STOCK'
  | 'DATA_ERROR'

/**
 * Hợp đồng dữ liệu tồn kho công khai cho Storefront (Module F & E).
 */
export interface PublicStockView {
  productId: string
  tracked: boolean
  status: PublicStockStatus
  /** Tồn khả dụng tính bằng gram (null nếu sản phẩm chưa bật quản lý tồn kho) */
  availableGrams: number | null
  /** Tồn khả dụng quy đổi ra kg, không bao giờ làm tròn lên (null nếu chưa bật tracking) */
  availableKg: number | null
  /** Chuỗi số kg đã định dạng an toàn (ví dụ: "300", "135.5") */
  availableKgFormatted: string | null
  moqGrams: number
  moqKgFormatted: string
  /** Khách có thể đặt đơn sỉ tiêu chuẩn (>= MOQ) hay không */
  isOrderable: boolean
  /** Thông điệp hiển thị trên trang Chi tiết sản phẩm (/san-pham/[slug]) */
  detailLabel: string | null
  /** Nhãn ngắn gọn hiển thị trên Product Card (/san-pham, trang chủ) */
  cardBadgeLabel: string | null
  /** Thời điểm ghi nhận số liệu (ISO string) */
  observedAt: string
}

export interface EvaluatedProductInventory {
  productId: string
  name: string
  slug: string
  category?: string
  farmId: string
  farmName: string
  inventoryTrackingEnabled: boolean
  moqGrams: number
  isActive: boolean
  totalBatchesCount: number
  eligibleActiveBatchesCount: number
  unverifiedBatchesCount: number
  expiredBatchesCount: number
  expiringSoonBatchesCount: number
  /** Tổng nhập ban đầu của các lô có sổ cái */
  importedGrams: number
  /** Tồn vật lý thực tế (Physical Stock) */
  physicalStockGrams: number
  /** Tồn đang giữ chỗ (Reserved Stock) */
  reservedStockGrams: number
  /** Tồn khả dụng bán được theo FEFO (Available Stock — khớp 100% với Storefront) */
  availableStockGrams: number
  /** Tồn nằm ở các lô không đủ điều kiện FEFO (hết hạn / UNVERIFIED / khóa QC) */
  ineligibleStockGrams: number
  /** Đã xuất kho (Dispatched Stock) */
  dispatchedStockGrams: number
  /** Hạn sử dụng gần nhất của lô FEFO khả dụng */
  nearestExpiryDate: string | null
  nearestExpiryAlert: BatchExpiryAlert | null
  stockAlert: ProductStockAlert
  anomalies: BatchAnomaly[]
  publicStock: PublicStockView
  batches: EvaluatedBatchInventory[]
}

// ============================================================================
// 3. SAFE KG FORMATTING (NO ROUNDING UP)
// ============================================================================

/**
 * Quy đổi từ gram sang số thực kg, làm tròn xuống đến hàng 10g (2 chữ số thập phân)
 * hoặc giữ nguyên 3 chữ số thập phân nếu nhỏ hơn 10g.
 * TUYỆT ĐỐI KHÔNG làm tròn lên (Math.ceil bị cấm) để tránh hiển thị vượt tồn thực tế.
 */
export function gramsToSafeDisplayKg(grams: number): number {
  if (!Number.isFinite(grams) || grams <= 0) {
    return 0
  }
  const intGrams = Math.trunc(grams)
  if (intGrams < 10) {
    return intGrams / 1000
  }
  return Math.floor(intGrams / 10) / 100
}

/**
 * Format số gram sang chuỗi số kg (không kèm chữ "kg").
 * Ví dụ:
 * - 300000 -> "300"
 * - 135500 -> "135.5"
 * - 135999 -> "135.99" (không làm tròn lên 136)
 * - 0 -> "0"
 */
export function formatAvailableKgNumber(grams: number): string {
  if (!Number.isFinite(grams) || grams <= 0) {
    return '0'
  }
  const safeKg = gramsToSafeDisplayKg(grams)
  return safeKg.toString()
}

/**
 * Format số gram sang chuỗi có đơn vị "kg".
 * Ví dụ: 300000 -> "300 kg", 135500 -> "135.5 kg"
 */
export function formatAvailableKgWithUnit(grams: number): string {
  return `${formatAvailableKgNumber(grams)} kg`
}

// ============================================================================
// 4. EXPIRY & LOW-STOCK ALERT EVALUATION (MODULE D)
// ============================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Tính số ngày còn lại giữa ngày hết hạn và ngày tham chiếu theo múi giờ Asia/Ho_Chi_Minh.
 */
export function evaluateBatchExpiryAlert(
  expiryDate: Date | string | null | undefined,
  referenceDate: Date = new Date()
): BatchExpiryAlert {
  if (!expiryDate) {
    return {
      level: 'UNKNOWN_EXPIRY',
      label: 'Không xác định hạn dùng',
      daysRemaining: null,
      isExpired: false,
      isExpiringSoon: false,
    }
  }

  const parsedExpiry = expiryDate instanceof Date ? expiryDate : new Date(expiryDate)
  if (Number.isNaN(parsedExpiry.getTime())) {
    return {
      level: 'UNKNOWN_EXPIRY',
      label: 'Không xác định hạn dùng',
      daysRemaining: null,
      isExpired: false,
      isExpiringSoon: false,
    }
  }

  const expiryStr = toVietnamCalendarDate(parsedExpiry)
  const refStr = toVietnamCalendarDate(referenceDate)

  const [expY, expM, expD] = expiryStr.split('-').map(Number)
  const [refY, refM, refD] = refStr.split('-').map(Number)

  const expiryUtcMidnight = Date.UTC(expY, expM - 1, expD)
  const refUtcMidnight = Date.UTC(refY, refM - 1, refD)
  const daysRemaining = Math.round((expiryUtcMidnight - refUtcMidnight) / MS_PER_DAY)

  if (daysRemaining < 0) {
    return {
      level: 'EXPIRED',
      label: `Đã hết hạn (${Math.abs(daysRemaining)} ngày)`,
      daysRemaining,
      isExpired: true,
      isExpiringSoon: false,
    }
  }

  if (daysRemaining <= EXPIRY_URGENT_DAYS) {
    return {
      level: 'EXPIRING_3_DAYS',
      label:
        daysRemaining === 0
          ? 'Hết hạn hôm nay'
          : `Sắp hết hạn (còn ${daysRemaining} ngày)`,
      daysRemaining,
      isExpired: false,
      isExpiringSoon: true,
    }
  }

  if (daysRemaining <= EXPIRY_WARNING_DAYS) {
    return {
      level: 'EXPIRING_7_DAYS',
      label: `Sắp hết hạn (còn ${daysRemaining} ngày)`,
      daysRemaining,
      isExpired: false,
      isExpiringSoon: true,
    }
  }

  return {
    level: 'NORMAL',
    label: `Còn ${daysRemaining} ngày`,
    daysRemaining,
    isExpired: false,
    isExpiringSoon: false,
  }
}

/**
 * Đánh giá cảnh báo mức tồn kho khả dụng của sản phẩm theo ngưỡng MOQ B2B.
 */
export function evaluateProductStockAlert(params: {
  inventoryTrackingEnabled: boolean
  availableGrams: number
  moqGrams: number
  hasCriticalAnomaly?: boolean
}): ProductStockAlert {
  const { inventoryTrackingEnabled, availableGrams, moqGrams, hasCriticalAnomaly } = params

  if (!inventoryTrackingEnabled) {
    return {
      level: 'UNTRACKED',
      label: 'Chưa bật quản lý tồn kho',
      description: 'Sản phẩm vận hành theo luồng đặt hàng tiêu chuẩn, không áp dụng giữ chỗ FEFO.',
    }
  }

  if (hasCriticalAnomaly || !Number.isFinite(availableGrams) || availableGrams < 0) {
    return {
      level: 'DATA_ERROR',
      label: 'Cần kiểm tra dữ liệu',
      description: 'Phát hiện sai lệch số dư sổ cái hoặc phân bổ lô hàng.',
    }
  }

  const safeMoq = Math.max(1000, Math.trunc(moqGrams || 0))

  if (availableGrams === 0) {
    return {
      level: 'OUT_OF_STOCK',
      label: 'Hết tồn khả dụng',
      description: '0 kg khả dụng trên các lô FEFO hợp lệ.',
    }
  }

  if (availableGrams < safeMoq) {
    return {
      level: 'BELOW_MOQ',
      label: 'Tồn thấp (Dưới MOQ)',
      description: `Còn ${formatAvailableKgWithUnit(availableGrams)}, thấp hơn MOQ ${formatAvailableKgWithUnit(safeMoq)}.`,
    }
  }

  if (availableGrams < safeMoq * LOW_STOCK_MOQ_MULTIPLIER) {
    return {
      level: 'LOW_STOCK',
      label: 'Sắp chạm ngưỡng MOQ',
      description: `Còn ${formatAvailableKgWithUnit(availableGrams)} (dưới 2 lần MOQ ${formatAvailableKgWithUnit(safeMoq)}).`,
    }
  }

  return {
    level: 'NORMAL',
    label: 'Tồn bình thường',
    description: `Đủ cung ứng (${formatAvailableKgWithUnit(availableGrams)} khả dụng).`,
  }
}

// ============================================================================
// 5. PUBLIC STOCK VIEW BUILDER (MODULE E & F)
// ============================================================================

/**
 * Xây dựng dữ liệu hiển thị tồn kho công khai cho Storefront.
 */
export function buildPublicStockView(params: {
  productId: string
  inventoryTrackingEnabled: boolean
  availableGrams: number | null | undefined
  moqGrams: number
  hasDataError?: boolean
  observedAt?: Date | string
}): PublicStockView {
  const {
    productId,
    inventoryTrackingEnabled,
    availableGrams,
    moqGrams,
    hasDataError = false,
    observedAt = new Date(),
  } = params

  const observedIso =
    observedAt instanceof Date ? observedAt.toISOString() : new Date(observedAt).toISOString()
  const safeMoqGrams = Math.max(0, Math.trunc(moqGrams || 0))
  const moqKgFormatted = formatAvailableKgNumber(safeMoqGrams)

  if (!inventoryTrackingEnabled) {
    return {
      productId,
      tracked: false,
      status: 'UNTRACKED',
      availableGrams: null,
      availableKg: null,
      availableKgFormatted: null,
      moqGrams: safeMoqGrams,
      moqKgFormatted,
      isOrderable: true,
      detailLabel: null,
      cardBadgeLabel: null,
      observedAt: observedIso,
    }
  }

  if (
    hasDataError ||
    availableGrams === null ||
    availableGrams === undefined ||
    !Number.isFinite(availableGrams) ||
    availableGrams < 0
  ) {
    return {
      productId,
      tracked: true,
      status: 'DATA_ERROR',
      availableGrams: null,
      availableKg: null,
      availableKgFormatted: null,
      moqGrams: safeMoqGrams,
      moqKgFormatted,
      isOrderable: false,
      detailLabel: 'Chưa thể xác nhận tồn kho',
      cardBadgeLabel: 'Chưa xác nhận tồn',
      observedAt: observedIso,
    }
  }

  const safeAvailableGrams = Math.max(0, Math.trunc(availableGrams))
  const availableKg = gramsToSafeDisplayKg(safeAvailableGrams)
  const availableKgFormatted = formatAvailableKgNumber(safeAvailableGrams)

  if (safeAvailableGrams === 0) {
    return {
      productId,
      tracked: true,
      status: 'OUT_OF_STOCK',
      availableGrams: 0,
      availableKg: 0,
      availableKgFormatted: '0',
      moqGrams: safeMoqGrams,
      moqKgFormatted,
      isOrderable: false,
      detailLabel: 'Hết hàng — 0 kg khả dụng',
      cardBadgeLabel: 'Hết hàng',
      observedAt: observedIso,
    }
  }

  if (safeAvailableGrams < safeMoqGrams) {
    return {
      productId,
      tracked: true,
      status: 'BELOW_MOQ',
      availableGrams: safeAvailableGrams,
      availableKg,
      availableKgFormatted,
      moqGrams: safeMoqGrams,
      moqKgFormatted,
      isOrderable: false,
      detailLabel: `Hiện còn ${availableKgFormatted} kg, chưa đủ số lượng đặt tối thiểu ${moqKgFormatted} kg`,
      cardBadgeLabel: `Còn ${availableKgFormatted} kg`,
      observedAt: observedIso,
    }
  }

  return {
    productId,
    tracked: true,
    status: 'IN_STOCK',
    availableGrams: safeAvailableGrams,
    availableKg,
    availableKgFormatted,
    moqGrams: safeMoqGrams,
    moqKgFormatted,
    isOrderable: true,
    detailLabel: `Còn ${availableKgFormatted} kg trong kho`,
    cardBadgeLabel: `Còn ${availableKgFormatted} kg`,
    observedAt: observedIso,
  }
}

/**
 * Kiểm tra cảnh báo tồn kho cho một dòng sản phẩm trong Giỏ hàng hoặc Checkout (Mục 9.3 & 9.4).
 */
export function evaluateCartItemStockWarning(params: {
  productName: string
  requestedGrams: number
  publicStock: PublicStockView | null | undefined
}): {
  exceedsStock: boolean
  warningMessage: string | null
} {
  const { productName, requestedGrams, publicStock } = params

  if (!publicStock || !publicStock.tracked) {
    return { exceedsStock: false, warningMessage: null }
  }

  if (publicStock.status === 'DATA_ERROR' || publicStock.availableGrams === null) {
    return {
      exceedsStock: true,
      warningMessage: `Chưa thể xác nhận tồn kho cho sản phẩm ${productName}. Vui lòng thử lại sau.`,
    }
  }

  const safeRequestedGrams = Math.max(0, Math.trunc(requestedGrams))
  if (safeRequestedGrams <= 0) {
    return { exceedsStock: false, warningMessage: null }
  }

  if (safeRequestedGrams > publicStock.availableGrams) {
    return {
      exceedsStock: true,
      warningMessage: `Kho hiện chỉ còn ${publicStock.availableKgFormatted} kg ${productName}. Vui lòng giảm số lượng đặt.`,
    }
  }

  return { exceedsStock: false, warningMessage: null }
}

// ============================================================================
// 6. BATCH & PRODUCT INVENTORY EVALUATION (SHARED ENGINE)
// ============================================================================

const FEFO_REASON_LABELS: Record<string, string> = {
  BATCH_UNVERIFIED: 'Lô chưa xác minh tồn kho (Lô lịch sử / QR)',
  NOT_FEFO_ELIGIBLE: 'Chưa bật cờ đủ điều kiện FEFO (Lô lịch sử / QR)',
  BATCH_LOCKED_QC: 'Đang phong tỏa kiểm định QC',
  MISSING_EXPIRY_DATE: 'Thiếu ngày hết hạn sử dụng',
  BATCH_EXPIRED: 'Lô hàng đã quá hạn sử dụng',
  BATCH_DEPLETED: 'Lô hàng đã xuất hết',
  NO_AVAILABLE_STOCK: 'Đã hết số lượng khả dụng (0 kg)',
  PRODUCT_MISMATCH: 'Không khớp sản phẩm',
}

/**
 * Đánh giá chi tiết 1 lô hàng từ sổ cái InventoryLedger và danh sách Allocation.
 */
export function evaluateBatchInventory(
  input: BatchInventorySnapshotInput,
  referenceDate: Date = new Date()
): EvaluatedBatchInventory {
  const stockSummary = calculateStockFromLedger(input.ledgerEntries)

  // Kiểm tra các allocation đang HOLD_PENDING nhưng đã quá hạn thanh toán
  let overdueHoldGrams = 0
  if (input.allocations && input.allocations.length > 0) {
    for (const alloc of input.allocations) {
      if (alloc.status === 'HOLD_PENDING' && alloc.holdExpiresAt) {
        const exp =
          alloc.holdExpiresAt instanceof Date
            ? alloc.holdExpiresAt
            : new Date(alloc.holdExpiresAt)
        if (!Number.isNaN(exp.getTime()) && exp.getTime() < referenceDate.getTime()) {
          overdueHoldGrams += calculateUnreleasedAllocationGrams(alloc)
        }
      }
    }
  }

  const eligibilityCheck = evaluateBatchEligibility(
    {
      id: input.id,
      code: input.code,
      productId: input.productId,
      farmId: input.farmId,
      status: input.status,
      isFefoEligible: input.isFefoEligible,
      expiryDate: input.expiryDate,
      harvestDate: input.harvestDate,
      physicalStockGrams: stockSummary.physicalStockGrams,
      reservedGrams: stockSummary.reservedGrams,
    },
    { referenceDate }
  )

  const expiryAlert = evaluateBatchExpiryAlert(input.expiryDate, referenceDate)

  // Lô chỉ đóng góp vào sellableAvailableGrams khi sản phẩm bật tracking VÀ lô đủ điều kiện FEFO
  const sellableAvailableGrams =
    input.productTrackingEnabled && eligibilityCheck.eligible ? stockSummary.availableGrams : 0

  // Nếu lô có tồn trong sổ cái nhưng không đủ điều kiện FEFO (hết hạn, UNVERIFIED, LOCKED_QC...),
  // phần tồn chưa bị giữ chỗ này được phân loại vào Ineligible Stock.
  const ineligibleStockGrams = eligibilityCheck.eligible ? 0 : stockSummary.availableGrams

  // Phát hiện bất thường dữ liệu (Module D — Mục 8.3)
  const anomalies: BatchAnomaly[] = []

  const invariantResult = verifyInventoryInvariants(stockSummary)
  if (!invariantResult.valid) {
    if (stockSummary.rawPhysicalStockGrams < 0) {
      anomalies.push({
        code: 'NEGATIVE_PHYSICAL_STOCK',
        severity: 'CRITICAL',
        message: `Tồn vật lý âm trên sổ cái (${stockSummary.rawPhysicalStockGrams} g).`,
      })
    }

    if (stockSummary.rawReservedGrams < 0) {
      anomalies.push({
        code: 'NEGATIVE_RESERVED_STOCK',
        severity: 'CRITICAL',
        message: `Tồn giữ chỗ âm trên sổ cái (${stockSummary.rawReservedGrams} g).`,
      })
    }

    if (stockSummary.rawAvailableGrams < 0) {
      anomalies.push({
        code: 'RESERVED_EXCEEDS_PHYSICAL',
        severity: 'CRITICAL',
        message: `Số lượng giữ chỗ (${stockSummary.rawReservedGrams} g) vượt quá tồn vật lý (${stockSummary.rawPhysicalStockGrams} g).`,
      })
    }
  }

  // Kiểm tra đối soát giữa tổng OrderItemBatchAllocation chưa giải phóng và số dư giữ chỗ trên InventoryLedger
  if (input.allocations && input.allocations.length > 0) {
    const totalUnreleasedFromAllocations = input.allocations.reduce(
      (sum, alloc) => sum + calculateUnreleasedAllocationGrams(alloc),
      0
    )
    if (totalUnreleasedFromAllocations !== stockSummary.rawReservedGrams) {
      anomalies.push({
        code: 'ALLOCATION_LEDGER_MISMATCH',
        severity: 'CRITICAL',
        message: `Tổng phân bổ giữ chỗ (${totalUnreleasedFromAllocations} g) không khớp với số dư giữ chỗ trên InventoryLedger (${stockSummary.rawReservedGrams} g).`,
      })
    }
  }

  if (input.status === 'ACTIVE' && input.isFefoEligible && !input.expiryDate) {
    anomalies.push({
      code: 'ACTIVE_FEFO_MISSING_EXPIRY',
      severity: 'CRITICAL',
      message: 'Lô ACTIVE bật FEFO nhưng thiếu ngày hết hạn (expiryDate).',
    })
  }

  if (input.status === 'ACTIVE' && input.isFefoEligible && input.ledgerEntries.length === 0) {
    anomalies.push({
      code: 'ACTIVE_FEFO_EMPTY_LEDGER',
      severity: 'WARNING',
      message: 'Lô ACTIVE bật FEFO nhưng chưa có bút toán nhập kho (IMPORT) trong sổ cái.',
    })
  }

  if (overdueHoldGrams > 0) {
    anomalies.push({
      code: 'OVERDUE_HOLD_PENDING',
      severity: 'WARNING',
      message: `Có ${formatAvailableKgWithUnit(overdueHoldGrams)} đang ở trạng thái HOLD_PENDING đã quá hạn thanh toán chờ thu hồi.`,
    })
  }

  const harvestIso =
    input.harvestDate instanceof Date
      ? input.harvestDate.toISOString()
      : new Date(input.harvestDate).toISOString()
  const expiryIso = input.expiryDate
    ? input.expiryDate instanceof Date
      ? input.expiryDate.toISOString()
      : new Date(input.expiryDate).toISOString()
    : null
  const receivedIso = input.receivedAt
    ? input.receivedAt instanceof Date
      ? input.receivedAt.toISOString()
      : new Date(input.receivedAt).toISOString()
    : null
  const createdIso =
    input.createdAt instanceof Date
      ? input.createdAt.toISOString()
      : new Date(input.createdAt).toISOString()

  const initialQuantityGrams =
    stockSummary.importGrams > 0
      ? stockSummary.importGrams
      : Math.max(0, Math.trunc(input.initialQuantityGrams ?? input.harvestGrams ?? 0))

  const netQcAdjustmentGrams =
    stockSummary.rawPhysicalStockGrams -
    (stockSummary.importGrams - stockSummary.dispatchedGrams - stockSummary.shrinkageGrams)

  return {
    id: input.id,
    code: input.code,
    productId: input.productId,
    productName: input.productName,
    productSlug: input.productSlug,
    productTrackingEnabled: input.productTrackingEnabled,
    farmId: input.farmId,
    farmName: input.farmName,
    harvestDate: harvestIso,
    expiryDate: expiryIso,
    receivedAt: receivedIso,
    status: input.status,
    isFefoEligible: input.isFefoEligible,
    initialQuantityGrams,
    harvestGrams: input.harvestGrams,
    qcNotes: input.qcNotes,
    createdAt: createdIso,
    stockSummary,
    physicalStockGrams: stockSummary.physicalStockGrams,
    reservedGrams: stockSummary.reservedGrams,
    ledgerAvailableGrams: stockSummary.availableGrams,
    sellableAvailableGrams,
    ineligibleStockGrams,
    dispatchedGrams: stockSummary.dispatchedGrams,
    shrinkageLossGrams: stockSummary.shrinkageGrams,
    netQcAdjustmentGrams,
    fefoEligibility: {
      eligible: eligibilityCheck.eligible,
      reason: eligibilityCheck.reason ?? null,
      label: eligibilityCheck.eligible
        ? 'Đủ điều kiện FEFO'
        : FEFO_REASON_LABELS[eligibilityCheck.reason || ''] || 'Không đủ điều kiện FEFO',
    },
    expiryAlert,
    anomalies,
    overdueHoldGrams,
    ledgerCount: input.ledgerEntries.length,
  }
}

/**
 * Sắp xếp danh sách lô hàng cho Admin:
 * 1. Các lô đủ điều kiện FEFO xếp trước theo chuẩn FEFO:
 *    expiryDate ASC -> harvestDate ASC -> code ASC -> id ASC
 * 2. Các lô không đủ điều kiện FEFO / UNVERIFIED xếp tách biệt phía sau theo ngày tạo mới nhất.
 */
export function sortEvaluatedBatchesForAdmin(
  batches: EvaluatedBatchInventory[]
): EvaluatedBatchInventory[] {
  const fefoCandidates: BatchCandidate[] = []
  const byId = new Map<string, EvaluatedBatchInventory>()
  const nonFefoBatches: EvaluatedBatchInventory[] = []

  for (const batch of batches) {
    byId.set(batch.id, batch)
    if (batch.fefoEligibility.eligible && batch.expiryDate) {
      fefoCandidates.push({
        id: batch.id,
        code: batch.code,
        productId: batch.productId,
        farmId: batch.farmId,
        status: batch.status,
        isFefoEligible: batch.isFefoEligible,
        expiryDate: batch.expiryDate,
        harvestDate: batch.harvestDate,
        physicalStockGrams: batch.physicalStockGrams,
        reservedGrams: batch.reservedGrams,
      })
    } else {
      nonFefoBatches.push(batch)
    }
  }

  const sortedFefo = sortBatchesByFefo(fefoCandidates)
    .map((c) => byId.get(c.id)!)
    .filter(Boolean)

  const sortedNonFefo = [...nonFefoBatches].sort((a, b) => {
    const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    if (timeDiff !== 0) return timeDiff
    return a.code.localeCompare(b.code)
  })

  return [...sortedFefo, ...sortedNonFefo]
}

/**
 * Tổng hợp tồn kho cấp Sản phẩm từ danh sách các lô hàng của sản phẩm đó.
 */
export function evaluateProductInventory(params: {
  productId: string
  name: string
  slug: string
  category?: string
  farmId: string
  farmName: string
  inventoryTrackingEnabled: boolean
  moqGrams: number
  isActive: boolean
  batches: BatchInventorySnapshotInput[]
  referenceDate?: Date
}): EvaluatedProductInventory {
  const referenceDate = params.referenceDate ?? new Date()

  const evaluatedBatches = sortEvaluatedBatchesForAdmin(
    params.batches.map((b) => evaluateBatchInventory(b, referenceDate))
  )

  let importedGrams = 0
  let physicalStockGrams = 0
  let reservedStockGrams = 0
  let availableStockGrams = 0
  let ineligibleStockGrams = 0
  let dispatchedStockGrams = 0

  let eligibleActiveBatchesCount = 0
  let unverifiedBatchesCount = 0
  let expiredBatchesCount = 0
  let expiringSoonBatchesCount = 0

  const allAnomalies: BatchAnomaly[] = []
  let nearestExpiryDate: string | null = null
  let nearestExpiryAlert: BatchExpiryAlert | null = null

  for (const batch of evaluatedBatches) {
    importedGrams += batch.stockSummary.importGrams
    physicalStockGrams += batch.physicalStockGrams
    reservedStockGrams += batch.reservedGrams
    availableStockGrams += batch.sellableAvailableGrams
    ineligibleStockGrams += batch.ineligibleStockGrams
    dispatchedStockGrams += batch.dispatchedGrams

    if (batch.status === 'UNVERIFIED') {
      unverifiedBatchesCount += 1
    }

    if (batch.fefoEligibility.eligible) {
      eligibleActiveBatchesCount += 1
      if (!nearestExpiryDate && batch.expiryDate) {
        nearestExpiryDate = batch.expiryDate
        nearestExpiryAlert = batch.expiryAlert
      }
    }

    if (batch.isFefoEligible && batch.expiryAlert.isExpired) {
      expiredBatchesCount += 1
    } else if (
      batch.isFefoEligible &&
      batch.expiryAlert.isExpiringSoon &&
      batch.physicalStockGrams > 0
    ) {
      expiringSoonBatchesCount += 1
    }

    for (const anomaly of batch.anomalies) {
      allAnomalies.push({
        ...anomaly,
        message: `[Lô ${batch.code}] ${anomaly.message}`,
      })
    }
  }

  const hasCriticalAnomaly = allAnomalies.some((a) => a.severity === 'CRITICAL')

  const stockAlert = evaluateProductStockAlert({
    inventoryTrackingEnabled: params.inventoryTrackingEnabled,
    availableGrams: availableStockGrams,
    moqGrams: params.moqGrams,
    hasCriticalAnomaly,
  })

  const publicStock = buildPublicStockView({
    productId: params.productId,
    inventoryTrackingEnabled: params.inventoryTrackingEnabled,
    availableGrams: availableStockGrams,
    moqGrams: params.moqGrams,
    hasDataError: hasCriticalAnomaly,
    observedAt: referenceDate,
  })

  return {
    productId: params.productId,
    name: params.name,
    slug: params.slug,
    category: params.category,
    farmId: params.farmId,
    farmName: params.farmName,
    inventoryTrackingEnabled: params.inventoryTrackingEnabled,
    moqGrams: params.moqGrams,
    isActive: params.isActive,
    totalBatchesCount: evaluatedBatches.length,
    eligibleActiveBatchesCount,
    unverifiedBatchesCount,
    expiredBatchesCount,
    expiringSoonBatchesCount,
    importedGrams,
    physicalStockGrams,
    reservedStockGrams,
    availableStockGrams,
    ineligibleStockGrams,
    dispatchedStockGrams,
    nearestExpiryDate,
    nearestExpiryAlert,
    stockAlert,
    anomalies: allAnomalies,
    publicStock,
    batches: evaluatedBatches,
  }
}

/**
 * Helper hiển thị nhãn tiếng Việt cho loại bút toán sổ cái InventoryLedgerType.
 */
export function getLedgerTypePresentation(type: InventoryLedgerType): {
  label: string
  shortLabel: string
  sign: '+' | '-' | 'HOLD' | 'RELEASE' | '±'
  badgeClass: string
  effectDescription: string
} {
  switch (type) {
    case 'IMPORT':
      return {
        label: 'Nhập kho ban đầu (IMPORT)',
        shortLabel: 'Nhập kho',
        sign: '+',
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        effectDescription: 'Tăng tồn vật lý & tồn khả dụng',
      }
    case 'RESERVATION_HOLD':
      return {
        label: 'Giữ chỗ đơn hàng (RESERVATION_HOLD)',
        shortLabel: 'Giữ chỗ FEFO',
        sign: 'HOLD',
        badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
        effectDescription: 'Tăng tồn giữ chỗ, giảm tồn khả dụng',
      }
    case 'RESERVATION_RELEASE':
      return {
        label: 'Giải phóng giữ chỗ (RESERVATION_RELEASE)',
        shortLabel: 'Hoàn giữ chỗ',
        sign: 'RELEASE',
        badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
        effectDescription: 'Giảm tồn giữ chỗ, hoàn lại tồn khả dụng',
      }
    case 'DISPATCH_OUT':
      return {
        label: 'Xuất kho giao hàng (DISPATCH_OUT)',
        shortLabel: 'Xuất kho',
        sign: '-',
        badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        effectDescription: 'Giảm tồn vật lý & kết thúc giữ chỗ',
      }
    case 'SHRINKAGE_LOSS':
      return {
        label: 'Hao hụt tự nhiên (SHRINKAGE_LOSS)',
        shortLabel: 'Hao hụt',
        sign: '-',
        badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
        effectDescription: 'Giảm tồn vật lý & tồn khả dụng',
      }
    case 'QC_ADJUSTMENT_ADD':
      return {
        label: 'Kiểm định QC cộng thêm (QC_ADJUSTMENT_ADD)',
        shortLabel: 'QC (+)',
        sign: '+',
        badgeClass: 'bg-teal-50 text-teal-700 border-teal-200',
        effectDescription: 'Tăng tồn vật lý sau kiểm định',
      }
    case 'QC_ADJUSTMENT_SUB':
      return {
        label: 'Kiểm định QC trừ bớt (QC_ADJUSTMENT_SUB)',
        shortLabel: 'QC (-)',
        sign: '-',
        badgeClass: 'bg-orange-50 text-orange-700 border-orange-200',
        effectDescription: 'Giảm tồn vật lý sau kiểm định',
      }
    case 'QC_ADJUSTMENT':
    default:
      return {
        label: 'Điều chỉnh kiểm định (QC_ADJUSTMENT)',
        shortLabel: 'Điều chỉnh QC',
        sign: '±',
        badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
        effectDescription: 'Điều chỉnh tồn vật lý theo biên bản QC',
      }
  }
}
