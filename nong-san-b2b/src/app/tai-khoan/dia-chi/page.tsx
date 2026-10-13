import { redirect } from 'next/navigation'
import { getServerAuthSession } from '@/lib/auth'
import { getUserAddresses } from '@/server/actions/user'
import { AddressList } from './address-list'

export default async function AddressBookPage() {
  const session = await getServerAuthSession()
  if (!session?.user) {
    redirect('/dang-nhap')
  }

  const addresses = await getUserAddresses()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Sổ địa chỉ nhận hàng
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Quản lý các điểm giao nhận, kho hàng, bãi tập kết để chọn nhanh khi tạo đơn hàng sỉ
        </p>
      </div>

      <AddressList initialAddresses={addresses} />
    </div>
  )
}
