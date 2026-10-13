import path from 'path'
import fs from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'

export interface StorageService {
  saveUpload(file: File): Promise<string>
}

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg',
]
export const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

/**
 * Lưu file upload vào thư mục public/uploads trên đĩa cứng
 * Validate mime type (jpg, png, webp) và dung lượng <= 5MB
 */
export async function saveUpload(file: File): Promise<string> {
  if (!file) {
    throw new Error('Không tìm thấy file để tải lên')
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type.toLowerCase())) {
    throw new Error('Chỉ chấp nhận file ảnh định dạng JPG, PNG hoặc WebP')
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error('Kích thước ảnh tối đa cho phép là 5MB')
  }

  const uploadDir = path.join(process.cwd(), 'public', 'uploads')
  if (!existsSync(uploadDir)) {
    mkdirSync(uploadDir, { recursive: true })
  }

  const originalExt = path.extname(file.name).toLowerCase()
  const extension =
    originalExt ||
    (file.type === 'image/png'
      ? '.png'
      : file.type === 'image/webp'
      ? '.webp'
      : '.jpg')

  const timestamp = Date.now()
  const randomStr = Math.random().toString(36).substring(2, 8)
  const filename = `${timestamp}-${randomStr}${extension}`
  const filePath = path.join(uploadDir, filename)

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  await fs.writeFile(filePath, buffer)

  return `/uploads/${filename}`
}
