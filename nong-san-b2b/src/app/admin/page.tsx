import Link from 'next/link'
import { db } from '@/lib/db'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Apple,
  Warehouse,
  QrCode,
  Users,
  ArrowRight,
  TrendingUp,
  ShoppingCart,
  Clock,
  Truck,
  AlertCircle,
  BarChart3,
  Package,
} from 'lucide-react'
import { getAdminDashboardKpis, getBusinessReports } from '@/server/reports'
import { formatVND } from '@/lib/money'
import { formatVietnamDate } from '@/lib/utils'
import { DashboardChart } from './dashboard-chart'
import { OrderStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

function DashboardOrderStatusBadge({ status }: { status: OrderStatus }) {
  switch (status) {
    case 'PENDING_CONFIRMATION':
      return <Badge className="bg-amber-100 text-amber-800 border-amber-200 font-semibold text-[10px] rounded-full">Chờ xác nhận</Badge>
    case 'PROCESSING':
      return <Badge className="bg-blue-100 text-blue-800 border-blue-200 font-semibold text-[10px] rounded-full">Đang xử lý</Badge>
    case 'SHIPPING':
      return <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200 font-semibold text-[10px] rounded-full">Đang giao</Badge>
    case 'DELIVERED':
      return <Badge className="bg-teal-100 text-teal-800 border-teal-200 font-semibold text-[10px] rounded-full">Đã giao</Badge>
    case 'COMPLETED':
      return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 font-semibold text-[10px] rounded-full">Hoàn thành</Badge>
    case 'CANCELLED':
      return <Badge className="bg-rose-50 text-rose-600 border-rose-200 font-semibold text-[10px] rounded-full">Đã hủy</Badge>
    case 'COMPLAINT':
      return <Badge className="bg-rose-100 text-rose-800 border-rose-200 font-semibold text-[10px] rounded-full">Khiếu nại</Badge>
    default:
      return <Badge variant="outline" className="text-[10px] rounded-full">{status}</Badge>
  }
}

export default async function AdminDashboardPage() {
  const [
    productCount,
    farmCount,
    batchCount,
    userCount,
    operationalKpis,
    reportResult,
    recentOrders,
  ] = await Promise.all([
    db.product.count(),
    db.farm.count(),
    db.batch.count(),
    db.user.count({ where: { role: 'CUSTOMER' } }),
    getAdminDashboardKpis(),
    getBusinessReports({ preset: '7D', grouping: 'DAY' }).catch(() => ({ success: false, data: undefined })),
    db.order.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        code: true,
        status: true,
        total: true,
        deliveryDate: true,
        createdAt: true,
        user: {
          select: {
            fullName: true,
            companyName: true,
          },
        },
        items: {
          select: {
            productName: true,
            quantity: true,
          },
        },
      },
    }),
  ])

  const reportData = reportResult.success ? reportResult.data : null
  const timelinePoints = reportData?.timeline.points || []
  const total7dRevenue = reportData?.timeline.totalRevenue || 0
  const total7dOrders = reportData?.timeline.totalCompletedOrders || 0
  const topCrops = reportData?.topProducts.topByKg?.slice(0, 4) || []

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Top Command Center Bar (Stitch Admin Header) */}
      <div className="bg-white p-6 sm:p-7 rounded-3xl border border-slate-200/90 shadow-card flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono text-[11px] font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              REAL-TIME TELEMETRY
            </span>
            <span className="text-xs text-slate-400 font-medium">Trung tâm điều hành B2B E Vibe</span>
          </div>
          <h1 className="font-heading text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Bảng Điều Khiển Trung Tâm Quản Trị
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 max-w-2xl leading-relaxed">
            Tổng quan tài nguyên nguồn hàng, hệ thống giá sỉ, tiến độ vận hành kho vận và hoạt động khách hàng B2B.
          </p>
        </div>

        {/* Quick Action Ribbon */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Link href="/admin/bao-cao">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full text-xs font-semibold border-slate-200 text-slate-700 hover:text-emerald-700 hover:bg-emerald-50 h-10 px-4 gap-1.5 transition-all"
            >
              <BarChart3 className="w-4 h-4 text-emerald-600" />
              <span>Báo cáo kinh doanh</span>
            </Button>
          </Link>
          <Link href="/admin/don-hang">
            <Button
              size="sm"
              className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold h-10 px-5 gap-1.5 shadow-btn-glow hover:-translate-y-0.5 transition-all"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>Quản lý đơn hàng</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* 4 Key Operational KPIs (Bento Cards with Stitch look) */}
      <div className="space-y-3">
        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider px-1">
          Chỉ số Vận hành hôm nay (Thời gian thực)
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
          {/* KPI 1: Đơn mới hôm nay */}
          <Link href="/admin/don-hang" className="block group">
            <Card className="rounded-3xl border-slate-200/90 shadow-card bg-white p-5 sm:p-6 transition-all hover:border-emerald-500 hover:shadow-md relative overflow-hidden">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Đơn mới hôm nay</div>
                  <div className="text-3xl font-black text-slate-900 mt-1.5 font-heading">
                    {operationalKpis.newOrdersToday}
                  </div>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center shrink-0">
                  <ShoppingCart className="w-6 h-6" />
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <span className="text-slate-500 font-medium">Toàn sàn B2B</span>
                <span className="text-emerald-600 font-bold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                  Xem danh sách <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </Card>
          </Link>

          {/* KPI 2: Chờ xác nhận tiền */}
          <Link href="/admin/don-hang" className="block group">
            <Card className="rounded-3xl border-slate-200/90 shadow-card bg-white p-5 sm:p-6 transition-all hover:border-amber-500 hover:shadow-md relative overflow-hidden">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Chờ xác nhận tiền</div>
                  <div className="text-3xl font-black text-amber-700 mt-1.5 font-heading">
                    {operationalKpis.awaitingPaymentConfirmation}
                  </div>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-700 border border-amber-100 flex items-center justify-center shrink-0">
                  <Clock className="w-6 h-6" />
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <span className="text-slate-500 font-medium">Đối soát VietQR</span>
                <span className="text-amber-700 font-bold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                  Xác nhận ngay <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </Card>
          </Link>

          {/* KPI 3: Đơn giao hôm nay */}
          <Link href="/admin/don-hang" className="block group">
            <Card className="rounded-3xl border-slate-200/90 shadow-card bg-white p-5 sm:p-6 transition-all hover:border-blue-500 hover:shadow-md relative overflow-hidden">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Đơn giao hôm nay</div>
                  <div className="text-3xl font-black text-slate-900 mt-1.5 font-heading">
                    {operationalKpis.deliveriesToday}
                  </div>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-700 border border-blue-100 flex items-center justify-center shrink-0">
                  <Truck className="w-6 h-6" />
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <span className="text-slate-500 font-medium">Lịch xe & Kho vận</span>
                <span className="text-blue-700 font-bold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                  Lộ trình giao <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </Card>
          </Link>

          {/* KPI 4: Khiếu nại đang mở */}
          <Link href="/admin/khieu-nai" className="block group">
            <Card className="rounded-3xl border-slate-200/90 shadow-card bg-white p-5 sm:p-6 transition-all hover:border-rose-500 hover:shadow-md relative overflow-hidden">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Khiếu nại đang mở</div>
                  <div className="text-3xl font-black text-rose-700 mt-1.5 font-heading">
                    {operationalKpis.openComplaints}
                  </div>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-700 border border-rose-100 flex items-center justify-center shrink-0">
                  <AlertCircle className="w-6 h-6" />
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <span className="text-slate-500 font-medium">SLA bảo đảm 24h</span>
                <span className="text-rose-700 font-bold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                  Xử lý ngay <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </Card>
          </Link>
        </div>
      </div>

      {/* Executive 7-Day Revenue & Outflow Section (Grid 12 cols, matching Stitch) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: 7-Day Revenue Trend Chart (8 Cols) */}
        <div className="lg:col-span-8 bg-white rounded-3xl p-6 sm:p-7 border border-slate-200/90 shadow-card space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 gap-2">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-mono">Dòng tiền bán hàng</div>
              <h2 className="font-heading text-lg sm:text-xl font-bold text-slate-900 tracking-tight mt-0.5">
                Xu hướng Doanh thu 7 ngày gần nhất
              </h2>
            </div>
            <Link href="/admin/bao-cao">
              <Button variant="ghost" size="sm" className="text-xs text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 rounded-full h-8 px-3 font-semibold gap-1">
                Chi tiết báo cáo <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </div>

          {/* Interactive Recharts Visualization */}
          <DashboardChart
            points={timelinePoints}
            totalRevenue={total7dRevenue}
            totalOrders={total7dOrders}
          />
        </div>

        {/* Right Column: Top Products Outflow / Sản lượng nông sản tiêu biểu (4 Cols) */}
        <div className="lg:col-span-4 bg-white rounded-3xl p-6 sm:p-7 border border-slate-200/90 shadow-card space-y-5">
          <div className="flex items-center justify-between pb-2">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 font-mono">Thống kê xuất kho</div>
              <h2 className="font-heading text-lg font-bold text-slate-900 tracking-tight mt-0.5">
                Sản lượng nông sản Hot
              </h2>
            </div>
            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] rounded-full px-2.5 py-0.5 font-bold">
              7 ngày qua
            </Badge>
          </div>

          {topCrops.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400 space-y-1">
              <Package className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p>Chưa có dữ liệu sản lượng hoàn tất</p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {topCrops.map((crop, idx) => {
                const maxRevenue = topCrops[0]?.totalRevenue || 1
                const percent = Math.min(100, Math.round((crop.totalRevenue / maxRevenue) * 100))
                const rankNum = String(idx + 1).padStart(2, '0')

                return (
                  <div key={crop.productId} className="p-3.5 rounded-2xl bg-slate-50/80 border border-slate-100 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-emerald-700 font-bold text-xs flex items-center justify-center shrink-0">
                          {rankNum}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-900 truncate">{crop.productName}</div>
                          <div className="text-[10px] text-slate-500">
                            {crop.totalKg.toLocaleString('vi-VN')} kg xuất kho
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs font-extrabold text-emerald-700">{formatVND(crop.totalRevenue)}</div>
                        <div className="text-[10px] text-slate-400">{crop.orderCount} đơn</div>
                      </div>
                    </div>
                    <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-emerald-600 h-full rounded-full transition-all duration-500"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 4 Catalog & Network Scale KPI Cards */}
      <div className="space-y-3">
        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider px-1">
          Quy mô Danh mục &amp; Mạng lưới Đối tác
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
          <Card className="rounded-3xl border-slate-200/90 shadow-card bg-white p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Sản phẩm vụ mùa
                </div>
                <div className="text-2xl font-black text-slate-900 mt-1 font-heading">{productCount}</div>
                <div className="text-[11px] text-emerald-600 mt-1 flex items-center gap-1 font-semibold">
                  <TrendingUp className="w-3 h-3" /> Đang thu hoạch &amp; Mở sỉ
                </div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-700 border border-amber-100 flex items-center justify-center shrink-0">
                <Apple className="w-6 h-6" />
              </div>
            </div>
          </Card>

          <Card className="rounded-3xl border-slate-200/90 shadow-card bg-white p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Nhà vườn liên kết
                </div>
                <div className="text-2xl font-black text-slate-900 mt-1 font-heading">{farmCount}</div>
                <div className="text-[11px] text-slate-500 mt-1 font-medium">
                  VietGAP &amp; GlobalGAP
                </div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-center justify-center shrink-0">
                <Warehouse className="w-6 h-6" />
              </div>
            </div>
          </Card>

          <Card className="rounded-3xl border-slate-200/90 shadow-card bg-white p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Lô hàng &amp; Mã QR
                </div>
                <div className="text-2xl font-black text-slate-900 mt-1 font-heading">{batchCount}</div>
                <div className="text-[11px] text-blue-600 mt-1 font-medium">
                  Truy xuất nguồn gốc
                </div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-700 border border-blue-100 flex items-center justify-center shrink-0">
                <QrCode className="w-6 h-6" />
              </div>
            </div>
          </Card>

          <Card className="rounded-3xl border-slate-200/90 shadow-card bg-white p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Khách hàng sỉ B2B
                </div>
                <div className="text-2xl font-black text-slate-900 mt-1 font-heading">{userCount}</div>
                <div className="text-[11px] text-purple-600 mt-1 font-medium">
                  Đại lý &amp; Siêu thị
                </div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-700 border border-purple-100 flex items-center justify-center shrink-0">
                <Users className="w-6 h-6" />
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Recent Orders Live Activity Stream */}
      <div className="bg-white rounded-3xl p-6 sm:p-7 border border-slate-200/90 shadow-card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-heading text-lg font-bold text-slate-900 tracking-tight">
              Hoạt Động Đơn Hàng Gần Đây
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">5 đơn hàng mới nhất phát sinh trên toàn sàn</p>
          </div>
          <Link href="/admin/don-hang">
            <Button variant="outline" size="sm" className="rounded-full text-xs font-semibold border-slate-200 text-slate-700 hover:text-emerald-700 hover:bg-emerald-50 h-8 px-3 gap-1">
              Xem tất cả đơn <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>

        {recentOrders.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-400">
            Chưa có đơn hàng nào trong hệ thống.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200/80">
                <tr>
                  <th className="py-3 px-4 rounded-l-xl">Mã đơn</th>
                  <th className="py-3 px-4">Khách hàng</th>
                  <th className="py-3 px-4">Ngày đặt</th>
                  <th className="py-3 px-4 text-right">Tổng tiền</th>
                  <th className="py-3 px-4 text-center">Trạng thái</th>
                  <th className="py-3 px-4 text-right rounded-r-xl">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentOrders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-emerald-800">
                      <Link href={`/admin/don-hang/${ord.code}`} className="hover:underline">
                        {ord.code}
                      </Link>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">
                        {ord.user.companyName || ord.user.fullName}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {ord.items.length} mặt hàng
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {formatVietnamDate(ord.createdAt, {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-3 px-4 text-right font-extrabold text-slate-900">
                      {formatVND(ord.total)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <DashboardOrderStatusBadge status={ord.status} />
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Link href={`/admin/don-hang/${ord.code}`}>
                        <Button size="sm" variant="outline" className="h-7 text-[11px] rounded-full border-slate-200 hover:border-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 px-2.5">
                          Chi tiết
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Quick Action Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="rounded-3xl border-slate-200/90 shadow-card bg-white p-6 sm:p-7 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <Apple className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-heading text-base font-bold text-slate-900">Quản lý danh mục &amp; giá sỉ</h3>
              <p className="text-xs text-slate-500">Cấu hình bảng giá sỉ và chu kỳ thu hoạch</p>
            </div>
          </div>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
            Thiết lập sản phẩm trái cây, quy cách đóng gói (thùng, rổ, gói mẫu), quy định MOQ
            và cài đặt các bậc giá sỉ theo sản lượng (mua trên 50kg, 200kg...).
          </p>
          <div className="flex flex-wrap gap-2.5 pt-2">
            <Link href="/admin/san-pham">
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-full text-xs font-bold h-9 px-4 gap-1.5 shadow-btn-glow">
                Quản lý Sản phẩm &amp; Bậc giá <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
            <Link href="/admin/san-luong">
              <Button size="sm" variant="outline" className="rounded-full border-slate-200 text-xs font-medium h-9 px-4">
                Sản lượng khả dụng tuần
              </Button>
            </Link>
          </div>
        </Card>

        <Card className="rounded-3xl border-slate-200/90 shadow-card bg-white p-6 sm:p-7 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center">
              <Warehouse className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-heading text-base font-bold text-slate-900">Nhà vườn &amp; Truy xuất nguồn gốc</h3>
              <p className="text-xs text-slate-500">Chuỗi cung ứng minh bạch VietGAP &amp; GlobalGAP</p>
            </div>
          </div>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
            Quản lý hồ sơ nhà vườn, tọa độ Google Maps, tải chứng nhận tiêu chuẩn VietGAP/GlobalGAP
            và in tem mã QR định danh cho từng lô hàng thu hoạch.
          </p>
          <div className="flex flex-wrap gap-2.5 pt-2">
            <Link href="/admin/nha-vuon">
              <Button size="sm" variant="outline" className="rounded-full border-slate-200 text-xs font-medium h-9 px-4">
                Hồ sơ nhà vườn
              </Button>
            </Link>
            <Link href="/admin/lo-hang">
              <Button size="sm" variant="outline" className="rounded-full border-slate-200 text-xs font-medium h-9 px-4">
                Lô hàng &amp; Mã QR
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  )
}
