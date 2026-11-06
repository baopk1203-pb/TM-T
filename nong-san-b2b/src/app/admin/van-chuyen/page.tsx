import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { getWarehouseConfig, diagnoseShippingRates } from '@/lib/services/shipping-config'
import { DEFAULT_SHIPPING_RATES, VehicleType } from '@/lib/domain/shipping'
import {
  ShippingManagementClient,
  ShipmentListItem,
  ShippingRateItem,
} from './shipping-management-client'
import { OrderStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

export default async function AdminShippingPage() {
  await requireAdmin()

  const [orders, dbRates, warehouse] = await Promise.all([
    db.order.findMany({
      where: {
        status: {
          in: [
            OrderStatus.PROCESSING,
            OrderStatus.SHIPPING,
            OrderStatus.DELIVERED,
            OrderStatus.CANCELLED,
          ],
        },
      },
      include: {
        user: true,
        shipment: true,
        items: {
          include: {
            packaging: true,
            batch: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    db.shippingRate.findMany({
      orderBy: [{ vehicleType: 'asc' }, { minGrams: 'asc' }],
    }),
    getWarehouseConfig(),
  ])

  // Chuẩn hóa danh sách đơn vận chuyển
  const shipmentList: ShipmentListItem[] = orders.map((o) => {
    const address = (o.addressSnapshot ?? {}) as Record<string, string>
    const addressText = `${address.line || ''}, ${address.ward || ''}, ${address.district || ''}, ${address.province || ''}`.replace(/^[\s,]+|[\s,]+$/g, '')

    const totalGrams = o.items.reduce((sum, item) => sum + item.orderedGrams, 0)

    return {
      orderId: o.id,
      orderCode: o.code,
      customerName: address.recipient || o.user.fullName,
      companyName: o.user.companyName,
      phone: address.phone || o.user.phone,
      addressText: addressText || 'Địa chỉ chưa cập nhật',
      deliveryDate: o.deliveryDate ? o.deliveryDate.toISOString() : null,
      timeSlot: o.timeSlot,
      orderStatus: o.status,
      shippingVehicleType: o.shippingVehicleType || 'NORMAL',
      shippingDistanceKm: o.shippingDistanceKm,
      shippingFee: o.shippingFee,
      totalGrams,
      shipment: o.shipment
        ? {
            id: o.shipment.id,
            code: o.shipment.code,
            status: o.shipment.status,
            driverName: o.shipment.driverName,
            driverPhone: o.shipment.driverPhone,
            licensePlate: o.shipment.licensePlate,
            dispatchedAt: o.shipment.dispatchedAt ? o.shipment.dispatchedAt.toISOString() : null,
            deliveredAt: o.shipment.deliveredAt ? o.shipment.deliveredAt.toISOString() : null,
            note: o.shipment.note,
          }
        : null,
      items: o.items.map((i) => ({
        id: i.id,
        productName: i.productName,
        packagingName: i.packagingName,
        orderedGrams: i.orderedGrams,
        batchCode: i.batch?.code || null,
        isSample: i.isSample,
      })),
    }
  })

  // Chuẩn hóa danh sách bảng cước & chẩn đoán trạng thái cấu hình
  const configDiagnostic = diagnoseShippingRates(dbRates)
  const isUsingDefaultRates = configDiagnostic.isUsingDefaultRates
  const rateList: ShippingRateItem[] = isUsingDefaultRates
    ? DEFAULT_SHIPPING_RATES.map((r, index) => ({
        id: `default-${index}`,
        vehicleType: r.vehicleType as VehicleType,
        minGrams: r.minGrams,
        baseFee: r.baseFee,
        perKm: r.perKm,
        isActive: true,
      }))
    : dbRates.map((r) => ({
        id: r.id,
        vehicleType: r.vehicleType as VehicleType,
        minGrams: r.minGrams,
        baseFee: r.baseFee,
        perKm: r.perKm,
        isActive: r.isActive,
      }))

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <ShippingManagementClient
        shipments={shipmentList}
        rates={rateList}
        isUsingDefaultRates={isUsingDefaultRates}
        configDiagnostic={configDiagnostic}
        warehouse={warehouse}
      />
    </div>
  )
}
