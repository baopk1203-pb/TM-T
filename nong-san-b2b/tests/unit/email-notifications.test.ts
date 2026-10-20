import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  OrderStatus,
  OrderType,
  PaymentOption,
  Resolution,
  TxMethod,
  TxStatus,
  TxType,
  VehicleType,
} from '@prisma/client'

const { mockOrderEvents, mockOrderFindUnique } = vi.hoisted(() => ({
  mockOrderEvents: [] as Array<{
    id: string
    orderId: string
    type: string
    note: string | null
    payload?: unknown
  }>,
  mockOrderFindUnique: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    orderEvent: {
      findFirst: vi.fn(
        async ({ where }: { where: { orderId: string; type: string } }) =>
          mockOrderEvents.find(
            (e) => e.orderId === where.orderId && e.type === where.type
          ) || null
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: {
            orderId: string
            type: string
            note?: string | null
            payload?: unknown
          }
        }) => {
          const created = {
            id: `evt-${mockOrderEvents.length + 1}`,
            orderId: data.orderId,
            type: data.type,
            note: data.note ?? null,
            payload: data.payload,
          }
          mockOrderEvents.push(created)
          return created
        }
      ),
    },
    order: {
      findUnique: mockOrderFindUnique,
    },
  },
}))

import {
  MockEmailAdapter,
  NodemailerAdapter,
  UnconfiguredEmailAdapter,
  getEmailAdapter,
  validateSmtpConfig,
  sanitizeSmtpError,
} from '@/lib/email/adapter'
import {
  renderOrderPlacedTemplate,
  renderPaymentConfirmedTemplate,
  renderOrderShippingTemplate,
  renderOrderCompletedTemplate,
  renderComplaintOpenedTemplate,
  renderComplaintResolvedTemplate,
  renderRefundConfirmedTemplate,
} from '@/lib/email/templates'
import {
  computeIdempotencyKey,
  sendOrderNotification,
} from '@/lib/email/service'

describe('Email Notification System (Phase 9 & DEV-TASK-45 Reliability Hotfix)', () => {
  let mockAdapter: MockEmailAdapter
  const originalEnv = { ...process.env }

  const baseUser = {
    id: 'user-123',
    fullName: 'Công ty Thực Phẩm Xanh',
    email: 'buyer@example.com',
    phone: '0901234567',
    companyName: 'Công ty Thực Phẩm Xanh',
  }

  const baseOrder = {
    id: 'order-123',
    userId: 'user-123',
    code: 'ORD-2026-001',
    type: OrderType.STANDARD,
    status: OrderStatus.PENDING_CONFIRMATION,
    total: 4800000,
    finalTotal: null as number | null,
    subtotal: 4650000,
    finalSubtotal: null as number | null,
    shippingFee: 150000,
    depositAmount: 1440000,
    paymentOption: PaymentOption.DEPOSIT_30,
    deliveryDate: new Date('2026-10-25T00:00:00Z'),
    timeSlot: 'MORNING',
    deliveredAt: new Date('2026-10-20T10:00:00Z'),
    paymentDueAt: new Date('2026-10-21T00:00:00Z'),
    addressSnapshot: {
      line: '123 Đường Số 7',
      ward: 'Phường 3',
      district: 'Quận 10',
      province: 'TP.HCM',
    },
  }

  const fullMockOrderFromDb = {
    ...baseOrder,
    user: baseUser,
    items: [
      {
        id: 'item-1',
        productName: 'Xoài Cát Hòa Lộc',
        packagingName: 'Thùng 10kg Loại 1',
        quantity: 5,
        orderedGrams: 50000,
        actualGrams: 49500,
        unitPricePerKg: 65000,
        lineTotal: 3250000,
        finalLineTotal: 3217500,
        isSample: false,
      },
    ],
    shipment: {
      id: 'ship-789',
      code: 'SHIP-ORD-2026-001',
      vehicleType: VehicleType.COLD,
      driverName: 'Nguyễn Văn Tài',
      driverPhone: '0901234567',
      licensePlate: '51C-998.22',
    },
    complaints: [
      {
        id: 'comp-001',
        orderItemId: 'item-1',
        reportedGrams: 5000,
        description: 'Hàng dập nhẹ do vận chuyển',
        photos: ['photo1.jpg'],
        resolution: Resolution.REFUND,
        compensation: 325000,
        adminNote: 'Chấp nhận hoàn tiền 5kg',
      },
    ],
    transactions: [
      {
        id: 'tx-456',
        type: TxType.PAYMENT,
        status: TxStatus.DONE,
        method: TxMethod.BANK_TRANSFER,
        amount: 1440000,
        reference: 'FT-1440',
        completedAt: new Date('2026-10-20T11:00:00Z'),
        createdAt: new Date('2026-10-20T11:00:00Z'),
        note: 'Thanh toán cọc 30%',
      },
      {
        id: 'tx-refund-999',
        type: TxType.REFUND,
        status: TxStatus.DONE,
        method: TxMethod.BANK_TRANSFER,
        amount: 325000,
        reference: 'REF-325',
        completedAt: new Date('2026-10-20T15:00:00Z'),
        createdAt: new Date('2026-10-20T15:00:00Z'),
        note: 'Hoàn tiền khiếu nại',
      },
    ],
  }

  beforeEach(() => {
    process.env = { ...originalEnv }
    mockAdapter = new MockEmailAdapter()
    mockAdapter.clear()
    mockOrderEvents.length = 0
    mockOrderFindUnique.mockReset()
    mockOrderFindUnique.mockResolvedValue(fullMockOrderFromDb)
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('MockEmailAdapter & Adapter Factory (DEV-TASK-45 P1 Fix)', () => {
    it('sends email successfully and stores payload in memory', async () => {
      const result = await mockAdapter.send({
        to: 'buyer@example.com',
        subject: 'Đơn hàng mới #ORD-123',
        html: '<p>Xin chào</p>',
        text: 'Xin chào',
      })

      expect(result.success).toBe(true)
      expect(result.messageId).toBeDefined()
      expect(result.messageId).toContain('@nongsanb2b.vn')

      const sent = mockAdapter.getSentMessages()
      expect(sent).toHaveLength(1)
      expect(sent[0].to).toBe('buyer@example.com')
      expect(sent[0].subject).toBe('Đơn hàng mới #ORD-123')
    })

    it('simulates failure when requested without crashing', async () => {
      mockAdapter.simulateFailure('SMTP connection timeout')

      const result = await mockAdapter.send({
        to: 'buyer@example.com',
        subject: 'Thử nghiệm lỗi',
        html: '<p>Test</p>',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('SMTP connection timeout')
      expect(mockAdapter.getSentMessages()).toHaveLength(0)

      const nextResult = await mockAdapter.send({
        to: 'buyer@example.com',
        subject: 'Thử nghiệm phục hồi',
        html: '<p>Test OK</p>',
      })
      expect(nextResult.success).toBe(true)
    })

    it('clears recorded messages on clear()', async () => {
      await mockAdapter.send({
        to: 'buyer@example.com',
        subject: 'Test 1',
        html: '<p>1</p>',
      })
      expect(mockAdapter.getSentMessages()).toHaveLength(1)

      mockAdapter.clear()
      expect(mockAdapter.getSentMessages()).toHaveLength(0)
      expect(mockAdapter.getLastMessage()).toBeUndefined()
    })

    it('getEmailAdapter returns MockEmailAdapter in local test environment', () => {
      delete process.env.VERCEL
      delete process.env.VERCEL_ENV
      const adapter = getEmailAdapter()
      expect(adapter).toBeInstanceOf(MockEmailAdapter)
    })

    it('NEVER falls back to MockEmailAdapter on Vercel Preview/Production when SMTP is missing', async () => {
      process.env.VERCEL = '1'
      process.env.VERCEL_ENV = 'preview'
      process.env.EMAIL_PROVIDER = 'mock' // Kể cả khi cấu hình nhầm mock trên Vercel vẫn phải chặn
      delete process.env.SMTP_HOST
      delete process.env.SMTP_PORT
      delete process.env.SMTP_USER
      delete process.env.SMTP_PASS

      const adapter = getEmailAdapter()
      expect(adapter).toBeInstanceOf(UnconfiguredEmailAdapter)
      expect(adapter).not.toBeInstanceOf(MockEmailAdapter)

      const sendRes = await adapter.send({
        to: 'buyer@example.com',
        subject: 'Test Preview',
        html: '<p>Preview</p>',
      })
      expect(sendRes.success).toBe(false)
      expect(sendRes.skipped).toBe(true)
      expect(sendRes.skipReason).toBe('MISSING_SMTP_CONFIG')
    })

    it('validates all required SMTP variables (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)', () => {
      process.env.SMTP_HOST = 'smtp.resend.com'
      process.env.SMTP_USER = 'resend'
      delete process.env.SMTP_PORT
      delete process.env.SMTP_PASS

      const partialValidation = validateSmtpConfig()
      expect(partialValidation.valid).toBe(false)
      expect(partialValidation.missingKeys).toContain('SMTP_PORT')
      expect(partialValidation.missingKeys).toContain('SMTP_PASS')

      process.env.SMTP_PORT = '465'
      process.env.SMTP_PASS = 're_secret_api_key_123'
      const fullValidation = validateSmtpConfig()
      expect(fullValidation.valid).toBe(true)
      expect(fullValidation.missingKeys).toHaveLength(0)

      process.env.VERCEL = '1'
      expect(getEmailAdapter()).toBeInstanceOf(NodemailerAdapter)
    })

    it('redacts SMTP credentials from error messages', () => {
      process.env.SMTP_USER = 'b2b_smtp_user'
      process.env.SMTP_PASS = 'super_secret_password_999'

      const rawError = new Error(
        'Invalid login for b2b_smtp_user using password super_secret_password_999 at smtp://b2b_smtp_user:super_secret_password_999@smtp.example.com'
      )
      const sanitized = sanitizeSmtpError(rawError)

      expect(sanitized).not.toContain('super_secret_password_999')
      expect(sanitized).not.toContain('b2b_smtp_user')
      expect(sanitized).toContain('[REDACTED]')
    })

    it('enforces SMTP timeout so Serverless actions never hang indefinitely', async () => {
      process.env.SMTP_HOST = 'smtp.example.com'
      process.env.SMTP_PORT = '587'
      process.env.SMTP_USER = 'user@example.com'
      process.env.SMTP_PASS = 'secret123'

      const adapter = new NodemailerAdapter(40) // Timeout ngắn 40ms để kiểm thử
      // Ghi đè getTransporter nội bộ trả về sendMail bị treo 500ms
      const closeSpy = vi.fn()
      ;(adapter as unknown as { transporter: unknown }).transporter = {
        sendMail: () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ messageId: 'late' }), 500)
          ),
        close: closeSpy,
      }

      const result = await adapter.send({
        to: 'buyer@example.com',
        subject: 'Timeout test',
        html: '<p>Timeout</p>',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('SMTP_TIMEOUT')
      expect(closeSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('Service Reliability: MISSING_SMTP_CONFIG, Retry after Skip/Fail & Sequential Dedup', () => {
    it('records EMAIL_SKIPPED with MISSING_SMTP_CONFIG on Vercel without SMTP and does NOT record EMAIL_SENT', async () => {
      process.env.VERCEL = '1'
      process.env.VERCEL_ENV = 'preview'
      delete process.env.SMTP_HOST
      delete process.env.SMTP_PORT
      delete process.env.SMTP_USER
      delete process.env.SMTP_PASS

      const result = await sendOrderNotification({
        type: 'ORDER_PLACED',
        orderId: 'order-123',
      })

      expect(result.success).toBe(false)
      expect(result.skipped).toBe(true)
      expect(result.skipReason).toBe('MISSING_SMTP_CONFIG')

      // Kiểm tra OrderEvent: Chỉ ghi EMAIL_SKIPPED_ORDER_PLACED, tuyệt đối không có EMAIL_SENT_ORDER_PLACED
      expect(mockOrderEvents).toHaveLength(1)
      expect(mockOrderEvents[0].type).toBe('EMAIL_SKIPPED_ORDER_PLACED')
      expect(mockOrderEvents[0].note).toContain('MISSING_SMTP_CONFIG')
      expect(
        mockOrderEvents.some((e) => e.type.startsWith('EMAIL_SENT_'))
      ).toBe(false)
    })

    it('allows future send to succeed after previous MISSING_SMTP_CONFIG or FAILED attempt, then deduplicates subsequent calls', async () => {
      // Lần 1: Chưa cấu hình SMTP -> Gặp MISSING_SMTP_CONFIG (ghi EMAIL_SKIPPED_ORDER_PLACED)
      const unconfiguredAdapter = new UnconfiguredEmailAdapter([
        'SMTP_HOST',
        'SMTP_PORT',
      ])
      const firstAttempt = await sendOrderNotification(
        { type: 'ORDER_PLACED', orderId: 'order-123' },
        { adapter: unconfiguredAdapter }
      )
      expect(firstAttempt.success).toBe(false)
      expect(firstAttempt.skipReason).toBe('MISSING_SMTP_CONFIG')
      expect(mockOrderEvents).toHaveLength(1)
      expect(mockOrderEvents[0].type).toBe('EMAIL_SKIPPED_ORDER_PLACED')

      // Lần 2: SMTP gặp lỗi mạng tạm thời -> Ghi EMAIL_FAILED_ORDER_PLACED
      mockAdapter.simulateFailure('Connection reset by peer')
      const secondAttempt = await sendOrderNotification(
        { type: 'ORDER_PLACED', orderId: 'order-123' },
        { adapter: mockAdapter }
      )
      expect(secondAttempt.success).toBe(false)
      expect(mockOrderEvents).toHaveLength(2)
      expect(mockOrderEvents[1].type).toBe('EMAIL_FAILED_ORDER_PLACED')

      // Lần 3: SMTP đã hoạt động -> Không bị chặn bởi SKIPPED/FAILED trước đó, gửi thành công và ghi EMAIL_SENT_ORDER_PLACED
      const thirdAttempt = await sendOrderNotification(
        { type: 'ORDER_PLACED', orderId: 'order-123' },
        { adapter: mockAdapter }
      )
      expect(thirdAttempt.success).toBe(true)
      expect(mockAdapter.getSentMessages()).toHaveLength(1)
      expect(mockOrderEvents).toHaveLength(3)
      expect(mockOrderEvents[2].type).toBe('EMAIL_SENT_ORDER_PLACED')

      // Lần 4: Gọi lại tuần tự sau khi đã EMAIL_SENT -> Bị chặn bởi Sequential Deduplication
      const fourthAttempt = await sendOrderNotification(
        { type: 'ORDER_PLACED', orderId: 'order-123' },
        { adapter: mockAdapter }
      )
      expect(fourthAttempt.success).toBe(true)
      expect(fourthAttempt.skipped).toBe(true)
      expect(fourthAttempt.skipReason).toContain('ALREADY_SENT')
      expect(mockAdapter.getSentMessages()).toHaveLength(1) // Không gửi thêm email thứ 2
    })

    it('supports all events E01-E06 and REFUND_CONFIRMED end-to-end via sendOrderNotification', async () => {
      const events = [
        { type: 'ORDER_PLACED' as const, orderId: 'order-123' },
        {
          type: 'PAYMENT_CONFIRMED' as const,
          orderId: 'order-123',
          transactionId: 'tx-456',
        },
        {
          type: 'ORDER_SHIPPING' as const,
          orderId: 'order-123',
          shipmentId: 'ship-789',
        },
        { type: 'ORDER_COMPLETED' as const, orderId: 'order-123' },
        {
          type: 'COMPLAINT_OPENED' as const,
          orderId: 'order-123',
          complaintId: 'comp-001',
        },
        {
          type: 'COMPLAINT_RESOLVED' as const,
          orderId: 'order-123',
          complaintId: 'comp-001',
        },
        {
          type: 'REFUND_CONFIRMED' as const,
          orderId: 'order-123',
          transactionId: 'tx-refund-999',
        },
      ]

      for (const evt of events) {
        const res = await sendOrderNotification(evt, { adapter: mockAdapter })
        expect(res.success).toBe(true)
      }

      expect(mockAdapter.getSentMessages()).toHaveLength(7)
      expect(mockOrderEvents).toHaveLength(7)
      expect(
        mockOrderEvents.every((e) => e.type.startsWith('EMAIL_SENT_'))
      ).toBe(true)
    })
  })

  describe('E01 — ORDER_PLACED Template', () => {
    it('renders order placed template with full item list and deposit', () => {
      const rendered = renderOrderPlacedTemplate({
        order: baseOrder,
        user: baseUser,
        items: [
          {
            productName: 'Xoài Cát Hòa Lộc',
            packagingName: 'Thùng 10kg Loại 1',
            quantity: 5,
            orderedGrams: 50000,
            unitPricePerKg: 65000,
            lineTotal: 3250000,
            isSample: false,
          },
          {
            productName: 'Thanh Long Ruột Đỏ',
            packagingName: 'Thùng 20kg',
            quantity: 2,
            orderedGrams: 40000,
            unitPricePerKg: 35000,
            lineTotal: 1400000,
            isSample: false,
          },
        ],
      })

      expect(rendered.subject).toContain('ORD-2026-001')
      expect(rendered.subject).toContain('Xác nhận đặt hàng thành công')
      expect(rendered.html).toContain('Công ty Thực Phẩm Xanh')
      expect(rendered.html).toContain('ORD-2026-001')
      expect(rendered.html).toContain('Xoài Cát Hòa Lộc')
      expect(rendered.html).toContain('Thùng 10kg Loại 1')
      expect(rendered.html).toContain('Thanh Long Ruột Đỏ')
      expect(rendered.html).toContain('4.800.000 đ')
      expect(rendered.html).toContain('1.440.000 đ')
      expect(rendered.html).toContain('123 Đường Số 7')
      expect(rendered.text).toContain('ORD-2026-001')
      expect(rendered.text).toContain('4.800.000 đ')
      expect(rendered.text).toContain('1.440.000 đ')
    })
  })

  describe('E02 — PAYMENT_CONFIRMED Template', () => {
    it('renders payment confirmed template with remaining balance and transaction code', () => {
      const rendered = renderPaymentConfirmedTemplate({
        order: {
          ...baseOrder,
          status: OrderStatus.PROCESSING,
        },
        user: baseUser,
        transaction: {
          id: 'tx-vqr-8899',
          amount: 2000000,
          method: 'Chuyển khoản VietQR',
          reference: 'TX-VQR-8899',
          completedAt: new Date('2026-10-20T14:30:00Z'),
        },
      })

      expect(rendered.subject).toContain('ORD-2026-001')
      expect(rendered.subject).toContain('Xác nhận thanh toán thành công')
      expect(rendered.html).toContain('Công ty Thực Phẩm Xanh')
      expect(rendered.html).toContain('2.000.000 đ')
      expect(rendered.html).toContain('TX-VQR-8899')
      expect(rendered.html).toContain('Chuyển khoản VietQR')
      expect(rendered.html).toContain('Đang chuẩn bị hàng (PROCESSING)')
      expect(rendered.text).toContain('2.000.000 đ')
      expect(rendered.text).toContain('ORD-2026-001')
    })
  })

  describe('E03 — ORDER_SHIPPING Template', () => {
    it('renders shipping dispatch template with driver and license plate info', () => {
      const rendered = renderOrderShippingTemplate({
        order: {
          ...baseOrder,
          status: OrderStatus.SHIPPING,
        },
        user: baseUser,
        shipment: {
          code: 'SHIP-ORD-2026-001',
          vehicleType: VehicleType.COLD,
          driverName: 'Nguyễn Văn Tài',
          driverPhone: '0901234567',
          licensePlate: '51C-998.22',
        },
      })

      expect(rendered.subject).toContain('ORD-2026-001')
      expect(rendered.subject).toContain('đang trên đường giao')
      expect(rendered.html).toContain('Nguyễn Văn Tài')
      expect(rendered.html).toContain('0901234567')
      expect(rendered.html).toContain('51C-998.22')
      expect(rendered.html).toContain('Xe tải lạnh chuyên dụng')
      expect(rendered.text).toContain('Nguyễn Văn Tài - SĐT: 0901234567')
      expect(rendered.text).toContain('Biển số: 51C-998.22')
    })
  })

  describe('E04 — ORDER_COMPLETED Template (PH9-00 & 24h Window)', () => {
    it('prominently features the 24-hour complaint deadline window from deliveredAt', () => {
      const deliveredDate = new Date('2026-10-20T10:00:00.000Z')
      const rendered = renderOrderCompletedTemplate({
        order: {
          ...baseOrder,
          status: OrderStatus.COMPLETED,
          deliveredAt: deliveredDate,
          finalTotal: 12500000,
        },
        user: baseUser,
        items: [
          {
            productName: 'Bơ Sáp 034',
            packagingName: 'Sọt 25kg',
            orderedGrams: 50000,
            actualGrams: 49200,
            lineTotal: 5000000,
            finalLineTotal: 4920000,
          },
        ],
      })

      expect(rendered.subject).toContain('ORD-2026-001')
      expect(rendered.subject).toContain('Giao hàng thành công & Hoàn tất')
      expect(rendered.html).toContain('THỜI HẠN KHIẾU NẠI 24 GIỜ')
      expect(rendered.html).toContain('đúng 24 giờ kể từ thời điểm nhận hàng')
      expect(rendered.html).toContain('Sau đúng 24h00m00s, cổng khiếu nại sẽ tự động đóng lại')
      expect(rendered.html).toContain('Bơ Sáp 034')
      expect(rendered.html).toContain('12.500.000 đ')
      expect(rendered.text).toContain('LƯU Ý: Quý khách có đúng 24 giờ')
      expect(rendered.text).toContain('12.500.000 đ')
    })
  })

  describe('E05 — COMPLAINT_OPENED Template', () => {
    it('renders complaint opened template with complaint ID and description', () => {
      const rendered = renderComplaintOpenedTemplate({
        order: {
          ...baseOrder,
          status: OrderStatus.COMPLAINT,
        },
        user: baseUser,
        complaint: {
          id: 'KN-998811',
          reportedGrams: 5000,
          description: 'Phát hiện 5kg dưa hấu bị nứt vỏ do vận chuyển',
          photosCount: 2,
          itemProductName: 'Dưa Hấu Không Hạt',
        },
      })

      expect(rendered.subject).toContain('ORD-2026-001')
      expect(rendered.subject).toContain('tiếp nhận khiếu nại')
      expect(rendered.html).toContain('Phát hiện 5kg dưa hấu bị nứt vỏ do vận chuyển')
      expect(rendered.text).toContain('ORD-2026-001')
    })
  })

  describe('E06 — COMPLAINT_RESOLVED & REFUND Templates', () => {
    it('renders complaint resolved template with refund resolution and compensation amount', () => {
      const rendered = renderComplaintResolvedTemplate({
        order: {
          ...baseOrder,
          status: OrderStatus.COMPLAINT,
        },
        user: baseUser,
        complaint: {
          id: 'KN-112233',
          resolution: Resolution.REFUND,
          compensation: 750000,
          note: 'Đồng ý bồi hoàn 100% phần hoa quả dập hỏng',
        },
      })

      expect(rendered.subject).toContain('ORD-2026-001')
      expect(rendered.subject).toContain('Kết quả giải quyết khiếu nại')
      expect(rendered.html).toContain('CHẤP THUẬN BỒI HOÀN TIỀN MẶT')
      expect(rendered.html).toContain('750.000 đ')
      expect(rendered.html).toContain('Tiến độ hoàn tiền:')
      expect(rendered.text).toContain('Chấp thuận bồi hoàn tiền mặt')
    })

    it('renders complaint resolved template with REJECTED resolution', () => {
      const rendered = renderComplaintResolvedTemplate({
        order: {
          ...baseOrder,
          status: OrderStatus.COMPLETED,
        },
        user: baseUser,
        complaint: {
          id: 'KN-445566',
          resolution: 'REJECTED',
          note: 'Yêu cầu gửi quá thời hạn 24 giờ kể từ khi ký nhận giao hàng',
        },
      })

      expect(rendered.html).toContain('TỪ CHỐI BỒI HOÀN')
      expect(rendered.html).toContain('Yêu cầu gửi quá thời hạn 24 giờ')
      expect(rendered.text).toContain('Từ chối yêu cầu khiếu nại')
    })

    it('renders complaint resolved template with REPLACE resolution', () => {
      const rendered = renderComplaintResolvedTemplate({
        order: {
          ...baseOrder,
          status: OrderStatus.COMPLETED,
        },
        user: baseUser,
        complaint: {
          id: 'KN-778899',
          resolution: Resolution.REPLACE,
          note: 'Bù 15kg thanh long vào chuyến giao hàng định kỳ tiếp theo',
        },
      })

      expect(rendered.html).toContain('CHẤP THUẬN BÙ HÀNG')
      expect(rendered.html).toContain('đóng gói bù thêm và giao kèm miễn phí')
      expect(rendered.text).toContain('Chấp thuận bù hàng')
    })

    it('renders refund confirmed template when money transfer completes', () => {
      const rendered = renderRefundConfirmedTemplate({
        order: {
          ...baseOrder,
          status: OrderStatus.COMPLETED,
        },
        user: baseUser,
        transaction: {
          id: 'tx-refund-7788',
          amount: 1200000,
          completedAt: new Date('2026-10-20T16:30:00Z'),
          note: 'Chuyển khoản hoàn tiền khiếu nại qua Vietcombank',
        },
      })

      expect(rendered.subject).toContain('ORD-2026-001')
      expect(rendered.subject).toContain('Hoàn tất chuyển khoản bồi hoàn')
      expect(rendered.html).toContain('ĐÃ HOÀN TẤT CHUYỂN KHOẢN TIỀN BỒI HOÀN')
      expect(rendered.html).toContain('1.200.000 đ')
      expect(rendered.html).toContain('Chuyển khoản hoàn tiền khiếu nại qua Vietcombank')
      expect(rendered.text).toContain('1.200.000 đ')
    })
  })

  describe('Deduplication & Idempotency Key Computation', () => {
    it('computes order-level idempotency key for ORDER_PLACED', () => {
      const key = computeIdempotencyKey({
        type: 'ORDER_PLACED',
        orderId: 'order-123',
      })
      expect(key).toBe('EMAIL_SENT_ORDER_PLACED')
    })

    it('computes order-level idempotency key for ORDER_COMPLETED', () => {
      const key = computeIdempotencyKey({
        type: 'ORDER_COMPLETED',
        orderId: 'order-123',
      })
      expect(key).toBe('EMAIL_SENT_ORDER_COMPLETED')
    })

    it('computes transaction-scoped idempotency key for PAYMENT_CONFIRMED', () => {
      const key = computeIdempotencyKey({
        type: 'PAYMENT_CONFIRMED',
        orderId: 'order-123',
        transactionId: 'tx-456',
      })
      expect(key).toBe('EMAIL_SENT_PAYMENT_CONFIRMED_tx-456')
    })

    it('computes shipment-scoped idempotency key for ORDER_SHIPPING', () => {
      const key = computeIdempotencyKey({
        type: 'ORDER_SHIPPING',
        orderId: 'order-123',
        shipmentId: 'ship-789',
      })
      expect(key).toBe('EMAIL_SENT_ORDER_SHIPPING_ship-789')
    })

    it('computes complaint-scoped idempotency key for COMPLAINT_OPENED and COMPLAINT_RESOLVED', () => {
      const openKey = computeIdempotencyKey({
        type: 'COMPLAINT_OPENED',
        orderId: 'order-123',
        complaintId: 'comp-001',
      })
      expect(openKey).toBe('EMAIL_SENT_COMPLAINT_OPENED_comp-001')

      const resolveKey = computeIdempotencyKey({
        type: 'COMPLAINT_RESOLVED',
        orderId: 'order-123',
        complaintId: 'comp-001',
      })
      expect(resolveKey).toBe('EMAIL_SENT_COMPLAINT_RESOLVED_comp-001')
    })

    it('computes refund-scoped idempotency key for REFUND_CONFIRMED', () => {
      const key = computeIdempotencyKey({
        type: 'REFUND_CONFIRMED',
        orderId: 'order-123',
        transactionId: 'tx-refund-999',
      })
      expect(key).toBe('EMAIL_SENT_REFUND_CONFIRMED_tx-refund-999')
    })
  })
})
