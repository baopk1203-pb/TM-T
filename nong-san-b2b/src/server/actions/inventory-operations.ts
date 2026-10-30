'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { BatchStatus } from '@prisma/client'
import {
  isInventoryWriteEnabled,
  isInventoryAdjustmentEnabled,
} from '@/lib/domain/inventory-operations'
import {
  receiveStockInTx,
  adjustStockInTx,
  updateBatchStatusInTx,
  dispatchStockManualInTx,
  getBatchStatusAuditTrail,
} from '@/lib/services/inventory-write'
import type {
  StockReceiptInput,
  StockAdjustmentInput,
  StockAdjustmentType,
} from '@/lib/domain/inventory-operations'

export interface ServerActionResult<T = unknown> {
  success: boolean
  message?: string
  error?: string
  code?: string
  data?: T
}

/**
 * Helper: Revalidate các đường dẫn liên quan đến tồn kho trên Admin và Storefront.
 */
function revalidateInventoryPaths(productSlug?: string): void {
  try {
    revalidatePath('/admin/lo-hang')
    revalidatePath('/admin/ton-kho')
    revalidatePath('/admin/ton-kho/lich-su')
    revalidatePath('/san-pham')
    revalidatePath('/gio-hang')
    revalidatePath('/thanh-toan')
    if (productSlug) {
      revalidatePath(`/san-pham/${productSlug}`)
    }
  } catch {
    // Không làm gián đoạn transaction nếu revalidate thất bại trong môi trường test
  }
}

/**
 * Server Action: Nhập kho thu hoạch mới (Module A).
 */
export async function adminReceiveStock(
  input: StockReceiptInput
): Promise<ServerActionResult> {
  try {
    const admin = await requireAdmin()

    if (!isInventoryWriteEnabled()) {
      return {
        success: false,
        error:
          'Chức năng ghi kho Admin hiện đang bị khóa trên môi trường này theo chính sách an toàn (Fail-closed).',
        code: 'FEATURE_DISABLED',
      }
    }

    const result = await db.$transaction(async (tx) => {
      return await receiveStockInTx(tx, {
        ...input,
        actorId: admin.id,
      })
    })

    // Lấy thông tin slug sản phẩm để revalidate
    const product = await db.product.findUnique({
      where: { id: result.batch.productId },
      select: { slug: true },
    })

    revalidateInventoryPaths(product?.slug)

    return {
      success: true,
      message: `Đã nhập kho thành công lô hàng ${result.batch.code} (${result.batch.quantityGrams / 1000} kg)`,
      data: result,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Lỗi hệ thống khi nhập kho'
    return {
      success: false,
      error: message,
    }
  }
}

/**
 * Server Action: Điều chỉnh tồn kho / Ghi nhận hao hụt (Module C).
 */
export async function adminAdjustStock(
  input: StockAdjustmentInput
): Promise<ServerActionResult> {
  try {
    const admin = await requireAdmin()

    if (!isInventoryAdjustmentEnabled()) {
      return {
        success: false,
        error:
          'Chức năng điều chỉnh tồn kho Admin hiện đang bị khóa trên môi trường này theo chính sách an toàn (Fail-closed).',
        code: 'FEATURE_DISABLED',
      }
    }

    const result = await db.$transaction(async (tx) => {
      return await adjustStockInTx(tx, {
        ...input,
        actorId: admin.id,
      })
    })

    const batch = await db.batch.findUnique({
      where: { id: input.batchId },
      include: { product: { select: { slug: true } } },
    })

    revalidateInventoryPaths(batch?.product?.slug)

    const typeLabels: Record<StockAdjustmentType, string> = {
      SHRINKAGE_LOSS: 'Hao hụt/hư hỏng',
      QC_ADJUSTMENT_SUB: 'Kiểm kê giảm',
      QC_ADJUSTMENT_ADD: 'Kiểm kê tăng',
    }

    return {
      success: true,
      message: `Đã ghi nhận ${typeLabels[input.type] || input.type} ${input.quantityKg} kg cho lô hàng thành công`,
      data: result,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Lỗi hệ thống khi điều chỉnh tồn kho'
    return {
      success: false,
      error: message,
    }
  }
}

/**
 * Server Action: Cập nhật trạng thái lô hàng & Điều kiện FEFO (Module D).
 */
export async function adminUpdateBatchStatus(input: {
  batchId: string
  targetStatus: BatchStatus
  targetEligibility: boolean
  reason: string
  qcNotes?: string | null
}): Promise<ServerActionResult> {
  try {
    const admin = await requireAdmin()

    if (!isInventoryWriteEnabled()) {
      return {
        success: false,
        error:
          'Chức năng ghi kho Admin hiện đang bị khóa trên môi trường này theo chính sách an toàn (Fail-closed).',
        code: 'FEATURE_DISABLED',
      }
    }

    const result = await db.$transaction(async (tx) => {
      return await updateBatchStatusInTx(tx, {
        batchId: input.batchId,
        targetStatus: input.targetStatus,
        targetEligibility: input.targetEligibility,
        reason: input.reason,
        qcNotes: input.qcNotes,
        actorId: admin.id,
      })
    })

    const batch = await db.batch.findUnique({
      where: { id: input.batchId },
      include: { product: { select: { slug: true } } },
    })

    revalidateInventoryPaths(batch?.product?.slug)

    return {
      success: true,
      message: `Đã cập nhật trạng thái lô ${result.batch.code} sang ${result.batch.status} thành công`,
      data: result,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Lỗi hệ thống khi cập nhật trạng thái lô hàng'
    return {
      success: false,
      error: message,
    }
  }
}

/**
 * Server Action: Đọc lịch sử thay đổi trạng thái (Audit Trail) của lô hàng.
 */
export async function getBatchAuditHistory(
  batchId: string
): Promise<ServerActionResult> {
  try {
    await requireAdmin()

    const history = await getBatchStatusAuditTrail(db, batchId)
    return {
      success: true,
      data: history,
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Lỗi khi đọc lịch sử kiểm toán lô hàng'
    return {
      success: false,
      error: message,
    }
  }
}

/**
 * Server Action: Xuất kho thủ công (Module B).
 */
export async function adminDispatchStock(input: {
  batchId: string
  quantityKg: number
  reason: string
  referenceCode?: string | null
  orderId?: string | null
}): Promise<ServerActionResult> {
  try {
    const admin = await requireAdmin()

    if (!isInventoryWriteEnabled()) {
      return {
        success: false,
        error:
          'Chức năng ghi kho Admin hiện đang bị khóa trên môi trường này theo chính sách an toàn (Fail-closed).',
        code: 'FEATURE_DISABLED',
      }
    }

    await db.$transaction(async (tx) => {
      await dispatchStockManualInTx(tx, {
        ...input,
        actorId: admin.id,
      })
    })

    return {
      success: true,
      message: 'Xuất kho thành công',
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Lỗi khi xuất kho thủ công'
    return {
      success: false,
      error: message,
    }
  }
}
