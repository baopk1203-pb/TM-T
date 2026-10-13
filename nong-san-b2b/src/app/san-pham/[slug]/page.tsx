import { notFound } from 'next/navigation'
import { StorefrontHeader } from '@/components/shop/storefront-header'
import { getProductBySlug } from '@/server/actions/product'
import { getServerAuthSession } from '@/lib/auth'
import { ProductDetailView } from './product-detail-view'

export const dynamic = 'force-dynamic'

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const [product, session] = await Promise.all([
    getProductBySlug(slug),
    getServerAuthSession(),
  ])

  if (!product) {
    notFound()
  }

  const user = session?.user
    ? {
        name: session.user.name,
        discountPercent: session.user.discountPercent || 0,
        role: session.user.role,
      }
    : null

  return (
    <div className="min-h-screen flex flex-col bg-slate-50/50">
      <StorefrontHeader />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <ProductDetailView product={product} user={user} />
      </main>

      <footer className="bg-white border-t border-slate-200 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-slate-500">
          <p>© 2026 Nông Sản B2B - Đồ án môn Thương mại Điện tử</p>
        </div>
      </footer>
    </div>
  )
}
