/**
 * Certificate Domain Utility (WEB-CERT-04)
 * Xử lý kiểm tra tính hiệu lực và hiển thị chứng nhận nông sản theo thời gian thực.
 */

export interface CertificateStatus {
  isExpired: boolean
  remainingDays: number
}

/**
 * Kiểm tra trạng thái hiệu lực của một chứng nhận
 */
export function checkCertificateStatus(
  cert: { expiresAt: Date | string },
  referenceDate: Date = new Date()
): CertificateStatus {
  const expiresAtMs = new Date(cert.expiresAt).getTime()
  const refMs = referenceDate.getTime()
  const diffMs = expiresAtMs - refMs
  const isExpired = diffMs <= 0
  const remainingDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

  return { isExpired, remainingDays }
}

/**
 * Lọc danh sách chứng nhận còn hiệu lực
 */
export function filterActiveCertificates<T extends { expiresAt: Date | string }>(
  certs: T[],
  referenceDate: Date = new Date()
): T[] {
  const refMs = referenceDate.getTime()
  return certs.filter((c) => new Date(c.expiresAt).getTime() > refMs)
}

/**
 * Định dạng nhãn tóm tắt tiêu chuẩn nông nghiệp cho Storefront
 * - Nếu có chứng nhận còn hiệu lực: "VIETGAP, GLOBALGAP"
 * - Nếu không có chứng nhận hoặc tất cả đã hết hạn: "Chưa có chứng nhận còn hiệu lực"
 */
export function formatActiveCertificatesSummary(
  certs: { type: string; expiresAt: Date | string }[],
  referenceDate: Date = new Date()
): string {
  const active = filterActiveCertificates(certs, referenceDate)
  if (active.length === 0) {
    return 'Chưa có chứng nhận còn hiệu lực'
  }
  return active.map((c) => c.type).join(', ')
}
