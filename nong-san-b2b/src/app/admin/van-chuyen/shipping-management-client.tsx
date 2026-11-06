'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Truck,
  Plus,
  Edit2,
  Trash2,
  Settings,
  MapPin,
  RefreshCw,
  Search,
  Printer,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatVND } from '@/lib/money'
import { formatVietnamDate, formatDeliveryTimeSlot } from '@/lib/utils'
import { toast } from 'sonner'
import {
  createShippingRate,
  updateShippingRate,
  deleteShippingRate,
  updateWarehouseSettings,
  updateShipmentDriver,
  initializeDefaultShippingRates,
  CreateShippingRateInput,
  WarehouseSettingsInput,
} from '@/actions/shipping-admin'
import { transitionToShipping } from '@/actions/order-lifecycle'
import { PackingSlipModal, PackingSlipData } from '@/components/admin/packing-slip-modal'
import { OrderStatus, ShipmentStatus, VehicleType } from '@prisma/client'
import { ShippingConfigDiagnostic } from '@/lib/services/shipping-config'

export interface ShipmentListItem {
  orderId: string
  orderCode: string
  customerName: string
  companyName?: string | null
  phone: string
  addressText: string
  deliveryDate?: string | null
  timeSlot?: string | null
  orderStatus: OrderStatus
  shippingVehicleType: VehicleType
  shippingDistanceKm?: number | null
  shippingFee: number
  totalGrams: number
  shipment: {
    id: string
    code: string
    status: ShipmentStatus
    driverName?: string | null
    driverPhone?: string | null
    licensePlate?: string | null
    dispatchedAt?: string | null
    deliveredAt?: string | null
    note?: string | null
  } | null
  items: Array<{
    id: string
    productName: string
    packagingName: string
    orderedGrams: number
    batchCode?: string | null
    isSample: boolean
  }>
}

export interface ShippingRateItem {
  id: string
  vehicleType: VehicleType
  minGrams: number
  baseFee: number
  perKm: number
  isActive: boolean
}

export interface WarehouseSettingsData {
  name: string
  address: string
  lat: number
  lng: number
  maxRadiusKm: number
}

interface ShippingManagementClientProps {
  shipments: ShipmentListItem[]
  rates: ShippingRateItem[]
  isUsingDefaultRates: boolean
  configDiagnostic?: ShippingConfigDiagnostic
  warehouse: WarehouseSettingsData
}

export function ShippingManagementClient({
  shipments,
  rates,
  isUsingDefaultRates,
  configDiagnostic,
  warehouse,
}: ShippingManagementClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [activeTab, setActiveTab] = useState<'shipments' | 'rates' | 'warehouse'>('shipments')

  const diagnostic: ShippingConfigDiagnostic = configDiagnostic ?? {
    status: isUsingDefaultRates ? 'EMPTY_DB' : 'VALID',
    isUsingDefaultRates,
    hasNormalBase: true,
    hasColdBase: true,
    hasNormalBaseRecord: true,
    hasColdBaseRecord: true,
    missingBaseVehicleTypes: [],
    inactiveBaseVehicleTypes: [],
    totalRatesCount: rates.length,
    activeRatesCount: rates.filter((r) => r.isActive).length,
  }

  // Filters for Shipments tab
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [searchKeyword, setSearchKeyword] = useState<string>('')
  const [dateFilter, setDateFilter] = useState<string>('')

  // Modals state
  const [packingSlipData, setPackingSlipData] = useState<PackingSlipData | null>(null)
  const [packingSlipOpen, setPackingSlipOpen] = useState(false)

  // Dispatch modal (for PROCESSING orders)
  const [dispatchModalOpen, setDispatchModalOpen] = useState(false)
  const [selectedOrderForDispatch, setSelectedOrderForDispatch] = useState<ShipmentListItem | null>(null)
  const [dispatchForm, setDispatchForm] = useState({
    driverName: '',
    driverPhone: '',
    licensePlate: '',
    note: '',
  })

  // Edit Driver Modal (for SHIPPING orders)
  const [editDriverModalOpen, setEditDriverModalOpen] = useState(false)
  const [selectedShipmentForEdit, setSelectedShipmentForEdit] = useState<{
    id: string
    driverName: string
    driverPhone: string
    licensePlate: string
    note: string
  } | null>(null)

  // Rate CRUD Modal
  const [rateModalOpen, setRateModalOpen] = useState(false)
  const [editingRate, setEditingRate] = useState<ShippingRateItem | null>(null)
  const [rateForm, setRateForm] = useState<CreateShippingRateInput>({
    vehicleType: 'NORMAL',
    minGrams: 0,
    baseFee: 150000,
    perKm: 8000,
    isActive: true,
  })

  // Warehouse settings form
  const [warehouseForm, setWarehouseForm] = useState<WarehouseSettingsInput>({
    name: warehouse.name,
    address: warehouse.address,
    lat: warehouse.lat,
    lng: warehouse.lng,
    maxRadiusKm: warehouse.maxRadiusKm,
  })

  // Filtered shipments
  const filteredShipments = shipments.filter((item) => {
    // Status filter
    if (statusFilter === 'PROCESSING' && item.orderStatus !== 'PROCESSING') return false
    if (statusFilter === 'SHIPPING' && item.orderStatus !== 'SHIPPING') return false
    if (statusFilter === 'DELIVERED' && item.orderStatus !== 'DELIVERED') return false
    if (statusFilter === 'CANCELLED' && item.orderStatus !== 'CANCELLED') return false

    // Date filter
    if (dateFilter && item.deliveryDate && !item.deliveryDate.startsWith(dateFilter)) return false

    // Keyword search
    if (searchKeyword.trim()) {
      const kw = searchKeyword.toLowerCase().trim()
      const matchCode = item.orderCode.toLowerCase().includes(kw)
      const matchShipCode = item.shipment?.code.toLowerCase().includes(kw)
      const matchCustomer = item.customerName.toLowerCase().includes(kw)
      const matchDriver = item.shipment?.driverName?.toLowerCase().includes(kw)
      const matchPlate = item.shipment?.licensePlate?.toLowerCase().includes(kw)
      if (!matchCode && !matchShipCode && !matchCustomer && !matchDriver && !matchPlate) {
        return false
      }
    }

    return true
  })

  // Handlers
  const handleOpenDispatch = (item: ShipmentListItem) => {
    setSelectedOrderForDispatch(item)
    setDispatchForm({
      driverName: item.shipment?.driverName || '',
      driverPhone: item.shipment?.driverPhone || '',
      licensePlate: item.shipment?.licensePlate || '',
      note: item.shipment?.note || '',
    })
    setDispatchModalOpen(true)
  }

  const handleSubmitDispatch = () => {
    if (!selectedOrderForDispatch) return
    startTransition(async () => {
      const res = await transitionToShipping({
        orderId: selectedOrderForDispatch.orderId,
        driverName: dispatchForm.driverName,
        driverPhone: dispatchForm.driverPhone,
        licensePlate: dispatchForm.licensePlate,
        note: dispatchForm.note,
      })
      if (res.success) {
        toast.success(res.message || 'Đã bàn giao đơn hàng cho tài xế')
        setDispatchModalOpen(false)
        router.refresh()
      } else {
        toast.error(res.error || 'Có lỗi xảy ra khi bàn giao vận chuyển')
      }
    })
  }

  const handleOpenEditDriver = (item: ShipmentListItem) => {
    if (!item.shipment) return
    setSelectedShipmentForEdit({
      id: item.shipment.id,
      driverName: item.shipment.driverName || '',
      driverPhone: item.shipment.driverPhone || '',
      licensePlate: item.shipment.licensePlate || '',
      note: item.shipment.note || '',
    })
    setEditDriverModalOpen(true)
  }

  const handleSubmitEditDriver = () => {
    if (!selectedShipmentForEdit) return
    startTransition(async () => {
      const res = await updateShipmentDriver({
        shipmentId: selectedShipmentForEdit.id,
        driverName: selectedShipmentForEdit.driverName,
        driverPhone: selectedShipmentForEdit.driverPhone,
        licensePlate: selectedShipmentForEdit.licensePlate,
        note: selectedShipmentForEdit.note,
      })
      if (res.success) {
        toast.success(res.message || 'Đã cập nhật thông tin tài xế')
        setEditDriverModalOpen(false)
        router.refresh()
      } else {
        toast.error(res.error || 'Có lỗi khi cập nhật tài xế')
      }
    })
  }

  const handleOpenPackingSlip = (item: ShipmentListItem) => {
    setPackingSlipData({
      orderCode: item.orderCode,
      shipmentCode: item.shipment?.code || `SHIP-${item.orderCode}`,
      deliveryDate: item.deliveryDate,
      timeSlot: item.timeSlot,
      customerName: item.customerName,
      companyName: item.companyName,
      phone: item.phone,
      address: item.addressText,
      driverName: item.shipment?.driverName,
      driverPhone: item.shipment?.driverPhone,
      licensePlate: item.shipment?.licensePlate,
      vehicleType: item.shippingVehicleType,
      note: item.shipment?.note,
      items: item.items.map((i) => ({
        id: i.id,
        productName: i.productName,
        packagingName: i.packagingName,
        orderedKg: i.orderedGrams / 1000,
        batchCode: i.batchCode,
        isSample: i.isSample,
      })),
    })
    setPackingSlipOpen(true)
  }

  const handleInitDefaultRates = () => {
    if (
      !confirm(
        'Bạn có chắc chắn muốn khởi tạo 4 bậc cước vận chuyển chuẩn vào cơ sở dữ liệu? Sau khi khởi tạo, bạn có thể chỉnh sửa giá hoặc thêm các bậc tải trọng tùy chỉnh.'
      )
    ) {
      return
    }
    startTransition(async () => {
      const res = await initializeDefaultShippingRates()
      if (res.success) {
        toast.success(res.message)
        router.refresh()
      } else {
        toast.error(res.error || 'Lỗi khi khởi tạo cước mặc định')
      }
    })
  }

  const handleRecoverDefaultRates = () => {
    if (
      !confirm(
        'Hệ thống sẽ bổ sung các bậc cước mặc định còn thiếu vào cơ sở dữ liệu mà không ghi đè dữ liệu bạn đã tùy chỉnh. Bạn có chắc chắn muốn thực hiện?'
      )
    ) {
      return
    }
    startTransition(async () => {
      const res = await initializeDefaultShippingRates()
      if (res.success) {
        toast.success(res.message)
        router.refresh()
      } else {
        toast.error(res.error || 'Lỗi khi khôi phục cước mặc định')
      }
    })
  }

  const handleSaveRate = () => {
    startTransition(async () => {
      if (editingRate) {
        const res = await updateShippingRate({
          id: editingRate.id,
          baseFee: rateForm.baseFee,
          perKm: rateForm.perKm,
          isActive: rateForm.isActive ?? true,
        })
        if (res.success) {
          toast.success(res.message)
          setRateModalOpen(false)
          router.refresh()
        } else {
          toast.error(res.error)
        }
      } else {
        const res = await createShippingRate(rateForm)
        if (res.success) {
          toast.success(res.message)
          setRateModalOpen(false)
          router.refresh()
        } else {
          toast.error(res.error)
        }
      }
    })
  }

  const handleDeleteRate = (id: string) => {
    if (!confirm('Bạn có chắc chắn muốn xóa bậc cước này?')) return
    startTransition(async () => {
      const res = await deleteShippingRate(id)
      if (res.success) {
        toast.success(res.message)
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  const handleSaveWarehouse = () => {
    startTransition(async () => {
      const res = await updateWarehouseSettings(warehouseForm)
      if (res.success) {
        toast.success(res.message)
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 sm:p-7 rounded-3xl border border-slate-200/90 shadow-card">
        <div className="space-y-1">
          <h1 className="font-heading text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2.5">
            <Truck className="w-6 h-6 text-emerald-600" />
            Quản Lý Vận Chuyển &amp; Điều Phối Chuyến Giao
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Điều phối đội xe, theo dõi hành trình giao hàng B2B, quản lý bảng cước động và cấu hình kho.
          </p>
        </div>

        {/* Action button on top */}
        <div className="flex items-center gap-2 flex-wrap">
          {diagnostic.status === 'EMPTY_DB' && activeTab === 'rates' && (
            <Button
              size="sm"
              onClick={handleInitDefaultRates}
              disabled={isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 rounded-full px-4 h-9 shadow-btn-glow"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Khởi tạo 4 bậc cước mặc định vào DB
            </Button>
          )}

          {diagnostic.status === 'INVALID' &&
            diagnostic.missingBaseVehicleTypes.length > 0 &&
            activeTab === 'rates' && (
              <Button
                size="sm"
                onClick={handleRecoverDefaultRates}
                disabled={isPending}
                className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs gap-1.5 rounded-full px-4 h-9 shadow-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Bổ sung bậc cước mặc định còn thiếu
              </Button>
            )}

          {activeTab === 'rates' && (
            <Button
              size="sm"
              onClick={() => {
                if (diagnostic.status === 'EMPTY_DB') {
                  toast.error(
                    'Hệ thống đang dùng bảng cước mặc định. Vui lòng bấm "Khởi tạo 4 bậc cước mặc định vào DB" trước khi thêm bậc tùy chỉnh.'
                  )
                  return
                }
                setEditingRate(null)
                setRateForm({
                  vehicleType: 'NORMAL',
                  minGrams: 0,
                  baseFee: 150000,
                  perKm: 8000,
                  isActive: true,
                })
                setRateModalOpen(true)
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 rounded-full px-4 h-9 shadow-btn-glow"
            >
              <Plus className="w-4 h-4" />
              Thêm bậc cước mới
            </Button>
          )}
        </div>
      </div>

      {/* Tabs navigation */}
      <div className="flex border-b border-slate-200 gap-2">
        <button
          onClick={() => setActiveTab('shipments')}
          className={`pb-3 px-4 text-xs sm:text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'shipments'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Truck className="w-4 h-4" />
          Danh sách Vận chuyển ({shipments.length})
        </button>
        <button
          onClick={() => setActiveTab('rates')}
          className={`pb-3 px-4 text-xs sm:text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'rates'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Settings className="w-4 h-4" />
          Bảng cước phí ({rates.length})
        </button>
        <button
          onClick={() => setActiveTab('warehouse')}
          className={`pb-3 px-4 text-xs sm:text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'warehouse'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <MapPin className="w-4 h-4" />
          Cấu hình Tổng kho & Bán kính
        </button>
      </div>

      {/* TAB 1: SHIPMENTS LIST */}
      {activeTab === 'shipments' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-600">Trạng thái:</span>
              {(['ALL', 'PROCESSING', 'SHIPPING', 'DELIVERED', 'CANCELLED'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                    statusFilter === st
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {st === 'ALL'
                    ? 'Tất cả'
                    : st === 'PROCESSING'
                    ? 'Chờ điều phối'
                    : st === 'SHIPPING'
                    ? 'Đang giao'
                    : st === 'DELIVERED'
                    ? 'Đã giao'
                    : 'Đã hủy'}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-700"
              />
              <div className="relative w-full sm:w-56">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Mã đơn, khách, tài xế..."
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  className="h-8 pl-8 text-xs bg-white"
                />
              </div>
            </div>
          </div>

          {/* Shipments Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-4">Đơn hàng / Vận đơn</th>
                    <th className="py-3 px-4">Khách hàng & Địa chỉ</th>
                    <th className="py-3 px-4">Ngày / Khung giờ</th>
                    <th className="py-3 px-4">Dịch vụ & Tải trọng</th>
                    <th className="py-3 px-4">Khoảng cách & Phí</th>
                    <th className="py-3 px-4">Tài xế / Biển số</th>
                    <th className="py-3 px-4">Trạng thái</th>
                    <th className="py-3 px-4 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredShipments.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400 italic">
                        Không có đơn hàng hoặc chuyến giao nào khớp với bộ lọc hiện tại.
                      </td>
                    </tr>
                  ) : (
                    filteredShipments.map((item) => (
                      <tr key={item.orderId} className="hover:bg-slate-50/80 transition-colors">
                        {/* Cột 1: Mã đơn & Vận đơn */}
                        <td className="py-3 px-4">
                          <Link
                            href={`/admin/don-hang/${item.orderCode}`}
                            className="font-bold text-indigo-600 hover:underline block"
                          >
                            {item.orderCode}
                          </Link>
                          <span className="text-[11px] font-mono text-slate-400 block mt-0.5">
                            {item.shipment?.code || 'Chưa tạo shipment'}
                          </span>
                        </td>

                        {/* Cột 2: Khách hàng & Địa chỉ */}
                        <td className="py-3 px-4 max-w-xs">
                          <span className="font-semibold text-slate-800 block truncate">
                            {item.companyName ? `${item.companyName} (${item.customerName})` : item.customerName}
                          </span>
                          <span className="text-[11px] text-slate-500 block truncate" title={item.addressText}>
                            {item.addressText}
                          </span>
                        </td>

                        {/* Cột 3: Ngày / Giờ */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="font-medium text-slate-700 block">
                            {item.deliveryDate ? formatVietnamDate(item.deliveryDate) : '---'}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {formatDeliveryTimeSlot(item.timeSlot, 'short')}
                          </span>
                        </td>

                        {/* Cột 4: Loại xe & Khối lượng */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-bold ${
                              item.shippingVehicleType === 'COLD'
                                ? 'bg-cyan-50 text-cyan-700 border-cyan-200'
                                : 'bg-slate-50 text-slate-700 border-slate-200'
                            }`}
                          >
                            {item.shippingVehicleType === 'COLD' ? 'Xe lạnh COLD' : 'Xe thường NORMAL'}
                          </Badge>
                          <span className="text-[11px] text-slate-500 block mt-0.5">
                            {(item.totalGrams / 1000).toLocaleString('vi-VN')} kg ({item.items.length} món)
                          </span>
                        </td>

                        {/* Cột 5: Khoảng cách & Phí */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="font-semibold text-slate-900 block">
                            {formatVND(item.shippingFee)}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {item.shippingDistanceKm ? `${item.shippingDistanceKm} km` : '---'}
                          </span>
                        </td>

                        {/* Cột 6: Tài xế / Xe */}
                        <td className="py-3 px-4 max-w-[180px]">
                          {item.shipment?.driverName ? (
                            <div>
                              <span className="font-semibold text-slate-800 block truncate">
                                {item.shipment.driverName}
                              </span>
                              <span className="text-[11px] text-slate-500 block font-mono">
                                {item.shipment.licensePlate} ({item.shipment.driverPhone})
                              </span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-amber-600 italic font-medium">
                              Chưa gán tài xế
                            </span>
                          )}
                        </td>

                        {/* Cột 7: Trạng thái */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          {item.orderStatus === 'PROCESSING' ? (
                            <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-semibold">
                              Chờ điều phối
                            </Badge>
                          ) : item.orderStatus === 'SHIPPING' ? (
                            <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] font-semibold animate-pulse">
                              Đang giao hàng
                            </Badge>
                          ) : item.orderStatus === 'DELIVERED' ? (
                            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-semibold">
                              Đã giao thành công
                            </Badge>
                          ) : (
                            <Badge className="bg-slate-100 text-slate-500 text-[10px]">
                              {item.orderStatus}
                            </Badge>
                          )}
                        </td>

                        {/* Cột 8: Thao tác */}
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            {item.orderStatus === 'PROCESSING' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenDispatch(item)}
                                className="h-7 px-2 text-[11px] font-semibold text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                              >
                                Gán xe & Bàn giao
                              </Button>
                            )}

                            {item.orderStatus === 'SHIPPING' && item.shipment && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenEditDriver(item)}
                                className="h-7 px-2 text-[11px] text-slate-600 hover:bg-slate-100"
                              >
                                Sửa tài xế
                              </Button>
                            )}

                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleOpenPackingSlip(item)}
                              title="In phiếu giao hàng đồng kiểm"
                              className="h-7 w-7 p-0 text-slate-500 hover:text-slate-800"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: SHIPPING RATES CRUD */}
      {activeTab === 'rates' && (
        <div className="space-y-4">
          {/* State A: Thông báo nếu đang dùng bảng cước mặc định */}
          {diagnostic.status === 'EMPTY_DB' && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900 space-y-1">
                <p className="font-bold">
                  Hệ thống đang hoạt động với Bảng cước vận chuyển mặc định (In-Memory Fallback).
                </p>
                <p>
                  Database hiện chưa lưu bảng cước tùy chỉnh nào. Bạn có thể nhấn nút{' '}
                  <strong>&quot;Khởi tạo 4 bậc cước mặc định vào DB&quot;</strong> ở trên để lưu 4 mức cước chuẩn vào cơ sở dữ liệu, sau đó chỉnh sửa giá theo chính sách kinh doanh của bạn.
                </p>
              </div>
            </div>
          )}

          {/* State C: Cảnh báo cấu hình bảng cước trong DB chưa hoàn thiện hoặc thiếu bậc cơ sở */}
          {diagnostic.status === 'INVALID' && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex flex-col sm:flex-row items-start justify-between gap-3 shadow-sm">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="text-xs text-red-900 space-y-1.5">
                  <p className="font-bold text-sm text-red-800">
                    CẢNH BÁO: Bảng cước vận chuyển trong Cơ sở dữ liệu chưa hoàn thiện!
                  </p>
                  <p>
                    {diagnostic.errorMessage ||
                      'Hệ thống đang thiếu hoặc vô hiệu hóa bậc cước cơ sở (0kg). Điều này khiến hệ thống không thể tính cước và chặn luồng Checkout, Pre-order, Recurring.'}
                  </p>
                  {diagnostic.missingBaseVehicleTypes.length > 0 && (
                    <p className="font-medium text-red-700">
                      • Bậc cơ sở (0kg) bị thiếu hoàn toàn trong DB: {diagnostic.missingBaseVehicleTypes.join(', ')}.
                    </p>
                  )}
                  {diagnostic.inactiveBaseVehicleTypes.length > 0 && (
                    <p className="font-medium text-red-700">
                      • Bậc cơ sở (0kg) cho xe {diagnostic.inactiveBaseVehicleTypes.join(', ')} đang bị vô hiệu hóa (tạm dừng). Vui lòng nhấn nút &quot;Sửa&quot; tại dòng tương ứng bên dưới để kích hoạt lại.
                    </p>
                  )}
                </div>
              </div>
              {diagnostic.missingBaseVehicleTypes.length > 0 && (
                <Button
                  size="sm"
                  onClick={handleRecoverDefaultRates}
                  disabled={isPending}
                  className="bg-red-600 hover:bg-red-700 text-white font-semibold text-xs shrink-0 gap-1.5 mt-2 sm:mt-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Bổ sung bậc cước còn thiếu
                </Button>
              )}
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-800">Cấu hình Bậc cước Vận chuyển</h2>
                <p className="text-xs text-slate-500">
                  Hệ thống tự động áp dụng bậc cước có minGrams cao nhất không vượt quá tổng khối lượng đơn hàng.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-4">Loại phương tiện</th>
                    <th className="py-3 px-4">Khối lượng tối thiểu (Bậc tải trọng)</th>
                    <th className="py-3 px-4">Phí mở cửa (Base Fee)</th>
                    <th className="py-3 px-4">Cước phí mỗi km (Per Km)</th>
                    <th className="py-3 px-4">Trạng thái</th>
                    <th className="py-3 px-4 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rates.map((rate) => (
                    <tr key={rate.id} className="hover:bg-slate-50/80">
                      <td className="py-3 px-4 font-bold">
                        <Badge
                          variant="outline"
                          className={
                            rate.vehicleType === 'COLD'
                              ? 'bg-cyan-50 text-cyan-700 border-cyan-200'
                              : 'bg-slate-50 text-slate-700 border-slate-200'
                          }
                        >
                          {rate.vehicleType === 'COLD' ? 'Xe lạnh (COLD)' : 'Xe thường (NORMAL)'}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-800">
                        {rate.minGrams === 0 ? 'Từ 0 kg (Cơ bản)' : `Từ ${(rate.minGrams / 1000).toLocaleString('vi-VN')} kg trở lên`}
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900">
                        {formatVND(rate.baseFee)}
                      </td>
                      <td className="py-3 px-4 font-bold text-indigo-700">
                        {formatVND(rate.perKm)} / km
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          className={
                            rate.isActive
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]'
                              : 'bg-slate-100 text-slate-400 text-[10px]'
                          }
                        >
                          {rate.isActive ? 'Đang áp dụng' : 'Tạm dừng'}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingRate(rate)
                              setRateForm({
                                vehicleType: rate.vehicleType,
                                minGrams: rate.minGrams,
                                baseFee: rate.baseFee,
                                perKm: rate.perKm,
                                isActive: rate.isActive,
                              })
                              setRateModalOpen(true)
                            }}
                            className="h-7 w-7 p-0 text-slate-600 hover:text-indigo-600"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteRate(rate.id)}
                            className="h-7 w-7 p-0 text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: WAREHOUSE SETTINGS */}
      {activeTab === 'warehouse' && (
        <Card className="max-w-2xl border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-bold text-slate-900">
              Cấu hình Tổng kho Trung tâm & Phạm vi Phục vụ
            </CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Điểm xuất phát dùng để tính toán khoảng cách lộ trình (Google Routes API / Haversine) và bán kính giao hàng tối đa.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-xs">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Tên kho trung tâm</Label>
              <Input
                value={warehouseForm.name}
                onChange={(e) => setWarehouseForm({ ...warehouseForm, name: e.target.value })}
                className="text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Địa chỉ kho</Label>
              <Input
                value={warehouseForm.address}
                onChange={(e) => setWarehouseForm({ ...warehouseForm, address: e.target.value })}
                className="text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Vĩ độ GPS (Latitude)</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={warehouseForm.lat}
                  onChange={(e) => setWarehouseForm({ ...warehouseForm, lat: parseFloat(e.target.value) || 0 })}
                  className="text-xs font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Kinh độ GPS (Longitude)</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={warehouseForm.lng}
                  onChange={(e) => setWarehouseForm({ ...warehouseForm, lng: parseFloat(e.target.value) || 0 })}
                  className="text-xs font-mono"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">
                Bán kính phục vụ tối đa (km)
              </Label>
              <Input
                type="number"
                min="1"
                value={warehouseForm.maxRadiusKm}
                onChange={(e) =>
                  setWarehouseForm({ ...warehouseForm, maxRadiusKm: parseFloat(e.target.value) || 100 })
                }
                className="text-xs"
              />
              <p className="text-[11px] text-slate-500">
                Đơn hàng có khoảng cách vượt quá bán kính này sẽ bị từ chối đặt trực tuyến và hướng dẫn liên hệ hotline.
              </p>
            </div>

            <div className="pt-2">
              <Button
                onClick={handleSaveWarehouse}
                disabled={isPending}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs gap-1.5"
              >
                {isPending ? 'Đang lưu...' : 'Lưu cấu hình Tổng kho'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* MODAL 1: BÀN GIAO CHO TÀI XẾ (DISPATCH) */}
      <Dialog open={dispatchModalOpen} onOpenChange={setDispatchModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-slate-900">
              Bàn giao Vận chuyển — Đơn {selectedOrderForDispatch?.orderCode}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Nhập thông tin tài xế và biển số xe giao hàng để chuyển đơn sang trạng thái Đang giao (SHIPPING).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Họ tên tài xế *</Label>
              <Input
                placeholder="Ví dụ: Nguyễn Văn Hùng"
                value={dispatchForm.driverName}
                onChange={(e) => setDispatchForm({ ...dispatchForm, driverName: e.target.value })}
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Số điện thoại tài xế *</Label>
              <Input
                placeholder="Ví dụ: 0912345678"
                value={dispatchForm.driverPhone}
                onChange={(e) => setDispatchForm({ ...dispatchForm, driverPhone: e.target.value })}
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Biển số xe giao hàng *</Label>
              <Input
                placeholder="Ví dụ: 51D-892.45"
                value={dispatchForm.licensePlate}
                onChange={(e) => setDispatchForm({ ...dispatchForm, licensePlate: e.target.value.toUpperCase() })}
                className="text-xs uppercase font-mono"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Ghi chú điều phối (Tùy chọn)</Label>
              <Input
                placeholder="Ví dụ: Xe tải lạnh 1.5 tấn, giữ nhiệt độ 4 độ C"
                value={dispatchForm.note}
                onChange={(e) => setDispatchForm({ ...dispatchForm, note: e.target.value })}
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDispatchModalOpen(false)}
              disabled={isPending}
              className="text-xs"
            >
              Hủy
            </Button>
            <Button
              size="sm"
              onClick={handleSubmitDispatch}
              disabled={isPending}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs"
            >
              {isPending ? 'Đang xử lý...' : 'Xác nhận Bàn giao (SHIPPING)'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL 2: SỬA TÀI XẾ (EDIT DRIVER) */}
      <Dialog open={editDriverModalOpen} onOpenChange={setEditDriverModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-slate-900">
              Cập nhật Thông tin Tài xế Chuyến giao
            </DialogTitle>
          </DialogHeader>

          {selectedShipmentForEdit && (
            <div className="space-y-3 py-2 text-xs">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">Họ tên tài xế *</Label>
                <Input
                  value={selectedShipmentForEdit.driverName}
                  onChange={(e) =>
                    setSelectedShipmentForEdit({ ...selectedShipmentForEdit, driverName: e.target.value })
                  }
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">Số điện thoại tài xế *</Label>
                <Input
                  value={selectedShipmentForEdit.driverPhone}
                  onChange={(e) =>
                    setSelectedShipmentForEdit({ ...selectedShipmentForEdit, driverPhone: e.target.value })
                  }
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">Biển số xe *</Label>
                <Input
                  value={selectedShipmentForEdit.licensePlate}
                  onChange={(e) =>
                    setSelectedShipmentForEdit({
                      ...selectedShipmentForEdit,
                      licensePlate: e.target.value.toUpperCase(),
                    })
                  }
                  className="text-xs uppercase font-mono"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">Ghi chú chuyến giao</Label>
                <Input
                  value={selectedShipmentForEdit.note}
                  onChange={(e) =>
                    setSelectedShipmentForEdit({ ...selectedShipmentForEdit, note: e.target.value })
                  }
                  className="text-xs"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditDriverModalOpen(false)}
              disabled={isPending}
              className="text-xs"
            >
              Hủy
            </Button>
            <Button
              size="sm"
              onClick={handleSubmitEditDriver}
              disabled={isPending}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs"
            >
              {isPending ? 'Đang lưu...' : 'Lưu thay đổi'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL 3: THÊM / SỬA BẬC CƯỚC (RATE CRUD) */}
      <Dialog open={rateModalOpen} onOpenChange={setRateModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-slate-900">
              {editingRate ? 'Chỉnh sửa Bậc cước Vận chuyển' : 'Thêm mới Bậc cước Vận chuyển'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Loại phương tiện</Label>
              <select
                disabled={Boolean(editingRate)}
                value={rateForm.vehicleType}
                onChange={(e) =>
                  setRateForm({ ...rateForm, vehicleType: e.target.value as VehicleType })
                }
                className="w-full h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-800 disabled:bg-slate-100"
              >
                <option value="NORMAL">Xe thường (NORMAL)</option>
                <option value="COLD">Xe lạnh (COLD)</option>
              </select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">
                Khối lượng tối thiểu (minGrams)
              </Label>
              <Input
                type="number"
                disabled={Boolean(editingRate)}
                value={rateForm.minGrams}
                onChange={(e) =>
                  setRateForm({ ...rateForm, minGrams: parseInt(e.target.value) || 0 })
                }
                placeholder="0 = Mức cước cơ sở"
                className="text-xs disabled:bg-slate-100"
              />
              <p className="text-[10px] text-slate-500">
                Ví dụ: 0 = Xe nhỏ dưới 500kg, 500000 = Xe tải từ 500kg trở lên.
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Phí mở cửa (baseFee - VNĐ)</Label>
              <Input
                type="number"
                step="1000"
                value={rateForm.baseFee}
                onChange={(e) =>
                  setRateForm({ ...rateForm, baseFee: parseInt(e.target.value) || 0 })
                }
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Phí mỗi km (perKm - VNĐ/km)</Label>
              <Input
                type="number"
                step="1000"
                value={rateForm.perKm}
                onChange={(e) =>
                  setRateForm({ ...rateForm, perKm: parseInt(e.target.value) || 0 })
                }
                className="text-xs"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="rateIsActive"
                checked={rateForm.isActive ?? true}
                onChange={(e) => setRateForm({ ...rateForm, isActive: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <Label htmlFor="rateIsActive" className="text-xs font-semibold text-slate-700 cursor-pointer">
                Kích hoạt áp dụng bậc cước này
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRateModalOpen(false)}
              disabled={isPending}
              className="text-xs"
            >
              Hủy
            </Button>
            <Button
              size="sm"
              onClick={handleSaveRate}
              disabled={isPending}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs"
            >
              {isPending ? 'Đang lưu...' : 'Lưu bậc cước'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL 4: PHIẾU ĐÓNG GÓI / GIAO HÀNG A4 (PACKING SLIP) */}
      <PackingSlipModal
        open={packingSlipOpen}
        onOpenChange={setPackingSlipOpen}
        data={packingSlipData}
      />
    </div>
  )
}
