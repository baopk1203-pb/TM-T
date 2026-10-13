import Link from 'next/link'
import { db } from '@/lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Apple,
  Warehouse,
  QrCode,
  Users,
  ArrowRight,
  TrendingUp,
} from 'lucide-react'

export default async function AdminDashboardPage() {
  const [productCount, farmCount, batchCount, userCount] =
    await Promise.all([
      db.product.count(),
      db.farm.count(),
      db.batch.count(),
      db.user.count({ where: { role: 'CUSTOMER' } }),
    ])

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Bảng điều khiển Trung tâm Quản trị
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Tổng quan tài nguyên nguồn hàng, hệ thống giá sỉ và hoạt động khách hàng B2B
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-emerald-600 text-white text-xs px-3 py-1">
            Hệ thống đang hoạt động
          </Badge>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-slate-200">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                Sản phẩm vụ mùa
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-1">{productCount}</div>
              <div className="text-[11px] text-emerald-600 mt-1 flex items-center gap-1 font-medium">
                <TrendingUp className="w-3 h-3" /> Đang thu hoạch & Mở sỉ
              </div>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <Apple className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                Nhà vườn liên kết
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-1">{farmCount}</div>
              <div className="text-[11px] text-slate-500 mt-1">
                VietGAP & GlobalGAP
              </div>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Warehouse className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                Lô hàng & Mã QR
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-1">{batchCount}</div>
              <div className="text-[11px] text-blue-600 mt-1">
                Truy xuất nguồn gốc
              </div>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <QrCode className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                Khách hàng sỉ
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-1">{userCount}</div>
              <div className="text-[11px] text-purple-600 mt-1">
                Đại lý & Siêu thị
              </div>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-purple-100 text-purple-700 flex items-center justify-center">
              <Users className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Action Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Apple className="w-4 h-4 text-emerald-600" /> Quản lý danh mục & giá sỉ
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-600 leading-relaxed">
              Thiết lập sản phẩm trái cây, quy cách đóng gói (thùng, rổ, gói mẫu), quy định MOQ
              và cài đặt các bậc giá sỉ theo sản lượng (mua trên 50kg, 200kg...).
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Link href="/admin/san-pham">
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  Quản lý Sản phẩm & Bậc giá <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </Button>
              </Link>
              <Link href="/admin/san-luong">
                <Button size="sm" variant="outline">
                  Sản lượng khả dụng tuần
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Warehouse className="w-4 h-4 text-blue-600" /> Nhà vườn & Truy xuất nguồn gốc
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-600 leading-relaxed">
              Quản lý hồ sơ nhà vườn, tọa độ Google Maps, tải chứng nhận tiêu chuẩn VietGAP/GlobalGAP
              và in tem mã QR định danh cho từng lô hàng thu hoạch.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Link href="/admin/nha-vuon">
                <Button size="sm" variant="outline">
                  Hồ sơ nhà vườn
                </Button>
              </Link>
              <Link href="/admin/lo-hang">
                <Button size="sm" variant="outline">
                  Lô hàng & Mã QR
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
