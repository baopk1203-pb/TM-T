import { NextRequest, NextResponse } from 'next/server'
import { saveComplaintPhoto } from '@/lib/storage'
import { getServerAuthSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { Role, OrderStatus } from '@prisma/client'

export async function POST(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Vui lòng đăng nhập để tải ảnh khiếu nại' },
        { status: 401 }
      )
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const orderId = formData.get('orderId') as string | null

    // 1. Kiểm tra tham số orderId
    if (!orderId || typeof orderId !== 'string' || orderId.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Thiếu thông tin đơn hàng cần khiếu nại (orderId)' },
        { status: 400 }
      )
    }

    // 2. Truy vấn đơn hàng từ database để xác minh quyền hạn và điều kiện khiếu nại
    const order = await db.order.findUnique({
      where: { id: orderId.trim() },
      select: {
        id: true,
        userId: true,
        status: true,
        deliveredAt: true,
      },
    })

    if (!order) {
      return NextResponse.json(
        { success: false, error: 'Không tìm thấy đơn hàng cần khiếu nại' },
        { status: 404 }
      )
    }

    // 3. Kiểm tra phân quyền: Khách hàng sở hữu đơn hoặc Ban Quản Trị
    const isOwner = order.userId === session.user.id
    const isAdmin = session.user.role === Role.ADMIN

    if (!isOwner && !isAdmin) {
      return NextResponse.json(
        { success: false, error: 'Bạn không có quyền tải ảnh khiếu nại cho đơn hàng này' },
        { status: 403 }
      )
    }

    // 4. Kiểm tra điều kiện trạng thái đơn hàng (DELIVERED hoặc COMPLETED theo chuẩn PH9-00)
    const eligibleStatuses: OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.COMPLETED]
    if (!eligibleStatuses.includes(order.status)) {
      return NextResponse.json(
        {
          success: false,
          error: `Đơn hàng ở trạng thái "${order.status}" không đủ điều kiện khiếu nại (chỉ áp dụng cho đơn đã giao thành công)`,
        },
        { status: 400 }
      )
    }

    // 5. Kiểm tra thời hạn 24 giờ kể từ thời điểm giao hàng
    if (!order.deliveredAt) {
      return NextResponse.json(
        { success: false, error: 'Đơn hàng chưa ghi nhận thời điểm giao hàng thực tế' },
        { status: 400 }
      )
    }

    const now = new Date()
    const diffMs = now.getTime() - new Date(order.deliveredAt).getTime()
    if (diffMs < 0 || diffMs >= 24 * 60 * 60 * 1000) {
      return NextResponse.json(
        { success: false, error: 'Đã quá thời hạn khiếu nại 24 giờ kể từ thời điểm nhận hàng' },
        { status: 400 }
      )
    }

    // 6. Kiểm tra file upload
    if (!file) {
      return NextResponse.json(
        { success: false, error: 'Vui lòng chọn file ảnh tải lên' },
        { status: 400 }
      )
    }

    // 7. Thực hiện lưu trữ vào Private Blob Storage (hoặc mock local)
    const result = await saveComplaintPhoto(file, { orderId: order.id })

    return NextResponse.json({
      success: true,
      url: result.url,
      key: result.key,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Lỗi máy chủ khi tải ảnh khiếu nại'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
}
