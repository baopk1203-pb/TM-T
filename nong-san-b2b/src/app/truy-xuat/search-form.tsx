'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Search, ArrowRight, ShieldCheck, Tag } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const sampleCodes = ['LO-261013-001', 'LO-261013-002', 'LO-261013-003']

export function TraceabilitySearchForm() {
  const router = useRouter()
  const [code, setCode] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const clean = code.trim().toUpperCase()
    if (clean) {
      router.push(`/truy-xuat/${encodeURIComponent(clean)}`)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <Input
            name="code"
            placeholder="Nhập mã lô: LO-261013-001"
            className="pl-10 font-mono uppercase font-semibold h-11"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <Button
          type="submit"
          className="h-11 bg-emerald-600 hover:bg-emerald-700 text-white px-6 gap-1.5 shrink-0"
        >
          Tra cứu <ArrowRight className="w-4 h-4" />
        </Button>
      </form>

      {/* Gợi ý mã có sẵn trong cơ sở dữ liệu để kiểm thử */}
      <div className="text-xs text-slate-500 flex flex-wrap items-center justify-center gap-2 pt-1">
        <span className="flex items-center gap-1 font-medium text-slate-600">
          <Tag className="w-3.5 h-3.5 text-emerald-600" /> Mã lô mẫu có sẵn:
        </span>
        {sampleCodes.map((sampleCode) => (
          <Link key={sampleCode} href={`/truy-xuat/${sampleCode}`}>
            <Badge
              variant="outline"
              className="font-mono bg-slate-50 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 transition-colors cursor-pointer text-[11px]"
            >
              {sampleCode}
            </Badge>
          </Link>
        ))}
      </div>

      <div className="pt-3 border-t border-slate-100 flex items-center justify-center gap-2 text-xs text-slate-500">
        <ShieldCheck className="w-4 h-4 text-emerald-600" />
        <span>Dữ liệu xác thực từ nhật ký cắt vườn của HTX đạt chuẩn VietGAP / GlobalGAP</span>
      </div>
    </div>
  )
}
