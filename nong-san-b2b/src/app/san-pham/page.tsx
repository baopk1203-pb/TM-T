import { StorefrontHeader } from '@/components/shop/storefront-header'
import { StorefrontFooter } from '@/components/shop/storefront-footer'
import { getStorefrontProducts } from '@/server/actions/product'
import { getServerAuthSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { CatalogBrowser } from './catalog-browser'

export const dynamic = 'force-dynamic'

export default async function ProductsCatalogPage() {
  const [products, farms, session] = await Promise.all([
    getStorefrontProducts(),
    db.farm.findMany({
      select: { id: true, name: true, province: true },
      orderBy: { name: 'asc' },
    }),
    getServerAuthSession(),
  ])

  const userDiscountPercent = session?.user?.discountPercent || 0

  return (
    <div className="min-h-screen flex flex-col bg-slate-50/50">
      <StorefrontHeader />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-8">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            Danh Mục Nông Sản & Bảng Giá Sỉ Vụ Mùa
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-3xl">
            Cung ứng số lượng lớn cho siêu thị, chuỗi cửa hàng hoa quả và đại lý cấp 1. Bảng giá nhảy theo bậc khối lượng đặt thực tế.
          </p>
        </div>

        <CatalogBrowser
          products={products}
          farms={farms}
          userDiscountPercent={userDiscountPercent}
        />
      </main>

      <StorefrontFooter />
    </div>
  )
}
