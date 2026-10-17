import { describe, it, expect, beforeEach } from 'vitest'
import { useCartStore } from '@/lib/cart-store'

describe('Cart Store: Sample and Regular Items (BUG-11 verification)', () => {
  beforeEach(() => {
    const store: Record<string, string> = {}
    global.localStorage = {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = value
      },
      removeItem: (key: string) => {
        delete store[key]
      },
      clear: () => {
        for (const k in store) delete store[k]
      },
      length: 0,
      key: () => null,
    } as unknown as Storage
    useCartStore.getState().clearCart()
  })

  it('thêm hàng thường tăng số lượng tích lũy', () => {
    const store = useCartStore.getState()
    store.addItem('prod-1', 'pkg-thung-10kg', 2, false)
    expect(useCartStore.getState().items).toHaveLength(1)
    expect(useCartStore.getState().items[0].quantity).toBe(2)

    store.addItem('prod-1', 'pkg-thung-10kg', 3, false)
    expect(useCartStore.getState().items).toHaveLength(1)
    expect(useCartStore.getState().items[0].quantity).toBe(5)
  })

  it('thêm gói mẫu thử có tính idempotent: nhiều lần bấm chỉ nhận tối đa 1 gói', () => {
    const store = useCartStore.getState()
    // Lần 1: thêm gói mẫu
    store.addItem('prod-ri6', 'pkg-mau-2kg', 1, true)
    let items = useCartStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0].quantity).toBe(1)
    expect(items[0].isSample).toBe(true)

    // Lần 2: bấm thêm gói mẫu lần nữa
    store.addItem('prod-ri6', 'pkg-mau-2kg', 1, true)
    items = useCartStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0].quantity).toBe(1) // Vẫn là 1, không tăng thành 2

    // Lần 3: cố tình truyền quantity = 5
    store.addItem('prod-ri6', 'pkg-mau-2kg', 5, true)
    items = useCartStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0].quantity).toBe(1)
  })

  it('hàng mẫu thử và hàng thường cùng sản phẩm được lưu thành 2 dòng riêng biệt', () => {
    const store = useCartStore.getState()
    store.addItem('prod-ri6', 'pkg-thung-10kg', 5, false)
    store.addItem('prod-ri6', 'pkg-mau-2kg', 1, true)

    const items = useCartStore.getState().items
    expect(items).toHaveLength(2)
    expect(items.find((i) => i.packagingId === 'pkg-thung-10kg')?.quantity).toBe(5)
    expect(items.find((i) => i.packagingId === 'pkg-mau-2kg')?.quantity).toBe(1)
  })
})
