import { requireAdmin } from '@/lib/auth'
import { getAdminBatchesInventoryView } from '@/lib/services/inventory-read'
import { db } from '@/lib/db'
import {
  isInventoryWriteEnabled,
  isInventoryAdjustmentEnabled,
} from '@/lib/domain/inventory-operations'
import { BatchManagement } from './batch-management'

export const dynamic = 'force-dynamic'

interface AdminBatchesPageProps {
  searchParams?: Promise<{
    productId?: string
    batchCode?: string
  }>
}

export default async function AdminBatchesPage({ searchParams }: AdminBatchesPageProps) {
  await requireAdmin()
  const resolvedSearchParams = searchParams ? await searchParams : {}

  const [inventoryViews, products] = await Promise.all([
    getAdminBatchesInventoryView(new Date()),
    db.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        farmId: true,
        inventoryTrackingEnabled: true,
        farm: { select: { id: true, name: true } },
      },
      orderBy: [{ inventoryTrackingEnabled: 'desc' }, { name: 'asc' }],
    }),
  ])

  const writeEnabled = isInventoryWriteEnabled()
  const adjustmentEnabled = isInventoryAdjustmentEnabled()

  return (
    <BatchManagement
      inventoryViews={inventoryViews}
      products={products}
      writeEnabled={writeEnabled}
      adjustmentEnabled={adjustmentEnabled}
      initialProductIdFilter={resolvedSearchParams.productId || 'ALL'}
      initialSearchQuery={resolvedSearchParams.batchCode || ''}
    />
  )
}
