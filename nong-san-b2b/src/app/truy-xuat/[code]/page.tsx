import { notFound } from 'next/navigation'
import Link from 'next/link'
import { StorefrontHeader } from '@/components/shop/storefront-header'
import { getBatchByCode } from '@/server/actions/batch'
import {
  ShieldCheck,
  MapPin,
  Calendar,
  Award,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { gramsToKg } from '@/lib/money'

export const dynamic = 'force-dynamic'

export default async function BatchTraceabilityPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const batch = await getBatchByCode(code)

  if (!batch) {
    notFound()
  }

  const currentDate = new Date()

  const { product, farm } = batch

  return (
    <div className="min-h-screen flex flex-col bg-slate-50/50">
      <StorefrontHeader />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-8">
        {/* Verification Certificate Banner */}
        <div className="bg-gradient-to-r from-emerald-800 to-teal-900 text-white rounded-3xl p-6 sm:p-8 shadow-lg relative overflow-hidden">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 relative z-10">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-700/80 text-emerald-200 text-xs font-semibold backdrop-blur-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Chứng thư điện tử xác thực nguồn gốc nông sản
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                Lô Hàng Thu Hoạch: <span className="font-mono text-emerald-300">{batch.code}</span>
              </h1>
              <p className="text-xs sm:text-sm text-emerald-100 max-w-2xl leading-relaxed">
                Dữ liệu được số hóa trực tiếp từ nhật ký cắt vườn của đơn vị phân phối B2B và nhà vườn liên kết.
              </p>
            </div>

            <div className="p-3 bg-white rounded-2xl shadow-md shrink-0 mx-auto sm:mx-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/qr/${batch.code}`}
                alt={`QR ${batch.code}`}
                className="w-28 h-28"
              />
              <div className="text-[10px] font-mono text-center font-bold text-slate-800 mt-1">
                {batch.code}
              </div>
            </div>
          </div>
        </div>

        {/* 2-Columns Information Section */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
          {/* Cột trái: Thông tin sản phẩm & lô hàng (7 cols) */}
          <div className="md:col-span-7 space-y-6">
            <Card className="border-slate-200 shadow-xs">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-2 border-b pb-3">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                  <h2 className="text-base font-bold text-slate-900">Chi Tiết Đợt Thu Hoạch</h2>
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-slate-500 block">Sản phẩm:</span>
                    <strong className="text-slate-900 text-sm block mt-0.5">{product.name}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Ngày cắt tại vườn:</span>
                    <strong className="text-slate-900 text-sm block mt-0.5 flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      {new Date(batch.harvestDate).toLocaleDateString('vi-VN')}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Sản lượng lô:</span>
                    <strong className="text-slate-900 text-sm block mt-0.5">
                      {gramsToKg(batch.quantityGrams).toLocaleString('vi-VN')} kg ({gramsToKg(batch.quantityGrams) / 1000} tấn)
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Trạng thái:</span>
                    <Badge className="bg-emerald-600 text-white text-[11px] mt-0.5">
                      Đã kiểm định tại vườn
                    </Badge>
                  </div>
                </div>

                {batch.note && (
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-700 space-y-1">
                    <strong className="text-slate-900 block font-semibold">Ghi chú chất lượng của chuyên viên thu mua:</strong>
                    <p className="leading-relaxed italic">{batch.note}</p>
                  </div>
                )}

                <div className="pt-2 flex justify-end">
                  <Link href={`/san-pham/${product.slug}`}>
                    <Button variant="outline" size="sm" className="text-xs gap-1">
                      Xem bảng giá sỉ sản phẩm này <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>

            {/* Chứng nhận chất lượng của vườn */}
            <Card className="border-slate-200 shadow-xs">
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-2 border-b pb-3">
                  <Award className="w-5 h-5 text-emerald-600" />
                  <h2 className="text-base font-bold text-slate-900">
                    Chứng Nhận Tiêu Chuẩn Nông Nghiệp ({farm.certificates.length})
                  </h2>
                </div>

                <div className="space-y-3">
                  {farm.certificates.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">Chưa có chứng nhận còn hiệu lực</p>
                  ) : (
                    farm.certificates.map((cert) => {
                      const isExpired = new Date(cert.expiresAt) < currentDate
                      return (
                        <div
                          key={cert.id}
                          className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs"
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className={`text-[11px] ${
                                  isExpired
                                    ? 'border-rose-300 text-rose-700 bg-rose-50'
                                    : 'border-emerald-300 text-emerald-700 bg-emerald-50'
                                }`}
                              >
                                {cert.type}: {cert.code}
                              </Badge>
                              {isExpired ? (
                                <span className="text-[10px] text-rose-600 font-bold flex items-center gap-0.5">
                                  <AlertTriangle className="w-3 h-3" /> Hết hạn
                                </span>
                              ) : (
                                <span className="text-[10px] text-emerald-600 font-medium">
                                  Còn hiệu lực
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              Hiệu lực đến: {new Date(cert.expiresAt).toLocaleDateString('vi-VN')}
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Cột phải: Bản đồ và hồ sơ vườn (5 cols) */}
          <div className="md:col-span-5 space-y-6">
            <Card className="border-slate-200 shadow-xs">
              <CardContent className="p-6 space-y-4">
                <div>
                  <h3 className="font-bold text-slate-900 text-base">{farm.name}</h3>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                    <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>{farm.addressText}, {farm.province}</span>
                  </div>
                </div>

                <div className="rounded-xl overflow-hidden border border-slate-200 h-64 w-full bg-slate-100">
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

                <div className="text-[11px] text-slate-500 flex items-center justify-between">
                  <span>GPS: {farm.lat}, {farm.lng}</span>
                  <a
                    href={`https://maps.google.com/?q=${farm.lat},${farm.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-600 hover:underline inline-flex items-center gap-1 font-medium"
                  >
                    Mở Google Maps <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <Link href={`/nha-vuon/${farm.slug}`}>
                    <Button variant="outline" size="sm" className="w-full text-xs">
                      Xem toàn bộ hồ sơ nhà vườn
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <footer className="bg-white border-t border-slate-200 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-slate-500">
          <p>© 2026 Nông Sản B2B - Cổng thông tin truy xuất nguồn gốc nông sản</p>
        </div>
      </footer>
    </div>
  )
}
