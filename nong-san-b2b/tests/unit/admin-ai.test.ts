/**
 * F03 — UNIT & INTEGRATION TESTS: GEMINI EXECUTIVE AI ASSISTANT
 * E Vibe — Nông Sản B2B
 *
 * Verifies:
 * 1. Admin authorization gate (requireAdmin)
 * 2. API key security & presence check
 * 3. Model verification & preference ranking
 * 4. Error classification (MISSING_API_KEY, INVALID_API_KEY, QUOTA_EXCEEDED, TIMEOUT)
 * 5. PII sanitization (Customer ID, phone, address)
 * 6. Query execution & context assembly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getGeminiApiKey,
  verifyGeminiModelAccess,
  queryGemini,
} from '@/lib/gemini/client'
import {
  sanitizeCustomerIdentifier,
  sanitizePhoneNumber,
  sanitizeAddress,
  buildExecutiveContext,
  BuildExecutiveContextInput,
} from '@/lib/gemini/context'

// Hoist mocks for Server Action tests
const { mockRequireAdmin, mockGetBusinessReports, mockGetAdminDashboardKpis, mockGetAdminInventoryDashboardData } = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockGetBusinessReports: vi.fn(),
  mockGetAdminDashboardKpis: vi.fn(),
  mockGetAdminInventoryDashboardData: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireAdmin: mockRequireAdmin,
}))

vi.mock('@/server/reports', () => ({
  getBusinessReports: mockGetBusinessReports,
  getAdminDashboardKpis: mockGetAdminDashboardKpis,
}))

vi.mock('@/lib/services/inventory-read', () => ({
  getAdminInventoryDashboardData: mockGetAdminInventoryDashboardData,
}))

import {
  getAdminAiStatusAction,
  queryAdminExecutiveAiAction,
} from '@/server/actions/admin-ai'

describe('F03 — Gemini Executive AI Assistant Suite', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // SECTION 1: PII Sanitization & Context Builder
  // ==========================================================================
  describe('1. PII Sanitization & Context Redaction', () => {
    it('1.1 should sanitize customer identifier to anonymous format', () => {
      expect(sanitizeCustomerIdentifier('cm72xyz9988')).toBe('DOANH_NGHIEP_#9988')
      expect(sanitizeCustomerIdentifier('')).toBe('DOANH_NGHIEP_#ANON')
    })

    it('1.2 should mask phone numbers preserving only last 4 digits', () => {
      expect(sanitizePhoneNumber('0912345678')).toBe('09xxxx5678')
      expect(sanitizePhoneNumber('+84 987 654 321')).toBe('09xxxx4321')
      expect(sanitizePhoneNumber('')).toBe('N/A')
      expect(sanitizePhoneNumber(null)).toBe('N/A')
    })

    it('1.3 should sanitize address retaining only city/province', () => {
      expect(sanitizeAddress('123 Đường Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh')).toBe('TP. Hồ Chí Minh')
      expect(sanitizeAddress('Ấp Phú Hưng, Xã An Khánh, Huyện Châu Thành, Tỉnh Bến Tre')).toBe('Tỉnh Bến Tre')
      expect(sanitizeAddress('Quốc lộ 1A, Tiền Giang')).toBe('Tỉnh Tiền Giang')
      expect(sanitizeAddress('')).toBe('Việt Nam')
    })

    it('1.4 should build structured executive context with financial and inventory facts', () => {
      const mockReportData: BuildExecutiveContextInput['reportData'] = ({
        range: { fromText: '01/10/2026', toText: '27/10/2026', preset: '30D', startDateIso: '2026-10-01', endDateIso: '2026-10-27' },
        grouping: 'DAY',
        timeline: {
          totalRevenue: 150000000,
          totalCompletedOrders: 38,
          totalKg: 1120,
          points: [],
        },
        topProducts: {
          topByRevenue: [
            { productId: 'p1', productName: 'Xoài Cát Hòa Lộc', totalRevenue: 65000000, totalKg: 520, orderCount: 20 },
            { productId: 'p2', productName: 'Sầu riêng Monthong', totalRevenue: 85000000, totalKg: 600, orderCount: 18 },
          ],
          topByKg: [],
          sampleProductsCount: 0,
        },
        cancellationAndComplaints: {
          cancellationRate: 4.4,
          cancelledOrdersCount: 2,
          totalOrders: 45,
          complaintRate: 2.2,
          complaintOrdersCount: 1,
          byCustomerCount: 1,
          byCustomerRate: 2.2,
          bySellerCount: 1,
          bySellerRate: 2.2,
          bySystemCount: 0,
          bySystemRate: 0,
          unspecifiedCancelCount: 0,
        },
        shrinkage: {
          shrinkageGrams: 5000,
          shrinkageRate: 2.5,
          totalOrderedGrams: 200000,
          totalActualGrams: 195000,
          measuredItemsCount: 10,
          hasMeasuredData: true,
        },
        revenueByGroup: {
          groups: [
            { groupId: 'g1', groupName: 'Chuỗi Siêu Thị', groupCode: 'SUPERMARKET', revenue: 90000000, percentage: 60, orderCount: 25 },
          ],
          totalRevenue: 90000000,
          groupCount: 1,
        },
        cashflow: {
          completedRevenue: 150000000,
          totalPaid: 142000000,
          totalRefunded: 2000000,
          pendingRefund: 0,
          netCashReceived: 140000000,
        },
      } as unknown) as BuildExecutiveContextInput['reportData']

      const mockKpis: BuildExecutiveContextInput['dashboardKpis'] = {
        newOrdersToday: 6,
        awaitingPaymentConfirmation: 2,
        deliveriesToday: 4,
        openComplaints: 1,
      }

      const mockInventory: BuildExecutiveContextInput['inventoryData'] = ({
        observedAt: new Date().toISOString(),
        kpis: {
          totalProductsCount: 8,
          trackedProductsCount: 8,
          untrackedProductsCount: 0,
          totalBatchesCount: 20,
          eligibleActiveBatchesCount: 20,
          unverifiedBatchesCount: 0,
          totalPhysicalStockGrams: 1850000, // 1850 kg
          totalReservedStockGrams: 50000, // 50 kg
          totalAvailableStockGrams: 1800000, // 1800 kg
          totalIneligibleStockGrams: 0,
          totalDispatchedStockGrams: 0,
          expiringWithin3DaysBatchesCount: 1,
          expiringWithin7DaysBatchesCount: 3,
          expiredBatchesCount: 0,
          batchesWithAnomaliesCount: 0,
          lowStockProductsCount: 1,
        },
        products: [],
        expiringAndExpiredBatches: [],
        batchesWithAnomalies: [],
      } as unknown) as BuildExecutiveContextInput['inventoryData']

      const context = buildExecutiveContext({
        reportData: mockReportData,
        dashboardKpis: mockKpis,
        inventoryData: mockInventory,
      })

      expect(context).toContain('150.000.000')
      expect(context).toContain('Xoài Cát Hòa Lộc')
      expect(context).toContain('Sầu riêng Monthong')
      expect(context).toContain('8 / 8 sản phẩm đã bật theo dõi tồn kho')
      expect(context).toContain('1.850 kg')
      expect(context).toContain('Lô hàng sắp hết hạn trong 3 ngày tới: 1 lô')
      expect(context).toContain('Khiếu nại khách hàng đang mở: 1 vụ')
    })
  })

  // ==========================================================================
  // SECTION 2: Gemini Client & Model Verification
  // ==========================================================================
  describe('2. Gemini Client & Model Verification', () => {
    it('2.1 should detect missing API key', () => {
      delete process.env.GEMINI_API_KEY
      expect(getGeminiApiKey()).toBeNull()
    })

    it('2.2 should return MISSING_API_KEY result when verifying without key', async () => {
      const res = await verifyGeminiModelAccess(null)
      expect(res.ok).toBe(false)
      expect(res.errorType).toBe('MISSING_API_KEY')
    })

    it('2.3 should correctly probe models and prioritize gemini-3.1-flash-lite or gemini-1.5-flash', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [
            { name: 'models/gemini-1.0-pro', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-3.1-flash-lite', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          ],
        }),
      })
      global.fetch = mockFetch

      const res = await verifyGeminiModelAccess('test-valid-key')
      expect(res.ok).toBe(true)
      expect(res.activeModel).toBe('gemini-3.1-flash-lite')
      expect(res.availableModels).toContain('gemini-3.1-flash-lite')
      expect(res.availableModels).toContain('gemini-1.5-flash')
      expect(res.availableModels).not.toContain('text-embedding-004') // filtered out non-generation
    })

    it('2.4 should handle HTTP 429 Rate Limit as QUOTA_EXCEEDED', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({ error: { message: 'Quota exceeded for quota metric' } }),
      })

      const res = await verifyGeminiModelAccess('test-key')
      expect(res.ok).toBe(false)
      expect(res.errorType).toBe('QUOTA_EXCEEDED')
    })

    it('2.5 should handle HTTP 403 / 400 Invalid Key as INVALID_API_KEY', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: { message: 'API key not valid' } }),
      })

      const res = await verifyGeminiModelAccess('bad-key')
      expect(res.ok).toBe(false)
      expect(res.errorType).toBe('INVALID_API_KEY')
    })

    it('2.6 should query Gemini and extract candidate text answer', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: 'Tình hình doanh thu 30 ngày qua đạt 150.000.000 đ, tăng trưởng tốt ở dòng Sầu riêng.',
                  },
                ],
              },
            },
          ],
        }),
      })

      const res = await queryGemini({
        prompt: 'Tóm tắt doanh thu',
        context: 'Doanh thu 150.000.000 đ',
        apiKey: 'test-key',
        model: 'gemini-2.5-flash',
      })

      expect(res.success).toBe(true)
      expect(res.answer).toContain('150.000.000 đ')
      expect(res.metadata?.model).toBe('gemini-2.5-flash')
    })
  })

  // ==========================================================================
  // SECTION 3: Admin Authorization & Server Action Gates
  // ==========================================================================
  describe('3. Admin Authorization & Server Actions', () => {
    it('3.1 should reject queryAdminExecutiveAiAction if caller is not Admin', async () => {
      mockRequireAdmin.mockRejectedValue(new Error('Bạn không có quyền truy cập trang quản trị'))

      await expect(
        queryAdminExecutiveAiAction({ query: 'Tình hình doanh thu?' })
      ).rejects.toThrow('Bạn không có quyền truy cập trang quản trị')
    })

    it('3.2 should validate query length and reject empty/short queries', async () => {
      mockRequireAdmin.mockResolvedValue({ id: 'admin1', role: 'ADMIN' })

      const res = await queryAdminExecutiveAiAction({ query: ' ' })
      expect(res.success).toBe(false)
      expect(res.message).toContain('tối thiểu 2 ký tự')
    })

    it('3.3 should return MISSING_API_KEY when environment variable is not set', async () => {
      mockRequireAdmin.mockResolvedValue({ id: 'admin1', role: 'ADMIN' })
      delete process.env.GEMINI_API_KEY

      const res = await queryAdminExecutiveAiAction({ query: 'Tóm tắt doanh thu' })
      expect(res.success).toBe(false)
      expect(res.errorType).toBe('MISSING_API_KEY')
      expect(res.message).toContain('Chưa cấu hình GEMINI_API_KEY')
    })

    it('3.4 should successfully execute query for Admin when API key and data are available', async () => {
      mockRequireAdmin.mockResolvedValue({ id: 'admin1', role: 'ADMIN' })
      process.env.GEMINI_API_KEY = 'test-valid-key'

      mockGetBusinessReports.mockResolvedValue({
        success: true,
        data: {
          range: { fromText: '01/10/2026', toText: '27/10/2026' },
          timeline: { totalRevenue: 200000000, totalCompletedOrders: 45, totalKg: 1000, points: [] },
          topProducts: { topByRevenue: [], topByKg: [], sampleProductsCount: 0 },
          cancellationAndComplaints: { cancellationRate: 4.0, cancelledOrdersCount: 2, totalOrders: 50, complaintRate: 0, complaintOrdersCount: 0, byCustomerCount: 0, byCustomerRate: 0, bySellerCount: 0, bySellerRate: 0, bySystemCount: 0, bySystemRate: 0, unspecifiedCancelCount: 0 },
          shrinkage: { shrinkageGrams: 0, shrinkageRate: 0, totalOrderedGrams: 0, totalActualGrams: 0, measuredItemsCount: 0, hasMeasuredData: false },
          revenueByGroup: { groups: [], totalRevenue: 200000000, groupCount: 0 },
          cashflow: { completedRevenue: 200000000, totalPaid: 200000000, totalRefunded: 0, pendingRefund: 0, netCashReceived: 200000000 },
        },
      })
      mockGetAdminDashboardKpis.mockResolvedValue({
        newOrdersToday: 5,
        awaitingPaymentConfirmation: 1,
        deliveriesToday: 3,
        openComplaints: 0,
      })
      mockGetAdminInventoryDashboardData.mockResolvedValue({
        observedAt: new Date().toISOString(),
        kpis: {
          totalProductsCount: 8,
          trackedProductsCount: 8,
          untrackedProductsCount: 0,
          totalBatchesCount: 16,
          eligibleActiveBatchesCount: 16,
          unverifiedBatchesCount: 0,
          totalPhysicalStockGrams: 2000000,
          totalAvailableStockGrams: 1900000,
          totalReservedStockGrams: 100000,
          totalIneligibleStockGrams: 0,
          totalDispatchedStockGrams: 0,
          expiringWithin3DaysBatchesCount: 0,
          expiringWithin7DaysBatchesCount: 2,
          expiredBatchesCount: 0,
          batchesWithAnomaliesCount: 0,
          lowStockProductsCount: 0,
        },
        products: [],
        expiringAndExpiredBatches: [],
        batchesWithAnomalies: [],
      })

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/models?key=')) {
          return {
            ok: true,
            json: async () => ({
              models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }],
            }),
          }
        }
        return {
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: 'Báo cáo 30 ngày: Doanh thu thực nhận đạt 200.000.000 đ từ 45 đơn hàng hoàn thành.',
                    },
                  ],
                },
              },
            ],
          }),
        }
      })

      const res = await queryAdminExecutiveAiAction({ query: 'Doanh thu tháng này thế nào?' })

      expect(res.success).toBe(true)
      expect(res.answer).toContain('200.000.000 đ')
      expect(res.metadata?.model).toBe('gemini-2.5-flash')
    })

    it('3.5 should return correct status from getAdminAiStatusAction', async () => {
      mockRequireAdmin.mockResolvedValue({ id: 'admin1', role: 'ADMIN' })
      process.env.GEMINI_API_KEY = 'test-valid-key'

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }],
        }),
      })

      const status = await getAdminAiStatusAction()
      expect(status.configured).toBe(true)
      expect(status.activeModel).toBe('gemini-2.5-flash')
      expect(status.statusMessage).toContain('Sẵn sàng')
    })
  })
})
