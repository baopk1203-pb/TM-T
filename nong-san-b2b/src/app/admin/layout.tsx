import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth'
import { Role } from '@prisma/client'
import {
  LayoutDashboard,
  ShoppingCart,
  Apple,
  Warehouse,
  QrCode,
  CalendarRange,
  Users,
  Percent,
  AlertCircle,
  Repeat,
  BarChart3,
  Truck,
  Bell,
  LogOut,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const navItems = [
  { label: 'Bảng điều khiển', href: '/admin', icon: LayoutDashboard },
  { label: 'Quản lý đơn hàng', href: '/admin/don-hang', icon: ShoppingCart },
  { label: 'Sản phẩm & Giá bậc', href: '/admin/san-pham', icon: Apple },
  { label: 'Nhà vườn & Chứng nhận', href: '/admin/nha-vuon', icon: Warehouse },
  { label: 'Lô hàng & Mã QR', href: '/admin/lo-hang', icon: QrCode },
  { label: 'Sản lượng theo tuần', href: '/admin/san-luong', icon: CalendarRange },
  { label: 'Khách hàng & Đối tác', href: '/admin/khach-hang', icon: Users },
  { label: 'Nhóm khách & Chiết khấu', href: '/admin/nhom-khach', icon: Percent },
  { label: 'Xử lý khiếu nại', href: '/admin/khieu-nai', icon: AlertCircle },
  { label: 'Lịch đơn định kỳ', href: '/admin/dinh-ky', icon: Repeat },
  { label: 'Báo cáo & Thống kê', href: '/admin/bao-cao', icon: BarChart3 },
  { label: 'Quản lý vận chuyển', href: '/admin/van-chuyen', icon: Truck, badge: 'Phase 8' },
  { label: 'Nhật ký thông báo', href: '/admin/thong-bao', icon: Bell, badge: 'Phase 9' },
]

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerAuthSession()

  if (!session?.user) {
    redirect('/dang-nhap?callbackUrl=/admin')
  }

  if (session.user.role !== Role.ADMIN) {
    redirect('/')
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-slate-900 text-slate-300 flex flex-col shrink-0">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-bold">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <span className="font-bold text-white text-base tracking-tight block">
                ADMIN B2B
              </span>
              <span className="text-[11px] text-slate-400 block">Ban Vận Hành Hệ Thống</span>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-slate-400" />
                  <span>{item.label}</span>
                </div>
                {item.badge && (
                  <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-slate-700 text-slate-400">
                    {item.badge}
                  </Badge>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-2">
          <Link href="/" target="_blank">
            <Button
              variant="outline"
              size="sm"
              className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 text-xs justify-start"
            >
              <ExternalLink className="w-3.5 h-3.5 mr-2" /> Xem Website Storefront
            </Button>
          </Link>
          <Link href="/api/auth/signout">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 text-xs justify-start"
            >
              <LogOut className="w-3.5 h-3.5 mr-2" /> Đăng xuất Admin
            </Button>
          </Link>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 h-16 px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">
              Quyền: Quản trị viên tối cao
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-600">
            <span>
              Người trực: <strong>{session.user.name}</strong> ({session.user.email})
            </span>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
