import { db } from '@/lib/db'
import { recordOrderEvent } from '@/lib/events'
import {
  getEmailAdapter,
  EmailAdapter,
  sanitizeSmtpError,
} from './adapter'
import {
  OrderNotificationInput,
  SendEmailResult,
  EmailTemplateResult,
  NotificationEventType,
  ACTIVE_NOTIFICATION_EVENTS,
} from './types'
import {
  renderOrderPlacedTemplate,
  renderPaymentConfirmedTemplate,
  renderOrderShippingTemplate,
  renderOrderCompletedTemplate,
  renderComplaintOpenedTemplate,
  renderComplaintResolvedTemplate,
  renderRefundConfirmedTemplate,
} from './templates'

export interface SendOrderNotificationOptions {
  adapter?: EmailAdapter
}

export function computeIdempotencyKey(input: OrderNotificationInput): string {
  switch (input.type) {
    case 'ORDER_PLACED':
      return 'EMAIL_SENT_ORDER_PLACED'
    case 'PAYMENT_CONFIRMED':
      return input.transactionId
        ? `EMAIL_SENT_PAYMENT_CONFIRMED_${input.transactionId}`
        : `EMAIL_SENT_PAYMENT_CONFIRMED_${input.orderId}`
    case 'ORDER_SHIPPING':
      return input.shipmentId
        ? `EMAIL_SENT_ORDER_SHIPPING_${input.shipmentId}`
        : `EMAIL_SENT_ORDER_SHIPPING_${input.orderId}`
    case 'ORDER_COMPLETED':
      return 'EMAIL_SENT_ORDER_COMPLETED'
    case 'COMPLAINT_OPENED':
      return input.complaintId
        ? `EMAIL_SENT_COMPLAINT_OPENED_${input.complaintId}`
        : `EMAIL_SENT_COMPLAINT_OPENED_${input.orderId}`
    case 'COMPLAINT_RESOLVED':
      return input.complaintId
        ? `EMAIL_SENT_COMPLAINT_RESOLVED_${input.complaintId}`
        : `EMAIL_SENT_COMPLAINT_RESOLVED_${input.orderId}`
    case 'REFUND_CONFIRMED':
      return input.transactionId
        ? `EMAIL_SENT_REFUND_CONFIRMED_${input.transactionId}`
        : `EMAIL_SENT_REFUND_CONFIRMED_${input.orderId}`
    default:
      return `EMAIL_SENT_${input.type}`
  }
}

/**
 * Tập hợp sự kiện email đang được kích hoạt (DEV-TASK-47)
 */
export const ACTIVE_NOTIFICATION_SET: ReadonlySet<NotificationEventType> = new Set(
  ACTIVE_NOTIFICATION_EVENTS
)

/**
 * Kiểm tra xem một loại sự kiện có được phép gửi email theo chính sách hiện hành hay không
 */
export function isNotificationEventEnabled(type: NotificationEventType): boolean {
  return ACTIVE_NOTIFICATION_SET.has(type)
}

/**
 * Gửi thông báo Email cho các sự kiện vòng đời đơn hàng B2B (Phase 9)
 * - Chính sách tối ưu DEV-TASK-47: Chỉ kích hoạt gửi cho E02, E04, E06 và REFUND_CONFIRMED.
 *   Các sự kiện E01, E03, E05 đã tắt có chủ đích để tinh gọn tần suất (không gọi SMTP, không ghi DB event).
 * - Thực thi sau khi DB transaction đã commit (được await có kiểm soát timeout để bảo đảm hoàn tất trên Serverless).
 * - Best-effort Sequential Deduplication: Kiểm tra bản ghi EMAIL_SENT_* trong OrderEvent trước khi gửi.
 *   Các bản ghi EMAIL_FAILED_* hoặc EMAIL_SKIPPED_* không chặn lần gửi hợp lệ về sau.
 * - Fail-safe: Bắt toàn bộ lỗi nội bộ và ẩn thông tin nhạy cảm, không bao giờ ném Exception làm hỏng kết quả nghiệp vụ đã commit.
 */
export async function sendOrderNotification(
  input: OrderNotificationInput,
  options?: SendOrderNotificationOptions
): Promise<SendEmailResult> {
  // 1. Kiểm tra chính sách kích hoạt sự kiện email tập trung (DEV-TASK-47)
  // Các sự kiện E01 (ORDER_PLACED), E03 (ORDER_SHIPPING), E05 (COMPLAINT_OPENED) đã tắt có chủ đích:
  // - KHÔNG gọi SMTP adapter
  // - KHÔNG ghi bất kỳ bản ghi EMAIL_SENT, EMAIL_FAILED hoặc EMAIL_SKIPPED nào vào OrderEvent
  // - KHÔNG ảnh hưởng bất kỳ luồng nghiệp vụ nào
  if (!isNotificationEventEnabled(input.type)) {
    return {
      success: true,
      skipped: true,
      skipReason: `EVENT_DISABLED_BY_POLICY: Sự kiện [${input.type}] đã tắt theo chính sách thông báo email`,
    }
  }

  // Bảo vệ khi chạy trong các unit test cô lập chỉ mock một phần db
  if (!db?.orderEvent || !db?.order) {
    return {
      success: false,
      skipped: true,
      skipReason: 'DB_CLIENT_UNAVAILABLE',
    }
  }

  const adapter = options?.adapter || getEmailAdapter()
  const idempotencyKey = computeIdempotencyKey(input)

  try {
    // 1. Kiểm tra Sequential Deduplication: Chỉ chặn nếu đã có bản ghi EMAIL_SENT_* thành công trước đó.
    // Các bản ghi EMAIL_SKIPPED_* hoặc EMAIL_FAILED_* không bị trùng khóa này nên không chặn gửi lại về sau.
    const existingLog = await db.orderEvent.findFirst({
      where: {
        orderId: input.orderId,
        type: idempotencyKey,
      },
    })

    if (existingLog) {
      return {
        success: true,
        skipped: true,
        skipReason: `ALREADY_SENT: Email đã được gửi trước đó với mã ${idempotencyKey}`,
      }
    }

    // 2. Tra cứu dữ liệu đơn hàng và quan hệ
    const order = await db.order.findUnique({
      where: { id: input.orderId },
      include: {
        user: true,
        items: true,
        shipment: true,
        complaints: {
          orderBy: { createdAt: 'desc' },
        },
        transactions: {
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!order) {
      return {
        success: false,
        skipped: true,
        skipReason: `ORDER_NOT_FOUND: Không tìm thấy đơn hàng với ID ${input.orderId}`,
      }
    }

    const recipientEmail = order.user?.email?.trim()
    if (!recipientEmail || !recipientEmail.includes('@')) {
      await recordOrderEvent(db, {
        orderId: order.id,
        type: `EMAIL_SKIPPED_${input.type}`,
        note: `Khách hàng ${order.userId} không có email hợp lệ để nhận thông báo ${input.type}`,
        payload: {
          reason: 'INVALID_RECIPIENT_EMAIL',
          type: input.type,
          attemptedAt: new Date().toISOString(),
        },
      })
      return {
        success: false,
        skipped: true,
        skipReason: 'INVALID_RECIPIENT_EMAIL',
      }
    }

    // 3. Render nội dung email theo mẫu tương ứng
    let templateResult: EmailTemplateResult

    switch (input.type) {
      case 'ORDER_PLACED': {
        templateResult = renderOrderPlacedTemplate({
          order,
          user: order.user,
          items: order.items,
        })
        break
      }

      case 'PAYMENT_CONFIRMED': {
        const tx = input.transactionId
          ? order.transactions.find((t) => t.id === input.transactionId)
          : order.transactions.find((t) => t.status === 'DONE') ||
            order.transactions[0]

        templateResult = renderPaymentConfirmedTemplate({
          order,
          user: order.user,
          transaction: {
            id: tx?.id || order.id,
            amount: tx?.amount || order.depositAmount,
            method: tx?.method || 'Chuyển khoản ngân hàng',
            reference: tx?.reference,
            completedAt: tx?.completedAt || tx?.createdAt || new Date(),
          },
        })
        break
      }

      case 'ORDER_SHIPPING': {
        templateResult = renderOrderShippingTemplate({
          order,
          user: order.user,
          shipment: order.shipment,
        })
        break
      }

      case 'ORDER_COMPLETED': {
        const refundTx = order.transactions.find((t) => t.type === 'REFUND')
        templateResult = renderOrderCompletedTemplate({
          order,
          user: order.user,
          items: order.items,
          refundAmount: refundTx?.amount,
        })
        break
      }

      case 'COMPLAINT_OPENED': {
        const complaint = input.complaintId
          ? order.complaints.find((c) => c.id === input.complaintId)
          : order.complaints[0]
        const item = complaint
          ? order.items.find((i) => i.id === complaint.orderItemId)
          : undefined

        templateResult = renderComplaintOpenedTemplate({
          order,
          user: order.user,
          complaint: {
            id: complaint?.id || 'KN-PENDING',
            reportedGrams: complaint?.reportedGrams || 0,
            description: complaint?.description || 'Khiếu nại nông sản',
            photosCount: complaint?.photos?.length || 0,
            itemProductName: item?.productName,
          },
        })
        break
      }

      case 'COMPLAINT_RESOLVED': {
        const complaint = input.complaintId
          ? order.complaints.find((c) => c.id === input.complaintId)
          : order.complaints[0]
        const item = complaint
          ? order.items.find((i) => i.id === complaint.orderItemId)
          : undefined

        templateResult = renderComplaintResolvedTemplate({
          order,
          user: order.user,
          complaint: {
            id: complaint?.id || 'KN-RESOLVED',
            resolution: complaint?.resolution || 'REFUND',
            compensation: complaint?.compensation,
            note: complaint?.adminNote,
            itemProductName: item?.productName,
          },
        })
        break
      }

      case 'REFUND_CONFIRMED': {
        const tx = input.transactionId
          ? order.transactions.find((t) => t.id === input.transactionId)
          : order.transactions.find((t) => t.type === 'REFUND')

        templateResult = renderRefundConfirmedTemplate({
          order,
          user: order.user,
          transaction: {
            id: tx?.id || order.id,
            amount: tx?.amount || 0,
            completedAt: tx?.completedAt || tx?.createdAt || new Date(),
            note: tx?.note,
          },
        })
        break
      }

      default:
        return {
          success: false,
          error: `Loại sự kiện email không được hỗ trợ: ${input.type}`,
        }
    }

    // 4. Gửi email qua Adapter
    const sendResult = await adapter.send({
      to: recipientEmail,
      subject: templateResult.subject,
      html: templateResult.html,
      text: templateResult.text,
    })

    // 5. Ghi vết audit log vào DB theo đúng kết quả thực tế
    if (sendResult.success) {
      await recordOrderEvent(db, {
        orderId: order.id,
        type: idempotencyKey,
        note: `Máy chủ SMTP đã chấp nhận gửi email [${input.type}] tới ${recipientEmail}`,
        payload: {
          recipient: recipientEmail,
          subject: templateResult.subject,
          messageId: sendResult.messageId,
          type: input.type,
          deliveryStatus: 'SMTP_ACCEPTED',
          sentAt: new Date().toISOString(),
        },
      })
    } else if (sendResult.skipped) {
      const safeReason = sanitizeSmtpError(
        sendResult.error || sendResult.skipReason || 'MISSING_SMTP_CONFIG'
      )
      await recordOrderEvent(db, {
        orderId: order.id,
        type: `EMAIL_SKIPPED_${input.type}`,
        note: `Bỏ qua gửi email [${input.type}] tới ${recipientEmail}: ${safeReason}`,
        payload: {
          recipient: recipientEmail,
          subject: templateResult.subject,
          reason: sendResult.skipReason || 'MISSING_SMTP_CONFIG',
          error: safeReason,
          type: input.type,
          attemptedAt: new Date().toISOString(),
        },
      })
    } else {
      const safeError = sanitizeSmtpError(
        sendResult.error || 'Lỗi kết nối hoặc gửi qua SMTP'
      )
      await recordOrderEvent(db, {
        orderId: order.id,
        type: `EMAIL_FAILED_${input.type}`,
        note: `Gửi email [${input.type}] thất bại tới ${recipientEmail}: ${safeError}`,
        payload: {
          recipient: recipientEmail,
          subject: templateResult.subject,
          reason: 'SMTP_SEND_FAILED',
          error: safeError,
          type: input.type,
          attemptedAt: new Date().toISOString(),
        },
      })
    }

    return sendResult
  } catch (err: unknown) {
    const safeErrorMsg = sanitizeSmtpError(err)
    console.error(
      `[sendOrderNotification] Error for order ${input.orderId} (${input.type}): ${safeErrorMsg}`
    )

    // Cố gắng ghi vết lỗi vào DB (fail-safe)
    try {
      await recordOrderEvent(db, {
        orderId: input.orderId,
        type: `EMAIL_FAILED_${input.type}`,
        note: `Hệ thống gặp ngoại lệ khi xử lý email [${input.type}]: ${safeErrorMsg}`,
        payload: {
          reason: 'INTERNAL_NOTIFICATION_ERROR',
          error: safeErrorMsg,
          type: input.type,
          attemptedAt: new Date().toISOString(),
        },
      })
    } catch {
      // Bỏ qua lỗi ghi DB phụ
    }

    return {
      success: false,
      error: safeErrorMsg,
      skipped: false,
    }
  }
}
