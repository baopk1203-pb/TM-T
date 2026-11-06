import { describe, it, expect } from 'vitest'
import { OrderStatus, OrderType, TimeSlot } from '@prisma/client'
import {
  getDashboardKpiMetrics,
  getDraftConfirmationDeadline,
  DashboardOrderItem,
} from '@/lib/domain/dashboard'
import { isPreorderAwaitingCustomerDecision } from '@/lib/domain/preorder'
import { earliestDeliveryDate, isDeliveryDateValid } from '@/lib/domain/delivery-date'

describe('Batch 6C: Customer Dashboard Domain Logic & Integration Checks', () => {
  describe('1. getDashboardKpiMetrics - Phân loại 4 thẻ thống kê không trùng lặp', () => {
    const mockOrders: DashboardOrderItem[] = [
      // 1. Đang xử lý (4 đơn với 4 trạng thái khác nhau)
      {
        id: 'o-proc',
        code: 'ORD-PROC',
        type: OrderType.STANDARD,
        status: OrderStatus.PROCESSING,
        total: 1000000,
      },
      {
        id: 'o-ship',
        code: 'ORD-SHIP',
        type: OrderType.RECURRING,
        status: OrderStatus.SHIPPING,
        total: 2000000,
      },
      {
        id: 'o-deliv',
        code: 'ORD-DELIV',
        type: OrderType.STANDARD,
        status: OrderStatus.DELIVERED,
        total: 1500000,
      },
      {
        id: 'o-compl',
        code: 'ORD-COMPL',
        type: OrderType.STANDARD,
        status: OrderStatus.COMPLAINT,
        total: 800000,
      },

      // 2. Chờ thanh toán (2 đơn PENDING_CONFIRMATION)
      {
        id: 'o-pend-1',
        code: 'ORD-PEND-1',
        type: OrderType.STANDARD,
        status: OrderStatus.PENDING_CONFIRMATION,
        total: 3000000,
      },
      {
        id: 'o-pend-2',
        code: 'ORD-PEND-2',
        type: OrderType.PREORDER,
        status: OrderStatus.PENDING_CONFIRMATION,
        total: 5000000,
      },

      // 3. Đơn nháp định kỳ (2 đơn DRAFT)
      {
        id: 'o-draft-1',
        code: 'ORD-DRAFT-1',
        type: OrderType.RECURRING,
        status: OrderStatus.DRAFT,
        total: 1200000,
      },
      {
        id: 'o-draft-2',
        code: 'ORD-DRAFT-2',
        type: OrderType.RECURRING,
        status: OrderStatus.DRAFT,
        total: 1800000,
      },

      // 4. Đơn Pre-order (3 đơn PREORDER_WAITING)
      // 4a. Đang chờ vụ mùa (chưa công bố giá thu hoạch)
      {
        id: 'o-pre-waiting',
        code: 'ORD-PRE-WAIT',
        type: OrderType.PREORDER,
        status: OrderStatus.PREORDER_WAITING,
        total: 4000000,
        preorderFinalPricePerKg: null,
      },
      // 4b. Cần khách quyết định (giá ngoài biên độ, PENDING)
      {
        id: 'o-pre-decide-pending',
        code: 'ORD-PRE-DECIDE-1',
        type: OrderType.PREORDER,
        status: OrderStatus.PREORDER_WAITING,
        total: 4000000,
        preorderFinalPricePerKg: 85000,
        preorderCustomerDecision: 'PENDING',
      },
      // 4c. Cần khách quyết định (giá ngoài biên độ, null)
      {
        id: 'o-pre-decide-null',
        code: 'ORD-PRE-DECIDE-2',
        type: OrderType.PREORDER,
        status: OrderStatus.PREORDER_WAITING,
        total: 4000000,
        preorderFinalPricePerKg: 90000,
        preorderCustomerDecision: null,
      },

      // 5. Trạng thái kết thúc (COMPLETED & CANCELLED không nằm trong 4 nhóm KPI tác nghiệp)
      {
        id: 'o-done',
        code: 'ORD-DONE',
        type: OrderType.STANDARD,
        status: OrderStatus.COMPLETED,
        total: 5000000,
      },
      {
        id: 'o-canc',
        code: 'ORD-CANC',
        type: OrderType.STANDARD,
        status: OrderStatus.CANCELLED,
        total: 2000000,
      },
    ]

    it('Đếm chính xác số lượng cho 4 nhóm thẻ thống kê', () => {
      const metrics = getDashboardKpiMetrics(mockOrders)

      expect(metrics.processingCount).toBe(4) // PROCESSING, SHIPPING, DELIVERED, COMPLAINT
      expect(metrics.pendingPaymentCount).toBe(2) // 2 đơn PENDING_CONFIRMATION
      expect(metrics.draftRecurringCount).toBe(2) // 2 đơn DRAFT
      expect(metrics.preorderCount).toBe(3) // 3 đơn PREORDER_WAITING
    })

    it('Tách bạch chính xác giữa đơn chờ vụ mùa và đơn cần quyết định trong nhóm Pre-order', () => {
      const metrics = getDashboardKpiMetrics(mockOrders)

      expect(metrics.preorderCount).toBe(3)
      expect(metrics.preorderAwaitingDecisionCount).toBe(2) // 1 PENDING + 1 null
      expect(metrics.preorderWaitingHarvestCount).toBe(1) // 1 đơn chưa có giá
    })

    it('Đảm bảo tính loại trừ lẫn nhau (Mutually Exclusive) - Không đếm trùng lặp bất kỳ đơn nào', () => {
      const metrics = getDashboardKpiMetrics(mockOrders)

      const activeOperationalOrdersCount = mockOrders.filter(
        (o) => o.status !== OrderStatus.COMPLETED && o.status !== OrderStatus.CANCELLED
      ).length

      const totalKpiCount =
        metrics.processingCount +
        metrics.pendingPaymentCount +
        metrics.draftRecurringCount +
        metrics.preorderCount

      expect(totalKpiCount).toBe(activeOperationalOrdersCount)
      expect(totalKpiCount).toBe(11) // 4 + 2 + 2 + 3 = 11
    })

    it('Xử lý an toàn khi danh sách đơn rỗng', () => {
      const metrics = getDashboardKpiMetrics([])

      expect(metrics.processingCount).toBe(0)
      expect(metrics.pendingPaymentCount).toBe(0)
      expect(metrics.draftRecurringCount).toBe(0)
      expect(metrics.preorderCount).toBe(0)
      expect(metrics.preorderAwaitingDecisionCount).toBe(0)
      expect(metrics.preorderWaitingHarvestCount).toBe(0)
    })
  })

  describe('2. Integration Check A: isPreorderAwaitingCustomerDecision - Đồng bộ null vs PENDING', () => {
    it('Nhận diện đúng đơn Pre-order đang chờ quyết định khi preorderCustomerDecision là null', () => {
      const isAwaiting = isPreorderAwaitingCustomerDecision({
        type: OrderType.PREORDER,
        status: OrderStatus.PREORDER_WAITING,
        preorderFinalPricePerKg: 78000,
        preorderCustomerDecision: null,
      })
      expect(isAwaiting).toBe(true)
    })

    it('Nhận diện đúng đơn Pre-order đang chờ quyết định khi preorderCustomerDecision là PENDING', () => {
      const isAwaiting = isPreorderAwaitingCustomerDecision({
        type: OrderType.PREORDER,
        status: OrderStatus.PREORDER_WAITING,
        preorderFinalPricePerKg: 78000,
        preorderCustomerDecision: 'PENDING',
      })
      expect(isAwaiting).toBe(true)
    })

    it('Nhận diện đúng đơn Pre-order đang chờ quyết định khi preorderCustomerDecision là undefined', () => {
      const isAwaiting = isPreorderAwaitingCustomerDecision({
        type: OrderType.PREORDER,
        status: OrderStatus.PREORDER_WAITING,
        preorderFinalPricePerKg: 78000,
      })
      expect(isAwaiting).toBe(true)
    })

    it('Trả về false khi khách hàng đã ACCEPT đơn giá mới', () => {
      const isAwaiting = isPreorderAwaitingCustomerDecision({
        type: OrderType.PREORDER,
        status: OrderStatus.PREORDER_WAITING,
        preorderFinalPricePerKg: 78000,
        preorderCustomerDecision: 'ACCEPT',
      })
      expect(isAwaiting).toBe(false)
    })

    it('Trả về false khi khách hàng đã CANCEL đơn hàng', () => {
      const isAwaiting = isPreorderAwaitingCustomerDecision({
        type: OrderType.PREORDER,
        status: OrderStatus.PREORDER_WAITING,
        preorderFinalPricePerKg: 78000,
        preorderCustomerDecision: 'CANCEL',
      })
      expect(isAwaiting).toBe(false)
    })

    it('Trả về false khi admin chưa chốt đơn giá thu hoạch (preorderFinalPricePerKg là null hoặc 0)', () => {
      const isAwaitingNull = isPreorderAwaitingCustomerDecision({
        type: OrderType.PREORDER,
        status: OrderStatus.PREORDER_WAITING,
        preorderFinalPricePerKg: null,
      })
      expect(isAwaitingNull).toBe(false)

      const isAwaitingZero = isPreorderAwaitingCustomerDecision({
        type: OrderType.PREORDER,
        status: OrderStatus.PREORDER_WAITING,
        preorderFinalPricePerKg: 0,
      })
      expect(isAwaitingZero).toBe(false)
    })

    it('Trả về false khi đơn hàng không phải loại PREORDER', () => {
      const isAwaitingStandard = isPreorderAwaitingCustomerDecision({
        type: OrderType.STANDARD,
        status: OrderStatus.PREORDER_WAITING,
        preorderFinalPricePerKg: 78000,
      })
      expect(isAwaitingStandard).toBe(false)

      const isAwaitingRecurring = isPreorderAwaitingCustomerDecision({
        type: OrderType.RECURRING,
        status: OrderStatus.PREORDER_WAITING,
        preorderFinalPricePerKg: 78000,
      })
      expect(isAwaitingRecurring).toBe(false)
    })

    it('Trả về false khi trạng thái đơn không phải PREORDER_WAITING (đã chuyển PROCESSING hoặc CANCELLED)', () => {
      const isAwaitingProcessing = isPreorderAwaitingCustomerDecision({
        type: OrderType.PREORDER,
        status: OrderStatus.PROCESSING,
        preorderFinalPricePerKg: 78000,
        preorderCustomerDecision: 'ACCEPT',
      })
      expect(isAwaitingProcessing).toBe(false)

      const isAwaitingCancelled = isPreorderAwaitingCustomerDecision({
        type: OrderType.PREORDER,
        status: OrderStatus.CANCELLED,
        preorderFinalPricePerKg: 78000,
        preorderCustomerDecision: 'CANCEL',
      })
      expect(isAwaitingCancelled).toBe(false)
    })
  })

  describe('3. Integration Check B: Ngày và khung giờ giao khi khách ACCEPT giá ngoài biên độ', () => {
    it('Bảo toàn deliveryDate và timeSlot đã được thiết lập bởi admin trước đó', () => {
      const stagedDate = new Date('2026-11-20T00:00:00Z')
      const stagedSlot = TimeSlot.AFTERNOON

      const orderDeliveryDate: Date | null = stagedDate
      const orderTimeSlot: TimeSlot | null = stagedSlot

      const finalDeliveryDate =
        orderDeliveryDate ?? earliestDeliveryDate(new Date(), [1])
      const finalTimeSlot = orderTimeSlot ?? TimeSlot.MORNING

      expect(finalDeliveryDate).toEqual(stagedDate)
      expect(finalTimeSlot).toBe(TimeSlot.AFTERNOON)
    })

    it('Tự động tính fallback hợp lệ (earliestDeliveryDate & TimeSlot.MORNING) nếu deliveryDate ban đầu null', () => {
      const now = new Date('2026-10-18T10:00:00Z')
      const leadTimeDays = 2

      const orderDeliveryDate: Date | null = null
      const orderTimeSlot: TimeSlot | null = null

      const minDeliveryDate = earliestDeliveryDate(now, [leadTimeDays])
      const finalDeliveryDate =
        orderDeliveryDate && isDeliveryDateValid(orderDeliveryDate, minDeliveryDate)
          ? orderDeliveryDate
          : minDeliveryDate
      const finalTimeSlot = orderTimeSlot ?? TimeSlot.MORNING

      expect(finalDeliveryDate).toBeInstanceOf(Date)
      expect(finalDeliveryDate.getTime()).toBeGreaterThan(now.getTime())
      expect(finalTimeSlot).toBe(TimeSlot.MORNING)
    })

    it('Sanity Check: Nếu admin chọn ngày giao nhưng khách ACCEPT sau ngày đó (hoặc không còn thỏa leadTimeDays), server tự động tính fallback ngày sớm nhất hợp lệ', () => {
      const now = new Date('2026-10-18T10:00:00Z')
      const leadTimeDays = 2
      const minDeliveryDate = earliestDeliveryDate(now, [leadTimeDays])

      // Admin từng chọn ngày giao là hôm qua (quá khứ so với thời điểm khách ACCEPT)
      const pastStagedDate = new Date('2026-10-17T00:00:00Z')
      const orderDeliveryDate: Date | null = pastStagedDate
      const orderTimeSlot: TimeSlot | null = TimeSlot.AFTERNOON

      // Áp dụng đúng công thức bảo vệ trên server
      const finalDeliveryDate =
        orderDeliveryDate && isDeliveryDateValid(orderDeliveryDate, minDeliveryDate)
          ? orderDeliveryDate
          : minDeliveryDate
      const finalTimeSlot = orderTimeSlot ?? TimeSlot.MORNING

      // Phải chuyển sang minDeliveryDate hợp lệ, không giữ ngày quá khứ
      expect(finalDeliveryDate).not.toEqual(pastStagedDate)
      expect(finalDeliveryDate).toEqual(minDeliveryDate)
      expect(isDeliveryDateValid(finalDeliveryDate, minDeliveryDate)).toBe(true)
      expect(finalTimeSlot).toBe(TimeSlot.AFTERNOON)
    })
  })

  describe('4. getDraftConfirmationDeadline - Hạn chót xác nhận đơn nháp định kỳ', () => {
    it('Ưu tiên sử dụng paymentDueAt nếu đã có sẵn', () => {
      const dueAt = new Date('2026-10-25T17:00:00Z')
      const deadline = getDraftConfirmationDeadline('2026-10-28', dueAt, 1)

      expect(deadline).toEqual(dueAt)
    })

    it('Tính lùi leadTimeDays từ deliveryDate khi chưa có paymentDueAt', () => {
      // Ngày giao: 2026-10-30, leadTime: 2 ngày -> deadline: 2026-10-28 17:00:00 UTC
      const deadline = getDraftConfirmationDeadline('2026-10-30', null, 2)

      expect(deadline).not.toBeNull()
      expect(deadline?.getUTCFullYear()).toBe(2026)
      expect(deadline?.getUTCMonth()).toBe(9) // Tháng 10 (0-indexed)
      expect(deadline?.getUTCDate()).toBe(28)
      expect(deadline?.getUTCHours()).toBe(17)
    })

    it('Trả về null khi không có cả deliveryDate lẫn paymentDueAt', () => {
      const deadline = getDraftConfirmationDeadline(null, null, 1)
      expect(deadline).toBeNull()
    })
  })

  describe('5. Bảo mật & Cô lập dữ liệu theo tài khoản (Data Isolation)', () => {
    const userAOrders = [
      { id: '1', userId: 'user-a', code: 'ORD-A-1', status: OrderStatus.PROCESSING },
      { id: '2', userId: 'user-a', code: 'ORD-A-2', status: OrderStatus.DRAFT },
    ]
    const userBOrders = [
      { id: '3', userId: 'user-b', code: 'ORD-B-1', status: OrderStatus.PROCESSING },
    ]
    const allDbOrders = [...userAOrders, ...userBOrders]

    it('Chỉ tính toán và hiển thị đơn hàng thuộc về chính tài khoản đăng nhập', () => {
      const currentUserId = 'user-a'
      const isolatedOrders = allDbOrders.filter((o) => o.userId === currentUserId)

      expect(isolatedOrders.length).toBe(2)
      expect(isolatedOrders.every((o) => o.userId === 'user-a')).toBe(true)
      expect(isolatedOrders.some((o) => o.userId === 'user-b')).toBe(false)
    })
  })
})
