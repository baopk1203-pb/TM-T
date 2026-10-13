import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface CartItem {
  productId: string
  packagingId: string
  quantity: number
}

interface CartState {
  items: CartItem[]
  addItem: (productId: string, packagingId: string, quantity?: number) => void
  updateQuantity: (productId: string, packagingId: string, quantity: number) => void
  removeItem: (productId: string, packagingId: string) => void
  clearCart: () => void
  getTotalQuantity: () => number
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (productId: string, packagingId: string, quantity = 1) => {
        if (quantity <= 0) return
        set((state) => {
          const existingIndex = state.items.findIndex(
            (item) => item.productId === productId && item.packagingId === packagingId
          )

          if (existingIndex > -1) {
            const updatedItems = [...state.items]
            updatedItems[existingIndex] = {
              ...updatedItems[existingIndex],
              quantity: updatedItems[existingIndex].quantity + quantity,
            }
            return { items: updatedItems }
          }

          return {
            items: [...state.items, { productId, packagingId, quantity }],
          }
        })
      },

      updateQuantity: (productId: string, packagingId: string, quantity: number) => {
        set((state) => {
          if (quantity <= 0) {
            return {
              items: state.items.filter(
                (item) => !(item.productId === productId && item.packagingId === packagingId)
              ),
            }
          }

          return {
            items: state.items.map((item) =>
              item.productId === productId && item.packagingId === packagingId
                ? { ...item, quantity }
                : item
            ),
          }
        })
      },

      removeItem: (productId: string, packagingId: string) => {
        set((state) => ({
          items: state.items.filter(
            (item) => !(item.productId === productId && item.packagingId === packagingId)
          ),
        }))
      },

      clearCart: () => {
        set({ items: [] })
      },

      getTotalQuantity: () => {
        return get().items.reduce((sum, item) => sum + item.quantity, 0)
      },
    }),
    {
      name: 'nongsan_b2b_cart_storage',
    }
  )
)
