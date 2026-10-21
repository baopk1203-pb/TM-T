'use client'

import { useState } from 'react'
import {
  QrCode,
  Plus,
  Download,
  Trash2,
  ExternalLink,
  Loader2,
  Sparkles,
  Calendar,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { gramsToKg, kgToGrams } from '@/lib/money'
import {
  createBatch,
  deleteBatch,
  generateNextBatchCode,
} from '@/server/actions/batch'
import { BatchInput } from '@/lib/validators/batch'

interface BatchItem {
  id: string
  code: string
  productId: string
  farmId: string
  harvestDate: Date | string
  quantityGrams: number
  note: string | null
  product: { id: string; name: string; slug: string; images: string[] }
  farm: { id: string; name: string; province: string }
  _count: { orderItems: number }
}

interface ProductOption {
  id: string
  name: string
  farmId: string
  farm: { id: string; name: string }
}

export function BatchManagement({
  initialBatches,
  products,
}: {
  initialBatches: BatchItem[]
  products: ProductOption[]
}) {
  const [batches, setBatches] = useState<BatchItem[]>(initialBatches)
  const [search, setSearch] = useState('')

  // Create Modal State
  const [dialogOpen, setDialogOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [code, setCode] = useState('')
  const [productId, setProductId] = useState(products[0]?.id || '')
  const [farmId, setFarmId] = useState(products[0]?.farmId || '')
  const [harvestDate, setHarvestDate] = useState(
    new Date().toISOString().split('T')[0]
  )
  const [quantityKg, setQuantityKg] = useState(3000)
  const [note, setNote] = useState('')

  // QR Preview Modal State
  const [previewBatch, setPreviewBatch] = useState<BatchItem | null>(null)
  const [qrModalOpen, setQrModalOpen] = useState(false)

  // Open Create Dialog
  const openCreateDialog = async () => {
    try {
      const suggestedCode = await generateNextBatchCode()
      setCode(suggestedCode)
    } catch {
      setCode(`LO-${Date.now().toString().slice(-6)}`)
    }

    if (products.length > 0) {
      setProductId(products[0].id)
      setFarmId(products[0].farmId)
    }
    setHarvestDate(new Date().toISOString().split('T')[0])
    setQuantityKg(3000)
    setNote('')
    setDialogOpen(true)
  }

  // When product changes, auto-sync farmId
  const handleProductChange = (prodId: string | null) => {
    if (!prodId) return
    setProductId(prodId)
    const match = products.find((p) => p.id === prodId)
    if (match) {
      setFarmId(match.farmId)
    }
  }

  // Submit Batch
  const handleSaveBatch = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const payload: BatchInput = {
      code: code.trim().toUpperCase(),
      productId,
      farmId,
      harvestDate: new Date(harvestDate),
      quantityGrams: kgToGrams(quantityKg),
      note: note.trim() || undefined,
    }

    try {
      const res = await createBatch(payload)
      if (!res.success || !res.batch) {
        toast.error(res.error || 'Lỗi khi tạo lô hàng')
      } else {
        toast.success(res.message)
        const matchProduct = products.find((p) => p.id === productId)
        const newBatchItem: BatchItem = {
          ...res.batch,
          product: {
            id: matchProduct?.id || productId,
            name: matchProduct?.name || '',
            slug: '',
            images: [],
          },
          farm: {
            id: matchProduct?.farm.id || farmId,
            name: matchProduct?.farm.name || '',
            province: '',
          },
          _count: { orderItems: 0 },
        }
        setBatches((prev) => [newBatchItem, ...prev])
        setDialogOpen(false)
      }
    } catch {
      toast.error('Lỗi kết nối máy chủ')
    } finally {
      setLoading(false)
    }
  }

  // Delete Batch
  const handleDeleteBatch = async (batch: BatchItem) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa lô hàng "${batch.code}"?`)) return

    const res = await deleteBatch(batch.id)
    if (!res.success) {
      toast.error(res.error)
    } else {
      toast.success(res.message)
      setBatches((prev) => prev.filter((b) => b.id !== batch.id))
    }
  }

  // Open QR modal
  const openQrModal = (batch: BatchItem) => {
    setPreviewBatch(batch)
    setQrModalOpen(true)
  }

  const filteredBatches = batches.filter(
    (b) =>
      b.code.toLowerCase().includes(search.toLowerCase()) ||
      b.product.name.toLowerCase().includes(search.toLowerCase()) ||
      b.farm.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 sm:p-7 rounded-3xl border border-slate-200/90 shadow-card">
        <div className="space-y-1">
          <h1 className="font-heading text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2.5">
            <QrCode className="w-6 h-6 text-emerald-600" />
            Quản Lý Lô Hàng &amp; Tem Mã QR
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Theo dõi từng đợt thu hoạch từ nhà vườn và tự động tạo mã QR truy xuất nguồn gốc công khai.
          </p>
        </div>
        <Button onClick={openCreateDialog} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-full font-bold text-xs h-10 px-5 gap-2 shadow-btn-glow hover:-translate-y-0.5 transition-all">
          <Plus className="w-4 h-4" /> Thêm Lô Hàng Mới
        </Button>
      </div>

      <div className="bg-white p-4 sm:p-5 rounded-3xl border border-slate-200/90 shadow-card flex items-center gap-4">
        <Input
          placeholder="Tìm theo mã lô (LO-...), tên sản phẩm, nhà vườn..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md bg-white rounded-2xl border-slate-200/90 text-xs h-10 pl-4"
        />
      </div>

      <div className="bg-white rounded-3xl border border-slate-200/90 overflow-hidden shadow-card">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead className="font-bold text-slate-900">Mã Lô Hàng</TableHead>
              <TableHead className="font-bold text-slate-900">Sản Phẩm & Vườn Thu Hoạch</TableHead>
              <TableHead className="font-bold text-slate-900 text-center">Ngày Cắt Vườn</TableHead>
              <TableHead className="font-bold text-slate-900 text-right">Sản Lượng Lô</TableHead>
              <TableHead className="font-bold text-slate-900 text-center">Tem Mã QR</TableHead>
              <TableHead className="text-right font-bold text-slate-900">Thao Tác</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredBatches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                  Không tìm thấy lô hàng nào phù hợp
                </TableCell>
              </TableRow>
            ) : (
              filteredBatches.map((batch) => (
                <TableRow key={batch.id} className="hover:bg-slate-50">
                  <TableCell className="font-mono font-bold text-emerald-700">
                    {batch.code}
                  </TableCell>

                  <TableCell>
                    <div className="font-semibold text-slate-900">{batch.product.name}</div>
                    <div className="text-xs text-slate-500">
                      Vườn: <strong>{batch.farm.name}</strong>
                    </div>
                    {batch.note && (
                      <div className="text-[11px] text-slate-400 italic line-clamp-1 mt-0.5">
                        {batch.note}
                      </div>
                    )}
                  </TableCell>

                  <TableCell className="text-center text-xs text-slate-700">
                    <span className="inline-flex items-center gap-1 font-medium">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      {new Date(batch.harvestDate).toLocaleDateString('vi-VN')}
                    </span>
                  </TableCell>

                  <TableCell className="text-right font-bold text-slate-900 text-xs">
                    {gramsToKg(batch.quantityGrams).toLocaleString('vi-VN')} kg
                    <span className="text-[11px] text-slate-400 block font-normal">
                      ({(gramsToKg(batch.quantityGrams) / 1000).toFixed(1)} tấn)
                    </span>
                  </TableCell>

                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openQrModal(batch)}
                        className="h-8 text-xs text-slate-700"
                      >
                        <QrCode className="w-3.5 h-3.5 mr-1 text-slate-600" /> Xem QR
                      </Button>
                      <a href={`/api/qr/${batch.code}?download=1`} download>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                      </a>
                    </div>
                  </TableCell>

                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <a
                        href={`/truy-xuat/${batch.code}`}
                        target="_blank"
                        className="p-1.5 text-slate-500 hover:text-slate-800"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteBatch(batch)}
                        className="h-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* DIALOG THÊM LÔ HÀNG */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm Lô Hàng Thu Hoạch Mới</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveBatch} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Mã Lô Thu Hoạch *</Label>
              <div className="flex items-center gap-2">
                <Input
                  required
                  placeholder="LO-261013-001"
                  className="font-mono font-bold tracking-wider"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const c = await generateNextBatchCode()
                    setCode(c)
                  }}
                  className="shrink-0 text-xs"
                >
                  <Sparkles className="w-3.5 h-3.5 mr-1 text-amber-500" /> Tự sinh
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Chọn Sản Phẩm *</Label>
              <Select value={productId} onValueChange={handleProductChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} (Vườn: {p.farm.name})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ngày thu hoạch *</Label>
                <Input
                  type="date"
                  required
                  value={harvestDate}
                  onChange={(e) => setHarvestDate(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Sản lượng lô (Kg) *</Label>
                <Input
                  type="number"
                  min={1}
                  required
                  value={quantityKg}
                  onChange={(e) => setQuantityKg(parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Ghi chú chất lượng đợt cắt</Label>
              <Textarea
                rows={3}
                placeholder="Lô sầu riêng cắt đợt 1 khu A, độ già 8.5 tuổi, cơm vàng hạt lép..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Hủy
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Lưu Lô Hàng
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG XEM & TẢI TEM MÃ QR */}
      <Dialog open={qrModalOpen} onOpenChange={setQrModalOpen}>
        <DialogContent className="max-w-sm text-center">
          <DialogHeader>
            <DialogTitle>Tem Truy Xuất Lô {previewBatch?.code}</DialogTitle>
          </DialogHeader>

          {previewBatch && (
            <div className="space-y-4 pt-2">
              <div className="p-4 bg-white border-2 border-slate-900 rounded-2xl shadow-sm inline-block mx-auto">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/qr/${previewBatch.code}`}
                  alt={`QR ${previewBatch.code}`}
                  className="w-56 h-56 mx-auto"
                />
                <div className="font-mono font-bold text-xs tracking-wider text-slate-900 mt-2">
                  {previewBatch.code}
                </div>
              </div>

              <div className="text-xs text-slate-600 space-y-1">
                <div>
                  <strong>{previewBatch.product.name}</strong>
                </div>
                <div>Nhà vườn: {previewBatch.farm.name}</div>
                <div>
                  Ngày cắt: {new Date(previewBatch.harvestDate).toLocaleDateString('vi-VN')}
                </div>
              </div>

              <div className="flex gap-2 justify-center pt-2">
                <a href={`/api/qr/${previewBatch.code}?download=1`} download className="flex-1">
                  <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs">
                    <Download className="w-3.5 h-3.5 mr-1.5" /> Tải Tem PNG
                  </Button>
                </a>
                <a
                  href={`/truy-xuat/${previewBatch.code}`}
                  target="_blank"
                  className="flex-1"
                >
                  <Button variant="outline" className="w-full text-xs">
                    Mở Trang Web <ExternalLink className="w-3 h-3 ml-1" />
                  </Button>
                </a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
