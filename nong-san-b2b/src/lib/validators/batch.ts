import { z } from 'zod'

export const batchSchema = z.object({
  code: z
    .string()
    .min(5, 'Mã lô phải có ít nhất 5 ký tự')
    .regex(/^[A-Z0-9-]+$/, 'Mã lô chỉ gồm chữ in hoa, số và dấu gạch ngang (-)'),
  productId: z.string().min(1, 'Chưa chọn sản phẩm'),
  farmId: z.string().min(1, 'Chưa chọn nhà vườn'),
  harvestDate: z.coerce.date({
    error: 'Ngày thu hoạch không hợp lệ',
  }),
  quantityGrams: z.number().int().min(1000, 'Khối lượng lô hàng phải từ 1kg (1.000g)'),
  note: z.string().optional().nullable(),
})

export type BatchInput = z.infer<typeof batchSchema>
