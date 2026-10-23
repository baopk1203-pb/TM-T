import { describe, it, expect } from 'vitest'
import {
  gramsToKg,
  kgToGrams,
  validateIntegerGrams,
  toVietnamCalendarDate,
  isBatchExpired,
  calculateStockFromLedger,
  evaluateBatchEligibility,
  sortBatchesByFefo,
  allocateBatchesFefo,
  calculateAvailableStock,
  BatchCandidate,
  LedgerEntry,
} from '@/lib/domain/inventory'

describe('Domain: Inventory & FEFO Engine (EV-IMP-01A)', () => {
  // ==========================================================================
  // NHÓM 1: QUY ĐỔI & KIỂM TRA ĐƠN VỊ TÍNH (GRAMS & KG)
  // ==========================================================================
  describe('Đơn vị tính Gram & Kilogram', () => {
    it('quy đổi chính xác gram sang kg', () => {
      expect(gramsToKg(1000)).toBe(1)
      expect(gramsToKg(50000)).toBe(50)
      expect(gramsToKg(2500)).toBe(2.5)
      expect(gramsToKg(0)).toBe(0)
    })

    it('quy đổi chính xác kg sang gram', () => {
      expect(kgToGrams(1)).toBe(1000)
      expect(kgToGrams(50)).toBe(50000)
      expect(kgToGrams(2.5)).toBe(2500)
      expect(kgToGrams(0)).toBe(0)
    })

    it('validateIntegerGrams ném lỗi khi dùng số thực, số âm hoặc NaN', () => {
      expect(() => validateIntegerGrams(10.5)).toThrowError(RangeError)
      expect(() => validateIntegerGrams(-100)).toThrowError(RangeError)
      expect(() => validateIntegerGrams(NaN)).toThrowError(TypeError)
      expect(() => validateIntegerGrams(Infinity)).toThrowError(TypeError)
      expect(() => validateIntegerGrams(50000)).not.toThrow()
    })
  })

  // ==========================================================================
  // NHÓM 2: SỔ CÁI TỒN KHO & TOÁN HỌC CHỐNG DOUBLE-COUNTING
  // ==========================================================================
  describe('Sổ cái Tồn kho & Toán học Không Double-Counting', () => {
    it('tính đúng tồn kho khi chỉ có nhập kho (IMPORT)', () => {
      const entries: LedgerEntry[] = [
        { type: 'IMPORT', quantityGrams: 100000 }, // Nhập 100 kg
      ]
      const summary = calculateStockFromLedger(entries)

      expect(summary.physicalStockGrams).toBe(100000)
      expect(summary.reservedGrams).toBe(0)
      expect(summary.availableGrams).toBe(100000)
      expect(summary.dispatchedGrams).toBe(0)
      expect(summary.shrinkageGrams).toBe(0)
    })

    it('tính đúng khi giữ chỗ hàng (RESERVATION_HOLD) làm giảm tồn khả dụng', () => {
      const entries: LedgerEntry[] = [
        { type: 'IMPORT', quantityGrams: 100000 },          // Nhập 100 kg
        { type: 'RESERVATION_HOLD', quantityGrams: 30000 }, // Giữ 30 kg
      ]
      const summary = calculateStockFromLedger(entries)

      expect(summary.physicalStockGrams).toBe(100000) // Hàng vẫn còn trong kho vật lý
      expect(summary.reservedGrams).toBe(30000)        // 30 kg bị giữ
      expect(summary.availableGrams).toBe(70000)       // Chỉ còn 70 kg mở bán
    })

    it('giải phóng giữ chỗ (RESERVATION_RELEASE) khôi phục hoàn toàn tồn khả dụng', () => {
      const entries: LedgerEntry[] = [
        { type: 'IMPORT', quantityGrams: 100000 },             // Nhập 100 kg
        { type: 'RESERVATION_HOLD', quantityGrams: 30000 },    // Giữ 30 kg
        { type: 'RESERVATION_RELEASE', quantityGrams: 30000 }, // Hủy đơn nhả 30 kg
      ]
      const summary = calculateStockFromLedger(entries)

      expect(summary.physicalStockGrams).toBe(100000)
      expect(summary.reservedGrams).toBe(0)
      expect(summary.availableGrams).toBe(100000)
    })

    it('CHỨNG MINH TOÁN HỌC: DISPATCH_OUT không trừ hai lần khi xuất kho', () => {
      // Kịch bản: Nhập 100kg -> Giữ chỗ 30kg -> Xuất kho giao cho khách 30kg
      const entries: LedgerEntry[] = [
        { type: 'IMPORT', quantityGrams: 100000 },          // Nhập 100 kg
        { type: 'RESERVATION_HOLD', quantityGrams: 30000 }, // Giữ chỗ 30 kg (Available còn 70kg)
        { type: 'DISPATCH_OUT', quantityGrams: 30000 },     // Bàn giao xe xuất kho 30 kg
      ]
      const summary = calculateStockFromLedger(entries)

      // 1. Tồn vật lý giảm từ 100kg xuống 70kg vì hàng đã rời kho
      expect(summary.physicalStockGrams).toBe(70000)
      // 2. Lượng giữ chỗ về 0 vì hàng đã xuất xong, không còn ở trạng thái chờ
      expect(summary.reservedGrams).toBe(0)
      // 3. Tồn khả dụng giữ nguyên 70kg! (Không bị trừ lần thứ 2)
      expect(summary.availableGrams).toBe(70000)
      expect(summary.dispatchedGrams).toBe(30000)
    })

    it('ghi nhận hao hụt kho (SHRINKAGE_LOSS) làm giảm đồng thời tồn vật lý và khả dụng', () => {
      const entries: LedgerEntry[] = [
        { type: 'IMPORT', quantityGrams: 100000 },          // Nhập 100 kg
        { type: 'SHRINKAGE_LOSS', quantityGrams: 5000 },    // Hư hỏng 5 kg
      ]
      const summary = calculateStockFromLedger(entries)

      expect(summary.physicalStockGrams).toBe(95000)
      expect(summary.reservedGrams).toBe(0)
      expect(summary.availableGrams).toBe(95000)
      expect(summary.shrinkageGrams).toBe(5000)
    })

    it('xử lý vòng đời tổng hợp phức tạp chính xác', () => {
      const entries: LedgerEntry[] = [
        { type: 'IMPORT', quantityGrams: 500000 },          // Nhập 500 kg
        { type: 'RESERVATION_HOLD', quantityGrams: 100000 }, // Đơn 1 giữ 100 kg
        { type: 'DISPATCH_OUT', quantityGrams: 100000 },     // Đơn 1 xuất kho 100 kg
        { type: 'RESERVATION_HOLD', quantityGrams: 50000 },  // Đơn 2 giữ 50 kg
        { type: 'RESERVATION_RELEASE', quantityGrams: 10000},// Đơn 2 giảm bớt 10 kg
        { type: 'SHRINKAGE_LOSS', quantityGrams: 5000 },     // Hao hụt kho 5 kg
      ]
      const summary = calculateStockFromLedger(entries)

      // Physical = 500kg - 100kg (dispatch) - 5kg (loss) = 395 kg
      expect(summary.physicalStockGrams).toBe(395000)
      // Reserved = 50kg - 10kg = 40 kg
      expect(summary.reservedGrams).toBe(40000)
      // Available = 395kg - 40kg = 355 kg
      expect(summary.availableGrams).toBe(355000)
    })
  })

  // ==========================================================================
  // NHÓM 3: NGÀY KINH DOANH & KIỂM TRA HẠN DÙNG (VIETNAM TIMEZONE)
  // ==========================================================================
  describe('Chuẩn hóa Ngày & Hạn Dùng theo Múi Giờ Việt Nam', () => {
    it('chuẩn hóa chính xác ngày Date và String về định dạng YYYY-MM-DD', () => {
      expect(toVietnamCalendarDate('2026-10-23')).toBe('2026-10-23')
      expect(toVietnamCalendarDate(new Date('2026-10-23T00:00:00Z'))).toBe('2026-10-23')
      // 18:00 UTC ngày 23/10 là 01:00 sáng ngày 24/10 tại Việt Nam
      expect(toVietnamCalendarDate(new Date('2026-10-23T18:00:00Z'))).toBe('2026-10-24')
    })

    it('lô hàng hết hạn đúng hôm nay vẫn được phép bán (chưa hết hạn)', () => {
      // Hạn ngày 2026-10-23, ngày kiểm tra 2026-10-23 => Vẫn hợp lệ
      expect(isBatchExpired('2026-10-23', '2026-10-23')).toBe(false)
    })

    it('lô hàng có hạn hôm qua bị coi là đã hết hạn vào hôm nay', () => {
      // Hạn ngày 2026-10-22, ngày kiểm tra 2026-10-23 => Đã hết hạn
      expect(isBatchExpired('2026-10-22', '2026-10-23')).toBe(true)
    })

    it('lô hàng chưa có hạn sử dụng (null/undefined) không bị coi là expired nhưng chưa verified', () => {
      expect(isBatchExpired(null, '2026-10-23')).toBe(false)
      expect(isBatchExpired(undefined, '2026-10-23')).toBe(false)
    })
  })

  // ==========================================================================
  // NHÓM 4: ĐÁNH GIÁ ĐIỀU KIỆN CẤP PHÁT LÔ HÀNG (BATCH ELIGIBILITY)
  // ==========================================================================
  describe('Đánh giá Điều kiện Lô Hàng (evaluateBatchEligibility)', () => {
    const baseBatch: BatchCandidate = {
      id: 'batch-01',
      code: 'LO-261023-001',
      productId: 'prod-durian',
      farmId: 'farm-01',
      harvestDate: '2026-10-20',
      expiryDate: '2026-11-05',
      status: 'ACTIVE',
      isFefoEligible: true,
      physicalStockGrams: 50000, // 50 kg
      reservedGrams: 10000,       // Giữ 10 kg -> Khả dụng 40 kg
    }

    it('chấp thuận lô hàng ACTIVE, có hạn dùng tương lai và đủ tồn', () => {
      const res = evaluateBatchEligibility(baseBatch, { referenceDate: '2026-10-23' })
      expect(res.eligible).toBe(true)
      expect(res.availableGrams).toBe(40000)
    })

    it('từ chối lô hàng chưa qua xác minh (UNVERIFIED) - chỉ dùng tra cứu QR', () => {
      const unverifiedBatch: BatchCandidate = {
        ...baseBatch,
        status: 'UNVERIFIED',
      }
      const res = evaluateBatchEligibility(unverifiedBatch)
      expect(res.eligible).toBe(false)
      expect(res.reason).toBe('BATCH_UNVERIFIED')
      expect(res.availableGrams).toBe(0)
    })

    it('từ chối lô hàng thiếu expiryDate (không tự suy luận từ harvestDate)', () => {
      const noExpiryBatch: BatchCandidate = {
        ...baseBatch,
        expiryDate: null,
      }
      const res = evaluateBatchEligibility(noExpiryBatch)
      expect(res.eligible).toBe(false)
      expect(res.reason).toBe('MISSING_EXPIRY_DATE')
    })

    it('từ chối lô hàng đã hết hạn sử dụng', () => {
      const expiredBatch: BatchCandidate = {
        ...baseBatch,
        expiryDate: '2026-10-22',
      }
      const res = evaluateBatchEligibility(expiredBatch, { referenceDate: '2026-10-23' })
      expect(res.eligible).toBe(false)
      expect(res.reason).toBe('BATCH_EXPIRED')
    })

    it('từ chối lô hàng đang bị phong tỏa chất lượng (LOCKED_QC)', () => {
      const lockedBatch: BatchCandidate = {
        ...baseBatch,
        status: 'LOCKED_QC',
      }
      const res = evaluateBatchEligibility(lockedBatch)
      expect(res.eligible).toBe(false)
      expect(res.reason).toBe('BATCH_LOCKED_QC')
    })

    it('từ chối lô hàng chưa bật cờ cấp phát FEFO (isFefoEligible = false)', () => {
      const nonFefoBatch: BatchCandidate = {
        ...baseBatch,
        isFefoEligible: false,
      }
      const res = evaluateBatchEligibility(nonFefoBatch)
      expect(res.eligible).toBe(false)
      expect(res.reason).toBe('NOT_FEFO_ELIGIBLE')
    })

    it('từ chối lô hàng có tồn khả dụng bằng 0 (đã bị giữ hết hoặc xuất hết)', () => {
      const zeroStockBatch: BatchCandidate = {
        ...baseBatch,
        physicalStockGrams: 50000,
        reservedGrams: 50000, // Đã bị giữ sạch
      }
      const res = evaluateBatchEligibility(zeroStockBatch)
      expect(res.eligible).toBe(false)
      expect(res.reason).toBe('NO_AVAILABLE_STOCK')
    })

    it('từ chối lô hàng không khớp targetProductId', () => {
      const res = evaluateBatchEligibility(baseBatch, { targetProductId: 'prod-mango' })
      expect(res.eligible).toBe(false)
      expect(res.reason).toBe('PRODUCT_MISMATCH')
    })
  })

  // ==========================================================================
  // NHÓM 5: SẮP XẾP LÔ THEO FEFO TẤT ĐỊNH (DETERMINISTIC SORTING)
  // ==========================================================================
  describe('Sắp xếp Lô FEFO Tất định (sortBatchesByFefo)', () => {
    it('sắp xếp ưu tiên hạn sử dụng gần nhất trước (expiryDate ASC)', () => {
      const b1: BatchCandidate = {
        id: 'b1',
        code: 'LO-001',
        productId: 'p1',
        harvestDate: '2026-10-10',
        expiryDate: '2026-11-10', // Hạn 10/11
        status: 'ACTIVE',
        isFefoEligible: true,
        physicalStockGrams: 10000,
        reservedGrams: 0,
      }
      const b2: BatchCandidate = {
        id: 'b2',
        code: 'LO-002',
        productId: 'p1',
        harvestDate: '2026-10-12',
        expiryDate: '2026-10-28', // Hạn 28/10 (Gần nhất)
        status: 'ACTIVE',
        isFefoEligible: true,
        physicalStockGrams: 10000,
        reservedGrams: 0,
      }
      const b3: BatchCandidate = {
        id: 'b3',
        code: 'LO-003',
        productId: 'p1',
        harvestDate: '2026-10-11',
        expiryDate: '2026-11-02', // Hạn 02/11
        status: 'ACTIVE',
        isFefoEligible: true,
        physicalStockGrams: 10000,
        reservedGrams: 0,
      }

      const sorted = sortBatchesByFefo([b1, b2, b3], '2026-10-23')
      expect(sorted.map((b) => b.id)).toEqual(['b2', 'b3', 'b1'])
    })

    it('cùng ngày hết hạn thì ưu tiên lô thu hoạch sớm hơn (harvestDate ASC)', () => {
      const b1: BatchCandidate = {
        id: 'b1',
        code: 'LO-001',
        productId: 'p1',
        harvestDate: '2026-10-18', // Thu hoạch sau
        expiryDate: '2026-11-05',
        status: 'ACTIVE',
        isFefoEligible: true,
        physicalStockGrams: 10000,
        reservedGrams: 0,
      }
      const b2: BatchCandidate = {
        id: 'b2',
        code: 'LO-002',
        productId: 'p1',
        harvestDate: '2026-10-15', // Thu hoạch trước
        expiryDate: '2026-11-05',
        status: 'ACTIVE',
        isFefoEligible: true,
        physicalStockGrams: 10000,
        reservedGrams: 0,
      }

      const sorted = sortBatchesByFefo([b1, b2], '2026-10-23')
      expect(sorted.map((b) => b.id)).toEqual(['b2', 'b1'])
    })

    it('cùng ngày hết hạn và thu hoạch thì sắp xếp theo mã lô alphabet (code ASC)', () => {
      const b1: BatchCandidate = {
        id: 'b1',
        code: 'LO-B',
        productId: 'p1',
        harvestDate: '2026-10-15',
        expiryDate: '2026-11-05',
        status: 'ACTIVE',
        isFefoEligible: true,
        physicalStockGrams: 10000,
        reservedGrams: 0,
      }
      const b2: BatchCandidate = {
        id: 'b2',
        code: 'LO-A',
        productId: 'p1',
        harvestDate: '2026-10-15',
        expiryDate: '2026-11-05',
        status: 'ACTIVE',
        isFefoEligible: true,
        physicalStockGrams: 10000,
        reservedGrams: 0,
      }

      const sorted = sortBatchesByFefo([b1, b2], '2026-10-23')
      expect(sorted.map((b) => b.code)).toEqual(['LO-A', 'LO-B'])
    })

    it('hàm thuần: không làm đột biến hay thay đổi thứ tự mảng gốc', () => {
      const original = [
        {
          id: 'b1',
          code: 'LO-B',
          productId: 'p1',
          harvestDate: '2026-10-15',
          expiryDate: '2026-11-05',
          status: 'ACTIVE' as const,
          isFefoEligible: true,
          physicalStockGrams: 10000,
          reservedGrams: 0,
        },
        {
          id: 'b2',
          code: 'LO-A',
          productId: 'p1',
          harvestDate: '2026-10-15',
          expiryDate: '2026-11-05',
          status: 'ACTIVE' as const,
          isFefoEligible: true,
          physicalStockGrams: 10000,
          reservedGrams: 0,
        },
      ]
      sortBatchesByFefo(original)
      expect(original[0].code).toBe('LO-B')
      expect(original[1].code).toBe('LO-A')
    })
  })

  // ==========================================================================
  // NHÓM 6: THUẬT TOÁN PHÂN BỔ FEFO (allocateBatchesFefo)
  // ==========================================================================
  describe('Phân bổ Lô FEFO (allocateBatchesFefo)', () => {
    it('trường hợp một lô duy nhất đủ hàng', () => {
      const batches: BatchCandidate[] = [
        {
          id: 'batch-01',
          code: 'LO-01',
          productId: 'p1',
          harvestDate: '2026-10-15',
          expiryDate: '2026-11-01',
          status: 'ACTIVE',
          isFefoEligible: true,
          physicalStockGrams: 100000, // 100 kg
          reservedGrams: 20000,       // 20 kg -> Khả dụng 80 kg
        },
      ]

      const result = allocateBatchesFefo({
        batches,
        requestedGrams: 30000, // Đặt 30 kg
        referenceDate: '2026-10-23',
      })

      expect(result.success).toBe(true)
      expect(result.isFullyAllocated).toBe(true)
      expect(result.allocatedGrams).toBe(30000)
      expect(result.shortageGrams).toBe(0)
      expect(result.allocations).toHaveLength(1)
      expect(result.allocations[0]).toEqual({
        batchId: 'batch-01',
        batchCode: 'LO-01',
        allocatedGrams: 30000,
        expiryDate: '2026-11-01',
        harvestDate: '2026-10-15',
      })
    })

    it('trường hợp phân bổ qua nhiều lô theo thứ tự hạn dùng gần nhất', () => {
      const batches: BatchCandidate[] = [
        {
          id: 'batch-late',
          code: 'LO-LATE',
          productId: 'p1',
          harvestDate: '2026-10-15',
          expiryDate: '2026-11-10', // Hạn xa
          status: 'ACTIVE',
          isFefoEligible: true,
          physicalStockGrams: 60000, // 60 kg
          reservedGrams: 0,
        },
        {
          id: 'batch-early',
          code: 'LO-EARLY',
          productId: 'p1',
          harvestDate: '2026-10-12',
          expiryDate: '2026-10-30', // Hạn gần (ưu tiên bốc trước)
          status: 'ACTIVE',
          isFefoEligible: true,
          physicalStockGrams: 40000, // 40 kg
          reservedGrams: 0,
        },
      ]

      // Yêu cầu 70 kg -> Bốc hết 40kg lô sớm, bốc 30kg lô muộn
      const result = allocateBatchesFefo({
        batches,
        requestedGrams: 70000,
        referenceDate: '2026-10-23',
      })

      expect(result.success).toBe(true)
      expect(result.isFullyAllocated).toBe(true)
      expect(result.allocatedGrams).toBe(70000)
      expect(result.shortageGrams).toBe(0)
      expect(result.allocations).toHaveLength(2)

      expect(result.allocations[0].batchId).toBe('batch-early')
      expect(result.allocations[0].allocatedGrams).toBe(40000)

      expect(result.allocations[1].batchId).toBe('batch-late')
      expect(result.allocations[1].allocatedGrams).toBe(30000)
    })

    it('trường hợp tổng hàng không đủ: thông báo thiếu hàng và trả về phần cấp phát được', () => {
      const batches: BatchCandidate[] = [
        {
          id: 'batch-01',
          code: 'LO-01',
          productId: 'p1',
          harvestDate: '2026-10-15',
          expiryDate: '2026-11-01',
          status: 'ACTIVE',
          isFefoEligible: true,
          physicalStockGrams: 50000, // 50 kg khả dụng
          reservedGrams: 0,
        },
      ]

      // Yêu cầu 80 kg, chỉ có 50 kg
      const result = allocateBatchesFefo({
        batches,
        requestedGrams: 80000,
        referenceDate: '2026-10-23',
      })

      expect(result.success).toBe(false)
      expect(result.isFullyAllocated).toBe(false)
      expect(result.allocatedGrams).toBe(50000)
      expect(result.shortageGrams).toBe(30000) // Thiếu 30 kg
      expect(result.error).toContain('yêu cầu: 80 kg, chỉ cấp phát được: 50 kg, còn thiếu: 30 kg')
    })

    it('tuyệt đối không sử dụng lô không hợp lệ (hết hạn, khóa QC, chưa verified) dù có số lượng rất lớn', () => {
      const batches: BatchCandidate[] = [
        {
          id: 'batch-expired',
          code: 'LO-EXPIRED',
          productId: 'p1',
          harvestDate: '2026-09-01',
          expiryDate: '2026-10-10', // Đã hết hạn
          status: 'ACTIVE',
          isFefoEligible: true,
          physicalStockGrams: 10000000, // 10 tấn hàng hỏng
          reservedGrams: 0,
        },
        {
          id: 'batch-unverified',
          code: 'LO-UNVERIFIED',
          productId: 'p1',
          harvestDate: '2026-10-20',
          expiryDate: null, // Chưa xác minh
          status: 'UNVERIFIED',
          isFefoEligible: false,
          physicalStockGrams: 5000000, // 5 tấn chưa kiểm định
          reservedGrams: 0,
        },
        {
          id: 'batch-locked',
          code: 'LO-LOCKED',
          productId: 'p1',
          harvestDate: '2026-10-20',
          expiryDate: '2026-11-20',
          status: 'LOCKED_QC', // Đang phong tỏa
          isFefoEligible: true,
          physicalStockGrams: 3000000, // 3 tấn phong tỏa
          reservedGrams: 0,
        },
        {
          id: 'batch-valid',
          code: 'LO-VALID',
          productId: 'p1',
          harvestDate: '2026-10-20',
          expiryDate: '2026-11-20',
          status: 'ACTIVE',
          isFefoEligible: true,
          physicalStockGrams: 20000, // Chỉ có 20 kg hợp lệ
          reservedGrams: 0,
        },
      ]

      // Đặt 50 kg
      const result = allocateBatchesFefo({
        batches,
        requestedGrams: 50000,
        referenceDate: '2026-10-23',
      })

      // Chỉ cấp được đúng 20 kg từ lô hợp lệ duy nhất, tuyệt đối không đụng vào 18 tấn hàng không hợp lệ
      expect(result.success).toBe(false)
      expect(result.allocatedGrams).toBe(20000)
      expect(result.shortageGrams).toBe(30000)
      expect(result.allocations).toHaveLength(1)
      expect(result.allocations[0].batchId).toBe('batch-valid')
      expect(result.eligibleBatchesCount).toBe(1)
      expect(result.consideredBatchesCount).toBe(4)
    })

    it('xử lý dữ liệu đầu vào bất hợp lệ (số âm, float, NaN, <= 0)', () => {
      const batches: BatchCandidate[] = [
        {
          id: 'b1',
          code: 'LO-1',
          productId: 'p1',
          harvestDate: '2026-10-20',
          expiryDate: '2026-11-20',
          status: 'ACTIVE',
          isFefoEligible: true,
          physicalStockGrams: 50000,
          reservedGrams: 0,
        },
      ]

      // Số âm
      const resNegative = allocateBatchesFefo({ batches, requestedGrams: -500 })
      expect(resNegative.success).toBe(false)
      expect(resNegative.error).toContain('phải là số nguyên gram dương')

      // Số 0
      const resZero = allocateBatchesFefo({ batches, requestedGrams: 0 })
      expect(resZero.success).toBe(false)

      // Số thực float
      const resFloat = allocateBatchesFefo({ batches, requestedGrams: 100.5 })
      expect(resFloat.success).toBe(false)
      expect(resFloat.error).toContain('phải là số nguyên gram dương')

      // NaN
      const resNaN = allocateBatchesFefo({ batches, requestedGrams: NaN })
      expect(resNaN.success).toBe(false)
    })

    it('tính bất biến: không làm thay đổi các thuộc tính của BatchCandidate', () => {
      const batch: BatchCandidate = {
        id: 'b1',
        code: 'LO-1',
        productId: 'p1',
        harvestDate: '2026-10-20',
        expiryDate: '2026-11-20',
        status: 'ACTIVE',
        isFefoEligible: true,
        physicalStockGrams: 50000,
        reservedGrams: 10000,
      }

      allocateBatchesFefo({
        batches: [batch],
        requestedGrams: 20000,
        referenceDate: '2026-10-23',
      })

      // Batch gốc giữ nguyên vẹn
      expect(batch.physicalStockGrams).toBe(50000)
      expect(batch.reservedGrams).toBe(10000)
    })
  })

  // ==========================================================================
  // NHÓM 7: TỔNG HỢP TỒN KHẢ DỤNG SẢN PHẨM (calculateAvailableStock)
  // ==========================================================================
  describe('Tổng hợp Tồn Khả Dụng Sản Phẩm (calculateAvailableStock)', () => {
    it('tổng hợp chính xác phân loại các lô và tính tổng tồn khả dụng', () => {
      const batches: BatchCandidate[] = [
        {
          id: 'b1',
          code: 'LO-1',
          productId: 'prod-durian',
          harvestDate: '2026-10-20',
          expiryDate: '2026-11-20',
          status: 'ACTIVE',
          isFefoEligible: true,
          physicalStockGrams: 50000,
          reservedGrams: 10000, // Khả dụng 40 kg
        },
        {
          id: 'b2',
          code: 'LO-2',
          productId: 'prod-durian',
          harvestDate: '2026-10-20',
          expiryDate: '2026-11-25',
          status: 'ACTIVE',
          isFefoEligible: true,
          physicalStockGrams: 60000,
          reservedGrams: 0, // Khả dụng 60 kg
        },
        {
          id: 'b3',
          code: 'LO-3',
          productId: 'prod-durian',
          harvestDate: '2026-09-01',
          expiryDate: '2026-10-10', // Hết hạn
          status: 'ACTIVE',
          isFefoEligible: true,
          physicalStockGrams: 30000,
          reservedGrams: 0,
        },
        {
          id: 'b4',
          code: 'LO-4',
          productId: 'prod-durian',
          harvestDate: '2026-10-20',
          expiryDate: null, // Chưa xác minh
          status: 'UNVERIFIED',
          isFefoEligible: false,
          physicalStockGrams: 100000,
          reservedGrams: 0,
        },
        {
          id: 'b5',
          code: 'LO-5',
          productId: 'prod-mango', // Khác sản phẩm
          harvestDate: '2026-10-20',
          expiryDate: '2026-11-20',
          status: 'ACTIVE',
          isFefoEligible: true,
          physicalStockGrams: 80000,
          reservedGrams: 0,
        },
      ]

      const summary = calculateAvailableStock(batches, {
        targetProductId: 'prod-durian',
        referenceDate: '2026-10-23',
      })

      // 40kg + 60kg = 100kg khả dụng
      expect(summary.totalAvailableGrams).toBe(100000)
      expect(summary.eligibleBatchesCount).toBe(2)
      expect(summary.expiredBatchesCount).toBe(1)
      expect(summary.unverifiedBatchesCount).toBe(1)
      // Tổng tồn vật lý các lô sầu riêng = 50 + 60 + 30 + 100 = 240 kg
      expect(summary.totalPhysicalStockGrams).toBe(240000)
      expect(summary.totalReservedGrams).toBe(10000)
    })
  })
})
