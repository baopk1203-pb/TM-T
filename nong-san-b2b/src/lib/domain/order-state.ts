import { OrderStatus, PaymentOption, CancelActor } from '@prisma/client'
import { computeCancellation } from './settlement'

export type OrderActor = 'CUSTOMER' | 'SELLER' | 'SYSTEM'

export interface OrderStateSnapshot {
  status: OrderStatus
  paymentOption: PaymentOption
  total: number
  depositAmount: number
  finalTotal?: number | null
  deliveredAt?: Date | null
}

export interface TransitionContext {
  paidAmount?: number
  grossPaid?: number
  refundedAmount?: number
  hasPendingRefund?: boolean
  hasComplaint?: boolean
  complaintResolved?: boolean
  hasActualGramsForAllLines?: boolean
  photosCount?: number
  now?: Date
}

export interface TransitionImpact {
  nextStatus: OrderStatus
  forfeitAmount: number
  refundAmount: number
  requiresRefund: boolean
  isDepositForfeited: boolean
  note: string
}

/**
 * Ngưỡng tiền tối thiểu cần thanh toán để đơn hàng đủ điều kiện duyệt sang PROCESSING (Mục 3.7)
 * - FULL: phải thanh toán 100% tổng tiền (order.total)
 * - DEPOSIT_30: phải thanh toán tối thiểu tiền cọc 30% (order.depositAmount)
 */
export function getRequiredConfirmationPayment(
  order: Pick<OrderStateSnapshot, 'paymentOption' | 'total' | 'depositAmount'>
): number {
  return order.paymentOption === PaymentOption.FULL ? order.total : order.depositAmount
}

/**
 * Kiểm tra xem một chuyển đổi trạng thái có hợp lệ hay không (Mục 3.7)
 */
export function canTransition(
  order: OrderStateSnapshot,
  toStatus: OrderStatus,
  actor: OrderActor,
  context?: TransitionContext
): { ok: boolean; reason?: string } {
  const fromStatus = order.status

  // Không thể chuyển sang chính trạng thái hiện tại
  if (fromStatus === toStatus) {
    return { ok: false, reason: `Đơn hàng đã ở trạng thái ${fromStatus}` }
  }

  // Trạng thái kết thúc: CANCELLED và COMPLETED không thể chuyển đi đâu nữa
  if (fromStatus === OrderStatus.CANCELLED || fromStatus === OrderStatus.COMPLETED) {
    return {
      ok: false,
      reason: `Đơn hàng đã ở trạng thái kết thúc (${fromStatus}), không thể chuyển tiếp`,
    }
  }

  // Tuyệt đối không được hủy từ SHIPPING trở đi
  if (
    toStatus === OrderStatus.CANCELLED &&
    (fromStatus === OrderStatus.SHIPPING ||
      fromStatus === OrderStatus.DELIVERED ||
      fromStatus === OrderStatus.COMPLAINT)
  ) {
    return {
      ok: false,
      reason: `Không thể hủy đơn hàng từ giai đoạn ${fromStatus}. Sự cố phải xử lý qua đường khiếu nại.`,
    }
  }

  const paid = context?.paidAmount ?? 0
  const now = context?.now ?? new Date()

  // Bảng tra cứu chuyển trạng thái theo bảng 3.7
  switch (fromStatus) {
    case OrderStatus.DRAFT:
      if (toStatus === OrderStatus.PENDING_CONFIRMATION) {
        if (actor !== 'CUSTOMER') {
          return { ok: false, reason: 'Chỉ khách hàng mới có quyền xác nhận đơn nháp' }
        }
        return { ok: true }
      }
      if (toStatus === OrderStatus.CANCELLED) {
        if (actor !== 'SYSTEM' && actor !== 'CUSTOMER') {
          return { ok: false, reason: 'Chỉ hệ thống hoặc khách hàng mới được hủy đơn nháp' }
        }
        return { ok: true }
      }
      return { ok: false, reason: `Không thể chuyển từ DRAFT sang ${toStatus}` }

    case OrderStatus.PENDING_CONFIRMATION:
      if (toStatus === OrderStatus.PREORDER_WAITING) {
        if (actor !== 'SELLER') {
          return { ok: false, reason: 'Chỉ ban quản trị (SELLER) mới có quyền xác nhận cọc đơn đặt trước' }
        }
        const requiredAmount = order.depositAmount
        if (paid < requiredAmount) {
          return {
            ok: false,
            reason: `Chưa nhận đủ tiền đặt cọc tối thiểu (${paid.toLocaleString('vi-VN')} đ < ${requiredAmount.toLocaleString('vi-VN')} đ)`,
          }
        }
        return { ok: true }
      }
      if (toStatus === OrderStatus.PROCESSING) {
        if (actor !== 'SELLER') {
          return { ok: false, reason: 'Chỉ ban quản trị (SELLER) mới có quyền duyệt đơn sang PROCESSING' }
        }
        const requiredAmount = getRequiredConfirmationPayment(order)
        if (paid < requiredAmount) {
          return {
            ok: false,
            reason: `Chưa nhận đủ tiền thanh toán tối thiểu (${paid.toLocaleString('vi-VN')} đ < ${requiredAmount.toLocaleString('vi-VN')} đ)`,
          }
        }
        return { ok: true }
      }
      if (toStatus === OrderStatus.CANCELLED) {
        return { ok: true }
      }
      return { ok: false, reason: `Không thể chuyển từ PENDING_CONFIRMATION sang ${toStatus}` }

    case OrderStatus.PREORDER_WAITING:
      if (toStatus === OrderStatus.PROCESSING) {
        if (actor !== 'SELLER' && actor !== 'CUSTOMER') {
          return {
            ok: false,
            reason: 'Chỉ ban quản trị hoặc khách hàng mới được chuyển đơn đặt trước vào xử lý',
          }
        }
        return { ok: true }
      }
      if (toStatus === OrderStatus.CANCELLED) {
        return { ok: true }
      }
      return { ok: false, reason: `Không thể chuyển từ PREORDER_WAITING sang ${toStatus}` }

    case OrderStatus.PROCESSING:
      if (toStatus === OrderStatus.SHIPPING) {
        if (actor !== 'SELLER') {
          return { ok: false, reason: 'Chỉ ban quản trị mới có quyền bàn giao vận chuyển' }
        }
        return { ok: true }
      }
      if (toStatus === OrderStatus.CANCELLED) {
        if (actor !== 'CUSTOMER' && actor !== 'SELLER') {
          return { ok: false, reason: 'Hệ thống không được tự ý hủy đơn đang xử lý' }
        }
        return { ok: true }
      }
      return { ok: false, reason: `Không thể chuyển từ PROCESSING sang ${toStatus}` }

    case OrderStatus.SHIPPING:
      if (toStatus === OrderStatus.DELIVERED) {
        if (actor !== 'SELLER') {
          return { ok: false, reason: 'Chỉ ban quản trị mới có quyền xác nhận giao hàng DELIVERED' }
        }
        if (context?.hasActualGramsForAllLines === false) {
          return {
            ok: false,
            reason: 'Bắt buộc phải nhập khối lượng thực giao cho từng dòng trước khi chuyển sang DELIVERED',
          }
        }
        return { ok: true }
      }
      return { ok: false, reason: `Không thể chuyển từ SHIPPING sang ${toStatus}` }

    case OrderStatus.DELIVERED:
      if (toStatus === OrderStatus.COMPLAINT) {
        if (actor !== 'CUSTOMER') {
          return { ok: false, reason: 'Chỉ khách hàng mới có quyền tạo khiếu nại' }
        }
        if (!order.deliveredAt) {
          return { ok: false, reason: 'Đơn hàng chưa ghi nhận thời điểm giao hàng' }
        }
        const diffMs = now.getTime() - order.deliveredAt.getTime()
        if (diffMs > 24 * 60 * 60 * 1000) {
          return { ok: false, reason: 'Đã quá thời hạn khiếu nại 24h kể từ khi nhận hàng' }
        }
        if (context?.photosCount !== undefined && context.photosCount < 1) {
          return { ok: false, reason: 'Khiếu nại phải kèm theo ít nhất 1 hình ảnh sản phẩm' }
        }
        return { ok: true }
      }
      if (toStatus === OrderStatus.COMPLETED) {
        if (actor !== 'SELLER') {
          return { ok: false, reason: 'Chỉ ban quản trị mới có quyền hoàn thành đơn hàng' }
        }
        if (context?.hasPendingRefund) {
          return { ok: false, reason: 'Đơn hàng còn khoản hoàn tiền đang chờ xử lý' }
        }
        const targetTotal = order.finalTotal ?? order.total
        const grossPaid =
          context?.grossPaid ??
          (context?.refundedAmount !== undefined ? paid + context.refundedAmount : paid)
        const isSettled =
          paid === targetTotal ||
          (grossPaid >= targetTotal && !context?.hasPendingRefund)

        if (!isSettled) {
          return {
            ok: false,
            reason: `Chưa tất toán đủ giá trị đơn hàng (${paid.toLocaleString('vi-VN')} đ !== ${targetTotal.toLocaleString('vi-VN')} đ)`,
          }
        }
        if (order.deliveredAt) {
          const diffMs = now.getTime() - order.deliveredAt.getTime()
          if (diffMs <= 24 * 60 * 60 * 1000) {
            return {
              ok: false,
              reason: 'Chưa hết thời hạn 24h để khách hàng khiếu nại sau khi giao',
            }
          }
        }
        return { ok: true }
      }
      return { ok: false, reason: `Không thể chuyển từ DELIVERED sang ${toStatus}` }

    case OrderStatus.COMPLAINT:
      if (toStatus === OrderStatus.COMPLETED) {
        if (actor !== 'SELLER') {
          return { ok: false, reason: 'Chỉ ban quản trị mới có quyền hoàn thành đơn hàng sau khiếu nại' }
        }
        if (context?.complaintResolved === false) {
          return { ok: false, reason: 'Khiếu nại chưa được xử lý xong' }
        }
        if (context?.hasPendingRefund) {
          return { ok: false, reason: 'Đơn hàng còn khoản hoàn tiền đang chờ xử lý' }
        }
        const targetTotal = order.finalTotal ?? order.total
        const grossPaid =
          context?.grossPaid ??
          (context?.refundedAmount !== undefined ? paid + context.refundedAmount : paid)
        const isSettled =
          paid === targetTotal ||
          (grossPaid >= targetTotal && !context?.hasPendingRefund)

        if (!isSettled) {
          return {
            ok: false,
            reason: `Chưa tất toán đủ giá trị đơn hàng (${paid.toLocaleString('vi-VN')} đ !== ${targetTotal.toLocaleString('vi-VN')} đ)`,
          }
        }
        return { ok: true }
      }
      return { ok: false, reason: `Không thể chuyển từ COMPLAINT sang ${toStatus}` }

    default:
      return { ok: false, reason: `Trạng thái không hợp lệ: ${fromStatus}` }
  }
}

/**
 * Áp dụng chuyển trạng thái và tính toán các tác động tài chính liên quan (Mục 3.7)
 */
export function applyTransition(
  order: OrderStateSnapshot,
  toStatus: OrderStatus,
  actor: OrderActor,
  context?: TransitionContext
): TransitionImpact {
  const check = canTransition(order, toStatus, actor, context)
  if (!check.ok) {
    throw new Error(check.reason || 'Chuyển trạng thái không hợp lệ')
  }

  const paid = context?.paidAmount ?? 0

  if (toStatus === OrderStatus.CANCELLED) {
    const cancelActorPrisma: CancelActor =
      actor === 'CUSTOMER'
        ? CancelActor.CUSTOMER
        : actor === 'SELLER'
        ? CancelActor.SELLER
        : CancelActor.SYSTEM

    const cancelCalc = computeCancellation(order, paid, cancelActorPrisma)

    return {
      nextStatus: OrderStatus.CANCELLED,
      forfeitAmount: cancelCalc.forfeitAmount,
      refundAmount: cancelCalc.refundAmount,
      requiresRefund: cancelCalc.refundAmount > 0,
      isDepositForfeited: cancelCalc.isDepositForfeited,
      note: cancelCalc.isDepositForfeited
        ? `Khách hủy đơn ở PROCESSING - Mất cọc ${cancelCalc.forfeitAmount.toLocaleString('vi-VN')} đ, hoàn ${cancelCalc.refundAmount.toLocaleString('vi-VN')} đ`
        : `Hủy đơn - Hoàn tiền 100% (${cancelCalc.refundAmount.toLocaleString('vi-VN')} đ)`,
    }
  }

  return {
    nextStatus: toStatus,
    forfeitAmount: 0,
    refundAmount: 0,
    requiresRefund: false,
    isDepositForfeited: false,
    note: `Chuyển trạng thái sang ${toStatus} bởi ${actor}`,
  }
}
