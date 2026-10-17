import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth'
import { CalendarDays, ArrowRight, Sparkles, ShoppingBag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default async function RecurringOrdersPage() {
  const session = await getServerAuthSession()
  if (!session?.user) {
    redirect('/dang-nhap?callbackUrl=/tai-khoan/dinh-ky')
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <CalendarDays className="w-6 h-6 text-emerald-600" /> Đơn Hàng Định Kỳ
          </h1>
          <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-300 text-xs">
            Tính năng Phase 6
          </Badge>
        </div>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Lên lịch giao trái cây tươi định kỳ hàng tuần cho chuỗi siêu thị và đại lý bán sỉ.
        </p>
      </div>

      <Card className="border border-slate-200 bg-gradient-to-br from-amber-50/40 via-white to-slate-50 py-12 text-center shadow-xs">
        <CardContent className="space-y-5 max-w-lg mx-auto">
          <div className="w-16 h-16 rounded-3xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto shadow-sm">
            <Sparkles className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h3 className="text-lg font-bold text-slate-900">
              Đang phát triển theo lộ trình (Phase 6)
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Tính năng thiết lập lịch giao hàng định kỳ tự động (theo chu kỳ hàng tuần, tạo đơn nháp tự động và giữ nguồn cung sỉ ổn định) sẽ chính thức được kích hoạt trong <strong>Phase 6</strong>.
            </p>
          </div>

          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <Link href="/tai-khoan/don-hang">
              <Button variant="outline" size="sm" className="text-xs">
                Xem đơn hàng hiện tại
              </Button>
            </Link>
            <Link href="/san-pham">
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5">
                <ShoppingBag className="w-3.5 h-3.5" /> Đặt hàng vụ mùa <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
