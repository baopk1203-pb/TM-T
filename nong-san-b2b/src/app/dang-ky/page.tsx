'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Leaf, ArrowRight, Loader2, Building2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { toast } from 'sonner'
import { registerUser } from '@/server/actions/auth'

export default function RegisterPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    companyName: '',
    taxCode: '',
    password: '',
    confirmPassword: '',
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const res = await registerUser(formData)
      if (!res.success) {
        toast.error(res.error || 'Đăng ký không thành công')
      } else {
        toast.success('Đăng ký tài khoản sỉ thành công! Vui lòng đăng nhập.')
        router.push('/dang-nhap')
      }
    } catch {
      toast.error('Đã xảy ra lỗi kết nối, vui lòng thử lại sau')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/50 via-white to-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <Link href="/" className="inline-flex items-center gap-2 mb-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-sm">
            <Leaf className="w-6 h-6" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-slate-900">
            NÔNG SẢN <span className="text-emerald-600">B2B</span>
          </span>
        </Link>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Đăng ký tài khoản Đối tác sỉ
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Dành cho siêu thị mini, đại lý phân phối, cửa hàng trái cây sạch và chuỗi F&B
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-xl px-4">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50 p-2.5 rounded-lg border border-emerald-200">
              <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600" />
              Đăng ký xong đặt hàng được ngay - Không chờ phê duyệt tài khoản!
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="fullName">Họ và tên người đại diện *</Label>
                  <Input
                    id="fullName"
                    name="fullName"
                    placeholder="Nguyễn Văn A"
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
                    placeholder="0912345678"
                    required
                    value={formData.phone}
                    onChange={handleChange}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">Địa chỉ Email doanh nghiệp *</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="contact@cuahangtraicay.vn"
                  required
                  value={formData.email}
                  onChange={handleChange}
                />
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Building2 className="w-4 h-4 text-emerald-600" />
                  Thông tin đơn vị kinh doanh
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="companyName">Tên Doanh nghiệp / Chuỗi / Cửa hàng *</Label>
                  <Input
                    id="companyName"
                    name="companyName"
                    placeholder="Ví dụ: Cửa hàng Trái cây Tươi Sạch Ba Tri"
                    required
                    value={formData.companyName}
                    onChange={handleChange}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="taxCode">Mã số thuế (nếu có để xuất hóa đơn)</Label>
                  <Input
                    id="taxCode"
                    name="taxCode"
                    placeholder="0312345678"
                    value={formData.taxCode}
                    onChange={handleChange}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="password">Mật khẩu *</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    placeholder="Ít nhất 6 ký tự"
                    required
                    value={formData.password}
                    onChange={handleChange}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword">Xác nhận mật khẩu *</Label>
                  <Input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    placeholder="Nhập lại mật khẩu"
                    required
                    value={formData.confirmPassword}
                    onChange={handleChange}
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white mt-4"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Đang tạo tài khoản...
                  </>
                ) : (
                  <>
                    Hoàn tất đăng ký đối tác sỉ <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-6 text-center text-sm text-slate-600">
              Đã có tài khoản đối tác?{' '}
              <Link href="/dang-nhap" className="font-semibold text-emerald-600 hover:text-emerald-700">
                Đăng nhập ngay
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
