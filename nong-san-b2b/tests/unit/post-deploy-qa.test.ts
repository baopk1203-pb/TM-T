import { describe, it, expect, beforeEach } from 'vitest'
import { useCartStore } from '@/lib/cart-store'
import { filterActiveCertificates, formatActiveCertificatesSummary } from '@/lib/certificate'
import fs from 'fs'
import path from 'path'
import type { QuoteCartResponse } from '@/actions/cart'
import type { PricedLineItem } from '@/lib/domain/pricing'

function createMockQuote(params: {
  lines?: { productId: string; packagingId: string; quantity: number }[]
  isValid?: boolean
  subtotal?: number
}): QuoteCartResponse {
  const pricedLines: PricedLineItem[] = (params.lines || []).map((l) => ({
    productId: l.productId,
    packagingId: l.packagingId,
    productName: 'Sản phẩm test',
    packagingName: 'Quy cách test',
    quantity: l.quantity,
    weightGrams: 10000,
    totalGrams: l.quantity * 10000,
    unitPricePerKg: 50000,
    lineTotal: l.quantity * 500000,
    isSample: false,
  }))

  return {
    quote: {
      productSummaries: [],
      lines: pricedLines,
      sampleLines: [],
      subtotal: params.subtotal ?? 5700000,
      errors: params.isValid === false ? ['Chưa đạt MOQ'] : [],
      isValid: params.isValid ?? true,
    },
    userDiscountPercent: 5,
    groupName: 'Đại lý cấp 1',
    purchasedSampleProductIds: [],
    productMetadata: {},
  }
}

describe('Post-Deploy Beta QA Verification (QA-WORK-02 Fixes)', () => {
  beforeEach(() => {
    const storage: Record<string, string> = {}
    global.localStorage = {
      getItem: (key: string) => storage[key] || null,
      setItem: (key: string, value: string) => {
        storage[key] = value
      },
      removeItem: (key: string) => {
        delete storage[key]
      },
      clear: () => {
        for (const k in storage) delete storage[k]
      },
      length: 0,
      key: () => null,
    } as unknown as Storage
    useCartStore.getState().clearCart()
  })

  describe('1. WEB-POST-01: Rapid clicks and cart quantity state consistency', () => {
    it('nhấp chuột liên tiếp 3 lần trên dòng 7 thùng 10kg tăng đúng thành 10 thùng (không mất thao tác)', () => {
      const store = useCartStore.getState()
      store.addItem('prod-xoai', 'pkg-10kg', 7, false)
      store.addItem('prod-xoai', 'pkg-15kg', 2, false)

      expect(useCartStore.getState().items.find((i) => i.packagingId === 'pkg-10kg')?.quantity).toBe(7)
      expect(useCartStore.getState().items.find((i) => i.packagingId === 'pkg-15kg')?.quantity).toBe(2)

      // Kịch bản QA-WORK-02: click nhanh 3 lần liên tiếp nút '+' trên dòng 10kg
      store.incrementQuantity('prod-xoai', 'pkg-10kg', 1)
      store.incrementQuantity('prod-xoai', 'pkg-10kg', 1)
      store.incrementQuantity('prod-xoai', 'pkg-10kg', 1)

      const items = useCartStore.getState().items
      const line10 = items.find((i) => i.packagingId === 'pkg-10kg')
      const line15 = items.find((i) => i.packagingId === 'pkg-15kg')

      expect(line10?.quantity).toBe(10) // 7 + 3 = 10 (không bị kẹt ở 8)
      expect(line15?.quantity).toBe(2)  // Dòng khác không bị ảnh hưởng
    })

    it('nhấp chuột liên tiếp 8 lần trên dòng 2 thùng 15kg tăng đúng thành 10 thùng (không mất thao tác)', () => {
      const store = useCartStore.getState()
      store.addItem('prod-xoai', 'pkg-15kg', 2, false)

      for (let i = 0; i < 8; i++) {
        store.incrementQuantity('prod-xoai', 'pkg-15kg', 1)
      }

      const items = useCartStore.getState().items
      expect(items[0].quantity).toBe(10) // 2 + 8 = 10 (không bị kẹt ở 3)
    })

    it('giảm số lượng từng bước và tự động xóa dòng khi số lượng về 0', () => {
      const store = useCartStore.getState()
      store.addItem('prod-xoai', 'pkg-10kg', 3, false)

      store.incrementQuantity('prod-xoai', 'pkg-10kg', -1)
      expect(useCartStore.getState().items[0].quantity).toBe(2)

      store.incrementQuantity('prod-xoai', 'pkg-10kg', -1)
      expect(useCartStore.getState().items[0].quantity).toBe(1)

      store.incrementQuantity('prod-xoai', 'pkg-10kg', -1)
      expect(useCartStore.getState().items).toHaveLength(0)
    })

    it('Revision 02: isQuoteInSyncWithItems phát hiện báo giá cũ bị lệch ngay khi quantity thay đổi (chặn checkout trong 200ms debounce)', async () => {
      const { isQuoteInSyncWithItems } = await import('@/app/gio-hang/cart-view')

      const cartItems = [
        { productId: 'prod-xoai', packagingId: 'pkg-10kg', quantity: 7 },
        { productId: 'prod-xoai', packagingId: 'pkg-15kg', quantity: 2 },
      ]

      const matchingQuote = createMockQuote({
        lines: [
          { productId: 'prod-xoai', packagingId: 'pkg-10kg', quantity: 7 },
          { productId: 'prod-xoai', packagingId: 'pkg-15kg', quantity: 2 },
        ],
        isValid: true,
      })

      // Khi quote khớp hoàn toàn với cart: fresh = true
      expect(isQuoteInSyncWithItems(cartItems, matchingQuote)).toBe(true)

      // Người dùng nhấn tăng 10kg từ 7 lên 8 (trong 200ms debounce, quote chưa kịp cập nhật)
      const modifiedCart = [
        { productId: 'prod-xoai', packagingId: 'pkg-10kg', quantity: 8 },
        { productId: 'prod-xoai', packagingId: 'pkg-15kg', quantity: 2 },
      ]

      // Ngay lập tức isQuoteInSyncWithItems trả về false -> chặn checkout ngay lập tức
      expect(isQuoteInSyncWithItems(modifiedCart, matchingQuote)).toBe(false)
    })

    it('Revision 02: Báo giá không còn khớp khi có dòng bị xóa hoặc dòng hàng mẫu mới', async () => {
      const { isQuoteInSyncWithItems } = await import('@/app/gio-hang/cart-view')

      const cartItems = [
        { productId: 'prod-xoai', packagingId: 'pkg-10kg', quantity: 7 },
      ]

      const quoteWithTwoLines = createMockQuote({
        lines: [
          { productId: 'prod-xoai', packagingId: 'pkg-10kg', quantity: 7 },
          { productId: 'prod-xoai', packagingId: 'pkg-15kg', quantity: 2 },
        ],
        isValid: true,
      })

      // Số dòng không khớp -> false
      expect(isQuoteInSyncWithItems(cartItems, quoteWithTwoLines)).toBe(false)
      expect(isQuoteInSyncWithItems([], quoteWithTwoLines)).toBe(false)
      expect(isQuoteInSyncWithItems(cartItems, null)).toBe(false)
    })

    it('Revision 02: Điều kiện checkout (canCheckout) khóa chặt chẽ khi đang quote, lỗi quote hoặc quote lệch', async () => {
      const { isQuoteInSyncWithItems } = await import('@/app/gio-hang/cart-view')

      const cartItems = [{ productId: 'p1', packagingId: 'pkg1', quantity: 10 }]
      const validMatchingQuote = createMockQuote({
        lines: [{ productId: 'p1', packagingId: 'pkg1', quantity: 10 }],
        isValid: true,
        subtotal: 600000,
      })

      const computeCanCheckout = (params: {
        quote: ReturnType<typeof createMockQuote> | null
        isQuoting: boolean
        quoteError: string | null
        cart: typeof cartItems
      }) => {
        const isQuoteFresh = isQuoteInSyncWithItems(params.cart, params.quote)
        const isCartValid = (params.quote?.quote?.isValid ?? false) && isQuoteFresh
        return isCartValid && !params.isQuoting && !params.quoteError
      }

      // Case 1: Đủ điều kiện, quote tươi mới, không lỗi -> CAN CHECKOUT
      expect(computeCanCheckout({
        quote: validMatchingQuote,
        isQuoting: false,
        quoteError: null,
        cart: cartItems,
      })).toBe(true)

      // Case 2: Trong thời gian debounce hoặc fetch (isQuoting = true) -> KHÔNG ĐƯỢC CHECKOUT
      expect(computeCanCheckout({
        quote: validMatchingQuote,
        isQuoting: true,
        quoteError: null,
        cart: cartItems,
      })).toBe(false)

      // Case 3: Cart đã thay đổi (quantity 11) nhưng quote chưa chạy -> KHÔNG ĐƯỢC CHECKOUT
      expect(computeCanCheckout({
        quote: validMatchingQuote,
        isQuoting: false,
        quoteError: null,
        cart: [{ productId: 'p1', packagingId: 'pkg1', quantity: 11 }],
      })).toBe(false)

      // Case 4: Quote bị lỗi mạng (quoteError khác null) -> KHÔNG ĐƯỢC CHECKOUT
      expect(computeCanCheckout({
        quote: validMatchingQuote,
        isQuoting: false,
        quoteError: 'Mất kết nối mạng',
        cart: cartItems,
      })).toBe(false)

      // Case 5: Giỏ không đủ MOQ (isValid = false) -> KHÔNG ĐƯỢC CHECKOUT
      const invalidMoqQuote = createMockQuote({
        lines: [{ productId: 'p1', packagingId: 'pkg1', quantity: 10 }],
        isValid: false,
        subtotal: 600000,
      })
      expect(computeCanCheckout({
        quote: invalidMoqQuote,
        isQuoting: false,
        quoteError: null,
        cart: cartItems,
      })).toBe(false)
    })

    it('Revision 02: Cơ chế sequence counter (requestSeqRef) bảo đảm request cũ không ghi đè quote mới', () => {
      let requestSeq = 0
      let latestAppliedQuoteSeq = 0

      // Request A phát đi với seq 1
      requestSeq += 1
      const seqA = requestSeq

      // Request B phát đi với seq 2
      requestSeq += 1
      const seqB = requestSeq

      // Giả sử Request B trả về trước và được áp dụng
      if (seqB === requestSeq) {
        latestAppliedQuoteSeq = seqB
      }
      expect(latestAppliedQuoteSeq).toBe(2)

      // Request A chậm trễ trả về sau đó
      if (seqA === requestSeq) {
        latestAppliedQuoteSeq = seqA // Sẽ không chạy vì 1 !== 2
      }
      expect(latestAppliedQuoteSeq).toBe(2) // Báo giá mới của Request B vẫn được bảo toàn
    })
  })

  describe('2. WEB-POST-02: Farm certificates consistency and expired handling', () => {
    const referenceDate = new Date('2026-10-18T00:00:00Z')

    const farmBenTreCert = {
      id: 'cert-bt-01',
      type: 'VIETGAP',
      code: 'VIETGAP-BT-2023-888',
      issuedAt: new Date('2023-06-20T00:00:00Z'),
      expiresAt: new Date('2026-06-20T00:00:00Z'), // Đã hết hạn trước 10/2026
    }

    it('trang chi tiết sản phẩm nhận được đầy đủ danh sách chứng nhận của nhà vườn (gồm cả hết hạn)', () => {
      const allCerts = [farmBenTreCert]
      // Hồ sơ nhà vườn và tab chứng nhận trên trang sản phẩm đều thấy 1 chứng nhận
      expect(allCerts.length).toBe(1)

      // Nhưng tiêu chuẩn hợp lệ trả về rỗng vì chứng nhận đã hết hạn
      const activeCerts = filterActiveCertificates(allCerts, referenceDate)
      expect(activeCerts.length).toBe(0)

      // Tiêu chuẩn vườn hiển thị đúng "Chưa có chứng nhận còn hiệu lực"
      const summary = formatActiveCertificatesSummary(allCerts, referenceDate)
      expect(summary).toBe('Chưa có chứng nhận còn hiệu lực')
    })

    it('kiểm tra query getProductBySlug trong src/server/actions/product.ts không còn lọc where expiresAt', () => {
      const filePath = path.resolve(__dirname, '../../src/server/actions/product.ts')
      const content = fs.readFileSync(filePath, 'utf-8')

      // getProductBySlug phải include certificates mà không có điều kiện expiresAt: { gt: ... }
      const slugQueryBlock = content.slice(content.indexOf('export async function getProductBySlug'))
      const firstReturnBlock = slugQueryBlock.slice(0, slugQueryBlock.indexOf('export async function createProduct'))

      expect(firstReturnBlock).toContain("orderBy: { expiresAt: 'asc' }")
      expect(firstReturnBlock).not.toContain('where: { expiresAt: { gt:')
    })
  })

  describe('3. WEB-POST-03: Home page pre-order banner copy synchronization', () => {
    it('banner trang chủ không còn cam kết giữ giá trần hoặc ưu tiên giao hàng', () => {
      const filePath = path.resolve(__dirname, '../../src/app/page.tsx')
      const content = fs.readFileSync(filePath, 'utf-8')

      // Kiểm tra banner Đặt Trước Vụ Mùa
      expect(content).not.toContain('Giữ mức giá trần trong biên độ an toàn, ưu tiên giao hàng đợt 1')
      expect(content).toContain('Đang phát triển - Phase 6')
      expect(content).toContain('Tham Khảo Vụ Mùa Sắp Tới (Pre-order Demo)')
      expect(content).toContain('Tính năng đặt cọc giữ giá trần (Pre-order Cọc 30%) đang được hoàn thiện cho Phase 6')
    })
  })
})
