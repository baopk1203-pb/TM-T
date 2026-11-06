import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { Session } from 'next-auth'
import {
  saveComplaintPhoto,
  getComplaintPhoto,
  hasBlobCredentials,
  MAX_FILE_SIZE,
  parseComplaintPhotoKey,
  isValidComplaintPhotoKey,
  getComplaintPhotoUrl,
} from '@/lib/storage'
import { canTransition } from '@/lib/domain/order-state'
import { OrderStatus, Role } from '@prisma/client'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

// Mock @vercel/blob SDK for unit testing OIDC, Legacy and Fail-closed mechanisms
const { mockBlobPut, mockBlobGet } = vi.hoisted(() => ({
  mockBlobPut: vi.fn(),
  mockBlobGet: vi.fn(),
}))

vi.mock('@vercel/blob', () => ({
  put: mockBlobPut,
  get: mockBlobGet,
}))

// Mock session and DB for route testing
vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    order: {
      findUnique: vi.fn(),
    },
    complaint: {
      create: vi.fn(),
    },
    $transaction: vi.fn((cb) => cb({
      complaint: { create: vi.fn().mockResolvedValue({ id: 'c-1' }) },
      order: { update: vi.fn() },
      orderEvent: { create: vi.fn() },
    })),
  },
}))

describe('DEV-TASK-36B: Complaint Private Blob Storage & Security Gates', () => {
  let tempUploadDir: string
  const validOrderId = 'order-test-123'

  // Chữ ký Magic Bytes hợp lệ
  const validJpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
  const validPngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
  const validWebpBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])

  function createMockFile(buffer: Buffer, name: string, type: string): File {
    return new File([new Uint8Array(buffer)], name, { type })
  }

  beforeEach(async () => {
    tempUploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'b2b-blob-test-'))
    vi.clearAllMocks()
  })

  afterEach(async () => {
    try {
      await fs.rm(tempUploadDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
    delete process.env.VERCEL
    delete process.env.BLOB_READ_WRITE_TOKEN
    delete process.env.BLOB_STORE_ID
    delete process.env.VERCEL_OIDC_TOKEN
  })

  describe('1. Storage Service (saveComplaintPhoto & getComplaintPhoto)', () => {
    it('1.1 Tải lên ảnh JPEG hợp lệ thành công và trả về URL authenticated route an toàn', async () => {
      const file = createMockFile(validJpegBytes, 'damage.jpg', 'image/jpeg')
      const result = await saveComplaintPhoto(file, { orderId: validOrderId }, { uploadDir: tempUploadDir })

      expect(result.key).toMatch(/^complaints\/order-test-123\/\d+-[a-f0-9-]+\.jpg$/)
      expect(result.url).toBe(`/api/complaints/photos?key=${encodeURIComponent(result.key)}`)
      expect(result.size).toBe(validJpegBytes.length)
      expect(result.contentType).toBe('image/jpeg')

      // Kiểm tra đọc lại ảnh
      const fetched = await getComplaintPhoto(result.key, { uploadDir: tempUploadDir })
      expect(fetched).not.toBeNull()
      expect(fetched?.contentType).toBe('image/jpeg')
      expect(fetched?.size).toBe(validJpegBytes.length)
    })

    it('1.2 Tải lên ảnh PNG và WebP hợp lệ thành công', async () => {
      const pngFile = createMockFile(validPngBytes, 'evidence.png', 'image/png')
      const pngResult = await saveComplaintPhoto(pngFile, { orderId: validOrderId }, { uploadDir: tempUploadDir })
      expect(pngResult.key).toMatch(/\.png$/)

      const webpFile = createMockFile(validWebpBytes, 'evidence.webp', 'image/webp')
      const webpResult = await saveComplaintPhoto(webpFile, { orderId: validOrderId }, { uploadDir: tempUploadDir })
      expect(webpResult.key).toMatch(/\.webp$/)
    })

    it('1.3 Từ chối file vượt quá giới hạn 4.000.000 bytes (4MB)', async () => {
      const largeBuffer = Buffer.alloc(MAX_FILE_SIZE + 100)
      validJpegBytes.copy(largeBuffer, 0, 0, validJpegBytes.length)
      const file = createMockFile(largeBuffer, 'large.jpg', 'image/jpeg')

      await expect(
        saveComplaintPhoto(file, { orderId: validOrderId }, { uploadDir: tempUploadDir })
      ).rejects.toThrow(/Kích thước ảnh tối đa cho phép là 4MB \(4\.000\.000 bytes\)/)
    })

    it('1.4 Từ chối file có MIME hoặc Magic bytes giả mạo', async () => {
      const fakeBuffer = Buffer.from('<script>alert("hacked")</script>')
      const disguisedFile = createMockFile(fakeBuffer, 'innocent.jpg', 'image/jpeg')

      await expect(
        saveComplaintPhoto(disguisedFile, { orderId: validOrderId }, { uploadDir: tempUploadDir })
      ).rejects.toThrow(/Định dạng nội dung file không hợp lệ/)
    })

    it('1.5 Chống Path Traversal trong filename người dùng (tự sinh UUID)', async () => {
      const file = createMockFile(validJpegBytes, '../../../etc/passwd.jpg', 'image/jpeg')
      const result = await saveComplaintPhoto(file, { orderId: validOrderId }, { uploadDir: tempUploadDir })

      expect(result.key).not.toContain('..')
      expect(result.key).not.toContain('passwd')
      expect(result.key).toMatch(/^complaints\/order-test-123\/\d+-[a-f0-9-]+\.jpg$/)
    })

    it('1.6 hasBlobCredentials() nhận diện chính xác cả OIDC, Legacy và Missing credentials', () => {
      // 1. Missing credentials
      delete process.env.BLOB_STORE_ID
      delete process.env.BLOB_READ_WRITE_TOKEN
      expect(hasBlobCredentials()).toBe(false)

      // 2. OIDC (BLOB_STORE_ID)
      process.env.BLOB_STORE_ID = 'blob_store_preview_123'
      expect(hasBlobCredentials()).toBe(true)
      delete process.env.BLOB_STORE_ID

      // 3. Legacy (BLOB_READ_WRITE_TOKEN)
      process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test_token'
      expect(hasBlobCredentials()).toBe(true)
      delete process.env.BLOB_READ_WRITE_TOKEN

      // 4. Options token
      expect(hasBlobCredentials({ blobToken: 'manual_token' })).toBe(true)
    })

    it('1.7 DEV-TASK-42: Vercel Blob OIDC Mode — Tự động dùng OIDC khi có BLOB_STORE_ID, không truyền token thủ công cho SDK', async () => {
      process.env.BLOB_STORE_ID = 'store_preview_oidc_123'
      delete process.env.BLOB_READ_WRITE_TOKEN

      mockBlobPut.mockResolvedValueOnce({
        pathname: 'complaints/order-test-123/123456-abc.jpg',
        contentType: 'image/jpeg',
      })

      const file = createMockFile(validJpegBytes, 'damage.jpg', 'image/jpeg')
      const result = await saveComplaintPhoto(file, { orderId: validOrderId })

      // Xác nhận gọi put với private access và KHÔNG truyền token thủ công
      expect(mockBlobPut).toHaveBeenCalledTimes(1)
      const [calledKey, , calledOptions] = mockBlobPut.mock.calls[0]
      expect(calledKey).toMatch(/^complaints\/order-test-123\/\d+-[a-f0-9-]+\.jpg$/)
      expect(calledOptions.access).toBe('private')
      expect(calledOptions.contentType).toBe('image/jpeg')
      expect(calledOptions.token).toBeUndefined() // KHÔNG truyền token thủ công

      expect(result.key).toBe('complaints/order-test-123/123456-abc.jpg')
      expect(result.url).toBe(`/api/complaints/photos?key=${encodeURIComponent('complaints/order-test-123/123456-abc.jpg')}`)

      // Kiểm tra getComplaintPhoto trong OIDC Mode
      mockBlobGet.mockResolvedValueOnce({
        statusCode: 200,
        stream: Buffer.from(validJpegBytes),
        blob: { contentType: 'image/jpeg', size: validJpegBytes.length },
      })

      const fetched = await getComplaintPhoto(result.key)
      expect(mockBlobGet).toHaveBeenCalledTimes(1)
      const [getKey, getOptions] = mockBlobGet.mock.calls[0]
      expect(getKey).toBe(result.key)
      expect(getOptions.access).toBe('private')
      expect(getOptions.token).toBeUndefined() // KHÔNG truyền token thủ công
      expect(fetched).not.toBeNull()
      expect(fetched?.contentType).toBe('image/jpeg')
    })

    it('1.8 DEV-TASK-42: Legacy Mode — Sử dụng BLOB_READ_WRITE_TOKEN tĩnh khi được cấu hình', async () => {
      process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_static_token_456'
      delete process.env.BLOB_STORE_ID

      mockBlobPut.mockResolvedValueOnce({
        pathname: 'complaints/order-test-123/legacy-file.png',
        contentType: 'image/png',
      })

      const file = createMockFile(validPngBytes, 'evidence.png', 'image/png')
      const result = await saveComplaintPhoto(file, { orderId: validOrderId })

      expect(mockBlobPut).toHaveBeenCalledTimes(1)
      const [, , calledOptions] = mockBlobPut.mock.calls[0]
      expect(calledOptions.access).toBe('private')
      expect(calledOptions.token).toBe('vercel_blob_rw_static_token_456') // Có truyền token legacy

      expect(result.key).toBe('complaints/order-test-123/legacy-file.png')

      // Kiểm tra getComplaintPhoto trong Legacy Mode
      mockBlobGet.mockResolvedValueOnce({
        statusCode: 200,
        stream: Buffer.from(validPngBytes),
        blob: { contentType: 'image/png', size: validPngBytes.length },
      })

      const fetched = await getComplaintPhoto(result.key)
      expect(mockBlobGet).toHaveBeenCalledTimes(1)
      const [, getOptions] = mockBlobGet.mock.calls[0]
      expect(getOptions.access).toBe('private')
      expect(getOptions.token).toBe('vercel_blob_rw_static_token_456')
      expect(fetched).not.toBeNull()
    })

    it('1.9 DEV-TASK-42: Fail-Closed trên Vercel khi thiếu cả OIDC và Legacy token -> Báo lỗi, không fallback sang disk', async () => {
      process.env.VERCEL = '1'
      delete process.env.BLOB_STORE_ID
      delete process.env.BLOB_READ_WRITE_TOKEN

      const file = createMockFile(validJpegBytes, 'photo.jpg', 'image/jpeg')
      await expect(
        saveComplaintPhoto(file, { orderId: validOrderId })
      ).rejects.toThrow(/Dịch vụ lưu trữ Vercel Blob chưa được cấu hình/)

      const fetched = await getComplaintPhoto('complaints/order-test-123/some-key.jpg')
      expect(fetched).toBeNull()
      expect(mockBlobPut).not.toHaveBeenCalled()
      expect(mockBlobGet).not.toHaveBeenCalled()
    })

    it('1.7 Parse key, Validate key và generate URL chính xác', () => {
      expect(isValidComplaintPhotoKey('complaints/order-1/123-abc.jpg')).toBe(true)
      expect(isValidComplaintPhotoKey('uploads/test.jpg')).toBe(false)
      expect(isValidComplaintPhotoKey('../../../etc/passwd')).toBe(false)

      const parsed = parseComplaintPhotoKey('complaints/order-999/456-def.png')
      expect(parsed).toEqual({ orderId: 'order-999', filename: '456-def.png' })
      expect(parseComplaintPhotoKey('invalid-key')).toBeNull()

      expect(getComplaintPhotoUrl('complaints/o-1/p.jpg')).toBe('/api/complaints/photos?key=complaints%2Fo-1%2Fp.jpg')
      expect(getComplaintPhotoUrl('/api/complaints/photos?key=test')).toBe('/api/complaints/photos?key=test')
    })
  })

  describe('2. Upload Route Security (/api/upload)', () => {
    it('2.1 Từ chối yêu cầu upload khi chưa đăng nhập (401)', async () => {
      const { getServerAuthSession } = await import('@/lib/auth')
      vi.mocked(getServerAuthSession).mockResolvedValueOnce(null)

      const { POST } = await import('@/app/api/upload/route')
      const formData = new FormData()
      formData.append('orderId', validOrderId)
      formData.append('file', createMockFile(validJpegBytes, 'p.jpg', 'image/jpeg'))

      const req = new NextRequest('http://localhost/api/upload', {
        method: 'POST',
        body: formData,
      })

      const res = await POST(req)
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data.error).toContain('Vui lòng đăng nhập')
    })

    it('2.2 Từ chối khi thiếu tham số orderId (400)', async () => {
      const { getServerAuthSession } = await import('@/lib/auth')
      vi.mocked(getServerAuthSession).mockResolvedValueOnce({
        user: { id: 'user-1', role: Role.CUSTOMER },
      } as unknown as Session)

      const { POST } = await import('@/app/api/upload/route')
      const formData = new FormData()
      formData.append('file', createMockFile(validJpegBytes, 'p.jpg', 'image/jpeg'))

      const req = new NextRequest('http://localhost/api/upload', {
        method: 'POST',
        body: formData,
      })

      const res = await POST(req)
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toContain('Thiếu thông tin đơn hàng')
    })

    it('2.3 Từ chối khi người dùng không sở hữu đơn hàng (403)', async () => {
      const { getServerAuthSession } = await import('@/lib/auth')
      vi.mocked(getServerAuthSession).mockResolvedValueOnce({
        user: { id: 'other-user', role: Role.CUSTOMER },
      } as unknown as Session)

      const { db } = await import('@/lib/db')
      vi.mocked(db.order.findUnique).mockResolvedValueOnce({
        id: validOrderId,
        userId: 'original-owner',
        status: OrderStatus.DELIVERED,
        deliveredAt: new Date(),
      } as unknown as Awaited<ReturnType<typeof db.order.findUnique>>)

      const { POST } = await import('@/app/api/upload/route')
      const formData = new FormData()
      formData.append('orderId', validOrderId)
      formData.append('file', createMockFile(validJpegBytes, 'p.jpg', 'image/jpeg'))

      const req = new NextRequest('http://localhost/api/upload', {
        method: 'POST',
        body: formData,
      })

      const res = await POST(req)
      expect(res.status).toBe(403)
      const data = await res.json()
      expect(data.error).toContain('Bạn không có quyền tải ảnh khiếu nại')
    })

    it('2.4 Từ chối khi đơn hàng chưa giao (chưa ở trạng thái DELIVERED hoặc COMPLETED)', async () => {
      const { getServerAuthSession } = await import('@/lib/auth')
      vi.mocked(getServerAuthSession).mockResolvedValueOnce({
        user: { id: 'user-1', role: Role.CUSTOMER },
      } as unknown as Session)

      const { db } = await import('@/lib/db')
      vi.mocked(db.order.findUnique).mockResolvedValueOnce({
        id: validOrderId,
        userId: 'user-1',
        status: OrderStatus.SHIPPING, // Chưa giao
        deliveredAt: null,
      } as unknown as Awaited<ReturnType<typeof db.order.findUnique>>)

      const { POST } = await import('@/app/api/upload/route')
      const formData = new FormData()
      formData.append('orderId', validOrderId)
      formData.append('file', createMockFile(validJpegBytes, 'p.jpg', 'image/jpeg'))

      const req = new NextRequest('http://localhost/api/upload', {
        method: 'POST',
        body: formData,
      })

      const res = await POST(req)
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toContain('không đủ điều kiện khiếu nại')
    })

    it('2.5 Từ chối khi đơn hàng đã quá thời hạn khiếu nại 24h kể từ deliveredAt', async () => {
      const { getServerAuthSession } = await import('@/lib/auth')
      vi.mocked(getServerAuthSession).mockResolvedValueOnce({
        user: { id: 'user-1', role: Role.CUSTOMER },
      } as unknown as Session)

      const { db } = await import('@/lib/db')
      const delivered25HoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000)
      vi.mocked(db.order.findUnique).mockResolvedValueOnce({
        id: validOrderId,
        userId: 'user-1',
        status: OrderStatus.DELIVERED,
        deliveredAt: delivered25HoursAgo,
      } as unknown as Awaited<ReturnType<typeof db.order.findUnique>>)

      const { POST } = await import('@/app/api/upload/route')
      const formData = new FormData()
      formData.append('orderId', validOrderId)
      formData.append('file', createMockFile(validJpegBytes, 'p.jpg', 'image/jpeg'))

      const req = new NextRequest('http://localhost/api/upload', {
        method: 'POST',
        body: formData,
      })

      const res = await POST(req)
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toContain('Đã quá thời hạn khiếu nại 24 giờ')
    })
  })

  describe('3. Authenticated Delivery Route (/api/complaints/photos)', () => {
    it('3.1 Từ chối người dùng chưa đăng nhập (401)', async () => {
      const { getServerAuthSession } = await import('@/lib/auth')
      vi.mocked(getServerAuthSession).mockResolvedValueOnce(null)

      const { GET } = await import('@/app/api/complaints/photos/route')
      const req = new NextRequest('http://localhost/api/complaints/photos?key=complaints/order-1/1.jpg')
      const res = await GET(req)

      expect(res.status).toBe(401)
    })

    it('3.2 Từ chối khi định dạng key không hợp lệ hoặc thiếu key (400)', async () => {
      const { getServerAuthSession } = await import('@/lib/auth')
      vi.mocked(getServerAuthSession).mockResolvedValueOnce({
        user: { id: 'user-1', role: Role.CUSTOMER },
      } as unknown as Session)

      const { GET } = await import('@/app/api/complaints/photos/route')
      const req = new NextRequest('http://localhost/api/complaints/photos?key=invalid_key')
      const res = await GET(req)

      expect(res.status).toBe(400)
    })

    it('3.3 Khách hàng khác không thể xem ảnh của đơn hàng không thuộc về mình (403)', async () => {
      const { getServerAuthSession } = await import('@/lib/auth')
      vi.mocked(getServerAuthSession).mockResolvedValueOnce({
        user: { id: 'attacker-user', role: Role.CUSTOMER },
      } as unknown as Session)

      const { db } = await import('@/lib/db')
      vi.mocked(db.order.findUnique).mockResolvedValueOnce({
        id: 'victim-order',
        userId: 'victim-user',
      } as unknown as Awaited<ReturnType<typeof db.order.findUnique>>)

      const { GET } = await import('@/app/api/complaints/photos/route')
      const req = new NextRequest('http://localhost/api/complaints/photos?key=complaints/victim-order/photo.jpg')
      const res = await GET(req)

      expect(res.status).toBe(403)
    })

    it('3.4 Admin có quyền xem ảnh của bất kỳ đơn hàng nào', async () => {
      const { getServerAuthSession } = await import('@/lib/auth')
      vi.mocked(getServerAuthSession).mockResolvedValueOnce({
        user: { id: 'admin-user', role: Role.ADMIN },
      } as unknown as Session)

      const { db } = await import('@/lib/db')
      vi.mocked(db.order.findUnique).mockResolvedValueOnce({
        id: 'order-1',
        userId: 'customer-1',
      } as unknown as Awaited<ReturnType<typeof db.order.findUnique>>)

      // Lưu file vào mock local storage
      const file = createMockFile(validJpegBytes, 'photo.jpg', 'image/jpeg')
      const uploadRes = await saveComplaintPhoto(file, { orderId: 'order-1' })

      const { GET } = await import('@/app/api/complaints/photos/route')
      const req = new NextRequest(`http://localhost/api/complaints/photos?key=${encodeURIComponent(uploadRes.key)}`)
      const res = await GET(req)

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('image/jpeg')
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(res.headers.get('Cache-Control')).toContain('private')
    })
  })

  describe('4. PH9-00 Compatibility & State Transition Guard', () => {
    it('4.1 Khách hàng được khiếu nại đơn đã COMPLETED trong vòng 24 giờ sau deliveredAt', () => {
      const delivered2HoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
      const order = {
        status: OrderStatus.COMPLETED,
        paymentOption: 'FULL' as const,
        total: 1000000,
        depositAmount: 1000000,
        deliveredAt: delivered2HoursAgo,
      }

      const check = canTransition(order, OrderStatus.COMPLAINT, 'CUSTOMER', {
        photosCount: 2,
        now: new Date(),
      })

      expect(check.ok).toBe(true)
    })

    it('4.2 Từ chối khiếu nại đơn đã COMPLETED nếu đã quá thời hạn 24 giờ', () => {
      const delivered26HoursAgo = new Date(Date.now() - 26 * 60 * 60 * 1000)
      const order = {
        status: OrderStatus.COMPLETED,
        paymentOption: 'FULL' as const,
        total: 1000000,
        depositAmount: 1000000,
        deliveredAt: delivered26HoursAgo,
      }

      const check = canTransition(order, OrderStatus.COMPLAINT, 'CUSTOMER', {
        photosCount: 1,
        now: new Date(),
      })

      expect(check.ok).toBe(false)
      expect(check.reason).toContain('Đã quá thời hạn khiếu nại 24h')
    })

    it('4.3 Từ chối khiếu nại khi không đính kèm ít nhất 1 ảnh minh chứng', () => {
      const delivered1HourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000)
      const order = {
        status: OrderStatus.COMPLETED,
        paymentOption: 'FULL' as const,
        total: 1000000,
        depositAmount: 1000000,
        deliveredAt: delivered1HourAgo,
      }

      const check = canTransition(order, OrderStatus.COMPLAINT, 'CUSTOMER', {
        photosCount: 0,
        now: new Date(),
      })

      expect(check.ok).toBe(false)
      expect(check.reason).toContain('Khiếu nại phải kèm theo ít nhất 1 hình ảnh')
    })
  })
})
