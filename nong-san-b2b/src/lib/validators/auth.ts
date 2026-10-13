import { z } from 'zod'

export const registerSchema = z.object({
  fullName: z.string().min(2, 'Họ và tên phải có ít nhất 2 ký tự'),
  email: z.string().email('Địa chỉ email không hợp lệ'),
  phone: z
    .string()
    .min(10, 'Số điện thoại phải có ít nhất 10 số')
    .max(12, 'Số điện thoại không hợp lệ')
    .regex(/^[0-9]+$/, 'Số điện thoại chỉ bao gồm các chữ số'),
  companyName: z
    .string()
    .min(2, 'Tên doanh nghiệp / Cửa hàng là bắt buộc đối với khách mua sỉ B2B'),
  taxCode: z.string().optional().or(z.literal('')),
  password: z.string().min(6, 'Mật khẩu phải có ít nhất 6 ký tự'),
  confirmPassword: z.string().min(6, 'Vui lòng xác nhận lại mật khẩu'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Mật khẩu xác nhận không trùng khớp',
  path: ['confirmPassword'],
})

export type RegisterInput = z.infer<typeof registerSchema>

export const loginSchema = z.object({
  email: z.string().email('Địa chỉ email không hợp lệ'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
})

export type LoginInput = z.infer<typeof loginSchema>
