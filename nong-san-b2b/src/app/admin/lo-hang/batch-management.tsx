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
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { createBatch } from '@/server/actions/batch'
import { gramsToKg } from '@/lib/money'
import type { AdminBatchDetailView } from '@/lib/services/inventory-read'
import {
  formatAvailableKgWithUnit,
  getLedgerTypePresentation,
  type BatchExpiryAlert,
} from '@/lib/domain/inventory-view'

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

export function BatchManagement({
  inventoryViews,
  products,
  initialProductIdFilter = 'ALL',
  initialSearchQuery = '',
}: BatchManagementProps) {
  const router = useRouter()
  const [isRefreshing, startRefreshTransition] = useTransition()
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [selectedProductId, setSelectedProductId] = useState(products[0]?.id || '')
  const [harvestDate, setHarvestDate] = useState(new Date().toISOString().split('T')[0])
  const [harvestKg, setHarvestKg] = useState('500')
  const [qcNotes, setQcNotes] = useState('')
  const [customCode, setCustomCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [qrModalBatch, setQrModalBatch] = useState<{
    code: string
    productName: string
    farmName: string
    harvestDate: string
    harvestGrams: number | null
  } | null>(null)

  // Bộ lọc tìm kiếm (Module B — Section 6.2)
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery)
  const [productFilter, setProductFilter] = useState(initialProductIdFilter)
  const [farmFilter, setFarmFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [fefoFilter, setFefoFilter] = useState<'ALL' | 'ELIGIBLE' | 'INELIGIBLE'>('ALL')
  const [expiryFilter, setExpiryFilter] = useState<'ALL' | 'EXPIRING_SOON' | 'EXPIRED' | 'NORMAL'>('ALL')

  // Modal chi tiết lô hàng (Module B — Section 6.4)
  const [detailBatchView, setDetailBatchView] = useState<AdminBatchDetailView | null>(null)

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

  // Tách nhóm lô đủ điều kiện FEFO và lô không đủ điều kiện / UNVERIFIED (Section 6.3)
  const fefoEligibleViews = filteredViews.filter((v) => v.batch.fefoEligibility.eligible)
  const nonEligibleViews = filteredViews.filter((v) => !v.batch.fefoEligibility.eligible)

  const handleRefresh = () => {
    startRefreshTransition(() => {
      router.refresh()
    })
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProduct) return
    setLoading(true)
    setError(null)
    setSuccessMsg(null)

    const autoCode =
      customCode.trim() ||
      `LO-${harvestDate.replace(/-/g, '').slice(2)}-${String(inventoryViews.length + 1).padStart(3, '0')}`

    const res = await createBatch({
      code: autoCode,
      productId: selectedProduct.id,
      farmId: selectedProduct.farmId,
      harvestDate: new Date(harvestDate),
      quantityGrams: Math.round(Number(harvestKg) * 1000),
      note: qcNotes,
    })

    setLoading(false)
    if (!res.success) {
      setError(res.error || 'Lỗi khi tạo lô hàng')
    } else {
      setSuccessMsg(`Đã tạo thành công lô hàng ${res.batch?.code}`)
      setCustomCode('')
      setQcNotes('')
      setShowCreateForm(false)
      router.refresh()
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
            Theo dõi thứ tự xuất kho FEFO (First-Expired, First-Out), số dư sổ cái từng lô, lịch sử giữ chỗ đơn hàng và cấp mã QR truy xuất.
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
            {showCreateForm ? 'Đóng biểu mẫu' : 'Tạo lô QR truy xuất'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          {successMsg}
        </div>
      )}

      {/* Form tạo lô QR truy xuất */}
      {showCreateForm && (
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold text-slate-900">
              Khởi tạo Lô thu hoạch &amp; Cấp mã QR Truy xuất
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
                      {p.name} — Vườn: {p.farm.name}
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
                <Label>Sản lượng thu hoạch của lô (Kg) *</Label>
                <Input
                  type="number"
                  min={1}
                  step="0.5"
                  value={harvestKg}
                  onChange={(e) => setHarvestKg(e.target.value)}
                  required
                  className="bg-white"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label>Mã lô tùy chỉnh (Bỏ trống để hệ thống tự sinh theo chuẩn LO-YYMMDD-XXX)</Label>
                <Input
                  placeholder="VD: LO-261015-001"
                  value={customCode}
                  onChange={(e) => setCustomCode(e.target.value)}
                  className="bg-white"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label>Biên bản Kiểm định Chất lượng (QC Notes) *</Label>
                <Textarea
                  rows={3}
                  placeholder="Ghi rõ độ ngọt Brix, kích cỡ quả, tỷ lệ đạt chuẩn loại 1, nhiệt độ đóng gói..."
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
                  disabled={loading}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {loading ? 'Đang khởi tạo...' : 'Xác nhận & Sinh mã QR'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Thanh tìm kiếm & bộ lọc (Module B — Section 6.2) */}
      <Card className="border-slate-200/80 shadow-xs">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="lg:col-span-2 relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm mã lô (VD: F01C-SR6...), sản phẩm, nhà vườn..."
                className="pl-8 h-9 text-xs"
              />
            </div>

            <div>
              <select
                value={productFilter}
                onChange={(e) => setProductFilter(e.target.value)}
                className="w-full h-9 px-2.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700"
              >
                <option value="ALL">Tất cả sản phẩm</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.inventoryTrackingEnabled ? '(FEFO)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <select
                value={farmFilter}
                onChange={(e) => setFarmFilter(e.target.value)}
                className="w-full h-9 px-2.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700"
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
                className="w-full h-9 px-2.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700"
              >
                <option value="ALL">Mọi trạng thái lô</option>
                <option value="ACTIVE">ACTIVE (Đang hoạt động)</option>
                <option value="UNVERIFIED">UNVERIFIED (Lô QR lịch sử)</option>
                <option value="EXPIRED">EXPIRED (Hết hạn)</option>
                <option value="LOCKED_QC">LOCKED_QC (Khóa QC)</option>
                <option value="DEPLETED">DEPLETED (Đã xuất hết)</option>
              </select>
            </div>

            <div className="flex gap-2">
              <select
                value={fefoFilter}
                onChange={(e) => setFefoFilter(e.target.value as 'ALL' | 'ELIGIBLE' | 'INELIGIBLE')}
                className="w-full h-9 px-2.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700"
              >
                <option value="ALL">Mọi điều kiện FEFO</option>
                <option value="ELIGIBLE">Đủ điều kiện FEFO</option>
                <option value="INELIGIBLE">Không đủ ĐK / Lô QR</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-slate-500 font-medium mr-1">Lọc nhanh hạn dùng:</span>
              {[
                { key: 'ALL', label: 'Tất cả' },
                { key: 'NORMAL', label: 'Còn hạn an toàn (> 7 ngày)' },
                { key: 'EXPIRING_SOON', label: 'Sắp hết hạn (≤ 7 ngày)' },
                { key: 'EXPIRED', label: 'Đã hết hạn' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() =>
                    setExpiryFilter(tab.key as 'ALL' | 'EXPIRING_SOON' | 'EXPIRED' | 'NORMAL')
                  }
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                    expiryFilter === tab.key
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {(searchQuery ||
              productFilter !== 'ALL' ||
              farmFilter !== 'ALL' ||
              statusFilter !== 'ALL' ||
              fefoFilter !== 'ALL' ||
              expiryFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('')
                  setProductFilter('ALL')
                  setFarmFilter('ALL')
                  setStatusFilter('ALL')
                  setFefoFilter('ALL')
                  setExpiryFilter('ALL')
                }}
                className="text-emerald-700 hover:underline font-semibold text-xs"
              >
                Xóa bộ lọc
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* PHẦN 1: DANH SÁCH LÔ ĐỦ ĐIỀU KIỆN FEFO (SẮP XẾP THEO EXPIRY ASC, HARVEST ASC, CODE ASC) */}
      <Card className="border-emerald-200/90 shadow-xs overflow-hidden">
        <CardHeader className="bg-emerald-50/50 border-b border-emerald-100 p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Lô Hàng Đủ Điều Kiện Xuất Bán FEFO ({fefoEligibleViews.length} lô)
              </CardTitle>
              <p className="text-xs text-slate-600 mt-0.5">
                Sắp xếp tự động theo thứ tự ưu tiên xuất kho FEFO: <strong>Hạn sử dụng gần nhất (expiryDate ASC) → Ngày thu hoạch (harvestDate ASC) → Mã lô (code ASC)</strong>.
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
                      <span
                        className={
                          b.reservedGrams > 0 ? 'font-bold text-amber-700' : 'text-slate-400'
                        }
                      >
                        {formatAvailableKgWithUnit(b.reservedGrams)}
                      </span>
                    </td>

                    <td className="px-3.5 py-3.5 text-right font-mono font-extrabold text-emerald-700 text-sm">
                      {formatAvailableKgWithUnit(b.sellableAvailableGrams)}
                    </td>

                    <td className="px-3.5 py-3.5">{renderExpiryBadge(b.expiryAlert)}</td>

                    <td className="px-3.5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDetailBatchView(view)}
                          className="h-7 px-2.5 text-[11px] gap-1 border-emerald-200 text-emerald-800 hover:bg-emerald-50"
                        >
                          <Eye className="w-3 h-3" /> Chi tiết &amp; Sổ cái
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
                          className="h-7 px-2 text-[11px] text-slate-600"
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

      {/* PHẦN 2: LÔ LỊCH SỬ / UNVERIFIED / KHÔNG ĐỦ ĐIỀU KIỆN FEFO (TÁCH BIỆT RÕ RÀNG) */}
      <Card className="border-slate-200/80 shadow-xs overflow-hidden">
        <CardHeader className="bg-slate-50 border-b border-slate-200/80 p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Lock className="w-4 h-4 text-slate-500" />
                Lô Lịch Sử Truy Xuất QR / Không Thuộc Tồn Khả Dụng FEFO ({nonEligibleViews.length} lô)
              </CardTitle>
              <p className="text-xs text-slate-500 mt-0.5">
                Bao gồm các lô lịch sử <code>UNVERIFIED</code> (chỉ phục vụ quét mã QR truy xuất nguồn gốc) hoặc các lô đã hết hạn / khóa QC. Các lô này <strong>không bao giờ được cộng vào tồn khả dụng</strong> trên trang bán hàng.
              </p>
            </div>
          </div>
        </CardHeader>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase">
              <tr>
                <th className="px-3.5 py-3 font-semibold">Mã lô</th>
                <th className="px-3.5 py-3 font-semibold">Sản phẩm &amp; Nhà vườn</th>
                <th className="px-3.5 py-3 font-semibold">Thu hoạch / Hết hạn</th>
                <th className="px-3.5 py-3 font-semibold">Trạng thái</th>
                <th className="px-3.5 py-3 font-semibold">Lý do loại trừ khỏi FEFO</th>
                <th className="px-3.5 py-3 font-semibold text-right">Sản lượng ghi nhận</th>
                <th className="px-3.5 py-3 font-semibold text-right">Tồn sổ cái</th>
                <th className="px-3.5 py-3 font-semibold text-right">Khả dụng bán</th>
                <th className="px-3.5 py-3 font-semibold text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {nonEligibleViews.map((view) => {
                const b = view.batch
                return (
                  <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-3.5 py-3.5 font-mono font-bold text-slate-700">{b.code}</td>
                    <td className="px-3.5 py-3.5">
                      <div className="font-semibold text-slate-800">{b.productName}</div>
                      <div className="text-[11px] text-slate-500">{b.farmName}</div>
                    </td>
                    <td className="px-3.5 py-3.5 text-slate-600">
                      <div>Hái: {formatVnDate(b.harvestDate)}</div>
                      <div className="text-[11px] text-slate-400">
                        HSD: {formatVnDate(b.expiryDate)}
                      </div>
                    </td>
                    <td className="px-3.5 py-3.5">
                      <Badge
                        variant="outline"
                        className="bg-slate-100 text-slate-700 border-slate-300 text-[10px]"
                      >
                        {b.status}
                      </Badge>
                    </td>
                    <td className="px-3.5 py-3.5 text-slate-600">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px]">
                        Không đủ ĐK FEFO: {b.fefoEligibility.label}
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
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDetailBatchView(view)}
                          className="h-7 px-2.5 text-[11px] gap-1"
                        >
                          <Eye className="w-3 h-3" /> Chi tiết
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
                    Không có lô lịch sử / không đủ điều kiện FEFO nào trong bộ lọc.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* MODAL CHI TIẾT LÔ HÀNG: SỔ CÁI LEDGER & PHÂN BỔ GIỮ CHỖ (Module B — Section 6.4) */}
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

              {/* Thông tin lô & QC */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                <div>
                  <span className="text-slate-400 block">Ngày thu hoạch:</span>
                  <strong className="text-slate-900">
                    {formatVnDate(detailBatchView.batch.harvestDate)}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Ngày hết hạn (HSD):</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <strong className="text-slate-900">
                      {formatVnDate(detailBatchView.batch.expiryDate)}
                    </strong>
                    {renderExpiryBadge(detailBatchView.batch.expiryAlert)}
                  </div>
                </div>
                <div>
                  <span className="text-slate-400 block">Ngày nhập kho:</span>
                  <strong className="text-slate-900">
                    {formatVnDateTime(detailBatchView.batch.receivedAt || detailBatchView.batch.createdAt)}
                  </strong>
                </div>
                {detailBatchView.batch.qcNotes && (
                  <div className="sm:col-span-3 pt-2 border-t border-slate-200/70">
                    <span className="text-slate-400 block">Biên bản QC:</span>
                    <p className="text-slate-700 mt-0.5">{detailBatchView.batch.qcNotes}</p>
                  </div>
                )}
              </div>

              {/* Cảnh báo bất thường nếu có */}
              {detailBatchView.batch.anomalies.length > 0 && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-rose-600" />
                    Cảnh báo đối soát dữ liệu lô:
                  </div>
                  <ul className="list-disc pl-5">
                    {detailBatchView.batch.anomalies.map((a, idx) => (
                      <li key={idx}>{a.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Danh sách phân bổ giữ chỗ đơn hàng (OrderItemBatchAllocation) — Read-Only */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-900 text-sm">
                    1. Bản Ghi Phân Bổ &amp; Giữ Chỗ Đơn Hàng (OrderItemBatchAllocation —{' '}
                    {detailBatchView.allocations.length})
                  </h4>
                  <span className="text-[11px] text-slate-500">Chế độ xem chỉ đọc (Read-only)</span>
                </div>

                {detailBatchView.allocations.length > 0 ? (
                  <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Mã đơn hàng</th>
                          <th className="px-3 py-2 font-semibold">Trạng thái giữ chỗ</th>
                          <th className="px-3 py-2 font-semibold text-right">Đã cấp phát</th>
                          <th className="px-3 py-2 font-semibold text-right">Đã giải phóng</th>
                          <th className="px-3 py-2 font-semibold text-right">Đang khóa thực tế</th>
                          <th className="px-3 py-2 font-semibold">Thời điểm giữ</th>
                          <th className="px-3 py-2 font-semibold">Hạn giữ chỗ (10p)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {detailBatchView.allocations.map((alloc) => (
                          <tr key={alloc.id}>
                            <td className="px-3 py-2 font-mono font-bold text-emerald-700">
                              <Link
                                href={`/admin/don-hang/${alloc.orderId}`}
                                className="hover:underline"
                              >
                                {alloc.orderCode}
                              </Link>
                            </td>
                            <td className="px-3 py-2">
                              <Badge
                                variant="outline"
                                className={`text-[10px] ${
                                  alloc.status === 'HOLD_PENDING'
                                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                                    : alloc.status === 'ALLOCATED_CONFIRMED'
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : alloc.status === 'RELEASED'
                                    ? 'bg-slate-100 text-slate-600 border-slate-200'
                                    : 'bg-blue-50 text-blue-700 border-blue-200'
                                }`}
                              >
                                {alloc.status}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-right font-mono">
                              {formatAvailableKgWithUnit(alloc.allocatedGrams)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-slate-500">
                              {formatAvailableKgWithUnit(alloc.releasedGrams)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-amber-700">
                              {formatAvailableKgWithUnit(alloc.unreleasedGrams)}
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {formatVnDateTime(alloc.createdAt)}
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {formatVnDateTime(alloc.holdExpiresAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 text-slate-500 text-center">
                    Lô hàng này hiện chưa có bản ghi phân bổ đơn hàng (OrderItemBatchAllocation) nào.
                  </div>
                )}
              </div>

              {/* Lịch sử sổ cái InventoryLedger của lô */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-900 text-sm">
                    2. Lịch Sử Biến Động Sổ Cái Của Lô (InventoryLedger —{' '}
                    {detailBatchView.ledgerEntries.length})
                  </h4>
                  <Link
                    href={`/admin/ton-kho/lich-su?batchId=${detailBatchView.batch.id}`}
                    className="text-emerald-700 hover:underline font-semibold"
                  >
                    Mở trong trang Sổ cái kho →
                  </Link>
                </div>

                {detailBatchView.ledgerEntries.length > 0 ? (
                  <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Thời gian (GMT+7)</th>
                          <th className="px-3 py-2 font-semibold">Loại giao dịch</th>
                          <th className="px-3 py-2 font-semibold text-right">Khối lượng</th>
                          <th className="px-3 py-2 font-semibold">Đơn hàng</th>
                          <th className="px-3 py-2 font-semibold">Idempotency Key / Tham chiếu</th>
                          <th className="px-3 py-2 font-semibold">Ghi chú</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {detailBatchView.ledgerEntries.map((entry) => {
                          const pres = getLedgerTypePresentation(entry.type)
                          return (
                            <tr key={entry.id}>
                              <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                                {formatVnDateTime(entry.createdAt)}
                              </td>
                              <td className="px-3 py-2">
                                <span
                                  className={`inline-flex px-2 py-0.5 rounded border text-[10px] font-semibold ${pres.badgeClass}`}
                                >
                                  {pres.shortLabel} ({entry.type})
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                                {pres.sign === '+' ? '+' : pres.sign === '-' ? '-' : ''}
                                {formatAvailableKgWithUnit(entry.quantityGrams)}
                              </td>
                              <td className="px-3 py-2 font-mono">
                                {entry.orderCode && entry.orderId ? (
                                  <Link
                                    href={`/admin/don-hang/${entry.orderId}`}
                                    className="text-emerald-700 font-bold hover:underline"
                                  >
                                    {entry.orderCode}
                                  </Link>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                                {entry.idempotencyKey}
                              </td>
                              <td className="px-3 py-2 text-slate-600 max-w-xs truncate">
                                {entry.notes || '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 text-slate-500 text-center">
                    Lô hàng này không có bút toán InventoryLedger (Lô lịch sử chỉ phục vụ truy xuất QR).
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setDetailBatchView(null)}>
                Đóng
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal hiển thị & In Tem QR Code cho Lô hàng */}
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
