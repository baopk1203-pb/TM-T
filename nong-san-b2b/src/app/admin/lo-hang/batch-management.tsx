'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  QrCode,
  Plus,
  ExternalLink,
  Tractor,
  CheckCircle2,
  Printer,
  X,
  Search,
  RefreshCw,
  Boxes,
  History,
  Lock,
  Eye,
  ShieldAlert,
  Scale,
  Truck,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { createBatch } from '@/server/actions/batch'
import {
  adminReceiveStock,
  adminAdjustStock,
  adminUpdateBatchStatus,
  getBatchAuditHistory,
} from '@/server/actions/inventory-operations'
import { gramsToKg } from '@/lib/money'
import type { AdminBatchDetailView } from '@/lib/services/inventory-read'
import {
  formatAvailableKgWithUnit,
  getLedgerTypePresentation,
  type BatchExpiryAlert,
} from '@/lib/domain/inventory-view'
import { BatchStatus } from '@prisma/client'
import type {
  BatchStatusAuditEntry,
  StockAdjustmentType,
} from '@/lib/domain/inventory-operations'

interface ProductOption {
  id: string
  name: string
  farmId: string
  inventoryTrackingEnabled?: boolean
  farm: { id: string; name: string }
}

interface BatchManagementProps {
  inventoryViews: AdminBatchDetailView[]
  products: ProductOption[]
  writeEnabled?: boolean
  adjustmentEnabled?: boolean
  initialProductIdFilter?: string
  initialSearchQuery?: string
}

function formatVnDate(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

function formatVnDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(d)
}

function renderExpiryBadge(alert: BatchExpiryAlert) {
  switch (alert.level) {
    case 'EXPIRED':
      return (
        <Badge className="bg-rose-100 text-rose-800 border border-rose-200 hover:bg-rose-100 text-[10px]">
          {alert.label}
        </Badge>
      )
    case 'EXPIRING_3_DAYS':
      return (
        <Badge className="bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-100 text-[10px]">
          {alert.label}
        </Badge>
      )
    case 'EXPIRING_7_DAYS':
      return (
        <Badge className="bg-yellow-50 text-yellow-800 border border-yellow-200 hover:bg-yellow-50 text-[10px]">
          {alert.label}
        </Badge>
      )
    case 'UNKNOWN_EXPIRY':
      return (
        <Badge variant="outline" className="text-slate-500 border-slate-300 text-[10px]">
          {alert.label}
        </Badge>
      )
    case 'NORMAL':
    default:
      return (
        <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-50 text-[10px]">
          {alert.label}
        </Badge>
      )
  }
}

export interface BatchAdjustActionState {
  canOpen: boolean
  disabledReason: string | null
}

/**
 * Đánh giá xem một lô hàng (kể cả lô UNVERIFIED / LOCKED_QC / không đủ điều kiện FEFO)
 * có thể mở Modal Điều chỉnh tồn kho & Hao hụt (Module C) hay không.
 */
export function evaluateBatchAdjustActionState(batch: {
  productTrackingEnabled: boolean
  status: BatchStatus
  physicalStockGrams: number
  ledgerCount: number
}): BatchAdjustActionState {
  if (!batch.productTrackingEnabled) {
    return {
      canOpen: false,
      disabledReason: 'Sản phẩm chưa bật quản lý tồn kho sổ cái',
    }
  }
  if (batch.status === BatchStatus.DEPLETED) {
    return {
      canOpen: false,
      disabledReason: 'Lô hàng đã cạn tồn (DEPLETED), không thể điều chỉnh',
    }
  }
  if (batch.physicalStockGrams <= 0 && batch.ledgerCount <= 0) {
    return {
      canOpen: false,
      disabledReason: 'Lô lịch sử chỉ phục vụ truy xuất QR, chưa có bút toán nhập kho (0 kg)',
    }
  }
  return {
    canOpen: true,
    disabledReason: null,
  }
}

export function BatchManagement({
  inventoryViews,
  products,
  writeEnabled = false,
  adjustmentEnabled = false,
  initialProductIdFilter = 'ALL',
  initialSearchQuery = '',
}: BatchManagementProps) {
  const effectiveAdjustmentEnabled = adjustmentEnabled || writeEnabled
  const router = useRouter()
  const [isRefreshing, startRefreshTransition] = useTransition()
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState(products[0]?.id || '')
  const [harvestDate, setHarvestDate] = useState(new Date().toISOString().split('T')[0])
  const [expiryDate, setExpiryDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 14)
    return d.toISOString().split('T')[0]
  })
  const [harvestKg, setHarvestKg] = useState('500')
  const [qcNotes, setQcNotes] = useState('')
  const [customCode, setCustomCode] = useState('')
  const [createStatus, setCreateStatus] = useState<BatchStatus>(BatchStatus.ACTIVE)
  const [isFefoEligible, setIsFefoEligible] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // QR Modal
  const [qrModalBatch, setQrModalBatch] = useState<{
    code: string
    productName: string
    farmName: string
    harvestDate: string
    harvestGrams: number | null
  } | null>(null)

  // Detail Modal
  const [detailBatchView, setDetailBatchView] = useState<AdminBatchDetailView | null>(null)

  // Module C: Adjust Modal
  const [adjustModalBatch, setAdjustModalBatch] = useState<AdminBatchDetailView | null>(null)
  const [adjustType, setAdjustType] = useState<StockAdjustmentType>('SHRINKAGE_LOSS')
  const [adjustKg, setAdjustKg] = useState('10')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjustRefCode, setAdjustRefCode] = useState('')
    const [adjustLoading, setAdjustLoading] = useState(false)
  const [adjustError, setAdjustError] = useState<string | null>(null)

  // Module D: Status & FEFO Modal
  const [statusModalBatch, setStatusModalBatch] = useState<AdminBatchDetailView | null>(null)
  const [targetStatus, setTargetStatus] = useState<BatchStatus>(BatchStatus.ACTIVE)
  const [targetEligibility, setTargetEligibility] = useState(true)
  const [statusReason, setStatusReason] = useState('')
  const [statusQcNotes, setStatusQcNotes] = useState('')
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [auditHistory, setAuditHistory] = useState<BatchStatusAuditEntry[] | null>(null)
  const [loadingAuditHistory, setLoadingAuditHistory] = useState(false)

  // Module B: Dispatch Modal
  const [dispatchModalBatch, setDispatchModalBatch] = useState<AdminBatchDetailView | null>(null)

  // Filter states
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery)
  const [productFilter, setProductFilter] = useState(initialProductIdFilter)
  const [farmFilter, setFarmFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [fefoFilter, setFefoFilter] = useState<'ALL' | 'ELIGIBLE' | 'INELIGIBLE'>('ALL')
  const [expiryFilter, setExpiryFilter] = useState<'ALL' | 'EXPIRING_SOON' | 'EXPIRED' | 'NORMAL'>('ALL')

  const selectedProduct = products.find((p) => p.id === selectedProductId)

  const uniqueFarms = Array.from(
    new Map(inventoryViews.map((v) => [v.batch.farmId, v.batch.farmName])).entries()
  ).map(([id, name]) => ({ id, name }))

  const filteredViews = inventoryViews.filter((item) => {
    const b = item.batch
    if (productFilter !== 'ALL' && b.productId !== productFilter) return false
    if (farmFilter !== 'ALL' && b.farmId !== farmFilter) return false
    if (statusFilter !== 'ALL' && b.status !== statusFilter) return false
    if (fefoFilter === 'ELIGIBLE' && !b.fefoEligibility.eligible) return false
    if (fefoFilter === 'INELIGIBLE' && b.fefoEligibility.eligible) return false
    if (expiryFilter === 'EXPIRING_SOON' && !b.expiryAlert.isExpiringSoon) return false
    if (expiryFilter === 'EXPIRED' && !b.expiryAlert.isExpired) return false
    if (expiryFilter === 'NORMAL' && b.expiryAlert.level !== 'NORMAL') return false

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      const matchCode = b.code.toLowerCase().includes(q)
      const matchProduct = b.productName.toLowerCase().includes(q)
      const matchFarm = b.farmName.toLowerCase().includes(q)
      if (!matchCode && !matchProduct && !matchFarm) return false
    }

    return true
  })

  const fefoEligibleViews = filteredViews.filter((v) => v.batch.fefoEligibility.eligible)
  const nonEligibleViews = filteredViews.filter((v) => !v.batch.fefoEligibility.eligible)

  const handleRefresh = () => {
    startRefreshTransition(() => {
      router.refresh()
    })
  }

  const openAdjustModal = (view: AdminBatchDetailView) => {
    const actionState = evaluateBatchAdjustActionState(view.batch)
    if (!actionState.canOpen) return
    const currentPhysicalKg = gramsToKg(view.batch.physicalStockGrams)
    const defaultKg =
      currentPhysicalKg > 0 ? String(Math.min(1, currentPhysicalKg)) : '1'
    setAdjustModalBatch(view)
    setAdjustType(view.batch.physicalStockGrams > 0 ? 'SHRINKAGE_LOSS' : 'QC_ADJUSTMENT_ADD')
    setAdjustKg(defaultKg)
    setAdjustReason('')
    setAdjustRefCode('')
        setAdjustError(null)
  }

  // Handle Stock Receipt (Module A)
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProduct) return
    setLoading(true)
    setError(null)
    setSuccessMsg(null)

    const autoCode =
      customCode.trim() ||
      `LO-${harvestDate.replace(/-/g, '').slice(2)}-${String(inventoryViews.length + 1).padStart(3, '0')}`

    try {
      let res
      if (selectedProduct.inventoryTrackingEnabled) {
        res = await adminReceiveStock({
          productId: selectedProduct.id,
          farmId: selectedProduct.farmId,
          code: autoCode,
          harvestDate: new Date(harvestDate),
          expiryDate: expiryDate ? new Date(expiryDate) : null,
          quantityKg: Number(harvestKg),
          status: createStatus,
          isFefoEligible: createStatus === BatchStatus.ACTIVE ? isFefoEligible : false,
          qcNotes: qcNotes.trim() || undefined,
        })
      } else {
        res = await createBatch({
          code: autoCode,
          productId: selectedProduct.id,
          farmId: selectedProduct.farmId,
          harvestDate: new Date(harvestDate),
          quantityGrams: Math.round(Number(harvestKg) * 1000),
          note: qcNotes,
        })
      }

      setLoading(false)
      if (!res.success) {
        setError(res.error || 'Lỗi khi tạo lô hàng')
      } else {
        setSuccessMsg(res.message || `Đã tạo thành công lô hàng ${autoCode}`)
        setCustomCode('')
        setQcNotes('')
        setShowCreateForm(false)
        router.refresh()
      }
    } catch (err: unknown) {
      setLoading(false)
      setError(err instanceof Error ? err.message : 'Lỗi hệ thống khi nhập kho')
    }
  }

  // Handle Stock Adjustment (Module C)
  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!adjustModalBatch) return
    setAdjustLoading(true)
    setAdjustError(null)

    try {
      const res = await adminAdjustStock({
        batchId: adjustModalBatch.batch.id,
        type: adjustType,
        quantityKg: Number(adjustKg),
        reason: adjustReason,
        referenceCode: adjustRefCode.trim() || null,
              })

      setAdjustLoading(false)
      if (!res.success) {
        setAdjustError(res.error || 'Lỗi khi điều chỉnh tồn kho')
      } else {
        setSuccessMsg(res.message || 'Đã điều chỉnh tồn kho thành công')
        setAdjustModalBatch(null)
        router.refresh()
      }
    } catch (err: unknown) {
      setAdjustLoading(false)
      setAdjustError(err instanceof Error ? err.message : 'Lỗi hệ thống khi điều chỉnh tồn kho')
    }
  }

  // Handle Status Update (Module D)
  const handleStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!statusModalBatch) return
    setStatusLoading(true)
    setStatusError(null)

    try {
      const res = await adminUpdateBatchStatus({
        batchId: statusModalBatch.batch.id,
        targetStatus,
        targetEligibility,
        reason: statusReason,
        qcNotes: statusQcNotes.trim() || undefined,
      })

      setStatusLoading(false)
      if (!res.success) {
        setStatusError(res.error || 'Lỗi khi cập nhật trạng thái lô hàng')
      } else {
        setSuccessMsg(res.message || 'Đã cập nhật trạng thái lô hàng thành công')
        setStatusModalBatch(null)
        router.refresh()
      }
    } catch (err: unknown) {
      setStatusLoading(false)
      setStatusError(err instanceof Error ? err.message : 'Lỗi hệ thống khi cập nhật trạng thái')
    }
  }

  const handleFetchAuditHistory = async (batchId: string) => {
    setLoadingAuditHistory(true)
    try {
      const res = await getBatchAuditHistory(batchId)
      setLoadingAuditHistory(false)
      if (res.success && Array.isArray(res.data)) {
        setAuditHistory(res.data as BatchStatusAuditEntry[])
      }
    } catch {
      setLoadingAuditHistory(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600 text-[10px]">
              FEFO Batch Management
            </Badge>
            <span className="text-xs text-slate-500">
              Tổng cộng: <strong>{inventoryViews.length} lô</strong> ({fefoEligibleViews.length} lô đủ điều kiện FEFO)
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <QrCode className="w-6 h-6 text-emerald-600" />
            Quản Lý Lô Hàng FEFO &amp; Truy Xuất QR
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Theo dõi thứ tự xuất kho FEFO (First-Expired, First-Out), số dư sổ cái từng lô, điều chỉnh tồn kho và cấp mã QR truy xuất.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href="/admin/ton-kho">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <Boxes className="w-3.5 h-3.5 text-emerald-600" />
              Bảng tổng quan tồn kho
            </Button>
          </Link>
          <Link href="/admin/ton-kho/lich-su">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <History className="w-3.5 h-3.5 text-blue-600" />
              Sổ cái kho (Ledger)
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            Làm mới
          </Button>
          <Button
            size="sm"
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            {showCreateForm ? 'Đóng biểu mẫu' : 'Nhập kho lô mới'}
          </Button>
        </div>
      </div>

      {/* Feature Flag Fail-Closed Warning Banner */}
      {!writeEnabled && (
        <div
          className={`p-4 rounded-xl border flex items-start gap-3 shadow-xs ${
            effectiveAdjustmentEnabled
              ? 'bg-blue-50/80 border-blue-200 text-blue-900'
              : 'bg-amber-50 border border-amber-200 text-amber-900'
          }`}
        >
          {effectiveAdjustmentEnabled ? (
            <Scale className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
          ) : (
            <Lock className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          )}
          <div className="space-y-1">
            <div className="font-bold text-sm flex items-center gap-2 flex-wrap">
              {effectiveAdjustmentEnabled
                ? 'Chế độ Demo có kiểm soát: Đã kích hoạt Điều chỉnh tồn kho FEFO'
                : 'Chế độ Chỉ Đọc (Khóa ghi kho an toàn — Fail-Closed)'}
              <Badge
                variant="outline"
                className={`text-[10px] ${
                  effectiveAdjustmentEnabled
                    ? 'bg-blue-100 text-blue-800 border-blue-300'
                    : 'bg-amber-100 text-amber-800 border-amber-300'
                }`}
              >
                {effectiveAdjustmentEnabled
                  ? 'ENABLE_ADMIN_INVENTORY_ADJUSTMENTS = true'
                  : 'ENABLE_ADMIN_INVENTORY_WRITES = false'}
              </Badge>
            </div>
            <p className="text-xs leading-relaxed">
              {effectiveAdjustmentEnabled
                ? 'Tính năng Điều chỉnh tồn kho (Hao hụt, Kiểm kê tăng/giảm) đã được mở cho Admin demo. Các tính năng Nhập kho mới và Đổi trạng thái lô vẫn được khóa an toàn (Fail-closed).'
                : 'Các chức năng ghi kho Admin (Nhập kho, Điều chỉnh tồn, Cập nhật trạng thái) hiện đang được bảo vệ ở trạng thái khóa trên môi trường Beta theo chính sách an toàn. Bảng điều khiển và Sổ cái đang hoạt động ở chế độ đọc dữ liệu chuẩn xác.'}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Form tạo lô / Nhập kho mới (Module A) */}
      {showCreateForm && (
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Plus className="w-4 h-4 text-emerald-600" />
              Khởi tạo Lô thu hoạch &amp; Nhập kho FEFO (Module A)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Chọn Nông sản thu hoạch *</Label>
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-sm"
                  required
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.inventoryTrackingEnabled ? '(Có quản lý FEFO)' : '(Chỉ QR)'} — Vườn: {p.farm.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Nhà vườn thu hoạch (Tự động theo sản phẩm)</Label>
                <Input
                  value={selectedProduct?.farm.name || ''}
                  disabled
                  className="bg-slate-100 text-slate-600"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Ngày thu hoạch thực tế *</Label>
                <Input
                  type="date"
                  value={harvestDate}
                  onChange={(e) => setHarvestDate(e.target.value)}
                  required
                  className="bg-white"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Hạn sử dụng dự kiến (Bắt buộc để đủ điều kiện FEFO)</Label>
                <Input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="bg-white"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Sản lượng nhập kho thực tế (Kg) *</Label>
                <Input
                  type="number"
                  min={1}
                  step="0.1"
                  value={harvestKg}
                  onChange={(e) => setHarvestKg(e.target.value)}
                  required
                  className="bg-white"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Trạng thái ban đầu &amp; Điều kiện FEFO</Label>
                <div className="flex items-center gap-4 pt-1.5">
                  <select
                    value={createStatus}
                    onChange={(e) => setCreateStatus(e.target.value as BatchStatus)}
                    className="h-10 px-3 rounded-md border border-slate-300 bg-white text-sm"
                  >
                    <option value={BatchStatus.ACTIVE}>ACTIVE (Khả dụng)</option>
                    <option value={BatchStatus.UNVERIFIED}>UNVERIFIED (Chưa xác minh)</option>
                  </select>
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isFefoEligible}
                      onChange={(e) => setIsFefoEligible(e.target.checked)}
                      disabled={createStatus !== BatchStatus.ACTIVE}
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                    />
                    <span>Đủ điều kiện xuất bán FEFO</span>
                  </label>
                </div>
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label>Mã lô tùy chỉnh (Bỏ trống để hệ thống tự sinh LO-YYMMDD-XXX)</Label>
                <Input
                  placeholder="VD: LO-RI6-261026-001"
                  value={customCode}
                  onChange={(e) => setCustomCode(e.target.value)}
                  className="bg-white"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label>Biên bản Kiểm định Chất lượng (QC Notes) *</Label>
                <Textarea
                  rows={2}
                  placeholder="Ghi rõ độ ngọt Brix, kích cỡ quả, tỷ lệ đạt chuẩn loại 1, nhiệt độ bảo quản..."
                  value={qcNotes}
                  onChange={(e) => setQcNotes(e.target.value)}
                  required
                  className="bg-white"
                />
              </div>

              <div className="md:col-span-2 flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowCreateForm(false)}>
                  Hủy
                </Button>
                <Button
                  type="submit"
                  disabled={loading || !writeEnabled}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {loading ? 'Đang ghi Sổ cái...' : writeEnabled ? 'Xác nhận Nhập kho & Sinh QR' : 'Ghi kho đang bị khóa'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* BỘ LỌC TÌM KIẾM */}
      <Card className="border-slate-200/80 shadow-xs">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <Input
                placeholder="Tìm mã lô, tên sản phẩm, nhà vườn..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-white text-xs"
              />
            </div>

            <div>
              <select
                value={productFilter}
                onChange={(e) => setProductFilter(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-slate-300 bg-white text-xs text-slate-700"
              >
                <option value="ALL">Tất cả sản phẩm</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <select
                value={farmFilter}
                onChange={(e) => setFarmFilter(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-slate-300 bg-white text-xs text-slate-700"
              >
                <option value="ALL">Tất cả nhà vườn</option>
                {uniqueFarms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-slate-300 bg-white text-xs text-slate-700"
              >
                <option value="ALL">Tất cả trạng thái</option>
                <option value={BatchStatus.ACTIVE}>ACTIVE (Khả dụng)</option>
                <option value={BatchStatus.UNVERIFIED}>UNVERIFIED (Chưa xác minh)</option>
                <option value={BatchStatus.LOCKED_QC}>LOCKED_QC (Phong tỏa)</option>
                <option value={BatchStatus.EXPIRED}>EXPIRED (Hết hạn)</option>
                <option value={BatchStatus.DEPLETED}>DEPLETED (Hết hàng)</option>
              </select>
            </div>

            <div>
              <select
                value={fefoFilter}
                onChange={(e) => setFefoFilter(e.target.value as 'ALL' | 'ELIGIBLE' | 'INELIGIBLE')}
                className="w-full h-9 px-3 rounded-md border border-slate-300 bg-white text-xs text-slate-700"
              >
                <option value="ALL">Tất cả điều kiện FEFO</option>
                <option value="ELIGIBLE">Chỉ lô ĐỦ ĐIỀU KIỆN FEFO</option>
                <option value="INELIGIBLE">Lô KHÔNG ĐỦ ĐIỀU KIỆN / Lịch sử</option>
              </select>
            </div>

            <div>
              <select
                value={expiryFilter}
                onChange={(e) => setExpiryFilter(e.target.value as 'ALL' | 'EXPIRING_SOON' | 'EXPIRED' | 'NORMAL')}
                className="w-full h-9 px-3 rounded-md border border-slate-300 bg-white text-xs text-slate-700"
              >
                <option value="ALL">Tất cả hạn dùng</option>
                <option value="EXPIRING_SOON">Sắp hết hạn (≤ 7 ngày)</option>
                <option value="EXPIRED">Đã hết hạn</option>
                <option value="NORMAL">Hạn dùng bình thường</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* PHẦN 1: DANH SÁCH LÔ ĐỦ ĐIỀU KIỆN FEFO */}
      <Card className="border-emerald-200/90 shadow-xs overflow-hidden">
        <CardHeader className="bg-emerald-50/50 border-b border-emerald-100 p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Lô Hàng Đủ Điều Kiện Xuất Bán FEFO ({fefoEligibleViews.length} lô)
              </CardTitle>
              <p className="text-xs text-slate-600 mt-0.5">
                Sắp xếp theo thứ tự ưu tiên FEFO: <strong>Hạn sử dụng gần nhất (expiryDate ASC) → Ngày thu hoạch (harvestDate ASC) → Mã lô (code ASC)</strong>.
              </p>
            </div>
          </div>
        </CardHeader>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase">
              <tr>
                <th className="px-3.5 py-3 font-semibold">Thứ tự / Mã lô</th>
                <th className="px-3.5 py-3 font-semibold">Sản phẩm &amp; Nhà vườn</th>
                <th className="px-3.5 py-3 font-semibold">Thu hoạch / Hết hạn</th>
                <th className="px-3.5 py-3 font-semibold">Trạng thái &amp; FEFO</th>
                <th className="px-3.5 py-3 font-semibold text-right">Nhập ban đầu</th>
                <th className="px-3.5 py-3 font-semibold text-right">Tồn thực tế</th>
                <th className="px-3.5 py-3 font-semibold text-right">Đang giữ chỗ</th>
                <th className="px-3.5 py-3 font-semibold text-right">Khả dụng</th>
                <th className="px-3.5 py-3 font-semibold">Cảnh báo hạn dùng</th>
                <th className="px-3.5 py-3 font-semibold text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {fefoEligibleViews.map((view, idx) => {
                const b = view.batch
                return (
                  <tr key={b.id} className="hover:bg-emerald-50/20 transition-colors">
                    <td className="px-3.5 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-600 text-white font-bold text-[10px] shrink-0">
                          {idx + 1}
                        </span>
                        <div>
                          <div className="font-mono font-bold text-slate-900 text-xs">{b.code}</div>
                          <div className="text-[10px] text-slate-400">
                            {view.ledgerEntries.length} bút toán • {view.allocations.length} giữ chỗ
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-3.5 py-3.5">
                      <div className="font-bold text-slate-900">{b.productName}</div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                        <Tractor className="w-3 h-3 text-emerald-600" />
                        {b.farmName}
                      </div>
                    </td>

                    <td className="px-3.5 py-3.5">
                      <div className="text-slate-600">
                        Hái: <strong className="text-slate-800">{formatVnDate(b.harvestDate)}</strong>
                      </div>
                      <div className="text-slate-600 mt-0.5">
                        HSD: <strong className="text-emerald-800">{formatVnDate(b.expiryDate)}</strong>
                      </div>
                    </td>

                    <td className="px-3.5 py-3.5">
                      <div className="flex flex-col items-start gap-1">
                        <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 text-[10px]">
                          {b.status}
                        </Badge>
                        <span className="text-[10px] text-emerald-700 font-semibold">
                          ✓ Đủ ĐK FEFO
                        </span>
                      </div>
                    </td>

                    <td className="px-3.5 py-3.5 text-right font-mono text-slate-600">
                      {formatAvailableKgWithUnit(b.initialQuantityGrams)}
                    </td>

                    <td className="px-3.5 py-3.5 text-right font-mono font-bold text-slate-900">
                      {formatAvailableKgWithUnit(b.physicalStockGrams)}
                    </td>

                    <td className="px-3.5 py-3.5 text-right font-mono">
                      <span className={b.reservedGrams > 0 ? 'font-bold text-amber-700' : 'text-slate-400'}>
                        {formatAvailableKgWithUnit(b.reservedGrams)}
                      </span>
                    </td>

                    <td className="px-3.5 py-3.5 text-right font-mono font-extrabold text-emerald-700 text-sm">
                      {formatAvailableKgWithUnit(b.sellableAvailableGrams)}
                    </td>

                    <td className="px-3.5 py-3.5">{renderExpiryBadge(b.expiryAlert)}</td>

                    <td className="px-3.5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDetailBatchView(view)}
                          className="h-7 px-2 text-[11px] gap-1 border-emerald-200 text-emerald-800 hover:bg-emerald-50"
                        >
                          <Eye className="w-3 h-3" /> Sổ cái
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openAdjustModal(view)}
                          className="h-7 px-2 text-[11px] gap-1 border-amber-200 text-amber-800 hover:bg-amber-50"
                          title="Điều chỉnh tồn kho / Hao hụt"
                        >
                          <Scale className="w-3 h-3" /> Điều chỉnh
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setStatusModalBatch(view)
                            setTargetStatus(b.status)
                            setTargetEligibility(b.fefoEligibility.eligible)
                            setStatusReason('')
                            setStatusQcNotes(b.qcNotes || '')
                            setStatusError(null)
                            setAuditHistory(null)
                          }}
                          className="h-7 px-2 text-[11px] gap-1 border-blue-200 text-blue-800 hover:bg-blue-50"
                          title="Quản lý trạng thái & FEFO"
                        >
                          <ShieldAlert className="w-3 h-3" /> Trạng thái
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDispatchModalBatch(view)}
                          className="h-7 px-1.5 text-[11px] text-slate-500 hover:text-slate-800"
                          title="Xuất kho"
                        >
                          <Truck className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setQrModalBatch({
                              code: b.code,
                              productName: b.productName,
                              farmName: b.farmName,
                              harvestDate: b.harvestDate,
                              harvestGrams: b.initialQuantityGrams,
                            })
                          }
                          className="h-7 px-1.5 text-[11px] text-slate-600"
                          title="In tem QR"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {fefoEligibleViews.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-slate-500 text-xs">
                    Không có lô hàng FEFO nào khớp với điều kiện lọc hiện tại.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* PHẦN 2: DANH SÁCH LÔ LỊCH SỬ / CHƯA XÁC MINH / KHÔNG ĐỦ ĐIỀU KIỆN FEFO */}
      <Card className="border-slate-200 shadow-xs overflow-hidden">
        <CardHeader className="bg-slate-50 border-b border-slate-200 p-4 sm:p-5">
          <div>
            <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-slate-500" />
              Lô Hàng Lịch Sử / Chưa Xác Minh / Không Đủ Điều Kiện FEFO ({nonEligibleViews.length} lô)
            </CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">
              Các lô này chỉ phục vụ quét mã QR và không mở bán trên Storefront.
            </p>
          </div>
        </CardHeader>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50/50 text-slate-500 border-b border-slate-200 uppercase">
              <tr>
                <th className="px-3.5 py-3 font-semibold">Mã lô</th>
                <th className="px-3.5 py-3 font-semibold">Sản phẩm &amp; Nhà vườn</th>
                <th className="px-3.5 py-3 font-semibold">Thu hoạch / HSD</th>
                <th className="px-3.5 py-3 font-semibold">Trạng thái</th>
                <th className="px-3.5 py-3 font-semibold">Lý do không mở bán</th>
                <th className="px-3.5 py-3 font-semibold text-right">Sản lượng</th>
                <th className="px-3.5 py-3 font-semibold text-right">Tồn thực tế</th>
                <th className="px-3.5 py-3 font-semibold text-right">Khả dụng</th>
                <th className="px-3.5 py-3 font-semibold text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {nonEligibleViews.map((view) => {
                const b = view.batch
                const adjustActionState = evaluateBatchAdjustActionState(b)
                return (
                  <tr key={b.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-3.5 py-3.5 font-mono font-bold text-slate-700">{b.code}</td>
                    <td className="px-3.5 py-3.5">
                      <div className="font-semibold text-slate-800">{b.productName}</div>
                      <div className="text-[11px] text-slate-400">{b.farmName}</div>
                    </td>
                    <td className="px-3.5 py-3.5">
                      <div className="text-slate-600">Hái: {formatVnDate(b.harvestDate)}</div>
                      <div className="text-[11px] text-slate-400">HSD: {formatVnDate(b.expiryDate)}</div>
                    </td>
                    <td className="px-3.5 py-3.5">
                      <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-300 text-[10px]">
                        {b.status}
                      </Badge>
                    </td>
                    <td className="px-3.5 py-3.5 text-slate-600">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px]">
                        {b.fefoEligibility.label}
                      </span>
                    </td>
                    <td className="px-3.5 py-3.5 text-right font-mono text-slate-500">
                      {b.harvestGrams ? formatAvailableKgWithUnit(b.harvestGrams) : '—'}
                    </td>
                    <td className="px-3.5 py-3.5 text-right font-mono text-slate-500">
                      {formatAvailableKgWithUnit(b.physicalStockGrams)}
                    </td>
                    <td className="px-3.5 py-3.5 text-right font-mono text-slate-400">
                      0 kg (Không mở bán)
                    </td>
                    <td className="px-3.5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDetailBatchView(view)}
                          className="h-7 px-2 text-[11px] gap-1"
                        >
                          <Eye className="w-3 h-3" /> Chi tiết
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!adjustActionState.canOpen}
                          onClick={() => openAdjustModal(view)}
                          className="h-7 px-2 text-[11px] gap-1 border-amber-200 text-amber-800 hover:bg-amber-50 disabled:opacity-45"
                          title={adjustActionState.disabledReason || 'Điều chỉnh tồn kho / Hao hụt'}
                        >
                          <Scale className="w-3 h-3" /> Điều chỉnh
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setStatusModalBatch(view)
                            setTargetStatus(b.status)
                            setTargetEligibility(b.fefoEligibility.eligible)
                            setStatusReason('')
                            setStatusQcNotes(b.qcNotes || '')
                            setStatusError(null)
                            setAuditHistory(null)
                          }}
                          className="h-7 px-2 text-[11px] gap-1 border-blue-200 text-blue-800 hover:bg-blue-50"
                        >
                          <ShieldAlert className="w-3 h-3" /> Duyệt QC
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setQrModalBatch({
                              code: b.code,
                              productName: b.productName,
                              farmName: b.farmName,
                              harvestDate: b.harvestDate,
                              harvestGrams: b.harvestGrams ?? b.initialQuantityGrams,
                            })
                          }
                          className="h-7 px-2 text-[11px] gap-1"
                        >
                          <QrCode className="w-3 h-3" /> Tem QR
                        </Button>
                        <Link href={`/truy-xuat/${b.code}`} target="_blank">
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]">
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {nonEligibleViews.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-400 text-xs">
                    Không có lô lịch sử nào trong bộ lọc.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* MODAL 1: ĐIỀU CHỈNH TỒN KHO & HAO HỤT (MODULE C) */}
      {adjustModalBatch && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-amber-600 text-white flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base flex items-center gap-2">
                  <Scale className="w-5 h-5" />
                  Điều Chỉnh Tồn Kho &amp; Hao Hụt (Module C)
                </h3>
                <p className="text-xs text-amber-100 mt-0.5">
                  Lô hàng: <strong className="font-mono text-white">{adjustModalBatch.batch.code}</strong> • {adjustModalBatch.batch.productName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdjustModalBatch(null)}
                className="p-1 rounded-full text-white/80 hover:text-white hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAdjustSubmit} className="p-6 space-y-4 text-xs">
              {adjustError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700">
                  {adjustError}
                </div>
              )}

              {/* Tình trạng tồn hiện tại */}
              <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200 text-center">
                <div>
                  <div className="text-slate-500">Tồn vật lý</div>
                  <div className="font-mono font-bold text-slate-900 mt-0.5">
                    {formatAvailableKgWithUnit(adjustModalBatch.batch.physicalStockGrams)}
                  </div>
                </div>
                <div>
                  <div className="text-amber-800">Đang giữ chỗ</div>
                  <div className="font-mono font-bold text-amber-700 mt-0.5">
                    {formatAvailableKgWithUnit(adjustModalBatch.batch.reservedGrams)}
                  </div>
                </div>
                <div>
                  <div className="text-emerald-800">Khả dụng</div>
                  <div className="font-mono font-bold text-emerald-700 mt-0.5">
                    {formatAvailableKgWithUnit(adjustModalBatch.batch.sellableAvailableGrams)}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Loại điều chỉnh tồn *</Label>
                <select
                  value={adjustType}
                  onChange={(e) => setAdjustType(e.target.value as StockAdjustmentType)}
                  className="w-full h-9 px-3 rounded-md border border-slate-300 bg-white text-xs"
                >
                  <option value="SHRINKAGE_LOSS">Hao hụt tự nhiên / Hư hỏng kho lạnh (SHRINKAGE_LOSS, Giảm tồn)</option>
                  <option value="QC_ADJUSTMENT_SUB">Điều chỉnh giảm sau kiểm kê thực tế (QC_ADJUSTMENT_SUB, Giảm tồn)</option>
                  <option value="QC_ADJUSTMENT_ADD">Điều chỉnh tăng sau kiểm kê thực tế (QC_ADJUSTMENT_ADD, Tăng tồn)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Khối lượng điều chỉnh (Kg) *</Label>
                <Input
                  type="number"
                  min={0.1}
                  step="0.1"
                  value={adjustKg}
                  onChange={(e) => setAdjustKg(e.target.value)}
                  required
                  className="bg-white"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Lý do nghiệp vụ (Bắt buộc, tối thiểu 5 ký tự) *</Label>
                <Textarea
                  rows={2}
                  placeholder="Ghi rõ lý do hao hụt, hư hỏng nhiệt độ hoặc biên bản kiểm kê..."
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  required
                  className="bg-white"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Mã biên bản / Mã tham chiếu kiểm kê (Tùy chọn)</Label>
                <Input
                  placeholder="VD: BB-KK-20261026-01"
                  value={adjustRefCode}
                  onChange={(e) => setAdjustRefCode(e.target.value)}
                  className="bg-white"
                />
              </div>

              {/* Dự kiến số dư sau điều chỉnh */}
              <div className="p-3 rounded-xl bg-blue-50/60 border border-blue-200 space-y-1">
                <div className="font-semibold text-blue-900">Dự kiến số dư sau điều chỉnh:</div>
                <div className="flex justify-between text-blue-800">
                  <span>Tồn vật lý mới:</span>
                  <strong className="font-mono">
                    {adjustType === 'QC_ADJUSTMENT_ADD'
                      ? formatAvailableKgWithUnit(
                          adjustModalBatch.batch.physicalStockGrams + Math.round(Number(adjustKg || 0) * 1000)
                        )
                      : formatAvailableKgWithUnit(
                          adjustModalBatch.batch.physicalStockGrams - Math.round(Number(adjustKg || 0) * 1000)
                        )}
                  </strong>
                </div>
                <div className="flex justify-between text-blue-800">
                  <span>Khả dụng xuất bán mới:</span>
                  <strong className="font-mono">
                    {adjustModalBatch.batch.fefoEligibility.eligible
                      ? adjustType === 'QC_ADJUSTMENT_ADD'
                        ? formatAvailableKgWithUnit(
                            adjustModalBatch.batch.sellableAvailableGrams + Math.round(Number(adjustKg || 0) * 1000)
                          )
                        : formatAvailableKgWithUnit(
                            Math.max(
                              0,
                              adjustModalBatch.batch.sellableAvailableGrams - Math.round(Number(adjustKg || 0) * 1000)
                            )
                          )
                      : '0 kg (Lô không mở bán FEFO)'}
                  </strong>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <Button type="button" variant="outline" onClick={() => setAdjustModalBatch(null)}>
                  Hủy
                </Button>
                <Button
                  type="submit"
                  disabled={adjustLoading || !effectiveAdjustmentEnabled}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {adjustLoading ? 'Đang ghi Sổ cái...' : effectiveAdjustmentEnabled ? 'Xác nhận điều chỉnh' : 'Khóa ghi kho'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: QUẢN LÝ TRẠNG THÁI & FEFO ELIGIBILITY & AUDIT TRAIL (MODULE D) */}
      {statusModalBatch && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-blue-400" />
                  Quản Lý Trạng Thái Lô &amp; Điều Kiện FEFO (Module D)
                </h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  Lô hàng: <strong className="font-mono text-white">{statusModalBatch.batch.code}</strong> • {statusModalBatch.batch.productName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStatusModalBatch(null)}
                className="p-1 rounded-full text-white/80 hover:text-white hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleStatusSubmit} className="p-6 space-y-4 text-xs">
              {statusError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700">
                  {statusError}
                </div>
              )}

              {/* Cảnh báo nếu đang có hàng giữ chỗ */}
              {statusModalBatch.batch.reservedGrams > 0 && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong>Cảnh báo bảo vệ Reservation:</strong> Lô hàng đang có{' '}
                    <strong>{formatAvailableKgWithUnit(statusModalBatch.batch.reservedGrams)}</strong> đang được giữ chỗ cho các đơn hàng. Hệ thống sẽ chặn các thao tác phong tỏa LOCKED_QC hoặc tắt FEFO để bảo vệ đơn hàng của khách.
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Trạng thái đích *</Label>
                  <select
                    value={targetStatus}
                    onChange={(e) => setTargetStatus(e.target.value as BatchStatus)}
                    className="w-full h-9 px-3 rounded-md border border-slate-300 bg-white text-xs"
                  >
                    <option value={BatchStatus.ACTIVE}>ACTIVE (Khả dụng xuất bán)</option>
                    <option value={BatchStatus.LOCKED_QC}>LOCKED_QC (Phong tỏa kiểm định)</option>
                    <option value={BatchStatus.EXPIRED}>EXPIRED (Hết hạn sử dụng)</option>
                    <option value={BatchStatus.DEPLETED}>DEPLETED (Đã xuất hết kho)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label>Cờ đủ điều kiện FEFO</Label>
                  <div className="pt-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={targetEligibility}
                        onChange={(e) => setTargetEligibility(e.target.checked)}
                        disabled={targetStatus !== BatchStatus.ACTIVE}
                        className="rounded border-slate-300 text-emerald-600 w-4 h-4"
                      />
                      <span className="font-semibold text-slate-800">Đủ điều kiện xuất bán FEFO</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Lý do thay đổi trạng thái (Bắt buộc lưu Audit Trail, tối thiểu 5 ký tự) *</Label>
                <Textarea
                  rows={2}
                  placeholder="VD: Kiểm định đạt chuẩn VietGAP sau ủ lạnh; hoặc phát hiện nấm mốc cần phong tỏa kiểm định..."
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                  required
                  className="bg-white"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Ghi chú QC bổ sung</Label>
                <Input
                  placeholder="Ghi chú chi tiết kết quả kiểm định..."
                  value={statusQcNotes}
                  onChange={(e) => setStatusQcNotes(e.target.value)}
                  className="bg-white"
                />
              </div>

              {/* Lịch sử kiểm toán (Audit Trail) */}
              <div className="border-t border-slate-200 pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-700 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-slate-500" />
                    Lịch sử chuyển trạng thái (Audit Trail)
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleFetchAuditHistory(statusModalBatch.batch.id)}
                    className="h-6 text-[10px] text-blue-600 hover:text-blue-700 p-0"
                  >
                    {loadingAuditHistory ? 'Đang tải...' : 'Xem lịch sử'}
                  </Button>
                </div>

                {auditHistory && auditHistory.length > 0 ? (
                  <div className="max-h-36 overflow-y-auto space-y-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
                    {auditHistory.map((entry, i) => (
                      <div key={i} className="text-[11px] p-2 bg-white rounded border border-slate-100 shadow-2xs">
                        <div className="flex items-center justify-between text-slate-500 text-[10px]">
                          <span>{formatVnDateTime(entry.timestamp)}</span>
                          <span className="font-mono">{entry.actorId}</span>
                        </div>
                        <div className="font-semibold text-slate-800 mt-0.5">
                          {entry.oldStatus} → {entry.newStatus} (FEFO: {entry.newEligibility ? 'Bật' : 'Tắt'})
                        </div>
                        <div className="text-slate-600 mt-0.5 italic">Lý do: {entry.reason}</div>
                      </div>
                    ))}
                  </div>
                ) : auditHistory && auditHistory.length === 0 ? (
                  <div className="p-2 text-center text-slate-400 text-[11px] bg-slate-50 rounded">
                    Chưa có nhật ký chuyển trạng thái nào cho lô này.
                  </div>
                ) : null}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <Button type="button" variant="outline" onClick={() => setStatusModalBatch(null)}>
                  Hủy
                </Button>
                <Button
                  type="submit"
                  disabled={statusLoading || !writeEnabled}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {statusLoading ? 'Đang lưu...' : writeEnabled ? 'Cập nhật trạng thái' : 'Khóa ghi kho'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: XUẤT KHO THỦ CÔNG (MODULE B — RESERVATION PROTECTION & ARCHITECTURE NOTICE) */}
      {dispatchModalBatch && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
                  <Truck className="w-5 h-5 text-slate-600" />
                  Nghiệp Vụ Xuất Kho (Module B)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Lô: <strong className="font-mono">{dispatchModalBatch.batch.code}</strong> • {dispatchModalBatch.batch.productName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDispatchModalBatch(null)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5 text-xs text-slate-700">
              <div className="font-bold text-slate-900 flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-amber-600" />
                Kiểm Soát Xuất Kho &amp; Bảo Vệ Sổ Cái FEFO
              </div>
              <p className="leading-relaxed">
                Theo thiết kế Sổ Cái FEFO chuẩn (F01A), mọi lượng xuất kho <strong>DISPATCH_OUT</strong> được tính toán để triệt tiêu đúng lượng giữ chỗ <strong>RESERVATION_HOLD</strong> của đơn hàng, chống trừ hai lần (Double-Counting).
              </p>
              <div className="p-2.5 rounded bg-white border border-slate-200 font-mono text-[11px] text-slate-800">
                Tồn thực tế: {formatAvailableKgWithUnit(dispatchModalBatch.batch.physicalStockGrams)} | Đang giữ: {formatAvailableKgWithUnit(dispatchModalBatch.batch.reservedGrams)}
              </div>
              <ul className="list-disc list-inside space-y-1 text-slate-600 text-[11px]">
                <li>
                  <strong>Xuất kho theo đơn hàng:</strong> Tự động tích hợp trong luồng Vận Chuyển &amp; Giao Hàng tại Phase 8.
                </li>
                <li>
                  <strong>Giảm kho do hư hỏng / kiểm kê:</strong> Vui lòng sử dụng tính năng <em>Điều chỉnh tồn kho (Hao hụt)</em> để ghi nhận đúng chuẩn Sổ Cái mà không làm sai lệch giữ chỗ.
                </li>
              </ul>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setDispatchModalBatch(null)}>
                Đóng
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const b = dispatchModalBatch
                  setDispatchModalBatch(null)
                  openAdjustModal(b)
                }}
                className="bg-amber-600 hover:bg-amber-700 text-white text-xs gap-1.5"
              >
                <Scale className="w-3.5 h-3.5" /> Chuyển sang Điều chỉnh tồn
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: CHI TIẾT LÔ HÀNG & SỔ CÁI */}
      {detailBatchView && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-extrabold text-base text-emerald-400">
                    {detailBatchView.batch.code}
                  </span>
                  <Badge className="bg-white/15 text-white text-[10px]">
                    {detailBatchView.batch.status}
                  </Badge>
                  {detailBatchView.batch.fefoEligibility.eligible ? (
                    <Badge className="bg-emerald-500 text-white text-[10px]">
                      Đủ điều kiện FEFO
                    </Badge>
                  ) : (
                    <Badge className="bg-slate-700 text-slate-200 text-[10px]">
                      {detailBatchView.batch.fefoEligibility.label}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-slate-300">
                  {detailBatchView.batch.productName} • Nhà vườn: {detailBatchView.batch.farmName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailBatchView(null)}
                className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto space-y-6 text-xs">
              {/* Số dư tồn kho của lô */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-slate-500">Nhập ban đầu (IMPORT)</div>
                  <div className="text-base font-extrabold text-slate-900 font-mono mt-1">
                    {formatAvailableKgWithUnit(detailBatchView.batch.initialQuantityGrams)}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-blue-50/50 border border-blue-200">
                  <div className="text-blue-800">Tồn thực tế (Physical)</div>
                  <div className="text-base font-extrabold text-blue-900 font-mono mt-1">
                    {formatAvailableKgWithUnit(detailBatchView.batch.physicalStockGrams)}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-amber-50/60 border border-amber-200">
                  <div className="text-amber-800">Đang giữ chỗ (Reserved)</div>
                  <div className="text-base font-extrabold text-amber-800 font-mono mt-1">
                    {formatAvailableKgWithUnit(detailBatchView.batch.reservedGrams)}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200">
                  <div className="text-emerald-800">Khả dụng bán (Available)</div>
                  <div className="text-base font-extrabold text-emerald-700 font-mono mt-1">
                    {formatAvailableKgWithUnit(detailBatchView.batch.sellableAvailableGrams)}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-slate-500">Đã xuất / Hao hụt</div>
                  <div className="text-base font-extrabold text-slate-800 font-mono mt-1">
                    {formatAvailableKgWithUnit(
                      detailBatchView.batch.dispatchedGrams +
                        detailBatchView.batch.shrinkageLossGrams
                    )}
                  </div>
                </div>
              </div>

              {/* Lịch sử Sổ cái */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                    <History className="w-4 h-4 text-emerald-600" />
                    Bút Toán Sổ Cái Kho (InventoryLedger — {detailBatchView.ledgerEntries.length} giao dịch)
                  </h4>
                  <Link href={`/admin/ton-kho/lich-su?batchCode=${encodeURIComponent(detailBatchView.batch.code)}`}>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] text-emerald-700">
                      Xem trang sổ cái đầy đủ →
                    </Button>
                  </Link>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Thời gian</th>
                        <th className="px-3 py-2 font-semibold">Loại giao dịch</th>
                        <th className="px-3 py-2 font-semibold text-right">Biến động</th>
                        <th className="px-3 py-2 font-semibold">Mã đơn / Tham chiếu</th>
                        <th className="px-3 py-2 font-semibold">Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {detailBatchView.ledgerEntries.map((e) => {
                        const pres = getLedgerTypePresentation(e.type)
                        return (
                          <tr key={e.id} className="hover:bg-slate-50/50">
                            <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                              {formatVnDateTime(e.createdAt)}
                            </td>
                            <td className="px-3 py-2">
                              <Badge className={`${pres.badgeClass} text-[10px]`}>
                                {pres.label}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-bold whitespace-nowrap">
                              <span className={pres.sign === '+' ? 'text-emerald-700' : 'text-rose-700'}>
                                {pres.sign}
                                {formatAvailableKgWithUnit(e.quantityGrams)}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-700">
                              {e.orderCode ? (
                                <Link
                                  href={`/admin/don-hang/${e.orderCode}`}
                                  className="text-emerald-700 hover:underline"
                                >
                                  {e.orderCode}
                                </Link>
                              ) : (
                                e.referenceCode || '—'
                              )}
                            </td>
                            <td className="px-3 py-2 text-slate-600 max-w-xs truncate">
                              {e.notes || '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {(() => {
                  const detailAdjustState = evaluateBatchAdjustActionState(detailBatchView.batch)
                  return (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!detailAdjustState.canOpen}
                      onClick={() => {
                        const target = detailBatchView
                        setDetailBatchView(null)
                        openAdjustModal(target)
                      }}
                      className="text-xs gap-1.5 border-amber-200 text-amber-800 hover:bg-amber-50 disabled:opacity-45"
                      title={detailAdjustState.disabledReason || 'Mở Điều chỉnh tồn kho & Hao hụt (Module C)'}
                    >
                      <Scale className="w-3.5 h-3.5" /> Điều chỉnh tồn
                    </Button>
                  )
                })()}
              </div>
              <Button variant="outline" size="sm" onClick={() => setDetailBatchView(null)}>
                Đóng
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: TEM QR CODE */}
      {qrModalBatch && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 relative space-y-5">
            <button
              onClick={() => setQrModalBatch(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="text-center space-y-1">
              <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                TEM TRUY XUẤT NGUỒN GỐC B2B
              </Badge>
              <h3 className="text-lg font-bold text-slate-900 pt-1">
                {qrModalBatch.productName}
              </h3>
              <p className="text-xs text-slate-500">{qrModalBatch.farmName}</p>
            </div>

            <div className="bg-slate-50 p-6 rounded-xl border border-dashed border-slate-300 flex flex-col items-center justify-center space-y-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
                  `${typeof window !== 'undefined' ? window.location.origin : ''}/truy-xuat/${qrModalBatch.code}`
                )}`}
                alt={`QR ${qrModalBatch.code}`}
                className="w-48 h-48 rounded-lg bg-white p-2 border border-slate-200 shadow-xs"
              />
              <div className="font-mono text-sm font-bold text-slate-900 tracking-wider bg-white px-3 py-1 rounded border border-slate-200">
                {qrModalBatch.code}
              </div>
              <div className="text-[11px] text-slate-500 text-center">
                Ngày thu hoạch: {formatVnDate(qrModalBatch.harvestDate)}
                {qrModalBatch.harvestGrams
                  ? ` • Khối lượng: ${gramsToKg(qrModalBatch.harvestGrams)} kg`
                  : ''}
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 gap-1.5"
                onClick={() => window.print()}
              >
                <Printer className="w-4 h-4" /> In Tem QR
              </Button>
              <Link href={`/truy-xuat/${qrModalBatch.code}`} target="_blank" className="flex-1">
                <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5">
                  <ExternalLink className="w-4 h-4" /> Mở trang truy xuất
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
