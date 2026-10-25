'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  History,
  Boxes,
  QrCode,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react'
import { InventoryLedgerType } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import type { AdminLedgerHistoryResult } from '@/lib/services/inventory-read'
import {
  formatAvailableKgWithUnit,
  getLedgerTypePresentation,
} from '@/lib/domain/inventory-view'

interface LedgerHistoryClientProps {
  result: AdminLedgerHistoryResult
  initialFilters: {
    productId: string
    batchId: string
    type: InventoryLedgerType | 'ALL'
    dateFrom: string
    dateTo: string
    search: string
  }
}

function formatVnDateTime(iso: string): string {
  const d = new Date(iso)
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

const LEDGER_TYPE_OPTIONS: Array<{ value: InventoryLedgerType | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Tất cả loại giao dịch' },
  { value: 'IMPORT', label: 'IMPORT — Nhập kho ban đầu' },
  { value: 'RESERVATION_HOLD', label: 'RESERVATION_HOLD — Giữ chỗ đơn hàng' },
  { value: 'RESERVATION_RELEASE', label: 'RESERVATION_RELEASE — Hoàn giữ chỗ' },
  { value: 'DISPATCH_OUT', label: 'DISPATCH_OUT — Xuất kho giao hàng' },
  { value: 'SHRINKAGE_LOSS', label: 'SHRINKAGE_LOSS — Hao hụt tự nhiên' },
  { value: 'QC_ADJUSTMENT', label: 'QC_ADJUSTMENT — Điều chỉnh QC' },
  { value: 'QC_ADJUSTMENT_ADD', label: 'QC_ADJUSTMENT_ADD — Kiểm định QC (+)' },
  { value: 'QC_ADJUSTMENT_SUB', label: 'QC_ADJUSTMENT_SUB — Kiểm định QC (-)' },
]

export function LedgerHistoryClient({ result, initialFilters }: LedgerHistoryClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [productId, setProductId] = useState(initialFilters.productId)
  const [batchId, setBatchId] = useState(initialFilters.batchId)
  const [type, setType] = useState<InventoryLedgerType | 'ALL'>(initialFilters.type)
  const [dateFrom, setDateFrom] = useState(initialFilters.dateFrom)
  const [dateTo, setDateTo] = useState(initialFilters.dateTo)
  const [search, setSearch] = useState(initialFilters.search)

  const buildUrl = (overrides: Partial<typeof initialFilters & { page: number }> = {}) => {
    const params = new URLSearchParams()
    const nextProduct = overrides.productId ?? productId
    const nextBatch = overrides.batchId ?? batchId
    const nextType = overrides.type ?? type
    const nextFrom = overrides.dateFrom ?? dateFrom
    const nextTo = overrides.dateTo ?? dateTo
    const nextSearch = overrides.search ?? search
    const nextPage = overrides.page ?? 1

    if (nextProduct && nextProduct !== 'ALL') params.set('productId', nextProduct)
    if (nextBatch && nextBatch !== 'ALL') params.set('batchId', nextBatch)
    if (nextType && nextType !== 'ALL') params.set('type', nextType)
    if (nextFrom) params.set('dateFrom', nextFrom)
    if (nextTo) params.set('dateTo', nextTo)
    if (nextSearch.trim()) params.set('search', nextSearch.trim())
    if (nextPage > 1) params.set('page', String(nextPage))

    const qs = params.toString()
    return qs ? `/admin/ton-kho/lich-su?${qs}` : '/admin/ton-kho/lich-su'
  }

  const handleApplyFilter = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    startTransition(() => {
      router.push(buildUrl({ page: 1 }))
    })
  }

  const handleResetFilters = () => {
    setProductId('ALL')
    setBatchId('ALL')
    setType('ALL')
    setDateFrom('')
    setDateTo('')
    setSearch('')
    startTransition(() => {
      router.push('/admin/ton-kho/lich-su')
    })
  }

  const handlePageChange = (newPage: number) => {
    startTransition(() => {
      router.push(buildUrl({ page: newPage }))
    })
  }

  const { pagination, items, filterOptions } = result

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge className="bg-blue-600 text-white hover:bg-blue-600 text-[10px]">
              Immutable Audit Log
            </Badge>
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Sổ cái bất biến (Append-only) • Múi giờ: Asia/Ho_Chi_Minh (GMT+7)
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2.5">
            <History className="w-6 h-6 text-blue-600" />
            Lịch Sử Sổ Cái Tồn Kho (Inventory Ledger)
          </h1>
          <p className="text-sm text-slate-600">
            Mọi biến động nhập kho, giữ chỗ 10 phút, hoàn giữ chỗ, xuất kho và điều chỉnh QC đều được ghi nhận kèm <code>idempotencyKey</code> chống trùng lặp.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href="/admin/ton-kho">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <Boxes className="w-3.5 h-3.5 text-emerald-600" />
              Tổng quan tồn kho
            </Button>
          </Link>
          <Link href="/admin/lo-hang">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs">
              <QrCode className="w-3.5 h-3.5 text-emerald-600" />
              Quản lý lô FEFO
            </Button>
          </Link>
          <Button
            size="sm"
            onClick={() => startTransition(() => router.refresh())}
            disabled={isPending}
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isPending ? 'animate-spin' : ''}`} />
            Làm mới
          </Button>
        </div>
      </div>

      {/* Bộ lọc Server-side (Module C — Section 7.2) */}
      <Card className="border-slate-200/80 shadow-xs">
        <CardContent className="p-4">
          <form onSubmit={handleApplyFilter} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              <div className="lg:col-span-2 relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm mã lô, mã đơn, idempotency key, ghi chú..."
                  className="pl-8 h-9 text-xs"
                />
              </div>

              <div>
                <select
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700"
                >
                  <option value="ALL">Tất cả sản phẩm</option>
                  {filterOptions.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.trackingEnabled ? '(FEFO)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <select
                  value={batchId}
                  onChange={(e) => setBatchId(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700"
                >
                  <option value="ALL">Tất cả lô hàng</option>
                  {filterOptions.batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} — {b.productName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="lg:col-span-2">
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as InventoryLedgerType | 'ALL')}
                  className="w-full h-9 px-2.5 rounded-md border border-slate-200 bg-white text-xs text-slate-700"
                >
                  {LEDGER_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500 font-medium">Khoảng ngày (GMT+7):</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-8 px-2.5 rounded-md border border-slate-200 text-xs bg-white"
                />
                <span className="text-slate-400">đến</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-8 px-2.5 rounded-md border border-slate-200 text-xs bg-white"
                />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleResetFilters}
                  className="h-8 text-xs text-slate-600"
                >
                  Đặt lại
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isPending}
                  className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-4"
                >
                  {isPending ? 'Đang lọc...' : 'Áp dụng bộ lọc'}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Bảng lịch sử InventoryLedger (Module C — Section 7.1) */}
      <Card className="border-slate-200/80 shadow-xs overflow-hidden">
        <CardHeader className="bg-slate-50/70 border-b border-slate-200/80 p-4 sm:p-5 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-bold text-slate-900">
              Danh Sách Bút Toán Sổ Cái ({pagination.totalItems} bản ghi)
            </CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">
              Trang {pagination.page} / {pagination.totalPages} (Hiển thị tối đa {pagination.pageSize} bút toán/trang). Chế độ chỉ đọc — không cho phép sửa hoặc xóa.
            </p>
          </div>
        </CardHeader>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase">
              <tr>
                <th className="px-4 py-3 font-semibold">Thời gian ghi nhận</th>
                <th className="px-4 py-3 font-semibold">Loại giao dịch</th>
                <th className="px-4 py-3 font-semibold">Mã lô</th>
                <th className="px-4 py-3 font-semibold">Sản phẩm</th>
                <th className="px-4 py-3 font-semibold text-right">Số lượng biến động</th>
                <th className="px-4 py-3 font-semibold">Mã đơn hàng</th>
                <th className="px-4 py-3 font-semibold"> Tham chiếu / Idempotency Key</th>
                <th className="px-4 py-3 font-semibold">Ghi chú</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {items.map((entry) => {
                const pres = getLedgerTypePresentation(entry.type)
                return (
                  <tr key={entry.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3.5 text-slate-700 whitespace-nowrap font-mono">
                      {formatVnDateTime(entry.createdAt)}
                    </td>

                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${pres.badgeClass}`}
                      >
                        {pres.shortLabel} ({entry.type})
                      </span>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {pres.effectDescription}
                      </div>
                    </td>

                    <td className="px-4 py-3.5">
                      <Link
                        href={`/admin/lo-hang?batchCode=${encodeURIComponent(entry.batchCode)}`}
                        className="font-mono font-bold text-slate-900 hover:text-emerald-700 hover:underline"
                      >
                        {entry.batchCode}
                      </Link>
                    </td>

                    <td className="px-4 py-3.5 font-semibold text-slate-800">
                      {entry.productName}
                    </td>

                    <td className="px-4 py-3.5 text-right font-mono">
                      <div
                        className={`font-extrabold text-sm ${
                          pres.sign === '+'
                            ? 'text-emerald-700'
                            : pres.sign === '-'
                            ? 'text-rose-700'
                            : pres.sign === 'HOLD'
                            ? 'text-amber-700'
                            : 'text-sky-700'
                        }`}
                      >
                        {pres.sign === '+'
                          ? '+'
                          : pres.sign === '-'
                          ? '-'
                          : pres.sign === 'HOLD'
                          ? '🔒 '
                          : pres.sign === 'RELEASE'
                          ? '🔓 +'
                          : ''}
                        {formatAvailableKgWithUnit(entry.quantityGrams)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        ({entry.quantityGrams.toLocaleString('vi-VN')} g)
                      </div>
                    </td>

                    <td className="px-4 py-3.5 font-mono">
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

                    <td className="px-4 py-3.5">
                      {entry.referenceCode && (
                        <div className="font-mono text-slate-800 font-semibold">
                          Ref: {entry.referenceCode}
                        </div>
                      )}
                      <div className="font-mono text-[11px] text-slate-500 break-all">
                        Key: {entry.idempotencyKey}
                      </div>
                    </td>

                    <td className="px-4 py-3.5 text-slate-600 max-w-xs">
                      {entry.notes || '—'}
                    </td>
                  </tr>
                )
              })}

              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500 text-xs">
                    Không tìm thấy bút toán InventoryLedger nào khớp với bộ lọc.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Phân trang */}
        {pagination.totalPages > 1 && (
          <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs">
            <span className="text-slate-600">
              Hiển thị {items.length} trên tổng số <strong>{pagination.totalItems}</strong> bút toán
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page <= 1 || isPending}
                onClick={() => handlePageChange(pagination.page - 1)}
                className="h-8 px-2.5 text-xs gap-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Trước
              </Button>
              <span className="font-semibold text-slate-800 px-2">
                Trang {pagination.page} / {pagination.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page >= pagination.totalPages || isPending}
                onClick={() => handlePageChange(pagination.page + 1)}
                className="h-8 px-2.5 text-xs gap-1"
              >
                Sau <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
