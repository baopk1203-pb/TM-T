import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { saveUpload, detectImageSignature, MAX_FILE_SIZE } from '@/lib/storage'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

describe('SRC-SEC-04: File Upload Security & Magic Bytes Validation', () => {
  let tempUploadDir: string

  beforeEach(async () => {
    // Tạo thư mục tạm cô lập riêng cho mỗi test, tuyệt đối không ghi vào public/uploads
    tempUploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'b2b-upload-test-'))
  })

  afterEach(async () => {
    // Dọn dẹp thư mục tạm sau khi test xong
    try {
      await fs.rm(tempUploadDir, { recursive: true, force: true })
    } catch {
      // Bỏ qua lỗi dọn dẹp nếu có
    }
  })

  // Helper tạo mock File với Buffer bất kỳ
  function createMockFile(buffer: Buffer, name: string, type: string): File {
    return new File([new Uint8Array(buffer)], name, { type })
  }

  // Chữ ký Magic Bytes chuẩn
  const validJpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
  const validPngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
  // WebP: RIFF (4 bytes) + file length (4 bytes) + WEBP (4 bytes)
  const validWebpBytes = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x24, 0x00, 0x00, 0x00, // file length
    0x57, 0x45, 0x42, 0x50, // WEBP
  ])

  describe('detectImageSignature()', () => {
    it('1. Nhận diện chính xác file JPEG (FF D8 FF)', () => {
      const res = detectImageSignature(validJpegBytes)
      expect(res).not.toBeNull()
      expect(res?.mime).toBe('image/jpeg')
      expect(res?.extension).toBe('.jpg')
    })

    it('2. Nhận diện chính xác file PNG (89 50 4E 47 0D 0A 1A 0A)', () => {
      const res = detectImageSignature(validPngBytes)
      expect(res).not.toBeNull()
      expect(res?.mime).toBe('image/png')
      expect(res?.extension).toBe('.png')
    })

    it('3. Nhận diện chính xác file WebP (RIFF .... WEBP)', () => {
      const res = detectImageSignature(validWebpBytes)
      expect(res).not.toBeNull()
      expect(res?.mime).toBe('image/webp')
      expect(res?.extension).toBe('.webp')
    })

    it('4. Từ chối file text/HTML giả mạo (<script>alert(1)</script>)', () => {
      const fakeHtml = Buffer.from('<script>alert("xss")</script>')
      const res = detectImageSignature(fakeHtml)
      expect(res).toBeNull()
    })

    it('5. Từ chối file PDF (%PDF-1.4...)', () => {
      const fakePdf = Buffer.from('%PDF-1.4\n%âãÏÓ\n')
      const res = detectImageSignature(fakePdf)
      expect(res).toBeNull()
    })

    it('6. Từ chối file thực thi Windows EXE/DLL (MZ...)', () => {
      const fakeExe = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00')
      const res = detectImageSignature(fakeExe)
      expect(res).toBeNull()
    })
  })

  describe('saveUpload() Service', () => {
    it('1. Upload thành công file JPEG hợp lệ vào thư mục chỉ định', async () => {
      const file = createMockFile(validJpegBytes, 'photo.jpg', 'image/jpeg')
      const url = await saveUpload(file, { uploadDir: tempUploadDir })

      expect(url).toMatch(/^\/uploads\/\d+-[a-f0-9-]+\.jpg$/)
      const savedFilename = path.basename(url)
      const fileExists = await fs.stat(path.join(tempUploadDir, savedFilename))
      expect(fileExists.isFile()).toBe(true)
    })

    it('2. Upload thành công file PNG hợp lệ', async () => {
      const file = createMockFile(validPngBytes, 'evidence.png', 'image/png')
      const url = await saveUpload(file, { uploadDir: tempUploadDir })

      expect(url).toMatch(/^\/uploads\/\d+-[a-f0-9-]+\.png$/)
    })

    it('3. Upload thành công file WebP hợp lệ', async () => {
      const file = createMockFile(validWebpBytes, 'sample.webp', 'image/webp')
      const url = await saveUpload(file, { uploadDir: tempUploadDir })

      expect(url).toMatch(/^\/uploads\/\d+-[a-f0-9-]+\.webp$/)
    })

    it('4. Từ chối file HTML giả mạo Content-Type ảnh (Stored XSS attempt)', async () => {
      const maliciousBuffer = Buffer.from('<html><body><script>alert("attack")</script></body></html>')
      // Kẻ tấn công khai báo type image/png và tên safe.png nhưng nội dung là HTML
      const fakeFile = createMockFile(maliciousBuffer, 'safe.png', 'image/png')

      await expect(saveUpload(fakeFile, { uploadDir: tempUploadDir })).rejects.toThrow(
        /Định dạng nội dung file không hợp lệ/
      )
    })

    it('5. Từ chối file PDF hoặc EXE đổi đuôi thành .jpg', async () => {
      const fakePdf = Buffer.from('%PDF-1.4\nsome pdf binary data here')
      const disguisedFile = createMockFile(fakePdf, 'invoice.jpg', 'image/jpeg')

      await expect(saveUpload(disguisedFile, { uploadDir: tempUploadDir })).rejects.toThrow(
        /Định dạng nội dung file không hợp lệ/
      )
    })

    it('6. Từ chối file vượt quá kích thước tối đa cho phép', async () => {
      // Tạo file lớn hơn MAX_FILE_SIZE
      const largeBuffer = Buffer.alloc(MAX_FILE_SIZE + 1024)
      // Giả lập header JPEG ở đầu
      validJpegBytes.copy(largeBuffer, 0, 0, validJpegBytes.length)

      const largeFile = createMockFile(largeBuffer, 'large.jpg', 'image/jpeg')

      await expect(saveUpload(largeFile, { uploadDir: tempUploadDir })).rejects.toThrow(
        /Kích thước ảnh tối đa cho phép/
      )
    })

    it('7. Chống Path Traversal trong filename do client cung cấp', async () => {
      // Kẻ tấn công cố tình gửi tên file có ../../../evil.php
      const file = createMockFile(validJpegBytes, '../../../../etc/passwd.jpg', 'image/jpeg')
      const url = await saveUpload(file, { uploadDir: tempUploadDir })

      // File phải được lưu trong thư mục tempUploadDir với UUID ngẫu nhiên, không chứa ../
      expect(url).not.toContain('..')
      expect(url).not.toContain('passwd')
      expect(url).toMatch(/^\/uploads\/\d+-[a-f0-9-]+\.jpg$/)

      const savedFilename = path.basename(url)
      const savedPath = path.join(tempUploadDir, savedFilename)
      const stat = await fs.stat(savedPath)
      expect(stat.isFile()).toBe(true)
    })

    it('8. Từ chối file rỗng (0 bytes)', async () => {
      const emptyFile = createMockFile(Buffer.alloc(0), 'empty.jpg', 'image/jpeg')

      await expect(saveUpload(emptyFile, { uploadDir: tempUploadDir })).rejects.toThrow(
        /File tải lên không có dữ liệu/
      )
    })
  })
})
