import { z } from 'zod'

export const profileSchema = z.object({
  fullName: z.string().min(2, 'Họ và tên phải có ít nhất 2 ký tự'),
  phone: z
    .string()
    .min(10, 'Số điện thoại phải có ít nhất 10 chữ số')
    .max(12, 'Số điện thoại không hợp lệ'),
  companyName: z.string().min(2, 'Tên doanh nghiệp / Cửa hàng là bắt buộc'),
  taxCode: z.string().optional().or(z.literal('')),
})

export type ProfileInput = z.infer<typeof profileSchema>

export const addressSchema = z.object({
  label: z.string().min(1, 'Vui lòng đặt tên gợi nhớ cho địa chỉ (VD: Kho 1, Trụ sở...)'),
  recipient: z.string().min(2, 'Họ và tên người nhận hàng là bắt buộc'),
  phone: z
    .string()
    .min(10, 'Số điện thoại người nhận phải có ít nhất 10 số')
    .max(12, 'Số điện thoại không hợp lệ'),
  line: z.string().min(3, 'Số nhà, tên đường chi tiết là bắt buộc'),
  ward: z.string().min(1, 'Phường / Xã là bắt buộc'),
  district: z.string().min(1, 'Quận / Huyện là bắt buộc'),
  province: z.string().min(1, 'Tỉnh / Thành phố là bắt buộc'),
  isDefault: z.boolean().default(false),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
})

export type AddressInput = z.infer<typeof addressSchema>
