/**
 * F03 — GEMINI AI INTEGRATION TYPES
 * E Vibe — Nông Sản B2B
 */

export type GeminiErrorCode =
  | 'MISSING_API_KEY'
  | 'INVALID_API_KEY'
  | 'QUOTA_EXCEEDED'
  | 'MODEL_ACCESS_DENIED'
  | 'TIMEOUT_OR_NETWORK'
  | 'SERVICE_UNAVAILABLE'
  | 'UNKNOWN_ERROR'

export interface ModelVerificationResult {
  ok: boolean
  activeModel?: string
  availableModels?: string[]
  errorType?: GeminiErrorCode
  message?: string
}

export interface GeminiQueryResult {
  success: boolean
  answer?: string
  errorType?: GeminiErrorCode
  message?: string
  metadata?: {
    model: string
    timestamp: string
    processingTimeMs: number
  }
}

export interface AdminAiQueryPayload {
  query: string
}

export interface AdminAiStatus {
  configured: boolean
  activeModel?: string
  statusMessage: string
  errorType?: GeminiErrorCode
}
