import path from 'path'
import fs from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import crypto from 'crypto'

export interface StorageService {
  saveUpload(file: File, options?: { uploadDir?: string }): Promise<string>
}

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg',
]
export const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

export type SupportedImageType = 'image/jpeg' | 'image/png' | 'image/webp'

export interface ImageDetectionResult {
  mime: SupportedImageType
  extension: '.jpg' | '.png' | '.webp'
}

/**
 * Xác minh chữ ký file thực tế (Magic bytes / file signatures)
 * Tuyệt đối không tin tưởng MIME type hoặc extension do client gửi lên (SRC-SEC-04)
 */
export function detectImageSignature(buffer: Buffer): ImageDetectionResult | null {
  if (!buffer || buffer.length < 12) {
    return null
  }

  // 1. JPEG / JPG: Bắt đầu bằng 3 byte FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', extension: '.jpg' }
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: 'image/png', extension: '.png' }
  }

  // 3. WebP: RIFF (bytes 0..3) và WEBP (bytes 8..11)
  const isRiff =
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46
  const isWebp =
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50 // P

  if (isRiff && isWebp) {
    return { mime: 'image/webp', extension: '.webp' }
  }

  return null
}

/**
 * Lưu file upload vào thư mục lưu trữ (mặc định public/uploads)
 * - Kiểm tra dung lượng tối đa 5MB
 * - Xác minh Magic bytes thực tế (JPEG, PNG, WebP)
 * - Sinh tên file an toàn bằng crypto.randomUUID() chống Path Traversal và ghi đè
 * - Cho phép truyền options.uploadDir để unit tests chạy trong thư mục tạm cô lập
 */
export async function saveUpload(
  file: File,
  options?: { uploadDir?: string }
): Promise<string> {
  if (!file) {
    throw new Error('Không tìm thấy file để tải lên')
  }

  if (file.size <= 0) {
    throw new Error('File tải lên không có dữ liệu')
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error('Kích thước ảnh tối đa cho phép là 5MB')
  }

  // Đọc buffer dữ liệu
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Kiểm tra chữ ký file thực tế (Magic bytes)
  const detected = detectImageSignature(buffer)
  if (!detected) {
    throw new Error('Định dạng nội dung file không hợp lệ. Chỉ chấp nhận file ảnh JPG, PNG hoặc WebP thực tế')
  }

  // Nếu client có khai báo file.type, cũng phải khớp với danh sách cho phép
  if (file.type && !ALLOWED_MIME_TYPES.includes(file.type.toLowerCase())) {
    throw new Error('Chỉ chấp nhận file ảnh định dạng JPG, PNG hoặc WebP')
  }

  const uploadDir = options?.uploadDir || path.join(process.cwd(), 'public', 'uploads')
  if (!existsSync(/*turbopackIgnore: true*/ uploadDir)) {
    mkdirSync(/*turbopackIgnore: true*/ uploadDir, { recursive: true })
  }

  // Sinh tên file ngẫu nhiên an toàn bằng UUID, phần mở rộng gán theo Magic Bytes đã phát hiện
  const uniqueId = crypto.randomUUID()
  const filename = `${Date.now()}-${uniqueId}${detected.extension}`
  const filePath = path.join(uploadDir, filename)

  // Kiểm tra chống Path Traversal
  const resolvedFilePath = path.resolve(filePath)
  const resolvedUploadDir = path.resolve(/*turbopackIgnore: true*/ uploadDir)
  if (!resolvedFilePath.startsWith(resolvedUploadDir)) {
    throw new Error('Đường dẫn file không hợp lệ (Path Traversal detected)')
  }

  await fs.writeFile(filePath, buffer)

  return `/uploads/${filename}`
}
