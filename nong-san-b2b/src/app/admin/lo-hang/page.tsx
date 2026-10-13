import { getAdminBatches } from '@/server/actions/batch'
import { db } from '@/lib/db'
import { BatchManagement } from './batch-management'

export const dynamic = 'force-dynamic'

export default async function AdminBatchesPage() {
  const [batches, products] = await Promise.all([
    getAdminBatches(),
    db.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        farmId: true,
        farm: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    }),
  ])

  return <BatchManagement initialBatches={batches} products={products} />
}
