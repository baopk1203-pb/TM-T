import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params
    if (!code) {
      return new NextResponse('Thiếu mã định danh lô hàng', { status: 400 })
    }

    const appUrl =
      process.env.APP_URL ||
      process.env.NEXTAUTH_URL ||
      'http://localhost:3000'

    // URL truy xuất nguồn gốc công khai cho lô hàng
    const targetUrl = `${appUrl.replace(/\/$/, '')}/truy-xuat/${encodeURIComponent(code)}`

    // Sinh QR dạng buffer PNG
    const qrBuffer = await QRCode.toBuffer(targetUrl, {
      type: 'png',
      width: 400,
      margin: 2,
      color: {
        dark: '#0f172a', // slate-900
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })

    const isDownload = req.nextUrl.searchParams.get('download') === '1'

    return new NextResponse(new Uint8Array(qrBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `${isDownload ? 'attachment' : 'inline'}; filename="QR-${code}.png"`,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=43200',
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Lỗi khi tạo mã QR'
    return new NextResponse(message, { status: 500 })
  }
}
