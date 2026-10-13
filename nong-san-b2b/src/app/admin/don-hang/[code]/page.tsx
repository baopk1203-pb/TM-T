import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { derivePaymentStatus } from '@/lib/domain/settlement'
import { OrderDetailClient, OrderDetailData } from './order-detail-client'

export const dynamic = 'force-dynamic'

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params

  const order = await db.order.findFirst({
    where: {
      OR: [{ code }, { id: code }],
    },
    include: {
      user: {
        include: {
          group: true,
        },
      },
      items: true,
      transactions: {
        orderBy: { createdAt: 'desc' },
      },
      events: {
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  if (!order) {
    notFound()
  }

  const payment = derivePaymentStatus(
    {
      total: order.total,
      finalTotal: order.finalTotal,
      status: order.status,
    },
    order.transactions
  )

  interface AdminAddressSnapshot {
    recipient?: string
    phone?: string
    line?: string
    ward?: string
    district?: string
    province?: string
  }

  const addressSnapshot = (order.addressSnapshot as unknown as AdminAddressSnapshot) || {}

  const orderData: OrderDetailData = {
    id: order.id,
    code: order.code,
    type: order.type,
    status: order.status,
    paymentOption: order.paymentOption,
    groupDiscountPercent: order.groupDiscountPercent,
    deliveryDate: order.deliveryDate ? order.deliveryDate.toISOString() : null,
    timeSlot: order.timeSlot,
    subtotal: order.subtotal,
    shippingFee: order.shippingFee,
    total: order.total,
    depositAmount: order.depositAmount,
    finalSubtotal: order.finalSubtotal,
    finalTotal: order.finalTotal,
    paymentDueAt: order.paymentDueAt ? order.paymentDueAt.toISOString() : null,
    deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
    cancelledBy: order.cancelledBy,
    cancelReason: order.cancelReason,
    customerNote: order.customerNote,
    createdAt: order.createdAt.toISOString(),
    addressSnapshot: {
      recipient: addressSnapshot?.recipient ?? '',
      phone: addressSnapshot?.phone ?? '',
      line: addressSnapshot?.line ?? '',
      ward: addressSnapshot?.ward ?? '',
      district: addressSnapshot?.district ?? '',
      province: addressSnapshot?.province ?? '',
    },
    user: {
      id: order.user.id,
      fullName: order.user.fullName,
      email: order.user.email,
      phone: order.user.phone,
      companyName: order.user.companyName,
      groupName: order.user.group?.name ?? null,
      groupDiscount: order.user.group?.discountPercent ?? 0,
    },
    items: order.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      packagingName: item.packagingName,
      isSample: item.isSample,
      quantity: item.quantity,
      orderedGrams: item.orderedGrams,
      unitPricePerKg: item.unitPricePerKg,
      lineTotal: item.lineTotal,
      actualGrams: item.actualGrams,
      finalLineTotal: item.finalLineTotal,
    })),
    transactions: order.transactions.map((tx) => ({
      id: tx.id,
      type: tx.type,
      status: tx.status,
      method: tx.method,
      amount: tx.amount,
      reference: tx.reference,
      note: tx.note,
      createdAt: tx.createdAt.toISOString(),
      completedAt: tx.completedAt ? tx.completedAt.toISOString() : null,
    })),
    events: order.events.map((evt) => ({
      id: evt.id,
      type: evt.type,
      fromStatus: evt.fromStatus,
      toStatus: evt.toStatus,
      note: evt.note,
      actorId: evt.actorId,
      createdAt: evt.createdAt.toISOString(),
      payload: evt.payload,
    })),
    paidAmount: payment.paidAmount,
    remainingAmount: payment.remainingAmount,
    paymentStatus: payment.status,
  }

  return <OrderDetailClient order={orderData} />
}
