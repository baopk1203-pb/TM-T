'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { StorefrontHeader } from '@/components/shop/storefront-header'
import { QrCode, Search, ShieldCheck, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'

export default function TraceabilityIndexPage() {
  const router = useRouter()
  const [code, setCode] = useState('')

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (code.trim()) {
      router.push(`/truy-xuat/${code.trim().toUpperCase()}`)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50/50">
      <StorefrontHeader />

      <main className="flex-1 flex flex-col justify-center max-w-2xl w-full mx-auto px-4 py-16 text-center space-y-8">
        <div className="space-y-3">
          <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto shadow-sm">
            <QrCode className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            Tra Cứu Lô Hàng & Truy Xuất Nguồn Gốc
          </h1>
          <p className="text-sm text-slate-600 max-w-lg mx-auto">
            Nhập mã lô hàng in trên tem mã QR (ví dụ: <code className="bg-slate-200 px-1.5 py-0.5 rounded text-emerald-800 font-mono">LO-261013-001</code>) để kiểm tra chứng thư thu hoạch tại vườn.
          </p>
        </div>

        <Card className="border-slate-200 shadow-md">
          <CardContent className="p-6">
            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <Input
                  placeholder="Nhập mã lô: LO-YYMMDD-XXX"
                  className="pl-10 font-mono uppercase font-semibold h-11"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
              <Button type="submit" className="h-11 bg-emerald-600 hover:bg-emerald-700 text-white px-6 gap-1.5">
                Tra cứu <ArrowRight className="w-4 h-4" />
              </Button>
            </form>

            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Dữ liệu xác thực từ mạng lưới nhà vườn chuẩn VietGAP / GlobalGAP</span>
            </div>
          </CardContent>
        </Card>
      </main>

      <footer className="bg-white border-t border-slate-200 py-8 text-center text-xs text-slate-500">
        <p>© 2026 Nông Sản B2B - Đồ án môn Thương mại Điện tử</p>
      </footer>
    </div>
  )
}
