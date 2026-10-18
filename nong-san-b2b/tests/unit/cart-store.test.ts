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

  describe('WEB-POST-01: incrementQuantity and rapid clicks handling', () => {
    it('thao tác click nhanh 3 lần liên tiếp: tăng chính xác 7 -> 8 -> 9 -> 10', () => {
      const store = useCartStore.getState()
      store.addItem('prod-xoai', 'pkg-10kg', 7, false)
      expect(useCartStore.getState().items[0].quantity).toBe(7)

      // Giả lập 3 click liên tiếp nhanh chóng không chờ quote
      store.incrementQuantity('prod-xoai', 'pkg-10kg', 1)
      store.incrementQuantity('prod-xoai', 'pkg-10kg', 1)
      store.incrementQuantity('prod-xoai', 'pkg-10kg', 1)

      const items = useCartStore.getState().items
      expect(items).toHaveLength(1)
      expect(items[0].quantity).toBe(10)
    })

    it('thao tác click nhanh 8 lần liên tiếp: tăng chính xác 2 -> 10', () => {
      const store = useCartStore.getState()
      store.addItem('prod-xoai', 'pkg-15kg', 2, false)
      expect(useCartStore.getState().items[0].quantity).toBe(2)

      // Giả lập 8 click liên tiếp
      for (let i = 0; i < 8; i++) {
        store.incrementQuantity('prod-xoai', 'pkg-15kg', 1)
      }

      const items = useCartStore.getState().items
      expect(items).toHaveLength(1)
      expect(items[0].quantity).toBe(10)
    })

    it('giảm số lượng về 0 thì tự động xóa dòng sản phẩm khỏi giỏ', () => {
      const store = useCartStore.getState()
      store.addItem('prod-xoai', 'pkg-10kg', 2, false)

      store.incrementQuantity('prod-xoai', 'pkg-10kg', -1)
      expect(useCartStore.getState().items[0].quantity).toBe(1)

      store.incrementQuantity('prod-xoai', 'pkg-10kg', -1)
      expect(useCartStore.getState().items).toHaveLength(0)
    })

    it('hàng mẫu thử không cho tăng quá 1 qua incrementQuantity', () => {
      const store = useCartStore.getState()
      store.addItem('prod-xoai', 'pkg-mau-1kg', 1, true)

      // Cố tình gọi increment +1
      store.incrementQuantity('prod-xoai', 'pkg-mau-1kg', 1)
      expect(useCartStore.getState().items[0].quantity).toBe(1)

      // Nhưng cho phép giảm về 0 để xóa
      store.incrementQuantity('prod-xoai', 'pkg-mau-1kg', -1)
      expect(useCartStore.getState().items).toHaveLength(0)
    })

    it('gọi incrementQuantity cho sản phẩm chưa có trong giỏ với delta > 0 sẽ thêm mới', () => {
      const store = useCartStore.getState()
      store.incrementQuantity('prod-new', 'pkg-new', 3)
      expect(useCartStore.getState().items).toHaveLength(1)
      expect(useCartStore.getState().items[0].quantity).toBe(3)
    })
  })
})
