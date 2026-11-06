import { StorefrontHeader } from '@/components/shop/storefront-header'
import { StorefrontFooter } from '@/components/shop/storefront-footer'
import { getStorefrontProducts } from '@/server/actions/product'
import { getServerAuthSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { CatalogBrowser } from './catalog-browser'
import { BadgeCheck, Sparkles } from 'lucide-react'

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

  const user = session?.user
  const userDiscountPercent = user?.discountPercent || 0

  return (
    <div className="min-h-screen flex flex-col bg-slate-50/60 font-sans text-slate-900">
      <StorefrontHeader />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-8">
        {/* STITCH B2B CATALOG HERO BANNER */}
        <div className="rounded-3xl bg-gradient-to-r from-emerald-50 via-emerald-50/40 to-slate-50 p-6 sm:p-8 border border-emerald-100/80 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white text-emerald-800 text-xs font-semibold border border-emerald-200/80 shadow-2xs">
              <BadgeCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Nguồn hàng sỉ chuẩn vườn VietGAP &amp; GlobalGAP</span>
            </div>
            <h1 className="font-heading text-2xl sm:text-3xl lg:text-4xl font-extrabold text-slate-900 tracking-tight">
              Danh Mục Nông Sản &amp; Bảng Giá Sỉ Vụ Mùa
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Cung ứng số lượng lớn cho siêu thị, chuỗi cửa hàng hoa quả và đại lý cấp 1. Bảng giá nhảy theo bậc khối lượng đặt thực tế.
            </p>
          </div>

          {user && (
            <div className="rounded-2xl bg-white p-4 border border-emerald-200/70 shadow-xs shrink-0 text-right space-y-1">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                Tài khoản đối tác
              </span>
              <div className="font-heading font-bold text-slate-900 text-sm">
                {user.name}
              </div>
              {user.groupName && (
                <div className="text-xs text-emerald-700 font-medium">
                  Nhóm: <strong>{user.groupName}</strong>
                </div>
              )}
              {userDiscountPercent > 0 && (
                <div className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 mt-1">
                  <Sparkles className="w-3 h-3 text-emerald-600" /> Chiết khấu -{userDiscountPercent}%
                </div>
              )}
            </div>
          )}
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
