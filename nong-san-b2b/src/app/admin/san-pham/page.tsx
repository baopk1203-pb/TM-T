import { getAdminProducts } from '@/server/actions/product'
import { getAdminFarms } from '@/server/actions/farm'
import { ProductManagement } from './product-management'

export const dynamic = 'force-dynamic'

export default async function AdminProductsPage() {
  const [products, farms] = await Promise.all([
    getAdminProducts(),
    getAdminFarms(),
  ])

  const farmOptions = farms.map((f) => ({
    id: f.id,
    name: f.name,
    province: f.province,
  }))

  return (
    <ProductManagement
      initialProducts={products}
      farms={farmOptions}
    />
  )
}
