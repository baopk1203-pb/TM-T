import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  haversineKm,
  estimateRoadDistanceKm,
  isValidCoordinate,
  resolveCentroid,
  resolveVehicleType,
  findShippingRate,
  computeShippingFee,
  calculateShippingQuote,
  DEFAULT_SHIPPING_RATES,
} from '@/lib/domain/shipping'
import { computeDepositAmount } from '@/lib/domain/settlement'

describe('Domain: Shipping Engine & Checkout (Phase 8A)', () => {
  describe('1. Khoảng cách & Tọa độ thuần (haversineKm, estimateRoadDistanceKm, isValidCoordinate)', () => {
    it('tính khoảng cách đường chim bay chính xác giữa 2 điểm tọa độ', () => {
      // Kho Thủ Đức (10.8505, 106.7717) đến Quận 1 (10.7769, 106.7009)
      const straight = haversineKm(10.8505, 106.7717, 10.7769, 106.7009)
      expect(straight).toBeGreaterThan(10)
      expect(straight).toBeLessThan(14)
    })

    it('ước tính khoảng cách đường bộ bằng đường chim bay x 1.3', () => {
      const straight = 10
      const road = estimateRoadDistanceKm(straight)
      expect(road).toBe(13) // 10 * 1.3 = 13
    })

    it('kiểm tra tính hợp lệ của tọa độ GPS (isValidCoordinate)', () => {
      expect(isValidCoordinate(10.8505, 106.7717)).toBe(true)
      expect(isValidCoordinate(null, 106.7717)).toBe(false)
      expect(isValidCoordinate(10.8505, undefined)).toBe(false)
      expect(isValidCoordinate(NaN, 106.7717)).toBe(false)
      expect(isValidCoordinate(100, 106.7717)).toBe(false) // lat > 90
      expect(isValidCoordinate(10.8505, 200)).toBe(false) // lng > 180
      expect(isValidCoordinate(0, 0)).toBe(false) // Null island (0, 0)
    })

    it('tra cứu tọa độ đại diện trung tâm khu vực khi địa chỉ chưa có GPS ghim (resolveCentroid)', () => {
      const q1 = resolveCentroid('Số 10 Lê Lợi', 'Quận 1', 'TP. Hồ Chí Minh')
      expect(q1).not.toBeNull()
      expect(q1?.lat).toBeCloseTo(10.7769, 3)

      const thuDuc = resolveCentroid('Võ Văn Ngân', 'Thủ Đức', 'Hồ Chí Minh')
      expect(thuDuc).not.toBeNull()
      expect(thuDuc?.lat).toBeCloseTo(10.8505, 3)

      const unknown = resolveCentroid('Thôn 5', 'Huyện Hẻo Lánh', 'Tỉnh Xa Xôi')
      expect(unknown).toBeNull()
    })
  })

  describe('2. Phân loại xe (resolveVehicleType)', () => {
    it('bắt buộc sử dụng xe COLD nếu giỏ có bất kỳ sản phẩm nào có requiresCold = true', () => {
      const items = [{ requiresCold: false }, { requiresCold: true }, { requiresCold: false }]
      // Khách yêu cầu NORMAL nhưng hệ thống bắt buộc COLD
      expect(resolveVehicleType(items, 'NORMAL')).toBe('COLD')
      expect(resolveVehicleType(items, undefined)).toBe('COLD')
      expect(resolveVehicleType(items, 'COLD')).toBe('COLD')
    })

    it('mặc định xe NORMAL nếu không có sản phẩm nhạy cảm nhiệt độ', () => {
      const items = [{ requiresCold: false }, { requiresCold: false }]
      expect(resolveVehicleType(items)).toBe('NORMAL')
      expect(resolveVehicleType(items, 'NORMAL')).toBe('NORMAL')
    })

    it('cho phép khách hàng chủ động nâng cấp lên xe COLD khi hàng không yêu cầu', () => {
      const items = [{ requiresCold: false }, { requiresCold: false }]
      expect(resolveVehicleType(items, 'COLD')).toBe('COLD')
    })
  })

  describe('3. Bậc cước vận chuyển (findShippingRate)', () => {
    it('chọn bậc cước 0 - 500kg cho xe NORMAL khi khối lượng < 500kg', () => {
      const rate = findShippingRate(DEFAULT_SHIPPING_RATES, 'NORMAL', 210000)
      expect(rate.baseFee).toBe(150000)
      expect(rate.perKm).toBe(8000)
      expect(rate.minGrams).toBe(0)
    })

    it('chọn bậc cước >= 500kg cho xe NORMAL khi khối lượng >= 500kg', () => {
      const rate = findShippingRate(DEFAULT_SHIPPING_RATES, 'NORMAL', 500000)
      expect(rate.baseFee).toBe(300000)
      expect(rate.perKm).toBe(12000)
      expect(rate.minGrams).toBe(500000)
    })

    it('chốt chính xác ranh giới bậc tải trọng tại 499.999g và 500.000g', () => {
      const rateUnder = findShippingRate(DEFAULT_SHIPPING_RATES, 'NORMAL', 499999)
      expect(rateUnder.minGrams).toBe(0)
      expect(rateUnder.baseFee).toBe(150000)

      const rateExact = findShippingRate(DEFAULT_SHIPPING_RATES, 'NORMAL', 500000)
      expect(rateExact.minGrams).toBe(500000)
      expect(rateExact.baseFee).toBe(300000)
    })

    it('chọn bậc cước cho xe COLD chính xác theo tải trọng', () => {
      const rateSmall = findShippingRate(DEFAULT_SHIPPING_RATES, 'COLD', 100000)
      expect(rateSmall.baseFee).toBe(250000)
      expect(rateSmall.perKm).toBe(12000)

      const rateLarge = findShippingRate(DEFAULT_SHIPPING_RATES, 'COLD', 600000)
      expect(rateLarge.baseFee).toBe(450000)
      expect(rateLarge.perKm).toBe(18000)
    })
  })

  describe('4. Bốn Test Cases Bắt Buộc F1 - F4 (Mục 7.6 & Mục 9)', () => {
    it('F1: NORMAL, 210kg, 23.4km -> ceil(23.4) = 24km -> 150.000 + 24 * 8.000 = 342.000 đ', () => {
      const res = computeShippingFee({
        totalGrams: 210000,
        vehicleType: 'NORMAL',
        distanceKm: 23.4,
      })
      expect(res.billedKm).toBe(24)
      expect(res.baseFee).toBe(150000)
      expect(res.perKm).toBe(8000)
      expect(res.fee).toBe(342000)
    })

    it('F2: COLD, 600kg, 10.2km -> ceil(10.2) = 11km -> 450.000 + 11 * 18.000 = 648.000 đ', () => {
      const res = computeShippingFee({
        totalGrams: 600000,
        vehicleType: 'COLD',
        distanceKm: 10.2,
      })
      expect(res.billedKm).toBe(11)
      expect(res.baseFee).toBe(450000)
      expect(res.perKm).toBe(18000)
      expect(res.fee).toBe(648000)
    })

    it('F3: NORMAL, 10kg, 0.5km -> ceil(0.5) = 1km -> 150.000 + 1 * 8.000 = 158.000 đ', () => {
      const res = computeShippingFee({
        totalGrams: 10000,
        vehicleType: 'NORMAL',
        distanceKm: 0.5,
      })
      expect(res.billedKm).toBe(1)
      expect(res.baseFee).toBe(150000)
      expect(res.perKm).toBe(8000)
      expect(res.fee).toBe(158000)
    })

    it('F4: Khoảng cách vượt maxRadiusKm (100km) -> ném lỗi và chặn checkout', () => {
      expect(() =>
        computeShippingFee({
          totalGrams: 100000,
          vehicleType: 'NORMAL',
          distanceKm: 100.1,
          maxRadiusKm: 100,
        })
      ).toThrow('vượt quá bán kính phục vụ tối đa')
    })
  })

  describe('5. Fallback & Tích hợp Google Routes API (calculateShippingQuote)', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
    })

    it('hoạt động bình thường khi KHÔNG có Google Maps API key (dùng Haversine x 1.3 và gắn cờ ước tính)', async () => {
      const quote = await calculateShippingQuote(
        {
          totalGrams: 210000,
          requiresCold: false,
          vehicleType: 'NORMAL',
          lat: 10.7412,
          lng: 106.7188,
          addressText: 'Số 120 Đường Nguyễn Thị Thập, Quận 7, TP.HCM',
        },
        { apiKey: '' } // Không có key
      )

      expect(quote.allowed).toBe(true)
      expect(quote.fee).toBeGreaterThan(0)
      expect(quote.isEstimated).toBe(true)
      expect(quote.note).toContain('ước tính')
    })

    it('xử lý địa chỉ không có tọa độ nhưng có tên Quận/Huyện TP.HCM (dùng tọa độ đại diện centroid)', async () => {
      const quote = await calculateShippingQuote({
        totalGrams: 10000,
        lat: null,
        lng: null,
        addressText: 'Đường Nguyễn Huệ',
        district: 'Quận 1',
        province: 'TP. Hồ Chí Minh',
      })

      expect(quote.allowed).toBe(true)
      expect(quote.isEstimated).toBe(true)
      expect(quote.note).toContain('đại diện')
      expect(quote.fee).toBeGreaterThan(0)
    })

    it('từ chối báo giá và chặn đơn nếu địa chỉ không có tọa độ và không nhận diện được khu vực', async () => {
      const quote = await calculateShippingQuote({
        totalGrams: 10000,
        lat: null,
        lng: null,
        addressText: 'Khu vực không rõ',
        district: 'Vùng sâu vùng xa',
        province: 'Chưa xác định',
      })

      expect(quote.allowed).toBe(false)
      expect(quote.fee).toBe(0)
      expect(quote.error).toContain('chưa có tọa độ')
    })

    it('chặn đơn và trả về allowed = false nếu khoảng cách vượt 100km', async () => {
      // Vị trí xa > 100km (ví dụ Cần Thơ: 10.0452, 105.7469)
      const quote = await calculateShippingQuote({
        totalGrams: 50000,
        lat: 10.0452,
        lng: 105.7469,
        addressText: 'Ninh Kiều, Cần Thơ',
      })

      expect(quote.allowed).toBe(false)
      expect(quote.fee).toBe(0)
      expect(quote.error).toContain('vượt quá bán kính phục vụ')
    })

    it('xử lý graceful fallback khi Google API trả về lỗi hoặc HTTP 500', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      } as unknown as Response)

      const quote = await calculateShippingQuote(
        {
          totalGrams: 50000,
          lat: 10.8032,
          lng: 106.7456,
          addressText: 'Song Hành Xa Lộ Hà Nội, TP. Thủ Đức',
        },
        { apiKey: 'mock-key' }
      )

      expect(quote.allowed).toBe(true)
      expect(quote.isEstimated).toBe(true) // Fallback sang Haversine
      expect(quote.fee).toBeGreaterThan(0)
    })
  })

  describe('6. Công thức Tài chính & Đặt cọc (total = subtotal + shippingFee, cọc 30%)', () => {
    it('tổng tiền đơn hàng phải bao gồm cả tiền hàng và phí vận chuyển', () => {
      const subtotal = 10000000 // 10.000.000 đ
      const shippingFee = 342000 // Phí ship F1
      const total = subtotal + shippingFee
      expect(total).toBe(10342000)

      // Cọc 30% làm tròn lên nghìn đồng
      const depositAmount = computeDepositAmount(total)
      // 10.342.000 * 0.3 = 3.102.600 -> làm tròn lên nghìn thành 3.103.000 đ
      expect(depositAmount).toBe(3103000)
    })

    it('tính toán cọc 30% cho đơn FULL và DEPOSIT_30 đều đồng nhất công thức', () => {
      const subtotal = 5000000
      const shippingFee = 158000 // Phí ship F3
      const total = subtotal + shippingFee // 5.158.000 đ
      const deposit = computeDepositAmount(total)
      // 5.158.000 * 0.3 = 1.547.400 -> 1.548.000 đ
      expect(deposit).toBe(1548000)
    })

    it('bảo toàn tính toàn vẹn cho đơn hàng cũ (shippingFee = 0 đ)', () => {
      const subtotal = 4000000
      const oldShippingFee = 0
      const total = subtotal + oldShippingFee
      expect(total).toBe(4000000)
      expect(computeDepositAmount(total)).toBe(1200000) // 4tr * 0.3 = 1.2tr tròn
    })
  })
})
