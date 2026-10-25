import { requireAdmin } from '@/lib/auth'
import { getAdminInventoryDashboardData } from '@/lib/services/inventory-read'
import { InventoryDashboardClient } from './inventory-dashboard-client'

export const dynamic = 'force-dynamic'

export default async function AdminInventoryDashboardPage() {
  await requireAdmin()
  const dashboardData = await getAdminInventoryDashboardData(new Date())

  return (
    <div className="space-y-6">
      <InventoryDashboardClient data={dashboardData} />
    </div>
  )
}
