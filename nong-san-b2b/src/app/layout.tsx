import type { Metadata } from 'next'
import { Inter, Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { Providers } from '@/components/providers'

const inter = Inter({
  subsets: ['vietnamese', 'latin'],
  variable: '--font-sans',
  display: 'swap',
})

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['vietnamese', 'latin'],
  variable: '--font-heading',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'E Vibe - Sàn Phân Phối Trái Cây Sỉ Chuẩn Vườn',
  description:
    'Hệ thống phân phối sỉ trái cây tươi từ nhà vườn VietGAP/GlobalGAP tới đại lý, siêu thị và F&B.',
  openGraph: {
    title: 'E Vibe - Sàn Phân Phối Trái Cây Sỉ Chuẩn Vườn',
    description:
      'Hệ thống phân phối sỉ trái cây tươi từ nhà vườn VietGAP/GlobalGAP tới đại lý, siêu thị và F&B.',
    siteName: 'E Vibe',
    locale: 'vi_VN',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="vi"
      className={`${inter.variable} ${plusJakartaSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans bg-slate-50 text-slate-900">
        <Providers>
          {children}
          <Toaster position="top-right" richColors />
        </Providers>
      </body>
    </html>
  )
}
