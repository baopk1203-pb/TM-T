import { notFound, redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { derivePaymentStatus } from '@/lib/domain/settlement'
import { CustomerOrderView, CustomerOrderData } from './customer-order-view'
import { Role } from '@prisma/client'

export const dynamic = 'force-dynamic'

export default async function CustomerOrderDetailPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const session = await getServerAuthSession()
  if (!session?.user) {
    redirect('/dang-nhap')
  }

  const { code } = await params

  const order = await db.order.findFirst({
    where: {
      OR: [{ code }, { id: code }],
    },
    include: {
      items: {
        include: {
          batch: true,
        },
      },
      transactions: {
        orderBy: { createdAt: 'desc' },
      },
      events: {
        orderBy: { createdAt: 'desc' },
      },
      complaints: {
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  if (!order) {
    notFound()
  }

  // Khách chỉ được xem đơn của mình (trừ Admin)
  if (order.userId !== session.user.id && session.user.role !== Role.ADMIN) {
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

  interface AddressSnapshot {
    recipient?: string
    phone?: string
    line?: string
    ward?: string
    district?: string
    province?: string
  }

  const address = (order.addressSnapshot as unknown as AddressSnapshot) || {}

  const orderData: CustomerOrderData = {
    id: order.id,
    code: order.code,
    status: order.status,
    paymentOption: order.paymentOption,
    subtotal: order.subtotal,
    shippingFee: order.shippingFee,
    total: order.total,
    depositAmount: order.depositAmount,
    finalSubtotal: order.finalSubtotal,
    finalTotal: order.finalTotal,
    deliveryDate: order.deliveryDate ? order.deliveryDate.toISOString() : null,
    timeSlot: order.timeSlot,
    deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
    paymentDueAt: order.paymentDueAt ? order.paymentDueAt.toISOString() : null,
    createdAt: order.createdAt.toISOString(),
    cancelledBy: order.cancelledBy,
    cancelReason: order.cancelReason,
    addressSnapshot: {
      recipient: address.recipient,
      phone: address.phone,
      line: address.line,
      ward: address.ward,
      district: address.district,
      province: address.province,
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
      batchCode: item.batch?.code ?? null,
    })),
    transactions: order.transactions.map((tx) => ({
      id: tx.id,
      type: tx.type,
      status: tx.status,
      method: tx.method,
      amount: tx.amount,
      createdAt: tx.createdAt.toISOString(),
    })),
    events: order.events.map((evt) => ({
      id: evt.id,
      type: evt.type,
      note: evt.note,
      createdAt: evt.createdAt.toISOString(),
    })),
    complaints: order.complaints.map((c) => ({
      id: c.id,
      orderItemId: c.orderItemId,
      reportedGrams: c.reportedGrams,
      verifiedGrams: c.verifiedGrams,
      description: c.description,
      photos: c.photos,
      status: c.status,
      resolution: c.resolution,
      compensation: c.compensation,
      createdAt: c.createdAt.toISOString(),
    })),
    paidAmount: payment.paidAmount,
    remainingAmount: payment.remainingAmount,
    paymentStatus: payment.status,
  }

  return <CustomerOrderView order={orderData} />
}
