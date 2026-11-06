import { describe, it, expect } from 'vitest'
import {
  checkCertificateStatus,
  filterActiveCertificates,
  formatActiveCertificatesSummary,
} from '@/lib/certificate'

describe('WEB-CERT-04: Certificate Expiration & Validity Logic', () => {
  const referenceDate = new Date('2026-10-18T00:00:00Z')

  const validCert1 = {
    id: 'cert-1',
    type: 'VIETGAP',
    code: 'VIETGAP-TG-2024-001',
    issuedAt: new Date('2024-01-15T00:00:00Z'),
    expiresAt: new Date('2027-01-15T00:00:00Z'), // Còn hạn
  }

  const validCert2 = {
    id: 'cert-2',
    type: 'GLOBALGAP',
    code: 'GG-VN-2024-987',
    issuedAt: new Date('2024-03-01T00:00:00Z'),
    expiresAt: new Date('2027-03-01T00:00:00Z'), // Còn hạn
  }

  const expiredCert = {
    id: 'cert-3',
    type: 'VIETGAP',
    code: 'VIETGAP-BT-2023-888',
    issuedAt: new Date('2023-06-20T00:00:00Z'),
    expiresAt: new Date('2026-06-20T00:00:00Z'), // Đã hết hạn vào tháng 06/2026
  }

  const expiringYesterday = {
    id: 'cert-4',
    type: 'ORGANIC',
    code: 'ORG-2025-001',
    issuedAt: new Date('2025-10-17T00:00:00Z'),
    expiresAt: new Date('2026-10-17T23:59:59Z'), // Hết hạn ngày hôm qua
  }

  const expiringTomorrow = {
    id: 'cert-5',
    type: 'ORGANIC',
    code: 'ORG-2025-002',
    issuedAt: new Date('2025-10-19T00:00:00Z'),
    expiresAt: new Date('2026-10-19T23:59:59Z'), // Còn hạn ngày mai
  }

  it('1. checkCertificateStatus() phân biệt chính xác chứng nhận còn hiệu lực và đã hết hạn', () => {
    const validStatus = checkCertificateStatus(validCert1, referenceDate)
    expect(validStatus.isExpired).toBe(false)
    expect(validStatus.remainingDays).toBeGreaterThan(0)

    const expiredStatus = checkCertificateStatus(expiredCert, referenceDate)
    expect(expiredStatus.isExpired).toBe(true)
    expect(expiredStatus.remainingDays).toBeLessThanOrEqual(0)
  })

  it('2. Kiểm tra biên: Hết hạn hôm qua vs còn hạn ngày mai', () => {
    const yesterdayStatus = checkCertificateStatus(expiringYesterday, referenceDate)
    expect(yesterdayStatus.isExpired).toBe(true)

    const tomorrowStatus = checkCertificateStatus(expiringTomorrow, referenceDate)
    expect(tomorrowStatus.isExpired).toBe(false)
  })

  it('3. filterActiveCertificates() loại bỏ hoàn toàn các chứng nhận hết hạn', () => {
    const certList = [validCert1, expiredCert, validCert2, expiringYesterday]
    const active = filterActiveCertificates(certList, referenceDate)

    expect(active.length).toBe(2)
    expect(active.map((c) => c.id)).toEqual(['cert-1', 'cert-2'])
  })

  it('4. formatActiveCertificatesSummary() hiển thị đúng tiêu chuẩn còn hiệu lực', () => {
    // Vườn có 2 chứng nhận còn hạn
    const summary = formatActiveCertificatesSummary([validCert1, validCert2], referenceDate)
    expect(summary).toBe('VIETGAP, GLOBALGAP')

    // Vườn có chứng chỉ lẫn lộn (Farm Bến Tre: chỉ có chứng chỉ đã hết hạn)
    const benTreSummary = formatActiveCertificatesSummary([expiredCert], referenceDate)
    expect(benTreSummary).toBe('Chưa có chứng nhận còn hiệu lực')

    // Vườn không có chứng chỉ nào
    const emptySummary = formatActiveCertificatesSummary([], referenceDate)
    expect(emptySummary).toBe('Chưa có chứng nhận còn hiệu lực')
  })

  it('5. Không hiển thị "Đang tái cấp" trừ khi có dữ liệu xác nhận', () => {
    const benTreSummary = formatActiveCertificatesSummary([expiredCert], referenceDate)
    expect(benTreSummary).not.toContain('Đang tái cấp')
    expect(benTreSummary).toBe('Chưa có chứng nhận còn hiệu lực')
  })

  it('6. WEB-POST-02: Nhà vườn chỉ có chứng chỉ hết hạn (Bến Tre): tổng chứng nhận > 0 nhưng active = 0', () => {
    const benTreCerts = [expiredCert]
    expect(benTreCerts.length).toBe(1) // Hồ sơ nhà vườn & tab có 1 chứng nhận để lưu lịch sử

    const activeCerts = filterActiveCertificates(benTreCerts, referenceDate)
    expect(activeCerts.length).toBe(0) // Nhưng không có chứng nhận nào còn hiệu lực

    const summary = formatActiveCertificatesSummary(benTreCerts, referenceDate)
    expect(summary).toBe('Chưa có chứng nhận còn hiệu lực')
  })

  it('7. WEB-POST-02: Nhà vườn hoàn toàn không có chứng chỉ: cả tổng và active đều bằng 0', () => {
    const emptyCerts: typeof validCert1[] = []
    expect(emptyCerts.length).toBe(0)

    const activeCerts = filterActiveCertificates(emptyCerts, referenceDate)
    expect(activeCerts.length).toBe(0)

    const summary = formatActiveCertificatesSummary(emptyCerts, referenceDate)
    expect(summary).toBe('Chưa có chứng nhận còn hiệu lực')
  })
})
