/**
 * Domain Logic: Vận chuyển & Phí giao hàng (Shipping)
 * LƯU Ý CRITICAL: Phase 4-7 CHỈ ĐƯỢC dùng zeroShippingCalculator (phí = 0 đ).
 * Tính năng tính phí theo Google Maps / loại xe được triển khai ở Phase 8.
 */

export interface ShippingQuoteInput {
  totalGrams: number
  requiresCold?: boolean
  lat?: number | null
  lng?: number | null
  addressText?: string
}

export interface ShippingQuoteResult {
  fee: number
  vehicleType: 'NORMAL' | 'COLD'
  distanceKm?: number
  note: string
}

export interface ShippingCalculator {
  quote(input: ShippingQuoteInput): Promise<ShippingQuoteResult>
}

/**
 * Calculator giả lập cho Phase 3 - 7: phí ship = 0 đ
 */
export const zeroShippingCalculator: ShippingCalculator = {
  async quote(input: ShippingQuoteInput): Promise<ShippingQuoteResult> {
    const vehicleType = input.requiresCold ? 'COLD' : 'NORMAL'
    return {
      fee: 0,
      vehicleType,
      note: 'Phí vận chuyển: Sẽ được báo chính xác khi Admin xác nhận đơn hàng',
    }
  },
}

/**
 * Hook lấy shipping calculator hiện hành
 */
export function getShippingCalculator(): ShippingCalculator {
  return zeroShippingCalculator
}
