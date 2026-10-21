'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ShieldAlert,
  Search,
  ExternalLink,
  Package,
  User,
  Scale,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
import { getComplaintPhotoUrl } from '@/lib/storage-helpers'
import { resolveComplaint } from '@/actions/order-lifecycle'
import { toast } from 'sonner'
import { ComplaintStatus, Resolution } from '@prisma/client'

export interface AdminComplaintItem {
  id: string
  orderId: string
  orderCode: string
  orderItemId: string
  productName: string
  packagingName: string
  unitPricePerKg: number
  itemActualGrams: number
  reportedGrams: number
  verifiedGrams: number | null
  description: string
  photos: string[]
  status: ComplaintStatus
  resolution: Resolution | null
  compensation: number | null
  adminNote: string | null
  createdAt: string
  resolvedAt: string | null
  user: {
    fullName: string
    companyName: string | null
    phone: string
  }
}

interface ComplaintListClientProps {
  initialComplaints: AdminComplaintItem[]
}

const statusTabs = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'OPEN', label: 'Chờ xử lý' },
  { value: 'RESOLVED', label: 'Đã bồi hoàn / Bù hàng' },
  { value: 'REJECTED', label: 'Từ chối' },
]

export function ComplaintListClient({ initialComplaints }: ComplaintListClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  // Selected complaint for resolution dialog
  const [selectedComplaint, setSelectedComplaint] = useState<AdminComplaintItem | null>(null)
  const [verifiedKg, setVerifiedKg] = useState<number>(0)
  const [resolutionChoice, setResolutionChoice] = useState<Resolution | 'REJECTED'>('REFUND')
  const [adminNote, setAdminNote] = useState('')

  const handleOpenResolveDialog = (complaint: AdminComplaintItem) => {
    setSelectedComplaint(complaint)
    setVerifiedKg(complaint.reportedGrams / 1000)
    setResolutionChoice('REFUND')
    setAdminNote('')
  }

  // Live calculation of compensation preview
  const compPreview = (() => {
    if (!selectedComplaint) return { allowedKg: 0, excessKg: 0, compensation: 0 }
    const actualGrams = selectedComplaint.itemActualGrams
    const verifiedGrams = Math.round(verifiedKg * 1000)
    const allowedGrams = Math.floor((actualGrams * 3) / 100)
    const excessGrams = Math.max(0, verifiedGrams - allowedGrams)
    const compensation = Math.round((selectedComplaint.unitPricePerKg * excessGrams) / 1000)

    return {
      allowedKg: allowedGrams / 1000,
      excessKg: excessGrams / 1000,
      compensation,
    }
  })()

  const handleResolveSubmit = () => {
    if (!selectedComplaint) return

    if (resolutionChoice !== 'REJECTED' && verifiedKg <= 0) {
      toast.error('Khối lượng xác minh phải lớn hơn 0')
      return
    }

    startTransition(async () => {
      try {
        const res = await resolveComplaint({
          complaintId: selectedComplaint.id,
          verifiedGrams: Math.round(verifiedKg * 1000),
          resolution: resolutionChoice,
          adminNote,
        })

        if (res.success) {
          toast.success(res.message || 'Xử lý khiếu nại thành công')
          setSelectedComplaint(null)
          router.refresh()
        } else {
          toast.error(res.error || 'Có lỗi xảy ra')
        }
      } catch {
        toast.error('Lỗi khi xử lý khiếu nại')
      }
    })
  }

  const filteredComplaints = initialComplaints.filter((c) => {
    if (statusFilter !== 'ALL' && c.status !== statusFilter) {
      return false
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim()
      const matchOrder = c.orderCode.toLowerCase().includes(term)
      const matchUser = c.user.fullName.toLowerCase().includes(term)
      const matchCompany = (c.user.companyName || '').toLowerCase().includes(term)
      const matchProduct = c.productName.toLowerCase().includes(term)
      if (!matchOrder && !matchUser && !matchCompany && !matchProduct) return false
    }

    return true
  })

  const openCount = initialComplaints.filter((c) => c.status === ComplaintStatus.OPEN).length

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 sm:p-7 rounded-3xl border border-slate-200/90 shadow-card">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="font-heading text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
              <AlertCircle className="w-6 h-6 text-rose-600" />
              Tiếp Nhận &amp; Xử Lý Khiếu Nại Hao Hụt
            </h1>
            {openCount > 0 && (
              <Badge className="bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs rounded-full px-2.5 py-0.5">
                {openCount} chờ xử lý
              </Badge>
            )}
          </div>
          <p className="text-xs sm:text-sm text-slate-500">
            Xác minh ảnh đồng kiểm, tính bồi hoàn hao hụt vượt định mức 3% theo đúng quy định.
          </p>
        </div>
      </div>

      {/* Filter Tabs & Search */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200/90 shadow-card space-y-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
          {statusTabs.map((tab) => {
            const active = statusFilter === tab.value
            const count =
              tab.value === 'ALL'
                ? initialComplaints.length
                : initialComplaints.filter((c) => c.status === tab.value).length
            return (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={`px-4 py-2 rounded-full font-medium whitespace-nowrap transition-all flex items-center gap-2 ${
                  active
                    ? 'bg-slate-900 text-white font-bold shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                    active ? 'bg-slate-700 text-slate-200' : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        <div className="relative pt-1 border-t border-slate-100">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Tìm theo mã đơn (DH-...), tên khách, hoặc sản phẩm..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 text-xs h-10 rounded-2xl border-slate-200/90 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
      </div>

      {/* Complaints List Table */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-card overflow-hidden">
        {filteredComplaints.length === 0 ? (
          <div className="text-center py-16 px-4">
            <ShieldAlert className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-700">Không có khiếu nại nào</p>
            <p className="text-xs text-slate-400 mt-1">
              Hệ thống chưa ghi nhận khiếu nại phù hợp với bộ lọc hiện tại.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 text-xs">
            {filteredComplaints.map((c) => (
              <div key={c.id} className="p-5 hover:bg-slate-50/60 transition-colors flex flex-col md:flex-row gap-5 justify-between">
                {/* Left info */}
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <Link
                      href={`/admin/don-hang/${c.orderCode}`}
                      className="font-mono font-bold text-emerald-700 hover:underline text-sm inline-flex items-center gap-1"
                    >
                      {c.orderCode} <ExternalLink className="w-3 h-3" />
                    </Link>

                    <ComplaintBadge status={c.status} />

                    {c.resolution && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-800">
                        {c.resolution === 'REFUND' ? 'BỒI HOÀN TIỀN' : 'BÙ HÀNG CHUYẾN SAU'}
                      </span>
                    )}

                    <span className="text-[11px] text-slate-400">
                      Gửi lúc {new Date(c.createdAt).toLocaleString('vi-VN')}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1">
                      <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                        <Package className="w-3.5 h-3.5 text-emerald-600" />
                        {c.productName} ({c.packagingName})
                      </div>
                      <div className="text-[11px] text-slate-600">
                        Thực giao: {(c.itemActualGrams / 1000).toLocaleString('vi-VN')} kg • Đơn giá: {formatVND(c.unitPricePerKg)}/kg
                      </div>
                      <div className="text-[11px] text-rose-700 font-bold">
                        Khách báo hư hỏng: {(c.reportedGrams / 1000).toLocaleString('vi-VN')} kg
                      </div>
                      {c.verifiedGrams !== null && (
                        <div className="text-[11px] text-emerald-700 font-bold">
                          Admin xác minh: {(c.verifiedGrams / 1000).toLocaleString('vi-VN')} kg
                        </div>
                      )}
                    </div>

                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1">
                      <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-500" />
                        {c.user.companyName || c.user.fullName}
                      </div>
                      <div className="text-[11px] text-slate-600">
                        {c.user.fullName} - {c.user.phone}
                      </div>
                      {c.compensation && (
                        <div className="text-emerald-800 font-bold pt-1">
                          Số tiền bồi hoàn: {formatVND(c.compensation)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Customer Description */}
                  <div className="p-3 bg-amber-50/50 border border-amber-200/60 rounded-xl text-slate-700">
                    <strong className="text-amber-900 block mb-0.5">Mô tả của khách hàng:</strong>
                    {c.description}
                  </div>

                  {/* Photos */}
                  {c.photos.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold text-slate-600 mb-1">
                        Ảnh minh chứng nhận hàng ({c.photos.length}):
                      </div>
                      <div className="flex gap-2.5 overflow-x-auto pb-1">
                        {c.photos.map((photo, i) => {
                          const photoUrl = getComplaintPhotoUrl(photo)
                          return (
                            <a key={i} href={photoUrl} target="_blank" rel="noreferrer" className="shrink-0">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={photoUrl}
                                alt="Minh chứng"
                                className="w-20 h-20 object-cover rounded-xl border border-slate-200 hover:opacity-90 shadow-sm"
                              />
                            </a>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {c.adminNote && (
                    <div className="text-[11px] text-slate-500 italic">
                      Ghi chú admin: {c.adminNote}
                    </div>
                  )}
                </div>

                {/* Right action button */}
                <div className="flex md:flex-col justify-end items-end gap-2 shrink-0 pt-2 md:pt-0">
                  {c.status === ComplaintStatus.OPEN ? (
                    <Button
                      onClick={() => handleOpenResolveDialog(c)}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 shadow-sm"
                    >
                      <Scale className="w-4 h-4" /> Xử lý khiếu nại
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenResolveDialog(c)}
                      className="text-xs text-slate-600 border-slate-300"
                    >
                      Xem / Cập nhật
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Resolution Dialog */}
      {selectedComplaint && (
        <Dialog open={Boolean(selectedComplaint)} onOpenChange={(open) => !open && setSelectedComplaint(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-slate-900">
                Xử lý Khiếu nại Hao hụt / Hư hỏng
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Đơn hàng <strong className="font-mono">{selectedComplaint.orderCode}</strong> • Sản phẩm: {selectedComplaint.productName}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 text-xs">
              <div>
                <Label htmlFor="verifiedKg" className="text-xs font-semibold text-slate-700">
                  Khối lượng hư hỏng xác minh (kg) *
                </Label>
                <Input
                  id="verifiedKg"
                  type="number"
                  step="0.1"
                  min="0"
                  value={verifiedKg}
                  onChange={(e) => setVerifiedKg(Number(e.target.value))}
                  className="mt-1 font-mono font-bold text-sm"
                />
                <div className="text-[11px] text-slate-500 mt-1 flex justify-between">
                  <span>Khách báo: {(selectedComplaint.reportedGrams / 1000).toLocaleString('vi-VN')} kg</span>
                  <span>Thực giao: {(selectedComplaint.itemActualGrams / 1000).toLocaleString('vi-VN')} kg</span>
                </div>
              </div>

              <div>
                <Label className="text-xs font-semibold text-slate-700">Hướng giải quyết *</Label>
                <select
                  value={resolutionChoice}
                  onChange={(e) =>
                    setResolutionChoice(e.target.value as Resolution | 'REJECTED')
                  }
                  className="w-full mt-1 h-9 px-3 rounded-lg border border-slate-200 bg-white text-slate-700 font-medium text-xs focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="REFUND">Bồi hoàn tiền (REFUND) - Tạo khoản hoàn chuyển khoản</option>
                  <option value="REPLACE">Bù hàng chuyến sau (REPLACE) - Ghi chú không phát sinh tiền</option>
                  <option value="REJECTED">Từ chối khiếu nại (REJECTED) - Hao hụt trong định mức hoặc không hợp lệ</option>
                </select>
              </div>

              {/* Compensation calculation preview */}
              {resolutionChoice === 'REFUND' && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5 text-xs">
                  <div className="font-semibold text-slate-800">Công thức bồi hoàn (Mục 3.9):</div>
                  <div className="flex justify-between text-slate-600">
                    <span>Hao hụt tự nhiên cho phép (3%):</span>
                    <span className="font-mono">{compPreview.allowedKg.toFixed(2)} kg</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Hao hụt vượt định mức bồi hoàn:</span>
                    <span className="font-mono font-bold text-slate-800">{compPreview.excessKg.toFixed(2)} kg</span>
                  </div>
                  <div className="flex justify-between font-bold pt-1 border-t border-slate-200 text-emerald-800">
                    <span>Số tiền bồi hoàn thực tế:</span>
                    <span className="font-mono text-sm">{formatVND(compPreview.compensation)}</span>
                  </div>
                </div>
              )}

              <div>
                <Label htmlFor="adminNote" className="text-xs font-semibold text-slate-700">
                  Ghi chú phản hồi cho khách
                </Label>
                <Textarea
                  id="adminNote"
                  placeholder="Nhập lý do xác nhận hoặc từ chối..."
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  rows={2}
                  className="mt-1 text-xs resize-none"
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedComplaint(null)}
                disabled={isPending}
                className="text-xs"
              >
                Hủy bỏ
              </Button>
              <Button
                size="sm"
                onClick={handleResolveSubmit}
                disabled={isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5"
              >
                {isPending ? 'Đang xử lý...' : 'Xác nhận xử lý khiếu nại'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function ComplaintBadge({ status }: { status: ComplaintStatus }) {
  switch (status) {
    case 'OPEN':
      return (
        <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100 font-semibold">
          Chờ xử lý
        </Badge>
      )
    case 'RESOLVED':
      return (
        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100 font-semibold">
          Đã giải quyết
        </Badge>
      )
    case 'REJECTED':
      return (
        <Badge className="bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-100 font-semibold">
          Từ chối
        </Badge>
      )
  }
}
