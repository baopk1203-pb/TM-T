'use client'

import { useRef } from 'react'
import { Printer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatVietnamDate, formatDeliveryTimeSlot } from '@/lib/utils'

export interface PackingSlipData {
  orderCode: string
  shipmentCode: string
  deliveryDate?: string | null
  timeSlot?: string | null
  customerName: string
  companyName?: string | null
  taxCode?: string | null
  phone: string
  address: string
  driverName?: string | null
  driverPhone?: string | null
  licensePlate?: string | null
  vehicleType: string
  note?: string | null
  items: Array<{
    id: string
    productName: string
    packagingName: string
    orderedKg: number
    batchCode?: string | null
    isSample: boolean
  }>
}

interface PackingSlipModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  data: PackingSlipData | null
}

export function PackingSlipModal({ open, onOpenChange, data }: PackingSlipModalProps) {
  const printContentRef = useRef<HTMLDivElement>(null)

  if (!data) return null

  const handlePrint = () => {
    window.print()
  }

  const formatSlot = (slot?: string | null) => {
    return formatDeliveryTimeSlot(slot, 'short')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0 print:m-0 print:p-0 print:max-w-none print:max-h-none print:shadow-none print:border-none">
        {/* Header toolbar (Hidden during print) */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50 print:hidden">
          <DialogTitle className="text-sm font-bold text-slate-800">
            Xem trước Phiếu giao hàng & Biên bản đồng kiểm
          </DialogTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handlePrint}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs gap-1.5"
            >
              <Printer className="w-4 h-4" />
              In phiếu (Print)
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="text-xs"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Printable Document Sheet (Styled for standard A4 document) */}
        <div
          ref={printContentRef}
          className="p-8 text-slate-900 bg-white font-sans text-xs leading-normal print:p-0"
        >
          {/* Header */}
          <div className="flex justify-between items-start border-b-2 border-slate-800 pb-4 mb-4">
            <div>
              <h1 className="text-base font-extrabold tracking-wide uppercase text-emerald-800">
                HỆ THỐNG PHÂN PHỐI NÔNG SẢN B2B
              </h1>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Kho vận B2B Farm-to-Business — Chuyên sỉ trái cây chuẩn VietGAP / GlobalGAP
              </p>
              <p className="text-[11px] text-slate-600">
                Hotline hỗ trợ điều phối: 1900 888 999
              </p>
            </div>
            <div className="text-right">
              <h2 className="text-sm font-bold text-slate-800">PHIẾU GIAO HÀNG & ĐỒNG KIỂM</h2>
              <p className="text-[11px] font-mono font-bold text-indigo-700 mt-1">
                Mã đơn: {data.orderCode}
              </p>
              <p className="text-[11px] font-mono text-slate-500">
                Vận đơn: {data.shipmentCode}
              </p>
            </div>
          </div>

          {/* Grid thông tin giao nhận */}
          <div className="grid grid-cols-2 gap-4 border border-slate-300 rounded-lg p-3.5 mb-5 bg-slate-50/50 print:bg-transparent">
            {/* Cột 1: Người nhận */}
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                ĐƠN VỊ / KHÁCH HÀNG NHẬN
              </div>
              <p className="font-bold text-sm text-slate-900">
                {data.companyName ? `${data.companyName} (${data.customerName})` : data.customerName}
              </p>
              {data.taxCode && (
                <p className="text-[11px] text-slate-600">MST: {data.taxCode}</p>
              )}
              <p className="text-[11px] text-slate-700">SĐT: {data.phone}</p>
              <p className="text-[11px] text-slate-700">Địa chỉ: {data.address}</p>
            </div>

            {/* Cột 2: Chuyến giao & Phương tiện */}
            <div className="space-y-1 border-l border-slate-200 pl-4 print:border-slate-300">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                THÔNG TIN VẬN CHUYỂN
              </div>
              <p className="text-[11px]">
                <span className="font-semibold text-slate-700">Ngày giao:</span>{' '}
                {data.deliveryDate ? formatVietnamDate(data.deliveryDate) : 'Chưa định ngày'}
              </p>
              <p className="text-[11px]">
                <span className="font-semibold text-slate-700">Khung giờ:</span>{' '}
                {formatSlot(data.timeSlot)}
              </p>
              <p className="text-[11px]">
                <span className="font-semibold text-slate-700">Tài xế phụ trách:</span>{' '}
                {data.driverName || 'Chưa gán'} - SĐT: {data.driverPhone || 'N/A'}
              </p>
              <p className="text-[11px]">
                <span className="font-semibold text-slate-700">Biển số xe:</span>{' '}
                <span className="font-mono font-bold text-slate-900">{data.licensePlate || 'N/A'}</span>
              </p>
              <p className="text-[11px]">
                <span className="font-semibold text-slate-700">Dịch vụ bảo quản:</span>{' '}
                <span className="font-semibold text-emerald-700">
                  {data.vehicleType === 'COLD' ? 'Xe thùng lạnh chuyên dụng' : 'Xe tiêu chuẩn'}
                </span>
              </p>
            </div>
          </div>

          {/* Ghi chú nếu có */}
          {data.note && (
            <div className="mb-4 p-2.5 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-900 print:bg-transparent">
              <span className="font-bold">Ghi chú giao hàng:</span> {data.note}
            </div>
          )}

          {/* Bảng chi tiết mặt hàng đồng kiểm */}
          <div className="mb-6">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
              CHI TIẾT MẶT HÀNG & BIÊN BẢN CÂN ĐỒNG KIỂM TẠI ĐIỂM GIAO
            </h3>
            <table className="w-full border-collapse border border-slate-300 text-[11px]">
              <thead>
                <tr className="bg-slate-100 print:bg-slate-200">
                  <th className="border border-slate-300 p-2 text-center w-8 font-bold">STT</th>
                  <th className="border border-slate-300 p-2 text-left font-bold">Tên nông sản & Quy cách</th>
                  <th className="border border-slate-300 p-2 text-center w-24 font-bold">Mã lô thu hoạch</th>
                  <th className="border border-slate-300 p-2 text-right w-24 font-bold">Khối lượng đặt (kg)</th>
                  <th className="border border-slate-300 p-2 text-center w-32 font-bold bg-amber-50/50 print:bg-transparent">
                    Khối lượng cân thực tế (kg)*
                  </th>
                  <th className="border border-slate-300 p-2 text-center w-36 font-bold">
                    Tình trạng & Hao hụt
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item, index) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="border border-slate-300 p-2 text-center">{index + 1}</td>
                    <td className="border border-slate-300 p-2">
                      <span className="font-bold text-slate-900">{item.productName}</span>
                      <span className="text-slate-500 block text-[10px]">
                        {item.packagingName} {item.isSample && '(Hàng mẫu)'}
                      </span>
                    </td>
                    <td className="border border-slate-300 p-2 text-center font-mono">
                      {item.batchCode || '---'}
                    </td>
                    <td className="border border-slate-300 p-2 text-right font-medium">
                      {item.orderedKg.toLocaleString('vi-VN')}
                    </td>
                    <td className="border border-slate-300 p-2 text-center bg-amber-50/30 print:bg-transparent">
                      {/* Cột trống để cân thực tế và ghi tay */}
                      <div className="h-6 border-b border-dotted border-slate-400"></div>
                    </td>
                    <td className="border border-slate-300 p-2 text-center text-[10px] text-slate-500">
                      [ ] Đạt chuẩn [ ] Dập nát
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-slate-500 italic mt-1.5">
              * Khối lượng thực tế được cân lại trực tiếp có sự chứng kiến của tài xế và đại diện nhận hàng. Tỷ lệ hao hụt tự nhiên cho phép theo quy chuẩn: tối đa 3%.
            </p>
          </div>

          {/* Điều khoản & Chữ ký */}
          <div className="border-t border-slate-300 pt-4 mt-8">
            <p className="text-[10px] text-slate-600 mb-6 text-center italic">
              &quot;Bên nhận đã đồng kiểm đủ số lượng, cân khối lượng thực tế và kiểm tra chất lượng quy cách bao bì trước khi ký nhận.&quot;
            </p>
            <div className="grid grid-cols-2 text-center">
              <div>
                <p className="font-bold text-xs text-slate-800 uppercase">ĐẠI DIỆN BÊN NHẬN HÀNG</p>
                <p className="text-[10px] text-slate-500 italic">(Ký, ghi rõ họ tên và đóng dấu nếu có)</p>
                <div className="h-20"></div>
                <p className="text-xs font-medium text-slate-700">....................................................</p>
              </div>
              <div>
                <p className="font-bold text-xs text-slate-800 uppercase">TÀI XẾ GIAO HÀNG</p>
                <p className="text-[10px] text-slate-500 italic">(Ký và ghi rõ họ tên)</p>
                <div className="h-20"></div>
                <p className="text-xs font-medium text-slate-700">
                  {data.driverName ? data.driverName : '....................................................'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
