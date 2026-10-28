import { EmailTemplateResult } from './types'
import { formatVND } from '@/lib/money'
import { OrderStatus, PaymentOption, Resolution, VehicleType } from '@prisma/client'

export interface AddressSnapshotData {
  line?: string
  ward?: string
  district?: string
  province?: string
  recipient?: string
  phone?: string
  [key: string]: unknown
}

interface BaseEmailData {
  order: {
    id: string
    code: string
    status: OrderStatus
    total: number
    finalTotal?: number | null
    subtotal: number
    finalSubtotal?: number | null
    shippingFee: number
    depositAmount: number
    paymentOption: PaymentOption | string
    deliveryDate: Date | null
    timeSlot: string | null
    deliveredAt: Date | null
    paymentDueAt: Date | null
    addressSnapshot: unknown
  }
  user: {
    fullName: string
    email: string
    phone?: string | null
    companyName?: string | null
  }
}

export interface OrderPlacedEmailData extends BaseEmailData {
  items: Array<{
    productName: string
    packagingName: string
    quantity: number
    orderedGrams: number
    unitPricePerKg: number
    lineTotal: number
    isSample: boolean
  }>
}

export interface PaymentConfirmedEmailData extends BaseEmailData {
  transaction: {
    id: string
    amount: number
    method: string
    reference?: string | null
    completedAt?: Date | null
  }
}

export interface OrderShippingEmailData extends BaseEmailData {
  shipment?: {
    code: string
    vehicleType: VehicleType | string
    driverName?: string | null
    driverPhone?: string | null
    licensePlate?: string | null
    note?: string | null
    dispatchedAt?: Date | null
  } | null
}

export interface OrderCompletedEmailData extends BaseEmailData {
  items: Array<{
    productName: string
    packagingName: string
    orderedGrams: number
    actualGrams: number | null
    lineTotal: number
    finalLineTotal: number | null
  }>
  refundAmount?: number
}

export interface ComplaintOpenedEmailData extends BaseEmailData {
  complaint: {
    id: string
    reportedGrams: number
    description: string
    photosCount: number
    itemProductName?: string
  }
}

export interface ComplaintResolvedEmailData extends BaseEmailData {
  complaint: {
    id: string
    resolution: Resolution | string
    compensation?: number | null
    note?: string | null
    itemProductName?: string
  }
}

export interface RefundConfirmedEmailData extends BaseEmailData {
  transaction: {
    id: string
    amount: number
    completedAt?: Date | null
    note?: string | null
  }
}

/**
 * Khung HTML chuẩn, responsive, hỗ trợ email clients (Gmail, Outlook, Apple Mail...)
 */
export interface ComplaintProposedEmailData extends BaseEmailData {
  complaint: {
    id: string
    proposalType: string
    proposalAmount?: number | null
    proposalNotes?: string | null
    reviewDueAt?: Date | string | null
    isFinalProposal?: boolean
    itemProductName?: string
  }
}

function wrapHtmlEmail(title: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #334155; }
    .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
    .header { background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
    .header p { margin: 4px 0 0; font-size: 13px; opacity: 0.9; }
    .content { padding: 28px 24px; line-height: 1.6; }
    .card { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
    .table th { background-color: #f1f5f9; text-align: left; padding: 10px; border-bottom: 2px solid #cbd5e1; color: #475569; }
    .table td { padding: 10px; border-bottom: 1px solid #e2e8f0; }
    .table td.number { text-align: right; font-family: monospace; font-weight: 600; }
    .highlight-box { border-left: 4px solid #10b981; background-color: #ecfdf5; padding: 12px 16px; margin: 16px 0; border-radius: 0 8px 8px 0; }
    .warning-box { border-left: 4px solid #f59e0b; background-color: #fffbeb; padding: 12px 16px; margin: 16px 0; border-radius: 0 8px 8px 0; }
    .footer { background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 24px; text-align: center; font-size: 12px; color: #64748b; }
    .btn { display: inline-block; background-color: #059669; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>NÔNG SẢN B2B</h1>
      <p>Sàn Thương mại Điện tử Nông sản – Trái cây B2B</p>
    </div>
    <div class="content">
      ${bodyContent}
    </div>
    <div class="footer">
      <p><strong>Nông Sản B2B – Đối tác tin cậy của nhà vườn và đại lý</strong></p>
      <p>Email: support@nongsanb2b.vn | Hotline: 1900 6868</p>
      <p>Địa chỉ kho: Kho Trung tâm Phân phối Nông sản, TP. Hồ Chí Minh</p>
      <p style="font-size: 11px; margin-top: 8px;">Email này được gửi tự động từ hệ thống giao dịch, vui lòng không trả lời trực tiếp.</p>
    </div>
  </div>
</body>
</html>`
}

function formatDateVN(date: Date | null): string {
  if (!date) return 'Chưa xác định'
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

function formatDayVN(date: Date | null): string {
  if (!date) return 'Chưa xác định'
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date))
}

// ============================================================================
// E01: ĐẶT HÀNG THÀNH CÔNG (ORDER_PLACED)
// ============================================================================
export function renderOrderPlacedTemplate(data: OrderPlacedEmailData): EmailTemplateResult {
  const isDeposit = data.order.paymentOption === PaymentOption.DEPOSIT_30
  const initialPayment = isDeposit ? data.order.depositAmount : data.order.total

  const itemsHtml = data.items
    .map(
      (i) => `<tr>
      <td><strong>${i.productName}</strong><br><small style="color: #64748b;">${i.packagingName} x ${i.quantity} kiện (${(i.orderedGrams / 1000).toLocaleString('vi-VN')} kg)</small></td>
      <td class="number">${formatVND(i.lineTotal)}</td>
    </tr>`
    )
    .join('')

  const recipientName = data.user.fullName
  const address = data.order.addressSnapshot as AddressSnapshotData | null | undefined
  const addressText = address
    ? [address.line, address.ward, address.district, address.province].filter(Boolean).join(', ') || 'Theo địa chỉ mặc định'
    : 'Theo địa chỉ mặc định'

  const html = wrapHtmlEmail(
    `Xác nhận đơn hàng #${data.order.code}`,
    `<h2 style="color: #0f172a; margin-top: 0;">Xin chào ${recipientName},</h2>
    <p>Đơn hàng <strong>#${data.order.code}</strong> của bạn đã được khởi tạo thành công trên hệ thống Nông Sản B2B.</p>

    <div class="card">
      <table style="width: 100%; font-size: 13px;">
        <tr><td style="color: #64748b;">Mã đơn hàng:</td><td style="font-weight: bold; text-align: right; font-family: monospace;">${data.order.code}</td></tr>
        <tr><td style="color: #64748b;">Ngày giao dự kiến:</td><td style="text-align: right; font-weight: 600;">${formatDayVN(data.order.deliveryDate)} (${data.order.timeSlot === 'MORNING' ? 'Buổi sáng' : data.order.timeSlot === 'AFTERNOON' ? 'Buổi chiều' : 'Cả ngày'})</td></tr>
        <tr><td style="color: #64748b;">Địa chỉ nhận hàng:</td><td style="text-align: right;">${addressText}</td></tr>
        <tr><td style="color: #64748b;">Hình thức:</td><td style="text-align: right; font-weight: 600;">${isDeposit ? 'Đặt cọc 30%' : 'Thanh toán 100%'}</td></tr>
      </table>
    </div>

    <h3 style="font-size: 15px; margin-bottom: 8px;">Chi tiết sản phẩm đặt sỉ:</h3>
    <table class="table">
      <thead><tr><th>Sản phẩm / Quy cách</th><th style="text-align: right;">Thành tiền</th></tr></thead>
      <tbody>
        ${itemsHtml}
        <tr><td style="text-align: right; font-weight: 600;">Tạm tính tiền hàng:</td><td class="number">${formatVND(data.order.subtotal)}</td></tr>
        <tr><td style="text-align: right; font-weight: 600;">Phí vận chuyển:</td><td class="number">${data.order.shippingFee === 0 ? 'Miễn phí' : formatVND(data.order.shippingFee)}</td></tr>
        <tr style="background-color: #f8fafc;"><td style="text-align: right; font-weight: bold; font-size: 14px;">Tổng giá trị đơn:</td><td class="number" style="font-size: 15px; color: #059669;">${formatVND(data.order.total)}</td></tr>
        <tr><td style="text-align: right; font-weight: bold; color: #b45309;">Số tiền cần thanh toán (${isDeposit ? 'Cọc 30%' : '100%'}):</td><td class="number" style="font-size: 15px; color: #b45309;">${formatVND(initialPayment)}</td></tr>
      </tbody>
    </table>

    <div class="warning-box">
      <strong>Thời hạn thanh toán:</strong> Đơn hàng sẽ được giữ chỗ trong vòng 24 giờ. Vui lòng thanh toán trước <strong>${formatDateVN(data.order.paymentDueAt)}</strong> để nhà vườn tiến hành thu hoạch đóng gói.
    </div>

    <p style="text-align: center; margin-top: 24px;">
      <a href="https://nong-san-b2b-git-beta-baopk.vercel.app/thanh-toan/${data.order.code}" class="btn">Thanh toán VietQR ngay</a>
    </p>`
  )

  const text = `Kính gửi ${recipientName},\n\nĐơn hàng #${data.order.code} của bạn đã được tạo thành công.\nTổng giá trị: ${formatVND(data.order.total)}\nSố tiền cần thanh toán (${isDeposit ? 'Cọc 30%' : '100%'}): ${formatVND(initialPayment)}\nHạn thanh toán: ${formatDateVN(data.order.paymentDueAt)}\n\nTrân trọng,\nNông Sản B2B.`

  return {
    subject: `[Nông Sản B2B] Xác nhận đặt hàng thành công #${data.order.code}`,
    html,
    text,
  }
}

// ============================================================================
// E02: XÁC NHẬN THANH TOÁN THÀNH CÔNG (PAYMENT_CONFIRMED)
// ============================================================================
export function renderPaymentConfirmedTemplate(data: PaymentConfirmedEmailData): EmailTemplateResult {
  const recipientName = data.user.fullName
  const statusLabel =
    data.order.status === OrderStatus.PROCESSING
      ? 'Đang chuẩn bị hàng (PROCESSING)'
      : data.order.status === OrderStatus.PREORDER_WAITING
      ? 'Chờ thu hoạch vụ mùa (PREORDER_WAITING)'
      : data.order.status

  const html = wrapHtmlEmail(
    `Thanh toán thành công #${data.order.code}`,
    `<h2 style="color: #0f172a; margin-top: 0;">Kính gửi ${recipientName},</h2>
    <div class="highlight-box">
      <strong>Đã xác nhận thanh toán thành công!</strong> Ban quản trị Nông Sản B2B đã nhận được khoản thanh toán cho đơn hàng <strong>#${data.order.code}</strong>.
    </div>

    <div class="card">
      <table style="width: 100%; font-size: 13px;">
        <tr><td style="color: #64748b;">Mã đơn hàng:</td><td style="font-weight: bold; text-align: right; font-family: monospace;">${data.order.code}</td></tr>
        <tr><td style="color: #64748b;">Số tiền đã thanh toán:</td><td class="number" style="color: #059669; font-size: 15px;">${formatVND(data.transaction.amount)}</td></tr>
        <tr><td style="color: #64748b;">Phương thức:</td><td style="text-align: right;">${data.transaction.method}</td></tr>
        ${data.transaction.reference ? `<tr><td style="color: #64748b;">Mã tham chiếu GD:</td><td style="text-align: right; font-family: monospace;">${data.transaction.reference}</td></tr>` : ''}
        <tr><td style="color: #64748b;">Thời gian ghi nhận:</td><td style="text-align: right;">${formatDateVN(data.transaction.completedAt || new Date())}</td></tr>
        <tr><td style="color: #64748b;">Trạng thái đơn mới:</td><td style="text-align: right; font-weight: bold; color: #059669;">${statusLabel}</td></tr>
      </table>
    </div>

    <p>Đơn hàng của bạn đã được chuyển cho nhà vườn tại vùng trồng để bắt đầu công đoạn chọn lọc, đóng gói chuẩn quy cách B2B.</p>

    <p style="text-align: center; margin-top: 24px;">
      <a href="https://nong-san-b2b-git-beta-baopk.vercel.app/tai-khoan/don-hang/${data.order.code}" class="btn">Theo dõi tiến độ đơn hàng</a>
    </p>`
  )

  const text = `Kính gửi ${recipientName},\n\nXác nhận đã nhận khoản thanh toán ${formatVND(data.transaction.amount)} cho đơn hàng #${data.order.code}.\nTrạng thái đơn hiện tại: ${statusLabel}.\n\nTrân trọng,\nNông Sản B2B.`

  return {
    subject: `[Nông Sản B2B] Xác nhận thanh toán thành công #${data.order.code}`,
    html,
    text,
  }
}

// ============================================================================
// E03: ĐANG BÀN GIAO VẬN CHUYỂN (ORDER_SHIPPING)
// ============================================================================
export function renderOrderShippingTemplate(data: OrderShippingEmailData): EmailTemplateResult {
  const recipientName = data.user.fullName
  const shipment = data.shipment
  const vehicleLabel =
    shipment?.vehicleType === VehicleType.COLD || shipment?.vehicleType === 'COLD'
      ? 'Xe tải lạnh chuyên dụng'
      : 'Xe tải tiêu chuẩn'

  const html = wrapHtmlEmail(
    `Đơn hàng #${data.order.code} đang vận chuyển`,
    `<h2 style="color: #0f172a; margin-top: 0;">Xin chào ${recipientName},</h2>
    <p>Đơn hàng <strong>#${data.order.code}</strong> đã hoàn tất đóng gói và đang trên đường vận chuyển đến kho của bạn.</p>

    <div class="card">
      <h3 style="margin-top: 0; font-size: 14px; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">Thông tin Chuyến giao & Tài xế phụ trách:</h3>
      <table style="width: 100%; font-size: 13px;">
        <tr><td style="color: #64748b;">Mã chuyến giao:</td><td style="font-weight: bold; text-align: right; font-family: monospace;">${shipment?.code || `SHIP-${data.order.code}`}</td></tr>
        <tr><td style="color: #64748b;">Loại phương tiện:</td><td style="text-align: right; font-weight: 600;">${vehicleLabel}</td></tr>
        ${shipment?.driverName ? `<tr><td style="color: #64748b;">Tài xế giao hàng:</td><td style="text-align: right; font-weight: bold;">${shipment.driverName}</td></tr>` : ''}
        ${shipment?.driverPhone ? `<tr><td style="color: #64748b;">Số điện thoại tài xế:</td><td style="text-align: right;"><a href="tel:${shipment.driverPhone}" style="color: #059669; font-weight: bold;">${shipment.driverPhone}</a></td></tr>` : ''}
        ${shipment?.licensePlate ? `<tr><td style="color: #64748b;">Biển số xe:</td><td style="text-align: right; font-family: monospace;">${shipment.licensePlate}</td></tr>` : ''}
        <tr><td style="color: #64748b;">Khung giờ giao:</td><td style="text-align: right;">${data.order.timeSlot === 'MORNING' ? 'Buổi sáng (07:00 - 11:30)' : data.order.timeSlot === 'AFTERNOON' ? 'Buổi chiều (13:30 - 17:30)' : 'Trong ngày'}</td></tr>
      </table>
    </div>

    <div class="highlight-box">
      <strong>Lưu ý khi nhận hàng:</strong> Quý khách vui lòng đồng kiểm tra số lượng kiện, kiểm tra tem niêm phong và cân đối chứng với tài xế trước khi ký biên bản giao nhận.
    </div>

    <p style="text-align: center; margin-top: 24px;">
      <a href="https://nong-san-b2b-git-beta-baopk.vercel.app/tai-khoan/don-hang/${data.order.code}" class="btn">Xem chi tiết vận chuyển</a>
    </p>`
  )

  const text = `Kính gửi ${recipientName},\n\nĐơn hàng #${data.order.code} đang trên đường giao hàng.\nMã vận đơn: ${shipment?.code || 'Đang cập nhật'}\nTài xế: ${shipment?.driverName || 'Đang điều phối'} - SĐT: ${shipment?.driverPhone || 'N/A'}\nBiển số: ${shipment?.licensePlate || 'N/A'}\n\nTrân trọng,\nNông Sản B2B.`

  return {
    subject: `[Nông Sản B2B] Đơn hàng #${data.order.code} đang trên đường giao đến bạn`,
    html,
    text,
  }
}

// ============================================================================
// E04: HOÀN TẤT ĐƠN HÀNG TỨC THÌ & NHẮC BIÊN KHIẾU NẠI 24H (ORDER_COMPLETED - PH9-00)
// ============================================================================
export function renderOrderCompletedTemplate(data: OrderCompletedEmailData): EmailTemplateResult {
  const recipientName = data.user.fullName
  const deliveredTimeStr = formatDateVN(data.order.deliveredAt || new Date())
  const finalTotal = data.order.finalTotal ?? data.order.total

  const itemsHtml = data.items
    .map((i) => {
      const orderedKg = (i.orderedGrams / 1000).toLocaleString('vi-VN')
      const actualKg = i.actualGrams !== null ? (i.actualGrams / 1000).toLocaleString('vi-VN') : orderedKg
      const lineCost = i.finalLineTotal !== null ? i.finalLineTotal : i.lineTotal
      return `<tr>
        <td><strong>${i.productName}</strong><br><small style="color: #64748b;">${i.packagingName}</small></td>
        <td class="number">${orderedKg} kg</td>
        <td class="number" style="color: #059669;">${actualKg} kg</td>
        <td class="number">${formatVND(lineCost)}</td>
      </tr>`
    })
    .join('')

  const html = wrapHtmlEmail(
    `Giao hàng thành công & Hoàn tất đơn hàng #${data.order.code}`,
    `<h2 style="color: #0f172a; margin-top: 0;">Kính gửi ${recipientName},</h2>
    <div class="highlight-box">
      <strong>Đơn hàng #${data.order.code} đã được giao thành công và hoàn tất quyết toán!</strong>
    </div>

    <p>Thời điểm bàn giao thực tế: <strong>${deliveredTimeStr}</strong></p>

    <h3 style="font-size: 15px; margin-bottom: 8px;">Bảng đối soát khối lượng & Quyết toán thực tế:</h3>
    <table class="table">
      <thead>
        <tr><th>Sản phẩm</th><th style="text-align: right;">Đặt</th><th style="text-align: right;">Thực giao</th><th style="text-align: right;">Quyết toán</th></tr>
      </thead>
      <tbody>
        ${itemsHtml}
        <tr style="background-color: #f8fafc;"><td colspan="3" style="text-align: right; font-weight: bold;">Tổng tiền quyết toán thực tế:</td><td class="number" style="font-size: 15px; color: #059669;">${formatVND(finalTotal)}</td></tr>
      </tbody>
    </table>

    <div class="warning-box">
      <h4 style="margin: 0 0 6px 0; color: #92400e; font-size: 14px;">⚠️ QUY ĐỊNH BẢO VỆ KHÁCH HÀNG & THỜI HẠN KHIẾU NẠI 24 GIỜ:</h4>
      <p style="margin: 0; font-size: 13px; color: #78350f;">
        Theo quy chuẩn giao dịch nông sản sỉ B2B, quý khách có <strong>đúng 24 giờ kể từ thời điểm nhận hàng (${deliveredTimeStr})</strong> để kiểm tra chất lượng bên trong. Nếu có hao hụt tự nhiên vượt mức quy định 3%, quý khách vui lòng chụp ảnh rõ nét và bấm <strong>"Khiếu nại hao hụt (24h)"</strong> trong chi tiết đơn hàng.<br>
        <strong>Lưu ý: Sau đúng 24h00m00s, cổng khiếu nại sẽ tự động đóng lại.</strong>
      </p>
    </div>

    <p style="text-align: center; margin-top: 24px;">
      <a href="https://nong-san-b2b-git-beta-baopk.vercel.app/tai-khoan/don-hang/${data.order.code}" class="btn">Xem chi tiết đơn hàng & Quyết toán</a>
    </p>`
  )

  const text = `Kính gửi ${recipientName},\n\nĐơn hàng #${data.order.code} đã giao thành công vào lúc ${deliveredTimeStr}.\nTổng quyết toán thực tế: ${formatVND(finalTotal)}.\n\nLƯU Ý: Quý khách có đúng 24 giờ kể từ lúc nhận hàng để kiểm tra chất lượng và gửi khiếu nại hao hụt nếu phát sinh vượt mức 3% quy định.\n\nTrân trọng,\nNông Sản B2B.`

  return {
    subject: `[Nông Sản B2B] Giao hàng thành công & Hoàn tất đơn hàng #${data.order.code}`,
    html,
    text,
  }
}

// ============================================================================
// E05: TIẾP NHẬN KHIẾU NẠI (COMPLAINT_OPENED)
// ============================================================================
export function renderComplaintOpenedTemplate(data: ComplaintOpenedEmailData): EmailTemplateResult {
  const recipientName = data.user.fullName
  const reportedKg = (data.complaint.reportedGrams / 1000).toLocaleString('vi-VN')

  const html = wrapHtmlEmail(
    `Tiếp nhận khiếu nại đơn hàng #${data.order.code}`,
    `<h2 style="color: #0f172a; margin-top: 0;">Kính gửi ${recipientName},</h2>
    <div class="warning-box">
      <strong>Đã tiếp nhận yêu cầu khiếu nại thành công!</strong> Hệ thống Nông Sản B2B đã ghi nhận khiếu nại của bạn cho đơn hàng <strong>#${data.order.code}</strong>.
    </div>

    <div class="card">
      <table style="width: 100%; font-size: 13px;">
        <tr><td style="color: #64748b;">Mã đơn hàng:</td><td style="font-weight: bold; text-align: right; font-family: monospace;">${data.order.code}</td></tr>
        ${data.complaint.itemProductName ? `<tr><td style="color: #64748b;">Sản phẩm khiếu nại:</td><td style="text-align: right; font-weight: bold;">${data.complaint.itemProductName}</td></tr>` : ''}
        <tr><td style="color: #64748b;">Khối lượng báo hao hụt:</td><td class="number" style="color: #b45309;">${reportedKg} kg</td></tr>
        <tr><td style="color: #64748b;">Số ảnh minh chứng:</td><td style="text-align: right;">${data.complaint.photosCount} ảnh</td></tr>
        <tr><td style="color: #64748b; vertical-align: top;">Nội dung mô tả:</td><td style="text-align: right; color: #1e293b;">${data.complaint.description}</td></tr>
      </table>
    </div>

    <p>Ban Quản Trị và Bộ phận Đảm bảo Chất lượng (QA) đang tiến hành thẩm định hình ảnh và biên bản giao nhận với nhà vườn. Chúng tôi sẽ phản hồi kết luận chính thức trong vòng <strong>24 - 48 giờ làm việc</strong>.</p>

    <p style="text-align: center; margin-top: 24px;">
      <a href="https://nong-san-b2b-git-beta-baopk.vercel.app/tai-khoan/don-hang/${data.order.code}" class="btn">Theo dõi xử lý khiếu nại</a>
    </p>`
  )

  const text = `Kính gửi ${recipientName},\n\nĐã tiếp nhận khiếu nại hao hụt ${reportedKg} kg cho đơn hàng #${data.order.code}.\nBan Quản Trị đang tiến hành thẩm định và sẽ phản hồi trong vòng 24-48 giờ làm việc.\n\nTrân trọng,\nNông Sản B2B.`

  return {
    subject: `[Nông Sản B2B] Đã tiếp nhận khiếu nại cho đơn hàng #${data.order.code}`,
    html,
    text,
  }
}

// ============================================================================
// E06: KẾT QUẢ XỬ LÝ KHIẾU NẠI (COMPLAINT_RESOLVED)
// ============================================================================
export function renderComplaintResolvedTemplate(data: ComplaintResolvedEmailData): EmailTemplateResult {
  const recipientName = data.user.fullName
  const resolution = data.complaint.resolution

  let resolutionTitle = 'Kết quả xử lý khiếu nại'
  let resolutionContentHtml = ''

  if (resolution === Resolution.REFUND || resolution === 'REFUND') {
    const compensation = data.complaint.compensation || 0
    resolutionTitle = 'Chấp thuận bồi hoàn tiền mặt'
    resolutionContentHtml = `
      <div class="highlight-box">
        <strong>Kết luận: CHẤP THUẬN BỒI HOÀN TIỀN MẶT</strong><br>
        Số tiền bồi hoàn được phê duyệt: <strong style="font-size: 16px; color: #059669;">${formatVND(compensation)}</strong>
      </div>
      <p style="font-size: 13px; color: #475569;">
        <strong>Tiến độ hoàn tiền:</strong> Lệnh hoàn tiền đã được chuyển sang bộ phận kế toán để thực hiện ủy nhiệm chi qua chuyển khoản ngân hàng. Quý khách sẽ nhận được thông báo xác nhận ngay khi giao dịch chuyển khoản hoàn tất.
      </p>
    `
  } else if (resolution === Resolution.REPLACE || resolution === 'REPLACE') {
    resolutionTitle = 'Chấp thuận bù hàng'
    resolutionContentHtml = `
      <div class="highlight-box">
        <strong>Kết luận: CHẤP THUẬN BÙ HÀNG</strong><br>
        Số lượng nông sản hao hụt sẽ được đóng gói bù thêm và giao kèm miễn phí trong chuyến giao tiếp theo của quý khách.
      </div>
    `
  } else {
    // REJECTED
    resolutionTitle = 'Từ chối yêu cầu khiếu nại'
    resolutionContentHtml = `
      <div class="warning-box">
        <strong>Kết luận: TỪ CHỐI BỒI HOÀN</strong><br>
        Yêu cầu khiếu nại không đủ điều kiện bồi hoàn theo quy chế sàn (mức hao hụt nằm trong giới hạn tự nhiên cho phép hoặc không cung cấp đủ ảnh minh chứng hợp lệ).
      </div>
      ${data.complaint.note ? `<p style="font-size: 13px; color: #475569;"><strong>Ghi chú từ quản trị viên:</strong> ${data.complaint.note}</p>` : ''}
    `
  }

  const html = wrapHtmlEmail(
    `${resolutionTitle} #${data.order.code}`,
    `<h2 style="color: #0f172a; margin-top: 0;">Kính gửi ${recipientName},</h2>
    <p>Ban Quản Trị Nông Sản B2B xin thông báo kết quả xử lý khiếu nại cho đơn hàng <strong>#${data.order.code}</strong>:</p>

    ${resolutionContentHtml}

    <p style="text-align: center; margin-top: 24px;">
      <a href="https://nong-san-b2b-git-beta-baopk.vercel.app/tai-khoan/don-hang/${data.order.code}" class="btn">Xem chi tiết khiếu nại</a>
    </p>`
  )

  const text = `Kính gửi ${recipientName},\n\nKết quả xử lý khiếu nại cho đơn hàng #${data.order.code}: ${resolutionTitle}.\n\nTrân trọng,\nNông Sản B2B.`

  return {
    subject: `[Nông Sản B2B] Kết quả giải quyết khiếu nại đơn hàng #${data.order.code}`,
    html,
    text,
  }
}

// ============================================================================
// REFUND_CONFIRMED: XÁC NHẬN CHUYỂN KHOẢN HOÀN TIỀN THÀNH CÔNG (Sau khi Admin bấm xác nhận chuyển khoản)
// ============================================================================
export function renderRefundConfirmedTemplate(data: RefundConfirmedEmailData): EmailTemplateResult {
  const recipientName = data.user.fullName

  const html = wrapHtmlEmail(
    `Hoàn tất chuyển khoản bồi hoàn #${data.order.code}`,
    `<h2 style="color: #0f172a; margin-top: 0;">Kính gửi ${recipientName},</h2>
    <div class="highlight-box">
      <strong>ĐÃ HOÀN TẤT CHUYỂN KHOẢN TIỀN BỒI HOÀN!</strong><br>
      Ban quản trị Nông Sản B2B đã chuyển thành công số tiền <strong style="font-size: 16px; color: #059669;">${formatVND(data.transaction.amount)}</strong> vào tài khoản ngân hàng của quý khách.
    </div>

    <div class="card">
      <table style="width: 100%; font-size: 13px;">
        <tr><td style="color: #64748b;">Mã đơn hàng:</td><td style="font-weight: bold; text-align: right; font-family: monospace;">${data.order.code}</td></tr>
        <tr><td style="color: #64748b;">Số tiền hoàn trả:</td><td class="number" style="color: #059669; font-size: 15px;">${formatVND(data.transaction.amount)}</td></tr>
        <tr><td style="color: #64748b;">Thời điểm hoàn tất:</td><td style="text-align: right;">${formatDateVN(data.transaction.completedAt || new Date())}</td></tr>
        ${data.transaction.note ? `<tr><td style="color: #64748b;">Ghi chú kế toán:</td><td style="text-align: right;">${data.transaction.note}</td></tr>` : ''}
      </table>
    </div>

    <p>Quý khách vui lòng kiểm tra biến động số dư tài khoản ngân hàng. Nếu cần hỗ trợ đối soát thêm, xin vui lòng liên hệ hotline 1900 6868.</p>`
  )

  const text = `Kính gửi ${recipientName},\n\nKhoản tiền bồi hoàn ${formatVND(data.transaction.amount)} cho đơn hàng #${data.order.code} đã được chuyển khoản ngân hàng thành công.\n\nTrân trọng,\nNông Sản B2B.`

  return {
    subject: `[Nông Sản B2B] Hoàn tất chuyển khoản bồi hoàn cho đơn hàng #${data.order.code}`,
    html,
    text,
  }
}


// ============================================================================
// COMPLAINT_PROPOSED: THÔNG BÁO ĐỀ XUẤT XỬ LÝ KHIẾU NẠI (F02 - 48H SLA)
// ============================================================================
export function renderComplaintProposedTemplate(data: ComplaintProposedEmailData): EmailTemplateResult {
  const recipientName = data.user.fullName
  const isFinal = Boolean(data.complaint.isFinalProposal)
  const proposalType = data.complaint.proposalType
  const deadlineDate = data.complaint.reviewDueAt ? new Date(data.complaint.reviewDueAt) : null
  const deadlineStr = formatDateVN(deadlineDate)

  let typeLabel = 'Bồi thường bằng tiền'
  if (proposalType === 'REJECT_COMPLAINT' || proposalType === 'REJECT') {
    typeLabel = 'Từ chối khiếu nại'
  } else if (proposalType === 'REPLACE_GOODS' || proposalType === 'REPLACE') {
    typeLabel = 'Bù hàng chuyến sau'
  }

  const subject = `[E Vibe] Đề xuất xử lý khiếu nại${isFinal ? ' (Lần cuối)' : ''} đơn hàng #${data.order.code}`

  const orderUrl = process.env.NEXTAUTH_URL
    ? `${process.env.NEXTAUTH_URL}/tai-khoan/don-hang/${data.order.code}`
    : `/tai-khoan/don-hang/${data.order.code}`

  const html = wrapHtmlEmail(
    `Đề xuất xử lý khiếu nại đơn hàng #${data.order.code}`,
    `<h2 style="color: #0f172a; margin-top: 0;">Kính gửi ${recipientName},</h2>
    <p>Ban quản trị E Vibe — Nông Sản B2B đã xem xét khiếu nại của quý khách cho đơn hàng <strong>#${data.order.code}</strong> và đưa ra phương án xử lý như sau:</p>

    <div class="highlight-box" style="border-left: 4px solid ${isFinal ? '#e11d48' : '#0284c7'}; background: ${isFinal ? '#fff1f2' : '#f0f9ff'}; padding: 16px; margin: 16px 0; border-radius: 8px;">
      <strong style="color: ${isFinal ? '#9f1239' : '#0369a1'}; font-size: 15px;">
        ${isFinal ? '⚠️ ĐÂY LÀ ĐỀ XUẤT CUỐI CÙNG (ĐÃ QUA PHÚC TRA)' : 'ĐỀ XUẤT GIẢI QUYẾT KHIẾU NẠI'}
      </strong><br>
      <div style="margin-top: 8px; font-size: 14px;">
        <strong>Phương án:</strong> ${typeLabel}<br>
        ${
          proposalType === 'REFUND_MONEY' && data.complaint.proposalAmount
            ? `<strong>Số tiền bồi hoàn:</strong> <span style="font-size: 16px; color: #059669; font-weight: bold;">${formatVND(data.complaint.proposalAmount)}</span><br>`
            : ''
        }
        <strong>Thời hạn phản hồi:</strong> <span style="color: #dc2626; font-weight: bold;">${deadlineStr} (48 giờ)</span>
      </div>
    </div>

    ${
      data.complaint.proposalNotes
        ? `<div class="card" style="background: #f8fafc; padding: 12px; border-radius: 6px; margin-bottom: 16px;">
            <strong style="color: #475569; font-size: 13px;">Ghi chú từ Ban quản trị:</strong>
            <p style="margin: 4px 0 0; font-size: 13px; color: #1e293b;">${data.complaint.proposalNotes}</p>
          </div>`
        : ''
    }

    <p style="font-size: 13px; color: #475569;">
      ${
        isFinal
          ? 'Vì đây là phương án sau phúc tra (vòng cuối), quý khách có thể <strong>Chấp nhận đề xuất</strong> hoặc <strong>Rút khiếu nại</strong> trên hệ thống.'
          : 'Quý khách có thể <strong>Chấp nhận đề xuất</strong>, <strong>Yêu cầu phúc tra (tối đa 1 lần)</strong> hoặc <strong>Rút khiếu nại</strong> trực tiếp tại trang chi tiết đơn hàng.'
      }
      Nếu không có phản hồi trong vòng <strong>48 giờ</strong>, khiếu nại sẽ được tự động đóng theo quy chế.
    </p>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${orderUrl}" style="background-color: #059669; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
        Xem chi tiết và Phản hồi đề xuất
      </a>
    </div>`
  )

  const text = `Kính gửi ${recipientName},\n\nBan quản trị đã gửi đề xuất xử lý khiếu nại cho đơn hàng #${data.order.code}.\nPhương án: ${typeLabel}\n${
    proposalType === 'REFUND_MONEY' && data.complaint.proposalAmount
      ? `Số tiền bồi hoàn: ${formatVND(data.complaint.proposalAmount)}\n`
      : ''
  }Hạn phản hồi: ${deadlineStr} (48 giờ).\n${isFinal ? 'Lưu ý: Đây là đề xuất cuối cùng.\n' : ''}\nChi tiết: ${orderUrl}\n\nTrân trọng,\nE Vibe — Nông Sản B2B.`

  return {
    subject,
    html,
    text,
  }
}
