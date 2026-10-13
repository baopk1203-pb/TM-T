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
        orderBy: { weightGrams: 'asc' },
      },
      priceTiers: {
        orderBy: { minGrams: 'asc' },
      },
    },
  })
}

/**
 * Thêm mới sản phẩm sỉ (ADMIN)
 * Bắt buộc kiểm tra logic bậc giá sỉ bằng validatePriceTiers()
 */
export async function createProduct(input: ProductInput) {
  await requireAdmin()

  const validated = productSchema.safeParse(input)
  if (!validated.success) {
    return {
      success: false,
      error: validated.error.issues[0]?.message || 'Dữ liệu sản phẩm không hợp lệ',
    }
  }

  const data = validated.data

  // Kiểm tra tính hợp lệ của bậc giá sỉ theo quy tắc 3.2
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

  // Cập nhật trong transaction: xóa quy cách & bậc giá cũ rồi thêm mới
  const updated = await db.$transaction(async (tx) => {
    await tx.packaging.deleteMany({ where: { productId: id } })
    await tx.priceTier.deleteMany({ where: { productId: id } })

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
        packagings: {
          create: data.packagings.map((pkg) => ({
            name: pkg.name.trim(),
            weightGrams: pkg.weightGrams,
            isSample: pkg.isSample,
            samplePrice: pkg.samplePrice ?? null,
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
  })

  revalidatePath('/admin/san-pham')
  revalidatePath('/san-pham')
  revalidatePath('/san-pham/' + updated.slug)
  return { success: true, product: updated, message: 'Cập nhật sản phẩm thành công!' }
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
