'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireUser, requireAdmin } from '@/lib/auth'
import { recordOrderEvent } from '@/lib/events'
import { generateOrderCode } from '@/lib/order-code'
import {
  checkPriceBand,
  computePreorderShortfallRefund,
  calculatePreorderPricing,
  computeOutOfBandCancellationRefund,
} from '@/lib/domain/preorder'
import { earliestDeliveryDate, isDeliveryDateValid } from '@/lib/domain/delivery-date'
import { canTransition } from '@/lib/domain/order-state'
import { createDynamicShippingCalculator } from '@/lib/services/shipping-config'
import { computeDepositAmount } from '@/lib/domain/settlement'
import {
  OrderStatus,
  OrderType,
  PaymentOption,
  TimeSlot,
  TxType,
  TxStatus,
  TxMethod,
  CancelActor,
  Prisma,
} from '@prisma/client'

// 1. PLACE PRE-ORDER SCHEMA
const placePreorderSchema = z.object({
  productId: z.string().min(1, 'Vui lòng chọn sản phẩm'),
  packagingId: z.string().min(1, 'Vui lòng chọn quy cách đóng gói'),
  quantity: z.number().int().positive('Số lượng phải lớn hơn 0'),
  addressId: z.string().min(1, 'Vui lòng chọn địa chỉ nhận hàng'),
  customerNote: z.string().max(500).optional(),
})

export type PlacePreorderInput = z.infer<typeof placePreorderSchema>

export interface PlacePreorderResult {
  success: boolean
  orderCode?: string
  orderId?: string
  error?: string
}

/**
 * Server Action: Đặt trước vụ mùa (Storefront Pre-order - Mục 3.10)
 * - Sản phẩm đơn lẻ, kiểm tra preorderOpen === true
 * - Áp dụng chiết khấu nhóm đối tác vào preorderPricePerKg
 * - Kiểm tra MOQ sản phẩm
 * - Bắt buộc hình thức thanh toán DEPOSIT_30
 * - Chưa chọn ngày giao hàng trước thu hoạch (deliveryDate = null)
 * - paymentDueAt = now + 24h
 * - Trạng thái ban đầu: PENDING_CONFIRMATION
 */
export async function placePreorder(input: PlacePreorderInput): Promise<PlacePreorderResult> {
  try {
    const sessionUser = await requireUser()
    const validated = placePreorderSchema.parse(input)

    const result = await db.$transaction(
      async (tx) => {
        // Lấy thông tin user và nhóm khách hàng
        const user = await tx.user.findUnique({
          where: { id: sessionUser.id },
          include: { group: true },
        })

        if (!user) {
          throw new Error('Không tìm thấy tài khoản người dùng')
        }

        const groupDiscountPercent = user.group?.discountPercent ?? 0

        // Kiểm tra địa chỉ giao hàng
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

        // Kiểm tra sản phẩm và cấu hình đặt trước
        const product = await tx.product.findUnique({
          where: {
            id: validated.productId,
            isActive: true,
          },
          include: {
            packagings: { where: { isActive: true } },
          },
        })

        if (!product) {
          throw new Error('Sản phẩm không tồn tại hoặc đã ngừng kinh doanh')
        }

        if (!product.preorderOpen || !product.preorderPricePerKg || product.preorderPricePerKg <= 0) {
          throw new Error('Sản phẩm hiện không mở chương trình đặt trước vụ mùa')
        }

        const packaging = product.packagings.find((p) => p.id === validated.packagingId)
        if (!packaging) {
          throw new Error('Quy cách đóng gói không hợp lệ')
        }

        if (packaging.isSample) {
          throw new Error('Gói mẫu thử không áp dụng cho hợp đồng đặt trước vụ mùa')
        }

        const totalGrams = packaging.weightGrams * validated.quantity
        if (totalGrams < product.moqGrams) {
          const orderedKg = totalGrams / 1000
          const moqKg = product.moqGrams / 1000
          throw new Error(
            `Khối lượng đặt (${orderedKg}kg) chưa đạt số lượng đặt tối thiểu (MOQ: ${moqKg}kg) của sản phẩm`
          )
        }

        // Tính toán đơn giá chiết khấu và cọc 30%
        const pricing = calculatePreorderPricing({
          preorderPricePerKg: product.preorderPricePerKg,
          groupDiscountPercent,
          packagingWeightGrams: packaging.weightGrams,
          quantity: validated.quantity,
        })

        const now = new Date()
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

        const paymentDueAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)

        // Tính toán phí vận chuyển dự kiến theo địa chỉ khách chọn (Shipping Engine - Phase 8B Dynamic)
        const shippingCalculator = createDynamicShippingCalculator()
        const shippingQuote = await shippingCalculator.quote({
          totalGrams,
          requiresCold: product.requiresCold,
          vehicleType: product.requiresCold ? 'COLD' : 'NORMAL',
          lat: address.lat,
          lng: address.lng,
          addressText: `${address.line}, ${address.ward}, ${address.district}, ${address.province}`,
          district: address.district,
          province: address.province,
        })

        if (!shippingQuote.allowed) {
          throw new Error(
            shippingQuote.error ||
              'Không thể tính phí vận chuyển cho địa chỉ đã chọn (vượt bán kính phục vụ hoặc thiếu tọa độ)'
          )
        }

        const shippingFee = shippingQuote.fee
        const subtotal = pricing.subtotal
        const total = subtotal + shippingFee
        const depositAmount = computeDepositAmount(total)

        // Tạo đơn đặt trước
        const order = await tx.order.create({
          data: {
            code,
            userId: user.id,
            type: OrderType.PREORDER,
            status: OrderStatus.PENDING_CONFIRMATION,
            paymentOption: PaymentOption.DEPOSIT_30,
            groupDiscountPercent,
            addressSnapshot,
            deliveryDate: null,
            timeSlot: null,
            subtotal,
            shippingFee,
            shippingDistanceKm: shippingQuote.distanceKm,
            shippingVehicleType: shippingQuote.vehicleType,
            total,
            depositAmount,
            paymentDueAt,
            customerNote: validated.customerNote || null,
            items: {
              create: [
                {
                  productId: product.id,
                  packagingId: packaging.id,
                  productName: product.name,
                  packagingName: packaging.name,
                  isSample: false,
                  quantity: validated.quantity,
                  orderedGrams: totalGrams,
                  unitPricePerKg: pricing.discountedPricePerKg,
                  lineTotal: pricing.lineTotal,
                },
              ],
            },
          },
        })

        // Ghi OrderEvent ORDER_CREATED
        await recordOrderEvent(tx, {
          orderId: order.id,
          type: 'ORDER_CREATED',
          toStatus: OrderStatus.PENDING_CONFIRMATION,
          actorId: user.id,
          note: `Khách hàng ${user.fullName} đặt trước vụ mùa cho sản phẩm ${product.name} (${totalGrams / 1000}kg). Tiền cọc 30%: ${depositAmount.toLocaleString('vi-VN')} đ (Đã gồm phí ship dự kiến: ${shippingFee.toLocaleString('vi-VN')} đ)`,
        })

        return {
          success: true,
          orderCode: order.code,
          orderId: order.id,
        }
      },
      { timeout: 15000 }
    )

    // DEV-TASK-47: E01 (ORDER_PLACED) đã được tắt theo chính sách tinh gọn thông báo email

    return result
  } catch (error) {
    console.error('Error placing preorder:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Đặt trước thất bại, vui lòng thử lại',
    }
  }
}

// 2. ADMIN PROCESS HARVEST SCHEMA
const adminProcessHarvestSchema = z.object({
  orderId: z.string().min(1, 'Thiếu mã đơn hàng'),
  finalPricePerKg: z.number().int().min(0, 'Đơn giá chốt vụ không hợp lệ'),
  fulfilledGrams: z.number().int().min(0, 'Khối lượng giao thực tế không hợp lệ'),
  deliveryDate: z.string().optional(),
  timeSlot: z.nativeEnum(TimeSlot).optional(),
  batchId: z.string().optional(),
  adminNote: z.string().max(500).optional(),
})

export type AdminProcessHarvestInput = z.infer<typeof adminProcessHarvestSchema>

export interface AdminProcessHarvestResult {
  success: boolean
  action?: 'LOST_AND_CANCELLED' | 'CONFIRMED_IN_BAND' | 'WAITING_CUSTOMER_DECISION'
  diffPercent?: number
  inBand?: boolean
  error?: string
}

/**
 * Server Action: Ban quản trị chốt vụ mùa cho đơn đặt trước (Mục 3.10)
 * - Chỉ áp dụng cho đơn PREORDER ở trạng thái PREORDER_WAITING
 * - 1. Nếu mất mùa (fulfilledGrams === 0): Tự động CANCELLED, hoàn 100% tiền cọc
 * - 2. So sánh đơn giá thực tế với preorderPricePerKg (biên độ bandPercent, mặc định 10%):
 *      - Trong biên độ (<= 10%): Chốt giá sau chiết khấu, gán deliveryDate & timeSlot, chuyển PROCESSING.
 *        Nếu sản lượng thiếu hụt, tạo giao dịch REFUND cọc tương ứng.
 *      - Ngoài biên độ (> 10%): Lưu preorderFinalPricePerKg và preorderFulfilledGrams,
 *        giữ nguyên PREORDER_WAITING, phát sự kiện PREORDER_HARVEST_READY chờ khách hàng quyết định.
 *        Nếu sản lượng thiếu hụt, cũng ghi nhận lệnh hoàn cọc thiếu hụt.
 */
export async function adminProcessHarvest(
  input: AdminProcessHarvestInput
): Promise<AdminProcessHarvestResult> {
  try {
    const admin = await requireAdmin()
    const validated = adminProcessHarvestSchema.parse(input)

    return await db.$transaction(
      async (tx) => {
        try {
          await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${validated.orderId} FOR UPDATE`
        } catch {
          // Bỏ qua nếu SQLite / mock test không hỗ trợ FOR UPDATE
        }

        const order = await tx.order.findUnique({
          where: { id: validated.orderId },
          include: {
            items: {
              include: {
                packaging: {
                  include: {
                    product: true,
                  },
                },
              },
            },
            transactions: true,
            user: {
              include: { group: true },
            },
          },
        })

        if (!order) {
          throw new Error('Không tìm thấy đơn hàng')
        }

        if (order.type !== OrderType.PREORDER) {
          throw new Error('Đơn hàng không phải là loại đặt trước vụ mùa (PREORDER)')
        }

        if (order.status !== OrderStatus.PREORDER_WAITING) {
          throw new Error(`Chỉ có thể chốt vụ mùa khi đơn ở trạng thái PREORDER_WAITING (hiện tại: ${order.status})`)
        }

        const firstItem = order.items[0]
        if (!firstItem) {
          throw new Error('Đơn hàng không có dòng sản phẩm nào')
        }

        const product = firstItem.packaging.product
        const basePreorderPrice = product?.preorderPricePerKg ?? firstItem.unitPricePerKg
        const bandPercent = product?.preorderBandPercent ?? 10
        const orderedGrams = firstItem.orderedGrams

        // Trường hợp 1: Mất mùa 100% (fulfilledGrams === 0)
        if (validated.fulfilledGrams <= 0) {
          const totalPaid = order.transactions
            .filter((t) => t.type === TxType.PAYMENT && t.status === TxStatus.DONE)
            .reduce((sum, t) => sum + t.amount, 0)

          await tx.order.update({
            where: { id: order.id },
            data: {
              status: OrderStatus.CANCELLED,
              cancelledBy: CancelActor.SELLER,
              cancelReason: 'Vụ mùa thất thu 100%, không có sản lượng để thu hoạch và bàn giao',
              preorderFinalPricePerKg: validated.finalPricePerKg,
              preorderFulfilledGrams: 0,
            },
          })

          if (totalPaid > 0) {
            await tx.paymentTransaction.create({
              data: {
                orderId: order.id,
                type: TxType.REFUND,
                status: TxStatus.PENDING,
                method: TxMethod.BANK_TRANSFER,
                amount: totalPaid,
                note: 'Hoàn trả 100% tiền cọc do vườn mất mùa 100%',
              },
            })
          }

          await recordOrderEvent(tx, {
            orderId: order.id,
            type: 'PREORDER_HARVEST_LOST',
            fromStatus: OrderStatus.PREORDER_WAITING,
            toStatus: OrderStatus.CANCELLED,
            actorId: admin.id,
            note: `Nhà vườn thông báo thất thu 100%. Đã hủy đơn và tạo lệnh hoàn trả ${totalPaid.toLocaleString('vi-VN')} đ tiền cọc cho khách.`,
            payload: {
              finalPricePerKg: validated.finalPricePerKg,
              fulfilledGrams: 0,
              refundAmount: totalPaid,
            },
          })

          revalidatePath(`/admin/don-hang/${order.code}`)
          revalidatePath(`/tai-khoan/don-hang/${order.code}`)

          return {
            success: true,
            action: 'LOST_AND_CANCELLED',
            inBand: false,
          }
        }

        // Trường hợp 2: Có thu hoạch -> Kiểm tra biên độ giá
        const bandResult = checkPriceBand(basePreorderPrice, validated.finalPricePerKg, bandPercent)

        // Tính cọc hoàn do thiếu hụt sản lượng (R3)
        const shortfallRefund = computePreorderShortfallRefund({
          depositAmount: order.depositAmount,
          orderedGrams,
          fulfilledGrams: validated.fulfilledGrams,
        })

        if (shortfallRefund > 0) {
          await tx.paymentTransaction.create({
            data: {
              orderId: order.id,
              type: TxType.REFUND,
              status: TxStatus.PENDING,
              method: TxMethod.BANK_TRANSFER,
              amount: shortfallRefund,
              reference: 'REFUND_SHORTFALL',
              note: `Hoàn tiền cọc do sản lượng thu hoạch thiếu hụt (${validated.fulfilledGrams / 1000}kg / ${orderedGrams / 1000}kg)`,
            },
          })
        }

        // A. Trong biên độ (<= bandPercent, mặc định 10%)
        if (bandResult.inBand) {
          if (!validated.deliveryDate) {
            throw new Error('Vui lòng chọn ngày giao hàng khi đơn giá chốt trong biên độ')
          }

          const [year, month, day] = validated.deliveryDate.split('-').map(Number)
          const deliveryDate = new Date(Date.UTC(year, month - 1, day))
          const timeSlot = validated.timeSlot ?? TimeSlot.MORNING

          const groupDiscount = order.groupDiscountPercent || 0
          const finalDiscountedPricePerKg = Math.round(
            validated.finalPricePerKg * (1 - groupDiscount / 100)
          )
          const finalLineTotal = Math.round(
            (finalDiscountedPricePerKg * validated.fulfilledGrams) / 1000
          )
          const finalTotal = finalLineTotal + order.shippingFee

          // Cập nhật OrderItem
          await tx.orderItem.update({
            where: { id: firstItem.id },
            data: {
              actualGrams: validated.fulfilledGrams,
              unitPricePerKg: finalDiscountedPricePerKg,
              finalLineTotal,
              batchId: validated.batchId || null,
            },
          })

          // Cập nhật Order chuyển sang PROCESSING
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: OrderStatus.PROCESSING,
              deliveryDate,
              timeSlot,
              preorderFinalPricePerKg: validated.finalPricePerKg,
              preorderFulfilledGrams: validated.fulfilledGrams,
              finalSubtotal: finalLineTotal,
              finalTotal,
            },
          })

          await recordOrderEvent(tx, {
            orderId: order.id,
            type: 'PREORDER_HARVEST_READY',
            fromStatus: OrderStatus.PREORDER_WAITING,
            toStatus: OrderStatus.PROCESSING,
            actorId: admin.id,
            note: `Admin chốt vụ mùa trong biên độ (Đơn giá: ${validated.finalPricePerKg.toLocaleString('vi-VN')} đ/kg, Biến động: ${bandResult.diffPercent}%, Giao: ${validated.fulfilledGrams / 1000}kg). Đơn chuyển sang Đang xử lý.${shortfallRefund > 0 ? ` Hoàn cọc thiếu hụt: ${shortfallRefund.toLocaleString('vi-VN')} đ.` : ''}`,
            payload: {
              finalPricePerKg: validated.finalPricePerKg,
              fulfilledGrams: validated.fulfilledGrams,
              diffPercent: bandResult.diffPercent,
              shortfallRefund,
            },
          })

          revalidatePath(`/admin/don-hang/${order.code}`)
          revalidatePath(`/tai-khoan/don-hang/${order.code}`)

          return {
            success: true,
            action: 'CONFIRMED_IN_BAND',
            diffPercent: bandResult.diffPercent,
            inBand: true,
          }
        }

        // B. Ngoài biên độ (> bandPercent, mặc định 10%) -> Chờ khách hàng quyết định
        let outOfBandDeliveryDate: Date | null = null
        if (validated.deliveryDate) {
          const [year, month, day] = validated.deliveryDate.split('-').map(Number)
          outOfBandDeliveryDate = new Date(Date.UTC(year, month - 1, day))
        }

        await tx.order.update({
          where: { id: order.id },
          data: {
            preorderFinalPricePerKg: validated.finalPricePerKg,
            preorderFulfilledGrams: validated.fulfilledGrams,
            preorderCustomerDecision: 'PENDING',
            ...(outOfBandDeliveryDate ? { deliveryDate: outOfBandDeliveryDate } : {}),
            ...(validated.timeSlot ? { timeSlot: validated.timeSlot } : {}),
          },
        })

        if (validated.batchId) {
          await tx.orderItem.update({
            where: { id: firstItem.id },
            data: { batchId: validated.batchId },
          })
        }

        await recordOrderEvent(tx, {
          orderId: order.id,
          type: 'PREORDER_HARVEST_READY',
          fromStatus: OrderStatus.PREORDER_WAITING,
          toStatus: OrderStatus.PREORDER_WAITING,
          actorId: admin.id,
          note: `Admin chốt vụ mùa ngoài biên độ ±${bandPercent}% (Đơn giá: ${validated.finalPricePerKg.toLocaleString('vi-VN')} đ/kg, Biến động: ${bandResult.diffPercent}%, Giao: ${validated.fulfilledGrams / 1000}kg). Đang chờ khách hàng xác nhận.${shortfallRefund > 0 ? ` Hoàn cọc thiếu hụt: ${shortfallRefund.toLocaleString('vi-VN')} đ.` : ''}`,
          payload: {
            finalPricePerKg: validated.finalPricePerKg,
            fulfilledGrams: validated.fulfilledGrams,
            diffPercent: bandResult.diffPercent,
            shortfallRefund,
          },
        })

        revalidatePath(`/admin/don-hang/${order.code}`)
        revalidatePath(`/tai-khoan/don-hang/${order.code}`)

        return {
          success: true,
          action: 'WAITING_CUSTOMER_DECISION',
          diffPercent: bandResult.diffPercent,
          inBand: false,
        }
      },
      { timeout: 15000 }
    )
  } catch (error) {
    console.error('Error processing harvest:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Chốt vụ mùa thất bại, vui lòng thử lại',
    }
  }
}

// 3. CUSTOMER DECIDE PRE-ORDER SCHEMA
const customerDecidePreorderSchema = z.object({
  orderId: z.string().min(1, 'Thiếu mã đơn hàng'),
  decision: z.enum(['ACCEPT', 'CANCEL']),
})

export type CustomerDecidePreorderInput = z.infer<typeof customerDecidePreorderSchema>

export interface CustomerDecidePreorderResult {
  success: boolean
  decision?: 'ACCEPT' | 'CANCEL'
  refundAmount?: number
  error?: string
}

/**
 * Server Action: Khách hàng phản hồi khi đơn giá vụ mùa vượt biên độ (Mục 3.10)
 * - ACCEPT: Chấp nhận giá mới -> Đơn chuyển sang PROCESSING
 * - CANCEL: Từ chối giá mới -> Đơn chuyển sang CANCELLED, hoàn 100% tiền cọc (trừ khoản cọc đã hoàn thiếu hụt để tránh double refund)
 */
export async function customerDecidePreorder(
  input: CustomerDecidePreorderInput
): Promise<CustomerDecidePreorderResult> {
  try {
    const sessionUser = await requireUser()
    const validated = customerDecidePreorderSchema.parse(input)

    return await db.$transaction(
      async (tx) => {
        try {
          await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${validated.orderId} FOR UPDATE`
        } catch {
          // Bỏ qua nếu SQLite / mock test không hỗ trợ FOR UPDATE
        }

        const order = await tx.order.findUnique({
          where: { id: validated.orderId },
          include: {
            items: {
              include: {
                packaging: {
                  include: {
                    product: true,
                  },
                },
              },
            },
            transactions: true,
          },
        })

        if (!order) {
          throw new Error('Không tìm thấy đơn hàng')
        }

        if (order.userId !== sessionUser.id) {
          throw new Error('Bạn không có quyền quyết định đơn hàng của tài khoản khác')
        }

        if (order.type !== OrderType.PREORDER) {
          throw new Error('Đơn hàng không phải là đơn đặt trước vụ mùa')
        }

        if (order.status !== OrderStatus.PREORDER_WAITING) {
          throw new Error('Đơn hàng hiện không ở trạng thái chờ khách hàng xác nhận giá')
        }

        if (order.preorderFinalPricePerKg === null || order.preorderFinalPricePerKg === undefined) {
          throw new Error('Nhà vườn chưa công bố đơn giá chốt vụ thực tế')
        }

        const firstItem = order.items[0]
        if (!firstItem) {
          throw new Error('Đơn hàng không có sản phẩm')
        }

        // Quyết định 1: CHẤP NHẬN GIÁ MỚI (ACCEPT)
        if (validated.decision === 'ACCEPT') {
          const transitionCheck = canTransition(order, OrderStatus.PROCESSING, 'CUSTOMER')
          if (!transitionCheck.ok) {
            throw new Error(transitionCheck.reason || 'Không thể chuyển đơn hàng sang Đang xử lý')
          }

          const groupDiscount = order.groupDiscountPercent || 0
          const finalDiscountedPricePerKg = Math.round(
            order.preorderFinalPricePerKg * (1 - groupDiscount / 100)
          )
          const fulfilledGrams = order.preorderFulfilledGrams ?? firstItem.orderedGrams
          const finalLineTotal = Math.round(
            (finalDiscountedPricePerKg * fulfilledGrams) / 1000
          )
          const finalTotal = finalLineTotal + order.shippingFee

          // Đảm bảo deliveryDate và timeSlot hợp lệ khi chuyển sang PROCESSING (Integration Check B & Sanity Check)
          const leadTime = firstItem.packaging?.product?.leadTimeDays ?? 1
          const now = new Date()
          const minDeliveryDate = earliestDeliveryDate(now, [leadTime])
          const deliveryDate =
            order.deliveryDate && isDeliveryDateValid(order.deliveryDate, minDeliveryDate)
              ? order.deliveryDate
              : minDeliveryDate
          const timeSlot = order.timeSlot ?? TimeSlot.MORNING

          await tx.orderItem.update({
            where: { id: firstItem.id },
            data: {
              actualGrams: fulfilledGrams,
              unitPricePerKg: finalDiscountedPricePerKg,
              finalLineTotal,
            },
          })

          await tx.order.update({
            where: { id: order.id },
            data: {
              status: OrderStatus.PROCESSING,
              deliveryDate,
              timeSlot,
              preorderCustomerDecision: 'ACCEPT',
              finalSubtotal: finalLineTotal,
              finalTotal,
            },
          })

          await recordOrderEvent(tx, {
            orderId: order.id,
            type: 'STATUS_CHANGED',
            fromStatus: OrderStatus.PREORDER_WAITING,
            toStatus: OrderStatus.PROCESSING,
            actorId: sessionUser.id,
            note: `Khách hàng chấp nhận đơn giá chốt vụ (${order.preorderFinalPricePerKg.toLocaleString('vi-VN')} đ/kg). Đơn chuyển sang Đang xử lý.`,
            payload: {
              decision: 'ACCEPT',
              finalPricePerKg: order.preorderFinalPricePerKg,
              fulfilledGrams,
            },
          })

          revalidatePath(`/admin/don-hang/${order.code}`)
          revalidatePath(`/tai-khoan/don-hang/${order.code}`)

          return {
            success: true,
            decision: 'ACCEPT',
          }
        }

        // Quyết định 2: TỪ CHỐI VÀ HỦY ĐƠN (CANCEL) -> Hoàn 100% tiền cọc
        const totalPaid = order.transactions
          .filter((t) => t.type === TxType.PAYMENT && t.status === TxStatus.DONE)
          .reduce((sum, t) => sum + t.amount, 0)

        const alreadyRefunded = order.transactions
          .filter(
            (t) =>
              t.type === TxType.REFUND &&
              (t.status === TxStatus.DONE || t.status === TxStatus.PENDING)
          )
          .reduce((sum, t) => sum + t.amount, 0)

        const remainingRefund = computeOutOfBandCancellationRefund({
          paidAmount: totalPaid,
          shortfallRefundAmount: alreadyRefunded,
        })

        if (remainingRefund > 0) {
          await tx.paymentTransaction.create({
            data: {
              orderId: order.id,
              type: TxType.REFUND,
              status: TxStatus.PENDING,
              method: TxMethod.BANK_TRANSFER,
              amount: remainingRefund,
              note: 'Hoàn lại tiền cọc do khách hàng từ chối giá mùa vụ vượt biên độ thỏa thuận',
            },
          })
        }

        await tx.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.CANCELLED,
            cancelledBy: CancelActor.CUSTOMER,
            cancelReason: 'Khách hàng từ chối nhận hàng do đơn giá chốt vụ mùa vượt biên độ thỏa thuận',
            preorderCustomerDecision: 'CANCEL',
          },
        })

        await recordOrderEvent(tx, {
          orderId: order.id,
          type: 'STATUS_CHANGED',
          fromStatus: OrderStatus.PREORDER_WAITING,
          toStatus: OrderStatus.CANCELLED,
          actorId: sessionUser.id,
          note: `Khách hàng từ chối giá mùa vụ vượt biên độ thỏa thuận (${order.preorderFinalPricePerKg.toLocaleString('vi-VN')} đ/kg). Đã hủy đơn và tạo lệnh hoàn trả ${remainingRefund.toLocaleString('vi-VN')} đ tiền cọc còn lại.`,
          payload: {
            decision: 'CANCEL',
            finalPricePerKg: order.preorderFinalPricePerKg,
            refundAmount: remainingRefund,
          },
        })

        revalidatePath(`/admin/don-hang/${order.code}`)
        revalidatePath(`/tai-khoan/don-hang/${order.code}`)

        return {
          success: true,
          decision: 'CANCEL',
          refundAmount: remainingRefund,
        }
      },
      { timeout: 15000 }
    )
  } catch (error) {
    console.error('Error deciding preorder:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Xử lý quyết định thất bại, vui lòng thử lại',
    }
  }
}
