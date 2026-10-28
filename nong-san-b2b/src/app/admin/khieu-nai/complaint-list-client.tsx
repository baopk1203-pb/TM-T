'use client'

import { useState, useTransition, useEffect } from 'react'
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
  Clock,
  RotateCcw,
  FileText,
  CheckCircle2,
  XCircle,
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
import { formatVietnamDateTime } from '@/lib/utils'
import { getComplaintPhotoUrl } from '@/lib/storage-helpers'
import { proposeComplaintResolution } from '@/actions/order-lifecycle'
import { toast } from 'sonner'
import { ComplaintStatus, ComplaintResolutionType } from '@prisma/client'
import { computeComplaintCompensation } from '@/lib/domain/settlement'

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
  resolution: string | null
  compensation: number | null
  adminNote: string | null
  createdAt: string
  resolvedAt: string | null
  user: {
    fullName: string
    companyName: string | null
    phone: string
  }
  proposalType?: ComplaintResolutionType | string | null
  proposalAmount?: number | null
  proposalNotes?: string | null
  proposedAt?: string | null
  reviewDueAt?: string | null
  customerAcceptedAt?: string | null
  reReviewCount?: number
  reReviewReason?: string | null
  reReviewedAt?: string | null
  isFinalProposal?: boolean
  autoClosedAt?: string | null
  refundTxStatus?: string | null
}

interface ComplaintListClientProps {
  initialComplaints: AdminComplaintItem[]
}

const statusTabs = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'OPEN', label: 'Chờ xử lý (OPEN)' },
  { value: 'PROPOSED', label: 'Đã gửi đề xuất' },
  { value: 'UNDER_REVIEW', label: 'Đang phúc tra' },
  { value: 'CUSTOMER_ACCEPTED', label: 'Khách đã chấp thuận' },
  { value: 'WITHDRAWN', label: 'Đã rút / Quá hạn' },
  { value: 'RESOLVED', label: 'Đã giải quyết' },
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
  const [proposalType, setProposalType] = useState<ComplaintResolutionType>(
    ComplaintResolutionType.REFUND_MONEY
  )
  const [customAmount, setCustomAmount] = useState<string>('')
  const [proposalNotes, setProposalNotes] = useState('')

  const handleOpenResolveDialog = (complaint: AdminComplaintItem) => {
    setSelectedComplaint(complaint)
    const initialKg =
      complaint.verifiedGrams !== null && complaint.verifiedGrams > 0
        ? complaint.verifiedGrams / 1000
        : complaint.reportedGrams / 1000
    setVerifiedKg(initialKg)

    if (
      complaint.proposalType === ComplaintResolutionType.REFUND_MONEY ||
      complaint.proposalType === ComplaintResolutionType.REJECT_COMPLAINT
    ) {
      setProposalType(complaint.proposalType as ComplaintResolutionType)
    } else {
      setProposalType(ComplaintResolutionType.REFUND_MONEY)
    }

    setCustomAmount(
      complaint.proposalAmount !== null && complaint.proposalAmount !== undefined
        ? String(complaint.proposalAmount)
        : ''
    )
    setProposalNotes(complaint.proposalNotes || complaint.adminNote || '')
  }

  // Live calculation of compensation preview
  const compPreview = (() => {
    if (!selectedComplaint) return { allowedKg: 0, excessKg: 0, compensation: 0 }
    const actualGrams = selectedComplaint.itemActualGrams
    const damagedGrams = Math.round(verifiedKg * 1000)

    const res = computeComplaintCompensation({
      actualGrams,
      damagedGrams,
      unitPricePerKg: selectedComplaint.unitPricePerKg,
    })

    return {
      allowedKg: res.allowedGrams / 1000,
      excessKg: res.excessGrams / 1000,
      compensation: res.compensation,
    }
  })()

  // Auto sync customAmount with compPreview if empty
  const effectiveCompensation =
    customAmount.trim() !== '' ? Number(customAmount) : compPreview.compensation

  const handleProposalSubmit = () => {
    if (!selectedComplaint) return

    if (proposalType === ComplaintResolutionType.REFUND_MONEY && verifiedKg <= 0) {
      toast.error('Khối lượng xác minh bồi thường phải lớn hơn 0 kg')
      return
    }

    startTransition(async () => {
      try {
        const res = await proposeComplaintResolution({
          complaintId: selectedComplaint.id,
          proposalType,
          proposalAmount:
            proposalType === ComplaintResolutionType.REFUND_MONEY
              ? effectiveCompensation
              : 0,
          verifiedGrams: Math.round(verifiedKg * 1000),
          proposalNotes,
        })

        if (res.success) {
          toast.success(res.message || 'Đã gửi đề xuất bồi thường thành công')
          setSelectedComplaint(null)
          router.refresh()
        } else {
          toast.error(res.error || 'Có lỗi xảy ra khi gửi đề xuất')
        }
      } catch {
        toast.error('Lỗi khi gửi đề xuất bồi thường')
      }
    })
  }

  const filteredComplaints = initialComplaints.filter((c) => {
    if (statusFilter !== 'ALL' && c.status !== statusFilter) {
      return false
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim()
      const matchCode = c.orderCode.toLowerCase().includes(term)
      const matchCustomer =
        c.user.fullName.toLowerCase().includes(term) ||
        (c.user.companyName && c.user.companyName.toLowerCase().includes(term)) ||
        c.user.phone.includes(term)
      const matchProduct = c.productName.toLowerCase().includes(term)
      return matchCode || matchCustomer || matchProduct
    }

    return true
  })

  const openCount = initialComplaints.filter((c) => c.status === ComplaintStatus.OPEN).length
  const underReviewCount = initialComplaints.filter(
    (c) => c.status === ComplaintStatus.UNDER_REVIEW
  ).length

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 sm:p-7 rounded-3xl border border-slate-200/90 shadow-card">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="font-heading text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
              <AlertCircle className="w-6 h-6 text-rose-600" />
              Quản Lý Khiếu Nại &amp; Đề Xuất Bồi Thường (F02)
            </h1>
            {openCount > 0 && (
              <Badge className="bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs rounded-full px-2.5 py-0.5">
                {openCount} chờ xử lý
              </Badge>
            )}
            {underReviewCount > 0 && (
              <Badge className="bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-full px-2.5 py-0.5">
                {underReviewCount} cần phúc tra
              </Badge>
            )}
          </div>
          <p className="text-xs sm:text-sm text-slate-500">
            Quy trình khiếu nại hai chiều (Two-Way Complaints) • Khấu trừ 3% hao hụt • SLA phản hồi 48 giờ.
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
            {filteredComplaints.map((c) => {
              return (
                <div
                  key={c.id}
                  className="p-5 hover:bg-slate-50/60 transition-colors flex flex-col md:flex-row gap-5 justify-between"
                >
                  {/* Left info */}
                  <div className="space-y-2.5 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <Link
                        href={`/admin/don-hang/${c.orderCode}`}
                        className="font-mono font-bold text-emerald-700 hover:underline text-sm inline-flex items-center gap-1"
                      >
                        {c.orderCode} <ExternalLink className="w-3 h-3" />
                      </Link>

                      <ComplaintBadge status={c.status} />

                      {c.isFinalProposal && (
                        <Badge className="bg-rose-100 text-rose-800 border-rose-300 font-bold text-[10px]">
                          Đề xuất cuối cùng
                        </Badge>
                      )}

                      <span className="text-[11px] text-slate-400">
                        Gửi lúc {formatVietnamDateTime(c.createdAt)}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1">
                        <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                          <Package className="w-3.5 h-3.5 text-emerald-600" />
                          {c.productName} ({c.packagingName})
                        </div>
                        <div className="text-[11px] text-slate-600">
                          Thực giao: {(c.itemActualGrams / 1000).toLocaleString('vi-VN')} kg • Đơn giá:{' '}
                          {formatVND(c.unitPricePerKg)}/kg
                        </div>
                        <div className="text-[11px] text-rose-700 font-bold">
                          Khách báo hư hỏng: {(c.reportedGrams / 1000).toLocaleString('vi-VN')} kg
                        </div>
                        {c.verifiedGrams !== null && (
                          <div className="text-[11px] text-emerald-700 font-bold">
                            Xác minh bồi hoàn: {(c.verifiedGrams / 1000).toLocaleString('vi-VN')} kg
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
                        {c.compensation !== null && (
                          <div className="text-emerald-800 font-bold pt-1">
                            Khoản bồi hoàn: {formatVND(c.compensation)}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Customer Description */}
                    <div className="p-3 bg-amber-50/50 border border-amber-200/60 rounded-xl text-slate-700">
                      <strong className="text-amber-900 block mb-0.5">Mô tả của khách hàng:</strong>
                      {c.description}
                    </div>

                    {/* PHOTOS */}
                    {c.photos.length > 0 && (
                      <div>
                        <div className="text-[11px] font-semibold text-slate-600 mb-1">
                          Ảnh minh chứng nhận hàng ({c.photos.length}):
                        </div>
                        <div className="flex gap-2.5 overflow-x-auto pb-1">
                          {c.photos.map((photo, i) => {
                            const photoUrl = getComplaintPhotoUrl(photo)
                            return (
                              <a
                                key={i}
                                href={photoUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0"
                              >
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

                    {/* F02 DETAIL HIGHLIGHTS: UNDER_REVIEW, PROPOSED, CUSTOMER_ACCEPTED, WITHDRAWN */}
                    {c.status === ComplaintStatus.UNDER_REVIEW && (
                      <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-purple-950 space-y-1">
                        <div className="font-bold flex items-center gap-1.5 text-purple-900">
                          <RotateCcw className="w-4 h-4 text-purple-600" />
                          Yêu cầu phúc tra từ khách hàng (Lần 1):
                        </div>
                        <div className="text-xs bg-white/80 p-2 rounded border border-purple-200">
                          {c.reReviewReason || 'Không có lý do chi tiết'}
                        </div>
                        <p className="text-[11px] text-purple-700">
                          Vui lòng xem xét lại chứng từ và gửi đề xuất lần cuối.
                        </p>
                      </div>
                    )}

                    {c.status === ComplaintStatus.PROPOSED && (
                      <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl text-sky-950 space-y-1">
                        <div className="font-bold flex items-center justify-between text-sky-900">
                          <span className="flex items-center gap-1.5">
                            <FileText className="w-4 h-4 text-sky-600" />
                            Đã gửi đề xuất:{' '}
                            {c.proposalType === ComplaintResolutionType.REFUND_MONEY ||
                            c.proposalType === 'REFUND_MONEY'
                              ? formatVND(c.proposalAmount || 0)
                              : c.proposalType}
                          </span>
                          {c.reviewDueAt && <AdminProposalCountdown reviewDueAt={c.reviewDueAt} />}
                        </div>
                        {c.proposalNotes && (
                          <div className="text-xs text-slate-600 bg-white/70 p-2 rounded">
                            Ghi chú: {c.proposalNotes}
                          </div>
                        )}
                        {c.reviewDueAt && (
                          <div className="text-[11px] text-slate-500">
                            Hạn khách phản hồi: {formatVietnamDateTime(c.reviewDueAt)} (48 giờ)
                          </div>
                        )}
                      </div>
                    )}

                    {c.status === ComplaintStatus.CUSTOMER_ACCEPTED && (
                      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-950 space-y-1">
                        <div className="font-bold flex items-center justify-between text-emerald-900">
                          <span className="flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            Khách đã đồng ý đề xuất bồi thường
                          </span>
                          {c.refundTxStatus ? (
                            <Badge
                              className={
                                c.refundTxStatus === 'DONE'
                                  ? 'bg-emerald-600 text-white font-bold'
                                  : 'bg-purple-100 text-purple-800 border-purple-200 font-bold'
                              }
                            >
                              {c.refundTxStatus === 'DONE'
                                ? 'ĐÃ HOÀN TIỀN'
                                : 'CHỜ CHUYỂN KHOẢN (PENDING)'}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-xs text-emerald-800">
                          Số tiền bồi thường: <strong>{formatVND(c.proposalAmount || 0)}</strong>.
                          Đơn hàng giữ nguyên trạng thái COMPLAINT để bảo vệ doanh thu cho đến khi đối soát hoàn tất.
                        </p>
                      </div>
                    )}

                    {c.status === ComplaintStatus.WITHDRAWN && (
                      <div className="p-3 bg-slate-100 border border-slate-200 rounded-xl text-slate-700 space-y-1">
                        <div className="font-bold flex items-center gap-1.5 text-slate-800">
                          <XCircle className="w-4 h-4 text-slate-500" />
                          Khiếu nại đã đóng (WITHDRAWN)
                        </div>
                        <p className="text-xs">
                          {c.autoClosedAt
                            ? `Tự động đóng do khách hàng quá hạn 48 giờ phản hồi (${formatVietnamDateTime(
                                c.autoClosedAt
                              )}).`
                            : 'Khách hàng đã chủ động rút khiếu nại.'}
                        </p>
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
                        <Scale className="w-4 h-4" /> Đề xuất bồi thường
                      </Button>
                    ) : c.status === ComplaintStatus.UNDER_REVIEW ? (
                      <Button
                        onClick={() => handleOpenResolveDialog(c)}
                        className="bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs gap-1.5 shadow-sm"
                      >
                        <RotateCcw className="w-4 h-4" /> Xử lý phúc tra (Lần cuối)
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenResolveDialog(c)}
                        className="text-xs text-slate-600 border-slate-300"
                      >
                        Xem chi tiết
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* PROPOSAL MODAL (F02) */}
      {selectedComplaint && (
        <Dialog
          open={Boolean(selectedComplaint)}
          onOpenChange={(open) => !open && setSelectedComplaint(null)}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Scale className="w-5 h-5 text-emerald-600" />
                {selectedComplaint.status === ComplaintStatus.UNDER_REVIEW
                  ? 'Đề Xuất Phương Án Bồi Thường Cuối Cùng'
                  : 'Đề Xuất Phương Án Xử Lý Khiếu Nại (48h SLA)'}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Đơn hàng <strong className="font-mono">{selectedComplaint.orderCode}</strong> • Sản phẩm:{' '}
                {selectedComplaint.productName}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 text-xs">
              {/* Cảnh báo khi đang phúc tra */}
              {selectedComplaint.status === ComplaintStatus.UNDER_REVIEW && (
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl space-y-1.5 text-purple-900">
                  <div className="font-bold flex items-center gap-1.5 text-purple-800">
                    <AlertCircle className="w-4 h-4 text-purple-600" />
                    Lưu ý: Đây là đề xuất phương án cuối cùng (vòng phúc tra)
                  </div>
                  <p className="text-[11px] text-purple-700">
                    Khách hàng chỉ có thể <strong>Chấp nhận</strong> hoặc <strong>Rút khiếu nại</strong>,
                    không thể yêu cầu phúc tra thêm lần nữa.
                  </p>
                  {selectedComplaint.reReviewReason && (
                    <div className="text-[11px] bg-white p-2 rounded border border-purple-200 font-medium">
                      Lý do khách phúc tra: {selectedComplaint.reReviewReason}
                    </div>
                  )}
                </div>
              )}

              {/* Khối lượng xác minh */}
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

              {/* Hướng giải quyết */}
              <div>
                <Label className="text-xs font-semibold text-slate-700">Hình thức đề xuất *</Label>
                <select
                  value={proposalType}
                  onChange={(e) =>
                    setProposalType(e.target.value as ComplaintResolutionType)
                  }
                  className="w-full mt-1 h-9 px-3 rounded-lg border border-slate-200 bg-white text-slate-700 font-medium text-xs focus:ring-1 focus:ring-emerald-500"
                >
                  <option value={ComplaintResolutionType.REFUND_MONEY}>
                    Hoàn tiền bồi hoàn (REFUND_MONEY) - Kích hoạt hoàn tiền khi khách đồng ý
                  </option>
                  <option value={ComplaintResolutionType.REJECT_COMPLAINT}>
                    Từ chối khiếu nại (REJECT_COMPLAINT) - Hao hụt trong định mức hoặc không đủ căn cứ
                  </option>
                  <option value={ComplaintResolutionType.REPLACE_GOODS} disabled>
                    Bù hàng chuyến sau (REPLACE_GOODS) - [Chưa hỗ trợ tự động trong Phase 8]
                  </option>
                </select>
              </div>

              {/* Compensation calculation preview */}
              {proposalType === ComplaintResolutionType.REFUND_MONEY && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
                  <div className="font-semibold text-slate-800">Tính toán bồi hoàn (Mục 3.9):</div>
                  <div className="flex justify-between text-slate-600">
                    <span>Hao hụt tự nhiên cho phép (3%):</span>
                    <span className="font-mono">{compPreview.allowedKg.toFixed(2)} kg</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Hao hụt vượt định mức tính tiền:</span>
                    <span className="font-mono font-bold text-slate-800">
                      {compPreview.excessKg.toFixed(2)} kg
                    </span>
                  </div>
                  <div className="flex justify-between font-bold pt-1 border-t border-slate-200 text-emerald-800">
                    <span>Số tiền bồi hoàn gợi ý:</span>
                    <span className="font-mono text-sm">{formatVND(compPreview.compensation)}</span>
                  </div>

                  <div className="pt-2 border-t border-slate-200">
                    <Label htmlFor="customAmount" className="text-[11px] font-semibold text-slate-700">
                      Số tiền bồi hoàn đề xuất (VND) (để trống nếu dùng số tiền gợi ý):
                    </Label>
                    <Input
                      id="customAmount"
                      type="number"
                      placeholder={String(compPreview.compensation)}
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                      className="mt-1 font-mono font-bold text-xs h-8"
                    />
                  </div>
                </div>
              )}

              <div>
                <Label htmlFor="proposalNotes" className="text-xs font-semibold text-slate-700">
                  Ghi chú / Giải thích đề xuất cho khách
                </Label>
                <Textarea
                  id="proposalNotes"
                  placeholder="Nhập ghi chú giải thích phương án đề xuất cho khách hàng..."
                  value={proposalNotes}
                  onChange={(e) => setProposalNotes(e.target.value)}
                  rows={2}
                  className="mt-1 text-xs resize-none"
                />
              </div>

              {/* SLA Banner */}
              <div className="p-2.5 bg-amber-50/70 border border-amber-200/80 rounded-lg flex items-start gap-2 text-[11px] text-amber-900">
                <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  <strong>Quy chế 48 giờ SLA:</strong> Sau khi gửi, khách hàng có 48 giờ để phản hồi
                  (Chấp nhận / Phúc tra / Rút). Nếu quá 48 giờ không phản hồi, khiếu nại sẽ được tự động
                  đóng theo quy chế sàn.
                </span>
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
                onClick={handleProposalSubmit}
                disabled={isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5"
              >
                {isPending ? 'Đang gửi...' : 'Gửi đề xuất giải quyết'}
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
        <Badge className="bg-amber-100 text-amber-900 border-amber-300 font-semibold text-[10px]">
          Chờ xử lý (OPEN)
        </Badge>
      )
    case 'PROPOSED':
      return (
        <Badge className="bg-sky-100 text-sky-900 border-sky-300 font-semibold text-[10px]">
          Đã gửi đề xuất
        </Badge>
      )
    case 'UNDER_REVIEW':
      return (
        <Badge className="bg-purple-100 text-purple-900 border-purple-300 font-semibold text-[10px]">
          Đang phúc tra
        </Badge>
      )
    case 'CUSTOMER_ACCEPTED':
      return (
        <Badge className="bg-emerald-100 text-emerald-900 border-emerald-300 font-semibold text-[10px]">
          Khách đã chấp nhận
        </Badge>
      )
    case 'WITHDRAWN':
      return (
        <Badge className="bg-slate-100 text-slate-800 border-slate-300 font-semibold text-[10px]">
          Đã rút / Quá hạn
        </Badge>
      )
    case 'RESOLVED':
      return (
        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 font-semibold text-[10px]">
          Đã giải quyết
        </Badge>
      )
    case 'REJECTED':
      return (
        <Badge className="bg-rose-100 text-rose-800 border-rose-200 font-semibold text-[10px]">
          Từ chối
        </Badge>
      )
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function AdminProposalCountdown({ reviewDueAt }: { reviewDueAt: string }) {
  const [timeLeft, setTimeLeft] = useState<{ hours: number; minutes: number; expired: boolean } | null>(null)

  useEffect(() => {
    const calculate = () => {
      const due = new Date(reviewDueAt).getTime()
      const now = Date.now()
      const diff = due - now
      if (diff <= 0) {
        setTimeLeft({ hours: 0, minutes: 0, expired: true })
      } else {
        const hours = Math.floor(diff / (1000 * 60 * 60))
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
        setTimeLeft({ hours, minutes, expired: false })
      }
    }

    calculate()
    const timer = setInterval(calculate, 60000)
    return () => clearInterval(timer)
  }, [reviewDueAt])

  if (!timeLeft) return null

  if (timeLeft.expired) {
    return (
      <span className="text-rose-600 font-semibold flex items-center gap-1 text-[10px] bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
        <Clock className="w-3 h-3 text-rose-500" />
        Đã quá hạn 48h
      </span>
    )
  }

  return (
    <span className="text-sky-800 font-medium flex items-center gap-1 bg-sky-100/60 px-2 py-0.5 rounded border border-sky-200 text-[10px]">
      <Clock className="w-3 h-3 text-sky-600 animate-pulse" />
      Còn lại: {timeLeft.hours}h {timeLeft.minutes}m
    </span>
  )
}
