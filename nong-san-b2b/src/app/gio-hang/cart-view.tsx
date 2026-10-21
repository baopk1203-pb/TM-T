'use client'

import { useSyncExternalStore, useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import {
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  Sparkles,
  Package,
  Layers,
  ShieldCheck,
  Building2,
  RefreshCw,
  Truck,
  CreditCard,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { useCartStore, CartItem } from '@/lib/cart-store'
import { formatVND } from '@/lib/money'
import { getCartDiscountDisplay, calculateCartSavings } from '@/lib/cart-summary'
import { quoteCart, QuoteCartResponse } from '@/actions/cart'
import { toast } from 'sonner'

const emptySubscribe = () => () => {}

/**
 * Kiểm tra đối chiếu xem dữ liệu báo giá hiện hành có khớp chính xác
 * với danh sách mặt hàng và số lượng thực tế trong store giỏ hàng hay không.
 */
export function isQuoteInSyncWithItems(
  items: CartItem[],
  quoteData: QuoteCartResponse | null
): boolean {
  if (!quoteData || !quoteData.quote) return false

  const activeItems = items.filter((i) => i.quantity > 0)
  const quotedLines = [
    ...(quoteData.quote.lines || []),
    ...(quoteData.quote.sampleLines || []),
  ]

  // Số lượng dòng sản phẩm khác nhau -> báo giá không còn khớp
  if (activeItems.length !== quotedLines.length) {
    return false
  }

  // Đối chiếu từng mặt hàng và số lượng quy cách
  for (const item of activeItems) {
    const matched = quotedLines.find(
      (q) => q.productId === item.productId && q.packagingId === item.packagingId
    )
    if (!matched || matched.quantity !== item.quantity) {
      return false
    }
  }

  return true
}

export function CartView() {
  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  )

  const items = useCartStore((state) => state.items)
  const updateQuantity = useCartStore((state) => state.updateQuantity)
  const incrementQuantity = useCartStore((state) => state.incrementQuantity)
  const removeItem = useCartStore((state) => state.removeItem)
  const clearCart = useCartStore((state) => state.clearCart)

  const [quoteData, setQuoteData] = useState<QuoteCartResponse | null>(null)
  const [isQuoting, setIsQuoting] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const isInitialMount = useRef(true)
  const requestSeqRef = useRef(0)

  // Cập nhật quote khi items thay đổi (với debounce 200ms cho các thao tác click liên tục)
  useEffect(() => {
    if (!isMounted) return

    let isCancelled = false

    if (items.length === 0) {
      return
    }

    const fetchQuote = () => {
      requestSeqRef.current += 1
      const currentSeq = requestSeqRef.current

      setIsQuoting(true)
      quoteCart(items)
        .then((data) => {
          if (!isCancelled && currentSeq === requestSeqRef.current) {
            setQuoteData(data)
            setQuoteError(null)
            setIsQuoting(false)
          }
        })
        .catch((err) => {
          if (!isCancelled && currentSeq === requestSeqRef.current) {
            console.error('Error fetching cart quote:', err)
            setIsQuoting(false)
            setQuoteError('Không thể tính giá giỏ hàng mới nhất, vui lòng thử lại sau.')
            toast.error('Không thể tính giá giỏ hàng, vui lòng thử lại')
          }
        })
    }

    // Lần đầu mount: fetch ngay lập tức không delay
    if (isInitialMount.current) {
      isInitialMount.current = false
      fetchQuote()
      return () => {
        isCancelled = true
      }
    }

    // Các lần thay đổi sau: debounce 200ms để gộp thao tác click nhanh
    const timer = setTimeout(() => {
      fetchQuote()
    }, 200)

    return () => {
      isCancelled = true
      clearTimeout(timer)
    }
  }, [items, isMounted])

  if (!isMounted) {
    return (
      <div className="py-24 text-center">
        <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto mb-3" />
        <p className="text-sm text-slate-500 font-medium">Đang tải giỏ hàng...</p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-16 px-4 text-center">
        <div className="w-20 h-20 bg-emerald-50 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-emerald-200/80 shadow-xs">
          <ShoppingCart className="w-10 h-10 text-emerald-600" />
        </div>
        <h2 className="font-heading text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Giỏ hàng của bạn đang trống
        </h2>
        <p className="text-slate-600 text-sm mt-2 max-w-md mx-auto leading-relaxed">
          Chưa có sản phẩm trái cây nào trong giỏ. Hãy khám phá danh mục vụ mùa tuyển chọn từ các nhà vườn đạt chuẩn VietGAP &amp; GlobalGAP.
        </p>
        <div className="mt-8">
          <Link href="/san-pham">
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm px-8 py-6 rounded-full shadow-btn-glow gap-2 hover:-translate-y-0.5 transition-all">
              <span>Khám phá sản phẩm vụ mùa</span>
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  if (items.length > 0 && !quoteData) {
    if (quoteError) {
      return (
        <div className="max-w-md mx-auto py-16 px-4 text-center space-y-4">
          <div className="w-16 h-16 bg-rose-50 rounded-3xl flex items-center justify-center mx-auto border border-rose-200">
            <AlertTriangle className="w-8 h-8 text-rose-600" />
          </div>
          <h2 className="font-heading text-xl font-bold text-slate-900">Không thể tải báo giá giỏ hàng</h2>
          <p className="text-xs text-slate-500">{quoteError}</p>
          <Button
            onClick={() => {
              setQuoteError(null)
              setIsQuoting(true)
              quoteCart(items)
                .then((data) => setQuoteData(data))
                .catch(() => setQuoteError('Không thể kết nối máy chủ, vui lòng thử lại sau.'))
                .finally(() => setIsQuoting(false))
            }}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-full px-6"
          >
            Thử lại
          </Button>
        </div>
      )
    }

    return (
      <div className="space-y-8 animate-pulse">
        <div className="h-20 bg-white rounded-3xl border border-slate-200 p-6" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-8 space-y-4">
            <div className="h-44 bg-white rounded-3xl border border-slate-200 p-6 flex flex-col justify-center items-center text-center">
              <RefreshCw className="w-6 h-6 text-emerald-600 animate-spin mb-2" />
              <p className="text-xs text-slate-500 font-medium">
                Đang đối chiếu bậc giá sỉ &amp; chiết khấu nhóm đối tác...
              </p>
            </div>
          </div>
          <div className="lg:col-span-4">
            <div className="h-64 bg-white rounded-3xl border border-slate-200 p-6 space-y-4" />
          </div>
        </div>
      </div>
    )
  }

  const quote = quoteData?.quote
  const summaries = quote?.productSummaries || []
  const regularLines = quote?.lines || []
  const sampleLines = quote?.sampleLines || []
  const metadata = quoteData?.productMetadata || {}
  const userDiscount = quoteData?.userDiscountPercent || 0
  const groupName = quoteData?.groupName || 'Khách vãng lai'

  // Đối chiếu tính tươi mới của báo giá: Báo giá chỉ hợp lệ khi khớp chính xác giỏ hàng hiện hành
  const isQuoteFresh = isQuoteInSyncWithItems(items, quoteData)
  const isCartValid = (quote?.isValid ?? false) && isQuoteFresh
  const canCheckout = isCartValid && !isQuoting && !quoteError

  // Gom các dòng theo sản phẩm (chỉ giữ sản phẩm còn trong store items)
  const allProductIds = Array.from(
    new Set([
      ...regularLines.map((l) => l.productId),
      ...sampleLines.map((l) => l.productId),
    ])
  ).filter((productId) => items.some((i) => i.productId === productId))

  return (
    <div className="space-y-8">
      {/* STITCH 4-STEP PROGRESS STEPPER */}
      <div className="w-full bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-xs">
        <div className="grid grid-cols-4 relative max-w-4xl mx-auto">
          <div className="absolute top-1/2 left-[12.5%] right-[12.5%] -translate-y-1/2 h-1 bg-slate-100 pointer-events-none -z-0">
            <div className="h-full bg-emerald-600 transition-all duration-500 rounded-full" style={{ width: '0%' }} />
          </div>

          {/* Bước 1: Active */}
          <div className="relative z-10 flex flex-col items-center text-center">
            <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-md ring-4 ring-emerald-100">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div className="mt-2 flex flex-col items-center">
              <span className="text-[10px] text-emerald-700 font-extrabold uppercase tracking-wider">Bước 1</span>
              <span className="text-xs sm:text-sm font-bold text-slate-900">Giỏ hàng</span>
            </div>
          </div>

          {/* Bước 2: Inactive */}
          <div className="relative z-10 flex flex-col items-center text-center opacity-60">
            <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center font-bold text-sm">
              <Truck className="w-5 h-5" />
            </div>
            <div className="mt-2 flex flex-col items-center">
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Bước 2</span>
              <span className="text-xs sm:text-sm font-medium text-slate-600">Giao nhận</span>
            </div>
          </div>

          {/* Bước 3: Inactive */}
          <div className="relative z-10 flex flex-col items-center text-center opacity-60">
            <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center font-bold text-sm">
              <CreditCard className="w-5 h-5" />
            </div>
            <div className="mt-2 flex flex-col items-center">
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Bước 3</span>
              <span className="text-xs sm:text-sm font-medium text-slate-600">Thanh toán</span>
            </div>
          </div>

          {/* Bước 4: Inactive */}
          <div className="relative z-10 flex flex-col items-center text-center opacity-60">
            <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center font-bold text-sm">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="mt-2 flex flex-col items-center">
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Bước 4</span>
              <span className="text-xs sm:text-sm font-medium text-slate-600">Hoàn tất</span>
            </div>
          </div>
        </div>
      </div>

      {/* HEADER & PARTNER STATUS BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 sm:p-6 rounded-3xl border border-slate-200/90 shadow-xs">
        <div>
          <h1 className="font-heading text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
            <ShoppingCart className="w-7 h-7 text-emerald-600" />
            Giỏ Hàng Sỉ B2B
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Giá nhảy tự động theo tổng sản lượng quy cách của từng sản phẩm
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-full flex items-center gap-2.5 text-xs text-emerald-900 shadow-2xs">
            <Building2 className="w-4 h-4 text-emerald-600" />
            <div>
              <span>Nhóm đối tác: <strong>{groupName}</strong></span>
              {userDiscount > 0 && (
                <Badge className="ml-2 bg-emerald-600 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">
                  -{userDiscount}%
                </Badge>
              )}
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm('Bạn có chắc muốn xóa toàn bộ sản phẩm trong giỏ hàng?')) {
                clearCart()
                setQuoteData(null)
                setIsQuoting(false)
                setQuoteError(null)
              }
            }}
            className="text-slate-400 hover:text-rose-600 text-xs gap-1.5 rounded-full px-3"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Xóa giỏ</span>
          </Button>
        </div>
      </div>

      {/* MAIN TWO COLUMN LAYOUT: ITEMS (8 COLS) & STICKY SUMMARY (4 COLS) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* CỘT TRÁI: CÁC SẢN PHẨM TRONG GIỎ */}
        <div className="lg:col-span-8 space-y-6">
          {allProductIds.map((productId) => {
            const meta = metadata[productId]
            const summary = summaries.find((s) => s.productId === productId)
            const prodRegularLines = regularLines
              .filter((l) => l.productId === productId)
              .filter((l) =>
                items.some((i) => i.productId === l.productId && i.packagingId === l.packagingId)
              )
            const prodSampleLines = sampleLines
              .filter((l) => l.productId === productId)
              .filter((l) =>
                items.some((i) => i.productId === l.productId && i.packagingId === l.packagingId)
              )

            const totalKg = (summary?.totalGrams || 0) / 1000
            const moqKg = meta ? meta.moqKg : 50
            const meetsMoq = summary?.meetsMoq ?? (prodRegularLines.length === 0)
            const missingKg = (summary?.missingGramsForMoq || 0) / 1000

            return (
              <div
                key={productId}
                className="bg-white rounded-3xl border border-slate-200/90 overflow-hidden shadow-card hover:border-emerald-300 transition-all"
              >
                {/* Header sản phẩm */}
                <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
                  <div className="flex items-center gap-3.5">
                    {meta?.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={meta.image}
                        alt={meta.name}
                        className="w-14 h-14 rounded-2xl object-cover border border-slate-200/80 shrink-0 shadow-2xs"
                      />
                    )}
                    <div>
                      <Link
                        href={meta ? `/san-pham/${meta.slug}` : '#'}
                        className="font-heading font-bold text-slate-900 hover:text-emerald-700 transition-colors text-base line-clamp-1"
                      >
                        {meta?.name || 'Sản phẩm sỉ'}
                      </Link>
                      <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                        <span>Nhà vườn: <strong>{meta?.farmName}</strong> ({meta?.farmProvince})</span>
                        <span>•</span>
                        <span>MOQ: <strong>{moqKg} kg</strong></span>
                      </div>
                    </div>
                  </div>

                  {/* Badge trạng thái MOQ */}
                  {prodRegularLines.length > 0 && (
                    <div>
                      {meetsMoq ? (
                        <Badge className="bg-emerald-50 text-emerald-800 border-emerald-300 font-bold text-xs gap-1.5 px-3 py-1 rounded-full shadow-2xs">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          Đạt MOQ ({totalKg} kg)
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="bg-rose-50 text-rose-800 border-rose-300 font-bold text-xs gap-1.5 px-3 py-1 rounded-full shadow-2xs">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                          Chưa đạt MOQ (Thiếu {missingKg} kg)
                        </Badge>
                      )}
                    </div>
                  )}
                </div>

                {/* Khối thanh tiến trình bậc giá cho sản phẩm */}
                {prodRegularLines.length > 0 && summary && (
                  <div className="px-4 sm:px-6 py-4 bg-emerald-50/20 border-b border-slate-100 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 font-medium">
                        Tổng sản lượng quy cách thường: <strong className="text-slate-900">{totalKg} kg</strong>
                      </span>
                      <div className="flex items-center gap-1.5 font-bold">
                        <span className="text-slate-500">Đơn giá bậc:</span>
                        <span className="font-heading text-emerald-700 text-sm font-extrabold">
                          {formatVND(summary.unitPricePerKg)}/kg
                        </span>
                        {userDiscount > 0 && (
                          <span className="text-[11px] text-slate-400 line-through">
                            {formatVND(summary.basePricePerKg)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full bg-slate-200/80 h-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          meetsMoq ? 'bg-emerald-600' : 'bg-amber-500'
                        }`}
                        style={{
                          width: `${Math.min(100, (totalKg / moqKg) * 100)}%`,
                        }}
                      />
                    </div>

                    {/* Hint */}
                    {!meetsMoq ? (
                      <p className="text-[11px] text-rose-600 font-medium flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        Cần đặt thêm tối thiểu <strong>{missingKg} kg</strong> của sản phẩm này để có thể đặt hàng.
                      </p>
                    ) : summary.nextTier ? (
                      <p className="text-[11px] text-blue-700 font-medium flex items-center gap-1">
                        <TrendingDown className="w-3.5 h-3.5 shrink-0" />
                        Mua thêm <strong>{summary.nextTier.missingGrams / 1000} kg</strong> để nâng lên bậc giá ưu đãi hơn:{' '}
                        <strong>
                          {formatVND(
                            userDiscount > 0
                              ? Math.round(
                                  (summary.nextTier.pricePerKg * (100 - userDiscount)) / 100
                                )
                              : summary.nextTier.pricePerKg
                          )}
                          /kg
                        </strong>
                      </p>
                    ) : (
                      <p className="text-[11px] text-emerald-700 font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        Đang áp dụng bậc giá sỉ ưu đãi cao nhất!
                      </p>
                    )}
                  </div>
                )}

                {/* Danh sách các quy cách sỉ của sản phẩm */}
                <div className="divide-y divide-slate-100">
                  {prodRegularLines.map((line) => {
                    const storeItem = items.find(
                      (i) => i.productId === line.productId && i.packagingId === line.packagingId
                    )
                    const currentQuantity = storeItem ? storeItem.quantity : line.quantity
                    const packagingWeightKg = line.weightGrams / 1000
                    const lineKg = packagingWeightKg * currentQuantity
                    const displayLineTotal =
                      storeItem && storeItem.quantity !== line.quantity
                        ? line.unitPricePerKg * packagingWeightKg * currentQuantity
                        : line.lineTotal

                    return (
                      <div
                        key={line.packagingId}
                        className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/40 transition-colors"
                      >
                        <div className="space-y-1">
                          <div className="font-semibold text-sm text-slate-900 flex items-center gap-2">
                            <Package className="w-4 h-4 text-emerald-600" />
                            {line.packagingName}
                          </div>
                          <div className="text-xs text-slate-500">
                            Quy cách: {packagingWeightKg} kg/kiện • Tổng khối lượng:{' '}
                            <strong className="text-slate-800">{lineKg} kg</strong>
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-6">
                          {/* Segmented Stepper Pill */}
                          <div className="flex items-center bg-slate-100/90 rounded-full p-1 border border-slate-200/80 shadow-inner">
                            <button
                              type="button"
                              onClick={() => {
                                setIsQuoting(true)
                                setQuoteError(null)
                                incrementQuantity(line.productId, line.packagingId, -1)
                              }}
                              className="w-7 h-7 rounded-full bg-white text-slate-700 flex items-center justify-center hover:bg-emerald-600 hover:text-white transition-colors font-bold shadow-xs"
                              aria-label={`Giảm số lượng ${line.packagingName}`}
                              title="Giảm số lượng"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <input
                              type="number"
                              min={0}
                              value={currentQuantity}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 0
                                updateQuantity(line.productId, line.packagingId, Math.max(0, val))
                              }}
                              className="w-10 text-center text-xs font-bold text-slate-900 bg-transparent focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setIsQuoting(true)
                                setQuoteError(null)
                                incrementQuantity(line.productId, line.packagingId, 1)
                              }}
                              className="w-7 h-7 rounded-full bg-white text-slate-700 flex items-center justify-center hover:bg-emerald-600 hover:text-white transition-colors font-bold shadow-xs"
                              aria-label={`Tăng số lượng ${line.packagingName}`}
                              title="Tăng số lượng"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Thành tiền dòng */}
                          <div className="text-right min-w-[120px]">
                            <div className="font-heading text-sm sm:text-base font-extrabold text-slate-900">
                              {formatVND(displayLineTotal)}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {formatVND(line.unitPricePerKg)}/kg
                            </div>
                          </div>

                          {/* Nút xóa dòng */}
                          <button
                            type="button"
                            onClick={() => {
                              setIsQuoting(true)
                              setQuoteError(null)
                              removeItem(line.productId, line.packagingId)
                            }}
                            className="text-slate-400 hover:text-rose-600 transition-colors p-1.5 rounded-full hover:bg-rose-50"
                            aria-label={`Xóa ${line.packagingName} khỏi giỏ hàng`}
                            title="Xóa quy cách này"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )
                  })}

                  {/* Dòng hàng mẫu nếu có */}
                  {prodSampleLines.map((sample) => (
                    <div
                      key={sample.packagingId}
                      className="p-4 sm:p-5 bg-amber-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-l-4 border-amber-400"
                    >
                      <div className="space-y-1">
                        <div className="font-semibold text-sm text-amber-950 flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-amber-600" />
                          {sample.packagingName}
                          <Badge className="bg-amber-600 text-white text-[10px] rounded-full">
                            Hàng mẫu thử
                          </Badge>
                        </div>
                        <p className="text-[11px] text-amber-800">
                          Khối lượng {sample.weightGrams / 1000}kg. Giá trọn gói cố định, không áp MOQ và chiết khấu.
                        </p>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-6">
                        <div className="text-left sm:text-right">
                          <span className="text-xs text-amber-900 font-semibold block">
                            Số lượng: {sample.quantity} gói {sample.quantity === 1 ? '(Tối đa)' : ''}
                          </span>
                          {sample.quantity > 1 && (
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[11px] font-semibold text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded">
                                Vượt quá tối đa 1 gói
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setIsQuoting(true)
                                  setQuoteError(null)
                                  updateQuantity(sample.productId, sample.packagingId, 1)
                                }}
                                className="text-[11px] text-emerald-700 underline hover:text-emerald-900 font-bold"
                              >
                                [Giảm về 1 gói]
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="text-right min-w-[120px]">
                          <div className="font-heading text-sm font-extrabold text-amber-900">
                            {formatVND(sample.lineTotal)}
                          </div>
                          <div className="text-[11px] text-amber-700">
                            {sample.quantity > 1 ? `${formatVND(sample.samplePrice)} × ${sample.quantity}` : 'Giá trọn gói'}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setIsQuoting(true)
                            setQuoteError(null)
                            removeItem(sample.productId, sample.packagingId)
                          }}
                          className="text-amber-600 hover:text-rose-600 transition-colors p-1.5 rounded-full hover:bg-amber-100/50"
                          aria-label={`Xóa gói mẫu ${sample.packagingName} khỏi giỏ hàng`}
                          title="Xóa gói mẫu"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* CỘT PHẢI: TÓM TẮT ĐƠN HÀNG B2B (STICKY ORDER SUMMARY) */}
        <div className="lg:col-span-4 sticky top-24 space-y-4">
          <Card className="border border-slate-200/90 shadow-card rounded-3xl overflow-hidden bg-white">
            <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
              <h3 className="font-heading font-bold text-sm tracking-wide uppercase flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400" /> Tóm Tắt Đơn Hàng Sỉ
              </h3>
              <Badge className="bg-emerald-600 text-white text-[10px] rounded-full px-2 py-0.5">
                B2B Order
              </Badge>
            </div>

            <CardContent className="p-5 sm:p-6 space-y-5">
              {/* Chi tiết tiền */}
              <div className="space-y-3 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Tạm tính tiền hàng:</span>
                  <strong className="font-heading text-slate-900 text-sm font-bold">
                    {formatVND(quote?.subtotal || 0)}
                  </strong>
                </div>

                {(() => {
                  const actualSavings = calculateCartSavings(quote)
                  const discountDisplay = getCartDiscountDisplay({
                    userDiscount,
                    regularLineCount: regularLines.length,
                    sampleLineCount: sampleLines.length,
                    actualSavings,
                  })
                  return (
                    <div className="space-y-0.5">
                      <div className="flex justify-between text-slate-600">
                        <span>{discountDisplay.label}</span>
                        <span className="font-medium text-emerald-700">
                          {discountDisplay.text}
                        </span>
                      </div>
                      {discountDisplay.subtext && (
                        <div className="text-[11px] text-amber-700 italic text-right">
                          {discountDisplay.subtext}
                        </div>
                      )}
                    </div>
                  )
                })()}

                <div className="flex justify-between text-slate-600 pt-3 border-t border-slate-100">
                  <span>Phí vận chuyển:</span>
                  <span className="text-slate-500 italic">Tính ở bước thanh toán</span>
                </div>
              </div>

              {/* Tổng cộng */}
              <div className="pt-3 border-t border-slate-200 flex items-baseline justify-between">
                <div>
                  <span className="block text-xs font-bold text-slate-900 uppercase flex items-center gap-1.5">
                    Tổng tiền hàng
                    {(isQuoting || !isQuoteFresh) && <RefreshCw className="w-3 h-3 text-emerald-600 animate-spin" />}
                  </span>
                  <span className="text-[11px] text-slate-400">Chưa gồm phí ship</span>
                </div>
                <div className="text-right">
                  <span className="font-heading text-2xl font-black text-emerald-700 tracking-tight">
                    {formatVND(quote?.subtotal || 0)}
                  </span>
                </div>
              </div>

              {/* Thông báo lỗi khi tính giá thất bại */}
              {quoteError && (
                <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-rose-900">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    Lỗi tính giá giỏ hàng:
                  </div>
                  <p className="text-[11px] text-rose-700 leading-relaxed">{quoteError}</p>
                </div>
              )}

              {/* Thông báo lỗi MOQ nếu có (chỉ hiển thị khi báo giá đã khớp với giỏ hàng hiện tại) */}
              {!isCartValid && isQuoteFresh && !quoteError && (
                <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800 space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-rose-900">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    Chưa đủ điều kiện đặt hàng:
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                    {quote?.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Nút hành động */}
              <div className="pt-2 space-y-2.5">
                <Link href={canCheckout ? '/thanh-toan' : '#'}>
                  <Button
                    disabled={!canCheckout}
                    className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-full shadow-btn-glow gap-2 disabled:bg-slate-300 disabled:cursor-not-allowed hover:-translate-y-0.5 transition-all"
                  >
                    <span>
                      {quoteError
                        ? 'Không thể tính giá - Vui lòng thử lại'
                        : isQuoting || !isQuoteFresh
                        ? 'Đang cập nhật giá...'
                        : 'Tiến hành đặt hàng'}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>

                <Link href="/san-pham" className="block text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs text-slate-600 hover:text-emerald-700 hover:bg-emerald-50/50 rounded-full"
                  >
                    ← Tiếp tục mua sắm vụ mùa
                  </Button>
                </Link>
              </div>

              {/* Cam kết B2B */}
              <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-500 space-y-1.5 leading-relaxed">
                <div className="flex items-center gap-1.5 text-slate-700 font-semibold">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Chính sách sỉ &amp; bảo vệ quyền lợi
                </div>
                <p>• Hỗ trợ cọc 30% linh hoạt hoặc chuyển khoản 100%.</p>
                <p>• Cân trọng lượng thực tế tại thời điểm bàn giao hàng.</p>
                <p>• Bồi hoàn hư hỏng hao hụt vượt định mức 3% trong 24h.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
