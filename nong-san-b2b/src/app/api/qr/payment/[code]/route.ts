import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { db } from '@/lib/db'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params
    if (!code) {
      return new NextResponse('Thiếu mã đơn hàng', { status: 400 })
    }

    const order = await db.order.findUnique({
      where: { code },
      select: {
        code: true,
        total: true,
        depositAmount: true,
        paymentOption: true,
      },
    })

    if (!order) {
      return new NextResponse('Không tìm thấy đơn hàng', { status: 404 })
    }

    const bankBin = process.env.VIETQR_BANK_BIN || '970422'
    const accountNo = process.env.VIETQR_ACCOUNT_NO || '0123456789'
    const accountName = process.env.VIETQR_ACCOUNT_NAME || 'CONG TY NONG SAN B2B'
    const amountToPay =
      order.paymentOption === 'DEPOSIT_30' ? order.depositAmount : order.total

    // VietQR Payload / Chuyển khoản nội bộ offline
    // Định dạng nội dung chuyển khoản rõ ràng hỗ trợ quét offline
    const qrData = `VIETQR|${bankBin}|${accountNo}|${amountToPay}|${order.code}|${accountName}`

    const qrBuffer = await QRCode.toBuffer(qrData, {
      type: 'png',
      width: 400,
      margin: 2,
      color: {
        dark: '#0f172a', // slate-900
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })

    return new NextResponse(new Uint8Array(qrBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Lỗi khi tạo mã QR thanh toán offline'
    return new NextResponse(message, { status: 500 })
  }
}
