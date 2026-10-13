import Link from 'next/link'
import {
  ShieldCheck,
  TrendingDown,
  Truck,
  ArrowRight,
  BadgeCheck,
  Sparkles,
  MapPin,
  Award,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StorefrontHeader } from '@/components/shop/storefront-header'
import { ProductCard } from '@/components/shop/product-card'
import { getStorefrontProducts } from '@/server/actions/product'
import { getServerAuthSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { SeasonStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const [products, farms, session] = await Promise.all([
    getStorefrontProducts(),
    db.farm.findMany({
      include: {
        certificates: {
          where: { expiresAt: { gt: new Date() } },
        },
        _count: { select: { products: true } },
      },
      take: 3,
    }),
    getServerAuthSession(),
  ])

  const userDiscountPercent = session?.user?.discountPercent || 0

  const harvestingProducts = products.filter(
    (p) => p.seasonStatus === SeasonStatus.HARVESTING
  )
  const preorderProducts = products.filter(
    (p) => p.preorderOpen || p.seasonStatus === SeasonStatus.UPCOMING
  )

  return (
    <div className="min-h-screen flex flex-col bg-slate-50/50">
      <StorefrontHeader />

      {/* Hero Section */}
      <main className="flex-1 space-y-16 pb-16">
        <section className="bg-gradient-to-b from-emerald-50 via-emerald-50/40 to-slate-50/50 py-16 sm:py-20 border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-100/90 text-emerald-800 text-xs font-semibold mb-6 shadow-xs">
                <BadgeCheck className="w-4 h-4 text-emerald-600" />
                Chuẩn hóa chất lượng VietGAP & GlobalGAP từ gốc vườn
              </div>
              <h1 className="text-4xl sm:text-5xl font-extrabold text-slate-900 tracking-tight leading-[1.15]">
                Nền tảng cung ứng trái cây sỉ{' '}
                <span className="text-emerald-600">tận vườn</span> cho siêu thị & đại lý
              </h1>
              <p className="mt-5 text-base sm:text-lg text-slate-600 leading-relaxed">
                Giải quyết 3 bài toán lớn của khách mua sỉ: <strong>Niềm tin</strong> nguồn gốc minh bạch với tem QR từng lô,{' '}
                <strong>Giá bậc</strong> chiết khấu theo sản lượng kg, và <strong>Vận chuyển</strong> giao tận nơi
                chốt khối lượng thực tế.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <Link href="/san-pham">
                  <Button size="lg" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-sm">
                    Xem toàn bộ danh mục sỉ <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
                <Link href="/dang-ky">
                  <Button size="lg" variant="outline" className="border-slate-300 bg-white">
                    Đăng ký đối tác mua sỉ
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* KHỐI 1: ĐANG THU HOẠCH (HARVESTING) */}
        {harvestingProducts.length > 0 && (
          <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 uppercase tracking-wider mb-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Sẵn sàng giao ngay
                </div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                  Trái Cây Đang Vào Vụ Thu Hoạch
                </h2>
                <p className="text-sm text-slate-600 mt-1">
                  Thu hoạch cắt lứa tại vườn Cai Lậy, Bến Tre, Tây Nguyên. Giao hàng theo MOQ từng đợt.
                </p>
              </div>
              <Link href="/san-pham?seasonStatus=HARVESTING">
                <Button variant="outline" size="sm" className="gap-1.5 bg-white text-xs">
                  Xem tất cả ({harvestingProducts.length}) <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {harvestingProducts.slice(0, 4).map((p) => (
                <ProductCard
                  key={p.id}
                  slug={p.slug}
                  name={p.name}
                  images={p.images}
                  seasonStatus={p.seasonStatus}
                  requiresCold={p.requiresCold}
                  moqGrams={p.moqGrams}
                  leadTimeDays={p.leadTimeDays}
                  preorderOpen={p.preorderOpen}
                  farm={p.farm}
                  priceTiers={p.priceTiers}
                  userDiscountPercent={userDiscountPercent}
                />
              ))}
            </div>
          </section>
        )}

        {/* KHỐI 2: ĐẶT TRƯỚC VỤ MÙA (PRE-ORDER) */}
        {preorderProducts.length > 0 && (
          <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 text-white rounded-3xl p-8 sm:p-10 shadow-xl overflow-hidden relative">
              <div className="relative z-10 max-w-2xl mb-8">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-purple-300 uppercase tracking-wider mb-2">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  Chính sách giữ giá vụ mới
                </div>
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                  Mở Đặt Trước Vụ Mùa (Pre-order Cọc 30%)
                </h2>
                <p className="text-sm text-purple-200 mt-2 leading-relaxed">
                  Đảm bảo nguồn cung trái cây loại 1 cho các chuỗi siêu thị và đại lý trước ngày thu hoạch rộ.
                  Giữ mức giá trần trong biên độ an toàn, ưu tiên giao hàng đợt 1.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 relative z-10">
                {preorderProducts.map((p) => (
                  <div key={p.id} className="bg-white rounded-2xl overflow-hidden text-slate-900 shadow-lg">
                    <ProductCard
                      slug={p.slug}
                      name={p.name}
                      images={p.images}
                      seasonStatus={p.seasonStatus}
                      requiresCold={p.requiresCold}
                      moqGrams={p.moqGrams}
                      leadTimeDays={p.leadTimeDays}
                      preorderOpen={p.preorderOpen}
                      preorderPricePerKg={p.preorderPricePerKg}
                      farm={p.farm}
                      priceTiers={p.priceTiers}
                      userDiscountPercent={userDiscountPercent}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* KHỐI 3: NHÀ VƯỜN LIÊN KẾT ĐẠT CHUẨN */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 gap-4">
            <div>
              <div className="text-xs font-bold text-emerald-700 uppercase tracking-wider mb-1">
                Minh bạch nguồn gốc
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                Mạng Lưới Nhà Vườn Liên Kết Đạt Chuẩn GAP
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                Tọa độ GPS định vị chính xác, quy trình canh tác đạt chứng nhận VietGAP / GlobalGAP.
              </p>
            </div>
            <Link href="/nha-vuon">
              <Button variant="outline" size="sm" className="gap-1.5 bg-white text-xs">
                Xem tất cả đối tác <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {farms.map((f) => (
              <Card key={f.id} className="border-slate-200 overflow-hidden hover:shadow-md transition-shadow">
                <div className="h-44 w-full bg-slate-100 relative overflow-hidden">
                  {f.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.images[0]} alt={f.name} className="w-full h-full object-cover" />
                  ) : null}
                  <div className="absolute top-3 right-3">
                    <Badge className="bg-slate-900/80 backdrop-blur-sm text-white text-[11px]">
                      {f._count.products} loại quả
                    </Badge>
                  </div>
                </div>

                <CardContent className="p-5 space-y-3">
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">{f.name}</h3>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                      <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{f.province}</span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                    {f.description}
                  </p>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                    <div className="flex flex-wrap gap-1">
                      {f.certificates.map((cert) => (
                        <Badge
                          key={cert.id}
                          variant="outline"
                          className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300"
                        >
                          <Award className="w-3 h-3 mr-0.5 inline" /> {cert.type}
                        </Badge>
                      ))}
                    </div>

                    <Link href={`/nha-vuon/${f.slug}`}>
                      <Button variant="ghost" size="sm" className="text-xs text-emerald-700 hover:text-emerald-800">
                        Hồ sơ vườn →
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* 3 Core Pillars */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card className="border-slate-200 shadow-none bg-white">
              <CardContent className="p-6">
                <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 mb-4">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-slate-900">1. Niềm tin & Nguồn gốc</h3>
                <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                  Hồ sơ nhà vườn định vị tọa độ, chứng nhận VietGAP/GlobalGAP công khai. Mã QR gắn theo từng lô
                  hàng thu hoạch giúp đại lý và siêu thị minh bạch tuyệt đối với khách hàng.
                </p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-none bg-white">
              <CardContent className="p-6">
                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center text-blue-700 mb-4">
                  <TrendingDown className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-slate-900">2. Giá bậc & Chiết khấu sỉ</h3>
                <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                  Bảng giá bậc tuyệt đối theo sản lượng tính bằng kg. Đặt càng nhiều giá càng giảm kèm chiết khấu
                  thành viên theo nhóm (Đại lý cấp 1 -5%, Siêu thị -3%, Cửa hàng nhỏ 0%).
                </p>
              </CardContent>
            </Card>

            <Card className="border-slate-200 shadow-none bg-white">
              <CardContent className="p-6">
                <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 mb-4">
                  <Truck className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-slate-900">3. Vận chuyển & Chốt cân thực</h3>
                <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                  Lựa chọn ngày giao theo chu kỳ thu hoạch vườn, hỗ trợ xe lạnh chuyên dụng. Đồng kiểm tại chỗ và
                  chốt khối lượng thực giao để quyết toán công bằng.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-slate-500 space-y-2">
          <p className="font-semibold text-slate-700">NÔNG SẢN B2B - HỆ THỐNG CUNG ỨNG TRÁI CÂY TẬN VƯỜN</p>
          <p>© 2026 Đồ án môn Thương mại Điện tử. Mọi quyền được bảo lưu.</p>
        </div>
      </footer>
    </div>
  )
}
