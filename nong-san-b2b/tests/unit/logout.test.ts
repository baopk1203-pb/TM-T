import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getSafeCallbackUrl } from '@/components/auth/sign-out-button'

describe('Logout Security & Open Redirect Prevention (WEB-AUTH-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Helper: getSafeCallbackUrl()', () => {
    it('1. Cho phép relative URL nội bộ an toàn', () => {
      expect(getSafeCallbackUrl('/dang-nhap')).toBe('/dang-nhap')
      expect(getSafeCallbackUrl('/san-pham?category=trai-cay')).toBe('/san-pham?category=trai-cay')
      expect(getSafeCallbackUrl('/tai-khoan/don-hang#tab-history')).toBe('/tai-khoan/don-hang#tab-history')
    })

    it('2. Ngăn chặn Open Redirect dạng protocol-relative URL (//evil.com)', () => {
      expect(getSafeCallbackUrl('//evil.com')).toBe('/dang-nhap')
      expect(getSafeCallbackUrl('//nong-san-b2b.vercel.app.attacker.com')).toBe('/dang-nhap')
    })

    it('3. Ngăn chặn Open Redirect dạng absolute URL sang domain ngoài (https://attacker.com)', () => {
      expect(getSafeCallbackUrl('https://evil.com')).toBe('/dang-nhap')
      expect(getSafeCallbackUrl('https://evil.com/dang-nhap')).toBe('/dang-nhap')
      expect(getSafeCallbackUrl('http://malicious.org')).toBe('/dang-nhap')
      expect(getSafeCallbackUrl('javascript:alert(1)')).toBe('/dang-nhap')
    })

    it('4. Fallback an toàn về /dang-nhap khi url rỗng hoặc undefined', () => {
      expect(getSafeCallbackUrl('')).toBe('/dang-nhap')
      expect(getSafeCallbackUrl(undefined)).toBe('/dang-nhap')
      expect(getSafeCallbackUrl('   ')).toBe('/dang-nhap')
    })
  })
})
