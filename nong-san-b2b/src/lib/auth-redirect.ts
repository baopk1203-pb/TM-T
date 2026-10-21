import { Role } from '@prisma/client'

/**
 * Kiểm tra và làm sạch callbackUrl để chống Open Redirect (WEB-AUTH-10)
 * - Chỉ chấp nhận relative URL hợp lệ (bắt đầu bằng '/', không bắt đầu bằng '//')
 * - Nếu là absolute URL, bắt buộc origin phải trùng với origin hiện tại
 */
export function sanitizeCallbackUrl(url?: string | null, origin?: string): string | null {
  if (!url || typeof url !== 'string') return null
  const trimmed = url.trim()
  if (!trimmed) return null

  // Chặn protocol-relative URLs (ví dụ: //evil.com) và javascript:
  if (trimmed.startsWith('//') || trimmed.toLowerCase().startsWith('javascript:')) {
    return null
  }

  // Relative URL hợp lệ
  if (trimmed.startsWith('/')) {
    return trimmed
  }

  // Absolute URL: chỉ chấp nhận nếu cùng origin
  if (origin) {
    try {
      const parsed = new URL(trimmed)
      const base = new URL(origin)
      if (parsed.origin === base.origin) {
        return parsed.pathname + parsed.search + parsed.hash
      }
    } catch {
      return null
    }
  }

  return null
}

/**
 * Xác định URL chuyển hướng an toàn sau khi đăng nhập thành công (DEV-TASK-53)
 *
 * Quy tắc:
 * 1. Role ADMIN: Mặc định chuyển tới '/admin' nếu callbackUrl không được truyền hoặc là '/', '/dang-nhap', '/dang-ky'.
 *    Nếu có callbackUrl hợp lệ (ví dụ: '/admin/san-pham' hoặc '/san-pham/sau-rieng'), chuyển đến callbackUrl đó.
 * 2. Role CUSTOMER: Mặc định chuyển tới Storefront ('/').
 *    Nếu callbackUrl trỏ vào '/admin' (do người dùng tình cờ truy cập trước đó), bảo vệ chuyển về '/' để tránh lỗi 403 / redirect loop.
 *    Nếu callbackUrl là route hợp lệ của khách hàng (ví dụ: '/tai-khoan', '/thanh-toan'), chuyển đến route đó.
 * 3. Ngăn chặn Open Redirect tuyệt đối.
 */
export function resolveLoginRedirectUrl(
  role: Role | string | undefined | null,
  callbackUrl?: string | null,
  origin?: string
): string {
  const safeUrl = sanitizeCallbackUrl(callbackUrl, origin)
  const isAdmin = role === 'ADMIN' || role === Role.ADMIN

  // Nếu không có callbackUrl hoặc là trang chủ / trang xác thực
  if (!safeUrl || safeUrl === '/' || safeUrl === '/dang-nhap' || safeUrl === '/dang-ky') {
    return isAdmin ? '/admin' : '/'
  }

  // Khách hàng không có quyền truy cập phân hệ Admin -> chuyển về Storefront
  if (!isAdmin && safeUrl.startsWith('/admin')) {
    return '/'
  }

  return safeUrl
}
