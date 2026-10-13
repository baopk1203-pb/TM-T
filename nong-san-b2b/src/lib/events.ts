import { PrismaClient, OrderStatus, Prisma } from '@prisma/client'
import { db } from '@/lib/db'

export interface RecordOrderEventInput {
  orderId: string
  type: string
  fromStatus?: OrderStatus | null
  toStatus?: OrderStatus | null
  actorId?: string | null
  note?: string | null
  payload?: Prisma.InputJsonValue
}

type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>

/**
 * Ghi vết sự kiện đơn hàng (OrderEvent) vào database
 * Tuân thủ quy tắc: Phase 4-8 CHỈ GHI VÀO DB, không gửi email hay Zalo ZNS trước Phase 9.
 */
export async function recordOrderEvent(
  txOrDb: PrismaTransactionClient | typeof db,
  input: RecordOrderEventInput
) {
  return await txOrDb.orderEvent.create({
    data: {
      orderId: input.orderId,
      type: input.type,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      actorId: input.actorId ?? null,
      note: input.note ?? null,
      payload: input.payload ?? undefined,
    },
  })
}
