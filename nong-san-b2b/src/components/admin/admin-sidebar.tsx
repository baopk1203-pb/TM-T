'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  ShoppingCart,
  Apple,
  Warehouse,
  QrCode,
  Boxes,
  History,
  Users,
  Percent,
  AlertCircle,
  Repeat,
  BarChart3,
  Truck,
  Bell,
  ExternalLink,
  Menu,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { BrandLogo } from '@/components/ui/brand-logo'

export interface AdminNavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
  group: string
}

export interface AdminNavGroup {
  title: string
  items: Array<{
    label: string
    href: string
    icon: React.ComponentType<{ className?: string }>
    badge?: string
  }>
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    title: 'Tổng quan & Bán hàng',
    items: [
      { label: 'Bảng điều khiển', href: '/admin', icon: LayoutDashboard },
      { label: 'Quản lý đơn hàng', href: '/admin/don-hang', icon: ShoppingCart },
      { label: 'Lịch đơn định kỳ', href: '/admin/dinh-ky', icon: Repeat },
    ],
  },
  {
    title: 'Nông sản & Nhà vườn',
    items: [
      { label: 'Sản phẩm & Giá bậc', href: '/admin/san-pham', icon: Apple },
      { label: 'Nhà vườn & Chứng nhận', href: '/admin/nha-vuon', icon: Warehouse },
      { label: 'Quản lý tồn kho FEFO', href: '/admin/ton-kho', icon: Boxes },
      { label: 'Lô hàng & Mã QR', href: '/admin/lo-hang', icon: QrCode },
      { label: 'Sổ cái kho (Ledger)', href: '/admin/ton-kho/lich-su', icon: History },
    ],
  },
  {
    title: 'Đối tác & Khách hàng',
    items: [
      { label: 'Khách hàng & Đối tác', href: '/admin/khach-hang', icon: Users },
      { label: 'Nhóm khách & Chiết khấu', href: '/admin/nhom-khach', icon: Percent },
      { label: 'Xử lý khiếu nại', href: '/admin/khieu-nai', icon: AlertCircle },
    ],
  },
  {
    title: 'Vận hành & Hệ thống',
    items: [
      { label: 'Quản lý vận chuyển', href: '/admin/van-chuyen', icon: Truck },
      { label: 'Nhật ký thông báo', href: '/admin/thong-bao', icon: Bell },
      { label: 'Báo cáo & Thống kê', href: '/admin/bao-cao', icon: BarChart3 },
    ],
  },
]

interface AdminSidebarProps {
  user: {
    name: string
    email: string
  }
}

export function AdminSidebar({ user }: AdminSidebarProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  const isItemActive = (href: string) => {
    if (href === '/admin' || href === '/admin/ton-kho') {
      return pathname === href
    }
    return pathname === href || pathname.startsWith(href + '/')
  }

  const renderNavList = () => (
    <div className="space-y-6">
      {ADMIN_NAV_GROUPS.map((group) => (
        <div key={group.title} className="space-y-1.5">
          <div className="px-3 text-[10px] font-extrabold uppercase tracking-wider text-emerald-300/60 font-mono">
            {group.title}
          </div>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon
              const active = isItemActive(item.href)

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all ${
                    active
                      ? 'bg-emerald-600 text-white font-bold shadow-xs ring-1 ring-white/10'
                      : 'text-emerald-100/75 hover:bg-[#065F46] hover:text-white font-medium'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-white' : 'text-emerald-300/80'}`} />
                    <span className="truncate">{item.label}</span>
                  </div>
                  {item.badge && (
                    <Badge
                      variant="outline"
                      className={`text-[9px] py-0 px-1.5 rounded-full border-emerald-500/30 ${
                        active ? 'bg-white/20 text-white' : 'bg-emerald-950/40 text-emerald-300'
                      }`}
                    >
                      {item.badge}
                    </Badge>
                  )}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )

  const initials = user.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'AD'

  return (
    <>
      {/* Mobile Top Bar */}
      <div className="md:hidden bg-[#064E3B] text-white px-4 py-3 flex items-center justify-between border-b border-emerald-900 sticky top-0 z-40 shadow-xs">
        <BrandLogo
          variant="dark"
          size="sm"
          subtitleText="Ban Vận Hành B2B"
          showSubtitle={true}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMobileOpen(true)}
          className="text-white hover:bg-emerald-800 p-2 h-9 w-9 rounded-xl"
          aria-label="Mở menu quản trị"
        >
          <Menu className="w-5 h-5" />
        </Button>
      </div>

      {/* Mobile Drawer Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 md:hidden transition-opacity"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile Drawer Content */}
      <div
        className={`fixed inset-y-0 left-0 w-72 bg-[#064E3B] text-slate-100 z-50 transform transition-transform duration-300 ease-in-out md:hidden flex flex-col justify-between shadow-2xl ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-5 border-b border-emerald-900/60 flex items-center justify-between">
          <BrandLogo
            variant="dark"
            size="sm"
            subtitleText="Ban Vận Hành B2B"
            showSubtitle={true}
          />
          <button
            onClick={() => setMobileOpen(false)}
            className="p-1.5 rounded-lg text-emerald-200 hover:text-white hover:bg-emerald-800"
            aria-label="Đóng menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-4 overflow-y-auto">
          {renderNavList()}
        </nav>

        <div className="p-4 border-t border-emerald-900/60 space-y-3 bg-[#053d2e]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-emerald-700 text-white flex items-center justify-center font-bold text-xs shrink-0 ring-2 ring-emerald-500/30">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-xs text-white truncate">{user.name}</div>
              <div className="text-[11px] text-emerald-200/70 truncate">{user.email}</div>
            </div>
          </div>
          <div className="space-y-1 pt-1">
            <Link href="/" target="_blank" className="block">
              <Button
                variant="outline"
                size="sm"
                className="w-full bg-emerald-900/40 hover:bg-emerald-800 text-emerald-100 border-emerald-700/60 text-xs justify-start rounded-xl h-8"
              >
                <ExternalLink className="w-3.5 h-3.5 mr-2" /> Xem Website Storefront
              </Button>
            </Link>
            <SignOutButton
              variant="ghost"
              size="sm"
              className="w-full text-rose-300 hover:text-rose-200 hover:bg-rose-950/40 text-xs justify-start rounded-xl h-8"
            >
              Đăng xuất Admin
            </SignOutButton>
          </div>
        </div>
      </div>

      {/* Desktop Persistent Sidebar */}
      <aside className="hidden md:flex w-64 lg:w-72 bg-[#064E3B] text-slate-100 flex-col shrink-0 border-r border-emerald-950/40 h-screen sticky top-0 shadow-sm">
        <div className="p-5 border-b border-emerald-900/60 flex items-center justify-between">
          <BrandLogo
            variant="dark"
            size="md"
            subtitleText="Ban Vận Hành B2B"
            showSubtitle={true}
          />
        </div>

        <nav className="flex-1 p-3.5 space-y-1 overflow-y-auto">
          {renderNavList()}
        </nav>

        {/* Live Status Pill */}
        <div className="px-4 py-2">
          <div className="p-2.5 rounded-xl bg-[#065F46]/50 border border-emerald-500/20 flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-100 font-medium">Hệ thống B2B E Vibe</span>
            </div>
            <span className="text-[10px] text-emerald-300 font-bold uppercase tracking-wider">Trực tuyến</span>
          </div>
        </div>

        {/* User Card & Actions */}
        <div className="p-4 border-t border-emerald-900/60 space-y-2.5 bg-[#053d2e]/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-emerald-700 text-white flex items-center justify-center font-bold text-xs shrink-0 ring-2 ring-emerald-500/30">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-xs text-white truncate">{user.name}</div>
              <div className="text-[10px] text-emerald-200/70 truncate">{user.email}</div>
            </div>
          </div>

          <div className="space-y-1 pt-1">
            <Link href="/" target="_blank" className="block">
              <Button
                variant="outline"
                size="sm"
                className="w-full bg-emerald-900/40 hover:bg-emerald-800 text-emerald-100 border-emerald-700/60 text-xs justify-start rounded-xl h-8"
              >
                <ExternalLink className="w-3.5 h-3.5 mr-2 text-emerald-300" /> Xem Website Storefront
              </Button>
            </Link>
            <SignOutButton
              variant="ghost"
              size="sm"
              className="w-full text-rose-300 hover:text-rose-200 hover:bg-rose-950/40 text-xs justify-start rounded-xl h-8"
            >
              Đăng xuất Admin
            </SignOutButton>
          </div>
        </div>
      </aside>
    </>
  )
}
