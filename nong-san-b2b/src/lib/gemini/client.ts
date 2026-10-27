/**
 * F03 — GEMINI CLIENT & MODEL VERIFIER
 * E Vibe — Nông Sản B2B
 *
 * REST API client directly using native fetch.
 * Strictly server-side only: never expose API keys to client.
 */

import {
  GeminiQueryResult,
  ModelVerificationResult,
} from './types'

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_TIMEOUT_MS = 15000 // 15s timeout
const VERIFY_TIMEOUT_MS = 8000 // 8s timeout for probe

// Priority order for production models supported by Gemini API
const PREFERRED_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3-flash-preview',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
  'gemini-2.5-flash',
  'gemini-1.5-flash',
]

/**
 * Lấy API Key từ biến môi trường máy chủ (không bao giờ lộ ra client)
 */
export function getGeminiApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim()
  return key && key.length > 0 ? key : null
}

/**
 * Tiện ích thăm dò và xác minh danh sách model cùng quyền truy cập thực tế của API Key
 * (Preflight Verification Strategy)
 */
export async function verifyGeminiModelAccess(
  providedApiKey?: string | null
): Promise<ModelVerificationResult> {
  const apiKey = providedApiKey !== undefined ? providedApiKey : getGeminiApiKey()

  if (!apiKey) {
    return {
      ok: false,
      errorType: 'MISSING_API_KEY',
      message:
        'Biến môi trường GEMINI_API_KEY chưa được cấu hình trên máy chủ. Vui lòng thiết lập GEMINI_API_KEY trong .env.local hoặc Vercel Environment Variables.',
    }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)

  try {
    const res = await fetch(`${GEMINI_API_BASE_URL}/models?key=${encodeURIComponent(apiKey)}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}))
      const errorMsg = errorBody?.error?.message || res.statusText

      if (res.status === 400 || res.status === 403) {
        return {
          ok: false,
          errorType: 'INVALID_API_KEY',
          message: `Khóa GEMINI_API_KEY không hợp lệ hoặc bị từ chối truy cập (HTTP ${res.status}: ${errorMsg}).`,
        }
      }

      if (res.status === 429) {
        return {
          ok: false,
          errorType: 'QUOTA_EXCEEDED',
          message: `Hạn ngạch Gemini API đã vượt quá giới hạn (HTTP 429: ${errorMsg}).`,
        }
      }

      return {
        ok: false,
        errorType: 'UNKNOWN_ERROR',
        message: `Lỗi kết nối Gemini API (HTTP ${res.status}: ${errorMsg}).`,
      }
    }

    const data = await res.json()
    const rawModels: Array<{ name: string; supportedGenerationMethods?: string[] }> =
      data.models || []

    // Lọc các model hỗ trợ generateContent
    const contentModels = rawModels
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))

    if (contentModels.length === 0) {
      return {
        ok: false,
        errorType: 'MODEL_ACCESS_DENIED',
        message: 'Khóa API không có quyền sử dụng bất kỳ mô hình generateContent nào.',
      }
    }

    // Chọn model ưu tiên tốt nhất
    let activeModel: string = contentModels[0]
    for (const preferred of PREFERRED_MODELS) {
      if (contentModels.includes(preferred)) {
        activeModel = preferred
        break
      }
    }

    return {
      ok: true,
      activeModel,
      availableModels: contentModels,
      message: `Xác thực thành công. Đang sử dụng mô hình: ${activeModel}`,
    }
  } catch (error: unknown) {
    clearTimeout(timeoutId)

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        ok: false,
        errorType: 'TIMEOUT_OR_NETWORK',
        message: 'Quá thời gian kết nối (Timeout) khi kiểm tra danh sách mô hình Gemini.',
      }
    }

    return {
      ok: false,
      errorType: 'TIMEOUT_OR_NETWORK',
      message: error instanceof Error ? error.message : 'Lỗi mạng khi kết nối Gemini API.',
    }
  }
}

export interface QueryGeminiOptions {
  prompt: string
  context: string
  systemInstruction?: string
  model?: string
  apiKey?: string | null
  timeoutMs?: number
}

const DEFAULT_SYSTEM_INSTRUCTION = `Bạn là Trợ lý Quản trị Cấp cao (Executive AI Assistant) của Sàn Thương mại Điện tử B2B Nông sản E Vibe.
Nhiệm vụ của bạn là hỗ trợ Ban Giám đốc và Quản trị viên phân tích báo cáo kinh doanh, tài chính, đơn hàng, khiếu nại và tồn kho FEFO.

CÁC NGUYÊN TẮC BẮT BUỘC:
1. TRUNG THỰC VÀ CHÍNH XÁC TUYỆT ĐỐI (ZERO HALLUCINATION):
   - Bạn CHỈ ĐƯỢC phân tích dựa trên các số liệu và sự kiện thực tế có trong phần [NGỮ CẢNH DỮ LIỆU].
   - TUYỆT ĐỐI KHÔNG tự tạo ra, phỏng đoán hoặc bịa đặt số liệu doanh thu, đơn hàng, khách hàng hay khối lượng tồn kho không có trong dữ liệu.
   - Nếu quản trị viên hỏi về thông tin không xuất hiện trong ngữ cảnh, hãy thông báo rõ ràng rằng dữ liệu đó không có trong kỳ báo cáo hiện hành.

2. QUY CHUẨN ĐƠN VỊ & ĐỊNH DẠNG:
   - Tiền tệ: Luôn viết bằng số nguyên VND có dấu chấm ngăn cách hàng nghìn và kèm chữ 'đ' (ví dụ: 15.450.000 đ).
   - Khối lượng: Luôn viết kèm đơn vị kg hoặc tấn (ví dụ: 250 kg, 1,3 tấn).
   - Tỷ lệ: Ghi kèm ký hiệu % (ví dụ: 4,5%).

3. PHONG CÁCH DIỄN ĐẠT:
   - Trả lời bằng tiếng Việt chuyên nghiệp, gãy gọn, rành mạch, có tiêu đề và gạch đầu dòng rõ ràng.
   - Nêu bật ngay các chỉ số trọng yếu, các phát hiện bất thường (ví dụ: tỷ lệ hủy đơn cao, lô hàng sắp cận date, chênh lệch dòng tiền) và gợi ý hành động cụ thể cho ban quản trị.

4. BẢO MẬT DỮ LIỆU:
   - Dữ liệu khách hàng đã được khử định danh (PII). Hãy giữ nguyên các mã định danh đã khử (ví dụ: DOANH_NGHIEP_#1234).`

/**
 * Thực hiện truy vấn Gemini API để phân tích dữ liệu kinh doanh / kho bãi
 */
export async function queryGemini(
  options: QueryGeminiOptions
): Promise<GeminiQueryResult> {
  const startTime = Date.now()
  const apiKey = options.apiKey !== undefined ? options.apiKey : getGeminiApiKey()

  if (!apiKey) {
    return {
      success: false,
      errorType: 'MISSING_API_KEY',
      message:
        'Trợ lý AI chưa thể hoạt động: Chưa cấu hình GEMINI_API_KEY trên máy chủ. Vui lòng thêm biến môi trường GEMINI_API_KEY vào .env.local hoặc Vercel dashboard.',
    }
  }

  // Nếu không truyền model, thực hiện thăm dò hoặc lấy model mặc định
  let modelToUse = options.model
  if (!modelToUse) {
    const verification = await verifyGeminiModelAccess(apiKey)
    if (!verification.ok || !verification.activeModel) {
      return {
        success: false,
        errorType: verification.errorType || 'MODEL_ACCESS_DENIED',
        message:
          verification.message ||
          'Không thể xác thực quyền truy cập mô hình Gemini với API Key hiện tại.',
      }
    }
    modelToUse = verification.activeModel
  }

  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  const systemInstruction = options.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION
  const fullUserPrompt = `[NGỮ CẢNH DỮ LIỆU QUẢN TRỊ E VIBE]\n${options.context}\n\n[CÂU HỎI CỦA QUẢN TRỊ VIÊN]\n${options.prompt}`

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [{ text: fullUserPrompt }],
      },
    ],
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    generationConfig: {
      temperature: 0.2, // Nhiệt độ thấp để đảm bảo câu trả lời bám sát sự thật
      maxOutputTokens: 2048,
    },
  }

  try {
    const url = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(modelToUse)}:generateContent?key=${encodeURIComponent(apiKey)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}))
      const errorMsg = errorBody?.error?.message || res.statusText

      if (res.status === 400 && (errorMsg?.includes('API key') || errorMsg?.includes('API_KEY'))) {
        return {
          success: false,
          errorType: 'INVALID_API_KEY',
          message: `Khóa GEMINI_API_KEY không hợp lệ hoặc bị từ chối truy cập (HTTP 400: ${errorMsg}).`,
        }
      }

      if (res.status === 429) {
        return {
          success: false,
          errorType: 'QUOTA_EXCEEDED',
          message:
            'Hạn ngạch Gemini API của dự án đã tạm thời vượt mức (HTTP 429). Vui lòng thử lại sau ít phút hoặc nâng cấp quota.',
        }
      }

      if (res.status === 404 || res.status === 403) {
        return {
          success: false,
          errorType: 'MODEL_ACCESS_DENIED',
          message: `Không có quyền truy cập mô hình ${modelToUse} (HTTP ${res.status}: ${errorMsg}).`,
        }
      }

      if (res.status >= 500) {
        return {
          success: false,
          errorType: 'SERVICE_UNAVAILABLE',
          message:
            'Dịch vụ Google Gemini đang tạm thời gián đoạn (HTTP 5xx). Vui lòng thử lại sau.',
        }
      }

      return {
        success: false,
        errorType: 'UNKNOWN_ERROR',
        message: `Lỗi gọi Gemini API (HTTP ${res.status}: ${errorMsg}).`,
      }
    }

    const data = await res.json()
    const candidateText =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()

    if (!candidateText) {
      return {
        success: false,
        errorType: 'UNKNOWN_ERROR',
        message: 'Mô hình Gemini không phản hồi nội dung văn bản hợp lệ.',
      }
    }

    return {
      success: true,
      answer: candidateText,
      metadata: {
        model: modelToUse,
        timestamp: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime,
      },
    }
  } catch (error: unknown) {
    clearTimeout(timeoutId)

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        errorType: 'TIMEOUT_OR_NETWORK',
        message: `Yêu cầu Gemini API bị quá hạn thời gian xử lý (${timeoutMs / 1000}s). Vui lòng thử lại câu hỏi ngắn hơn.`,
      }
    }

    return {
      success: false,
      errorType: 'TIMEOUT_OR_NETWORK',
      message: error instanceof Error ? error.message : 'Lỗi kết nối mạng tới Gemini API.',
    }
  }
}
