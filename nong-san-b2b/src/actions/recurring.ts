'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireUser, requireAdmin } from '@/lib/auth'
import { priceCart, ProductPricingData } from '@/lib/domain/pricing'
import { earliestDeliveryDate, isDeliveryDateValid } from '@/lib/domain/delivery-date'
import { checkCapacity, getWeekStartMonday } from '@/lib/domain/capacity'
import { getShippingCalculator } from '@/lib/domain/shipping'
import { computeDepositAmount } from '@/lib/domain/settlement'
import { canTransition } from '@/lib/domain/order-state'
import { isDraftExpired } from '@/lib/domain/recurring'
import { processRecurringSchedules, RecurringGeneratorResult } from '@/lib/services/recurring-generator'
import { recordOrderEvent } from '@/lib/events'
import { OrderStatus, PaymentOption, TimeSlot } from '@prisma/client'

const recurringItemInputSchema = z.object({
  productId: z.string().min(1, 'Vui lòng chọn sản phẩm'),
  packagingId: z.string().min(1, 'Vui lòng chọn quy cách'),
  quantity: z.number().int().positive('Số lượng phải lớn hơn 0'),
})

const createScheduleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Vui lòng nhập tên lịch giao định kỳ')
    .max(120, 'Tên lịch tối đa 120 ký tự'),
  weekdays: z
    .array(z.number().int().min(1).max(7))
    .min(1, 'Vui lòng chọn ít nhất 1 ngày trong tuần (Thứ 2 – Chủ Nhật)'),
  timeSlot: z.nativeEnum(TimeSlot, {
    message: 'Khung giờ giao hàng không hợp lệ',
  }),
  addressId: z.string().min(1, 'Vui lòng chọn địa chỉ giao hàng'),
  paymentOption: z.nativeEnum(PaymentOption, {
    message: 'Hình thức thanh toán mặc định không hợp lệ',
  }),
  items: z.array(recurringItemInputSchema).min(1, 'Vui lòng chọn ít nhất 1 sản phẩm định kỳ'),
})

const updateScheduleSchema = createScheduleSchema.extend({
  scheduleId: z.string().min(1, 'Thiếu mã lịch định kỳ'),
  isActive: z.boolean().optional(),
})

const createFromOrderSchema = z.object({
  orderId: z.string().min(1, 'Thiếu mã đơn hàng gốc'),
  name: z
    .string()
    .trim()
    .min(1, 'Vui lòng nhập tên lịch giao định kỳ')
    .max(120, 'Tên lịch tối đa 120 ký tự'),
  weekdays: z
    .array(z.number().int().min(1).max(7))
    .min(1, 'Vui lòng chọn ít nhất 1 ngày trong tuần (Thứ 2 – Chủ Nhật)'),
  timeSlot: z.nativeEnum(TimeSlot).optional(),
  addressId: z.string().min(1).optional(),
  paymentOption: z.nativeEnum(PaymentOption).optional(),
})

const confirmDraftSchema = z.object({
  orderId: z.string().min(1, 'Thiếu mã đơn nháp'),
  paymentOption: z.nativeEnum(PaymentOption, {
    message: 'Vui lòng chọn hình thức thanh toán hợp lệ',
  }),
  items: z
    .array(recurringItemInputSchema)
    .min(1, 'Đơn hàng phải có ít nhất 1 dòng sản phẩm'),
  customerNote: z.string().max(500, 'Ghi chú tối đa 500 ký tự').optional(),
})

export type CreateRecurringScheduleInput = z.infer<typeof createScheduleSchema>
export type UpdateRecurringScheduleInput = z.infer<typeof updateScheduleSchema>
export type CreateRecurringFromOrderInput = z.infer<typeof createFromOrderSchema>
export type ConfirmRecurringDraftInput = z.infer<typeof confirmDraftSchema>

export interface RecurringActionResult {
  success: boolean
  scheduleId?: string
  orderCode?: string
  orderId?: string
  error?: string
}

function normalizeWeekdays(weekdays: number[]): number[] {
  return [...new Set(weekdays.filter((w) => Number.isInteger(w) && w >= 1 && w <= 7))].sort(
    (a, b) => a - b
  )
}

function mergeRecurringItems(
  items: Array<{ productId: string; packagingId: string; quantity: number }>
): Array<{ productId: string; packagingId: string; quantity: number }> {
  const map = new Map<string, { productId: string; packagingId: string; quantity: number }>()
  for (const item of items) {
    const key = `${item.productId}::${item.packagingId}`
    const existing = map.get(key)
    if (existing) {
      existing.quantity += item.quantity
    } else {
      map.set(key, {
        productId: item.productId,
        packagingId: item.packagingId,
        quantity: item.quantity,
      })
    }
  }
  return Array.from(map.values())
}

/**
 * Tạo lịch giao hàng định kỳ mới (thủ công)
 */
export async function createRecurringSchedule(
  input: CreateRecurringScheduleInput
): Promise<RecurringActionResult> {
  try {
    const sessionUser = await requireUser()
    const validated = createScheduleSchema.parse(input)
    const weekdays = normalizeWeekdays(validated.weekdays)
    if (weekdays.length === 0) {
      return { success: false, error: 'Vui lòng chọn ít nhất 1 thứ hợp lệ trong tuần' }
    }

    const mergedItems = mergeRecurringItems(validated.items)

    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: sessionUser.id },
        include: { group: true },
      })
      if (!user) {
        throw new Error('Không tìm thấy tài khoản khách hàng')
      }

      const address = await tx.address.findFirst({
        where: {
          id: validated.addressId,
          userId: sessionUser.id,
        },
      })
      if (!address) {
        throw new Error('Địa chỉ giao hàng không tồn tại hoặc không thuộc tài khoản của bạn')
      }

      const productIds = [...new Set(mergedItems.map((i) => i.productId))]
      const products = await tx.product.findMany({
        where: {
          id: { in: productIds },
          isActive: true,
        },
        include: {
          packagings: { where: { isActive: true } },
          priceTiers: { orderBy: { minGrams: 'asc' } },
        },
      })

      if (products.length !== productIds.length) {
        throw new Error('Một hoặc nhiều sản phẩm không tồn tại hoặc đã ngừng kinh doanh')
      }

      for (const item of mergedItems) {
        const prod = products.find((p) => p.id === item.productId)
        const pkg = prod?.packagings.find((pk) => pk.id === item.packagingId)
        if (!pkg) {
          throw new Error(`Quy cách đóng gói của sản phẩm "${prod?.name ?? ''}" không hợp lệ`)
        }
        if (pkg.isSample) {
          throw new Error(
            `Không thể đưa gói mẫu thử (${prod?.name} - ${pkg.name}) vào lịch giao định kỳ`
          )
        }
      }

      const pricingProducts: ProductPricingData[] = products.map((p) => ({
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

      const quote = priceCart({
        lines: mergedItems,
        products: pricingProducts,
        groupDiscountPercent: user.group?.discountPercent ?? 0,
      })

      if (quote.errors.length > 0) {
        throw new Error(quote.errors.join('. '))
      }

      const created = await tx.recurringSchedule.create({
        data: {
          userId: sessionUser.id,
          name: validated.name,
          weekdays,
          timeSlot: validated.timeSlot,
          addressId: address.id,
          paymentOption: validated.paymentOption,
          isActive: true,
          items: {
            create: mergedItems.map((item) => ({
              productId: item.productId,
              packagingId: item.packagingId,
              quantity: item.quantity,
            })),
          },
        },
      })

      return created
    })

    revalidatePath('/tai-khoan/dinh-ky')
    revalidatePath('/admin/dinh-ky')
    return { success: true, scheduleId: result.id }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.issues[0]?.message || 'Dữ liệu lịch định kỳ không hợp lệ',
      }
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Không thể tạo lịch định kỳ',
    }
  }
}

/**
 * Tạo lịch định kỳ nhanh từ một đơn hàng đã COMPLETED ("Đặt định kỳ từ đơn này")
 */
export async function createRecurringFromOrder(
  input: CreateRecurringFromOrderInput
): Promise<RecurringActionResult> {
  try {
    const sessionUser = await requireUser()
    const validated = createFromOrderSchema.parse(input)
    const weekdays = normalizeWeekdays(validated.weekdays)
    if (weekdays.length === 0) {
      return { success: false, error: 'Vui lòng chọn ít nhất 1 thứ hợp lệ trong tuần' }
    }

    const result = await db.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: {
          id: validated.orderId,
          userId: sessionUser.id,
        },
        include: {
          items: true,
          user: { include: { group: true } },
        },
      })

      if (!order) {
        throw new Error('Không tìm thấy đơn hàng hoặc bạn không có quyền truy cập')
      }

      if (order.status !== OrderStatus.COMPLETED) {
        throw new Error('Chỉ có thể tạo lịch định kỳ từ đơn hàng đã hoàn thành (COMPLETED)')
      }

      const regularItems = order.items.filter((i) => !i.isSample && i.quantity > 0)
      if (regularItems.length === 0) {
        throw new Error('Đơn hàng này chỉ có gói mẫu thử, không có sản phẩm thương mại để đặt định kỳ')
      }

      const mergedItems = mergeRecurringItems(
        regularItems.map((i) => ({
          productId: i.productId,
          packagingId: i.packagingId,
          quantity: i.quantity,
        }))
      )

      // Xác định địa chỉ giao hàng
      const snapshotObj = order.addressSnapshot as Record<string, unknown> | null
      const snapshotAddressId =
        snapshotObj && typeof snapshotObj.id === 'string' ? snapshotObj.id : undefined
      const preferredAddressId = validated.addressId || snapshotAddressId

      let address = preferredAddressId
        ? await tx.address.findFirst({
            where: { id: preferredAddressId, userId: sessionUser.id },
          })
        : null

      if (!address) {
        address = await tx.address.findFirst({
          where: { userId: sessionUser.id },
          orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
        })
      }

      if (!address) {
        throw new Error('Vui lòng thêm ít nhất một địa chỉ giao hàng trong Sổ địa chỉ trước khi tạo lịch định kỳ')
      }

      // Kiểm tra sản phẩm & quy cách vẫn còn hoạt động và đạt MOQ hiện hành
      const productIds = [...new Set(mergedItems.map((i) => i.productId))]
      const products = await tx.product.findMany({
        where: {
          id: { in: productIds },
          isActive: true,
        },
        include: {
          packagings: { where: { isActive: true } },
          priceTiers: { orderBy: { minGrams: 'asc' } },
        },
      })

      if (products.length !== productIds.length) {
        throw new Error('Một số sản phẩm trong đơn cũ hiện đã ngừng kinh doanh')
      }

      for (const item of mergedItems) {
        const prod = products.find((p) => p.id === item.productId)
        const pkg = prod?.packagings.find((pk) => pk.id === item.packagingId && !pk.isSample)
        if (!pkg) {
          throw new Error(`Quy cách đóng gói của sản phẩm "${prod?.name ?? ''}" hiện không còn khả dụng`)
        }
      }

      const pricingProducts: ProductPricingData[] = products.map((p) => ({
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

      const quote = priceCart({
        lines: mergedItems,
        products: pricingProducts,
        groupDiscountPercent: order.user.group?.discountPercent ?? 0,
      })

      if (quote.errors.length > 0) {
        throw new Error(quote.errors.join('. '))
      }

      const schedule = await tx.recurringSchedule.create({
        data: {
          userId: sessionUser.id,
          name: validated.name,
          weekdays,
          timeSlot: validated.timeSlot ?? order.timeSlot ?? TimeSlot.MORNING,
          addressId: address.id,
          paymentOption: validated.paymentOption ?? order.paymentOption,
          isActive: true,
          items: {
            create: mergedItems.map((item) => ({
              productId: item.productId,
              packagingId: item.packagingId,
              quantity: item.quantity,
            })),
          },
        },
      })

      return { schedule, orderCode: order.code }
    })

    revalidatePath('/tai-khoan/dinh-ky')
    revalidatePath(`/tai-khoan/don-hang/${result.orderCode}`)
    revalidatePath('/admin/dinh-ky')
    return { success: true, scheduleId: result.schedule.id }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.issues[0]?.message || 'Dữ liệu tạo lịch định kỳ không hợp lệ',
      }
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Không thể tạo lịch định kỳ từ đơn hàng',
    }
  }
}

/**
 * Cập nhật lịch giao định kỳ của khách hàng
 */
export async function updateRecurringSchedule(
  input: UpdateRecurringScheduleInput
): Promise<RecurringActionResult> {
  try {
    const sessionUser = await requireUser()
    const validated = updateScheduleSchema.parse(input)
    const weekdays = normalizeWeekdays(validated.weekdays)
    if (weekdays.length === 0) {
      return { success: false, error: 'Vui lòng chọn ít nhất 1 thứ hợp lệ trong tuần' }
    }

    const mergedItems = mergeRecurringItems(validated.items)

    await db.$transaction(async (tx) => {
      const existing = await tx.recurringSchedule.findFirst({
        where: {
          id: validated.scheduleId,
          userId: sessionUser.id,
        },
      })
      if (!existing) {
        throw new Error('Không tìm thấy lịch định kỳ hoặc bạn không có quyền chỉnh sửa')
      }

      const user = await tx.user.findUnique({
        where: { id: sessionUser.id },
        include: { group: true },
      })

      const address = await tx.address.findFirst({
        where: {
          id: validated.addressId,
          userId: sessionUser.id,
        },
      })
      if (!address) {
        throw new Error('Địa chỉ giao hàng không hợp lệ hoặc không thuộc tài khoản của bạn')
      }

      const productIds = [...new Set(mergedItems.map((i) => i.productId))]
      const products = await tx.product.findMany({
        where: {
          id: { in: productIds },
          isActive: true,
        },
        include: {
          packagings: { where: { isActive: true } },
          priceTiers: { orderBy: { minGrams: 'asc' } },
        },
      })

      if (products.length !== productIds.length) {
        throw new Error('Một hoặc nhiều sản phẩm không tồn tại hoặc đã ngừng kinh doanh')
      }

      for (const item of mergedItems) {
        const prod = products.find((p) => p.id === item.productId)
        const pkg = prod?.packagings.find((pk) => pk.id === item.packagingId)
        if (!pkg || pkg.isSample) {
          throw new Error(`Quy cách đóng gói của sản phẩm "${prod?.name ?? ''}" không hợp lệ`)
        }
      }

      const pricingProducts: ProductPricingData[] = products.map((p) => ({
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

      const quote = priceCart({
        lines: mergedItems,
        products: pricingProducts,
        groupDiscountPercent: user?.group?.discountPercent ?? 0,
      })

      if (quote.errors.length > 0) {
        throw new Error(quote.errors.join('. '))
      }

      await tx.recurringItem.deleteMany({
        where: { scheduleId: existing.id },
      })

      await tx.recurringSchedule.update({
        where: { id: existing.id },
        data: {
          name: validated.name,
          weekdays,
          timeSlot: validated.timeSlot,
          addressId: address.id,
          paymentOption: validated.paymentOption,
          ...(typeof validated.isActive === 'boolean' ? { isActive: validated.isActive } : {}),
          items: {
            create: mergedItems.map((item) => ({
              productId: item.productId,
              packagingId: item.packagingId,
              quantity: item.quantity,
            })),
          },
        },
      })
    })

    revalidatePath('/tai-khoan/dinh-ky')
    revalidatePath('/admin/dinh-ky')
    return { success: true, scheduleId: validated.scheduleId }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.issues[0]?.message || 'Dữ liệu cập nhật lịch định kỳ không hợp lệ',
      }
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Không thể cập nhật lịch định kỳ',
    }
  }
}

/**
 * Bật / Tắt lịch giao định kỳ của khách hàng
 */
export async function toggleRecurringSchedule(
  scheduleId: string,
  isActive: boolean
): Promise<RecurringActionResult> {
  try {
    const sessionUser = await requireUser()
    if (!scheduleId) {
      return { success: false, error: 'Thiếu mã lịch định kỳ' }
    }

    const existing = await db.recurringSchedule.findFirst({
      where: {
        id: scheduleId,
        userId: sessionUser.id,
      },
    })

    if (!existing) {
      return {
        success: false,
        error: 'Không tìm thấy lịch định kỳ hoặc bạn không có quyền thực hiện',
      }
    }

    await db.recurringSchedule.update({
      where: { id: existing.id },
      data: { isActive: Boolean(isActive) },
    })

    revalidatePath('/tai-khoan/dinh-ky')
    revalidatePath('/admin/dinh-ky')
    return { success: true, scheduleId: existing.id }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Không thể thay đổi trạng thái lịch định kỳ',
    }
  }
}

/**
 * Xóa lịch giao định kỳ của khách hàng
 */
export async function deleteRecurringSchedule(scheduleId: string): Promise<RecurringActionResult> {
  try {
    const sessionUser = await requireUser()
    if (!scheduleId) {
      return { success: false, error: 'Thiếu mã lịch định kỳ' }
    }

    await db.$transaction(async (tx) => {
      const existing = await tx.recurringSchedule.findFirst({
        where: {
          id: scheduleId,
          userId: sessionUser.id,
        },
      })

      if (!existing) {
        throw new Error('Không tìm thấy lịch định kỳ hoặc bạn không có quyền xóa')
      }

      // Ngắt liên kết các đơn hàng đã sinh trước đó để không vi phạm khóa ngoại
      await tx.order.updateMany({
        where: { recurringScheduleId: existing.id },
        data: { recurringScheduleId: null },
      })

      await tx.recurringSchedule.delete({
        where: { id: existing.id },
      })
    })

    revalidatePath('/tai-khoan/dinh-ky')
    revalidatePath('/admin/dinh-ky')
    return { success: true, scheduleId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Không thể xóa lịch định kỳ',
    }
  }
}

/**
 * Khách hàng xác nhận đơn nháp định kỳ (DRAFT -> PENDING_CONFIRMATION):
 * - Tính lại giá bằng `priceCart()` tại thời điểm xác nhận
 * - Kiểm tra MOQ, sản phẩm/quy cách active, hạn xác nhận / earliestDeliveryDate, WeeklyCapacity
 * - Cập nhật nguyên tử `updateMany({ where: { id, status: DRAFT } })` chống double-submit
 * - Thiết lập `paymentDueAt = now + 24h`, ghi `OrderEvent`, sau đó chuyển sang `/thanh-toan/[code]`
 */
export async function confirmRecurringDraft(
  input: ConfirmRecurringDraftInput
): Promise<RecurringActionResult> {
  try {
    const sessionUser = await requireUser()
    const validated = confirmDraftSchema.parse(input)
    const mergedItems = mergeRecurringItems(validated.items)
    const now = new Date()

    const result = await db.$transaction(async (tx) => {
      try {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${validated.orderId} FOR UPDATE`
      } catch {
        // Bỏ qua nếu môi trường test / driver không hỗ trợ raw query
      }

      const order = await tx.order.findUnique({
        where: { id: validated.orderId },
        include: {
          items: true,
          user: { include: { group: true } },
        },
      })

      if (!order || order.userId !== sessionUser.id) {
        throw new Error('Không tìm thấy đơn nháp hoặc bạn không có quyền xác nhận đơn này')
      }

      const transitionCheck = canTransition(
        {
          status: order.status,
          paymentOption: validated.paymentOption,
          total: order.total,
          depositAmount: order.depositAmount,
          deliveredAt: null,
        },
        OrderStatus.PENDING_CONFIRMATION,
        'CUSTOMER',
        {
          paidAmount: 0,
          hasPendingRefund: false,
          hasComplaint: false,
          now,
        }
      )

      if (!transitionCheck.ok || order.status !== OrderStatus.DRAFT) {
        throw new Error(
          transitionCheck.reason || 'Chỉ đơn nháp (DRAFT) mới có thể xác nhận thanh toán'
        )
      }

      if (!order.deliveryDate) {
        throw new Error('Đơn nháp thiếu thông tin ngày giao hàng')
      }

      const productIds = [...new Set(mergedItems.map((i) => i.productId))]
      const products = await tx.product.findMany({
        where: {
          id: { in: productIds },
          isActive: true,
        },
        include: {
          packagings: { where: { isActive: true } },
          priceTiers: { orderBy: { minGrams: 'asc' } },
        },
      })

      if (products.length !== productIds.length) {
        throw new Error('Một hoặc nhiều sản phẩm trong đơn nháp đã ngừng kinh doanh')
      }

      for (const item of mergedItems) {
        const prod = products.find((p) => p.id === item.productId)
        const pkg = prod?.packagings.find((pk) => pk.id === item.packagingId)
        if (!pkg || pkg.isSample) {
          throw new Error(`Quy cách đóng gói của sản phẩm "${prod?.name ?? ''}" không hợp lệ`)
        }
      }

      const leadTimes = products.map((p) => p.leadTimeDays).filter((d) => d > 0)
      const maxLeadTimeDays = leadTimes.length > 0 ? Math.max(...leadTimes) : 1

      if (isDraftExpired(order.deliveryDate, now, maxLeadTimeDays)) {
        throw new Error(
          'Đơn nháp này đã quá hạn xác nhận (sát ngày giao hàng). Vui lòng tạo đơn mới hoặc đợi kỳ giao tiếp theo.'
        )
      }

      const minDeliveryDate = earliestDeliveryDate(now, leadTimes)
      if (!isDeliveryDateValid(order.deliveryDate, minDeliveryDate)) {
        const minDateStr = minDeliveryDate.toLocaleDateString('vi-VN', { timeZone: 'UTC' })
        throw new Error(
          `Đã qua giờ chốt đơn cho ngày giao này. Ngày giao sớm nhất hợp lệ hiện tại là ${minDateStr}.`
        )
      }

      const pricingProducts: ProductPricingData[] = products.map((p) => ({
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

      const groupDiscountPercent = order.user.group?.discountPercent ?? 0
      const quote = priceCart({
        lines: mergedItems,
        products: pricingProducts,
        groupDiscountPercent,
      })

      if (quote.errors.length > 0) {
        throw new Error(quote.errors.join('. '))
      }

      // Kiểm tra năng lực cung ứng theo tuần (loại trừ đơn CANCELLED, đơn DRAFT chưa xác nhận, và chính đơn hiện tại)
      const weekStart = getWeekStartMonday(order.deliveryDate)
      const weekEnd = new Date(
        Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + 7)
      )

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
          const existingItems = await tx.orderItem.findMany({
            where: {
              productId: summary.productId,
              isSample: false,
              order: {
                id: { not: order.id },
                status: { notIn: [OrderStatus.CANCELLED, OrderStatus.DRAFT] },
                deliveryDate: {
                  gte: weekStart,
                  lt: weekEnd,
                },
              },
            },
            select: { orderedGrams: true },
          })

          const existingGrams = existingItems.reduce((sum, item) => sum + item.orderedGrams, 0)
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

      const addressSnapshot = (order.addressSnapshot ?? {}) as Record<string, unknown>
      const shippingCalculator = getShippingCalculator()
      const totalGramsAll = quote.lines.reduce((sum, l) => sum + l.totalGrams, 0)
      const shippingQuote = await shippingCalculator.quote({
        totalGrams: totalGramsAll,
        requiresCold: products.some((p) => p.requiresCold),
        lat: typeof addressSnapshot.lat === 'number' ? addressSnapshot.lat : null,
        lng: typeof addressSnapshot.lng === 'number' ? addressSnapshot.lng : null,
        addressText: `${addressSnapshot.line ?? ''}, ${addressSnapshot.ward ?? ''}, ${addressSnapshot.district ?? ''}, ${addressSnapshot.province ?? ''}`,
        district: typeof addressSnapshot.district === 'string' ? addressSnapshot.district : undefined,
        province: typeof addressSnapshot.province === 'string' ? addressSnapshot.province : undefined,
      })

      if (!shippingQuote.allowed) {
        throw new Error(
          shippingQuote.error ||
            'Không thể xác nhận đơn nháp: địa chỉ không thể tính phí vận chuyển hoặc vượt bán kính'
        )
      }

      const shippingFee = shippingQuote.fee
      const subtotal = quote.subtotal
      const total = subtotal + shippingFee
      const depositAmount = computeDepositAmount(total)
      const paymentDueAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)

      const updateResult = await tx.order.updateMany({
        where: {
          id: order.id,
          status: OrderStatus.DRAFT,
        },
        data: {
          status: OrderStatus.PENDING_CONFIRMATION,
          paymentOption: validated.paymentOption,
          groupDiscountPercent,
          subtotal,
          shippingFee,
          shippingDistanceKm: shippingQuote.distanceKm,
          shippingVehicleType: shippingQuote.vehicleType,
          total,
          depositAmount,
          paymentDueAt,
          customerNote: validated.customerNote?.trim() || order.customerNote,
        },
      })

      if (updateResult.count === 0) {
        throw new Error('Đơn nháp đã được xác nhận hoặc thay đổi trạng thái trước đó')
      }

      await tx.orderItem.deleteMany({
        where: { orderId: order.id },
      })

      await tx.orderItem.createMany({
        data: quote.lines.map((line) => ({
          orderId: order.id,
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
      })

      await recordOrderEvent(tx, {
        orderId: order.id,
        type: 'STATUS_CHANGED',
        fromStatus: OrderStatus.DRAFT,
        toStatus: OrderStatus.PENDING_CONFIRMATION,
        actorId: sessionUser.id,
        note: `Khách hàng xác nhận đơn nháp định kỳ (${
          validated.paymentOption === PaymentOption.DEPOSIT_30
            ? 'Đặt cọc 30%'
            : 'Thanh toán 100%'
        })`,
        payload: {
          paymentOption: validated.paymentOption,
          subtotal,
          shippingFee,
          total,
          depositAmount,
        },
      })

      return {
        orderId: order.id,
        orderCode: order.code,
      }
    })

    revalidatePath('/tai-khoan/dinh-ky')
    revalidatePath('/tai-khoan/don-hang')
    revalidatePath(`/tai-khoan/don-hang/${result.orderCode}`)
    revalidatePath(`/thanh-toan/${result.orderCode}`)
    revalidatePath('/admin/don-hang')
    revalidatePath('/admin/dinh-ky')

    return {
      success: true,
      orderId: result.orderId,
      orderCode: result.orderCode,
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.issues[0]?.message || 'Dữ liệu xác nhận đơn nháp không hợp lệ',
      }
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Không thể xác nhận đơn nháp định kỳ',
    }
  }
}

/**
 * Admin Action: Chạy trình sinh đơn nháp định kỳ thủ công ("Chạy sinh đơn định kỳ")
 * Bắt buộc kiểm tra quyền `requireAdmin()`
 */
export async function runRecurringGeneratorJob(): Promise<RecurringGeneratorResult> {
  try {
    await requireAdmin()
    const result = await processRecurringSchedules()

    revalidatePath('/admin/dinh-ky')
    revalidatePath('/admin/don-hang')
    revalidatePath('/tai-khoan/dinh-ky')
    revalidatePath('/tai-khoan/don-hang')

    return result
  } catch (error) {
    return {
      success: false,
      createdCount: 0,
      skippedDuplicates: 0,
      processedSchedules: 0,
      createdOrderCodes: [],
      error:
        error instanceof Error
          ? error.message
          : 'Không có quyền hoặc lỗi khi chạy sinh đơn định kỳ',
    }
  }
}
