'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { profileSchema, ProfileInput, addressSchema, AddressInput } from '@/lib/validators/user'

/**
 * Cập nhật thông tin doanh nghiệp / hồ sơ
 */
export async function updateProfile(input: ProfileInput) {
  const sessionUser = await requireUser()
  const validated = profileSchema.safeParse(input)

  if (!validated.success) {
    return {
      success: false,
      error: validated.error.issues[0]?.message || 'Dữ liệu không hợp lệ',
    }
  }

  const { fullName, phone, companyName, taxCode } = validated.data

  await db.user.update({
    where: { id: sessionUser.id },
    data: {
      fullName: fullName.trim(),
      phone: phone.trim(),
      companyName: companyName.trim(),
      taxCode: taxCode?.trim() || null,
    },
  })

  revalidatePath('/tai-khoan')
  revalidatePath('/tai-khoan/ho-so')

  return { success: true, message: 'Cập nhật thông tin tài khoản thành công!' }
}

/**
 * Lấy danh sách địa chỉ nhận hàng của người dùng
 */
export async function getUserAddresses() {
  const sessionUser = await requireUser()
  return await db.address.findMany({
    where: { userId: sessionUser.id },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  })
}

/**
 * Thêm địa chỉ mới
 */
export async function createAddress(input: AddressInput) {
  const sessionUser = await requireUser()
  const validated = addressSchema.safeParse(input)

  if (!validated.success) {
    return {
      success: false,
      error: validated.error.issues[0]?.message || 'Dữ liệu địa chỉ không hợp lệ',
    }
  }

  const data = validated.data

  // Nếu địa chỉ này là mặc định, reset các địa chỉ cũ
  if (data.isDefault) {
    await db.address.updateMany({
      where: { userId: sessionUser.id },
      data: { isDefault: false },
    })
  } else {
    // Nếu chưa có địa chỉ nào, địa chỉ đầu tiên tự động thành mặc định
    const count = await db.address.count({
      where: { userId: sessionUser.id },
    })
    if (count === 0) {
      data.isDefault = true
    }
  }

  const newAddress = await db.address.create({
    data: {
      userId: sessionUser.id,
      label: data.label.trim(),
      recipient: data.recipient.trim(),
      phone: data.phone.trim(),
      line: data.line.trim(),
      ward: data.ward.trim(),
      district: data.district.trim(),
      province: data.province.trim(),
      isDefault: data.isDefault,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
    },
  })

  revalidatePath('/tai-khoan/dia-chi')
  revalidatePath('/thanh-toan')

  return { success: true, address: newAddress, message: 'Thêm địa chỉ mới thành công!' }
}

/**
 * Cập nhật địa chỉ
 */
export async function updateAddress(id: string, input: AddressInput) {
  const sessionUser = await requireUser()
  const validated = addressSchema.safeParse(input)

  if (!validated.success) {
    return {
      success: false,
      error: validated.error.issues[0]?.message || 'Dữ liệu địa chỉ không hợp lệ',
    }
  }

  const existing = await db.address.findFirst({
    where: { id, userId: sessionUser.id },
  })

  if (!existing) {
    return { success: false, error: 'Không tìm thấy địa chỉ' }
  }

  const data = validated.data

  if (data.isDefault) {
    await db.address.updateMany({
      where: { userId: sessionUser.id },
      data: { isDefault: false },
    })
  }

  await db.address.update({
    where: { id },
    data: {
      label: data.label.trim(),
      recipient: data.recipient.trim(),
      phone: data.phone.trim(),
      line: data.line.trim(),
      ward: data.ward.trim(),
      district: data.district.trim(),
      province: data.province.trim(),
      isDefault: data.isDefault,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
    },
  })

  revalidatePath('/tai-khoan/dia-chi')
  revalidatePath('/thanh-toan')

  return { success: true, message: 'Cập nhật địa chỉ thành công!' }
}

/**
 * Xóa địa chỉ
 */
export async function deleteAddress(id: string) {
  const sessionUser = await requireUser()

  const existing = await db.address.findFirst({
    where: { id, userId: sessionUser.id },
  })

  if (!existing) {
    return { success: false, error: 'Không tìm thấy địa chỉ' }
  }

  await db.address.delete({
    where: { id },
  })

  // Nếu vừa xóa địa chỉ mặc định, set địa chỉ còn lại gần nhất làm mặc định
  if (existing.isDefault) {
    const nextAddress = await db.address.findFirst({
      where: { userId: sessionUser.id },
      orderBy: { createdAt: 'desc' },
    })
    if (nextAddress) {
      await db.address.update({
        where: { id: nextAddress.id },
        data: { isDefault: true },
      })
    }
  }

  revalidatePath('/tai-khoan/dia-chi')
  revalidatePath('/thanh-toan')

  return { success: true, message: 'Xóa địa chỉ thành công!' }
}

/**
 * Thiết lập địa chỉ làm mặc định
 */
export async function setDefaultAddress(id: string) {
  const sessionUser = await requireUser()

  await db.address.updateMany({
    where: { userId: sessionUser.id },
    data: { isDefault: false },
  })

  await db.address.update({
    where: { id, userId: sessionUser.id },
    data: { isDefault: true },
  })

  revalidatePath('/tai-khoan/dia-chi')
  revalidatePath('/thanh-toan')

  return { success: true, message: 'Đã đặt làm địa chỉ nhận hàng mặc định' }
}
