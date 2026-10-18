import { describe, it, expect } from 'vitest'
import {
  checkPriceBand,
  computePreorderShortfallRefund,
  calculatePreorderPricing,
  computeOutOfBandCancellationRefund,
  formatPackagingLabel,
  formatAddressLabel,
} from '@/lib/domain/preorder'
import { canTransition } from '@/lib/domain/order-state'
import { computeCancellation } from '@/lib/domain/settlement'
import { OrderStatus, PaymentOption, CancelActor } from '@prisma/client'

describe('Pre-order Domain Logic (Batch 6B - Mục 3.10)', () => {
  describe('1. checkPriceBand - Kiểm tra biên độ giá chốt vụ', () => {
    it('R1: Đơn giá tăng từ 70k lên 76k với biên độ 10% -> Trong biên độ (8.57%)', () => {
      const result = checkPriceBand(70000, 76000, 10)
      expect(result.inBand).toBe(true)
      expect(result.diffPercent).toBe(8.57)
      expect(result.minAllowed).toBe(63000)
      expect(result.maxAllowed).toBe(77000)
    })

    it('R2: Đơn giá tăng từ 70k lên 78k với biên độ 10% -> Ngoài biên độ (11.43%)', () => {
      const result = checkPriceBand(70000, 78000, 10)
      expect(result.inBand).toBe(false)
      expect(result.diffPercent).toBe(11.43)
      expect(result.minAllowed).toBe(63000)
      expect(result.maxAllowed).toBe(77000)
    })

    it('Biên trên chính xác 10%: 70k lên 77k -> Trong biên độ (10.0%)', () => {
      const result = checkPriceBand(70000, 77000, 10)
      expect(result.inBand).toBe(true)
      expect(result.diffPercent).toBe(10)
    })

    it('Biên dưới chính xác 10%: 70k xuống 63k -> Trong biên độ (10.0%)', () => {
      const result = checkPriceBand(70000, 63000, 10)
      expect(result.inBand).toBe(true)
      expect(result.diffPercent).toBe(10)
    })

    it('Vượt biên dưới: 70k xuống 62k -> Ngoài biên độ (11.43%)', () => {
      const result = checkPriceBand(70000, 62000, 10)
      expect(result.inBand).toBe(false)
      expect(result.diffPercent).toBe(11.43)
    })

    it('Đơn giá không đổi: 70k -> 70k -> Trong biên độ (0%)', () => {
      const result = checkPriceBand(70000, 70000, 10)
      expect(result.inBand).toBe(true)
      expect(result.diffPercent).toBe(0)
    })

    it('Biên độ tùy chỉnh 15%: 70k lên 80k (chênh lệch 14.29%) -> Trong biên độ', () => {
      const result = checkPriceBand(70000, 80000, 15)
      expect(result.inBand).toBe(true)
      expect(result.diffPercent).toBe(14.29)
      expect(result.maxAllowed).toBe(80500)
    })

    it('Ném lỗi khi đơn giá đặt trước ban đầu <= 0', () => {
      expect(() => checkPriceBand(0, 50000, 10)).toThrow('Đơn giá đặt trước phải lớn hơn 0')
    })
  })

  describe('2. computePreorderShortfallRefund - Tính cọc hoàn do thiếu hụt sản lượng', () => {
    it('R3: Cọc 3.000.000 đ, đặt 100kg (100.000g), giao 60kg (60.000g) -> Hoàn 1.200.000 đ', () => {
      const refund = computePreorderShortfallRefund({
        depositAmount: 3000000,
        orderedGrams: 100000,
        fulfilledGrams: 60000,
      })
      expect(refund).toBe(1200000)
    })

    it('Mất mùa 100% (fulfilledGrams = 0) -> Hoàn 100% tiền cọc (3.000.000 đ)', () => {
      const refund = computePreorderShortfallRefund({
        depositAmount: 3000000,
        orderedGrams: 100000,
        fulfilledGrams: 0,
      })
      expect(refund).toBe(3000000)
    })

    it('Giao đủ sản lượng (fulfilledGrams >= orderedGrams) -> Không hoàn cọc (0 đ)', () => {
      const exactRefund = computePreorderShortfallRefund({
        depositAmount: 3000000,
        orderedGrams: 100000,
        fulfilledGrams: 100000,
      })
      expect(exactRefund).toBe(0)

      const surplusRefund = computePreorderShortfallRefund({
        depositAmount: 3000000,
        orderedGrams: 100000,
        fulfilledGrams: 120000,
      })
      expect(surplusRefund).toBe(0)
    })

    it('Đầu vào không hợp lệ (deposit <= 0 hoặc ordered <= 0) -> Trả về 0 đ', () => {
      expect(
        computePreorderShortfallRefund({
          depositAmount: 0,
          orderedGrams: 100000,
          fulfilledGrams: 50000,
        })
      ).toBe(0)
    })
  })

  describe('3. calculatePreorderPricing - Tính giá và tiền cọc 30%', () => {
    it('Tính đúng đơn giá, tổng tiền và tiền cọc 30% làm tròn lên nghìn đồng', () => {
      // 10 thùng x 10kg = 100kg. Giá 70.000 đ/kg -> Tổng 7.000.000 đ. Cọc 30% = 2.100.000 đ
      const result = calculatePreorderPricing({
        preorderPricePerKg: 70000,
        packagingWeightGrams: 10000,
        quantity: 10,
      })

      expect(result.discountedPricePerKg).toBe(70000)
      expect(result.totalGrams).toBe(100000)
      expect(result.lineTotal).toBe(7000000)
      expect(result.subtotal).toBe(7000000)
      expect(result.total).toBe(7000000)
      expect(result.depositAmount).toBe(2100000)
    })

    it('Áp dụng chiết khấu nhóm đối tác vào đơn giá đặt trước', () => {
      // Giá gốc 70.000 đ/kg, chiết khấu 10% -> 63.000 đ/kg
      // 10 thùng x 10kg = 100kg -> Tổng 6.300.000 đ. Cọc 30% = 1.890.000 đ
      const result = calculatePreorderPricing({
        preorderPricePerKg: 70000,
        groupDiscountPercent: 10,
        packagingWeightGrams: 10000,
        quantity: 10,
      })

      expect(result.discountedPricePerKg).toBe(63000)
      expect(result.lineTotal).toBe(6300000)
      expect(result.total).toBe(6300000)
      expect(result.depositAmount).toBe(1890000)
    })

    it('Làm tròn tiền cọc 30% lên hàng nghìn (computeDepositAmount)', () => {
      // 1 kiện 15kg x giá 75.000 đ/kg = 1.125.000 đ.
      // 30% = 337.500 đ -> làm tròn lên = 338.000 đ
      const result = calculatePreorderPricing({
        preorderPricePerKg: 75000,
        packagingWeightGrams: 15000,
        quantity: 1,
      })

      expect(result.lineTotal).toBe(1125000)
      expect(result.depositAmount).toBe(338000)
    })
  })

  describe('4. computeOutOfBandCancellationRefund - Ngăn ngừa hoàn trùng (Double Refund)', () => {
    it('Khách đã đóng cọc 3.000.000 đ, chưa hoàn khoản nào -> Hoàn 3.000.000 đ (100%)', () => {
      const refund = computeOutOfBandCancellationRefund({
        paidAmount: 3000000,
        shortfallRefundAmount: 0,
      })
      expect(refund).toBe(3000000)
    })

    it('Đã hoàn thiếu hụt 1.200.000 đ trước đó -> Hoàn phần còn lại 1.800.000 đ (Tổng = 3.000.000 đ)', () => {
      const refund = computeOutOfBandCancellationRefund({
        paidAmount: 3000000,
        shortfallRefundAmount: 1200000,
      })
      expect(refund).toBe(1800000)
    })

    it('Chưa thanh toán cọc (paidAmount = 0) -> Hoàn 0 đ', () => {
      const refund = computeOutOfBandCancellationRefund({
        paidAmount: 0,
        shortfallRefundAmount: 0,
      })
      expect(refund).toBe(0)
    })
  })

  describe('5. order-state.ts - Máy trạng thái cho đơn PREORDER', () => {
    const basePreorder = {
      status: OrderStatus.PENDING_CONFIRMATION,
      paymentOption: PaymentOption.DEPOSIT_30,
      total: 7000000,
      depositAmount: 2100000,
    }

    it('PENDING_CONFIRMATION -> PREORDER_WAITING: Cho phép SELLER khi đã nhận đủ cọc', () => {
      const check = canTransition(
        basePreorder,
        OrderStatus.PREORDER_WAITING,
        'SELLER',
        { paidAmount: 2100000 }
      )
      expect(check.ok).toBe(true)
    })

    it('PENDING_CONFIRMATION -> PREORDER_WAITING: Từ chối SELLER khi chưa đủ cọc', () => {
      const check = canTransition(
        basePreorder,
        OrderStatus.PREORDER_WAITING,
        'SELLER',
        { paidAmount: 1500000 }
      )
      expect(check.ok).toBe(false)
      expect(check.reason).toContain('Chưa nhận đủ tiền đặt cọc tối thiểu')
    })

    it('PENDING_CONFIRMATION -> PREORDER_WAITING: Từ chối CUSTOMER tự ý duyệt', () => {
      const check = canTransition(
        basePreorder,
        OrderStatus.PREORDER_WAITING,
        'CUSTOMER',
        { paidAmount: 2100000 }
      )
      expect(check.ok).toBe(false)
      expect(check.reason).toContain('Chỉ ban quản trị')
    })

    it('PREORDER_WAITING -> PROCESSING: Cho phép SELLER (khi vào vụ trong biên độ)', () => {
      const waitingOrder = { ...basePreorder, status: OrderStatus.PREORDER_WAITING }
      const check = canTransition(waitingOrder, OrderStatus.PROCESSING, 'SELLER')
      expect(check.ok).toBe(true)
    })

    it('PREORDER_WAITING -> PROCESSING: Cho phép CUSTOMER (khi chấp nhận đơn giá ngoài biên độ)', () => {
      const waitingOrder = { ...basePreorder, status: OrderStatus.PREORDER_WAITING }
      const check = canTransition(waitingOrder, OrderStatus.PROCESSING, 'CUSTOMER')
      expect(check.ok).toBe(true)
    })

    it('PREORDER_WAITING -> PROCESSING: Từ chối SYSTEM tự ý chuyển', () => {
      const waitingOrder = { ...basePreorder, status: OrderStatus.PREORDER_WAITING }
      const check = canTransition(waitingOrder, OrderStatus.PROCESSING, 'SYSTEM')
      expect(check.ok).toBe(false)
    })

    it('PREORDER_WAITING -> CANCELLED: Cho phép hủy', () => {
      const waitingOrder = { ...basePreorder, status: OrderStatus.PREORDER_WAITING }
      const check = canTransition(waitingOrder, OrderStatus.CANCELLED, 'CUSTOMER')
      expect(check.ok).toBe(true)
    })
  })

  describe('6. settlement.ts - Chính sách cọc khi hủy đơn PREORDER_WAITING', () => {
    const preorderWaiting = {
      status: OrderStatus.PREORDER_WAITING,
      depositAmount: 2100000,
      total: 7000000,
      paymentOption: PaymentOption.DEPOSIT_30,
    }

    it('Khách tự ý hủy đơn bình thường khi đang chờ vụ mùa -> Mất cọc 30%', () => {
      const impact = computeCancellation(preorderWaiting, 2100000, CancelActor.CUSTOMER)
      expect(impact.forfeitAmount).toBe(2100000)
      expect(impact.refundAmount).toBe(0)
      expect(impact.isDepositForfeited).toBe(true)
    })

    it('Khách hủy do từ chối giá ngoài biên độ (isOutOfBandRejection = true) -> Hoàn 100% cọc', () => {
      const impact = computeCancellation(preorderWaiting, 2100000, CancelActor.CUSTOMER, true)
      expect(impact.forfeitAmount).toBe(0)
      expect(impact.refundAmount).toBe(2100000)
      expect(impact.isDepositForfeited).toBe(false)
    })

    it('Bên bán (SELLER/ADMIN) hủy đơn khi đang chờ vụ mùa -> Hoàn 100% cọc', () => {
      const impact = computeCancellation(preorderWaiting, 2100000, CancelActor.SELLER)
      expect(impact.forfeitAmount).toBe(0)
      expect(impact.refundAmount).toBe(2100000)
      expect(impact.isDepositForfeited).toBe(false)
    })
  })

  describe('7. QW04-01: Định dạng nhãn dropdown Pre-order (Select human-readable labels)', () => {
    describe('formatPackagingLabel', () => {
      it('Định dạng nhãn quy cách đóng gói rõ ràng, dễ đọc kèm khối lượng', () => {
        const label20kg = formatPackagingLabel({
          name: 'Rổ nhựa 20kg',
          weightGrams: 20000,
        })
        expect(label20kg).toBe('Rổ nhựa 20kg (20 kg/thùng)')

        const label10kg = formatPackagingLabel({
          name: 'Thùng carton 10kg',
          weightGrams: 10000,
        })
        expect(label10kg).toBe('Thùng carton 10kg (10 kg/thùng)')
      })

      it('Xử lý an toàn khi quy cách null hoặc undefined', () => {
        expect(formatPackagingLabel(null)).toBe('')
        expect(formatPackagingLabel(undefined)).toBe('')
      })
    })

    describe('formatAddressLabel', () => {
      it('Định dạng nhãn địa chỉ đầy đủ có gắn nhãn kho (label)', () => {
        const label = formatAddressLabel({
          label: 'Kho Thủ Đức',
          recipient: 'Nguyễn Văn A',
          phone: '0901234567',
          line: '123 Đường Số 1',
          ward: 'Linh Chiểu',
          district: 'TP. Thủ Đức',
          province: 'TP. Hồ Chí Minh',
        })
        expect(label).toBe(
          '[Kho Thủ Đức] Nguyễn Văn A (0901234567) - 123 Đường Số 1, Linh Chiểu, TP. Thủ Đức, TP. Hồ Chí Minh'
        )
      })

      it('Định dạng nhãn địa chỉ khi không có trường label (hoặc rỗng)', () => {
        const label = formatAddressLabel({
          label: null,
          recipient: 'Trần Thị B',
          phone: '0987654321',
          line: '456 Lê Lợi',
          ward: 'Bến Nghé',
          district: 'Quận 1',
          province: 'TP. Hồ Chí Minh',
        })
        expect(label).toBe(
          'Trần Thị B (0987654321) - 456 Lê Lợi, Bến Nghé, Quận 1, TP. Hồ Chí Minh'
        )
      })

      it('Xử lý an toàn khi địa chỉ null hoặc undefined', () => {
        expect(formatAddressLabel(null)).toBe('')
        expect(formatAddressLabel(undefined)).toBe('')
      })
    })
  })
})
