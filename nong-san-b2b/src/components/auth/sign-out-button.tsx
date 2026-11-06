'use client'

import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { LogOut, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface SignOutButtonProps {
  className?: string
  variant?: 'ghost' | 'outline' | 'default' | 'destructive'
  size?: 'default' | 'sm' | 'lg' | 'icon'
  callbackUrl?: string
  children?: React.ReactNode
}

/**
 * Hàm kiểm tra và chuẩn hóa callbackUrl an toàn, ngăn chặn Open Redirect (WEB-AUTH-10)
 * - Chỉ cho phép relative path hợp lệ (bắt đầu bằng '/', không bắt đầu bằng '//')
 * - Nếu là absolute URL, bắt buộc origin phải trùng với window.location.origin
 */
export function getSafeCallbackUrl(url?: string): string {
  const fallback = '/dang-nhap'
  if (!url || typeof url !== 'string') return fallback

  const trimmed = url.trim()

  // Cho phép relative URL bắt đầu bằng '/' nhưng ngăn '//' (protocol-relative URL)
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed
  }

  // Nếu là absolute URL, kiểm tra origin trùng với window.location.origin
  if (typeof window !== 'undefined' && window.location?.origin) {
    try {
      const parsed = new URL(trimmed, window.location.origin)
      if (parsed.origin === window.location.origin) {
        return parsed.pathname + parsed.search + parsed.hash
      }
    } catch {
      return fallback
    }
  }

  return fallback
}

export function SignOutButton({
  className = 'text-slate-600 hover:text-rose-600',
  variant = 'ghost',
  size = 'sm',
  callbackUrl = '/dang-nhap',
  children,
}: SignOutButtonProps) {
  const [loading, setLoading] = useState(false)

  const handleSignOut = async () => {
    setLoading(true)
    try {
      const targetUrl = getSafeCallbackUrl(callbackUrl)

      // 1. Gọi signOut với redirect: false để hủy session cookie trên origin hiện tại
      //    mà không bị ép chuyển hướng chéo hostname theo baseUrl server-side (WEB-AUTH-10)
      const res = await signOut({ redirect: false, callbackUrl: targetUrl })

      // 2. Chỉ chuyển hướng khi signOut thành công
      if (res && typeof res.url === 'string') {
        const safeDestination = getSafeCallbackUrl(targetUrl)
        window.location.href = safeDestination
      } else {
        // Đăng xuất thất bại: Giữ nguyên trạng thái và hiển thị lỗi, không giả vờ đăng xuất thành công
        toast.error('Đăng xuất không thành công. Vui lòng thử lại.')
        setLoading(false)
      }
    } catch (error) {
      console.error('Sign-out failed:', error)
      toast.error('Lỗi kết nối khi đăng xuất. Vui lòng kiểm tra lại mạng.')
      setLoading(false)
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={handleSignOut}
      disabled={loading}
      aria-label="Đăng xuất khỏi hệ thống"
      title="Đăng xuất"
    >
      {loading ? (
        <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
      ) : (
        <LogOut className="w-4 h-4 mr-1.5" />
      )}
      {children || 'Đăng xuất'}
    </Button>
  )
}
