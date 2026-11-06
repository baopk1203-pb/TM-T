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
          transactions: true,
        },
      },
    },
  })

  const mappedComplaints: AdminComplaintItem[] = complaints.map((c) => {
    const item = c.order.items.find((i) => i.id === c.orderItemId)
    const refundTx = c.order.transactions.find(
      (t) => t.type === 'REFUND' && t.reference === `COMPLAINT_${c.id}`
    )

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
      proposalType: c.proposalType,
      proposalAmount: c.proposalAmount,
      proposalNotes: c.proposalNotes,
      proposedAt: c.proposedAt ? c.proposedAt.toISOString() : null,
      reviewDueAt: c.reviewDueAt ? c.reviewDueAt.toISOString() : null,
      customerAcceptedAt: c.customerAcceptedAt ? c.customerAcceptedAt.toISOString() : null,
      reReviewCount: c.reReviewCount,
      reReviewReason: c.reReviewReason,
      reReviewedAt: c.reReviewedAt ? c.reReviewedAt.toISOString() : null,
      isFinalProposal: c.isFinalProposal,
      autoClosedAt: c.autoClosedAt ? c.autoClosedAt.toISOString() : null,
      refundTxStatus: refundTx ? refundTx.status : null,
    }
  })

  return <ComplaintListClient initialComplaints={mappedComplaints} />
}
