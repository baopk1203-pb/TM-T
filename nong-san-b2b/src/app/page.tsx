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
  QrCode,
  CheckCircle2,
  Snowflake,
  Scale,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StorefrontHeader } from '@/components/shop/storefront-header'
import { StorefrontFooter } from '@/components/shop/storefront-footer'
import { ProductCard } from '@/components/shop/product-card'
import { getStorefrontProducts } from '@/server/actions/product'
import { getServerAuthSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { SeasonStatus } from '@prisma/client'
import { formatVND, gramsToKg } from '@/lib/money'

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

  const heroProduct = harvestingProducts[0] || products[0]
  const heroStartingPrice = heroProduct
    ? userDiscountPercent > 0
      ? Math.round(
          ((heroProduct.priceTiers[0]?.pricePerKg || 0) *
            (100 - userDiscountPercent)) /
            100
        )
      : heroProduct.priceTiers[0]?.pricePerKg || 0
    : 0

  return (
    <div className="min-h-screen flex flex-col bg-slate-50/60 font-sans text-slate-900">
      <StorefrontHeader />

      <main className="flex-1 space-y-16 pb-20">
        {/* HERO SECTION — STITCH 12-COLUMN MODERN SHOWCASE */}
        <section className="relative overflow-hidden bg-gradient-to-b from-emerald-50/80 via-emerald-50/20 to-slate-50/60 pt-10 pb-16 sm:pt-14 sm:pb-20 border-b border-emerald-100/70">
          {/* Ambient Glow Circles */}
          <div className="absolute top-0 right-10 w-96 h-96 rounded-full bg-emerald-200/30 blur-3xl -z-10 pointer-events-none" />
          <div className="absolute bottom-0 left-10 w-80 h-80 rounded-full bg-lime-100/40 blur-3xl -z-10 pointer-events-none" />

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
              {/* Left Column (7 cols): Editorial & Value Proposition */}
              <div className="lg:col-span-7 space-y-6">
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white text-emerald-800 text-xs font-semibold border border-emerald-200/80 shadow-xs">
                  <BadgeCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Chuẩn hóa chất lượng VietGAP &amp; GlobalGAP từ gốc vườn</span>
                </div>

                <h1 className="font-heading text-4xl sm:text-5xl lg:text-[52px] font-extrabold text-slate-900 tracking-tight leading-[1.12]">
                  Nền tảng cung ứng trái cây sỉ{' '}
                  <span className="text-emerald-600 underline decoration-emerald-200 decoration-wavy decoration-2">
                    tận vườn
                  </span>{' '}
                  cho siêu thị &amp; đại lý
                </h1>

                <p className="text-base sm:text-lg text-slate-600 leading-relaxed max-w-2xl">
                  Giải quyết 3 bài toán lớn của khách mua sỉ: <strong>Niềm tin</strong> nguồn gốc minh bạch với tem QR từng lô,{' '}
                  <strong>Giá bậc</strong> chiết khấu theo sản lượng kg, và <strong>Vận chuyển</strong> giao tận nơi
                  chốt khối lượng thực tế.
                </p>

                <div className="pt-2 flex flex-wrap gap-4 items-center">
                  <Link href="/san-pham">
                    <Button
                      size="lg"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-full px-6 py-6 font-semibold shadow-btn-glow gap-2 hover:-translate-y-0.5 transition-all"
                    >
                      <span>Xem toàn bộ danh mục sỉ</span>
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                  <Link href="/dang-ky">
                    <Button
                      size="lg"
                      variant="outline"
                      className="rounded-full px-6 py-6 border-slate-300 bg-white hover:border-emerald-400 hover:bg-emerald-50/40 text-slate-800 font-semibold transition-all"
                    >
                      Đăng ký đối tác mua sỉ
                    </Button>
                  </Link>
                </div>

                {/* Micro Highlights Metrics Bar */}
                <div className="pt-4 grid grid-cols-3 gap-4 border-t border-emerald-100/80 max-w-lg">
                  <div className="space-y-0.5">
                    <div className="font-heading text-xl sm:text-2xl font-bold text-emerald-700">100%</div>
                    <div className="text-xs text-slate-500 font-medium">Chuẩn vườn GAP</div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="font-heading text-xl sm:text-2xl font-bold text-emerald-700">Tận gốc</div>
                    <div className="text-xs text-slate-500 font-medium">Cai Lậy, Bến Tre, Tây Nguyên</div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="font-heading text-xl sm:text-2xl font-bold text-emerald-700">Real-time</div>
                    <div className="text-xs text-slate-500 font-medium">Giá theo bậc &amp; chốt cân</div>
                  </div>
                </div>
              </div>

              {/* Right Column (5 cols): Hero Premier Showcase Card */}
              {heroProduct && (
                <div className="lg:col-span-5 relative">
                  <div className="relative rounded-3xl bg-white p-4 sm:p-5 shadow-xl border border-emerald-100/80 overflow-hidden group hover:border-emerald-300 transition-all duration-300">
                    <div className="relative h-64 sm:h-72 w-full rounded-2xl overflow-hidden bg-slate-100">
                      {heroProduct.images[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={heroProduct.images[0]}
                          alt={heroProduct.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">
                          Chưa có ảnh
                        </div>
                      )}

                      {/* Top Badges */}
                      <div className="absolute top-3 left-3 flex flex-col gap-1.5 items-start z-10">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/95 backdrop-blur-md text-emerald-800 font-semibold text-xs shadow-xs">
                          <span className="w-2 h-2 rounded-full bg-lime-500 animate-pulse" />
                          Vừa thu hoạch tại vườn
                        </span>
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-600 text-white font-semibold text-[11px] shadow-xs">
                          <CheckCircle2 className="w-3 h-3" /> Chuẩn GAP
                        </span>
                      </div>

                      {/* Bottom Info Tag */}
                      <div className="absolute bottom-3 right-3 z-10">
                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-slate-900/85 backdrop-blur-md text-white text-xs font-medium shadow-xs">
                          {heroProduct.requiresCold ? (
                            <>
                              <Snowflake className="w-3.5 h-3.5 text-sky-400" />
                              <span>Xe lạnh chuyên dụng</span>
                            </>
                          ) : (
                            <>
                              <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                              <span>{heroProduct.farm.province}</span>
                            </>
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="pt-4 space-y-3">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="font-semibold text-emerald-700 uppercase tracking-wider text-[11px]">
                          Vườn: {heroProduct.farm.name} ({heroProduct.farm.province})
                        </span>
                        <span className="flex items-center gap-1">
                          <Scale className="w-3.5 h-3.5 text-slate-400" /> MOQ {gramsToKg(heroProduct.moqGrams)} kg
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-heading font-extrabold text-lg sm:text-xl text-slate-900 line-clamp-1 group-hover:text-emerald-700 transition-colors">
                            {heroProduct.name}
                          </h3>
                          <div className="flex items-baseline gap-1.5 mt-0.5">
                            <span className="text-[11px] text-slate-500">Giá sỉ tại MOQ:</span>
                            <span className="font-heading font-extrabold text-lg text-emerald-700">
                              {formatVND(heroStartingPrice)}
                            </span>
                            <span className="text-xs text-emerald-600 font-medium">/kg</span>
                          </div>
                        </div>

                        <Link href={`/san-pham/${heroProduct.slug}`}>
                          <Button
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-full px-4 text-xs font-semibold shadow-xs gap-1"
                          >
                            <span>Xem chi tiết</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 4 CORE VALUE PILLARS STRIP — STITCH HORIZONTAL HIGHLIGHT */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/80 shadow-xs hover:border-emerald-200 hover:shadow-card transition-all flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-heading font-bold text-sm text-slate-900">1. Niềm tin &amp; Nguồn gốc</h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Hồ sơ nhà vườn định vị tọa độ, chứng nhận VietGAP/GlobalGAP công khai, minh bạch từng đợt hái.
                </p>
              </div>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/80 shadow-xs hover:border-blue-200 hover:shadow-card transition-all flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0 border border-blue-100">
                <TrendingDown className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-heading font-bold text-sm text-slate-900">2. Giá bậc &amp; Chiết khấu sỉ</h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Bảng giá bậc theo kg, đặt càng nhiều giá càng giảm kèm chiết khấu đối tác doanh nghiệp B2B.
                </p>
              </div>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/80 shadow-xs hover:border-amber-200 hover:shadow-card transition-all flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0 border border-amber-100">
                <Truck className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-heading font-bold text-sm text-slate-900">3. Vận chuyển &amp; Chốt cân thực</h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Lựa chọn ngày giao theo chu kỳ thu hoạch vườn, hỗ trợ xe lạnh và đồng kiểm khối lượng thực tế.
                </p>
              </div>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/80 shadow-xs hover:border-purple-200 hover:shadow-card transition-all flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center shrink-0 border border-purple-100">
                <QrCode className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-heading font-bold text-sm text-slate-900">4. Truy xuất QR &amp; Đổi trả 24h</h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Tra cứu nguồn gốc lô hàng theo mã QR; hỗ trợ khiếu nại bồi hoàn hao hụt minh bạch cho đối tác.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* BENTO QUICK NAVIGATION CHIPS — B2B DESTINATIONS */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Link
              href="/san-pham?seasonStatus=HARVESTING"
              className="p-4 rounded-2xl bg-white border border-slate-200/80 hover:border-emerald-400 hover:shadow-sm transition-all group"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Giao ngay</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              <h4 className="font-heading font-bold text-slate-900 text-sm group-hover:text-emerald-700 transition-colors">
                Trái cây đang thu hoạch
              </h4>
              <p className="text-xs text-slate-500 mt-1 line-clamp-1">Cắt lứa tại vườn, đóng thùng chuẩn</p>
            </Link>

            <Link
              href="/san-pham?seasonStatus=UPCOMING"
              className="p-4 rounded-2xl bg-white border border-slate-200/80 hover:border-purple-400 hover:shadow-sm transition-all group"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-purple-700">Vụ mới</span>
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
              </div>
              <h4 className="font-heading font-bold text-slate-900 text-sm group-hover:text-purple-700 transition-colors">
                Kế hoạch vụ mùa tới
              </h4>
              <p className="text-xs text-slate-500 mt-1 line-clamp-1">Tham khảo giá dự kiến &amp; pre-order</p>
            </Link>

            <Link
              href="/nha-vuon"
              className="p-4 rounded-2xl bg-white border border-slate-200/80 hover:border-blue-400 hover:shadow-sm transition-all group"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700">Đối tác vườn</span>
                <MapPin className="w-3.5 h-3.5 text-blue-600" />
              </div>
              <h4 className="font-heading font-bold text-slate-900 text-sm group-hover:text-blue-700 transition-colors">
                Mạng lưới nhà vườn
              </h4>
              <p className="text-xs text-slate-500 mt-1 line-clamp-1">Tọa độ GPS &amp; chứng nhận GAP</p>
            </Link>

            <Link
              href="/truy-xuat"
              className="p-4 rounded-2xl bg-white border border-slate-200/80 hover:border-amber-400 hover:shadow-sm transition-all group"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Minh bạch</span>
                <QrCode className="w-3.5 h-3.5 text-amber-600" />
              </div>
              <h4 className="font-heading font-bold text-slate-900 text-sm group-hover:text-amber-700 transition-colors">
                Truy xuất nguồn gốc QR
              </h4>
              <p className="text-xs text-slate-500 mt-1 line-clamp-1">Tra cứu nhật ký canh tác từng lô</p>
            </Link>
          </div>
        </section>

        {/* KHỐI 1: ĐANG THU HOẠCH (HARVESTING) */}
        {harvestingProducts.length > 0 && (
          <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 uppercase tracking-wider mb-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Sẵn sàng giao ngay
                </div>
                <h2 className="font-heading text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                  Trái Cây Đang Vào Vụ Thu Hoạch
                </h2>
                <p className="text-sm text-slate-600 mt-1 max-w-2xl">
                  Thu hoạch cắt lứa tại vườn Cai Lậy, Bến Tre, Tây Nguyên. Giao hàng theo MOQ từng đợt.
                </p>
              </div>
              <Link href="/san-pham?seasonStatus=HARVESTING">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 bg-white rounded-full px-4 text-xs font-semibold hover:border-emerald-300 hover:bg-emerald-50/50"
                >
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
            <div className="rounded-3xl bg-gradient-to-br from-[#064E3B] via-[#047857] to-[#0F172A] p-8 sm:p-12 text-white shadow-2xl relative overflow-hidden border border-emerald-500/20">
              <div className="relative z-10 max-w-3xl mb-8">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-300 uppercase tracking-wider mb-2.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md">
                  <Sparkles className="w-4 h-4 text-lime-300" />
                  Thông tin dự kiến vụ mới (Đang phát triển - Phase 6)
                </div>
                <h2 className="font-heading text-2xl sm:text-3xl font-extrabold tracking-tight">
                  Tham Khảo Vụ Mùa Sắp Tới (Pre-order Demo)
                </h2>
                <p className="text-sm text-emerald-100/90 mt-2 leading-relaxed">
                  Theo dõi sớm các giống trái cây sắp vào vụ thu hoạch từ nhà vườn liên kết.
                  Tính năng đặt cọc giữ giá trần (Pre-order Cọc 30%) đang được hoàn thiện cho Phase 6. Hiện tại quý khách có thể tham khảo giá dự kiến và đặt mua sỉ theo các quy cách sẵn có.
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
              <div className="text-xs font-bold text-emerald-700 uppercase tracking-wider mb-1.5">
                Minh bạch nguồn gốc
              </div>
              <h2 className="font-heading text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                Mạng Lưới Nhà Vườn Liên Kết Đạt Chuẩn GAP
              </h2>
              <p className="text-sm text-slate-600 mt-1 max-w-2xl">
                Tọa độ GPS định vị chính xác, quy trình canh tác đạt chứng nhận VietGAP / GlobalGAP.
              </p>
            </div>
            <Link href="/nha-vuon">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 bg-white rounded-full px-4 text-xs font-semibold hover:border-emerald-300 hover:bg-emerald-50/50"
              >
                Xem tất cả đối tác <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {farms.map((f) => (
              <Card
                key={f.id}
                className="rounded-2xl border-slate-200/90 overflow-hidden hover:shadow-card-hover hover:border-emerald-300 transition-all duration-300 group"
              >
                <div className="h-48 w-full bg-slate-100 relative overflow-hidden">
                  {f.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={f.images[0]}
                      alt={f.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : null}
                  <div className="absolute top-3 right-3">
                    <Badge className="bg-slate-900/80 backdrop-blur-md text-white text-[11px] rounded-full px-2.5 py-0.5">
                      {f._count.products} loại quả
                    </Badge>
                  </div>
                </div>

                <CardContent className="p-5 space-y-3">
                  <div>
                    <h3 className="font-heading font-bold text-slate-900 text-base group-hover:text-emerald-700 transition-colors">
                      {f.name}
                    </h3>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                      <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{f.province}</span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                    {f.description}
                  </p>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <div className="flex flex-wrap gap-1">
                      {f.certificates.map((cert) => (
                        <Badge
                          key={cert.id}
                          variant="outline"
                          className="text-[10px] bg-emerald-50 text-emerald-800 border-emerald-300 rounded-full px-2 py-0.5"
                        >
                          <Award className="w-3 h-3 mr-0.5 inline text-emerald-600" /> {cert.type}
                        </Badge>
                      ))}
                    </div>

                    <Link href={`/nha-vuon/${f.slug}`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50/50 font-semibold"
                      >
                        Hồ sơ vườn →
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <StorefrontFooter />
    </div>
  )
}
