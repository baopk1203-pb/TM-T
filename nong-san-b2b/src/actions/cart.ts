'use server'

import { db } from '@/lib/db'
import { getServerAuthSession } from '@/lib/auth'
import {
  priceCart,
  CartLineItemInput,
  PriceCartResult,
  ProductPricingData,
} from '@/lib/domain/pricing'
import { OrderStatus } from '@prisma/client'
import { getPublicStockByProductIds } from '@/lib/services/inventory-read'
import {
  evaluateCartItemStockWarning,
  type PublicStockView,
} from '@/lib/domain/inventory-view'

export interface ExtendedProductInfo {
  id: string
  name: string
  slug: string
  image: string
  farmName: string
  farmProvince: string
  moqGrams: number
  moqKg: number
  leadTimeDays: number
  seasonStatus: string
  requiresCold: boolean
  publicStock?: PublicStockView | null
  stockWarning?: string | null
}

export interface QuoteCartResponse {
  quote: PriceCartResult
  userDiscountPercent: number
  groupName: string
  purchasedSampleProductIds: string[]
  productMetadata: Record<string, ExtendedProductInfo>
}

/**
 * Server action: Tính giá toàn bộ giỏ hàng từ cơ sở dữ liệu
 * - Đọc session: nếu đã đăng nhập thì lấy discountPercent của nhóm khách
 * - Kiểm tra các sản phẩm đã từng mua mẫu hay chưa
 * - Truy vấn thông tin sản phẩm, bậc giá, quy cách đóng gói từ database
 * - Gọi hàm thuần domain priceCart()
 */
export async function quoteCart(
  lines: CartLineItemInput[]
): Promise<QuoteCartResponse> {
  const session = await getServerAuthSession()

  let userDiscountPercent = 0
  let groupName = 'Khách vãng lai'
  let purchasedSampleProductIds: string[] = []

  if (session?.user?.id) {
    // Đọc thông tin nhóm mới nhất từ DB
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      include: { group: true },
    })

    if (user?.group) {
      userDiscountPercent = user.group.discountPercent
      groupName = user.group.name
    }

    // Đọc các sản phẩm mà khách hàng này đã từng mua gói mẫu (không tính đơn CANCELLED)
    const sampleItems = await db.orderItem.findMany({
      where: {
        isSample: true,
        order: {
          userId: session.user.id,
          status: { not: OrderStatus.CANCELLED },
        },
      },
      select: {
        productId: true,
      },
    })

    purchasedSampleProductIds = Array.from(
      new Set(sampleItems.map((item) => item.productId))
    )
  }

  // Lấy danh sách ID các sản phẩm có trong giỏ
  const productIds = Array.from(
    new Set(lines.filter((l) => l.quantity > 0).map((l) => l.productId))
  )

  if (productIds.length === 0) {
    const emptyQuote = priceCart({
      lines: [],
      products: [],
      groupDiscountPercent: userDiscountPercent,
    })
    return {
      quote: emptyQuote,
      userDiscountPercent,
      groupName,
      purchasedSampleProductIds,
      productMetadata: {},
    }
  }

  // Truy vấn sản phẩm và tồn kho khả dụng (Shared Read Service F01D) từ DB
  const [dbProducts, publicStockMap] = await Promise.all([
    db.product.findMany({
      where: {
        id: { in: productIds },
        isActive: true,
      },
      include: {
        farm: {
          select: {
            name: true,
            province: true,
          },
        },
        priceTiers: {
          orderBy: { minGrams: 'asc' },
        },
        packagings: {
          where: { isActive: true },
          orderBy: { weightGrams: 'asc' },
        },
      },
    }),
    getPublicStockByProductIds(productIds),
  ])

  // Chuẩn bị dữ liệu định giá chuẩn cho domain engine
  const pricingProducts: ProductPricingData[] = dbProducts.map((p) => ({
    id: p.id,
    name: p.name,
    moqGrams: p.moqGrams,
    priceTiers: p.priceTiers.map((t) => ({
      id: t.id,
      minGrams: t.minGrams,
      pricePerKg: t.pricePerKg,
    })),
    packagings: p.packagings.map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      weightGrams: pkg.weightGrams,
      isSample: pkg.isSample,
      samplePrice: pkg.samplePrice,
    })),
  }))

  // Metadata để hiển thị UI
  const productMetadata: Record<string, ExtendedProductInfo> = {}
  for (const p of dbProducts) {
    productMetadata[p.id] = {
      id: p.id,
      name: p.name,
      slug: p.slug,
      image: p.images[0] || '',
      farmName: p.farm.name,
      farmProvince: p.farm.province,
      moqGrams: p.moqGrams,
      moqKg: p.moqGrams / 1000,
      leadTimeDays: p.leadTimeDays,
      seasonStatus: p.seasonStatus,
      requiresCold: p.requiresCold,
      publicStock: publicStockMap[p.id] ?? null,
      stockWarning: null,
    }
  }

  // Gọi engine giá thuần
  const quote = priceCart({
    lines,
    products: pricingProducts,
    groupDiscountPercent: userDiscountPercent,
  })

  // Đối chiếu tổng khối lượng đặt mỗi sản phẩm trong giỏ với tồn kho khả dụng (Mục 9.3 & 9.4)
  const requestedGramsByProduct = new Map<string, number>()
  for (const summary of quote.productSummaries) {
    requestedGramsByProduct.set(
      summary.productId,
      (requestedGramsByProduct.get(summary.productId) || 0) + summary.totalGrams
    )
  }
  for (const sampleLine of quote.sampleLines) {
    requestedGramsByProduct.set(
      sampleLine.productId,
      (requestedGramsByProduct.get(sampleLine.productId) || 0) + sampleLine.weightGrams
    )
  }

  for (const [productId, requestedGrams] of requestedGramsByProduct.entries()) {
    const meta = productMetadata[productId]
    if (!meta) continue
    const check = evaluateCartItemStockWarning({
      productName: meta.name,
      requestedGrams,
      publicStock: meta.publicStock,
    })
    if (check.exceedsStock && check.warningMessage) {
      meta.stockWarning = check.warningMessage
      quote.errors.push(check.warningMessage)
      quote.isValid = false
    }
  }

  // Kiểm tra vi phạm mua mẫu trùng
  for (const sampleLine of quote.sampleLines) {
    if (purchasedSampleProductIds.includes(sampleLine.productId)) {
      quote.errors.push(
        `Bạn đã mua gói mẫu của sản phẩm "${sampleLine.productName}" trong đơn hàng trước đó`
      )
      quote.isValid = false
    }
    if (sampleLine.quantity > 1) {
      quote.errors.push(
        `Sản phẩm "${sampleLine.productName}": mỗi khách hàng chỉ được mua tối đa 1 gói mẫu`
      )
      quote.isValid = false
    }
  }

  return {
    quote,
    userDiscountPercent,
    groupName,
    purchasedSampleProductIds,
    productMetadata,
  }
}

/**
 * Kiểm tra xem khách hàng hiện tại đã mua gói mẫu của sản phẩm này chưa
 */
export async function checkSamplePurchased(productId: string): Promise<boolean> {
  const session = await getServerAuthSession()
  if (!session?.user?.id) return false

  const existing = await db.orderItem.findFirst({
    where: {
      productId,
      isSample: true,
      order: {
        userId: session.user.id,
        status: { not: OrderStatus.CANCELLED },
      },
    },
    select: { id: true },
  })

  return !!existing
}
