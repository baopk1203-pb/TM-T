import { describe, expect, it } from 'vitest'
import { BatchStatus } from '@prisma/client'
import {
  isInventoryWriteEnabled,
  validateStockReceipt,
  validateStockAdjustment,
  validateBatchStatusTransition,
  calculateStockAdjustmentImpact,
  buildBatchStatusAuditKey,
} from '@/lib/domain/inventory-operations'
import type { BatchStockSummary } from '@/lib/domain/inventory'

describe('Domain: Inventory Operations (F01D Phase 2)', () => {
  describe('1. Feature Flag & Fail-Closed Guards', () => {
    it('Mặc định trả về false khi cờ không được set hoặc set khác "true"', () => {
      expect(isInventoryWriteEnabled(undefined)).toBe(false)
      expect(isInventoryWriteEnabled('')).toBe(false)
      expect(isInventoryWriteEnabled('false')).toBe(false)
      expect(isInventoryWriteEnabled('1')).toBe(false)
    })

    it('Trả về true khi biến môi trường được bật chính xác là "true"', () => {
      expect(isInventoryWriteEnabled('true')).toBe(true)
    })
  })

  describe('2. Module A — Stock Receipt Validation', () => {
    const validReceiptInput = {
      productId: 'prod-ri6',
      farmId: 'farm-mekong',
      code: 'LO-RI6-261026-001',
      harvestDate: new Date('2026-10-25'),
      expiryDate: new Date('2026-11-05'),
      quantityKg: 150.5, // 150,500 g
      status: BatchStatus.ACTIVE,
      isFefoEligible: true,
      qcNotes: 'Đạt chuẩn xuất khẩu loại 1',
    }

    it('A1. Nhập kho hợp lệ: chuyển đổi chính xác sang số nguyên gram', () => {
      const res = validateStockReceipt(validReceiptInput, new Date('2026-10-26'))
      expect(res.isValid).toBe(true)
      expect(res.errors).toHaveLength(0)
      expect(res.data?.quantityGrams).toBe(150500)
      expect(res.data?.code).toBe('LO-RI6-261026-001')
      expect(res.data?.isFefoEligible).toBe(true)
      expect(res.data?.status).toBe(BatchStatus.ACTIVE)
      expect(res.data?.idempotencyKey).toBe('RECEIPT:LO-RI6-261026-001')
    })

    it('A2. Từ chối khi thiếu productId, farmId hoặc mã lô', () => {
      const res = validateStockReceipt({
        ...validReceiptInput,
        productId: '',
        farmId: '   ',
        code: 'invalid code with space!',
      })
      expect(res.isValid).toBe(false)
      expect(res.errors.some((e) => e.includes('productId'))).toBe(true)
      expect(res.errors.some((e) => e.includes('farmId'))).toBe(true)
      expect(res.errors.some((e) => e.includes('Mã lô hàng chỉ được chứa chữ hoa'))).toBe(true)
    })

    it('A3. Từ chối khối lượng âm, bằng 0, NaN hoặc Infinity', () => {
      expect(validateStockReceipt({ ...validReceiptInput, quantityKg: 0 }).isValid).toBe(false)
      expect(validateStockReceipt({ ...validReceiptInput, quantityKg: -10 }).isValid).toBe(false)
      expect(validateStockReceipt({ ...validReceiptInput, quantityKg: NaN }).isValid).toBe(false)
      expect(validateStockReceipt({ ...validReceiptInput, quantityKg: Infinity }).isValid).toBe(false)
    })

    it('A4. Từ chối khi hạn sử dụng trước ngày thu hoạch', () => {
      const res = validateStockReceipt({
        ...validReceiptInput,
        harvestDate: new Date('2026-10-26'),
        expiryDate: new Date('2026-10-20'),
      })
      expect(res.isValid).toBe(false)
      expect(res.errors.some((e) => e.includes('Hạn sử dụng'))).toBe(true)
    })

    it('A5. Từ chối bật FEFO khi thiếu ngày hết hạn', () => {
      const res = validateStockReceipt({
        ...validReceiptInput,
        expiryDate: null,
        isFefoEligible: true,
      })
      expect(res.isValid).toBe(false)
      expect(res.errors.some((e) => e.includes('chưa có ngày hết hạn'))).toBe(true)
    })

    it('A6. Từ chối bật ACTIVE hoặc FEFO khi lô đã quá hạn sử dụng', () => {
      const res = validateStockReceipt(
        {
          ...validReceiptInput,
          harvestDate: new Date('2026-10-01'),
          expiryDate: new Date('2026-10-10'),
          status: BatchStatus.ACTIVE,
          isFefoEligible: true,
        },
        new Date('2026-10-26')
      )
      expect(res.isValid).toBe(false)
      expect(res.errors.some((e) => e.includes('quá hạn'))).toBe(true)
    })

    it('A7. Từ chối bật FEFO cho lô UNVERIFIED hoặc LOCKED_QC', () => {
      const resUnverified = validateStockReceipt({
        ...validReceiptInput,
        status: BatchStatus.UNVERIFIED,
        isFefoEligible: true,
      })
      expect(resUnverified.isValid).toBe(false)

      const resLocked = validateStockReceipt({
        ...validReceiptInput,
        status: BatchStatus.LOCKED_QC,
        isFefoEligible: true,
      })
      expect(resLocked.isValid).toBe(false)
    })
  })

  describe('3. Module C — Stock Adjustment Validation', () => {
    const mockStockSummary: BatchStockSummary = {
      physicalStockGrams: 100000, // 100 kg vật lý
      reservedGrams: 30000,       // 30 kg đang giữ chỗ
      availableGrams: 70000,      // 70 kg khả dụng
      dispatchedGrams: 0,
      shrinkageGrams: 0,
      importGrams: 100000,
      rawPhysicalStockGrams: 100000,
      rawReservedGrams: 30000,
      rawAvailableGrams: 70000,
      hasDeficit: false,
      warnings: [],
    }

    it('C1. Tính toán tác động điều chỉnh giảm hao hụt SHRINKAGE_LOSS', () => {
      const impact = calculateStockAdjustmentImpact(mockStockSummary, 'SHRINKAGE_LOSS', 20000)
      expect(impact.deltaGrams).toBe(-20000)
      expect(impact.projectedPhysicalStockGrams).toBe(80000)
      expect(impact.projectedReservedGrams).toBe(30000)
      expect(impact.projectedAvailableGrams).toBe(50000)
    })

    it('C2. Tính toán tác động điều chỉnh tăng kiểm kê QC_ADJUSTMENT_ADD', () => {
      const impact = calculateStockAdjustmentImpact(mockStockSummary, 'QC_ADJUSTMENT_ADD', 10000)
      expect(impact.deltaGrams).toBe(10000)
      expect(impact.projectedPhysicalStockGrams).toBe(110000)
      expect(impact.projectedReservedGrams).toBe(30000)
      expect(impact.projectedAvailableGrams).toBe(80000)
    })

    it('C3. Điều chỉnh giảm hợp lệ trong phạm vi khả dụng: PASS', () => {
      const res = validateStockAdjustment(
        {
          batchId: 'batch-01',
          type: 'SHRINKAGE_LOSS',
          quantityKg: 20,
          reason: 'Hao hụt tự nhiên do bảo quản kho lạnh',
        },
        mockStockSummary
      )
      expect(res.isValid).toBe(true)
      expect(res.data?.quantityGrams).toBe(20000)
      expect(res.data?.impact.projectedPhysicalStockGrams).toBe(80000)
      expect(res.data?.impact.projectedAvailableGrams).toBe(50000)
    })

    it('C4. Từ chối điều chỉnh giảm vượt quá tồn vật lý (không làm âm kho)', () => {
      const res = validateStockAdjustment(
        {
          batchId: 'batch-01',
          type: 'SHRINKAGE_LOSS',
          quantityKg: 120, // Kho chỉ có 100 kg
          reason: 'Hư hỏng toàn bộ',
        },
        mockStockSummary
      )
      expect(res.isValid).toBe(false)
      expect(res.errors.some((e) => e.includes('sẽ làm âm kho vật lý'))).toBe(true)
    })

    it('C5. Từ chối điều chỉnh giảm chạm vào phần RESERVED của đơn hàng khác', () => {
      const res = validateStockAdjustment(
        {
          batchId: 'batch-01',
          type: 'QC_ADJUSTMENT_SUB',
          quantityKg: 80, // Tồn 100 kg, giữ 30 kg, khả dụng chỉ có 70 kg
          reason: 'Kiểm kê thực tế thiếu 80 kg',
        },
        mockStockSummary
      )
      expect(res.isValid).toBe(false)
      expect(res.errors.some((e) => e.includes('được giữ chỗ cho các đơn hàng'))).toBe(true)
    })

    it('C6. Bắt buộc có lý do điều chỉnh có nghĩa (>= 5 ký tự)', () => {
      const res = validateStockAdjustment(
        {
          batchId: 'batch-01',
          type: 'SHRINKAGE_LOSS',
          quantityKg: 5,
          reason: 'abc', // Quá ngắn
        },
        mockStockSummary
      )
      expect(res.isValid).toBe(false)
      expect(res.errors.some((e) => e.includes('ít nhất 5 ký tự'))).toBe(true)
    })
  })

  describe('4. Module D — Batch Status Lifecycle & Audit Trail', () => {
    it('D1. Chuyển đổi trạng thái hợp lệ: UNVERIFIED -> ACTIVE', () => {
      const res = validateBatchStatusTransition({
        batchId: 'b-01',
        currentStatus: BatchStatus.UNVERIFIED,
        targetStatus: BatchStatus.ACTIVE,
        currentEligibility: false,
        targetEligibility: true,
        expiryDate: new Date('2026-11-20'),
        activeReservedGrams: 0,
        reason: 'QC kiểm định chất lượng đạt chuẩn VietGAP',
        actorId: 'admin-01',
      })
      expect(res.isValid).toBe(true)
      expect(res.data?.newStatus).toBe(BatchStatus.ACTIVE)
      expect(res.data?.newEligibility).toBe(true)
      expect(res.data?.actorId).toBe('admin-01')
    })

    it('D2. Từ chối chuyển đổi vi phạm máy trạng thái (DEPLETED -> ACTIVE hoặc EXPIRED -> ACTIVE)', () => {
      const resDepleted = validateBatchStatusTransition({
        batchId: 'b-01',
        currentStatus: BatchStatus.DEPLETED,
        targetStatus: BatchStatus.ACTIVE,
        currentEligibility: false,
        targetEligibility: true,
        reason: 'Muốn mở lại bán',
        actorId: 'admin-01',
      })
      expect(resDepleted.isValid).toBe(false)

      const resExpired = validateBatchStatusTransition({
        batchId: 'b-01',
        currentStatus: BatchStatus.EXPIRED,
        targetStatus: BatchStatus.ACTIVE,
        currentEligibility: false,
        targetEligibility: true,
        reason: 'Gia hạn thêm ngày',
        actorId: 'admin-01',
      })
      expect(resExpired.isValid).toBe(false)
    })

    it('D3. Từ chối khóa lô hoặc tắt FEFO khi lô ĐANG CÓ RESERVATION còn hiệu lực', () => {
      const res = validateBatchStatusTransition({
        batchId: 'b-01',
        currentStatus: BatchStatus.ACTIVE,
        targetStatus: BatchStatus.LOCKED_QC,
        currentEligibility: true,
        targetEligibility: false,
        activeReservedGrams: 50000, // Đang giữ 50 kg cho đơn hàng
        reason: 'Tạm khóa để kiểm định mẫu ngẫu nhiên',
        actorId: 'admin-01',
      })
      expect(res.isValid).toBe(false)
      expect(res.errors.some((e) => e.includes('CẢNH BÁO BẢO VỆ RESERVATION'))).toBe(true)
    })

    it('D4. Từ chối bật FEFO khi lô thiếu ngày hết hạn', () => {
      const res = validateBatchStatusTransition({
        batchId: 'b-01',
        currentStatus: BatchStatus.UNVERIFIED,
        targetStatus: BatchStatus.ACTIVE,
        currentEligibility: false,
        targetEligibility: true,
        expiryDate: null,
        reason: 'Mở bán thử nghiệm',
        actorId: 'admin-01',
      })
      expect(res.isValid).toBe(false)
      expect(res.errors.some((e) => e.includes('thiếu ngày hết hạn'))).toBe(true)
    })

    it('D5. Xây dựng Audit Key theo quy ước AppSetting', () => {
      const key = buildBatchStatusAuditKey('batch-123', 1700000000000)
      expect(key).toBe('AUDIT:BATCH_STATUS:batch-123:1700000000000')
    })
  })
})
