import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getServerAuthSession } from '@/lib/auth'
import { StorefrontHeader } from '@/components/shop/storefront-header'
import { CheckoutView } from './checkout-view'

export const metadata: Metadata = {
  title: 'Thanh Toán & Đặt Hàng | Nông Sản B2B',
  description: 'Xác nhận thông tin giao nhận, lựa chọn hình thức cọc 30% hoặc 100% qua VietQR.',
}

export const dynamic = 'force-dynamic'

export default async function CheckoutPage() {
  const session = await getServerAuthSession()

  if (!session?.user?.id) {
    redirect('/dang-nhap?callbackUrl=/thanh-toan')
  }

  const addresses = await db.address.findMany({
    where: { userId: session.user.id },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      label: true,
      recipient: true,
      phone: true,
      line: true,
      ward: true,
      district: true,
      province: true,
      isDefault: true,
      lat: true,
      lng: true,
    },
  })

  return (
    <div className="min-h-screen flex flex-col bg-slate-50/50">
      <StorefrontHeader />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <CheckoutView addresses={addresses} userName={session.user.name || 'Khách hàng B2B'} />
      </main>

      <footer className="bg-white border-t border-slate-200 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-slate-500">
          <p>© 2026 Nông Sản B2B - Đồ án môn Thương mại Điện tử</p>
        </div>
      </footer>
    </div>
  )
}
