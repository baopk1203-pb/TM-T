/**
 * Domain Logic: Vận chuyển & Phí giao hàng (Shipping Engine - Phase 8A)
 *
 * Tính năng tính phí vận chuyển chuyên sâu theo khoảng cách thực tế (Google Routes API),
 * đường chim bay ước tính (Haversine x 1.3), loại phương tiện (NORMAL / COLD)
 * và tổng khối lượng đơn hàng (bậc tải trọng).
 */

import {
  MembershipTier,
  calculateMembershipShippingBenefit,
} from '../membership'

export type VehicleType = 'NORMAL' | 'COLD'

export interface ShippingRateRule {
  id?: string
  vehicleType: VehicleType
  minGrams: number
  baseFee: number
  perKm: number
  isActive?: boolean
}

export interface ShippingQuoteInput {
  totalGrams: number
  requiresCold?: boolean // derived from cart items
  vehicleType?: VehicleType // user preferred vehicle type (can upgrade to COLD)
  lat?: number | null
  lng?: number | null
  addressText?: string
  district?: string
  province?: string
  membershipTier?: MembershipTier | null
}

export interface ShippingQuoteResult {
  fee: number
  baseShippingFee?: number
  membershipShippingDiscount?: number
  vehicleType: VehicleType
  distanceKm: number
  billedKm: number
  baseFee: number
  perKm: number
  minGrams: number
  isEstimated: boolean
  note: string
  error?: string
  allowed: boolean
}

export interface ShippingCalculator {
  quote(input: ShippingQuoteInput): Promise<ShippingQuoteResult>
}

/**
 * Cấu hình Kho Tổng trung tâm Demo (Mục 4)
 */
export const DEFAULT_WAREHOUSE = {
  lat: 10.8505,
  lng: 106.7717,
  maxRadiusKm: 100,
  name: 'Kho trung tâm Demo — Khu vực Thủ Đức, TP.HCM',
  address: 'Khu vực Thủ Đức, TP. Hồ Chí Minh',
}

/**
 * Ma trận bảng cước vận chuyển chuẩn (Bảng cước Mục 4)
 */
export const DEFAULT_SHIPPING_RATES: ShippingRateRule[] = [
  { vehicleType: 'NORMAL', minGrams: 0, baseFee: 150000, perKm: 8000, isActive: true },
  { vehicleType: 'NORMAL', minGrams: 500000, baseFee: 300000, perKm: 12000, isActive: true },
  { vehicleType: 'COLD', minGrams: 0, baseFee: 250000, perKm: 12000, isActive: true },
  { vehicleType: 'COLD', minGrams: 500000, baseFee: 450000, perKm: 18000, isActive: true },
]

/**
 * Bảng tọa độ đại diện trung tâm các Quận/Huyện TP.HCM & các tỉnh lân cận
 * dùng khi địa chỉ chưa có tọa độ GPS ghim chính xác (Mục 5)
 */
export const DISTRICT_CENTROIDS: Record<string, { lat: number; lng: number; name: string }> = {
  'thủ đức': { lat: 10.8505, lng: 106.7717, name: 'TP. Thủ Đức' },
  'thu duc': { lat: 10.8505, lng: 106.7717, name: 'TP. Thủ Đức' },
  'quận 1': { lat: 10.7769, lng: 106.7009, name: 'Quận 1, TP.HCM' },
  'quan 1': { lat: 10.7769, lng: 106.7009, name: 'Quận 1, TP.HCM' },
  'quận 3': { lat: 10.7844, lng: 106.6844, name: 'Quận 3, TP.HCM' },
  'quan 3': { lat: 10.7844, lng: 106.6844, name: 'Quận 3, TP.HCM' },
  'quận 4': { lat: 10.7578, lng: 106.7013, name: 'Quận 4, TP.HCM' },
  'quan 4': { lat: 10.7578, lng: 106.7013, name: 'Quận 4, TP.HCM' },
  'quận 5': { lat: 10.7540, lng: 106.6634, name: 'Quận 5, TP.HCM' },
  'quan 5': { lat: 10.7540, lng: 106.6634, name: 'Quận 5, TP.HCM' },
  'quận 6': { lat: 10.7472, lng: 106.6352, name: 'Quận 6, TP.HCM' },
  'quan 6': { lat: 10.7472, lng: 106.6352, name: 'Quận 6, TP.HCM' },
  'quận 7': { lat: 10.7340, lng: 106.7218, name: 'Quận 7, TP.HCM' },
  'quan 7': { lat: 10.7340, lng: 106.7218, name: 'Quận 7, TP.HCM' },
  'quận 8': { lat: 10.7241, lng: 106.6286, name: 'Quận 8, TP.HCM' },
  'quan 8': { lat: 10.7241, lng: 106.6286, name: 'Quận 8, TP.HCM' },
  'quận 10': { lat: 10.7715, lng: 106.6674, name: 'Quận 10, TP.HCM' },
  'quan 10': { lat: 10.7715, lng: 106.6674, name: 'Quận 10, TP.HCM' },
  'quận 11': { lat: 10.7629, lng: 106.6504, name: 'Quận 11, TP.HCM' },
  'quan 11': { lat: 10.7629, lng: 106.6504, name: 'Quận 11, TP.HCM' },
  'quận 12': { lat: 10.8672, lng: 106.6413, name: 'Quận 12, TP.HCM' },
  'quan 12': { lat: 10.8672, lng: 106.6413, name: 'Quận 12, TP.HCM' },
  'bình thạnh': { lat: 10.8106, lng: 106.7091, name: 'Bình Thạnh, TP.HCM' },
  'binh thanh': { lat: 10.8106, lng: 106.7091, name: 'Bình Thạnh, TP.HCM' },
  'gò vấp': { lat: 10.8388, lng: 106.6653, name: 'Gò Vấp, TP.HCM' },
  'go vap': { lat: 10.8388, lng: 106.6653, name: 'Gò Vấp, TP.HCM' },
  'phú nhuận': { lat: 10.7992, lng: 106.6803, name: 'Phú Nhuận, TP.HCM' },
  'phu nhuan': { lat: 10.7992, lng: 106.6803, name: 'Phú Nhuận, TP.HCM' },
  'tân bình': { lat: 10.8015, lng: 106.6548, name: 'Tân Bình, TP.HCM' },
  'tan binh': { lat: 10.8015, lng: 106.6548, name: 'Tân Bình, TP.HCM' },
  'tân phú': { lat: 10.7901, lng: 106.6282, name: 'Tân Phú, TP.HCM' },
  'tan phu': { lat: 10.7901, lng: 106.6282, name: 'Tân Phú, TP.HCM' },
  'bình tân': { lat: 10.7654, lng: 106.6039, name: 'Bình Tân, TP.HCM' },
  'binh tan': { lat: 10.7654, lng: 106.6039, name: 'Bình Tân, TP.HCM' },
  'bình chánh': { lat: 10.6875, lng: 106.5939, name: 'Bình Chánh, TP.HCM' },
  'binh chanh': { lat: 10.6875, lng: 106.5939, name: 'Bình Chánh, TP.HCM' },
  'hóc môn': { lat: 10.8841, lng: 106.5925, name: 'Hóc Môn, TP.HCM' },
  'hoc mon': { lat: 10.8841, lng: 106.5925, name: 'Hóc Môn, TP.HCM' },
  'củ chi': { lat: 11.0067, lng: 106.5132, name: 'Củ Chi, TP.HCM' },
  'cu chi': { lat: 11.0067, lng: 106.5132, name: 'Củ Chi, TP.HCM' },
  'nhà bè': { lat: 10.6953, lng: 106.7277, name: 'Nhà Bè, TP.HCM' },
  'nha be': { lat: 10.6953, lng: 106.7277, name: 'Nhà Bè, TP.HCM' },
  'cần giờ': { lat: 10.4114, lng: 106.9547, name: 'Cần Giờ, TP.HCM' },
  'can gio': { lat: 10.4114, lng: 106.9547, name: 'Cần Giờ, TP.HCM' },
  'bình dương': { lat: 10.9805, lng: 106.6519, name: 'Tỉnh Bình Dương' },
  'binh duong': { lat: 10.9805, lng: 106.6519, name: 'Tỉnh Bình Dương' },
  'đồng nai': { lat: 10.9574, lng: 106.8427, name: 'Tỉnh Đồng Nai' },
  'dong nai': { lat: 10.9574, lng: 106.8427, name: 'Tỉnh Đồng Nai' },
  'biên hòa': { lat: 10.9574, lng: 106.8427, name: 'TP. Biên Hòa' },
  'bien hoa': { lat: 10.9574, lng: 106.8427, name: 'TP. Biên Hòa' },
  'long an': { lat: 10.5364, lng: 106.4134, name: 'Tỉnh Long An' },
  'tân an': { lat: 10.5364, lng: 106.4134, name: 'TP. Tân An' },
  'hồ chí minh': { lat: 10.7769, lng: 106.7009, name: 'TP. Hồ Chí Minh' },
  'tp.hcm': { lat: 10.7769, lng: 106.7009, name: 'TP. Hồ Chí Minh' },
  'tphcm': { lat: 10.7769, lng: 106.7009, name: 'TP. Hồ Chí Minh' },
}

/**
 * Kiểm tra tính hợp lệ của cặp tọa độ GPS:
 * - Phải là số thực hữu hạn
 * - Vĩ độ (-90 đến +90), kinh độ (-180 đến +180)
 * - Không phải tọa độ rỗng (0, 0)
 */
export function isValidCoordinate(lat?: number | null, lng?: number | null): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false
  if (isNaN(lat) || isNaN(lng) || !isFinite(lat) || !isFinite(lng)) return false
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false
  // Không chấp nhận tọa độ (0, 0) đại dương Null Island
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false
  return true
}

/**
 * Tra cứu tọa độ đại diện quận/huyện/tỉnh khi địa chỉ chưa có tọa độ ghim (Mục 5)
 */
export function resolveCentroid(
  addressText?: string,
  district?: string,
  province?: string
): { lat: number; lng: number; name: string } | null {
  const combined = `${district || ''} ${province || ''} ${addressText || ''}`.toLowerCase()

  for (const [key, centroid] of Object.entries(DISTRICT_CENTROIDS)) {
    if (combined.includes(key)) {
      return centroid
    }
  }

  return null
}

/**
 * Tính khoảng cách đường chim bay giữa 2 điểm tọa độ theo công thức Haversine (km)
 */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371 // Bán kính Trái Đất (km)
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Ước tính khoảng cách đường bộ từ khoảng cách chim bay:
 * distanceKm = haversineKm * 1.3
 */
export function estimateRoadDistanceKm(straightKm: number): number {
  return Math.round(straightKm * 1.3 * 10) / 10
}

/**
 * Phân định loại xe giao hàng theo sản phẩm và yêu cầu của khách (Mục 4):
 * - Nếu bất kỳ sản phẩm nào có requiresCold = true -> bắt buộc COLD.
 * - Nếu không có sản phẩm bắt buộc lạnh -> mặc định NORMAL, khách có thể nâng cấp lên COLD.
 * - Server không chấp nhận NORMAL khi giỏ có hàng bắt buộc COLD.
 */
export function resolveVehicleType(
  items: Array<{ requiresCold?: boolean }>,
  requestedVehicleType?: VehicleType
): VehicleType {
  const hasColdProduct = items.some((item) => item.requiresCold)
  if (hasColdProduct) {
    return 'COLD'
  }
  return requestedVehicleType === 'COLD' ? 'COLD' : 'NORMAL'
}

/**
 * Tìm bản ghi bậc cước phù hợp nhất theo loại xe và tổng khối lượng:
 * Chọn bản ghi có minGrams lớn nhất không vượt tổng khối lượng (Mục 4)
 */
export function findShippingRate(
  rates: ShippingRateRule[],
  vehicleType: VehicleType,
  totalGrams: number
): ShippingRateRule {
  const applicable = rates
    .filter(
      (r) =>
        r.vehicleType === vehicleType &&
        (r.isActive ?? true) &&
        r.minGrams <= totalGrams
    )
    .sort((a, b) => b.minGrams - a.minGrams)

  if (applicable.length > 0) {
    return applicable[0]
  }

  // Fallback nếu không có bậc nào nhỏ hơn tổng khối lượng (ví dụ âm hoặc cấu hình bất thường)
  const fallback = rates
    .filter((r) => r.vehicleType === vehicleType && (r.isActive ?? true))
    .sort((a, b) => a.minGrams - b.minGrams)

  if (fallback.length > 0) {
    return fallback[0]
  }

  throw new Error(`Không tìm thấy cấu hình cước cho loại xe ${vehicleType}`)
}

/**
 * Tính phí vận chuyển (Hàm thuần - Mục 4 & Mục 7.6):
 * fee = ceil((baseFee + ceil(distanceKm) * perKm) / 1000) * 1000
 * Nếu distanceKm > maxRadiusKm: ném lỗi vượt bán kính phục vụ.
 */
export function computeShippingFee({
  totalGrams,
  vehicleType,
  distanceKm,
  rates = DEFAULT_SHIPPING_RATES,
  maxRadiusKm = DEFAULT_WAREHOUSE.maxRadiusKm,
}: {
  totalGrams: number
  vehicleType: VehicleType
  distanceKm: number
  rates?: ShippingRateRule[]
  maxRadiusKm?: number
}): {
  fee: number
  baseFee: number
  perKm: number
  billedKm: number
  minGrams: number
} {
  if (distanceKm > maxRadiusKm) {
    throw new Error(
      `Khoảng cách giao hàng (${distanceKm}km) vượt quá bán kính phục vụ tối đa (${maxRadiusKm}km). Vui lòng liên hệ hotline để được hỗ trợ giao hàng liên tỉnh.`
    )
  }

  const billedKm = Math.ceil(distanceKm)
  const rate = findShippingRate(rates, vehicleType, totalGrams)
  const rawFee = rate.baseFee + billedKm * rate.perKm
  const fee = Math.ceil(rawFee / 1000) * 1000

  return {
    fee,
    baseFee: rate.baseFee,
    perKm: rate.perKm,
    billedKm,
    minGrams: rate.minGrams,
  }
}

/**
 * Gọi Google Routes API (ComputeRoutes v2) từ server-side:
 * - Bảo vệ bằng timeout 3000ms
 * - Trả về khoảng cách theo km hoặc null nếu lỗi/timeout/thiếu key
 */
export async function fetchGoogleRoutesDistance(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  apiKey?: string
): Promise<number | null> {
  const key = apiKey || process.env.GOOGLE_MAPS_API_KEY
  if (!key) return null

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)

    const response = await fetch(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
        },
        body: JSON.stringify({
          origin: {
            location: {
              latLng: {
                latitude: origin.lat,
                longitude: origin.lng,
              },
            },
          },
          destination: {
            location: {
              latLng: {
                latitude: destination.lat,
                longitude: destination.lng,
              },
            },
          },
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_UNAWARE',
        }),
        signal: controller.signal,
      }
    )

    clearTimeout(timer)

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    const distanceMeters = data?.routes?.[0]?.distanceMeters

    if (typeof distanceMeters === 'number' && distanceMeters >= 0) {
      return Math.round((distanceMeters / 1000) * 10) / 10
    }

    return null
  } catch {
    return null
  }
}

/**
 * Tính toán báo giá vận chuyển toàn diện (Shipping Engine Calculator)
 */
export async function calculateShippingQuote(
  input: ShippingQuoteInput,
  options?: {
    rates?: ShippingRateRule[]
    warehouse?: typeof DEFAULT_WAREHOUSE
    apiKey?: string
  }
): Promise<ShippingQuoteResult> {
  const warehouse = options?.warehouse || DEFAULT_WAREHOUSE
  const rates = options?.rates || DEFAULT_SHIPPING_RATES

  // 1. Xác định loại xe
  const vehicleType = resolveVehicleType(
    [{ requiresCold: input.requiresCold }],
    input.vehicleType
  )

  // 2. Xác định tọa độ giao hàng
  let destLat = input.lat
  let destLng = input.lng
  let isCentroidFallback = false

  if (!isValidCoordinate(destLat, destLng)) {
    const centroid = resolveCentroid(input.addressText, input.district, input.province)
    if (centroid) {
      destLat = centroid.lat
      destLng = centroid.lng
      isCentroidFallback = true
    } else {
      return {
        fee: 0,
        vehicleType,
        distanceKm: 0,
        billedKm: 0,
        baseFee: 0,
        perKm: 0,
        minGrams: 0,
        isEstimated: false,
        note: 'Địa chỉ chưa có tọa độ giao hàng',
        error:
          'Địa chỉ giao hàng chưa có tọa độ hợp lệ. Vui lòng cập nhật tọa độ hoặc chọn địa chỉ đầy đủ quận/huyện để tính phí.',
        allowed: false,
      }
    }
  }

  // 3. Tính khoảng cách (Google Routes API hoặc Haversine x 1.3)
  let distanceKm: number
  let isEstimated: boolean
  let note: string

  const googleDist = await fetchGoogleRoutesDistance(
    { lat: warehouse.lat, lng: warehouse.lng },
    { lat: destLat!, lng: destLng! },
    options?.apiKey
  )

  if (googleDist !== null && !isCentroidFallback) {
    distanceKm = googleDist
    isEstimated = false
    note = 'Khoảng cách đường bộ tính theo Google Routes'
  } else {
    const straight = haversineKm(warehouse.lat, warehouse.lng, destLat!, destLng!)
    distanceKm = estimateRoadDistanceKm(straight)
    isEstimated = true
    note = isCentroidFallback
      ? 'Khoảng cách ước tính (tọa độ đại diện khu vực)'
      : 'Khoảng cách ước tính'
  }

  // 4. Tính phí theo công thức
  try {
    const feeResult = computeShippingFee({
      totalGrams: input.totalGrams,
      vehicleType,
      distanceKm,
      rates,
      maxRadiusKm: warehouse.maxRadiusKm,
    })

    const baseCalculatedFee = feeResult.fee
    const shippingBenefit = calculateMembershipShippingBenefit({
      baseShippingFee: baseCalculatedFee,
      totalGrams: input.totalGrams,
      tier: input.membershipTier ?? null,
    })

    return {
      fee: shippingBenefit.finalShippingFee,
      baseShippingFee: shippingBenefit.baseShippingFee,
      membershipShippingDiscount: shippingBenefit.membershipShippingDiscount,
      vehicleType,
      distanceKm,
      billedKm: feeResult.billedKm,
      baseFee: feeResult.baseFee,
      perKm: feeResult.perKm,
      minGrams: feeResult.minGrams,
      isEstimated,
      note,
      allowed: true,
    }
  } catch (err: unknown) {
    return {
      fee: 0,
      vehicleType,
      distanceKm,
      billedKm: Math.ceil(distanceKm),
      baseFee: 0,
      perKm: 0,
      minGrams: 0,
      isEstimated,
      note,
      error: err instanceof Error ? err.message : 'Khoảng cách vượt quá bán kính phục vụ',
      allowed: false,
    }
  }
}

/**
 * Calculator mặc định của hệ thống
 */
export const defaultShippingCalculator: ShippingCalculator = {
  async quote(input: ShippingQuoteInput): Promise<ShippingQuoteResult> {
    return calculateShippingQuote(input)
  },
}

/**
 * Calculator giả lập cho trường hợp cần mock phí = 0
 */
export const zeroShippingCalculator: ShippingCalculator = {
  async quote(input: ShippingQuoteInput): Promise<ShippingQuoteResult> {
    const vehicleType = input.requiresCold ? 'COLD' : 'NORMAL'
    return {
      fee: 0,
      baseShippingFee: 0,
      membershipShippingDiscount: 0,
      vehicleType,
      distanceKm: 0,
      billedKm: 0,
      baseFee: 0,
      perKm: 0,
      minGrams: 0,
      isEstimated: false,
      note: 'Phí vận chuyển: Sẽ được báo chính xác khi Admin xác nhận đơn hàng',
      allowed: true,
    }
  },
}

/**
 * Hook lấy shipping calculator hiện hành của hệ thống
 */
export function getShippingCalculator(): ShippingCalculator {
  return defaultShippingCalculator
}
