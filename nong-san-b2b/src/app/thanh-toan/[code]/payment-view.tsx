'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  CheckCircle2,
  Clock,
  QrCode,
  Copy,
  ArrowRight,
  Package,
  AlertCircle,
  CreditCard,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatVND } from '@/lib/money'
import { toast } from 'sonner'
import { resolvePaymentPresentationState } from '@/lib/domain/payment-presentation'

interface PaymentViewProps {
  order: {
    id: string
    code: string
    status: string
    paymentOption: string
    subtotal: number
    shippingFee: number
    total: number
    depositAmount: number
    paymentDueAt: Date | null
    createdAt: Date
    items: {
      id: string
      productName: string
      packagingName: string
      quantity: number
      orderedGrams: number
      unitPricePerKg: number
      lineTotal: number
      isSample: boolean
    }[]
  }
  vietQrUrl: string
  bankInfo: {
    bankBin: string
    accountNo: string
    accountName: string
  }
  payable?: {
    isPayable: boolean
    amountToPay: number
    grossPaid: number
    reason?: string
  }
}

export function PaymentView({ order, vietQrUrl, bankInfo, payable }: PaymentViewProps) {
  const [timeLeft, setTimeLeft] = useState('')
  const [qrSrc, setQrSrc] = useState(vietQrUrl)
  const [isFallback, setIsFallback] = useState(false)
  const [qrError, setQrError] = useState(false)

  // Số tiền cần chuyển: dựa trên payable thực tế (đã trừ PAYMENT DONE)
  const isPayable = payable ? payable.isPayable : true
  const grossPaid = payable ? payable.grossPaid : 0
  const amountToPay = payable
    ? payable.amountToPay
    : order.paymentOption === 'DEPOSIT_30'
      ? order.depositAmount
      : order.total

  // Suy diễn trạng thái hiển thị giao diện thanh toán an toàn (EV-IMP-01C / QW11-01)
  const presentation = resolvePaymentPresentationState({
    orderStatus: order.status,
    paymentOption: order.paymentOption,
    total: order.total,
    depositAmount: order.depositAmount,
    paymentDueAt: order.paymentDueAt,
    isPayable,
    amountToPay,
    grossPaid,
  })

  // Đếm ngược 10 phút giữ chỗ thanh toán (chỉ kích hoạt khi presentation.showCountdown)
  useEffect(() => {
    if (!presentation.showCountdown || !order.paymentDueAt) return

    const targetTime = new Date(order.paymentDueAt).getTime()

    const updateTimer = () => {
      const now = Date.now()
      const diff = targetTime - now

      if (diff <= 0) {
        setTimeLeft('Đã hết hạn thanh toán')
        return
      }

      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      const seconds = Math.floor((diff % (1000 * 60)) / 1000)

      setTimeLeft(
        `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      )
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)
    return () => clearInterval(interval)
  }, [presentation.showCountdown, order.paymentDueAt])

  // Trạng thái hết hạn runtime trên client (nếu đang đếm ngược mà đồng hồ chạm 0)
  const isClientTimerExpired = presentation.showCountdown && timeLeft === 'Đã hết hạn thanh toán'
  const effectiveCanAcceptPayment = presentation.canAcceptPayment && !isClientTimerExpired
  const effectiveIsExpired = presentation.isExpired || isClientTimerExpired

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast.success(`Đã sao chép ${label}`)
  }

  // Kiểu màu huy hiệu
  const badgeClassName =
    isClientTimerExpired || presentation.badgeTone === 'rose'
      ? 'bg-rose-600 text-white text-[10px] rounded-full px-2.5 py-0.5'
      : presentation.badgeTone === 'amber'
        ? 'bg-amber-600 text-white text-[10px] rounded-full px-2.5 py-0.5'
        : presentation.badgeTone === 'slate'
          ? 'bg-slate-600 text-white text-[10px] rounded-full px-2.5 py-0.5'
          : 'bg-emerald-600 text-white text-[10px] rounded-full px-2.5 py-0.5'

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* STITCH 4-STEP PROGRESS STEPPER */}
      <div className="w-full bg-white rounded-3xl p-5 sm:p-6 border border-slate-200/90 shadow-xs">
        <div className="grid grid-cols-4 relative max-w-4xl mx-auto">
          <div className="absolute top-1/2 left-[12.5%] right-[12.5%] -translate-y-1/2 h-1 bg-slate-100 pointer-events-none -z-0">
            <div
              className={`h-full transition-all duration-500 rounded-full ${
                presentation.isCancelled ? 'bg-rose-500' : 'bg-emerald-600'
              }`}
              style={{
                width: presentation.isCancelled
                  ? '75%'
                  : effectiveCanAcceptPayment
                    ? '66.66%'
                    : '100%',
              }}
            />
          </div>

          {/* Bước 1: Giỏ hàng */}
          <div className="relative z-10 flex flex-col items-center text-center">
            <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-md">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="mt-2 flex flex-col items-center">
              <span className="text-[10px] text-emerald-700 font-extrabold uppercase tracking-wider">Bước 1</span>
              <span className="text-xs sm:text-sm font-semibold text-slate-800">Giỏ hàng</span>
            </div>
          </div>

          {/* Bước 2: Giao nhận */}
          <div className="relative z-10 flex flex-col items-center text-center">
            <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-md">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="mt-2 flex flex-col items-center">
              <span className="text-[10px] text-emerald-700 font-extrabold uppercase tracking-wider">Bước 2</span>
              <span className="text-xs sm:text-sm font-semibold text-slate-800">Giao nhận</span>
            </div>
          </div>

          {/* Bước 3: Thanh toán */}
          <div className="relative z-10 flex flex-col items-center text-center">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shadow-md ${
                presentation.isCancelled
                  ? 'bg-rose-600 text-white ring-4 ring-rose-100'
                  : effectiveCanAcceptPayment
                    ? 'bg-emerald-600 text-white ring-4 ring-emerald-100'
                    : 'bg-emerald-600 text-white'
              }`}
            >
              {presentation.isCancelled ? (
                <AlertCircle className="w-5 h-5" />
              ) : effectiveCanAcceptPayment ? (
                <CreditCard className="w-5 h-5" />
              ) : (
                <CheckCircle2 className="w-5 h-5" />
              )}
            </div>
            <div className="mt-2 flex flex-col items-center">
              <span
                className={`text-[10px] font-extrabold uppercase tracking-wider ${
                  presentation.isCancelled ? 'text-rose-700' : 'text-emerald-700'
                }`}
              >
                Bước 3
              </span>
              <span className="text-xs sm:text-sm font-bold text-slate-900">
                {presentation.isCancelled ? 'Thanh toán (Hủy)' : 'Thanh toán'}
              </span>
            </div>
          </div>

          {/* Bước 4: Hoàn tất */}
          <div
            className={`relative z-10 flex flex-col items-center text-center ${
              effectiveCanAcceptPayment ? 'opacity-60' : ''
            }`}
          >
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shadow-md ${
                presentation.isCancelled
                  ? 'bg-rose-600 text-white ring-4 ring-rose-100'
                  : effectiveCanAcceptPayment
                    ? 'bg-slate-100 text-slate-500'
                    : 'bg-emerald-600 text-white ring-4 ring-emerald-100'
              }`}
            >
              {presentation.isCancelled ? (
                <AlertCircle className="w-5 h-5" />
              ) : (
                <CheckCircle2 className="w-5 h-5" />
              )}
            </div>
            <div className="mt-2 flex flex-col items-center">
              <span
                className={`text-[10px] uppercase tracking-wider ${
                  presentation.isCancelled
                    ? 'text-rose-700 font-extrabold'
                    : effectiveCanAcceptPayment
                      ? 'text-slate-400 font-semibold'
                      : 'text-emerald-700 font-extrabold'
                }`}
              >
                Bước 4
              </span>
              <span
                className={`text-xs sm:text-sm ${
                  presentation.isCancelled
                    ? 'font-bold text-rose-900'
                    : effectiveCanAcceptPayment
                      ? 'font-medium text-slate-600'
                      : 'font-bold text-slate-900'
                }`}
              >
                {presentation.isCancelled ? 'Đã hủy' : 'Hoàn tất'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Banner đầu trang phản ánh đúng trạng thái */}
      <div
        className={`text-white rounded-3xl p-6 sm:p-8 text-center shadow-card relative overflow-hidden ${
          presentation.bannerTone === 'rose'
            ? 'bg-gradient-to-br from-rose-700 via-rose-800 to-slate-900'
            : isClientTimerExpired || presentation.bannerTone === 'amber'
              ? 'bg-gradient-to-br from-amber-700 via-rose-800 to-slate-900'
              : 'bg-gradient-to-br from-emerald-600 via-emerald-600 to-teal-700'
        }`}
      >
        <div className="absolute -right-10 -bottom-10 w-44 h-44 bg-white/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -left-10 -top-10 w-44 h-44 bg-emerald-400/20 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10">
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-md shadow-inner border border-white/30">
            {presentation.isCancelled || effectiveIsExpired ? (
              <AlertCircle className="w-10 h-10 text-white" />
            ) : (
              <CheckCircle2 className="w-10 h-10 text-white" />
            )}
          </div>
          <h1 className="font-heading text-2xl sm:text-3xl font-extrabold tracking-tight">
            {isClientTimerExpired
              ? 'Đơn Hàng Đã Quá Hạn Thanh Toán'
              : presentation.bannerTitle}
          </h1>
          <p className="text-emerald-100 text-xs sm:text-sm mt-2 max-w-md mx-auto">
            Mã đơn hàng:{' '}
            <strong className="text-white text-base tracking-wider bg-white/20 px-3.5 py-1 rounded-full border border-white/30 inline-block font-mono ml-1.5">
              {order.code}
            </strong>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
        {/* Cột trái: Mã VietQR hoặc Khối thông báo trạng thái kết thúc (6 cols) */}
        <div className="md:col-span-6 space-y-5">
          <Card className="border border-slate-200/90 rounded-3xl overflow-hidden shadow-card bg-white">
            <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
              <span className="font-heading font-bold text-xs uppercase tracking-wider flex items-center gap-2">
                <QrCode className="w-4 h-4 text-emerald-400" />
                {effectiveCanAcceptPayment ? 'Quét Mã VietQR Chuyển Khoản' : presentation.cardTitle}
              </span>
              <Badge className={badgeClassName}>
                {isClientTimerExpired ? 'Hết hạn giữ chỗ' : presentation.badgeLabel}
              </Badge>
            </div>

            {!effectiveCanAcceptPayment ? (
              <CardContent className="p-6 sm:p-7 text-center space-y-5">
                <div
                  className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto border shadow-xs ${
                    presentation.isCancelled
                      ? grossPaid > 0
                        ? 'bg-amber-50 border-amber-200'
                        : 'bg-rose-50 border-rose-200'
                      : effectiveIsExpired
                        ? 'bg-rose-50 border-rose-200'
                        : 'bg-emerald-50 border-emerald-200'
                  }`}
                >
                  {presentation.isCancelled ? (
                    <AlertCircle
                      className={`w-10 h-10 ${
                        grossPaid > 0 ? 'text-amber-600' : 'text-rose-600'
                      }`}
                    />
                  ) : effectiveIsExpired ? (
                    <AlertCircle className="w-10 h-10 text-rose-600" />
                  ) : (
                    <CheckCircle2 className="w-10 h-10 text-emerald-600" />
                  )}
                </div>

                <div className="space-y-2">
                  <h3 className="font-heading text-base font-bold text-slate-900">
                    {isClientTimerExpired
                      ? 'Thời gian giữ chỗ thanh toán 10 phút đã hết hạn'
                      : presentation.statusTitle}
                  </h3>

                  <p className="text-xs text-slate-600 leading-relaxed max-w-md mx-auto">
                    {isClientTimerExpired
                      ? 'Đơn hàng đã vượt quá hạn chót 10 phút quy định. Hệ thống đang tự động giải phóng khối lượng giữ chỗ tại các lô FEFO. Mã thanh toán VietQR cho đơn hàng này đã bị vô hiệu hóa.'
                      : presentation.statusDescription}
                  </p>

                  {/* Cảnh báo an toàn hoặc thông tin số tiền thực nhận */}
                  {presentation.warningNotice && (
                    <div
                      className={`rounded-xl p-3 text-xs leading-relaxed ${
                        presentation.isCancelled && grossPaid > 0
                          ? 'bg-amber-50 border border-amber-200 text-amber-900 font-semibold'
                          : presentation.isCancelled
                            ? 'bg-slate-50 border border-slate-200 text-slate-700'
                            : 'bg-rose-50 border border-rose-200 text-rose-800'
                      }`}
                    >
                      {presentation.warningNotice}
                    </div>
                  )}

                  {!presentation.isCancelled && !effectiveIsExpired && grossPaid > 0 && (
                    <p className="text-xs text-slate-600">
                      Tổng số tiền đã nhận:{' '}
                      <strong className="text-emerald-700">{formatVND(grossPaid)}</strong>
                    </p>
                  )}
                </div>

                <div className="pt-2 space-y-2">
                  <Link href={`/tai-khoan/don-hang/${order.code}`}>
                    <Button className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs h-11 rounded-full">
                      Xem chi tiết đơn hàng
                    </Button>
                  </Link>
                  <Link href="/san-pham" className="block text-center">
                    <Button
                      variant="outline"
                      className="w-full text-xs text-slate-600 border-slate-200 rounded-full h-10 hover:text-slate-900"
                    >
                      {presentation.isCancelled || effectiveIsExpired
                        ? 'Tiếp tục mua hàng nông sản'
                        : 'Mua thêm sản phẩm khác'}
                    </Button>
                  </Link>
                </div>
              </CardContent>
            ) : (
              <CardContent className="p-6 sm:p-7 text-center space-y-5">
                {/* Ảnh VietQR động kèm cơ chế fallback EMVCo an toàn (SRC-QR-08) */}
                <div className="w-64 h-64 sm:w-72 sm:h-72 mx-auto bg-white p-4 rounded-3xl border-2 border-dashed border-emerald-300 shadow-xs flex items-center justify-center">
                  {qrError ? (
                    <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                      <AlertCircle className="w-8 h-8 text-amber-500 mb-2 shrink-0" />
                      <span className="text-xs font-semibold text-slate-800">
                        Không thể tải mã QR chuyển khoản
                      </span>
                      <span className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                        Vui lòng sử dụng thông tin số tài khoản bên dưới để chuyển khoản thủ công.
                      </span>
                    </div>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={qrSrc}
                      alt={`VietQR-${order.code}`}
                      onError={() => {
                        if (!isFallback) {
                          setIsFallback(true)
                          setQrSrc(`/api/qr/payment/${order.code}`)
                        } else {
                          setQrError(true)
                        }
                      }}
                      className="w-full h-full object-contain"
                    />
                  )}
                </div>

                {isFallback && !qrError && (
                  <div className="text-[11px] text-amber-800 bg-amber-50 px-3.5 py-1 rounded-full border border-amber-200 inline-block font-medium">
                    Đang hiển thị mã QR dự phòng nội bộ (Chuẩn EMVCo / VietQR)
                  </div>
                )}

                {/* Đồng hồ đếm ngược 10 phút giữ chỗ thanh toán */}
                {presentation.showCountdown && (
                  <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-3.5 flex items-center justify-center gap-2 text-xs text-amber-900 font-semibold shadow-xs">
                    <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Hạn chót thanh toán: </span>
                    <span className="font-mono text-sm text-amber-950 font-extrabold">
                      {timeLeft || '00:10:00'}
                    </span>
                  </div>
                )}

                {/* Thông tin số tài khoản chi tiết */}
                <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/90 text-left text-xs space-y-3">
                  {grossPaid > 0 && (
                    <div className="flex justify-between items-center text-[11px] text-emerald-800 bg-emerald-50 px-3.5 py-2 rounded-xl border border-emerald-200 font-medium">
                      <span>Đã thanh toán trước đó:</span>
                      <strong className="text-emerald-900">{formatVND(grossPaid)}</strong>
                    </div>
                  )}

                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Ngân hàng thụ hưởng:</span>
                    <strong className="text-slate-900 font-semibold">MBBank (Ngân hàng Quân Đội)</strong>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Số tài khoản:</span>
                    <div className="flex items-center gap-1.5">
                      <strong className="font-mono text-sm text-slate-900 font-bold">
                        {bankInfo.accountNo}
                      </strong>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(bankInfo.accountNo, 'Số tài khoản')}
                        className="text-slate-400 hover:text-emerald-700 p-1 transition-colors"
                        title="Sao chép số tài khoản"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Chủ tài khoản:</span>
                    <strong className="text-slate-900 font-semibold">{bankInfo.accountName}</strong>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Số tiền cần chuyển:</span>
                    <div className="flex items-center gap-1.5">
                      <strong className="text-base text-emerald-700 font-extrabold">
                        {formatVND(amountToPay)}
                      </strong>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(String(amountToPay), 'Số tiền')}
                        className="text-slate-400 hover:text-emerald-700 p-1 transition-colors"
                        title="Sao chép số tiền"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                    <span className="text-slate-500">Nội dung chuyển khoản:</span>
                    <div className="flex items-center gap-1.5">
                      <strong className="font-mono text-sm text-emerald-800 bg-emerald-100/70 px-2.5 py-0.5 rounded-lg font-bold">
                        {order.code}
                      </strong>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(order.code, 'Nội dung chuyển khoản')}
                        className="text-slate-400 hover:text-emerald-700 p-1 transition-colors"
                        title="Sao chép nội dung chuyển khoản"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        </div>

        {/* Cột phải: Chi tiết đơn hàng & Nút hành động (6 cols) */}
        <div className="md:col-span-6 space-y-5">
          <Card className="border border-slate-200/90 rounded-3xl overflow-hidden shadow-card bg-white">
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
              <span className="font-heading font-bold text-xs uppercase tracking-wider text-slate-900 flex items-center gap-2">
                <Package className="w-4 h-4 text-emerald-600" /> Danh Sách Hàng Đặt Sỉ
              </span>
              <Badge className="bg-slate-800 text-white text-[10px] rounded-full px-2.5 py-0.5 font-medium">
                {order.paymentOption === 'DEPOSIT_30' ? 'Cọc 30%' : '100%'}
              </Badge>
            </div>

            <CardContent className="p-6 space-y-5">
              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto pr-1">
                {order.items.map((item) => (
                  <div key={item.id} className="py-3 flex justify-between items-center text-xs">
                    <div>
                      <div className="font-bold text-slate-900">{item.productName}</div>
                      <div className="text-slate-500 text-[11px] mt-0.5">
                        {item.packagingName} × {item.quantity}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-extrabold text-slate-900">{formatVND(item.lineTotal)}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {item.isSample ? 'Gói mẫu' : `${formatVND(item.unitPricePerKg)}/kg`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Tóm tắt tổng tiền */}
              <div className="pt-3 border-t border-slate-200/90 space-y-2.5 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Tiền hàng:</span>
                  <span className="font-bold text-slate-900">{formatVND(order.subtotal)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Phí ship:</span>
                  <span className="text-emerald-700 font-medium">
                    {order.shippingFee > 0 ? formatVND(order.shippingFee) : '0 đ (Tạm tính)'}
                  </span>
                </div>
                <div className="flex justify-between text-slate-900 font-extrabold text-sm pt-2.5 border-t border-slate-100">
                  <span>Tổng giá trị đơn hàng:</span>
                  <span>{formatVND(order.total)}</span>
                </div>
                <div className="flex justify-between text-emerald-800 font-black text-base pt-1">
                  <span>{presentation.amountLabel}</span>
                  <span
                    className={
                      presentation.isCancelled
                        ? grossPaid > 0
                          ? 'text-amber-700 font-bold'
                          : 'text-slate-500 font-bold'
                        : ''
                    }
                  >
                    {presentation.amountDisplay}
                  </span>
                </div>
              </div>

              {/* Hành động */}
              <div className="pt-4 space-y-2.5">
                <Link href={`/tai-khoan/don-hang/${order.code}`}>
                  <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-11 rounded-full gap-1.5 shadow-btn-glow hover:-translate-y-0.5 transition-all">
                    Xem chi tiết đơn hàng của tôi <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>

                <Link href="/san-pham" className="block text-center">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs text-slate-600 border-slate-200 rounded-full h-10 hover:text-slate-900"
                  >
                    Tiếp tục mua hàng
                  </Button>
                </Link>
              </div>

              {/* Hộp lưu ý theo trạng thái (QW11-01: ẩn hoàn toàn hướng dẫn chuyển khoản khi đã hủy) */}
              <div
                className={`rounded-2xl text-[11px] leading-relaxed space-y-1 ${
                  presentation.noticeBox.type === 'rose_cancelled' ||
                  presentation.noticeBox.type === 'rose_expired' ||
                  isClientTimerExpired
                    ? 'p-4 bg-rose-50 border border-rose-200 text-rose-900'
                    : presentation.noticeBox.type === 'amber_refund_review'
                      ? 'p-4 bg-amber-50 border border-amber-200 text-amber-900'
                      : presentation.noticeBox.type === 'emerald_completed' ||
                          presentation.noticeBox.type === 'emerald_processing'
                        ? 'p-4 bg-emerald-50 border border-emerald-200 text-emerald-900'
                        : 'p-4 bg-blue-50/80 border border-blue-200 text-blue-900'
                }`}
              >
                <strong>
                  {isClientTimerExpired
                    ? '⏰ Hết hạn thời gian giữ chỗ 10 phút:'
                    : presentation.noticeBox.title}
                </strong>
                <p>
                  {isClientTimerExpired
                    ? 'Đã quá thời gian quy định thanh toán giữ chỗ 10 phút. Hệ thống đang tiến hành giải phóng tồn kho FEFO. Vui lòng không tiếp tục chuyển khoản cho mã đơn này.'
                    : presentation.noticeBox.content}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
