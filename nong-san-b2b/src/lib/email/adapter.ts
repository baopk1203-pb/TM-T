import nodemailer from 'nodemailer'
import { SendEmailPayload, SendEmailResult } from './types'

export const DEFAULT_SMTP_TIMEOUT_MS = 5000

export interface EmailAdapter {
  send(payload: SendEmailPayload): Promise<SendEmailResult>
}

export interface SmtpConfigValidation {
  valid: boolean
  missingKeys: string[]
}

/**
 * Kiểm tra môi trường có đang chạy trên hạ tầng Vercel (Preview / Production) hay không.
 * Trên Vercel tuyệt đối không bao giờ cho phép dùng MockEmailAdapter.
 */
export function isVercelRuntime(): boolean {
  return (
    process.env.VERCEL === '1' ||
    Boolean(process.env.VERCEL_ENV && process.env.VERCEL_ENV.trim().length > 0)
  )
}

/**
 * Kiểm tra đầy đủ các biến môi trường SMTP thực sự cần thiết cho NodemailerAdapter.
 */
export function validateSmtpConfig(): SmtpConfigValidation {
  const missingKeys: string[] = []

  const host = process.env.SMTP_HOST?.trim()
  if (!host) {
    missingKeys.push('SMTP_HOST')
  }

  const portStr = process.env.SMTP_PORT?.trim()
  const port = portStr ? Number(portStr) : NaN
  if (!portStr || !Number.isInteger(port) || port < 1 || port > 65535) {
    missingKeys.push('SMTP_PORT')
  }

  const user = process.env.SMTP_USER?.trim()
  if (!user) {
    missingKeys.push('SMTP_USER')
  }

  const pass = process.env.SMTP_PASS?.trim()
  if (!pass) {
    missingKeys.push('SMTP_PASS')
  }

  return {
    valid: missingKeys.length === 0,
    missingKeys,
  }
}

/**
 * Làm sạch thông báo lỗi SMTP, đảm bảo tuyệt đối không rò rỉ mật khẩu hay thông tin nhạy cảm vào log/DB.
 */
export function sanitizeSmtpError(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err || 'Lỗi gửi email qua SMTP')

  const secretsToRedact = [
    process.env.SMTP_PASS?.trim(),
    process.env.SMTP_USER?.trim(),
  ].filter((s): s is string => Boolean(s && s.length >= 3))

  for (const secret of secretsToRedact) {
    msg = msg.split(secret).join('[REDACTED]')
  }

  // Che các chuỗi xác thực dạng URL user:pass@host nếu có
  msg = msg.replace(/\/\/([^:/\s]+):([^@/\s]+)@/g, '//[REDACTED]:[REDACTED]@')

  return msg
}

/**
 * Mock Email Adapter: CHỈ dùng trong Unit Tests (NODE_ENV=test) hoặc Local Dev bật chủ động (EMAIL_PROVIDER=mock).
 * Tuyệt đối không dùng trên Vercel Preview / Production.
 */
export class MockEmailAdapter implements EmailAdapter {
  private sentMessages: SendEmailPayload[] = []
  private shouldFailNext = false
  private failError = 'Mock SMTP connection refused'

  async send(payload: SendEmailPayload): Promise<SendEmailResult> {
    if (this.shouldFailNext) {
      this.shouldFailNext = false
      return {
        success: false,
        error: this.failError,
      }
    }

    this.sentMessages.push({ ...payload })
    const messageId = `<mock-${Date.now()}-${Math.random().toString(36).substring(2, 9)}@nongsanb2b.vn>`
    return {
      success: true,
      messageId,
    }
  }

  getSentMessages(): SendEmailPayload[] {
    return [...this.sentMessages]
  }

  getLastMessage(): SendEmailPayload | undefined {
    return this.sentMessages[this.sentMessages.length - 1]
  }

  clear(): void {
    this.sentMessages = []
    this.shouldFailNext = false
  }

  simulateFailure(errorMessage?: string): void {
    this.shouldFailNext = true
    if (errorMessage) {
      this.failError = errorMessage
    }
  }
}

/**
 * Adapter trả về trạng thái thiếu cấu hình SMTP (MISSING_SMTP_CONFIG) một cách tường minh,
 * ngăn chặn ghi nhận EMAIL_SENT giả khi môi trường chưa cấu hình SMTP.
 */
export class UnconfiguredEmailAdapter implements EmailAdapter {
  private missingKeys: string[]

  constructor(missingKeys: string[] = []) {
    this.missingKeys = missingKeys
  }

  async send(): Promise<SendEmailResult> {
    const missingDetail =
      this.missingKeys.length > 0
        ? ` (Thiếu: ${this.missingKeys.join(', ')})`
        : ''
    return {
      success: false,
      skipped: true,
      skipReason: 'MISSING_SMTP_CONFIG',
      error: `MISSING_SMTP_CONFIG: Chưa cấu hình đầy đủ thông số SMTP${missingDetail}`,
    }
  }
}

/**
 * Nodemailer SMTP Adapter kết nối qua SMTP với cơ chế timeout bảo vệ vòng đời Serverless.
 * Lưu ý: Kết quả success=true chỉ phản ánh máy chủ SMTP đã chấp nhận gửi (250 OK),
 * không đồng nghĩa với việc email đã vào hộp thư đến hoặc đã được khách hàng mở đọc.
 */
export class NodemailerAdapter implements EmailAdapter {
  private transporter: nodemailer.Transporter | null = null
  private timeoutMs: number

  constructor(timeoutMs?: number) {
    const envTimeout = Number(process.env.SMTP_TIMEOUT_MS)
    this.timeoutMs =
      timeoutMs ??
      (Number.isFinite(envTimeout) && envTimeout > 0
        ? envTimeout
        : DEFAULT_SMTP_TIMEOUT_MS)
  }

  private getTransporter(): nodemailer.Transporter {
    if (!this.transporter) {
      const host = process.env.SMTP_HOST!.trim()
      const port = Number(process.env.SMTP_PORT!.trim())
      const user = process.env.SMTP_USER!.trim()
      const pass = process.env.SMTP_PASS!.trim()
      const secure = process.env.SMTP_SECURE === 'true' || port === 465

      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
        connectionTimeout: this.timeoutMs,
        greetingTimeout: this.timeoutMs,
        socketTimeout: this.timeoutMs,
      })
    }
    return this.transporter
  }

  async send(payload: SendEmailPayload): Promise<SendEmailResult> {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    try {
      const transporter = this.getTransporter()
      const from =
        process.env.SMTP_FROM?.trim() ||
        process.env.MAIL_FROM?.trim() ||
        'Nông Sản B2B <no-reply@nongsanb2b.vn>'

      const sendPromise = transporter.sendMail({
        from,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      })

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new Error(
              `SMTP_TIMEOUT: Quá thời gian kết nối/gửi email qua SMTP (${this.timeoutMs}ms)`
            )
          )
        }, this.timeoutMs)
      })

      const info = await Promise.race([sendPromise, timeoutPromise])
      return {
        success: true,
        messageId: info.messageId,
      }
    } catch (err: unknown) {
      if (this.transporter) {
        try {
          this.transporter.close()
        } catch {
          // Bỏ qua lỗi đóng kết nối
        }
        this.transporter = null
      }
      return {
        success: false,
        error: sanitizeSmtpError(err),
      }
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
    }
  }
}

let mockAdapterInstance: MockEmailAdapter | null = null

export function getMockEmailAdapter(): MockEmailAdapter {
  if (!mockAdapterInstance) {
    mockAdapterInstance = new MockEmailAdapter()
  }
  return mockAdapterInstance
}

/**
 * Factory lấy adapter phù hợp với cấu hình môi trường:
 * 1. Trên Vercel (Preview / Production): Tuyệt đối KHÔNG dùng Mock. Nếu đủ cấu hình SMTP thì dùng NodemailerAdapter,
 *    ngược lại trả về UnconfiguredEmailAdapter để ghi nhận MISSING_SMTP_CONFIG.
 * 2. Ngoài Vercel: Chỉ dùng Mock khi NODE_ENV === 'test' hoặc EMAIL_PROVIDER === 'mock'.
 * 3. Nếu không bật Mock và thiếu cấu hình SMTP: Trả về UnconfiguredEmailAdapter (không âm thầm giả lập thành công).
 */
export function getEmailAdapter(): EmailAdapter {
  const onVercel = isVercelRuntime()

  if (!onVercel) {
    if (
      process.env.NODE_ENV === 'test' ||
      process.env.EMAIL_PROVIDER === 'mock'
    ) {
      return getMockEmailAdapter()
    }
  }

  const validation = validateSmtpConfig()
  if (validation.valid) {
    return new NodemailerAdapter()
  }

  return new UnconfiguredEmailAdapter(validation.missingKeys)
}
