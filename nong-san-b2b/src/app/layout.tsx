import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'

const inter = Inter({
  subsets: ['vietnamese', 'latin'],
  variable: '--font-sans',
})

export const metadata: Metadata = {
  title: 'Nông Sản B2B - Sàn Phân Phối Trái Cây Sỉ Chuẩn Vườn',
  description:
    'Hệ thống phân phối sỉ trái cây tươi từ nhà vườn VietGAP/GlobalGAP tới đại lý, siêu thị và F&B.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="vi" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans bg-slate-50 text-slate-900">
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  )
}
