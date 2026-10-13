import { db } from '@/lib/db'
import { ComplaintListClient, AdminComplaintItem } from './complaint-list-client'

export const dynamic = 'force-dynamic'

export default async function AdminComplaintsPage() {
  const complaints = await db.complaint.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      order: {
        include: {
          user: true,
          items: true,
        },
      },
    },
  })

  const mappedComplaints: AdminComplaintItem[] = complaints.map((c) => {
    const item = c.order.items.find((i) => i.id === c.orderItemId)
    return {
      id: c.id,
      orderId: c.orderId,
      orderCode: c.order.code,
      orderItemId: c.orderItemId,
      productName: item?.productName ?? 'Sản phẩm',
      packagingName: item?.packagingName ?? '',
      unitPricePerKg: item?.unitPricePerKg ?? 0,
      itemActualGrams: item?.actualGrams ?? item?.orderedGrams ?? 0,
      reportedGrams: c.reportedGrams,
      verifiedGrams: c.verifiedGrams,
      description: c.description,
      photos: c.photos,
      status: c.status,
      resolution: c.resolution,
      compensation: c.compensation,
      adminNote: c.adminNote,
      createdAt: c.createdAt.toISOString(),
      resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
      user: {
        fullName: c.order.user.fullName,
        companyName: c.order.user.companyName,
        phone: c.order.user.phone,
      },
    }
  })

  return <ComplaintListClient initialComplaints={mappedComplaints} />
}
