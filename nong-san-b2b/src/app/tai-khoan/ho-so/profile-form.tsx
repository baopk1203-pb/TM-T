'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Loader2, Sparkles, Building2, CheckCircle2 } from 'lucide-react'
import { updateProfile } from '@/server/actions/user'

interface ProfileFormProps {
  user: {
    id: string
    email: string
    fullName: string
    phone: string
    companyName: string | null
    taxCode: string | null
    group: {
      name: string
      discountPercent: number
    } | null
  }
}

export function ProfileForm({ user }: ProfileFormProps) {
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    fullName: user.fullName,
    phone: user.phone,
    companyName: user.companyName || '',
    taxCode: user.taxCode || '',
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const res = await updateProfile(formData)
      if (!res.success) {
        toast.error(res.error || 'Cập nhật không thành công')
      } else {
        toast.success(res.message || 'Cập nhật hồ sơ thành công!')
      }
    } catch {
      toast.error('Lỗi khi gửi yêu cầu')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-slate-200">
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Email (Readonly) & Member Tier */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-slate-500">Email đăng nhập (Cố định)</Label>
              <div className="font-semibold text-slate-800 text-sm mt-1">{user.email}</div>
            </div>
            <div>
              <Label className="text-xs text-slate-500">Phân hạng khách hàng</Label>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="bg-emerald-50 text-emerald-800 border-emerald-300">
                  <Sparkles className="w-3.5 h-3.5 mr-1" />
                  {user.group?.name || 'Cửa hàng nhỏ'} (-{user.group?.discountPercent || 0}%)
                </Badge>
                <span className="text-[11px] text-slate-500">
                  (Chiết khấu tự động trừ vào từng đơn sỉ)
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Họ và tên người đại diện *</Label>
              <Input
                id="fullName"
                name="fullName"
                required
                value={formData.fullName}
                onChange={handleChange}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Số điện thoại liên hệ *</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                required
                value={formData.phone}
                onChange={handleChange}
              />
            </div>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Building2 className="w-4 h-4 text-emerald-600" />
              Thông tin xuất hóa đơn & pháp nhân
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="companyName">Tên Doanh nghiệp / Cửa hàng *</Label>
              <Input
                id="companyName"
                name="companyName"
                required
                value={formData.companyName}
                onChange={handleChange}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="taxCode">Mã số thuế doanh nghiệp</Label>
              <Input
                id="taxCode"
                name="taxCode"
                placeholder="0312345678"
                value={formData.taxCode}
                onChange={handleChange}
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              type="submit"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Đang lưu...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" /> Lưu thay đổi
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
