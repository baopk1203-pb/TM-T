import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
  })

  // 1. Kiểm tra các route yêu cầu người dùng phải đăng nhập
  const isProtectedUserRoute =
    pathname.startsWith('/tai-khoan') || pathname.startsWith('/thanh-toan')

  if (isProtectedUserRoute && !token) {
    const loginUrl = new URL('/dang-nhap', req.url)
    loginUrl.searchParams.set('callbackUrl', req.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }

  // 2. Kiểm tra phân quyền trang Quản trị Admin
  if (pathname.startsWith('/admin')) {
    if (!token) {
      const loginUrl = new URL('/dang-nhap', req.url)
      loginUrl.searchParams.set('callbackUrl', req.nextUrl.pathname)
      return NextResponse.redirect(loginUrl)
    }

    if (token.role !== 'ADMIN') {
      // Đã đăng nhập nhưng không phải ADMIN -> chuyển hướng về trang chủ
      return NextResponse.redirect(new URL('/', req.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*', '/tai-khoan/:path*', '/thanh-toan/:path*'],
}
