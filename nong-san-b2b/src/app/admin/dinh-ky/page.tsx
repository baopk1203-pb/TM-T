import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { OrderType } from '@prisma/client'
import { upcomingDeliveryDates } from '@/lib/domain/recurring'
import {
  AdminRecurringClient,
  AdminRecurringScheduleItem,
  AdminRecurringOrderItem,
} from './admin-recurring-client'

export const dynamic = 'force-dynamic'

export default async function AdminRecurringPage() {
  await requireAdmin()

  const [schedulesRaw, recurringOrdersRaw, productsRaw] = await Promise.all([
    db.recurringSchedule.findMany({
      include: {
        user: {
          include: {
            group: true,
          },
        },
        items: true,
        _count: {
          select: { orders: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    db.order.findMany({
      where: {
        type: OrderType.RECURRING,
      },
      include: {
        user: {
          select: {
            fullName: true,
            companyName: true,
          },
        },
        recurringSchedule: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 50,
    }),
    db.product.findMany({
      include: {
        packagings: true,
      },
    }),
  ])

  const productMap = new Map(productsRaw.map((p) => [p.id, p]))
  const now = new Date()

  const schedules: AdminRecurringScheduleItem[] = schedulesRaw.map((sched) => {
    const items = sched.items.map((item) => {
      const prod = productMap.get(item.productId)
      const pkg = prod?.packagings.find((pk) => pk.id === item.packagingId)
      const weightGrams = pkg?.weightGrams ?? 10000
      return {
        id: item.id,
        productName: prod?.name ?? 'Sản phẩm',
        packagingName: pkg?.name ?? 'Quy cách',
        quantity: item.quantity,
        totalGrams: weightGrams * item.quantity,
      }
    })

    const leadTimes = sched.items
      .map((i) => productMap.get(i.productId)?.leadTimeDays ?? 1)
      .filter((d) => d > 0)
    const maxLeadTime = leadTimes.length > 0 ? Math.max(...leadTimes) : 1
    const upcoming = upcomingDeliveryDates(sched, now, maxLeadTime)

    return {
      id: sched.id,
      name: sched.name,
      weekdays: sched.weekdays,
      timeSlot: sched.timeSlot,
      paymentOption: sched.paymentOption,
      isActive: sched.isActive,
      createdAt: sched.createdAt.toISOString(),
      upcomingDates: upcoming.map((d) => d.toISOString()),
      customer: {
        id: sched.user.id,
        name: sched.user.fullName,
        companyName: sched.user.companyName,
        phone: sched.user.phone || '',
        groupName: sched.user.group?.name ?? null,
      },
      items,
      ordersCount: sched._count.orders,
    }
  })

  const orders: AdminRecurringOrderItem[] = recurringOrdersRaw.map((order) => ({
    id: order.id,
    code: order.code,
    status: order.status,
    paymentOption: order.paymentOption,
    deliveryDate: order.deliveryDate ? order.deliveryDate.toISOString() : null,
    timeSlot: order.timeSlot,
    total: order.total,
    depositAmount: order.depositAmount,
    createdAt: order.createdAt.toISOString(),
    scheduleName: order.recurringSchedule?.name ?? null,
    customerName: order.user.fullName,
    companyName: order.user.companyName,
  }))

  return <AdminRecurringClient schedules={schedules} orders={orders} />
}
