import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { OrderStatus } from '@prisma/client'
import { upcomingDeliveryDates } from '@/lib/domain/recurring'
import {
  RecurringClient,
  RecurringScheduleClientItem,
  DraftOrderClientItem,
  CompletedOrderSummaryItem,
  CatalogProductItem,
  CustomerAddressItem,
} from './recurring-client'

export const dynamic = 'force-dynamic'

export default async function RecurringOrdersPage({
  searchParams,
}: {
  searchParams?: Promise<{ fromOrder?: string }>
}) {
  const session = await getServerAuthSession()
  if (!session?.user) {
    redirect('/dang-nhap?callbackUrl=/tai-khoan/dinh-ky')
  }

  const resolvedSearchParams = searchParams ? await searchParams : {}
  const initialFromOrderCode = resolvedSearchParams?.fromOrder

  const [schedulesRaw, draftOrdersRaw, completedOrdersRaw, productsRaw, addressesRaw] =
    await Promise.all([
      db.recurringSchedule.findMany({
        where: { userId: session.user.id },
        include: {
          items: true,
          _count: {
            select: { orders: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      db.order.findMany({
        where: {
          userId: session.user.id,
          status: OrderStatus.DRAFT,
        },
        include: {
          items: true,
          recurringSchedule: {
            select: { id: true, name: true },
          },
        },
        orderBy: [{ deliveryDate: 'asc' }, { createdAt: 'desc' }],
      }),
      db.order.findMany({
        where: {
          userId: session.user.id,
          status: OrderStatus.COMPLETED,
        },
        include: {
          items: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      db.product.findMany({
        where: { isActive: true },
        include: {
          packagings: {
            where: {
              isActive: true,
              isSample: false,
            },
            orderBy: { weightGrams: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      }),
      db.address.findMany({
        where: { userId: session.user.id },
        orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
      }),
    ])

  const products: CatalogProductItem[] = productsRaw
    .filter((p) => p.packagings.length > 0)
    .map((p) => ({
      id: p.id,
      name: p.name,
      moqGrams: p.moqGrams,
      leadTimeDays: p.leadTimeDays,
      packagings: p.packagings.map((pk) => ({
        id: pk.id,
        name: pk.name,
        weightGrams: pk.weightGrams,
      })),
    }))

  const productMap = new Map(productsRaw.map((p) => [p.id, p]))
  const now = new Date()

  const schedules: RecurringScheduleClientItem[] = schedulesRaw.map((sched) => {
    const mappedItems = sched.items.map((item) => {
      const prod = productMap.get(item.productId)
      const pkg = prod?.packagings.find((pk) => pk.id === item.packagingId)
      return {
        id: item.id,
        productId: item.productId,
        packagingId: item.packagingId,
        quantity: item.quantity,
        productName: prod?.name || 'Sản phẩm nông sản',
        packagingName: pkg?.name || 'Quy cách tiêu chuẩn',
        weightGrams: pkg?.weightGrams || 10000,
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
      addressId: sched.addressId,
      paymentOption: sched.paymentOption,
      isActive: sched.isActive,
      createdAt: sched.createdAt.toISOString(),
      upcomingDates: upcoming.map((d) => d.toISOString()),
      items: mappedItems,
      ordersCount: sched._count.orders,
    }
  })

  const draftOrders: DraftOrderClientItem[] = draftOrdersRaw.map((order) => ({
    id: order.id,
    code: order.code,
    scheduleId: order.recurringScheduleId,
    scheduleName: order.recurringSchedule?.name ?? null,
    deliveryDate: order.deliveryDate ? order.deliveryDate.toISOString() : null,
    timeSlot: order.timeSlot,
    paymentOption: order.paymentOption,
    subtotal: order.subtotal,
    shippingFee: order.shippingFee,
    total: order.total,
    depositAmount: order.depositAmount,
    customerNote: order.customerNote,
    items: order.items
      .filter((i) => !i.isSample)
      .map((i) => ({
        id: i.id,
        productId: i.productId,
        packagingId: i.packagingId,
        productName: i.productName,
        packagingName: i.packagingName,
        quantity: i.quantity,
        orderedGrams: i.orderedGrams,
        unitPricePerKg: i.unitPricePerKg,
        lineTotal: i.lineTotal,
      })),
  }))

  const completedOrders: CompletedOrderSummaryItem[] = completedOrdersRaw
    .map((order) => {
      const snapshotObj = order.addressSnapshot as Record<string, unknown> | null
      const addressId =
        snapshotObj && typeof snapshotObj.id === 'string' ? snapshotObj.id : null
      const regularItems = order.items.filter((i) => !i.isSample && i.quantity > 0)
      return {
        id: order.id,
        code: order.code,
        deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
        timeSlot: order.timeSlot,
        paymentOption: order.paymentOption,
        addressId,
        total: order.finalTotal ?? order.total,
        items: regularItems.map((i) => ({
          productId: i.productId,
          packagingId: i.packagingId,
          productName: i.productName,
          packagingName: i.packagingName,
          quantity: i.quantity,
          orderedGrams: i.orderedGrams,
        })),
      }
    })
    .filter((o) => o.items.length > 0)

  const addresses: CustomerAddressItem[] = addressesRaw.map((a) => ({
    id: a.id,
    label: a.label,
    recipient: a.recipient,
    phone: a.phone,
    street: a.line,
    ward: a.ward,
    district: a.district,
    province: a.province,
    isDefault: a.isDefault,
  }))

  return (
    <RecurringClient
      schedules={schedules}
      draftOrders={draftOrders}
      completedOrders={completedOrders}
      products={products}
      addresses={addresses}
      initialFromOrderCode={initialFromOrderCode}
    />
  )
}
