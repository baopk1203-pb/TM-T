'use client'

import { useState } from 'react'
import { Plus, MapPin, Check, Trash2, Edit3, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import {
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} from '@/server/actions/user'

interface AddressItem {
  id: string
  label: string
  recipient: string
  phone: string
  line: string
  ward: string
  district: string
  province: string
  isDefault: boolean
}

export function AddressList({ initialAddresses }: { initialAddresses: AddressItem[] }) {
  const [addresses, setAddresses] = useState<AddressItem[]>(initialAddresses)
  const [openDialog, setOpenDialog] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [form, setForm] = useState({
    label: '',
    recipient: '',
    phone: '',
    line: '',
    ward: '',
    district: '',
    province: '',
    isDefault: false,
  })

  const resetForm = () => {
    setForm({
      label: '',
      recipient: '',
      phone: '',
      line: '',
      ward: '',
      district: '',
      province: '',
      isDefault: false,
    })
    setEditingId(null)
  }

  const handleOpenAdd = () => {
    resetForm()
    setOpenDialog(true)
  }

  const handleOpenEdit = (addr: AddressItem) => {
    setEditingId(addr.id)
    setForm({
      label: addr.label,
      recipient: addr.recipient,
      phone: addr.phone,
      line: addr.line,
      ward: addr.ward,
      district: addr.district,
      province: addr.province,
      isDefault: addr.isDefault,
    })
    setOpenDialog(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      if (editingId) {
        const res = await updateAddress(editingId, form)
        if (!res.success) {
          toast.error(res.error || 'Cập nhật thất bại')
        } else {
          toast.success('Cập nhật địa chỉ thành công!')
          setAddresses((prev) =>
            prev.map((a) => (a.id === editingId ? { ...a, ...form } : a))
          )
          setOpenDialog(false)
          resetForm()
        }
      } else {
        const res = await createAddress(form)
        if (!res.success) {
          toast.error(res.error || 'Thêm địa chỉ thất bại')
        } else {
          toast.success('Thêm địa chỉ mới thành công!')
          if (res.address) {
            setAddresses((prev) => [res.address as AddressItem, ...prev])
          }
          setOpenDialog(false)
          resetForm()
        }
      }
    } catch {
      toast.error('Đã xảy ra lỗi kết nối')
    } finally {
      setLoading(false)
    }
  }

  const handleSetDefault = async (id: string) => {
    try {
      const res = await setDefaultAddress(id)
      if (res.success) {
        toast.success(res.message)
        setAddresses((prev) =>
          prev.map((a) => ({
            ...a,
            isDefault: a.id === id,
          }))
        )
      } else {
        toast.error('Thao tác không thành công')
      }
    } catch {
      toast.error('Lỗi kết nối')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Bạn có chắc chắn muốn xóa địa chỉ nhận hàng này?')) return

    try {
      const res = await deleteAddress(id)
      if (res.success) {
        toast.success(res.message)
        setAddresses((prev) => prev.filter((a) => a.id !== id))
      } else {
        toast.error(res.error || 'Xóa thất bại')
      }
    } catch {
      toast.error('Lỗi kết nối')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={handleOpenAdd}
          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-sm"
        >
          <Plus className="w-4 h-4" /> Thêm địa chỉ kho / nhận hàng
        </Button>
      </div>

      {addresses.length === 0 ? (
        <Card className="border-slate-200">
          <CardContent className="py-12 text-center text-slate-500">
            <MapPin className="w-10 h-10 mx-auto text-slate-400 mb-2" />
            <p className="text-base font-semibold text-slate-700">Chưa có địa chỉ nào</p>
            <p className="text-sm mt-1">
              Vui lòng thêm ít nhất một địa chỉ kho nhận hàng để thuận tiện khi đặt đơn sỉ
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {addresses.map((addr) => (
            <Card
              key={addr.id}
              className={`border transition-all ${
                addr.isDefault
                  ? 'border-emerald-500 bg-emerald-50/20 shadow-sm ring-1 ring-emerald-500'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <CardContent className="p-5 flex flex-col justify-between h-full">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="font-bold text-slate-900 text-base">{addr.label}</span>
                    {addr.isDefault && (
                      <Badge className="bg-emerald-600 text-white text-[11px]">
                        Mặc định
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm font-medium text-slate-800">
                    {addr.recipient} - <span className="text-slate-600">{addr.phone}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                    {addr.line}, {addr.ward}, {addr.district}, {addr.province}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div>
                    {!addr.isDefault && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-slate-600 hover:text-emerald-700"
                        onClick={() => handleSetDefault(addr.id)}
                      >
                        <Check className="w-3.5 h-3.5 mr-1" /> Đặt làm mặc định
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenEdit(addr)}
                      aria-label={`Chỉnh sửa địa chỉ ${addr.label}`}
                      title={`Chỉnh sửa địa chỉ ${addr.label}`}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                      onClick={() => handleDelete(addr.id)}
                      aria-label={`Xóa địa chỉ ${addr.label}`}
                      title={`Xóa địa chỉ ${addr.label}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Cập nhật địa chỉ nhận hàng' : 'Thêm địa chỉ kho nhận mới'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="label">Tên gợi nhớ địa điểm *</Label>
              <Input
                id="label"
                placeholder="Ví dụ: Kho Quận 7, Bãi tập kết Miền Đông..."
                required
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="recipient">Tên người nhận *</Label>
                <Input
                  id="recipient"
                  placeholder="Nguyễn Văn A"
                  required
                  value={form.recipient}
                  onChange={(e) => setForm({ ...form, recipient: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">SĐT người nhận *</Label>
                <Input
                  id="phone"
                  placeholder="0912345678"
                  required
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="line">Số nhà, tên đường chi tiết *</Label>
              <Input
                id="line"
                placeholder="Số 123 Đường Nguyễn Thị Thập..."
                required
                value={form.line}
                onChange={(e) => setForm({ ...form, line: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="ward">Phường/Xã *</Label>
                <Input
                  id="ward"
                  placeholder="Phường 1"
                  required
                  value={form.ward}
                  onChange={(e) => setForm({ ...form, ward: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="district">Quận/Huyện *</Label>
                <Input
                  id="district"
                  placeholder="Quận 7"
                  required
                  value={form.district}
                  onChange={(e) => setForm({ ...form, district: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="province">Tỉnh/TP *</Label>
                <Input
                  id="province"
                  placeholder="TP. HCM"
                  required
                  value={form.province}
                  onChange={(e) => setForm({ ...form, province: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="isDefault"
                checked={form.isDefault}
                onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
              />
              <Label htmlFor="isDefault" className="text-sm font-normal cursor-pointer">
                Đặt làm địa chỉ nhận hàng mặc định
              </Label>
            </div>

            <div className="flex justify-end gap-2 pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpenDialog(false)}
              >
                Hủy
              </Button>
              <Button
                type="submit"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={loading}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Lưu địa chỉ'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
