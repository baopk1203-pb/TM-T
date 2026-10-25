'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ShoppingCart,
  Plus,
  Minus,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  TrendingDown,
  PackageCheck,
  Scale,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useCartStore } from '@/lib/cart-store'
import { formatVND, gramsToKg } from '@/lib/money'
import { priceCart, ProductPricingData } from '@/lib/domain/pricing'
import {
  evaluateCartItemStockWarning,
  type PublicStockView,
} from '@/lib/domain/inventory-view'
import { toast } from 'sonner'

interface ProductOrderBoxProps {
  product: {
    id: string
    name: string
    moqGrams: number
    publicStock?: PublicStockView | null
    priceTiers: {
      id?: string
      minGrams: number
      pricePerKg: number
    }[]
    packagings: {
      id: string
      name: string
      weightGrams: number
      isSample: boolean
      samplePrice?: number | null
      isActive: boolean
    }[]
  }
  user: {
    name?: string | null
    discountPercent: number
    role: string
    groupName?: string
  } | null
  hasPurchasedSample: boolean
}

export function ProductOrderBox({
  product,
  user,
  hasPurchasedSample,
}: ProductOrderBoxProps) {
  const router = useRouter()
  const addItem = useCartStore((state) => state.addItem)
  const items = useCartStore((state) => state.items)
  const userDiscount = user?.discountPercent || 0

  // Tách quy cách thường và mẫu
  const regularPackagings = useMemo(
    () => product.packagings.filter((p) => !p.isSample && p.isActive),
    [product.packagings]
  )
  const samplePackaging = useMemo(
    () => product.packagings.find((p) => p.isSample && p.isActive),
    [product.packagings]
  )

  // Khởi tạo số lượng cho từng quy cách thường
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {}
    regularPackagings.forEach((pkg, index) => {
      // Gợi ý quy cách đầu tiên vừa đủ đạt MOQ
      if (index === 0 && pkg.weightGrams > 0) {
        init[pkg.id] = Math.ceil(product.moqGrams / pkg.weightGrams)
      } else {
        init[pkg.id] = 0
      }
    })
    return init
  })

  const [isPending, startTransition] = useTransition()

  // Chuyển đổi sang format dữ liệu cho pricing engine
  const pricingProduct: ProductPricingData = useMemo(() => {
    return {
      id: product.id,
      name: product.name,
      moqGrams: product.moqGrams,
      priceTiers: product.priceTiers.map((t) => ({
        minGrams: t.minGrams,
        pricePerKg: t.pricePerKg,
      })),
      packagings: product.packagings.map((pkg) => ({
        id: pkg.id,
        name: pkg.name,
        weightGrams: pkg.weightGrams,
        isSample: pkg.isSample,
        samplePrice: pkg.samplePrice,
      })),
    }
  }, [product])

  // Tính toán báo giá realtime
  const quoteResult = useMemo(() => {
    const lines = Object.entries(quantities)
      .filter(([, q]) => q > 0)
      .map(([packagingId, quantity]) => ({
        productId: product.id,
        packagingId,
        quantity,
      }))

    return priceCart({
      lines,
      products: [pricingProduct],
      groupDiscountPercent: userDiscount,
    })
  }, [quantities, pricingProduct, userDiscount, product.id])

  const summary = quoteResult.productSummaries[0]
  const currentTotalGrams = summary?.totalGrams || 0
  const currentTotalKg = currentTotalGrams / 1000
  const moqKg = product.moqGrams / 1000
  const meetsMoq = summary?.meetsMoq ?? false
  const missingKg = (summary?.missingGramsForMoq || 0) / 1000

  const stockWarningCheck = useMemo(
    () =>
      evaluateCartItemStockWarning({
        productName: product.name,
        requestedGrams: currentTotalGrams,
        publicStock: product.publicStock,
      }),
    [product.name, currentTotalGrams, product.publicStock]
  )
  const isTrackedAndUnorderable =
    Boolean(product.publicStock?.tracked) && !product.publicStock?.isOrderable

  // Xử lý tăng / giảm số lượng
  const handleQuantityChange = (pkgId: string, delta: number) => {
    setQuantities((prev) => {
      const current = prev[pkgId] || 0
      const next = Math.max(0, current + delta)
      return { ...prev, [pkgId]: next }
    })
  }

  // Thêm các quy cách thường đã chọn vào giỏ hàng
  const handleAddToCart = () => {
    startTransition(() => {
      const itemsToAdd = Object.entries(quantities).filter(([, q]) => q > 0)
      if (itemsToAdd.length === 0) {
        toast.error('Vui lòng chọn ít nhất một quy cách sản phẩm')
        return
      }

      itemsToAdd.forEach(([packagingId, quantity]) => {
        addItem(product.id, packagingId, quantity)
      })

      toast.success(`Đã thêm ${currentTotalKg} kg ${product.name} vào giỏ hàng`, {
        description: meetsMoq
          ? 'Đã đạt MOQ - Bạn có thể xem giỏ và tiến hành đặt hàng'
          : `Lưu ý: Chưa đạt MOQ ${moqKg}kg (thiếu ${missingKg}kg)`,
        action: {
          label: 'Xem giỏ hàng',
          onClick: () => {
            router.push('/gio-hang')
          },
        },
      })
    })
  }

  // Thêm gói mẫu thử vào giỏ hàng
  const handleAddSample = () => {
    if (!samplePackaging) return
    if (hasPurchasedSample) {
      toast.error('Bạn đã từng mua gói mẫu thử của sản phẩm này')
      return
    }

    const isAlreadyInCart = items.some(
      (item) => item.productId === product.id && item.packagingId === samplePackaging.id
    )

    if (isAlreadyInCart) {
      toast.info(`Gói mẫu thử "${samplePackaging.name}" đã có trong giỏ hàng (quy định tối đa 1 gói).`)
      return
    }

    startTransition(() => {
      addItem(product.id, samplePackaging.id, 1, true)
      toast.success(`Đã thêm gói mẫu thử "${samplePackaging.name}" vào giỏ hàng`, {
        action: {
          label: 'Xem giỏ hàng',
          onClick: () => {
            router.push('/gio-hang')
          },
        },
      })
    })
  }

  return (
    <div className="space-y-6 bg-white p-5 sm:p-7 rounded-3xl border border-slate-200/90 shadow-card">
      <div className="flex items-center justify-between border-b border-slate-100 pb-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Scale className="w-5 h-5 text-emerald-600" />
            Chọn Quy Cách & Xem Trước Giá Realtime
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Giá tự động nhảy theo tổng sản lượng các quy cách cộng lại
          </p>
        </div>
        {userDiscount > 0 && (
          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100 font-semibold text-xs">
            Chiết khấu: -{userDiscount}%
          </Badge>
        )}
      </div>

      {/* Danh sách quy cách đóng gói thường */}
      <div className="space-y-3">
        <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider block">
          1. Quy cách sỉ vụ mùa (cộng dồn khối lượng tính giá bậc)
        </label>
        <div className="space-y-2.5">
          {regularPackagings.map((pkg) => {
            const qty = quantities[pkg.id] || 0
            const pkgKg = pkg.weightGrams / 1000
            const lineGrams = qty * pkg.weightGrams
            const lineKg = lineGrams / 1000

            return (
              <div
                key={pkg.id}
                className={`p-3 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  qty > 0
                    ? 'border-emerald-300 bg-emerald-50/30'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div>
                  <div className="font-semibold text-sm text-slate-900">
                    {pkg.name}
                  </div>
                  <div className="text-xs text-slate-500">
                    Khối lượng tịnh: <strong>{pkgKg} kg / kiện</strong>
                    {qty > 0 && (
                      <span className="text-emerald-700 font-medium ml-2">
                        (= {lineKg} kg)
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center border border-slate-200 rounded-lg bg-white overflow-hidden shadow-2xs">
                    <button
                      type="button"
                      onClick={() => handleQuantityChange(pkg.id, -1)}
                      disabled={qty <= 0}
                      className="w-8 h-8 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="Giảm 1"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min={0}
                      value={qty}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 0
                        setQuantities((prev) => ({
                          ...prev,
                          [pkg.id]: Math.max(0, val),
                        }))
                      }}
                      className="w-12 h-8 text-center text-xs font-bold text-slate-900 border-x border-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleQuantityChange(pkg.id, 1)}
                      className="w-8 h-8 flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors"
                      title="Tăng 1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* THANH TIẾN TRÌNH & ENGINE GIÁ REALTIME */}
      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-600 font-medium flex items-center gap-1.5">
            Tổng sản lượng đang chọn:
          </span>
          <span className="text-sm font-extrabold text-slate-900">
            {currentTotalKg} / {moqKg} kg MOQ
          </span>
        </div>

        {/* Thanh tiến trình khối lượng */}
        <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden relative">
          <div
            className={`h-full transition-all duration-300 ${
              meetsMoq ? 'bg-emerald-600' : 'bg-amber-500'
            }`}
            style={{
              width: `${Math.min(100, (currentTotalKg / moqKg) * 100)}%`,
            }}
          />
        </div>

        {/* Thông báo trạng thái bậc & gợi ý mua thêm */}
        {!meetsMoq ? (
          <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
            <span>
              Chưa đạt MOQ: Bạn cần thêm <strong>{missingKg} kg</strong> nữa để đạt mức đặt sỉ tối thiểu.
            </span>
          </div>
        ) : summary?.nextTier ? (
          <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 p-2.5 rounded-lg border border-blue-200">
            <TrendingDown className="w-4 h-4 shrink-0 text-blue-600" />
            <span>
              Mua thêm <strong>{summary.nextTier.missingGrams / 1000} kg</strong> để nâng lên bậc giá rẻ hơn:{' '}
              <strong className="text-blue-900">
                {formatVND(
                  userDiscount > 0
                    ? Math.round(
                        (summary.nextTier.pricePerKg * (100 - userDiscount)) / 100
                      )
                    : summary.nextTier.pricePerKg
                )}
                /kg
              </strong>
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-emerald-800 bg-emerald-50 p-2.5 rounded-lg border border-emerald-200 font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>Bạn đã đạt bậc giá sỉ ưu đãi cao nhất cho sản phẩm này!</span>
          </div>
        )}

        {/* Bảng tóm tắt đơn giá và thành tiền tạm tính */}
        <div className="pt-2 border-t border-slate-200/60 grid grid-cols-2 gap-4 text-xs">
          <div>
            <span className="text-slate-500 block">Đơn giá áp dụng:</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-base font-extrabold text-emerald-700">
                {formatVND(summary?.unitPricePerKg || 0)}
              </span>
              <span className="text-[11px] text-slate-500">/kg</span>
            </div>
          </div>

          <div className="text-right">
            <span className="text-slate-500 block">Tạm tính sản phẩm:</span>
            <span className="text-base font-extrabold text-slate-900 mt-0.5 block">
              {formatVND(quoteResult.subtotal)}
            </span>
          </div>
        </div>
      </div>

      {/* Cảnh báo vượt tồn kho khả dụng hoặc hết hàng (F01D) */}
      {product.publicStock?.tracked &&
        (isTrackedAndUnorderable || stockWarningCheck.exceedsStock) && (
          <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <strong className="font-bold block">
                {isTrackedAndUnorderable
                  ? product.publicStock.detailLabel
                  : 'Số lượng chọn vượt quá tồn kho khả dụng'}
              </strong>
              {stockWarningCheck.warningMessage && !isTrackedAndUnorderable && (
                <span className="text-[11px] text-rose-700 mt-0.5 block">
                  {stockWarningCheck.warningMessage}
                </span>
              )}
            </div>
          </div>
        )}

      {/* Nút thêm quy cách sỉ vào giỏ */}
      <div>
        <Button
          onClick={handleAddToCart}
          disabled={
            isPending ||
            currentTotalKg === 0 ||
            isTrackedAndUnorderable ||
            stockWarningCheck.exceedsStock
          }
          className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-2 text-sm rounded-full shadow-btn-glow hover:-translate-y-0.5 transition-all disabled:opacity-50"
        >
          <ShoppingCart className="w-4 h-4" />
          {isTrackedAndUnorderable
            ? product.publicStock?.status === 'OUT_OF_STOCK'
              ? 'Tạm hết hàng khả dụng'
              : 'Chưa đủ tồn kho tối thiểu (MOQ)'
            : stockWarningCheck.exceedsStock
            ? 'Vượt quá tồn kho khả dụng'
            : `Thêm ${currentTotalKg > 0 ? `${currentTotalKg} kg` : ''} vào giỏ hàng`}
        </Button>
      </div>

      {/* KHỐI GÓI MẪU THỬ TEST CHẤT LƯỢNG */}
      {samplePackaging && (
        <div className="pt-4 border-t border-slate-100">
          <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-1.5 font-bold text-xs text-amber-900">
                <Sparkles className="w-4 h-4 text-amber-600" />
                {samplePackaging.name}
              </div>
              <p className="text-[11px] text-amber-800 mt-0.5">
                Khối lượng {gramsToKg(samplePackaging.weightGrams)}kg. Hàng mẫu không áp MOQ, không chiết khấu nhóm. Tối đa 1 gói/khách hàng.
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <span className="text-sm font-extrabold text-amber-900">
                {formatVND(samplePackaging.samplePrice || 0)}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={handleAddSample}
                disabled={hasPurchasedSample || isPending}
                className="border-amber-300 text-amber-900 hover:bg-amber-100 text-xs font-semibold"
              >
                {hasPurchasedSample ? (
                  'Đã mua mẫu trước đó'
                ) : (
                  <>
                    <PackageCheck className="w-3.5 h-3.5 mr-1" />
                    Mua gói mẫu
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
