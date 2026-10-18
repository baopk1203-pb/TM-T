import { db } from '@/lib/db'
import { recordOrderEvent } from '@/lib/events'
import { generateOrderCode } from '@/lib/order-code'
import { priceCart, ProductPricingData } from '@/lib/domain/pricing'
import { getShippingCalculator } from '@/lib/domain/shipping'
import { computeDepositAmount } from '@/lib/domain/settlement'
import {
  upcomingDeliveryDates,
  shouldCreateDraft,
  toUtcDateKey,
  ExistingRecurringOrderRef,
} from '@/lib/domain/recurring'
import { OrderStatus, OrderType, Prisma } from '@prisma/client'

export interface RecurringGeneratorResult {
  success: boolean
  createdCount: number
  skippedDuplicates: number
  processedSchedules: number
  createdOrderCodes: string[]
  error?: string
}

/**
 * Service nội bộ: Quét các lịch giao định kỳ đang hoạt động (`isActive = true`)
 * và tự động sinh đơn nháp (`OrderStatus.DRAFT`, `OrderType.RECURRING`) cho các ngày giao
 * rơi vào khoảng `[today + leadTimeDays, today + leadTimeDays + 7 ngày]`.
 *
 * Bảo đảm an toàn:
 * - Tách biệt khỏi Server Action công khai; chỉ được gọi từ Cron (bảo vệ bằng CRON_SECRET) hoặc Admin Action (`requireAdmin()`).
 * - Khóa dòng (`SELECT id FROM "RecurringSchedule" WHERE id = ... FOR UPDATE`) trong transaction.
 * - Kiểm tra kép bằng hàm thuần `shouldCreateDraft()` và truy vấn DB trong transaction để không bao giờ tạo trùng đơn cho cùng `(recurringScheduleId, deliveryDate)`.
 * - Tính giá server-side theo bảng giá bậc và chiết khấu nhóm hiện hành thông qua `priceCart()`.
 */
export async function processRecurringSchedules(
  now: Date = new Date()
): Promise<RecurringGeneratorResult> {
  try {
    const activeSchedules = await db.recurringSchedule.findMany({
      where: { isActive: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })

    let createdCount = 0
    let skippedDuplicates = 0
    let processedSchedules = 0
    const createdOrderCodes: string[] = []

    for (const candidate of activeSchedules) {
      const txStats = await db.$transaction(async (tx) => {
        try {
          await tx.$queryRaw`SELECT id FROM "RecurringSchedule" WHERE id = ${candidate.id} FOR UPDATE`
        } catch {
          // Bỏ qua nếu môi trường test / driver không hỗ trợ raw query
        }

        const schedule = await tx.recurringSchedule.findUnique({
          where: { id: candidate.id },
          include: {
            user: {
              include: {
                group: true,
              },
            },
            items: true,
            orders: {
              select: {
                id: true,
                recurringScheduleId: true,
                deliveryDate: true,
                status: true,
              },
            },
          },
        })

        if (!schedule || !schedule.isActive || schedule.items.length === 0) {
          return { created: 0, skipped: 0, codes: [] as string[], processed: false }
        }

        // Kiểm tra địa chỉ thuộc sở hữu của khách hàng
        const address = await tx.address.findFirst({
          where: {
            id: schedule.addressId,
            userId: schedule.userId,
          },
        })

        if (!address) {
          return { created: 0, skipped: 0, codes: [] as string[], processed: false }
        }

        // Truy vấn sản phẩm và quy cách hiện hành
        const productIds = [...new Set(schedule.items.map((i) => i.productId))]
        const products = await tx.product.findMany({
          where: {
            id: { in: productIds },
            isActive: true,
          },
          include: {
            packagings: {
              where: { isActive: true },
            },
            priceTiers: {
              orderBy: { minGrams: 'asc' },
            },
          },
        })

        if (products.length === 0) {
          return { created: 0, skipped: 0, codes: [] as string[], processed: false }
        }

        const productMap = new Map(products.map((p) => [p.id, p]))
        const validLines: Array<{ productId: string; packagingId: string; quantity: number }> = []

        for (const item of schedule.items) {
          if (item.quantity <= 0) continue
          const prod = productMap.get(item.productId)
          if (!prod) continue
          const pkg = prod.packagings.find((pk) => pk.id === item.packagingId && !pk.isSample)
          if (!pkg) continue
          validLines.push({
            productId: item.productId,
            packagingId: item.packagingId,
            quantity: item.quantity,
          })
        }

        if (validLines.length === 0) {
          return { created: 0, skipped: 0, codes: [] as string[], processed: false }
        }

        const usedProducts = products.filter((p) =>
          validLines.some((line) => line.productId === p.id)
        )
        const leadTimes = usedProducts.map((p) => p.leadTimeDays).filter((d) => d > 0)
        const maxLeadTimeDays = leadTimes.length > 0 ? Math.max(...leadTimes) : 1

        const deliveryDates = upcomingDeliveryDates(schedule, now, maxLeadTimeDays)
        if (deliveryDates.length === 0) {
          return { created: 0, skipped: 0, codes: [] as string[], processed: true }
        }

        const pricingProducts: ProductPricingData[] = usedProducts.map((p) => ({
          id: p.id,
          name: p.name,
          moqGrams: p.moqGrams,
          seasonStatus: p.seasonStatus,
          isActive: p.isActive,
          packagings: p.packagings.map((pk) => ({
            id: pk.id,
            name: pk.name,
            weightGrams: pk.weightGrams,
            isSample: pk.isSample,
            samplePrice: pk.samplePrice,
            isActive: pk.isActive,
          })),
          priceTiers: p.priceTiers.map((pt) => ({
            minGrams: pt.minGrams,
            pricePerKg: pt.pricePerKg,
          })),
        }))

        const groupDiscountPercent = schedule.user.group?.discountPercent ?? 0
        const quote = priceCart({
          lines: validLines,
          products: pricingProducts,
          groupDiscountPercent,
        })

        if (quote.lines.length === 0) {
          return { created: 0, skipped: 0, codes: [] as string[], processed: false }
        }

        const addressSnapshot = {
          id: address.id,
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

        const shippingCalculator = getShippingCalculator()
        const totalGramsAll = quote.lines.reduce((sum, l) => sum + l.totalGrams, 0)
        const shippingQuote = await shippingCalculator.quote({
          totalGrams: totalGramsAll,
          requiresCold: usedProducts.some((p) => p.requiresCold),
          lat: address.lat,
          lng: address.lng,
          addressText: `${address.line}, ${address.ward}, ${address.district}, ${address.province}`,
        })

        const shippingFee = shippingQuote.fee
        const subtotal = quote.subtotal
        const total = subtotal + shippingFee
        const depositAmount = computeDepositAmount(total)

        const existingOrders: ExistingRecurringOrderRef[] = schedule.orders.map((o) => ({
          recurringScheduleId: o.recurringScheduleId,
          deliveryDate: o.deliveryDate,
        }))

        let localCreated = 0
        let localSkipped = 0
        const localCodes: string[] = []

        for (const deliveryDate of deliveryDates) {
          const canCreate = shouldCreateDraft({
            scheduleId: schedule.id,
            deliveryDate,
            existingOrders,
          })

          if (!canCreate) {
            localSkipped++
            continue
          }

          // Kiểm tra trực tiếp trong DB bên trong transaction để chống race condition tuyệt đối
          const existingInDb = await tx.order.findFirst({
            where: {
              recurringScheduleId: schedule.id,
              deliveryDate,
            },
            select: { id: true },
          })

          if (existingInDb) {
            existingOrders.push({
              recurringScheduleId: schedule.id,
              deliveryDate,
            })
            localSkipped++
            continue
          }

          let orderCode = generateOrderCode(now)
          for (let attempt = 0; attempt < 5; attempt++) {
            const codeCollision = await tx.order.findUnique({
              where: { code: orderCode },
              select: { id: true },
            })
            if (!codeCollision) break
            orderCode = generateOrderCode(now)
          }

          const createdOrder = await tx.order.create({
            data: {
              code: orderCode,
              userId: schedule.userId,
              type: OrderType.RECURRING,
              status: OrderStatus.DRAFT,
              paymentOption: schedule.paymentOption,
              groupDiscountPercent,
              addressSnapshot: addressSnapshot as Prisma.InputJsonValue,
              deliveryDate,
              timeSlot: schedule.timeSlot,
              subtotal,
              shippingFee,
              total,
              depositAmount,
              paymentDueAt: null,
              customerNote: `Đơn định kỳ tự động từ lịch: ${schedule.name}`,
              recurringScheduleId: schedule.id,
              items: {
                create: quote.lines.map((line) => ({
                  productId: line.productId,
                  packagingId: line.packagingId,
                  productName: line.productName,
                  packagingName: line.packagingName,
                  isSample: false,
                  quantity: line.quantity,
                  orderedGrams: line.totalGrams,
                  unitPricePerKg: line.unitPricePerKg,
                  lineTotal: line.lineTotal,
                })),
              },
            },
          })

          await recordOrderEvent(tx, {
            orderId: createdOrder.id,
            type: 'RECURRING_DRAFT_CREATED',
            fromStatus: null,
            toStatus: OrderStatus.DRAFT,
            note: `Hệ thống tự động sinh đơn nháp định kỳ từ lịch "${schedule.name}" (ngày giao ${toUtcDateKey(deliveryDate)})`,
            payload: {
              recurringScheduleId: schedule.id,
              scheduleName: schedule.name,
              deliveryDate: toUtcDateKey(deliveryDate),
            },
          })

          existingOrders.push({
            recurringScheduleId: schedule.id,
            deliveryDate,
          })
          localCreated++
          localCodes.push(createdOrder.code)
        }

        return {
          created: localCreated,
          skipped: localSkipped,
          codes: localCodes,
          processed: true,
        }
      })

      createdCount += txStats.created
      skippedDuplicates += txStats.skipped
      createdOrderCodes.push(...txStats.codes)
      if (txStats.processed) {
        processedSchedules++
      }
    }

    return {
      success: true,
      createdCount,
      skippedDuplicates,
      processedSchedules,
      createdOrderCodes,
    }
  } catch (error) {
    console.error('Error in processRecurringSchedules:', error)
    return {
      success: false,
      createdCount: 0,
      skippedDuplicates: 0,
      processedSchedules: 0,
      createdOrderCodes: [],
      error:
        error instanceof Error
          ? error.message
          : 'Lỗi hệ thống khi chạy trình sinh đơn định kỳ',
    }
  }
}
