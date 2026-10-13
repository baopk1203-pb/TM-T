import { describe, it, expect } from 'vitest'
import {
  canTransition,
  applyTransition,
  OrderStateSnapshot,
} from '@/lib/domain/order-state'
import { OrderStatus, PaymentOption } from '@prisma/client'

describe('Domain: order-state.ts (Mục 3.7 Máy trạng thái đơn hàng)', () => {
  const baseOrder: OrderStateSnapshot = {
    status: OrderStatus.PENDING_CONFIRMATION,
    paymentOption: PaymentOption.DEPOSIT_30,
    total: 15277500,
    depositAmount: 4584000,
  }

  describe('DRAFT transitions', () => {
    const draftOrder: OrderStateSnapshot = {
      ...baseOrder,
      status: OrderStatus.DRAFT,
    }

    it('Khách hàng chuyển DRAFT -> PENDING_CONFIRMATION thành công', () => {
      const res = canTransition(draftOrder, OrderStatus.PENDING_CONFIRMATION, 'CUSTOMER')
      expect(res.ok).toBe(true)
    })

    it('Người khác không được chuyển DRAFT -> PENDING_CONFIRMATION', () => {
      const res = canTransition(draftOrder, OrderStatus.PENDING_CONFIRMATION, 'SELLER')
      expect(res.ok).toBe(false)
    })

    it('Hệ thống chuyển DRAFT -> CANCELLED thành công (quá hạn)', () => {
      const res = canTransition(draftOrder, OrderStatus.CANCELLED, 'SYSTEM')
      expect(res.ok).toBe(true)
    })

    it('Không thể nhảy cóc DRAFT -> PROCESSING hay SHIPPING', () => {
      expect(canTransition(draftOrder, OrderStatus.PROCESSING, 'SELLER').ok).toBe(false)
      expect(canTransition(draftOrder, OrderStatus.SHIPPING, 'SELLER').ok).toBe(false)
    })
  })

  describe('PENDING_CONFIRMATION transitions', () => {
    it('Admin duyệt sang PROCESSING khi đã nhận đủ cọc 4.584.000', () => {
      const res = canTransition(baseOrder, OrderStatus.PROCESSING, 'SELLER', {
        paidAmount: 4584000,
      })
      expect(res.ok).toBe(true)
    })

    it('Admin không được duyệt sang PROCESSING khi chưa nhận đủ tiền', () => {
      const res = canTransition(baseOrder, OrderStatus.PROCESSING, 'SELLER', {
        paidAmount: 2000000,
      })
      expect(res.ok).toBe(false)
      expect(res.reason).toContain('Chưa nhận đủ')
    })

    it('Khách không được tự duyệt sang PROCESSING', () => {
      const res = canTransition(baseOrder, OrderStatus.PROCESSING, 'CUSTOMER', {
        paidAmount: 15277500,
      })
      expect(res.ok).toBe(false)
    })

    it('Khách, Admin hoặc Hệ thống hủy ở PENDING_CONFIRMATION -> hoàn 100%', () => {
      const impact = applyTransition(baseOrder, OrderStatus.CANCELLED, 'CUSTOMER', {
        paidAmount: 4584000,
      })
      expect(impact.nextStatus).toBe(OrderStatus.CANCELLED)
      expect(impact.forfeitAmount).toBe(0)
      expect(impact.refundAmount).toBe(4584000)
      expect(impact.isDepositForfeited).toBe(false)
    })
  })

  describe('PROCESSING transitions', () => {
    const processingOrder: OrderStateSnapshot = {
      ...baseOrder,
      status: OrderStatus.PROCESSING,
    }

    it('Admin chuyển PROCESSING -> SHIPPING thành công', () => {
      const res = canTransition(processingOrder, OrderStatus.SHIPPING, 'SELLER')
      expect(res.ok).toBe(true)
    })

    it('Khách không được chuyển sang SHIPPING', () => {
      const res = canTransition(processingOrder, OrderStatus.SHIPPING, 'CUSTOMER')
      expect(res.ok).toBe(false)
    })

    it('Khách hủy ở PROCESSING: Mất cọc (forfeit = deposit), hoàn phần dôi dư', () => {
      // Đã trả FULL 15.277.500
      const impact = applyTransition(processingOrder, OrderStatus.CANCELLED, 'CUSTOMER', {
        paidAmount: 15277500,
      })
      expect(impact.forfeitAmount).toBe(4584000)
      expect(impact.refundAmount).toBe(10693500)
      expect(impact.isDepositForfeited).toBe(true)
    })

    it('Khách chỉ cọc 4.584.000 hủy ở PROCESSING: Mất toàn bộ cọc, hoàn 0', () => {
      const impact = applyTransition(processingOrder, OrderStatus.CANCELLED, 'CUSTOMER', {
        paidAmount: 4584000,
      })
      expect(impact.forfeitAmount).toBe(4584000)
      expect(impact.refundAmount).toBe(0)
      expect(impact.isDepositForfeited).toBe(true)
    })

    it('Bên bán (SELLER) hủy ở PROCESSING: Hoàn 100% không mất cọc', () => {
      const impact = applyTransition(processingOrder, OrderStatus.CANCELLED, 'SELLER', {
        paidAmount: 4584000,
      })
      expect(impact.forfeitAmount).toBe(0)
      expect(impact.refundAmount).toBe(4584000)
      expect(impact.isDepositForfeited).toBe(false)
    })
  })

  describe('SHIPPING transitions', () => {
    const shippingOrder: OrderStateSnapshot = {
      ...baseOrder,
      status: OrderStatus.SHIPPING,
    }

    it('Tuyệt đối không được hủy từ SHIPPING trở đi', () => {
      const resCustomer = canTransition(shippingOrder, OrderStatus.CANCELLED, 'CUSTOMER')
      expect(resCustomer.ok).toBe(false)
      const resSeller = canTransition(shippingOrder, OrderStatus.CANCELLED, 'SELLER')
      expect(resSeller.ok).toBe(false)
    })

    it('Admin chuyển SHIPPING -> DELIVERED khi đã nhập khối lượng thực tế', () => {
      const res = canTransition(shippingOrder, OrderStatus.DELIVERED, 'SELLER', {
        hasActualGramsForAllLines: true,
      })
      expect(res.ok).toBe(true)
    })

    it('Admin bị chặn nếu chưa nhập khối lượng thực tế cho các dòng', () => {
      const res = canTransition(shippingOrder, OrderStatus.DELIVERED, 'SELLER', {
        hasActualGramsForAllLines: false,
      })
      expect(res.ok).toBe(false)
      expect(res.reason).toContain('khối lượng thực giao')
    })
  })

  describe('DELIVERED & COMPLAINT transitions', () => {
    const deliveredAt = new Date('2026-10-10T10:00:00Z')
    const deliveredOrder: OrderStateSnapshot = {
      ...baseOrder,
      status: OrderStatus.DELIVERED,
      finalTotal: 14950125,
      deliveredAt,
    }

    it('Khách tạo khiếu nại trong 24h có ảnh -> chuyển COMPLAINT thành công', () => {
      const now = new Date('2026-10-10T20:00:00Z') // sau 10h
      const res = canTransition(deliveredOrder, OrderStatus.COMPLAINT, 'CUSTOMER', {
        now,
        photosCount: 2,
      })
      expect(res.ok).toBe(true)
    })

    it('Khách tạo khiếu nại sau 24h -> bị từ chối', () => {
      const now = new Date('2026-10-11T12:00:00Z') // sau 26h
      const res = canTransition(deliveredOrder, OrderStatus.COMPLAINT, 'CUSTOMER', {
        now,
        photosCount: 2,
      })
      expect(res.ok).toBe(false)
      expect(res.reason).toContain('quá thời hạn khiếu nại 24h')
    })

    it('Admin hoàn thành đơn khi đã tất toán và đã qua 24h không khiếu nại', () => {
      const now = new Date('2026-10-11T12:00:00Z') // sau 26h
      const res = canTransition(deliveredOrder, OrderStatus.COMPLETED, 'SELLER', {
        now,
        paidAmount: 14950125,
        hasPendingRefund: false,
      })
      expect(res.ok).toBe(true)
    })

    it('Admin không được hoàn thành đơn khi chưa tất toán đủ tiền', () => {
      const now = new Date('2026-10-11T12:00:00Z')
      const res = canTransition(deliveredOrder, OrderStatus.COMPLETED, 'SELLER', {
        now,
        paidAmount: 10000000, // thiếu
      })
      expect(res.ok).toBe(false)
    })

    it('Từ COMPLAINT -> COMPLETED khi khiếu nại đã xử lý xong và đã tất toán', () => {
      const complaintOrder: OrderStateSnapshot = {
        ...deliveredOrder,
        status: OrderStatus.COMPLAINT,
      }

      const res = canTransition(complaintOrder, OrderStatus.COMPLETED, 'SELLER', {
        complaintResolved: true,
        paidAmount: 14950125,
        hasPendingRefund: false,
      })
      expect(res.ok).toBe(true)
    })
  })

  describe('Terminal states', () => {
    it('CANCELLED không thể chuyển đi đâu nữa', () => {
      const cancelledOrder: OrderStateSnapshot = {
        ...baseOrder,
        status: OrderStatus.CANCELLED,
      }
      expect(canTransition(cancelledOrder, OrderStatus.PROCESSING, 'SELLER').ok).toBe(false)
      expect(canTransition(cancelledOrder, OrderStatus.COMPLETED, 'SELLER').ok).toBe(false)
    })

    it('COMPLETED không thể chuyển đi đâu nữa', () => {
      const completedOrder: OrderStateSnapshot = {
        ...baseOrder,
        status: OrderStatus.COMPLETED,
      }
      expect(canTransition(completedOrder, OrderStatus.PROCESSING, 'SELLER').ok).toBe(false)
      expect(canTransition(completedOrder, OrderStatus.CANCELLED, 'SELLER').ok).toBe(false)
    })
  })
})
