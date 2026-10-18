import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getAuthSecret } from '@/lib/auth-config'

describe('Domain/Config: getAuthSecret (SRC-SEC-06 & SRC-CONF-01)', () => {
  const originalNextAuthSecret = process.env.NEXTAUTH_SECRET
  const originalAuthSecret = process.env.AUTH_SECRET

  beforeEach(() => {
    delete process.env.NEXTAUTH_SECRET
    delete process.env.AUTH_SECRET
  })

  afterEach(() => {
    if (originalNextAuthSecret !== undefined) {
      process.env.NEXTAUTH_SECRET = originalNextAuthSecret
    } else {
      delete process.env.NEXTAUTH_SECRET
    }

    if (originalAuthSecret !== undefined) {
      process.env.AUTH_SECRET = originalAuthSecret
    } else {
      delete process.env.AUTH_SECRET
    }
  })

  it('1. Trả về NEXTAUTH_SECRET khi chỉ có NEXTAUTH_SECRET', () => {
    process.env.NEXTAUTH_SECRET = 'valid-nextauth-secret-key-1'
    expect(getAuthSecret()).toBe('valid-nextauth-secret-key-1')
  })

  it('2. Trả về AUTH_SECRET khi chỉ có AUTH_SECRET', () => {
    process.env.AUTH_SECRET = 'valid-auth-secret-key-2'
    expect(getAuthSecret()).toBe('valid-auth-secret-key-2')
  })

  it('3. Khi cả hai cùng tồn tại nhưng khác nhau: Ưu tiên NEXTAUTH_SECRET để giữ phiên hoạt động', () => {
    process.env.NEXTAUTH_SECRET = 'primary-nextauth-secret'
    process.env.AUTH_SECRET = 'secondary-auth-secret'
    expect(getAuthSecret()).toBe('primary-nextauth-secret')
  })

  it('4. Fail-closed: Khi thiếu cả hai biến môi trường, quăng lỗi, tuyệt đối không dùng chuỗi fallback tĩnh', () => {
    expect(() => getAuthSecret()).toThrowError(/Authentication secret is not configured/)
  })

  it('5. Fail-closed: Khi biến môi trường chỉ chứa khoảng trắng, quăng lỗi', () => {
    process.env.NEXTAUTH_SECRET = '   '
    process.env.AUTH_SECRET = ''
    expect(() => getAuthSecret()).toThrowError(/Authentication secret is not configured/)
  })
})
