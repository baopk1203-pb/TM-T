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
  clearModelVerificationCache,
  DEFAULT_SYSTEM_INSTRUCTION,
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
    clearModelVerificationCache()
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
      expect(context).toContain('Tổng số lô hàng cận date cần lưu ý (trong vòng 7 ngày tới): 3 lô duy nhất')
      expect(context).toContain('Nhóm khẩn cấp cao (hạn dùng ≤ 3 ngày tới): 1 lô')
      expect(context).toContain('Nhóm khẩn cấp trung bình (hạn dùng từ > 3 ngày đến ≤ 7 ngày tới): 2 lô')
      expect(context).toContain('FEFO (FIRST EXPIRED, FIRST OUT')
      expect(context).toContain('Khiếu nại khách hàng đang mở: 1 vụ')
    })

    it('1.5 (Test A - F03-WORK-02) should correctly format nested expiry groups (5 within 7 days, 1 within 3 days) without double counting into 6', () => {
      const mockInventoryWithNestedAlerts = ({
        observedAt: new Date().toISOString(),
        kpis: {
          totalProductsCount: 8,
          trackedProductsCount: 8,
          untrackedProductsCount: 0,
          totalBatchesCount: 20,
          eligibleActiveBatchesCount: 16,
          unverifiedBatchesCount: 3,
          totalPhysicalStockGrams: 1858000,
          totalReservedStockGrams: 0,
          totalAvailableStockGrams: 1850000,
          totalIneligibleStockGrams: 8000,
          totalDispatchedStockGrams: 0,
          expiringWithin3DaysBatchesCount: 1, // Nhóm A (<= 3 ngày)
          expiringWithin7DaysBatchesCount: 5, // Tổng cả hai nhóm (<= 7 ngày)
          expiredBatchesCount: 0,
          batchesWithAnomaliesCount: 0,
          lowStockProductsCount: 0,
        },
        products: [],
        expiringAndExpiredBatches: [],
        batchesWithAnomalies: [],
      } as unknown) as BuildExecutiveContextInput['inventoryData']

      const context = buildExecutiveContext({
        inventoryData: mockInventoryWithNestedAlerts,
      })

      // 1. Phải nêu rõ tổng cộng 5 lô duy nhất
      expect(context).toContain('Tổng số lô hàng cận date cần lưu ý (trong vòng 7 ngày tới): 5 lô duy nhất')
      // 2. Nhóm khẩn cấp cao: 1 lô
      expect(context).toContain('Nhóm khẩn cấp cao (hạn dùng ≤ 3 ngày tới): 1 lô')
      // 3. Nhóm khẩn cấp trung bình: 5 - 1 = 4 lô
      expect(context).toContain('Nhóm khẩn cấp trung bình (hạn dùng từ > 3 ngày đến ≤ 7 ngày tới): 4 lô')
      // 4. Có chỉ dẫn tập hợp rõ ràng để AI không cộng dồn
      expect(context).toContain('QUY TẮC TẬP HỢP: Nhóm ≤3 ngày là tập con lồng trong nhóm ≤7 ngày; KHÔNG ĐƯỢC cộng dồn')
      // 5. Tuyệt đối không được xuất hiện phép tính tổng cộng 6 lô
      expect(context).not.toContain('tổng cộng 6 lô')
      expect(context).not.toContain(': 6 lô')
    })

    it('1.6 (Test C - Dynamic Data) should dynamically compute non-overlapping expiry groups for variable batch counts', () => {
      // Thử nghiệm với một bộ dữ liệu hoàn toàn khác: 9 lô <= 7 ngày, trong đó 4 lô <= 3 ngày (nhóm trung bình = 5 lô)
      const mockDynamicInventory = ({
        observedAt: new Date().toISOString(),
        kpis: {
          totalProductsCount: 10,
          trackedProductsCount: 10,
          untrackedProductsCount: 0,
          totalBatchesCount: 30,
          eligibleActiveBatchesCount: 25,
          unverifiedBatchesCount: 0,
          totalPhysicalStockGrams: 3000000,
          totalReservedStockGrams: 100000,
          totalAvailableStockGrams: 2900000,
          totalIneligibleStockGrams: 0,
          totalDispatchedStockGrams: 0,
          expiringWithin3DaysBatchesCount: 4,
          expiringWithin7DaysBatchesCount: 9,
          expiredBatchesCount: 2,
          batchesWithAnomaliesCount: 0,
          lowStockProductsCount: 2,
        },
        products: [],
        expiringAndExpiredBatches: [],
        batchesWithAnomalies: [],
      } as unknown) as BuildExecutiveContextInput['inventoryData']

      const context = buildExecutiveContext({
        inventoryData: mockDynamicInventory,
      })

      expect(context).toContain('Tổng số lô hàng cận date cần lưu ý (trong vòng 7 ngày tới): 9 lô duy nhất')
      expect(context).toContain('Nhóm khẩn cấp cao (hạn dùng ≤ 3 ngày tới): 4 lô')
      expect(context).toContain('Nhóm khẩn cấp trung bình (hạn dùng từ > 3 ngày đến ≤ 7 ngày tới): 5 lô')
      expect(context).toContain('Lô hàng đã hết hạn (quá hạn sử dụng): 2 lô')
      // Không bị cộng sai 4 + 9 = 13 lô
      expect(context).not.toContain('tổng cộng 13 lô')
      expect(context).not.toContain(': 13 lô')
    })

    it('1.7 (Test B - F03-WORK-03) should define FEFO correctly as First Expired First Out and distinguish from FIFO First In First Out in instructions and context', () => {
      // Kiểm tra trong DEFAULT_SYSTEM_INSTRUCTION
      expect(DEFAULT_SYSTEM_INSTRUCTION).toContain('First Expired, First Out')
      expect(DEFAULT_SYSTEM_INSTRUCTION).toContain('Hết hạn trước, Xuất trước')
      expect(DEFAULT_SYSTEM_INSTRUCTION).toContain('First In, First Out')
      expect(DEFAULT_SYSTEM_INSTRUCTION).toContain('TUYỆT ĐỐI KHÔNG giải thích FEFO là "nhập trước xuất trước"')
      expect(DEFAULT_SYSTEM_INSTRUCTION).toContain('căn cứ vào HẠN SỬ DỤNG của lô hàng chứ KHÔNG căn cứ vào ngày nhập kho')
      expect(DEFAULT_SYSTEM_INSTRUCTION).toContain('LOCKED_QC')
      expect(DEFAULT_SYSTEM_INSTRUCTION).toContain('UNVERIFIED')

      // Kiểm tra trong Header của context
      const context = buildExecutiveContext({
        inventoryData: {
          observedAt: new Date().toISOString(),
          kpis: {
            totalProductsCount: 1,
            trackedProductsCount: 1,
            untrackedProductsCount: 0,
            totalBatchesCount: 1,
            eligibleActiveBatchesCount: 1,
            unverifiedBatchesCount: 0,
            totalPhysicalStockGrams: 10000,
            totalReservedStockGrams: 0,
            totalAvailableStockGrams: 10000,
            totalIneligibleStockGrams: 0,
            totalDispatchedStockGrams: 0,
            expiringWithin3DaysBatchesCount: 0,
            expiringWithin7DaysBatchesCount: 0,
            expiredBatchesCount: 0,
            batchesWithAnomaliesCount: 0,
            lowStockProductsCount: 0,
          },
          products: [],
          expiringAndExpiredBatches: [],
          batchesWithAnomalies: [],
        } as unknown as BuildExecutiveContextInput['inventoryData'],
      })

      expect(context).toContain('FEFO (FIRST EXPIRED, FIRST OUT — HẾT HẠN TRƯỚC, XUẤT TRƯỚC)')
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

      // Verify header transmission and URL cleanliness
      expect(mockFetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'x-goog-api-key': 'test-valid-key',
          }),
        })
      )
      const calledUrl = mockFetch.mock.calls[0][0] as string
      expect(calledUrl).not.toContain('key=')
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
      const mockFetch = vi.fn().mockResolvedValue({
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
      global.fetch = mockFetch

      const res = await queryGemini({
        prompt: 'Tóm tắt doanh thu',
        context: 'Doanh thu 150.000.000 đ',
        apiKey: 'test-key',
        model: 'gemini-2.5-flash',
      })

      expect(res.success).toBe(true)
      expect(res.answer).toContain('150.000.000 đ')
      expect(res.metadata?.model).toBe('gemini-2.5-flash')

      // Verify header transmission and URL cleanliness
      const calledUrl = mockFetch.mock.calls[0][0] as string
      const calledOptions = mockFetch.mock.calls[0][1] as RequestInit
      expect(calledUrl).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
      expect(calledUrl).not.toContain('key=')
      expect((calledOptions.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key')
    })

    it('2.7 (SECURITY) should transmit API key via x-goog-api-key header and never in URL query parameter', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/models')) {
          return {
            ok: true,
            json: async () => ({
              models: [{ name: 'models/gemini-3.1-flash-lite', supportedGenerationMethods: ['generateContent'] }],
            }),
          }
        }
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: 'Response' }] } }],
          }),
        }
      })
      global.fetch = mockFetch

      // Test verifyGeminiModelAccess
      await verifyGeminiModelAccess('secret-test-key-123')
      const verifyCall = mockFetch.mock.calls[0]
      const verifyUrl = verifyCall[0] as string
      const verifyOptions = verifyCall[1] as RequestInit

      expect(verifyUrl).toBe('https://generativelanguage.googleapis.com/v1beta/models')
      expect(verifyUrl).not.toContain('key=')
      expect(verifyUrl).not.toContain('secret-test-key-123')
      expect((verifyOptions.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-test-key-123')

      // Test queryGemini
      mockFetch.mockClear()
      await queryGemini({
        prompt: 'Check security',
        context: 'Context data',
        apiKey: 'secret-test-key-456',
        model: 'gemini-3.1-flash-lite',
      })
      const queryCall = mockFetch.mock.calls[0]
      const queryUrl = queryCall[0] as string
      const queryOptions = queryCall[1] as RequestInit

      expect(queryUrl).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent')
      expect(queryUrl).not.toContain('key=')
      expect(queryUrl).not.toContain('secret-test-key-456')
      expect((queryOptions.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-test-key-456')
    })

    it('2.8 (RESILIENCE) should retry with fallback model if initial model returns HTTP 5xx (OBS-04)', async () => {
      let callCount = 0
      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          // First attempt to gemini-3.5-flash-lite fails with HTTP 500
          return {
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: async () => ({ error: { message: 'Upstream server error' } }),
          }
        }
        // Fallback retry to next model succeeds
        return {
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: 'Phản hồi thành công từ mô hình dự phòng.' }],
                },
              },
            ],
          }),
        }
      })
      global.fetch = mockFetch

      const res = await queryGemini({
        prompt: 'Câu hỏi phân tích',
        context: 'Dữ liệu ngữ cảnh',
        apiKey: 'test-key',
        model: 'gemini-3.5-flash-lite',
      })

      expect(res.success).toBe(true)
      expect(res.answer).toContain('Phản hồi thành công từ mô hình dự phòng')
      expect(callCount).toBe(2)
      // Verify fallback model was one of PREFERRED_MODELS other than gemini-3.5-flash-lite
      expect(res.metadata?.model).toBe('gemini-3-flash-preview')
    })

    it('2.9 should prioritize gemini-3.5-flash-lite over gemini-3.1-flash-lite when available', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [
            { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-3.1-flash-lite', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
      })

      const res = await verifyGeminiModelAccess('test-valid-key')
      expect(res.ok).toBe(true)
      expect(res.activeModel).toBe('gemini-3.5-flash-lite')
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

      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        expect(url).not.toContain('key=')
        const headers = init?.headers as Record<string, string> | undefined
        expect(headers?.['x-goog-api-key']).toBe('test-valid-key')

        if (url.endsWith('/models')) {
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

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }],
        }),
      })
      global.fetch = mockFetch

      const status = await getAdminAiStatusAction()
      expect(status.configured).toBe(true)
      expect(status.activeModel).toBe('gemini-2.5-flash')
      expect(status.statusMessage).toContain('Sẵn sàng')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-goog-api-key': 'test-valid-key',
          }),
        })
      )
    })
  })
})
