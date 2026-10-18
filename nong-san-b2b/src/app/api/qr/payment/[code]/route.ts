import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { db } from '@/lib/db'
import { buildVietQREmvcoPayload } from '@/lib/vietqr-payload'
import { getServerAuthSession } from '@/lib/auth'
import { computePayableAmount } from '@/lib/domain/settlement'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params
    if (!code) {
      return new NextResponse('Thiếu mã đơn hàng', { status: 400 })
    }

    // 1. Kiểm tra xác thực (Authentication)
    const session = await getServerAuthSession()
    if (!session?.user?.id) {
      return new NextResponse('Bạn cần đăng nhập để xem mã QR thanh toán', { status: 401 })
    }

    // 2. Truy vấn đơn hàng kèm các giao dịch thanh toán thực tế
    const order = await db.order.findUnique({
      where: { code },
      select: {
        id: true,
        code: true,
        userId: true,
        status: true,
        total: true,
        depositAmount: true,
        finalTotal: true,
        paymentOption: true,
        transactions: {
          select: {
            type: true,
            status: true,
            amount: true,
          },
        },
      },
    })

    if (!order) {
      return new NextResponse('Không tìm thấy đơn hàng', { status: 404 })
    }

    // 3. Phân quyền (RBAC): Chỉ chủ đơn hàng hoặc Admin mới có quyền truy cập
    if (order.userId !== session.user.id && session.user.role !== 'ADMIN') {
      return new NextResponse(
        'Bạn không có quyền xem thông tin thanh toán của đơn hàng này',
        { status: 403 }
      )
    }

    // 4. Tính toán số tiền thực tế còn phải thanh toán và kiểm tra trạng thái đơn
    const payable = computePayableAmount(order, order.transactions)
    if (!payable.isPayable || payable.amountToPay <= 0) {
      return new NextResponse(
        payable.reason || 'Đơn hàng không ở trạng thái cần thanh toán',
        { status: 400 }
      )
    }

    const bankBin = process.env.VIETQR_BANK_BIN || '970422'
    const accountNo = process.env.VIETQR_ACCOUNT_NO || '0123456789'
    const accountName = process.env.VIETQR_ACCOUNT_NAME || 'CONG TY NONG SAN B2B'
    const amountToPay = payable.amountToPay

    // 5. Sinh payload chuẩn VietQR / EMVCo theo Quyết định 1753/QĐ-NHNN (SRC-QR-08)
    const qrData = buildVietQREmvcoPayload({
      bankBin,
      accountNo,
      amount: amountToPay,
      orderCode: order.code,
      accountName,
    })

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

    // 6. Header bảo mật: Không cache dữ liệu thanh toán nhạy cảm (no-store, private)
    return new NextResponse(new Uint8Array(qrBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, no-cache, no-store, max-age=0, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    })
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : 'Lỗi khi tạo mã QR thanh toán offline'
    return new NextResponse(message, { status: 500 })
  }
}
