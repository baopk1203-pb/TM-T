import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { getServerAuthSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { derivePaymentStatus } from '@/lib/domain/settlement'
import { formatVND } from '@/lib/money'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ArrowLeft,
  Package,
  MapPin,
  CreditCard,
  History,
  QrCode,
} from 'lucide-react'
import { OrderStatus } from '@prisma/client'

interface AddressData {
  recipient?: string
  phone?: string
  line?: string
  ward?: string
  district?: string
  province?: string
}

export const dynamic = 'force-dynamic'

export default async function CustomerOrderDetailPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const session = await getServerAuthSession()
  if (!session?.user) {
    redirect('/dang-nhap')
  }

  const { code } = await params

  const order = await db.order.findFirst({
    where: {
      OR: [{ code }, { id: code }],
    },
    include: {
      items: true,
      transactions: {
        orderBy: { createdAt: 'desc' },
      },
      events: {
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  if (!order) {
    notFound()
  }

  // Khách chỉ được xem đơn của mình (trừ Admin)
  if (order.userId !== session.user.id && session.user.role !== 'ADMIN') {
    notFound()
  }

  const payment = derivePaymentStatus(
    {
      total: order.total,
      finalTotal: order.finalTotal,
      status: order.status,
    },
    order.transactions
  )

  const address = order.addressSnapshot as unknown as AddressData
  const isUnpaid = payment.status === 'AWAITING_PAYMENT'

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
              <CustomerPaymentBadge status={payment.status} />
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Ngày đặt: {new Date(order.createdAt).toLocaleString('vi-VN')}
            </p>
          </div>
        </div>

        {isUnpaid && order.status === OrderStatus.PENDING_CONFIRMATION && (
          <Link href={`/thanh-toan/${order.code}`}>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 shadow-sm">
              <QrCode className="w-4 h-4" />
              Thanh toán VietQR ngay
            </Button>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left col (2 cols) */}
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
                {address?.recipient} - {address?.phone}
              </div>
              <div className="text-slate-600">
                {address?.line}, {address?.ward}, {address?.district}, {address?.province}
              </div>
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-slate-500">
                <span>
                  Ngày giao dự kiến:{' '}
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

          {/* Items */}
          <Card className="border-slate-200 shadow-sm overflow-hidden">
            <CardHeader className="pb-3 border-b border-slate-100">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-900">
                <Package className="w-4 h-4 text-emerald-600" />
                Sản phẩm trong đơn ({order.items.length})
              </CardTitle>
            </CardHeader>
            <div className="divide-y divide-slate-100 text-xs">
              {order.items.map((item) => (
                <div key={item.id} className="p-4 flex justify-between items-center gap-4">
                  <div>
                    <div className="font-bold text-slate-900">{item.productName}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Quy cách: {item.packagingName} • {item.quantity} kiện (
                      {(item.orderedGrams / 1000).toLocaleString('vi-VN')} kg)
                      {item.isSample && (
                        <span className="ml-2 bg-amber-100 text-amber-800 font-bold px-1.5 py-0.2 rounded text-[10px]">
                          Gói mẫu
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-bold text-slate-900">
                      {formatVND(item.lineTotal)}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {formatVND(item.unitPricePerKg)}/kg
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

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
                Thanh toán
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
                <span>Tổng cộng:</span>
                <span className="font-mono">{formatVND(order.total)}</span>
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
                  <span className="font-mono">{formatVND(payment.paidAmount)}</span>
                </div>
                <div className="flex justify-between text-slate-800 font-bold">
                  <span>Còn lại:</span>
                  <span className="font-mono text-rose-700">
                    {formatVND(payment.remainingAmount)}
                  </span>
                </div>
              </div>

              {isUnpaid && order.status === OrderStatus.PENDING_CONFIRMATION && (
                <div className="pt-2">
                  <Link href={`/thanh-toan/${order.code}`}>
                    <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5">
                      <QrCode className="w-4 h-4" /> Thanh toán VietQR
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function CustomerStatusBadge({ status }: { status: OrderStatus }) {
  switch (status) {
    case 'PENDING_CONFIRMATION':
      return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Chờ xác nhận</Badge>
    case 'PROCESSING':
      return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Đang xử lý</Badge>
    case 'SHIPPING':
      return <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200">Đang giao</Badge>
    case 'DELIVERED':
      return <Badge className="bg-teal-100 text-teal-800 border-teal-200">Đã giao hàng</Badge>
    case 'COMPLETED':
      return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Hoàn thành</Badge>
    case 'CANCELLED':
      return <Badge className="bg-rose-50 text-rose-600 border-rose-200">Đã hủy</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function CustomerPaymentBadge({
  status,
}: {
  status: 'AWAITING_PAYMENT' | 'DEPOSIT_PAID' | 'PAID' | 'REFUND_PENDING' | 'PARTIALLY_REFUNDED' | 'REFUNDED'
}) {
  switch (status) {
    case 'AWAITING_PAYMENT':
      return <Badge variant="outline">Chờ thanh toán</Badge>
    case 'DEPOSIT_PAID':
      return <Badge className="bg-amber-50 text-amber-800 border-amber-300">Đã cọc 30%</Badge>
    case 'PAID':
      return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">Đã thanh toán đủ</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}
