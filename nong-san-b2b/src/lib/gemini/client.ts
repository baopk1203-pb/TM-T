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
const DEFAULT_TIMEOUT_MS = 35000 // 35s timeout
const VERIFY_TIMEOUT_MS = 8000 // 8s timeout for probe
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes TTL for verified model cache

// Priority order for production models supported by Gemini API
const PREFERRED_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
  'gemini-2.5-flash',
  'gemini-1.5-flash',
]

let cachedVerification: { result: ModelVerificationResult; expiresAt: number } | null = null

/**
 * Xóa bộ nhớ đệm xác minh model (dùng khi kiểm thử hoặc làm mới cưỡng bức)
 */
export function clearModelVerificationCache(): void {
  cachedVerification = null
}

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
  providedApiKey?: string | null,
  forceRefresh = false
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

  // Sử dụng cache trong bộ nhớ nếu còn hiệu lực và không yêu cầu làm mới
  if (!forceRefresh && cachedVerification && cachedVerification.expiresAt > Date.now() && cachedVerification.result.ok) {
    return cachedVerification.result
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)

  try {
    const res = await fetch(`${GEMINI_API_BASE_URL}/models`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'x-goog-api-key': apiKey,
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

    const verificationResult: ModelVerificationResult = {
      ok: true,
      activeModel,
      availableModels: contentModels,
      message: `Xác thực thành công. Đang sử dụng mô hình: ${activeModel}`,
    }

    cachedVerification = {
      result: verificationResult,
      expiresAt: Date.now() + CACHE_TTL_MS,
    }

    return verificationResult
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

export const DEFAULT_SYSTEM_INSTRUCTION = `Bạn là Trợ lý Quản trị Cấp cao (Executive AI Assistant) của Sàn Thương mại Điện tử B2B Nông sản E Vibe.
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
   - Dữ liệu khách hàng đã được khử định danh (PII). Hãy giữ nguyên các mã định danh đã khử (ví dụ: DOANH_NGHIEP_#1234).

5. ĐỘ DÀI VÀ TRỌNG TÂM:
   - Trình bày cô đọng, súc tích (khoảng 150 - 250 từ), tập trung trực tiếp vào câu trả lời và số liệu then chốt.
   - Không sao chép lại toàn bộ bảng số liệu thô; chỉ trích dẫn các chỉ số quan trọng nhất và đưa ra nhận xét/cảnh báo thiết thực.

6. ĐỊNH NGHĨA VÀ NGUYÊN TẮC QUẢN TRỊ KHO FEFO (F03-WORK-03):
   - FEFO là viết tắt của "First Expired, First Out" (Hết hạn trước, Xuất trước).
   - Định nghĩa chính xác: Ưu tiên xuất kho những lô hàng có hạn sử dụng gần nhất trước, với điều kiện lô hàng đó đạt tiêu chuẩn chất lượng (QC) và ở trạng thái hợp lệ để bán (Active/Sellable).
   - TUYỆT ĐỐI KHÔNG giải thích FEFO là "nhập trước xuất trước". Đó là nguyên tắc FIFO ("First In, First Out"). FEFO căn cứ vào HẠN SỬ DỤNG của lô hàng chứ KHÔNG căn cứ vào ngày nhập kho.
   - Tiêu chí xuất kho: Luôn căn cứ vào Hạn sử dụng (Expiry Date) khi phân tích thứ tự ưu tiên xuất hàng.
   - Tuyệt đối không khẳng định một lô được phép bán nếu dữ liệu kiểm định chất lượng (QC) không cho phép (ví dụ: lô bị khóa LOCKED_QC hoặc chưa kiểm định UNVERIFIED thì không đủ điều kiện bán).

7. QUY TẮC ĐẾM LÔ CẬN DATE VÀ PHÂN TẬP HỢP (F03-WORK-02):
   - Khi phân tích cảnh báo hạn dùng: Nhóm lô hàng hết hạn trong ≤3 ngày là TẬP CON lồng bên trong nhóm hết hạn trong ≤7 ngày.
   - TUYỆT ĐỐI KHÔNG cộng hai số đếm này lại để tạo ra tổng số lô mới. Ví dụ: Nếu có 5 lô ≤7 ngày và trong đó có 1 lô ≤3 ngày thì tổng số lô cận date chỉ là 5 lô duy nhất (gồm 1 lô khẩn cấp cao ≤3 ngày và 4 lô khẩn cấp trung bình >3 đến ≤7 ngày), TUYỆT ĐỐI KHÔNG được cộng thành 6 lô.`

/**
 * Thực hiện gọi API generateContent với một mô hình cụ thể
 */
async function callGeminiGenerateContent(
  model: string,
  apiKey: string,
  fullUserPrompt: string,
  systemInstruction: string,
  timeoutMs: number,
  startTime: number
): Promise<GeminiQueryResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

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
    const url = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-goog-api-key': apiKey,
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
          message: `Không có quyền truy cập mô hình ${model} (HTTP ${res.status}: ${errorMsg}).`,
        }
      }

      if (res.status >= 500) {
        return {
          success: false,
          errorType: 'SERVICE_UNAVAILABLE',
          message:
            `Dịch vụ Google Gemini đang tạm thời gián đoạn (HTTP ${res.status}: ${errorMsg}).`,
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
        model,
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

/**
 * Thực hiện truy vấn Gemini API để phân tích dữ liệu kinh doanh / kho bãi
 * Tích hợp cơ chế tự động chuyển model dự phòng (fallback) nếu gặp lỗi 5xx hoặc nghẽn mạng (OBS-04)
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

  // Nếu không truyền model, thực hiện thăm dò hoặc lấy model mặc định từ cache
  let modelToUse = options.model
  let availableModels: string[] = []

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
    availableModels = verification.availableModels || []
  }

  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
  const systemInstruction = options.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION
  const fullUserPrompt = `[NGỮ CẢNH DỮ LIỆU QUẢN TRỊ E VIBE]\n${options.context}\n\n[CÂU HỎI CỦA QUẢN TRỊ VIÊN]\n${options.prompt}`

  // Lần thử 1 với model ưu tiên
  const initialResult = await callGeminiGenerateContent(
    modelToUse,
    apiKey,
    fullUserPrompt,
    systemInstruction,
    timeoutMs,
    startTime
  )

  if (initialResult.success) {
    return initialResult
  }

  // Tự động chuyển model dự phòng nếu gặp lỗi 5xx từ máy chủ Google (OBS-04)
  const isRetryable = initialResult.errorType === 'SERVICE_UNAVAILABLE'

  if (isRetryable) {
    const fallbackCandidates = PREFERRED_MODELS.filter((m) => m !== modelToUse)
    const fallbackModel =
      availableModels.length > 0
        ? fallbackCandidates.find((m) => availableModels.includes(m))
        : fallbackCandidates[0]

    if (fallbackModel) {
      const fallbackResult = await callGeminiGenerateContent(
        fallbackModel,
        apiKey,
        fullUserPrompt,
        systemInstruction,
        timeoutMs,
        startTime
      )

      if (fallbackResult.success) {
        return fallbackResult
      }
    }
  }

  return initialResult
}
