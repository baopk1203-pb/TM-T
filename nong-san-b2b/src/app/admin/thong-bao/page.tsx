import { db } from '@/lib/db'
import { formatVietnamDateTime } from '@/lib/utils'
import {
  NotificationListClient,
  AdminEmailLogItem,
} from './notification-list-client'

export const dynamic = 'force-dynamic'

interface EmailEventPayload {
  recipient?: string
  subject?: string
  messageId?: string
  type?: string
  sentAt?: string
  reason?: string
  error?: string
  attemptedAt?: string
}

function parseEmailEvent(
  type: string,
  payloadRaw: unknown
): {
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED'
  eventType: string
  payload: EmailEventPayload
} {
  const payload = (payloadRaw ?? {}) as EmailEventPayload

  if (type.startsWith('EMAIL_SENT_')) {
    let eventType = payload.type || type.replace('EMAIL_SENT_', '')
    // Bóc tách nếu có ID phía sau (ví dụ: EMAIL_SENT_PAYMENT_CONFIRMED_cl...)
    if (eventType.startsWith('PAYMENT_CONFIRMED')) eventType = 'PAYMENT_CONFIRMED'
    else if (eventType.startsWith('ORDER_SHIPPING')) eventType = 'ORDER_SHIPPING'
    else if (eventType.startsWith('COMPLAINT_OPENED')) eventType = 'COMPLAINT_OPENED'
    else if (eventType.startsWith('COMPLAINT_RESOLVED')) eventType = 'COMPLAINT_RESOLVED'
    else if (eventType.startsWith('REFUND_CONFIRMED')) eventType = 'REFUND_CONFIRMED'

    return {
      status: 'SUCCESS',
      eventType,
      payload,
    }
  }

  if (type.startsWith('EMAIL_FAILED_')) {
    const eventType = payload.type || type.replace('EMAIL_FAILED_', '')
    return {
      status: 'FAILED',
      eventType,
      payload,
    }
  }

  if (type.startsWith('EMAIL_SKIPPED_')) {
    const eventType = payload.type || type.replace('EMAIL_SKIPPED_', '')
    return {
      status: 'SKIPPED',
      eventType,
      payload,
    }
  }

  return {
    status: 'SUCCESS',
    eventType: type,
    payload,
  }
}

export default async function AdminNotificationsPage() {
  const emailEvents = await db.orderEvent.findMany({
    where: {
      type: {
        startsWith: 'EMAIL_',
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      order: {
        include: {
          user: true,
        },
      },
    },
  })

  const mappedLogs: AdminEmailLogItem[] = emailEvents.map((evt) => {
    const { status, eventType, payload } = parseEmailEvent(evt.type, evt.payload)

    const recipient =
      payload.recipient || evt.order.user?.email || 'Chưa xác định'
    const customerName =
      evt.order.user?.fullName || evt.order.user?.companyName || 'Khách hàng'

    return {
      id: evt.id,
      orderId: evt.orderId,
      orderCode: evt.order.code,
      eventType,
      recipient,
      subject: payload.subject || '',
      status,
      note: evt.note,
      error: payload.error || payload.reason || null,
      messageId: payload.messageId || null,
      createdAt: formatVietnamDateTime(evt.createdAt),
      customerName,
    }
  })

  return <NotificationListClient initialLogs={mappedLogs} />
}
