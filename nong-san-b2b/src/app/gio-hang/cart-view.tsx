'use client'

import { useSyncExternalStore, useState, useEffect } from 'react'
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
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { useCartStore } from '@/lib/cart-store'
import { formatVND } from '@/lib/money'
import { quoteCart, QuoteCartResponse } from '@/actions/cart'
import { toast } from 'sonner'

const emptySubscribe = () => () => {}

export function CartView() {
  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  )

  const items = useCartStore((state) => state.items)
  const updateQuantity = useCartStore((state) => state.updateQuantity)
  const removeItem = useCartStore((state) => state.removeItem)
  const clearCart = useCartStore((state) => state.clearCart)

  const [quoteData, setQuoteData] = useState<QuoteCartResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Cập nhật quote khi items thay đổi
  useEffect(() => {
    if (!isMounted) return

    let isCancelled = false

    quoteCart(items)
      .then((data) => {
        if (!isCancelled) {
          setQuoteData(data)
          setIsLoading(false)
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          console.error('Error fetching cart quote:', err)
          setIsLoading(false)
          toast.error('Không thể tính giá giỏ hàng, vui lòng thử lại')
        }
      })

    return () => {
      isCancelled = true
    }
  }, [items, isMounted])

  if (!isMounted) {
    return (
      <div className="py-20 text-center">
        <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto mb-3" />
        <p className="text-sm text-slate-500 font-medium">Đang tải giỏ hàng...</p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-16 px-4 text-center">
        <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-6 border border-emerald-200">
          <ShoppingCart className="w-10 h-10 text-emerald-600" />
        </div>
        <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
          Giỏ hàng của bạn đang trống
        </h2>
        <p className="text-slate-600 text-sm mt-2 max-w-md mx-auto leading-relaxed">
          Chưa có sản phẩm trái cây nào trong giỏ. Hãy khám phá danh mục vụ mùa tuyển chọn từ các nhà vườn đạt chuẩn VietGAP & GlobalGAP.
        </p>
        <div className="mt-8">
          <Link href="/san-pham">
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm px-6 py-2.5 shadow-sm">
              Khám phá sản phẩm vụ mùa
            </Button>
          </Link>
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
  const isCartValid = quote?.isValid ?? false

  // Gom các dòng theo sản phẩm
  const allProductIds = Array.from(
    new Set([
      ...regularLines.map((l) => l.productId),
      ...sampleLines.map((l) => l.productId),
    ])
  )

  return (
    <div className="space-y-8">
      {/* Tiêu đề & thông tin nhóm khách hàng */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
            <ShoppingCart className="w-7 h-7 text-emerald-600" />
            Giỏ Hàng Sỉ B2B
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Giá nhảy tự động theo tổng sản lượng quy cách của từng sản phẩm
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-emerald-50/70 border border-emerald-200 px-3.5 py-2 rounded-xl flex items-center gap-2.5 text-xs text-emerald-900">
            <Building2 className="w-4 h-4 text-emerald-600" />
            <div>
              <span>Nhóm: <strong>{groupName}</strong></span>
              {userDiscount > 0 && (
                <Badge className="ml-2 bg-emerald-600 text-white text-[10px] px-1.5 py-0">
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
              }
            }}
            className="text-slate-400 hover:text-rose-600 text-xs gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" /> Xóa giỏ
          </Button>
        </div>
      </div>

      {/* Grid: Danh sách sản phẩm (8 cols) & Tóm tắt đơn hàng (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Cột trái: Các sản phẩm trong giỏ */}
        <div className="lg:col-span-8 space-y-6">
          {allProductIds.map((productId) => {
            const meta = metadata[productId]
            const summary = summaries.find((s) => s.productId === productId)
            const prodRegularLines = regularLines.filter((l) => l.productId === productId)
            const prodSampleLines = sampleLines.filter((l) => l.productId === productId)

            const totalKg = (summary?.totalGrams || 0) / 1000
            const moqKg = meta ? meta.moqKg : 50
            const meetsMoq = summary?.meetsMoq ?? (prodRegularLines.length === 0)
            const missingKg = (summary?.missingGramsForMoq || 0) / 1000

            return (
              <div
                key={productId}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs"
              >
                {/* Header sản phẩm */}
                <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
                  <div className="flex items-center gap-3">
                    {meta?.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={meta.image}
                        alt={meta.name}
                        className="w-12 h-12 rounded-xl object-cover border border-slate-200 shrink-0"
                      />
                    )}
                    <div>
                      <Link
                        href={meta ? `/san-pham/${meta.slug}` : '#'}
                        className="font-bold text-slate-900 hover:text-emerald-700 transition-colors text-base"
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
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold text-xs gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          Đạt MOQ ({totalKg} kg)
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="bg-rose-100 text-rose-800 border-rose-300 font-bold text-xs gap-1">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                          Chưa đạt MOQ (Thiếu {missingKg} kg)
                        </Badge>
                      )}
                    </div>
                  )}
                </div>

                {/* Khối thanh tiến trình bậc giá cho sản phẩm */}
                {prodRegularLines.length > 0 && summary && (
                  <div className="px-4 sm:px-5 py-3.5 bg-slate-50 border-b border-slate-100 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 font-medium">
                        Tổng sản lượng quy cách thường: <strong>{totalKg} kg</strong>
                      </span>
                      <div className="flex items-center gap-1.5 font-bold">
                        <span className="text-slate-500">Đơn giá bậc:</span>
                        <span className="text-emerald-700 text-sm">
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
                    <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
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
                      <p className="text-[11px] text-rose-600 font-medium">
                        ⚠️ Cần đặt thêm tối thiểu <strong>{missingKg} kg</strong> của sản phẩm này để có thể đặt hàng.
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
                    const lineKg = line.totalGrams / 1000

                    return (
                      <div
                        key={line.packagingId}
                        className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        <div className="space-y-1">
                          <div className="font-semibold text-sm text-slate-900 flex items-center gap-2">
                            <Package className="w-4 h-4 text-slate-400" />
                            {line.packagingName}
                          </div>
                          <div className="text-xs text-slate-500">
                            Quy cách: {line.weightGrams / 1000} kg/kiện • Tổng:{' '}
                            <strong className="text-slate-800">{lineKg} kg</strong>
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-6">
                          {/* Bộ tăng giảm số lượng */}
                          <div className="flex items-center border border-slate-200 rounded-lg bg-white overflow-hidden shadow-2xs">
                            <button
                              type="button"
                              onClick={() =>
                                updateQuantity(line.productId, line.packagingId, line.quantity - 1)
                              }
                              className="w-8 h-8 flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors"
                              aria-label={`Giảm số lượng ${line.packagingName}`}
                              title="Giảm số lượng"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <span className="w-12 h-8 flex items-center justify-center text-xs font-bold text-slate-900 border-x border-slate-200">
                              {line.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                updateQuantity(line.productId, line.packagingId, line.quantity + 1)
                              }
                              className="w-8 h-8 flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors"
                              aria-label={`Tăng số lượng ${line.packagingName}`}
                              title="Tăng số lượng"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Thành tiền dòng */}
                          <div className="text-right min-w-[120px]">
                            <div className="text-sm font-extrabold text-slate-900">
                              {formatVND(line.lineTotal)}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {formatVND(line.unitPricePerKg)}/kg
                            </div>
                          </div>

                          {/* Nút xóa dòng */}
                          <button
                            type="button"
                            onClick={() => removeItem(line.productId, line.packagingId)}
                            className="text-slate-400 hover:text-rose-600 transition-colors p-1"
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
                          <Badge className="bg-amber-600 text-white text-[10px]">
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
                                onClick={() => updateQuantity(sample.productId, sample.packagingId, 1)}
                                className="text-[11px] text-emerald-700 underline hover:text-emerald-900 font-bold"
                              >
                                [Giảm về 1 gói]
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="text-right min-w-[120px]">
                          <div className="text-sm font-extrabold text-amber-900">
                            {formatVND(sample.lineTotal)}
                          </div>
                          <div className="text-[11px] text-amber-700">
                            {sample.quantity > 1 ? `${formatVND(sample.samplePrice)} × ${sample.quantity}` : 'Giá trọn gói'}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeItem(sample.productId, sample.packagingId)}
                          className="text-amber-600 hover:text-rose-600 transition-colors p-1"
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

        {/* Cột phải: Tóm tắt đơn hàng B2B */}
        <div className="lg:col-span-4 sticky top-24 space-y-4">
          <Card className="border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
            <div className="bg-slate-900 text-white p-4">
              <h3 className="font-bold text-sm tracking-wide uppercase flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400" /> Tóm Tắt Đơn Hàng Sỉ
              </h3>
            </div>

            <CardContent className="p-5 space-y-4">
              {/* Chi tiết tiền */}
              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Tạm tính tiền hàng:</span>
                  <strong className="text-slate-900 text-sm">
                    {formatVND(quote?.subtotal || 0)}
                  </strong>
                </div>

                <div className="flex justify-between text-slate-600">
                  <span>Chiết khấu nhóm đối tác:</span>
                  <span className="font-medium text-emerald-700">
                    {userDiscount > 0 ? `Đã trừ ${userDiscount}%` : '0%'}
                  </span>
                </div>

                <div className="flex justify-between text-slate-600 pt-2 border-t border-slate-100">
                  <span>Phí vận chuyển:</span>
                  <span className="text-slate-500 italic">Tính ở bước thanh toán</span>
                </div>
              </div>

              {/* Tổng cộng */}
              <div className="pt-3 border-t border-slate-200 flex items-baseline justify-between">
                <div>
                  <span className="block text-xs font-bold text-slate-900 uppercase">
                    Tổng tiền hàng
                  </span>
                  <span className="text-[11px] text-slate-400">Chưa gồm phí ship</span>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-black text-emerald-700">
                    {formatVND(quote?.subtotal || 0)}
                  </span>
                </div>
              </div>

              {/* Thông báo lỗi MOQ nếu có */}
              {!isCartValid && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 space-y-1">
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
              <div className="pt-2 space-y-2">
                <Link href={isCartValid ? '/thanh-toan' : '#'}>
                  <Button
                    disabled={!isCartValid || isLoading}
                    className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm gap-2 shadow-sm disabled:bg-slate-300 disabled:cursor-not-allowed"
                  >
                    Tiến hành đặt hàng <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>

                <Link href="/san-pham" className="block text-center">
                  <Button variant="ghost" size="sm" className="w-full text-xs text-slate-600 hover:text-slate-900">
                    ← Tiếp tục mua sắm vụ mùa
                  </Button>
                </Link>
              </div>

              {/* Cam kết B2B */}
              <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-500 space-y-1.5">
                <div className="flex items-center gap-1.5 text-slate-700 font-semibold">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Chính sách sỉ & bảo vệ quyền lợi
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
