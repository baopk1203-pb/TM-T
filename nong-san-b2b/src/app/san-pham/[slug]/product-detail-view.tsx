'use client'

import { useState } from 'react'
import Link from 'next/link'
import { SeasonStatus, Packaging, PriceTier, Certificate } from '@prisma/client'
import {
  MapPin,
  Snowflake,
  Clock,
  Scale,
  Award,
  Sparkles,
  ShieldCheck,
  Package,
  Layers,
  ArrowRight,
  ExternalLink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatVND, gramsToKg } from '@/lib/money'
import { calculateCustomerUnitPrice } from '@/lib/domain/pricing'

interface ProductDetailProps {
  product: {
    id: string
    name: string
    slug: string
    description: string
    images: string[]
    moqGrams: number
    leadTimeDays: number
    seasonStatus: SeasonStatus
    requiresCold: boolean
    preorderOpen: boolean
    preorderPricePerKg: number | null
    preorderBandPercent: number | null
    expectedHarvestFrom: Date | null
    expectedHarvestTo: Date | null
    packagings: Packaging[]
    priceTiers: PriceTier[]
    farm: {
      id: string
      name: string
      slug: string
      ownerName: string | null
      province: string
      addressText: string
      description: string
      lat: number
      lng: number
      images: string[]
      certificates: Certificate[]
    }
  }
  user: {
    name?: string | null
    discountPercent: number
    role: string
    groupName?: string
  } | null
}

export function ProductDetailView({ product, user }: ProductDetailProps) {
  const [activeImage, setActiveImage] = useState(product.images[0] || '')
  const [nowTimestamp] = useState(() => Date.now())
  const userDiscount = user?.discountPercent || 0

  // Sắp xếp các bậc giá theo kg tăng dần
  const sortedTiers = [...product.priceTiers].sort((a, b) => a.minGrams - b.minGrams)

  return (
    <div className="space-y-10">
      {/* Breadcrumb */}
      <nav className="text-xs text-slate-500 flex items-center gap-2">
        <Link href="/" className="hover:text-emerald-700">Trang chủ</Link>
        <span>/</span>
        <Link href="/san-pham" className="hover:text-emerald-700">Sản phẩm vụ mùa</Link>
        <span>/</span>
        <span className="text-slate-900 font-semibold">{product.name}</span>
      </nav>

      {/* Main Grid: Gallery & Main Info */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        {/* Left Column: Image Gallery (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="h-96 w-full rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 shadow-xs relative">
            {activeImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={activeImage}
                alt={product.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-400">
                Chưa có ảnh
              </div>
            )}

            <div className="absolute top-3 left-3 flex flex-col gap-1.5 items-start">
              <Badge
                className={
                  product.seasonStatus === SeasonStatus.HARVESTING
                    ? 'bg-emerald-600 text-white'
                    : product.seasonStatus === SeasonStatus.UPCOMING
                    ? 'bg-amber-600 text-white'
                    : 'bg-slate-700 text-white'
                }
              >
                {product.seasonStatus === SeasonStatus.HARVESTING
                  ? 'Đang thu hoạch'
                  : product.seasonStatus === SeasonStatus.UPCOMING
                  ? 'Sắp vào vụ'
                  : 'Hết vụ mùa'}
              </Badge>
              {product.requiresCold && (
                <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">
                  <Snowflake className="w-3.5 h-3.5 mr-1" /> Vận chuyển xe lạnh
                </Badge>
              )}
            </div>
          </div>

          {/* Thumbnails */}
          {product.images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {product.images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setActiveImage(img)}
                  className={`w-16 h-16 rounded-xl overflow-hidden border-2 shrink-0 transition-all ${
                    activeImage === img ? 'border-emerald-600 shadow-sm' : 'border-slate-200 opacity-70'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img} alt={`thumb-${i}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Key Details & Pricing Matrix (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <MapPin className="w-3.5 h-3.5 text-emerald-600" />
              <span>Vườn: <strong>{product.farm.name}</strong> ({product.farm.province})</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              {product.name}
            </h1>
          </div>

          <p className="text-sm text-slate-600 leading-relaxed">
            {product.description}
          </p>

          {/* Quick specs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs bg-slate-50 p-4 rounded-2xl border border-slate-200">
            <div>
              <span className="text-slate-500 block flex items-center gap-1">
                <Scale className="w-3.5 h-3.5" /> MOQ (Đặt tối thiểu):
              </span>
              <strong className="text-slate-900 text-sm font-bold">
                {gramsToKg(product.moqGrams)} kg
              </strong>
            </div>
            <div>
              <span className="text-slate-500 block flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> Thời gian chuẩn bị:
              </span>
              <strong className="text-slate-900 text-sm font-bold">
                {product.leadTimeDays} ngày
              </strong>
            </div>
            <div>
              <span className="text-slate-500 block flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Tiêu chuẩn vườn:
              </span>
              <strong className="text-emerald-700 text-sm font-bold">
                {product.farm.certificates.map((c) => c.type).join(', ') || 'Đang xác minh'}
              </strong>
            </div>
          </div>

          {/* BẢNG GIÁ BẬC CHI TIẾT (PRICE TIERS TABLE) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-600" /> Bảng Giá Sỉ Theo Bậc Khối Lượng
              </h3>
              {userDiscount > 0 ? (
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 text-xs">
                  Chiết khấu đối tác của bạn: -{userDiscount}%
                </Badge>
              ) : (
                <span className="text-xs text-slate-500">
                  <Link href="/dang-nhap" className="text-emerald-600 hover:underline">
                    Đăng nhập đối tác
                  </Link>{' '}
                  để xem giá chiết khấu thêm
                </span>
              )}
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="font-bold text-slate-900">Mức Sản Lượng (Kg)</TableHead>
                    <TableHead className="font-bold text-slate-900 text-right">Đơn Giá Chuẩn</TableHead>
                    {user && (
                      <TableHead className="font-bold text-emerald-700 text-right bg-emerald-50/50">
                        Giá Của Bạn (-{userDiscount}%)
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedTiers.map((tier, idx) => {
                    const minKg = gramsToKg(tier.minGrams)
                    const nextTier = sortedTiers[idx + 1]
                    const maxKg = nextTier ? gramsToKg(nextTier.minGrams) - 1 : null
                    const rangeLabel = maxKg ? `${minKg} – ${maxKg} kg` : `≥ ${minKg} kg`
                    const userUnitPrice = calculateCustomerUnitPrice(tier.pricePerKg, userDiscount)

                    return (
                      <TableRow key={tier.id || idx} className="hover:bg-slate-50/60">
                        <TableCell className="font-semibold text-slate-800 text-xs sm:text-sm">
                          {rangeLabel}
                        </TableCell>
                        <TableCell className="text-right font-medium text-slate-600 text-xs sm:text-sm">
                          {formatVND(tier.pricePerKg)}/kg
                        </TableCell>
                        {user && (
                          <TableCell className="text-right font-bold text-emerald-700 text-xs sm:text-sm bg-emerald-50/30">
                            {formatVND(userUnitPrice)}/kg
                          </TableCell>
                        )}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* QUY CÁCH ĐÓNG GÓI SẴN CÓ */}
          <div className="space-y-3 pt-2">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-600" /> Quy Cách Đóng Gói
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {product.packagings.map((pkg) => (
                <div
                  key={pkg.id}
                  className={`p-3.5 rounded-xl border text-xs flex items-center justify-between ${
                    pkg.isSample
                      ? 'border-amber-300 bg-amber-50/60 text-amber-900'
                      : 'border-slate-200 bg-white text-slate-800'
                  }`}
                >
                  <div>
                    <strong className="block text-sm font-semibold">{pkg.name}</strong>
                    <span className="text-slate-500">Khối lượng: {gramsToKg(pkg.weightGrams)} kg</span>
                  </div>
                  {pkg.isSample ? (
                    <Badge className="bg-amber-600 text-white font-bold">
                      Gói mẫu: {formatVND(pkg.samplePrice || 0)}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-slate-600">Quy cách sỉ</Badge>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* PRE-ORDER BANNER (IF APPLICABLE) */}
          {product.preorderOpen && (
            <div className="p-4 rounded-2xl bg-purple-50 border border-purple-200 text-purple-900 space-y-2">
              <div className="flex items-center gap-2 font-bold text-sm">
                <Sparkles className="w-4 h-4 text-purple-600" />
                Mở Đặt Trước Vụ Mùa (Giữ Giá Trần)
              </div>
              <p className="text-xs text-purple-800 leading-relaxed">
                Đơn giá cọc giữ chỗ: <strong>{formatVND(product.preorderPricePerKg || 0)}/kg</strong> (Biên độ giá chốt vụ không quá ±{product.preorderBandPercent}%).
                {product.expectedHarvestFrom && (
                  <span> Dự kiến thu hoạch từ: {new Date(product.expectedHarvestFrom).toLocaleDateString('vi-VN')}</span>
                )}
              </p>
            </div>
          )}

          {/* Action Callout */}
          <div className="pt-2 flex flex-col sm:flex-row gap-3">
            <Link href="/san-pham" className="flex-1">
              <Button variant="outline" className="w-full text-xs">
                ← Quay lại danh mục sỉ
              </Button>
            </Link>
            <Link href="/dang-ky" className="flex-1">
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5 shadow-sm">
                Đăng ký mở tài khoản đặt sỉ <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* TABS: HỒ SƠ NHÀ VƯỜN & BẢN ĐỒ GOOGLE MAPS */}
      <div className="pt-8 border-t border-slate-200">
        <Tabs defaultValue="farm" className="space-y-6">
          <TabsList className="bg-slate-100 p-1">
            <TabsTrigger value="farm" className="text-xs sm:text-sm font-semibold">
              Hồ Sơ Nhà Vườn & Bản Đồ Tọa Độ
            </TabsTrigger>
            <TabsTrigger value="certs" className="text-xs sm:text-sm font-semibold">
              Chứng Nhận Tiêu Chuẩn ({product.farm.certificates.length})
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Farm Profile & Embedded Google Maps */}
          <TabsContent value="farm" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              <div className="lg:col-span-6 space-y-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">{product.farm.name}</h3>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                    <MapPin className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{product.farm.addressText}, {product.farm.province}</span>
                  </div>
                </div>

                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  {product.farm.description}
                </p>

                <div className="pt-2">
                  <Link href={`/nha-vuon/${product.farm.slug}`}>
                    <Button variant="outline" size="sm" className="text-xs gap-1.5">
                      Xem trang hồ sơ đầy đủ của vườn <ExternalLink className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                </div>
              </div>

              {/* Embedded Google Maps iframe */}
              <div className="lg:col-span-6 space-y-2">
                <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm h-72 w-full bg-slate-100">
                  <iframe
                    title="Vị trí nhà vườn"
                    width="100%"
                    height="100%"
                    style={{ border: 0 }}
                    loading="lazy"
                    allowFullScreen
                    referrerPolicy="no-referrer-when-downgrade"
                    src={`https://www.google.com/maps?q=${product.farm.lat},${product.farm.lng}&output=embed`}
                  />
                </div>
                <div className="text-[11px] text-slate-500 flex items-center justify-between px-1">
                  <span>Tọa độ GPS: {product.farm.lat}, {product.farm.lng}</span>
                  <a
                    href={`https://maps.google.com/?q=${product.farm.lat},${product.farm.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-600 hover:underline font-medium inline-flex items-center gap-1"
                  >
                    Mở Google Maps <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Tab 2: Certificates */}
          <TabsContent value="certs" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {product.farm.certificates.map((cert) => {
                const isExpired = new Date(cert.expiresAt).getTime() < nowTimestamp
                return (
                  <Card key={cert.id} className="border-slate-200">
                    <CardContent className="p-4 flex items-start gap-4">
                      <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                        <Award className="w-5 h-5" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={
                              isExpired
                                ? 'border-rose-300 text-rose-700 bg-rose-50'
                                : 'border-emerald-300 text-emerald-700 bg-emerald-50'
                            }
                          >
                            {cert.type}: {cert.code}
                          </Badge>
                          {isExpired ? (
                            <span className="text-[10px] text-rose-600 font-bold">Hết hạn</span>
                          ) : (
                            <span className="text-[10px] text-emerald-600 font-medium">Còn hiệu lực</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500">
                          Cấp ngày: {new Date(cert.issuedAt).toLocaleDateString('vi-VN')}
                        </div>
                        <div className="text-xs text-slate-500">
                          Hết hạn: {new Date(cert.expiresAt).toLocaleDateString('vi-VN')}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
