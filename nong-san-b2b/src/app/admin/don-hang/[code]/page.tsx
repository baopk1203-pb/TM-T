import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { derivePaymentStatus } from '@/lib/domain/settlement'
import { processExpiredOrders } from '@/lib/services/order-expiration'
import { OrderDetailClient, OrderDetailData } from './order-detail-client'

export const dynamic = 'force-dynamic'

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params

  await processExpiredOrders(new Date()).catch(() => undefined)

  const [order, batches] = await Promise.all([
    db.order.findFirst({
      where: {
        OR: [{ code }, { id: code }],
      },
      include: {
        user: {
          include: {
            group: true,
          },
        },
        items: {
          include: {
            batch: true,
            packaging: {
              include: {
                product: true,
              },
            },
          },
        },
        transactions: {
          orderBy: { createdAt: 'desc' },
        },
        events: {
          orderBy: { createdAt: 'desc' },
        },
        complaints: {
          orderBy: { createdAt: 'desc' },
        },
        shipment: true,
      },
    }),
    db.batch.findMany({
      select: {
        id: true,
        code: true,
        productId: true,
        harvestDate: true,
        quantityGrams: true,
      },
      orderBy: { harvestDate: 'desc' },
    }),
  ])

  if (!order) {
    notFound()
  }

  const payment = derivePaymentStatus(
    {
      total: order.total,
      finalTotal: order.finalTotal,
      status: order.status,
    },
    order.transactions
  )

  interface AdminAddressSnapshot {
    recipient?: string
    phone?: string
    line?: string
    ward?: string
    district?: string
    province?: string
  }

  const addressSnapshot = (order.addressSnapshot as unknown as AdminAddressSnapshot) || {}

  const orderData: OrderDetailData = {
    id: order.id,
    code: order.code,
    type: order.type,
    status: order.status,
    paymentOption: order.paymentOption,
    groupDiscountPercent: order.groupDiscountPercent,
    deliveryDate: order.deliveryDate ? order.deliveryDate.toISOString() : null,
    timeSlot: order.timeSlot,
    subtotal: order.subtotal,
    shippingFee: order.shippingFee,
    total: order.total,
    depositAmount: order.depositAmount,
    finalSubtotal: order.finalSubtotal,
    finalTotal: order.finalTotal,
    paymentDueAt: order.paymentDueAt ? order.paymentDueAt.toISOString() : null,
    deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
    cancelledBy: order.cancelledBy,
    cancelReason: order.cancelReason,
    customerNote: order.customerNote,
    preorderFinalPricePerKg: order.preorderFinalPricePerKg,
    preorderFulfilledGrams: order.preorderFulfilledGrams,
    preorderCustomerDecision: order.preorderCustomerDecision,
    createdAt: order.createdAt.toISOString(),
    addressSnapshot: {
      recipient: addressSnapshot?.recipient ?? '',
      phone: addressSnapshot?.phone ?? '',
      line: addressSnapshot?.line ?? '',
      ward: addressSnapshot?.ward ?? '',
      district: addressSnapshot?.district ?? '',
      province: addressSnapshot?.province ?? '',
    },
    user: {
      id: order.user.id,
      fullName: order.user.fullName,
      email: order.user.email,
      phone: order.user.phone,
      companyName: order.user.companyName,
      groupName: order.user.group?.name ?? null,
      groupDiscount: order.user.group?.discountPercent ?? 0,
    },
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      packagingName: item.packagingName,
      isSample: item.isSample,
      quantity: item.quantity,
      orderedGrams: item.orderedGrams,
      unitPricePerKg: item.unitPricePerKg,
      preorderPricePerKg: item.packaging?.product?.preorderPricePerKg ?? item.unitPricePerKg,
      preorderBandPercent: item.packaging?.product?.preorderBandPercent ?? 10,
      lineTotal: item.lineTotal,
      actualGrams: item.actualGrams,
      finalLineTotal: item.finalLineTotal,
      batchId: item.batchId,
      batchCode: item.batch?.code ?? null,
    })),
    transactions: order.transactions.map((tx) => ({
      id: tx.id,
      type: tx.type,
      status: tx.status,
      method: tx.method,
      amount: tx.amount,
      reference: tx.reference,
      note: tx.note,
      createdAt: tx.createdAt.toISOString(),
      completedAt: tx.completedAt ? tx.completedAt.toISOString() : null,
    })),
    events: order.events.map((evt) => ({
      id: evt.id,
      type: evt.type,
      fromStatus: evt.fromStatus,
      toStatus: evt.toStatus,
      note: evt.note,
      actorId: evt.actorId,
      createdAt: evt.createdAt.toISOString(),
      payload: evt.payload,
    })),
    complaints: order.complaints.map((c) => ({
      id: c.id,
      orderItemId: c.orderItemId,
      description: c.description,
      photos: c.photos,
      reportedGrams: c.reportedGrams,
      verifiedGrams: c.verifiedGrams,
      status: c.status,
      resolution: c.resolution,
      compensation: c.compensation,
      adminNote: c.adminNote,
      createdAt: c.createdAt.toISOString(),
      resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
    })),
    paidAmount: payment.paidAmount,
    remainingAmount: payment.remainingAmount,
    grossPaid: payment.grossPaid,
    netPaid: payment.netPaid,
    refundedAmount: payment.refundedAmount,
    paymentStatus: payment.status,
    shippingDistanceKm: order.shippingDistanceKm,
    shippingVehicleType: order.shippingVehicleType,
    shipment: order.shipment
      ? {
          id: order.shipment.id,
          code: order.shipment.code,
          vehicleType: order.shipment.vehicleType,
          distanceKm: order.shipment.distanceKm,
          shippingFee: order.shipment.shippingFee,
          driverName: order.shipment.driverName,
          driverPhone: order.shipment.driverPhone,
          licensePlate: order.shipment.licensePlate,
          status: order.shipment.status,
          dispatchedAt: order.shipment.dispatchedAt ? order.shipment.dispatchedAt.toISOString() : null,
          deliveredAt: order.shipment.deliveredAt ? order.shipment.deliveredAt.toISOString() : null,
          note: order.shipment.note,
        }
      : null,
  }

  const mappedBatches = batches.map((b) => ({
    id: b.id,
    code: b.code,
    productId: b.productId,
    harvestDate: b.harvestDate.toISOString(),
    quantityGrams: b.quantityGrams,
  }))

  return <OrderDetailClient order={orderData} availableBatches={mappedBatches} />
}
