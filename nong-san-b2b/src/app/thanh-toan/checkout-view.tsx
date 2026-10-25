'use client'

import { useState, useEffect, useSyncExternalStore, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  MapPin,
  Calendar as CalendarIcon,
  Truck,
  CreditCard,
  ShieldCheck,
  Plus,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  ShoppingCart,
  Snowflake,
  Info,
  CheckCircle2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCartStore } from '@/lib/cart-store'
import { formatVND } from '@/lib/money'
import { getCheckoutDiscountNotice, calculateCartSavings } from '@/lib/cart-summary'
import { quoteCart, QuoteCartResponse } from '@/actions/cart'
import { placeOrder, calculateShippingQuoteAction } from '@/actions/order'
import { computeDepositAmount } from '@/lib/domain/settlement'
import { RESERVATION_TIMEOUT_MINUTES } from '@/lib/domain/inventory'
import { TimeSlot, PaymentOption, VehicleType } from '@prisma/client'
import { ShippingQuoteResult, DEFAULT_WAREHOUSE } from '@/lib/domain/shipping'
import { toast } from 'sonner'

interface AddressItem {
  id: string
  label: string
  recipient: string
  phone: string
  line: string
  ward: string
  district: string
  province: string
  isDefault: boolean
  lat?: number | null
  lng?: number | null
}

interface CheckoutViewProps {
  addresses: AddressItem[]
  userName: string
}

const emptySubscribe = () => () => {}

export function CheckoutView({ addresses, userName }: CheckoutViewProps) {
  const router = useRouter()
  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  )

  const items = useCartStore((state) => state.items)
  const clearCart = useCartStore((state) => state.clearCart)

  const [quoteData, setQuoteData] = useState<QuoteCartResponse | null>(null)
  const [isQuoting, setIsQuoting] = useState(true)
  const [isSubmitting, startTransition] = useTransition()

  // Form states
  const defaultAddressId = addresses.find((a) => a.isDefault)?.id || addresses[0]?.id || ''
  const [selectedAddressId, setSelectedAddressId] = useState(defaultAddressId)
  const [deliveryDate, setDeliveryDate] = useState('')
  const [timeSlot, setTimeSlot] = useState<TimeSlot>(TimeSlot.MORNING)
  const [paymentOption, setPaymentOption] = useState<PaymentOption>(PaymentOption.DEPOSIT_30)
  const [customerNote, setCustomerNote] = useState('')

  // Shipping Engine states (Phase 8A)
  const [requestedVehicleType, setRequestedVehicleType] = useState<VehicleType>('NORMAL')
  const [shippingQuote, setShippingQuote] = useState<ShippingQuoteResult | null>(null)
  const [isCalculatingShipping, setIsCalculatingShipping] = useState(false)
  const [shippingError, setShippingError] = useState<string | null>(null)

  // Load quote & earliest delivery date
  useEffect(() => {
    if (!isMounted) return

    let isCancelled = false

    const fetchQuote = async () => {
      try {
        const data = await quoteCart(items)
        if (!isCancelled) {
          setQuoteData(data)
          setIsQuoting(false)

          // Tính ngày giao sớm nhất mặc định (hôm nay + maxLeadTime + 1 nếu sau 17h)
          const now = new Date()
          const leadTimes = Object.values(data.productMetadata).map((p) => p.leadTimeDays)
          const maxLead = leadTimes.length > 0 ? Math.max(...leadTimes) : 1
          const isAfter17 = now.getHours() >= 17
          const daysToAdd = maxLead + (isAfter17 ? 1 : 0)

          const minDate = new Date(now)
          minDate.setDate(minDate.getDate() + daysToAdd)
          const yyyy = minDate.getFullYear()
          const mm = String(minDate.getMonth() + 1).padStart(2, '0')
          const dd = String(minDate.getDate()).padStart(2, '0')
          setDeliveryDate(`${yyyy}-${mm}-${dd}`)
        }
      } catch (err) {
        if (!isCancelled) {
          console.error(err)
          setIsQuoting(false)
          toast.error('Không thể tính toán chi phí giỏ hàng')
        }
      }
    }

    fetchQuote()

    return () => {
      isCancelled = true
    }
  }, [items, isMounted])

  const cartRequiresCold = quoteData
    ? Object.values(quoteData.productMetadata).some((p) => p.requiresCold)
    : false

  // Tự động chuyển sang xe COLD nếu giỏ hàng có hàng yêu cầu lạnh (Mục 4)
  const vehicleType: VehicleType = cartRequiresCold ? 'COLD' : requestedVehicleType

  // Tính phí vận chuyển live khi thay đổi địa chỉ, loại xe hoặc giỏ hàng (Phase 8A)
  useEffect(() => {
    if (!isMounted || !selectedAddressId || items.length === 0) return

    let isCancelled = false
    const timer = setTimeout(() => {
      setIsCalculatingShipping(true)
    }, 0)

    calculateShippingQuoteAction({
      addressId: selectedAddressId,
      lines: items,
      vehicleType,
    })
      .then((res) => {
        if (!isCancelled) {
          setIsCalculatingShipping(false)
          if (res.success && res.quote) {
            setShippingQuote(res.quote)
            setShippingError(res.quote.allowed ? null : res.quote.error || 'Địa chỉ không hỗ trợ giao hàng')
          } else {
            setShippingQuote(null)
            setShippingError(res.error || 'Không thể tính phí vận chuyển')
          }
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setIsCalculatingShipping(false)
          setShippingQuote(null)
          setShippingError('Lỗi kết nối khi tính phí vận chuyển')
        }
      })

    return () => {
      isCancelled = true
      clearTimeout(timer)
    }
  }, [isMounted, selectedAddressId, items, vehicleType])

  if (!isMounted || isQuoting) {
    return (
      <div className="py-24 text-center">
        <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-600">Đang chuẩn bị thông tin thanh toán...</p>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="max-w-md mx-auto py-20 text-center">
        <div className="w-20 h-20 bg-emerald-50 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-emerald-200/80 shadow-xs">
          <ShoppingCart className="w-10 h-10 text-emerald-600" />
        </div>
        <h2 className="font-heading text-2xl font-bold text-slate-900 tracking-tight">
          Giỏ hàng của bạn đang trống
        </h2>
        <p className="text-xs text-slate-500 mt-2 max-w-sm mx-auto leading-relaxed">
          Vui lòng thêm sản phẩm vào giỏ hàng trước khi tiến hành thanh toán.
        </p>
        <Link href="/san-pham" className="mt-6 inline-block">
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-full px-6 py-5 shadow-btn-glow font-bold">
            Duyệt sản phẩm vụ mùa
          </Button>
        </Link>
      </div>
    )
  }

  const quote = quoteData?.quote
  const subtotal = quote?.subtotal || 0
  const shippingFee = shippingQuote?.allowed ? shippingQuote.fee : 0
  const total = subtotal + shippingFee
  const depositAmount = computeDepositAmount(total)
  const requiredPayNow = paymentOption === PaymentOption.DEPOSIT_30 ? depositAmount : total
  const isCartValid = quote?.isValid ?? false
  const isShippingValid = (shippingQuote?.allowed ?? false) && !shippingError

  // Xử lý đặt hàng
  const handleSubmitOrder = () => {
    if (!selectedAddressId) {
      toast.error('Vui lòng chọn hoặc thêm địa chỉ nhận hàng')
      return
    }

    if (!deliveryDate) {
      toast.error('Vui lòng chọn ngày giao hàng mong muốn')
      return
    }

    if (!isCartValid) {
      toast.error('Giỏ hàng chưa đủ điều kiện đặt hàng (kiểm tra lại MOQ)')
      return
    }

    if (!isShippingValid) {
      toast.error(shippingError || 'Không thể đặt hàng do phí vận chuyển chưa hợp lệ')
      return
    }

    startTransition(async () => {
      const res = await placeOrder({
        lines: items,
        addressId: selectedAddressId,
        deliveryDate,
        timeSlot,
        paymentOption,
        vehicleType,
        customerNote: customerNote.trim() || undefined,
      })

      if (res.success && res.orderCode) {
        clearCart()
        toast.success(`Đặt hàng thành công! Mã đơn: ${res.orderCode}`)
        router.push(`/thanh-toan/${res.orderCode}`)
      } else {
        toast.error(res.error || 'Đặt hàng thất bại, vui lòng kiểm tra lại')
      }
    })
  }

  return (
    <div className="space-y-8">
      {/* STITCH 4-STEP PROGRESS STEPPER */}
      <div className="w-full bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-xs">
        <div className="grid grid-cols-4 relative max-w-4xl mx-auto">
          <div className="absolute top-1/2 left-[12.5%] right-[12.5%] -translate-y-1/2 h-1 bg-slate-100 pointer-events-none -z-0">
            <div className="h-full bg-emerald-600 transition-all duration-500 rounded-full" style={{ width: '33.33%' }} />
          </div>

          {/* Bước 1: Hoàn tất */}
          <Link href="/gio-hang" className="relative z-10 flex flex-col items-center text-center group cursor-pointer">
            <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-md group-hover:scale-105 transition-transform">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="mt-2 flex flex-col items-center">
              <span className="text-[10px] text-emerald-700 font-extrabold uppercase tracking-wider">Bước 1</span>
              <span className="text-xs sm:text-sm font-semibold text-slate-800 group-hover:text-emerald-700 transition-colors">Giỏ hàng</span>
            </div>
          </Link>

          {/* Bước 2: Active */}
          <div className="relative z-10 flex flex-col items-center text-center">
            <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-md ring-4 ring-emerald-100">
              <Truck className="w-5 h-5" />
            </div>
            <div className="mt-2 flex flex-col items-center">
              <span className="text-[10px] text-emerald-700 font-extrabold uppercase tracking-wider">Bước 2</span>
              <span className="text-xs sm:text-sm font-bold text-slate-900">Giao nhận</span>
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
            <CreditCard className="w-7 h-7 text-emerald-600" />
            Xác Nhận Đơn Hàng &amp; Giao Nhận
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Khách hàng: <strong className="text-slate-800">{userName}</strong>
            {getCheckoutDiscountNotice({
              userDiscount: quoteData?.userDiscountPercent || 0,
              regularLineCount: quoteData?.quote.lines.length || 0,
              sampleLineCount: quoteData?.quote.sampleLines.length || 0,
              actualSavings: calculateCartSavings(quoteData?.quote),
            })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/gio-hang">
            <Button variant="outline" size="sm" className="rounded-full text-xs text-slate-600 hover:text-slate-900 border-slate-200 gap-1.5 h-9">
              <ShoppingCart className="w-3.5 h-3.5" />
              Sửa giỏ hàng
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Cột trái: Form thông tin giao hàng & thanh toán (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          {/* BƯỚC 1: ĐỊA CHỈ GIAO HÀNG */}
          <div className="bg-white p-6 sm:p-7 rounded-3xl border border-slate-200/90 shadow-card space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-100/80 flex items-center justify-center text-emerald-700">
                  <MapPin className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-heading text-base font-bold text-slate-900 uppercase tracking-wide">
                    1. Địa Chỉ Nhận Hàng
                  </h2>
                  <p className="text-xs text-slate-500">Chọn kho bãi hoặc địa điểm tiếp nhận nông sản</p>
                </div>
              </div>
              <Link href="/tai-khoan/dia-chi">
                <Button variant="outline" size="sm" className="rounded-full border-emerald-200 bg-emerald-50/50 text-emerald-700 hover:bg-emerald-100/60 text-xs gap-1.5 h-8 font-semibold">
                  <Plus className="w-3.5 h-3.5" /> Sổ địa chỉ
                </Button>
              </Link>
            </div>

            {addresses.length === 0 ? (
              <div className="p-6 rounded-2xl border-2 border-dashed border-slate-200 text-center space-y-3 bg-slate-50/50">
                <MapPin className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs text-slate-500">Bạn chưa có địa chỉ nhận hàng nào được lưu.</p>
                <Link href="/tai-khoan/dia-chi">
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-full px-5">
                    Thêm địa chỉ ngay
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {addresses.map((addr) => {
                  const isSelected = selectedAddressId === addr.id

                  return (
                    <div
                      key={addr.id}
                      onClick={() => setSelectedAddressId(addr.id)}
                      className={`p-4 rounded-2xl border-2 text-xs cursor-pointer transition-all space-y-1.5 relative ${
                        isSelected
                          ? 'border-emerald-600 bg-emerald-50/50 shadow-xs ring-1 ring-emerald-500/30'
                          : 'border-slate-200/90 bg-white hover:border-slate-300 hover:shadow-xs'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-slate-900 font-bold text-sm flex items-center gap-1.5">
                          {addr.label}
                          {isSelected && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          )}
                        </span>
                        {addr.isDefault && (
                          <Badge variant="outline" className="text-[10px] bg-slate-100 text-slate-600 border-slate-200 rounded-full px-2 py-0.5">
                            Mặc định
                          </Badge>
                        )}
                      </div>
                      <div className="text-slate-700 font-medium">
                        {addr.recipient} • <strong className="text-slate-900">{addr.phone}</strong>
                      </div>
                      <div className="text-slate-500 line-clamp-2 leading-relaxed">
                        {addr.line}, {addr.ward}, {addr.district}, {addr.province}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* BƯỚC 2: NGÀY & KHUNG GIỜ GIAO HÀNG */}
          <div className="bg-white p-6 sm:p-7 rounded-3xl border border-slate-200/90 shadow-card space-y-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-emerald-100/80 flex items-center justify-center text-emerald-700">
                <CalendarIcon className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-heading text-base font-bold text-slate-900 uppercase tracking-wide">
                  2. Ngày &amp; Khung Giờ Giao Hàng
                </h2>
                <p className="text-xs text-slate-500">Đã tính theo chu kỳ thu hoạch và vận chuyển từ nhà vườn</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="delivery-date" className="text-xs font-semibold text-slate-700">
                  Ngày giao mong muốn (Đã tính thời gian cắt hái của vườn):
                </Label>
                <input
                  id="delivery-date"
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className="w-full h-11 px-4 text-xs rounded-2xl border border-slate-200/90 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 font-medium transition-all"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold text-slate-700">
                  Khung giờ giao hàng:
                </Label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { slot: TimeSlot.MORNING, label: 'Sáng', sub: '6h – 11h' },
                    { slot: TimeSlot.AFTERNOON, label: 'Chiều', sub: '13h – 17h' },
                    { slot: TimeSlot.EVENING, label: 'Tối', sub: '18h – 21h' },
                  ].map(({ slot, label, sub }) => (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setTimeSlot(slot)}
                      className={`p-2.5 rounded-2xl border text-center transition-all ${
                        timeSlot === slot
                          ? 'border-emerald-600 bg-emerald-50/60 text-emerald-950 font-bold shadow-xs ring-1 ring-emerald-500/20'
                          : 'border-slate-200/90 text-slate-600 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="text-xs font-bold">{label}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* BƯỚC 3: PHƯƠNG THỨC VẬN CHUYỂN & LOẠI XE (Phase 8A) */}
          <div className="bg-white p-6 sm:p-7 rounded-3xl border border-slate-200/90 shadow-card space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-100/80 flex items-center justify-center text-emerald-700">
                  <Truck className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-heading text-base font-bold text-slate-900 uppercase tracking-wide">
                    3. Phương Thức Vận Chuyển &amp; Loại Xe
                  </h2>
                  <p className="text-xs text-slate-500">Tối ưu chi phí theo tuyến đường và yêu cầu bảo quản</p>
                </div>
              </div>
              {shippingQuote?.allowed && (
                <Badge
                  variant="outline"
                  className={`text-[10px] rounded-full px-3 py-1 font-semibold ${
                    shippingQuote.isEstimated
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  }`}
                >
                  {shippingQuote.isEstimated ? 'Khoảng cách ước tính' : 'Google Routes API'}
                </Badge>
              )}
            </div>

            <div className="text-xs text-slate-600 bg-slate-50 p-4 rounded-2xl border border-slate-200/80 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <strong className="text-slate-900 font-bold">{DEFAULT_WAREHOUSE.name}</strong>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Bán kính phục vụ tối đa: {DEFAULT_WAREHOUSE.maxRadiusKm}km. Phí ship tính theo bậc khối lượng và km thực tế.
                </p>
              </div>
            </div>

            {/* Bộ chọn loại phương tiện */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-slate-700">
                Chọn phương tiện chuyên chở:
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Xe tiêu chuẩn (NORMAL) */}
                <div
                  onClick={() => {
                    if (!cartRequiresCold) {
                      setRequestedVehicleType('NORMAL')
                    }
                  }}
                  className={`p-4 rounded-2xl border-2 text-xs transition-all space-y-2 relative ${
                    cartRequiresCold
                      ? 'border-slate-200 bg-slate-100 opacity-60 cursor-not-allowed'
                      : vehicleType === 'NORMAL'
                      ? 'border-emerald-600 bg-emerald-50/50 shadow-xs ring-1 ring-emerald-500/30 cursor-pointer'
                      : 'border-slate-200/90 hover:border-slate-300 cursor-pointer bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <strong className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                      <Truck className="w-4 h-4 text-slate-700" /> Xe Tải Tiêu Chuẩn
                    </strong>
                    {vehicleType === 'NORMAL' && !cartRequiresCold && (
                      <Badge className="bg-emerald-600 text-white text-[10px] rounded-full px-2 py-0.5">Đang chọn</Badge>
                    )}
                  </div>
                  <p className="text-slate-500 text-[11px] leading-relaxed">
                    Thùng kín thoáng khí, bảo vệ hàng tránh mưa nắng. Cước cơ sở từ 150.000đ + 8.000đ/km.
                  </p>
                  {cartRequiresCold && (
                    <div className="text-[10px] text-rose-600 font-medium">
                      * Không khả dụng do giỏ có hàng cần bảo quản lạnh
                    </div>
                  )}
                </div>

                {/* Xe lạnh (COLD) */}
                <div
                  onClick={() => setRequestedVehicleType('COLD')}
                  className={`p-4 rounded-2xl border-2 text-xs cursor-pointer transition-all space-y-2 relative ${
                    vehicleType === 'COLD'
                      ? 'border-blue-500 bg-blue-50/50 shadow-xs ring-1 ring-blue-500/30'
                      : 'border-slate-200/90 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <strong className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                      <Snowflake className="w-4 h-4 text-blue-600" /> Xe Lạnh Chuyên Dụng
                    </strong>
                    {cartRequiresCold ? (
                      <Badge className="bg-blue-600 text-white text-[10px] rounded-full px-2 py-0.5">Bắt buộc theo SP</Badge>
                    ) : vehicleType === 'COLD' ? (
                      <Badge className="bg-blue-600 text-white text-[10px] rounded-full px-2 py-0.5">Nâng cấp</Badge>
                    ) : null}
                  </div>
                  <p className="text-slate-500 text-[11px] leading-relaxed">
                    Nhiệt độ kiểm soát 2°C – 8°C, giữ độ tươi giòn tối đa. Cước cơ sở từ 250.000đ + 12.000đ/km.
                  </p>
                  {cartRequiresCold && (
                    <div className="text-[10px] text-blue-700 font-medium">
                      * Tự động áp dụng cho sản phẩm yêu cầu lạnh trong đơn
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Chi tiết tính cước & khoảng cách */}
            {isCalculatingShipping ? (
              <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 text-emerald-600 animate-spin" />
                <span>Đang tính toán khoảng cách và cước vận chuyển...</span>
              </div>
            ) : shippingQuote && shippingQuote.allowed ? (
              <div className="p-4 sm:p-5 rounded-2xl border border-emerald-200 bg-emerald-50/40 text-xs space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-slate-600">
                  <div>
                    <span className="block text-[11px] text-slate-400">Khoảng cách:</span>
                    <strong className="text-slate-900 text-sm font-bold">
                      {shippingQuote.distanceKm} km
                    </strong>
                    <span className="text-[10px] text-slate-400 block">(Tính cước: {shippingQuote.billedKm}km)</span>
                  </div>
                  <div>
                    <span className="block text-[11px] text-slate-400">Loại xe:</span>
                    <strong className="text-slate-900 font-bold">
                      {shippingQuote.vehicleType === 'COLD' ? 'Xe Lạnh (2-8°C)' : 'Xe Tiêu Chuẩn'}
                    </strong>
                  </div>
                  <div>
                    <span className="block text-[11px] text-slate-400">Bậc tải trọng:</span>
                    <strong className="text-slate-900 font-bold">
                      {shippingQuote.minGrams >= 500000 ? '≥ 500 kg (Xe lớn)' : '< 500 kg'}
                    </strong>
                  </div>
                  <div>
                    <span className="block text-[11px] text-slate-400">Phí vận chuyển:</span>
                    <strong className="text-emerald-700 text-base font-extrabold">
                      {formatVND(shippingQuote.fee)}
                    </strong>
                  </div>
                </div>

                <div className="pt-2.5 border-t border-emerald-100 flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-slate-500 gap-1">
                  <span>Ghi chú lộ trình: {shippingQuote.note}</span>
                  <span className="text-slate-400">
                    Cước cơ sở: {formatVND(shippingQuote.baseFee)} + {formatVND(shippingQuote.perKm)}/km
                  </span>
                </div>
              </div>
            ) : shippingError ? (
              <div className="p-4 rounded-2xl border border-rose-200 bg-rose-50/80 text-xs text-rose-800 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-rose-900">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  Không thể giao hàng tới địa chỉ này:
                </div>
                <p className="text-[11px] text-rose-700 leading-relaxed">{shippingError}</p>
              </div>
            ) : null}
          </div>

          {/* BƯỚC 4: HÌNH THỨC THANH TOÁN */}
          <div className="bg-white p-6 sm:p-7 rounded-3xl border border-slate-200/90 shadow-card space-y-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-emerald-100/80 flex items-center justify-center text-emerald-700">
                <CreditCard className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-heading text-base font-bold text-slate-900 uppercase tracking-wide">
                  4. Phương Thức Thanh Toán VietQR
                </h2>
                <p className="text-xs text-slate-500">Chuyển khoản an toàn chuẩn B2B, tự động khớp lệnh</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Cọc 30% */}
              <div
                onClick={() => setPaymentOption(PaymentOption.DEPOSIT_30)}
                className={`p-4 sm:p-5 rounded-2xl border-2 cursor-pointer transition-all space-y-2 relative ${
                  paymentOption === PaymentOption.DEPOSIT_30
                    ? 'border-emerald-600 bg-emerald-50/50 shadow-xs ring-1 ring-emerald-500/30'
                    : 'border-slate-200/90 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <strong className="text-sm font-bold text-slate-900">
                    Đặt cọc 30% giữ hàng
                  </strong>
                  <Badge className="bg-emerald-600 text-white text-[10px] rounded-full px-2 py-0.5">Phổ biến nhất</Badge>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Chuyển trước 30% để vườn lên lịch cắt hái. 70% còn lại thanh toán khi nhận hàng theo khối lượng thực tế.
                </p>
                <div className="pt-2 text-xs flex items-baseline justify-between border-t border-slate-100">
                  <span className="text-slate-500">Cần chuyển ngay:</span>
                  <strong className="text-emerald-700 font-extrabold text-base">
                    {formatVND(depositAmount)}
                  </strong>
                </div>
              </div>

              {/* Trả 100% */}
              <div
                onClick={() => setPaymentOption(PaymentOption.FULL)}
                className={`p-4 sm:p-5 rounded-2xl border-2 cursor-pointer transition-all space-y-2 relative ${
                  paymentOption === PaymentOption.FULL
                    ? 'border-emerald-600 bg-emerald-50/50 shadow-xs ring-1 ring-emerald-500/30'
                    : 'border-slate-200/90 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <strong className="text-sm font-bold text-slate-900">
                    Chuyển khoản 100% (FULL)
                  </strong>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Thanh toán toàn bộ giá trị đơn hàng một lần. Chênh lệch khối lượng thực tế sẽ được tự động hoàn tiền sau khi giao.
                </p>
                <div className="pt-2 text-xs flex items-baseline justify-between border-t border-slate-100">
                  <span className="text-slate-500">Cần chuyển ngay:</span>
                  <strong className="text-slate-900 font-extrabold text-base">
                    {formatVND(total)}
                  </strong>
                </div>
              </div>
            </div>
          </div>

          {/* BƯỚC 5: GHI CHÚ ĐƠN HÀNG */}
          <div className="bg-white p-6 sm:p-7 rounded-3xl border border-slate-200/90 shadow-card space-y-3">
            <Label htmlFor="customer-note" className="text-xs font-semibold text-slate-700">
              Ghi chú cho nhà vườn &amp; đơn vị vận chuyển (Tùy chọn):
            </Label>
            <Textarea
              id="customer-note"
              rows={3}
              placeholder="Ví dụ: Giao trước 9h sáng, liên hệ bảo vệ kho để nhập hàng..."
              value={customerNote}
              onChange={(e) => setCustomerNote(e.target.value)}
              className="text-xs rounded-2xl border-slate-200/90 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all p-3.5"
            />
          </div>
        </div>

        {/* Cột phải: Tóm tắt đơn hàng & nút chốt đơn (4 cols) */}
        <div className="lg:col-span-4 sticky top-24 space-y-4">
          <Card className="border border-slate-200/90 shadow-card rounded-3xl overflow-hidden bg-white">
            <div className="bg-slate-900 text-white p-5">
              <h3 className="font-heading font-bold text-sm tracking-wide uppercase flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-emerald-400" />
                Tóm Tắt Thanh Toán
              </h3>
            </div>

            <CardContent className="p-6 space-y-5">
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Tạm tính tiền hàng:</span>
                  <span className="font-bold text-slate-900 text-sm">{formatVND(subtotal)}</span>
                </div>

                <div className="flex justify-between text-slate-600">
                  <span>Phí vận chuyển ({vehicleType === 'COLD' ? 'Xe lạnh' : 'Xe tiêu chuẩn'}):</span>
                  {isCalculatingShipping ? (
                    <span className="font-medium text-slate-400 flex items-center gap-1">
                      <RefreshCw className="w-3 h-3 animate-spin text-emerald-600" /> Đang tính...
                    </span>
                  ) : isShippingValid ? (
                    <div className="text-right">
                      <span className="font-bold text-emerald-700 text-sm">
                        {formatVND(shippingFee)}
                      </span>
                      <span className="block text-[10px] text-slate-400">
                        {shippingQuote?.distanceKm} km {shippingQuote?.isEstimated ? '(Ước tính)' : ''}
                      </span>
                    </div>
                  ) : (
                    <span className="font-semibold text-rose-600 text-xs">
                      Chưa tính được phí
                    </span>
                  )}
                </div>

                <div className="flex justify-between text-slate-600 pt-3 border-t border-slate-100">
                  <span className="font-semibold text-slate-900">Tổng giá trị đơn hàng:</span>
                  <span className="font-extrabold text-slate-900 text-base">{formatVND(total)}</span>
                </div>
              </div>

              {/* Số tiền cần thanh toán ngay */}
              <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200 text-emerald-950 space-y-1">
                <span className="text-xs block font-semibold text-emerald-800">Số tiền cần chuyển ngay (VietQR):</span>
                <span className="text-2xl font-black text-emerald-800 block">
                  {formatVND(requiredPayNow)}
                </span>
                <span className="text-[11px] text-emerald-700 block leading-tight">
                  {paymentOption === PaymentOption.DEPOSIT_30
                    ? 'Đặt cọc 30% (70% còn lại thanh toán khi nhận hàng)'
                    : 'Thanh toán 100%'}
                </span>
              </div>

              {/* Lỗi MOQ nếu có */}
              {!isCartValid && (
                <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Giỏ hàng có sản phẩm chưa đạt MOQ, vui lòng kiểm tra lại.</span>
                </div>
              )}

              {/* Lỗi Vận chuyển nếu có */}
              {!isShippingValid && !isCalculatingShipping && shippingError && (
                <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{shippingError}</span>
                </div>
              )}

              {/* Nút đặt hàng */}
              <Button
                onClick={handleSubmitOrder}
                disabled={
                  isSubmitting ||
                  !isCartValid ||
                  !selectedAddressId ||
                  !isShippingValid ||
                  isCalculatingShipping
                }
                className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm gap-2 rounded-full shadow-btn-glow hover:-translate-y-0.5 transition-all disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Đang tạo đơn hàng...
                  </>
                ) : isCalculatingShipping ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Đang tính phí ship...
                  </>
                ) : !isShippingValid ? (
                  <>Không thể giao tới địa chỉ này</>
                ) : (
                  <>
                    Xác nhận đặt hàng <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>

              <div className="pt-2 text-center">
                <Link href="/gio-hang" className="text-xs text-slate-500 hover:text-emerald-700 font-medium transition-colors">
                  ← Quay lại chỉnh sửa giỏ hàng
                </Link>
              </div>

              {/* Cam kết */}
              <div className="pt-4 border-t border-slate-100 text-[11px] text-slate-500 space-y-1.5">
                <div className="flex items-center gap-1.5 text-slate-800 font-semibold">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Bảo đảm B2B E Vibe
                </div>
                <p>• Mã VietQR và thời gian giữ chỗ {RESERVATION_TIMEOUT_MINUTES} phút hiển thị ngay sau khi đặt.</p>
                <p>• Hỗ trợ hoàn cọc 100% nếu sự cố xuất phát từ nhà vườn.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
