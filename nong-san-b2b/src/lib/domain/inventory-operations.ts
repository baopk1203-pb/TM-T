/**
 * ============================================================================
 * E VIBE B2B — CONTROLLED INVENTORY OPERATIONS DOMAIN (F01D PHASE 2)
 * ============================================================================
 * Pure domain functions cho các nghiệp vụ ghi kho quản trị:
 * 1. Module A: Validation & quy tắc nhập kho (Stock Receipt)
 * 2. Module B: Validation & quy tắc xuất kho (Stock Dispatch)
 * 3. Module C: Validation & tính toán điều chỉnh tồn (Stock Adjustment)
 * 4. Module D: Máy trạng thái vòng đời lô hàng & Audit Trail (Batch Status Lifecycle)
 *
 * NGUYÊN TẮC BẤT BIẾN:
 * 1. Pure Functions: Tuyệt đối không gọi Prisma, không truy cập DB, không side-effects.
 * 2. Đơn vị cơ sở: Luôn dùng số nguyên gram (Int). Kiểm tra tính toàn vẹn (không float, không âm, không NaN).
 * 3. Bất biến tồn kho:
 *    - PhysicalStock >= 0
 *    - ReservedStock >= 0
 *    - AvailableStock = Math.max(0, PhysicalStock - ReservedStock)
 *    - Không điều chỉnh giảm kho làm PhysicalStock < ReservedStock.
 * 4. Fail-closed: Mọi thao tác ghi phải có kiểm soát an toàn.
 * ============================================================================
 */

import {
  BatchStatus,
} from '@prisma/client'
import {
  validateIntegerGrams,
  gramsToKg,
  kgToGrams,
  toVietnamCalendarDate,
  isBatchExpired,
  type BatchStockSummary,
} from './inventory'

// ============================================================================
// 1. FEATURE FLAG & ENVIRONMENT GUARDS
// ============================================================================

/**
 * Kiểm tra cờ tính năng ghi kho Admin (Fail-closed).
 * Mặc định trả về `false` trừ khi biến môi trường `ENABLE_ADMIN_INVENTORY_WRITES` được bật tường minh là `'true'`.
 */
export function isInventoryWriteEnabled(envValue?: string): boolean {
  const flag = envValue !== undefined ? envValue : process.env.ENABLE_ADMIN_INVENTORY_WRITES
  return flag === 'true'
}
/**
 * Kiểm tra cờ tính năng Điều chỉnh tồn kho Admin (Fail-closed).
 * Cho phép thực hiện điều chỉnh tồn kho FEFO khi:
 * 1. Cờ tổng ENABLE_ADMIN_INVENTORY_WRITES === 'true' (toàn bộ quyền ghi kho Admin được mở), HOẶC
 * 2. Cờ chuyên biệt ENABLE_ADMIN_INVENTORY_ADJUSTMENTS === 'true' (mở riêng cho môi trường Demo/Beta).
 * Mặc định trả về alse (Fail-closed).
 */
export function isInventoryAdjustmentEnabled(envValue?: string): boolean {
  if (isInventoryWriteEnabled(envValue)) {
    return true
  }
  const flag =
    envValue !== undefined ? envValue : process.env.ENABLE_ADMIN_INVENTORY_ADJUSTMENTS
  return flag === 'true'
}

// ============================================================================
// 2. MODULE A — STOCK RECEIPT / NHẬP KHO
// ============================================================================

export interface StockReceiptInput {
  productId: string
  farmId: string
  code: string
  harvestDate: Date | string
  expiryDate?: Date | string | null
  quantityKg: number
  status?: BatchStatus
  isFefoEligible?: boolean
  qcNotes?: string | null
  note?: string | null
  idempotencyKey?: string
}

export interface ValidatedStockReceipt {
  productId: string
  farmId: string
  code: string
  harvestDate: Date
  expiryDate: Date | null
  quantityGrams: number
  status: BatchStatus
  isFefoEligible: boolean
  qcNotes: string | null
  note: string | null
  idempotencyKey: string
}

export interface ValidationResult<T> {
  isValid: boolean
  errors: string[]
  data?: T
}

/**
 * Xác thực dữ liệu đầu vào cho nghiệp vụ Nhập kho mới (Module A).
 */
export function validateStockReceipt(
  input: StockReceiptInput,
  referenceDate: Date = new Date()
): ValidationResult<ValidatedStockReceipt> {
  const errors: string[] = []

  // 1. Kiểm tra productId & farmId
  const productId = typeof input.productId === 'string' ? input.productId.trim() : ''
  if (!productId) {
    errors.push('Mã sản phẩm (productId) không được để trống')
  }

  const farmId = typeof input.farmId === 'string' ? input.farmId.trim() : ''
  if (!farmId) {
    errors.push('Mã nông trường / nhà vườn (farmId) không được để trống')
  }

  // 2. Kiểm tra mã lô hàng
  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : ''
  if (!code) {
    errors.push('Mã lô hàng (batchCode) không được để trống')
  } else if (!/^[A-Z0-9_-]{3,50}$/.test(code)) {
    errors.push('Mã lô hàng chỉ được chứa chữ hoa, số, gạch nối (-) hoặc gạch dưới (_), độ dài 3-50 ký tự')
  }

  // 3. Kiểm tra khối lượng nhập (kg -> gram)
  if (typeof input.quantityKg !== 'number' || isNaN(input.quantityKg) || !Number.isFinite(input.quantityKg)) {
    errors.push('Khối lượng nhập phải là một số hợp lệ')
  } else if (input.quantityKg <= 0) {
    errors.push('Khối lượng nhập phải lớn hơn 0 kg')
  }

  let quantityGrams = 0
  if (errors.length === 0 || (typeof input.quantityKg === 'number' && input.quantityKg > 0)) {
    try {
      quantityGrams = kgToGrams(input.quantityKg)
      validateIntegerGrams(quantityGrams, 'Khối lượng nhập')
      if (quantityGrams <= 0) {
        errors.push('Khối lượng nhập sau quy đổi gram phải lớn hơn 0 g')
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Khối lượng nhập không hợp lệ')
    }
  }

  // 4. Kiểm tra ngày thu hoạch
  let harvestDateObj: Date | null = null
  if (!input.harvestDate) {
    errors.push('Ngày thu hoạch không được để trống')
  } else {
    harvestDateObj = input.harvestDate instanceof Date ? input.harvestDate : new Date(input.harvestDate)
    if (isNaN(harvestDateObj.getTime())) {
      errors.push('Ngày thu hoạch không hợp lệ')
      harvestDateObj = null
    }
  }

  // 5. Kiểm tra hạn sử dụng (expiryDate)
  let expiryDateObj: Date | null = null
  if (input.expiryDate) {
    expiryDateObj = input.expiryDate instanceof Date ? input.expiryDate : new Date(input.expiryDate)
    if (isNaN(expiryDateObj.getTime())) {
      errors.push('Hạn sử dụng không hợp lệ')
      expiryDateObj = null
    }
  }

  // So sánh ngày thu hoạch và hạn sử dụng
  if (harvestDateObj && expiryDateObj) {
    const harvestStr = toVietnamCalendarDate(harvestDateObj)
    const expiryStr = toVietnamCalendarDate(expiryDateObj)
    if (expiryStr < harvestStr) {
      errors.push(`Hạn sử dụng (${expiryStr}) không thể trước ngày thu hoạch (${harvestStr})`)
    }
  }

  // 6. Kiểm tra trạng thái lô & điều kiện FEFO
  const requestedStatus = input.status || BatchStatus.ACTIVE
  const requestedEligibility = input.isFefoEligible !== undefined ? input.isFefoEligible : false

  const resolvedStatus = requestedStatus
  const resolvedEligibility = requestedEligibility

  // Quy tắc FEFO bắt buộc:
  // - Nếu không có expiryDate -> CẤM bật FEFO (lô chưa kiểm định hoặc hàng không rõ hạn)
  if (!expiryDateObj && resolvedEligibility) {
    errors.push('Không thể bật cờ đủ điều kiện FEFO khi lô hàng chưa có ngày hết hạn sử dụng')
  }

  // - Nếu ngày tham chiếu đã quá hạn -> CẤM trạng thái ACTIVE và CẤM FEFO
  if (expiryDateObj && isBatchExpired(expiryDateObj, referenceDate)) {
    if (resolvedStatus === BatchStatus.ACTIVE) {
      errors.push('Lô hàng đã quá hạn sử dụng, không thể đặt trạng thái ACTIVE')
    }
    if (resolvedEligibility) {
      errors.push('Lô hàng đã quá hạn sử dụng, không thể đánh dấu đủ điều kiện FEFO')
    }
  }

  // - Lô UNVERIFIED không thể có isFefoEligible = true
  if (resolvedStatus === BatchStatus.UNVERIFIED && resolvedEligibility) {
    errors.push('Lô hàng ở trạng thái UNVERIFIED (chưa xác minh) không được phép bật cờ FEFO')
  }

  // - Lô LOCKED_QC không thể có isFefoEligible = true
  if (resolvedStatus === BatchStatus.LOCKED_QC && resolvedEligibility) {
    errors.push('Lô hàng đang bị phong tỏa kiểm định (LOCKED_QC) không được phép bật cờ FEFO')
  }

  // 7. Idempotency Key
  const idempotencyKey =
    typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim()
      ? input.idempotencyKey.trim()
      : `RECEIPT:${code}`

  if (errors.length > 0) {
    return { isValid: false, errors }
  }

  return {
    isValid: true,
    errors: [],
    data: {
      productId,
      farmId,
      code,
      harvestDate: harvestDateObj!,
      expiryDate: expiryDateObj,
      quantityGrams,
      status: resolvedStatus,
      isFefoEligible: resolvedEligibility,
      qcNotes: input.qcNotes?.trim() || null,
      note: input.note?.trim() || null,
      idempotencyKey,
    },
  }
}

// ============================================================================
// 3. MODULE C — STOCK ADJUSTMENT / ĐIỀU CHỈNH TỒN KHO
// ============================================================================

export type StockAdjustmentType =
  | 'SHRINKAGE_LOSS'
  | 'QC_ADJUSTMENT_SUB'
  | 'QC_ADJUSTMENT_ADD'

export interface StockAdjustmentInput {
  batchId: string
  type: StockAdjustmentType
  quantityKg: number
  reason: string
  referenceCode?: string | null
  idempotencyKey?: string
}

export interface ValidatedStockAdjustment {
  batchId: string
  type: StockAdjustmentType
  quantityGrams: number
  reason: string
  referenceCode: string | null
  idempotencyKey: string
}

export interface StockAdjustmentImpact {
  currentPhysicalStockGrams: number
  currentReservedGrams: number
  currentAvailableGrams: number
  adjustmentGrams: number
  deltaGrams: number
  projectedPhysicalStockGrams: number
  projectedReservedGrams: number
  projectedAvailableGrams: number
}

/**
 * Tính toán tác động của điều chỉnh tồn lên số dư vật lý và khả dụng.
 */
export function calculateStockAdjustmentImpact(
  currentSummary: BatchStockSummary,
  type: StockAdjustmentType,
  adjustmentGrams: number
): StockAdjustmentImpact {
  validateIntegerGrams(adjustmentGrams, 'Khối lượng điều chỉnh')

  const deltaGrams =
    type === 'QC_ADJUSTMENT_ADD' ? adjustmentGrams : -adjustmentGrams

  const projectedPhysicalStockGrams = currentSummary.physicalStockGrams + deltaGrams
  const projectedReservedGrams = currentSummary.reservedGrams
  const projectedAvailableGrams = projectedPhysicalStockGrams - projectedReservedGrams

  return {
    currentPhysicalStockGrams: currentSummary.physicalStockGrams,
    currentReservedGrams: currentSummary.reservedGrams,
    currentAvailableGrams: currentSummary.availableGrams,
    adjustmentGrams,
    deltaGrams,
    projectedPhysicalStockGrams,
    projectedReservedGrams,
    projectedAvailableGrams,
  }
}

/**
 * Xác thực nghiệp vụ điều chỉnh tồn kho (Module C).
 * Kiểm tra các điều kiện bất biến:
 * 1. Không làm âm tồn vật lý (projectedPhysical >= 0)
 * 2. Không làm âm tồn khả dụng (projectedPhysical >= reservedGrams)
 * 3. Bắt buộc có lý do nghiệp vụ
 */
export function validateStockAdjustment(
  input: StockAdjustmentInput,
  currentSummary: BatchStockSummary
): ValidationResult<ValidatedStockAdjustment & { impact: StockAdjustmentImpact }> {
  const errors: string[] = []

  const batchId = typeof input.batchId === 'string' ? input.batchId.trim() : ''
  if (!batchId) {
    errors.push('Mã định danh lô hàng (batchId) không được để trống')
  }

  const validTypes: StockAdjustmentType[] = ['SHRINKAGE_LOSS', 'QC_ADJUSTMENT_SUB', 'QC_ADJUSTMENT_ADD']
  if (!validTypes.includes(input.type)) {
    errors.push(`Loại điều chỉnh không hợp lệ: ${input.type}. Chỉ chấp nhận: ${validTypes.join(', ')}`)
  }

  if (typeof input.quantityKg !== 'number' || isNaN(input.quantityKg) || !Number.isFinite(input.quantityKg)) {
    errors.push('Khối lượng điều chỉnh phải là một số hợp lệ')
  } else if (input.quantityKg <= 0) {
    errors.push('Khối lượng điều chỉnh phải lớn hơn 0 kg')
  }

  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (!reason || reason.length < 5) {
    errors.push('Lý do điều chỉnh kho là bắt buộc và phải có ít nhất 5 ký tự')
  }

  let adjustmentGrams = 0
  if (typeof input.quantityKg === 'number' && input.quantityKg > 0) {
    try {
      adjustmentGrams = kgToGrams(input.quantityKg)
      validateIntegerGrams(adjustmentGrams, 'Khối lượng điều chỉnh')
      if (adjustmentGrams <= 0) {
        errors.push('Khối lượng điều chỉnh quy đổi sang gram phải lớn hơn 0 g')
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Khối lượng điều chỉnh không hợp lệ')
    }
  }

  if (errors.length > 0) {
    return { isValid: false, errors }
  }

  const impact = calculateStockAdjustmentImpact(currentSummary, input.type, adjustmentGrams)

  // Kiểm tra bất biến số dư
  if (impact.projectedPhysicalStockGrams < 0) {
    const projectedKgStr = `-${gramsToKg(Math.abs(impact.projectedPhysicalStockGrams))}`
    errors.push(
      `Không thể điều chỉnh giảm ${gramsToKg(adjustmentGrams)} kg vì tồn vật lý hiện tại chỉ còn ${gramsToKg(currentSummary.physicalStockGrams)} kg (sẽ làm âm kho vật lý: ${projectedKgStr} kg)`
    )
  }

  if (impact.projectedAvailableGrams < 0) {
    errors.push(
      `Không thể điều chỉnh giảm ${gramsToKg(adjustmentGrams)} kg vì kho đang có ${gramsToKg(currentSummary.reservedGrams)} kg được giữ chỗ cho các đơn hàng. Tồn khả dụng còn lại chỉ là ${gramsToKg(currentSummary.availableGrams)} kg.`
    )
  }

  if (errors.length > 0) {
    return { isValid: false, errors }
  }

  const idempotencyKey =
    typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim()
      ? input.idempotencyKey.trim()
      : `ADJUST:${batchId}:${input.type}:${Date.now()}`

  return {
    isValid: true,
    errors: [],
    data: {
      batchId,
      type: input.type,
      quantityGrams: adjustmentGrams,
      reason,
      referenceCode: input.referenceCode?.trim() || null,
      idempotencyKey,
      impact,
    },
  }
}

// ============================================================================
// 4. MODULE D — BATCH STATUS LIFECYCLE & AUDIT TRAIL
// ============================================================================

export interface BatchStatusTransitionInput {
  batchId: string
  currentStatus: BatchStatus
  targetStatus: BatchStatus
  currentEligibility: boolean
  targetEligibility: boolean
  expiryDate?: Date | string | null
  activeAllocationsCount?: number
  activeReservedGrams?: number
  reason: string
  actorId: string
}

export interface BatchStatusAuditEntry {
  batchId: string
  oldStatus: BatchStatus
  newStatus: BatchStatus
  oldEligibility: boolean
  newEligibility: boolean
  actorId: string
  reason: string
  timestamp: string
}

/**
 * Ma trận chuyển đổi trạng thái hợp lệ cho lô hàng nông sản (State Machine).
 */
const ALLOWED_STATUS_TRANSITIONS: Record<BatchStatus, BatchStatus[]> = {
  UNVERIFIED: [BatchStatus.ACTIVE, BatchStatus.LOCKED_QC, BatchStatus.EXPIRED],
  ACTIVE: [BatchStatus.LOCKED_QC, BatchStatus.EXPIRED, BatchStatus.DEPLETED],
  LOCKED_QC: [BatchStatus.ACTIVE, BatchStatus.EXPIRED, BatchStatus.DEPLETED],
  EXPIRED: [BatchStatus.DEPLETED], // Hết hạn là trạng thái cuối, không thể quay lại bán (ACTIVE/UNVERIFIED)
  DEPLETED: [], // Đã xuất hết là trạng thái kết thúc hoàn toàn
}

/**
 * Kiểm tra xem việc chuyển đổi trạng thái lô hàng có hợp lệ hay không (Module D).
 */
export function validateBatchStatusTransition(
  input: BatchStatusTransitionInput,
  referenceDate: Date = new Date()
): ValidationResult<BatchStatusAuditEntry> {
  const errors: string[] = []

  const {
    batchId,
    currentStatus,
    targetStatus,
    currentEligibility,
    targetEligibility,
    expiryDate,
    activeReservedGrams = 0,
    reason,
    actorId,
  } = input

  if (!batchId) {
    errors.push('Mã định danh lô hàng (batchId) không được để trống')
  }

  if (!actorId) {
    errors.push('Mã người thực hiện (actorId) không được để trống')
  }

  const cleanReason = typeof reason === 'string' ? reason.trim() : ''
  if (!cleanReason || cleanReason.length < 5) {
    errors.push('Lý do thay đổi trạng thái lô hàng là bắt buộc (tối thiểu 5 ký tự)')
  }

  // 1. Kiểm tra ma trận chuyển trạng thái
  if (currentStatus !== targetStatus) {
    const allowedTargets = ALLOWED_STATUS_TRANSITIONS[currentStatus] || []
    if (!allowedTargets.includes(targetStatus)) {
      errors.push(
        `Không thể chuyển trạng thái lô hàng từ ${currentStatus} sang ${targetStatus}. Các trạng thái được phép: ${allowedTargets.join(', ') || 'Không có (trạng thái kết thúc)'}`
      )
    }
  }

  // 2. Kiểm tra nếu lô đã hết hạn
  const isExpired = expiryDate ? isBatchExpired(expiryDate, referenceDate) : false
  if (isExpired && targetStatus === BatchStatus.ACTIVE) {
    errors.push('Lô hàng đã quá hạn sử dụng, không thể đặt trạng thái ACTIVE')
  }
  if (isExpired && targetEligibility) {
    errors.push('Lô hàng đã quá hạn sử dụng, không thể bật cờ đủ điều kiện FEFO')
  }

  // 3. Thiếu ngày hết hạn -> Cấm bật FEFO
  if (!expiryDate && targetEligibility) {
    errors.push('Lô hàng thiếu ngày hết hạn sử dụng, không thể bật cờ FEFO')
  }

  // 4. Nếu chuyển sang LOCKED_QC hoặc EXPIRED hoặc DEPLETED mà đang có hàng giữ chỗ (HOLD)
  if (
    (targetStatus === BatchStatus.LOCKED_QC ||
      targetStatus === BatchStatus.EXPIRED ||
      targetStatus === BatchStatus.DEPLETED ||
      (!targetEligibility && currentEligibility)) &&
    activeReservedGrams > 0
  ) {
    errors.push(
      `CẢNH BÁO BẢO VỆ RESERVATION: Lô hàng đang có ${gramsToKg(activeReservedGrams)} kg hàng giữ chỗ cho các đơn hàng đang chờ thanh toán / chuẩn bị giao. Không thể khóa hoặc tắt FEFO khi chưa hoàn tất hoặc giải phóng đơn hàng.`
    )
  }

  // 5. Trạng thái UNVERIFIED / LOCKED_QC không được phép bật FEFO
  if ((targetStatus === BatchStatus.UNVERIFIED || targetStatus === BatchStatus.LOCKED_QC) && targetEligibility) {
    errors.push(`Lô hàng ở trạng thái ${targetStatus} không được phép bật cờ đủ điều kiện FEFO`)
  }

  if (errors.length > 0) {
    return { isValid: false, errors }
  }

  const auditEntry: BatchStatusAuditEntry = {
    batchId,
    oldStatus: currentStatus,
    newStatus: targetStatus,
    oldEligibility: currentEligibility,
    newEligibility: targetEligibility,
    actorId,
    reason: cleanReason,
    timestamp: referenceDate.toISOString(),
  }

  return {
    isValid: true,
    errors: [],
    data: auditEntry,
  }
}

/**
 * Định dạng khóa lưu trữ Audit Trail trong bảng AppSetting.
 */
export function buildBatchStatusAuditKey(batchId: string, timestampMs: number = Date.now()): string {
  return `AUDIT:BATCH_STATUS:${batchId}:${timestampMs}`
}
