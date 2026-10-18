import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Package,
  MapPin,
  Sparkles,
  ShoppingBag,
  ArrowRight,
  Truck,
  CreditCard,
  RefreshCw,
  AlertTriangle,
  Eye,
  FileCheck2,
} from 'lucide-react'
import { OrderStatus, OrderType, TimeSlot } from '@prisma/client'
import { formatVND } from '@/lib/money'
import { derivePaymentStatus } from '@/lib/domain/settlement'
import { isPreorderAwaitingCustomerDecision } from '@/lib/domain/preorder'
import {
  getDashboardKpiMetrics,
  getDraftConfirmationDeadline,
} from '@/lib/domain/dashboard'

export const dynamic = 'force-dynamic'

const orderTypeConfig: Record<string, { label: string; color: string }> = {
  [OrderType.STANDARD]: {
    label: 'Tiêu chuẩn',
    color: 'bg-blue-50 text-blue-800 border-blue-200',
  },
  [OrderType.SAMPLE]: {
    label: 'Mẫu thử',
    color: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  [OrderType.RECURRING]: {
    label: 'Định kỳ',
    color: 'bg-purple-50 text-purple-800 border-purple-200',
  },
  [OrderType.PREORDER]: {
    label: 'Đặt trước',
    color: 'bg-amber-50 text-amber-800 border-amber-200',
  },
}

const statusMap: Record<OrderStatus, { label: string; color: string }> = {
  [OrderStatus.DRAFT]: {
    label: 'Đơn nháp',
    color: 'bg-slate-100 text-slate-700 border-slate-300',
  },
  [OrderStatus.PREORDER_WAITING]: {
    label: 'Chờ vụ mùa',
    color: 'bg-purple-100 text-purple-800 border-purple-300',
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
    label: 'Đã giao',
    color: 'bg-teal-100 text-teal-800 border-teal-300',
  },
  [OrderStatus.COMPLAINT]: {
    label: 'Khiếu nại',
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
  PAID: { label: 'Đã thanh toán', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  REFUND_PENDING: { label: 'Chờ hoàn tiền', color: 'bg-purple-100 text-purple-800 border-purple-200' },
  PARTIALLY_REFUNDED: { label: 'Hoàn một phần', color: 'bg-slate-100 text-slate-800 border-slate-300' },
  REFUNDED: { label: 'Đã hoàn tiền', color: 'bg-slate-100 text-slate-800 border-slate-300' },
}

const timeSlotLabels: Record<TimeSlot, string> = {
  [TimeSlot.MORNING]: 'Sáng (08:00 - 12:00)',
  [TimeSlot.AFTERNOON]: 'Chiều (13:00 - 17:00)',
  [TimeSlot.EVENING]: 'Tối (18:00 - 21:00)',
}

export default async function CustomerDashboardPage() {
  const session = await getServerAuthSession()
  if (!session?.user) {
    redirect('/dang-nhap?callbackUrl=/tai-khoan')
  }

  // 1. Tải thông tin người dùng và quyền truy cập
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: {
      group: true,
      addresses: true,
    },
  })

  if (!user) {
    redirect('/dang-nhap')
  }

  // 2. Tải toàn bộ đơn hàng của riêng người dùng này (đảm bảo Server-Side Data Isolation)
  const orders = await db.order.findMany({
    where: {
      userId: session.user.id,
    },
    include: {
      items: {
        include: {
          packaging: {
            include: {
              product: true,
            },
          },
          batch: true,
        },
      },
      transactions: true,
      recurringSchedule: {
        select: { id: true, name: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  // 3. Tính toán các chỉ số KPI theo Domain Logic (Mutually Exclusive, không trùng lặp)
  const kpi = getDashboardKpiMetrics(orders)

  // 4. Lọc các khối hành động ưu tiên
  const preordersAwaitingDecision = orders.filter((order) =>
    isPreorderAwaitingCustomerDecision(order)
  )

  const draftRecurringOrders = orders.filter(
    (order) => order.status === OrderStatus.DRAFT
  )

  // 5. Danh sách đơn gần đây (tối đa 5 đơn)
  const recentOrders = orders.slice(0, 5)

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-emerald-700 via-teal-700 to-emerald-800 rounded-2xl p-6 text-white shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-block text-xs font-bold px-2.5 py-1 rounded-full bg-white/20 text-white backdrop-blur-xs">
              Đối tác B2B: {user.group?.name || 'Thành viên mới'}
            </span>
            {user.group?.discountPercent ? (
              <span className="inline-block text-xs font-bold px-2.5 py-1 rounded-full bg-amber-400 text-amber-950">
                Chiết khấu -{user.group.discountPercent}%
              </span>
            ) : null}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            Xin chào, {user.companyName || user.fullName}!
          </h1>
          <p className="text-emerald-100 text-xs sm:text-sm">
            Bảng điều khiển khách hàng sỉ — Theo dõi tiến độ đơn hàng, lịch giao định kỳ và quản lý đặt trước vụ mùa.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/san-pham">
            <Button className="bg-white text-emerald-800 hover:bg-emerald-50 font-bold gap-2 text-xs shadow-sm h-9">
              <ShoppingBag className="w-4 h-4 text-emerald-700" /> Đặt hàng vụ mùa
            </Button>
          </Link>
          <Link href="/tai-khoan/dinh-ky">
            <Button
              variant="outline"
              className="bg-emerald-800/40 border-white/30 text-white hover:bg-emerald-800/60 font-semibold gap-1.5 text-xs h-9"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Lịch định kỳ
            </Button>
          </Link>
        </div>
      </div>

      {/* A. BỐN THẺ THỐNG KÊ (KPI CARDS - MUTUALLY EXCLUSIVE) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Đơn đang xử lý */}
        <Link href="/tai-khoan/don-hang" className="block focus:outline-hidden group">
          <Card className="border-slate-200 group-hover:border-blue-400 group-hover:shadow-md transition-all h-full">
            <CardContent className="p-5 flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-xs text-slate-500 font-medium">Đơn đang xử lý</span>
                <div className="text-2xl font-black text-slate-900 group-hover:text-blue-600 transition-colors">
                  {kpi.processingCount}
                </div>
                <p className="text-[11px] text-slate-500">
                  Xử lý, giao hàng hoặc khiếu nại
                </p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <Truck className="w-6 h-6" />
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* KPI 2: Đơn chờ thanh toán */}
        <Link href="/tai-khoan/don-hang" className="block focus:outline-hidden group">
          <Card className="border-slate-200 group-hover:border-amber-400 group-hover:shadow-md transition-all h-full">
            <CardContent className="p-5 flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-xs text-slate-500 font-medium">Chờ thanh toán</span>
                <div className="text-2xl font-black text-slate-900 group-hover:text-amber-600 transition-colors">
                  {kpi.pendingPaymentCount}
                </div>
                <p className="text-[11px] text-slate-500">
                  Chờ xác nhận chuyển khoản / cọc
                </p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                <CreditCard className="w-6 h-6" />
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* KPI 3: Đơn nháp định kỳ */}
        <Link href="/tai-khoan/dinh-ky" className="block focus:outline-hidden group">
          <Card className="border-slate-200 group-hover:border-purple-400 group-hover:shadow-md transition-all h-full">
            <CardContent className="p-5 flex items-center justify-between">
              <div className="space-y-1">
                <span className="text-xs text-slate-500 font-medium">Đơn nháp định kỳ</span>
                <div className="text-2xl font-black text-slate-900 group-hover:text-purple-600 transition-colors">
                  {kpi.draftRecurringCount}
                </div>
                <p className="text-[11px] text-slate-500">
                  Lịch giao tuần chờ bạn xác nhận
                </p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                <RefreshCw className="w-6 h-6" />
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* KPI 4: Đơn Pre-order */}
        <Link href="/tai-khoan/don-hang" className="block focus:outline-hidden group">
          <Card
            className={`transition-all h-full ${
              kpi.preorderAwaitingDecisionCount > 0
                ? 'border-amber-400 bg-amber-50/20 shadow-xs group-hover:shadow-md'
                : 'border-slate-200 group-hover:border-emerald-400 group-hover:shadow-md'
            }`}
          >
            <CardContent className="p-5 flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-500 font-medium">Đơn Pre-order</span>
                  {kpi.preorderAwaitingDecisionCount > 0 && (
                    <Badge className="bg-amber-500 hover:bg-amber-600 text-white text-[10px] px-1.5 py-0">
                      Cần xử lý
                    </Badge>
                  )}
                </div>
                <div className="text-2xl font-black text-slate-900 group-hover:text-emerald-700 transition-colors">
                  {kpi.preorderCount}
                </div>
                <p className="text-[11px] text-slate-500">
                  {kpi.preorderAwaitingDecisionCount > 0 ? (
                    <span className="text-amber-700 font-bold">
                      {kpi.preorderAwaitingDecisionCount} đơn cần bạn quyết định
                    </span>
                  ) : (
                    `${kpi.preorderWaitingHarvestCount} đơn chờ vụ thu hoạch`
                  )}
                </p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                <Sparkles className="w-6 h-6" />
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* B. KHỐI "CẦN BẠN QUYẾT ĐỊNH" (Ưu tiên cao nhất khi có đơn Pre-order ngoài biên độ) */}
      {preordersAwaitingDecision.length > 0 && (
        <Card className="border-amber-300 bg-gradient-to-br from-amber-50/80 via-white to-amber-50/30 shadow-xs">
          <CardHeader className="pb-3 border-b border-amber-200/60">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4 text-amber-700" />
                </div>
                <div>
                  <CardTitle className="text-base font-bold text-amber-950 flex items-center gap-2">
                    Cần Bạn Quyết Định
                    <Badge className="bg-amber-500 text-white font-bold text-xs">
                      {preordersAwaitingDecision.length} đơn
                    </Badge>
                  </CardTitle>
                  <p className="text-xs text-amber-800 mt-0.5">
                    Nhà vườn đã chốt giá thu hoạch thực tế ngoài biên độ cam kết. Bạn có toàn quyền Chấp nhận hoặc Hủy nhận lại 100% cọc.
                  </p>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-5 space-y-3">
            {preordersAwaitingDecision.map((order) => {
              const firstItem = order.items[0]
              const expectedPrice =
                firstItem?.packaging?.product?.preorderPricePerKg ?? firstItem?.unitPricePerKg ?? 0
              const finalPrice = order.preorderFinalPricePerKg ?? 0
              const diffPercent =
                expectedPrice > 0
                  ? Math.round(Math.abs((finalPrice - expectedPrice) / expectedPrice) * 1000) / 10
                  : 0
              const isHigher = finalPrice >= expectedPrice

              return (
                <div
                  key={order.id}
                  className="bg-white rounded-xl border border-amber-200 p-4 shadow-2xs hover:shadow-sm transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold text-slate-900 text-sm">
                        {order.code}
                      </span>
                      <Badge className="bg-purple-100 text-purple-900 border-purple-200 text-[11px]">
                        Đặt trước vụ mùa
                      </Badge>
                      <Badge className="bg-amber-100 text-amber-900 border-amber-300 text-[11px] font-semibold">
                        Chờ bạn phản hồi
                      </Badge>
                    </div>

                    <div className="text-xs text-slate-700 font-medium">
                      Sản phẩm:{' '}
                      <strong className="text-slate-900">
                        {firstItem?.productName || 'Nông sản theo mùa'}
                      </strong>{' '}
                      <span className="text-slate-500">({firstItem?.packagingName})</span>
                    </div>

                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
                      <div>
                        <span className="text-slate-500">Giá đặt trước:</span>{' '}
                        <span className="font-semibold text-slate-700">
                          {formatVND(expectedPrice)}/kg
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500">Giá chốt thực tế:</span>{' '}
                        <strong className="text-purple-900 font-bold">
                          {formatVND(finalPrice)}/kg
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-500">Chênh lệch:</span>{' '}
                        <strong className="text-amber-700 font-bold">
                          {isHigher ? `+${diffPercent}%` : `-${diffPercent}%`} (Vượt biên độ)
                        </strong>
                      </div>
                      {order.deliveryDate && (
                        <div>
                          <span className="text-slate-500">Dự kiến giao:</span>{' '}
                          <span className="font-medium text-slate-700">
                            {new Date(order.deliveryDate).toLocaleDateString('vi-VN')}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex sm:shrink-0 items-center gap-2">
                    <Link href={`/tai-khoan/don-hang/${order.code}`}>
                      <Button
                        size="sm"
                        className="w-full sm:w-auto bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs gap-1.5 shadow-sm"
                      >
                        Xem chi tiết & Quyết định <ArrowRight className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* C. KHỐI "ĐƠN NHÁP ĐỊNH KỲ CHỜ XÁC NHẬN" */}
      {draftRecurringOrders.length > 0 && (
        <Card className="border-purple-200 bg-gradient-to-br from-purple-50/40 via-white to-purple-50/20 shadow-xs">
          <CardHeader className="pb-3 border-b border-purple-100">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-800 flex items-center justify-center shrink-0">
                  <FileCheck2 className="w-4 h-4 text-purple-700" />
                </div>
                <div>
                  <CardTitle className="text-base font-bold text-purple-950 flex items-center gap-2">
                    Đơn Nháp Định Kỳ Chờ Xác Nhận
                    <Badge className="bg-purple-600 text-white font-bold text-xs">
                      {draftRecurringOrders.length} đơn
                    </Badge>
                  </CardTitle>
                  <p className="text-xs text-purple-800 mt-0.5">
                    Hệ thống tự động tạo đơn nháp trước kỳ giao hàng. Vui lòng kiểm tra và xác nhận thanh toán để kịp xuất kho.
                  </p>
                </div>
              </div>
              <Link href="/tai-khoan/dinh-ky">
                <Button variant="ghost" size="sm" className="text-xs text-purple-700 hover:text-purple-900 gap-1">
                  Quản lý tất cả lịch định kỳ <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-5 space-y-3">
            {draftRecurringOrders.map((order) => {
              const totalAmount = order.finalTotal ?? order.total
              const deadline = getDraftConfirmationDeadline(
                order.deliveryDate,
                order.paymentDueAt,
                1
              )

              return (
                <div
                  key={order.id}
                  className="bg-white rounded-xl border border-purple-200/80 p-4 shadow-2xs hover:shadow-sm transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold text-slate-900 text-sm">
                        {order.code}
                      </span>
                      <Badge className="bg-slate-100 text-slate-800 border-slate-300 text-[11px] font-semibold">
                        Đơn nháp (DRAFT)
                      </Badge>
                      {order.recurringSchedule?.name && (
                        <Badge variant="outline" className="text-purple-800 border-purple-200 text-[11px]">
                          Lịch: {order.recurringSchedule.name}
                        </Badge>
                      )}
                    </div>

                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-slate-700">
                      <div>
                        <span className="text-slate-500">Ngày giao dự kiến:</span>{' '}
                        <strong className="text-slate-900">
                          {order.deliveryDate
                            ? new Date(order.deliveryDate).toLocaleDateString('vi-VN')
                            : 'Chưa xếp'}
                        </strong>{' '}
                        {order.timeSlot && (
                          <span className="text-slate-500">
                            ({timeSlotLabels[order.timeSlot] || order.timeSlot})
                          </span>
                        )}
                      </div>

                      <div>
                        <span className="text-slate-500">Tổng tiền dự kiến:</span>{' '}
                        <strong className="text-emerald-700 font-bold">
                          {formatVND(totalAmount)}
                        </strong>
                      </div>

                      {deadline && (
                        <div>
                          <span className="text-slate-500">Hạn xác nhận:</span>{' '}
                          <span className="font-semibold text-rose-700">
                            {deadline.toLocaleDateString('vi-VN')} 17:00
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex sm:shrink-0 items-center gap-2">
                    <Link href={`/tai-khoan/don-hang/${order.code}`}>
                      <Button
                        size="sm"
                        className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 shadow-sm"
                      >
                        Kiểm tra & Xác nhận <ArrowRight className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* D. ĐƠN HÀNG GẦN ĐÂY */}
      <Card className="border-slate-200">
        <CardHeader className="pb-3 border-b border-slate-100 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Package className="w-5 h-5 text-emerald-600" /> Đơn Hàng Gần Đây
          </CardTitle>
          <Link href="/tai-khoan/don-hang">
            <Button variant="ghost" size="sm" className="text-xs text-slate-600 hover:text-emerald-700 gap-1">
              Xem tất cả ({orders.length}) <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {recentOrders.length === 0 ? (
            <div className="text-center py-10 px-4 text-slate-500 space-y-3">
              <Package className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-sm">Bạn chưa có đơn hàng nào.</p>
              <Link href="/san-pham">
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs">
                  Khám phá danh mục nông sản
                </Button>
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentOrders.map((order) => {
                const typeConfig =
                  orderTypeConfig[order.type] || {
                    label: order.type,
                    color: 'bg-slate-100 text-slate-700',
                  }

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
                  <div
                    key={order.id}
                    className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
                  >
                    <div className="space-y-1.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-bold text-slate-900 text-sm">
                          {order.code}
                        </span>
                        <Badge variant="outline" className={`text-[11px] px-2 py-0.5 font-medium ${typeConfig.color}`}>
                          {typeConfig.label}
                        </Badge>
                        <Badge variant="outline" className={`text-[11px] px-2 py-0.5 font-semibold ${statusConfig.color}`}>
                          {statusConfig.label}
                        </Badge>
                        <Badge className={`text-[11px] px-2 py-0.5 ${paymentConfig.color}`}>
                          {paymentConfig.label}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span>
                          Ngày đặt: {new Date(order.createdAt).toLocaleDateString('vi-VN')}
                        </span>
                        <span>
                          Sản phẩm: {order.items.length} mặt hàng
                        </span>
                        <span>
                          Tổng tiền: <strong className="text-slate-900 font-semibold">{formatVND(totalDisplay)}</strong>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Link href={`/tai-khoan/don-hang/${order.code}`}>
                        <Button variant="outline" size="sm" className="text-xs gap-1.5 h-8">
                          <Eye className="w-3.5 h-3.5" /> Chi tiết
                        </Button>
                      </Link>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Thông tin tài khoản & Sổ địa chỉ rút gọn */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-600" /> Thông tin đối tác B2B
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Doanh nghiệp / Cửa hàng:</span>
              <strong className="text-slate-900">{user.companyName || 'Cá nhân'}</strong>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Mã số thuế:</span>
              <span className="text-slate-700">{user.taxCode || 'Chưa cập nhật'}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Hạng khách hàng:</span>
              <span className="font-semibold text-emerald-700">
                {user.group?.name || 'Cửa hàng nhỏ'} (-{user.group?.discountPercent || 0}%)
              </span>
            </div>
            <div className="pt-2">
              <Link href="/tai-khoan/ho-so">
                <Button variant="outline" size="sm" className="w-full text-xs h-8">
                  Cập nhật thông tin đối tác
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-emerald-600" /> Sổ địa chỉ kho nhận hàng
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {user.addresses.length === 0 ? (
              <p className="text-slate-500 py-2">Chưa lưu địa chỉ nhận hàng nào.</p>
            ) : (
              user.addresses.slice(0, 2).map((addr) => (
                <div key={addr.id} className="p-2.5 rounded-lg bg-slate-50 space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">{addr.label}</span>
                    {addr.isDefault && (
                      <Badge className="bg-emerald-100 text-emerald-800 text-[10px] px-1.5 py-0">
                        Mặc định
                      </Badge>
                    )}
                  </div>
                  <div className="text-slate-600 truncate">
                    {addr.recipient} ({addr.phone}) - {addr.line}, {addr.district}, {addr.province}
                  </div>
                </div>
              ))
            )}
            <div className="pt-2">
              <Link href="/tai-khoan/dia-chi">
                <Button variant="outline" size="sm" className="w-full text-xs h-8">
                  Quản lý sổ địa chỉ ({user.addresses.length})
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
