'use client'

import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { LogOut, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface SignOutButtonProps {
  className?: string
  variant?: 'ghost' | 'outline' | 'default' | 'destructive'
  size?: 'default' | 'sm' | 'lg' | 'icon'
  callbackUrl?: string
  children?: React.ReactNode
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
      // Gọi signOut trên chính origin hiện tại, không chuyển sang origin khác
      await signOut({ callbackUrl })
    } catch {
      window.location.href = callbackUrl
    } finally {
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
