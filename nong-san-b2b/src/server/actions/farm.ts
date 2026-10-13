'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import {
  farmSchema,
  certificateSchema,
  FarmInput,
  CertificateInput,
} from '@/lib/validators/farm'

/**
 * Lấy danh sách nhà vườn cho trang Quản trị Admin
 */
export async function getAdminFarms() {
  await requireAdmin()

  return await db.farm.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      certificates: {
        orderBy: { expiresAt: 'asc' },
      },
      _count: {
        select: {
          products: true,
          batches: true,
        },
      },
    },
  })
}

/**
 * Lấy thông tin nhà vườn công khai qua slug
 */
export async function getFarmBySlug(slug: string) {
  return await db.farm.findUnique({
    where: { slug },
    include: {
      certificates: {
        orderBy: { expiresAt: 'asc' },
      },
      products: {
        where: { isActive: true },
        include: {
          priceTiers: {
            orderBy: { minGrams: 'asc' },
          },
          packagings: true,
        },
      },
    },
  })
}

/**
 * Thêm mới nhà vườn liên kết (ADMIN)
 */
export async function createFarm(input: FarmInput) {
  await requireAdmin()

  const validated = farmSchema.safeParse(input)
  if (!validated.success) {
    return {
      success: false,
      error: validated.error.issues[0]?.message || 'Dữ liệu không hợp lệ',
    }
  }

  const data = validated.data

  const existingSlug = await db.farm.findUnique({
    where: { slug: data.slug },
  })
  if (existingSlug) {
    return { success: false, error: 'Slug định danh nhà vườn này đã tồn tại' }
  }

  const farm = await db.farm.create({
    data: {
      name: data.name.trim(),
      slug: data.slug.trim().toLowerCase(),
      ownerName: data.ownerName?.trim() || null,
      province: data.province.trim(),
      addressText: data.addressText.trim(),
      description: data.description.trim(),
      lat: data.lat,
      lng: data.lng,
      images: data.images,
    },
  })

  revalidatePath('/admin/nha-vuon')
  revalidatePath('/nha-vuon/' + farm.slug)
  return { success: true, farm, message: 'Thêm nhà vườn thành công!' }
}

/**
 * Cập nhật thông tin nhà vườn (ADMIN)
 */
export async function updateFarm(id: string, input: FarmInput) {
  await requireAdmin()

  const validated = farmSchema.safeParse(input)
  if (!validated.success) {
    return {
      success: false,
      error: validated.error.issues[0]?.message || 'Dữ liệu không hợp lệ',
    }
  }

  const data = validated.data

  const existing = await db.farm.findUnique({ where: { id } })
  if (!existing) {
    return { success: false, error: 'Không tìm thấy nhà vườn' }
  }

  if (data.slug !== existing.slug) {
    const checkSlug = await db.farm.findUnique({ where: { slug: data.slug } })
    if (checkSlug) {
      return { success: false, error: 'Slug định danh đã bị trùng' }
    }
  }

  const updated = await db.farm.update({
    where: { id },
    data: {
      name: data.name.trim(),
      slug: data.slug.trim().toLowerCase(),
      ownerName: data.ownerName?.trim() || null,
      province: data.province.trim(),
      addressText: data.addressText.trim(),
      description: data.description.trim(),
      lat: data.lat,
      lng: data.lng,
      images: data.images,
    },
  })

  revalidatePath('/admin/nha-vuon')
  revalidatePath('/nha-vuon/' + updated.slug)
  return { success: true, farm: updated, message: 'Cập nhật nhà vườn thành công!' }
}

/**
 * Xóa nhà vườn (ADMIN)
 */
export async function deleteFarm(id: string) {
  await requireAdmin()

  const farm = await db.farm.findUnique({
    where: { id },
    include: {
      _count: {
        select: { products: true, batches: true },
      },
    },
  })

  if (!farm) {
    return { success: false, error: 'Không tìm thấy nhà vườn' }
  }

  if (farm._count.products > 0 || farm._count.batches > 0) {
    return {
      success: false,
      error: `Không thể xóa vì vườn đang có ${farm._count.products} sản phẩm và ${farm._count.batches} lô hàng liên kết.`,
    }
  }

  await db.farm.delete({ where: { id } })

  revalidatePath('/admin/nha-vuon')
  return { success: true, message: 'Đã xóa nhà vườn thành công!' }
}

/**
 * Thêm mới chứng nhận tiêu chuẩn chất lượng (ADMIN)
 */
export async function createCertificate(input: CertificateInput) {
  await requireAdmin()

  const validated = certificateSchema.safeParse(input)
  if (!validated.success) {
    return {
      success: false,
      error: validated.error.issues[0]?.message || 'Dữ liệu không hợp lệ',
    }
  }

  const data = validated.data

  const cert = await db.certificate.create({
    data: {
      farmId: data.farmId,
      type: data.type,
      code: data.code.trim(),
      issuedAt: data.issuedAt,
      expiresAt: data.expiresAt,
      imageUrl: data.imageUrl || null,
    },
  })

  revalidatePath('/admin/nha-vuon')
  return { success: true, certificate: cert, message: 'Thêm chứng nhận thành công!' }
}

/**
 * Xóa chứng nhận chất lượng (ADMIN)
 */
export async function deleteCertificate(id: string) {
  await requireAdmin()

  try {
    await db.certificate.delete({ where: { id } })
    revalidatePath('/admin/nha-vuon')
    return { success: true, message: 'Đã xóa chứng nhận thành công!' }
  } catch {
    return { success: false, error: 'Không thể xóa chứng nhận này' }
  }
}
