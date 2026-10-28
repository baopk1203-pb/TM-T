'use server'

/**
 * F03 — ADMIN EXECUTIVE AI SERVER ACTION
 * E Vibe — Nông Sản B2B
 *
 * Exclusively accessible by ADMIN users via requireAdmin().
 * Read-only aggregation of business metrics and inventory data.
 * Zero arbitrary SQL, zero database mutations, zero client API key exposure.
 */

import { requireAdmin } from '@/lib/auth'
import { getBusinessReports } from '@/server/reports'
import { getAdminDashboardKpis } from '@/server/reports'
import { getAdminInventoryDashboardData } from '@/lib/services/inventory-read'
import { buildExecutiveContext } from '@/lib/gemini/context'
import {
  getGeminiApiKey,
  verifyGeminiModelAccess,
  queryGemini,
} from '@/lib/gemini/client'
import {
  AdminAiQueryPayload,
  AdminAiStatus,
  GeminiQueryResult,
} from '@/lib/gemini/types'

const MAX_QUERY_LENGTH = 500
const MIN_QUERY_LENGTH = 2

/**
 * Kiểm tra trạng thái sẵn sàng của dịch vụ Gemini AI dành cho Admin
 */
export async function getAdminAiStatusAction(): Promise<AdminAiStatus> {
  await requireAdmin()

  const apiKey = getGeminiApiKey()
  if (!apiKey) {
    return {
      configured: false,
      statusMessage: 'Chưa cấu hình GEMINI_API_KEY trên máy chủ.',
      errorType: 'MISSING_API_KEY',
    }
  }

  const verification = await verifyGeminiModelAccess(apiKey)
  if (!verification.ok) {
    return {
      configured: false,
      statusMessage: verification.message || 'Lỗi kết nối Gemini API.',
      errorType: verification.errorType,
    }
  }

  return {
    configured: true,
    activeModel: verification.activeModel,
    statusMessage: `Sẵn sàng (${verification.activeModel})`,
  }
}

/**
 * Server Action chính: Nhận câu hỏi từ Admin, trích xuất ngữ cảnh đọc báo cáo nội bộ và gọi Gemini AI
 */
export async function queryAdminExecutiveAiAction(
  payload: AdminAiQueryPayload
): Promise<GeminiQueryResult> {
  // 1. Kiểm tra quyền Quản trị viên tối cao
  await requireAdmin()

  // 2. Validate input query
  const query = payload?.query?.trim()
  if (!query || query.length < MIN_QUERY_LENGTH) {
    return {
      success: false,
      errorType: 'UNKNOWN_ERROR',
      message: 'Vui lòng nhập câu hỏi tối thiểu 2 ký tự.',
    }
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return {
      success: false,
      errorType: 'UNKNOWN_ERROR',
      message: `Câu hỏi quá dài (tối đa ${MAX_QUERY_LENGTH} ký tự).`,
    }
  }

  // 3. Kiểm tra sự tồn tại của API Key
  const apiKey = getGeminiApiKey()
  if (!apiKey) {
    return {
      success: false,
      errorType: 'MISSING_API_KEY',
      message:
        'Trợ lý AI chưa thể hoạt động: Chưa cấu hình GEMINI_API_KEY trên máy chủ. Quản trị viên vui lòng bổ sung khóa GEMINI_API_KEY vào biến môi trường để kích hoạt.',
    }
  }

  // 4. Thu thập ngữ cảnh server-side read-only (Báo cáo kinh doanh 30 ngày, KPI hôm nay, Tồn kho FEFO)
  let reportData = null
  let dashboardKpis = null
  let inventoryData = null

  try {
    const [reportsResult, kpisResult, inventoryResult] = await Promise.allSettled([
      getBusinessReports({ preset: '30D', grouping: 'DAY' }),
      getAdminDashboardKpis(),
      getAdminInventoryDashboardData(),
    ])

    if (reportsResult.status === 'fulfilled' && reportsResult.value.success) {
      reportData = reportsResult.value.data || null
    }

    if (kpisResult.status === 'fulfilled') {
      dashboardKpis = kpisResult.value
    }

    if (inventoryResult.status === 'fulfilled') {
      inventoryData = inventoryResult.value
    }
  } catch (error) {
    console.error('[AdminAI] Error assembling context:', error)
  }

  // 5. Chuẩn hóa ngữ cảnh và khử định danh thông tin cá nhân (PII Redaction)
  const context = buildExecutiveContext({
    reportData,
    dashboardKpis,
    inventoryData,
  })

  // 6. Thực hiện truy vấn Gemini qua native REST client
  return await queryGemini({
    prompt: query,
    context,
    apiKey,
    model: payload?.model,
  })
}
