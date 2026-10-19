import { requireAdmin } from '@/lib/auth'
import { getBusinessReports } from '@/server/reports'
import { ReportsClient } from './reports-client'

export const dynamic = 'force-dynamic'

export default async function AdminReportsPage() {
  await requireAdmin()

  const reportResult = await getBusinessReports({
    preset: '7D',
    grouping: 'DAY',
  })

  if (!reportResult.success || !reportResult.data) {
    return (
      <div className="p-8 text-center text-slate-500 text-sm">
        Không thể tải dữ liệu báo cáo kinh doanh: {reportResult.error || 'Lỗi không xác định'}
      </div>
    )
  }

  return <ReportsClient initialData={reportResult.data} />
}
