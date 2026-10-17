import { StorefrontHeader } from '@/components/shop/storefront-header'
import { QrCode } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { TraceabilitySearchForm } from './search-form'

export const dynamic = 'force-dynamic'

export default function TraceabilityIndexPage() {
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
            Nhập mã lô hàng in trên tem mã QR (ví dụ:{' '}
            <code className="bg-slate-200 px-1.5 py-0.5 rounded text-emerald-800 font-mono font-semibold">
              LO-261013-001
            </code>
            ) để kiểm tra chứng thư thu hoạch điện tử tại vườn.
          </p>
        </div>

        <Card className="border-slate-200 shadow-md text-left">
          <CardContent className="p-6">
            <TraceabilitySearchForm />
          </CardContent>
        </Card>
      </main>

      <footer className="bg-white border-t border-slate-200 py-8 text-center text-xs text-slate-500">
        <p>© 2026 Nông Sản B2B - Đồ án môn Thương mại Điện tử</p>
      </footer>
    </div>
  )
}
