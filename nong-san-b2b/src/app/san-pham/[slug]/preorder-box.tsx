'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Sparkles,
  Calendar,
  ShieldCheck,
  Package,
  MapPin,
  Clock,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatVND } from '@/lib/money'
import { placePreorder } from '@/actions/preorder'
import { getUserAddresses } from '@/server/actions/user'
import { calculatePreorderPricing } from '@/lib/domain/preorder'
import { toast } from 'sonner'

export interface PreorderPackagingItem {
  id: string
  name: string
  weightGrams: number
  isSample: boolean
  isActive: boolean
}

export interface PreorderBoxProps {
  product: {
    id: string
    slug: string
    name: string
    moqGrams: number
    preorderOpen: boolean
    preorderPricePerKg: number | null
    preorderBandPercent?: number | null
    expectedHarvestFrom: Date | string | null
    expectedHarvestTo: Date | string | null
    packagings: PreorderPackagingItem[]
  }
  user: {
    name?: string | null
    discountPercent: number
    role: string
  } | null
}

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
}

export function PreorderBox({ product, user }: PreorderBoxProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const regularPackagings = product.packagings.filter((p) => !p.isSample && p.isActive)
  const defaultPackaging = regularPackagings[0]

  const [selectedPackagingId, setSelectedPackagingId] = useState<string>(
    defaultPackaging?.id || ''
  )
  const [quantity, setQuantity] = useState<number>(1)
  const [addressId, setAddressId] = useState<string>('')
  const [customerNote, setCustomerNote] = useState<string>('')

  // Addresses state
  const [addresses, setAddresses] = useState<AddressItem[]>([])
  const [loadingAddresses, setLoadingAddresses] = useState<boolean>(Boolean(user))

  useEffect(() => {
    let ignore = false
    if (user) {
      getUserAddresses()
        .then((data) => {
          if (!ignore) {
            setAddresses(data)
            const def = data.find((a) => a.isDefault) || data[0]
            if (def) {
              setAddressId(def.id)
            }
            setLoadingAddresses(false)
          }
        })
        .catch((err) => {
          console.error('Error fetching addresses:', err)
          if (!ignore) {
            setLoadingAddresses(false)
          }
        })
    }
    return () => {
      ignore = true
    }
  }, [user])

  const selectedPackaging = regularPackagings.find((p) => p.id === selectedPackagingId)
  const packagingWeightGrams = selectedPackaging?.weightGrams || 10000
  const userDiscount = user?.discountPercent || 0
  const preorderPrice = product.preorderPricePerKg || 0
  const bandPercent = product.preorderBandPercent ?? 10

  // Calculate pricing realtime
  const pricing =
    preorderPrice > 0 && packagingWeightGrams > 0 && quantity > 0
      ? calculatePreorderPricing({
          preorderPricePerKg: preorderPrice,
          groupDiscountPercent: userDiscount,
          packagingWeightGrams,
          quantity,
        })
      : null

  const totalKg = (packagingWeightGrams * quantity) / 1000
  const moqKg = product.moqGrams / 1000
  const isMoqMet = pricing ? pricing.totalGrams >= product.moqGrams : false

  const handlePlacePreorder = () => {
    if (!user) {
      router.push(`/dang-nhap?callbackUrl=/san-pham/${product.slug}`)
      return
    }

    if (!selectedPackagingId) {
      toast.error('Vui lòng chọn quy cách đóng gói')
      return
    }

    if (!isMoqMet) {
      toast.error(`Khối lượng đặt (${totalKg}kg) chưa đạt mức tối thiểu MOQ (${moqKg}kg)`)
      return
    }

    if (!addressId) {
      toast.error('Vui lòng chọn địa chỉ nhận hàng')
      return
    }

    startTransition(async () => {
      const res = await placePreorder({
        productId: product.id,
        packagingId: selectedPackagingId,
        quantity,
        addressId,
        customerNote: customerNote.trim() || undefined,
      })

      if (res.success && res.orderCode) {
        toast.success(`Đặt trước thành công! Mã đơn: ${res.orderCode}`)
        router.push(`/thanh-toan/${res.orderCode}`)
      } else {
        toast.error(res.error || 'Đặt trước thất bại, vui lòng thử lại')
      }
    })
  }

  const formatHarvestDate = (dateVal: Date | string | null) => {
    if (!dateVal) return null
    return new Date(dateVal).toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }

  const harvestFromStr = formatHarvestDate(product.expectedHarvestFrom)
  const harvestToStr = formatHarvestDate(product.expectedHarvestTo)

  return (
    <Card className="border-2 border-purple-200 bg-linear-to-br from-purple-50/60 via-white to-purple-50/30 shadow-md rounded-2xl overflow-hidden">
      <div className="bg-purple-700 text-white px-5 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2.5 font-bold text-sm sm:text-base">
          <Sparkles className="w-5 h-5 text-amber-300 animate-pulse" />
          <span>Đặt Trước Vụ Mùa (Pre-order)</span>
        </div>
        <Badge className="bg-purple-900/80 text-purple-100 hover:bg-purple-900 border-purple-400 text-xs">
          Biên độ giá: ±{bandPercent}%
        </Badge>
      </div>

      <CardContent className="p-5 sm:p-6 space-y-5">
        {/* Info Banner */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-purple-50/80 rounded-xl border border-purple-100 text-xs text-purple-950">
          <div>
            <span className="text-purple-700 font-medium block flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-purple-600" /> Thời gian dự kiến thu hoạch:
            </span>
            <strong className="text-sm font-bold text-purple-900">
              {harvestFromStr ? (
                <>
                  {harvestFromStr} {harvestToStr ? `– ${harvestToStr}` : ''}
                </>
              ) : (
                'Theo thông báo mùa vụ từ nhà vườn'
              )}
            </strong>
          </div>
          <div>
            <span className="text-purple-700 font-medium block flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-purple-600" /> Cam kết giá chốt vụ:
            </span>
            <strong className="text-sm font-bold text-purple-900">
              Giữ trần ±{bandPercent}%{' '}
              <span className="text-xs font-normal text-purple-700">
                (Được hủy nhận 100% cọc nếu giá tăng vượt quá {bandPercent}%)
              </span>
            </strong>
          </div>
        </div>

        {/* Pricing Highlights */}
        <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2 border-b border-purple-100">
          <div>
            <span className="text-xs text-slate-500 font-medium block">Đơn giá cọc giữ chỗ:</span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-purple-900">
                {formatVND(pricing?.discountedPricePerKg || preorderPrice)}
                <span className="text-xs font-normal text-slate-500">/kg</span>
              </span>
              {userDiscount > 0 && (
                <>
                  <span className="text-xs line-through text-slate-400">
                    {formatVND(preorderPrice)}/kg
                  </span>
                  <Badge variant="outline" className="text-[11px] bg-purple-100 text-purple-800 border-purple-300">
                    Đối tác -{userDiscount}%
                  </Badge>
                </>
              )}
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-500 block">Số lượng tối thiểu (MOQ):</span>
            <span className="text-sm font-bold text-slate-800">{moqKg} kg</span>
          </div>
        </div>

        {/* Form Selection */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Packaging */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-800 flex items-center gap-1">
              <Package className="w-3.5 h-3.5 text-purple-600" /> Quy cách đóng gói sỉ
            </Label>
            <Select
              value={selectedPackagingId}
              onValueChange={(val) => {
                if (val) setSelectedPackagingId(val)
              }}
            >
              <SelectTrigger className="w-full text-xs sm:text-sm bg-white">
                <SelectValue placeholder="Chọn quy cách..." />
              </SelectTrigger>
              <SelectContent>
                {regularPackagings.map((pkg) => (
                  <SelectItem key={pkg.id} value={pkg.id} className="text-xs sm:text-sm">
                    {pkg.name} ({pkg.weightGrams / 1000} kg/thùng)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quantity */}
          <div className="space-y-1.5">
            <Label className="text-xs font-bold text-slate-800">
              Số lượng kiện (Thùng/Sọt)
            </Label>
            <div className="flex items-center gap-2">
              <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden bg-white">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="px-3 py-1.5 text-sm font-bold hover:bg-slate-100 active:bg-slate-200 transition-colors"
                >
                  −
                </button>
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-16 text-center text-sm font-semibold border-none focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={() => setQuantity((q) => q + 1)}
                  className="px-3 py-1.5 text-sm font-bold hover:bg-slate-100 active:bg-slate-200 transition-colors"
                >
                  +
                </button>
              </div>
              <span className="text-xs font-semibold text-slate-700">
                = {totalKg} kg
              </span>
            </div>
          </div>
        </div>

        {/* MOQ Status Banner */}
        {!isMoqMet ? (
          <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 flex items-center gap-2 text-xs text-amber-800 font-medium">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              Chưa đủ MOQ: Bạn cần đặt tối thiểu <strong>{moqKg} kg</strong> (còn thiếu{' '}
              <strong>{(product.moqGrams - (pricing?.totalGrams || 0)) / 1000} kg</strong>). Vui lòng tăng số lượng.
            </span>
          </div>
        ) : (
          <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center gap-2 text-xs text-emerald-800 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>Đã đạt ngưỡng tối thiểu {moqKg}kg của nhà vườn!</span>
          </div>
        )}

        {/* Delivery Address Selector */}
        {user && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold text-slate-800 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-purple-600" /> Địa chỉ nhận hàng dự kiến
              </Label>
              <Link
                href="/tai-khoan/dia-chi"
                className="text-[11px] text-purple-700 hover:underline font-medium"
              >
                + Thêm / Quản lý địa chỉ
              </Link>
            </div>

            {loadingAddresses ? (
              <div className="text-xs text-slate-400 py-1">Đang tải địa chỉ...</div>
            ) : addresses.length === 0 ? (
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
                <span>Bạn chưa có địa chỉ nhận hàng nào.</span>
                <Link href="/tai-khoan/dia-chi">
                  <Button size="sm" variant="outline" className="text-xs h-7">
                    Thêm địa chỉ ngay
                  </Button>
                </Link>
              </div>
            ) : (
              <Select
                value={addressId}
                onValueChange={(val) => {
                  if (val) setAddressId(val)
                }}
              >
                <SelectTrigger className="w-full text-xs sm:text-sm bg-white">
                  <SelectValue placeholder="Chọn địa chỉ nhận hàng..." />
                </SelectTrigger>
                <SelectContent>
                  {addresses.map((addr) => (
                    <SelectItem key={addr.id} value={addr.id} className="text-xs sm:text-sm">
                      <span className="font-semibold">{addr.recipient} ({addr.phone})</span>: {addr.line}, {addr.ward}, {addr.district}, {addr.province}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {/* Customer Note */}
        {user && (
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-700">
              Ghi chú cho nhà vườn (tùy chọn)
            </Label>
            <Textarea
              placeholder="Yêu cầu về độ chín, thời gian thu hoạch hoặc quy chuẩn bảo quản..."
              rows={2}
              value={customerNote}
              onChange={(e) => setCustomerNote(e.target.value)}
              className="text-xs bg-white"
            />
          </div>
        )}

        {/* Price & Deposit Summary */}
        {pricing && (
          <div className="p-4 rounded-xl bg-purple-50/70 border border-purple-200 space-y-2 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>Tổng giá trị đơn hàng dự kiến:</span>
              <span className="font-semibold text-slate-900">{formatVND(pricing.total)}</span>
            </div>
            <div className="flex justify-between items-baseline text-purple-900 pt-1 border-t border-purple-200">
              <div>
                <span className="font-bold text-sm block">Tiền cọc bắt buộc 30%:</span>
                <span className="text-[11px] text-purple-700 italic">
                  (Thanh toán qua chuyển khoản VietQR trong vòng 24h)
                </span>
              </div>
              <span className="text-lg font-black text-purple-800">
                {formatVND(pricing.depositAmount)}
              </span>
            </div>
          </div>
        )}

        {/* Action Button */}
        <div>
          {user ? (
            <Button
              onClick={handlePlacePreorder}
              disabled={isPending || !isMoqMet || !addressId}
              className="w-full h-11 text-sm font-bold bg-purple-700 hover:bg-purple-800 text-white shadow-md flex items-center justify-center gap-2"
            >
              {isPending ? (
                <span>Đang xử lý đặt trước...</span>
              ) : (
                <>
                  <span>Xác nhận đặt trước & Thanh toán cọc 30%</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          ) : (
            <Link href={`/dang-nhap?callbackUrl=/san-pham/${product.slug}`}>
              <Button
                variant="default"
                className="w-full h-11 text-sm font-bold bg-purple-700 hover:bg-purple-800 text-white shadow-md flex items-center justify-center gap-2"
              >
                <span>Đăng nhập đối tác để đặt trước vụ mùa</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          )}

          <p className="text-[11px] text-slate-500 text-center mt-2 flex items-center justify-center gap-1">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            Hạn thanh toán cọc: 24h kể từ khi đặt. Ngày giao cụ thể sẽ được ấn định khi vào vụ thu hoạch.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
