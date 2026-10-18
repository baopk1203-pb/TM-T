/**
 * Shared Auth Configuration Helper - Tương thích Edge Runtime & Node.js
 * Sử dụng chung cho cả NextAuth Options (src/lib/auth.ts) và Next.js Middleware (src/middleware.ts).
 *
 * Quy tắc ưu tiên secret (SRC-CONF-01 & SRC-SEC-06):
 * 1. NEXTAUTH_SECRET: Biến tiêu chuẩn của NextAuth v4 (đang dùng để mã hóa session hiện hữu).
 * 2. AUTH_SECRET: Biến định danh Auth.js tiêu chuẩn mới (fallback nếu NEXTAUTH_SECRET chưa đặt).
 * 3. Nếu cả hai cùng tồn tại nhưng khác nhau: Ưu tiên NEXTAUTH_SECRET để bảo vệ tính hợp lệ
 *    của các phiên đăng nhập đang hoạt động (không làm đứt phiên người dùng).
 * 4. Nếu thiếu cả hai hoặc rỗng: Quăng lỗi fail-closed, tuyệt đối không dùng chuỗi fallback tĩnh.
 */
export function getAuthSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET

  if (!secret || secret.trim() === '') {
    throw new Error(
      'Authentication secret is not configured. Please set NEXTAUTH_SECRET or AUTH_SECRET in environment variables.'
    )
  }

  return secret
}
