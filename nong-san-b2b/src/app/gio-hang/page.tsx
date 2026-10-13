import { Metadata } from 'next'
import { StorefrontHeader } from '@/components/shop/storefront-header'
import { CartView } from './cart-view'

export const metadata: Metadata = {
  title: 'Giỏ Hàng Sỉ B2B | Nông Sản B2B',
  description:
    'Quản lý giỏ hàng sỉ trái cây, kiểm tra định mức MOQ và xem trước bảng giá theo sản lượng tự động.',
}

export default function CartPage() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50/50">
      <StorefrontHeader />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <CartView />
      </main>

      <footer className="bg-white border-t border-slate-200 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-slate-500">
          <p>© 2026 Nông Sản B2B - Đồ án môn Thương mại Điện tử</p>
        </div>
      </footer>
    </div>
  )
}
