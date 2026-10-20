import { OrderStatus, Role, ComplaintStatus, Resolution } from '@prisma/client'
import { isOrderEligibleForRevenue, getOrderEligibleRevenue } from './reports'

export const MIN_GROUP_DISCOUNT_PERCENT = 0
export const MAX_GROUP_DISCOUNT_PERCENT = 50

export interface DiscountValidationResult {
  valid: boolean
  value?: number
  error?: string
}

/**
 * Validate tỷ lệ chiết khấu nhóm khách hàng (Mục 2.B — Batch 7A)
 * - Chỉ chấp nhận số nguyên từ 0 đến 50 (bao gồm 0 và 50)
 * - Từ chối số âm, số thập phân, giá trị > 50, NaN hoặc kiểu dữ liệu không hợp lệ
 */
export function validateDiscountPercent(input: unknown): DiscountValidationResult {
  if (typeof input !== 'number' || Number.isNaN(input) || !Number.isFinite(input)) {
    return {
      valid: false,
      error: 'Tỷ lệ chiết khấu phải là một số hợp lệ',
    }
  }

  if (!Number.isInteger(input)) {
    return {
      valid: false,
      error: 'Tỷ lệ chiết khấu phải là số nguyên (không chấp nhận số thập phân)',
    }
  }

  if (input < MIN_GROUP_DISCOUNT_PERCENT) {
    return {
      valid: false,
      error: `Tỷ lệ chiết khấu không được âm (tối thiểu ${MIN_GROUP_DISCOUNT_PERCENT}%)`,
    }
  }

  if (input > MAX_GROUP_DISCOUNT_PERCENT) {
    return {
      valid: false,
      error: `Tỷ lệ chiết khấu tối đa cho phép là ${MAX_GROUP_DISCOUNT_PERCENT}%`,
    }
  }

  return {
    valid: true,
    value: input,
  }
}

export interface CustomerOrderSummaryInput {
  status: OrderStatus | string
  total: number
  finalTotal?: number | null
  complaints?: Array<{
    status: ComplaintStatus | string
    resolution?: Resolution | string | null
    compensation?: number | null
  }>
}

export interface CustomerOrderStats {
  orderCount: number // Tổng số đơn (không tính đơn DRAFT chưa xác nhận)
  completedOrderCount: number // Số đơn COMPLETED
  completedRevenue: number // Tổng (finalTotal ?? total) của các đơn COMPLETED
  activeOrderCount: number // Số đơn đang xử lý / chờ xác nhận / pre-order
  cancelledOrderCount: number // Số đơn đã hủy (CANCELLED)
  draftOrderCount: number // Số đơn nháp định kỳ chưa xác nhận (DRAFT)
}

/**
 * Tính toán thống kê đơn hàng và doanh thu của một khách hàng B2B (Mục 3 — CRM-01)
 * - Số đơn (orderCount): không tính đơn DRAFT chưa xác nhận
 * - Doanh thu (completedRevenue): chỉ tính đơn có status = COMPLETED không có khiếu nại OPEN, lấy (finalTotal ?? total) - bồi hoàn
 */
export function computeCustomerOrderStats(
  orders: CustomerOrderSummaryInput[]
): CustomerOrderStats {
  let orderCount = 0
  let completedOrderCount = 0
  let completedRevenue = 0
  let activeOrderCount = 0
  let cancelledOrderCount = 0
  let draftOrderCount = 0

  for (const order of orders) {
    if (order.status === OrderStatus.DRAFT) {
      draftOrderCount++
      continue
    }

    orderCount++

    if (order.status === OrderStatus.COMPLETED) {
      if (!isOrderEligibleForRevenue(order)) {
        // Đơn COMPLETED nhưng đang có khiếu nại chưa xử lý -> tính là đơn active dispute (BR-04)
        activeOrderCount++
      } else {
        completedOrderCount++
        completedRevenue += getOrderEligibleRevenue(order)
      }
    } else if (order.status === OrderStatus.CANCELLED) {
      cancelledOrderCount++
    } else {
      activeOrderCount++
    }
  }

  return {
    orderCount,
    completedOrderCount,
    completedRevenue,
    activeOrderCount,
    cancelledOrderCount,
    draftOrderCount,
  }
}

export interface GroupInfoSnapshot {
  id: string
  code: string
  name: string
  discountPercent: number
}

export interface CustomerGroupAuditLogEntry {
  event: 'CUSTOMER_GROUP_CHANGED'
  actorId: string
  customerId: string
  fromGroup: {
    id: string | null
    code: string | null
    name: string | null
    discountPercent: number
  }
  toGroup: {
    id: string
    code: string
    name: string
    discountPercent: number
  }
  reason: string | null
  timestamp: string
}

/**
 * Tạo bản ghi structured audit log khi Admin đổi nhóm khách hàng (Mục 2.A — CRM-02 & CRM-06)
 * - Chỉ ghi các trường định danh & nghiệp vụ cần thiết: actorId, customerId, fromGroup, toGroup, reason, timestamp
 * - Tuyệt đối không ghi passwordHash, token hoặc dữ liệu cá nhân nhạy cảm
 */
export function buildCustomerGroupChangeAuditEntry(input: {
  actorId: string
  customerId: string
  fromGroup?: GroupInfoSnapshot | null
  toGroup: GroupInfoSnapshot
  reason?: string | null
  timestamp?: Date
}): CustomerGroupAuditLogEntry {
  const cleanReason = input.reason?.trim() ? input.reason.trim() : null
  const now = input.timestamp ?? new Date()

  return {
    event: 'CUSTOMER_GROUP_CHANGED',
    actorId: input.actorId,
    customerId: input.customerId,
    fromGroup: {
      id: input.fromGroup?.id ?? null,
      code: input.fromGroup?.code ?? null,
      name: input.fromGroup?.name ?? null,
      discountPercent: input.fromGroup?.discountPercent ?? 0,
    },
    toGroup: {
      id: input.toGroup.id,
      code: input.toGroup.code,
      name: input.toGroup.name,
      discountPercent: input.toGroup.discountPercent,
    },
    reason: cleanReason,
    timestamp: now.toISOString(),
  }
}

export interface DbCustomerContextInput {
  id?: string
  fullName?: string | null
  companyName?: string | null
  phone?: string | null
  role?: Role
  groupId?: string | null
  group?: {
    id: string
    code: string
    name: string
    discountPercent: number
  } | null
}

export interface SessionCustomerContextFallback {
  id?: string
  name?: string | null
  companyName?: string | null
  phone?: string | null
  role?: Role
  groupId?: string | null
  groupCode?: string | null
  groupName?: string | null
  discountPercent?: number
}

export interface ResolvedCustomerGroupContext {
  name: string | null
  companyName: string | null
  phone: string | null
  role: Role
  groupId: string | null
  groupCode: string
  groupName: string
  discountPercent: number
}

/**
 * Đồng bộ thông tin nhóm và chiết khấu mới nhất từ DB cho phiên làm việc của khách (Mục 5 — CRM-05)
 * - Luôn ưu tiên dữ liệu thực tế từ DB (dbUser) thay vì giá trị cũ trong JWT token
 * - Fallback an toàn về session hiện tại nếu truy vấn DB không khả dụng (ví dụ trong môi trường mock test)
 */
export function resolveCustomerGroupContext(
  dbUser?: DbCustomerContextInput | null,
  fallbackSessionUser?: SessionCustomerContextFallback | null
): ResolvedCustomerGroupContext {
  if (dbUser) {
    return {
      name: dbUser.fullName ?? fallbackSessionUser?.name ?? null,
      companyName: dbUser.companyName ?? fallbackSessionUser?.companyName ?? null,
      phone: dbUser.phone ?? fallbackSessionUser?.phone ?? null,
      role: dbUser.role ?? fallbackSessionUser?.role ?? Role.CUSTOMER,
      groupId: dbUser.groupId ?? dbUser.group?.id ?? null,
      groupCode: dbUser.group?.code ?? 'SMALL_SHOP',
      groupName: dbUser.group?.name ?? 'Cửa hàng nhỏ',
      discountPercent: dbUser.group?.discountPercent ?? 0,
    }
  }

  const fallbackDiscount = fallbackSessionUser?.discountPercent ?? 0
  return {
    name: fallbackSessionUser?.name ?? null,
    companyName: fallbackSessionUser?.companyName ?? null,
    phone: fallbackSessionUser?.phone ?? null,
    role: fallbackSessionUser?.role ?? Role.CUSTOMER,
    groupId: fallbackSessionUser?.groupId ?? null,
    groupCode: fallbackSessionUser?.groupCode ?? 'SMALL_SHOP',
    groupName: fallbackSessionUser?.groupName ?? 'Cửa hàng nhỏ',
    discountPercent: fallbackDiscount,
  }
}

export interface CustomerGroupBadgeInfo {
  label: string
  groupName: string
  groupCode: string
  discountPercent: number
  color: string
}

/**
 * Định dạng nhãn và màu sắc hiển thị hạng thành viên B2B từ thông tin nhóm trong DB (Mục 5)
 * - Không hardcode theo discountPercent === 5 hay === 3
 * - Phản ánh chính xác cả khi Admin thay đổi % chiết khấu của nhóm (ví dụ Siêu thị 3% -> 4%)
 */
export function formatCustomerGroupBadge(group?: {
  code?: string | null
  name?: string | null
  discountPercent?: number | null
} | null): CustomerGroupBadgeInfo {
  const groupCode = group?.code || 'SMALL_SHOP'
  const groupName = group?.name || 'Cửa hàng nhỏ'
  const discountPercent =
    typeof group?.discountPercent === 'number' && group.discountPercent > 0
      ? group.discountPercent
      : 0

  const label =
    discountPercent > 0 ? `${groupName} (-${discountPercent}%)` : groupName

  let color = 'bg-slate-100 text-slate-700 border-slate-300'
  if (groupCode === 'TIER1_AGENT') {
    color = 'bg-blue-100 text-blue-800 border-blue-300'
  } else if (groupCode === 'SUPERMARKET') {
    color = 'bg-emerald-100 text-emerald-800 border-emerald-300'
  } else if (discountPercent > 0) {
    color = 'bg-amber-100 text-amber-800 border-amber-300'
  }

  return {
    label,
    groupName,
    groupCode,
    discountPercent,
    color,
  }
}

export interface FilterableCustomerRecord {
  id: string
  fullName: string
  email: string
  phone: string
  companyName: string | null
  taxCode: string | null
  groupCode: string | null
}

/**
 * Lọc danh sách khách hàng theo từ khóa tìm kiếm và mã nhóm
 */
export function filterCustomers<T extends FilterableCustomerRecord>(
  customers: T[],
  criteria: {
    search?: string
    groupCode?: string
  }
): T[] {
  const q = criteria.search?.trim().toLowerCase() || ''
  const groupFilter = criteria.groupCode?.trim() || 'ALL'

  return customers.filter((c) => {
    if (groupFilter !== 'ALL') {
      const effectiveGroupCode = c.groupCode || 'SMALL_SHOP'
      if (effectiveGroupCode !== groupFilter) {
        return false
      }
    }

    if (!q) return true

    const matchName = c.fullName.toLowerCase().includes(q)
    const matchCompany = (c.companyName || '').toLowerCase().includes(q)
    const matchTax = (c.taxCode || '').toLowerCase().includes(q)
    const matchPhone = c.phone.toLowerCase().includes(q)
    const matchEmail = c.email.toLowerCase().includes(q)

    return matchName || matchCompany || matchTax || matchPhone || matchEmail
  })
}
