'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { SeasonStatus } from '@prisma/client'
import { validatePriceTiers } from '@/lib/domain/pricing'
import {
  productSchema,
  ProductInput,
} from '@/lib/validators/product'

/**
 * Lấy danh sách sản phẩm cho trang Quản trị Admin
 */
export async function getAdminProducts() {
  await requireAdmin()

  return await db.product.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      farm: {
        select: { id: true, name: true, province: true },
      },
      packagings: {
        orderBy: { weightGrams: 'asc' },
      },
      priceTiers: {
        orderBy: { minGrams: 'asc' },
      },
      _count: {
        select: {
          batches: true,
        },
      },
    },
  })
}

/**
 * Lấy danh sách sản phẩm hiển thị trên trang Storefront
 */
export async function getStorefrontProducts(filters?: {
  seasonStatus?: SeasonStatus
  farmId?: string
  search?: string
}) {
  const where: Record<string, unknown> = {
    isActive: true,
  }

  if (filters?.seasonStatus) {
    where.seasonStatus = filters.seasonStatus
  }

  if (filters?.farmId) {
    where.farmId = filters.farmId
  }

  if (filters?.search) {
    where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { description: { contains: filters.search, mode: 'insensitive' } },
      { farm: { name: { contains: filters.search, mode: 'insensitive' } } },
    ]
  }

  return await db.product.findMany({
    where,
    orderBy: [
      { seasonStatus: 'asc' }, // HARVESTING -> UPCOMING -> OFF_SEASON
      { createdAt: 'desc' },
    ],
    include: {
      farm: {
        include: {
          certificates: {
            where: { expiresAt: { gt: new Date() } },
          },
        },
      },
      packagings: {
        where: { isActive: true },
        orderBy: { weightGrams: 'asc' },
      },
      priceTiers: {
        orderBy: { minGrams: 'asc' },
      },
    },
  })
}

/**
 * Lấy chi tiết sản phẩm qua slug
 */
export async function getProductBySlug(slug: string) {
  return await db.product.findUnique({
    where: { slug },
    include: {
      farm: {
        include: {
          certificates: {
            orderBy: { expiresAt: 'asc' },
          },
        },
      },
      packagings: {
        where: { isActive: true },
        orderBy: { weightGrams: 'asc' },
      },
      priceTiers: {
        orderBy: { minGrams: 'asc' },
      },
    },
  })
}

/**
 * Tạo sản phẩm mới (ADMIN)
 */
export async function createProduct(input: ProductInput) {
  await requireAdmin()

  const validated = productSchema.safeParse(input)
  if (!validated.success) {
    return {
      success: false,
      error: validated.error.issues[0]?.message || 'Dữ liệu không hợp lệ',
    }
  }

  const data = validated.data

  // Kiểm tra tính hợp lệ của bậc giá sỉ
  const tiersValidation = validatePriceTiers(
    data.moqGrams,
    data.priceTiers.map((t) => ({ minGrams: t.minGrams, pricePerKg: t.pricePerKg }))
  )

  if (!tiersValidation.valid) {
    return {
      success: false,
      error: tiersValidation.errors.join('. '),
    }
  }

  // Kiểm tra trùng slug
  const existingSlug = await db.product.findUnique({
    where: { slug: data.slug },
  })
  if (existingSlug) {
    return { success: false, error: 'Slug định danh sản phẩm này đã tồn tại' }
  }

  const farm = await db.farm.findUnique({
    where: { id: data.farmId },
  })
  if (!farm) {
    return { success: false, error: 'Nhà vườn đã chọn không tồn tại' }
  }

  // Tạo sản phẩm và các quan hệ lồng nhau
  const product = await db.product.create({
    data: {
      name: data.name.trim(),
      slug: data.slug.trim().toLowerCase(),
      description: data.description.trim(),
      images: data.images,
      farmId: data.farmId,
      moqGrams: data.moqGrams,
      leadTimeDays: data.leadTimeDays,
      seasonStatus: data.seasonStatus,
      requiresCold: data.requiresCold,
      isActive: data.isActive,
      preorderOpen: data.preorderOpen,
      preorderPricePerKg: data.preorderPricePerKg ?? null,
      preorderBandPercent: data.preorderBandPercent ?? 10,
      expectedHarvestFrom: data.expectedHarvestFrom ?? null,
      expectedHarvestTo: data.expectedHarvestTo ?? null,
      packagings: {
        create: data.packagings.map((pkg) => ({
          name: pkg.name.trim(),
          weightGrams: pkg.weightGrams,
          isSample: pkg.isSample,
          samplePrice: pkg.samplePrice ?? null,
          isActive: pkg.isActive ?? true,
        })),
      },
      priceTiers: {
        create: data.priceTiers.map((pt) => ({
          minGrams: pt.minGrams,
          pricePerKg: pt.pricePerKg,
        })),
      },
    },
  })

  revalidatePath('/admin/san-pham')
  revalidatePath('/san-pham')
  revalidatePath('/san-pham/' + product.slug)
  return { success: true, product, message: 'Thêm sản phẩm thành công!' }
}

/**
 * Cập nhật thông tin sản phẩm (ADMIN)
 */
export async function updateProduct(id: string, input: ProductInput) {
  await requireAdmin()

  const validated = productSchema.safeParse(input)
  if (!validated.success) {
    return {
      success: false,
      error: validated.error.issues[0]?.message || 'Dữ liệu không hợp lệ',
    }
  }

  const data = validated.data

  const existing = await db.product.findUnique({ where: { id } })
  if (!existing) {
    return { success: false, error: 'Không tìm thấy sản phẩm' }
  }

  if (data.slug !== existing.slug) {
    const checkSlug = await db.product.findUnique({ where: { slug: data.slug } })
    if (checkSlug) {
      return { success: false, error: 'Slug định danh đã bị trùng' }
    }
  }

  // Kiểm tra bậc giá
  const tiersValidation = validatePriceTiers(
    data.moqGrams,
    data.priceTiers.map((t) => ({ minGrams: t.minGrams, pricePerKg: t.pricePerKg }))
  )

  if (!tiersValidation.valid) {
    return {
      success: false,
      error: tiersValidation.errors.join('. '),
    }
  }

  try {
    // Cập nhật trong transaction: đồng bộ quy cách an toàn (SRC-DATA-03 & PACK-REG-01)
    const updated = await db.$transaction(async (tx) => {
      // 1. Kiểm tra trùng lặp ID trong payload
      const payloadPackagingIds = data.packagings
        .map((p) => p.id)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)

      const uniquePayloadIds = new Set(payloadPackagingIds)
      if (uniquePayloadIds.size !== payloadPackagingIds.length) {
        throw new Error('Dữ liệu quy cách đóng gói có ID trùng lặp bất thường')
      }

      // 2. Lấy toàn bộ Packaging hiện tại của sản phẩm từ DB
      const existingPackagings = await tx.packaging.findMany({
        where: { productId: id },
      })
      const existingMap = new Map(existingPackagings.map((p) => [p.id, p]))

      // 3. Xác minh tất cả ID gửi lên phải thuộc sản phẩm đang chỉnh sửa
      for (const pkgId of payloadPackagingIds) {
        if (!existingMap.has(pkgId)) {
          throw new Error('Quy cách đóng gói không tồn tại hoặc không thuộc sản phẩm đang chỉnh sửa')
        }
      }

      // 4. Đồng bộ từng packaging trong payload (update in-place hoặc create)
      for (const pkg of data.packagings) {
        const cleanId = pkg.id?.trim()
        if (cleanId && existingMap.has(cleanId)) {
          const existingPkg = existingMap.get(cleanId)!

          // PACK-REG-01: Quy tắc an toàn xác định isActive cho Packaging hiện hữu:
          // 1. Nếu packaging trong DB đang inactive:
          //    - Giữ nguyên inactive khi Admin chỉ chỉnh sửa thông tin sản phẩm.
          //    - CHỈ chuyển sang active khi có hành động kích hoạt lại rõ ràng (pkg.isActive === true).
          //    - Tuyệt đối không suy luận kích hoạt chỉ từ việc Packaging xuất hiện trong payload.
          // 2. Nếu packaging trong DB đang active:
          //    - Giữ active trừ khi có yêu cầu deactive rõ ràng (pkg.isActive === false).
          let targetIsActive: boolean
          if (existingPkg.isActive) {
            targetIsActive = pkg.isActive !== false
          } else {
            targetIsActive = pkg.isActive === true
          }

          // Cập nhật bản ghi hiện có
          await tx.packaging.update({
            where: { id: cleanId },
            data: {
              name: pkg.name.trim(),
              weightGrams: pkg.weightGrams,
              isSample: pkg.isSample,
              samplePrice: pkg.samplePrice ?? null,
              isActive: targetIsActive,
            },
          })
        } else {
          // Tạo mới packaging: mặc định active = true trừ khi có chỉ định khác
          await tx.packaging.create({
            data: {
              productId: id,
              name: pkg.name.trim(),
              weightGrams: pkg.weightGrams,
              isSample: pkg.isSample,
              samplePrice: pkg.samplePrice ?? null,
              isActive: pkg.isActive ?? true,
            },
          })
        }
      }

      // 5. Các packaging cũ của sản phẩm nhưng không có trong payload:
      // Tuyệt đối không xóa vật lý (tránh lỗi khóa ngoại với OrderItem và bảo toàn lịch sử),
      // chuyển sang isActive: false (soft-deactivate)
      const submittedIdsSet = new Set(payloadPackagingIds)
      const packagingsToDeactivate = existingPackagings.filter(
        (p) => !submittedIdsSet.has(p.id) && p.isActive
      )

      for (const pkgToDeactivate of packagingsToDeactivate) {
        await tx.packaging.update({
          where: { id: pkgToDeactivate.id },
          data: { isActive: false },
        })
      }

      // 6. Cập nhật bậc giá sỉ (PriceTier không có khóa ngoại tham chiếu từ OrderItem)
      await tx.priceTier.deleteMany({ where: { productId: id } })

      // 7. Cập nhật thông tin sản phẩm
      return await tx.product.update({
        where: { id },
        data: {
          name: data.name.trim(),
          slug: data.slug.trim().toLowerCase(),
          description: data.description.trim(),
          images: data.images,
          farmId: data.farmId,
          moqGrams: data.moqGrams,
          leadTimeDays: data.leadTimeDays,
          seasonStatus: data.seasonStatus,
          requiresCold: data.requiresCold,
          isActive: data.isActive,
          preorderOpen: data.preorderOpen,
          preorderPricePerKg: data.preorderPricePerKg ?? null,
          preorderBandPercent: data.preorderBandPercent ?? 10,
          expectedHarvestFrom: data.expectedHarvestFrom ?? null,
          expectedHarvestTo: data.expectedHarvestTo ?? null,
          priceTiers: {
            create: data.priceTiers.map((pt) => ({
              minGrams: pt.minGrams,
              pricePerKg: pt.pricePerKg,
            })),
          },
        },
      })
    })

    revalidatePath('/admin/san-pham')
    revalidatePath('/san-pham')
    revalidatePath('/san-pham/' + updated.slug)
    return { success: true, product: updated, message: 'Cập nhật sản phẩm thành công!' }
  } catch (error) {
    console.error('Error updating product:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Lỗi khi cập nhật sản phẩm',
    }
  }
}

/**
 * Xóa sản phẩm (ADMIN)
 */
export async function deleteProduct(id: string) {
  await requireAdmin()

  const product = await db.product.findUnique({
    where: { id },
    include: {
      _count: {
        select: { batches: true },
      },
    },
  })

  if (!product) {
    return { success: false, error: 'Không tìm thấy sản phẩm' }
  }

  if (product._count.batches > 0) {
    return {
      success: false,
      error: `Không thể xóa vì sản phẩm đã phát sinh ${product._count.batches} lô hàng liên kết. Bạn có thể chọn Tắt kích hoạt sản phẩm.`,
    }
  }

  await db.product.delete({ where: { id } })

  revalidatePath('/admin/san-pham')
  revalidatePath('/san-pham')
  return { success: true, message: 'Đã xóa sản phẩm thành công!' }
}
