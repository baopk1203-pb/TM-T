/**
 * VietQR / EMVCo Specification Generator & Parser
 * Tuân thủ tiêu chuẩn VietQR theo Quyết định 1753/QĐ-NHNN và chuẩn EMVCo Merchant-Presented Mode.
 */

export interface VietQRParams {
  bankBin: string        // 6 chữ số BIN ngân hàng (ví dụ: 970422 - MBBank)
  accountNo: string      // Số tài khoản ngân hàng thụ hưởng (tối đa 24 ký tự)
  amount: number         // Số tiền chuyển khoản (VNĐ, số nguyên dương)
  orderCode: string      // Mã đơn hàng (truyền vào tag 62.08)
  accountName?: string   // Tên chủ tài khoản (tùy chọn)
}

/**
 * Hàm hỗ trợ định dạng TLV (Tag-Length-Value)
 */
export function formatTLV(tag: string, value: string): string {
  const lengthStr = value.length.toString().padStart(2, '0')
  return `${tag}${lengthStr}${value}`
}

/**
 * Tính toán checksum CRC-16/CCITT-FALSE (Polynomial 0x1021, Initial 0xFFFF, XorOut 0x0000)
 */
export function computeCRC16CCITT(data: string): string {
  let crc = 0xffff
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff
      } else {
        crc = (crc << 1) & 0xffff
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/**
 * Tạo chuỗi EMVCo VietQR hợp lệ cho thanh toán chuyển khoản liên ngân hàng 24/7 (Napas 247)
 */
export function buildVietQREmvcoPayload(params: VietQRParams): string {
  const bankBin = params.bankBin ? params.bankBin.trim() : ''
  const accountNo = params.accountNo ? params.accountNo.trim() : ''
  const orderCode = params.orderCode ? params.orderCode.trim() : ''
  const amount = Math.round(params.amount)

  if (!/^\d{6}$/.test(bankBin)) {
    throw new Error('Mã định danh ngân hàng (Bank BIN) phải gồm đúng 6 chữ số')
  }

  if (!accountNo || accountNo.length < 4 || accountNo.length > 24) {
    throw new Error('Số tài khoản thụ hưởng không hợp lệ (độ dài 4-24 ký tự)')
  }

  if (amount <= 0 || !Number.isFinite(amount)) {
    throw new Error('Số tiền thanh toán phải lớn hơn 0')
  }

  // Tag 00: Payload Format Indicator (cố định "01")
  const tag00 = formatTLV('00', '01')

  // Tag 01: Point of Initiation Method ("12": Dynamic QR có số tiền, "11": Static QR)
  const tag01 = formatTLV('01', '12')

  // Tag 38: Merchant Account Information (VietQR NAPAS)
  // Subtag 00: GUID của Napas ("A000000727")
  const subTag00 = formatTLV('00', 'A000000727')
  // Subtag 01: Tổ chức thụ hưởng (gồm sub-sub-tag 00: Bank BIN, 01: Account No)
  const subSubTag00 = formatTLV('00', bankBin)
  const subSubTag01 = formatTLV('01', accountNo)
  const subTag01 = formatTLV('01', `${subSubTag00}${subSubTag01}`)
  // Subtag 02: Dịch vụ chuyển tiền nhanh liên ngân hàng Napas 247 ("QRIBFTTA")
  const subTag02 = formatTLV('02', 'QRIBFTTA')
  const tag38Value = `${subTag00}${subTag01}${subTag02}`
  const tag38 = formatTLV('38', tag38Value)

  // Tag 53: Transaction Currency ("704" - VNĐ theo ISO 4217)
  const tag53 = formatTLV('53', '704')

  // Tag 54: Transaction Amount
  const tag54 = formatTLV('54', amount.toString())

  // Tag 58: Country Code ("VN" theo ISO 3166-1 alpha-2)
  const tag58 = formatTLV('58', 'VN')

  // Tag 62: Additional Data Field (Subtag 08: Purpose of Transaction / Nội dung chuyển khoản)
  // Chuẩn hóa nội dung chuyển khoản: loại bỏ ký tự đặc biệt, tối đa 25 ký tự
  const cleanOrderCode = orderCode.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 25)
  const subTag08 = formatTLV('08', cleanOrderCode)
  const tag62 = formatTLV('62', subTag08)

  // Ghép toàn bộ chuỗi trước khi tính CRC (gồm Tag 63 và Length 04)
  const rawDataWithoutCRC = `${tag00}${tag01}${tag38}${tag53}${tag54}${tag58}${tag62}6304`

  // Tag 63: CRC-16 Checksum
  const crc = computeCRC16CCITT(rawDataWithoutCRC)

  return `${rawDataWithoutCRC}${crc}`
}

/**
 * Bộ giải mã độc lập để kiểm chứng tính toàn vẹn của chuỗi EMVCo VietQR
 */
export function parseVietQREmvcoPayload(payload: string): {
  isValid: boolean
  crcValid: boolean
  tags: Record<string, string>
  subTags38?: Record<string, string>
  subSubTags01?: Record<string, string>
  subTags62?: Record<string, string>
  error?: string
} {
  try {
    if (!payload || payload.length < 24) {
      return { isValid: false, crcValid: false, tags: {}, error: 'Payload quá ngắn' }
    }

    const payloadWithoutCRC = payload.slice(0, -4)
    const expectedCRC = payload.slice(-4).toUpperCase()
    const calculatedCRC = computeCRC16CCITT(payloadWithoutCRC)
    const crcValid = expectedCRC === calculatedCRC

    const tags: Record<string, string> = {}
    let i = 0
    while (i < payload.length - 4) {
      const tagId = payload.slice(i, i + 2)
      const len = parseInt(payload.slice(i + 2, i + 4), 10)
      if (isNaN(len) || i + 4 + len > payload.length - 4) break
      const val = payload.slice(i + 4, i + 4 + len)
      tags[tagId] = val
      i += 4 + len
    }

    // Parse Tag 38
    const subTags38: Record<string, string> = {}
    const subSubTags01: Record<string, string> = {}
    if (tags['38']) {
      let j = 0
      const val38 = tags['38']
      while (j < val38.length) {
        const subId = val38.slice(j, j + 2)
        const subLen = parseInt(val38.slice(j + 2, j + 4), 10)
        if (isNaN(subLen) || j + 4 + subLen > val38.length) break
        const subVal = val38.slice(j + 4, j + 4 + subLen)
        subTags38[subId] = subVal
        j += 4 + subLen
      }

      if (subTags38['01']) {
        let k = 0
        const val01 = subTags38['01']
        while (k < val01.length) {
          const sId = val01.slice(k, k + 2)
          const sLen = parseInt(val01.slice(k + 2, k + 4), 10)
          if (isNaN(sLen) || k + 4 + sLen > val01.length) break
          const sVal = val01.slice(k + 4, k + 4 + sLen)
          subSubTags01[sId] = sVal
          k += 4 + sLen
        }
      }
    }

    // Parse Tag 62
    const subTags62: Record<string, string> = {}
    if (tags['62']) {
      let m = 0
      const val62 = tags['62']
      while (m < val62.length) {
        const sId = val62.slice(m, m + 2)
        const sLen = parseInt(val62.slice(m + 2, m + 4), 10)
        if (isNaN(sLen) || m + 4 + sLen > val62.length) break
        const sVal = val62.slice(m + 4, m + 4 + sLen)
        subTags62[sId] = sVal
        m += 4 + sLen
      }
    }

    const isValid =
      crcValid &&
      tags['00'] === '01' &&
      tags['53'] === '704' &&
      tags['58'] === 'VN' &&
      subTags38['00'] === 'A000000727' &&
      subTags38['02'] === 'QRIBFTTA'

    return {
      isValid,
      crcValid,
      tags,
      subTags38,
      subSubTags01,
      subTags62,
    }
  } catch (err: unknown) {
    return {
      isValid: false,
      crcValid: false,
      tags: {},
      error: err instanceof Error ? err.message : 'Lỗi phân tích cú pháp',
    }
  }
}
