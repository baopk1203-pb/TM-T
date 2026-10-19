import { describe, it, expect } from 'vitest'
import {
  computePayableAmount,
  derivePaymentStatus,
  computeDepositAmount,
  computeCancellation,
  isShortfallRefund,
  PaymentTransactionData,
} from '@/lib/domain/settlement'
import {
  computePreorderShortfallRefund,
  computeOutOfBandCancellationRefund,
} from '@/lib/domain/preorder'
import { canTransition } from '@/lib/domain/order-state'
import {
  OrderStatus,
  OrderType,
  PaymentOption,
  TxType,
  TxStatus,
  CancelActor,
} from '@prisma/client'

describe('DEV-TASK-20-FIX01 / PH8A-FIN-01: Regression Tests S1 - S8 for Pre-order Shortfall Settlement', () => {
  // S1: Pre-order hụt 40%, hoàn cọc đã hoàn tất (TxStatus.DONE)
  describe('S1 — Pre-order hụt 40%, hoàn cọc đã hoàn tất (TxStatus.DONE)', () => {
    // Đơn đặt trước 100kg @ 70.000đ/kg = 7.000.000đ + Phí ship 310.000đ = 7.310.000đ
    // Cọc 30% làm tròn = 2.193.000đ
    const total = 7310000
    const depositAmount = computeDepositAmount(total) // 2.193.000đ
    expect(depositAmount).toBe(2193000)

    // Thu hoạch giao 60kg @ 70k = 4.200.000đ + Phí ship 310.000đ = FinalTotal 4.510.000đ
    const finalTotal = 4200000 + 310000 // 4.510.000đ
    const shortfallRefund = computePreorderShortfallRefund({
      depositAmount,
      orderedGrams: 100000,
      fulfilledGrams: 60000,
    }) // 40% của 2.193.000đ = 877.200đ
    expect(shortfallRefund).toBe(877200)

    const order = {
      type: OrderType.PREORDER,
      status: OrderStatus.PROCESSING,
      paymentOption: PaymentOption.DEPOSIT_30,
      total,
      depositAmount,
      finalTotal,
    }

    const txs: PaymentTransactionData[] = [
      {
        type: TxType.PAYMENT,
        status: TxStatus.DONE,
        amount: depositAmount, // 2.193.000
      },
      {
        type: TxType.REFUND,
        status: TxStatus.DONE,
        amount: shortfallRefund, // 877.200
        reference: 'REFUND_SHORTFALL',
        note: 'Hoàn tiền cọc do sản lượng thu hoạch thiếu hụt (60kg / 100kg)',
      },
    ]

    it('tính chính xác số tiền còn lại phải thanh toán là 3.194.200đ (không bị tính thiếu 877.200đ)', () => {
      const payable = computePayableAmount(order, txs)
      expect(payable.isPayable).toBe(true)
      // 4.510.000 - (2.193.000 - 877.200) = 4.510.000 - 1.315.800 = 3.194.200đ
      expect(payable.amountToPay).toBe(3194200)
    })

    it('derivePaymentStatus trả về remainingAmount = 3.194.200đ và netPaid = 1.315.800đ', () => {
      const payment = derivePaymentStatus(order, txs)
      expect(payment.grossPaid).toBe(2193000)
      expect(payment.refundedAmount).toBe(877200)
      expect(payment.netPaid).toBe(1315800)
      expect(payment.remainingAmount).toBe(3194200)
      expect(payment.isSettled).toBe(false)
    })

    it('khi khách thanh toán tiếp 3.194.200đ, đơn hàng tất toán chính xác và doanh nghiệp thực nhận đủ 4.510.000đ', () => {
      const fullTxs: PaymentTransactionData[] = [
        ...txs,
        {
          type: TxType.PAYMENT,
          status: TxStatus.DONE,
          amount: 3194200,
        },
      ]

      const payable = computePayableAmount(order, fullTxs)
      expect(payable.isPayable).toBe(false)
      expect(payable.amountToPay).toBe(0)

      const payment = derivePaymentStatus(order, fullTxs)
      expect(payment.remainingAmount).toBe(0)
      expect(payment.netPaid).toBe(4510000) // Đúng bằng finalTotal!
      expect(payment.isSettled).toBe(true)

      // Kiểm tra chuyển COMPLETED theo máy trạng thái (từ DELIVERED sau 24h)
      const deliveredOrder = {
        ...order,
        status: OrderStatus.DELIVERED,
        deliveredAt: new Date(Date.now() - 25 * 3600 * 1000),
      }
      const transitionCheck = canTransition(
        deliveredOrder,
        OrderStatus.COMPLETED,
        'SELLER',
        {
          paidAmount: payment.paidAmount,
          grossPaid: payment.grossPaid,
          refundedAmount: payment.refundedAmount,
          hasPendingRefund: false,
        }
      )
      expect(transitionCheck.ok).toBe(true)
    })
  })

  // S2: Pre-order giao đủ 100% (không có shortfall)
  describe('S2 — Pre-order giao đủ 100%', () => {
    const total = 7310000
    const depositAmount = computeDepositAmount(total) // 2.193.000đ
    const finalTotal = 7310000 // Giao đủ 100kg

    const order = {
      type: OrderType.PREORDER,
      status: OrderStatus.PROCESSING,
      paymentOption: PaymentOption.DEPOSIT_30,
      total,
      depositAmount,
      finalTotal,
    }

    const txs: PaymentTransactionData[] = [
      {
        type: TxType.PAYMENT,
        status: TxStatus.DONE,
        amount: depositAmount,
      },
    ]

    it('yêu cầu thanh toán đúng phần còn lại và không tính phí ship hai lần', () => {
      const payable = computePayableAmount(order, txs)
      expect(payable.isPayable).toBe(true)
      // 7.310.000 - 2.193.000 = 5.117.000đ
      expect(payable.amountToPay).toBe(5117000)

      const payment = derivePaymentStatus(order, txs)
      expect(payment.remainingAmount).toBe(5117000)
      expect(payment.isSettled).toBe(false)
    })
  })

  // S3: Pre-order hụt 100% (mất mùa)
  describe('S3 — Pre-order hụt 100%', () => {
    const total = 7310000
    const depositAmount = computeDepositAmount(total)

    const order = {
      type: OrderType.PREORDER,
      status: OrderStatus.CANCELLED,
      paymentOption: PaymentOption.DEPOSIT_30,
      total,
      depositAmount,
      finalTotal: null,
    }

    const txs: PaymentTransactionData[] = [
      {
        type: TxType.PAYMENT,
        status: TxStatus.DONE,
        amount: depositAmount,
      },
      {
        type: TxType.REFUND,
        status: TxStatus.PENDING,
        amount: depositAmount,
        note: 'Hoàn trả 100% tiền cọc do vườn mất mùa 100%',
      },
    ]

    it('không tạo khoản thanh toán còn lại cho đơn hàng đã hủy', () => {
      const payable = computePayableAmount(order, txs)
      expect(payable.isPayable).toBe(false)
      expect(payable.amountToPay).toBe(0)
    })
  })

  // S4: Refund đang PENDING
  describe('S4 — Refund đang PENDING', () => {
    const total = 7310000
    const depositAmount = computeDepositAmount(total)
    const finalTotal = 4510000

    const order = {
      type: OrderType.PREORDER,
      status: OrderStatus.PROCESSING,
      paymentOption: PaymentOption.DEPOSIT_30,
      total,
      depositAmount,
      finalTotal,
    }

    const txsPending: PaymentTransactionData[] = [
      {
        type: TxType.PAYMENT,
        status: TxStatus.DONE,
        amount: depositAmount,
      },
      {
        type: TxType.REFUND,
        status: TxStatus.PENDING, // Đang chờ chuyển khoản
        amount: 877200,
        reference: 'REFUND_SHORTFALL',
        note: 'Hoàn tiền cọc do sản lượng thu hoạch thiếu hụt (60kg / 100kg)',
      },
    ]

    it('không coi khoản hoàn chưa thực hiện là tiền đã trả cho khách (refundedAmount = 0)', () => {
      const payment = derivePaymentStatus(order, txsPending)
      expect(payment.hasPendingRefund).toBe(true)
      expect(payment.status).toBe('REFUND_PENDING')
      expect(payment.refundedAmount).toBe(0) // Chưa hoàn xong
      expect(payment.isSettled).toBe(false)
    })

    it('khi refund chuyển sang DONE, cọc thực giữ được cập nhật chuẩn xác', () => {
      const txsDone: PaymentTransactionData[] = [
        txsPending[0],
        { ...txsPending[1], status: TxStatus.DONE },
      ]

      const payment = derivePaymentStatus(order, txsDone)
      expect(payment.hasPendingRefund).toBe(false)
      expect(payment.refundedAmount).toBe(877200)
      expect(payment.remainingAmount).toBe(3194200)

      const payable = computePayableAmount(order, txsDone)
      expect(payable.amountToPay).toBe(3194200)
    })
  })

  // S5: Khách CANCEL do giá ngoài biên độ
  describe('S5 — Khách CANCEL do giá ngoài biên độ', () => {
    it('hoàn đúng khoản cọc còn lại và không hoàn trùng khoản shortfall đã tạo', () => {
      const depositAmount = 2193000
      const shortfallRefund = 877200

      // Khách từ chối giá ngoài biên độ:
      const remainingRefund = computeOutOfBandCancellationRefund({
        paidAmount: depositAmount,
        shortfallRefundAmount: shortfallRefund,
      })

      // 2.193.000 - 877.200 = 1.315.800đ
      expect(remainingRefund).toBe(1315800)
      // Tổng 2 lần hoàn đúng 100% cọc ban đầu (877.200 + 1.315.800 = 2.193.000đ)
      expect(shortfallRefund + remainingRefund).toBe(depositAmount)
    })
  })

  // S6: Khiếu nại sau giao hàng (Complaint - Bảo toàn SRC-FIN-02)
  describe('S6 — Khiếu nại sau giao hàng (Bảo toàn SRC-FIN-02)', () => {
    const deliveredOrder = {
      total: 15277500,
      finalTotal: 14950125,
      status: OrderStatus.COMPLAINT,
      paymentOption: PaymentOption.FULL,
      depositAmount: computeDepositAmount(15277500),
    }

    const complaintTxs: PaymentTransactionData[] = [
      { type: TxType.PAYMENT, status: TxStatus.DONE, amount: 14950125 },
      {
        type: TxType.REFUND,
        status: TxStatus.DONE,
        amount: 278996,
        note: 'Khoản bồi hoàn khiếu nại hao hụt (278.996 đ cho 5 kg)',
      },
    ]

    it('khoản bồi hoàn khiếu nại không làm phát sinh nợ giả cho khách (amountToPay = 0)', () => {
      const payable = computePayableAmount(deliveredOrder, complaintTxs)
      expect(payable.isPayable).toBe(false)
      expect(payable.amountToPay).toBe(0)
    })

    it('derivePaymentStatus trả về remainingAmount = 0 và isSettled = true', () => {
      const payment = derivePaymentStatus(deliveredOrder, complaintTxs)
      expect(payment.remainingAmount).toBe(0)
      expect(payment.isSettled).toBe(true)
      expect(payment.status).toBe('PARTIALLY_REFUNDED')
    })

    it('chuyển trạng thái COMPLAINT -> COMPLETED thành công sau khi bồi hoàn (SRC-FIN-02)', () => {
      const payment = derivePaymentStatus(deliveredOrder, complaintTxs)
      const transition = canTransition(
        deliveredOrder,
        OrderStatus.COMPLETED,
        'SELLER',
        {
          paidAmount: payment.paidAmount,
          grossPaid: payment.grossPaid,
          refundedAmount: payment.refundedAmount,
          hasPendingRefund: false,
          complaintResolved: true,
        }
      )
      expect(transition.ok).toBe(true)
    })
  })

  // S7: Đơn thường FULL và DEPOSIT_30
  describe('S7 — Đơn thường FULL và DEPOSIT_30 (Bảo toàn SRC-FIN-01)', () => {
    it('đơn thường DEPOSIT_30 yêu cầu đúng 70% còn lại khi PROCESSING', () => {
      const normalDepositOrder = {
        total: 10000000,
        depositAmount: 3000000,
        status: OrderStatus.PROCESSING,
        paymentOption: PaymentOption.DEPOSIT_30,
      }
      const txs: PaymentTransactionData[] = [
        { type: TxType.PAYMENT, status: TxStatus.DONE, amount: 3000000 },
      ]
      const payable = computePayableAmount(normalDepositOrder, txs)
      expect(payable.isPayable).toBe(true)
      expect(payable.amountToPay).toBe(7000000)
    })

    it('đơn thường FULL hủy ở PROCESSING không bị phạt cọc 100% (SRC-FIN-01)', () => {
      const res = computeCancellation(
        {
          status: OrderStatus.PROCESSING,
          depositAmount: 10000000,
          total: 10000000,
          paymentOption: 'FULL',
        },
        10000000,
        CancelActor.CUSTOMER
      )
      // Cọc chính sách 30% = 3.000.000đ, hoàn 7.000.000đ
      expect(res.forfeitAmount).toBe(3000000)
      expect(res.refundAmount).toBe(7000000)
    })
  })

  // S8: Backward Compatibility với đơn Pre-order cũ có shippingFee = 0
  describe('S8 — Backward Compatibility với Pre-order cũ (shippingFee = 0)', () => {
    const total = 7000000 // 100kg @ 70k, ship 0đ
    const depositAmount = computeDepositAmount(total) // 2.100.000đ
    const finalTotal = 4200000 // Giao 60kg @ 70k = 4.200.000đ, ship 0đ
    const shortfallRefund = computePreorderShortfallRefund({
      depositAmount,
      orderedGrams: 100000,
      fulfilledGrams: 60000,
    }) // 840.000đ

    const oldOrder = {
      type: OrderType.PREORDER,
      status: OrderStatus.PROCESSING,
      paymentOption: PaymentOption.DEPOSIT_30,
      total,
      depositAmount,
      finalTotal,
    }

    const txs: PaymentTransactionData[] = [
      { type: TxType.PAYMENT, status: TxStatus.DONE, amount: depositAmount },
      {
        type: TxType.REFUND,
        status: TxStatus.DONE,
        amount: shortfallRefund,
        note: 'Hoàn tiền cọc do sản lượng thu hoạch thiếu hụt (60kg / 100kg)',
      },
    ]

    it('tính toán số tiền còn lại chính xác là 2.940.000đ cho đơn cũ', () => {
      // 4.200.000 - (2.100.000 - 840.000) = 4.200.000 - 1.260.000 = 2.940.000đ
      const payable = computePayableAmount(oldOrder, txs)
      expect(payable.amountToPay).toBe(2940000)

      const payment = derivePaymentStatus(oldOrder, txs)
      expect(payment.remainingAmount).toBe(2940000)
      expect(payment.netPaid).toBe(1260000)
      expect(payment.isSettled).toBe(false)
    })
  })

  // Helper unit tests
  describe('isShortfallRefund helper verification', () => {
    it('nhận diện đúng giao dịch hoàn cọc do hụt sản lượng qua reference hoặc note', () => {
      expect(
        isShortfallRefund({
          type: TxType.REFUND,
          status: TxStatus.DONE,
          amount: 500000,
          reference: 'REFUND_SHORTFALL',
        })
      ).toBe(true)

      expect(
        isShortfallRefund({
          type: TxType.REFUND,
          status: TxStatus.DONE,
          amount: 500000,
          note: 'Hoàn tiền cọc do sản lượng thu hoạch thiếu hụt 40%',
        })
      ).toBe(true)

      expect(
        isShortfallRefund({
          type: TxType.REFUND,
          status: TxStatus.DONE,
          amount: 500000,
          isShortfall: true,
        })
      ).toBe(true)

      // Giao dịch khiếu nại không phải là shortfall
      expect(
        isShortfallRefund({
          type: TxType.REFUND,
          status: TxStatus.DONE,
          amount: 500000,
          note: 'Khoản bồi hoàn khiếu nại hao hụt nông sản',
        })
      ).toBe(false)

      // Giao dịch thanh toán (PAYMENT) không phải là shortfall refund
      expect(
        isShortfallRefund({
          type: TxType.PAYMENT,
          status: TxStatus.DONE,
          amount: 500000,
        })
      ).toBe(false)
    })
  })
})
