'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'

function getMonday(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  const diff = date.getDate() - day + (day === 0 ? -6 : 1) // Thứ Hai
  date.setDate(diff)
  date.setHours(0, 0, 0, 0)
  return date
}

/**
 * Lấy ma trận sản phẩm và năng lực sản lượng trong 4 tuần tới (ADMIN)
 */
export async function getAdminWeeklyCapacities() {
  await requireAdmin()

  const currentMonday = getMonday(new Date())
  const weeks = []

  for (let i = 0; i < 4; i++) {
    const monday = new Date(currentMonday)
    monday.setDate(monday.getDate() + i * 7)

    const sunday = new Date(monday)
    sunday.setDate(sunday.getDate() + 6)

    weeks.push({
      weekIndex: i,
      weekStart: monday,
      label: `Tuần ${i + 1} (${monday.getDate()}/${monday.getMonth() + 1} - ${sunday.getDate()}/${sunday.getMonth() + 1})`,
    })
  }

  const products = await db.product.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      moqGrams: true,
      seasonStatus: true,
      farm: { select: { name: true } },
    },
  })

  const capacities = await db.weeklyCapacity.findMany({
    where: {
      weekStart: {
        gte: currentMonday,
        lte: weeks[3].weekStart,
      },
    },
  })

  return {
    weeks,
    products,
    capacities,
  }
}

/**
 * Cập nhật năng lực sản lượng cho 1 sản phẩm vào 1 tuần cụ thể (ADMIN)
 * maxGrams truyền vào là số gram (được quy đổi từ kg trên giao diện)
 */
export async function setWeeklyCapacity(
  productId: string,
  weekStartDate: Date | string,
  maxGrams: number
) {
  await requireAdmin()

  const date = new Date(weekStartDate)
  date.setHours(0, 0, 0, 0)

  if (maxGrams <= 0) {
    // Nếu đặt <= 0 thì xóa giới hạn (nghĩa là không giới hạn)
    await db.weeklyCapacity.deleteMany({
      where: {
        productId,
        weekStart: date,
      },
    })
  } else {
    await db.weeklyCapacity.upsert({
      where: {
        productId_weekStart: {
          productId,
          weekStart: date,
        },
      },
      update: {
        maxGrams,
      },
      create: {
        productId,
        weekStart: date,
        maxGrams,
      },
    })
  }

  revalidatePath('/admin/san-luong')
  return { success: true, message: 'Cập nhật sản lượng thành công!' }
}
