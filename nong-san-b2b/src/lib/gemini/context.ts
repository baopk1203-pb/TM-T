/**
 * F03 — CONTEXT AGGREGATOR & PII SANITIZER
 * E Vibe — Nông Sản B2B
 *
 * Aggregates server-side read-only business reports and inventory snapshots,
 * strips all sensitive Personally Identifiable Information (PII),
 * and formats bounded factual context for Gemini AI.
 */

import { BusinessReportData } from '@/server/reports'
import { AdminDashboardKpis } from '@/lib/domain/reports'
import { AdminInventoryDashboardData } from '@/lib/services/inventory-read'
import { formatVND } from '@/lib/money'

/**
 * Khử định danh ID và tên khách hàng B2B
 * Ví dụ: "cm72xyz9988" -> "DOANH_NGHIEP_#9988"
 */
export function sanitizeCustomerIdentifier(id: string): string {
  if (!id) return 'DOANH_NGHIEP_#ANON'
  const cleanId = id.replace(/[^a-zA-Z0-9]/g, '')
  const suffix = cleanId.slice(-4).toUpperCase()
  return `DOANH_NGHIEP_#${suffix || '0000'}`
}

/**
 * Che dấu số điện thoại, chỉ giữ 4 số cuối
 * Ví dụ: "0901234567" -> "09xxxx4567"
 */
export function sanitizePhoneNumber(phone?: string | null): string {
  if (!phone || phone.trim().length === 0) return 'N/A'
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return '09xxxx****'
  return `09xxxx${digits.slice(-4)}`
}

/**
 * Rút gọn địa chỉ giao hàng, chỉ giữ lại Tỉnh / Thành phố
 * Loại bỏ số nhà, tên đường, thông tin liên lạc cá nhân
 */
export function sanitizeAddress(address?: string | null): string {
  if (!address || address.trim().length === 0) return 'Việt Nam'

  // Tìm tỉnh/thành phố phổ biến ở Việt Nam
  const provinces = [
    'Hồ Chí Minh', 'TP.HCM', 'Hà Nội', 'Đà Nẵng', 'Cần Thơ', 'Hải Phòng',
    'Bến Tre', 'Tiền Giang', 'Đồng Tháp', 'Vĩnh Long', 'An Giang', 'Lâm Đồng',
    'Đắk Lắk', 'Bình Thuận', 'Long An', 'Bình Dương', 'Đồng Nai'
  ]

  for (const prov of provinces) {
    if (new RegExp(prov, 'i').test(address)) {
      return prov.startsWith('TP') || prov === 'Hồ Chí Minh' || prov === 'Hà Nội' || prov === 'Đà Nẵng' || prov === 'Cần Thơ' || prov === 'Hải Phòng'
        ? `TP. ${prov.replace(/^TP\.?\s*/i, '')}`
        : `Tỉnh ${prov}`
    }
  }

  return 'Khu vực nội địa Việt Nam'
}

export interface BuildExecutiveContextInput {
  reportData?: BusinessReportData | null
  dashboardKpis?: AdminDashboardKpis | null
  inventoryData?: AdminInventoryDashboardData | null
  referenceDate?: Date
}

/**
 * Xây dựng tài liệu ngữ cảnh factual có cấu trúc và giới hạn kích thước cho Gemini AI
 */
export function buildExecutiveContext(input: BuildExecutiveContextInput): string {
  const { reportData, dashboardKpis, inventoryData, referenceDate = new Date() } = input

  const sections: string[] = []

  // Header thông tin phiên báo cáo
  sections.push(
    `THỜI ĐIỂM TRÍCH XUẤT DỮ LIỆU: ${referenceDate.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`
  )

  // 1. Dữ liệu Báo cáo Tài chính & Doanh thu
  if (reportData) {
    const { range, timeline, topProducts, cancellationAndComplaints, shrinkage, revenueByGroup, cashflow } = reportData

    sections.push(
      `\n### 1. BÁO CÁO KINH DOANH & TÀI CHÍNH (KỲ: ${range.fromText} ĐẾN ${range.toText})` +
      `\n- Tổng doanh thu thực nhận (đơn hoàn thành): ${formatVND(timeline.totalRevenue)}` +
      `\n- Tổng sản lượng xuất bán hoàn thành: ${(timeline.totalKg).toLocaleString('vi-VN')} kg` +
      `\n- Số lượng đơn hàng hoàn thành: ${timeline.totalCompletedOrders} đơn` +
      `\n- Tỷ lệ hủy đơn hàng: ${cancellationAndComplaints.cancellationRate}% (${cancellationAndComplaints.cancelledOrdersCount} / ${cancellationAndComplaints.totalOrders} đơn)` +
      `\n- Tỷ lệ phát sinh khiếu nại: ${cancellationAndComplaints.complaintRate}% (${cancellationAndComplaints.complaintOrdersCount} đơn bị khiếu nại)` +
      `\n- Hao hụt giao hàng (Shrinkage): ${(shrinkage.shrinkageGrams / 1000).toLocaleString('vi-VN')} kg (Tỷ lệ hao hụt: ${shrinkage.shrinkageRate}%)` +
      `\n- Tình hình dòng tiền:` +
      `\n  + Thực thu tiền hàng thuần: ${formatVND(cashflow.netCashReceived)}` +
      `\n  + Tổng tiền đã thanh toán: ${formatVND(cashflow.totalPaid)}` +
      `\n  + Tổng tiền đã hoàn trả cho khách: ${formatVND(cashflow.totalRefunded)}` +
      `\n  + Tiền hoàn đang chờ xử lý: ${formatVND(cashflow.pendingRefund)}`
    )

    // Top sản phẩm theo doanh thu
    if (topProducts.topByRevenue.length > 0) {
      const topList = topProducts.topByRevenue
        .slice(0, 8)
        .map(
          (p, idx) =>
            `  ${idx + 1}. ${p.productName}: Doanh thu ${formatVND(p.totalRevenue)} | Sản lượng: ${p.totalKg.toLocaleString('vi-VN')} kg (${p.orderCount} đơn)`
        )
        .join('\n')
      sections.push(`\n### 2. TOP SẢN PHẨM BÁN CHẠY:\n${topList}`)
    }

    // Cơ cấu doanh thu theo nhóm khách hàng (B2B)
    if (revenueByGroup.groups.length > 0) {
      const groupList = revenueByGroup.groups
        .map(
          (g) =>
            `  - ${g.groupName} (${g.groupCode}): Doanh thu ${formatVND(g.revenue)} (${g.percentage}%), Số đơn: ${g.orderCount}`
        )
        .join('\n')
      sections.push(`\n### 3. PHÂN BỔ DOANH THU THEO NHÓM KHÁCH HÀNG:\n${groupList}`)
    }
  } else {
    sections.push('\n### 1. BÁO CÁO KINH DOANH: Chưa có dữ liệu kỳ báo cáo.')
  }

  // 2. Dữ liệu Quản trị Tồn kho & FEFO (F01)
  if (inventoryData?.kpis) {
    const {
      totalPhysicalStockGrams,
      totalAvailableStockGrams,
      totalReservedStockGrams,
      trackedProductsCount,
      untrackedProductsCount,
      eligibleActiveBatchesCount,
      expiringWithin3DaysBatchesCount,
      expiringWithin7DaysBatchesCount,
      expiredBatchesCount,
      lowStockProductsCount,
    } = inventoryData.kpis

    // Nhóm ≤3 ngày là tập con lồng trong nhóm ≤7 ngày.
    // Phân tách thành hai nhóm không giao nhau để tránh cộng trùng (F03-WORK-02):
    // - Nhóm A (khẩn cấp cao): ≤ 3 ngày
    // - Nhóm B (khẩn cấp trung bình): > 3 ngày đến ≤ 7 ngày
    // Tổng số lô cận date ≤ 7 ngày = expiringWithin7DaysBatchesCount (= A + B)
    const urgentExpiringWithin3Days = expiringWithin3DaysBatchesCount
    const moderateExpiring3To7Days = Math.max(
      0,
      expiringWithin7DaysBatchesCount - expiringWithin3DaysBatchesCount
    )
    const totalExpiringWithin7Days = expiringWithin7DaysBatchesCount

    let expiryAlertText =
      `\n- Cảnh báo rủi ro hạn dùng lô hàng (QUY TẮC TẬP HỢP: Nhóm ≤3 ngày là tập con lồng trong nhóm ≤7 ngày; KHÔNG ĐƯỢC cộng dồn hai số đếm này để tạo thành tổng mới):` +
      `\n  + Tổng số lô hàng cận date cần lưu ý (trong vòng 7 ngày tới): ${totalExpiringWithin7Days} lô duy nhất. Trong đó gồm:` +
      `\n    * Nhóm khẩn cấp cao (hạn dùng ≤ 3 ngày tới): ${urgentExpiringWithin3Days} lô` +
      `\n    * Nhóm khẩn cấp trung bình (hạn dùng từ > 3 ngày đến ≤ 7 ngày tới): ${moderateExpiring3To7Days} lô` +
      `\n  + Lô hàng đã hết hạn (quá hạn sử dụng): ${expiredBatchesCount} lô`

    // Bổ sung chi tiết các lô hàng cận date nếu có dữ liệu danh sách lô
    if (inventoryData.expiringAndExpiredBatches && inventoryData.expiringAndExpiredBatches.length > 0) {
      const expiringList = inventoryData.expiringAndExpiredBatches
        .slice(0, 6)
        .map((b) => {
          const daysText =
            b.expiryAlert.daysRemaining !== null
              ? `còn ${b.expiryAlert.daysRemaining} ngày`
              : 'không rõ HSD'
          const expiryDateText = b.expiryDate
            ? new Date(b.expiryDate).toLocaleDateString('vi-VN')
            : 'N/A'
          const kgAvailable = (b.sellableAvailableGrams / 1000).toLocaleString('vi-VN')
          return `    * Lô ${b.code} (${b.productName}): HSD ${expiryDateText} (${daysText}) | Tồn bán được: ${kgAvailable} kg`
        })
        .join('\n')
      expiryAlertText += `\n  + Chi tiết các lô hàng sắp hết hạn cần ưu tiên xử lý:\n${expiringList}`
    }

    sections.push(
      `\n### 4. TÌNH TRẠNG TỒN KHO & QUẢN TRỊ LÔ HÀNG FEFO (FIRST EXPIRED, FIRST OUT — HẾT HẠN TRƯỚC, XUẤT TRƯỚC)` +
      `\n- Trạng thái quản lý FEFO: ${trackedProductsCount} / ${trackedProductsCount + untrackedProductsCount} sản phẩm đã bật theo dõi tồn kho theo lô.` +
      `\n- Tổng tồn kho vật lý: ${(totalPhysicalStockGrams / 1000).toLocaleString('vi-VN')} kg` +
      `\n- Tổng tồn khả dụng (bán được): ${(totalAvailableStockGrams / 1000).toLocaleString('vi-VN')} kg` +
      `\n- Đang giữ chỗ thanh toán (Reservation 10 phút): ${(totalReservedStockGrams / 1000).toLocaleString('vi-VN')} kg` +
      `\n- Số lô hàng ACTIVE hợp lệ xuất kho FEFO: ${eligibleActiveBatchesCount} lô` +
      expiryAlertText +
      `\n- Số mặt hàng chạm ngưỡng tồn kho thấp (Low stock): ${lowStockProductsCount} mặt hàng`
    )
  }

  // 3. Chỉ số Vận hành Thời gian thực (Dashboard KPIs)
  if (dashboardKpis) {
    sections.push(
      `\n### 5. CHỈ SỐ VẬN HÀNH THỜI GIAN THỰC (HÔM NAY)` +
      `\n- Số đơn hàng mới hôm nay: ${dashboardKpis.newOrdersToday} đơn` +
      `\n- Đơn hàng chờ xác nhận tiền / đối soát: ${dashboardKpis.awaitingPaymentConfirmation} đơn` +
      `\n- Đơn hàng cần xuất giao hôm nay: ${dashboardKpis.deliveriesToday} đơn` +
      `\n- Khiếu nại khách hàng đang mở: ${dashboardKpis.openComplaints} vụ`
    )
  }

  return sections.join('\n')
}
