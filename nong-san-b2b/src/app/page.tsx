import Link from 'next/link'
import {
  ShieldCheck,
  TrendingDown,
  Truck,
  ArrowRight,
  BadgeCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StorefrontHeader } from '@/components/shop/storefront-header'

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <StorefrontHeader />

      {/* Hero Section */}
      <main className="flex-1">
        <section className="bg-gradient-to-b from-emerald-50/60 to-white py-16 sm:py-24 border-b border-slate-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100/80 text-emerald-800 text-xs font-semibold mb-6">
                <BadgeCheck className="w-4 h-4 text-emerald-600" />
                Chuẩn hóa chất lượng VietGAP & GlobalGAP
              </div>
              <h1 className="text-4xl sm:text-5xl font-extrabold text-slate-900 tracking-tight leading-[1.15]">
                Nền tảng cung ứng trái cây sỉ{' '}
                <span className="text-emerald-600">tận vườn</span> cho siêu thị & đại lý
              </h1>
              <p className="mt-5 text-lg text-slate-600 leading-relaxed">
                Giải quyết 3 bài toán lớn của khách mua sỉ: <strong>Niềm tin</strong> nguồn gốc minh bạch,{' '}
                <strong>Giá bậc</strong> chiết khấu theo sản lượng, và <strong>Vận chuyển</strong> giao tận nơi
                chốt khối lượng thực tế.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <Link href="/san-pham">
                  <Button size="lg" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-sm">
                    Xem bảng giá sỉ vụ mùa <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
                <Link href="/dang-ky">
                  <Button size="lg" variant="outline" className="border-slate-300">
                    Mở tài khoản doanh nghiệp
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* 3 Core Pillars */}
        <section className="py-16 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card className="border-slate-200 shadow-none hover:border-emerald-300 transition-colors">
              <CardContent className="p-6">
                <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 mb-4">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">1. Niềm tin & Nguồn gốc</h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                  Hồ sơ nhà vườn định vị tọa độ, chứng nhận VietGAP/GlobalGAP công khai. Mã QR gắn theo từng lô
                  hàng thu hoạch giúp đại lý và siêu thị minh bạch tuyệt đối với khách hàng.
                </p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-none hover:border-emerald-300 transition-colors">
              <CardContent className="p-6">
                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center text-blue-700 mb-4">
                  <TrendingDown className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">2. Giá bậc & Chiết khấu sỉ</h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                  Bảng giá bậc tuyệt đối theo sản lượng tính bằng kg. Đặt càng nhiều giá càng giảm kèm chiết khấu
                  thành viên theo nhóm (Đại lý cấp 1, Siêu thị, Cửa hàng nhỏ).
                </p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-none hover:border-emerald-300 transition-colors">
              <CardContent className="p-6">
                <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 mb-4">
                  <Truck className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">3. Vận chuyển & Chốt cân thực</h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                  Lựa chọn ngày giao theo chu kỳ thu hoạch vườn, hỗ trợ xe lạnh chuyên dụng. Đồng kiểm tại chỗ và
                  chốt khối lượng thực giao để quyết toán công bằng.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Status Phase 0 Badge */}
        <section className="pb-16 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-slate-100 rounded-2xl p-6 border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-white text-emerald-700 border-emerald-300">
                  Phase 0: Khởi tạo dự án
                </Badge>
                <span className="text-xs text-slate-500 font-mono">Next.js 16 + Tailwind v4 + shadcn/ui + Vitest</span>
              </div>
              <p className="mt-2 text-sm text-slate-700">
                Khung kiến trúc hệ thống, cấu hình cơ sở dữ liệu và tiện ích nghiệp vụ tiền tệ/khối lượng đã sẵn sàng.
              </p>
            </div>
            <Link href="/admin">
              <Button variant="secondary" size="sm">
                Trang Quản trị (Admin)
              </Button>
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-slate-500">
          <p>© 2026 Nông Sản B2B - Đồ án môn Thương mại Điện tử. Mọi quyền được bảo lưu.</p>
        </div>
      </footer>
    </div>
  )
}
