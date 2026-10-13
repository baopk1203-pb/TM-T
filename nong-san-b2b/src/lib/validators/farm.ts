import { z } from 'zod'
import { CertType } from '@prisma/client'

export const farmSchema = z.object({
  name: z.string().min(2, 'Tên nhà vườn phải có ít nhất 2 ký tự'),
  slug: z
    .string()
    .min(2, 'Slug không được để trống')
    .regex(/^[a-z0-9-]+$/, 'Slug chỉ gồm chữ thường, số và dấu gạch ngang (-)'),
  ownerName: z.string().optional().nullable(),
  province: z.string().min(2, 'Tỉnh / Thành phố không được để trống'),
  addressText: z.string().min(5, 'Địa chỉ cụ thể không được để trống'),
  description: z.string().min(10, 'Mô tả nhà vườn phải có ít nhất 10 ký tự'),
  lat: z.number().min(-90).max(90, 'Vĩ độ (Lat) không hợp lệ'),
  lng: z.number().min(-180).max(180, 'Kinh độ (Lng) không hợp lệ'),
  images: z.array(z.string()).default([]),
})

export const certificateSchema = z.object({
  farmId: z.string().min(1, 'Chưa chọn nhà vườn'),
  type: z.nativeEnum(CertType, {
    error: 'Loại chứng nhận không hợp lệ',
  }),
  code: z.string().min(2, 'Mã số chứng nhận không được để trống'),
  issuedAt: z.coerce.date({
    error: 'Ngày cấp không hợp lệ',
  }),
  expiresAt: z.coerce.date({
    error: 'Ngày hết hạn không hợp lệ',
  }),
  imageUrl: z.string().optional().nullable(),
})

export type FarmInput = z.infer<typeof farmSchema>
export type CertificateInput = z.infer<typeof certificateSchema>
