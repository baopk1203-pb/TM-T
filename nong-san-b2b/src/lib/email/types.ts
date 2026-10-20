export type NotificationEventType =
  | 'ORDER_PLACED'
  | 'PAYMENT_CONFIRMED'
  | 'ORDER_SHIPPING'
  | 'ORDER_COMPLETED'
  | 'COMPLAINT_OPENED'
  | 'COMPLAINT_RESOLVED'
  | 'REFUND_CONFIRMED'

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
