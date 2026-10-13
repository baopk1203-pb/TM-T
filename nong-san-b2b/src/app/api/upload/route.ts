import { NextRequest, NextResponse } from 'next/server'
import { saveUpload } from '@/lib/storage'
import { getServerAuthSession } from '@/lib/auth'
import { Role } from '@prisma/client'

export async function POST(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user || session.user.role !== Role.ADMIN) {
      return NextResponse.json(
        { success: false, error: 'Chỉ quản trị viên mới có quyền tải ảnh lên' },
        { status: 403 }
      )
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'Vui lòng chọn file tải lên' },
        { status: 400 }
      )
    }

    const url = await saveUpload(file)
    return NextResponse.json({ success: true, url })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Lỗi máy chủ khi tải ảnh'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
}
