'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Search,
  Clock,
  Eye,
  ShieldAlert,
  ShoppingCart,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { formatVND } from '@/lib/money'
import { formatVietnamDate } from '@/lib/utils'
import { expireOrdersJob } from '@/actions/admin-order'
import { toast } from 'sonner'
import { OrderStatus } from '@prisma/client'

export interface OrderItemSummary {
  id: string
  productName: string
  packagingName: string
  quantity: number
  orderedGrams: number
  unitPricePerKg: number
  lineTotal: number
}

export interface AdminOrderListItem {
  id: string
  code: string
  createdAt: string
  paymentDueAt: string | null
  deliveryDate: string | null
  timeSlot: string | null
  status: OrderStatus
  paymentOption: string
  subtotal: number
  shippingFee: number
  total: number
  depositAmount: number
  finalTotal: number | null
  customerNote: string | null
  user: {
    id: string
    fullName: string
    companyName: string | null
    phone: string
    email: string
    groupName: string | null
  }
  itemCount: number
  totalGrams: number
  paidAmount: number
  paymentStatus: 'AWAITING_PAYMENT' | 'DEPOSIT_PAID' | 'PAID' | 'REFUND_PENDING' | 'PARTIALLY_REFUNDED' | 'REFUNDED'
}

interface OrderListClientProps {
  initialOrders: AdminOrderListItem[]
}

const statusTabs = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'DRAFT', label: 'Đơn nháp' },
  { value: 'PENDING_CONFIRMATION', label: 'Chờ xác nhận' },
  { value: 'PROCESSING', label: 'Đang xử lý' },
  { value: 'SHIPPING', label: 'Đang giao' },
  { value: 'DELIVERED', label: 'Đã giao' },
  { value: 'COMPLETED', label: 'Hoàn thành' },
  { value: 'CANCELLED', label: 'Đã hủy' },
]

export function OrderListClient({ initialOrders }: OrderListClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [paymentFilter, setPaymentFilter] = useState('ALL')

  const handleExpireJob = () => {
    startTransition(async () => {
      try {
        const res = await expireOrdersJob()
        if (res.success) {
          toast.success(
            `Quét thành công: Đã xử lý ${res.expiredCount} đơn quá hạn (thanh toán / đơn nháp định kỳ)!`
          )
          router.refresh()
        } else {
          toast.error('Có lỗi khi quét đơn quá hạn')
        }
      } catch {
        toast.error('Lỗi khi thực hiện quét đơn quá hạn')
      }
    })
  }

  const filteredOrders = initialOrders.filter((order) => {
    // Search
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim()
      const matchCode = order.code.toLowerCase().includes(term)
      const matchName = order.user.fullName.toLowerCase().includes(term)
      const matchCompany = (order.user.companyName || '').toLowerCase().includes(term)
      const matchPhone = order.user.phone.toLowerCase().includes(term)
      if (!matchCode && !matchName && !matchCompany && !matchPhone) return false
    }

    // Status filter
    if (statusFilter !== 'ALL' && order.status !== statusFilter) {
      return false
    }

    // Payment filter
    if (paymentFilter !== 'ALL' && order.paymentStatus !== paymentFilter) {
      return false
    }

    return true
  })

  // Đếm đơn chờ xác nhận
  const pendingCount = initialOrders.filter(
    (o) => o.status === OrderStatus.PENDING_CONFIRMATION
  ).length

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header & Main Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 sm:p-7 rounded-3xl border border-slate-200/90 shadow-card">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="font-heading text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
              <ShoppingCart className="w-6 h-6 text-emerald-600" />
              Quản Lý Đơn Hàng &amp; Doanh Thu
            </h1>
            {pendingCount > 0 && (
              <Badge className="bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-full px-2.5 py-0.5 shadow-2xs">
                {pendingCount} chờ xác nhận
              </Badge>
            )}
          </div>
          <p className="text-xs sm:text-sm text-slate-500">
            Theo dõi đơn hàng B2B, xác nhận tiền VietQR và kiểm soát vòng đời đơn hàng toàn diện.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExpireJob}
            disabled={isPending}
            className="text-xs font-semibold gap-1.5 border-slate-200 hover:bg-slate-50 text-slate-700 rounded-full h-10 px-4 shadow-2xs"
          >
            <Clock className={`w-3.5 h-3.5 text-amber-600 ${isPending ? 'animate-spin' : ''}`} />
            {isPending ? 'Đang quét...' : 'Quét đơn quá hạn thanh toán'}
          </Button>
        </div>
      </div>

      {/* Multi-tier Filter Strip & Search */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200/90 shadow-card space-y-4">
        {/* Status Tabs (Stitch Pills) */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
          {statusTabs.map((tab) => {
            const active = statusFilter === tab.value
            const count =
              tab.value === 'ALL'
                ? initialOrders.length
                : initialOrders.filter((o) => o.status === tab.value).length

            return (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={`px-4 py-2 rounded-full font-medium whitespace-nowrap transition-all flex items-center gap-2 ${
                  active
                    ? 'bg-emerald-600 text-white font-bold shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200/80 text-slate-700'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                    active ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Search bar & Payment Filter */}
        <div className="flex flex-col sm:flex-row gap-3 pt-1 border-t border-slate-100">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Tìm theo mã đơn (DH-...), tên khách, công ty hoặc SĐT..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 text-xs h-10 rounded-2xl border-slate-200/90 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value)}
              className="text-xs h-10 px-4 rounded-2xl border border-slate-200/90 bg-white text-slate-700 font-medium focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 cursor-pointer shadow-2xs"
            >
              <option value="ALL">Tất cả thanh toán</option>
              <option value="AWAITING_PAYMENT">Chờ thanh toán (0đ)</option>
              <option value="DEPOSIT_PAID">Đã đặt cọc</option>
              <option value="PAID">Đã thanh toán đủ</option>
              <option value="REFUND_PENDING">Đang chờ hoàn tiền</option>
              <option value="REFUNDED">Đã hoàn tiền</option>
            </select>
          </div>
        </div>
      </div>

      {/* Orders List Table (Stitch Rounded Card) */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-card overflow-hidden">
        {filteredOrders.length === 0 ? (
          <div className="text-center py-16 px-4 space-y-2">
            <ShieldAlert className="w-10 h-10 text-slate-300 mx-auto" />
            <p className="text-sm font-bold text-slate-800">Không tìm thấy đơn hàng nào</p>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Hãy thử thay đổi từ khóa tìm kiếm hoặc bấm chọn tab trạng thái khác.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 border-b border-slate-200/90 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3.5 px-5">Mã đơn hàng</th>
                  <th className="py-3.5 px-4">Khách hàng</th>
                  <th className="py-3.5 px-4">Ngày giao / Slot</th>
                  <th className="py-3.5 px-4 text-right">Tổng tiền &amp; Cọc</th>
                  <th className="py-3.5 px-4 text-center">Trạng thái đơn</th>
                  <th className="py-3.5 px-4 text-center">Thanh toán</th>
                  <th className="py-3.5 px-5 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOrders.map((order) => {
                  return (
                    <tr key={order.id} className="hover:bg-emerald-50/20 transition-colors">
                      {/* Mã đơn */}
                      <td className="py-4 px-5 font-mono font-bold text-slate-900">
                        <Link
                          href={`/admin/don-hang/${order.code}`}
                          className="text-emerald-800 hover:text-emerald-600 hover:underline"
                        >
                          {order.code}
                        </Link>
                        <div className="text-[11px] text-slate-400 font-sans font-normal mt-0.5">
                          {formatVietnamDate(order.createdAt, {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </td>

                      {/* Khách hàng */}
                      <td className="py-4 px-4">
                        <div className="font-bold text-slate-900">
                          {order.user.companyName || order.user.fullName}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {order.user.fullName} • {order.user.phone}
                        </div>
                        {order.user.groupName && (
                          <span className="inline-block mt-1 text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
                            {order.user.groupName}
                          </span>
                        )}
                      </td>

                      {/* Ngày giao */}
                      <td className="py-4 px-4">
                        {order.deliveryDate ? (
                          <>
                            <div className="font-semibold text-slate-800">
                              {formatVietnamDate(order.deliveryDate)}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {order.timeSlot === 'MORNING'
                                ? 'Sáng (07:00 - 11:30)'
                                : order.timeSlot === 'AFTERNOON'
                                ? 'Chiều (13:30 - 17:30)'
                                : 'Cả ngày'}
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-400 italic">Vụ mùa (Pre-order)</span>
                        )}
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {order.itemCount} sản phẩm ({(order.totalGrams / 1000).toFixed(1)} kg)
                        </div>
                      </td>

                      {/* Tổng tiền & Cọc */}
                      <td className="py-4 px-4 text-right">
                        <div className="font-extrabold text-slate-900 text-sm">
                          {formatVND(order.total)}
                        </div>
                        {order.paymentOption === 'DEPOSIT_30' ? (
                          <div className="text-[11px] text-amber-700 font-semibold mt-0.5">
                            Cọc: {formatVND(order.depositAmount)}
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-500 mt-0.5">Trả 100%</div>
                        )}
                        <div className="text-[10px] text-emerald-700 font-bold mt-0.5">
                          Đã trả: {formatVND(order.paidAmount)}
                        </div>
                      </td>

                      {/* Trạng thái đơn */}
                      <td className="py-4 px-4 text-center">
                        <OrderStatusBadge status={order.status} />
                      </td>

                      {/* Trạng thái thanh toán */}
                      <td className="py-4 px-4 text-center">
                        <PaymentStatusBadge status={order.paymentStatus} />
                      </td>

                      {/* Thao tác */}
                      <td className="py-4 px-5 text-right">
                        <Link href={`/admin/don-hang/${order.code}`}>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs font-semibold gap-1 hover:bg-emerald-50 hover:text-emerald-700 border-slate-200 rounded-full px-3 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" /> Chi tiết
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function OrderStatusBadge({ status }: { status: OrderStatus }) {
  switch (status) {
    case 'DRAFT':
      return <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-200 rounded-full text-[10px] px-2.5 py-0.5">Đơn nháp</Badge>
    case 'PENDING_CONFIRMATION':
      return <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 font-semibold rounded-full text-[10px] px-2.5 py-0.5">Chờ xác nhận</Badge>
    case 'PREORDER_WAITING':
      return <Badge className="bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-100 font-semibold rounded-full text-[10px] px-2.5 py-0.5">Chờ vào vụ</Badge>
    case 'PROCESSING':
      return <Badge className="bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100 font-semibold rounded-full text-[10px] px-2.5 py-0.5">Đang xử lý</Badge>
    case 'SHIPPING':
      return <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200 hover:bg-indigo-100 font-semibold rounded-full text-[10px] px-2.5 py-0.5">Đang giao</Badge>
    case 'DELIVERED':
      return <Badge className="bg-teal-100 text-teal-800 border-teal-200 hover:bg-teal-100 font-semibold rounded-full text-[10px] px-2.5 py-0.5">Đã giao hàng</Badge>
    case 'COMPLAINT':
      return <Badge className="bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-100 font-semibold rounded-full text-[10px] px-2.5 py-0.5">Đang khiếu nại</Badge>
    case 'COMPLETED':
      return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100 font-semibold rounded-full text-[10px] px-2.5 py-0.5">Hoàn thành</Badge>
    case 'CANCELLED':
      return <Badge className="bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-50 font-semibold rounded-full text-[10px] px-2.5 py-0.5">Đã hủy</Badge>
    default:
      return <Badge variant="outline" className="rounded-full text-[10px] px-2.5 py-0.5">{status}</Badge>
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
        <Badge variant="outline" className="bg-slate-50 text-slate-600 border-slate-300 rounded-full text-[10px] px-2.5 py-0.5 font-medium">
          Chờ thanh toán
        </Badge>
      )
    case 'DEPOSIT_PAID':
      return (
        <Badge className="bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-50 font-semibold rounded-full text-[10px] px-2.5 py-0.5">
          Đã đặt cọc 30%
        </Badge>
      )
    case 'PAID':
      return (
        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100 font-semibold rounded-full text-[10px] px-2.5 py-0.5">
          Đã thanh toán đủ
        </Badge>
      )
    case 'REFUND_PENDING':
      return (
        <Badge className="bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-100 font-semibold rounded-full text-[10px] px-2.5 py-0.5">
          Chờ hoàn tiền
        </Badge>
      )
    case 'PARTIALLY_REFUNDED':
    case 'REFUNDED':
      return (
        <Badge className="bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-100 font-semibold rounded-full text-[10px] px-2.5 py-0.5">
          Đã hoàn tiền
        </Badge>
      )
  }
}
