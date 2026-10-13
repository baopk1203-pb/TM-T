import { describe, it, expect } from 'vitest'
import {
  computeDepositAmount,
  derivePaymentStatus,
} from '@/lib/domain/settlement'
import { TxType, TxStatus, OrderStatus } from '@prisma/client'

describe('Domain: settlement.ts (Mục 3.6 & Test Case S1)', () => {
  describe('computeDepositAmount', () => {
    it('Test Case S1: total 15.277.500 -> deposit 4.584.000 (làm tròn lên nghìn)', () => {
      // 15.277.500 * 0.3 = 4.583.250 -> làm tròn lên nghìn: 4.584.000
      expect(computeDepositAmount(15277500)).toBe(4584000)
    })

    it('total chẵn: 4.000.000 -> deposit 1.200.000', () => {
      expect(computeDepositAmount(4000000)).toBe(1200000)
    })

    it('total lẻ: 1.234.567 -> deposit 371.000', () => {
      // 1.234.567 * 0.3 = 370.370,1 -> 371.000
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
  })
})
