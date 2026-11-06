import { NextAuthOptions, getServerSession, Session } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { Role } from '@prisma/client'
import { getAuthSecret } from '@/lib/auth-config'
import { resolveCustomerGroupContext } from '@/lib/domain/crm'

export const authOptions: NextAuthOptions = {
  secret: getAuthSecret(),
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 ngày
  },
  pages: {
    signIn: '/dang-nhap',
    error: '/dang-nhap',
  },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Mật khẩu', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Vui lòng nhập đầy đủ email và mật khẩu')
        }

        const user = await db.user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() },
          include: { group: true },
        })

        if (!user || !user.passwordHash) {
          throw new Error('Email hoặc mật khẩu không chính xác')
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        )

        if (!isPasswordValid) {
          throw new Error('Email hoặc mật khẩu không chính xác')
        }

        return {
          id: user.id,
          email: user.email,
          name: user.fullName,
          role: user.role,
          groupId: user.groupId,
          groupCode: user.group?.code ?? 'SMALL_SHOP',
          groupName: user.group?.name ?? 'Cửa hàng nhỏ',
          discountPercent: user.group?.discountPercent ?? 0,
          companyName: user.companyName,
          phone: user.phone,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role
        token.groupId = user.groupId
        token.groupCode = user.groupCode ?? 'SMALL_SHOP'
        token.groupName = user.groupName ?? 'Cửa hàng nhỏ'
        token.discountPercent = user.discountPercent
        token.companyName = user.companyName
        token.phone = user.phone
      }
      return token
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id
        session.user.role = token.role
        session.user.groupId = token.groupId
        session.user.groupCode = token.groupCode ?? 'SMALL_SHOP'
        session.user.groupName = token.groupName ?? 'Cửa hàng nhỏ'
        session.user.discountPercent = token.discountPercent
        session.user.companyName = token.companyName
        session.user.phone = token.phone
      }
      return session
    },
    async redirect({ url, baseUrl }) {
      // Cho phép relative callback URLs an toàn (ngăn chặn open redirect dạng //evil.com)
      if (url.startsWith('/')) {
        if (url.startsWith('//')) return baseUrl
        return `${baseUrl}${url}`
      }
      // Cho phép callback URLs trên cùng host/origin
      try {
        const parsedUrl = new URL(url)
        const parsedBase = new URL(baseUrl)
        if (parsedUrl.origin === parsedBase.origin) return url
      } catch {}
      return baseUrl
    },
  },
}

/**
 * Đồng bộ thông tin nhóm khách hàng và tỷ lệ chiết khấu mới nhất từ DB vào session
 * Đảm bảo khi Admin đổi nhóm khách hàng hoặc sửa % chiết khấu của nhóm,
 * giao diện khách hàng nhận được thông tin mới ở lần tải trang tiếp theo mà không cần đăng nhập lại (CRM-05).
 */
export async function syncSessionWithDatabase(
  session: Session | null
): Promise<Session | null> {
  if (!session?.user?.id) {
    return session
  }

  try {
    const dbUser = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        fullName: true,
        companyName: true,
        phone: true,
        role: true,
        groupId: true,
        group: {
          select: {
            id: true,
            code: true,
            name: true,
            discountPercent: true,
          },
        },
      },
    })

    if (dbUser) {
      const resolved = resolveCustomerGroupContext(dbUser, session.user)
      return {
        ...session,
        user: {
          ...session.user,
          name: resolved.name ?? session.user.name,
          companyName: resolved.companyName,
          phone: resolved.phone,
          role: resolved.role,
          groupId: resolved.groupId,
          groupCode: resolved.groupCode,
          groupName: resolved.groupName,
          discountPercent: resolved.discountPercent,
        },
      }
    }
  } catch {
    // Fallback an toàn về dữ liệu trong JWT nếu môi trường test không mock db.user
  }

  return session
}

/**
 * Lấy session hiện tại ở Server Component / Server Action (đã đồng bộ nhóm & chiết khấu mới nhất từ DB)
 */
export async function getServerAuthSession() {
  const session = await getServerSession(authOptions)
  return await syncSessionWithDatabase(session)
}

/**
 * Bắt buộc người dùng đã đăng nhập; nếu chưa thì quăng lỗi hoặc redirect
 */
export async function requireUser() {
  const session = await getServerAuthSession()
  if (!session?.user) {
    throw new Error('Yêu cầu đăng nhập để thực hiện chức năng này')
  }
  return session.user
}

/**
 * Bắt buộc quyền Quản trị viên (ADMIN)
 */
export async function requireAdmin() {
  const user = await requireUser()
  if (user.role !== Role.ADMIN) {
    throw new Error('Bạn không có quyền truy cập trang quản trị')
  }
  return user
}
