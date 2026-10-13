'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { getServerAuthSession, requireAdmin } from '@/lib/auth'
import { recordOrderEvent } from '@/lib/events'
import {
  canTransition,
  applyTransition,
  OrderActor,
} from '@/lib/domain/order-state'
import {
  computeWeightSettlement,
  computeComplaintCompensation,
  derivePaymentStatus,
} from '@/lib/domain/settlement'
import {
  OrderStatus,
  TxType,
  TxStatus,
  TxMethod,
  CancelActor,
  ComplaintStatus,
  Resolution,
  Role,
} from '@prisma/client'

/**
 * Hủy đơn hàng (Khách hàng hoặc Bên bán / Admin) (Mục 3.7 & Test Cases S2-S5)
 */
export async function cancelOrder(input: {
  orderId: string
  reason: string
}) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user) {
      return { success: false, error: 'Vui lòng đăng nhập để thực hiện' }
    }

    if (!input.reason?.trim()) {
      return { success: false, error: 'Vui lòng cung cấp lý do hủy đơn hàng' }
    }

    const order = await db.order.findUnique({
      where: { id: input.orderId },
      include: {
        transactions: true,
      },
    })

    if (!order) {
      return { success: false, error: 'Không tìm thấy đơn hàng' }
    }

    // Xác định vai trò actor
    const isAdmin = session.user.role === Role.ADMIN
    const isOwner = order.userId === session.user.id

    if (!isAdmin && !isOwner) {
      return { success: false, error: 'Bạn không có quyền hủy đơn hàng này' }
    }

    const actor: OrderActor = isAdmin ? 'SELLER' : 'CUSTOMER'

    // Tính tổng số tiền khách đã trả thành công
    const paymentCalc = derivePaymentStatus(
      {
        total: order.total,
        finalTotal: order.finalTotal,
        status: order.status,
      },
      order.transactions
    )
    const paidAmount = paymentCalc.paidAmount

    // Kiểm tra khả năng chuyển trạng thái theo máy trạng thái (3.7)
    const check = canTransition(
      {
        status: order.status,
        paymentOption: order.paymentOption,
        total: order.total,
        depositAmount: order.depositAmount,
        finalTotal: order.finalTotal,
        deliveredAt: order.deliveredAt,
      },
      OrderStatus.CANCELLED,
      actor,
      { paidAmount }
    )

    if (!check.ok) {
      return { success: false, error: check.reason || 'Không thể hủy đơn hàng' }
    }

    // Tính toán tác động tài chính (mất cọc / hoàn tiền)
    const impact = applyTransition(
      {
        status: order.status,
        paymentOption: order.paymentOption,
        total: order.total,
        depositAmount: order.depositAmount,
        finalTotal: order.finalTotal,
        deliveredAt: order.deliveredAt,
      },
      OrderStatus.CANCELLED,
      actor,
      { paidAmount }
    )

    const cancelActorPrisma: CancelActor = isAdmin
      ? CancelActor.SELLER
      : CancelActor.CUSTOMER

    await db.$transaction(async (tx) => {
      // Cập nhật trạng thái đơn hàng
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.CANCELLED,
          cancelledBy: cancelActorPrisma,
          cancelReason: input.reason.trim(),
        },
      })

      // Nếu có khoản hoàn tiền
      if (impact.refundAmount > 0) {
        await tx.paymentTransaction.create({
          data: {
            orderId: order.id,
            type: TxType.REFUND,
            status: TxStatus.PENDING,
            method: TxMethod.BANK_TRANSFER,
            amount: impact.refundAmount,
            note: impact.isDepositForfeited
              ? `Hoàn tiền dôi dư sau khi trừ tiền cọc phạt hủy đơn (${impact.refundAmount.toLocaleString('vi-VN')} đ)`
              : `Hoàn tiền 100% khi hủy đơn (${impact.refundAmount.toLocaleString('vi-VN')} đ)`,
          },
        })
      }

      // Ghi OrderEvent
      await recordOrderEvent(tx, {
        orderId: order.id,
        type: 'ORDER_CANCELLED',
        fromStatus: order.status,
        toStatus: OrderStatus.CANCELLED,
        actorId: session.user.id,
        note: `${actor === 'SELLER' ? 'Admin/Bên bán' : 'Khách hàng'} hủy đơn: ${input.reason.trim()}. ${impact.note}`,
        payload: {
          cancelledBy: cancelActorPrisma,
          reason: input.reason.trim(),
          paidAmount,
          forfeitAmount: impact.forfeitAmount,
          refundAmount: impact.refundAmount,
        },
      })
    })

    revalidatePath(`/admin/don-hang/${order.id}`)
    revalidatePath(`/admin/don-hang/${order.code}`)
    revalidatePath('/admin/don-hang')
    revalidatePath(`/tai-khoan/don-hang/${order.code}`)
    revalidatePath('/tai-khoan')

    return {
      success: true,
      message: impact.isDepositForfeited
        ? `Đã hủy đơn hàng. Do hủy ở trạng thái Đang xử lý, quý khách mất tiền cọc ${impact.forfeitAmount.toLocaleString('vi-VN')} đ, số tiền còn lại ${impact.refundAmount.toLocaleString('vi-VN')} đ đang được tạo lệnh hoàn.`
        : `Đã hủy đơn hàng thành công.${impact.refundAmount > 0 ? ` Lệnh hoàn ${impact.refundAmount.toLocaleString('vi-VN')} đ đã được tạo.` : ''}`,
    }
  } catch (error) {
    console.error('Error cancelling order:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Hủy đơn hàng thất bại',
    }
  }
}

/**
 * Admin chuyển đơn sang SHIPPING (Bàn giao vận chuyển) & gán lô hàng (Mục 3.7, 3.12)
 */
export async function transitionToShipping(input: {
  orderId: string
  batchAssignments?: { orderItemId: string; batchId: string }[]
}) {
  try {
    const admin = await requireAdmin()

    const order = await db.order.findUnique({
      where: { id: input.orderId },
      include: { items: true },
    })

    if (!order) return { success: false, error: 'Không tìm thấy đơn hàng' }

    const check = canTransition(
      {
        status: order.status,
        paymentOption: order.paymentOption,
        total: order.total,
        depositAmount: order.depositAmount,
        finalTotal: order.finalTotal,
        deliveredAt: order.deliveredAt,
      },
      OrderStatus.SHIPPING,
      'SELLER'
    )

    if (!check.ok) {
      return { success: false, error: check.reason || 'Không thể chuyển sang SHIPPING' }
    }

    await db.$transaction(async (tx) => {
      // Cập nhật lô hàng cho từng dòng nếu có
      if (input.batchAssignments && input.batchAssignments.length > 0) {
        for (const assign of input.batchAssignments) {
          if (assign.batchId) {
            await tx.orderItem.update({
              where: { id: assign.orderItemId },
              data: { batchId: assign.batchId },
            })
          }
        }
      }

      // Cập nhật trạng thái đơn hàng sang SHIPPING
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.SHIPPING },
      })

      // Ghi OrderEvent
      await recordOrderEvent(tx, {
        orderId: order.id,
        type: 'ORDER_SHIPPED',
        fromStatus: order.status,
        toStatus: OrderStatus.SHIPPING,
        actorId: admin.id,
        note: 'Admin đã bàn giao hàng cho tài xế/đội vận chuyển',
      })
    })

    revalidatePath(`/admin/don-hang/${order.id}`)
    revalidatePath(`/admin/don-hang/${order.code}`)
    revalidatePath('/admin/don-hang')
    revalidatePath(`/tai-khoan/don-hang/${order.code}`)

    return { success: true, message: 'Đã chuyển đơn hàng sang trạng thái ĐANG GIAO (SHIPPING)' }
  } catch (error) {
    console.error('Error transitioning to shipping:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Chuyển trạng thái thất bại',
    }
  }
}

/**
 * Admin chốt khối lượng thực tế & Xác nhận giao hàng DELIVERED (Mục 3.8 & Test Cases W1-W3)
 */
export async function settleActualWeights(input: {
  orderId: string
  lines: { orderItemId: string; actualGrams: number }[]
}) {
  try {
    const admin = await requireAdmin()

    const order = await db.order.findUnique({
      where: { id: input.orderId },
      include: {
        items: true,
        transactions: true,
      },
    })

    if (!order) return { success: false, error: 'Không tìm thấy đơn hàng' }

    // Kiểm tra tính hợp lệ của trạng thái
    const check = canTransition(
      {
        status: order.status,
        paymentOption: order.paymentOption,
        total: order.total,
        depositAmount: order.depositAmount,
        finalTotal: order.finalTotal,
        deliveredAt: order.deliveredAt,
      },
      OrderStatus.DELIVERED,
      'SELLER',
      { hasActualGramsForAllLines: true }
    )

    if (!check.ok) {
      return { success: false, error: check.reason || 'Không thể chốt khối lượng ở trạng thái này' }
    }

    // Chuẩn bị dữ liệu tính toán quyết toán khối lượng
    const lineInputs = order.items.map((item) => {
      const match = input.lines.find((l) => l.orderItemId === item.id)
      const actualGrams = match ? match.actualGrams : item.orderedGrams
      return {
        id: item.id,
        orderedGrams: item.orderedGrams,
        actualGrams,
        unitPricePerKg: item.unitPricePerKg,
        isSample: item.isSample,
        lineTotal: item.lineTotal,
      }
    })

    // Tính tổng số tiền đã thanh toán
    const paymentCalc = derivePaymentStatus(
      {
        total: order.total,
        finalTotal: order.finalTotal,
        status: order.status,
      },
      order.transactions
    )
    const paidAmount = paymentCalc.paidAmount

    // Chạy domain logic chốt khối lượng (hàm thuần có validate 105%)
    const settlement = computeWeightSettlement({
      lines: lineInputs,
      shippingFee: order.shippingFee,
      paid: paidAmount,
    })

    await db.$transaction(async (tx) => {
      // Cập nhật actualGrams và finalLineTotal cho từng dòng
      for (const resLine of settlement.lines) {
        await tx.orderItem.update({
          where: { id: resLine.id },
          data: {
            actualGrams: resLine.actualGrams,
            finalLineTotal: resLine.finalLineTotal,
          },
        })
      }

      // Cập nhật order sang DELIVERED
      await tx.order.update({
        where: { id: order.id },
        data: {
          finalSubtotal: settlement.finalSubtotal,
          finalTotal: settlement.finalTotal,
          status: OrderStatus.DELIVERED,
          deliveredAt: new Date(),
        },
      })

      // Nếu số tiền đã trả > số tiền thực tế cần trả (thực tế giao thiếu), tạo khoản hoàn
      if (settlement.refundAmount > 0) {
        await tx.paymentTransaction.create({
          data: {
            orderId: order.id,
            type: TxType.REFUND,
            status: TxStatus.PENDING,
            method: TxMethod.BANK_TRANSFER,
            amount: settlement.refundAmount,
            note: `Khoản hoàn do giao thiếu khối lượng sau khi chốt cân (${settlement.refundAmount.toLocaleString('vi-VN')} đ)`,
          },
        })
      }

      // Ghi OrderEvent
      await recordOrderEvent(tx, {
        orderId: order.id,
        type: 'WEIGHTS_SETTLED',
        fromStatus: order.status,
        toStatus: OrderStatus.DELIVERED,
        actorId: admin.id,
        note: `Chốt khối lượng thực tế: Tổng quyết toán ${settlement.finalTotal.toLocaleString('vi-VN')} đ. ${
          settlement.customerToPay > 0
            ? `Khách thanh toán phần còn lại: ${settlement.customerToPay.toLocaleString('vi-VN')} đ.`
            : settlement.refundAmount > 0
            ? `Tạo khoản hoàn tiền thừa: ${settlement.refundAmount.toLocaleString('vi-VN')} đ.`
            : 'Đã tất toán đủ.'
        }`,
        payload: {
          finalSubtotal: settlement.finalSubtotal,
          finalTotal: settlement.finalTotal,
          balance: settlement.balance,
          customerToPay: settlement.customerToPay,
          refundAmount: settlement.refundAmount,
        },
      })
    })

    revalidatePath(`/admin/don-hang/${order.id}`)
    revalidatePath(`/admin/don-hang/${order.code}`)
    revalidatePath('/admin/don-hang')
    revalidatePath(`/tai-khoan/don-hang/${order.code}`)

    return {
      success: true,
      message: `Đã chốt khối lượng thực tế và chuyển đơn sang ĐÃ GIAO (DELIVERED). Tổng tiền: ${settlement.finalTotal.toLocaleString('vi-VN')} đ.`,
    }
  } catch (error) {
    console.error('Error settling weights:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Chốt khối lượng thực tế thất bại',
    }
  }
}

/**
 * Admin xác nhận đã hoàn tiền cho khách (Chuyển REFUND status PENDING -> DONE)
 */
export async function confirmRefundDone(input: {
  transactionId: string
  note?: string
}) {
  try {
    const admin = await requireAdmin()

    const txRecord = await db.paymentTransaction.findUnique({
      where: { id: input.transactionId },
      include: { order: true },
    })

    if (!txRecord || txRecord.type !== TxType.REFUND) {
      return { success: false, error: 'Không tìm thấy giao dịch hoàn tiền hợp lệ' }
    }

    await db.$transaction(async (tx) => {
      await tx.paymentTransaction.update({
        where: { id: txRecord.id },
        data: {
          status: TxStatus.DONE,
          completedAt: new Date(),
          note: input.note ? `${txRecord.note || ''} | ${input.note}` : txRecord.note,
        },
      })

      await recordOrderEvent(tx, {
        orderId: txRecord.orderId,
        type: 'REFUND_CONFIRMED',
        actorId: admin.id,
        note: `Admin xác nhận đã chuyển khoản hoàn ${txRecord.amount.toLocaleString('vi-VN')} đ cho khách`,
        payload: {
          transactionId: txRecord.id,
          amount: txRecord.amount,
        },
      })
    })

    revalidatePath(`/admin/don-hang/${txRecord.orderId}`)
    revalidatePath(`/admin/don-hang/${txRecord.order.code}`)
    revalidatePath('/admin/don-hang')

    return { success: true, message: 'Đã xác nhận hoàn tiền thành công' }
  } catch (error) {
    console.error('Error confirming refund:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Xác nhận hoàn tiền thất bại',
    }
  }
}

/**
 * Admin đóng đơn hàng hoàn tất (COMPLETED) (Mục 3.7)
 */
export async function completeOrder(input: { orderId: string }) {
  try {
    const admin = await requireAdmin()

    const order = await db.order.findUnique({
      where: { id: input.orderId },
      include: {
        transactions: true,
        complaints: true,
      },
    })

    if (!order) return { success: false, error: 'Không tìm thấy đơn hàng' }

    const paymentCalc = derivePaymentStatus(
      {
        total: order.total,
        finalTotal: order.finalTotal,
        status: order.status,
      },
      order.transactions
    )

    const hasPendingRefund = order.transactions.some(
      (t) => t.type === TxType.REFUND && t.status === TxStatus.PENDING
    )
    const openComplaint = order.complaints.find((c) => c.status === ComplaintStatus.OPEN)

    const check = canTransition(
      {
        status: order.status,
        paymentOption: order.paymentOption,
        total: order.total,
        depositAmount: order.depositAmount,
        finalTotal: order.finalTotal,
        deliveredAt: order.deliveredAt,
      },
      OrderStatus.COMPLETED,
      'SELLER',
      {
        paidAmount: paymentCalc.paidAmount,
        hasPendingRefund,
        complaintResolved: !openComplaint,
        now: new Date(),
      }
    )

    if (!check.ok) {
      return { success: false, error: check.reason || 'Chưa đủ điều kiện hoàn thành đơn hàng' }
    }

    await db.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.COMPLETED },
      })

      await recordOrderEvent(tx, {
        orderId: order.id,
        type: 'ORDER_COMPLETED',
        fromStatus: order.status,
        toStatus: OrderStatus.COMPLETED,
        actorId: admin.id,
        note: 'Đơn hàng đã hoàn tất toàn diện (đã tất toán, giao nhận thành công và không còn khiếu nại)',
      })
    })

    revalidatePath(`/admin/don-hang/${order.id}`)
    revalidatePath(`/admin/don-hang/${order.code}`)
    revalidatePath('/admin/don-hang')
    revalidatePath(`/tai-khoan/don-hang/${order.code}`)

    return { success: true, message: 'Đơn hàng đã được đánh dấu HOÀN THÀNH (COMPLETED)' }
  } catch (error) {
    console.error('Error completing order:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Hoàn thành đơn hàng thất bại',
    }
  }
}

/**
 * Khách hàng gửi khiếu nại hao hụt trong 24h sau nhận hàng (Mục 3.9 & Test Cases C1-C3)
 */
export async function submitComplaint(input: {
  orderId: string
  orderItemId: string
  reportedGrams: number
  description: string
  photos: string[]
}) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user) {
      return { success: false, error: 'Vui lòng đăng nhập' }
    }

    if (input.reportedGrams <= 0) {
      return { success: false, error: 'Khối lượng hao hụt/hư hỏng phải lớn hơn 0' }
    }

    if (!input.photos || input.photos.length === 0) {
      return { success: false, error: 'Vui lòng tải lên ít nhất 1 ảnh minh chứng' }
    }

    const order = await db.order.findUnique({
      where: { id: input.orderId },
      include: { items: true },
    })

    if (!order) return { success: false, error: 'Không tìm thấy đơn hàng' }

    if (order.userId !== session.user.id && session.user.role !== Role.ADMIN) {
      return { success: false, error: 'Bạn không có quyền khiếu nại cho đơn này' }
    }

    const check = canTransition(
      {
        status: order.status,
        paymentOption: order.paymentOption,
        total: order.total,
        depositAmount: order.depositAmount,
        finalTotal: order.finalTotal,
        deliveredAt: order.deliveredAt,
      },
      OrderStatus.COMPLAINT,
      'CUSTOMER',
      {
        photosCount: input.photos.length,
        now: new Date(),
      }
    )

    if (!check.ok) {
      return { success: false, error: check.reason || 'Không thể tạo khiếu nại' }
    }

    const targetItem = order.items.find((i) => i.id === input.orderItemId)
    if (!targetItem) {
      return { success: false, error: 'Không tìm thấy sản phẩm trong đơn hàng' }
    }

    const itemActualGrams = targetItem.actualGrams ?? targetItem.orderedGrams
    if (input.reportedGrams > itemActualGrams) {
      return {
        success: false,
        error: `Khối lượng hư hỏng không được vượt quá khối lượng thực giao (${(itemActualGrams / 1000).toLocaleString('vi-VN')} kg)`,
      }
    }

    await db.$transaction(async (tx) => {
      // Tạo bản ghi Complaint
      const complaint = await tx.complaint.create({
        data: {
          orderId: order.id,
          orderItemId: input.orderItemId,
          reportedGrams: input.reportedGrams,
          description: input.description.trim(),
          photos: input.photos,
          status: ComplaintStatus.OPEN,
        },
      })

      // Đổi trạng thái order sang COMPLAINT
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.COMPLAINT },
      })

      // Ghi OrderEvent
      await recordOrderEvent(tx, {
        orderId: order.id,
        type: 'COMPLAINT_FILED',
        fromStatus: order.status,
        toStatus: OrderStatus.COMPLAINT,
        actorId: session.user.id,
        note: `Khách gửi khiếu nại hư hỏng ${(input.reportedGrams / 1000).toLocaleString('vi-VN')} kg ${targetItem.productName}: ${input.description.trim()}`,
        payload: {
          complaintId: complaint.id,
          orderItemId: input.orderItemId,
          reportedGrams: input.reportedGrams,
          photos: input.photos,
        },
      })
    })

    revalidatePath(`/tai-khoan/don-hang/${order.code}`)
    revalidatePath(`/admin/don-hang/${order.code}`)
    revalidatePath('/admin/khieu-nai')

    return { success: true, message: 'Đã gửi khiếu nại thành công. Ban quản trị sẽ xác minh trong 24h.' }
  } catch (error) {
    console.error('Error submitting complaint:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Gửi khiếu nại thất bại',
    }
  }
}

/**
 * Admin giải quyết khiếu nại (Xác minh kg & chọn REFUND / REPLACE / REJECTED) (Mục 3.9 & Test Cases C1-C3)
 */
export async function resolveComplaint(input: {
  complaintId: string
  verifiedGrams: number
  resolution: Resolution | 'REJECTED'
  adminNote?: string
}) {
  try {
    const admin = await requireAdmin()

    const complaint = await db.complaint.findUnique({
      where: { id: input.complaintId },
      include: {
        order: {
          include: {
            items: true,
            transactions: true,
          },
        },
      },
    })

    if (!complaint) return { success: false, error: 'Không tìm thấy khiếu nại' }

    const targetItem = complaint.order.items.find((i) => i.id === complaint.orderItemId)
    if (!targetItem) {
      return { success: false, error: 'Không tìm thấy sản phẩm khiếu nại' }
    }

    const actualGrams = targetItem.actualGrams ?? targetItem.orderedGrams
    let compensation = 0

    if (input.resolution === Resolution.REFUND) {
      const compCalc = computeComplaintCompensation({
        actualGrams,
        damagedGrams: input.verifiedGrams,
        unitPricePerKg: targetItem.unitPricePerKg,
      })
      compensation = compCalc.compensation
    }

    await db.$transaction(async (tx) => {
      // Cập nhật trạng thái Complaint
      const isRejected = input.resolution === 'REJECTED'
      await tx.complaint.update({
        where: { id: complaint.id },
        data: {
          status: isRejected ? ComplaintStatus.REJECTED : ComplaintStatus.RESOLVED,
          resolution: isRejected ? null : (input.resolution as Resolution),
          verifiedGrams: input.verifiedGrams,
          compensation: compensation > 0 ? compensation : null,
          adminNote: input.adminNote?.trim() || null,
          resolvedAt: new Date(),
        },
      })

      // Nếu có bồi hoàn tiền (REFUND)
      if (compensation > 0) {
        await tx.paymentTransaction.create({
          data: {
            orderId: complaint.orderId,
            type: TxType.REFUND,
            status: TxStatus.PENDING,
            method: TxMethod.BANK_TRANSFER,
            amount: compensation,
            note: `Khoản bồi hoàn khiếu nại hao hụt (${compensation.toLocaleString('vi-VN')} đ cho ${(input.verifiedGrams / 1000).toLocaleString('vi-VN')} kg)`,
          },
        })
      }

      // Ghi OrderEvent
      await recordOrderEvent(tx, {
        orderId: complaint.orderId,
        type: 'COMPLAINT_RESOLVED',
        actorId: admin.id,
        note: `Admin xử lý khiếu nại: ${
          isRejected
            ? `Từ chối khiếu nại (${input.adminNote || 'Không thỏa điều kiện'})`
            : input.resolution === Resolution.REFUND
            ? `Chấp nhận bồi hoàn ${compensation.toLocaleString('vi-VN')} đ (Hao hụt xác nhận ${(input.verifiedGrams / 1000).toLocaleString('vi-VN')} kg)`
            : `Đồng ý bù hàng ${((input.verifiedGrams) / 1000).toLocaleString('vi-VN')} kg ở chuyến sau`
        }`,
        payload: {
          complaintId: complaint.id,
          resolution: input.resolution,
          verifiedGrams: input.verifiedGrams,
          compensation,
        },
      })
    })

    revalidatePath('/admin/khieu-nai')
    revalidatePath(`/admin/don-hang/${complaint.orderId}`)
    revalidatePath(`/admin/don-hang/${complaint.order.code}`)
    revalidatePath(`/tai-khoan/don-hang/${complaint.order.code}`)

    return {
      success: true,
      message: `Đã xử lý khiếu nại thành công (${input.resolution}). ${compensation > 0 ? `Lệnh bồi hoàn ${compensation.toLocaleString('vi-VN')} đ đã được tạo.` : ''}`,
    }
  } catch (error) {
    console.error('Error resolving complaint:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Xử lý khiếu nại thất bại',
    }
  }
}
