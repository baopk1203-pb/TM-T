import { Role } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { GroupManagementClient, type AdminCustomerGroupItem } from './group-management'

export const dynamic = 'force-dynamic'

export default async function AdminCustomerGroupsPage() {
  await requireAdmin()

  const rawGroups = await db.customerGroup.findMany({
    include: {
      users: {
        where: { role: Role.CUSTOMER },
        select: { id: true },
      },
    },
    orderBy: [{ discountPercent: 'desc' }, { code: 'asc' }],
  })

  const initialGroups: AdminCustomerGroupItem[] = rawGroups.map((g) => ({
    id: g.id,
    code: g.code,
    name: g.name,
    discountPercent: g.discountPercent,
    isDefault: g.isDefault,
    customerCount: g.users.length,
    updatedAt: g.updatedAt.toISOString(),
  }))

  return <GroupManagementClient initialGroups={initialGroups} />
}
