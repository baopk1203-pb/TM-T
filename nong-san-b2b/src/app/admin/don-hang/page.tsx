import { db } from '@/lib/db'
import { derivePaymentStatus } from '@/lib/domain/settlement'
import { processExpiredOrders } from '@/lib/services/order-expiration'
import { OrderListClient, AdminOrderListItem } from './order-list-client'

export const dynamic = 'force-dynamic'

export default async function AdminOrdersPage() {
  await processExpiredOrders(new Date()).catch(() => undefined)

  const orders = await db.order.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      user: {
        include: {
          group: true,
        },
      },
      items: true,
      transactions: true,
    },
  })

  const mappedOrders: AdminOrderListItem[] = orders.map((order) => {
    const payment = derivePaymentStatus(
      {
        total: order.total,
        finalTotal: order.finalTotal,
        status: order.status,
      },
      order.transactions
    )

    const totalGrams = order.items.reduce((sum, item) => sum + item.orderedGrams, 0)

    return {
      id: order.id,
      code: order.code,
      createdAt: order.createdAt.toISOString(),
      paymentDueAt: order.paymentDueAt ? order.paymentDueAt.toISOString() : null,
      deliveryDate: order.deliveryDate ? order.deliveryDate.toISOString() : null,
      timeSlot: order.timeSlot,
      status: order.status,
      paymentOption: order.paymentOption,
      subtotal: order.subtotal,
      shippingFee: order.shippingFee,
      total: order.total,
      depositAmount: order.depositAmount,
      finalTotal: order.finalTotal,
      customerNote: order.customerNote,
      user: {
        id: order.user.id,
        fullName: order.user.fullName,
        companyName: order.user.companyName,
        phone: order.user.phone,
        email: order.user.email,
        groupName: order.user.group?.name ?? null,
      },
      itemCount: order.items.length,
      totalGrams,
      paidAmount: payment.paidAmount,
      paymentStatus: payment.status,
    }
  })

  return <OrderListClient initialOrders={mappedOrders} />
}
