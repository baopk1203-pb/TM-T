import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface CartItem {
  productId: string
  packagingId: string
  quantity: number
  isSample?: boolean
}

interface CartState {
  items: CartItem[]
  addItem: (productId: string, packagingId: string, quantity?: number, isSample?: boolean) => void
  updateQuantity: (productId: string, packagingId: string, quantity: number) => void
  incrementQuantity: (productId: string, packagingId: string, delta: number) => void
  removeItem: (productId: string, packagingId: string) => void
  clearCart: () => void
  getTotalQuantity: () => number
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (productId: string, packagingId: string, quantity = 1, isSample = false) => {
        if (quantity <= 0) return
        set((state) => {
          const existingIndex = state.items.findIndex(
            (item) => item.productId === productId && item.packagingId === packagingId
          )

          if (existingIndex > -1) {
            const updatedItems = [...state.items]
            const wasSample = isSample || updatedItems[existingIndex].isSample
            // Nếu là hàng mẫu thử, mỗi khách chỉ được 1 gói: giữ nguyên 1
            if (wasSample) {
              updatedItems[existingIndex] = {
                ...updatedItems[existingIndex],
                quantity: 1,
                isSample: true,
              }
              return { items: updatedItems }
            }

            updatedItems[existingIndex] = {
              ...updatedItems[existingIndex],
              quantity: updatedItems[existingIndex].quantity + quantity,
            }
            return { items: updatedItems }
          }

          return {
            items: [
              ...state.items,
              { productId, packagingId, quantity: isSample ? 1 : quantity, isSample },
            ],
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
                ? { ...item, quantity: item.isSample ? 1 : quantity }
                : item
            ),
          }
        })
      },

      incrementQuantity: (productId: string, packagingId: string, delta: number) => {
        set((state) => {
          const existingIndex = state.items.findIndex(
            (item) => item.productId === productId && item.packagingId === packagingId
          )

          if (existingIndex === -1) {
            if (delta > 0) {
              return {
                items: [
                  ...state.items,
                  { productId, packagingId, quantity: delta, isSample: false },
                ],
              }
            }
            return state
          }

          const currentItem = state.items[existingIndex]

          // Hàng mẫu thử: mỗi khách tối đa 1 gói, không cho tăng thêm
          if (currentItem.isSample && delta > 0) {
            return state
          }

          const newQuantity = currentItem.quantity + delta

          // Giảm về <= 0 thì tự động xóa khỏi giỏ
          if (newQuantity <= 0) {
            return {
              items: state.items.filter(
                (item) => !(item.productId === productId && item.packagingId === packagingId)
              ),
            }
          }

          const updatedItems = [...state.items]
          updatedItems[existingIndex] = {
            ...currentItem,
            quantity: currentItem.isSample ? 1 : newQuantity,
          }
          return { items: updatedItems }
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
