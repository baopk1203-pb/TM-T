import { Role } from '@prisma/client'
import { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: Role
      groupId: string | null
      groupCode?: string | null
      groupName?: string | null
      discountPercent: number
      companyName?: string | null
      phone?: string | null
    } & DefaultSession['user']
  }

  interface User {
    id: string
    role: Role
    groupId: string | null
    groupCode?: string | null
    groupName?: string | null
    discountPercent: number
    companyName?: string | null
    phone?: string | null
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    role: Role
    groupId: string | null
    groupCode?: string | null
    groupName?: string | null
    discountPercent: number
    companyName?: string | null
    phone?: string | null
  }
}
