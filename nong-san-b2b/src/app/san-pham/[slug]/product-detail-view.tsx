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
  ShieldCheck,
  Layers,
  ExternalLink,
  AlertTriangle,
  ChevronRight,
  Sparkles,
  Boxes,
  CheckCircle2,
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
import { formatActiveCertificatesSummary, filterActiveCertificates } from '@/lib/certificate'
import { calculateCustomerUnitPrice } from '@/lib/domain/pricing'
import { MembershipTier, calculateCombinedProductDiscount } from '@/lib/domain/membership'
import { ProductOrderBox } from './product-order-box'
import { PreorderBox } from './preorder-box'
import type { PublicStockView } from '@/lib/domain/inventory-view'

function formatObservedTimeVn(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

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
    publicStock?: PublicStockView | null
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
    membershipTier?: MembershipTier | null
    membershipTierName?: string
    membershipDiscountPercent?: number
    combinedDiscountPercent?: number
  } | null
  hasPurchasedSample?: boolean
}

export function ProductDetailView({
  product,
  user,
  hasPurchasedSample = false,
}: ProductDetailProps) {
  const [activeImage, setActiveImage] = useState(product.images[0] || '')
  const [nowTimestamp] = useState(() => Date.now())
  const userDiscount = user?.discountPercent || 0
  const membershipDiscount = user?.membershipDiscountPercent || 0
  const combinedDiscount =
    user?.combinedDiscountPercent ??
    calculateCombinedProductDiscount(userDiscount, membershipDiscount)

  // Sắp xếp các bậc giá theo kg tăng dần
  const sortedTiers = [...product.priceTiers].sort((a, b) => a.minGrams - b.minGrams)

  return (
    <div className="space-y-10">
      {/* STITCH EDITORIAL BREADCRUMB */}
      <nav className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
        <Link href="/" className="hover:text-emerald-700 transition-colors">
          Trang chủ
        </Link>
        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
        <Link href="/san-pham" className="hover:text-emerald-700 transition-colors">
          Sản phẩm vụ mùa
        </Link>
        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-slate-900 font-semibold truncate max-w-xs">{product.name}</span>
      </nav>

      {/* MAIN SHOWCASE GRID: GALLERY (5 COLS) & B2B SPECS / PRICING MATRIX (7 COLS) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        {/* Left Column: Image Gallery Chamber (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="h-96 sm:h-[420px] w-full rounded-3xl overflow-hidden bg-slate-100 border border-slate-200/90 shadow-card relative group">
            {activeImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={activeImage}
                alt={product.name}
                className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-500"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">
                Chưa có ảnh
              </div>
            )}

            {/* Floating Status Badges */}
            <div className="absolute top-4 left-4 flex flex-col gap-2 items-start z-10">
              <Badge
                className={`text-xs font-semibold shadow-xs px-3 py-1 rounded-full ${
                  product.seasonStatus === SeasonStatus.HARVESTING
                    ? 'bg-emerald-600 text-white'
                    : product.seasonStatus === SeasonStatus.UPCOMING
                    ? 'bg-amber-600 text-white'
                    : 'bg-slate-700 text-white'
                }`}
              >
                {product.seasonStatus === SeasonStatus.HARVESTING ? (
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-lime-300 animate-pulse" />
                    Đang thu hoạch
                  </span>
                ) : product.seasonStatus === SeasonStatus.UPCOMING ? (
                  'Sắp vào vụ'
                ) : (
                  'Hết vụ mùa'
                )}
              </Badge>

              {product.requiresCold && (
                <Badge
                  variant="secondary"
                  className="bg-white/95 backdrop-blur-md text-blue-700 border border-blue-200 text-xs font-medium shadow-xs px-2.5 py-1 rounded-full"
                >
                  <Snowflake className="w-3.5 h-3.5 mr-1" /> Vận chuyển xe lạnh
                </Badge>
              )}
            </div>
          </div>

          {/* Thumbnails Strip */}
          {product.images.length > 1 && (
            <div className="flex gap-2.5 overflow-x-auto pb-1">
              {product.images.map((img, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setActiveImage(img)}
                  className={`w-18 h-18 rounded-2xl overflow-hidden border-2 shrink-0 transition-all ${
                    activeImage === img
                      ? 'border-emerald-600 ring-2 ring-emerald-500/20 shadow-sm'
                      : 'border-slate-200 opacity-70 hover:opacity-100'
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
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/80 text-xs font-semibold">
              <MapPin className="w-3.5 h-3.5 text-emerald-600" />
              <span>
                Vườn liên kết: <strong>{product.farm.name}</strong> ({product.farm.province})
              </span>
            </div>

            <h1 className="font-heading text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              {product.name}
            </h1>
          </div>

          <p className="text-sm text-slate-600 leading-relaxed">
            {product.description}
          </p>

          {/* Quick specs matrix */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-1">
              <span className="text-slate-500 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider">
                <Scale className="w-3.5 h-3.5 text-emerald-600" /> MOQ Tối thiểu
              </span>
              <div className="font-heading text-base font-bold text-slate-900">
                {gramsToKg(product.moqGrams)} kg
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-1">
              <span className="text-slate-500 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider">
                <Clock className="w-3.5 h-3.5 text-blue-600" /> Thời gian chuẩn bị
              </span>
              <div className="font-heading text-base font-bold text-slate-900">
                {product.leadTimeDays} ngày
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-1">
              <span className="text-slate-500 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Tiêu chuẩn vườn
              </span>
              <div
                className={`font-heading text-sm font-bold truncate ${
                  filterActiveCertificates(product.farm.certificates).length > 0
                    ? 'text-emerald-700'
                    : 'text-slate-500'
                }`}
              >
                {formatActiveCertificatesSummary(product.farm.certificates)}
              </div>
            </div>
          </div>

          {/* TỒN KHO KHẢ DỤNG THỜI GIAN THỰC (CHỈ HIỂN THỊ CHO SẢN PHẨM ĐÃ BẬT TRACKING FEFO - F01D) */}
          {product.publicStock?.tracked && (
            <div
              className={`p-4 rounded-2xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                product.publicStock.status === 'IN_STOCK'
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                  : product.publicStock.status === 'BELOW_MOQ'
                  ? 'bg-amber-50/80 border-amber-200 text-amber-950'
                  : 'bg-rose-50/80 border-rose-200 text-rose-950'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {product.publicStock.status === 'IN_STOCK' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : product.publicStock.status === 'BELOW_MOQ' ? (
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                ) : (
                  <Boxes className="w-4 h-4 text-rose-600 shrink-0" />
                )}
                <div>
                  <span className="font-bold text-sm block">
                    {product.publicStock.detailLabel}
                  </span>
                  <span className="text-[11px] opacity-80">
                    Tồn kho thực tế được phân bổ tự động theo lô thu hoạch có hạn dùng gần nhất (FEFO).
                  </span>
                </div>
              </div>
              <div className="text-[11px] font-medium opacity-75 sm:text-right shrink-0">
                Tồn kho cập nhật lúc {formatObservedTimeVn(product.publicStock.observedAt)}
              </div>
            </div>
          )}

          {/* BẢNG GIÁ BẬC CHI TIẾT (STITCH TIERED PRICING MATRIX) */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h3 className="font-heading text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-600" /> Bảng Giá Sỉ Theo Bậc Khối Lượng
              </h3>
              {combinedDiscount > 0 ? (
                <Badge
                  variant="outline"
                  className="bg-emerald-50 text-emerald-800 border-emerald-300 text-xs font-semibold px-2.5 py-0.5 rounded-full"
                >
                  <Sparkles className="w-3 h-3 text-emerald-600 mr-1" />
                  {membershipDiscount > 0
                    ? `Ưu đãi kết hợp: -${combinedDiscount}% (${user?.groupName || 'Nhóm'}: -${userDiscount}% • Hạng ${user?.membershipTierName || 'Thành viên'}: -${membershipDiscount}%)`
                    : `Chiết khấu đối tác của bạn: -${userDiscount}%`}
                </Badge>
              ) : (
                <span className="text-xs text-slate-500">
                  <Link href="/dang-nhap" className="text-emerald-600 hover:underline font-semibold">
                    Đăng nhập đối tác
                  </Link>{' '}
                  để xem giá chiết khấu thêm
                </span>
              )}
            </div>

            <div className="border border-slate-200/90 rounded-2xl overflow-hidden shadow-xs bg-white">
              <Table>
                <TableHeader className="bg-slate-50/80">
                  <TableRow>
                    <TableHead className="font-bold text-slate-900 text-xs">Mức Sản Lượng (Kg)</TableHead>
                    <TableHead className="font-bold text-slate-900 text-right text-xs">
                      Đơn Giá Chuẩn
                    </TableHead>
                    {user && (
                      <TableHead className="font-bold text-emerald-800 text-right bg-emerald-50/60 text-xs">
                        {membershipDiscount > 0
                          ? `Giá Của Bạn (-${combinedDiscount}%)`
                          : `Giá Của Bạn (-${userDiscount}%)`}
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
                    const userUnitPrice = calculateCustomerUnitPrice(tier.pricePerKg, combinedDiscount)

                    return (
                      <TableRow key={tier.id || idx} className="hover:bg-slate-50/60">
                        <TableCell className="font-semibold text-slate-800 text-xs sm:text-sm">
                          {rangeLabel}
                        </TableCell>
                        <TableCell className="text-right font-medium text-slate-600 text-xs sm:text-sm">
                          {formatVND(tier.pricePerKg)}/kg
                        </TableCell>
                        {user && (
                          <TableCell className="text-right font-heading font-bold text-emerald-700 text-xs sm:text-sm bg-emerald-50/30">
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

          {/* BỘ CHỌN QUY CÁCH & ĐẶT HÀNG / XEM GIÁ REALTIME */}
          <ProductOrderBox
            product={product}
            user={user}
            hasPurchasedSample={hasPurchasedSample}
          />

          {/* PRE-ORDER SECTION (IF APPLICABLE) */}
          {product.preorderOpen && (
            <PreorderBox
              product={product}
              user={user}
            />
          )}

          {/* Back link */}
          <div className="pt-2">
            <Link href="/san-pham">
              <Button
                variant="ghost"
                size="sm"
                className="text-slate-600 hover:text-emerald-700 hover:bg-emerald-50/40 text-xs rounded-full px-4"
              >
                ← Quay lại danh mục sỉ
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* TABS: HỒ SƠ NHÀ VƯỜN & BẢN ĐỒ GOOGLE MAPS */}
      <div className="pt-10 border-t border-slate-200/90">
        <Tabs defaultValue="farm" className="space-y-6">
          <TabsList className="bg-slate-100/90 p-1 rounded-full inline-flex">
            <TabsTrigger
              value="farm"
              className="text-xs sm:text-sm font-semibold rounded-full px-5 py-2 data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-xs transition-all"
            >
              Hồ Sơ Nhà Vườn &amp; Bản Đồ Tọa Độ
            </TabsTrigger>
            <TabsTrigger
              value="certs"
              className="text-xs sm:text-sm font-semibold rounded-full px-5 py-2 data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-xs transition-all"
            >
              Chứng Nhận Tiêu Chuẩn ({product.farm.certificates.length})
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Farm Profile & Embedded Google Maps */}
          <TabsContent value="farm" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              <div className="lg:col-span-6 space-y-4">
                <div>
                  <h3 className="font-heading text-xl font-bold text-slate-900">{product.farm.name}</h3>
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
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs gap-1.5 rounded-full px-4 border-slate-300 hover:border-emerald-400 hover:bg-emerald-50/40"
                    >
                      Xem trang hồ sơ đầy đủ của vườn <ExternalLink className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                </div>
              </div>

              {/* Embedded Google Maps iframe */}
              <div className="lg:col-span-6 space-y-2">
                <div className="rounded-3xl overflow-hidden border border-slate-200/90 shadow-card h-72 w-full bg-slate-100">
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
                <div className="text-[11px] text-slate-500 flex items-center justify-between px-2">
                  <span>Tọa độ GPS: {product.farm.lat}, {product.farm.lng}</span>
                  <a
                    href={`https://maps.google.com/?q=${product.farm.lat},${product.farm.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-700 hover:underline font-semibold inline-flex items-center gap-1"
                  >
                    Mở Google Maps <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Tab 2: Certificates */}
          <TabsContent value="certs" className="space-y-4">
            {product.farm.certificates.length === 0 ? (
              <div className="p-8 rounded-3xl border border-slate-200/90 text-center text-slate-500 text-xs col-span-2 bg-white shadow-2xs">
                Chưa có chứng nhận nào được ghi nhận cho nhà vườn này.
              </div>
            ) : (
              <>
                {filterActiveCertificates(product.farm.certificates).length === 0 && (
                  <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 text-xs flex items-center gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      Nhà vườn này hiện chưa có chứng nhận nào còn hiệu lực. Danh sách chứng nhận đã từng được cấp hiển thị bên dưới.
                    </span>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {product.farm.certificates.map((cert) => {
                    const isExpired = new Date(cert.expiresAt).getTime() < nowTimestamp
                    return (
                      <Card key={cert.id} className="rounded-2xl border-slate-200/90 shadow-2xs">
                        <CardContent className="p-5 flex items-start gap-4">
                          <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100">
                            <Award className="w-5 h-5" />
                          </div>
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className={
                                  isExpired
                                    ? 'border-rose-300 text-rose-700 bg-rose-50 rounded-full text-[10px]'
                                    : 'border-emerald-300 text-emerald-800 bg-emerald-50 rounded-full text-[10px]'
                                }
                              >
                                {cert.type}: {cert.code}
                              </Badge>
                              {isExpired ? (
                                <span className="text-[10px] text-rose-600 font-bold">Hết hạn</span>
                              ) : (
                                <span className="text-[10px] text-emerald-600 font-semibold">Còn hiệu lực</span>
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
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
