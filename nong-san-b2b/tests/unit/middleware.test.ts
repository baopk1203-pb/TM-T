import { describe, it, expect, vi, beforeEach } from 'vitest'
import { middleware } from '@/middleware'
import { NextRequest } from 'next/server'
import { getToken, type JWT } from 'next-auth/jwt'
import { getAuthSecret } from '@/lib/auth-config'
import { Role } from '@prisma/client'

vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn(),
}))

vi.mock('@/lib/auth-config', () => ({
  getAuthSecret: vi.fn(),
}))

describe('Next.js Middleware: Authentication & RBAC (SRC-CONF-01 & SRC-SEC-06)', () => {
  const dummySecret = 'test-middleware-secret-key-123'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAuthSecret).mockReturnValue(dummySecret)
  })

  it('1. Cho phép truy cập tự do với các route công khai (không thuộc matcher)', async () => {
    const req = new NextRequest('http://localhost:3000/san-pham')
    const res = await middleware(req)

    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
    expect(res.status).toBe(200)
    expect(getToken).not.toHaveBeenCalled()
  })

  it('2. Chuyển hướng về /dang-nhap khi truy cập /tai-khoan mà chưa đăng nhập', async () => {
    vi.mocked(getToken).mockResolvedValue(null)

    const req = new NextRequest('http://localhost:3000/tai-khoan/don-hang')
    const res = await middleware(req)

    expect(res.status).toBe(307)
    const location = res.headers.get('location')
    expect(location).toContain('/dang-nhap')
    expect(location).toContain('callbackUrl=%2Ftai-khoan%2Fdon-hang')
    expect(getToken).toHaveBeenCalledWith({ req, secret: dummySecret })
  })

  it('3. Cho phép truy cập /tai-khoan khi đã có token người dùng hợp lệ', async () => {
    const customerToken: JWT = {
      id: 'user-1',
      role: Role.CUSTOMER,
      email: 'customer@example.com',
      groupId: null,
      discountPercent: 0,
    }
    vi.mocked(getToken).mockResolvedValue(customerToken)

    const req = new NextRequest('http://localhost:3000/tai-khoan/don-hang')
    const res = await middleware(req)

    expect(res.status).toBe(200)
  })

  it('4. Chuyển hướng về /dang-nhap khi truy cập /admin mà chưa có token', async () => {
    vi.mocked(getToken).mockResolvedValue(null)

    const req = new NextRequest('http://localhost:3000/admin/don-hang')
    const res = await middleware(req)

    expect(res.status).toBe(307)
    const location = res.headers.get('location')
    expect(location).toContain('/dang-nhap')
    expect(location).toContain('callbackUrl=%2Fadmin%2Fdon-hang')
  })

  it('5. Chặn người dùng có role CUSTOMER truy cập /admin -> chuyển hướng về trang chủ /', async () => {
    const customerToken: JWT = {
      id: 'user-customer',
      role: Role.CUSTOMER,
      groupId: null,
      discountPercent: 0,
    }
    vi.mocked(getToken).mockResolvedValue(customerToken)

    const req = new NextRequest('http://localhost:3000/admin/don-hang')
    const res = await middleware(req)

    expect(res.status).toBe(307)
    const location = res.headers.get('location')
    expect(location).toBe('http://localhost:3000/')
  })

  it('6. Cho phép truy cập /admin khi có token hợp lệ với role ADMIN', async () => {
    const adminToken: JWT = {
      id: 'admin-1',
      role: Role.ADMIN,
      groupId: null,
      discountPercent: 0,
    }
    vi.mocked(getToken).mockResolvedValue(adminToken)

    const req = new NextRequest('http://localhost:3000/admin/don-hang')
    const res = await middleware(req)

    expect(res.status).toBe(200)
  })

  it('7. Fail-closed: Khi getAuthSecret() ném lỗi (thiếu secret), từ chối truy cập và chuyển hướng về /dang-nhap', async () => {
    vi.mocked(getAuthSecret).mockImplementation(() => {
      throw new Error('Authentication secret is not configured')
    })

    const req = new NextRequest('http://localhost:3000/admin')
    const res = await middleware(req)

    expect(res.status).toBe(307)
    const location = res.headers.get('location')
    expect(location).toContain('/dang-nhap')
    expect(getToken).not.toHaveBeenCalled()
  })
})
