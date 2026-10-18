import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { OrderStatus } from '@prisma/client'
import { derivePaymentStatus } from '@/lib/domain/settlement'
import { Package, Calendar, ArrowRight, ShoppingBag, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatVND } from '@/lib/money'

export const dynamic = 'force-dynamic'

const statusMap: Record<OrderStatus, { label: string; color: string }> = {
  [OrderStatus.DRAFT]: {
    label: 'Đơn nháp',
    color: 'bg-slate-100 text-slate-700 border-slate-300',
  },
  [OrderStatus.PREORDER_WAITING]: {
    label: 'Chờ vụ mùa',
    color: 'bg-purple-50 text-purple-800 border-purple-300',
  },
  [OrderStatus.PENDING_CONFIRMATION]: {
    label: 'Chờ xác nhận',
    color: 'bg-amber-100 text-amber-800 border-amber-300',
  },
  [OrderStatus.PROCESSING]: {
    label: 'Đang xử lý',
    color: 'bg-blue-100 text-blue-800 border-blue-300',
  },
  [OrderStatus.SHIPPING]: {
    label: 'Đang giao',
    color: 'bg-indigo-100 text-indigo-800 border-indigo-300',
  },
  [OrderStatus.DELIVERED]: {
    label: 'Đã giao hàng',
    color: 'bg-teal-100 text-teal-800 border-teal-300',
  },
  [OrderStatus.COMPLAINT]: {
    label: 'Đang khiếu nại',
    color: 'bg-rose-100 text-rose-800 border-rose-300',
  },
  [OrderStatus.COMPLETED]: {
    label: 'Hoàn tất',
    color: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  },
  [OrderStatus.CANCELLED]: {
    label: 'Đã hủy',
    color: 'bg-rose-50 text-rose-600 border-rose-200',
  },
}

const paymentStatusLabels: Record<string, { label: string; color: string }> = {
  AWAITING_PAYMENT: { label: 'Chờ thanh toán', color: 'bg-amber-50 text-amber-800 border-amber-300' },
  DEPOSIT_PAID: { label: 'Đã cọc 30%', color: 'bg-amber-100 text-amber-800 border-amber-300' },
  PAID: { label: 'Đã thanh toán đủ', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  REFUND_PENDING: { label: 'Chờ hoàn tiền', color: 'bg-purple-100 text-purple-800 border-purple-200' },
  PARTIALLY_REFUNDED: { label: 'Đã hoàn một phần', color: 'bg-slate-100 text-slate-800 border-slate-300' },
  REFUNDED: { label: 'Đã hoàn tiền', color: 'bg-slate-100 text-slate-800 border-slate-300' },
}

export default async function CustomerOrdersPage() {
  const session = await getServerAuthSession()
  if (!session?.user) {
    redirect('/dang-nhap?callbackUrl=/tai-khoan/don-hang')
  }

  const orders = await db.order.findMany({
    where: {
      userId: session.user.id,
    },
    include: {
      items: true,
      transactions: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Package className="w-6 h-6 text-emerald-600" /> Đơn Hàng Của Tôi
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Theo dõi tiến trình xử lý, thanh toán, ngày giao và chi tiết các đơn thu mua sỉ.
          </p>
        </div>
        <Link href="/san-pham">
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5">
            <ShoppingBag className="w-4 h-4" /> Đặt thêm hàng vụ mùa
          </Button>
        </Link>
      </div>

      {orders.length === 0 ? (
        <Card className="border-dashed border-2 border-slate-200 py-16 text-center">
          <CardContent className="space-y-4">
            <div className="w-16 h-16 rounded-3xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <Package className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">
                Bạn chưa có đơn hàng nào
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                Các đơn hàng sỉ hoặc đơn mẫu thử bạn đã đặt sẽ hiển thị đầy đủ tại đây cùng mã vận đơn và chứng từ thanh toán.
              </p>
            </div>
            <Link href="/san-pham">
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
                Khám phá sản phẩm vụ mùa <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => {
            const statusConfig =
              statusMap[order.status] || {
                label: order.status,
                color: 'bg-slate-100 text-slate-700',
              }

            const payment = derivePaymentStatus(
              {
                total: order.total,
                finalTotal: order.finalTotal,
                status: order.status,
              },
              order.transactions
            )

            const paymentConfig =
              paymentStatusLabels[payment.status] || {
                label: payment.status,
                color: 'bg-slate-100 text-slate-700',
              }

            const totalDisplay = order.finalTotal ?? order.total

            return (
              <Card
                key={order.id}
                className="border-slate-200 hover:border-emerald-300 transition-all shadow-2xs hover:shadow-sm"
              >
                <CardContent className="p-5 sm:p-6 space-y-4">
                  {/* Header đơn */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-bold text-base text-slate-900">
                        {order.code}
                      </span>
                      <Badge variant="outline" className={`text-xs px-2.5 py-0.5 font-semibold ${statusConfig.color}`}>
                        {statusConfig.label}
                      </Badge>
                      <Badge className={`text-[11px] px-2 py-0.5 ${paymentConfig.color}`}>
                        {paymentConfig.label}
                      </Badge>
                    </div>

                    <div className="text-xs text-slate-500 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      <span>{new Date(order.createdAt).toLocaleDateString('vi-VN')}</span>
                    </div>
                  </div>

                  {/* Danh sách tóm tắt mặt hàng */}
                  <div className="space-y-2 text-xs sm:text-sm">
                    {order.items.slice(0, 3).map((item) => (
                      <div key={item.id} className="flex justify-between items-center text-slate-700">
                        <div className="truncate pr-4">
                          <span className="font-semibold text-slate-900">{item.productName}</span>
                          <span className="text-slate-500 ml-1.5">({item.packagingName})</span>
                          {item.isSample && (
                            <Badge className="bg-amber-100 text-amber-800 text-[10px] ml-1.5">Mẫu thử</Badge>
                          )}
                        </div>
                        <div className="shrink-0 text-slate-600 font-medium">
                          {item.quantity} phần • {formatVND(item.lineTotal)}
                        </div>
                      </div>
                    ))}

                    {order.items.length > 3 && (
                      <div className="text-xs text-slate-400 italic">
                        và {order.items.length - 3} mặt hàng khác...
                      </div>
                    )}
                  </div>

                  {/* Footer đơn */}
                  <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-100">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs text-slate-500">
                        {order.finalTotal ? 'Tổng thanh toán thực tế:' : 'Tổng giá trị đơn:'}
                      </span>
                      <span className="text-base sm:text-lg font-extrabold text-emerald-700">
                        {formatVND(totalDisplay)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {order.status === OrderStatus.DRAFT && (
                        <Link href={`/tai-khoan/don-hang/${order.code}`}>
                          <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white text-xs gap-1">
                            Xác nhận đơn nháp <ArrowRight className="w-3.5 h-3.5" />
                          </Button>
                        </Link>
                      )}
                      {order.status === OrderStatus.COMPLETED && order.items.some((i) => !i.isSample) && (
                        <Link href={`/tai-khoan/dinh-ky?fromOrder=${order.code}`}>
                          <Button size="sm" variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 text-xs gap-1">
                            Đặt định kỳ từ đơn này
                          </Button>
                        </Link>
                      )}
                      {payment.status === 'AWAITING_PAYMENT' && order.status === OrderStatus.PENDING_CONFIRMATION && (
                        <Link href={`/thanh-toan/${order.code}`}>
                          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1">
                            Thanh toán VietQR <ArrowRight className="w-3.5 h-3.5" />
                          </Button>
                        </Link>
                      )}
                      <Link href={`/tai-khoan/don-hang/${order.code}`}>
                        <Button size="sm" variant="outline" className="text-xs gap-1.5">
                          <Eye className="w-3.5 h-3.5" /> Xem chi tiết
                        </Button>
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
