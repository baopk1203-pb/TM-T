/**
 * ============================================================================
 * UNIT TESTS: ADMIN INVENTORY ADJUSTMENT DOMAIN & FEATURE FLAG
 * EV-F01-ADMIN-INVENTORY-ADJUSTMENT-01
 * ============================================================================
 */

import { describe, it, expect, afterEach } from 'vitest'
import { BatchStatus } from '@prisma/client'
import {
  isInventoryAdjustmentEnabled,
  isInventoryWriteEnabled,
  calculateStockAdjustmentImpact,
  validateStockAdjustment,
} from '@/lib/domain/inventory-operations'
import { evaluateBatchAdjustActionState } from '@/app/admin/lo-hang/batch-management'
import type { BatchStockSummary } from '@/lib/domain/inventory'

describe('EV-F01-ADMIN-INVENTORY-ADJUSTMENT-01 — Unit Tests', () => {
  const originalWritesEnv = process.env.ENABLE_ADMIN_INVENTORY_WRITES
  const originalAdjustEnv = process.env.ENABLE_ADMIN_INVENTORY_ADJUSTMENTS

  afterEach(() => {
    if (originalWritesEnv !== undefined) {
      process.env.ENABLE_ADMIN_INVENTORY_WRITES = originalWritesEnv
    } else {
      delete process.env.ENABLE_ADMIN_INVENTORY_WRITES
    }

    if (originalAdjustEnv !== undefined) {
      process.env.ENABLE_ADMIN_INVENTORY_ADJUSTMENTS = originalAdjustEnv
    } else {
      delete process.env.ENABLE_ADMIN_INVENTORY_ADJUSTMENTS
    }
  })

  // ==========================================================================
  // 1. FEATURE FLAG ISOLATION TESTS
  // ==========================================================================
  describe('1. Feature Flag Isolation (ENABLE_ADMIN_INVENTORY_ADJUSTMENTS)', () => {
    it('FF-01: Mặc định Fail-closed khi không có biến môi trường nào được bật', () => {
      delete process.env.ENABLE_ADMIN_INVENTORY_WRITES
      delete process.env.ENABLE_ADMIN_INVENTORY_ADJUSTMENTS

      expect(isInventoryWriteEnabled()).toBe(false)
      expect(isInventoryAdjustmentEnabled()).toBe(false)
    })

    it('FF-02: Bật ENABLE_ADMIN_INVENTORY_ADJUSTMENTS="true" khi WRITES="false" -> Chỉ mở adjustment, khóa writes', () => {
      process.env.ENABLE_ADMIN_INVENTORY_WRITES = 'false'
      process.env.ENABLE_ADMIN_INVENTORY_ADJUSTMENTS = 'true'

      expect(isInventoryWriteEnabled()).toBe(false)
      expect(isInventoryAdjustmentEnabled()).toBe(true)
    })

    it('FF-03: ENABLE_ADMIN_INVENTORY_ADJUSTMENTS="false" -> Khóa điều chỉnh', () => {
      process.env.ENABLE_ADMIN_INVENTORY_WRITES = 'false'
      process.env.ENABLE_ADMIN_INVENTORY_ADJUSTMENTS = 'false'

      expect(isInventoryAdjustmentEnabled()).toBe(false)
    })

    it('FF-04: Cờ tổng ENABLE_ADMIN_INVENTORY_WRITES="true" -> Tự động cho phép cả adjustments', () => {
      process.env.ENABLE_ADMIN_INVENTORY_WRITES = 'true'
      delete process.env.ENABLE_ADMIN_INVENTORY_ADJUSTMENTS

      expect(isInventoryWriteEnabled()).toBe(true)
      expect(isInventoryAdjustmentEnabled()).toBe(true)
    })
  })

  // ==========================================================================
  // 2. STOCK ADJUSTMENT IMPACT CALCULATIONS
  // ==========================================================================
  describe('2. Stock Adjustment Impact Calculations', () => {
    const mockSummary: BatchStockSummary = {
      physicalStockGrams: 50000, // 50 kg
      reservedGrams: 15000,      // 15 kg
      availableGrams: 35000,     // 35 kg
      dispatchedGrams: 0,
      shrinkageGrams: 0,
      importGrams: 50000,
      rawPhysicalStockGrams: 50000,
      rawReservedGrams: 15000,
      rawAvailableGrams: 35000,
      hasDeficit: false,
      warnings: [],
    }

    it('ADJ-01: Admin tăng tồn 1 kg (QC_ADJUSTMENT_ADD) -> Physical +1kg, Available +1kg, Reserved giữ nguyên', () => {
      const impact = calculateStockAdjustmentImpact(mockSummary, 'QC_ADJUSTMENT_ADD', 1000)

      expect(impact.deltaGrams).toBe(1000)
      expect(impact.projectedPhysicalStockGrams).toBe(51000) // 50kg + 1kg = 51kg
      expect(impact.projectedReservedGrams).toBe(15000)      // 15kg không đổi
      expect(impact.projectedAvailableGrams).toBe(36000)     // 35kg + 1kg = 36kg
    })

    it('ADJ-02: Admin giảm tồn 1 kg (QC_ADJUSTMENT_SUB) -> Physical -1kg, Available -1kg, Reserved giữ nguyên', () => {
      const impact = calculateStockAdjustmentImpact(mockSummary, 'QC_ADJUSTMENT_SUB', 1000)

      expect(impact.deltaGrams).toBe(-1000)
      expect(impact.projectedPhysicalStockGrams).toBe(49000) // 50kg - 1kg = 49kg
      expect(impact.projectedReservedGrams).toBe(15000)      // 15kg không đổi
      expect(impact.projectedAvailableGrams).toBe(34000)     // 35kg - 1kg = 34kg
    })

    it('ADJ-03: Ghi nhận hao hụt (SHRINKAGE_LOSS) 2 kg -> Physical -2kg, Reserved giữ nguyên', () => {
      const impact = calculateStockAdjustmentImpact(mockSummary, 'SHRINKAGE_LOSS', 2000)

      expect(impact.deltaGrams).toBe(-2000)
      expect(impact.projectedPhysicalStockGrams).toBe(48000)
      expect(impact.projectedReservedGrams).toBe(15000)
      expect(impact.projectedAvailableGrams).toBe(33000)
    })
  })

  // ==========================================================================
  // 3. VALIDATION & INVENTORY INTEGRITY RULES
  // ==========================================================================
  describe('3. Validation & Inventory Integrity Rules', () => {
    const mockSummary: BatchStockSummary = {
      physicalStockGrams: 20000, // 20 kg
      reservedGrams: 15000,      // 15 kg đang giữ chỗ
      availableGrams: 5000,      // 5 kg khả dụng
      dispatchedGrams: 0,
      shrinkageGrams: 0,
      importGrams: 20000,
      rawPhysicalStockGrams: 20000,
      rawReservedGrams: 15000,
      rawAvailableGrams: 5000,
      hasDeficit: false,
      warnings: [],
    }

    it('VAL-01: Chấp nhận điều chỉnh giảm trong phạm vi khả dụng (<= 5 kg)', () => {
      const res = validateStockAdjustment(
        {
          batchId: 'batch-123',
          type: 'QC_ADJUSTMENT_SUB',
          quantityKg: 3,
          reason: 'Cân lại hao hụt 3 kg quả dập',
        },
        mockSummary
      )

      expect(res.isValid).toBe(true)
      expect(res.data?.quantityGrams).toBe(3000)
      expect(res.data?.impact.projectedPhysicalStockGrams).toBe(17000)
      expect(res.data?.impact.projectedAvailableGrams).toBe(2000)
    })

    it('VAL-02: Từ chối điều chỉnh giảm làm âm tồn vật lý (> 20 kg)', () => {
      const res = validateStockAdjustment(
        {
          batchId: 'batch-123',
          type: 'QC_ADJUSTMENT_SUB',
          quantityKg: 25,
          reason: 'Điều chỉnh giảm quá mức',
        },
        mockSummary
      )

      expect(res.isValid).toBe(false)
      expect(res.errors.some((e) => e.includes('làm âm kho vật lý'))).toBe(true)
    })

    it('VAL-03: Từ chối điều chỉnh giảm xâm phạm phần RESERVED (giảm 10 kg khi khả dụng chỉ có 5 kg)', () => {
      const res = validateStockAdjustment(
        {
          batchId: 'batch-123',
          type: 'SHRINKAGE_LOSS',
          quantityKg: 10,
          reason: 'Hao hụt vượt tồn khả dụng',
        },
        mockSummary
      )

      expect(res.isValid).toBe(false)
      expect(res.errors.some((e) => e.includes('được giữ chỗ cho các đơn hàng'))).toBe(true)
    })

    it('VAL-04: Từ chối khối lượng <= 0 hoặc lý do quá ngắn (< 5 ký tự)', () => {
      const resZeroKg = validateStockAdjustment(
        {
          batchId: 'batch-123',
          type: 'QC_ADJUSTMENT_ADD',
          quantityKg: 0,
          reason: 'Kiểm kê bù hàng',
        },
        mockSummary
      )
      expect(resZeroKg.isValid).toBe(false)
      expect(resZeroKg.errors.some((e) => e.includes('lớn hơn 0 kg'))).toBe(true)

      const resShortReason = validateStockAdjustment(
        {
          batchId: 'batch-123',
          type: 'QC_ADJUSTMENT_ADD',
          quantityKg: 1,
          reason: 'Hụt',
        },
        mockSummary
      )
      expect(resShortReason.isValid).toBe(false)
      expect(resShortReason.errors.some((e) => e.includes('ít nhất 5 ký tự'))).toBe(true)
    })
  })

  // ==========================================================================
  // 4. UI ACTION STATE (evaluateBatchAdjustActionState)
  // ==========================================================================
  describe('4. UI Action State Guard', () => {
    it('UI-01: Cho phép mở Modal Điều chỉnh cho lô ACTIVE hoặc LOCKED_QC', () => {
      const activeState = evaluateBatchAdjustActionState({
        productTrackingEnabled: true,
        status: BatchStatus.ACTIVE,
        physicalStockGrams: 50000,
        ledgerCount: 3,
      })
      expect(activeState.canOpen).toBe(true)
      expect(activeState.disabledReason).toBeNull()

      const lockedQcState = evaluateBatchAdjustActionState({
        productTrackingEnabled: true,
        status: BatchStatus.LOCKED_QC,
        physicalStockGrams: 10000,
        ledgerCount: 1,
      })
      expect(lockedQcState.canOpen).toBe(true)
      expect(lockedQcState.disabledReason).toBeNull()
    })

    it('UI-02: Chặn mở Modal Điều chỉnh cho lô DEPLETED, sản phẩm chưa bật tracking hoặc lô QR lịch sử 0 kg', () => {
      const depletedState = evaluateBatchAdjustActionState({
        productTrackingEnabled: true,
        status: BatchStatus.DEPLETED,
        physicalStockGrams: 0,
        ledgerCount: 4,
      })
      expect(depletedState.canOpen).toBe(false)
      expect(depletedState.disabledReason).toContain('DEPLETED')

      const untrackedState = evaluateBatchAdjustActionState({
        productTrackingEnabled: false,
        status: BatchStatus.ACTIVE,
        physicalStockGrams: 10000,
        ledgerCount: 1,
      })
      expect(untrackedState.canOpen).toBe(false)
      expect(untrackedState.disabledReason).toContain('chưa bật quản lý tồn kho')

      const qrZeroState = evaluateBatchAdjustActionState({
        productTrackingEnabled: true,
        status: BatchStatus.UNVERIFIED,
        physicalStockGrams: 0,
        ledgerCount: 0,
      })
      expect(qrZeroState.canOpen).toBe(false)
      expect(qrZeroState.disabledReason).toContain('0 kg')
    })
  })
})
