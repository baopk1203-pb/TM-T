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
import { toast } from 'sonner'
import { OrderStatus, TxMethod, TxType, TxStatus } from '@prisma/client'

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
    productName: string
    packagingName: string
    isSample: boolean
    quantity: number
    orderedGrams: number
    unitPricePerKg: number
    lineTotal: number
    actualGrams: number | null
    finalLineTotal: number | null
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
  paidAmount: number
  remainingAmount: number
  paymentStatus: 'AWAITING_PAYMENT' | 'DEPOSIT_PAID' | 'PAID' | 'REFUND_PENDING' | 'PARTIALLY_REFUNDED' | 'REFUNDED'
}

interface OrderDetailClientProps {
  order: OrderDetailData
}

export function OrderDetailClient({ order }: OrderDetailClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)

  // Default payment amount to prefill
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
          setDialogOpen(false)
          router.refresh()
        } else {
          toast.error(res.error || 'Có lỗi xảy ra')
        }
      } catch {
        toast.error('Lỗi khi thực hiện xác nhận thanh toán')
      }
    })
  }

  const isDueOver = order.paymentDueAt && new Date(order.paymentDueAt) < new Date() && order.paidAmount === 0

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Back button & Action header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/admin/don-hang">
            <Button variant="ghost" size="sm" className="h-9 w-9 p-0 rounded-xl text-slate-500 hover:text-slate-900">
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

        {/* Quick action: Xác nhận đã nhận tiền */}
        <div className="flex items-center gap-2.5">
          <Button
            onClick={() => setDialogOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 shadow-sm"
          >
            <CheckCircle2 className="w-4 h-4" />
            Xác nhận đã nhận tiền
          </Button>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-base font-bold text-slate-900">
                  Xác nhận giao dịch thanh toán
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  Ghi nhận tiền thanh toán thực tế cho đơn hàng <strong className="font-mono">{order.code}</strong>.
                  Nếu nhận đủ tiền cọc ({formatVND(order.depositAmount)}), đơn sẽ tự động chuyển sang <strong>Đang xử lý</strong>.
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
                    placeholder="VD: FT241013890212 hoặc MBVCB.12938..."
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
                  onClick={() => setDialogOpen(false)}
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
        </div>
      </div>

      {/* Due Alert if overdue */}
      {isDueOver && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3 text-amber-900 text-xs">
          <Clock className="w-5 h-5 text-amber-600 shrink-0" />
          <div>
            <strong>Đơn hàng đã quá hạn thanh toán 24h:</strong> Hạn chót là{' '}
            {new Date(order.paymentDueAt!).toLocaleString('vi-VN')}. Khách hàng chưa hoàn tất thanh toán. Bạn có thể chờ hoặc chạy &quot;Quét đơn quá hạn&quot; để tự động hủy.
          </div>
        </div>
      )}

      {/* Grid: Left Column Details & Right Column Financials */}
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

          {/* Items Table Card */}
          <Card className="border-slate-200 shadow-sm overflow-hidden">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-900">
                <Package className="w-4 h-4 text-emerald-600" />
                Danh mục Sản phẩm Đặt hàng ({order.items.length} mặt hàng)
              </CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Sản phẩm & Quy cách</th>
                    <th className="py-3 px-4 text-center">Số kiện</th>
                    <th className="py-3 px-4 text-right">Khối lượng (kg)</th>
                    <th className="py-3 px-4 text-right">Đơn giá / kg</th>
                    <th className="py-3 px-4 text-right">Thành tiền</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {order.items.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/80">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{item.productName}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                          <span>{item.packagingName}</span>
                          {item.isSample && (
                            <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.2 rounded">
                              Gói mẫu
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-center font-medium text-slate-800">
                        {item.quantity} kiện
                      </td>
                      <td className="py-3.5 px-4 text-right font-medium text-slate-800">
                        {(item.orderedGrams / 1000).toLocaleString('vi-VN')} kg
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-slate-800">
                        {formatVND(item.unitPricePerKg)}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">
                        {formatVND(item.lineTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Transactions List */}
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-900">
                <CreditCard className="w-4 h-4 text-emerald-600" />
                Lịch sử Giao dịch Thanh toán ({order.transactions.length})
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
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          tx.status === 'DONE'
                            ? 'text-emerald-700 border-emerald-300 bg-emerald-50'
                            : 'text-amber-700 border-amber-300 bg-amber-50'
                        }`}
                      >
                        {tx.status === 'DONE' ? 'Thành công' : 'Chờ xử lý'}
                      </Badge>
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

        {/* Right Column (1 col): Financials & Summaries */}
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
                <span className="font-bold text-slate-900 text-sm">Tổng giá trị đơn:</span>
                <span className="font-black text-slate-900 text-lg font-mono">
                  {formatVND(order.total)}
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
                  <span>Đã thanh toán:</span>
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

              {/* Action button inside card */}
              <div className="pt-3">
                <Button
                  onClick={() => setDialogOpen(true)}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 shadow-sm"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Xác nhận đã nhận tiền
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
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
