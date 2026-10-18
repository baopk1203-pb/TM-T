import { describe, it, expect } from 'vitest'
import {
  computeDepositAmount,
  derivePaymentStatus,
  computeCancellation,
  computeWeightSettlement,
  computeComplaintCompensation,
  computePayableAmount,
} from '@/lib/domain/settlement'
import { TxType, TxStatus, OrderStatus, CancelActor, PaymentOption } from '@prisma/client'

describe('Domain: settlement.ts (Mục 3.6, 3.8, 3.9 & Test Cases S1-S5, W1-W3, C1-C3)', () => {
  describe('computeDepositAmount', () => {
    it('Test Case S1: total 15.277.500 -> deposit 4.584.000 (làm tròn lên nghìn)', () => {
      expect(computeDepositAmount(15277500)).toBe(4584000)
    })

    it('total chẵn: 4.000.000 -> deposit 1.200.000', () => {
      expect(computeDepositAmount(4000000)).toBe(1200000)
    })

    it('total lẻ: 1.234.567 -> deposit 371.000', () => {
      expect(computeDepositAmount(1234567)).toBe(371000)
    })
  })

  describe('derivePaymentStatus', () => {
    const order = {
      total: 15277500,
      status: OrderStatus.PENDING_CONFIRMATION,
    }

    it('chưa có giao dịch -> AWAITING_PAYMENT', () => {
      const result = derivePaymentStatus(order, [])
      expect(result.status).toBe('AWAITING_PAYMENT')
      expect(result.paidAmount).toBe(0)
      expect(result.remainingAmount).toBe(15277500)
    })

    it('đã cọc 4.584.000đ -> DEPOSIT_PAID', () => {
      const result = derivePaymentStatus(order, [
        { type: TxType.PAYMENT, status: TxStatus.DONE, amount: 4584000 },
      ])
      expect(result.status).toBe('DEPOSIT_PAID')
      expect(result.paidAmount).toBe(4584000)
      expect(result.remainingAmount).toBe(15277500 - 4584000)
    })

    it('đã thanh toán 100% -> PAID', () => {
      const result = derivePaymentStatus(order, [
        { type: TxType.PAYMENT, status: TxStatus.DONE, amount: 15277500 },
      ])
      expect(result.status).toBe('PAID')
      expect(result.remainingAmount).toBe(0)
    })

    it('có giao dịch hoàn tiền PENDING -> REFUND_PENDING', () => {
      const result = derivePaymentStatus(order, [
        { type: TxType.PAYMENT, status: TxStatus.DONE, amount: 15277500 },
        { type: TxType.REFUND, status: TxStatus.PENDING, amount: 327375 },
      ])
      expect(result.status).toBe('REFUND_PENDING')
    })

    it('đã hoàn 100% tiền -> REFUNDED', () => {
      const result = derivePaymentStatus(order, [
        { type: TxType.PAYMENT, status: TxStatus.DONE, amount: 4584000 },
        { type: TxType.REFUND, status: TxStatus.DONE, amount: 4584000 },
      ])
      expect(result.status).toBe('REFUNDED')
      expect(result.paidAmount).toBe(0)
    })

    it('Test Case C1: Khách trả đủ 14.950.125, hoàn bồi thường khiếu nại 278.996 (DONE) -> PARTIALLY_REFUNDED, nợ còn lại = 0 (không nợ giả)', () => {
      const deliveredOrder = {
        total: 15277500,
        finalTotal: 14950125,
        status: OrderStatus.COMPLAINT,
      }
      const result = derivePaymentStatus(deliveredOrder, [
        { type: TxType.PAYMENT, status: TxStatus.DONE, amount: 14950125 },
        { type: TxType.REFUND, status: TxStatus.DONE, amount: 278996 },
      ])
      expect(result.status).toBe('PARTIALLY_REFUNDED')
      expect(result.grossPaid).toBe(14950125)
      expect(result.refundedAmount).toBe(278996)
      expect(result.netPaid).toBe(14671129)
      expect(result.paidAmount).toBe(14671129)
      expect(result.remainingAmount).toBe(0) // Khách không phát sinh nợ giả sau bồi thường!
      expect(result.isSettled).toBe(true)
    })

    it('Đơn có hoàn tiền bồi thường PENDING -> REFUND_PENDING, isSettled = false', () => {
      const deliveredOrder = {
        total: 15277500,
        finalTotal: 14950125,
        status: OrderStatus.COMPLAINT,
      }
      const result = derivePaymentStatus(deliveredOrder, [
        { type: TxType.PAYMENT, status: TxStatus.DONE, amount: 14950125 },
        { type: TxType.REFUND, status: TxStatus.PENDING, amount: 278996 },
      ])
      expect(result.status).toBe('REFUND_PENDING')
      expect(result.hasPendingRefund).toBe(true)
      expect(result.isSettled).toBe(false)
    })
  })

  describe('computeCancellation (Mục 7.2 - S2 đến S5)', () => {
    const processingOrder = {
      status: OrderStatus.PROCESSING,
      depositAmount: 4584000,
    }

    it('Test Case S2: FULL đã trả 15.277.500, khách hủy ở PROCESSING -> forfeit 4.584.000, hoàn 10.693.500', () => {
      const result = computeCancellation(
        processingOrder,
        15277500,
        CancelActor.CUSTOMER
      )
      expect(result.forfeitAmount).toBe(4584000)
      expect(result.refundAmount).toBe(10693500)
      expect(result.isDepositForfeited).toBe(true)
    })

    it('Test Case S2 (Legacy FULL order): Đơn cũ lưu nhầm depositAmount = 15.277.500 -> tự động bảo vệ chỉ phạt cọc 30%', () => {
      const legacyOrder = {
        status: OrderStatus.PROCESSING,
        depositAmount: 15277500, // lưu nhầm bằng 100% total
        total: 15277500,
        paymentOption: 'FULL',
      }
      const result = computeCancellation(
        legacyOrder,
        15277500,
        CancelActor.CUSTOMER
      )
      expect(result.forfeitAmount).toBe(4584000) // 30% cọc chuẩn
      expect(result.refundAmount).toBe(10693500) // Hoàn 70%
      expect(result.isDepositForfeited).toBe(true)
    })

    it('Test Case S3: DEPOSIT_30 đã trả 4.584.000, khách hủy ở PROCESSING -> hoàn 0 (mất cọc)', () => {
      const result = computeCancellation(
        processingOrder,
        4584000,
        CancelActor.CUSTOMER
      )
      expect(result.forfeitAmount).toBe(4584000)
      expect(result.refundAmount).toBe(0)
      expect(result.isDepositForfeited).toBe(true)
    })

    it('Test Case S4: Đã trả bất kỳ (15.277.500), bên bán hủy (SELLER) -> hoàn 100%', () => {
      const result = computeCancellation(
        processingOrder,
        15277500,
        CancelActor.SELLER
      )
      expect(result.forfeitAmount).toBe(0)
      expect(result.refundAmount).toBe(15277500)
      expect(result.isDepositForfeited).toBe(false)
    })

    it('Test Case S5: Khách hủy ở PENDING_CONFIRMATION -> hoàn 100%', () => {
      const pendingOrder = {
        status: OrderStatus.PENDING_CONFIRMATION,
        depositAmount: 4584000,
      }
      const result = computeCancellation(
        pendingOrder,
        4584000,
        CancelActor.CUSTOMER
      )
      expect(result.forfeitAmount).toBe(0)
      expect(result.refundAmount).toBe(4584000)
      expect(result.isDepositForfeited).toBe(false)
    })
  })

  describe('computeWeightSettlement (Mục 7.3 - W1 đến W3)', () => {
    it('Test Case W1: Đặt 210kg (72.750/kg), cọc 4.584.000, thực giao 205,5kg -> finalTotal 14.950.125, còn phải thu 10.366.125', () => {
      const result = computeWeightSettlement({
        lines: [
          {
            id: 'line-1',
            orderedGrams: 210000,
            actualGrams: 205500,
            unitPricePerKg: 72750,
          },
        ],
        shippingFee: 0,
        paid: 4584000,
      })

      expect(result.finalSubtotal).toBe(14950125)
      expect(result.finalTotal).toBe(14950125)
      expect(result.customerToPay).toBe(10366125)
      expect(result.refundAmount).toBe(0)
      expect(result.balance).toBe(10366125)
    })

    it('Test Case W2: Như W1 nhưng đã trả FULL 15.277.500 -> hoàn 327.375', () => {
      const result = computeWeightSettlement({
        lines: [
          {
            id: 'line-1',
            orderedGrams: 210000,
            actualGrams: 205500,
            unitPricePerKg: 72750,
          },
        ],
        shippingFee: 0,
        paid: 15277500,
      })

      expect(result.finalTotal).toBe(14950125)
      expect(result.customerToPay).toBe(0)
      expect(result.refundAmount).toBe(327375)
      expect(result.balance).toBe(-327375)
    })

    it('Test Case W3: actualGrams = 221.000 (> 105% của 210.000 = 220.500) -> lỗi', () => {
      expect(() =>
        computeWeightSettlement({
          lines: [
            {
              id: 'line-1',
              orderedGrams: 210000,
              actualGrams: 221000,
              unitPricePerKg: 72750,
            },
          ],
          shippingFee: 0,
          paid: 4584000,
        })
      ).toThrow('vượt quá 105%')
    })

    it('Đơn hàng có gói mẫu giữ nguyên giá mẫu', () => {
      const result = computeWeightSettlement({
        lines: [
          {
            id: 'line-regular',
            orderedGrams: 50000,
            actualGrams: 50000,
            unitPricePerKg: 80000,
          },
          {
            id: 'line-sample',
            orderedGrams: 2000,
            actualGrams: 2000,
            unitPricePerKg: 80000,
            isSample: true,
            lineTotal: 200000,
          },
        ],
        shippingFee: 0,
        paid: 4200000,
      })

      expect(result.finalSubtotal).toBe(4200000)
      expect(result.customerToPay).toBe(0)
    })
  })

  describe('computeComplaintCompensation (Mục 7.4 - C1 đến C3)', () => {
    it('Test Case C1: actual 205.500g, hư 10.000g, 72.750/kg -> allowed 6.165g, excess 3.835g, bồi hoàn 278.996', () => {
      const result = computeComplaintCompensation({
        actualGrams: 205500,
        damagedGrams: 10000,
        unitPricePerKg: 72750,
      })

      expect(result.allowedGrams).toBe(6165)
      expect(result.excessGrams).toBe(3835)
      expect(result.compensation).toBe(278996)
      expect(result.isExpired).toBe(false)
    })

    it('Test Case C2: hư 5.000g -> excess 0, bồi hoàn 0', () => {
      const result = computeComplaintCompensation({
        actualGrams: 205500,
        damagedGrams: 5000,
        unitPricePerKg: 72750,
      })

      expect(result.allowedGrams).toBe(6165)
      expect(result.excessGrams).toBe(0)
      expect(result.compensation).toBe(0)
    })

    it('Test Case C3: khiếu nại sau 24h kể từ deliveredAt -> bị từ chối', () => {
      const deliveredAt = new Date('2026-10-10T08:00:00Z')
      const submittedAt = new Date('2026-10-11T09:00:00Z') // 25h sau

      expect(() =>
        computeComplaintCompensation({
          actualGrams: 205500,
          damagedGrams: 10000,
          unitPricePerKg: 72750,
          deliveredAt,
          submittedAt,
        })
      ).toThrow('quá thời hạn khiếu nại 24h')
    })
  })

  describe('computePayableAmount (Xác định số tiền thanh toán thực tế & chống chuyển trùng)', () => {
    const fullOrder = {
      status: OrderStatus.PENDING_CONFIRMATION,
      paymentOption: PaymentOption.FULL,
      total: 10000000,
      depositAmount: 3000000,
    }

    const depositOrder = {
      status: OrderStatus.PENDING_CONFIRMATION,
      paymentOption: PaymentOption.DEPOSIT_30,
      total: 10000000,
      depositAmount: 3000000,
    }

    it('1. Đơn FULL chưa thanh toán -> yêu cầu 100% (total)', () => {
      const res = computePayableAmount(fullOrder, [])
      expect(res.isPayable).toBe(true)
      expect(res.amountToPay).toBe(10000000)
      expect(res.grossPaid).toBe(0)
    })

    it('2. Đơn FULL đã ghi nhận 30% nhưng vẫn PENDING_CONFIRMATION -> chỉ yêu cầu 70% còn lại', () => {
      const res = computePayableAmount(fullOrder, [
        { type: TxType.PAYMENT, status: TxStatus.DONE, amount: 3000000 },
      ])
      expect(res.isPayable).toBe(true)
      expect(res.amountToPay).toBe(7000000)
      expect(res.grossPaid).toBe(3000000)
    })

    it('3. Đơn FULL đã thanh toán đủ 100% -> isPayable = false, không phát sinh QR chuyển trùng', () => {
      const res = computePayableAmount(fullOrder, [
        { type: TxType.PAYMENT, status: TxStatus.DONE, amount: 10000000 },
      ])
      expect(res.isPayable).toBe(false)
      expect(res.amountToPay).toBe(0)
      expect(res.reason).toContain('đã thanh toán đủ khoản cần xác nhận')
    })

    it('4. Đơn DEPOSIT_30 chưa thanh toán -> yêu cầu đúng depositAmount (30%)', () => {
      const res = computePayableAmount(depositOrder, [])
      expect(res.isPayable).toBe(true)
      expect(res.amountToPay).toBe(3000000)
      expect(res.grossPaid).toBe(0)
    })

    it('5. Đơn DEPOSIT_30 đã trả một phần cọc -> chỉ yêu cầu số tiền cọc còn thiếu', () => {
      const res = computePayableAmount(depositOrder, [
        { type: TxType.PAYMENT, status: TxStatus.DONE, amount: 1000000 },
      ])
      expect(res.isPayable).toBe(true)
      expect(res.amountToPay).toBe(2000000)
      expect(res.grossPaid).toBe(1000000)
    })

    it('6. Đơn DEPOSIT_30 đã cọc đủ 30% -> isPayable = false khi ở PENDING_CONFIRMATION', () => {
      const res = computePayableAmount(depositOrder, [
        { type: TxType.PAYMENT, status: TxStatus.DONE, amount: 3000000 },
      ])
      expect(res.isPayable).toBe(false)
      expect(res.amountToPay).toBe(0)
    })

    it('7. Đơn DEPOSIT_30 khi chuyển sang PROCESSING -> yêu cầu phần nợ còn lại (70%)', () => {
      const processingOrder = {
        ...depositOrder,
        status: OrderStatus.PROCESSING,
      }
      const res = computePayableAmount(processingOrder, [
        { type: TxType.PAYMENT, status: TxStatus.DONE, amount: 3000000 },
      ])
      expect(res.isPayable).toBe(true)
      expect(res.amountToPay).toBe(7000000)
    })

    it('8. Đơn đã CANCELLED -> isPayable = false, từ chối tạo thanh toán', () => {
      const cancelledOrder = {
        ...fullOrder,
        status: OrderStatus.CANCELLED,
      }
      const res = computePayableAmount(cancelledOrder, [])
      expect(res.isPayable).toBe(false)
      expect(res.amountToPay).toBe(0)
      expect(res.reason).toContain('CANCELLED')
    })

    it('9. Đơn đã COMPLETED -> isPayable = false, từ chối tạo thanh toán', () => {
      const completedOrder = {
        ...fullOrder,
        status: OrderStatus.COMPLETED,
      }
      const res = computePayableAmount(completedOrder, [])
      expect(res.isPayable).toBe(false)
      expect(res.amountToPay).toBe(0)
      expect(res.reason).toContain('COMPLETED')
    })

    it('10. Bỏ qua các giao dịch PAYMENT thất bại hoặc PENDING', () => {
      const res = computePayableAmount(fullOrder, [
        { type: TxType.PAYMENT, status: TxStatus.PENDING, amount: 5000000 },
        { type: TxType.REFUND, status: TxStatus.DONE, amount: 1000000 },
      ])
      // Chỉ tính PAYMENT có status: DONE
      expect(res.isPayable).toBe(true)
      expect(res.amountToPay).toBe(10000000)
      expect(res.grossPaid).toBe(0)
    })
  })
})
