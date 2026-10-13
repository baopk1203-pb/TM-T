'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { batchSchema, BatchInput } from '@/lib/validators/batch'

/**
 * Gợi ý mã lô hàng tự động theo ngày hiện tại: LO-YYMMDD-XXX
 */
export async function generateNextBatchCode() {
  await requireAdmin()

  const now = new Date()
  const yy = String(now.getFullYear()).slice(-2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const prefix = `LO-${yy}${mm}${dd}`

  const countToday = await db.batch.count({
    where: {
      code: {
        startsWith: prefix,
      },
    },
  })

  const suffix = String(countToday + 1).padStart(3, '0')
  return `${prefix}-${suffix}`
}

/**
 * Lấy danh sách lô hàng thu hoạch (ADMIN)
 */
export async function getAdminBatches() {
  await requireAdmin()

  return await db.batch.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      product: {
        select: { id: true, name: true, slug: true, images: true },
      },
      farm: {
        select: { id: true, name: true, province: true },
      },
      _count: {
        select: { orderItems: true },
      },
    },
  })
}

/**
 * Lấy chi tiết thông tin lô hàng theo mã định danh QR (Công khai cho khách quét QR)
 */
export async function getBatchByCode(code: string) {
  return await db.batch.findUnique({
    where: { code },
    include: {
      product: {
        include: {
          packagings: true,
          priceTiers: {
            orderBy: { minGrams: 'asc' },
          },
        },
      },
      farm: {
        include: {
          certificates: {
            orderBy: { expiresAt: 'asc' },
          },
        },
      },
    },
  })
}

/**
 * Thêm mới lô hàng thu hoạch (ADMIN)
 */
export async function createBatch(input: BatchInput) {
  await requireAdmin()

  const validated = batchSchema.safeParse(input)
  if (!validated.success) {
    return {
      success: false,
      error: validated.error.issues[0]?.message || 'Dữ liệu lô hàng không hợp lệ',
    }
  }

  const data = validated.data

  const existing = await db.batch.findUnique({
    where: { code: data.code.trim() },
  })
  if (existing) {
    return { success: false, error: 'Mã lô hàng này đã tồn tại trong hệ thống' }
  }

  const batch = await db.batch.create({
    data: {
      code: data.code.trim().toUpperCase(),
      productId: data.productId,
      farmId: data.farmId,
      harvestDate: data.harvestDate,
      quantityGrams: data.quantityGrams,
      note: data.note?.trim() || null,
    },
  })

  revalidatePath('/admin/lo-hang')
  revalidatePath(`/truy-xuat/${batch.code}`)
  return { success: true, batch, message: 'Thêm lô hàng mới thành công!' }
}

/**
 * Xóa lô hàng (ADMIN)
 */
export async function deleteBatch(id: string) {
  await requireAdmin()

  const batch = await db.batch.findUnique({
    where: { id },
    include: {
      _count: {
        select: { orderItems: true },
      },
    },
  })

  if (!batch) {
    return { success: false, error: 'Không tìm thấy lô hàng' }
  }

  if (batch._count.orderItems > 0) {
    return {
      success: false,
      error: `Không thể xóa lô hàng này vì đã được gắn vào ${batch._count.orderItems} đơn hàng thực tế.`,
    }
  }

  await db.batch.delete({ where: { id } })

  revalidatePath('/admin/lo-hang')
  return { success: true, message: 'Đã xóa lô hàng thành công!' }
}
