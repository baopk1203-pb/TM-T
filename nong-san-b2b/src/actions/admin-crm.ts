'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { Role } from '@prisma/client'
import {
  validateDiscountPercent,
  buildCustomerGroupChangeAuditEntry,
  CustomerGroupAuditLogEntry,
} from '@/lib/domain/crm'

export interface UpdateCustomerGroupInput {
  customerId: string
  groupId: string
  reason?: string
}

export interface UpdateCustomerGroupResult {
  success: boolean
  message?: string
  error?: string
  unchanged?: boolean
  auditLog?: CustomerGroupAuditLogEntry
}

/**
 * Server Action: Admin đổi nhóm khách hàng B2B (Mục 2.A & Mục 3 — CRM-02, CRM-06, CRM-07)
 * - Bắt buộc quyền ADMIN qua requireAdmin()
 * - Chỉ áp dụng cho tài khoản có role = CUSTOMER
 * - Ghi structured server audit log (console.info) gồm: actorId, customerId, fromGroup, toGroup, reason, timestamp
 * - KHÔNG gắn vào OrderEvent của đơn hàng; hoạt động đồng nhất cho cả khách chưa có đơn hàng nào
 * - KHÔNG sửa đổi Order.groupDiscountPercent hoặc OrderItem của các đơn lịch sử
 */
export async function updateCustomerGroup(
  input: UpdateCustomerGroupInput
): Promise<UpdateCustomerGroupResult> {
  try {
    const admin = await requireAdmin()

    const customerId = typeof input?.customerId === 'string' ? input.customerId.trim() : ''
    const groupId = typeof input?.groupId === 'string' ? input.groupId.trim() : ''

    if (!customerId) {
      return { success: false, error: 'Thiếu mã khách hàng cần đổi nhóm' }
    }

    if (!groupId) {
      return { success: false, error: 'Vui lòng chọn nhóm khách hàng mới' }
    }

    const [customer, targetGroup] = await Promise.all([
      db.user.findUnique({
        where: { id: customerId },
        include: { group: true },
      }),
      db.customerGroup.findUnique({
        where: { id: groupId },
      }),
    ])

    if (!customer || customer.role !== Role.CUSTOMER) {
      return {
        success: false,
        error: 'Không tìm thấy tài khoản khách hàng B2B hợp lệ',
      }
    }

    if (!targetGroup) {
      return {
        success: false,
        error: 'Nhóm khách hàng được chọn không tồn tại trong hệ thống',
      }
    }

    if (customer.groupId === targetGroup.id) {
      return {
        success: true,
        unchanged: true,
        message: `Khách hàng đang thuộc nhóm "${targetGroup.name}" (-${targetGroup.discountPercent}%)`,
      }
    }

    await db.user.update({
      where: { id: customer.id },
      data: {
        groupId: targetGroup.id,
      },
    })

    const auditEntry = buildCustomerGroupChangeAuditEntry({
      actorId: admin.id,
      customerId: customer.id,
      fromGroup: customer.group
        ? {
            id: customer.group.id,
            code: customer.group.code,
            name: customer.group.name,
            discountPercent: customer.group.discountPercent,
          }
        : null,
      toGroup: {
        id: targetGroup.id,
        code: targetGroup.code,
        name: targetGroup.name,
        discountPercent: targetGroup.discountPercent,
      },
      reason: input.reason,
    })

    // Structured server audit log cho bản demo (Mục 2.A)
    console.info('[CRM_AUDIT]', JSON.stringify(auditEntry))

    revalidatePath('/admin/khach-hang')
    revalidatePath('/admin/nhom-khach')
    revalidatePath('/tai-khoan')
    revalidatePath('/tai-khoan/ho-so')
    revalidatePath('/san-pham')
    revalidatePath('/')

    const fromName = customer.group?.name || 'Chưa phân nhóm'
    return {
      success: true,
      auditLog: auditEntry,
      message: `Đã chuyển nhóm khách hàng từ "${fromName}" sang "${targetGroup.name}" (-${targetGroup.discountPercent}%)`,
    }
  } catch (error) {
    console.error('Error updating customer group:', error)
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Không thể cập nhật nhóm khách hàng',
    }
  }
}

export interface UpdateGroupDiscountInput {
  groupId: string
  discountPercent: number
}

export interface UpdateGroupDiscountResult {
  success: boolean
  message?: string
  error?: string
  group?: {
    id: string
    code: string
    name: string
    discountPercent: number
  }
}

/**
 * Server Action: Admin cập nhật tỷ lệ chiết khấu (%) của nhóm khách hàng (Mục 2.B & Mục 4 — CRM-03, CRM-04, CRM-07)
 * - Bắt buộc quyền ADMIN qua requireAdmin()
 * - Validate discountPercent là số nguyên từ 0 đến 50 (bao gồm 0 và 50)
 * - Thay đổi chỉ áp dụng cho báo giá và đơn hàng mới; tuyệt đối không sửa các đơn hàng đã snapshot
 */
export async function updateCustomerGroupDiscount(
  input: UpdateGroupDiscountInput
): Promise<UpdateGroupDiscountResult> {
  try {
    const admin = await requireAdmin()

    const groupId = typeof input?.groupId === 'string' ? input.groupId.trim() : ''
    if (!groupId) {
      return { success: false, error: 'Thiếu mã nhóm khách hàng' }
    }

    const validation = validateDiscountPercent(input?.discountPercent)
    if (!validation.valid || validation.value === undefined) {
      return {
        success: false,
        error: validation.error || 'Tỷ lệ chiết khấu không hợp lệ',
      }
    }

    const existingGroup = await db.customerGroup.findUnique({
      where: { id: groupId },
    })

    if (!existingGroup) {
      return {
        success: false,
        error: 'Không tìm thấy nhóm khách hàng cần cập nhật',
      }
    }

    const updatedGroup = await db.customerGroup.update({
      where: { id: existingGroup.id },
      data: {
        discountPercent: validation.value,
      },
      select: {
        id: true,
        code: true,
        name: true,
        discountPercent: true,
      },
    })

    console.info(
      '[CRM_AUDIT]',
      JSON.stringify({
        event: 'CUSTOMER_GROUP_DISCOUNT_UPDATED',
        actorId: admin.id,
        groupId: existingGroup.id,
        groupCode: existingGroup.code,
        fromDiscountPercent: existingGroup.discountPercent,
        toDiscountPercent: updatedGroup.discountPercent,
        timestamp: new Date().toISOString(),
      })
    )

    revalidatePath('/admin/nhom-khach')
    revalidatePath('/admin/khach-hang')
    revalidatePath('/tai-khoan')
    revalidatePath('/tai-khoan/ho-so')
    revalidatePath('/san-pham')
    revalidatePath('/')

    return {
      success: true,
      group: updatedGroup,
      message: `Đã cập nhật chiết khấu nhóm "${updatedGroup.name}" thành ${updatedGroup.discountPercent}% (chỉ áp dụng cho đơn mới)`,
    }
  } catch (error) {
    console.error('Error updating customer group discount:', error)
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Không thể cập nhật tỷ lệ chiết khấu nhóm',
    }
  }
}
