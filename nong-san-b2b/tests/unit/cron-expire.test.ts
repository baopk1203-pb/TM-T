import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GET, POST } from '@/app/api/cron/expire-orders/route'
import { processExpiredOrders } from '@/lib/services/order-expiration'
import { NextRequest } from 'next/server'

vi.mock('@/lib/services/order-expiration', () => ({
  processExpiredOrders: vi.fn(),
}))

describe('Cron API Route: /api/cron/expire-orders (SRC-SEC-05)', () => {
  const originalCronSecret = process.env.CRON_SECRET
  const testSecret = 'test-cron-secret-123456'

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = testSecret
  })

  afterEach(() => {
    if (originalCronSecret !== undefined) {
      process.env.CRON_SECRET = originalCronSecret
    } else {
      delete process.env.CRON_SECRET
    }
  })

  it('1. Fail-closed: Từ chối với status 401 khi CRON_SECRET chưa được cấu hình trên server', async () => {
    delete process.env.CRON_SECRET

    const req = new NextRequest('http://localhost:3000/api/cron/expire-orders', {
      method: 'GET',
      headers: { authorization: `Bearer ${testSecret}` },
    })

    const res = await GET(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error).toContain('CRON_SECRET is not configured')
    expect(processExpiredOrders).not.toHaveBeenCalled()
  })

  it('2. Từ chối với status 401 khi request thiếu header Authorization', async () => {
    const req = new NextRequest('http://localhost:3000/api/cron/expire-orders', {
      method: 'GET',
    })

    const res = await GET(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error).toContain('Invalid CRON_SECRET')
    expect(processExpiredOrders).not.toHaveBeenCalled()
  })

  it('3. Từ chối với status 401 khi Bearer token không khớp', async () => {
    const req = new NextRequest('http://localhost:3000/api/cron/expire-orders', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-secret-token' },
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error).toContain('Invalid CRON_SECRET')
    expect(processExpiredOrders).not.toHaveBeenCalled()
  })

  it('4. Chấp thuận và thực thi thành công khi truyền đúng Bearer token', async () => {
    vi.mocked(processExpiredOrders).mockResolvedValue({
      success: true,
      expiredCount: 3,
    })

    const req = new NextRequest('http://localhost:3000/api/cron/expire-orders', {
      method: 'POST',
      headers: { authorization: `Bearer ${testSecret}` },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.expiredCount).toBe(3)
    expect(processExpiredOrders).toHaveBeenCalledTimes(1)
  })
})
