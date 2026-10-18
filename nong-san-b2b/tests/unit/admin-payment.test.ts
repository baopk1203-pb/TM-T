import { describe, it, expect, vi, beforeEach } from 'vitest'
import { confirmPayment } from '@/actions/admin-order'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { recordOrderEvent } from '@/lib/events'
import { OrderStatus, PaymentOption, TxMethod, TxType, TxStatus, Role } from '@prisma/client'

vi.mock('@/lib/db', () => ({
  db: {
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(),
}))

vi.mock('@/lib/events', () => ({
  recordOrderEvent: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

interface MockOrder {
  id: string
  code: string
  status: OrderStatus
  paymentOption: PaymentOption
  total: number
  depositAmount: number
  transactions: Array<{
    id: string
    type: TxType
    status: TxStatus
    amount: number
  }>
}

describe('Server Action: confirmPayment() - REGRESSION-01 Test Suite', () => {
  const adminUser = {
    id: 'admin-123',
    email: 'admin@example.com',
    role: Role.ADMIN,
    name: 'Admin User',
    groupId: null,
    discountPercent: 0,
    companyName: null,
    phone: '0123456789',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdmin).mockResolvedValue(adminUser)
  })

  // Helper mock setup
  function setupTxMock(initialOrder: MockOrder) {
    const mockOrderUpdate = vi.fn().mockResolvedValue({ ...initialOrder, status: OrderStatus.PROCESSING })
    const mockTxCreate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: 'tx-new-1',
        ...data,
      })
    )

    const txMock = {
      order: {
        findUnique: vi.fn().mockResolvedValue(initialOrder),
        update: mockOrderUpdate,
      },
      paymentTransaction: {
        create: mockTxCreate,
      },
    }

    vi.mocked(db.$transaction).mockImplementation(async (callback) => {
      return await (callback as unknown as (tx: typeof txMock) => unknown)(txMock)
    })

    return { txMock, mockOrderUpdate, mockTxCreate }
  }

  it('Case A — FULL, mới trả 30% (4.584.000đ): Giữ trạng thái PENDING_CONFIRMATION, không chuyển PROCESSING', async () => {
    const orderData = {
      id: 'order-case-a',
      code: 'DH-CASE-A',
      status: OrderStatus.PENDING_CONFIRMATION,
      paymentOption: PaymentOption.FULL,
      total: 15277500,
      depositAmount: 4584000,
      transactions: [],
    }

    const { mockOrderUpdate } = setupTxMock(orderData)

    const result = await confirmPayment({
      orderId: 'order-case-a',
      amount: 4584000,
      method: TxMethod.BANK_TRANSFER,
      reference: 'FT-CASE-A',
    })

    expect(result.success).toBe(true)
    expect(result.message).toBe('Đã ghi nhận thanh toán thành công')
    // Không được gọi update trạng thái sang PROCESSING
    expect(mockOrderUpdate).not.toHaveBeenCalled()
    // Không ghi STATUS_CHANGED event, chỉ ghi PAYMENT_CONFIRMED
    const recordedEvents = vi.mocked(recordOrderEvent).mock.calls
    expect(recordedEvents).toHaveLength(1)
    expect(recordedEvents[0][1].type).toBe('PAYMENT_CONFIRMED')
  })

  it('Case B — FULL, trả tiếp phần còn thiếu 10.693.500đ sau khi đã trả 4.584.000đ: Chuyển PROCESSING và ghi OrderEvent đúng 1 lần', async () => {
    const existingTx = {
      id: 'tx-prev-1',
      type: TxType.PAYMENT,
      status: TxStatus.DONE,
      amount: 4584000,
    }

    const orderData = {
      id: 'order-case-b',
      code: 'DH-CASE-B',
      status: OrderStatus.PENDING_CONFIRMATION,
      paymentOption: PaymentOption.FULL,
      total: 15277500,
      depositAmount: 4584000,
      transactions: [existingTx],
    }

    const { mockOrderUpdate } = setupTxMock(orderData)

    const result = await confirmPayment({
      orderId: 'order-case-b',
      amount: 10693500,
      method: TxMethod.BANK_TRANSFER,
      reference: 'FT-CASE-B',
    })

    expect(result.success).toBe(true)
    expect(result.message).toContain('chuyển đơn hàng sang ĐANG XỬ LÝ (PROCESSING)')
    // Update trạng thái đúng 1 lần
    expect(mockOrderUpdate).toHaveBeenCalledTimes(1)
    expect(mockOrderUpdate).toHaveBeenCalledWith({
      where: { id: 'order-case-b' },
      data: { status: OrderStatus.PROCESSING },
    })

    // Ghi nhận cả PAYMENT_CONFIRMED và STATUS_CHANGED
    const recordedEvents = vi.mocked(recordOrderEvent).mock.calls
    expect(recordedEvents).toHaveLength(2)
    expect(recordedEvents[0][1].type).toBe('PAYMENT_CONFIRMED')
    expect(recordedEvents[1][1].type).toBe('STATUS_CHANGED')
    expect(recordedEvents[1][1].fromStatus).toBe(OrderStatus.PENDING_CONFIRMATION)
    expect(recordedEvents[1][1].toStatus).toBe(OrderStatus.PROCESSING)
    expect(recordedEvents[1][1].note).toContain('15.277.500')
    expect(recordedEvents[1][1].note).toContain('FULL')
  })

  it('Case C — FULL thanh toán đủ một lần 15.277.500đ: Chuyển PROCESSING thành công', async () => {
    const orderData = {
      id: 'order-case-c',
      code: 'DH-CASE-C',
      status: OrderStatus.PENDING_CONFIRMATION,
      paymentOption: PaymentOption.FULL,
      total: 15277500,
      depositAmount: 4584000,
      transactions: [],
    }

    const { mockOrderUpdate } = setupTxMock(orderData)

    const result = await confirmPayment({
      orderId: 'order-case-c',
      amount: 15277500,
      method: TxMethod.BANK_TRANSFER,
      reference: 'FT-CASE-C',
    })

    expect(result.success).toBe(true)
    expect(result.message).toContain('chuyển đơn hàng sang ĐANG XỬ LÝ (PROCESSING)')
    expect(mockOrderUpdate).toHaveBeenCalledWith({
      where: { id: 'order-case-c' },
      data: { status: OrderStatus.PROCESSING },
    })
  })

  it('Case D — DEPOSIT_30 thanh toán đủ cọc 4.584.000đ: Chuyển PROCESSING đúng như thiết kế', async () => {
    const orderData = {
      id: 'order-case-d',
      code: 'DH-CASE-D',
      status: OrderStatus.PENDING_CONFIRMATION,
      paymentOption: PaymentOption.DEPOSIT_30,
      total: 15277500,
      depositAmount: 4584000,
      transactions: [],
    }

    const { mockOrderUpdate } = setupTxMock(orderData)

    const result = await confirmPayment({
      orderId: 'order-case-d',
      amount: 4584000,
      method: TxMethod.BANK_TRANSFER,
      reference: 'FT-CASE-D',
    })

    expect(result.success).toBe(true)
    expect(result.message).toContain('chuyển đơn hàng sang ĐANG XỬ LÝ (PROCESSING)')
    expect(mockOrderUpdate).toHaveBeenCalledTimes(1)
    expect(mockOrderUpdate).toHaveBeenCalledWith({
      where: { id: 'order-case-d' },
      data: { status: OrderStatus.PROCESSING },
    })
  })

  it('Case E — Legacy FULL Order có depositAmount = total: Ngưỡng FULL vẫn bằng total 15.277.500đ, không bị ảnh hưởng', async () => {
    const legacyOrderData = {
      id: 'order-case-e',
      code: 'DH-CASE-E',
      status: OrderStatus.PENDING_CONFIRMATION,
      paymentOption: PaymentOption.FULL,
      total: 15277500,
      depositAmount: 15277500, // Legacy schema
      transactions: [],
    }

    // Thanh toán 30%: không chuyển trạng thái
    const { mockOrderUpdate: mockUpdate1 } = setupTxMock(legacyOrderData)
    const res1 = await confirmPayment({
      orderId: 'order-case-e',
      amount: 4584000,
      method: TxMethod.BANK_TRANSFER,
    })
    expect(res1.success).toBe(true)
    expect(mockUpdate1).not.toHaveBeenCalled()

    // Thanh toán đủ 100%: chuyển trạng thái
    const { mockOrderUpdate: mockUpdate2 } = setupTxMock(legacyOrderData)
    const res2 = await confirmPayment({
      orderId: 'order-case-e',
      amount: 15277500,
      method: TxMethod.BANK_TRANSFER,
    })
    expect(res2.success).toBe(true)
    expect(mockUpdate2).toHaveBeenCalledWith({
      where: { id: 'order-case-e' },
      data: { status: OrderStatus.PROCESSING },
    })
  })
})
