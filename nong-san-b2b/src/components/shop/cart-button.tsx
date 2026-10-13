'use client'

import { useSyncExternalStore } from 'react'
import Link from 'next/link'
import { ShoppingCart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCartStore } from '@/lib/cart-store'

const emptySubscribe = () => () => {}

export function CartButton() {
  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  )

  const items = useCartStore((state) => state.items)
  const totalCount = items.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <Link href="/gio-hang">
      <Button
        variant="outline"
        size="sm"
        className="relative gap-2 border-emerald-200 text-emerald-800 hover:bg-emerald-50 hover:text-emerald-900"
      >
        <ShoppingCart className="w-4 h-4 text-emerald-700" />
        <span className="hidden sm:inline text-xs font-semibold">Giỏ hàng</span>
        {isMounted && totalCount > 0 && (
          <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[11px] font-bold leading-none text-white bg-emerald-600 rounded-full animate-in fade-in zoom-in">
            {totalCount > 99 ? '99+' : totalCount}
          </span>
        )}
      </Button>
    </Link>
  )
}
