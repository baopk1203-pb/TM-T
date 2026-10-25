import { describe, it, expect } from 'vitest'
import { OrderStatus, PaymentOption } from '@prisma/client'
import { resolvePaymentPresentationState } from '@/lib/domain/payment-presentation'

describe('QW11-01 — Payment View Presentation State Logic (EV-IMP-01C)', () => {
  describe('Kịch bản 1: Đơn CANCELLED + paidAmount = 0 (Đơn thực tế QA-WORK-11 DH-261025-BMLQ)', () => {
    const cancelledUnpaidInput = {
      orderStatus: OrderStatus.CANCELLED,
      paymentOption: PaymentOption.DEPOSIT_30,
      total: 5_786_000,
      depositAmount: 1_736_000,
      paymentDueAt: new Date('2026-10-25T16:07:46.000Z'), // Đã quá hạn
      isPayable: false,
      amountToPay: 0,
      grossPaid: 0,
      now: new Date('2026-10-25T16:09:00.000Z'),
    }

    it('Không cho phép thanh toán và không hiển thị đếm ngược', () => {
      const res = resolvePaymentPresentationState(cancelledUnpaidInput)
      expect(res.canAcceptPayment).toBe(false)
      expect(res.showCountdown).toBe(false)
      expect(res.isCancelled).toBe(true)
      expect(res.isExpired).toBe(true)
    })

    it('Tuyệt đối KHÔNG hiển thị nhãn "Đã đối soát"', () => {
      const res = resolvePaymentPresentationState(cancelledUnpaidInput)
      expect(res.badgeLabel).toBe('Đã hủy')
      expect(res.badgeLabel).not.toContain('Đã đối soát')
      expect(res.badgeTone).toBe('rose')
    })

    it('Tiêu đề banner và card thể hiện rõ trạng thái CANCELLED', () => {
      const res = resolvePaymentPresentationState(cancelledUnpaidInput)
      expect(res.bannerTitle).toBe('Đơn Hàng Đã Bị Hủy (CANCELLED)')
      expect(res.bannerTone).toBe('rose')
      expect(res.cardTitle).toBe('Trạng Thái Thanh Toán')
      expect(res.statusTitle).toBe('Đơn hàng đã bị hủy, không thể tiếp tục thanh toán')
    })

    it('Hiển thị số tiền đã thanh toán là 0 đ và cảnh báo không chuyển khoản', () => {
      const res = resolvePaymentPresentationState(cancelledUnpaidInput)
      expect(res.amountLabel).toBe('Trạng thái thanh toán:')
      expect(res.amountDisplay).toBe('0 đ (Đã hủy)')
      expect(res.warningNotice).toContain('0 đ')
      expect(res.warningNotice).toContain('không thực hiện chuyển khoản')
    })

    it('Ẩn hoàn toàn lời nhắc chuyển sang PROCESSING trong 15-30 phút', () => {
      const res = resolvePaymentPresentationState(cancelledUnpaidInput)
      expect(res.noticeBox.type).toBe('rose_cancelled')
      expect(res.noticeBox.title).toContain('Thông báo đơn hàng đã hủy')
      expect(res.noticeBox.content).not.toContain('PROCESSING')
      expect(res.noticeBox.content).not.toContain('15-30 phút')
      expect(res.noticeBox.content).not.toContain('15–30 phút')
    })
  })

  describe('Kịch bản 2: Đơn CANCELLED + paidAmount > 0 (Đơn đã cọc nhưng bị hủy, cần đối soát)', () => {
    const cancelledPartiallyPaidInput = {
      orderStatus: OrderStatus.CANCELLED,
      paymentOption: PaymentOption.DEPOSIT_30,
      total: 5_786_000,
      depositAmount: 1_736_000,
      paymentDueAt: new Date('2026-10-25T16:07:46.000Z'),
      isPayable: false,
      amountToPay: 0,
      grossPaid: 1_736_000,
      now: new Date('2026-10-25T16:09:00.000Z'),
    }

    it('Không cho phép thanh toán thêm', () => {
      const res = resolvePaymentPresentationState(cancelledPartiallyPaidInput)
      expect(res.canAcceptPayment).toBe(false)
      expect(res.showCountdown).toBe(false)
      expect(res.isCancelled).toBe(true)
    })

    it('Huy hiệu hiển thị "Chờ đối soát hoàn tiền", không phải "Đã đối soát" hay tự nhận "Đã hoàn tiền"', () => {
      const res = resolvePaymentPresentationState(cancelledPartiallyPaidInput)
      expect(res.badgeLabel).toBe('Chờ đối soát hoàn tiền')
      expect(res.badgeLabel).not.toBe('Đã đối soát')
      expect(res.badgeLabel).not.toBe('Đã hoàn tiền')
      expect(res.badgeTone).toBe('amber')
    })

    it('Phản ánh chính xác khoản tiền đã nhận và trạng thái cần đối soát', () => {
      const res = resolvePaymentPresentationState(cancelledPartiallyPaidInput)
      expect(res.amountLabel).toBe('Số tiền đã thanh toán:')
      expect(res.amountDisplay).toBe('1.736.000 đ (Chờ đối soát)')
      expect(res.warningNotice).toContain('1.736.000 đ')
      expect(res.noticeBox.type).toBe('amber_refund_review')
      expect(res.noticeBox.content).toContain('1.736.000 đ')
      expect(res.noticeBox.content).not.toContain('PROCESSING')
    })
  })

  describe('Kịch bản 3: Đơn PENDING_CONFIRMATION còn hạn (Đang giữ chỗ 10 phút)', () => {
    const now = new Date('2026-10-25T16:00:00.000Z')
    const pendingActiveInput = {
      orderStatus: OrderStatus.PENDING_CONFIRMATION,
      paymentOption: PaymentOption.DEPOSIT_30,
      total: 5_786_000,
      depositAmount: 1_736_000,
      paymentDueAt: new Date('2026-10-25T16:10:00.000Z'), // Còn 10 phút
      isPayable: true,
      amountToPay: 1_736_000,
      grossPaid: 0,
      now,
    }

    it('Cho phép thanh toán và hiển thị đồng hồ đếm ngược', () => {
      const res = resolvePaymentPresentationState(pendingActiveInput)
      expect(res.canAcceptPayment).toBe(true)
      expect(res.showCountdown).toBe(true)
      expect(res.isCancelled).toBe(false)
      expect(res.isExpired).toBe(false)
    })

    it('Hiển thị mã VietQR, số tiền cọc cần chuyển ngay và huy hiệu khớp tự động', () => {
      const res = resolvePaymentPresentationState(pendingActiveInput)
      expect(res.cardTitle).toBe('Quét Mã VietQR Chuyển Khoản')
      expect(res.badgeLabel).toBe('Tự động khớp nội dung')
      expect(res.badgeTone).toBe('emerald')
      expect(res.bannerTitle).toBe('Đặt Hàng Thành Công!')
      expect(res.bannerTone).toBe('emerald')
      expect(res.amountLabel).toBe('Số tiền cần chuyển ngay:')
      expect(res.amountDisplay).toBe('1.736.000 đ')
    })

    it('Hiển thị đúng lời nhắc xử lý chuyển sang PROCESSING trong 15-30 phút', () => {
      const res = resolvePaymentPresentationState(pendingActiveInput)
      expect(res.noticeBox.type).toBe('blue_instruction')
      expect(res.noticeBox.content).toContain('PROCESSING')
      expect(res.noticeBox.content).toContain('15-30 phút')
    })
  })

  describe('Kịch bản 4: Đơn PENDING_CONFIRMATION quá hạn 10 phút (Chờ xử lý hủy)', () => {
    const now = new Date('2026-10-25T16:11:00.000Z')
    const pendingExpiredInput = {
      orderStatus: OrderStatus.PENDING_CONFIRMATION,
      paymentOption: PaymentOption.DEPOSIT_30,
      total: 5_786_000,
      depositAmount: 1_736_000,
      paymentDueAt: new Date('2026-10-25T16:10:00.000Z'), // Đã quá 1 phút
      isPayable: true,
      amountToPay: 1_736_000,
      grossPaid: 0,
      now,
    }

    it('Vô hiệu hóa thanh toán và ẩn đếm ngược', () => {
      const res = resolvePaymentPresentationState(pendingExpiredInput)
      expect(res.canAcceptPayment).toBe(false)
      expect(res.showCountdown).toBe(false)
      expect(res.isExpired).toBe(true)
    })

    it('Huy hiệu là "Hết hạn giữ chỗ", tuyệt đối KHÔNG hiển thị "Đã đối soát"', () => {
      const res = resolvePaymentPresentationState(pendingExpiredInput)
      expect(res.badgeLabel).toBe('Hết hạn giữ chỗ')
      expect(res.badgeLabel).not.toBe('Đã đối soát')
      expect(res.badgeTone).toBe('rose')
    })

    it('Không gợi ý thanh toán tiếp sau khi hệ thống xác định đã hết hạn', () => {
      const res = resolvePaymentPresentationState(pendingExpiredInput)
      expect(res.bannerTitle).toBe('Đơn Hàng Đã Quá Hạn Thanh Toán')
      expect(res.bannerTone).toBe('amber')
      expect(res.statusTitle).toBe('Thời gian giữ chỗ thanh toán 10 phút đã hết hạn')
      expect(res.warningNotice).toContain('không thực hiện chuyển khoản')
      expect(res.noticeBox.type).toBe('rose_expired')
      expect(res.noticeBox.content).not.toContain('15-30 phút')
    })
  })

  describe('Kịch bản 5: Đơn PROCESSING / COMPLETED (Đã đạt chính sách xác nhận)', () => {
    it('Đơn COMPLETED: Hiển thị trạng thái hoàn tất, không còn nợ và không yêu cầu nộp tiền', () => {
      const completedInput = {
        orderStatus: OrderStatus.COMPLETED,
        paymentOption: PaymentOption.FULL,
        total: 5_786_000,
        depositAmount: 5_786_000,
        isPayable: false,
        amountToPay: 0,
        grossPaid: 5_786_000,
      }
      const res = resolvePaymentPresentationState(completedInput)
      expect(res.canAcceptPayment).toBe(false)
      expect(res.badgeLabel).toBe('Đã đối soát')
      expect(res.bannerTitle).toBe('Đơn Hàng Đã Hoàn Tất')
      expect(res.amountLabel).toBe('Số tiền còn lại:')
      expect(res.amountDisplay).toBe('0 đ')
      expect(res.noticeBox.type).toBe('emerald_completed')
      expect(res.noticeBox.content).toContain('hoàn thành')
    })

    it('Đơn PROCESSING (Cọc 30% đã đối soát): Hiển thị "Đã nhận cọc 30%" và số tiền còn lại', () => {
      const processingInput = {
        orderStatus: OrderStatus.PROCESSING,
        paymentOption: PaymentOption.DEPOSIT_30,
        total: 5_786_000,
        depositAmount: 1_736_000,
        isPayable: false,
        amountToPay: 0,
        grossPaid: 1_736_000,
      }
      const res = resolvePaymentPresentationState(processingInput)
      expect(res.canAcceptPayment).toBe(false)
      expect(res.badgeLabel).toBe('Đã nhận cọc 30%')
      expect(res.badgeTone).toBe('emerald')
      expect(res.statusTitle).toBe('Đơn hàng đã thanh toán đủ khoản cần xác nhận')
      expect(res.amountLabel).toBe('Số tiền còn lại:')
      expect(res.amountDisplay).toBe('4.050.000 đ')
      expect(res.noticeBox.type).toBe('emerald_processing')
      expect(res.noticeBox.content).not.toContain('Sau khi bạn chuyển khoản thành công')
    })
  })
})
