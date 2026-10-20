import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { Role } from '@prisma/client'
import { computeCustomerOrderStats } from '@/lib/domain/crm'
import { derivePaymentStatus } from '@/lib/domain/settlement'
import {
  CustomerManagementClient,
  AdminCustomerListItem,
  AdminCustomerGroupOption,
} from './customer-management'

export const dynamic = 'force-dynamic'

export default async function AdminCustomersPage() {
  await requireAdmin()

  const [customers, groups] = await Promise.all([
    db.user.findMany({
      where: { role: Role.CUSTOMER },
      include: {
        group: true,
        addresses: {
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          include: {
            items: {
              select: {
                id: true,
                orderedGrams: true,
                actualGrams: true,
              },
            },
            transactions: {
              select: {
                type: true,
                status: true,
                amount: true,
              },
            },
            complaints: {
              select: {
                status: true,
                resolution: true,
                compensation: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    db.customerGroup.findMany({
      orderBy: { discountPercent: 'desc' },
    }),
  ])

  const mappedCustomers: AdminCustomerListItem[] = customers.map((customer) => {
    const stats = computeCustomerOrderStats(
      customer.orders.map((o) => ({
        status: o.status,
        total: o.total,
        finalTotal: o.finalTotal,
        complaints: o.complaints,
      }))
    )

    return {
      id: customer.id,
      fullName: customer.fullName,
      email: customer.email,
      phone: customer.phone,
      companyName: customer.companyName,
      taxCode: customer.taxCode,
      createdAt: customer.createdAt.toISOString(),
      groupId: customer.groupId,
      groupCode: customer.group?.code ?? 'SMALL_SHOP',
      groupName: customer.group?.name ?? 'Cửa hàng nhỏ',
      discountPercent: customer.group?.discountPercent ?? 0,
      orderCount: stats.orderCount,
      completedOrderCount: stats.completedOrderCount,
      completedRevenue: stats.completedRevenue,
      activeOrderCount: stats.activeOrderCount,
      cancelledOrderCount: stats.cancelledOrderCount,
      draftOrderCount: stats.draftOrderCount,
      addresses: customer.addresses.map((addr) => ({
        id: addr.id,
        label: addr.label,
        recipient: addr.recipient,
        phone: addr.phone,
        line: addr.line,
        ward: addr.ward,
        district: addr.district,
        province: addr.province,
        isDefault: addr.isDefault,
      })),
      orders: customer.orders.map((ord) => {
        const payment = derivePaymentStatus(
          {
            total: ord.total,
            finalTotal: ord.finalTotal,
            status: ord.status,
          },
          ord.transactions
        )
        const totalGrams = ord.items.reduce(
          (sum, item) => sum + (item.actualGrams ?? item.orderedGrams),
          0
        )

        return {
          id: ord.id,
          code: ord.code,
          type: ord.type,
          status: ord.status,
          paymentStatus: payment.status,
          groupDiscountPercent: ord.groupDiscountPercent,
          total: ord.total,
          finalTotal: ord.finalTotal,
          totalGrams,
          createdAt: ord.createdAt.toISOString(),
          deliveryDate: ord.deliveryDate ? ord.deliveryDate.toISOString() : null,
        }
      }),
    }
  })

  const mappedGroups: AdminCustomerGroupOption[] = groups.map((g) => ({
    id: g.id,
    code: g.code,
    name: g.name,
    discountPercent: g.discountPercent,
    isDefault: g.isDefault,
  }))

  return (
    <CustomerManagementClient
      initialCustomers={mappedCustomers}
      groups={mappedGroups}
    />
  )
}
