import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth'
import {
  User,
  MapPin,
  Package,
  CalendarDays,
  LayoutDashboard,
  Building2,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { BrandLogo } from '@/components/ui/brand-logo'
import { formatCustomerGroupBadge } from '@/lib/domain/crm'

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerAuthSession()
  if (!session?.user) {
    redirect('/dang-nhap?callbackUrl=/tai-khoan')
  }

  const user = session.user

  // Xác định badge nhóm từ dữ liệu DB đã đồng bộ (không hardcode theo mức 5% / 3%)
  const groupBadge = formatCustomerGroupBadge({
    code: user.groupCode,
    name: user.groupName,
    discountPercent: user.discountPercent,
  })

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <BrandLogo href="/" size="md" />

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-xs text-slate-500">
              Đăng nhập: <strong>{user.name}</strong>
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      {/* Main Account Area */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full flex-1">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-start">
          {/* Sidebar */}
          <aside className="md:col-span-1 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-6">
            <div className="border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center">
                  {user.name?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-slate-900 truncate text-sm">{user.name}</div>
                  <div className="text-xs text-slate-500 truncate">{user.email}</div>
                </div>
              </div>
              <div className="mt-2.5 flex items-center gap-1.5">
                <Badge variant="outline" className={`text-xs px-2 py-0.5 font-medium ${groupBadge.color}`}>
                  <Sparkles className="w-3 h-3 mr-1" />
                  {groupBadge.label}
                </Badge>
              </div>
              {user.companyName && (
                <div className="mt-2 text-xs text-slate-600 flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">{user.companyName}</span>
                </div>
              )}
            </div>

            <nav className="space-y-1">
              <Link
                href="/tai-khoan"
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
              >
                <LayoutDashboard className="w-4 h-4 text-slate-500" /> Tổng quan
              </Link>
              <Link
                href="/tai-khoan/don-hang"
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
              >
                <Package className="w-4 h-4 text-slate-500" /> Đơn hàng của tôi
              </Link>
              <Link
                href="/tai-khoan/dinh-ky"
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
              >
                <CalendarDays className="w-4 h-4 text-slate-500" /> Đơn hàng định kỳ
              </Link>
              <Link
                href="/tai-khoan/dia-chi"
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
              >
                <MapPin className="w-4 h-4 text-slate-500" /> Sổ địa chỉ nhận hàng
              </Link>
              <Link
                href="/tai-khoan/ho-so"
                className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
              >
                <User className="w-4 h-4 text-slate-500" /> Hồ sơ doanh nghiệp
              </Link>
            </nav>
          </aside>

          {/* Content */}
          <main className="md:col-span-3">{children}</main>
        </div>
      </div>
    </div>
  )
}
