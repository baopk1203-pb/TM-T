'use client'

import { useState } from 'react'
import { SeasonStatus } from '@prisma/client'
import {
  Plus,
  Edit2,
  Trash2,
  Apple,
  ExternalLink,
  Loader2,
  AlertCircle,
  Sparkles,
  Snowflake,
  Clock,
  Layers,
  Scale,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
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
import { formatVND, gramsToKg, kgToGrams } from '@/lib/money'
import { validatePriceTiers } from '@/lib/domain/pricing'
import {
  getAdminProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} from '@/server/actions/product'
import { ProductInput } from '@/lib/validators/product'

export type ProductWithRelations = Awaited<ReturnType<typeof getAdminProducts>>[number]

interface FarmOption {
  id: string
  name: string
  province: string
}

export function ProductManagement({
  initialProducts,
  farms,
}: {
  initialProducts: ProductWithRelations[]
  farms: FarmOption[]
}) {
  const [products, setProducts] = useState<ProductWithRelations[]>(initialProducts)
  const [search, setSearch] = useState('')
  const [filterSeason, setFilterSeason] = useState<string>('ALL')

  // Product Dialog State
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<ProductWithRelations | null>(null)
  const [loading, setLoading] = useState(false)

  // Form Fields
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrls, setImageUrls] = useState('')
  const [farmId, setFarmId] = useState(farms[0]?.id || '')
  const [moqKg, setMoqKg] = useState(50)
  const [leadTimeDays, setLeadTimeDays] = useState(1)
  const [seasonStatus, setSeasonStatus] = useState<SeasonStatus>(SeasonStatus.HARVESTING)
  const [requiresCold, setRequiresCold] = useState(false)
  const [isActive, setIsActive] = useState(true)

  // Pre-order Fields
  const [preorderOpen, setPreorderOpen] = useState(false)
  const [preorderPricePerKg, setPreorderPricePerKg] = useState<number>(0)
  const [preorderBandPercent, setPreorderBandPercent] = useState<number>(10)
  const [harvestFrom, setHarvestFrom] = useState('')
  const [harvestTo, setHarvestTo] = useState('')

  // Packagings State
  const [packagings, setPackagings] = useState<
    { id?: string; name: string; weightKg: number; isSample: boolean; samplePrice: number; isActive: boolean }[]
  >([
    { name: 'Thùng carton 10kg', weightKg: 10, isSample: false, samplePrice: 0, isActive: true },
    { name: 'Rổ nhựa 20kg', weightKg: 20, isSample: false, samplePrice: 0, isActive: true },
  ])

  // Price Tiers State
  const [tiers, setTiers] = useState<{ minKg: number; pricePerKg: number }[]>([
    { minKg: 50, pricePerKg: 80000 },
    { minKg: 200, pricePerKg: 75000 },
  ])

  // Auto-generate slug from name
  const handleNameChange = (val: string) => {
    setName(val)
    if (!editingProduct) {
      const generatedSlug = val
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, 'd')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
      setSlug(generatedSlug)
    }
  }

  // Open Create Modal
  const openCreateModal = () => {
    setEditingProduct(null)
    setName('')
    setSlug('')
    setDescription('')
    setImageUrls('https://images.unsplash.com/photo-1553279768-865429fa0078?auto=format&fit=crop&w=800&q=80')
    setFarmId(farms[0]?.id || '')
    setMoqKg(50)
    setLeadTimeDays(1)
    setSeasonStatus(SeasonStatus.HARVESTING)
    setRequiresCold(false)
    setIsActive(true)
    setPreorderOpen(false)
    setPreorderPricePerKg(0)
    setPreorderBandPercent(10)
    setHarvestFrom('')
    setHarvestTo('')
    setPackagings([
      { name: 'Thùng carton 10kg', weightKg: 10, isSample: false, samplePrice: 0, isActive: true },
      { name: 'Rổ nhựa 20kg', weightKg: 20, isSample: false, samplePrice: 0, isActive: true },
    ])
    setTiers([
      { minKg: 50, pricePerKg: 80000 },
      { minKg: 200, pricePerKg: 75000 },
    ])
    setDialogOpen(true)
  }

  // Open Edit Modal
  const openEditModal = (p: ProductWithRelations) => {
    setEditingProduct(p)
    setName(p.name)
    setSlug(p.slug)
    setDescription(p.description)
    setImageUrls(p.images.join('\n'))
    setFarmId(p.farmId)
    setMoqKg(gramsToKg(p.moqGrams))
    setLeadTimeDays(p.leadTimeDays)
    setSeasonStatus(p.seasonStatus)
    setRequiresCold(p.requiresCold)
    setIsActive(p.isActive)
    setPreorderOpen(p.preorderOpen)
    setPreorderPricePerKg(p.preorderPricePerKg || 0)
    setPreorderBandPercent(p.preorderBandPercent || 10)
    setHarvestFrom(
      p.expectedHarvestFrom ? new Date(p.expectedHarvestFrom).toISOString().split('T')[0] : ''
    )
    setHarvestTo(
      p.expectedHarvestTo ? new Date(p.expectedHarvestTo).toISOString().split('T')[0] : ''
    )
    setPackagings(
      p.packagings.length > 0
        ? p.packagings.map((pkg) => ({
            id: pkg.id,
            name: pkg.name,
            weightKg: gramsToKg(pkg.weightGrams),
            isSample: pkg.isSample,
            samplePrice: pkg.samplePrice || 0,
            isActive: pkg.isActive,
          }))
        : [
            {
              name: 'Thùng carton 10kg',
              weightKg: 10,
              isSample: false,
              samplePrice: 0,
              isActive: true,
            },
          ]
    )
    setTiers(
      p.priceTiers.map((t) => ({
        minKg: gramsToKg(t.minGrams),
        pricePerKg: t.pricePerKg,
      }))
    )
    setDialogOpen(true)
  }

  // Packaging Row operations
  const addPackagingRow = () => {
    setPackagings((prev) => [
      ...prev,
      { name: `Quy cách mới`, weightKg: 10, isSample: false, samplePrice: 0, isActive: true },
    ])
  }

  const removePackagingRow = (index: number) => {
    if (packagings.length <= 1) {
      toast.error('Phải có ít nhất 1 quy cách đóng gói')
      return
    }
    setPackagings((prev) => prev.filter((_, i) => i !== index))
  }

  // Price Tier Row operations
  const addTierRow = () => {
    const lastTier = tiers[tiers.length - 1]
    const nextKg = lastTier ? lastTier.minKg + 100 : moqKg
    const nextPrice = lastTier ? Math.max(1000, lastTier.pricePerKg - 5000) : 50000
    setTiers((prev) => [...prev, { minKg: nextKg, pricePerKg: nextPrice }])
  }

  const removeTierRow = (index: number) => {
    if (tiers.length <= 1) {
      toast.error('Phải có ít nhất 1 bậc giá')
      return
    }
    setTiers((prev) => prev.filter((_, i) => i !== index))
  }

  // Real-time Validation for Price Tiers
  const tierValidationResult = validatePriceTiers(
    kgToGrams(moqKg),
    tiers.map((t) => ({
      minGrams: kgToGrams(t.minKg),
      pricePerKg: t.pricePerKg,
    }))
  )

  // Submit Handler
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!tierValidationResult.valid) {
      toast.error(tierValidationResult.errors[0])
      return
    }

    setLoading(true)

    const images = imageUrls
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    const payload: ProductInput = {
      name: name.trim(),
      slug: slug.trim().toLowerCase(),
      description: description.trim(),
      images: images.length > 0 ? images : ['https://images.unsplash.com/photo-1553279768-865429fa0078?auto=format&fit=crop&w=800&q=80'],
      farmId,
      moqGrams: kgToGrams(moqKg),
      leadTimeDays,
      seasonStatus,
      requiresCold,
      isActive,
      preorderOpen,
      preorderPricePerKg: preorderOpen && preorderPricePerKg > 0 ? preorderPricePerKg : null,
      preorderBandPercent: preorderOpen ? preorderBandPercent : null,
      expectedHarvestFrom: preorderOpen && harvestFrom ? new Date(harvestFrom) : null,
      expectedHarvestTo: preorderOpen && harvestTo ? new Date(harvestTo) : null,
      packagings: packagings.map((pkg) => ({
        id: pkg.id,
        name: pkg.name.trim(),
        weightGrams: kgToGrams(pkg.weightKg),
        isSample: pkg.isSample,
        samplePrice: pkg.isSample ? pkg.samplePrice : null,
        isActive: pkg.isActive,
      })),
      priceTiers: tiers.map((t) => ({
        minGrams: kgToGrams(t.minKg),
        pricePerKg: t.pricePerKg,
      })),
    }

    try {
      if (editingProduct) {
        const res = await updateProduct(editingProduct.id, payload)
        if (!res.success) {
          toast.error(res.error)
        } else {
          toast.success(res.message)
          const farmInfo = farms.find((f) => f.id === farmId)
          setProducts((prev) =>
            prev.map((p) =>
              p.id === editingProduct.id
                ? ({
                    ...res.product,
                    farm: farmInfo || p.farm,
                    packagings: payload.packagings,
                    priceTiers: payload.priceTiers,
                    _count: p._count,
                  } as unknown as ProductWithRelations)
                : p
            )
          )
          setDialogOpen(false)
        }
      } else {
        const res = await createProduct(payload)
        if (!res.success) {
          toast.error(res.error)
        } else {
          toast.success(res.message)
          const farmInfo = farms.find((f) => f.id === farmId)
          setProducts((prev) => [
            {
              ...res.product,
              farm: farmInfo,
              packagings: payload.packagings,
              priceTiers: payload.priceTiers,
              _count: { batches: 0 },
            } as unknown as ProductWithRelations,
            ...prev,
          ])
          setDialogOpen(false)
        }
      }
    } catch {
      toast.error('Lỗi kết nối máy chủ')
    } finally {
      setLoading(false)
    }
  }

  // Delete Handler
  const handleDeleteProduct = async (p: ProductWithRelations) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa sản phẩm "${p.name}"?`)) return

    const res = await deleteProduct(p.id)
    if (!res.success) {
      toast.error(res.error)
    } else {
      toast.success(res.message)
      setProducts((prev) => prev.filter((item) => item.id !== p.id))
    }
  }

  const filteredProducts = products.filter((p) => {
    const matchSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.slug.toLowerCase().includes(search.toLowerCase()) ||
      p.farm.name.toLowerCase().includes(search.toLowerCase())
    const matchSeason = filterSeason === 'ALL' || p.seasonStatus === filterSeason
    return matchSearch && matchSeason
  })

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 sm:p-7 rounded-3xl border border-slate-200/90 shadow-card">
        <div className="space-y-1">
          <h1 className="font-heading text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2.5">
            <Apple className="w-6 h-6 text-emerald-600" />
            Sản Phẩm &amp; Bảng Giá Bậc
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Quản lý danh mục trái cây sỉ, quy cách đóng gói (thùng/rổ/mẫu) và bảng giá giảm theo bậc sản lượng.
          </p>
        </div>
        <Button onClick={openCreateModal} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-full font-bold text-xs h-10 px-5 gap-2 shadow-btn-glow hover:-translate-y-0.5 transition-all">
          <Plus className="w-4 h-4" /> Thêm Sản Phẩm Mới
        </Button>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 sm:p-5 rounded-3xl border border-slate-200/90 shadow-card flex flex-col sm:flex-row gap-3 items-center justify-between">
        <Input
          placeholder="Tìm kiếm theo tên sản phẩm, slug, nhà vườn..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:max-w-md bg-white rounded-2xl border-slate-200/90 text-xs h-10 pl-4"
        />
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-slate-500 font-medium whitespace-nowrap">Mùa vụ:</span>
          <Select value={filterSeason} onValueChange={(val) => { if (val) setFilterSeason(val) }}>
            <SelectTrigger className="w-full sm:w-44 bg-white text-xs rounded-2xl border-slate-200/90 h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tất cả mùa vụ</SelectItem>
              <SelectItem value={SeasonStatus.HARVESTING}>Đang thu hoạch</SelectItem>
              <SelectItem value={SeasonStatus.UPCOMING}>Sắp vào vụ</SelectItem>
              <SelectItem value={SeasonStatus.OFF_SEASON}>Hết mùa</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Products Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredProducts.map((p) => {
          return (
            <Card key={p.id} className="rounded-3xl border border-slate-200/90 shadow-card hover:shadow-md transition-shadow overflow-hidden bg-white flex flex-col justify-between">
              <div className="h-48 w-full bg-slate-100 relative overflow-hidden">
                {p.images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.images[0]} alt={p.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400">
                    <Apple className="w-12 h-12 stroke-[1.5]" />
                  </div>
                )}
                <div className="absolute top-3 left-3 flex gap-1.5 flex-wrap">
                  <Badge
                    className={
                      p.seasonStatus === SeasonStatus.HARVESTING
                        ? 'bg-emerald-600 text-white'
                        : p.seasonStatus === SeasonStatus.UPCOMING
                        ? 'bg-amber-600 text-white'
                        : 'bg-slate-700 text-white'
                    }
                  >
                    {p.seasonStatus === SeasonStatus.HARVESTING
                      ? 'Đang thu hoạch'
                      : p.seasonStatus === SeasonStatus.UPCOMING
                      ? 'Sắp vào vụ'
                      : 'Hết vụ'}
                  </Badge>
                  {p.requiresCold && (
                    <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">
                      <Snowflake className="w-3 h-3 mr-1" /> Cần lạnh
                    </Badge>
                  )}
                  {p.preorderOpen && (
                    <Badge className="bg-purple-600 text-white">Pre-order</Badge>
                  )}
                </div>
              </div>

              <CardContent className="p-5 space-y-4">
                <div>
                  <h3 className="font-bold text-slate-900 text-base line-clamp-1">{p.name}</h3>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Vườn: <strong>{p.farm.name}</strong> ({p.farm.province})
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                  <div>
                    <span className="text-slate-500 block">Mức đặt tối thiểu (MOQ):</span>
                    <strong className="text-slate-900 font-semibold">{gramsToKg(p.moqGrams)} kg</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Thời gian chuẩn bị:</span>
                    <strong className="text-slate-900 font-semibold flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" /> {p.leadTimeDays} ngày
                    </strong>
                  </div>
                </div>

                {/* Price Tiers List preview */}
                <div className="space-y-1">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                    Bậc giá sỉ ({p.priceTiers.length} bậc)
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {p.priceTiers.map((t, idx) => (
                      <span
                        key={idx}
                        className="text-[11px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200"
                      >
                        ≥ {gramsToKg(t.minGrams)}kg: <strong>{formatVND(t.pricePerKg)}/kg</strong>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Packagings preview */}
                <div className="space-y-1 pt-1">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                    Quy cách ({p.packagings.length})
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {p.packagings.map((pkg, idx) => (
                      <Badge
                        key={idx}
                        variant="outline"
                        className={`text-[11px] ${
                          !pkg.isActive
                            ? 'border-slate-200 bg-slate-100 text-slate-400 line-through'
                            : pkg.isSample
                            ? 'border-amber-300 bg-amber-50 text-amber-800'
                            : ''
                        }`}
                      >
                        {pkg.name} ({gramsToKg(pkg.weightGrams)}kg)
                        {pkg.isSample && ` • Mẫu ${formatVND(pkg.samplePrice || 0)}`}
                        {!pkg.isActive && ' (Đã ngừng)'}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditModal(p)}
                      className="h-8 text-xs text-slate-700 hover:text-slate-900"
                    >
                      <Edit2 className="w-3.5 h-3.5 mr-1" /> Sửa
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteProduct(p)}
                      className="h-8 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Xóa
                    </Button>
                  </div>
                  <a
                    href={`/san-pham/${p.slug}`}
                    target="_blank"
                    className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"
                  >
                    Xem Storefront <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* DIALOG THÊM / SỬA SẢN PHẨM */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[95vw] sm:max-w-4xl lg:max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="border-b pb-3">
            <DialogTitle className="text-lg font-bold text-slate-900 font-heading">
              {editingProduct ? 'Chỉnh Sửa Thông Tin Sản Phẩm' : 'Thêm Sản Phẩm Sỉ Mới'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveProduct} className="space-y-6 pt-2">
            {/* 1. THÔNG TIN CƠ BẢN */}
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5 border-b pb-1.5">
                <Apple className="w-4 h-4 text-emerald-600" /> 1. Thông Tin Cơ Bản
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Tên sản phẩm *</Label>
                  <Input
                    placeholder="Sầu Riêng Ri6 Chín Cây..."
                    required
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Slug đường dẫn *</Label>
                  <Input
                    placeholder="sau-rieng-ri6-chin-cay"
                    required
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Nhà vườn cung cấp *</Label>
                  <Select value={farmId} onValueChange={(val) => { if (val) setFarmId(val) }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {farms.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name} ({f.province})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Trạng thái vụ mùa</Label>
                  <Select
                    value={seasonStatus}
                    onValueChange={(val) => {
                      if (val) setSeasonStatus(val as SeasonStatus)
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SeasonStatus.HARVESTING}>Đang thu hoạch</SelectItem>
                      <SelectItem value={SeasonStatus.UPCOMING}>Sắp vào vụ</SelectItem>
                      <SelectItem value={SeasonStatus.OFF_SEASON}>Hết mùa vụ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Thời gian chuẩn bị (Ngày) *</Label>
                  <Input
                    type="number"
                    min={0}
                    required
                    value={leadTimeDays}
                    onChange={(e) => setLeadTimeDays(parseInt(e.target.value) || 0)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Mô tả chi tiết sản phẩm *</Label>
                <Textarea
                  rows={3}
                  placeholder="Đặc điểm trái, độ ngọt brix, tiêu chuẩn thu hoạch..."
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Hình ảnh sản phẩm (Link URL, mỗi dòng 1 ảnh)</Label>
                <Textarea
                  rows={2}
                  placeholder="https://images.unsplash.com/photo-..."
                  value={imageUrls}
                  onChange={(e) => setImageUrls(e.target.value)}
                />
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-8 pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={requiresCold}
                    onChange={(e) => setRequiresCold(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                  />
                  <span>Yêu cầu xe lạnh (Phí xe lạnh tính ở Phase 8)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                  />
                  <span>Kích hoạt hiển thị Storefront</span>
                </label>
              </div>
            </div>

            {/* 2. MỨC ĐẶT TỐI THIỂU (MOQ) & BẬC GIÁ SỈ */}
            <div className="space-y-3 p-4 sm:p-5 bg-slate-50/80 rounded-2xl border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <Scale className="w-4 h-4 text-emerald-600" /> 2. MOQ & Bảng Giá Bậc Theo Kg
                </h4>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addTierRow}
                  className="h-8 text-xs bg-white font-semibold rounded-lg shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> Thêm Bậc Giá
                </Button>
              </div>

              {/* Mở rộng khu vực nhập MOQ */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center bg-white p-3.5 rounded-xl border border-slate-200">
                <div className="sm:col-span-5 space-y-1">
                  <Label className="text-xs font-semibold text-slate-700">Mức đặt tối thiểu (MOQ) tính bằng Kg *</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      required
                      className="bg-white font-bold text-slate-900 max-w-[180px]"
                      value={moqKg}
                      onChange={(e) => setMoqKg(parseFloat(e.target.value) || 0)}
                    />
                    <span className="text-xs font-semibold text-slate-600">kg</span>
                  </div>
                </div>
                <div className="sm:col-span-7 text-xs text-slate-500 bg-emerald-50/60 p-2.5 rounded-lg border border-emerald-100/80 leading-relaxed">
                  💡 Bậc giá thấp nhất bắt buộc phải bắt đầu đúng từ mức <strong className="text-emerald-950 font-bold">{moqKg} kg</strong> này. Khách hàng chỉ có thể thêm vào giỏ và đặt hàng khi số lượng đạt hoặc vượt ngưỡng MOQ.
                </div>
              </div>

              {/* Danh sách bậc giá */}
              <div className="space-y-2.5 pt-1">
                {tiers.map((tier, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 bg-white rounded-xl border border-slate-200 shadow-xs"
                  >
                    <div className="w-8 text-xs font-bold text-slate-500 shrink-0">
                      #{idx + 1}
                    </div>

                    <div className="flex-1 flex items-center gap-2">
                      <span className="text-xs text-slate-500 shrink-0 min-w-[50px]">Từ mức:</span>
                      <Input
                        type="number"
                        min={1}
                        className="bg-white"
                        placeholder="Số kg"
                        value={tier.minKg}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0
                          setTiers((prev) =>
                            prev.map((t, i) => (i === idx ? { ...t, minKg: val } : t))
                          )
                        }}
                      />
                      <span className="text-xs font-medium text-slate-600 shrink-0">kg trở lên</span>
                    </div>

                    <div className="flex-1 flex items-center gap-2">
                      <span className="text-xs text-slate-500 shrink-0 min-w-[50px]">Đơn giá:</span>
                      <Input
                        type="number"
                        min={1000}
                        step={1000}
                        className="bg-white font-semibold text-emerald-700"
                        placeholder="Đơn giá đ/kg"
                        value={tier.pricePerKg}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 0
                          setTiers((prev) =>
                            prev.map((t, i) => (i === idx ? { ...t, pricePerKg: val } : t))
                          )
                        }}
                      />
                      <span className="text-xs font-medium text-slate-600 shrink-0">đ / kg</span>
                    </div>

                    <div className="flex justify-end sm:justify-center shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeTierRow(idx)}
                        className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 h-9 w-9 p-0 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Real-time validation warning message */}
              {!tierValidationResult.valid && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4" /> Bậc giá chưa hợp lệ:
                  </div>
                  <ul className="list-disc list-inside space-y-0.5">
                    {tierValidationResult.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* 3. QUY CÁCH ĐÓNG GÓI */}
            <div className="space-y-3 p-4 sm:p-5 bg-slate-50/80 rounded-2xl border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-emerald-600" /> 3. Quy Cách Đóng Gói (Thùng/Rổ/Gói Mẫu)
                </h4>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addPackagingRow}
                  className="h-8 text-xs bg-white font-semibold rounded-lg shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> Thêm Quy Cách
                </Button>
              </div>

              <div className="space-y-3">
                {packagings.map((pkg, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 bg-white rounded-xl border border-slate-200 space-y-2.5 text-xs shadow-xs"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                      <div className="sm:col-span-7 space-y-1">
                        <Label className="text-[11px] font-semibold text-slate-600">Tên quy cách</Label>
                        <Input
                          placeholder="Thùng carton 10kg..."
                          value={pkg.name}
                          onChange={(e) => {
                            const val = e.target.value
                            setPackagings((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, name: val } : item))
                            )
                          }}
                        />
                      </div>

                      <div className="sm:col-span-4 space-y-1">
                        <Label className="text-[11px] font-semibold text-slate-600">Khối lượng (Kg)</Label>
                        <Input
                          type="number"
                          step="any"
                          min={0.1}
                          value={pkg.weightKg}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0
                            setPackagings((prev) =>
                              prev.map((item, i) => (i === idx ? { ...item, weightKg: val } : item))
                            )
                          }}
                        />
                      </div>

                      <div className="sm:col-span-1 flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removePackagingRow(idx)}
                          className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 h-9 w-9 p-0 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-5 pt-1 border-t border-slate-100">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={pkg.isActive}
                          onChange={(e) => {
                            const checked = e.target.checked
                            setPackagings((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, isActive: checked } : item
                              )
                            )
                          }}
                          className="rounded border-slate-300 text-emerald-600 w-3.5 h-3.5"
                        />
                        <span
                          className={`font-medium ${
                            pkg.isActive ? 'text-emerald-700' : 'text-slate-500 line-through'
                          }`}
                        >
                          {pkg.isActive ? 'Đang mở bán' : 'Ngừng bán (Inactive)'}
                        </span>
                      </label>

                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={pkg.isSample}
                          onChange={(e) => {
                            const checked = e.target.checked
                            setPackagings((prev) =>
                              prev.map((item, i) =>
                                i === idx ? { ...item, isSample: checked } : item
                              )
                            )
                          }}
                          className="rounded border-slate-300 text-emerald-600 w-3.5 h-3.5"
                        />
                        <span className="font-medium text-amber-700">Là gói hàng mẫu dùng thử</span>
                      </label>

                      {pkg.isSample && (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-600">Giá gói mẫu:</span>
                          <Input
                            type="number"
                            min={1000}
                            step={1000}
                            className="w-32 h-8"
                            placeholder="Số tiền đ"
                            value={pkg.samplePrice}
                            onChange={(e) => {
                              const val = parseInt(e.target.value) || 0
                              setPackagings((prev) =>
                                prev.map((item, i) =>
                                  i === idx ? { ...item, samplePrice: val } : item
                                )
                              )
                            }}
                          />
                          <span>đ / gói</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 4. CẤU HÌNH ĐẶT TRƯỚC VỤ MÙA (PRE-ORDER) */}
            <div className="space-y-3 p-4 sm:p-5 bg-purple-50/50 rounded-2xl border border-purple-200">
              <div className="flex items-center justify-between border-b border-purple-200 pb-2">
                <h4 className="text-xs font-bold text-purple-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-purple-600" /> 4. Cấu Hình Đặt Trước Vụ Mùa (Pre-order)
                </h4>
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-purple-900">
                  <input
                    type="checkbox"
                    checked={preorderOpen}
                    onChange={(e) => setPreorderOpen(e.target.checked)}
                    className="rounded border-purple-300 text-purple-600 w-4 h-4"
                  />
                  <span>Mở nhận đơn Pre-order</span>
                </label>
              </div>

              {preorderOpen && (
                <div className="space-y-3 pt-2 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs">Giá dự kiến chốt trước (đ/kg) *</Label>
                      <Input
                        type="number"
                        min={1000}
                        step={1000}
                        className="bg-white font-semibold"
                        placeholder="90000"
                        value={preorderPricePerKg}
                        onChange={(e) => setPreorderPricePerKg(parseInt(e.target.value) || 0)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Biên độ giá cho phép (+/- %)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={50}
                        className="bg-white"
                        value={preorderBandPercent}
                        onChange={(e) => setPreorderBandPercent(parseInt(e.target.value) || 10)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label className="text-xs">Dự kiến thu hoạch từ ngày</Label>
                      <Input
                        type="date"
                        className="bg-white"
                        value={harvestFrom}
                        onChange={(e) => setHarvestFrom(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Đến ngày</Label>
                      <Input
                        type="date"
                        className="bg-white"
                        value={harvestTo}
                        onChange={(e) => setHarvestTo(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t sticky bottom-0 bg-white/95 backdrop-blur-xs py-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} className="rounded-xl">
                Hủy
              </Button>
              <Button
                type="submit"
                disabled={loading || !tierValidationResult.valid}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-btn-glow px-6"
              >
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {editingProduct ? 'Lưu Thay Đổi Sản Phẩm' : 'Tạo Sản Phẩm Mới'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
