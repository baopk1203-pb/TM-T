import { getAdminFarms } from '@/server/actions/farm'
import { FarmManagement } from './farm-management'

export const dynamic = 'force-dynamic'

export default async function AdminFarmsPage() {
  const farms = await getAdminFarms()

  return <FarmManagement initialFarms={farms} />
}
