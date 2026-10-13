import Link from 'next/link'
import { Leaf, User, Shield } from 'lucide-react'
import { getServerAuthSession } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CartButton } from '@/components/shop/cart-button'

export async function StorefrontHeader() {
  const session = await getServerAuthSession()
  const user = session?.user

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-sm">
            <Leaf className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight text-slate-900">
              NÔNG SẢN <span className="text-emerald-600">B2B</span>
            </span>
            <span className="block text-[11px] font-medium text-slate-500 uppercase tracking-wider">
              Phân phối sỉ trái cây chuẩn vườn
            </span>
          </div>
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <Link href="/" className="hover:text-emerald-700 transition-colors">
            Trang chủ
          </Link>
          <Link href="/san-pham" className="hover:text-slate-900 transition-colors">
            Sản phẩm vụ mùa
          </Link>
          <Link href="/nha-vuon" className="hover:text-slate-900 transition-colors">
            Hồ sơ nhà vườn
          </Link>
          <Link href="/truy-xuat" className="hover:text-slate-900 transition-colors">
            Truy xuất QR lô
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <CartButton />
          {user ? (
            <div className="flex items-center gap-2">
              {user.role === 'ADMIN' && (
                <Link href="/admin">
                  <Button size="sm" variant="outline" className="text-rose-700 border-rose-300 bg-rose-50 hover:bg-rose-100 gap-1.5">
                    <Shield className="w-3.5 h-3.5" /> Trang Quản Trị
                  </Button>
                </Link>
              )}
              <Link href="/tai-khoan">
                <Button size="sm" variant="ghost" className="gap-2">
                  <User className="w-4 h-4 text-emerald-600" />
                  <span className="max-w-[120px] truncate text-xs font-semibold">
                    {user.name}
                  </span>
                  {user.discountPercent > 0 && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-emerald-50 text-emerald-700 border-emerald-300">
                      -{user.discountPercent}%
                    </Badge>
                  )}
                </Button>
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/dang-nhap">
                <Button variant="outline" size="sm">
                  Đăng nhập
                </Button>
              </Link>
              <Link href="/dang-ky">
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  Đăng ký sỉ
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
