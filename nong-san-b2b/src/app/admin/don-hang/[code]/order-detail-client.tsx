'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  DollarSign,
  Package,
  MapPin,
  Building,
  User,
  CreditCard,
  History,
  Truck,
  Scale,
  XCircle,
  AlertTriangle,
  QrCode,
  ExternalLink,
  ShieldAlert,
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
import { confirmPayment } from '@/actions/admin-order'
import {
  cancelOrder,
  transitionToShipping,
  settleActualWeights,
  confirmRefundDone,
  completeOrder,
} from '@/actions/order-lifecycle'
import { toast } from 'sonner'
import {
  OrderStatus,
  TxMethod,
  TxType,
  TxStatus,
  ComplaintStatus,
} from '@prisma/client'

export interface OrderDetailData {
  id: string
  code: string
  type: string
  status: OrderStatus
  paymentOption: string
  groupDiscountPercent: number
  deliveryDate: string | null
  timeSlot: string | null
  subtotal: number
  shippingFee: number
  total: number
  depositAmount: number
  finalSubtotal: number | null
  finalTotal: number | null
  paymentDueAt: string | null
  deliveredAt: string | null
  cancelledBy: string | null
  cancelReason: string | null
  customerNote: string | null
  createdAt: string
  addressSnapshot: {
    recipient: string
    phone: string
    line: string
    ward: string
    district: string
    province: string
  }
  user: {
    id: string
    fullName: string
    email: string
    phone: string
    companyName: string | null
    groupName: string | null
    groupDiscount: number
  }
  items: {
    id: string
    productId: string
    productName: string
    packagingName: string
    isSample: boolean
    quantity: number
    orderedGrams: number
    unitPricePerKg: number
    lineTotal: number
    actualGrams: number | null
    finalLineTotal: number | null
    batchId: string | null
    batchCode: string | null
  }[]
  transactions: {
    id: string
    type: TxType
    status: TxStatus
    method: TxMethod
    amount: number
    reference: string | null
    note: string | null
    createdAt: string
    completedAt: string | null
  }[]
  events: {
    id: string
    type: string
    fromStatus: string | null
    toStatus: string | null
    note: string | null
    actorId: string | null
    createdAt: string
    payload: unknown
  }[]
  complaints: {
    id: string
    orderItemId: string
    description: string
    photos: string[]
    reportedGrams: number
    verifiedGrams: number | null
    status: ComplaintStatus
    resolution: string | null
    compensation: number | null
    adminNote: string | null
    createdAt: string
    resolvedAt: string | null
  }[]
  paidAmount: number
  remainingAmount: number
  paymentStatus: 'AWAITING_PAYMENT' | 'DEPOSIT_PAID' | 'PAID' | 'REFUND_PENDING' | 'PARTIALLY_REFUNDED' | 'REFUNDED'
}

export interface AvailableBatch {
  id: string
  code: string
  productId: string
  harvestDate: string
  quantityGrams: number
}

interface OrderDetailClientProps {
  order: OrderDetailData
  availableBatches: AvailableBatch[]
}

const cancelReasons = [
  'Hết hàng tại vườn',
  'Thiên tai / Thời tiết bất lợi',
  'Xe hỏng / Sự cố vận chuyển',
  'Khách không thanh toán theo hạn',
  'Khác',
]

export function OrderDetailClient({ order, availableBatches }: OrderDetailClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Modals state
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false)
  const [shippingDialogOpen, setShippingDialogOpen] = useState(false)
  const [settleDialogOpen, setSettleDialogOpen] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)

  // Payment form state
  const defaultAmount =
    order.paidAmount < order.depositAmount
      ? order.depositAmount - order.paidAmount
      : order.remainingAmount > 0
      ? order.remainingAmount
      : order.total

  const [paymentAmount, setPaymentAmount] = useState(defaultAmount)
  const [paymentMethod, setPaymentMethod] = useState<TxMethod>(TxMethod.BANK_TRANSFER)
  const [referenceCode, setReferenceCode] = useState('')
  const [paymentNote, setPaymentNote] = useState('')

  // Batch assignments state for SHIPPING
  const [batchAssignments, setBatchAssignments] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const item of order.items) {
      init[item.id] = item.batchId || ''
    }
    return init
  })

  // Settle weights form state (actualKg entered by admin)
  const [actualKgMap, setActualKgMap] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {}
    for (const item of order.items) {
      init[item.id] = (item.actualGrams ?? item.orderedGrams) / 1000
    }
    return init
  })

  // Cancel form state
  const [cancelReasonOption, setCancelReasonOption] = useState(cancelReasons[0])
  const [cancelReasonCustom, setCancelReasonCustom] = useState('')

  // Handlers
  const handleConfirmPayment = () => {
    if (paymentAmount <= 0) {
      toast.error('Số tiền xác nhận phải lớn hơn 0')
      return
    }

    startTransition(async () => {
      try {
        const res = await confirmPayment({
          orderId: order.id,
          amount: paymentAmount,
          method: paymentMethod,
          reference: referenceCode,
          note: paymentNote,
        })

        if (res.success) {
          toast.success(res.message || 'Xác nhận thanh toán thành công!')
          setPaymentDialogOpen(false)
          router.refresh()
        } else {
          toast.error(res.error || 'Có lỗi xảy ra')
        }
      } catch {
        toast.error('Lỗi khi thực hiện xác nhận thanh toán')
      }
    })
  }

  const handleTransitionToShipping = () => {
    startTransition(async () => {
      try {
        const assignments = Object.entries(batchAssignments)
          .filter(([, batchId]) => Boolean(batchId))
          .map(([orderItemId, batchId]) => ({ orderItemId, batchId }))

        const res = await transitionToShipping({
          orderId: order.id,
          batchAssignments: assignments,
        })

        if (res.success) {
          toast.success(res.message || 'Đã chuyển đơn sang Đang giao (SHIPPING)')
          setShippingDialogOpen(false)
          router.refresh()
        } else {
          toast.error(res.error || 'Có lỗi xảy ra')
        }
      } catch {
        toast.error('Lỗi khi chuyển trạng thái vận chuyển')
      }
    })
  }

  const handleSettleActualWeights = () => {
    // Validate 105% check before submitting
    for (const item of order.items) {
      if (!item.isSample) {
        const kg = actualKgMap[item.id] ?? 0
        const grams = Math.round(kg * 1000)
        const maxAllowed = Math.floor(item.orderedGrams * 1.05)
        if (grams > maxAllowed) {
          toast.error(
            `Khối lượng ${item.productName} (${kg} kg) vượt quá 105% khối lượng đặt (${(maxAllowed / 1000).toFixed(1)} kg)`
          )
          return
        }
      }
    }

    startTransition(async () => {
      try {
        const lines = order.items.map((item) => ({
          orderItemId: item.id,
          actualGrams: Math.round((actualKgMap[item.id] ?? 0) * 1000),
        }))

        const res = await settleActualWeights({
          orderId: order.id,
          lines,
        })

        if (res.success) {
          toast.success(res.message || 'Chốt khối lượng thành công!')
          setSettleDialogOpen(false)
          router.refresh()
        } else {
          toast.error(res.error || 'Có lỗi xảy ra')
        }
      } catch {
        toast.error('Lỗi khi chốt khối lượng thực tế')
      }
    })
  }

  const handleCancelOrder = () => {
    const fullReason =
      cancelReasonOption === 'Khác'
        ? cancelReasonCustom.trim() || 'Lý do khác'
        : cancelReasonCustom.trim()
        ? `${cancelReasonOption}: ${cancelReasonCustom.trim()}`
        : cancelReasonOption

    startTransition(async () => {
      try {
        const res = await cancelOrder({
          orderId: order.id,
          reason: fullReason,
        })

        if (res.success) {
          toast.success(res.message || 'Đã hủy đơn hàng thành công')
          setCancelDialogOpen(false)
          router.refresh()
        } else {
          toast.error(res.error || 'Có lỗi khi hủy đơn')
        }
      } catch {
        toast.error('Lỗi khi thực hiện hủy đơn')
      }
    })
  }

  const handleConfirmRefund = (transactionId: string) => {
    startTransition(async () => {
      try {
        const res = await confirmRefundDone({ transactionId })
        if (res.success) {
          toast.success(res.message || 'Đã xác nhận hoàn tiền thành công')
          router.refresh()
        } else {
          toast.error(res.error || 'Có lỗi xảy ra')
        }
      } catch {
        toast.error('Lỗi khi xác nhận hoàn tiền')
      }
    })
  }

  const handleCompleteOrder = () => {
    startTransition(async () => {
      try {
        const res = await completeOrder({ orderId: order.id })
        if (res.success) {
          toast.success(res.message || 'Đơn hàng đã hoàn thành!')
          router.refresh()
        } else {
          toast.error(res.error || 'Chưa đủ điều kiện hoàn thành đơn')
        }
      } catch {
        toast.error('Lỗi khi đóng hoàn thành đơn')
      }
    })
  }

  // Previews for weight settlement dialog
  const settlePreview = (() => {
    let subtotal = 0
    let hasOver105 = false

    for (const item of order.items) {
      const kg = actualKgMap[item.id] ?? 0
      const grams = Math.round(kg * 1000)
      if (!item.isSample && grams > Math.floor(item.orderedGrams * 1.05)) {
        hasOver105 = true
      }
      const lineTotal = item.isSample
        ? item.lineTotal
        : Math.round((item.unitPricePerKg * grams) / 1000)
      subtotal += lineTotal
    }

    const total = subtotal + order.shippingFee
    const balance = total - order.paidAmount

    return {
      subtotal,
      total,
      balance,
      hasOver105,
    }
  })()

  const isDueOver =
    order.paymentDueAt &&
    new Date(order.paymentDueAt) < new Date() &&
    order.paidAmount === 0

  const pendingRefundTx = order.transactions.find(
    (t) => t.type === TxType.REFUND && t.status === TxStatus.PENDING
  )

  const isEligibleToComplete =
    (order.status === OrderStatus.DELIVERED || order.status === OrderStatus.COMPLAINT) &&
    order.paidAmount === (order.finalTotal ?? order.total) &&
    !pendingRefundTx &&
    order.complaints.every((c) => c.status !== ComplaintStatus.OPEN)

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header & Quick Action Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/admin/don-hang">
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
              <OrderStatusBadge status={order.status} />
              <PaymentStatusBadge status={order.paymentStatus} />
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Tạo lúc {new Date(order.createdAt).toLocaleString('vi-VN')} • Mã ID: {order.id}
            </p>
          </div>
        </div>

        {/* Dynamic Action Buttons based on Order State */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Action 1: Xác nhận đã nhận tiền (khi còn thiếu tiền) */}
          {order.status !== OrderStatus.CANCELLED &&
            order.status !== OrderStatus.COMPLETED &&
            order.remainingAmount > 0 && (
              <Button
                onClick={() => setPaymentDialogOpen(true)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 shadow-sm"
              >
                <CheckCircle2 className="w-4 h-4" />
                Xác nhận đã nhận tiền
              </Button>
            )}

          {/* Action 2: Chuyển Đang giao (SHIPPING) (khi ở PROCESSING) */}
          {order.status === OrderStatus.PROCESSING && (
            <Button
              onClick={() => setShippingDialogOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs gap-1.5 shadow-sm"
            >
              <Truck className="w-4 h-4" />
              Bàn giao vận chuyển (SHIPPING)
            </Button>
          )}

          {/* Action 3: Chốt khối lượng thực tế (DELIVERED) (khi ở SHIPPING) */}
          {order.status === OrderStatus.SHIPPING && (
            <Button
              onClick={() => setSettleDialogOpen(true)}
              className="bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs gap-1.5 shadow-sm"
            >
              <Scale className="w-4 h-4" />
              Nhập khối lượng thực (DELIVERED)
            </Button>
          )}

          {/* Action 4: Hoàn thành đơn hàng (khi đã giao, tất toán đủ & qua 24h) */}
          {isEligibleToComplete && (
            <Button
              onClick={handleCompleteOrder}
              disabled={isPending}
              className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs gap-1.5 shadow-sm"
            >
              <CheckCircle2 className="w-4 h-4" />
              Hoàn thành đơn hàng (COMPLETED)
            </Button>
          )}

          {/* Action 5: Hủy đơn hàng (khi ở PENDING hoặc PROCESSING) */}
          {(order.status === OrderStatus.PENDING_CONFIRMATION ||
            order.status === OrderStatus.PROCESSING) && (
            <Button
              variant="outline"
              onClick={() => setCancelDialogOpen(true)}
              className="text-rose-700 border-rose-200 hover:bg-rose-50 text-xs font-semibold gap-1.5"
            >
              <XCircle className="w-4 h-4 text-rose-600" />
              Hủy đơn
            </Button>
          )}
        </div>
      </div>

      {/* Due Alert if overdue */}
      {isDueOver && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3 text-amber-900 text-xs">
          <Clock className="w-5 h-5 text-amber-600 shrink-0" />
          <div>
            <strong>Đơn hàng đã quá hạn thanh toán 24h:</strong> Hạn chót là{' '}
            {new Date(order.paymentDueAt!).toLocaleString('vi-VN')}. Khách hàng chưa hoàn tất thanh toán. Bạn có thể hủy hoặc chạy &quot;Quét đơn quá hạn&quot;.
          </div>
        </div>
      )}

      {/* Cancelled Banner */}
      {order.status === OrderStatus.CANCELLED && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3 text-rose-900 text-xs">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <strong>Đơn hàng đã bị hủy bởi {order.cancelledBy === 'CUSTOMER' ? 'Khách hàng' : order.cancelledBy === 'SELLER' ? 'Bên bán (Admin)' : 'Hệ thống'}:</strong>
            <p className="mt-0.5 text-rose-800">Lý do: {order.cancelReason || 'Không có lý do cụ thể'}</p>
          </div>
        </div>
      )}

      {/* Grid: Details & Financials */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer & Delivery Card */}
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-900">
                <User className="w-4 h-4 text-emerald-600" />
                Thông tin Khách hàng & Điểm giao hàng
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-5 text-xs">
              <div className="space-y-1.5 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                <div className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                  <Building className="w-4 h-4 text-slate-500" />
                  {order.user.companyName || order.user.fullName}
                </div>
                <div className="text-slate-600">Người liên hệ: <strong>{order.user.fullName}</strong></div>
                <div className="text-slate-600">Số điện thoại: <strong>{order.user.phone}</strong></div>
                <div className="text-slate-600">Email: {order.user.email}</div>
                {order.user.groupName && (
                  <div className="pt-1">
                    <span className="bg-emerald-100 text-emerald-800 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                      Hạng: {order.user.groupName} (-{order.user.groupDiscount}%)
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                <div className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-emerald-600" />
                  Địa chỉ nhận hàng (Snapshot)
                </div>
                <div className="text-slate-600">
                  Người nhận: <strong>{order.addressSnapshot.recipient}</strong> - {order.addressSnapshot.phone}
                </div>
                <div className="text-slate-600 leading-relaxed">
                  {order.addressSnapshot.line}, {order.addressSnapshot.ward},{' '}
                  {order.addressSnapshot.district}, {order.addressSnapshot.province}
                </div>
                <div className="pt-1 text-[11px] text-slate-500">
                  Ngày giao dự kiến:{' '}
                  <strong>
                    {order.deliveryDate
                      ? new Date(order.deliveryDate).toLocaleDateString('vi-VN')
                      : 'Vụ mùa'}
                  </strong>{' '}
                  •{' '}
                  {order.timeSlot === 'MORNING'
                    ? 'Buổi sáng (07:00 - 11:30)'
                    : order.timeSlot === 'AFTERNOON'
                    ? 'Buổi chiều (13:30 - 17:30)'
                    : 'Cả ngày'}
                </div>
              </div>

              {order.customerNote && (
                <div className="sm:col-span-2 bg-amber-50/60 border border-amber-200/60 p-3 rounded-xl text-slate-700">
                  <strong className="text-amber-900 block mb-0.5">Ghi chú của khách hàng:</strong>
                  {order.customerNote}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Items Table Card with Batch QR & Settled Weights */}
          <Card className="border-slate-200 shadow-sm overflow-hidden">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-900">
                <Package className="w-4 h-4 text-emerald-600" />
                Danh mục Sản phẩm & Quyết toán khối lượng ({order.items.length} mặt hàng)
              </CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Sản phẩm & Lô hàng</th>
                    <th className="py-3 px-4 text-center">Số kiện</th>
                    <th className="py-3 px-4 text-right">Đặt (kg)</th>
                    <th className="py-3 px-4 text-right">Thực giao (kg)</th>
                    <th className="py-3 px-4 text-right">Đơn giá / kg</th>
                    <th className="py-3 px-4 text-right">Thành tiền</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {order.items.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/80">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{item.productName}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span>{item.packagingName}</span>
                          {item.isSample && (
                            <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.2 rounded">
                              Gói mẫu
                            </span>
                          )}
                          {item.batchCode && (
                            <Link
                              href={`/truy-xuat/${item.batchCode}`}
                              target="_blank"
                              className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-[10px] font-mono font-bold px-1.5 py-0.2 rounded"
                            >
                              <QrCode className="w-3 h-3" />
                              Lô: {item.batchCode}
                              <ExternalLink className="w-2.5 h-2.5" />
                            </Link>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-center font-medium text-slate-800">
                        {item.quantity} kiện
                      </td>
                      <td className="py-3.5 px-4 text-right font-medium text-slate-800">
                        {(item.orderedGrams / 1000).toLocaleString('vi-VN')} kg
                      </td>
                      <td className="py-3.5 px-4 text-right font-semibold text-slate-900">
                        {item.actualGrams !== null ? (
                          <span className={item.actualGrams !== item.orderedGrams ? 'text-indigo-700' : ''}>
                            {(item.actualGrams / 1000).toLocaleString('vi-VN')} kg
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">Chờ cân</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-slate-800">
                        {formatVND(item.unitPricePerKg)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">
                        {item.finalLineTotal !== null
                          ? formatVND(item.finalLineTotal)
                          : formatVND(item.lineTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Complaints Section if complaints exist */}
          {order.complaints.length > 0 && (
            <Card className="border-rose-200 bg-rose-50/20 shadow-sm">
              <CardHeader className="pb-3 border-b border-rose-100 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-bold flex items-center gap-2 text-rose-900">
                  <ShieldAlert className="w-4 h-4 text-rose-600" />
                  Khiếu nại Hao hụt / Hư hỏng ({order.complaints.length})
                </CardTitle>
                <Link href="/admin/khieu-nai">
                  <Button size="sm" variant="outline" className="text-xs h-7 text-rose-700 border-rose-300">
                    Mở trang xử lý khiếu nại
                  </Button>
                </Link>
              </CardHeader>
              <CardContent className="p-4 space-y-3 text-xs">
                {order.complaints.map((c) => (
                  <div key={c.id} className="p-3 bg-white rounded-xl border border-rose-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-slate-900">
                        Báo hư: <span className="text-rose-700 font-bold">{(c.reportedGrams / 1000).toLocaleString('vi-VN')} kg</span>
                        {c.verifiedGrams !== null && (
                          <span className="ml-2 text-emerald-700 font-bold">
                            (Xác minh: {(c.verifiedGrams / 1000).toLocaleString('vi-VN')} kg)
                          </span>
                        )}
                      </div>
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
                        {c.status === 'RESOLVED' ? 'ĐÃ GIẢI QUYẾT' : c.status === 'REJECTED' ? 'TỪ CHỐI' : 'CHỜ XỬ LÝ'}
                      </Badge>
                    </div>
                    <div className="text-slate-600">{c.description}</div>
                    {c.photos.length > 0 && (
                      <div className="flex gap-2 pt-1 overflow-x-auto">
                        {c.photos.map((p, i) => (
                          <a key={i} href={p} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p} alt="Minh chứng" className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                          </a>
                        ))}
                      </div>
                    )}
                    {c.compensation && (
                      <div className="text-emerald-800 font-bold text-xs pt-1">
                        Bồi hoàn: {formatVND(c.compensation)} ({c.resolution})
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Transactions List */}
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-900">
                <CreditCard className="w-4 h-4 text-emerald-600" />
                Lịch sử Giao dịch & Hoàn tiền ({order.transactions.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {order.transactions.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-400 italic">
                  Chưa ghi nhận giao dịch thanh toán nào cho đơn này.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {order.transactions.map((tx) => (
                    <div
                      key={tx.id}
                      className="p-3 rounded-xl border border-slate-100 bg-slate-50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 font-mono text-sm">
                            {formatVND(tx.amount)}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              tx.type === 'PAYMENT'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-purple-100 text-purple-800'
                            }`}
                          >
                            {tx.type === 'PAYMENT' ? 'THANH TOÁN' : 'HOÀN TIỀN'}
                          </span>
                          <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.2 rounded font-medium">
                            {tx.method}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {new Date(tx.createdAt).toLocaleString('vi-VN')}
                          {tx.reference && ` • Mã GD: ${tx.reference}`}
                          {tx.note && ` • ${tx.note}`}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            tx.status === 'DONE'
                              ? 'text-emerald-700 border-emerald-300 bg-emerald-50'
                              : 'text-amber-700 border-amber-300 bg-amber-50'
                          }`}
                        >
                          {tx.status === 'DONE' ? 'Thành công' : 'Chờ hoàn tiền'}
                        </Badge>

                        {/* Action: Admin xác nhận đã hoàn tiền */}
                        {tx.type === TxType.REFUND && tx.status === TxStatus.PENDING && (
                          <Button
                            size="sm"
                            onClick={() => handleConfirmRefund(tx.id)}
                            disabled={isPending}
                            className="h-7 text-[10px] bg-purple-600 hover:bg-purple-700 text-white font-bold"
                          >
                            Xác nhận đã chuyển hoàn
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Events Timeline */}
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-900">
                <History className="w-4 h-4 text-emerald-600" />
                Nhật ký Vòng đời Đơn hàng ({order.events.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                {order.events.map((evt) => (
                  <div key={evt.id} className="relative text-xs">
                    <div className="absolute -left-6 top-1 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white shadow-sm" />
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800 font-mono text-[11px]">
                        {evt.type}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {new Date(evt.createdAt).toLocaleString('vi-VN')}
                      </span>
                    </div>
                    {evt.note && <div className="text-slate-600 mt-0.5">{evt.note}</div>}
                    {evt.fromStatus && evt.toStatus && (
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        {evt.fromStatus} ➔ {evt.toStatus}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Financials & Summaries */}
        <div className="space-y-6">
          <Card className="border-slate-200 shadow-sm sticky top-6">
            <CardHeader className="pb-3 border-b border-slate-100 bg-slate-50/50">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-900">
                <DollarSign className="w-4 h-4 text-emerald-600" />
                Tổng quan Tài chính & Quyết toán
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-3.5 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Tạm tính tiền hàng:</span>
                <span className="font-semibold text-slate-800 font-mono">
                  {formatVND(order.subtotal)}
                </span>
              </div>

              <div className="flex justify-between text-slate-600">
                <span>Chiết khấu nhóm ({order.groupDiscountPercent}%):</span>
                <span className="font-semibold text-emerald-700">Đã trừ trong đơn giá</span>
              </div>

              <div className="flex justify-between text-slate-600">
                <span>Phí vận chuyển:</span>
                <span className="font-semibold text-slate-800 font-mono">
                  {order.shippingFee === 0 ? '0 đ (Miễn phí)' : formatVND(order.shippingFee)}
                </span>
              </div>

              <div className="pt-2 border-t border-slate-200 flex justify-between items-baseline">
                <span className="font-bold text-slate-900 text-sm">
                  {order.finalTotal !== null ? 'Tổng quyết toán thực tế:' : 'Tổng giá trị đơn đặt:'}
                </span>
                <span className="font-black text-slate-900 text-lg font-mono">
                  {formatVND(order.finalTotal ?? order.total)}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-2 mt-2">
                <div className="flex justify-between text-slate-700">
                  <span>Hình thức thanh toán:</span>
                  <span className="font-bold">
                    {order.paymentOption === 'DEPOSIT_30' ? 'Cọc 30%' : 'Trả 100%'}
                  </span>
                </div>

                <div className="flex justify-between text-slate-700">
                  <span>Tiền cọc tối thiểu (30%):</span>
                  <span className="font-bold font-mono text-amber-800">
                    {formatVND(order.depositAmount)}
                  </span>
                </div>

                <div className="flex justify-between text-emerald-800 font-bold border-t border-slate-200 pt-2">
                  <span>Đã thanh toán thực tế:</span>
                  <span className="font-mono text-sm">{formatVND(order.paidAmount)}</span>
                </div>

                <div className="flex justify-between text-slate-800 font-bold">
                  <span>Còn lại cần thu:</span>
                  <span className="font-mono text-sm text-rose-700">
                    {formatVND(order.remainingAmount)}
                  </span>
                </div>
              </div>

              {order.paymentDueAt && (
                <div className="text-[11px] text-slate-500 pt-1 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span>
                    Hạn thanh toán: {new Date(order.paymentDueAt).toLocaleString('vi-VN')}
                  </span>
                </div>
              )}

              {/* Action buttons inside card */}
              <div className="pt-3 space-y-2">
                {order.remainingAmount > 0 && order.status !== OrderStatus.CANCELLED && (
                  <Button
                    onClick={() => setPaymentDialogOpen(true)}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 shadow-sm"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Xác nhận đã nhận tiền
                  </Button>
                )}

                {order.status === OrderStatus.PROCESSING && (
                  <Button
                    onClick={() => setShippingDialogOpen(true)}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs gap-1.5 shadow-sm"
                  >
                    <Truck className="w-4 h-4" />
                    Bàn giao vận chuyển (SHIPPING)
                  </Button>
                )}

                {order.status === OrderStatus.SHIPPING && (
                  <Button
                    onClick={() => setSettleDialogOpen(true)}
                    className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs gap-1.5 shadow-sm"
                  >
                    <Scale className="w-4 h-4" />
                    Nhập khối lượng thực & Quyết toán
                  </Button>
                )}

                {isEligibleToComplete && (
                  <Button
                    onClick={handleCompleteOrder}
                    disabled={isPending}
                    className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs gap-1.5 shadow-sm"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Đóng hoàn thành đơn (COMPLETED)
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Modal 1: Xác nhận đã nhận tiền */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900">
              Xác nhận giao dịch thanh toán
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Ghi nhận tiền thanh toán cho đơn hàng <strong className="font-mono">{order.code}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div>
              <Label htmlFor="amount" className="text-xs font-semibold text-slate-700">
                Số tiền nhận (VND) *
              </Label>
              <Input
                id="amount"
                type="number"
                step="1000"
                min="1000"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(Number(e.target.value))}
                className="mt-1 font-mono font-bold text-sm"
              />
              <div className="text-[11px] text-slate-500 mt-1 flex justify-between">
                <span>Cọc tối thiểu: {formatVND(order.depositAmount)}</span>
                <span>Còn lại: {formatVND(order.remainingAmount)}</span>
              </div>
            </div>

            <div>
              <Label htmlFor="method" className="text-xs font-semibold text-slate-700">
                Phương thức thanh toán *
              </Label>
              <select
                id="method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as TxMethod)}
                className="w-full mt-1 h-9 px-3 rounded-lg border border-slate-200 bg-white text-slate-700 font-medium text-xs focus:ring-1 focus:ring-emerald-500"
              >
                <option value="BANK_TRANSFER">Chuyển khoản VietQR / Ngân hàng (BANK_TRANSFER)</option>
                <option value="CASH">Tiền mặt (CASH)</option>
              </select>
            </div>

            <div>
              <Label htmlFor="ref" className="text-xs font-semibold text-slate-700">
                Mã tham chiếu GD / Mã ngân hàng
              </Label>
              <Input
                id="ref"
                placeholder="VD: FT241013890212..."
                value={referenceCode}
                onChange={(e) => setReferenceCode(e.target.value)}
                className="mt-1 text-xs"
              />
            </div>

            <div>
              <Label htmlFor="note" className="text-xs font-semibold text-slate-700">
                Ghi chú
              </Label>
              <Textarea
                id="note"
                placeholder="Ghi chú đối soát nội bộ..."
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
                rows={2}
                className="mt-1 text-xs resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPaymentDialogOpen(false)}
              disabled={isPending}
              className="text-xs"
            >
              Hủy bỏ
            </Button>
            <Button
              size="sm"
              onClick={handleConfirmPayment}
              disabled={isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5"
            >
              {isPending ? 'Đang ghi nhận...' : 'Xác nhận đã nhận'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal 2: Bàn giao vận chuyển & Gán lô hàng (SHIPPING) */}
      <Dialog open={shippingDialogOpen} onOpenChange={setShippingDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900">
              Bàn giao vận chuyển & Gán lô hàng
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Chuyển đơn hàng sang <strong>Đang giao (SHIPPING)</strong>. Bạn có thể gán mã lô hàng thu hoạch để khách tra cứu truy xuất nguồn gốc QR.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs max-h-96 overflow-y-auto">
            {order.items.map((item) => {
              const itemBatches = availableBatches.filter((b) => b.productId === item.productId)
              return (
                <div key={item.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
                  <div className="font-bold text-slate-800">
                    {item.productName} ({item.packagingName})
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Khối lượng đặt: {(item.orderedGrams / 1000).toLocaleString('vi-VN')} kg
                  </div>

                  <div>
                    <Label className="text-[11px] font-semibold text-slate-700">
                      Gán Lô hàng thu hoạch (Tùy chọn):
                    </Label>
                    <select
                      value={batchAssignments[item.id] || ''}
                      onChange={(e) =>
                        setBatchAssignments((prev) => ({
                          ...prev,
                          [item.id]: e.target.value,
                        }))
                      }
                      className="w-full mt-1 h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-medium text-xs focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="">-- Chưa gán lô --</option>
                      {itemBatches.map((b) => (
                        <option key={b.id} value={b.id}>
                          Lô {b.code} (Thu hoạch {new Date(b.harvestDate).toLocaleDateString('vi-VN')} - {(b.quantityGrams / 1000).toLocaleString('vi-VN')} kg)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )
            })}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShippingDialogOpen(false)}
              disabled={isPending}
              className="text-xs"
            >
              Hủy bỏ
            </Button>
            <Button
              size="sm"
              onClick={handleTransitionToShipping}
              disabled={isPending}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs gap-1.5"
            >
              {isPending ? 'Đang chuyển...' : 'Bàn giao cho vận chuyển'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal 3: Nhập khối lượng thực tế & Quyết toán (DELIVERED) */}
      <Dialog open={settleDialogOpen} onOpenChange={setSettleDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900">
              Nhập khối lượng thực tế & Chốt quyết toán giao hàng
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Nhập số kg thực tế giao của từng dòng sản phẩm. Giữ nguyên đơn giá đã chốt ban đầu.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div className="overflow-x-auto max-h-64 border rounded-xl border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Sản phẩm</th>
                    <th className="py-2.5 px-3 text-right">Đặt (kg)</th>
                    <th className="py-2.5 px-3 text-right">Thực giao (kg) *</th>
                    <th className="py-2.5 px-3 text-right">Đơn giá / kg</th>
                    <th className="py-2.5 px-3 text-right">Thành tiền mới</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {order.items.map((item) => {
                    const kg = actualKgMap[item.id] ?? 0
                    const grams = Math.round(kg * 1000)
                    const maxAllowed = Math.floor(item.orderedGrams * 1.05)
                    const isOver = !item.isSample && grams > maxAllowed
                    const lineTotal = item.isSample
                      ? item.lineTotal
                      : Math.round((item.unitPricePerKg * grams) / 1000)

                    return (
                      <tr key={item.id} className={isOver ? 'bg-rose-50/50' : ''}>
                        <td className="py-2.5 px-3 font-medium text-slate-900">
                          {item.productName}
                          {item.isSample && (
                            <span className="block text-[10px] text-amber-700 font-bold">Gói mẫu (cố định)</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-600">
                          {(item.orderedGrams / 1000).toLocaleString('vi-VN')} kg
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <Input
                            type="number"
                            step="0.1"
                            min="0"
                            disabled={item.isSample}
                            value={actualKgMap[item.id] ?? ''}
                            onChange={(e) =>
                              setActualKgMap((prev) => ({
                                ...prev,
                                [item.id]: Number(e.target.value),
                              }))
                            }
                            className={`w-24 h-7 text-xs font-mono font-bold text-right ml-auto ${
                              isOver ? 'border-rose-500 bg-rose-50 text-rose-800' : ''
                            }`}
                          />
                          {isOver && (
                            <div className="text-[10px] text-rose-600 font-semibold mt-0.5">
                              Tối đa {(maxAllowed / 1000).toFixed(1)} kg (+5%)
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                          {formatVND(item.unitPricePerKg)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                          {formatVND(lineTotal)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {settlePreview.hasOver105 && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>
                  <strong>Cảnh báo:</strong> Có sản phẩm vượt quá 105% khối lượng đặt hàng. Hệ thống không cho phép giao vượt quá 5%.
                </span>
              </div>
            )}

            {/* Settle live calculation summary */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Tổng tiền sau chốt cân:</span>
                <span className="font-bold text-slate-900 font-mono text-sm">
                  {formatVND(settlePreview.total)}
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Đã thanh toán trước đó:</span>
                <span className="font-bold text-emerald-800 font-mono">
                  {formatVND(order.paidAmount)}
                </span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-200 font-bold">
                <span>
                  {settlePreview.balance > 0
                    ? 'Khách cần thanh toán thêm:'
                    : settlePreview.balance < 0
                    ? 'Hệ thống cần hoàn trả lại khách:'
                    : 'Đã thanh toán đúng:'}
                </span>
                <span
                  className={`font-mono text-sm ${
                    settlePreview.balance > 0
                      ? 'text-rose-700'
                      : settlePreview.balance < 0
                      ? 'text-purple-700'
                      : 'text-emerald-700'
                  }`}
                >
                  {formatVND(Math.abs(settlePreview.balance))}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettleDialogOpen(false)}
              disabled={isPending}
              className="text-xs"
            >
              Hủy bỏ
            </Button>
            <Button
              size="sm"
              onClick={handleSettleActualWeights}
              disabled={isPending || settlePreview.hasOver105}
              className="bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs gap-1.5"
            >
              {isPending ? 'Đang quyết toán...' : 'Xác nhận chốt cân & Giao hàng'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal 4: Hủy đơn hàng (Bên bán hủy) */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900">
              Hủy đơn hàng (Bên bán hủy)
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Chính sách hủy: Khi Bên bán / Admin hủy đơn, khách hàng sẽ được <strong>hoàn tiền 100%</strong> ({formatVND(order.paidAmount)}) số tiền đã thanh toán.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            <div>
              <Label className="text-xs font-semibold text-slate-700">Lý do hủy đơn *</Label>
              <select
                value={cancelReasonOption}
                onChange={(e) => setCancelReasonOption(e.target.value)}
                className="w-full mt-1 h-9 px-3 rounded-lg border border-slate-200 bg-white text-slate-700 font-medium text-xs focus:ring-1 focus:ring-rose-500"
              >
                {cancelReasons.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="customReason" className="text-xs font-semibold text-slate-700">
                Chi tiết lý do hủy đơn *
              </Label>
              <Textarea
                id="customReason"
                placeholder="Nhập thông tin chi tiết giải trình việc hủy đơn..."
                value={cancelReasonCustom}
                onChange={(e) => setCancelReasonCustom(e.target.value)}
                rows={3}
                className="mt-1 text-xs resize-none"
              />
            </div>
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
              {isPending ? 'Đang hủy...' : 'Xác nhận hủy & Hoàn 100%'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function OrderStatusBadge({ status }: { status: OrderStatus }) {
  switch (status) {
    case 'DRAFT':
      return <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200">Đơn nháp</Badge>
    case 'PENDING_CONFIRMATION':
      return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 font-semibold">Chờ xác nhận</Badge>
    case 'PREORDER_WAITING':
      return <Badge className="bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-100 font-semibold">Chờ vào vụ</Badge>
    case 'PROCESSING':
      return <Badge className="bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100 font-semibold">Đang xử lý</Badge>
    case 'SHIPPING':
      return <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200 hover:bg-indigo-100 font-semibold">Đang giao</Badge>
    case 'DELIVERED':
      return <Badge className="bg-teal-100 text-teal-800 border-teal-200 hover:bg-teal-100 font-semibold">Đã giao hàng</Badge>
    case 'COMPLAINT':
      return <Badge className="bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-100 font-semibold">Đang khiếu nại</Badge>
    case 'COMPLETED':
      return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100 font-semibold">Hoàn thành</Badge>
    case 'CANCELLED':
      return <Badge className="bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-50 font-semibold">Đã hủy</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function PaymentStatusBadge({
  status,
}: {
  status: 'AWAITING_PAYMENT' | 'DEPOSIT_PAID' | 'PAID' | 'REFUND_PENDING' | 'PARTIALLY_REFUNDED' | 'REFUNDED'
}) {
  switch (status) {
    case 'AWAITING_PAYMENT':
      return (
        <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-300">
          Chờ thanh toán
        </Badge>
      )
    case 'DEPOSIT_PAID':
      return (
        <Badge className="bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-50 font-semibold">
          Đã đặt cọc 30%
        </Badge>
      )
    case 'PAID':
      return (
        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100 font-semibold">
          Đã thanh toán đủ
        </Badge>
      )
    case 'REFUND_PENDING':
      return (
        <Badge className="bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-100 font-semibold">
          Chờ hoàn tiền
        </Badge>
      )
    case 'PARTIALLY_REFUNDED':
    case 'REFUNDED':
      return (
        <Badge className="bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-100 font-semibold">
          Đã hoàn tiền
        </Badge>
      )
  }
}
