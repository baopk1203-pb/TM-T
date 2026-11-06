import { NextRequest, NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { Role } from '@prisma/client'
import { getComplaintPhoto, parseComplaintPhotoKey } from '@/lib/storage'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user) {
      return new NextResponse('Vui lòng đăng nhập để xem ảnh khiếu nại', {
        status: 401,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }

    const url = req.nextUrl || new URL(req.url)
    const key = url.searchParams.get('key')
    if (!key || typeof key !== 'string') {
      return new NextResponse('Thiếu tham số mã ảnh (key)', {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }

    const parsed = parseComplaintPhotoKey(key)
    if (!parsed) {
      return new NextResponse('Định dạng mã ảnh không hợp lệ', {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }

    // Truy vấn đơn hàng trong database để kiểm tra quyền sở hữu
    const order = await db.order.findUnique({
      where: { id: parsed.orderId },
      select: {
        id: true,
        userId: true,
      },
    })

    if (!order) {
      return new NextResponse('Không tìm thấy đơn hàng tương ứng', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }

    const isOwner = order.userId === session.user.id
    const isAdmin = session.user.role === Role.ADMIN

    if (!isOwner && !isAdmin) {
      return new NextResponse('Bạn không có quyền truy cập ảnh khiếu nại của đơn hàng này', {
        status: 403,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }

    // Lấy luồng dữ liệu ảnh từ storage
    const photo = await getComplaintPhoto(key)
    if (!photo) {
      return new NextResponse('Ảnh khiếu nại không tồn tại hoặc đã bị xóa', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }

    // Trả về stream với các header bảo mật nghiêm ngặt
    return new Response(photo.stream as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': photo.contentType,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        ...(photo.size ? { 'Content-Length': String(photo.size) } : {}),
      },
    })
  } catch (err: unknown) {
    console.error('Error serving complaint photo:', err)
    return new NextResponse('Lỗi máy chủ khi tải ảnh khiếu nại', {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}
