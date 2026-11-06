import Link from 'next/link'
import { SeasonStatus } from '@prisma/client'
import { MapPin, Snowflake, Sparkles, Scale, ArrowRight, Boxes } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatVND, gramsToKg } from '@/lib/money'
import type { PublicStockView } from '@/lib/domain/inventory-view'

export interface ProductCardProps {
  slug: string
  name: string
  images: string[]
  seasonStatus: SeasonStatus
  requiresCold: boolean
  moqGrams: number
  leadTimeDays: number
  preorderOpen: boolean
  preorderPricePerKg?: number | null
  farm: {
    name: string
    province: string
  }
  priceTiers: {
    minGrams: number
    pricePerKg: number
  }[]
  userDiscountPercent?: number
  publicStock?: PublicStockView | null
}

export function ProductCard({
  slug,
  name,
  images,
  seasonStatus,
  requiresCold,
  moqGrams,
  preorderOpen,
  preorderPricePerKg,
  farm,
  priceTiers,
  userDiscountPercent = 0,
  publicStock,
}: ProductCardProps) {
  // Bậc giá thấp nhất (bắt đầu từ MOQ)
  const baseStartingPrice = priceTiers[0]?.pricePerKg || 0
  const userStartingPrice =
    userDiscountPercent > 0
      ? Math.round((baseStartingPrice * (100 - userDiscountPercent)) / 100)
      : baseStartingPrice

  return (
    <Link href={`/san-pham/${slug}`} className="group block h-full">
      <Card className="h-full rounded-2xl bg-white border border-slate-200/90 hover:border-emerald-400 hover:shadow-card-hover transition-all duration-300 flex flex-col overflow-hidden hover:-translate-y-1">
        {/* Product Image Chamber */}
        <div className="relative h-52 w-full bg-gradient-to-tr from-slate-100 via-slate-50 to-emerald-50/40 overflow-hidden">
          {images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={images[0]}
              alt={name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-400 bg-slate-50 text-xs">
              Chưa có ảnh
            </div>
          )}

          {/* Badges Cluster */}
          <div className="absolute top-2.5 left-2.5 flex flex-col gap-1.5 items-start z-10">
            <Badge
              className={`text-[11px] font-semibold shadow-xs px-2.5 py-0.5 rounded-full ${
                seasonStatus === SeasonStatus.HARVESTING
                  ? 'bg-emerald-600 text-white'
                  : seasonStatus === SeasonStatus.UPCOMING
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-700 text-white'
              }`}
            >
              {seasonStatus === SeasonStatus.HARVESTING ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-lime-300 animate-pulse" />
                  Đang thu hoạch
                </span>
              ) : seasonStatus === SeasonStatus.UPCOMING ? (
                'Sắp vào vụ'
              ) : (
                'Hết vụ'
              )}
            </Badge>

            {preorderOpen && (
              <Badge className="bg-purple-600 text-white text-[10px] shadow-xs flex items-center gap-1 px-2 py-0.5 rounded-full">
                <Sparkles className="w-3 h-3" /> Vụ mới (Phase 6)
              </Badge>
            )}

            {requiresCold && (
              <Badge
                variant="secondary"
                className="bg-white/95 backdrop-blur-md text-blue-700 border border-blue-200 text-[10px] font-medium shadow-xs px-2 py-0.5 rounded-full"
              >
                <Snowflake className="w-3 h-3 mr-0.5" /> Xe lạnh
              </Badge>
            )}
          </div>

          {/* Farm Origin Capsule on Image */}
          <div className="absolute bottom-2.5 left-2.5 right-2.5 z-10 flex items-center justify-between gap-1.5">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/95 backdrop-blur-md text-[11px] font-medium text-slate-700 shadow-xs border border-white/60">
              <MapPin className="w-3 h-3 text-emerald-600 shrink-0" />
              <span className="truncate max-w-[130px]">{farm.province}</span>
            </span>

            {publicStock?.tracked && publicStock.cardBadgeLabel && (
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold shadow-xs border backdrop-blur-md ${
                  publicStock.status === 'IN_STOCK'
                    ? 'bg-emerald-950/90 text-emerald-100 border-emerald-500/40'
                    : publicStock.status === 'BELOW_MOQ'
                    ? 'bg-amber-900/90 text-amber-100 border-amber-400/40'
                    : 'bg-rose-900/90 text-rose-100 border-rose-400/40'
                }`}
              >
                <Boxes className="w-3 h-3 shrink-0" />
                <span>{publicStock.cardBadgeLabel}</span>
              </span>
            )}
          </div>
        </div>

        {/* Content Body */}
        <CardContent className="p-4 sm:p-5 flex-1 flex flex-col justify-between space-y-3.5">
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 line-clamp-1">
              Vườn: {farm.name}
            </div>
            <h3 className="font-heading font-bold text-slate-900 text-base leading-snug line-clamp-2 group-hover:text-emerald-700 transition-colors">
              {name}
            </h3>
          </div>

          <div className="space-y-2.5 pt-1 border-t border-slate-100">
            {/* MOQ Indicator */}
            <div className="flex items-center justify-between text-xs text-slate-500 bg-slate-50/80 px-2.5 py-1.5 rounded-lg border border-slate-100">
              <span className="flex items-center gap-1 text-[11px]">
                <Scale className="w-3.5 h-3.5 text-slate-400" /> MOQ tối thiểu:
              </span>
              <strong className="text-slate-800 font-bold">{gramsToKg(moqGrams)} kg</strong>
            </div>

            {/* Price Preview Matrix Chamber */}
            <div className="bg-gradient-to-r from-emerald-50/90 via-emerald-50/40 to-slate-50/60 p-3 rounded-xl border border-emerald-100/80 flex items-baseline justify-between">
              <div>
                <span className="text-[10px] uppercase font-semibold tracking-wider text-emerald-800 block">
                  {preorderOpen && preorderPricePerKg ? 'Giá dự kiến vụ mới' : 'Giá sỉ tại MOQ'}
                </span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="font-heading text-lg sm:text-xl font-extrabold text-emerald-700 tracking-tight">
                    {formatVND(
                      preorderOpen && preorderPricePerKg
                        ? preorderPricePerKg
                        : userStartingPrice
                    )}
                  </span>
                  <span className="text-xs text-emerald-600 font-medium">/kg</span>
                </div>
              </div>

              {userDiscountPercent > 0 && !preorderOpen && (
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 line-through block">
                    {formatVND(baseStartingPrice)}/kg
                  </span>
                  <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-emerald-300 text-emerald-700 bg-white font-bold">
                    -{userDiscountPercent}%
                  </Badge>
                </div>
              )}
            </div>
          </div>

          {/* Quick Action Footer */}
          <div className="text-xs font-semibold text-emerald-700 group-hover:text-emerald-800 flex items-center justify-between pt-1">
            <span className="text-[11px]">Xem bảng giá bậc</span>
            <div className="w-6 h-6 rounded-full bg-emerald-100/70 group-hover:bg-emerald-600 group-hover:text-white flex items-center justify-center transition-colors">
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
