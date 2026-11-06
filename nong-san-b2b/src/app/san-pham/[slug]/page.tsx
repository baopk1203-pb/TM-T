import { notFound } from 'next/navigation'
import { StorefrontHeader } from '@/components/shop/storefront-header'
import { StorefrontFooter } from '@/components/shop/storefront-footer'
import { getProductBySlug } from '@/server/actions/product'
import { getServerAuthSession } from '@/lib/auth'
import { checkSamplePurchased } from '@/actions/cart'
import { db } from '@/lib/db'
import {
  MembershipTier,
  MEMBERSHIP_TIER_CONFIG,
  resolveEffectiveMembershipTier,
  calculateCombinedProductDiscount,
} from '@/lib/domain/membership'
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

  let user: {
    name?: string | null
    discountPercent: number
    role: string
    groupName?: string
    membershipTier?: MembershipTier | null
    membershipTierName?: string
    membershipDiscountPercent?: number
    combinedDiscountPercent?: number
  } | null = null

  let hasPurchasedSample = false

  if (session?.user?.id) {
    const [sampleCheck, dbUser] = await Promise.all([
      checkSamplePurchased(product.id),
      db.user.findUnique({
        where: { id: session.user.id },
        include: { group: true },
      }),
    ])

    hasPurchasedSample = sampleCheck

    const userDiscountPercent = dbUser?.group?.discountPercent ?? session.user.discountPercent ?? 0
    const groupName = dbUser?.group?.name ?? session.user.groupName ?? undefined
    const membershipTier = resolveEffectiveMembershipTier(
      dbUser as unknown as { role?: string; membershipTier?: MembershipTier | null }
    )
    const tierBenefits = membershipTier ? MEMBERSHIP_TIER_CONFIG[membershipTier] : null
    const membershipDiscountPercent = tierBenefits?.productDiscountPercent ?? 0
    const combinedDiscountPercent = calculateCombinedProductDiscount(
      userDiscountPercent,
      membershipDiscountPercent
    )

    user = {
      name: session.user.name,
      discountPercent: userDiscountPercent,
      role: session.user.role,
      groupName,
      membershipTier,
      membershipTierName: tierBenefits?.name,
      membershipDiscountPercent,
      combinedDiscountPercent,
    }
  }

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
