'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { isValidCoordinate } from '@/lib/domain/shipping'
import { VehicleType } from '@prisma/client'

// Biểu thức chính quy kiểm tra số điện thoại di động Việt Nam (10 chữ số)
const VN_PHONE_REGEX = /^(0|\+84)(3|5|7|8|9)[0-9]{8}$/

export const createShippingRateSchema = z.object({
  vehicleType: z.enum(['NORMAL', 'COLD']),
  minGrams: z.number().int().min(0, 'Khối lượng tối thiểu không được âm'),
  baseFee: z.number().int().min(0, 'Phí mở cửa không được âm'),
  perKm: z.number().int().min(0, 'Phí mỗi km không được âm'),
  isActive: z.boolean().optional().default(true),
})

export type CreateShippingRateInput = z.input<typeof createShippingRateSchema>

export const updateShippingRateSchema = z.object({
  id: z.string().min(1, 'ID không được để trống'),
  baseFee: z.number().int().min(0, 'Phí mở cửa không được âm'),
  perKm: z.number().int().min(0, 'Phí mỗi km không được âm'),
  isActive: z.boolean(),
})

export type UpdateShippingRateInput = z.infer<typeof updateShippingRateSchema>

export const warehouseSettingsSchema = z.object({
  name: z.string().min(2, 'Tên kho phải từ 2 ký tự trở lên').max(200),
  address: z.string().min(5, 'Địa chỉ kho phải từ 5 ký tự trở lên').max(500),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  maxRadiusKm: z.number().positive('Bán kính phục vụ tối đa phải lớn hơn 0'),
})

export type WarehouseSettingsInput = z.infer<typeof warehouseSettingsSchema>

export const updateShipmentDriverSchema = z.object({
  shipmentId: z.string().min(1, 'ID chuyến giao không được để trống'),
  driverName: z.string().min(2, 'Tên tài xế phải từ 2 ký tự').max(100),
  driverPhone: z.string().regex(VN_PHONE_REGEX, 'Số điện thoại tài xế không hợp lệ (10 chữ số VN)'),
  licensePlate: z.string().min(3, 'Biển số xe không hợp lệ').max(20),
  note: z.string().max(500).optional(),
})

export type UpdateShipmentDriverInput = z.infer<typeof updateShipmentDriverSchema>

/**
 * Khởi tạo 4 bậc cước vận chuyển chuẩn (Action Admin chủ động bấm).
 * Không tự động chạy khi mở trang hoặc thực hiện GET/read query.
 * Idempotent: Bỏ qua các bậc cước đã tồn tại (skipDuplicates: true), không ghi đè cấu hình Admin đã sửa.
 * An toàn với PostgreSQL: Không ném lỗi P2002 làm abort transaction block.
 */
export async function initializeDefaultShippingRates() {
  try {
    await requireAdmin()

    const defaultTiers = [
      { vehicleType: VehicleType.NORMAL, minGrams: 0, baseFee: 150000, perKm: 8000, isActive: true },
      { vehicleType: VehicleType.NORMAL, minGrams: 500000, baseFee: 300000, perKm: 12000, isActive: true },
      { vehicleType: VehicleType.COLD, minGrams: 0, baseFee: 250000, perKm: 12000, isActive: true },
      { vehicleType: VehicleType.COLD, minGrams: 500000, baseFee: 450000, perKm: 18000, isActive: true },
    ]

    const createdCount = await db.$transaction(async (tx) => {
      // 1. Chèn an toàn, nguyên tử các bậc cước mặc định còn thiếu (ON CONFLICT DO NOTHING)
      const res = await tx.shippingRate.createMany({
        data: defaultTiers,
        skipDuplicates: true,
      })

      // 2. POST-INITIALIZATION INVARIANT CHECK:
      // Kiểm tra cấu hình sau khi khởi tạo/bổ sung:
      // Phải có ít nhất 1 bậc cơ sở 0kg đang hoạt động cho cả NORMAL và COLD
      const activeRates = await tx.shippingRate.findMany({
        where: { isActive: true },
      })
      const hasNormalBase = activeRates.some((r) => r.vehicleType === 'NORMAL' && r.minGrams === 0)
      const hasColdBase = activeRates.some((r) => r.vehicleType === 'COLD' && r.minGrams === 0)

      if (!hasNormalBase || !hasColdBase) {
        // Kiểm tra xem có bản ghi 0kg nào tồn tại nhưng đang bị vô hiệu hóa (isActive = false)
        const allBaseRecords = await tx.shippingRate.findMany({
          where: { minGrams: 0 },
        })
        const inactiveBases = allBaseRecords.filter((r) => !r.isActive).map((r) => r.vehicleType)
        if (inactiveBases.length > 0) {
          throw new Error(
            `Không thể hoàn tất khởi tạo: Bậc cước cơ sở (0kg) cho loại xe ${inactiveBases.join(', ')} đang tồn tại nhưng bị vô hiệu hóa. Vui lòng kích hoạt lại bậc cước này thay vì khởi tạo mới.`
          )
        }
        throw new Error(
          `Khởi tạo bảng cước không thành công: Thiếu bậc cước cơ sở (0kg) đang hoạt động cho loại xe ${!hasNormalBase ? 'NORMAL' : 'COLD'}.`
        )
      }

      return res.count
    })

    revalidatePath('/admin/van-chuyen')
    revalidatePath('/thanh-toan')

    return {
      success: true,
      message:
        createdCount > 0
          ? `Đã khởi tạo thành công ${createdCount} bậc cước vận chuyển chuẩn`
          : 'Tất cả các bậc cước mặc định đã tồn tại trong hệ thống, không có thay đổi mới',
      createdCount,
    }
  } catch (error: unknown) {
    console.error('Lỗi khi khởi tạo cước mặc định:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Lỗi khi khởi tạo cước mặc định',
    }
  }
}

/**
 * Thêm mới bậc cước vận chuyển
 */
export async function createShippingRate(input: CreateShippingRateInput) {
  try {
    await requireAdmin()
    const validated = createShippingRateSchema.parse(input)

    const rate = await db.$transaction(async (tx) => {
      // GUARD 1: Chống bẫy tạo bậc cước đầu tiên (FIX01-MAJ-01 - FIRST RATE CREATION TRAP)
      // Nếu DB đang rỗng (đang dùng DEFAULT_SHIPPING_RATES), từ chối tạo bậc cước lẻ
      const totalCount = await tx.shippingRate.count()
      if (totalCount === 0) {
        throw new Error(
          'Hệ thống đang sử dụng bảng cước mặc định. Vui lòng khởi tạo đầy đủ bảng cước trước khi thêm bậc tùy chỉnh.'
        )
      }

      // GUARD 2: Chống trùng lặp (vehicleType, minGrams)
      const existing = await tx.shippingRate.findUnique({
        where: {
          vehicleType_minGrams: {
            vehicleType: validated.vehicleType as VehicleType,
            minGrams: validated.minGrams,
          },
        },
      })

      if (existing) {
        throw new Error(
          `Bậc cước cho loại xe ${validated.vehicleType} tại mức ${validated.minGrams / 1000}kg đã tồn tại`
        )
      }

      // GUARD 3: Kiểm tra cấu hình hiện tại có đang thiếu bậc cơ sở không
      // Nếu DB đã có bản ghi nhưng đang thiếu bậc cơ sở 0kg, không cho tạo bậc phụ
      const currentActive = (await tx.shippingRate.findMany({
        where: { isActive: true },
      })) ?? []
      const currentHasNormalBase = currentActive.some((r) => r.vehicleType === 'NORMAL' && r.minGrams === 0)
      const currentHasColdBase = currentActive.some((r) => r.vehicleType === 'COLD' && r.minGrams === 0)
      if (!currentHasNormalBase || !currentHasColdBase) {
        throw new Error(
          'Bảng cước hiện tại chưa đầy đủ cấu hình mức cơ sở (0kg). Vui lòng khôi phục/khởi tạo bảng cước trước khi thêm bậc mới.'
        )
      }

      const created = await tx.shippingRate.create({
        data: {
          vehicleType: validated.vehicleType as VehicleType,
          minGrams: validated.minGrams,
          baseFee: validated.baseFee,
          perKm: validated.perKm,
          isActive: validated.isActive,
        },
      })

      // POST-CREATION INVARIANT CHECK:
      const remainingActive = await tx.shippingRate.findMany({
        where: { isActive: true },
      })
      const hasNormalBase = remainingActive.some((r) => r.vehicleType === 'NORMAL' && r.minGrams === 0)
      const hasColdBase = remainingActive.some((r) => r.vehicleType === 'COLD' && r.minGrams === 0)

      if (!hasNormalBase || !hasColdBase) {
        throw new Error(
          'Thao tác tạo bị từ chối: Bảng cước sau khi tạo sẽ thiếu bậc cước cơ sở (0kg) đang hoạt động.'
        )
      }

      return created
    })

    revalidatePath('/admin/van-chuyen')
    revalidatePath('/thanh-toan')

    return {
      success: true,
      message: 'Đã tạo bậc cước vận chuyển mới thành công',
      rate,
    }
  } catch (error: unknown) {
    console.error('Lỗi khi tạo bậc cước:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Lỗi khi tạo bậc cước',
    }
  }
}

/**
 * Cập nhật bậc cước vận chuyển
 */
export async function updateShippingRate(input: UpdateShippingRateInput) {
  try {
    await requireAdmin()
    const validated = updateShippingRateSchema.parse(input)

    const updated = await db.$transaction(async (tx) => {
      const targetRate = await tx.shippingRate.findUnique({
        where: { id: validated.id },
      })

      if (!targetRate) {
        throw new Error('Không tìm thấy bậc cước cần cập nhật')
      }

      // Guard Vô hiệu hóa (isActive = false):
      if (!validated.isActive && targetRate.isActive) {
        // Nếu đây là bậc 0kg cơ sở:
        if (targetRate.minGrams === 0) {
          const otherActiveBase = await tx.shippingRate.count({
            where: {
              vehicleType: targetRate.vehicleType,
              minGrams: 0,
              isActive: true,
              id: { not: targetRate.id },
            },
          })

          if (otherActiveBase === 0) {
            throw new Error(
              `Không thể vô hiệu hóa bậc cước cơ sở (0kg) của loại xe ${targetRate.vehicleType}. Hệ thống bắt buộc phải duy trì ít nhất một bậc cước cơ sở đang hoạt động cho loại xe này.`
            )
          }
        }
      }

      const res = await tx.shippingRate.update({
        where: { id: validated.id },
        data: {
          baseFee: validated.baseFee,
          perKm: validated.perKm,
          isActive: validated.isActive,
        },
      })

      // POST-CONDITION INVARIANT CHECK:
      // Đảm bảo sau cập nhật, bảng cước đang hoạt động trong DB phải luôn có ít nhất
      // 1 bậc cơ sở (0kg) cho NORMAL và 1 bậc cơ sở (0kg) cho COLD.
      const allActive = await tx.shippingRate.findMany({
        where: { isActive: true },
      })
      const totalDbCount = await tx.shippingRate.count()
      if (totalDbCount > 0) {
        const hasNormalBase = allActive.some((r) => r.vehicleType === 'NORMAL' && r.minGrams === 0)
        const hasColdBase = allActive.some((r) => r.vehicleType === 'COLD' && r.minGrams === 0)

        if (!hasNormalBase || !hasColdBase) {
          throw new Error(
            `Thao tác cập nhật bị từ chối: Bảng cước sau cập nhật sẽ thiếu bậc cước cơ sở (0kg) đang hoạt động cho loại xe ${!hasNormalBase ? 'NORMAL' : 'COLD'}.`
          )
        }
      }

      return res
    })

    revalidatePath('/admin/van-chuyen')
    revalidatePath('/thanh-toan')

    return {
      success: true,
      message: 'Đã cập nhật bậc cước thành công',
      rate: updated,
    }
  } catch (error: unknown) {
    console.error('Lỗi khi cập nhật bậc cước:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Lỗi khi cập nhật bậc cước',
    }
  }
}

/**
 * Xóa bậc cước vận chuyển
 */
export async function deleteShippingRate(id: string) {
  try {
    await requireAdmin()

    await db.$transaction(async (tx) => {
      const target = await tx.shippingRate.findUnique({ where: { id } })
      if (!target) {
        throw new Error('Không tìm thấy bậc cước cần xóa')
      }

      // Guard 1: Không cho phép xóa bậc cước cuối cùng (chặn đưa cấu hình DB về rỗng để tự fallback ngoài ý muốn)
      const totalCount = await tx.shippingRate.count()
      if (totalCount <= 1) {
        throw new Error(
          'Không thể xóa bậc cước cuối cùng trong hệ thống. Cấu hình bảng cước của Admin phải duy trì tối thiểu các bậc cước cơ sở.'
        )
      }

      // Guard 2: Kiểm tra nếu là bậc 0kg cơ sở
      if (target.minGrams === 0) {
        // Kiểm tra xem có bậc 0kg nào khác cho loại xe này không
        const otherBaseCount = await tx.shippingRate.count({
          where: {
            vehicleType: target.vehicleType,
            minGrams: 0,
            id: { not: target.id },
          },
        })

        if (otherBaseCount === 0) {
          // Kiểm tra xem có bậc tải trọng phụ (> 0kg) của loại xe này đang tồn tại không
          const dependentCount = await tx.shippingRate.count({
            where: {
              vehicleType: target.vehicleType,
              minGrams: { gt: 0 },
              id: { not: target.id },
            },
          })

          if (dependentCount > 0) {
            throw new Error(
              `Không thể xóa bậc cước cơ sở (0kg) của loại xe ${target.vehicleType} khi vẫn còn các bậc cước tải trọng khác (${dependentCount} bậc) đang tồn tại.`
            )
          }

          // Kể cả không còn bậc phụ, vẫn không được xóa bậc 0kg duy nhất của loại xe
          throw new Error(
            `Không thể xóa bậc cước cơ sở (0kg) duy nhất của loại xe ${target.vehicleType}. Hệ thống bắt buộc phải duy trì bậc cước cơ sở 0kg cho loại xe này khi đã cấu hình trong cơ sở dữ liệu.`
          )
        }
      }

      // Thực hiện xóa bản ghi
      await tx.shippingRate.delete({ where: { id } })

      // POST-CONDITION INVARIANT CHECK:
      // Kiểm tra tính toàn vẹn của cấu hình còn lại sau khi xóa
      const remainingTotal = await tx.shippingRate.count()
      if (remainingTotal === 0) {
        throw new Error(
          'Thao tác xóa bị từ chối: Không được phép xóa toàn bộ bảng cước để tự động quay về cấu hình mặc định.'
        )
      }

      const remainingActive = await tx.shippingRate.findMany({
        where: { isActive: true },
      })
      const hasNormalBase = remainingActive.some((r) => r.vehicleType === 'NORMAL' && r.minGrams === 0)
      const hasColdBase = remainingActive.some((r) => r.vehicleType === 'COLD' && r.minGrams === 0)

      if (!hasNormalBase || !hasColdBase) {
        throw new Error(
          `Thao tác xóa bị từ chối: Bảng cước sau khi xóa sẽ thiếu bậc cước cơ sở (0kg) đang hoạt động cho loại xe ${!hasNormalBase ? 'NORMAL' : 'COLD'}.`
        )
      }
    })

    revalidatePath('/admin/van-chuyen')
    revalidatePath('/thanh-toan')

    return {
      success: true,
      message: 'Đã xóa bậc cước vận chuyển thành công',
    }
  } catch (error: unknown) {
    console.error('Lỗi khi xóa bậc cước:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Lỗi khi xóa bậc cước',
    }
  }
}

/**
 * Cập nhật cấu hình Tổng kho & Bán kính phục vụ (AppSetting)
 */
export async function updateWarehouseSettings(input: WarehouseSettingsInput) {
  try {
    await requireAdmin()
    const validated = warehouseSettingsSchema.parse(input)

    if (!isValidCoordinate(validated.lat, validated.lng)) {
      return {
        success: false,
        error: 'Tọa độ GPS kho không hợp lệ (Vĩ độ -90..90, Kinh độ -180..180, không chấp nhận 0,0)',
      }
    }

    await db.$transaction(async (tx) => {
      const settingsToUpsert = [
        { key: 'warehouseName', value: validated.name.trim(), description: 'Tên kho xuất phát trung tâm' },
        { key: 'warehouseAddress', value: validated.address.trim(), description: 'Địa chỉ kho xuất phát trung tâm' },
        { key: 'warehouseLat', value: validated.lat.toString(), description: 'Vĩ độ GPS kho trung tâm' },
        { key: 'warehouseLng', value: validated.lng.toString(), description: 'Kinh độ GPS kho trung tâm' },
        { key: 'maxRadiusKm', value: validated.maxRadiusKm.toString(), description: 'Bán kính giao hàng tối đa (km)' },
      ]

      for (const item of settingsToUpsert) {
        await tx.appSetting.upsert({
          where: { key: item.key },
          update: { value: item.value, description: item.description },
          create: { key: item.key, value: item.value, description: item.description },
        })
      }
    })

    revalidatePath('/admin/van-chuyen')
    revalidatePath('/thanh-toan')

    return {
      success: true,
      message: 'Đã lưu cấu hình kho xuất phát và bán kính phục vụ thành công',
    }
  } catch (error: unknown) {
    console.error('Lỗi khi lưu cấu hình kho:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Lỗi khi lưu cấu hình kho',
    }
  }
}

/**
 * Cập nhật thông tin tài xế/biển số cho chuyến giao đang điều phối
 */
export async function updateShipmentDriver(input: UpdateShipmentDriverInput) {
  try {
    await requireAdmin()
    const validated = updateShipmentDriverSchema.parse(input)

    const shipment = await db.shipment.findUnique({
      where: { id: validated.shipmentId },
      include: { order: true },
    })

    if (!shipment) {
      return { success: false, error: 'Không tìm thấy thông tin chuyến giao hàng' }
    }

    if (shipment.status === 'DELIVERED' || shipment.status === 'CANCELLED') {
      return {
        success: false,
        error: `Không thể chỉnh sửa chuyến giao đã ${shipment.status === 'DELIVERED' ? 'hoàn tất giao' : 'hủy'}`,
      }
    }

    const updated = await db.shipment.update({
      where: { id: validated.shipmentId },
      data: {
        driverName: validated.driverName.trim(),
        driverPhone: validated.driverPhone.trim(),
        licensePlate: validated.licensePlate.trim().toUpperCase(),
        note: validated.note ? validated.note.trim() : null,
      },
    })

    revalidatePath('/admin/van-chuyen')
    revalidatePath(`/admin/don-hang/${shipment.order.code}`)
    revalidatePath(`/tai-khoan/don-hang/${shipment.order.code}`)

    return {
      success: true,
      message: 'Đã cập nhật thông tin tài xế và phương tiện thành công',
      shipment: updated,
    }
  } catch (error: unknown) {
    console.error('Lỗi khi cập nhật tài xế chuyến giao:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Lỗi khi cập nhật tài xế chuyến giao',
    }
  }
}
