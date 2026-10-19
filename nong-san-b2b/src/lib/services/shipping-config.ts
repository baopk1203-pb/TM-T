import { db } from '@/lib/db'
import {
  DEFAULT_SHIPPING_RATES,
  DEFAULT_WAREHOUSE,
  calculateShippingQuote,
  ShippingRateRule,
  ShippingQuoteInput,
  ShippingQuoteResult,
  ShippingCalculator,
  VehicleType,
} from '@/lib/domain/shipping'

export interface EffectiveRatesResult {
  rates: ShippingRateRule[]
  isDefault: boolean
  error?: string
}

export type ShippingConfigStatus = 'EMPTY_DB' | 'VALID' | 'INVALID'

export interface ShippingConfigDiagnostic {
  status: ShippingConfigStatus
  isUsingDefaultRates: boolean
  hasNormalBase: boolean
  hasColdBase: boolean
  hasNormalBaseRecord: boolean
  hasColdBaseRecord: boolean
  missingBaseVehicleTypes: ('NORMAL' | 'COLD')[]
  inactiveBaseVehicleTypes: ('NORMAL' | 'COLD')[]
  totalRatesCount: number
  activeRatesCount: number
  errorMessage?: string
}

/**
 * Kiểm tra và chẩn đoán trạng thái cấu hình bảng cước vận chuyển:
 * - State A (EMPTY_DB): Bảng cước rỗng, dùng DEFAULT_SHIPPING_RATES
 * - State B (VALID): DB có cấu hình đầy đủ ít nhất 1 bậc 0kg active cho NORMAL và COLD
 * - State C (INVALID): DB có cấu hình nhưng thiếu bậc 0kg hoặc bậc 0kg bị vô hiệu hóa
 */
export function diagnoseShippingRates(
  dbRates: Array<{
    vehicleType: string
    minGrams: number
    isActive: boolean
  }>
): ShippingConfigDiagnostic {
  const totalRatesCount = dbRates.length
  if (totalRatesCount === 0) {
    return {
      status: 'EMPTY_DB',
      isUsingDefaultRates: true,
      hasNormalBase: false,
      hasColdBase: false,
      hasNormalBaseRecord: false,
      hasColdBaseRecord: false,
      missingBaseVehicleTypes: ['NORMAL', 'COLD'],
      inactiveBaseVehicleTypes: [],
      totalRatesCount: 0,
      activeRatesCount: 0,
      errorMessage: undefined,
    }
  }

  const activeRates = dbRates.filter((r) => r.isActive)
  const hasNormalBase = activeRates.some((r) => r.vehicleType === 'NORMAL' && r.minGrams === 0)
  const hasColdBase = activeRates.some((r) => r.vehicleType === 'COLD' && r.minGrams === 0)

  const hasNormalBaseRecord = dbRates.some((r) => r.vehicleType === 'NORMAL' && r.minGrams === 0)
  const hasColdBaseRecord = dbRates.some((r) => r.vehicleType === 'COLD' && r.minGrams === 0)

  const missingBaseVehicleTypes: ('NORMAL' | 'COLD')[] = []
  if (!hasNormalBaseRecord) missingBaseVehicleTypes.push('NORMAL')
  if (!hasColdBaseRecord) missingBaseVehicleTypes.push('COLD')

  const inactiveBaseVehicleTypes: ('NORMAL' | 'COLD')[] = []
  if (hasNormalBaseRecord && !hasNormalBase) inactiveBaseVehicleTypes.push('NORMAL')
  if (hasColdBaseRecord && !hasColdBase) inactiveBaseVehicleTypes.push('COLD')

  const isValid = hasNormalBase && hasColdBase

  let errorMessage: string | undefined
  if (!isValid) {
    if (missingBaseVehicleTypes.length > 0 && inactiveBaseVehicleTypes.length > 0) {
      errorMessage = `Bảng cước thiếu bậc cơ sở (0kg) cho xe ${missingBaseVehicleTypes.join(', ')} và bậc cơ sở cho xe ${inactiveBaseVehicleTypes.join(', ')} đang bị vô hiệu hóa.`
    } else if (missingBaseVehicleTypes.length > 0) {
      errorMessage = `Bảng cước thiếu bậc cơ sở (0kg) cho xe ${missingBaseVehicleTypes.join(', ')}.`
    } else {
      errorMessage = `Bậc cước cơ sở (0kg) cho xe ${inactiveBaseVehicleTypes.join(', ')} đang bị vô hiệu hóa.`
    }
  }

  return {
    status: isValid ? 'VALID' : 'INVALID',
    isUsingDefaultRates: false,
    hasNormalBase,
    hasColdBase,
    hasNormalBaseRecord,
    hasColdBaseRecord,
    missingBaseVehicleTypes,
    inactiveBaseVehicleTypes,
    totalRatesCount,
    activeRatesCount: activeRates.length,
    errorMessage,
  }
}

export interface WarehouseConfig {
  lat: number
  lng: number
  maxRadiusKm: number
  name: string
  address: string
}

/**
 * Nạp bảng cước phí vận chuyển hiệu lực từ Database.
 * - Nếu bảng ShippingRate hoàn toàn rỗng: Dùng DEFAULT_SHIPPING_RATES (isDefault: true).
 * - Nếu bảng đã có cấu hình thực: Chỉ sử dụng các rate isActive = true từ DB.
 *   Không trộn rate DB với code mặc định để bảo đảm tính nhất quán tài chính.
 * - Nếu DB có cấu hình nhưng thiếu bậc cước cơ sở (minGrams = 0 cho NORMAL hoặc COLD), báo lỗi rõ ràng.
 */
export async function getEffectiveShippingRates(): Promise<EffectiveRatesResult> {
  if (!db?.shippingRate?.findMany) {
    return {
      rates: DEFAULT_SHIPPING_RATES,
      isDefault: true,
    }
  }

  const dbRates = await db.shippingRate.findMany({
    where: { isActive: true },
    orderBy: [{ vehicleType: 'asc' }, { minGrams: 'asc' }],
  })

  // Nếu bảng hoàn toàn rỗng (chưa từng seed hoặc cấu hình) -> dùng bảng cước mặc định
  if (dbRates.length === 0) {
    const allCount = await db.shippingRate.count()
    if (allCount === 0) {
      return {
        rates: DEFAULT_SHIPPING_RATES,
        isDefault: true,
      }
    }
    // Trường hợp Admin đã vô hiệu hóa toàn bộ bảng cước
    return {
      rates: [],
      isDefault: false,
      error: 'Toàn bộ bảng cước vận chuyển đang bị vô hiệu hóa. Vui lòng liên hệ Admin.',
    }
  }

  // Chuyển đổi dữ liệu Prisma sang ShippingRateRule interface
  const rates: ShippingRateRule[] = dbRates.map((r) => ({
    id: r.id,
    vehicleType: r.vehicleType as VehicleType,
    minGrams: r.minGrams,
    baseFee: r.baseFee,
    perKm: r.perKm,
    isActive: r.isActive,
  }))

  // Kiểm tra tính hoàn thiện: Phải có bậc cước khởi đầu (minGrams = 0) cho cả NORMAL và COLD
  const hasNormalBase = rates.some((r) => r.vehicleType === 'NORMAL' && r.minGrams === 0)
  const hasColdBase = rates.some((r) => r.vehicleType === 'COLD' && r.minGrams === 0)

  if (!hasNormalBase || !hasColdBase) {
    return {
      rates,
      isDefault: false,
      error: 'Bảng cước vận chuyển chưa hoàn thiện cấu hình mức cơ sở (0kg) cho đầy đủ loại xe (Xe thường / Xe lạnh).',
    }
  }

  return {
    rates,
    isDefault: false,
  }
}

/**
 * Nạp cấu hình Kho Tổng từ AppSetting trong Database.
 * Fallback an toàn về DEFAULT_WAREHOUSE nếu chưa cấu hình.
 */
export async function getWarehouseConfig(): Promise<WarehouseConfig> {
  if (!db?.appSetting?.findMany) {
    return DEFAULT_WAREHOUSE
  }

  const settings = await db.appSetting.findMany({
    where: {
      key: {
        in: [
          'warehouseLat',
          'warehouseLng',
          'warehouseAddress',
          'warehouseName',
          'maxRadiusKm',
        ],
      },
    },
  })

  const map = new Map<string, string>()
  for (const s of settings) {
    map.set(s.key, s.value)
  }

  let lat = DEFAULT_WAREHOUSE.lat
  let lng = DEFAULT_WAREHOUSE.lng
  let maxRadiusKm = DEFAULT_WAREHOUSE.maxRadiusKm
  let name = DEFAULT_WAREHOUSE.name
  let address = DEFAULT_WAREHOUSE.address

  const latStr = map.get('warehouseLat')
  if (latStr) {
    const parsedLat = parseFloat(latStr)
    if (!isNaN(parsedLat) && isFinite(parsedLat) && parsedLat >= -90 && parsedLat <= 90 && Math.abs(parsedLat) > 0.0001) {
      lat = parsedLat
    }
  }

  const lngStr = map.get('warehouseLng')
  if (lngStr) {
    const parsedLng = parseFloat(lngStr)
    if (!isNaN(parsedLng) && isFinite(parsedLng) && parsedLng >= -180 && parsedLng <= 180 && Math.abs(parsedLng) > 0.0001) {
      lng = parsedLng
    }
  }

  const radiusStr = map.get('maxRadiusKm')
  if (radiusStr) {
    const parsedRadius = parseFloat(radiusStr)
    if (!isNaN(parsedRadius) && isFinite(parsedRadius) && parsedRadius > 0) {
      maxRadiusKm = parsedRadius
    }
  }

  const nameStr = map.get('warehouseName')
  if (nameStr && nameStr.trim().length > 0) {
    name = nameStr.trim()
  }

  const addressStr = map.get('warehouseAddress')
  if (addressStr && addressStr.trim().length > 0) {
    address = addressStr.trim()
  }

  return {
    lat,
    lng,
    maxRadiusKm,
    name,
    address,
  }
}

/**
 * Tính toán báo giá vận chuyển động từ cấu hình Database hiện hành.
 * Dùng chung cho toàn bộ hệ thống (Checkout, Pre-order, Recurring).
 */
export async function getDynamicShippingQuote(
  input: ShippingQuoteInput
): Promise<ShippingQuoteResult> {
  const [ratesResult, warehouse] = await Promise.all([
    getEffectiveShippingRates(),
    getWarehouseConfig(),
  ])

  const targetVehicleType: VehicleType = input.requiresCold
    ? 'COLD'
    : input.vehicleType === 'COLD'
    ? 'COLD'
    : 'NORMAL'

  if (ratesResult.error) {
    return {
      fee: 0,
      vehicleType: targetVehicleType,
      distanceKm: 0,
      billedKm: 0,
      baseFee: 0,
      perKm: 0,
      minGrams: 0,
      isEstimated: false,
      note: 'Lỗi cấu hình cước phí',
      error: ratesResult.error,
      allowed: false,
    }
  }

  return calculateShippingQuote(input, {
    rates: ratesResult.rates,
    warehouse,
  })
}

/**
 * Factory tạo ShippingCalculator sử dụng cấu hình động.
 */
export function createDynamicShippingCalculator(): ShippingCalculator {
  return {
    async quote(input: ShippingQuoteInput): Promise<ShippingQuoteResult> {
      return getDynamicShippingQuote(input)
    },
  }
}
