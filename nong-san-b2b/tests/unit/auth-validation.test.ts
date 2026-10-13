import { describe, it, expect } from 'vitest'
import { registerSchema } from '@/lib/validators/auth'
import { addressSchema } from '@/lib/validators/user'

describe('Auth and User Validators', () => {
  describe('registerSchema', () => {
    it('validates correct registration data', () => {
      const data = {
        fullName: 'Nguyễn Văn Đại',
        email: 'dai.tran@example.com',
        phone: '0912345678',
        companyName: 'Công Ty Nông Sản Sạch Miền Tây',
        taxCode: '0312345678',
        password: 'Password@123',
        confirmPassword: 'Password@123',
      }
      const result = registerSchema.safeParse(data)
      expect(result.success).toBe(true)
    })

    it('fails when passwords do not match', () => {
      const data = {
        fullName: 'Nguyễn Văn Đại',
        email: 'dai.tran@example.com',
        phone: '0912345678',
        companyName: 'Công Ty Nông Sản Sạch Miền Tây',
        password: 'Password@123',
        confirmPassword: 'WrongPassword',
      }
      const result = registerSchema.safeParse(data)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('không trùng khớp')
      }
    })

    it('fails when companyName is missing', () => {
      const data = {
        fullName: 'Nguyễn Văn Đại',
        email: 'dai.tran@example.com',
        phone: '0912345678',
        companyName: '',
        password: 'Password@123',
        confirmPassword: 'Password@123',
      }
      const result = registerSchema.safeParse(data)
      expect(result.success).toBe(false)
    })
  })

  describe('addressSchema', () => {
    it('validates a complete address input', () => {
      const addr = {
        label: 'Kho Thủ Đức',
        recipient: 'Nguyễn Văn Đại',
        phone: '0912345678',
        line: '123 Đường Song Hành',
        ward: 'Phường An Phú',
        district: 'TP Thủ Đức',
        province: 'TP. Hồ Chí Minh',
        isDefault: true,
      }
      const result = addressSchema.safeParse(addr)
      expect(result.success).toBe(true)
    })
  })
})
