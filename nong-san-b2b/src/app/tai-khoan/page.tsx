import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Package, MapPin, Sparkles, ShoppingBag, ArrowRight } from 'lucide-react'

export default async function AccountOverviewPage() {
  const session = await getServerAuthSession()
  if (!session?.user) {
    redirect('/dang-nhap')
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: {
      group: true,
      addresses: true,
      orders: {
        take: 5,
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  if (!user) redirect('/dang-nhap')

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-700 rounded-2xl p-6 text-white shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <span className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full bg-white/20 mb-2">
            Đối tác B2B
          </span>
          <h1 className="text-2xl font-bold tracking-tight">
            Xin chào, {user.companyName || user.fullName}!
          </h1>
          <p className="text-emerald-100 text-sm mt-1">
            Chào mừng bạn đến với Cổng thông tin mua sỉ nông sản – trái cây chuẩn vườn.
          </p>
        </div>
        <Link href="/san-pham">
          <Button className="bg-white text-emerald-800 hover:bg-emerald-50 font-semibold gap-2 shadow-sm">
            <ShoppingBag className="w-4 h-4" /> Đặt hàng vụ mùa
          </Button>
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-slate-200">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs text-slate-500 font-medium">Hạng & Chiết khấu</div>
              <div className="text-lg font-bold text-slate-900">
                {user.group?.name || 'Cửa hàng nhỏ'} (-{user.group?.discountPercent || 0}%)
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs text-slate-500 font-medium">Tổng số đơn hàng</div>
              <div className="text-lg font-bold text-slate-900">{user.orders.length} đơn</div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <MapPin className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs text-slate-500 font-medium">Địa chỉ nhận hàng</div>
              <div className="text-lg font-bold text-slate-900">{user.addresses.length} địa chỉ</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Navigation Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-600" /> Đơn hàng gần đây
            </CardTitle>
          </CardHeader>
          <CardContent>
            {user.orders.length === 0 ? (
              <div className="text-center py-6 text-sm text-slate-500">
                Bạn chưa có đơn hàng nào. Hãy khám phá danh mục trái cây đang thu hoạch!
                <div className="mt-3">
                  <Link href="/san-pham">
                    <Button variant="outline" size="sm">
                      Xem danh mục sản phẩm
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {user.orders.map((o) => (
                  <div
                    key={o.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-slate-50 text-sm"
                  >
                    <div>
                      <span className="font-semibold text-slate-900">{o.code}</span>
                      <span className="block text-xs text-slate-500">
                        {new Date(o.createdAt).toLocaleDateString('vi-VN')}
                      </span>
                    </div>
                    <Link href={`/tai-khoan/don-hang/${o.code}`}>
                      <Button variant="ghost" size="sm">
                        Chi tiết <ArrowRight className="w-3.5 h-3.5 ml-1" />
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <MapPin className="w-4 h-4 text-emerald-600" /> Sổ địa chỉ giao hàng
            </CardTitle>
          </CardHeader>
          <CardContent>
            {user.addresses.length === 0 ? (
              <div className="text-center py-6 text-sm text-slate-500">
                Chưa có địa chỉ giao nhận nào được lưu.
                <div className="mt-3">
                  <Link href="/tai-khoan/dia-chi">
                    <Button variant="outline" size="sm">
                      Thêm địa chỉ kho nhận
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {user.addresses.slice(0, 2).map((addr) => (
                  <div key={addr.id} className="p-3 rounded-xl bg-slate-50 text-sm space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">{addr.label}</span>
                      {addr.isDefault && (
                        <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                          Mặc định
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-600">
                      {addr.recipient} - {addr.phone}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {addr.line}, {addr.ward}, {addr.district}, {addr.province}
                    </div>
                  </div>
                ))}
                <div className="pt-1">
                  <Link href="/tai-khoan/dia-chi">
                    <Button variant="ghost" size="sm" className="w-full text-xs">
                      Quản lý tất cả địa chỉ ({user.addresses.length})
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
