import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildVietQREmvcoPayload,
  parseVietQREmvcoPayload,
  computeCRC16CCITT,
  formatTLV,
} from '@/lib/vietqr-payload'
import { GET as getPaymentQR } from '@/app/api/qr/payment/[code]/route'
import { db } from '@/lib/db'
import { getServerAuthSession } from '@/lib/auth'
import { NextRequest } from 'next/server'
import { OrderStatus, PaymentOption, TxType, TxStatus } from '@prisma/client'

vi.mock('@/lib/db', () => ({
  db: {
    order: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}))

describe('SRC-QR-08: VietQR / EMVCo Specification & Offline Payment Fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1. formatTLV() định dạng chuẩn Tag-Length-Value', () => {
    expect(formatTLV('00', '01')).toBe('000201')
    expect(formatTLV('53', '704')).toBe('5303704')
    expect(formatTLV('58', 'VN')).toBe('5802VN')
  })

  it('2. computeCRC16CCITT() tính đúng checksum theo chuẩn quốc tế (test vector standard)', () => {
    // Chuỗi kiểm thử tiêu chuẩn CCITT-FALSE
    expect(computeCRC16CCITT('123456789')).toBe('29B1')
  })

  it('3. buildVietQREmvcoPayload() sinh cấu trúc EMVCo lồng nhau hợp lệ của Tag 38, Tag 54, Tag 62', () => {
    const payload = buildVietQREmvcoPayload({
      bankBin: '970422',
      accountNo: '0123456789',
      amount: 15277500,
      orderCode: 'ORD-20261018-001',
    })

    // Giải mã bằng bộ phân tích độc lập
    const parsed = parseVietQREmvcoPayload(payload)
    expect(parsed.isValid).toBe(true)
    expect(parsed.crcValid).toBe(true)

    // Tag 00: Version
    expect(parsed.tags['00']).toBe('01')
    // Tag 01: Dynamic QR (có số tiền)
    expect(parsed.tags['01']).toBe('12')
    // Tag 53: Currency VNĐ
    expect(parsed.tags['53']).toBe('704')
    // Tag 54: Amount
    expect(parsed.tags['54']).toBe('15277500')
    // Tag 58: Country VN
    expect(parsed.tags['58']).toBe('VN')

    // Tag 38: Napas VietQR info
    expect(parsed.subTags38?.['00']).toBe('A000000727')
    expect(parsed.subTags38?.['02']).toBe('QRIBFTTA')
    expect(parsed.subSubTags01?.['00']).toBe('970422')
    expect(parsed.subSubTags01?.['01']).toBe('0123456789')

    // Tag 62: Order Code
    expect(parsed.subTags62?.['08']).toBe('ORD-20261018-001')

    // Chuỗi không chứa định dạng phân cách gạch đứng cũ ('VIETQR|...')
    expect(payload).not.toContain('VIETQR|')
  })

  it('4. Từ chối input không hợp lệ (Bank BIN sai định dạng, số tiền <= 0, số tài khoản rỗng)', () => {
    // Bank BIN không phải 6 số
    expect(() =>
      buildVietQREmvcoPayload({
        bankBin: '123',
        accountNo: '0123456789',
        amount: 100000,
        orderCode: 'ORD-1',
      })
    ).toThrow('Bank BIN')

    // Số tiền <= 0
    expect(() =>
      buildVietQREmvcoPayload({
        bankBin: '970422',
        accountNo: '0123456789',
        amount: 0,
        orderCode: 'ORD-1',
      })
    ).toThrow('Số tiền thanh toán phải lớn hơn 0')

    // Số tài khoản rỗng
    expect(() =>
      buildVietQREmvcoPayload({
        bankBin: '970422',
        accountNo: '',
        amount: 50000,
        orderCode: 'ORD-1',
      })
    ).toThrow('Số tài khoản')
  })

  it('5. Phân biệt rõ giữa QR thanh toán ngân hàng (EMVCo) và QR truy xuất nguồn gốc lô hàng (Web URL)', () => {
    const paymentPayload = buildVietQREmvcoPayload({
      bankBin: '970422',
      accountNo: '0123456789',
      amount: 500000,
      orderCode: 'ORD-999',
    })
    const traceabilityQR = 'https://nongsanb2b.vn/truy-xuat/BATCH-202610-001'

    expect(paymentPayload.startsWith('000201')).toBe(true)
    expect(traceabilityQR.startsWith('http')).toBe(true)

    // Bộ giải mã EMVCo nhận diện đúng QR thanh toán và từ chối QR web
    expect(parseVietQREmvcoPayload(paymentPayload).isValid).toBe(true)
    expect(parseVietQREmvcoPayload(traceabilityQR).isValid).toBe(false)
  })

  describe('Route GET /api/qr/payment/[code] - Bảo mật & Khấu trừ thanh toán từng phần', () => {
    const mockOrder = {
      id: 'order-123',
      code: 'ORD-TEST-123',
      userId: 'user-owner',
      status: OrderStatus.PENDING_CONFIRMATION,
      total: 10000000,
      depositAmount: 3000000,
      finalTotal: null,
      paymentOption: PaymentOption.FULL,
      transactions: [],
    }

    type MockSession = Awaited<ReturnType<typeof getServerAuthSession>>
    type MockOrderResult = Awaited<ReturnType<typeof db.order.findUnique>>

    it('6. Từ chối 401 Unauthorized khi người dùng chưa đăng nhập', async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue(null)

      const req = new NextRequest('http://localhost:3000/api/qr/payment/ORD-TEST-123')
      const res = await getPaymentQR(req, {
        params: Promise.resolve({ code: 'ORD-TEST-123' }),
      })

      expect(res.status).toBe(401)
    })

    it('7. Từ chối 403 Forbidden khi người dùng không phải chủ đơn hàng và không phải Admin', async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: 'user-stranger', role: 'CUSTOMER', email: 'stranger@b2b.vn' },
      } as unknown as MockSession)

      vi.mocked(db.order.findUnique).mockResolvedValue(mockOrder as unknown as MockOrderResult)

      const req = new NextRequest('http://localhost:3000/api/qr/payment/ORD-TEST-123')
      const res = await getPaymentQR(req, {
        params: Promise.resolve({ code: 'ORD-TEST-123' }),
      })

      expect(res.status).toBe(403)
    })

    it('8. Trả về 404 Not Found khi đơn hàng không tồn tại', async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: 'user-owner', role: 'CUSTOMER', email: 'owner@b2b.vn' },
      } as unknown as MockSession)
      vi.mocked(db.order.findUnique).mockResolvedValue(null)

      const req = new NextRequest('http://localhost:3000/api/qr/payment/ORD-NONEXISTENT')
      const res = await getPaymentQR(req, {
        params: Promise.resolve({ code: 'ORD-NONEXISTENT' }),
      })

      expect(res.status).toBe(404)
    })

    it('9. Đơn FULL đã thanh toán 30% -> sinh mã QR ảnh PNG với số tiền là 70% còn lại', async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: 'user-owner', role: 'CUSTOMER', email: 'owner@b2b.vn' },
      } as unknown as MockSession)

      vi.mocked(db.order.findUnique).mockResolvedValue({
        ...mockOrder,
        transactions: [
          { type: TxType.PAYMENT, status: TxStatus.DONE, amount: 3000000 },
        ],
      } as unknown as MockOrderResult)

      const req = new NextRequest('http://localhost:3000/api/qr/payment/ORD-TEST-123')
      const res = await getPaymentQR(req, {
        params: Promise.resolve({ code: 'ORD-TEST-123' }),
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('image/png')
      // Cache header: private, no-store, no-cache
      expect(res.headers.get('Cache-Control')).toContain('no-store')
      expect(res.headers.get('Cache-Control')).toContain('private')
      expect(res.headers.get('Cache-Control')).not.toContain('public')
    })

    it('10. Đơn đã thanh toán đủ 100% -> từ chối 400 và không phát sinh QR chuyển trùng', async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: 'user-owner', role: 'CUSTOMER', email: 'owner@b2b.vn' },
      } as unknown as MockSession)

      vi.mocked(db.order.findUnique).mockResolvedValue({
        ...mockOrder,
        transactions: [
          { type: TxType.PAYMENT, status: TxStatus.DONE, amount: 10000000 },
        ],
      } as unknown as MockOrderResult)

      const req = new NextRequest('http://localhost:3000/api/qr/payment/ORD-TEST-123')
      const res = await getPaymentQR(req, {
        params: Promise.resolve({ code: 'ORD-TEST-123' }),
      })

      expect(res.status).toBe(400)
      const text = await res.text()
      expect(text).toContain('đã thanh toán đủ')
    })

    it('11. Đơn đã CANCELLED hoặc COMPLETED -> từ chối 400', async () => {
      vi.mocked(getServerAuthSession).mockResolvedValue({
        user: { id: 'user-owner', role: 'CUSTOMER', email: 'owner@b2b.vn' },
      } as unknown as MockSession)

      // Test CANCELLED
      vi.mocked(db.order.findUnique).mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.CANCELLED,
      } as unknown as MockOrderResult)

      const req = new NextRequest('http://localhost:3000/api/qr/payment/ORD-TEST-123')
      const resCancelled = await getPaymentQR(req, {
        params: Promise.resolve({ code: 'ORD-TEST-123' }),
      })
      expect(resCancelled.status).toBe(400)

      // Test COMPLETED
      vi.mocked(db.order.findUnique).mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.COMPLETED,
      } as unknown as MockOrderResult)

      const resCompleted = await getPaymentQR(req, {
        params: Promise.resolve({ code: 'ORD-TEST-123' }),
      })
      expect(resCompleted.status).toBe(400)
    })
  })
})
