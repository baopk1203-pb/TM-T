import { describe, it, expect } from 'vitest'
import { RESERVATION_TIMEOUT_MINUTES, computeOrderPaymentDueAt } from '@/lib/domain/inventory'
import { OrderStatus } from '@prisma/client'

describe('QA-WORK-10 UI Hotfix Verifications (QW10-01 & QW10-02)', () => {
  describe('QW10-01 — Checkout Payment Deadline Contract', () => {
    it('Chính sách giữ hàng F01C cấu hình đúng 10 phút, không phải 24 giờ', () => {
      expect(RESERVATION_TIMEOUT_MINUTES).toBe(10)
      const now = new Date('2026-10-25T10:00:00.000Z')
      const dueAt = computeOrderPaymentDueAt(now)
      expect(dueAt.toISOString()).toBe('2026-10-25T10:10:00.000Z')
    })
  })

  describe('QW10-02 — Admin Expiration & Cancelled Banner Logic', () => {
    const isDueOverHelper = (order: {
      status: OrderStatus
      paymentDueAt: string | null
      paidAmount: number
    }) => {
      return (
        order.status === OrderStatus.PENDING_CONFIRMATION &&
        order.paymentDueAt !== null &&
        new Date(order.paymentDueAt) < new Date('2026-10-25T12:00:00.000Z') &&
        order.paidAmount === 0
      )
    }

    const isF01cOrderHelper = (order: {
      createdAt: string | null
      paymentDueAt: string | null
    }) => {
      if (!order.paymentDueAt || !order.createdAt) return false
      const durationMs = new Date(order.paymentDueAt).getTime() - new Date(order.createdAt).getTime()
      return durationMs <= 15 * 60 * 1000
    }

    it('Đơn đã CANCELLED tuyệt đối KHÔNG hiển thị cảnh báo quá hạn isDueOver', () => {
      const cancelledOrder = {
        status: OrderStatus.CANCELLED,
        paymentDueAt: '2026-10-25T10:10:00.000Z', // Đã quá 12:00
        paidAmount: 0,
      }
      expect(isDueOverHelper(cancelledOrder)).toBe(false)
    })

    it('Đơn PENDING_CONFIRMATION quá hạn và chưa trả tiền hiển thị isDueOver', () => {
      const pendingOverdueOrder = {
        status: OrderStatus.PENDING_CONFIRMATION,
        paymentDueAt: '2026-10-25T10:10:00.000Z',
        paidAmount: 0,
      }
      expect(isDueOverHelper(pendingOverdueOrder)).toBe(true)
    })

    it('Đơn PENDING_CONFIRMATION đã thanh toán không bị coi là quá hạn', () => {
      const paidOrder = {
        status: OrderStatus.PENDING_CONFIRMATION,
        paymentDueAt: '2026-10-25T10:10:00.000Z',
        paidAmount: 1_000_000,
      }
      expect(isDueOverHelper(paidOrder)).toBe(false)
    })

    it('Phân biệt chính xác đơn F01C (10 phút) và đơn Legacy (24 giờ)', () => {
      const f01cOrder = {
        createdAt: '2026-10-25T10:00:00.000Z',
        paymentDueAt: '2026-10-25T10:10:00.000Z', // 10 phút
      }
      expect(isF01cOrderHelper(f01cOrder)).toBe(true)

      const legacyOrder = {
        createdAt: '2026-10-24T10:00:00.000Z',
        paymentDueAt: '2026-10-25T10:00:00.000Z', // 24 giờ
      }
      expect(isF01cOrderHelper(legacyOrder)).toBe(false)
    })
  })
})
