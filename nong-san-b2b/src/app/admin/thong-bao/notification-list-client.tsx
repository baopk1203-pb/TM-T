'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Mail,
  Search,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Clock,
  Filter,
  Eye,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface AdminEmailLogItem {
  id: string
  orderId: string
  orderCode: string
  eventType: string
  recipient: string
  subject: string
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED'
  note: string | null
  error: string | null
  messageId: string | null
  createdAt: string
  customerName: string
}

interface NotificationListClientProps {
  initialLogs: AdminEmailLogItem[]
}

const EVENT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  ORDER_PLACED: { label: 'Đặt hàng thành công', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  PAYMENT_CONFIRMED: { label: 'Xác nhận thanh toán', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  ORDER_SHIPPING: { label: 'Đang vận chuyển', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  ORDER_COMPLETED: { label: 'Giao hàng hoàn tất', color: 'bg-teal-100 text-teal-800 border-teal-200' },
  COMPLAINT_OPENED: { label: 'Tiếp nhận khiếu nại', color: 'bg-rose-100 text-rose-800 border-rose-200' },
  COMPLAINT_RESOLVED: { label: 'Giải quyết khiếu nại', color: 'bg-purple-100 text-purple-800 border-purple-200' },
  REFUND_CONFIRMED: { label: 'Xác nhận hoàn tiền', color: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
}

export function NotificationListClient({ initialLogs }: NotificationListClientProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'SUCCESS' | 'FAILED' | 'SKIPPED'>('ALL')
  const [eventFilter, setEventFilter] = useState<string>('ALL')
  const [selectedLog, setSelectedLog] = useState<AdminEmailLogItem | null>(null)

  // Thống kê
  const totalCount = initialLogs.length
  const successCount = initialLogs.filter((l) => l.status === 'SUCCESS').length
  const failedCount = initialLogs.filter((l) => l.status === 'FAILED').length
  const skippedCount = initialLogs.filter((l) => l.status === 'SKIPPED').length
  const successRate = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 100

  // Lọc dữ liệu
  const filteredLogs = initialLogs.filter((log) => {
    const matchesSearch =
      log.orderCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.recipient.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.subject.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesStatus =
      statusFilter === 'ALL' ? true : log.status === statusFilter

    const matchesEvent =
      eventFilter === 'ALL' ? true : log.eventType === eventFilter

    return matchesSearch && matchesStatus && matchesEvent
  })

  return (
    <div className="space-y-6">
      {/* Tiêu đề & Giới thiệu */}
      <div>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 text-emerald-800 rounded-lg">
            <Mail className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              Nhật ký Thông báo Email
            </h1>
            <p className="text-sm text-gray-500">
              Theo dõi toàn bộ email giao dịch và vòng đời đơn hàng B2B (Phase 9)
            </p>
          </div>
        </div>
      </div>

      {/* Thẻ thống kê */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white border-gray-200 shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">
              Tổng số thông báo
            </div>
            <div className="mt-2 text-2xl font-bold text-gray-900">{totalCount}</div>
            <div className="mt-1 text-xs text-gray-400">Tất cả sự kiện ghi nhận</div>
          </CardContent>
        </Card>

        <Card className="bg-white border-gray-200 shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs font-medium text-emerald-600 uppercase tracking-wider flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4" /> Thành công
            </div>
            <div className="mt-2 text-2xl font-bold text-emerald-700">{successCount}</div>
            <div className="mt-1 text-xs text-emerald-600/80">Tỷ lệ đạt {successRate}%</div>
          </CardContent>
        </Card>

        <Card className="bg-white border-gray-200 shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs font-medium text-rose-600 uppercase tracking-wider flex items-center gap-1">
              <AlertCircle className="w-4 h-4" /> Gặp sự cố
            </div>
            <div className="mt-2 text-2xl font-bold text-rose-700">{failedCount}</div>
            <div className="mt-1 text-xs text-rose-600/80">Cần kiểm tra SMTP / hòm thư</div>
          </CardContent>
        </Card>

        <Card className="bg-white border-gray-200 shadow-sm">
          <CardContent className="p-4">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1">
              <Clock className="w-4 h-4" /> Bỏ qua (Trùng/Thiếu Email)
            </div>
            <div className="mt-2 text-2xl font-bold text-gray-700">{skippedCount}</div>
            <div className="mt-1 text-xs text-gray-400">Idempotency & dữ liệu thiếu</div>
          </CardContent>
        </Card>
      </div>

      {/* Bộ lọc và Tìm kiếm */}
      <Card className="bg-white border-gray-200 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col md:flex-row gap-3">
            {/* Ô tìm kiếm */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Tìm theo mã đơn, email nhận, tên khách, tiêu đề..."
                className="pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            {/* Lọc trạng thái */}
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <select
                aria-label="Lọc theo trạng thái"
                className="border border-gray-300 rounded-md text-sm px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              >
                <option value="ALL">Tất cả trạng thái</option>
                <option value="SUCCESS">Thành công</option>
                <option value="FAILED">Thất bại</option>
                <option value="SKIPPED">Bỏ qua</option>
              </select>

              {/* Lọc loại sự kiện */}
              <select
                aria-label="Lọc theo loại sự kiện"
                className="border border-gray-300 rounded-md text-sm px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
              >
                <option value="ALL">Tất cả sự kiện</option>
                <option value="ORDER_PLACED">Đặt hàng (E01)</option>
                <option value="PAYMENT_CONFIRMED">Xác nhận thanh toán (E02)</option>
                <option value="ORDER_SHIPPING">Vận chuyển (E03)</option>
                <option value="ORDER_COMPLETED">Giao hoàn tất 24h (E04)</option>
                <option value="COMPLAINT_OPENED">Khiếu nại mở (E05)</option>
                <option value="COMPLAINT_RESOLVED">Khiếu nại giải quyết (E06)</option>
                <option value="REFUND_CONFIRMED">Xác nhận hoàn tiền</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bảng danh sách nhật ký */}
      <Card className="bg-white border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Thời gian</th>
                <th className="px-4 py-3">Mã đơn hàng</th>
                <th className="px-4 py-3">Khách hàng / Người nhận</th>
                <th className="px-4 py-3">Loại sự kiện</th>
                <th className="px-4 py-3">Tiêu đề email</th>
                <th className="px-4 py-3 text-center">Trạng thái</th>
                <th className="px-4 py-3 text-right">Chi tiết</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    Không tìm thấy nhật ký thông báo email nào phù hợp với bộ lọc.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const eventMeta = EVENT_TYPE_LABELS[log.eventType] || {
                    label: log.eventType,
                    color: 'bg-gray-100 text-gray-800 border-gray-200',
                  }

                  return (
                    <tr key={log.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500 font-mono">
                        {log.createdAt}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Link
                          href={`/admin/don-hang/${log.orderId}`}
                          className="font-mono font-medium text-emerald-600 hover:text-emerald-700 hover:underline inline-flex items-center gap-1"
                        >
                          {log.orderCode}
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{log.customerName}</div>
                        <div className="text-xs text-gray-400 font-mono">{log.recipient}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${eventMeta.color}`}
                        >
                          {eventMeta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-xs truncate text-gray-700" title={log.subject}>
                        {log.subject || log.note || '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-center">
                        {log.status === 'SUCCESS' && (
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100">
                            Thành công
                          </Badge>
                        )}
                        {log.status === 'FAILED' && (
                          <Badge variant="destructive" className="bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-100">
                            Thất bại
                          </Badge>
                        )}
                        {log.status === 'SKIPPED' && (
                          <Badge variant="secondary" className="bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-100">
                            Bỏ qua
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedLog(log)}
                          className="h-8 px-2 text-gray-500 hover:text-gray-900"
                        >
                          <Eye className="w-4 h-4 mr-1" /> Xem
                        </Button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal chi tiết thông báo */}
      {selectedLog && (
        <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Mail className="w-5 h-5 text-emerald-600" />
                Chi tiết Thông báo Email
              </DialogTitle>
              <DialogDescription>
                Mã đơn: <span className="font-mono font-semibold text-gray-800">{selectedLog.orderCode}</span>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2 text-sm text-gray-700">
              <div className="flex justify-between border-b pb-2">
                <span className="text-gray-500">Người nhận:</span>
                <span className="font-medium font-mono">{selectedLog.recipient}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-gray-500">Khách hàng:</span>
                <span className="font-medium">{selectedLog.customerName}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-gray-500">Sự kiện:</span>
                <span className="font-medium">
                  {EVENT_TYPE_LABELS[selectedLog.eventType]?.label || selectedLog.eventType}
                </span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-gray-500">Thời gian ghi nhận:</span>
                <span className="font-mono">{selectedLog.createdAt}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-gray-500">Trạng thái:</span>
                <span>
                  {selectedLog.status === 'SUCCESS' && (
                    <Badge className="bg-emerald-100 text-emerald-800">Thành công</Badge>
                  )}
                  {selectedLog.status === 'FAILED' && (
                    <Badge variant="destructive" className="bg-rose-100 text-rose-800">Thất bại</Badge>
                  )}
                  {selectedLog.status === 'SKIPPED' && (
                    <Badge variant="secondary">Bỏ qua</Badge>
                  )}
                </span>
              </div>

              {selectedLog.messageId && (
                <div className="flex justify-between border-b pb-2">
                  <span className="text-gray-500">Message ID:</span>
                  <span className="font-mono text-xs max-w-xs truncate">{selectedLog.messageId}</span>
                </div>
              )}

              <div className="space-y-1">
                <span className="text-gray-500">Tiêu đề:</span>
                <div className="p-2 bg-gray-50 rounded border text-sm font-medium">
                  {selectedLog.subject || '—'}
                </div>
              </div>

              {selectedLog.note && (
                <div className="space-y-1">
                  <span className="text-gray-500">Ghi chú hệ thống:</span>
                  <div className="p-2 bg-gray-50 rounded border text-xs text-gray-600">
                    {selectedLog.note}
                  </div>
                </div>
              )}

              {selectedLog.error && (
                <div className="space-y-1">
                  <span className="text-rose-600 font-medium">Chi tiết lỗi:</span>
                  <div className="p-2 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700 font-mono">
                    {selectedLog.error}
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
