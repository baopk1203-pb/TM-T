import { OrderStatus, PaymentOption } from '@prisma/client'
import { formatVND } from '@/lib/money'

export type PaymentViewMode =
  | 'CANCELLED_UNPAID'
  | 'CANCELLED_PARTIALLY_PAID'
  | 'EXPIRED_AWAITING_CANCEL'
  | 'PAYABLE_ACTIVE'
  | 'SETTLED_COMPLETED'
  | 'SETTLED_CONFIRMED'

export interface PaymentPresentationInput {
  orderStatus: OrderStatus | string
  paymentOption: PaymentOption | string
  total: number
  depositAmount: number
  paymentDueAt?: Date | string | null
  isPayable: boolean
  amountToPay: number
  grossPaid: number
  now?: Date
}

export interface PaymentNoticeBox {
  type:
    | 'blue_instruction'
    | 'rose_cancelled'
    | 'amber_refund_review'
    | 'rose_expired'
    | 'emerald_completed'
    | 'emerald_processing'
  title: string
  content: string
}

export interface PaymentPresentationResult {
  mode: PaymentViewMode
  canAcceptPayment: boolean
  showCountdown: boolean
  isCancelled: boolean
  isExpired: boolean

  // Header Banner
  bannerTitle: string
  bannerTone: 'emerald' | 'amber' | 'rose'

  // Card Header Badge & Title
  cardTitle: string
  badgeLabel: string
  badgeTone: 'emerald' | 'amber' | 'rose' | 'slate'

  // Left Card Status Content
  statusTitle: string
  statusDescription: string
  warningNotice?: string

  // Right Column Amount Summary
  amountLabel: string
  amountDisplay: string

  // Right Column Notice Box
  noticeBox: PaymentNoticeBox
}

/**
 * Suy diễn trạng thái hiển thị giao diện thanh toán đơn hàng (QW11-01 / EV-IMP-01C)
 * - CANCELLED + paidAmount = 0: Không hiển thị "Đã đối soát", QR, hoặc lời nhắc chuyển khoản.
 * - CANCELLED + paidAmount > 0: Phản ánh khoản tiền đã nhận, trạng thái chờ đối soát hoàn cọc; không tự khẳng định đã hoàn tiền.
 * - PENDING_CONFIRMATION còn hạn: Giữ nguyên đếm ngược 10 phút, mã VietQR và hướng dẫn chuyển khoản.
 * - PENDING_CONFIRMATION quá hạn: Vô hiệu hóa QR, cảnh báo quá hạn 10 phút và không chuyển khoản.
 * - PROCESSING / COMPLETED: Phản ánh chính xác trạng thái xác nhận cọc hoặc tất toán; ẩn hướng dẫn thanh toán đơn mới.
 */
export function resolvePaymentPresentationState(
  input: PaymentPresentationInput
): PaymentPresentationResult {
  const {
    orderStatus,
    paymentOption,
    total,
    depositAmount,
    paymentDueAt,
    isPayable,
    amountToPay,
    grossPaid,
    now = new Date(),
  } = input

  const isCancelled = orderStatus === OrderStatus.CANCELLED || orderStatus === 'CANCELLED'
  const isCompleted = orderStatus === OrderStatus.COMPLETED || orderStatus === 'COMPLETED'
  const isPendingConfirmation =
    orderStatus === OrderStatus.PENDING_CONFIRMATION || orderStatus === 'PENDING_CONFIRMATION'

  const dueTime = paymentDueAt ? new Date(paymentDueAt).getTime() : null
  const currentTime = now.getTime()
  const isDeadlinePassed = dueTime !== null && dueTime <= currentTime
  const isExpiredPending = isPendingConfirmation && isDeadlinePassed

  // Kịch bản 1: Đơn đã CANCELLED
  if (isCancelled) {
    if (grossPaid > 0) {
      return {
        mode: 'CANCELLED_PARTIALLY_PAID',
        canAcceptPayment: false,
        showCountdown: false,
        isCancelled: true,
        isExpired: true,
        bannerTitle: 'Đơn Hàng Đã Bị Hủy (CANCELLED)',
        bannerTone: 'rose',
        cardTitle: 'Trạng Thái Thanh Toán',
        badgeLabel: 'Chờ đối soát hoàn tiền',
        badgeTone: 'amber',
        statusTitle: 'Đơn hàng đã hủy - Cần đối soát khoản tiền đã nhận',
        statusDescription:
          'Hệ thống ghi nhận đơn hàng đã hủy có phát sinh khoản thanh toán trước đó. Ban quản trị sẽ tiến hành đối soát giao dịch thực tế để giải quyết theo chính sách hoàn cọc.',
        warningNotice: `Khoản tiền hệ thống đã ghi nhận: ${formatVND(grossPaid)}. Quý khách vui lòng không chuyển khoản thêm.`,
        amountLabel: 'Số tiền đã thanh toán:',
        amountDisplay: `${formatVND(grossPaid)} (Chờ đối soát)`,
        noticeBox: {
          type: 'amber_refund_review',
          title: '📋 Hướng dẫn đối soát & hoàn tiền:',
          content: `Hệ thống ghi nhận đơn đã hủy có khoản thanh toán trước đó (${formatVND(grossPaid)}). Ban quản trị đang xử lý đối soát giao dịch để hoàn tiền theo chính sách. Quý khách vui lòng không chuyển khoản thêm.`,
        },
      }
    }

    return {
      mode: 'CANCELLED_UNPAID',
      canAcceptPayment: false,
      showCountdown: false,
      isCancelled: true,
      isExpired: true,
      bannerTitle: 'Đơn Hàng Đã Bị Hủy (CANCELLED)',
      bannerTone: 'rose',
      cardTitle: 'Trạng Thái Thanh Toán',
      badgeLabel: 'Đã hủy',
      badgeTone: 'rose',
      statusTitle: 'Đơn hàng đã bị hủy, không thể tiếp tục thanh toán',
      statusDescription:
        'Đơn hàng này đã kết thúc do quá hạn thanh toán giữ chỗ 10 phút hoặc đã bị hủy bởi hệ thống. Cổng thanh toán và mã QR đã đóng.',
      warningNotice:
        'Số tiền đã thanh toán: 0 đ. Quý khách vui lòng không thực hiện chuyển khoản cho đơn hàng này.',
      amountLabel: 'Trạng thái thanh toán:',
      amountDisplay: '0 đ (Đã hủy)',
      noticeBox: {
        type: 'rose_cancelled',
        title: '⚠️ Thông báo đơn hàng đã hủy:',
        content:
          'Đơn hàng này đã kết thúc và không còn hiệu lực giao dịch. Quý khách vui lòng không thực hiện chuyển khoản cho đơn hàng này.',
      },
    }
  }

  // Kịch bản 2: PENDING_CONFIRMATION nhưng đã quá thời hạn 10 phút
  if (isExpiredPending) {
    return {
      mode: 'EXPIRED_AWAITING_CANCEL',
      canAcceptPayment: false,
      showCountdown: false,
      isCancelled: false,
      isExpired: true,
      bannerTitle: 'Đơn Hàng Đã Quá Hạn Thanh Toán',
      bannerTone: 'amber',
      cardTitle: 'Trạng Thái Thanh Toán',
      badgeLabel: 'Hết hạn giữ chỗ',
      badgeTone: 'rose',
      statusTitle: 'Thời gian giữ chỗ thanh toán 10 phút đã hết hạn',
      statusDescription:
        'Đơn hàng đã vượt quá hạn chót 10 phút quy định. Hệ thống đang tự động giải phóng khối lượng giữ chỗ tại các lô FEFO. Mã thanh toán VietQR cho đơn hàng này đã bị vô hiệu hóa.',
      warningNotice:
        'Vui lòng không thực hiện chuyển khoản cho đơn hàng này để tránh phát sinh thủ tục hoàn cọc thủ công.',
      amountLabel: 'Trạng thái thanh toán:',
      amountDisplay: 'Hết hạn thanh toán',
      noticeBox: {
        type: 'rose_expired',
        title: '⏰ Hết hạn thời gian giữ chỗ 10 phút:',
        content:
          'Đã quá thời gian quy định thanh toán giữ chỗ 10 phút. Hệ thống đang tiến hành giải phóng tồn kho FEFO. Vui lòng không tiếp tục chuyển khoản cho mã đơn này.',
      },
    }
  }

  // Kịch bản 3: COMPLETED
  if (isCompleted) {
    return {
      mode: 'SETTLED_COMPLETED',
      canAcceptPayment: false,
      showCountdown: false,
      isCancelled: false,
      isExpired: false,
      bannerTitle: 'Đơn Hàng Đã Hoàn Tất',
      bannerTone: 'emerald',
      cardTitle: 'Trạng Thái Thanh Toán',
      badgeLabel: grossPaid > 0 ? 'Đã đối soát' : 'Hoàn tất',
      badgeTone: 'emerald',
      statusTitle: 'Đơn hàng đã hoàn tất (COMPLETED), không còn khoản cần thanh toán',
      statusDescription:
        'Toàn bộ các bước giao dịch và nghĩa vụ thanh toán cho đơn hàng đã hoàn thành đầy đủ.',
      amountLabel: 'Số tiền còn lại:',
      amountDisplay: '0 đ',
      noticeBox: {
        type: 'emerald_completed',
        title: '✅ Đơn hàng đã hoàn tất:',
        content:
          'Cảm ơn quý khách đã tin tưởng và giao dịch nông sản tại E Vibe. Toàn bộ nghĩa vụ thanh toán cho đơn hàng này đã hoàn thành.',
      },
    }
  }

  // Kịch bản 4: Đã thanh toán đủ khoản cần xác nhận nhưng đơn đang xử lý (PROCESSING, SHIPPING, DELIVERED)
  if (!isPayable) {
    const isFullSettled = grossPaid >= total
    const isDepositSettled =
      paymentOption === PaymentOption.DEPOSIT_30 || paymentOption === 'DEPOSIT_30'
    const badgeLabel = isFullSettled
      ? 'Đã đối soát'
      : isDepositSettled && grossPaid >= depositAmount
        ? 'Đã nhận cọc 30%'
        : grossPaid > 0
          ? 'Đã đối soát'
          : 'Chưa thanh toán'

    return {
      mode: 'SETTLED_CONFIRMED',
      canAcceptPayment: false,
      showCountdown: false,
      isCancelled: false,
      isExpired: false,
      bannerTitle: 'Thông Tin Thanh Toán Đơn Hàng',
      bannerTone: 'emerald',
      cardTitle: 'Trạng Thái Thanh Toán',
      badgeLabel,
      badgeTone: 'emerald',
      statusTitle: 'Đơn hàng đã thanh toán đủ khoản cần xác nhận',
      statusDescription:
        'Khoản thanh toán cần thiết đã được đối soát. Đơn hàng đang được bộ phận kho vận chuẩn bị và điều phối giao hàng.',
      amountLabel: 'Số tiền còn lại:',
      amountDisplay: formatVND(Math.max(0, total - grossPaid)),
      noticeBox: {
        type: 'emerald_processing',
        title: '📦 Đơn hàng đang xử lý:',
        content:
          'Khoản thanh toán xác nhận đã được đối soát. Đơn hàng đang được chuẩn bị đóng gói và điều phối vận chuyển.',
      },
    }
  }

  // Kịch bản 5: Đang chờ thanh toán hợp lệ (PENDING_CONFIRMATION còn hạn hoặc đơn cần trả nốt)
  return {
    mode: 'PAYABLE_ACTIVE',
    canAcceptPayment: true,
    showCountdown: isPendingConfirmation,
    isCancelled: false,
    isExpired: false,
    bannerTitle: 'Đặt Hàng Thành Công!',
    bannerTone: 'emerald',
    cardTitle: 'Quét Mã VietQR Chuyển Khoản',
    badgeLabel: 'Tự động khớp nội dung',
    badgeTone: 'emerald',
    statusTitle: 'Quét mã VietQR hoặc chuyển khoản thủ công theo thông tin bên dưới',
    statusDescription:
      'Hệ thống tự động ghi nhận giao dịch sau khi nhận được thông báo biến động số dư qua sao kê VietQR.',
    amountLabel: 'Số tiền cần chuyển ngay:',
    amountDisplay: formatVND(amountToPay),
    noticeBox: {
      type: 'blue_instruction',
      title: '💡 Lưu ý quan trọng:',
      content:
        'Sau khi bạn chuyển khoản thành công, hệ thống ban quản trị sẽ đối soát và xác nhận chuyển trạng thái đơn hàng sang Đang xử lý (PROCESSING) trong vòng 15-30 phút.',
    },
  }
}
