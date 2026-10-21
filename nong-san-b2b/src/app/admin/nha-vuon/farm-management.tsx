'use client'

import { useState } from 'react'
import { CertType, Certificate, Farm } from '@prisma/client'
import {
  MapPin,
  Plus,
  Edit2,
  Trash2,
  Award,
  ExternalLink,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  Building,
  Warehouse,
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
import {
  createFarm,
  updateFarm,
  deleteFarm,
  createCertificate,
  deleteCertificate,
} from '@/server/actions/farm'
import { FarmInput, CertificateInput } from '@/lib/validators/farm'

type FarmWithDetails = Farm & {
  certificates: Certificate[]
  _count: {
    products: number
    batches: number
  }
}

export function FarmManagement({ initialFarms }: { initialFarms: FarmWithDetails[] }) {
  const [farms, setFarms] = useState<FarmWithDetails[]>(initialFarms)
  const [search, setSearch] = useState('')

  // Farm Dialog State
  const [farmDialogOpen, setFarmDialogOpen] = useState(false)
  const [editingFarm, setEditingFarm] = useState<FarmWithDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [farmForm, setFarmForm] = useState<FarmInput>({
    name: '',
    slug: '',
    ownerName: '',
    province: '',
    addressText: '',
    description: '',
    lat: 10.36,
    lng: 106.12,
    images: [],
  })
  const [imageInput, setImageInput] = useState('')

  // Certificate Dialog State
  const [certDialogOpen, setCertDialogOpen] = useState(false)
  const [selectedFarm, setSelectedFarm] = useState<FarmWithDetails | null>(null)
  const [certForm, setCertForm] = useState<{
    type: CertType
    code: string
    issuedAt: string
    expiresAt: string
    imageUrl: string
  }>(() => {
    const now = new Date()
    const nextYear = new Date(now)
    nextYear.setFullYear(nextYear.getFullYear() + 1)
    return {
      type: CertType.VIETGAP,
      code: '',
      issuedAt: now.toISOString().split('T')[0],
      expiresAt: nextYear.toISOString().split('T')[0],
      imageUrl: '',
    }
  })
  const [nowTimestamp] = useState(() => Date.now())

  // Open Farm Modal
  const openCreateFarmModal = () => {
    setEditingFarm(null)
    setFarmForm({
      name: '',
      slug: '',
      ownerName: '',
      province: '',
      addressText: '',
      description: '',
      lat: 10.36,
      lng: 106.12,
      images: [],
    })
    setImageInput('')
    setFarmDialogOpen(true)
  }

  const openEditFarmModal = (f: FarmWithDetails) => {
    setEditingFarm(f)
    setFarmForm({
      name: f.name,
      slug: f.slug,
      ownerName: f.ownerName || '',
      province: f.province,
      addressText: f.addressText,
      description: f.description,
      lat: f.lat,
      lng: f.lng,
      images: f.images,
    })
    setImageInput(f.images.join('\n'))
    setFarmDialogOpen(true)
  }

  // Handle auto-generate slug
  const handleNameChange = (name: string) => {
    const slug = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')

    setFarmForm((prev) => ({
      ...prev,
      name,
      slug: editingFarm ? prev.slug : slug,
    }))
  }

  // Submit Farm
  const handleSaveFarm = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const images = imageInput
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    const payload: FarmInput = {
      ...farmForm,
      images: images.length > 0 ? images : ['https://images.unsplash.com/photo-1500937386664-56d1dfef3854?auto=format&fit=crop&w=800&q=80'],
    }

    try {
      if (editingFarm) {
        const res = await updateFarm(editingFarm.id, payload)
        if (!res.success) {
          toast.error(res.error)
        } else {
          toast.success(res.message)
          setFarms((prev) =>
            prev.map((f) => (f.id === editingFarm.id ? { ...f, ...res.farm } : f))
          )
          setFarmDialogOpen(false)
        }
      } else {
        const res = await createFarm(payload)
        if (!res.success) {
          toast.error(res.error)
        } else {
          toast.success(res.message)
          setFarms((prev) => [
            {
              ...res.farm,
              certificates: [],
              _count: { products: 0, batches: 0 },
            } as unknown as FarmWithDetails,
            ...prev,
          ])
          setFarmDialogOpen(false)
        }
      }
    } catch {
      toast.error('Lỗi kết nối máy chủ')
    } finally {
      setLoading(false)
    }
  }

  // Delete Farm
  const handleDeleteFarm = async (farm: FarmWithDetails) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa nhà vườn "${farm.name}"?`)) return

    const res = await deleteFarm(farm.id)
    if (!res.success) {
      toast.error(res.error)
    } else {
      toast.success(res.message)
      setFarms((prev) => prev.filter((f) => f.id !== farm.id))
    }
  }

  // Manage Certs Modal
  const openCertsModal = (f: FarmWithDetails) => {
    setSelectedFarm(f)
    setCertDialogOpen(true)
  }

  // Add Cert
  const handleSaveCert = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedFarm) return
    setLoading(true)

    const payload: CertificateInput = {
      farmId: selectedFarm.id,
      type: certForm.type,
      code: certForm.code.trim(),
      issuedAt: new Date(certForm.issuedAt),
      expiresAt: new Date(certForm.expiresAt),
      imageUrl: certForm.imageUrl.trim() || undefined,
    }

    try {
      const res = await createCertificate(payload)
      if (!res.success || !res.certificate) {
        toast.error(res.error || 'Lỗi khi thêm chứng nhận')
      } else {
        toast.success(res.message)
        const newCert = res.certificate
        setSelectedFarm((prev) =>
          prev ? { ...prev, certificates: [...prev.certificates, newCert] } : null
        )
        setFarms((prev) =>
          prev.map((f) =>
            f.id === selectedFarm.id
              ? { ...f, certificates: [...f.certificates, newCert] }
              : f
          )
        )
        setCertForm({
          type: CertType.VIETGAP,
          code: '',
          issuedAt: new Date().toISOString().split('T')[0],
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          imageUrl: '',
        })
      }
    } catch {
      toast.error('Lỗi khi thêm chứng nhận')
    } finally {
      setLoading(false)
    }
  }

  // Delete Cert
  const handleDeleteCert = async (certId: string) => {
    if (!confirm('Bạn có chắc chắn muốn xóa chứng nhận này?')) return

    const res = await deleteCertificate(certId)
    if (!res.success) {
      toast.error(res.error)
    } else {
      toast.success(res.message)
      if (selectedFarm) {
        setSelectedFarm((prev) =>
          prev
            ? { ...prev, certificates: prev.certificates.filter((c) => c.id !== certId) }
            : null
        )
        setFarms((prev) =>
          prev.map((f) =>
            f.id === selectedFarm.id
              ? { ...f, certificates: f.certificates.filter((c) => c.id !== certId) }
              : f
          )
        )
      }
    }
  }

  const filteredFarms = farms.filter(
    (f) =>
      f.name.toLowerCase().includes(search.toLowerCase()) ||
      f.province.toLowerCase().includes(search.toLowerCase()) ||
      f.slug.toLowerCase().includes(search.toLowerCase())
  )

  const isExpired = (expiresAt: Date | string) => {
    return new Date(expiresAt).getTime() < nowTimestamp
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 sm:p-7 rounded-3xl border border-slate-200/90 shadow-card">
        <div className="space-y-1">
          <h1 className="font-heading text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2.5">
            <Warehouse className="w-6 h-6 text-emerald-600" />
            Nhà Vườn &amp; Chứng Nhận Chất Lượng
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Quản lý mạng lưới vườn đối tác liên kết, tọa độ GPS bản đồ và chứng chỉ GAP/Organic.
          </p>
        </div>
        <Button onClick={openCreateFarmModal} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-full font-bold text-xs h-10 px-5 gap-2 shadow-btn-glow hover:-translate-y-0.5 transition-all">
          <Plus className="w-4 h-4" /> Thêm Nhà Vườn Mới
        </Button>
      </div>

      <div className="bg-white p-4 sm:p-5 rounded-3xl border border-slate-200/90 shadow-card flex items-center gap-4">
        <Input
          placeholder="Tìm theo tên vườn, tỉnh thành hoặc slug..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md bg-white rounded-2xl border-slate-200/90 text-xs h-10 pl-4"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredFarms.map((farm) => {
          return (
            <Card key={farm.id} className="rounded-3xl border border-slate-200/90 shadow-card hover:shadow-md transition-shadow overflow-hidden bg-white">
              <div className="h-48 w-full bg-slate-100 relative overflow-hidden">
                {farm.images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={farm.images[0]}
                    alt={farm.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400">
                    <Building className="w-12 h-12 stroke-[1.5]" />
                  </div>
                )}
                <div className="absolute top-3 right-3 flex gap-1">
                  <Badge className="bg-slate-900/80 backdrop-blur-sm text-white">
                    {farm._count.products} Sản phẩm
                  </Badge>
                </div>
              </div>

              <CardContent className="p-5 space-y-4">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-slate-900 text-base line-clamp-1">{farm.name}</h3>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                    <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span className="line-clamp-1">{farm.province} • {farm.addressText}</span>
                  </div>
                </div>

                <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                  {farm.description}
                </p>

                {/* Certificates badge list */}
                <div className="pt-2 border-t border-slate-100">
                  <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center justify-between">
                    <span>Chứng nhận ({farm.certificates.length})</span>
                    <button
                      onClick={() => openCertsModal(farm)}
                      className="text-emerald-600 hover:text-emerald-700 text-xs font-semibold inline-flex items-center gap-1"
                    >
                      <Award className="w-3.5 h-3.5" /> Quản lý
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {farm.certificates.length === 0 ? (
                      <span className="text-xs text-slate-400 italic">Chưa có chứng nhận</span>
                    ) : (
                      farm.certificates.map((c) => {
                        const expired = isExpired(c.expiresAt)
                        return (
                          <Badge
                            key={c.id}
                            variant="outline"
                            className={`text-[11px] ${
                              expired
                                ? 'border-rose-300 text-rose-700 bg-rose-50'
                                : 'border-emerald-300 text-emerald-700 bg-emerald-50'
                            }`}
                          >
                            {expired && <AlertTriangle className="w-3 h-3 mr-1 inline" />}
                            {c.type}: {c.code} {expired ? '(Hết hạn)' : ''}
                          </Badge>
                        )
                      })
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditFarmModal(farm)}
                      className="h-8 text-xs text-slate-700 hover:text-slate-900"
                    >
                      <Edit2 className="w-3.5 h-3.5 mr-1" /> Sửa
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteFarm(farm)}
                      className="h-8 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Xóa
                    </Button>
                  </div>
                  <a
                    href={`/nha-vuon/${farm.slug}`}
                    target="_blank"
                    className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"
                  >
                    Xem <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* DIALOG: Thêm / Sửa Nhà Vườn */}
      <Dialog open={farmDialogOpen} onOpenChange={setFarmDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingFarm ? 'Cập Nhật Hồ Sơ Nhà Vườn' : 'Thêm Nhà Vườn Mới'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveFarm} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="farm-name">Tên Nhà Vườn *</Label>
                <Input
                  id="farm-name"
                  placeholder="HTX Sầu Riêng Cai Lậy..."
                  required
                  value={farmForm.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="farm-slug">Slug định danh *</Label>
                <Input
                  id="farm-slug"
                  placeholder="htx-sau-rieng-cai-lay"
                  required
                  value={farmForm.slug}
                  onChange={(e) =>
                    setFarmForm((prev) => ({ ...prev, slug: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="farm-owner">Chủ vườn / Đại diện</Label>
                <Input
                  id="farm-owner"
                  placeholder="Nguyễn Văn A"
                  value={farmForm.ownerName || ''}
                  onChange={(e) =>
                    setFarmForm((prev) => ({ ...prev, ownerName: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="farm-province">Tỉnh / Thành phố *</Label>
                <Input
                  id="farm-province"
                  placeholder="Tiền Giang, Bến Tre, Đắk Lắk..."
                  required
                  value={farmForm.province}
                  onChange={(e) =>
                    setFarmForm((prev) => ({ ...prev, province: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="farm-address">Địa chỉ chi tiết vườn *</Label>
              <Input
                id="farm-address"
                placeholder="Ấp 4, Xã Ngũ Hiệp, Huyện Cai Lậy"
                required
                value={farmForm.addressText}
                onChange={(e) =>
                  setFarmForm((prev) => ({ ...prev, addressText: e.target.value }))
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="farm-lat">Vĩ độ (Latitude) *</Label>
                <Input
                  id="farm-lat"
                  type="number"
                  step="any"
                  required
                  value={farmForm.lat}
                  onChange={(e) =>
                    setFarmForm((prev) => ({ ...prev, lat: parseFloat(e.target.value) || 0 }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="farm-lng">Kinh độ (Longitude) *</Label>
                <Input
                  id="farm-lng"
                  type="number"
                  step="any"
                  required
                  value={farmForm.lng}
                  onChange={(e) =>
                    setFarmForm((prev) => ({ ...prev, lng: parseFloat(e.target.value) || 0 }))
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="farm-desc">Mô tả vườn và quy trình canh tác *</Label>
              <Textarea
                id="farm-desc"
                rows={3}
                placeholder="Vườn chuyên canh trên 50ha, đất phù sa màu mỡ ven sông Tiền..."
                required
                value={farmForm.description}
                onChange={(e) =>
                  setFarmForm((prev) => ({ ...prev, description: e.target.value }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="farm-images">Link hình ảnh (mỗi dòng 1 link URL)</Label>
              <Textarea
                id="farm-images"
                rows={2}
                placeholder="https://images.unsplash.com/photo-..."
                value={imageInput}
                onChange={(e) => setImageInput(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setFarmDialogOpen(false)}
              >
                Hủy
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {editingFarm ? 'Lưu Thay Đổi' : 'Tạo Nhà Vườn'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG: Quản lý Chứng Nhận GAP / Organic */}
      <Dialog open={certDialogOpen} onOpenChange={setCertDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Chứng Nhận Của Vườn: {selectedFarm?.name}
            </DialogTitle>
          </DialogHeader>

          {/* Form thêm chứng nhận */}
          <form onSubmit={handleSaveCert} className="space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Thêm Chứng Nhận Mới
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Tiêu chuẩn</Label>
                <Select
                  value={certForm.type}
                  onValueChange={(val) => {
                    if (val) setCertForm((prev) => ({ ...prev, type: val as CertType }))
                  }}
                >
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CertType.VIETGAP}>VietGAP</SelectItem>
                    <SelectItem value={CertType.GLOBALGAP}>GlobalGAP</SelectItem>
                    <SelectItem value={CertType.ORGANIC}>Hữu Cơ (Organic)</SelectItem>
                    <SelectItem value={CertType.OTHER}>Tiêu Chuẩn Khác</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Mã số chứng nhận</Label>
                <Input
                  placeholder="VG-2024-TG01"
                  required
                  className="bg-white"
                  value={certForm.code}
                  onChange={(e) =>
                    setCertForm((prev) => ({ ...prev, code: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Ngày cấp</Label>
                <Input
                  type="date"
                  required
                  className="bg-white"
                  value={certForm.issuedAt}
                  onChange={(e) =>
                    setCertForm((prev) => ({ ...prev, issuedAt: e.target.value }))
                  }
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Ngày hết hạn</Label>
                <Input
                  type="date"
                  required
                  className="bg-white"
                  value={certForm.expiresAt}
                  onChange={(e) =>
                    setCertForm((prev) => ({ ...prev, expiresAt: e.target.value }))
                  }
                />
              </div>
            </div>

            <Button
              type="submit"
              size="sm"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Lưu Chứng Nhận
            </Button>
          </form>

          {/* Danh sách chứng nhận hiện có */}
          <div className="space-y-2 pt-2">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Danh Sách Chứng Nhận Đang Có
            </h4>
            {selectedFarm?.certificates.length === 0 ? (
              <p className="text-xs text-slate-500 py-3 text-center">Chưa có chứng nhận nào</p>
            ) : (
              selectedFarm?.certificates.map((cert) => {
                const expired = isExpired(cert.expiresAt)
                return (
                  <div
                    key={cert.id}
                    className="p-3 bg-white rounded-lg border border-slate-200 flex items-center justify-between text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={
                            expired
                              ? 'border-rose-300 text-rose-700 bg-rose-50'
                              : 'border-emerald-300 text-emerald-700 bg-emerald-50'
                          }
                        >
                          {cert.type}: {cert.code}
                        </Badge>
                        {expired ? (
                          <span className="text-[11px] font-semibold text-rose-600">ĐÃ HẾT HẠN</span>
                        ) : (
                          <span className="text-[11px] text-emerald-600 font-medium">
                            <ShieldCheck className="w-3.5 h-3.5 inline mr-0.5" /> Còn hiệu lực
                          </span>
                        )}
                      </div>
                      <div className="text-slate-500 text-[11px]">
                        Hiệu lực: {new Date(cert.issuedAt).toLocaleDateString('vi-VN')} →{' '}
                        {new Date(cert.expiresAt).toLocaleDateString('vi-VN')}
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteCert(cert.id)}
                      className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 h-8"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
