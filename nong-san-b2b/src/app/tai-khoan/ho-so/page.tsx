import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { ProfileForm } from './profile-form'

export default async function ProfilePage() {
  const session = await getServerAuthSession()
  if (!session?.user) {
    redirect('/dang-nhap')
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: { group: true },
  })

  if (!user) redirect('/dang-nhap')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Hồ sơ doanh nghiệp & đối tác
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Quản lý thông tin pháp nhân, mã số thuế và thông tin liên hệ đại diện
        </p>
      </div>

      <ProfileForm user={user} />
    </div>
  )
}
