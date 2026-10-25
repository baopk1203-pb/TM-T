/**
 * ============================================================================
 * E VIBE B2B — INVENTORY & FEFO ENGINE (PURE DOMAIN FUNCTIONS)
 * ============================================================================
 * Hợp đồng dữ liệu & Thuật toán xuất kho FEFO (First-Expired, First-Out).
 * 
 * NGUYÊN TẮC BẤT BIẾN:
 * 1. Pure Functions: Tuyệt đối không gọi Prisma, không truy cập Database, không có side-effects.
 * 2. Đơn vị đo lường cơ sở: Luôn dùng số nguyên Gram (Int) trong tính toán nội bộ.
 * 3. Chống Double-Counting: Lượng xuất kho (DISPATCH_OUT) triệt tiêu trong công thức tính khả dụng.
 * 4. Không tự động suy luận: Tuyệt đối không tự gán `expiryDate = harvestDate + X days`.
 * 5. Lô chưa kiểm định (UNVERIFIED) hoặc không có `expiryDate` chỉ dùng cho tra cứu QR, CẤM cấp phát FEFO.
 * 6. Tính tất định: Sắp xếp ưu tiên hạn dùng gần nhất (expiryDate ASC), sau đó tới harvestDate ASC, code ASC.
 * 7. Thời gian chuẩn: Quy đổi và so sánh ngày hết hạn theo ngày làm việc tại Việt Nam (Asia/Ho_Chi_Minh).
 * ============================================================================
 */

export const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh'

export type BatchStatus = 'UNVERIFIED' | 'ACTIVE' | 'LOCKED_QC' | 'EXPIRED' | 'DEPLETED'

export type InventoryLedgerType =
  | 'IMPORT'              // Thực nhập kho từ nông trường (+)
  | 'RESERVATION_HOLD'    // Giữ chỗ cho đơn hàng chờ thanh toán / đóng gói
  | 'RESERVATION_RELEASE' // Giải phóng giữ chỗ do hủy hoặc hết hạn
  | 'DISPATCH_OUT'        // Thực xuất kho bàn giao tài xế (-)
  | 'SHRINKAGE_LOSS'      // Hao hụt, hư hỏng tự nhiên trong kho (-)
  | 'QC_ADJUSTMENT'       // Cân đối điều chỉnh sau kiểm kê (tương thích cũ)
  | 'QC_ADJUSTMENT_ADD'   // Điều chỉnh tăng sau kiểm kê (+)
  | 'QC_ADJUSTMENT_SUB'   // Điều chỉnh giảm sau kiểm kê (-)

export type AllocationStatus =
  | 'HOLD_PENDING'          // Đang giữ chỗ tạm thời (chờ thanh toán 10 phút)
  | 'ALLOCATED_CONFIRMED'   // Đã xác nhận thanh toán hợp lệ (chờ xuất kho)
  | 'PARTIALLY_DISPATCHED'  // Đã xuất kho một phần
  | 'DISPATCHED'            // Đã xuất kho hoàn toàn
  | 'RELEASED'              // Đã giải phóng toàn bộ do hủy / quá hạn

export interface LedgerEntry {
  type: InventoryLedgerType
  quantityGrams: number
}

export interface BatchStockSummary {
  physicalStockGrams: number
  reservedGrams: number
  availableGrams: number
  dispatchedGrams: number
  shrinkageGrams: number
  importGrams: number
  rawPhysicalStockGrams: number
  rawReservedGrams: number
  rawAvailableGrams: number
  hasDeficit: boolean
  warnings: string[]
}

export interface InvariantVerificationResult {
  valid: boolean
  violations: string[]
  warnings: string[]
}

export interface BatchCandidate {
  id: string
  code: string
  productId: string
  farmId?: string
  harvestDate: Date | string
  expiryDate?: Date | string | null
  status: BatchStatus
  isFefoEligible: boolean
  physicalStockGrams: number
  reservedGrams: number
}

export type BatchIneligibilityReason =
  | 'PRODUCT_MISMATCH'
  | 'BATCH_UNVERIFIED'
  | 'MISSING_EXPIRY_DATE'
  | 'NOT_FEFO_ELIGIBLE'
  | 'BATCH_LOCKED_QC'
  | 'BATCH_EXPIRED'
  | 'BATCH_DEPLETED'
  | 'NO_AVAILABLE_STOCK'

export interface BatchEligibilityResult {
  eligible: boolean
  availableGrams: number
  reason?: BatchIneligibilityReason
  message?: string
}

export interface AllocationItem {
  batchId: string
  batchCode: string
  allocatedGrams: number
  expiryDate: string // YYYY-MM-DD
  harvestDate: string // YYYY-MM-DD
}

export interface FefoAllocationInput {
  batches: BatchCandidate[]
  requestedGrams: number
  targetProductId?: string
  referenceDate?: Date | string
}

export interface FefoAllocationResult {
  success: boolean
  isFullyAllocated: boolean
  requestedGrams: number
  allocatedGrams: number
  shortageGrams: number
  allocations: AllocationItem[]
  eligibleBatchesCount: number
  consideredBatchesCount: number
  error?: string
}

export interface InventoryAvailabilitySummary {
  totalPhysicalStockGrams: number
  totalReservedGrams: number
  totalAvailableGrams: number
  eligibleBatchesCount: number
  ineligibleBatchesCount: number
  expiredBatchesCount: number
  unverifiedBatchesCount: number
}

// ============================================================================
// 1. TIỆN ÍCH CHUYỂN ĐỔI & KIỂM TRA ĐƠN VỊ TÍNH (GRAMS & KG)
// ============================================================================

/**
 * Xác thực số nguyên gram hợp lệ. Ném lỗi nếu là số thực, NaN, hoặc âm.
 */
export function validateIntegerGrams(grams: number, fieldName = 'Khối lượng'): void {
  if (typeof grams !== 'number' || isNaN(grams) || !Number.isFinite(grams)) {
    throw new TypeError(`${fieldName} phải là một số hợp lệ (nhận được: ${grams})`)
  }
  if (!Number.isInteger(grams)) {
    throw new RangeError(`${fieldName} phải là số nguyên gram, không được dùng số thực (nhận được: ${grams})`)
  }
  if (grams < 0) {
    throw new RangeError(`${fieldName} không được là số âm (nhận được: ${grams} g)`)
  }
}

/**
 * Quy đổi gram sang kilogram hiển thị (1 kg = 1.000 g)
 */
export function gramsToKg(grams: number): number {
  validateIntegerGrams(grams, 'Số gram quy đổi')
  return grams / 1000
}

/**
 * Quy đổi kilogram sang gram lưu trữ nội bộ (Làm tròn số nguyên gần nhất)
 */
export function kgToGrams(kg: number): number {
  if (typeof kg !== 'number' || isNaN(kg) || !Number.isFinite(kg)) {
    throw new TypeError(`Số kg phải là một số hợp lệ (nhận được: ${kg})`)
  }
  if (kg < 0) {
    throw new RangeError(`Số kg không được là số âm (nhận được: ${kg})`)
  }
  return Math.round(kg * 1000)
}

// ============================================================================
// 2. CHUẨN HÓA THỜI GIAN THEO NGÀY LÀM VIỆC TẠI VIỆT NAM (ASIA/HO_CHI_MINH)
// ============================================================================

/**
 * Chuẩn hóa một Date hoặc Date-string về chuỗi ngày YYYY-MM-DD theo múi giờ Việt Nam.
 * Đảm bảo mọi phép so sánh hạn sử dụng độc lập với múi giờ máy chủ lưu trữ (Vercel US-East / Local).
 */
export function toVietnamCalendarDate(date: Date | string): string {
  if (!date) {
    throw new TypeError('Ngày không được để trống')
  }

  // Nếu đã là chuỗi YYYY-MM-DD hợp lệ, trả về nguyên bản
  if (typeof date === 'string') {
    const trimmed = date.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed
    }
  }

  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) {
    throw new RangeError(`Ngày không hợp lệ: ${date}`)
  }

  // Sử dụng formatter chuẩn xác theo múi giờ Việt Nam
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  return formatter.format(d)
}

/**
 * Kiểm tra xem một lô hàng đã hết hạn sử dụng chưa relative với ngày tham chiếu.
 * QUY TẮC NÔNG SẢN: Hàng có hạn đến ngày X thì vẫn có thể xuất kho trong suốt ngày X.
 * Lô chỉ bị coi là hết hạn khi ngày tham chiếu VƯỢT QUÁ ngày hết hạn (referenceDate > expiryDate).
 */
export function isBatchExpired(
  expiryDate?: Date | string | null,
  referenceDate?: Date | string
): boolean {
  if (!expiryDate) {
    return false // Không có ngày hết hạn -> Xử lý riêng ở khâu kiểm tra xác minh (UNVERIFIED)
  }

  const expiryStr = toVietnamCalendarDate(expiryDate)
  const refStr = referenceDate ? toVietnamCalendarDate(referenceDate) : toVietnamCalendarDate(new Date())

  // Ngày tham chiếu lớn hơn ngày hết hạn => Đã hết hạn
  return refStr > expiryStr
}

// ============================================================================
// 3. CÔNG THỨC TOÁN HỌC SỔ CÁI TỒN KHO (INVENTORY LEDGER MATH)
// ============================================================================

/**
 * Tính toán số dư tồn kho chuẩn xác từ các dòng biến động trong Sổ cái (Inventory Ledger).
 * 
 * CHỨNG MINH TOÁN HỌC KHÔNG DOUBLE-COUNTING:
 * 1. PhysicalStock = IMPORT - DISPATCH_OUT - SHRINKAGE_LOSS + QC_ADJUSTMENT
 * 2. ReservedStock = RESERVATION_HOLD - RESERVATION_RELEASE - DISPATCH_OUT
 * 3. AvailableForSale = PhysicalStock - ReservedStock
 *                     = (IMPORT - SHRINKAGE_LOSS + QC_ADJUSTMENT) - (RESERVATION_HOLD - RESERVATION_RELEASE)
 * 
 * Lượng xuất kho DISPATCH_OUT triệt tiêu hoàn toàn, không bị trừ 2 lần!
 */
export function calculateStockFromLedger(entries: LedgerEntry[]): BatchStockSummary {
  if (!Array.isArray(entries)) {
    throw new TypeError('Danh sách biến động sổ cái phải là một mảng')
  }

  let importGrams = 0
  let dispatchGrams = 0
  let shrinkageGrams = 0
  let holdGrams = 0
  let releaseGrams = 0
  let qcAdjustmentGrams = 0

  for (const entry of entries) {
    validateIntegerGrams(entry.quantityGrams, `Lượng biến động [${entry.type}]`)

    switch (entry.type) {
      case 'IMPORT':
        importGrams += entry.quantityGrams
        break
      case 'DISPATCH_OUT':
        dispatchGrams += entry.quantityGrams
        break
      case 'SHRINKAGE_LOSS':
        shrinkageGrams += entry.quantityGrams
        break
      case 'RESERVATION_HOLD':
        holdGrams += entry.quantityGrams
        break
      case 'RESERVATION_RELEASE':
        releaseGrams += entry.quantityGrams
        break
      case 'QC_ADJUSTMENT':
        // Điều chỉnh kiểm kê: giả định ghi nhận số dương tăng hoặc âm giảm
        qcAdjustmentGrams += entry.quantityGrams
        break
      case 'QC_ADJUSTMENT_ADD':
        // Điều chỉnh tăng sau kiểm kê (+)
        qcAdjustmentGrams += entry.quantityGrams
        break
      case 'QC_ADJUSTMENT_SUB':
        // Điều chỉnh giảm sau kiểm kê (-)
        qcAdjustmentGrams -= entry.quantityGrams
        break
      default:
        // Bỏ qua loại không xác định để tương thích ngược
        break
    }
  }

  // 1. Tồn kho vật lý thực tế trên kệ kho
  const rawPhysicalStockGrams = importGrams - dispatchGrams - shrinkageGrams + qcAdjustmentGrams
  const physicalStockGrams = Math.max(0, rawPhysicalStockGrams)

  // 2. Khối lượng đang giữ chỗ chưa xuất kho
  const rawReservedGrams = holdGrams - releaseGrams - dispatchGrams
  const reservedGrams = Math.max(0, rawReservedGrams)

  // 3. Tồn khả dụng để mở bán (không cho phép âm)
  const rawAvailableGrams = rawPhysicalStockGrams - rawReservedGrams
  const availableGrams = Math.max(0, physicalStockGrams - reservedGrams)

  // 4. Phát hiện bất thường (Deficit & Warnings) - Không che giấu mất cân đối
  const warnings: string[] = []
  let hasDeficit = false

  if (rawPhysicalStockGrams < 0) {
    hasDeficit = true
    warnings.push(`CẢNH BÁO TỒN ÂM: Tồn vật lý bị âm (${rawPhysicalStockGrams}g). Lượng xuất kho và hao hụt vượt quá số lượng thực nhập.`)
  }

  if (rawReservedGrams < 0) {
    hasDeficit = true
    warnings.push(`CẢNH BÁO GIỮ CHỖ ÂM: Khối lượng giữ chỗ bị âm (${rawReservedGrams}g). Có thể do xuất kho khi chưa có giữ chỗ hoặc giải phóng hai lần.`)
  }

  if (rawAvailableGrams < 0) {
    hasDeficit = true
    warnings.push(`CẢNH BÁO THIẾU HỤT PHÂN BỔ: Tồn khả dụng thô bị âm (${rawAvailableGrams}g). Hàng đang giữ (${reservedGrams}g) vượt quá tồn vật lý (${physicalStockGrams}g) do hao hụt tác động lên hàng đã giữ.`)
  }

  return {
    physicalStockGrams,
    reservedGrams,
    availableGrams,
    dispatchedGrams: dispatchGrams,
    shrinkageGrams,
    importGrams,
    rawPhysicalStockGrams,
    rawReservedGrams,
    rawAvailableGrams,
    hasDeficit,
    warnings,
  }
}

/**
 * Kiểm tra các điều kiện bất biến nghiệp vụ (Business Invariants) của tồn kho.
 * Phục vụ cảnh báo hệ thống, đối soát kế toán và chặn các giao dịch vi phạm.
 */
export function verifyInventoryInvariants(summary: BatchStockSummary): InvariantVerificationResult {
  const violations: string[] = []
  const warnings: string[] = [...summary.warnings]

  // Invariant 1: Tồn vật lý không được âm
  if (summary.rawPhysicalStockGrams < 0) {
    violations.push('INVARIANT_VIOLATION_PHYSICAL_DEFICIT: Tồn vật lý thực tế không thể âm.')
  }

  // Invariant 2: Lượng giữ chỗ không được âm
  if (summary.rawReservedGrams < 0) {
    violations.push('INVARIANT_VIOLATION_RESERVED_DEFICIT: Lượng hàng giữ chỗ không thể âm.')
  }

  // Invariant 3: Tồn khả dụng không thể vượt quá tồn vật lý
  if (summary.availableGrams > summary.physicalStockGrams) {
    violations.push('INVARIANT_VIOLATION_AVAILABLE_EXCEEDS_PHYSICAL: Tồn khả dụng không thể lớn hơn tồn vật lý.')
  }

  // Invariant 4: Tồn khả dụng thô âm nghĩa là hàng đã giữ vượt tồn thực tế
  if (summary.rawAvailableGrams < 0) {
    violations.push('INVARIANT_VIOLATION_OVER_ALLOCATED: Tổng lượng hàng đã giữ vượt quá tồn kho vật lý hiện có (do hao hụt hoặc kiểm kê giảm).')
  }

  return {
    valid: violations.length === 0,
    violations,
    warnings,
  }
}

// ============================================================================
// 3B. QUẢN LÝ VÒNG ĐỜI PHÂN BỔ & GIỮ CHỖ (RESERVATION & ALLOCATION DOMAIN)
// ============================================================================

export interface AllocationStateInput {
  allocatedGrams: number
  dispatchedGrams: number
  releasedGrams: number
  status?: AllocationStatus
}

/**
 * Tính toán lượng hàng còn đang bị giữ chưa xuất và chưa giải phóng.
 * UnreleasedGrams = allocatedGrams - dispatchedGrams - releasedGrams
 */
export function calculateUnreleasedAllocationGrams(allocation: AllocationStateInput): number {
  validateIntegerGrams(allocation.allocatedGrams, 'Lượng phân bổ ban đầu')
  validateIntegerGrams(allocation.dispatchedGrams, 'Lượng đã xuất')
  validateIntegerGrams(allocation.releasedGrams, 'Lượng đã giải phóng')

  const unreleased = allocation.allocatedGrams - allocation.dispatchedGrams - allocation.releasedGrams
  return Math.max(0, unreleased)
}

/**
 * Xử lý xuất kho một phần (Partial Dispatch) trên dòng phân bổ:
 * Chỉ xuất tối đa bằng lượng chưa xuất chưa nhả.
 */
export function calculatePartialDispatchAllocation(
  allocation: AllocationStateInput,
  dispatchGrams: number
): {
  newDispatchedGrams: number
  unreleasedGrams: number
  newStatus: AllocationStatus
} {
  validateIntegerGrams(dispatchGrams, 'Lượng yêu cầu xuất')
  const currentUnreleased = calculateUnreleasedAllocationGrams(allocation)

  if (dispatchGrams <= 0) {
    throw new RangeError('Khối lượng xuất kho phải là số nguyên dương')
  }

  if (dispatchGrams > currentUnreleased) {
    throw new RangeError(
      `Không thể xuất kho ${gramsToKg(dispatchGrams)} kg vì lượng phân bổ chưa xuất chỉ còn ${gramsToKg(currentUnreleased)} kg`
    )
  }

  const newDispatchedGrams = allocation.dispatchedGrams + dispatchGrams
  const newUnreleased = allocation.allocatedGrams - newDispatchedGrams - allocation.releasedGrams
  const newStatus: AllocationStatus = newUnreleased === 0 ? 'DISPATCHED' : 'PARTIALLY_DISPATCHED'

  return {
    newDispatchedGrams,
    unreleasedGrams: Math.max(0, newUnreleased),
    newStatus,
  }
}

/**
 * Xử lý giải phóng hàng (Release Hold) khi đơn bị hủy, quá hạn hoặc chốt cân giảm:
 * Chỉ giải phóng phần hàng CHƯA XUẤT. Tuyệt đối không nhả phần hàng đã xuất kho!
 */
export function calculateReleaseAllocation(
  allocation: AllocationStateInput,
  requestedReleaseGrams?: number
): {
  newReleasedGrams: number
  actuallyReleasedGrams: number
  unreleasedGrams: number
  newStatus: AllocationStatus
} {
  const currentUnreleased = calculateUnreleasedAllocationGrams(allocation)

  // Mặc định giải phóng toàn bộ phần còn lại nếu không truyền tham số
  const toRelease = requestedReleaseGrams !== undefined ? requestedReleaseGrams : currentUnreleased
  validateIntegerGrams(toRelease, 'Lượng yêu cầu giải phóng')

  if (toRelease > currentUnreleased) {
    throw new RangeError(
      `Không thể giải phóng ${gramsToKg(toRelease)} kg vì chỉ còn ${gramsToKg(currentUnreleased)} kg chưa xuất`
    )
  }

  const newReleasedGrams = allocation.releasedGrams + toRelease
  const newUnreleased = allocation.allocatedGrams - allocation.dispatchedGrams - newReleasedGrams

  let newStatus: AllocationStatus = allocation.status || 'HOLD_PENDING'
  if (newUnreleased === 0) {
    newStatus = allocation.dispatchedGrams > 0 ? 'DISPATCHED' : 'RELEASED'
  }

  return {
    newReleasedGrams,
    actuallyReleasedGrams: toRelease,
    unreleasedGrams: Math.max(0, newUnreleased),
    newStatus,
  }
}

// ============================================================================
// 4. ĐÁNH GIÁ ĐIỀU KIỆN CẤP PHÁT LÔ HÀNG (BATCH ELIGIBILITY EVALUATION)
// ============================================================================

/**
 * Đánh giá một lô hàng có đủ điều kiện để tham gia thuật toán xuất kho FEFO hay không.
 * Phân định rõ ràng:
 * - Khi nào lô được phép bán giao ngay (ACTIVE + isFefoEligible + Có expiryDate + Còn hạn + Có tồn khả dụng).
 * - Khi nào lô chỉ dùng để tra cứu QR (UNVERIFIED, không có expiryDate).
 */
export function evaluateBatchEligibility(
  batch: BatchCandidate,
  options?: {
    targetProductId?: string
    referenceDate?: Date | string
  }
): BatchEligibilityResult {
  if (!batch || typeof batch !== 'object') {
    return { eligible: false, availableGrams: 0, message: 'Dữ liệu lô hàng không tồn tại' }
  }

  // 1. Kiểm tra khớp sản phẩm nếu có chỉ định
  if (options?.targetProductId && batch.productId !== options.targetProductId) {
    return {
      eligible: false,
      availableGrams: 0,
      reason: 'PRODUCT_MISMATCH',
      message: `Lô ${batch.code} thuộc sản phẩm khác`,
    }
  }

  // 2. Kiểm tra trạng thái lô: UNVERIFIED (Lô lịch sử hoặc chưa qua kiểm định - chỉ dùng QR)
  if (batch.status === 'UNVERIFIED') {
    return {
      eligible: false,
      availableGrams: 0,
      reason: 'BATCH_UNVERIFIED',
      message: `Lô ${batch.code} chưa qua kiểm định chất lượng (chỉ dùng tra cứu QR)`,
    }
  }

  // 3. Kiểm tra sự tồn tại của ngày hết hạn (Tuyệt đối không tự suy luận từ harvestDate)
  if (!batch.expiryDate) {
    return {
      eligible: false,
      availableGrams: 0,
      reason: 'MISSING_EXPIRY_DATE',
      message: `Lô ${batch.code} chưa được cập nhật hạn sử dụng xác thực`,
    }
  }

  // 4. Kiểm tra cờ kiểm định chất lượng (QC)
  if (!batch.isFefoEligible) {
    return {
      eligible: false,
      availableGrams: 0,
      reason: 'NOT_FEFO_ELIGIBLE',
      message: `Lô ${batch.code} chưa được bật cờ cấp phát FEFO`,
    }
  }

  if (batch.status === 'LOCKED_QC') {
    return {
      eligible: false,
      availableGrams: 0,
      reason: 'BATCH_LOCKED_QC',
      message: `Lô ${batch.code} đang bị phong tỏa kiểm định chất lượng`,
    }
  }

  if (batch.status === 'EXPIRED') {
    return {
      eligible: false,
      availableGrams: 0,
      reason: 'BATCH_EXPIRED',
      message: `Lô ${batch.code} đã được đánh dấu hết hạn`,
    }
  }

  if (batch.status === 'DEPLETED') {
    return {
      eligible: false,
      availableGrams: 0,
      reason: 'BATCH_DEPLETED',
      message: `Lô ${batch.code} đã xuất hết hàng`,
    }
  }

  if (batch.status !== 'ACTIVE') {
    return {
      eligible: false,
      availableGrams: 0,
      reason: 'BATCH_UNVERIFIED',
      message: `Lô ${batch.code} ở trạng thái không thể bán (${batch.status})`,
    }
  }

  // 5. Kiểm tra hạn sử dụng so với ngày kinh doanh
  if (isBatchExpired(batch.expiryDate, options?.referenceDate)) {
    return {
      eligible: false,
      availableGrams: 0,
      reason: 'BATCH_EXPIRED',
      message: `Lô ${batch.code} đã hết hạn sử dụng vào ngày ${toVietnamCalendarDate(batch.expiryDate)}`,
    }
  }

  // 6. Kiểm tra tồn khả dụng
  validateIntegerGrams(batch.physicalStockGrams, `Tồn vật lý lô ${batch.code}`)
  validateIntegerGrams(batch.reservedGrams, `Lượng giữ chỗ lô ${batch.code}`)

  const availableGrams = Math.max(0, batch.physicalStockGrams - batch.reservedGrams)
  if (availableGrams <= 0) {
    return {
      eligible: false,
      availableGrams: 0,
      reason: 'NO_AVAILABLE_STOCK',
      message: `Lô ${batch.code} không còn tồn khả dụng để xuất (Vật lý: ${batch.physicalStockGrams}g, Đã giữ: ${batch.reservedGrams}g)`,
    }
  }

  return {
    eligible: true,
    availableGrams,
  }
}

// ============================================================================
// 5. SẮP XẾP LÔ HÀNG THEO THUẬT TOÁN FEFO TẤT ĐỊNH (DETERMINISTIC FEFO SORT)
// ============================================================================

/**
 * Lọc và sắp xếp các lô hàng đủ điều kiện theo nguyên tắc FEFO tất định.
 * 
 * THỨ TỰ ƯU TIÊN SẮP XẾP:
 * 1. Hạn sử dụng gần nhất trước (expiryDate ASC).
 * 2. Cùng hạn sử dụng -> Ưu tiên lô thu hoạch trước (harvestDate ASC).
 * 3. Cùng ngày thu hoạch -> Ưu tiên theo mã lô chữ cái (code ASC).
 * 4. Fallback cuối cùng -> Theo id lô (id ASC).
 * 
 * Hàm thuần (Pure): Không làm thay đổi mảng đầu vào.
 */
export function sortBatchesByFefo(
  batches: BatchCandidate[],
  referenceDate?: Date | string
): BatchCandidate[] {
  if (!Array.isArray(batches)) {
    return []
  }

  // 1. Lọc chỉ lấy các lô đủ điều kiện
  const eligible = batches.filter((b) => {
    const res = evaluateBatchEligibility(b, { referenceDate })
    return res.eligible
  })

  // 2. Tạo bản sao mới để sắp xếp (Bảo toàn Immutability)
  return [...eligible].sort((a, b) => {
    const expA = toVietnamCalendarDate(a.expiryDate!)
    const expB = toVietnamCalendarDate(b.expiryDate!)
    if (expA !== expB) {
      return expA.localeCompare(expB)
    }

    const harvA = toVietnamCalendarDate(a.harvestDate)
    const harvB = toVietnamCalendarDate(b.harvestDate)
    if (harvA !== harvB) {
      return harvA.localeCompare(harvB)
    }

    const codeCompare = a.code.localeCompare(b.code)
    if (codeCompare !== 0) {
      return codeCompare
    }

    return a.id.localeCompare(b.id)
  })
}

// ============================================================================
// 6. PHÂN BỔ FEFO QUA NHIỀU LÔ HÀNG (PURE FEFO ALLOCATION ENGINE)
// ============================================================================

/**
 * Phân bổ số lượng đặt hàng theo thuật toán FEFO qua một hoặc nhiều lô hàng hợp lệ.
 * 
 * ĐẶC TÍNH:
 * - Pure Function: Không gọi DB, không side effects.
 * - Trả về chi tiết phân bổ từng lô: { batchId, batchCode, allocatedGrams, expiryDate }.
 * - Thông báo thiếu hàng chính xác nếu tổng tồn khả dụng của toàn bộ các lô hợp lệ không đủ.
 * - Bảo vệ chặt chẽ: Không bao giờ phân bổ vượt quá tồn khả dụng của từng lô.
 * - Không làm thay đổi dữ liệu đầu vào.
 */
export function allocateBatchesFefo({
  batches,
  requestedGrams,
  targetProductId,
  referenceDate,
}: FefoAllocationInput): FefoAllocationResult {
  // 1. Xác thực số lượng yêu cầu
  if (typeof requestedGrams !== 'number' || isNaN(requestedGrams) || !Number.isFinite(requestedGrams)) {
    return {
      success: false,
      isFullyAllocated: false,
      requestedGrams: 0,
      allocatedGrams: 0,
      shortageGrams: 0,
      allocations: [],
      eligibleBatchesCount: 0,
      consideredBatchesCount: Array.isArray(batches) ? batches.length : 0,
      error: 'Khối lượng yêu cầu phải là một số hợp lệ',
    }
  }

  if (!Number.isInteger(requestedGrams) || requestedGrams <= 0) {
    return {
      success: false,
      isFullyAllocated: false,
      requestedGrams,
      allocatedGrams: 0,
      shortageGrams: requestedGrams,
      allocations: [],
      eligibleBatchesCount: 0,
      consideredBatchesCount: Array.isArray(batches) ? batches.length : 0,
      error: `Khối lượng yêu cầu phải là số nguyên gram dương (nhận được: ${requestedGrams} g)`,
    }
  }

  if (!Array.isArray(batches) || batches.length === 0) {
    return {
      success: false,
      isFullyAllocated: false,
      requestedGrams,
      allocatedGrams: 0,
      shortageGrams: requestedGrams,
      allocations: [],
      eligibleBatchesCount: 0,
      consideredBatchesCount: 0,
      error: 'Không có lô hàng nào trong danh mục xem xét',
    }
  }

  // 2. Lọc theo sản phẩm nếu có
  const filteredBatches = targetProductId
    ? batches.filter((b) => b.productId === targetProductId)
    : batches

  // 3. Sắp xếp lô đủ điều kiện theo FEFO
  const sortedEligibleBatches = sortBatchesByFefo(filteredBatches, referenceDate)

  let remainingNeeded = requestedGrams
  let totalAllocated = 0
  const allocations: AllocationItem[] = []

  // 4. Lần lượt bốc hàng từ các lô theo thứ tự FEFO
  for (const batch of sortedEligibleBatches) {
    if (remainingNeeded <= 0) {
      break
    }

    const available = Math.max(0, batch.physicalStockGrams - batch.reservedGrams)
    if (available <= 0) {
      continue
    }

    const takeGrams = Math.min(remainingNeeded, available)
    if (takeGrams > 0) {
      allocations.push({
        batchId: batch.id,
        batchCode: batch.code,
        allocatedGrams: takeGrams,
        expiryDate: toVietnamCalendarDate(batch.expiryDate!),
        harvestDate: toVietnamCalendarDate(batch.harvestDate),
      })

      totalAllocated += takeGrams
      remainingNeeded -= takeGrams
    }
  }

  const isFullyAllocated = remainingNeeded === 0
  const shortageGrams = remainingNeeded > 0 ? remainingNeeded : 0

  return {
    success: isFullyAllocated,
    isFullyAllocated,
    requestedGrams,
    allocatedGrams: totalAllocated,
    shortageGrams,
    allocations,
    eligibleBatchesCount: sortedEligibleBatches.length,
    consideredBatchesCount: batches.length,
    error: isFullyAllocated
      ? undefined
      : `Không đủ hàng khả dụng theo FEFO (yêu cầu: ${gramsToKg(requestedGrams)} kg, chỉ cấp phát được: ${gramsToKg(totalAllocated)} kg, còn thiếu: ${gramsToKg(shortageGrams)} kg)`,
  }
}

// ============================================================================
// 7. TỔNG HỢP NĂNG LỰC TỒN KHO KHẢ DỤNG THEO SẢN PHẨM
// ============================================================================

/**
 * Tính tổng lượng hàng tồn khả dụng của một sản phẩm từ danh sách các lô hàng.
 * Phân tích chi tiết số lô hợp lệ, số lô hết hạn, và số lô chưa xác minh.
 */
export function calculateAvailableStock(
  batches: BatchCandidate[],
  options?: {
    targetProductId?: string
    referenceDate?: Date | string
  }
): InventoryAvailabilitySummary {
  if (!Array.isArray(batches)) {
    return {
      totalPhysicalStockGrams: 0,
      totalReservedGrams: 0,
      totalAvailableGrams: 0,
      eligibleBatchesCount: 0,
      ineligibleBatchesCount: 0,
      expiredBatchesCount: 0,
      unverifiedBatchesCount: 0,
    }
  }

  const filtered = options?.targetProductId
    ? batches.filter((b) => b.productId === options.targetProductId)
    : batches

  let totalPhysicalStockGrams = 0
  let totalReservedGrams = 0
  let totalAvailableGrams = 0
  let eligibleBatchesCount = 0
  let ineligibleBatchesCount = 0
  let expiredBatchesCount = 0
  let unverifiedBatchesCount = 0

  for (const batch of filtered) {
    totalPhysicalStockGrams += Math.max(0, batch.physicalStockGrams || 0)
    totalReservedGrams += Math.max(0, batch.reservedGrams || 0)

    const eligibility = evaluateBatchEligibility(batch, options)
    if (eligibility.eligible) {
      eligibleBatchesCount++
      totalAvailableGrams += eligibility.availableGrams
    } else {
      ineligibleBatchesCount++
      if (eligibility.reason === 'BATCH_EXPIRED') {
        expiredBatchesCount++
      } else if (eligibility.reason === 'BATCH_UNVERIFIED' || eligibility.reason === 'MISSING_EXPIRY_DATE') {
        unverifiedBatchesCount++
      }
    }
  }

  return {
    totalPhysicalStockGrams,
    totalReservedGrams,
    totalAvailableGrams,
    eligibleBatchesCount,
    ineligibleBatchesCount,
    expiredBatchesCount,
    unverifiedBatchesCount,
  }
}

// ============================================================================
// 8. CHÍNH SÁCH GIỮ HÀNG 10 PHÚT & KIỂM TRA QUÁ HẠN THANH TOÁN (EV-IMP-01C)
// ============================================================================

export const RESERVATION_TIMEOUT_MINUTES = 10
export const RESERVATION_TIMEOUT_MS = RESERVATION_TIMEOUT_MINUTES * 60 * 1000

/**
 * Tính thời điểm hết hạn giữ chỗ thanh toán: createdAt + 10 phút.
 */
export function computeOrderPaymentDueAt(createdAt: Date = new Date()): Date {
  return new Date(createdAt.getTime() + RESERVATION_TIMEOUT_MS)
}

/**
 * Kiểm tra xem đơn hàng chờ xác nhận có bị quá hạn giữ chỗ 10 phút hay chưa (theo giờ Server).
 * Quy tắc EV-IMP-01C:
 * - Chỉ áp dụng cho đơn đang ở trạng thái PENDING_CONFIRMATION.
 * - Nếu đã thanh toán đạt ngưỡng xác nhận (paidAmount >= requiredAmount, khi requiredAmount > 0) thì không bị coi là quá hạn.
 * - Nếu chưa thanh toán (paidAmount = 0) hoặc mới thanh toán một phần dưới ngưỡng xác nhận (0 < paidAmount < requiredAmount):
 *   khi thời điểm hiện tại vượt qua paymentDueAt (paymentDueAt < now), quyền giữ chỗ 10 phút của đơn đã hết hạn.
 */
export function isOrderPaymentExpired(
  order: {
    status: string
    paymentDueAt?: Date | string | null
    paidAmount?: number
    requiredAmount?: number
  },
  now: Date = new Date()
): boolean {
  if (!order || order.status !== 'PENDING_CONFIRMATION') {
    return false
  }
  const paid = order.paidAmount ?? 0
  if (order.requiredAmount !== undefined && order.requiredAmount > 0) {
    if (paid >= order.requiredAmount) {
      return false
    }
  } else if (paid > 0) {
    return false
  }
  if (!order.paymentDueAt) {
    return false
  }
  const dueDate =
    typeof order.paymentDueAt === 'string' ? new Date(order.paymentDueAt) : order.paymentDueAt
  if (isNaN(dueDate.getTime())) {
    return false
  }
  return dueDate.getTime() < now.getTime()
}

