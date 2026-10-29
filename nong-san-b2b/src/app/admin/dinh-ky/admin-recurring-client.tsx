'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { OrderStatus, PaymentOption, TimeSlot } from '@prisma/client'
import { runRecurringGeneratorJob } from '@/actions/recurring'
import { expireOrdersJob } from '@/actions/admin-order'
import { formatVND, gramsToKgText } from '@/lib/money'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  CalendarDays,
  Play,
  Clock,
  Eye,
  Users,
  FileCheck2,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'

export interface AdminRecurringScheduleItem {
  id: string
  name: string
  weekdays: number[]
  timeSlot: TimeSlot
  paymentOption: PaymentOption
  isActive: boolean
  createdAt: string
  upcomingDates: string[]
  customer: {
    id: string
    name: string
    companyName: string | null
    phone: string
    groupName: string | null
  }
  items: Array<{
    id: string
    productName: string
    packagingName: string
    quantity: number
    totalGrams: number
  }>
  ordersCount: number
}

export interface AdminRecurringOrderItem {
  id: string
  code: string
  status: OrderStatus
  paymentOption: PaymentOption
  deliveryDate: string | null
  timeSlot: TimeSlot | null
  total: number
  depositAmount: number
  createdAt: string
  scheduleName: string | null
  customerName: string
  companyName: string | null
}

interface AdminRecurringClientProps {
  schedules: AdminRecurringScheduleItem[]
  orders: AdminRecurringOrderItem[]
}

const WEEKDAY_NAMES: Record<number, string> = {
  1: 'Thứ 2',
  2: 'Thứ 3',
  3: 'Thứ 4',
  4: 'Thứ 5',
  5: 'Thứ 6',
  6: 'Thứ 7',
  7: 'Chủ Nhật',
}

const TIME_SLOT_NAMES: Record<TimeSlot, string> = {
  [TimeSlot.MORNING]: 'Sáng (07:00 - 11:30)',
  [TimeSlot.AFTERNOON]: 'Chiều (13:30 - 17:30)',
  [TimeSlot.EVENING]: 'Tối (18:00 - 21:00)',
}

export function AdminRecurringClient({ schedules, orders }: AdminRecurringClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [lastJobSummary, setLastJobSummary] = useState<string | null>(null)

  const handleRunGenerator = () => {
    startTransition(async () => {
      try {
        const res = await runRecurringGeneratorJob()
        if (!res.success) {
          toast.error(res.error || 'Lỗi khi chạy sinh đơn định kỳ')
          return
        }

        const msg = `Đã quét ${res.processedSchedules} lịch đang bật: Tạo mới ${res.createdCount} đơn nháp, bỏ qua ${res.skippedDuplicates} kỳ giao đã có đơn.`
        setLastJobSummary(msg)
        toast.success(msg)
        router.refresh()
      } catch {
        toast.error('Lỗi hệ thống khi chạy sinh đơn định kỳ')
      }
    })
  }

  const handleRunExpire = () => {
    startTransition(async () => {
      try {
        const res = await expireOrdersJob()
        if (!res.success) {
          toast.error(res.error || 'Lỗi khi quét đơn quá hạn')
          return
        }

        toast.success(
          `Quét quá hạn hoàn tất: Đã hủy ${res.expiredCount} đơn (trong đó ${
            res.expiredDraftCount ?? 0
          } đơn nháp định kỳ quá hạn xác nhận).`
        )
        router.refresh()
      } catch {
        toast.error('Lỗi khi quét đơn quá hạn')
      }
    })
  }

  const activeCount = schedules.filter((s) => s.isActive).length
  const draftCount = orders.filter((o) => o.status === OrderStatus.DRAFT).length
  const confirmedCount = orders.filter(
    (o) => o.status !== OrderStatus.DRAFT && o.status !== OrderStatus.CANCELLED
  ).length

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 sm:p-7 rounded-3xl border border-slate-200/90 shadow-card">
        <div className="space-y-1">
          <h1 className="font-heading text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2.5">
            <CalendarDays className="w-6 h-6 text-emerald-600" />
            Quản Lý Lịch &amp; Đơn Định Kỳ
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Theo dõi lịch giao hàng cố định hàng tuần của đối tác B2B và kích hoạt trình sinh đơn
            nháp tự động (Idempotent).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRunExpire}
            disabled={isPending}
            className="text-xs font-semibold gap-1.5 rounded-full border-slate-200 h-9 px-4"
          >
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            Quét hủy đơn nháp quá hạn
          </Button>
          <Button
            size="sm"
            onClick={handleRunGenerator}
            disabled={isPending}
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold gap-1.5 shadow-btn-glow rounded-full h-9 px-5 hover:-translate-y-0.5 transition-all"
          >
            <Play className="w-3.5 h-3.5" />
            {isPending ? 'Đang xử lý...' : 'Chạy sinh đơn định kỳ'}
          </Button>
        </div>
      </div>

      {lastJobSummary && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-xs sm:text-sm text-emerald-900 flex items-center justify-between">
          <span>
            <strong>Kết quả chạy gần nhất:</strong> {lastJobSummary}
          </span>
          <button
            type="button"
            onClick={() => setLastJobSummary(null)}
            className="text-xs text-emerald-700 underline ml-4 font-semibold"
          >
            Ẩn
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 sm:gap-5">
        <Card className="rounded-3xl border-slate-200/90 shadow-card bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tổng lịch định kỳ</div>
              <div className="text-2xl font-black text-slate-900 mt-1 font-heading">{schedules.length}</div>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
              <Users className="w-6 h-6" />
            </div>
          </div>
        </Card>

        <Card className="rounded-3xl border-slate-200/90 shadow-card bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Lịch đang bật</div>
              <div className="text-2xl font-black text-emerald-700 mt-1 font-heading">{activeCount}</div>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center shrink-0">
              <RefreshCw className="w-6 h-6" />
            </div>
          </div>
        </Card>

        <Card className="rounded-3xl border-slate-200/90 shadow-card bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Đơn nháp chờ xác nhận</div>
              <div className="text-2xl font-black text-amber-600 mt-1 font-heading">{draftCount}</div>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center shrink-0">
              <FileCheck2 className="w-6 h-6" />
            </div>
          </div>
        </Card>

        <Card className="rounded-3xl border-slate-200/90 shadow-card bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Đơn định kỳ đã xác nhận</div>
              <div className="text-2xl font-black text-blue-600 mt-1 font-heading">{confirmedCount}</div>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
          </div>
        </Card>
      </div>

      {/* Bảng 1: Danh sách Lịch định kỳ */}
      <div className="space-y-3">
        <h2 className="text-base font-bold text-slate-900">
          1. Danh sách lịch giao định kỳ của đối tác ({schedules.length})
        </h2>

        {schedules.length === 0 ? (
          <Card className="border-slate-200">
            <CardContent className="p-8 text-center text-xs sm:text-sm text-slate-500">
              Chưa có khách hàng nào thiết lập lịch giao hàng định kỳ.
            </CardContent>
          </Card>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <tr>
                    <th className="px-4 py-3">Lịch định kỳ / Đối tác</th>
                    <th className="px-4 py-3">Chu kỳ & Khung giờ</th>
                    <th className="px-4 py-3">Sản phẩm định kỳ</th>
                    <th className="px-4 py-3">Kỳ giao sắp tới (7 ngày)</th>
                    <th className="px-4 py-3">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {schedules.map((sched) => (
                    <tr key={sched.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 align-top">
                        <div className="font-bold text-slate-900">{sched.name}</div>
                        <div className="text-xs text-slate-600 mt-0.5">
                          {sched.customer.companyName || sched.customer.name} ({sched.customer.phone})
                        </div>
                        {sched.customer.groupName && (
                          <Badge
                            variant="outline"
                            className="mt-1 text-[10px] bg-slate-50 text-slate-600"
                          >
                            {sched.customer.groupName}
                          </Badge>
                        )}
                      </td>

                      <td className="px-4 py-3 align-top">
                        <div className="font-semibold text-emerald-700">
                          {sched.weekdays
                            .slice()
                            .sort((a, b) => a - b)
                            .map((w) => WEEKDAY_NAMES[w] || `T${w}`)
                            .join(', ')}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {TIME_SLOT_NAMES[sched.timeSlot]}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          TT:{' '}
                          {sched.paymentOption === PaymentOption.DEPOSIT_30
                            ? 'Đặt cọc 30%'
                            : 'Thanh toán 100%'}
                        </div>
                      </td>

                      <td className="px-4 py-3 align-top">
                        <div className="space-y-1">
                          {sched.items.map((item) => (
                            <div key={item.id} className="text-xs text-slate-700">
                              <span className="font-medium text-slate-900">
                                {item.productName}
                              </span>{' '}
                              ({item.packagingName}) × <strong>{item.quantity}</strong> (
                              {gramsToKgText(item.totalGrams)})
                            </div>
                          ))}
                        </div>
                      </td>

                      <td className="px-4 py-3 align-top text-xs">
                        {sched.isActive && sched.upcomingDates.length > 0 ? (
                          <div className="space-y-1">
                            {sched.upcomingDates.map((d) => (
                              <Badge
                                key={d}
                                variant="outline"
                                className="mr-1 bg-emerald-50 text-emerald-800 border-emerald-200 text-[11px]"
                              >
                                {new Date(d).toLocaleDateString('vi-VN', { timeZone: 'UTC' })}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">Không có</span>
                        )}
                      </td>

                      <td className="px-4 py-3 align-top">
                        <Badge
                          variant="outline"
                          className={
                            sched.isActive
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 text-xs'
                              : 'bg-slate-100 text-slate-600 border-slate-300 text-xs'
                          }
                        >
                          {sched.isActive ? 'Đang bật' : 'Đã tắt'}
                        </Badge>
                        <div className="text-[11px] text-slate-500 mt-1">
                          Đã sinh: {sched.ordersCount} đơn
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Bảng 2: Danh sách Đơn định kỳ đã sinh */}
      <div className="space-y-3">
        <h2 className="text-base font-bold text-slate-900">
          2. Đơn hàng định kỳ đã sinh ({orders.length})
        </h2>

        {orders.length === 0 ? (
          <Card className="border-slate-200">
            <CardContent className="p-8 text-center text-xs sm:text-sm text-slate-500">
              Chưa có đơn hàng định kỳ nào được sinh. Hãy bấm nút{' '}
              <strong>&ldquo;Chạy sinh đơn định kỳ&rdquo;</strong> ở góc trên để tạo đơn nháp cho
              các lịch đang bật.
            </CardContent>
          </Card>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <tr>
                    <th className="px-4 py-3">Mã đơn</th>
                    <th className="px-4 py-3">Khách hàng & Lịch</th>
                    <th className="px-4 py-3">Ngày giao dự kiến</th>
                    <th className="px-4 py-3">Trạng thái</th>
                    <th className="px-4 py-3 text-right">Tổng tạm tính</th>
                    <th className="px-4 py-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orders.map((order) => (
                    <tr key={order.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-mono font-bold text-slate-900">
                        {order.code}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">
                          {order.companyName || order.customerName}
                        </div>
                        {order.scheduleName && (
                          <div className="text-xs text-slate-500">Lịch: {order.scheduleName}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">
                          {order.deliveryDate
                            ? new Date(order.deliveryDate).toLocaleDateString('vi-VN', {
                                timeZone: 'UTC',
                              })
                            : '—'}
                        </div>
                        {order.timeSlot && (
                          <div className="text-xs text-slate-500">
                            {TIME_SLOT_NAMES[order.timeSlot]}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <AdminRecurringOrderBadge status={order.status} />
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-700">
                        {formatVND(order.total)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/admin/don-hang/${order.code}`}>
                          <Button size="sm" variant="outline" className="h-8 text-xs gap-1">
                            <Eye className="w-3.5 h-3.5" /> Chi tiết
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AdminRecurringOrderBadge({ status }: { status: OrderStatus }) {
  switch (status) {
    case OrderStatus.DRAFT:
      return (
        <Badge className="bg-amber-100 text-amber-900 border-amber-300 text-xs">
          Đơn nháp chờ khách xác nhận
        </Badge>
      )
    case OrderStatus.PENDING_CONFIRMATION:
      return (
        <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-xs">
          Đã xác nhận (Chờ thanh toán)
        </Badge>
      )
    case OrderStatus.PROCESSING:
      return (
        <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200 text-xs">
          Đang xử lý
        </Badge>
      )
    case OrderStatus.COMPLETED:
      return (
        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs">
          Hoàn thành
        </Badge>
      )
    case OrderStatus.CANCELLED:
      return (
        <Badge className="bg-rose-50 text-rose-600 border-rose-200 text-xs">Đã hủy</Badge>
      )
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}
