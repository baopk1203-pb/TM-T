import { getAdminWeeklyCapacities } from '@/server/actions/capacity'
import { CapacityMatrix } from './capacity-matrix'

export const dynamic = 'force-dynamic'

export default async function AdminCapacitiesPage() {
  const { weeks, products, capacities } = await getAdminWeeklyCapacities()

  return (
    <CapacityMatrix
      weeks={weeks}
      products={products}
      initialCapacities={capacities}
    />
  )
}
