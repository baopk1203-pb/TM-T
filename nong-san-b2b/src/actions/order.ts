'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import {
  priceCart,
  ProductPricingData,
} from '@/lib/domain/pricing'
import {
  earliestDeliveryDate,
  isDeliveryDateValid,
} from '@/lib/domain/delivery-date'
import {
  checkCapacity,
  getWeekStartMonday,
} from '@/lib/domain/capacity'
import { getShippingCalculator } from '@/lib/domain/shipping'
import { computeDepositAmount } from '@/lib/domain/settlement'
import { recordOrderEvent } from '@/lib/events'
import { generateOrderCode } from '@/lib/order-code'
import {
  OrderStatus,
  OrderType,
  PaymentOption,
  TimeSlot,
  Prisma,
} from '@prisma/client'

const placeOrderSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        packagingId: z.string().min(1),
        quantity: z.number().int().positive(),
      })
    )
    .min(1, 'Giỏ hàng không được để trống'),
  addressId: z.string().min(1, 'Vui lòng chọn địa chỉ giao hàng'),
  deliveryDate: z.string().min(1, 'Vui lòng chọn ngày giao hàng'),
  timeSlot: z.nativeEnum(TimeSlot, {
    message: 'Vui lòng chọn khung giờ giao hàng hợp lệ',
  }),
  paymentOption: z.nativeEnum(PaymentOption, {
    message: 'Vui lòng chọn hình thức thanh toán hợp lệ',
  }),
  customerNote: z.string().max(500).optional(),
})

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>

export interface PlaceOrderResult {
  success: boolean
  orderCode?: string
  orderId?: string
  error?: string
}

/**
 * Server Action: Đặt hàng B2B (Place Order)
 * Toàn bộ logic chạy trong một transaction Prisma duy nhất để đảm bảo tính toàn vẹn dữ liệu:
 * 1. Validate Zod
 * 2. Xác thực tài khoản khách hàng và % chiết khấu nhóm
 * 3. Kiểm tra địa chỉ và tạo addressSnapshot
 * 4. Tính toán lại giá server-side (priceCart) và kiểm tra MOQ
 * 5. Kiểm tra giới hạn 1 gói mẫu thử / sản phẩm
 * 6. Kiểm tra ngày giao sớm nhất (earliestDeliveryDate)
 * 7. Kiểm tra năng lực cung ứng theo tuần (checkCapacity)
 * 8. Tính phí vận chuyển (zeroShippingCalculator ở Phase 4)
 * 9. Tính số tiền cọc (computeDepositAmount)
 * 10. Sinh mã đơn DH-YYMMDD-XXXX không trùng, paymentDueAt = now + 24h
 * 11. Ghi OrderEvent ORDER_CREATED
 */
export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  try {
    // 1. Xác thực người dùng
    const sessionUser = await requireUser()

    // 2. Validate input với Zod
    const validated = placeOrderSchema.parse(input)

    return await db.$transaction(
      async (tx) => {
        // Lấy thông tin user và nhóm khách hàng
        const user = await tx.user.findUnique({
          where: { id: sessionUser.id },
          include: { group: true },
        })

        if (!user) {
          throw new Error('Không tìm thấy thông tin tài khoản người dùng')
        }

        const groupDiscountPercent = user.group?.discountPercent ?? 0

        // 3. Kiểm tra địa chỉ giao hàng
        const address = await tx.address.findFirst({
          where: {
            id: validated.addressId,
            userId: user.id,
          },
        })

        if (!address) {
          throw new Error('Địa chỉ giao hàng không hợp lệ hoặc không thuộc tài khoản của bạn')
        }

        const addressSnapshot: Prisma.InputJsonValue = {
          label: address.label,
          recipient: address.recipient,
          phone: address.phone,
          line: address.line,
          ward: address.ward,
          district: address.district,
          province: address.province,
          lat: address.lat,
          lng: address.lng,
        }

        // 4. Truy vấn sản phẩm và quy cách từ database
        const productIds = Array.from(new Set(validated.lines.map((l) => l.productId)))
        const dbProducts = await tx.product.findMany({
          where: {
            id: { in: productIds },
            isActive: true,
          },
          include: {
            priceTiers: { orderBy: { minGrams: 'asc' } },
            packagings: { where: { isActive: true } },
          },
        })

        if (dbProducts.length !== productIds.length) {
          throw new Error('Một số sản phẩm trong giỏ hàng không tồn tại hoặc đã ngừng kinh doanh')
        }

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

        // Tính giá độc lập phía server
        const quote = priceCart({
          lines: validated.lines,
          products: pricingProducts,
          groupDiscountPercent,
        })

        if (!quote.isValid || quote.errors.length > 0) {
          throw new Error(quote.errors[0] || 'Giỏ hàng không đáp ứng điều kiện đặt sỉ')
        }

        // 5. Kiểm tra giới hạn hàng mẫu: Mỗi khách chỉ mua tối đa 1 gói mẫu / sản phẩm
        for (const sampleLine of quote.sampleLines) {
          if (sampleLine.quantity > 1) {
            throw new Error(
              `Sản phẩm "${sampleLine.productName}": mỗi khách hàng chỉ được mua tối đa 1 gói mẫu`
            )
          }

          const existingSampleOrder = await tx.orderItem.findFirst({
            where: {
              productId: sampleLine.productId,
              isSample: true,
              order: {
                userId: user.id,
                status: { not: OrderStatus.CANCELLED },
              },
            },
            select: { id: true },
          })

          if (existingSampleOrder) {
            throw new Error(
              `Bạn đã từng mua gói mẫu thử của sản phẩm "${sampleLine.productName}" trong đơn hàng trước đó`
            )
          }
        }

        // 6. Kiểm tra ngày giao hàng sớm nhất
        const now = new Date()
        const leadTimes = dbProducts.map((p) => p.leadTimeDays)
        const minDeliveryDate = earliestDeliveryDate(now, leadTimes)

        // Parse ngày giao hàng (chuẩn hóa UTC Date)
        const [year, month, day] = validated.deliveryDate.split('-').map(Number)
        const selectedDeliveryDate = new Date(Date.UTC(year, month - 1, day))

        if (!isDeliveryDateValid(selectedDeliveryDate, minDeliveryDate)) {
          const minDateStr = `${minDeliveryDate.getUTCDate()}/${minDeliveryDate.getUTCMonth() + 1}/${minDeliveryDate.getUTCFullYear()}`
          throw new Error(
            `Ngày giao hàng không hợp lệ. Do thời gian chuẩn bị của nhà vườn, ngày giao sớm nhất là ${minDateStr}`
          )
        }

        // 7. Kiểm tra năng lực cung ứng theo tuần (Weekly Capacity)
        const weekStart = getWeekStartMonday(selectedDeliveryDate)
        const weekEnd = new Date(weekStart)
        weekEnd.setUTCDate(weekEnd.getUTCDate() + 7)

        for (const summary of quote.productSummaries) {
          const capacityRecord = await tx.weeklyCapacity.findUnique({
            where: {
              productId_weekStart: {
                productId: summary.productId,
                weekStart,
              },
            },
          })

          if (capacityRecord) {
            // Tính tổng khối lượng đã đặt trong tuần của sản phẩm này (các đơn chưa bị CANCELLED)
            const existingItems = await tx.orderItem.findMany({
              where: {
                productId: summary.productId,
                isSample: false,
                order: {
                  status: { not: OrderStatus.CANCELLED },
                  deliveryDate: {
                    gte: weekStart,
                    lt: weekEnd,
                  },
                },
              },
              select: { orderedGrams: true },
            })

            const existingGrams = existingItems.reduce(
              (sum, item) => sum + item.orderedGrams,
              0
            )

            const capacityCheck = checkCapacity({
              maxGrams: capacityRecord.maxGrams,
              existingGrams,
              newGrams: summary.totalGrams,
              productName: summary.productName,
            })

            if (!capacityCheck.allowed) {
              throw new Error(capacityCheck.error)
            }
          }
        }

        // 8. Tính phí vận chuyển (gọi zeroShippingCalculator)
        const shippingCalculator = getShippingCalculator()
        const totalGramsAll =
          quote.lines.reduce((sum, l) => sum + l.totalGrams, 0) +
          quote.sampleLines.reduce((sum, l) => sum + l.weightGrams * l.quantity, 0)

        const shippingQuote = await shippingCalculator.quote({
          totalGrams: totalGramsAll,
          requiresCold: dbProducts.some((p) => p.requiresCold),
          lat: address.lat,
          lng: address.lng,
          addressText: `${address.line}, ${address.ward}, ${address.district}, ${address.province}`,
        })

        const shippingFee = shippingQuote.fee // 0 đ ở Phase 4
        const subtotal = quote.subtotal
        const total = subtotal + shippingFee

        // 9. Tính số tiền cọc (depositAmount)
        const depositAmount =
          validated.paymentOption === PaymentOption.DEPOSIT_30
            ? computeDepositAmount(total)
            : total

        // 10. Sinh mã đơn hàng duy nhất không trùng
        let code = generateOrderCode(now)
        let isCodeUnique = false
        let attempts = 0

        while (!isCodeUnique && attempts < 5) {
          const existingOrder = await tx.order.findUnique({
            where: { code },
            select: { id: true },
          })
          if (!existingOrder) {
            isCodeUnique = true
          } else {
            code = generateOrderCode(now)
            attempts++
          }
        }

        // 11. Hạn thanh toán 24h
        const paymentDueAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)

        // Phân loại đơn: SAMPLE nếu chỉ chứa hàng mẫu, ngược lại STANDARD
        const isAllSample = quote.lines.length === 0 && quote.sampleLines.length > 0
        const orderType = isAllSample ? OrderType.SAMPLE : OrderType.STANDARD

        // 12. Tạo đơn hàng và các dòng OrderItem trong database
        const order = await tx.order.create({
          data: {
            code,
            userId: user.id,
            type: orderType,
            status: OrderStatus.PENDING_CONFIRMATION,
            paymentOption: validated.paymentOption,
            groupDiscountPercent,
            addressSnapshot,
            deliveryDate: selectedDeliveryDate,
            timeSlot: validated.timeSlot,
            subtotal,
            shippingFee,
            total,
            depositAmount,
            paymentDueAt,
            customerNote: validated.customerNote || null,
            items: {
              create: [
                ...quote.lines.map((l) => ({
                  productId: l.productId,
                  packagingId: l.packagingId,
                  productName: l.productName,
                  packagingName: l.packagingName,
                  isSample: false,
                  quantity: l.quantity,
                  orderedGrams: l.totalGrams,
                  unitPricePerKg: l.unitPricePerKg,
                  lineTotal: l.lineTotal,
                })),
                ...quote.sampleLines.map((s) => ({
                  productId: s.productId,
                  packagingId: s.packagingId,
                  productName: s.productName,
                  packagingName: s.packagingName,
                  isSample: true,
                  quantity: s.quantity,
                  orderedGrams: s.weightGrams * s.quantity,
                  unitPricePerKg: 0,
                  lineTotal: s.lineTotal,
                })),
              ],
            },
          },
        })

        // 13. Ghi vết sự kiện ORDER_CREATED
        await recordOrderEvent(tx, {
          orderId: order.id,
          type: 'ORDER_CREATED',
          toStatus: OrderStatus.PENDING_CONFIRMATION,
          actorId: user.id,
          note: `Khách hàng ${user.fullName} đặt hàng thành công qua website`,
        })

        return {
          success: true,
          orderCode: order.code,
          orderId: order.id,
        }
      },
      {
        timeout: 15000,
      }
    )
  } catch (error) {
    console.error('Error placing order:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Đặt hàng thất bại, vui lòng thử lại',
    }
  }
}
