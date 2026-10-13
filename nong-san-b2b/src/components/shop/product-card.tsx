import Link from 'next/link'
import { SeasonStatus } from '@prisma/client'
import { MapPin, Snowflake, Sparkles, Scale, ArrowRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatVND, gramsToKg } from '@/lib/money'

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
}: ProductCardProps) {
  // Bậc giá thấp nhất (bắt đầu từ MOQ)
  const baseStartingPrice = priceTiers[0]?.pricePerKg || 0
  const userStartingPrice =
    userDiscountPercent > 0
      ? Math.round((baseStartingPrice * (100 - userDiscountPercent)) / 100)
      : baseStartingPrice

  return (
    <Link href={`/san-pham/${slug}`} className="group block h-full">
      <Card className="h-full overflow-hidden border-slate-200 hover:border-emerald-500 hover:shadow-lg transition-all flex flex-col">
        {/* Product Image */}
        <div className="relative h-48 w-full bg-slate-100 overflow-hidden">
          {images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={images[0]}
              alt={name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-400 bg-slate-50">
              Chưa có ảnh
            </div>
          )}

          {/* Badges */}
          <div className="absolute top-2.5 left-2.5 flex flex-col gap-1 items-start">
            <Badge
              className={`text-[11px] font-semibold shadow-sm ${
                seasonStatus === SeasonStatus.HARVESTING
                  ? 'bg-emerald-600 text-white'
                  : seasonStatus === SeasonStatus.UPCOMING
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-700 text-white'
              }`}
            >
              {seasonStatus === SeasonStatus.HARVESTING
                ? 'Đang thu hoạch'
                : seasonStatus === SeasonStatus.UPCOMING
                ? 'Sắp vào vụ'
                : 'Hết vụ'}
            </Badge>

            {preorderOpen && (
              <Badge className="bg-purple-600 text-white text-[10px] shadow-sm flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Đặt trước
              </Badge>
            )}

            {requiresCold && (
              <Badge
                variant="secondary"
                className="bg-blue-50/90 backdrop-blur-sm text-blue-700 border-blue-200 text-[10px]"
              >
                <Snowflake className="w-3 h-3 mr-0.5" /> Xe lạnh
              </Badge>
            )}
          </div>
        </div>

        {/* Content */}
        <CardContent className="p-4 flex-1 flex flex-col justify-between space-y-3">
          <div>
            <div className="text-xs text-slate-500 flex items-center gap-1 mb-1">
              <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span className="line-clamp-1">{farm.name} • {farm.province}</span>
            </div>
            <h3 className="font-bold text-slate-900 text-base line-clamp-2 group-hover:text-emerald-700 transition-colors">
              {name}
            </h3>
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-2">
            {/* MOQ */}
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <Scale className="w-3.5 h-3.5" /> Mức tối thiểu (MOQ):
              </span>
              <strong className="text-slate-800">{gramsToKg(moqGrams)} kg</strong>
            </div>

            {/* Price Preview */}
            <div className="bg-emerald-50/60 p-2.5 rounded-xl border border-emerald-100 flex items-baseline justify-between">
              <div>
                <span className="text-[11px] text-emerald-800 block">
                  {preorderOpen && preorderPricePerKg ? 'Giá giữ chỗ vụ mới:' : 'Giá sỉ từ:'}
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-base font-extrabold text-emerald-700">
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
                  <Badge variant="outline" className="text-[10px] py-0 px-1 border-emerald-300 text-emerald-700 bg-white">
                    -{userDiscountPercent}%
                  </Badge>
                </div>
              )}
            </div>
          </div>

          <div className="text-xs font-semibold text-emerald-600 group-hover:text-emerald-700 flex items-center justify-end gap-1 pt-1">
            Xem bảng giá bậc <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
