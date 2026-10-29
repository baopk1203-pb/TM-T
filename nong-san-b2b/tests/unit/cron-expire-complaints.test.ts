import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/cron/expire-complaints/route'
import * as complaintSla from '@/lib/services/complaint-sla'

describe('CRON Endpoint: /api/cron/expire-complaints', () => {
  const originalEnv = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    process.env.CRON_SECRET = originalEnv
  })

  it('1. Từ chối 401 nếu CRON_SECRET chưa được cấu hình trên server (Fail-closed)', async () => {
    delete process.env.CRON_SECRET

    const req = new NextRequest('http://localhost:3000/api/cron/expire-complaints', {
      method: 'GET',
      headers: {
        authorization: 'Bearer some-random-secret',
      },
    })

    const res = await GET(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error).toContain('CRON_SECRET is not configured')
  })

  it('2. Từ chối 401 nếu Authorization header thiếu hoặc không khớp secret', async () => {
    process.env.CRON_SECRET = 'valid-super-secret-123'

    const reqNoHeader = new NextRequest('http://localhost:3000/api/cron/expire-complaints', {
      method: 'GET',
    })

    const resNoHeader = await GET(reqNoHeader)
    expect(resNoHeader.status).toBe(401)
    const jsonNoHeader = await resNoHeader.json()
    expect(jsonNoHeader.error).toContain('Invalid CRON_SECRET')

    const reqWrongSecret = new NextRequest('http://localhost:3000/api/cron/expire-complaints', {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong-secret',
      },
    })

    const resWrongSecret = await POST(reqWrongSecret)
    expect(resWrongSecret.status).toBe(401)
    const jsonWrongSecret = await resWrongSecret.json()
    expect(jsonWrongSecret.error).toContain('Invalid CRON_SECRET')
  })

  it('3. Thực thi thành công khi Authorization header hợp lệ (GET & POST)', async () => {
    process.env.CRON_SECRET = 'valid-super-secret-123'

    vi.spyOn(complaintSla, 'processExpiredComplaintProposals').mockResolvedValue({
      processedCount: 2,
      complaintIds: ['c1', 'c2'],
    })

    const reqGet = new NextRequest('http://localhost:3000/api/cron/expire-complaints', {
      method: 'GET',
      headers: {
        authorization: 'Bearer valid-super-secret-123',
      },
    })

    const resGet = await GET(reqGet)
    expect(resGet.status).toBe(200)
    const jsonGet = await resGet.json()
    expect(jsonGet.success).toBe(true)
    expect(jsonGet.processedCount).toBe(2)
    expect(jsonGet.complaintIds).toEqual(['c1', 'c2'])
    expect(jsonGet.timestamp).toBeDefined()

    const reqPost = new NextRequest('http://localhost:3000/api/cron/expire-complaints', {
      method: 'POST',
      headers: {
        authorization: 'Bearer valid-super-secret-123',
      },
    })

    const resPost = await POST(reqPost)
    expect(resPost.status).toBe(200)
    const jsonPost = await resPost.json()
    expect(jsonPost.success).toBe(true)
    expect(jsonPost.processedCount).toBe(2)
  })

  it('4. Trả về 500 nếu service xử lý gặp ngoại lệ', async () => {
    process.env.CRON_SECRET = 'valid-super-secret-123'

    vi.spyOn(complaintSla, 'processExpiredComplaintProposals').mockRejectedValue(
      new Error('Database lock acquisition timeout')
    )

    const req = new NextRequest('http://localhost:3000/api/cron/expire-complaints', {
      method: 'GET',
      headers: {
        authorization: 'Bearer valid-super-secret-123',
      },
    })

    const res = await GET(req)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error).toBe('Database lock acquisition timeout')
  })
})
