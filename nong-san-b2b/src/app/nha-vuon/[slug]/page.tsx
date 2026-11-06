import { notFound } from 'next/navigation'
import Link from 'next/link'
import { StorefrontHeader } from '@/components/shop/storefront-header'
import { StorefrontFooter } from '@/components/shop/storefront-footer'
import { getFarmBySlug } from '@/server/actions/farm'
import { MapPin, Award, ExternalLink, ShieldCheck, Scale, ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatVND, gramsToKg } from '@/lib/money'

export const dynamic = 'force-dynamic'

export default async function FarmDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const farm = await getFarmBySlug(slug)

  if (!farm) {
    notFound()
  }

  const currentDate = new Date()

  return (
    <div className="min-h-screen flex flex-col bg-slate-50/50">
      <StorefrontHeader />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-10">
        {/* Breadcrumb */}
        <nav className="text-xs text-slate-500 flex items-center gap-2">
          <Link href="/" className="hover:text-emerald-700">Trang chủ</Link>
          <span>/</span>
          <Link href="/nha-vuon" className="hover:text-emerald-700">Hồ sơ nhà vườn</Link>
          <span>/</span>
          <span className="text-slate-900 font-semibold">{farm.name}</span>
        </nav>

        {/* Hero Section of Farm */}
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xs space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            <div className="lg:col-span-7 space-y-4">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Vườn đối tác liên kết trực tiếp
              </div>

              <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
                {farm.name}
              </h1>

              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
                <span className="flex items-center gap-1.5 font-medium">
                  <MapPin className="w-4 h-4 text-emerald-600 shrink-0" />
                  {farm.addressText}, {farm.province}
                </span>
                {farm.ownerName && (
                  <span>Đại diện: <strong>{farm.ownerName}</strong></span>
                )}
              </div>

              <p className="text-sm text-slate-600 leading-relaxed">
                {farm.description}
              </p>

              {/* Certificates */}
              <div className="pt-2 space-y-2">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                  Chứng nhận chất lượng ({farm.certificates.length}):
                </span>
                <div className="flex flex-wrap gap-2">
                  {farm.certificates.length === 0 ? (
                    <span className="text-xs text-slate-500 italic">Chưa có chứng nhận còn hiệu lực</span>
                  ) : null}
                  {farm.certificates.map((cert) => {
                    const isExpired = new Date(cert.expiresAt) < currentDate
                    return (
                      <Badge
                        key={cert.id}
                        variant="outline"
                        className={`text-xs py-1 px-2.5 ${
                          isExpired
                            ? 'border-rose-300 text-rose-700 bg-rose-50'
                            : 'border-emerald-300 text-emerald-700 bg-emerald-50'
                        }`}
                      >
                        <Award className="w-3.5 h-3.5 mr-1 inline" />
                        {cert.type}: {cert.code} {isExpired ? '(Hết hạn)' : '(Còn hiệu lực)'}
                      </Badge>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Google Maps Embed */}
            <div className="lg:col-span-5 space-y-2">
              <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm h-72 w-full bg-slate-100">
                <iframe
                  title={`Bản đồ ${farm.name}`}
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  loading="lazy"
                  allowFullScreen
                  referrerPolicy="no-referrer-when-downgrade"
                  src={`https://www.google.com/maps?q=${farm.lat},${farm.lng}&output=embed`}
                />
              </div>
              <div className="text-[11px] text-slate-500 flex items-center justify-between px-1">
                <span>Tọa độ GPS: {farm.lat}, {farm.lng}</span>
                <a
                  href={`https://maps.google.com/?q=${farm.lat},${farm.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-600 hover:underline font-medium inline-flex items-center gap-1"
                >
                  Xem trên Google Maps <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Products from this Farm */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                Sản Phẩm Cung Ứng Từ Vườn Này ({farm.products.length})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Các giống cây ăn trái được canh tác và thu hoạch trực tiếp tại vườn
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {farm.products.map((p) => {
              const lowestPrice = p.priceTiers[0]?.pricePerKg || 0
              return (
                <Card key={p.id} className="border-slate-200 overflow-hidden hover:shadow-md transition-shadow">
                  <div className="h-44 w-full bg-slate-100 relative overflow-hidden">
                    {p.images[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.images[0]} alt={p.name} className="w-full h-full object-cover" />
                    ) : null}
                  </div>

                  <CardContent className="p-5 space-y-3">
                    <h3 className="font-bold text-slate-900 text-base">{p.name}</h3>

                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <span className="flex items-center gap-1">
                        <Scale className="w-3.5 h-3.5" /> MOQ: <strong>{gramsToKg(p.moqGrams)} kg</strong>
                      </span>
                      <span className="text-emerald-700 font-bold">
                        Từ {formatVND(lowestPrice)}/kg
                      </span>
                    </div>

                    <div className="pt-2 border-t border-slate-100">
                      <Link href={`/san-pham/${p.slug}`}>
                        <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1">
                          Xem bảng giá sỉ & quy cách <ArrowRight className="w-3.5 h-3.5" />
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      </main>

      <StorefrontFooter />
    </div>
  )
}
