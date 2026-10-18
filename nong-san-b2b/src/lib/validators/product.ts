import { z } from 'zod'
import { SeasonStatus } from '@prisma/client'

export const packagingInputSchema = z.object({
  id: z.string().optional().nullable(),
  name: z.string().min(2, 'Tên quy cách không được để trống'),
  weightGrams: z.number().int().min(100, 'Khối lượng phải từ 100 gram trở lên'),
  isSample: z.boolean().default(false),
  samplePrice: z.number().int().min(1000, 'Giá gói mẫu tối thiểu 1.000 đ').optional().nullable(),
  isActive: z.boolean().optional(),
})

export const priceTierInputSchema = z.object({
  id: z.string().optional(),
  minGrams: z.number().int().min(100, 'Khối lượng tối thiểu phải từ 100 gram'),
  pricePerKg: z.number().int().min(1000, 'Đơn giá tối thiểu 1.000 đ/kg'),
})

export const productSchema = z.object({
  name: z.string().min(2, 'Tên sản phẩm phải có ít nhất 2 ký tự'),
  slug: z
    .string()
    .min(2, 'Slug không được để trống')
    .regex(/^[a-z0-9-]+$/, 'Slug chỉ gồm chữ thường, số và dấu gạch ngang (-)'),
  description: z.string().min(10, 'Mô tả sản phẩm phải có ít nhất 10 ký tự'),
  images: z.array(z.string()).min(1, 'Phải có ít nhất 1 hình ảnh sản phẩm'),
  farmId: z.string().min(1, 'Chưa chọn nhà vườn'),
  moqGrams: z.number().int().min(1000, 'Mức đặt tối thiểu (MOQ) từ 1kg (1.000g)'),
  leadTimeDays: z.number().int().min(0).default(1),
  seasonStatus: z.nativeEnum(SeasonStatus, {
    error: 'Trạng thái mùa vụ không hợp lệ',
  }),
  requiresCold: z.boolean().default(false),
  isActive: z.boolean().default(true),

  // Pre-order configuration
  preorderOpen: z.boolean().default(false),
  preorderPricePerKg: z.number().int().min(1000).optional().nullable(),
  preorderBandPercent: z.number().int().min(1).max(50).default(10).optional().nullable(),
  expectedHarvestFrom: z.coerce.date().optional().nullable(),
  expectedHarvestTo: z.coerce.date().optional().nullable(),

  packagings: z.array(packagingInputSchema).min(1, 'Phải có ít nhất 1 quy cách đóng gói'),
  priceTiers: z.array(priceTierInputSchema).min(1, 'Phải có ít nhất 1 bậc giá sỉ'),
})

export type ProductInput = z.infer<typeof productSchema>
export type PackagingInput = z.infer<typeof packagingInputSchema>
export type PriceTierFormInput = z.infer<typeof priceTierInputSchema>
