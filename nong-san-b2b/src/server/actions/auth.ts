'use server'

import { registerSchema, RegisterInput } from '@/lib/validators/auth'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { Role } from '@prisma/client'

export async function registerUser(input: RegisterInput) {
  try {
    const validated = registerSchema.safeParse(input)
    if (!validated.success) {
      const firstError = validated.error.issues[0]?.message || 'Dữ liệu không hợp lệ'
      return { success: false, error: firstError }
    }

    const { email, password, fullName, phone, companyName, taxCode } = validated.data
    const normalizedEmail = email.toLowerCase().trim()

    // 1. Kiểm tra email đã tồn tại chưa
    const existing = await db.user.findUnique({
      where: { email: normalizedEmail },
    })

    if (existing) {
      return {
        success: false,
        error: 'Địa chỉ email này đã được đăng ký tài khoản trong hệ thống',
      }
    }

    // 2. Lấy nhóm mặc định (Cửa hàng nhỏ - SMALL_SHOP)
    let defaultGroup = await db.customerGroup.findFirst({
      where: { isDefault: true },
    })

    if (!defaultGroup) {
      defaultGroup = await db.customerGroup.findUnique({
        where: { code: 'SMALL_SHOP' },
      })
    }

    // 3. Hash mật khẩu và tạo tài khoản
    const passwordHash = await bcrypt.hash(password, 10)

    const user = await db.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        fullName: fullName.trim(),
        phone: phone.trim(),
        companyName: companyName.trim(),
        taxCode: taxCode?.trim() || null,
        role: Role.CUSTOMER,
        groupId: defaultGroup?.id ?? null,
      },
    })

    return {
      success: true,
      userId: user.id,
      message: 'Đăng ký tài khoản doanh nghiệp thành công!',
    }
  } catch (error) {
    console.error('Lỗi khi đăng ký tài khoản:', error)
    return {
      success: false,
      error: 'Đã có lỗi xảy ra trong quá trình đăng ký. Vui lòng thử lại sau.',
    }
  }
}
