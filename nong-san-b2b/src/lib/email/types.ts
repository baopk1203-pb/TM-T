export type NotificationEventType =
  | 'ORDER_PLACED'
  | 'PAYMENT_CONFIRMED'
  | 'ORDER_SHIPPING'
  | 'ORDER_COMPLETED'
  | 'COMPLAINT_OPENED'
  | 'COMPLAINT_RESOLVED'
  | 'REFUND_CONFIRMED'

/**
 * Danh sách các sự kiện email được kích hoạt theo chính sách tối ưu hóa Phase 9 (DEV-TASK-47)
 * - TẮT: E01 (ORDER_PLACED), E03 (ORDER_SHIPPING), E05 (COMPLAINT_OPENED)
 * - BẬT: E02 (PAYMENT_CONFIRMED), E04 (ORDER_COMPLETED), E06 (COMPLAINT_RESOLVED), REFUND_CONFIRMED
 */
export const ACTIVE_NOTIFICATION_EVENTS = [
  'PAYMENT_CONFIRMED',
  'ORDER_COMPLETED',
  'COMPLAINT_RESOLVED',
  'REFUND_CONFIRMED',
] as const

export type ActiveNotificationEventType =
  (typeof ACTIVE_NOTIFICATION_EVENTS)[number]

export const DISABLED_NOTIFICATION_EVENTS = [
  'ORDER_PLACED',
  'ORDER_SHIPPING',
  'COMPLAINT_OPENED',
] as const

export type DisabledNotificationEventType =
  (typeof DISABLED_NOTIFICATION_EVENTS)[number]

export interface OrderNotificationInput {
  type: NotificationEventType
  orderId: string
  transactionId?: string
  complaintId?: string
  shipmentId?: string
}

export interface SendEmailPayload {
  to: string
  subject: string
  html: string
  text?: string
}

export interface SendEmailResult {
  success: boolean
  messageId?: string
  error?: string
  skipped?: boolean
  skipReason?: string
}

export interface EmailTemplateResult {
  subject: string
  html: string
  text: string
}
