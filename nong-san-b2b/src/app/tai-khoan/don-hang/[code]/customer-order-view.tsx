'use client'

import { useState, useEffect, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Package,
  MapPin,
  CreditCard,
  History,
  QrCode,
  AlertTriangle,
  XCircle,
  ShieldAlert,
  ExternalLink,
  CalendarDays,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatVND } from '@/lib/money'
import { cancelOrder, submitComplaint } from '@/actions/order-lifecycle'
import { confirmRecurringDraft, createRecurringFromOrder } from '@/actions/recurring'
import { quoteCart } from '@/actions/cart'
import { PriceCartResult } from '@/lib/domain/pricing'
import { computeDepositAmount } from '@/lib/domain/settlement'
import { toast } from 'sonner'
import { OrderStatus, ComplaintStatus, PaymentOption } from '@prisma/client'

export interface CustomerOrderData {
  id: string
  code: string
  status: OrderStatus
  paymentOption: string
  subtotal: number
  shippingFee: number
  total: number
  depositAmount: number
  finalSubtotal: number | null
  finalTotal: number | null
  deliveryDate: string | null
  timeSlot: string | null
  deliveredAt: string | null
  paymentDueAt: string | null
  createdAt: string
  cancelledBy: string | null
  cancelReason: string | null
  customerNote?: string | null
  addressSnapshot: {
    recipient?: string
    phone?: string
    line?: string
    ward?: string
    district?: string
    province?: string
  }
  items: {
    id: string
    productId: string
    packagingId: string
    productName: string
    packagingName: string
    isSample: boolean
    quantity: number
    orderedGrams: number
    unitPricePerKg: number
    lineTotal: number
    actualGrams: number | null
    finalLineTotal: number | null
    batchCode: string | null
  }[]
  transactions: {
    id: string
    type: string
    status: string
    method: string
    amount: number
    createdAt: string
  }[]
  events: {
    id: string
    type: string
    note: string | null
    createdAt: string
  }[]
  complaints: {
    id: string
    orderItemId: string
    reportedGrams: number
    verifiedGrams: number | null
    description: string
    photos: string[]
    status: ComplaintStatus
    resolution: string | null
    compensation: number | null
    createdAt: string
  }[]
  paidAmount: number
  remainingAmount: number
  paymentStatus: string
}

interface CustomerOrderViewProps {
  order: CustomerOrderData
}

export function CustomerOrderView({ order }: CustomerOrderViewProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Auto refresh every 30 seconds (Requirement 3.7 & Phase 5)
  useEffect(() => {
    const timer = setInterval(() => {
      router.refresh()
    }, 30000)
    return () => clearInterval(timer)
  }, [router])

  // Dialogs
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  const [complaintDialogOpen, setComplaintDialogOpen] = useState(false)
  const [selectedItemId, setSelectedItemId] = useState(order.items[0]?.id || '')
  const [reportedKg, setReportedKg] = useState<number>(1)
  const [complaintDesc, setComplaintDesc] = useState('')
  const [uploadedPhotos, setUploadedPhotos] = useState<string[]>([])
  const [isUploading, setIsUploading] = useState(false)

  // State cho xác nhận đơn nháp (OrderStatus.DRAFT)
  const [draftLines, setDraftLines] = useState(() =>
    order.items
      .filter((i) => !i.isSample)
      .map((i) => ({
        productId: i.productId,
        packagingId: i.packagingId,
        productName: i.productName,
        packagingName: i.packagingName,
        quantity: i.quantity,
      }))
  )
  const [draftPaymentOption, setDraftPaymentOption] = useState<PaymentOption>(
    order.paymentOption === 'FULL' ? PaymentOption.FULL : PaymentOption.DEPOSIT_30
  )
  const [draftNote, setDraftNote] = useState(order.customerNote ?? '')
  const [draftQuote, setDraftQuote] = useState<PriceCartResult | null>(null)
  const [isQuotingDraft, setIsQuotingDraft] = useState(false)

  // State cho tạo lịch định kỳ từ đơn COMPLETED
  const [recurringDialogOpen, setRecurringDialogOpen] = useState(false)
  const [recurringName, setRecurringName] = useState(`Lịch định kỳ từ đơn ${order.code}`)
  const [recurringWeekdays, setRecurringWeekdays] = useState<number[]>([1, 4])

  useEffect(() => {
    if (order.status !== OrderStatus.DRAFT || draftLines.length === 0) return
    let cancelled = false
    const timer = setTimeout(async () => {
      if (!cancelled) setIsQuotingDraft(true)
      try {
        const res = await quoteCart(
          draftLines
            .filter((i) => i.quantity > 0)
            .map((i) => ({
              productId: i.productId,
              packagingId: i.packagingId,
              quantity: i.quantity,
            }))
        )
        if (!cancelled) {
          setDraftQuote(res.quote)
        }
      } catch {
        if (!cancelled) setDraftQuote(null)
      } finally {
        if (!cancelled) setIsQuotingDraft(false)
      }
    }, 200)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [order.status, draftLines])

  const handleConfirmDraftOrder = () => {
    const validLines = draftLines.filter((l) => l.quantity > 0)
    if (validLines.length === 0) {
      toast.error('Đơn hàng phải có ít nhất 1 sản phẩm với số lượng lớn hơn 0')
      return
    }

    startTransition(async () => {
      const res = await confirmRecurringDraft({
        orderId: order.id,
        paymentOption: draftPaymentOption,
        items: validLines.map((l) => ({
          productId: l.productId,
          packagingId: l.packagingId,
          quantity: l.quantity,
        })),
        customerNote: draftNote,
      })

      if (!res.success || !res.orderCode) {
        toast.error(res.error || 'Không thể xác nhận đơn nháp')
        return
      }

      toast.success('Đã xác nhận đơn nháp! Đang chuyển tới trang thanh toán VietQR...')
      router.push(`/thanh-toan/${res.orderCode}`)
    })
  }

  const handleCreateRecurringFromThisOrder = () => {
    if (!recurringName.trim()) {
      toast.error('Vui lòng nhập tên lịch định kỳ')
      return
    }
    if (recurringWeekdays.length === 0) {
      toast.error('Vui lòng chọn ít nhất 1 thứ giao hàng trong tuần')
      return
    }

    startTransition(async () => {
      const res = await createRecurringFromOrder({
        orderId: order.id,
        name: recurringName.trim(),
        weekdays: recurringWeekdays,
      })

      if (!res.success) {
        toast.error(res.error || 'Không thể tạo lịch định kỳ từ đơn này')
        return
      }

      toast.success('Đã tạo lịch giao định kỳ thành công!')
      setRecurringDialogOpen(false)
      router.push('/tai-khoan/dinh-ky')
    })
  }

  // Handlers
  const handleCancelOrder = () => {
    if (!cancelReason.trim()) {
      toast.error('Vui lòng nhập lý do hủy đơn')
      return
    }

    startTransition(async () => {
      try {
        const res = await cancelOrder({
          orderId: order.id,
          reason: cancelReason.trim(),
        })

        if (res.success) {
          toast.success(res.message || 'Đã hủy đơn hàng thành công')
          setCancelDialogOpen(false)
          router.refresh()
        } else {
          toast.error(res.error || 'Có lỗi khi hủy đơn')
        }
      } catch {
        toast.error('Lỗi khi hủy đơn hàng')
      }
    })
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setIsUploading(true)
    try {
      const newUrls: string[] = []
      for (const file of Array.from(files)) {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        })
        const data = await res.json()
        if (data.success && data.url) {
          newUrls.push(data.url)
        } else {
          toast.error(data.error || 'Lỗi tải ảnh lên')
        }
      }
      setUploadedPhotos((prev) => [...prev, ...newUrls])
    } catch {
      toast.error('Lỗi khi tải ảnh lên')
    } finally {
      setIsUploading(false)
    }
  }

  const handleSubmitComplaint = () => {
    if (reportedKg <= 0) {
      toast.error('Khối lượng hư hỏng phải lớn hơn 0')
      return
    }
    if (!complaintDesc.trim()) {
      toast.error('Vui lòng nhập mô tả chi tiết hư hỏng')
      return
    }
    if (uploadedPhotos.length === 0) {
      toast.error('Vui lòng tải lên ít nhất 1 ảnh minh chứng hư hao')
      return
    }

    startTransition(async () => {
      try {
        const res = await submitComplaint({
          orderId: order.id,
          orderItemId: selectedItemId,
          reportedGrams: Math.round(reportedKg * 1000),
          description: complaintDesc.trim(),
          photos: uploadedPhotos,
        })

        if (res.success) {
          toast.success(res.message || 'Đã gửi khiếu nại thành công')
          setComplaintDialogOpen(false)
          router.refresh()
        } else {
          toast.error(res.error || 'Có lỗi khi gửi khiếu nại')
        }
      } catch {
        toast.error('Lỗi khi gửi khiếu nại')
      }
    })
  }

  // Check 24h complaint deadline
  const canComplaint = (() => {
    if (order.status !== OrderStatus.DELIVERED || !order.deliveredAt) return false
    const diffMs = new Date().getTime() - new Date(order.deliveredAt).getTime()
    return diffMs <= 24 * 60 * 60 * 1000
  })()

  const isUnpaid = order.paymentStatus === 'AWAITING_PAYMENT'

  const policyDeposit =
    order.depositAmount > 0 && order.depositAmount < order.total
      ? order.depositAmount
      : Math.ceil((order.total * 30) / 100 / 1000) * 1000

  const draftPreviewSubtotal = draftQuote?.subtotal ?? order.subtotal
  const draftPreviewTotal = draftPreviewSubtotal + order.shippingFee
  const draftPreviewDeposit = computeDepositAmount(draftPreviewTotal)
  const hasRegularItems = order.items.some((i) => !i.isSample)

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/tai-khoan">
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 p-0 rounded-xl text-slate-500 hover:text-slate-900"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl font-black text-slate-900 tracking-tight font-mono">
                {order.code}
              </h1>
              <CustomerStatusBadge status={order.status} />
              {order.status !== OrderStatus.DRAFT && (
                <CustomerPaymentBadge status={order.paymentStatus} />
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Ngày đặt: {new Date(order.createdAt).toLocaleString('vi-VN')}
            </p>
          </div>
        </div>

        {/* Customer Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Đặt định kỳ từ đơn COMPLETED */}
          {order.status === OrderStatus.COMPLETED && hasRegularItems && (
            <Button
              onClick={() => setRecurringDialogOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 shadow-sm"
            >
              <CalendarDays className="w-4 h-4" /> Đặt định kỳ từ đơn này
            </Button>
          )}

          {/* VietQR button if unpaid */}
          {isUnpaid && order.status === OrderStatus.PENDING_CONFIRMATION && (
            <Link href={`/thanh-toan/${order.code}`}>
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 shadow-sm">
                <QrCode className="w-4 h-4" /> Thanh toán VietQR
              </Button>
            </Link>
          )}

          {/* Khiếu nại hao hụt trong 24h */}
          {canComplaint && (
            <Button
              onClick={() => setComplaintDialogOpen(true)}
              className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs gap-1.5 shadow-sm"
            >
              <ShieldAlert className="w-4 h-4" /> Khiếu nại hao hụt (24h)
            </Button>
          )}

          {/* Hủy đơn hàng */}
          {(order.status === OrderStatus.PENDING_CONFIRMATION ||
            order.status === OrderStatus.PROCESSING) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCancelDialogOpen(true)}
              className="text-rose-700 border-rose-200 hover:bg-rose-50 text-xs font-semibold gap-1.5"
            >
              <XCircle className="w-3.5 h-3.5 text-rose-600" /> Hủy đơn
            </Button>
          )}
        </div>
      </div>

      {/* Khối xác nhận đơn nháp định kỳ (DRAFT -> PENDING_CONFIRMATION) */}
      {order.status === OrderStatus.DRAFT && (
        <Card className="border-amber-300 bg-amber-50/40 shadow-sm">
          <CardHeader className="pb-3 border-b border-amber-200/70">
            <CardTitle className="text-sm sm:text-base font-bold flex items-center gap-2 text-slate-900">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              Đơn nháp định kỳ chờ bạn kiểm tra & xác nhận thanh toán
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-4 text-xs sm:text-sm">
            <p className="text-slate-600 text-xs">
              Bạn có thể điều chỉnh số lượng từng mặt hàng bên dưới, chọn hình thức thanh toán (Cọc
              30% hoặc Thanh toán 100%) rồi bấm <strong>Xác nhận và Thanh toán</strong> để nhận mã
              VietQR. Hệ thống không bao giờ tự trừ tiền khi bạn chưa xác nhận.
            </p>

            <div className="space-y-2">
              <Label className="font-bold text-xs">Điều chỉnh số lượng sản phẩm</Label>
              {draftLines.map((line, idx) => (
                <div
                  key={`${line.productId}-${line.packagingId}`}
                  className="flex items-center justify-between gap-3 bg-white p-3 rounded-xl border border-amber-200"
                >
                  <div>
                    <div className="font-bold text-slate-900">{line.productName}</div>
                    <div className="text-xs text-slate-500">Quy cách: {line.packagingName}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Số lượng:</span>
                    <Input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(e) => {
                        const val = Math.max(1, parseInt(e.target.value, 10) || 1)
                        setDraftLines((prev) =>
                          prev.map((it, i) => (i === idx ? { ...it, quantity: val } : it))
                        )
                      }}
                      className="w-20 h-8 text-center text-xs bg-white"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setDraftPaymentOption(PaymentOption.DEPOSIT_30)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  draftPaymentOption === PaymentOption.DEPOSIT_30
                    ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div className="font-bold text-slate-900 text-xs">Đặt cọc 30% trước khi giao</div>
                <div className="text-emerald-700 font-extrabold text-sm mt-0.5">
                  Cần chuyển: {formatVND(draftPreviewDeposit)}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setDraftPaymentOption(PaymentOption.FULL)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  draftPaymentOption === PaymentOption.FULL
                    ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div className="font-bold text-slate-900 text-xs">Thanh toán 100% giá trị đơn</div>
                <div className="text-emerald-700 font-extrabold text-sm mt-0.5">
                  Cần chuyển: {formatVND(draftPreviewTotal)}
                </div>
              </button>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Ghi chú giao hàng (tùy chọn)</Label>
              <Input
                value={draftNote}
                onChange={(e) => setDraftNote(e.target.value)}
                placeholder="Ghi chú thêm cho chuyến giao định kỳ này..."
                className="bg-white text-xs"
              />
            </div>

            {draftQuote && draftQuote.errors.length > 0 && (
              <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700 font-medium">
                {draftQuote.errors.map((err, i) => (
                  <div key={i}>• {err}</div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-amber-200/70">
              <div className="text-xs text-slate-700">
                Tổng giá trị đơn mới:{' '}
                <strong className="text-base text-emerald-700 font-extrabold">
                  {isQuotingDraft ? 'Đang tính...' : formatVND(draftPreviewTotal)}
                </strong>
              </div>
              <Button
                onClick={handleConfirmDraftOrder}
                disabled={
                  isPending ||
                  isQuotingDraft ||
                  Boolean(draftQuote && draftQuote.errors.length > 0)
                }
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5"
              >
                {isPending ? 'Đang xác nhận...' : 'Xác nhận và Thanh toán'}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cancellation Notice if cancelled */}
      {order.status === OrderStatus.CANCELLED && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3 text-rose-900 text-xs">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <strong>Đơn hàng đã bị hủy:</strong>
            <p className="mt-0.5 text-rose-800">Lý do: {order.cancelReason || 'Không có lý do'}</p>
          </div>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left col: Details */}
        <div className="md:col-span-2 space-y-6">
          {/* Shipping Address */}
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-900">
                <MapPin className="w-4 h-4 text-emerald-600" />
                Địa chỉ nhận hàng & Lịch giao
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-2 text-xs">
              <div className="font-semibold text-slate-900">
                {order.addressSnapshot?.recipient} - {order.addressSnapshot?.phone}
              </div>
              <div className="text-slate-600">
                {order.addressSnapshot?.line}, {order.addressSnapshot?.ward},{' '}
                {order.addressSnapshot?.district}, {order.addressSnapshot?.province}
              </div>
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-slate-500">
                <span>
                  Ngày giao:{' '}
                  <strong className="text-slate-800">
                    {order.deliveryDate
                      ? new Date(order.deliveryDate).toLocaleDateString('vi-VN')
                      : 'Vụ mùa'}
                  </strong>
                </span>
                <span>
                  {order.timeSlot === 'MORNING'
                    ? 'Buổi sáng (07:00 - 11:30)'
                    : order.timeSlot === 'AFTERNOON'
                    ? 'Buổi chiều (13:30 - 17:30)'
                    : 'Cả ngày'}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Items & Settled Weights Table */}
          <Card className="border-slate-200 shadow-sm overflow-hidden">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-900">
                <Package className="w-4 h-4 text-emerald-600" />
                Sản phẩm trong đơn ({order.items.length})
              </CardTitle>
            </CardHeader>
            <div className="divide-y divide-slate-100 text-xs">
              {order.items.map((item) => (
                <div key={item.id} className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div className="space-y-1">
                    <div className="font-bold text-slate-900 text-sm">{item.productName}</div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-2 flex-wrap">
                      <span>Quy cách: {item.packagingName}</span>
                      <span>• {item.quantity} kiện</span>
                      <span>• Đặt: {(item.orderedGrams / 1000).toLocaleString('vi-VN')} kg</span>
                      {item.isSample && (
                        <span className="bg-amber-100 text-amber-800 font-bold px-1.5 py-0.2 rounded text-[10px]">
                          Gói mẫu
                        </span>
                      )}
                      {item.batchCode && (
                        <Link
                          href={`/truy-xuat/${item.batchCode}`}
                          target="_blank"
                          className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 font-mono font-bold px-1.5 py-0.2 rounded text-[10px]"
                        >
                          <QrCode className="w-3 h-3" />
                          Lô: {item.batchCode}
                          <ExternalLink className="w-2.5 h-2.5" />
                        </Link>
                      )}
                    </div>

                    {item.actualGrams !== null && (
                      <div className="text-[11px] text-indigo-700 font-semibold pt-0.5">
                        Thực giao: {(item.actualGrams / 1000).toLocaleString('vi-VN')} kg (Chênh lệch: {((item.actualGrams - item.orderedGrams) / 1000).toFixed(1)} kg)
                      </div>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <div className="font-mono font-bold text-slate-900 text-sm">
                      {item.finalLineTotal !== null
                        ? formatVND(item.finalLineTotal)
                        : formatVND(item.lineTotal)}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {formatVND(item.unitPricePerKg)}/kg
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Complaints filed by customer */}
          {order.complaints.length > 0 && (
            <Card className="border-rose-200 bg-rose-50/20 shadow-sm">
              <CardHeader className="pb-3 border-b border-rose-100">
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-rose-900">
                  <ShieldAlert className="w-4 h-4 text-rose-600" />
                  Khiếu nại của bạn ({order.complaints.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3 text-xs">
                {order.complaints.map((c) => (
                  <div key={c.id} className="p-3 bg-white rounded-xl border border-rose-200 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800">
                        Báo hao hụt: {(c.reportedGrams / 1000).toLocaleString('vi-VN')} kg
                      </span>
                      <Badge
                        variant="outline"
                        className={
                          c.status === 'RESOLVED'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                            : c.status === 'REJECTED'
                            ? 'bg-rose-50 text-rose-700 border-rose-300'
                            : 'bg-amber-50 text-amber-800 border-amber-300'
                        }
                      >
                        {c.status === 'RESOLVED' ? 'ĐÃ BỒI HOÀN' : c.status === 'REJECTED' ? 'TỪ CHỐI' : 'CHỜ XỬ LÝ'}
                      </Badge>
                    </div>
                    <p className="text-slate-600">{c.description}</p>
                    {c.compensation && (
                      <div className="text-emerald-800 font-bold text-xs pt-1">
                        Khoản bồi hoàn: {formatVND(c.compensation)} ({c.resolution})
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Timeline */}
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-900">
                <History className="w-4 h-4 text-emerald-600" />
                Lịch sử xử lý đơn hàng
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="relative pl-6 space-y-3 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 text-xs">
                {order.events.map((evt) => (
                  <div key={evt.id} className="relative">
                    <div className="absolute -left-6 top-1 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white" />
                    <div className="text-slate-500 text-[11px]">
                      {new Date(evt.createdAt).toLocaleString('vi-VN')}
                    </div>
                    <div className="font-medium text-slate-800">
                      {evt.note || evt.type}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right col: Payment */}
        <div className="space-y-6">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-900">
                <CreditCard className="w-4 h-4 text-emerald-600" />
                Thanh toán & Quyết toán
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Tạm tính tiền hàng:</span>
                <span className="font-semibold text-slate-800 font-mono">
                  {formatVND(order.subtotal)}
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Phí vận chuyển:</span>
                <span className="font-semibold text-slate-800 font-mono">
                  {order.shippingFee === 0 ? '0 đ (Miễn phí)' : formatVND(order.shippingFee)}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-100 flex justify-between font-bold text-slate-900 text-sm">
                <span>{order.finalTotal !== null ? 'Tổng quyết toán thực tế:' : 'Tổng giá trị:'}</span>
                <span className="font-mono">{formatVND(order.finalTotal ?? order.total)}</span>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl space-y-1.5 mt-2 border border-slate-100">
                <div className="flex justify-between text-slate-700">
                  <span>Hình thức:</span>
                  <span className="font-bold">
                    {order.paymentOption === 'DEPOSIT_30' ? 'Cọc 30%' : 'Trả 100%'}
                  </span>
                </div>
                <div className="flex justify-between text-emerald-800 font-bold">
                  <span>Đã thanh toán:</span>
                  <span className="font-mono">{formatVND(order.paidAmount)}</span>
                </div>
                <div className="flex justify-between text-slate-800 font-bold">
                  <span>Còn lại cần thanh toán:</span>
                  <span className="font-mono text-rose-700">
                    {formatVND(order.remainingAmount)}
                  </span>
                </div>
              </div>

              {isUnpaid && order.status === OrderStatus.PENDING_CONFIRMATION && (
                <div className="pt-2">
                  <Link href={`/thanh-toan/${order.code}`}>
                    <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5">
                      <QrCode className="w-4 h-4" /> Thanh toán VietQR ngay
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Modal Hủy đơn hàng */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900">
              Hủy đơn hàng {order.code}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              {order.status === OrderStatus.PROCESSING ? (
                <span className="text-rose-700 font-semibold block">
                  CẢNH BÁO MẤT CỌC: Đơn hàng đang được nhà vườn chuẩn bị (PROCESSING). Nếu bạn hủy đơn lúc này, bạn sẽ BỊ PHẠT MẤT TIỀN CỌC 30% ({formatVND(policyDeposit)}). Số tiền còn lại đã trả sẽ được hoàn qua chuyển khoản.
                </span>
              ) : (
                <span>
                  Bạn có chắc muốn hủy đơn hàng? Hệ thống sẽ hoàn lại 100% số tiền bạn đã thanh toán.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 text-xs">
            <Label htmlFor="cancelNote" className="text-xs font-semibold text-slate-700">
              Lý do bạn muốn hủy đơn *
            </Label>
            <Textarea
              id="cancelNote"
              placeholder="Vui lòng cho chúng tôi biết lý do..."
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              className="mt-1 text-xs resize-none"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCancelDialogOpen(false)}
              disabled={isPending}
              className="text-xs"
            >
              Quay lại
            </Button>
            <Button
              size="sm"
              onClick={handleCancelOrder}
              disabled={isPending}
              className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs gap-1.5"
            >
              {isPending ? 'Đang xử lý...' : 'Xác nhận hủy đơn'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Khiếu nại hao hụt */}
      <Dialog open={complaintDialogOpen} onOpenChange={setComplaintDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900">
              Gửi khiếu nại hao hụt / Hư hỏng trong 24h
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Quy định: Hư hao tự nhiên được hỗ trợ bồi hoàn cho phần vượt quá 3% khối lượng thực giao. Vui lòng đính kèm hình ảnh rõ nét.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div>
              <Label className="text-xs font-semibold text-slate-700">Chọn sản phẩm khiếu nại *</Label>
              <select
                value={selectedItemId}
                onChange={(e) => setSelectedItemId(e.target.value)}
                className="w-full mt-1 h-9 px-3 rounded-lg border border-slate-200 bg-white text-slate-700 font-medium text-xs focus:ring-1 focus:ring-emerald-500"
              >
                {order.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.productName} ({i.packagingName}) - Thực giao: {((i.actualGrams ?? i.orderedGrams) / 1000).toLocaleString('vi-VN')} kg
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="reportedKg" className="text-xs font-semibold text-slate-700">
                Khối lượng hư hỏng ước tính (kg) *
              </Label>
              <Input
                id="reportedKg"
                type="number"
                step="0.1"
                min="0.1"
                value={reportedKg}
                onChange={(e) => setReportedKg(Number(e.target.value))}
                className="mt-1 font-mono font-bold text-sm"
              />
            </div>

            <div>
              <Label htmlFor="desc" className="text-xs font-semibold text-slate-700">
                Mô tả chi tiết tình trạng hàng *
              </Label>
              <Textarea
                id="desc"
                placeholder="VD: Trái cây bị dập nát khoảng 5kg do va đập trong quá trình vận chuyển..."
                value={complaintDesc}
                onChange={(e) => setComplaintDesc(e.target.value)}
                rows={3}
                className="mt-1 text-xs resize-none"
              />
            </div>

            <div>
              <Label className="text-xs font-semibold text-slate-700">
                Tải ảnh minh chứng đồng kiểm (1-5 ảnh) *
              </Label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileUpload}
                  disabled={isUploading}
                  className="text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
                />
              </div>

              {uploadedPhotos.length > 0 && (
                <div className="flex gap-2 pt-2 overflow-x-auto">
                  {uploadedPhotos.map((url, i) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img key={i} src={url} alt="Minh chứng" className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setComplaintDialogOpen(false)}
              disabled={isPending}
              className="text-xs"
            >
              Hủy bỏ
            </Button>
            <Button
              size="sm"
              onClick={handleSubmitComplaint}
              disabled={isPending || isUploading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5"
            >
              {isPending ? 'Đang gửi...' : 'Gửi khiếu nại cho ban quản trị'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Đặt định kỳ từ đơn COMPLETED */}
      <Dialog open={recurringDialogOpen} onOpenChange={setRecurringDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <CalendarDays className="w-5 h-5 text-emerald-600" />
              Đặt định kỳ từ đơn {order.code}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Hệ thống sẽ lưu danh sách sản phẩm thương mại của đơn này vào lịch giao định kỳ hàng
              tuần và tự động tạo đơn nháp trước mỗi kỳ giao.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div className="space-y-1.5">
              <Label className="font-semibold">Tên lịch định kỳ</Label>
              <Input
                value={recurringName}
                onChange={(e) => setRecurringName(e.target.value)}
                className="text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="font-semibold">Chọn các thứ giao hàng trong tuần</Label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { value: 1, label: 'Thứ 2' },
                  { value: 2, label: 'Thứ 3' },
                  { value: 3, label: 'Thứ 4' },
                  { value: 4, label: 'Thứ 5' },
                  { value: 5, label: 'Thứ 6' },
                  { value: 6, label: 'Thứ 7' },
                  { value: 7, label: 'Chủ Nhật' },
                ].map((day) => {
                  const selected = recurringWeekdays.includes(day.value)
                  return (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() =>
                        setRecurringWeekdays((prev) =>
                          prev.includes(day.value)
                            ? prev.filter((d) => d !== day.value)
                            : [...prev, day.value].sort((a, b) => a - b)
                        )
                      }
                      className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                        selected
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white text-slate-700 border-slate-200'
                      }`}
                    >
                      {day.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRecurringDialogOpen(false)}
              disabled={isPending}
              className="text-xs"
            >
              Hủy
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleCreateRecurringFromThisOrder}
              disabled={isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
            >
              {isPending ? 'Đang tạo...' : 'Xác nhận tạo lịch định kỳ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CustomerStatusBadge({ status }: { status: OrderStatus }) {
  switch (status) {
    case 'DRAFT':
      return <Badge className="bg-amber-100 text-amber-900 border-amber-300">Đơn nháp định kỳ</Badge>
    case 'PENDING_CONFIRMATION':
      return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Chờ xác nhận</Badge>
    case 'PROCESSING':
      return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Đang xử lý</Badge>
    case 'SHIPPING':
      return <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200">Đang giao</Badge>
    case 'DELIVERED':
      return <Badge className="bg-teal-100 text-teal-800 border-teal-200">Đã giao hàng</Badge>
    case 'COMPLAINT':
      return <Badge className="bg-rose-100 text-rose-800 border-rose-200">Đang khiếu nại</Badge>
    case 'COMPLETED':
      return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Hoàn thành</Badge>
    case 'CANCELLED':
      return <Badge className="bg-rose-50 text-rose-600 border-rose-200">Đã hủy</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function CustomerPaymentBadge({ status }: { status: string }) {
  switch (status) {
    case 'AWAITING_PAYMENT':
      return <Badge variant="outline">Chờ thanh toán</Badge>
    case 'DEPOSIT_PAID':
      return <Badge className="bg-amber-50 text-amber-800 border-amber-300">Đã cọc 30%</Badge>
    case 'PAID':
      return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">Đã thanh toán đủ</Badge>
    case 'REFUND_PENDING':
      return <Badge className="bg-purple-100 text-purple-800 border-purple-200">Chờ hoàn tiền</Badge>
    case 'PARTIALLY_REFUNDED':
    case 'REFUNDED':
      return <Badge className="bg-slate-100 text-slate-800 border-slate-300">Đã hoàn tiền</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}
