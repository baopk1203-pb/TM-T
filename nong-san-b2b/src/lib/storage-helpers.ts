export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg',
]

// Giới hạn kích thước ảnh tối đa 4MB (4.000.000 bytes) theo DEV-TASK-36B (phù hợp trần Vercel 4.5MB)
export const MAX_FILE_SIZE = 4_000_000 // 4.000.000 bytes

export const MAX_PHOTOS_PER_COMPLAINT = 5

export type SupportedImageType = 'image/jpeg' | 'image/png' | 'image/webp'

export interface ImageDetectionResult {
  mime: SupportedImageType
  extension: '.jpg' | '.png' | '.webp'
}

// Biểu thức chính quy kiểm tra định dạng key ảnh khiếu nại: complaints/{orderId}/{filename}
export const COMPLAINT_PHOTO_KEY_REGEX = /^complaints\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/

/**
 * Kiểm tra tính hợp lệ của key ảnh khiếu nại
 */
export function isValidComplaintPhotoKey(key: string): boolean {
  if (!key || typeof key !== 'string') return false
  return COMPLAINT_PHOTO_KEY_REGEX.test(key)
}

/**
 * Phân tích key ảnh khiếu nại thành { orderId, filename }
 */
export function parseComplaintPhotoKey(key: string): { orderId: string; filename: string } | null {
  const match = COMPLAINT_PHOTO_KEY_REGEX.exec(key)
  if (!match) return null
  return {
    orderId: match[1],
    filename: match[2],
  }
}

/**
 * Chuyển đổi key ảnh sang URL truy cập qua authenticated route
 */
export function getComplaintPhotoUrl(key: string): string {
  if (!key || typeof key !== 'string') return ''
  if (key.startsWith('/api/complaints/photos') || key.startsWith('/uploads/') || key.startsWith('http://') || key.startsWith('https://')) {
    return key
  }
  return `/api/complaints/photos?key=${encodeURIComponent(key)}`
}

/**
 * Sinh key lưu trữ duy nhất và an toàn cho ảnh khiếu nại
 */
export function generateComplaintPhotoKey(orderId: string, extension: string): string {
  // Thay thế bằng crypto API chuẩn Web / Node
  const randomSuffix = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 15)
  const safeFilename = `${Date.now()}-${randomSuffix}${extension}`
  return `complaints/${orderId}/${safeFilename}`
}
