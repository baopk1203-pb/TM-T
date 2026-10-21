import { notFound } from 'next/navigation'
import { StorefrontHeader } from '@/components/shop/storefront-header'
import { StorefrontFooter } from '@/components/shop/storefront-footer'
import { getProductBySlug } from '@/server/actions/product'
import { getServerAuthSession } from '@/lib/auth'
import { checkSamplePurchased } from '@/actions/cart'
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

  const hasPurchasedSample = session?.user?.id
    ? await checkSamplePurchased(product.id)
    : false

  const user = session?.user
    ? {
        name: session.user.name,
        discountPercent: session.user.discountPercent || 0,
        role: session.user.role,
        groupName: session.user.groupName || undefined,
      }
    : null

  return (
    <div className="min-h-screen flex flex-col bg-slate-50/50">
      <StorefrontHeader />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <ProductDetailView
          product={product}
          user={user}
          hasPurchasedSample={hasPurchasedSample}
        />
      </main>

      <StorefrontFooter />
    </div>
  )
}
