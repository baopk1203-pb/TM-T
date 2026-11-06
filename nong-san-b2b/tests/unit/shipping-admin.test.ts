/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  initializeDefaultShippingRates,
  createShippingRate,
  updateShippingRate,
  deleteShippingRate,
  updateWarehouseSettings,
  updateShipmentDriver,
} from '@/actions/shipping-admin'
import {
  getEffectiveShippingRates,
  getWarehouseConfig,
  getDynamicShippingQuote,
  createDynamicShippingCalculator,
  diagnoseShippingRates,
} from '@/lib/services/shipping-config'
import { transitionToShipping, settleActualWeights, cancelOrder } from '@/actions/order-lifecycle'
import { db } from '@/lib/db'
import { requireAdmin, getServerAuthSession } from '@/lib/auth'
import { recordOrderEvent } from '@/lib/events'
import {
  OrderStatus,
  ShipmentStatus,
  VehicleType,
  Role,
  PaymentOption,
  TxStatus,
  TxType,
} from '@prisma/client'
import { DEFAULT_SHIPPING_RATES, DEFAULT_WAREHOUSE } from '@/lib/domain/shipping'

vi.mock('@/lib/db', () => {
  const mockDb = {
    $transaction: vi.fn(),
    order: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    shippingRate: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    appSetting: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    shipment: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    orderItem: {
      update: vi.fn(),
    },
  }
  return { db: mockDb }
})

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(),
  getServerAuthSession: vi.fn(),
}))

vi.mock('@/lib/events', () => ({
  recordOrderEvent: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

describe('Phase 8B: Admin Shipping & Shipment Management Test Suite', () => {
  const adminUser = {
    id: 'admin-001',
    email: 'admin@b2bnongsan.vn',
    role: Role.ADMIN,
    name: 'Quản trị viên',
    groupId: null,
    discountPercent: 0,
    companyName: null,
    phone: '0912345678',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAdmin).mockResolvedValue(adminUser)
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: adminUser,
      expires: '2099-01-01',
    })
    // Transaction mock: execute callback directly with mock db
    vi.mocked(db.$transaction).mockImplementation(async (cb: any) => {
      if (typeof cb === 'function') {
        return cb(db)
      }
      return cb
    })
    vi.mocked(db.shippingRate.findMany).mockResolvedValue([])
    vi.mocked(db.shippingRate.findUnique).mockResolvedValue(null)
    vi.mocked(db.shippingRate.count).mockResolvedValue(4)
    vi.mocked(db.shippingRate.createMany).mockResolvedValue({ count: 4 })
  })

  // =========================================================================
  // GROUP 1: ShippingRate CRUD Validation & Business Rules
  // =========================================================================
  describe('1. ShippingRate CRUD & Validation Rules', () => {
    it('1.1 Từ chối tạo bậc cước với phí mở cửa âm', async () => {
      const res = await createShippingRate({
        vehicleType: 'NORMAL',
        minGrams: 0,
        baseFee: -1000,
        perKm: 8000,
      })
      expect(res.success).toBe(false)
      expect(res.error).toBeDefined()
    })

    it('1.2 Từ chối tạo bậc cước với phí mỗi km âm', async () => {
      const res = await createShippingRate({
        vehicleType: 'NORMAL',
        minGrams: 0,
        baseFee: 150000,
        perKm: -500,
      })
      expect(res.success).toBe(false)
      expect(res.error).toBeDefined()
    })

    it('1.3 Từ chối tạo bậc cước với khối lượng tối thiểu (minGrams) âm', async () => {
      const res = await createShippingRate({
        vehicleType: 'COLD',
        minGrams: -100,
        baseFee: 250000,
        perKm: 12000,
      })
      expect(res.success).toBe(false)
      expect(res.error).toBeDefined()
    })

    it('1.4 Từ chối tạo bậc cước bị trùng lặp (vehicleType, minGrams)', async () => {
      vi.mocked(db.shippingRate.findUnique).mockResolvedValueOnce({
        id: 'rate-exist',
        vehicleType: VehicleType.NORMAL,
        minGrams: 0,
        baseFee: 150000,
        perKm: 8000,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const res = await createShippingRate({
        vehicleType: 'NORMAL',
        minGrams: 0,
        baseFee: 160000,
        perKm: 9000,
      })
      expect(res.success).toBe(false)
      expect(res.error).toContain('đã tồn tại')
    })

    it('1.5 Tạo bậc cước mới thành công khi dữ liệu hợp lệ', async () => {
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(4) // DB đã khởi tạo, count > 0
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([
        { id: 'norm-0', vehicleType: VehicleType.NORMAL, minGrams: 0, isActive: true },
        { id: 'cold-0', vehicleType: VehicleType.COLD, minGrams: 0, isActive: true },
      ] as any) // Guard 2: DB hiện tại có đủ bậc cơ sở
      vi.mocked(db.shippingRate.findUnique).mockResolvedValueOnce(null)
      vi.mocked(db.shippingRate.create).mockResolvedValueOnce({
        id: 'new-rate-1',
        vehicleType: VehicleType.NORMAL,
        minGrams: 100000,
        baseFee: 180000,
        perKm: 9000,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([
        { id: 'norm-0', vehicleType: VehicleType.NORMAL, minGrams: 0, isActive: true },
        { id: 'cold-0', vehicleType: VehicleType.COLD, minGrams: 0, isActive: true },
        { id: 'new-rate-1', vehicleType: VehicleType.NORMAL, minGrams: 100000, isActive: true },
      ] as any) // Post-condition check: vẫn giữ bậc cơ sở

      const res = await createShippingRate({
        vehicleType: 'NORMAL',
        minGrams: 100000,
        baseFee: 180000,
        perKm: 9000,
      })
      expect(res.success).toBe(true)
      expect(res.rate?.id).toBe('new-rate-1')
    })

    it('1.6 Cập nhật bậc cước thành công khi dữ liệu hợp lệ', async () => {
      vi.mocked(db.shippingRate.findUnique).mockResolvedValueOnce({
        id: 'rate-1',
        vehicleType: VehicleType.NORMAL,
        minGrams: 500000,
        baseFee: 300000,
        perKm: 12000,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      vi.mocked(db.shippingRate.update).mockResolvedValueOnce({
        id: 'rate-1',
        vehicleType: VehicleType.NORMAL,
        minGrams: 500000,
        baseFee: 320000,
        perKm: 13000,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([
        { id: 'norm-0', vehicleType: VehicleType.NORMAL, minGrams: 0, isActive: true },
        { id: 'cold-0', vehicleType: VehicleType.COLD, minGrams: 0, isActive: true },
      ] as any)
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(2)

      const res = await updateShippingRate({
        id: 'rate-1',
        baseFee: 320000,
        perKm: 13000,
        isActive: true,
      })
      expect(res.success).toBe(true)
      expect(res.rate?.baseFee).toBe(320000)
    })

    it('1.7 Ngăn chặn vô hiệu hóa bậc cước 0kg cơ sở khi vẫn còn bậc tải trọng khác đang hoạt động', async () => {
      vi.mocked(db.shippingRate.findUnique).mockResolvedValueOnce({
        id: 'rate-base-0',
        vehicleType: VehicleType.NORMAL,
        minGrams: 0,
        baseFee: 150000,
        perKm: 8000,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      // Không còn bậc 0kg nào khác đang active
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(0)

      const res = await updateShippingRate({
        id: 'rate-base-0',
        baseFee: 150000,
        perKm: 8000,
        isActive: false, // tắt bậc 0kg
      })
      expect(res.success).toBe(false)
      expect(res.error).toContain('Không thể vô hiệu hóa bậc cước cơ sở (0kg)')
    })

    it('1.8 Xóa bậc cước thành công và báo lỗi nếu không tìm thấy ID', async () => {
      vi.mocked(db.shippingRate.findUnique).mockResolvedValueOnce(null)
      const resNotFound = await deleteShippingRate('non-existent')
      expect(resNotFound.success).toBe(false)
      expect(resNotFound.error).toContain('Không tìm thấy')

      vi.mocked(db.shippingRate.findUnique).mockResolvedValueOnce({
        id: 'rate-to-del',
        vehicleType: VehicleType.COLD,
        minGrams: 500000,
        baseFee: 450000,
        perKm: 18000,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(3) // totalCount > 1
      vi.mocked(db.shippingRate.delete).mockResolvedValueOnce({} as any)
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(2) // remainingTotal > 0
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([
        { id: 'norm-0', vehicleType: VehicleType.NORMAL, minGrams: 0, isActive: true },
        { id: 'cold-0', vehicleType: VehicleType.COLD, minGrams: 0, isActive: true },
      ] as any)

      const resSuccess = await deleteShippingRate('rate-to-del')
      expect(resSuccess.success).toBe(true)
      expect(db.shippingRate.delete).toHaveBeenCalledWith({ where: { id: 'rate-to-del' } })
    })
  })

  // =========================================================================
  // GROUP 2: initializeDefaultShippingRates Idempotency
  // =========================================================================
  describe('2. Khởi tạo cước mặc định (initializeDefaultShippingRates)', () => {
    it('2.1 Tạo 4 bậc cước khi DB hoàn toàn rỗng', async () => {
      vi.mocked(db.shippingRate.createMany).mockResolvedValueOnce({ count: 4 })
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([
        { id: 'norm-0', vehicleType: VehicleType.NORMAL, minGrams: 0, isActive: true },
        { id: 'norm-500', vehicleType: VehicleType.NORMAL, minGrams: 500000, isActive: true },
        { id: 'cold-0', vehicleType: VehicleType.COLD, minGrams: 0, isActive: true },
        { id: 'cold-500', vehicleType: VehicleType.COLD, minGrams: 500000, isActive: true },
      ] as any)

      const res = await initializeDefaultShippingRates()
      expect(res.success).toBe(true)
      expect(res.createdCount).toBe(4)
      expect(db.shippingRate.createMany).toHaveBeenCalledWith({
        data: expect.any(Array),
        skipDuplicates: true,
      })
    })

    it('2.2 Idempotent: Bỏ qua nếu các bậc cước đã tồn tại', async () => {
      vi.mocked(db.shippingRate.createMany).mockResolvedValueOnce({ count: 0 })
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([
        { id: 'norm-0', vehicleType: VehicleType.NORMAL, minGrams: 0, isActive: true },
        { id: 'cold-0', vehicleType: VehicleType.COLD, minGrams: 0, isActive: true },
      ] as any)

      const res = await initializeDefaultShippingRates()
      expect(res.success).toBe(true)
      expect(res.createdCount).toBe(0)
      expect(db.shippingRate.createMany).toHaveBeenCalledWith({
        data: expect.any(Array),
        skipDuplicates: true,
      })
    })
  })

  // =========================================================================
  // GROUP 3: Cấu hình Kho & Bán kính (updateWarehouseSettings)
  // =========================================================================
  describe('3. Cấu hình Tổng kho & Bán kính phục vụ (updateWarehouseSettings)', () => {
    it('3.1 Từ chối tọa độ GPS không hợp lệ (Vĩ độ ngoài -90..90)', async () => {
      const res = await updateWarehouseSettings({
        name: 'Kho Trung Tâm',
        address: '123 Đường Nông Sản',
        lat: 95.0,
        lng: 106.7,
        maxRadiusKm: 50,
      })
      expect(res.success).toBe(false)
      expect(res.error).toBeDefined()
    })

    it('3.2 Từ chối tọa độ Null Island (0, 0)', async () => {
      const res = await updateWarehouseSettings({
        name: 'Kho Trung Tâm',
        address: '123 Đường Nông Sản',
        lat: 0,
        lng: 0,
        maxRadiusKm: 50,
      })
      expect(res.success).toBe(false)
      expect(res.error).toContain('Tọa độ GPS kho không hợp lệ')
    })

    it('3.3 Từ chối bán kính phục vụ <= 0', async () => {
      const res = await updateWarehouseSettings({
        name: 'Kho Trung Tâm',
        address: '123 Đường Nông Sản',
        lat: 10.8505,
        lng: 106.7717,
        maxRadiusKm: 0,
      })
      expect(res.success).toBe(false)
      expect(res.error).toBeDefined()
    })

    it('3.4 Lưu thành công cấu hình kho hợp lệ vào AppSetting', async () => {
      vi.mocked(db.appSetting.upsert).mockResolvedValue({} as any)

      const res = await updateWarehouseSettings({
        name: 'Tổng kho Thủ Đức',
        address: 'Khu Công Nghệ Cao, TP. Thủ Đức',
        lat: 10.8505,
        lng: 106.7717,
        maxRadiusKm: 60,
      })
      expect(res.success).toBe(true)
      expect(db.appSetting.upsert).toHaveBeenCalledTimes(5)
    })
  })

  // =========================================================================
  // GROUP 4: Cập nhật Tài xế Chuyến giao (updateShipmentDriver)
  // =========================================================================
  describe('4. Cập nhật Tài xế Chuyến giao (updateShipmentDriver)', () => {
    it('4.1 Từ chối số điện thoại tài xế không đúng chuẩn di động Việt Nam', async () => {
      const res = await updateShipmentDriver({
        shipmentId: 'ship-1',
        driverName: 'Nguyễn Văn A',
        driverPhone: '12345678', // thiếu số
        licensePlate: '51D-123.45',
      })
      expect(res.success).toBe(false)
      expect(res.error).toContain('Số điện thoại tài xế không hợp lệ')
    })

    it('4.2 Từ chối tên tài xế quá ngắn (< 2 ký tự)', async () => {
      const res = await updateShipmentDriver({
        shipmentId: 'ship-1',
        driverName: 'A',
        driverPhone: '0912345678',
        licensePlate: '51D-123.45',
      })
      expect(res.success).toBe(false)
      expect(res.error).toBeDefined()
    })

    it('4.3 Ngăn chặn sửa đổi khi chuyến giao đã ở trạng thái kết thúc (DELIVERED/CANCELLED)', async () => {
      vi.mocked(db.shipment.findUnique).mockResolvedValueOnce({
        id: 'ship-1',
        status: ShipmentStatus.DELIVERED,
        order: { code: 'ORD-001' },
      } as any)

      const res = await updateShipmentDriver({
        shipmentId: 'ship-1',
        driverName: 'Nguyễn Văn B',
        driverPhone: '0987654321',
        licensePlate: '51D-999.99',
      })
      expect(res.success).toBe(false)
      expect(res.error).toContain('Không thể chỉnh sửa chuyến giao đã hoàn tất giao')
    })

    it('4.4 Cập nhật tài xế & phương tiện thành công khi chuyến đang DISPATCHED', async () => {
      vi.mocked(db.shipment.findUnique).mockResolvedValueOnce({
        id: 'ship-2',
        status: ShipmentStatus.DISPATCHED,
        order: { code: 'ORD-002' },
      } as any)
      vi.mocked(db.shipment.update).mockResolvedValueOnce({
        id: 'ship-2',
        driverName: 'Trần Văn C',
        driverPhone: '0901234567',
        licensePlate: '59C-888.88',
      } as any)

      const res = await updateShipmentDriver({
        shipmentId: 'ship-2',
        driverName: 'Trần Văn C',
        driverPhone: '0901234567',
        licensePlate: '59C-888.88',
        note: 'Giao buổi sáng',
      })
      expect(res.success).toBe(true)
      expect(res.shipment?.driverName).toBe('Trần Văn C')
    })
  })

  // =========================================================================
  // GROUP 5: Dynamic Shipping Config Service
  // =========================================================================
  describe('5. Dịch vụ Cấu hình Cước động (shipping-config.ts)', () => {
    it('5.1 Trả về DEFAULT_SHIPPING_RATES với isDefault: true khi bảng ShippingRate rỗng', async () => {
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([])
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(0)

      const result = await getEffectiveShippingRates()
      expect(result.isDefault).toBe(true)
      expect(result.rates).toEqual(DEFAULT_SHIPPING_RATES)
    })

    it('5.2 Trả về rate từ DB khi đã có cấu hình và đủ bậc cơ sở 0kg', async () => {
      const mockDbRates = [
        { id: 'r1', vehicleType: 'NORMAL', minGrams: 0, baseFee: 140000, perKm: 7500, isActive: true },
        { id: 'r2', vehicleType: 'COLD', minGrams: 0, baseFee: 240000, perKm: 11000, isActive: true },
      ]
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce(mockDbRates as any)

      const result = await getEffectiveShippingRates()
      expect(result.isDefault).toBe(false)
      expect(result.rates.length).toBe(2)
      expect(result.rates[0].baseFee).toBe(140000)
    })

    it('5.3 Báo lỗi rõ ràng nếu DB có cước nhưng thiếu bậc 0kg của loại xe COLD', async () => {
      const incompleteRates = [
        { id: 'r1', vehicleType: 'NORMAL', minGrams: 0, baseFee: 140000, perKm: 7500, isActive: true },
        { id: 'r2', vehicleType: 'COLD', minGrams: 500000, baseFee: 450000, perKm: 18000, isActive: true }, // thiếu 0kg COLD
      ]
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce(incompleteRates as any)

      const result = await getEffectiveShippingRates()
      expect(result.isDefault).toBe(false)
      expect(result.error).toContain('chưa hoàn thiện cấu hình mức cơ sở (0kg)')
    })

    it('5.4 getWarehouseConfig fallback về DEFAULT_WAREHOUSE khi DB rỗng', async () => {
      vi.mocked(db.appSetting.findMany).mockResolvedValueOnce([])

      const wh = await getWarehouseConfig()
      expect(wh.lat).toBe(DEFAULT_WAREHOUSE.lat)
      expect(wh.lng).toBe(DEFAULT_WAREHOUSE.lng)
      expect(wh.maxRadiusKm).toBe(DEFAULT_WAREHOUSE.maxRadiusKm)
    })

    it('5.5 getWarehouseConfig đọc đúng các giá trị tùy biến từ AppSetting', async () => {
      vi.mocked(db.appSetting.findMany).mockResolvedValueOnce([
        { key: 'warehouseLat', value: '10.7769' },
        { key: 'warehouseLng', value: '106.7009' },
        { key: 'maxRadiusKm', value: '75' },
        { key: 'warehouseName', value: 'Kho Q1' },
      ] as any)

      const wh = await getWarehouseConfig()
      expect(wh.lat).toBeCloseTo(10.7769, 4)
      expect(wh.lng).toBeCloseTo(106.7009, 4)
      expect(wh.maxRadiusKm).toBe(75)
      expect(wh.name).toBe('Kho Q1')
    })

    it('5.6 getDynamicShippingQuote tính toán báo giá chính xác sử dụng cấu hình động', async () => {
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([])
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(0)
      vi.mocked(db.appSetting.findMany).mockResolvedValueOnce([])

      const quote = await getDynamicShippingQuote({
        lat: 10.7769,
        lng: 106.7009, // Q1
        totalGrams: 50000,
        requiresCold: false,
      })
      expect(quote.allowed).toBe(true)
      expect(quote.distanceKm).toBeGreaterThan(0)
      expect(quote.fee).toBeGreaterThan(150000)
    })

    it('5.7 createDynamicShippingCalculator tạo calculator factory hợp lệ', async () => {
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([])
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(0)
      vi.mocked(db.appSetting.findMany).mockResolvedValueOnce([])

      const calc = await createDynamicShippingCalculator()
      expect(typeof calc.quote).toBe('function')
      const quote = await calc.quote({
        lat: 10.7769,
        lng: 106.7009,
        totalGrams: 20000,
        requiresCold: true,
      })
      expect(quote.vehicleType).toBe('COLD')
    })
  })

  // =========================================================================
  // GROUP 6: transitionToShipping Vận chuyển & Giao hàng
  // =========================================================================
  describe('6. Bàn giao Vận chuyển (transitionToShipping)', () => {
    it('6.1 Bắt buộc nhập đầy đủ tên tài xế, SĐT và biển số xe hợp lệ', async () => {
      const resMissingName = await transitionToShipping({
        orderId: 'ord-1',
        driverName: '',
        driverPhone: '0912345678',
        licensePlate: '51D-123.45',
      })
      expect(resMissingName.success).toBe(false)
      expect(resMissingName.error).toContain('họ tên tài xế')

      const resInvalidPhone = await transitionToShipping({
        orderId: 'ord-1',
        driverName: 'Tài Xế Hùng',
        driverPhone: '012345',
        licensePlate: '51D-123.45',
      })
      expect(resInvalidPhone.success).toBe(false)
      expect(resInvalidPhone.error).toContain('Số điện thoại tài xế không hợp lệ')
    })

    it('6.2 Không cho phép bàn giao nếu đơn hàng không ở trạng thái PROCESSING', async () => {
      vi.mocked(db.order.findUnique).mockResolvedValueOnce({
        id: 'ord-pending',
        code: 'ORD-PENDING',
        status: OrderStatus.PENDING_CONFIRMATION, // Chưa thanh toán / chưa qua PROCESSING
        paymentOption: PaymentOption.FULL,
        total: 1000000,
        depositAmount: 300000,
        items: [],
        shipment: null,
      } as any)

      const res = await transitionToShipping({
        orderId: 'ord-pending',
        driverName: 'Nguyễn Văn A',
        driverPhone: '0912345678',
        licensePlate: '51D-123.45',
      })
      expect(res.success).toBe(false)
      expect(res.error).toBeDefined()
    })

    it('6.3 Chuyển đơn sang SHIPPING, tạo Shipment DISPATCHED và ghi OrderEvent', async () => {
      vi.mocked(db.order.findUnique).mockResolvedValueOnce({
        id: 'ord-proc',
        code: 'ORD-PROC-123',
        status: OrderStatus.PROCESSING,
        paymentOption: PaymentOption.FULL,
        total: 2000000,
        depositAmount: 600000,
        shippingFee: 180000,
        shippingDistanceKm: 12.5,
        shippingVehicleType: VehicleType.NORMAL,
        items: [{ id: 'item-1', orderedGrams: 50000 }],
        shipment: null,
      } as any)

      vi.mocked(db.shipment.findUnique).mockResolvedValueOnce(null)
      vi.mocked(db.shipment.create).mockResolvedValueOnce({
        id: 'ship-new',
        code: 'SHIP-ORD-PROC-123',
        status: ShipmentStatus.DISPATCHED,
      } as any)
      vi.mocked(db.order.update).mockResolvedValueOnce({} as any)

      const res = await transitionToShipping({
        orderId: 'ord-proc',
        driverName: 'Nguyễn Văn Hùng',
        driverPhone: '0912345678',
        licensePlate: '51D-123.45',
        note: 'Giao hàng cẩn thận',
      })

      expect(res.success).toBe(true)
      expect(db.order.update).toHaveBeenCalledWith({
        where: { id: 'ord-proc' },
        data: { status: OrderStatus.SHIPPING },
      })
      expect(db.shipment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: 'ord-proc',
            driverName: 'Nguyễn Văn Hùng',
            driverPhone: '0912345678',
            licensePlate: '51D-123.45',
            status: ShipmentStatus.DISPATCHED,
          }),
        })
      )
      expect(recordOrderEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'ORDER_SHIPPED',
          toStatus: OrderStatus.SHIPPING,
        })
      )
    })
  })

  // =========================================================================
  // GROUP 7: settleActualWeights & cancelOrder Đồng bộ Shipment
  // =========================================================================
  describe('7. Đồng bộ Vận đơn khi Quyết toán & Hủy đơn', () => {
    it('7.1 settleActualWeights đồng bộ Shipment.status = DELIVERED khi chốt giao hàng', async () => {
      vi.mocked(db.order.findUnique).mockResolvedValueOnce({
        id: 'ord-shipping',
        code: 'ORD-SHIP-999',
        status: OrderStatus.SHIPPING,
        paymentOption: PaymentOption.FULL,
        total: 1000000,
        depositAmount: 300000,
        finalTotal: null,
        items: [
          {
            id: 'item-1',
            productId: 'p1',
            productName: 'Cam Sành',
            orderedGrams: 10000,
            unitPricePerKg: 50000,
            lineTotal: 500000,
            isSample: false,
            actualGrams: null,
            finalLineTotal: null,
          },
        ],
        transactions: [
          { id: 'tx-1', type: TxType.PAYMENT, status: TxStatus.DONE, amount: 1000000 },
        ],
        shipment: {
          id: 'ship-999',
          status: ShipmentStatus.DISPATCHED,
        },
      } as any)

      vi.mocked(db.shipment.findUnique).mockResolvedValueOnce({
        id: 'ship-999',
        orderId: 'ord-shipping',
        status: ShipmentStatus.DISPATCHED,
      } as any)
      vi.mocked(db.order.update).mockResolvedValueOnce({} as any)
      vi.mocked(db.shipment.update).mockResolvedValueOnce({} as any)
      vi.mocked(db.orderItem.update).mockResolvedValueOnce({} as any)

      const res = await settleActualWeights({
        orderId: 'ord-shipping',
        lines: [{ orderItemId: 'item-1', actualGrams: 10000 }],
      })

      expect(res.success).toBe(true)
      expect(db.shipment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ship-999' },
          data: expect.objectContaining({
            status: ShipmentStatus.DELIVERED,
          }),
        })
      )
    })

    it('7.2 settleActualWeights tương thích ngược khi đơn cũ không có shipment (shipment = null)', async () => {
      vi.mocked(db.order.findUnique).mockResolvedValueOnce({
        id: 'ord-old',
        code: 'ORD-OLD',
        status: OrderStatus.SHIPPING,
        paymentOption: PaymentOption.FULL,
        total: 500000,
        depositAmount: 150000,
        items: [
          {
            id: 'item-old',
            orderedGrams: 5000,
            unitPricePerKg: 100000,
            lineTotal: 500000,
            isSample: false,
          },
        ],
        transactions: [
          { id: 'tx-old', type: TxType.PAYMENT, status: TxStatus.DONE, amount: 500000 },
        ],
        shipment: null, // Không có shipment
      } as any)
      vi.mocked(db.shipment.findUnique).mockResolvedValueOnce(null)

      vi.mocked(db.order.update).mockResolvedValueOnce({} as any)
      vi.mocked(db.orderItem.update).mockResolvedValueOnce({} as any)

      const res = await settleActualWeights({
        orderId: 'ord-old',
        lines: [{ orderItemId: 'item-old', actualGrams: 5000 }],
      })

      expect(res.success).toBe(true)
      expect(db.shipment.update).not.toHaveBeenCalled()
    })

    it('7.3 cancelOrder đồng bộ Shipment.status = CANCELLED khi hủy đơn đang giao hoặc đã gán xe', async () => {
      vi.mocked(db.order.findUnique).mockResolvedValueOnce({
        id: 'ord-cancel-target',
        code: 'ORD-CANCEL',
        status: OrderStatus.PROCESSING,
        userId: 'admin-001',
        paymentOption: PaymentOption.FULL,
        total: 1000000,
        depositAmount: 300000,
        transactions: [],
        shipment: {
          id: 'ship-to-cancel',
          status: ShipmentStatus.PENDING,
        },
      } as any)

      vi.mocked(db.shipment.findUnique).mockResolvedValueOnce({
        id: 'ship-to-cancel',
        orderId: 'ord-cancel-target',
        status: ShipmentStatus.PENDING,
      } as any)
      vi.mocked(db.order.update).mockResolvedValueOnce({} as any)
      vi.mocked(db.shipment.update).mockResolvedValueOnce({} as any)

      const res = await cancelOrder({
        orderId: 'ord-cancel-target',
        reason: 'Hết hàng tại vườn',
      })

      expect(res.success).toBe(true)
      expect(db.shipment.update).toHaveBeenCalledWith({
        where: { id: 'ship-to-cancel' },
        data: { status: ShipmentStatus.CANCELLED },
      })
    })
  })

  // =========================================================================
  // GROUP 8: RBAC Security Protection
  // =========================================================================
  describe('8. Bảo vệ Phân quyền RBAC (Role-Based Access Control)', () => {
    it('8.1 Chặn người dùng không có quyền Admin thực hiện các hành động quản trị vận chuyển', async () => {
      vi.mocked(requireAdmin).mockRejectedValueOnce(new Error('Unauthorized: Admin access required'))

      const res1 = await initializeDefaultShippingRates()
      expect(res1.success).toBe(false)
      expect(res1.error).toContain('Unauthorized')

      vi.mocked(requireAdmin).mockRejectedValueOnce(new Error('Unauthorized: Admin access required'))
      const res2 = await createShippingRate({
        vehicleType: 'NORMAL',
        minGrams: 0,
        baseFee: 150000,
        perKm: 8000,
      })
      expect(res2.success).toBe(false)
      expect(res2.error).toContain('Unauthorized')

      vi.mocked(requireAdmin).mockRejectedValueOnce(new Error('Unauthorized: Admin access required'))
      const res3 = await updateWarehouseSettings({
        name: 'Kho hack',
        address: '123 Fake',
        lat: 10.8,
        lng: 106.7,
        maxRadiusKm: 50,
      })
      expect(res3.success).toBe(false)
      expect(res3.error).toContain('Unauthorized')
    })
  })

  // =========================================================================
  // GROUP 9: DEV-TASK-23-FIX01 — BẢO VỆ TOÀN VẸN BẢNG CƯỚC & DELETE/UPDATE GUARD (T1 - T10)
  // =========================================================================
  describe('9. DEV-TASK-23-FIX01 — BẢO VỆ TOÀN VẸN BẢNG CƯỚC & DELETE/UPDATE GUARD (T1 - T10)', () => {
    // T1: Xóa NORMAL 0g khi còn bậc 500kg → REJECT
    it('T1. Xóa bậc NORMAL 0g khi còn bậc 500kg → REJECT', async () => {
      vi.mocked(db.shippingRate.findUnique).mockResolvedValueOnce({
        id: 'rate-norm-0',
        vehicleType: VehicleType.NORMAL,
        minGrams: 0,
        baseFee: 150000,
        perKm: 8000,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(3) // totalCount > 1
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(0) // otherBaseCount (no other 0kg)
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(1) // dependentCount (500kg tier exists)

      const res = await deleteShippingRate('rate-norm-0')
      expect(res.success).toBe(false)
      expect(res.error).toContain('Không thể xóa bậc cước cơ sở (0kg) của loại xe NORMAL khi vẫn còn các bậc cước tải trọng khác')
      expect(db.shippingRate.delete).not.toHaveBeenCalled()
    })

    // T2: Xóa COLD 0g khi còn bậc 500kg → REJECT
    it('T2. Xóa bậc COLD 0g khi còn bậc 500kg → REJECT', async () => {
      vi.mocked(db.shippingRate.findUnique).mockResolvedValueOnce({
        id: 'rate-cold-0',
        vehicleType: VehicleType.COLD,
        minGrams: 0,
        baseFee: 250000,
        perKm: 12000,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(3) // totalCount > 1
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(0) // otherBaseCount
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(1) // dependentCount (500kg tier exists)

      const res = await deleteShippingRate('rate-cold-0')
      expect(res.success).toBe(false)
      expect(res.error).toContain('Không thể xóa bậc cước cơ sở (0kg) của loại xe COLD khi vẫn còn các bậc cước tải trọng khác')
      expect(db.shippingRate.delete).not.toHaveBeenCalled()
    })

    // T3: Xóa bậc 0g duy nhất đang hoạt động của một loại xe → REJECT
    it('T3. Xóa bậc 0g duy nhất đang hoạt động của một loại xe → REJECT', async () => {
      vi.mocked(db.shippingRate.findUnique).mockResolvedValueOnce({
        id: 'rate-norm-0-only',
        vehicleType: VehicleType.NORMAL,
        minGrams: 0,
        baseFee: 150000,
        perKm: 8000,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(2) // totalCount (NORMAL 0g, COLD 0g)
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(0) // otherBaseCount
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(0) // dependentCount (no 500kg tier)

      const res = await deleteShippingRate('rate-norm-0-only')
      expect(res.success).toBe(false)
      expect(res.error).toContain('Không thể xóa bậc cước cơ sở (0kg) duy nhất của loại xe NORMAL')
      expect(db.shippingRate.delete).not.toHaveBeenCalled()
    })

    // T4: Xóa bậc phụ 500kg, còn bậc 0g hợp lệ → PASS
    it('T4. Xóa bậc phụ 500kg, còn bậc 0g hợp lệ → PASS', async () => {
      vi.mocked(db.shippingRate.findUnique).mockResolvedValueOnce({
        id: 'rate-norm-500',
        vehicleType: VehicleType.NORMAL,
        minGrams: 500000,
        baseFee: 300000,
        perKm: 12000,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(3) // totalCount
      vi.mocked(db.shippingRate.delete).mockResolvedValueOnce({} as any)
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(2) // remainingTotal
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([
        { id: 'norm-0', vehicleType: VehicleType.NORMAL, minGrams: 0, isActive: true },
        { id: 'cold-0', vehicleType: VehicleType.COLD, minGrams: 0, isActive: true },
      ] as any) // remainingActive has both NORMAL 0g and COLD 0g

      const res = await deleteShippingRate('rate-norm-500')
      expect(res.success).toBe(true)
      expect(db.shippingRate.delete).toHaveBeenCalledWith({ where: { id: 'rate-norm-500' } })
    })

    // T5: Vô hiệu hóa bậc cơ sở cuối cùng → REJECT
    it('T5. Vô hiệu hóa bậc cơ sở cuối cùng → REJECT', async () => {
      vi.mocked(db.shippingRate.findUnique).mockResolvedValueOnce({
        id: 'rate-norm-0',
        vehicleType: VehicleType.NORMAL,
        minGrams: 0,
        baseFee: 150000,
        perKm: 8000,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(0) // otherActiveBase = 0

      const res = await updateShippingRate({
        id: 'rate-norm-0',
        baseFee: 150000,
        perKm: 8000,
        isActive: false, // cố tình tắt bậc 0kg
      })
      expect(res.success).toBe(false)
      expect(res.error).toContain('Không thể vô hiệu hóa bậc cước cơ sở (0kg) của loại xe NORMAL')
      expect(db.shippingRate.update).not.toHaveBeenCalled()
    })

    // T6: Không có bản ghi DB từ đầu → fallback DEFAULT vẫn hoạt động, không ghi DB
    it('T6. Không có bản ghi DB từ đầu → fallback DEFAULT vẫn hoạt động, không ghi DB', async () => {
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([])
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(0)

      const result = await getEffectiveShippingRates()
      expect(result.isDefault).toBe(true)
      expect(result.rates).toEqual(DEFAULT_SHIPPING_RATES)
      expect(db.shippingRate.create).not.toHaveBeenCalled()
    })

    // T7: Không thể chuyển cấu hình Admin sang trạng thái bảng rỗng bằng thao tác xóa thông thường
    it('T7. Không thể chuyển cấu hình Admin sang trạng thái bảng rỗng bằng thao tác xóa thông thường', async () => {
      vi.mocked(db.shippingRate.findUnique).mockResolvedValueOnce({
        id: 'rate-last-standing',
        vehicleType: VehicleType.NORMAL,
        minGrams: 0,
        baseFee: 150000,
        perKm: 8000,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(1) // totalCount <= 1

      const res = await deleteShippingRate('rate-last-standing')
      expect(res.success).toBe(false)
      expect(res.error).toContain('Không thể xóa bậc cước cuối cùng trong hệ thống')
      expect(db.shippingRate.delete).not.toHaveBeenCalled()
    })

    // T8: Hai request initialize defaults đồng thời → không duplicate, xử lý nhất quán qua createMany skipDuplicates
    it('T8. Hai request initialize defaults đồng thời → không duplicate, xử lý nhất quán (skipDuplicates)', async () => {
      vi.mocked(db.shippingRate.createMany).mockResolvedValueOnce({ count: 0 })
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([
        { id: 'tier-1', vehicleType: VehicleType.NORMAL, minGrams: 0, isActive: true },
        { id: 'tier-2', vehicleType: VehicleType.NORMAL, minGrams: 500000, isActive: true },
        { id: 'tier-3', vehicleType: VehicleType.COLD, minGrams: 0, isActive: true },
        { id: 'tier-4', vehicleType: VehicleType.COLD, minGrams: 500000, isActive: true },
      ] as any)

      const res = await initializeDefaultShippingRates()
      expect(res.success).toBe(true)
      expect(res.createdCount).toBe(0)
      expect(db.shippingRate.createMany).toHaveBeenCalledWith({
        data: expect.any(Array),
        skipDuplicates: true,
      })
    })

    // T9: Hai request thay đổi cấu hình đồng thời → không phá invariant bảng cước
    it('T9. Hai request thay đổi cấu hình đồng thời → không phá invariant bảng cước (post-condition check)', async () => {
      vi.mocked(db.shippingRate.findUnique).mockResolvedValueOnce({
        id: 'rate-norm-500',
        vehicleType: VehicleType.NORMAL,
        minGrams: 500000,
        baseFee: 300000,
        perKm: 12000,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(3) // totalCount
      vi.mocked(db.shippingRate.delete).mockResolvedValueOnce({} as any)
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(2) // remainingTotal
      // Giả lập: Một transaction đồng thời khác đã làm mất bậc 0kg COLD
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([
        { id: 'norm-0', vehicleType: VehicleType.NORMAL, minGrams: 0, isActive: true },
        // Thiếu COLD 0kg!
      ] as any)

      const res = await deleteShippingRate('rate-norm-500')
      expect(res.success).toBe(false)
      expect(res.error).toContain('Thao tác xóa bị từ chối: Bảng cước sau khi xóa sẽ thiếu bậc cước cơ sở (0kg) đang hoạt động cho loại xe COLD')
    })

    // T10: Các thao tác bị từ chối không thay đổi snapshot Order hoặc Shipment
    it('T10. Các thao tác bị từ chối không thay đổi snapshot Order hoặc Shipment', async () => {
      // 1. Thao tác xóa bị từ chối
      vi.mocked(db.shippingRate.findUnique).mockResolvedValueOnce({
        id: 'rate-norm-0',
        vehicleType: VehicleType.NORMAL,
        minGrams: 0,
        baseFee: 150000,
        perKm: 8000,
        isActive: true,
      } as any)
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(2)
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(0)
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(1)

      const deleteRes = await deleteShippingRate('rate-norm-0')
      expect(deleteRes.success).toBe(false)

      // 2. Thao tác cập nhật bị từ chối
      vi.mocked(db.shippingRate.findUnique).mockResolvedValueOnce({
        id: 'rate-norm-0',
        vehicleType: VehicleType.NORMAL,
        minGrams: 0,
        baseFee: 150000,
        perKm: 8000,
        isActive: true,
      } as any)
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(0)

      const updateRes = await updateShippingRate({
        id: 'rate-norm-0',
        baseFee: 150000,
        perKm: 8000,
        isActive: false,
      })
      expect(updateRes.success).toBe(false)

      // Khẳng định: Hoàn toàn không có thao tác cập nhật nào lên Order hay Shipment
      expect(db.order.update).not.toHaveBeenCalled()
      expect(db.shipment.update).not.toHaveBeenCalled()
    })
  })

  // =========================================================================
  // GROUP 10: DEV-TASK-23-FIX02 — BẢO MẬT BOOTSTRAP BẢNG CƯỚC & GIAO DỊCH AN TOÀN (B1 - B10)
  // =========================================================================
  describe('10. DEV-TASK-23-FIX02 — BẢO MẬT BOOTSTRAP BẢNG CƯỚC & TRANSACTION SAFETY (B1 - B10)', () => {
    // B1: Empty DB → Create NORMAL 0g → REJECT, DB giữ nguyên rỗng, Checkout vẫn fallback mặc định
    it('B1. Empty DB → Create NORMAL 0g: REJECT, giữ nguyên rỗng, checkout fallback mặc định', async () => {
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(0) // DB rỗng

      const res = await createShippingRate({
        vehicleType: 'NORMAL',
        minGrams: 0,
        baseFee: 150000,
        perKm: 8000,
      })

      expect(res.success).toBe(false)
      expect(res.error).toContain('Hệ thống đang sử dụng bảng cước mặc định. Vui lòng khởi tạo đầy đủ bảng cước trước khi thêm bậc tùy chỉnh.')
      expect(db.shippingRate.create).not.toHaveBeenCalled()

      // Kiểm chứng: Shipping Engine vẫn fallback default hoàn hảo
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([])
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(0)
      const effective = await getEffectiveShippingRates()
      expect(effective.isDefault).toBe(true)
      expect(effective.rates).toEqual(DEFAULT_SHIPPING_RATES)
    })

    // B2: Empty DB → Create NORMAL 500kg → REJECT, không tạo cấu hình thiếu cơ sở
    it('B2. Empty DB → Create NORMAL 500kg: REJECT, không tạo cấu hình thiếu cơ sở', async () => {
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(0) // DB rỗng

      const res = await createShippingRate({
        vehicleType: 'NORMAL',
        minGrams: 500000,
        baseFee: 300000,
        perKm: 12000,
      })

      expect(res.success).toBe(false)
      expect(res.error).toContain('Hệ thống đang sử dụng bảng cước mặc định')
      expect(db.shippingRate.create).not.toHaveBeenCalled()
    })

    // B3: Empty DB → Initialize → Tạo đủ bốn bậc cước
    it('B3. Empty DB → Initialize: Tạo đủ bốn bậc cước chuẩn', async () => {
      vi.mocked(db.shippingRate.createMany).mockResolvedValueOnce({ count: 4 })
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([
        { id: 'norm-0', vehicleType: VehicleType.NORMAL, minGrams: 0, baseFee: 150000, perKm: 8000, isActive: true },
        { id: 'norm-500', vehicleType: VehicleType.NORMAL, minGrams: 500000, baseFee: 300000, perKm: 12000, isActive: true },
        { id: 'cold-0', vehicleType: VehicleType.COLD, minGrams: 0, baseFee: 250000, perKm: 12000, isActive: true },
        { id: 'cold-500', vehicleType: VehicleType.COLD, minGrams: 500000, baseFee: 450000, perKm: 18000, isActive: true },
      ] as any)

      const res = await initializeDefaultShippingRates()
      expect(res.success).toBe(true)
      expect(res.createdCount).toBe(4)
      expect(db.shippingRate.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ vehicleType: VehicleType.NORMAL, minGrams: 0 }),
          expect.objectContaining({ vehicleType: VehicleType.NORMAL, minGrams: 500000 }),
          expect.objectContaining({ vehicleType: VehicleType.COLD, minGrams: 0 }),
          expect.objectContaining({ vehicleType: VehicleType.COLD, minGrams: 500000 }),
        ]),
        skipDuplicates: true,
      })
    })

    // B4: Initialize lần hai → Không duplicate, không ghi đè các mức giá đã chỉnh
    it('B4. Initialize lần hai: Không duplicate, không ghi đè mức giá Admin đã chỉnh', async () => {
      vi.mocked(db.shippingRate.createMany).mockResolvedValueOnce({ count: 0 }) // skipDuplicates = 0 inserted
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([
        { id: 'norm-0', vehicleType: VehicleType.NORMAL, minGrams: 0, baseFee: 190000, perKm: 8500, isActive: true },
        { id: 'norm-500', vehicleType: VehicleType.NORMAL, minGrams: 500000, baseFee: 300000, perKm: 12000, isActive: true },
        { id: 'cold-0', vehicleType: VehicleType.COLD, minGrams: 0, baseFee: 250000, perKm: 12000, isActive: true },
        { id: 'cold-500', vehicleType: VehicleType.COLD, minGrams: 500000, baseFee: 450000, perKm: 18000, isActive: true },
      ] as any)

      const res = await initializeDefaultShippingRates()
      expect(res.success).toBe(true)
      expect(res.createdCount).toBe(0)
      expect(db.shippingRate.update).not.toHaveBeenCalled()
    })

    // B5: Create sau Initialize → Cho phép thêm bậc cước phụ hợp lệ
    it('B5. Create sau Initialize: Cho phép thêm bậc cước phụ hợp lệ', async () => {
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(4) // DB đã có 4 bậc cước
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([
        { id: 'norm-0', vehicleType: VehicleType.NORMAL, minGrams: 0, isActive: true },
        { id: 'cold-0', vehicleType: VehicleType.COLD, minGrams: 0, isActive: true },
      ] as any) // Guard 2: DB hiện tại có đủ bậc cơ sở
      vi.mocked(db.shippingRate.findUnique).mockResolvedValueOnce(null) // Không trùng
      vi.mocked(db.shippingRate.create).mockResolvedValueOnce({
        id: 'rate-norm-1000',
        vehicleType: VehicleType.NORMAL,
        minGrams: 1000000,
        baseFee: 400000,
        perKm: 15000,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([
        { id: 'norm-0', vehicleType: VehicleType.NORMAL, minGrams: 0, isActive: true },
        { id: 'cold-0', vehicleType: VehicleType.COLD, minGrams: 0, isActive: true },
        { id: 'rate-norm-1000', vehicleType: VehicleType.NORMAL, minGrams: 1000000, isActive: true },
      ] as any) // Post-condition: vẫn có đủ bậc cơ sở

      const res = await createShippingRate({
        vehicleType: 'NORMAL',
        minGrams: 1000000,
        baseFee: 400000,
        perKm: 15000,
      })

      expect(res.success).toBe(true)
      expect(res.rate?.minGrams).toBe(1000000)
    })

    // B6: Existing Partial Configuration → Có phương án khôi phục rõ ràng, không âm thầm dùng sai giá, không ghi đè dữ liệu Admin
    it('B6. Existing Partial Configuration: Khôi phục bổ sung bậc thiếu mà không ghi đè dữ liệu cũ', async () => {
      // Giả sử DB đang thiếu 2 bậc COLD, chỉ có 2 bậc NORMAL
      vi.mocked(db.shippingRate.createMany).mockResolvedValueOnce({ count: 2 }) // Chèn 2 bậc COLD còn thiếu
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([
        { id: 'norm-0', vehicleType: VehicleType.NORMAL, minGrams: 0, baseFee: 170000, perKm: 8000, isActive: true },
        { id: 'norm-500', vehicleType: VehicleType.NORMAL, minGrams: 500000, baseFee: 300000, perKm: 12000, isActive: true },
        { id: 'cold-0', vehicleType: VehicleType.COLD, minGrams: 0, baseFee: 250000, perKm: 12000, isActive: true },
        { id: 'cold-500', vehicleType: VehicleType.COLD, minGrams: 500000, baseFee: 450000, perKm: 18000, isActive: true },
      ] as any)

      const res = await initializeDefaultShippingRates()
      expect(res.success).toBe(true)
      expect(res.createdCount).toBe(2)
      expect(db.shippingRate.update).not.toHaveBeenCalled()
    })

    // B7: Concurrent Initialization → Không trùng khóa, không tiếp tục transaction đã aborted, cấu hình cuối hợp lệ
    it('B7. Concurrent Initialization: skipDuplicates chèn an toàn, không sinh aborted transaction', async () => {
      vi.mocked(db.shippingRate.createMany).mockResolvedValueOnce({ count: 0 })
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([
        { id: 'norm-0', vehicleType: VehicleType.NORMAL, minGrams: 0, isActive: true },
        { id: 'cold-0', vehicleType: VehicleType.COLD, minGrams: 0, isActive: true },
      ] as any)

      const res = await initializeDefaultShippingRates()
      expect(res.success).toBe(true)
      expect(res.createdCount).toBe(0)
    })

    // B8: Delete Guard Regression → Các test bảo vệ xóa bậc cước cơ sở tiếp tục PASS
    it('B8. Delete Guard Regression: Không cho phép xóa bậc cước cơ sở 0kg duy nhất', async () => {
      vi.mocked(db.shippingRate.findUnique).mockResolvedValueOnce({
        id: 'norm-0-only',
        vehicleType: VehicleType.NORMAL,
        minGrams: 0,
        baseFee: 150000,
        perKm: 8000,
        isActive: true,
      } as any)
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(2) // totalCount
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(0) // otherBaseCount
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(0) // dependentCount

      const res = await deleteShippingRate('norm-0-only')
      expect(res.success).toBe(false)
      expect(res.error).toContain('Không thể xóa bậc cước cơ sở (0kg) duy nhất của loại xe NORMAL')
      expect(db.shippingRate.delete).not.toHaveBeenCalled()
    })

    // B9: Financial Snapshot → Create/Initialize/Recovery không tự cập nhật Order hoặc Shipment cũ
    it('B9. Financial Snapshot: Create / Initialize không thay đổi Order hoặc Shipment lịch sử', async () => {
      // 1. Initialize
      vi.mocked(db.shippingRate.createMany).mockResolvedValueOnce({ count: 4 })
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([
        { id: 'n0', vehicleType: VehicleType.NORMAL, minGrams: 0, isActive: true },
        { id: 'c0', vehicleType: VehicleType.COLD, minGrams: 0, isActive: true },
      ] as any)
      await initializeDefaultShippingRates()

      // 2. Create auxiliary tier
      vi.mocked(db.shippingRate.count).mockResolvedValueOnce(4)
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([
        { id: 'n0', vehicleType: VehicleType.NORMAL, minGrams: 0, isActive: true },
        { id: 'c0', vehicleType: VehicleType.COLD, minGrams: 0, isActive: true },
      ] as any)
      vi.mocked(db.shippingRate.findUnique).mockResolvedValueOnce(null)
      vi.mocked(db.shippingRate.create).mockResolvedValueOnce({ id: 'n200' } as any)
      vi.mocked(db.shippingRate.findMany).mockResolvedValueOnce([
        { id: 'n0', vehicleType: VehicleType.NORMAL, minGrams: 0, isActive: true },
        { id: 'c0', vehicleType: VehicleType.COLD, minGrams: 0, isActive: true },
      ] as any)
      await createShippingRate({
        vehicleType: 'NORMAL',
        minGrams: 200000,
        baseFee: 200000,
        perKm: 10000,
      })

      // Đảm bảo không có mutation nào lên Order hay Shipment
      expect(db.order.update).not.toHaveBeenCalled()
      expect(db.shipment.update).not.toHaveBeenCalled()
    })

    // B10: UI Recovery Diagnostics → diagnoseShippingRates phân biệt chính xác State A, State B, State C
    it('B10. UI Recovery Diagnostics: diagnoseShippingRates phân loại chính xác State A, State B, State C', () => {
      // State A: DB hoàn toàn rỗng
      const diagA = diagnoseShippingRates([])
      expect(diagA.status).toBe('EMPTY_DB')
      expect(diagA.isUsingDefaultRates).toBe(true)

      // State B: DB hợp lệ có đủ bậc 0kg cho NORMAL và COLD
      const diagB = diagnoseShippingRates([
        { vehicleType: 'NORMAL', minGrams: 0, isActive: true },
        { vehicleType: 'NORMAL', minGrams: 500000, isActive: true },
        { vehicleType: 'COLD', minGrams: 0, isActive: true },
      ])
      expect(diagB.status).toBe('VALID')
      expect(diagB.isUsingDefaultRates).toBe(false)
      expect(diagB.hasNormalBase).toBe(true)
      expect(diagB.hasColdBase).toBe(true)

      // State C1: DB thiếu hoàn toàn bậc cơ sở 0kg của COLD
      const diagC1 = diagnoseShippingRates([
        { vehicleType: 'NORMAL', minGrams: 0, isActive: true },
        { vehicleType: 'NORMAL', minGrams: 500000, isActive: true },
      ])
      expect(diagC1.status).toBe('INVALID')
      expect(diagC1.missingBaseVehicleTypes).toContain('COLD')

      // State C2: DB có bản ghi NORMAL 0kg nhưng bị vô hiệu hóa (isActive = false)
      const diagC2 = diagnoseShippingRates([
        { vehicleType: 'NORMAL', minGrams: 0, isActive: false },
        { vehicleType: 'COLD', minGrams: 0, isActive: true },
      ])
      expect(diagC2.status).toBe('INVALID')
      expect(diagC2.inactiveBaseVehicleTypes).toContain('NORMAL')
      expect(diagC2.errorMessage).toContain('vô hiệu hóa')
    })
  })
})
