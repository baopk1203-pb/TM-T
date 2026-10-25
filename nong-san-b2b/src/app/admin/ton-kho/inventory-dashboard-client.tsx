'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Boxes,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Clock,
  Lock,
  PackageCheck,
  History,
  QrCode,
  ExternalLink,
  Search,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import type { AdminInventoryDashboardData } from '@/lib/services/inventory-read'
import {
  formatAvailableKgWithUnit,
  type BatchExpiryAlert,
  type EvaluatedProductInventory,
  type ProductStockAlert,
} from '@/lib/domain/inventory-view'

interface InventoryDashboardClientProps {
  data: AdminInventoryDashboardData
}

function formatVnDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

function formatVnDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d)
}

function renderExpiryBadge(alert: BatchExpiryAlert | null) {
  if (!alert) {
    return <span className="text-xs text-slate-400">—</span>
  }
  switch (alert.level) {
    case 'EXPIRED':
      return (
        <Badge className="bg-rose-100 text-rose-800 border border-rose-200 hover:bg-rose-100 text-[11px]">
          {alert.label}
        </Badge>
      )
    case 'EXPIRING_3_DAYS':
      return (
        <Badge className="bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-100 text-[11px]">
          {alert.label}
        </Badge>
      )
    case 'EXPIRING_7_DAYS':
      return (
        <Badge className="bg-yellow-50 text-yellow-800 border border-yellow-200 hover:bg-yellow-50 text-[11px]">
          {alert.label}
        </Badge>
      )
    case 'UNKNOWN_EXPIRY':
      return (
        <Badge variant="outline" className="text-slate-500 border-slate-300 text-[11px]">
          {alert.label}
        </Badge>
      )
    case 'NORMAL':
    default:
      return (
        <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-50 text-[11px]">
          {alert.label}
        </Badge>
      )
  }
}

function renderStockAlertBadge(alert: ProductStockAlert) {
  switch (alert.level) {
    case 'UNTRACKED':
      return (
        <Badge variant="outline" className="text-slate-600 bg-slate-50 border-slate-200 text-[11px]">
          {alert.label}
        </Badge>
      )
    case 'DATA_ERROR':
      return (
        <Badge className="bg-rose-600 text-white hover:bg-rose-600 text-[11px]">
          {alert.label}
        </Badge>
      )
    case 'OUT_OF_STOCK':
      return (
        <Badge className="bg-rose-100 text-rose-800 border border-rose-200 hover:bg-rose-100 text-[11px]">
          {alert.label}
        </Badge>
      )
    case 'BELOW_MOQ':
      return (
        <Badge className="bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-100 text-[11px]">
          {alert.label}
        </Badge>
      )
    case 'LOW_STOCK':
      return (
        <Badge className="bg-yellow-50 text-yellow-800 border border-yellow-200 hover:bg-yellow-50 text-[11px]">
          {alert.label}
        </Badge>
      )
    case 'NORMAL':
    default:
      return (
        <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-50 text-[11px]">
          {alert.label}
        </Badge>
      )
  }
}

export function InventoryDashboardClient({ data }: InventoryDashboardClientProps) {
  const router = useRouter()
  const [isRefreshing, startTransition] = useTransition()
  const [trackingFilter, setTrackingFilter] = useState<'ALL' | 'TRACKED' | 'UNTRACKED'>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null)

  const handleRefresh = () => {
    startTransition(() => {
      router.refresh()
    })
  }

  const filteredProducts = data.products.filter((p) => {
    if (trackingFilter === 'TRACKED' && !p.inventoryTrackingEnabled) return false
    if (trackingFilter === 'UNTRACKED' && p.inventoryTrackingEnabled) return false
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      return (
        p.name.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        p.farmName.toLowerCase().includes(q) ||
        p.batches.some((b) => b.code.toLowerCase().includes(q))
      )
    }
    return true
  })

  const toggleExpand = (productId: string) => {
    setExpandedProductId((prev) => (prev === productId ? null : productId))
  }

  const { kpis } = data

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600 text-[10px]">
              FEFO Engine F01D
            </Badge>
            <span className="text-xs text-slate-500">
              Cập nhật lúc: <strong className="text-slate-700">{formatVnDateTime(data.observedAt)}</strong> (GMT+7)
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2.5">
            <Boxes className="w-6 h-6 text-emerald-600" />
            Trung Tâm Quản Lý Tồn Kho FEFO
          </h1>
          <p className="text-sm text-slate-600">
            Đối soát thời gian thực giữa Tồn vật lý (Physical), Đang giữ chỗ (Reserved 10 phút / Đã xác nhận) và Tồn khả dụng công khai trên trang bán hàng.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Link href="/admin/lo-hang">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <QrCode className="w-3.5 h-3.5 text-emerald-600" />
              Quản lý lô FEFO ({kpis.totalBatchesCount})
            </Button>
          </Link>
          <Link href="/admin/ton-kho/lich-su">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <History className="w-3.5 h-3.5 text-blue-600" />
              Sổ cái kho (Ledger)
            </Button>
          </Link>
          <Button
            onClick={handleRefresh}
            disabled={isRefreshing}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Đang tải lại...' : 'Làm mới số liệu'}
          </Button>
        </div>
      </div>

      {/* 8 KPI Cards (Module A — Section 5.1) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-slate-200/80 shadow-xs">
          <CardContent className="p-5 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>SP Bật Quản Lý Tồn Kho</span>
              <PackageCheck className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-extrabold text-slate-900">
              {kpis.trackedProductsCount}{' '}
              <span className="text-sm font-medium text-slate-500">
                / {kpis.totalProductsCount} sản phẩm
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              {kpis.untrackedProductsCount} sản phẩm chưa bật quản lý tồn kho
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-xs">
          <CardContent className="p-5 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>Lô FEFO Đang Hoạt Động</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-extrabold text-emerald-700">
              {kpis.eligibleActiveBatchesCount}{' '}
              <span className="text-sm font-medium text-slate-500">lô ACTIVE hợp lệ</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Tách biệt {kpis.unverifiedBatchesCount} lô lịch sử UNVERIFIED (chỉ tra cứu QR)
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-xs">
          <CardContent className="p-5 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>Tổng Tồn Thực Tế (Physical)</span>
              <Boxes className="w-4 h-4 text-blue-600" />
            </div>
            <div className="text-2xl font-extrabold text-slate-900">
              {formatAvailableKgWithUnit(kpis.totalPhysicalStockGrams)}
            </div>
            <p className="text-[11px] text-slate-500">
              Đã xuất: {formatAvailableKgWithUnit(kpis.totalDispatchedStockGrams)}
            </p>
          </CardContent>
        </Card>

        <Card className="border-emerald-200 bg-emerald-50/40 shadow-xs">
          <CardContent className="p-5 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-emerald-800">
              <span>Tổng Tồn Khả Dụng (Available)</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-extrabold text-emerald-700">
              {formatAvailableKgWithUnit(kpis.totalAvailableStockGrams)}
            </div>
            <p className="text-[11px] text-emerald-800/80">
              Số lượng thực tế khách sỉ có thể đặt trên Storefront
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-xs">
          <CardContent className="p-5 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>Tổng Đang Giữ Chỗ (Reserved)</span>
              <Lock className="w-4 h-4 text-amber-600" />
            </div>
            <div className="text-2xl font-extrabold text-amber-700">
              {formatAvailableKgWithUnit(kpis.totalReservedStockGrams)}
            </div>
            <p className="text-[11px] text-slate-500">
              Gồm đơn giữ chỗ 10 phút &amp; đơn đã xác nhận chờ xuất
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-xs">
          <CardContent className="p-5 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>Lô Sắp Hết Hạn (≤ 7 ngày)</span>
              <Clock className="w-4 h-4 text-amber-600" />
            </div>
            <div className="text-2xl font-extrabold text-slate-900">
              {kpis.expiringWithin7DaysBatchesCount}{' '}
              <span className="text-sm font-medium text-slate-500">lô</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Trong đó khẩn cấp (≤ 3 ngày): <strong>{kpis.expiringWithin3DaysBatchesCount} lô</strong>
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-xs">
          <CardContent className="p-5 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>Lô Đã Hết Hạn</span>
              <AlertTriangle className="w-4 h-4 text-rose-600" />
            </div>
            <div className="text-2xl font-extrabold text-slate-900">
              {kpis.expiredBatchesCount}{' '}
              <span className="text-sm font-medium text-slate-500">lô</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Tồn không đủ ĐK bán: {formatAvailableKgWithUnit(kpis.totalIneligibleStockGrams)}
            </p>
          </CardContent>
        </Card>

        <Card
          className={`shadow-xs ${
            kpis.batchesWithAnomaliesCount > 0
              ? 'border-rose-300 bg-rose-50/40'
              : 'border-slate-200/80'
          }`}
        >
          <CardContent className="p-5 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>Lô Bất Thường / Cần Kiểm Tra</span>
              <ShieldAlert
                className={`w-4 h-4 ${
                  kpis.batchesWithAnomaliesCount > 0 ? 'text-rose-600' : 'text-emerald-600'
                }`}
              />
            </div>
            <div
              className={`text-2xl font-extrabold ${
                kpis.batchesWithAnomaliesCount > 0 ? 'text-rose-700' : 'text-emerald-700'
              }`}
            >
              {kpis.batchesWithAnomaliesCount}{' '}
              <span className="text-sm font-medium text-slate-500">lô bất thường</span>
            </div>
            <p className="text-[11px] text-slate-500">
              {kpis.batchesWithAnomaliesCount === 0
                ? '100% sổ cái khớp phân bổ giữ chỗ'
                : 'Cần đối soát sổ cái & phân bổ'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Product Inventory Table (Module A — Section 5.2) */}
      <Card className="border-slate-200/80 shadow-xs overflow-hidden">
        <CardHeader className="bg-slate-50/70 border-b border-slate-200/80 p-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base font-bold text-slate-900">
                Bảng Tồn Kho Theo Sản Phẩm ({filteredProducts.length}/{data.products.length})
              </CardTitle>
              <p className="text-xs text-slate-500 mt-0.5">
                Số liệu Khả dụng tại đây dùng chung một nguồn tính toán (Shared Read Service) với trang Bán hàng công khai.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setTrackingFilter('ALL')}
                  className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
                    trackingFilter === 'ALL'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Tất cả ({data.kpis.totalProductsCount})
                </button>
                <button
                  type="button"
                  onClick={() => setTrackingFilter('TRACKED')}
                  className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
                    trackingFilter === 'TRACKED'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Đang bật FEFO ({data.kpis.trackedProductsCount})
                </button>
                <button
                  type="button"
                  onClick={() => setTrackingFilter('UNTRACKED')}
                  className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
                    trackingFilter === 'UNTRACKED'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Chưa bật ({data.kpis.untrackedProductsCount})
                </button>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm sản phẩm, nhà vườn, mã lô..."
                  className="pl-8 h-8 text-xs bg-white"
                />
              </div>
            </div>
          </div>
        </CardHeader>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 font-semibold">Sản phẩm</th>
                <th className="px-4 py-3 font-semibold">Trạng thái quản lý</th>
                <th className="px-4 py-3 font-semibold text-center">Số lô hợp lệ</th>
                <th className="px-4 py-3 font-semibold text-right">Tồn thực tế</th>
                <th className="px-4 py-3 font-semibold text-right">Đang giữ chỗ</th>
                <th className="px-4 py-3 font-semibold text-right">Khả dụng (Storefront)</th>
                <th className="px-4 py-3 font-semibold">Hạn dùng gần nhất</th>
                <th className="px-4 py-3 font-semibold">Cảnh báo</th>
                <th className="px-4 py-3 font-semibold text-right">Chi tiết</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {filteredProducts.map((product: EvaluatedProductInventory) => {
                const isExpanded = expandedProductId === product.productId
                return (
                  <ProductInventoryRowGroup
                    key={product.productId}
                    product={product}
                    isExpanded={isExpanded}
                    onToggleExpand={() => toggleExpand(product.productId)}
                  />
                )
              })}
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500 text-xs">
                    Không tìm thấy sản phẩm phù hợp với bộ lọc.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Module D — Inventory Alerts & Rules Explanation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cảnh báo hạn dùng & bất thường */}
        <Card className="border-slate-200/80 shadow-xs">
          <CardHeader className="p-5 border-b border-slate-100">
            <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600" />
              Cảnh Báo Hạn Dùng &amp; Đối Soát Dữ Liệu Lô Hàng
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            {data.batchesWithAnomalies.length > 0 ? (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900 space-y-2">
                <div className="font-bold flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-rose-600" />
                  Phát hiện {data.batchesWithAnomalies.length} lô có bất thường dữ liệu:
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  {data.batchesWithAnomalies.map((b) =>
                    b.anomalies.map((a, idx) => (
                      <li key={`${b.id}-${idx}`}>
                        <strong>{b.code}</strong> ({b.productName}): {a.message}
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs text-emerald-900 flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <div>
                  <strong>Đối soát sổ cái &amp; phân bổ: An toàn (0 bất thường)</strong>
                  <p className="text-[11px] text-emerald-700 mt-0.5">
                    Toàn bộ lô FEFO ACTIVE đều có sổ cái hợp lệ, không có số dư âm hoặc sai lệch giữa Allocation và InventoryLedger.
                  </p>
                </div>
              </div>
            )}

            {data.expiringAndExpiredBatches.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-700">
                  Các lô sắp hết hạn hoặc đã hết hạn ({data.expiringAndExpiredBatches.length}):
                </div>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                  {data.expiringAndExpiredBatches.map((b) => (
                    <div
                      key={b.id}
                      className="p-3 bg-white flex items-center justify-between text-xs gap-2"
                    >
                      <div>
                        <span className="font-mono font-bold text-slate-900">{b.code}</span>
                        <span className="text-slate-500 ml-2">{b.productName}</span>
                        <div className="text-[11px] text-slate-400">
                          HSD: {formatVnDate(b.expiryDate)} • Khả dụng:{' '}
                          {formatAvailableKgWithUnit(b.sellableAvailableGrams)}
                        </div>
                      </div>
                      {renderExpiryBadge(b.expiryAlert)}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-600">
                Hiện không có lô FEFO nào sắp hết hạn trong vòng 7 ngày tới hoặc đã quá hạn.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quy tắc nghiệp vụ FEFO & Cảnh báo tồn thấp */}
        <Card className="border-slate-200/80 shadow-xs">
          <CardHeader className="p-5 border-b border-slate-100">
            <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Info className="w-4 h-4 text-emerald-600" />
              Quy Tắc Tính Tồn Kho &amp; Ngưỡng Cảnh Báo B2B
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-3 text-xs text-slate-600 leading-relaxed">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
              <div className="font-bold text-slate-900">1. Công thức số dư chuẩn từ InventoryLedger:</div>
              <p>
                • <strong>Tồn thực tế (Physical):</strong>{' '}
                <code className="bg-white px-1.5 py-0.5 rounded border text-[11px]">
                  IMPORT - DISPATCH_OUT - SHRINKAGE_LOSS ± QC_ADJUSTMENT
                </code>
              </p>
              <p>
                • <strong>Đang giữ chỗ (Reserved):</strong>{' '}
                <code className="bg-white px-1.5 py-0.5 rounded border text-[11px]">
                  RESERVATION_HOLD - RESERVATION_RELEASE - DISPATCH_OUT
                </code>
              </p>
              <p>
                • <strong>Tồn khả dụng (Available):</strong> Tổng{' '}
                <code className="bg-white px-1.5 py-0.5 rounded border text-[11px]">
                  Physical - Reserved
                </code>{' '}
                của các lô <strong className="text-emerald-700">ACTIVE + Đủ điều kiện FEFO + Chưa hết hạn</strong>.
              </p>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
              <div className="font-bold text-slate-900">2. Ngưỡng cảnh báo tồn thấp theo MOQ B2B:</div>
              <p>
                • <strong>Hết tồn khả dụng:</strong> <code className="text-rose-700">Khả dụng = 0 kg</code>
              </p>
              <p>
                • <strong>Tồn thấp (Dưới MOQ):</strong>{' '}
                <code className="text-amber-700">0 &lt; Khả dụng &lt; MOQ</code> (Khách sỉ không thể đặt đơn tiêu chuẩn).
              </p>
              <p>
                • <strong>Sắp chạm ngưỡng MOQ:</strong>{' '}
                <code className="text-yellow-700">MOQ ≤ Khả dụng &lt; 2 × MOQ</code>.
              </p>
              <p>
                • <strong>Tồn bình thường:</strong>{' '}
                <code className="text-emerald-700">Khả dụng ≥ 2 × MOQ</code>.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function ProductInventoryRowGroup({
  product,
  isExpanded,
  onToggleExpand,
}: {
  product: EvaluatedProductInventory
  isExpanded: boolean
  onToggleExpand: () => void
}) {
  return (
    <>
      <tr className="hover:bg-slate-50/80 transition-colors">
        <td className="px-4 py-3.5">
          <div className="font-bold text-slate-900 flex items-center gap-1.5">
            <span>{product.name}</span>
            <Link
              href={`/san-pham/${product.slug}`}
              target="_blank"
              className="text-slate-400 hover:text-emerald-600 transition-colors"
              title="Xem trên trang bán hàng"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Vườn: {product.farmName} • MOQ: {formatAvailableKgWithUnit(product.moqGrams)}
          </div>
        </td>

        <td className="px-4 py-3.5">
          {product.inventoryTrackingEnabled ? (
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600 text-[11px]">
              Đang bật FEFO
            </Badge>
          ) : (
            <Badge variant="outline" className="text-slate-500 bg-slate-50 border-slate-200 text-[11px]">
              Chưa bật quản lý tồn kho
            </Badge>
          )}
        </td>

        <td className="px-4 py-3.5 text-center">
          {product.inventoryTrackingEnabled ? (
            <div>
              <span className="font-bold text-slate-900">{product.eligibleActiveBatchesCount}</span>
              <span className="text-xs text-slate-500"> lô FEFO</span>
              {product.unverifiedBatchesCount > 0 && (
                <div className="text-[10px] text-slate-400">
                  (+{product.unverifiedBatchesCount} lô QR lịch sử)
                </div>
              )}
            </div>
          ) : (
            <span className="text-xs text-slate-400">—</span>
          )}
        </td>

        <td className="px-4 py-3.5 text-right font-mono">
          {product.inventoryTrackingEnabled ? (
            <span className="font-semibold text-slate-900">
              {formatAvailableKgWithUnit(product.physicalStockGrams)}
            </span>
          ) : (
            <span className="text-xs text-slate-400 font-sans">Không áp dụng</span>
          )}
        </td>

        <td className="px-4 py-3.5 text-right font-mono">
          {product.inventoryTrackingEnabled ? (
            <span
              className={`font-semibold ${
                product.reservedStockGrams > 0 ? 'text-amber-700' : 'text-slate-500'
              }`}
            >
              {formatAvailableKgWithUnit(product.reservedStockGrams)}
            </span>
          ) : (
            <span className="text-xs text-slate-400 font-sans">—</span>
          )}
        </td>

        <td className="px-4 py-3.5 text-right">
          {product.inventoryTrackingEnabled ? (
            <div>
              <span
                className={`font-mono font-extrabold text-sm ${
                  product.availableStockGrams >= product.moqGrams
                    ? 'text-emerald-700'
                    : product.availableStockGrams > 0
                    ? 'text-amber-700'
                    : 'text-rose-700'
                }`}
              >
                {formatAvailableKgWithUnit(product.availableStockGrams)}
              </span>
              <div className="text-[10px] text-slate-500">
                Hiển thị: {product.publicStock.cardBadgeLabel}
              </div>
            </div>
          ) : (
            <span className="text-xs text-slate-400 italic">Đặt hàng theo mùa vụ</span>
          )}
        </td>

        <td className="px-4 py-3.5">
          {product.inventoryTrackingEnabled && product.nearestExpiryDate ? (
            <div className="space-y-1">
              <div className="text-xs font-medium text-slate-800">
                {formatVnDate(product.nearestExpiryDate)}
              </div>
              {renderExpiryBadge(product.nearestExpiryAlert)}
            </div>
          ) : (
            <span className="text-xs text-slate-400">—</span>
          )}
        </td>

        <td className="px-4 py-3.5">{renderStockAlertBadge(product.stockAlert)}</td>

        <td className="px-4 py-3.5 text-right">
          {product.batches.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleExpand}
              className="text-xs text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 gap-1 h-8 px-2.5"
            >
              <span>{isExpanded ? 'Thu gọn' : `Xem ${product.batches.length} lô`}</span>
              {isExpanded ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </Button>
          ) : (
            <span className="text-xs text-slate-400">Chưa có lô</span>
          )}
        </td>
      </tr>

      {isExpanded && product.batches.length > 0 && (
        <tr className="bg-slate-50/90">
          <td colSpan={9} className="px-6 py-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-bold text-slate-800">
                  Chi tiết các lô hàng của {product.name} (Sắp xếp theo thứ tự ưu tiên xuất FEFO)
                </div>
                <div className="flex items-center gap-2">
                  <Link href={`/admin/lo-hang?productId=${product.productId}`}>
                    <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1">
                      <QrCode className="w-3 h-3" /> Mở trong Quản lý lô
                    </Button>
                  </Link>
                  <Link href={`/admin/ton-kho/lich-su?productId=${product.productId}`}>
                    <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1">
                      <History className="w-3 h-3" /> Xem sổ cái SP này
                    </Button>
                  </Link>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-t border-slate-100">
                  <thead className="text-slate-500 bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Mã lô</th>
                      <th className="px-3 py-2 font-semibold">Trạng thái</th>
                      <th className="px-3 py-2 font-semibold">Điều kiện FEFO</th>
                      <th className="px-3 py-2 font-semibold">Ngày thu hoạch</th>
                      <th className="px-3 py-2 font-semibold">Hạn sử dụng</th>
                      <th className="px-3 py-2 font-semibold text-right">Nhập ban đầu</th>
                      <th className="px-3 py-2 font-semibold text-right">Tồn thực tế</th>
                      <th className="px-3 py-2 font-semibold text-right">Đang giữ chỗ</th>
                      <th className="px-3 py-2 font-semibold text-right">Khả dụng FEFO</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {product.batches.map((b, idx) => (
                      <tr key={b.id} className={b.fefoEligibility.eligible ? '' : 'opacity-70 bg-slate-50/50'}>
                        <td className="px-3 py-2 font-mono font-bold text-slate-900">
                          {b.fefoEligibility.eligible && (
                            <span className="inline-block w-4 h-4 rounded-full bg-emerald-100 text-emerald-800 text-[10px] text-center leading-4 mr-1.5 font-sans">
                              {idx + 1}
                            </span>
                          )}
                          {b.code}
                        </td>
                        <td className="px-3 py-2">
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              b.status === 'ACTIVE'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-slate-200 bg-slate-100 text-slate-600'
                            }`}
                          >
                            {b.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          {b.fefoEligibility.eligible ? (
                            <span className="text-emerald-700 font-semibold">Đủ điều kiện FEFO</span>
                          ) : (
                            <span className="text-slate-500">{b.fefoEligibility.label}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{formatVnDate(b.harvestDate)}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-800">{formatVnDate(b.expiryDate)}</span>
                            {b.isFefoEligible && renderExpiryBadge(b.expiryAlert)}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-600">
                          {formatAvailableKgWithUnit(b.initialQuantityGrams)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900">
                          {formatAvailableKgWithUnit(b.physicalStockGrams)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-amber-700">
                          {formatAvailableKgWithUnit(b.reservedGrams)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700">
                          {formatAvailableKgWithUnit(b.sellableAvailableGrams)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
