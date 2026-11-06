import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getServerAuthSession } from '@/lib/auth'
import { Role } from '@prisma/client'
import { ExternalLink, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AdminSidebar } from '@/components/admin/admin-sidebar'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerAuthSession()

  if (!session?.user) {
    redirect('/dang-nhap?callbackUrl=/admin')
  }

  if (session.user.role !== Role.ADMIN) {
    redirect('/')
  }

  const userName = session.user.name || 'Quản trị viên'
  const userEmail = session.user.email || ''
  const initials = userName
    ? userName
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'AD'

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* Sidebar (Desktop & Mobile Drawer) */}
      <AdminSidebar
        user={{
          name: userName,
          email: userEmail,
        }}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/90 h-16 px-4 sm:px-6 lg:px-8 flex items-center justify-between sticky top-0 z-30 shadow-2xs">
          <div className="flex items-center gap-3">
            <Badge className="bg-emerald-50 text-emerald-800 border-emerald-300 font-semibold text-xs px-3 py-1 rounded-full flex items-center gap-1.5 shadow-2xs">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Quyền: Quản trị viên tối cao</span>
            </Badge>
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-slate-400 font-medium">
              • Trung tâm điều hành B2B E Vibe
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/" target="_blank" className="hidden lg:inline-block">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-full h-8 px-3 gap-1.5 font-medium transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5 text-emerald-600" />
                <span>Storefront</span>
              </Button>
            </Link>
            <div className="flex items-center gap-2 pl-3 border-l border-slate-200 text-xs text-slate-600">
              <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-[11px] ring-1 ring-emerald-300/50">
                {initials}
              </div>
              <span className="hidden md:inline">
                Người trực: <strong className="text-slate-900">{userName}</strong>
              </span>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto bg-slate-50/70">{children}</main>
      </div>
    </div>
  )
}
