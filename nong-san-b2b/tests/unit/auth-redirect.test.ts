import { describe, it, expect } from 'vitest'
import { Role } from '@prisma/client'
import { resolveLoginRedirectUrl, sanitizeCallbackUrl } from '@/lib/auth-redirect'

describe('DEV-TASK-53: Auth Login Redirect & Open Redirect Prevention', () => {
  describe('1. sanitizeCallbackUrl', () => {
    it('Cho phép relative URL nội bộ an toàn', () => {
      expect(sanitizeCallbackUrl('/admin')).toBe('/admin')
      expect(sanitizeCallbackUrl('/tai-khoan/don-hang')).toBe('/tai-khoan/don-hang')
      expect(sanitizeCallbackUrl('/thanh-toan/ORD-123?step=2')).toBe('/thanh-toan/ORD-123?step=2')
    })

    it('Chặn protocol-relative URL (//attacker.com)', () => {
      expect(sanitizeCallbackUrl('//attacker.com')).toBeNull()
      expect(sanitizeCallbackUrl('//nong-san-b2b.vercel.app.evil.com')).toBeNull()
    })

    it('Chặn javascript:', () => {
      expect(sanitizeCallbackUrl('javascript:alert(1)')).toBeNull()
      expect(sanitizeCallbackUrl('JAVASCRIPT:void(0)')).toBeNull()
    })

    it('Chặn external absolute URLs nếu không cùng origin', () => {
      const origin = 'https://nong-san-b2b.vercel.app'
      expect(sanitizeCallbackUrl('https://evil.com/admin', origin)).toBeNull()
      expect(sanitizeCallbackUrl('http://phishing.vn', origin)).toBeNull()
    })

    it('Cho phép absolute URLs nếu cùng origin', () => {
      const origin = 'https://nong-san-b2b.vercel.app'
      expect(sanitizeCallbackUrl('https://nong-san-b2b.vercel.app/admin/don-hang', origin)).toBe('/admin/don-hang')
    })

    it('Trả về null khi url rỗng hoặc không hợp lệ', () => {
      expect(sanitizeCallbackUrl('')).toBeNull()
      expect(sanitizeCallbackUrl('   ')).toBeNull()
      expect(sanitizeCallbackUrl(null)).toBeNull()
      expect(sanitizeCallbackUrl(undefined)).toBeNull()
    })
  })

  describe('2. resolveLoginRedirectUrl cho Role ADMIN', () => {
    it('Admin đăng nhập thông thường không có callbackUrl -> chuyển tới /admin', () => {
      expect(resolveLoginRedirectUrl(Role.ADMIN)).toBe('/admin')
      expect(resolveLoginRedirectUrl('ADMIN')).toBe('/admin')
      expect(resolveLoginRedirectUrl(Role.ADMIN, null)).toBe('/admin')
      expect(resolveLoginRedirectUrl(Role.ADMIN, '')).toBe('/admin')
    })

    it('Admin đăng nhập khi callbackUrl là / hoặc /dang-nhap -> mặc định /admin', () => {
      expect(resolveLoginRedirectUrl(Role.ADMIN, '/')).toBe('/admin')
      expect(resolveLoginRedirectUrl(Role.ADMIN, '/dang-nhap')).toBe('/admin')
      expect(resolveLoginRedirectUrl(Role.ADMIN, '/dang-ky')).toBe('/admin')
    })

    it('Admin quay lại trang nội bộ admin cụ thể -> chuyển đúng trang đó', () => {
      expect(resolveLoginRedirectUrl(Role.ADMIN, '/admin/san-pham')).toBe('/admin/san-pham')
      expect(resolveLoginRedirectUrl(Role.ADMIN, '/admin/nha-vuon')).toBe('/admin/nha-vuon')
      expect(resolveLoginRedirectUrl(Role.ADMIN, '/admin/don-hang/ORD-999')).toBe('/admin/don-hang/ORD-999')
    })

    it('Admin quay lại trang storefront cụ thể -> chuyển đúng trang đó', () => {
      expect(resolveLoginRedirectUrl(Role.ADMIN, '/san-pham/sau-rieng-ri6')).toBe('/san-pham/sau-rieng-ri6')
    })

    it('Admin có callbackUrl độc hại -> fallback an toàn về /admin', () => {
      expect(resolveLoginRedirectUrl(Role.ADMIN, '//evil.com')).toBe('/admin')
      expect(resolveLoginRedirectUrl(Role.ADMIN, 'https://attacker.com')).toBe('/admin')
    })
  })

  describe('3. resolveLoginRedirectUrl cho Role CUSTOMER', () => {
    it('Customer đăng nhập thông thường không có callbackUrl -> mặc định về Storefront /', () => {
      expect(resolveLoginRedirectUrl(Role.CUSTOMER)).toBe('/')
      expect(resolveLoginRedirectUrl('CUSTOMER')).toBe('/')
      expect(resolveLoginRedirectUrl(Role.CUSTOMER, null)).toBe('/')
      expect(resolveLoginRedirectUrl(Role.CUSTOMER, '')).toBe('/')
      expect(resolveLoginRedirectUrl(Role.CUSTOMER, '/')).toBe('/')
      expect(resolveLoginRedirectUrl(Role.CUSTOMER, '/dang-nhap')).toBe('/')
    })

    it('Customer có callbackUrl hợp lệ của khách hàng -> chuyển đúng trang', () => {
      expect(resolveLoginRedirectUrl(Role.CUSTOMER, '/tai-khoan/don-hang')).toBe('/tai-khoan/don-hang')
      expect(resolveLoginRedirectUrl(Role.CUSTOMER, '/thanh-toan/ORD-123')).toBe('/thanh-toan/ORD-123')
      expect(resolveLoginRedirectUrl(Role.CUSTOMER, '/san-pham/sau-rieng')).toBe('/san-pham/sau-rieng')
    })

    it('Customer cố tình có callbackUrl là /admin -> bị chặn và chuyển về Storefront /', () => {
      expect(resolveLoginRedirectUrl(Role.CUSTOMER, '/admin')).toBe('/')
      expect(resolveLoginRedirectUrl(Role.CUSTOMER, '/admin/san-pham')).toBe('/')
      expect(resolveLoginRedirectUrl(Role.CUSTOMER, '/admin/don-hang')).toBe('/')
    })

    it('Customer có callbackUrl độc hại -> fallback an toàn về Storefront /', () => {
      expect(resolveLoginRedirectUrl(Role.CUSTOMER, '//evil.com')).toBe('/')
      expect(resolveLoginRedirectUrl(Role.CUSTOMER, 'https://attacker.com')).toBe('/')
    })
  })

  describe('4. resolveLoginRedirectUrl khi Role không xác định / null', () => {
    it('Fallback an toàn về / như Customer', () => {
      expect(resolveLoginRedirectUrl(null)).toBe('/')
      expect(resolveLoginRedirectUrl(undefined)).toBe('/')
      expect(resolveLoginRedirectUrl(null, '/tai-khoan')).toBe('/tai-khoan')
      expect(resolveLoginRedirectUrl(null, '/admin')).toBe('/')
    })
  })
})
