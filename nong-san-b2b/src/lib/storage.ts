import path from 'path'
import fs from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  MAX_PHOTOS_PER_COMPLAINT,
  SupportedImageType,
  ImageDetectionResult,
  COMPLAINT_PHOTO_KEY_REGEX,
  isValidComplaintPhotoKey,
  parseComplaintPhotoKey,
  getComplaintPhotoUrl,
  generateComplaintPhotoKey,
} from './storage-helpers'

export {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  MAX_PHOTOS_PER_COMPLAINT,
  isValidComplaintPhotoKey,
  parseComplaintPhotoKey,
  getComplaintPhotoUrl,
  generateComplaintPhotoKey,
  COMPLAINT_PHOTO_KEY_REGEX,
}

export type { SupportedImageType, ImageDetectionResult }

export interface StorageService {
  saveUpload(file: File, options?: { uploadDir?: string }): Promise<string>
}

export interface SaveComplaintPhotoResult {
  url: string
  key: string
  size: number
  contentType: SupportedImageType
}

export interface ComplaintPhotoPayload {
  stream: ReadableStream<Uint8Array> | NodeJS.ReadableStream | Buffer
  contentType: string
  size?: number
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
 * Kiểm tra xem môi trường hiện tại có cấu hình thông tin xác thực Vercel Blob hay không
 * Hỗ trợ 2 cơ chế:
 * 1. OIDC mới: Có BLOB_STORE_ID (VERCEL_OIDC_TOKEN được runtime Vercel tự quản lý và SDK tự tìm)
 * 2. Legacy: Có BLOB_READ_WRITE_TOKEN hoặc options.blobToken được truyền vào
 */
export function hasBlobCredentials(options?: { blobToken?: string }): boolean {
  if (options?.blobToken && options.blobToken.trim().length > 0) {
    return true
  }
  if (process.env.BLOB_READ_WRITE_TOKEN && process.env.BLOB_READ_WRITE_TOKEN.trim().length > 0) {
    return true
  }
  if (process.env.BLOB_STORE_ID && process.env.BLOB_STORE_ID.trim().length > 0) {
    return true
  }
  return false
}

/**
 * Lưu ảnh khiếu nại vào Vercel Private Blob (hoặc local mock trong môi trường dev/test)
 * - Giới hạn tối đa 4.000.000 bytes
 * - Xác minh Magic bytes thực tế (JPEG, PNG, WebP)
 * - Tên file sinh ngẫu nhiên an toàn, cô lập theo orderId
 * - Sử dụng access: 'private'
 * - Hỗ trợ cả 2 cơ chế: Vercel OIDC (BLOB_STORE_ID) và Legacy token (BLOB_READ_WRITE_TOKEN)
 * - Không fallback âm thầm sang filesystem trên Vercel runtime
 */
export async function saveComplaintPhoto(
  file: File,
  context: { orderId: string },
  options?: {
    uploadDir?: string
    blobToken?: string
    forceLocalStorage?: boolean
  }
): Promise<SaveComplaintPhotoResult> {
  if (!file) {
    throw new Error('Không tìm thấy file để tải lên')
  }

  if (file.size <= 0) {
    throw new Error('File tải lên không có dữ liệu')
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error('Kích thước ảnh tối đa cho phép là 4MB (4.000.000 bytes)')
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

  const key = generateComplaintPhotoKey(context.orderId, detected.extension)
  const isVercelRuntime = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'
  const hasCreds = hasBlobCredentials(options)
  const shouldUseBlob = hasCreds && !options?.forceLocalStorage
  const explicitToken = options?.blobToken || process.env.BLOB_READ_WRITE_TOKEN

  // Trường hợp 1: Có cấu hình Vercel Blob (OIDC hoặc Legacy token)
  if (shouldUseBlob) {
    const { put } = await import('@vercel/blob')
    const putOptions: {
      access: 'private'
      contentType: string
      addRandomSuffix: boolean
      token?: string
    } = {
      access: 'private',
      contentType: detected.mime,
      addRandomSuffix: false,
    }
    // Chỉ truyền token khi dùng Legacy token (BLOB_READ_WRITE_TOKEN hoặc options.blobToken).
    // Nếu là cơ chế OIDC (BLOB_STORE_ID), KHÔNG truyền token và KHÔNG đọc VERCEL_OIDC_TOKEN,
    // để @vercel/blob SDK tự động xử lý OIDC và tự động làm mới token theo đúng khuyến nghị của Vercel.
    if (explicitToken && explicitToken.trim().length > 0) {
      putOptions.token = explicitToken.trim()
    }

    const blob = await put(key, buffer, putOptions)

    const storedKey = blob.pathname || key
    return {
      url: getComplaintPhotoUrl(storedKey),
      key: storedKey,
      size: buffer.length,
      contentType: detected.mime,
    }
  }

  // Trường hợp 2: Trên môi trường Vercel nhưng chưa cấu hình Blob (thiếu cả OIDC và Legacy) -> Báo lỗi an toàn, tuyệt đối không ghi đĩa
  if (isVercelRuntime && !options?.forceLocalStorage) {
    throw new Error('Dịch vụ lưu trữ Vercel Blob chưa được cấu hình. Vui lòng liên hệ ban quản trị.')
  }

  // Trường hợp 3: Local Development / Unit Tests mà không có Blob credentials -> Lưu vào thư mục mock local an toàn
  const baseDir = options?.uploadDir || path.join(process.cwd(), '.local-storage')
  const fullPath = path.join(/*turbopackIgnore: true*/ baseDir, key)
  const resolvedPath = path.resolve(/*turbopackIgnore: true*/ fullPath)
  const resolvedBaseDir = path.resolve(/*turbopackIgnore: true*/ baseDir)

  if (!resolvedPath.startsWith(resolvedBaseDir)) {
    throw new Error('Đường dẫn file không hợp lệ (Path Traversal detected)')
  }

  const dir = path.dirname(fullPath)
  if (!existsSync(/*turbopackIgnore: true*/ dir)) {
    mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true })
  }

  await fs.writeFile(/*turbopackIgnore: true*/ fullPath, buffer)

  return {
    url: getComplaintPhotoUrl(key),
    key,
    size: buffer.length,
    contentType: detected.mime,
  }
}

/**
 * Lấy dữ liệu ảnh khiếu nại từ Vercel Private Blob hoặc local mock storage
 */
export async function getComplaintPhoto(
  key: string,
  options?: {
    uploadDir?: string
    blobToken?: string
    forceLocalStorage?: boolean
  }
): Promise<ComplaintPhotoPayload | null> {
  const parsed = parseComplaintPhotoKey(key)
  if (!parsed) return null

  const isVercelRuntime = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'
  const hasCreds = hasBlobCredentials(options)
  const shouldUseBlob = hasCreds && !options?.forceLocalStorage
  const explicitToken = options?.blobToken || process.env.BLOB_READ_WRITE_TOKEN

  // Trường hợp 1: Truy xuất từ Vercel Private Blob (OIDC hoặc Legacy token)
  if (shouldUseBlob) {
    try {
      const { get } = await import('@vercel/blob')
      const getOptions: {
        access: 'private'
        token?: string
      } = {
        access: 'private',
      }
      if (explicitToken && explicitToken.trim().length > 0) {
        getOptions.token = explicitToken.trim()
      }

      const result = await get(key, getOptions)

      if (!result || result.statusCode !== 200 || !result.stream) {
        return null
      }

      return {
        stream: result.stream,
        contentType: result.blob.contentType || 'image/jpeg',
        size: result.blob.size,
      }
    } catch (err: unknown) {
      console.error('Error fetching private blob:', err)
      return null
    }
  }

  // Trường hợp 2: Trên Vercel nhưng thiếu credentials Blob -> Fail-closed, không fallback sang disk
  if (isVercelRuntime && !options?.forceLocalStorage) {
    return null
  }

  // Trường hợp 3: Local Development / Tests mock storage
  const baseDir = options?.uploadDir || path.join(process.cwd(), '.local-storage')
  const fullPath = path.join(/*turbopackIgnore: true*/ baseDir, key)
  const resolvedPath = path.resolve(/*turbopackIgnore: true*/ fullPath)
  const resolvedBaseDir = path.resolve(/*turbopackIgnore: true*/ baseDir)

  if (!resolvedPath.startsWith(resolvedBaseDir) || !existsSync(/*turbopackIgnore: true*/ fullPath)) {
    return null
  }

  const buffer = await fs.readFile(/*turbopackIgnore: true*/ fullPath)
  const detected = detectImageSignature(buffer)
  return {
    stream: buffer,
    contentType: detected?.mime || 'image/jpeg',
    size: buffer.length,
  }
}

/**
 * Hàm tương thích ngược dành cho các unit test và legacy upload
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
    throw new Error('Kích thước ảnh tối đa cho phép là 4MB (4.000.000 bytes)')
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const detected = detectImageSignature(buffer)
  if (!detected) {
    throw new Error('Định dạng nội dung file không hợp lệ. Chỉ chấp nhận file ảnh JPG, PNG hoặc WebP thực tế')
  }

  if (file.type && !ALLOWED_MIME_TYPES.includes(file.type.toLowerCase())) {
    throw new Error('Chỉ chấp nhận file ảnh định dạng JPG, PNG hoặc WebP')
  }

  const baseDir = options?.uploadDir || path.join(process.cwd(), 'public', 'uploads')
  const filename = `${Date.now()}-${crypto.randomUUID()}${detected.extension}`
  const filePath = path.join(/*turbopackIgnore: true*/ baseDir, filename)

  const resolvedFilePath = path.resolve(/*turbopackIgnore: true*/ filePath)
  const resolvedUploadDir = path.resolve(/*turbopackIgnore: true*/ baseDir)
  if (!resolvedFilePath.startsWith(resolvedUploadDir)) {
    throw new Error('Đường dẫn file không hợp lệ (Path Traversal detected)')
  }

  if (!existsSync(/*turbopackIgnore: true*/ baseDir)) {
    mkdirSync(/*turbopackIgnore: true*/ baseDir, { recursive: true })
  }

  await fs.writeFile(/*turbopackIgnore: true*/ filePath, buffer)
  return `/uploads/${filename}`
}
