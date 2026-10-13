import { NextAuthOptions, getServerSession } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { Role } from '@prisma/client'

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || 'nong-san-b2b-super-secret-key-change-in-production-123456',
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
        session.user.discountPercent = token.discountPercent
        session.user.companyName = token.companyName
        session.user.phone = token.phone
      }
      return session
    },
  },
}

/**
 * Lấy session hiện tại ở Server Component / Server Action
 */
export async function getServerAuthSession() {
  return await getServerSession(authOptions)
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
