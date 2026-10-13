'use client'

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Leaf, ArrowRight, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from 'sonner'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/'

  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const res = await signIn('credentials', {
        email: email.trim(),
        password,
        redirect: false,
      })

      if (res?.error) {
        toast.error(res.error || 'Email hoặc mật khẩu không chính xác')
      } else {
        toast.success('Đăng nhập thành công!')
        router.push(callbackUrl)
        router.refresh()
      }
    } catch {
      toast.error('Lỗi kết nối máy chủ')
    } finally {
      setLoading(false)
    }
  }

  // Tiện ích đăng nhập nhanh 1-click cho đồ án demo
  const quickLogin = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail)
    setPassword(demoPass)
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
          Đăng nhập hệ thống B2B
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Truy cập hệ thống đặt hàng sỉ và quản lý đơn thu mua nông sản
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="pt-6">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email tài khoản</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@nongsanb2b.vn"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Mật khẩu</Label>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="Nhập mật khẩu"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <Button
                type="submit"
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Đang kiểm tra...
                  </>
                ) : (
                  <>
                    Đăng nhập <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-6 text-center text-sm text-slate-600">
              Chưa có tài khoản đối tác?{' '}
              <Link href="/dang-ky" className="font-semibold text-emerald-600 hover:text-emerald-700">
                Đăng ký sỉ ngay
              </Link>
            </div>

            {/* Quick Demo Login Helper Box */}
            <div className="mt-8 pt-6 border-t border-slate-200">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">
                <Sparkles className="w-4 h-4 text-amber-500" />
                Tài khoản trải nghiệm đồ án (1-Click)
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-start text-left h-auto py-2"
                  onClick={() => quickLogin('admin@nongsanb2b.vn', 'AdminPassword@123')}
                >
                  <div>
                    <div className="font-semibold text-rose-700">Quản Trị Viên (Admin)</div>
                    <div className="text-[11px] text-slate-500">Toàn quyền vận hành</div>
                  </div>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-start text-left h-auto py-2"
                  onClick={() => quickLogin('daily1@nongsanb2b.vn', 'Demo@123')}
                >
                  <div>
                    <div className="font-semibold text-blue-700">Đại lý cấp 1 (-5%)</div>
                    <div className="text-[11px] text-slate-500">Đối tác chiến lược</div>
                  </div>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-start text-left h-auto py-2"
                  onClick={() => quickLogin('sieuthi@nongsanb2b.vn', 'Demo@123')}
                >
                  <div>
                    <div className="font-semibold text-emerald-700">Siêu thị (-3%)</div>
                    <div className="text-[11px] text-slate-500">Chuỗi bán lẻ lớn</div>
                  </div>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-start text-left h-auto py-2"
                  onClick={() => quickLogin('taphoa@nongsanb2b.vn', 'Demo@123')}
                >
                  <div>
                    <div className="font-semibold text-slate-700">Cửa hàng nhỏ (0%)</div>
                    <div className="text-[11px] text-slate-500">Khách sỉ phổ thông</div>
                  </div>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
