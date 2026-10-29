'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { getServerAuthSession, requireAdmin } from '@/lib/auth'
import { recordOrderEvent } from '@/lib/events'
import { sendOrderNotification } from '@/lib/email'
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
  canTransitionComplaint,
  calculateReviewDeadline,
  isComplaintProposalExpired,
} from '@/lib/domain/complaint-state'
import { releaseOrderInventoryAllocations, dispatchOrderInventoryAllocations } from '@/lib/services/inventory-reservation'
import {
  OrderStatus,
  TxType,
  TxStatus,
  TxMethod,
  CancelActor,
  ComplaintStatus,
  ComplaintResolutionType,
  Resolution,
  Role,
  ShipmentStatus,
  VehicleType,
} from '@prisma/client'

const VN_PHONE_REGEX = /^(0|\+84)(3|5|7|8|9)[0-9]{8}$/

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

      // Giải phóng phần tồn kho đang giữ chỗ nhưng chưa xuất kho (EV-IMP-01C)
      await releaseOrderInventoryAllocations(tx, {
        orderId: order.id,
        orderCode: order.code,
        actorId: session.user.id,
        reason: `Giải phóng phần hàng chưa xuất kho khi hủy đơn: ${input.reason.trim()}`,
        now: new Date(),
      })

      // Đồng bộ trạng thái chuyến giao nếu có (PENDING hoặc DISPATCHED)
      const existingShipment = await tx.shipment.findUnique({ where: { orderId: order.id } })
      if (existingShipment && (existingShipment.status === ShipmentStatus.PENDING || existingShipment.status === ShipmentStatus.DISPATCHED)) {
        await tx.shipment.update({
          where: { id: existingShipment.id },
          data: { status: ShipmentStatus.CANCELLED },
        })
      }

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
 * Admin chuyển đơn sang SHIPPING (Bàn giao vận chuyển, gán tài xế & lô hàng) (Mục 3.7, 3.12, Phase 8B)
 */
export async function transitionToShipping(input: {
  orderId: string
  batchAssignments?: { orderItemId: string; batchId: string }[]
  driverName?: string
  driverPhone?: string
  licensePlate?: string
  note?: string
}) {
  try {
    const admin = await requireAdmin()

    // Validate thông tin tài xế & phương tiện bắt buộc
    const driverName = input.driverName?.trim()
    const driverPhone = input.driverPhone?.trim()
    const licensePlate = input.licensePlate?.trim()

    if (!driverName || driverName.length < 2) {
      return { success: false, error: 'Vui lòng nhập họ tên tài xế (tối thiểu 2 ký tự)' }
    }
    if (!driverPhone || !VN_PHONE_REGEX.test(driverPhone)) {
      return { success: false, error: 'Số điện thoại tài xế không hợp lệ (10 chữ số VN, bắt đầu bằng 0 hoặc +84)' }
    }
    if (!licensePlate || licensePlate.length < 3) {
      return { success: false, error: 'Vui lòng nhập biển số xe giao hàng hợp lệ' }
    }

    const order = await db.order.findUnique({
      where: { id: input.orderId },
      include: { items: true, shipment: true },
    })

    if (!order) return { success: false, error: 'Không tìm thấy đơn hàng' }

    // Kiểm tra không cho giao lại nếu đã có shipment hoàn tất hoặc hủy
    if (order.shipment) {
      if (order.shipment.status === ShipmentStatus.DELIVERED || order.shipment.status === ShipmentStatus.CANCELLED) {
        return {
          success: false,
          error: `Không thể bàn giao chuyến giao đã ở trạng thái ${order.shipment.status === ShipmentStatus.DELIVERED ? 'ĐÃ GIAO' : 'ĐÃ HỦY'}`,
        }
      }
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

      // Tạo mới hoặc cập nhật Shipment liên quan
      const existingShipment = await tx.shipment.findUnique({
        where: { orderId: order.id },
      })

      if (existingShipment) {
        await tx.shipment.update({
          where: { id: existingShipment.id },
          data: {
            driverName,
            driverPhone,
            licensePlate: licensePlate.toUpperCase(),
            note: input.note?.trim() || null,
            status: ShipmentStatus.DISPATCHED,
            dispatchedAt: new Date(),
          },
        })
      } else {
        await tx.shipment.create({
          data: {
            orderId: order.id,
            code: `SHIP-${order.code}`,
            vehicleType: order.shippingVehicleType || VehicleType.NORMAL,
            distanceKm: order.shippingDistanceKm || 0,
            shippingFee: order.shippingFee || 0,
            driverName,
            driverPhone,
            licensePlate: licensePlate.toUpperCase(),
            note: input.note?.trim() || null,
            status: ShipmentStatus.DISPATCHED,
            dispatchedAt: new Date(),
          },
        })
      }

      // Ghi OrderEvent
      await recordOrderEvent(tx, {
        orderId: order.id,
        type: 'ORDER_SHIPPED',
        fromStatus: order.status,
        toStatus: OrderStatus.SHIPPING,
        actorId: admin.id,
        note: `Bàn giao vận chuyển cho tài xế ${driverName} (${driverPhone}) - Xe: ${licensePlate.toUpperCase()}`,
        payload: {
          driverName,
          driverPhone,
          licensePlate: licensePlate.toUpperCase(),
          shipmentCode: `SHIP-${order.code}`,
        },
      })
    })

    // DEV-TASK-47: E03 (ORDER_SHIPPING) đã được tắt theo chính sách tinh gọn thông báo email

    revalidatePath(`/admin/don-hang/${order.id}`)
    revalidatePath(`/admin/don-hang/${order.code}`)
    revalidatePath('/admin/don-hang')
    revalidatePath('/admin/van-chuyen')
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
      OrderStatus.COMPLETED,
      'SELLER',
      { hasActualGramsForAllLines: true }
    )

    if (!check.ok) {
      // Fallback kiểm tra chuyển DELIVERED nếu đơn ở trạng thái trung gian
      const fallbackCheck = canTransition(
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
      if (!fallbackCheck.ok) {
        return { success: false, error: check.reason || 'Không thể chốt khối lượng ở trạng thái này' }
      }
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

      // Quyết toán xuất kho và triệt tiêu reservation trên Sổ Cái FEFO (DISPATCH_OUT)
      await dispatchOrderInventoryAllocations(tx, {
        orderId: order.id,
        orderCode: order.code,
        actorId: admin.id,
        lines: input.lines,
        reason: 'Chốt khối lượng thực tế & Hoàn thành đơn hàng',
      })

      // Cập nhật order sang COMPLETED ngay lập tức theo chuẩn BR-01
      await tx.order.update({
        where: { id: order.id },
        data: {
          finalSubtotal: settlement.finalSubtotal,
          finalTotal: settlement.finalTotal,
          status: OrderStatus.COMPLETED,
          deliveredAt: new Date(),
        },
      })

      // Đồng bộ trạng thái chuyến giao nếu có: VẪN LÀ DELIVERED theo BR-01
      const existingShipment = await tx.shipment.findUnique({
        where: { orderId: order.id },
      })
      if (
        existingShipment &&
        existingShipment.status !== ShipmentStatus.DELIVERED &&
        existingShipment.status !== ShipmentStatus.CANCELLED
      ) {
        await tx.shipment.update({
          where: { id: existingShipment.id },
          data: {
            status: ShipmentStatus.DELIVERED,
            deliveredAt: new Date(),
          },
        })
      }

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
        toStatus: OrderStatus.COMPLETED,
        actorId: admin.id,
        note: `Chốt khối lượng thực tế & Hoàn thành đơn hàng ngay lập tức (COMPLETED): Tổng quyết toán ${settlement.finalTotal.toLocaleString('vi-VN')} đ. ${
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

    try {
      await sendOrderNotification({
        type: 'ORDER_COMPLETED',
        orderId: order.id,
      })
    } catch (err) {
      console.error('[settleActualWeights] Failed to send order completed notification:', err)
    }

    revalidatePath(`/admin/don-hang/${order.id}`)
    revalidatePath(`/admin/don-hang/${order.code}`)
    revalidatePath('/admin/don-hang')
    revalidatePath('/admin/van-chuyen')
    revalidatePath(`/tai-khoan/don-hang/${order.code}`)

    return {
      success: true,
      message: `Đã chốt khối lượng thực tế và hoàn thành đơn hàng (COMPLETED). Tổng tiền: ${settlement.finalTotal.toLocaleString('vi-VN')} đ.`,
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

      // BR-05 / F02: Nếu đơn đang ở COMPLAINT, không còn khiếu nại active (OPEN/PROPOSED/UNDER_REVIEW) và không còn refund pending, chuyển về COMPLETED
      const [remainingActiveComplaints, remainingPendingRefunds] = await Promise.all([
        tx.complaint.count({
          where: {
            orderId: txRecord.orderId,
            status: {
              in: [
                ComplaintStatus.OPEN,
                ComplaintStatus.PROPOSED,
                ComplaintStatus.UNDER_REVIEW,
              ],
            },
          },
        }),
        tx.paymentTransaction.count({
          where: {
            orderId: txRecord.orderId,
            id: { not: txRecord.id },
            type: TxType.REFUND,
            status: TxStatus.PENDING,
          },
        }),
      ])

      if (remainingActiveComplaints === 0 && remainingPendingRefunds === 0) {
        await tx.order.update({
          where: { id: txRecord.orderId },
          data: { status: OrderStatus.COMPLETED },
        })
      }

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

    try {
      await sendOrderNotification({
        type: 'REFUND_CONFIRMED',
        orderId: txRecord.orderId,
        transactionId: txRecord.id,
      })
    } catch (err) {
      console.error('[confirmRefundDone] Failed to send refund confirmed notification:', err)
    }

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
        grossPaid: paymentCalc.grossPaid,
        refundedAmount: paymentCalc.refundedAmount,
        hasPendingRefund,
        complaintResolved: !openComplaint,
        now: new Date(),
      }
    )

    if (!check.ok) {
      return { success: false, error: check.reason || 'Chưa đủ điều kiện hoàn thành đơn hàng' }
    }

    await db.$transaction(async (tx) => {
      // Quyết toán xuất kho và triệt tiêu reservation trên Sổ Cái FEFO nếu chưa thực xuất
      await dispatchOrderInventoryAllocations(tx, {
        orderId: order.id,
        orderCode: order.code,
        actorId: admin.id,
        reason: 'Đóng đơn hàng hoàn tất toàn diện (COMPLETED)',
      })

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

    try {
      await sendOrderNotification({
        type: 'ORDER_COMPLETED',
        orderId: order.id,
      })
    } catch (err) {
      console.error('[completeOrder] Failed to send order completed notification:', err)
    }

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

    if (input.photos.length > 5) {
      return { success: false, error: 'Tối đa 5 ảnh minh chứng cho một khiếu nại' }
    }

    // Xác thực an toàn: Mỗi ảnh phải gắn với đúng orderId này, ngăn chặn arbitrary URLs/keys
    for (const photo of input.photos) {
      const isLegitForOrder =
        photo.includes(`complaints%2F${input.orderId}%2F`) ||
        photo.includes(`complaints/${input.orderId}/`) ||
        photo.startsWith(`complaints/${input.orderId}/`) ||
        photo.startsWith('/uploads/')
      if (!isLegitForOrder) {
        return {
          success: false,
          error: 'Ảnh minh chứng không hợp lệ hoặc không thuộc đơn hàng này',
        }
      }
    }

    const order = await db.order.findUnique({
      where: { id: input.orderId },
      include: { items: true },
    })

    if (!order) return { success: false, error: 'Không tìm thấy đơn hàng' }

    if (order.userId !== session.user.id && session.user.role !== Role.ADMIN) {
      return { success: false, error: 'Bạn không có quyền khiếu nại cho đơn này' }
    }

    if (!order.deliveredAt) {
      return { success: false, error: 'Đơn hàng chưa ghi nhận thời điểm giao hàng thực tế' }
    }

    const now = new Date()
    const diffMs = now.getTime() - new Date(order.deliveredAt).getTime()
    if (diffMs < 0 || diffMs >= 24 * 60 * 60 * 1000) {
      return {
        success: false,
        error: 'Đã quá thời hạn khiếu nại 24 giờ kể từ thời điểm nhận hàng',
      }
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
        now,
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

      return { complaintId: complaint.id }
    })

    // DEV-TASK-47: E05 (COMPLAINT_OPENED) đã được tắt theo chính sách tinh gọn thông báo email

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
 * @deprecated Quy trình giải quyết đơn phương đã bị khóa theo chuẩn F02 Two-Way Complaint.
 * Không cho phép Admin tự ý giải quyết tạo refund bỏ qua phản hồi 48h của khách hàng.
 */
export async function resolveComplaint(_input: {
  complaintId: string
  verifiedGrams: number
  resolution: Resolution | 'REJECTED'
  adminNote?: string
}): Promise<{ success: boolean; error?: string; message?: string }> {
  void _input;
  return {
    success: false,
    error:
      'Quy trình giải quyết đơn phương đã bị khóa. Vui lòng sử dụng chức năng gửi đề xuất bồi thường (proposeComplaintResolution) theo chuẩn F02.',
  }
}

/**
 * Admin đưa ra Đề xuất bồi thường (Lần đầu hoặc Sau phúc tra) (F02: OPEN -> PROPOSED hoặc UNDER_REVIEW -> PROPOSED)
 * - Tự động thiết lập thời hạn phản hồi 48 giờ (reviewDueAt = proposedAt + 48h)
 * - Đánh dấu isFinalProposal = true nếu đang trong quy trình phúc tra
 * - TUYỆT ĐỐI KHÔNG sinh Transaction hoàn tiền ở thời điểm đề xuất (Phòng ngừa thất thoát tài chính)
 */
export async function proposeComplaintResolution(input: {
  complaintId: string
  proposalType: ComplaintResolutionType
  proposalAmount?: number
  verifiedGrams?: number
  proposalNotes?: string
}) {
  try {
    const admin = await requireAdmin()

    const complaint = await db.complaint.findUnique({
      where: { id: input.complaintId },
      include: {
        order: {
          include: {
            items: true,
          },
        },
      },
    })

    if (!complaint) {
      return { success: false, error: 'Không tìm thấy khiếu nại' }
    }

    if (
      complaint.status !== ComplaintStatus.OPEN &&
      complaint.status !== ComplaintStatus.UNDER_REVIEW
    ) {
      return {
        success: false,
        error: 'Chỉ có thể đưa ra đề xuất cho khiếu nại đang Mở (OPEN) hoặc đang Phúc tra (UNDER_REVIEW)',
      }
    }

    if (input.proposalType === ComplaintResolutionType.REPLACE_GOODS) {
      return {
        success: false,
        error:
          'Hình thức bù hàng chuyến sau (REPLACE_GOODS) chưa được hỗ trợ xử lý tự động trong phiên bản hiện tại (chưa có quy trình giữ tồn kho/tạo đơn bù Phase 8). Vui lòng chọn Hoàn tiền (REFUND_MONEY) hoặc Từ chối khiếu nại (REJECT_COMPLAINT).',
      }
    }

    // Đánh dấu đề xuất cuối cùng nếu khiếu nại đang ở vòng phúc tra
    const isFinalProposal =
      complaint.status === ComplaintStatus.UNDER_REVIEW || complaint.reReviewCount >= 1

    let proposalAmount = 0
    if (input.proposalType === ComplaintResolutionType.REFUND_MONEY) {
      if (input.proposalAmount !== undefined && input.proposalAmount >= 0) {
        proposalAmount = Math.round(input.proposalAmount)
      } else if (input.verifiedGrams !== undefined && input.verifiedGrams > 0) {
        const targetItem = complaint.order.items.find((i) => i.id === complaint.orderItemId)
        if (!targetItem) {
          return { success: false, error: 'Không tìm thấy sản phẩm khiếu nại trong đơn hàng' }
        }
        const actualGrams = targetItem.actualGrams ?? targetItem.orderedGrams
        const compCalc = computeComplaintCompensation({
          actualGrams,
          damagedGrams: input.verifiedGrams,
          unitPricePerKg: targetItem.unitPricePerKg,
        })
        proposalAmount = compCalc.compensation
      } else {
        return {
          success: false,
          error: 'Hình thức hoàn tiền yêu cầu cung cấp số tiền bồi thường hoặc khối lượng hao hụt xác nhận hợp lệ',
        }
      }
    }

    const proposedAt = new Date()
    const reviewDueAt = calculateReviewDeadline(proposedAt)

    const stateCheck = canTransitionComplaint(
      {
        status: complaint.status,
        reReviewCount: complaint.reReviewCount,
        isFinalProposal: complaint.isFinalProposal,
        reviewDueAt: complaint.reviewDueAt,
      },
      ComplaintStatus.PROPOSED,
      'ADMIN',
      {
        now: proposedAt,
        proposalType: input.proposalType,
        proposalAmount,
        verifiedGrams: input.verifiedGrams,
      }
    )

    if (!stateCheck.ok) {
      return { success: false, error: stateCheck.reason || 'Không thể gửi đề xuất bồi thường' }
    }

    await db.$transaction(async (tx) => {
      await tx.complaint.update({
        where: { id: complaint.id },
        data: {
          status: ComplaintStatus.PROPOSED,
          proposalType: input.proposalType,
          proposalAmount,
          proposalNotes: input.proposalNotes?.trim() || null,
          verifiedGrams: input.verifiedGrams ?? complaint.verifiedGrams,
          proposedAt,
          reviewDueAt,
          isFinalProposal,
        },
      })

      // TUYỆT ĐỐI KHÔNG TẠO REFUND TRANSACTION Ở ĐÂY.
      // Chỉ ghi nhận OrderEvent phục vụ Audit Log
      await recordOrderEvent(tx, {
        orderId: complaint.orderId,
        type: 'COMPLAINT_PROPOSED',
        actorId: admin.id,
        note: `Admin gửi ${isFinalProposal ? 'phương án bồi thường cuối cùng' : 'đề xuất bồi thường'}: ${
          input.proposalType === ComplaintResolutionType.REFUND_MONEY
            ? `Hoàn tiền ${proposalAmount.toLocaleString('vi-VN')} đ`
            : input.proposalType === ComplaintResolutionType.REPLACE_GOODS
            ? 'Bù hàng chuyến sau'
            : 'Từ chối bồi thường'
        }. Hạn phản hồi: 48 giờ.`,
        payload: {
          complaintId: complaint.id,
          proposalType: input.proposalType,
          proposalAmount,
          verifiedGrams: input.verifiedGrams,
          reviewDueAt: reviewDueAt.toISOString(),
          isFinalProposal,
        },
      })
    })

    // Gửi email thông báo đề xuất bồi thường cho khách hàng (Fail-safe, Phase 9)
    try {
      await sendOrderNotification({
        type: 'COMPLAINT_PROPOSED',
        orderId: complaint.orderId,
        complaintId: complaint.id,
        isFinalProposal,
      })
    } catch (emailErr) {
      console.error('[proposeComplaintResolution] Gửi email thông báo đề xuất thất bại:', emailErr)
    }

    revalidatePath('/admin/khieu-nai')
    revalidatePath(`/admin/don-hang/${complaint.orderId}`)
    revalidatePath(`/admin/don-hang/${complaint.order.code}`)
    revalidatePath(`/tai-khoan/don-hang/${complaint.order.code}`)

    return {
      success: true,
      message: `Đã gửi đề xuất bồi thường thành công. Hạn phản hồi: ${reviewDueAt.toLocaleString('vi-VN')}.`,
      data: {
        complaintId: complaint.id,
        reviewDueAt: reviewDueAt.toISOString(),
        isFinalProposal,
      },
    }
  } catch (error) {
    console.error('Error proposing complaint resolution:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Gửi đề xuất bồi thường thất bại',
    }
  }
}

/**
 * Khách hàng phản hồi đề xuất bồi thường (F02: PROPOSED -> CUSTOMER_ACCEPTED / UNDER_REVIEW / WITHDRAWN)
 * - Xác thực quyền sở hữu đơn hàng của người dùng hiện tại
 * - Kiểm tra nghiêm ngặt thời hạn 48 giờ (reviewDueAt)
 * - Phúc tra tối đa 1 lần duy nhất (reReviewCount = 0 -> 1) có khóa chống xung đột đồng thời
 * - BẢO VỆ TÀI CHÍNH BATCH B1: Khóa an toàn persistent finalization (hoàn tiền / tất toán / rút)
 */
export async function respondToComplaintProposal(input: {
  complaintId: string
  decision: 'ACCEPT' | 'REQUEST_REVIEW' | 'WITHDRAW'
  reason?: string
}) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user) {
      return { success: false, error: 'Vui lòng đăng nhập để phản hồi đề xuất' }
    }

    const complaint = await db.complaint.findUnique({
      where: { id: input.complaintId },
      include: {
        order: true,
      },
    })

    if (!complaint) {
      return { success: false, error: 'Không tìm thấy khiếu nại' }
    }

    // Xác thực quyền sở hữu: chỉ chủ đơn hàng hoặc Admin mới có quyền phản hồi
    if (complaint.order.userId !== session.user.id && session.user.role !== Role.ADMIN) {
      return { success: false, error: 'Bạn không có quyền phản hồi khiếu nại của đơn hàng này' }
    }

    if (complaint.status !== ComplaintStatus.PROPOSED) {
      return {
        success: false,
        error: `Khiếu nại đang ở trạng thái ${complaint.status}, không thể phản hồi đề xuất`,
      }
    }

    const now = new Date()

    // Kiểm tra thời hạn 48 giờ
    if (isComplaintProposalExpired(complaint.reviewDueAt, now)) {
      return {
        success: false,
        error: 'Thời hạn phản hồi 48 giờ cho đề xuất này đã kết thúc',
      }
    }

    // 1. Khách hàng yêu cầu Phúc tra (UNDER_REVIEW)
    if (input.decision === 'REQUEST_REVIEW') {
      const stateCheck = canTransitionComplaint(
        {
          status: complaint.status,
          reReviewCount: complaint.reReviewCount,
          isFinalProposal: complaint.isFinalProposal,
          reviewDueAt: complaint.reviewDueAt,
        },
        ComplaintStatus.UNDER_REVIEW,
        'CUSTOMER',
        {
          now,
          reason: input.reason,
        }
      )

      if (!stateCheck.ok) {
        return { success: false, error: stateCheck.reason || 'Không thể yêu cầu phúc tra' }
      }

      await db.$transaction(async (tx) => {
        // Khóa điều kiện an toàn chống race condition (chỉ cập nhật nếu reReviewCount vẫn là 0)
        const updateRes = await tx.complaint.updateMany({
          where: {
            id: complaint.id,
            status: ComplaintStatus.PROPOSED,
            reReviewCount: 0,
            isFinalProposal: false,
          },
          data: {
            status: ComplaintStatus.UNDER_REVIEW,
            reReviewCount: 1,
            reReviewReason: input.reason!.trim(),
            reReviewedAt: now,
          },
        })

        if (updateRes.count === 0) {
          throw new Error(
            'Yêu cầu phúc tra thất bại: khiếu nại đã được xử lý hoặc đã vượt quá số lần phúc tra cho phép'
          )
        }

        await recordOrderEvent(tx, {
          orderId: complaint.orderId,
          type: 'COMPLAINT_RE_REVIEW_REQUESTED',
          actorId: session.user.id,
          note: `Khách hàng yêu cầu phúc tra khiếu nại: ${input.reason!.trim()}`,
          payload: {
            complaintId: complaint.id,
            reReviewCount: 1,
            reason: input.reason!.trim(),
            requestedAt: now.toISOString(),
          },
        })
      })

      revalidatePath(`/tai-khoan/don-hang/${complaint.order.code}`)
      revalidatePath('/admin/khieu-nai')
      revalidatePath(`/admin/don-hang/${complaint.order.code}`)

      return {
        success: true,
        message: 'Đã gửi yêu cầu phúc tra tới Ban Quản Trị thành công',
      }
    }

    // 2. Khách hàng Đồng ý (ACCEPT) — HOÀN THIỆN TẤT TOÁN TÀI CHÍNH BATCH B2
    if (input.decision === 'ACCEPT') {
      const stateCheck = canTransitionComplaint(
        {
          status: complaint.status,
          reReviewCount: complaint.reReviewCount,
          isFinalProposal: complaint.isFinalProposal,
          reviewDueAt: complaint.reviewDueAt,
        },
        ComplaintStatus.CUSTOMER_ACCEPTED,
        'CUSTOMER',
        { now }
      )

      if (!stateCheck.ok) {
        return { success: false, error: stateCheck.reason || 'Không thể chấp thuận đề xuất' }
      }

      let createdRefundId: string | null = null

      await db.$transaction(async (tx) => {
        // Khóa điều kiện an toàn: Đảm bảo khiếu nại vẫn là PROPOSED và còn trong hạn 48h
        const updateRes = await tx.complaint.updateMany({
          where: {
            id: complaint.id,
            status: ComplaintStatus.PROPOSED,
            reviewDueAt: { gt: now },
          },
          data: {
            status: ComplaintStatus.CUSTOMER_ACCEPTED,
            customerAcceptedAt: now,
            resolvedAt: now,
            resolution:
              complaint.proposalType === ComplaintResolutionType.REFUND_MONEY
                ? Resolution.REFUND
                : complaint.proposalType === ComplaintResolutionType.REPLACE_GOODS
                ? Resolution.REPLACE
                : null,
            compensation: complaint.proposalAmount ?? 0,
          },
        })

        if (updateRes.count === 0) {
          throw new Error(
            'Chấp thuận đề xuất thất bại: thời hạn 48 giờ đã kết thúc hoặc trạng thái khiếu nại đã thay đổi'
          )
        }

        // Nếu phương án là hoàn tiền (REFUND_MONEY) và có số tiền bồi thường > 0:
        if (
          complaint.proposalType === ComplaintResolutionType.REFUND_MONEY &&
          complaint.proposalAmount &&
          complaint.proposalAmount > 0
        ) {
          // Idempotency: Kiểm tra xem đã có bản ghi REFUND nào gắn với khiếu nại này chưa
          const existingRefund = await tx.paymentTransaction.findFirst({
            where: {
              orderId: complaint.orderId,
              type: TxType.REFUND,
              reference: `COMPLAINT_${complaint.id}`,
            },
          })

          if (!existingRefund) {
            const newTx = await tx.paymentTransaction.create({
              data: {
                orderId: complaint.orderId,
                type: TxType.REFUND,
                status: TxStatus.PENDING,
                method: TxMethod.BANK_TRANSFER,
                amount: complaint.proposalAmount,
                reference: `COMPLAINT_${complaint.id}`,
                note: `Khoản bồi hoàn khiếu nại (${complaint.proposalAmount.toLocaleString('vi-VN')} đ) được khách chấp thuận`,
              },
            })
            createdRefundId = newTx.id
          } else {
            createdRefundId = existingRefund.id
          }

          // CHÚ Ý AN TOÀN TÀI CHÍNH PH9-00:
          // Vì có giao dịch hoàn tiền PENDING, đơn hàng KHÔNG chuyển sang COMPLETED ở đây!
          // Doanh thu đơn hàng tiếp tục bị đóng băng cho tới khi Admin thực hiện chuyển khoản và xác nhận confirmRefundDone().
        } else {
          // Đối với REPLACE_GOODS hoặc REJECT_COMPLAINT: Không tạo transaction hoàn tiền
          // Kiểm tra xem đơn hàng còn khiếu nại active nào khác hoặc refund pending nào không
          const [remainingActiveComplaints, remainingPendingRefunds] = await Promise.all([
            tx.complaint.count({
              where: {
                orderId: complaint.orderId,
                id: { not: complaint.id },
                status: {
                  in: [
                    ComplaintStatus.OPEN,
                    ComplaintStatus.PROPOSED,
                    ComplaintStatus.UNDER_REVIEW,
                  ],
                },
              },
            }),
            tx.paymentTransaction.count({
              where: {
                orderId: complaint.orderId,
                type: TxType.REFUND,
                status: TxStatus.PENDING,
              },
            }),
          ])

          if (remainingActiveComplaints === 0 && remainingPendingRefunds === 0) {
            await tx.order.update({
              where: { id: complaint.orderId },
              data: { status: OrderStatus.COMPLETED },
            })
          }
        }

        // Ghi Audit Event
        await recordOrderEvent(tx, {
          orderId: complaint.orderId,
          type: 'COMPLAINT_ACCEPTED',
          actorId: session.user.id,
          note: `Khách hàng đã đồng ý với đề xuất bồi thường (${
            complaint.proposalType === ComplaintResolutionType.REFUND_MONEY
              ? `Hoàn tiền ${(complaint.proposalAmount || 0).toLocaleString('vi-VN')} đ`
              : complaint.proposalType === ComplaintResolutionType.REPLACE_GOODS
              ? 'Bù hàng chuyến sau'
              : 'Từ chối bồi thường'
          })`,
          payload: {
            complaintId: complaint.id,
            proposalType: complaint.proposalType,
            proposalAmount: complaint.proposalAmount,
            refundTransactionId: createdRefundId,
            acceptedAt: now.toISOString(),
          },
        })
      })

      revalidatePath(`/tai-khoan/don-hang/${complaint.order.code}`)
      revalidatePath('/admin/khieu-nai')
      revalidatePath(`/admin/don-hang/${complaint.order.code}`)

      return {
        success: true,
        message: 'Đã chấp thuận đề xuất bồi thường thành công',
        data: {
          complaintId: complaint.id,
          status: ComplaintStatus.CUSTOMER_ACCEPTED,
          refundTransactionId: createdRefundId,
        },
      }
    }

    // 3. Khách hàng Rút khiếu nại (WITHDRAW) — HOÀN THIỆN BATCH B2
    if (input.decision === 'WITHDRAW') {
      const stateCheck = canTransitionComplaint(
        {
          status: complaint.status,
          reReviewCount: complaint.reReviewCount,
          isFinalProposal: complaint.isFinalProposal,
          reviewDueAt: complaint.reviewDueAt,
        },
        ComplaintStatus.WITHDRAWN,
        'CUSTOMER',
        { now }
      )

      if (!stateCheck.ok) {
        return { success: false, error: stateCheck.reason || 'Không thể rút khiếu nại' }
      }

      await db.$transaction(async (tx) => {
        const updateRes = await tx.complaint.updateMany({
          where: {
            id: complaint.id,
            status: {
              in: [
                ComplaintStatus.PROPOSED,
                ComplaintStatus.OPEN,
                ComplaintStatus.UNDER_REVIEW,
              ],
            },
          },
          data: {
            status: ComplaintStatus.WITHDRAWN,
            compensation: 0,
            resolution: null,
          },
        })

        if (updateRes.count === 0) {
          throw new Error('Rút khiếu nại thất bại: khiếu nại đã được xử lý hoặc trạng thái đã thay đổi')
        }

        // Kiểm tra xem đơn hàng còn khiếu nại active nào khác hoặc refund pending nào không
        const [remainingActiveComplaints, remainingPendingRefunds] = await Promise.all([
          tx.complaint.count({
            where: {
              orderId: complaint.orderId,
              id: { not: complaint.id },
              status: {
                in: [
                  ComplaintStatus.OPEN,
                  ComplaintStatus.PROPOSED,
                  ComplaintStatus.UNDER_REVIEW,
                ],
              },
            },
          }),
          tx.paymentTransaction.count({
            where: {
              orderId: complaint.orderId,
              type: TxType.REFUND,
              status: TxStatus.PENDING,
            },
          }),
        ])

        if (remainingActiveComplaints === 0 && remainingPendingRefunds === 0) {
          await tx.order.update({
            where: { id: complaint.orderId },
            data: { status: OrderStatus.COMPLETED },
          })
        }

        // Ghi Audit Event
        await recordOrderEvent(tx, {
          orderId: complaint.orderId,
          type: 'COMPLAINT_WITHDRAWN',
          actorId: session.user.id,
          note: 'Khách hàng đã tự nguyện rút khiếu nại. Khoản bồi thường: 0 đ.',
          payload: {
            complaintId: complaint.id,
            withdrawnAt: now.toISOString(),
          },
        })
      })

      revalidatePath(`/tai-khoan/don-hang/${complaint.order.code}`)
      revalidatePath('/admin/khieu-nai')
      revalidatePath(`/admin/don-hang/${complaint.order.code}`)

      return {
        success: true,
        message: 'Đã rút khiếu nại thành công',
        data: {
          complaintId: complaint.id,
          status: ComplaintStatus.WITHDRAWN,
        },
      }
    }

    return { success: false, error: 'Lựa chọn phản hồi không hợp lệ' }
  } catch (error) {
    console.error('Error responding to complaint proposal:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Phản hồi đề xuất thất bại',
    }
  }
}


/**
 * Server Action tự động rút toàn bộ khiếu nại quá thời hạn 48 giờ.
 * Có thể kích hoạt từ Admin giao diện hoặc Background Cron Job.
 */
export async function autoWithdrawExpiredComplaints(targetTime?: Date) {
  try {
    const { processExpiredComplaintProposals } = await import('@/lib/services/complaint-sla')
    const result = await processExpiredComplaintProposals(targetTime ?? new Date())
    revalidatePath('/admin/khieu-nai')
    return {
      success: true,
      processedCount: result.processedCount,
      complaintIds: result.complaintIds,
    }
  } catch (error) {
    console.error('Error auto-withdrawing expired complaints:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Tự động rút khiếu nại thất bại',
      processedCount: 0,
      complaintIds: [],
    }
  }
}
