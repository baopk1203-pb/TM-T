'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  CheckCircle2,
  Clock,
  QrCode,
  Copy,
  ArrowRight,
  Package,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatVND } from '@/lib/money'
import { toast } from 'sonner'

interface PaymentViewProps {
  order: {
    id: string
    code: string
    status: string
    paymentOption: string
    subtotal: number
    shippingFee: number
    total: number
    depositAmount: number
    paymentDueAt: Date | null
    createdAt: Date
    items: {
      id: string
      productName: string
      packagingName: string
      quantity: number
      orderedGrams: number
      unitPricePerKg: number
      lineTotal: number
      isSample: boolean
    }[]
  }
  vietQrUrl: string
  bankInfo: {
    bankBin: string
    accountNo: string
    accountName: string
  }
}

export function PaymentView({ order, vietQrUrl, bankInfo }: PaymentViewProps) {
  const [timeLeft, setTimeLeft] = useState('')

  // Số tiền cần chuyển ngay: nếu cọc 30% thì depositAmount, nếu FULL thì total
  const amountToPay =
    order.paymentOption === 'DEPOSIT_30' ? order.depositAmount : order.total

  // Đếm ngược 24h
  useEffect(() => {
    if (!order.paymentDueAt) return

    const targetTime = new Date(order.paymentDueAt).getTime()

    const updateTimer = () => {
      const now = Date.now()
      const diff = targetTime - now

      if (diff <= 0) {
        setTimeLeft('Đã hết hạn thanh toán')
        return
      }

      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      const seconds = Math.floor((diff % (1000 * 60)) / 1000)

      setTimeLeft(
        `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      )
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)
    return () => clearInterval(interval)
  }, [order.paymentDueAt])

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast.success(`Đã sao chép ${label}`)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Banner thành công */}
      <div className="bg-emerald-600 text-white rounded-3xl p-6 sm:p-8 text-center shadow-sm relative overflow-hidden">
        <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-xs">
          <CheckCircle2 className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
          Đặt Hàng Thành Công!
        </h1>
        <p className="text-emerald-100 text-sm mt-1 max-w-md mx-auto">
          Mã đơn hàng: <strong className="text-white text-base tracking-wider">{order.code}</strong>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
        {/* Cột trái: Mã VietQR & Đồng hồ đếm ngược (6 cols) */}
        <div className="md:col-span-6 space-y-5">
          <Card className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
            <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
              <span className="font-bold text-xs uppercase tracking-wider flex items-center gap-1.5">
                <QrCode className="w-4 h-4 text-emerald-400" /> Quét Mã VietQR Chuyển Khoản
              </span>
              <Badge className="bg-emerald-600 text-white text-[10px]">Tự động khớp nội dung</Badge>
            </div>

            <CardContent className="p-6 text-center space-y-5">
              {/* Ảnh VietQR động */}
              <div className="w-64 h-64 mx-auto bg-white p-3 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={vietQrUrl}
                  alt={`VietQR-${order.code}`}
                  className="w-full h-full object-contain"
                />
              </div>

              {/* Đồng hồ đếm ngược 24h */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-center gap-2 text-xs text-amber-900 font-semibold">
                <Clock className="w-4 h-4 text-amber-600" />
                <span>Hạn chót thanh toán: </span>
                <span className="font-mono text-sm text-amber-950 font-extrabold">{timeLeft || '24:00:00'}</span>
              </div>

              {/* Thông tin số tài khoản chi tiết */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-left text-xs space-y-2.5">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Ngân hàng thụ hưởng:</span>
                  <strong className="text-slate-900">MBBank (Ngân hàng Quân Đội)</strong>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Số tài khoản:</span>
                  <div className="flex items-center gap-1.5">
                    <strong className="font-mono text-sm text-slate-900">{bankInfo.accountNo}</strong>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(bankInfo.accountNo, 'Số tài khoản')}
                      className="text-slate-400 hover:text-emerald-700 p-1"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Chủ tài khoản:</span>
                  <strong className="text-slate-900">{bankInfo.accountName}</strong>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Số tiền cần chuyển:</span>
                  <div className="flex items-center gap-1.5">
                    <strong className="text-base text-emerald-700 font-extrabold">{formatVND(amountToPay)}</strong>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(String(amountToPay), 'Số tiền')}
                      className="text-slate-400 hover:text-emerald-700 p-1"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-1 border-t border-slate-200">
                  <span className="text-slate-500">Nội dung chuyển khoản:</span>
                  <div className="flex items-center gap-1.5">
                    <strong className="font-mono text-sm text-emerald-800 bg-emerald-100/70 px-2 py-0.5 rounded-md">
                      {order.code}
                    </strong>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(order.code, 'Nội dung chuyển khoản')}
                      className="text-slate-400 hover:text-emerald-700 p-1"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Cột phải: Chi tiết đơn hàng & Nút hành động (6 cols) */}
        <div className="md:col-span-6 space-y-5">
          <Card className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <span className="font-bold text-xs uppercase tracking-wider text-slate-900 flex items-center gap-2">
                <Package className="w-4 h-4 text-emerald-600" /> Danh Sách Hàng Đặt Sỉ
              </span>
              <Badge className="bg-slate-800 text-white text-[10px]">
                {order.paymentOption === 'DEPOSIT_30' ? 'Cọc 30%' : '100%'}
              </Badge>
            </div>

            <CardContent className="p-5 space-y-4">
              <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
                {order.items.map((item) => (
                  <div key={item.id} className="py-2.5 flex justify-between items-center text-xs">
                    <div>
                      <div className="font-bold text-slate-900">{item.productName}</div>
                      <div className="text-slate-500 text-[11px]">
                        {item.packagingName} × {item.quantity}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-extrabold text-slate-900">{formatVND(item.lineTotal)}</div>
                      <div className="text-[10px] text-slate-400">
                        {item.isSample ? 'Gói mẫu' : `${formatVND(item.unitPricePerKg)}/kg`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Tóm tắt tổng tiền */}
              <div className="pt-3 border-t border-slate-200 space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Tiền hàng:</span>
                  <span className="font-bold text-slate-900">{formatVND(order.subtotal)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Phí ship:</span>
                  <span className="text-emerald-700 font-medium">0 đ (Tạm tính)</span>
                </div>
                <div className="flex justify-between text-slate-900 font-extrabold text-sm pt-2 border-t border-slate-100">
                  <span>Tổng giá trị đơn hàng:</span>
                  <span>{formatVND(order.total)}</span>
                </div>
                <div className="flex justify-between text-emerald-800 font-black text-base pt-1">
                  <span>Số tiền cần chuyển ngay:</span>
                  <span>{formatVND(amountToPay)}</span>
                </div>
              </div>

              {/* Hành động */}
              <div className="pt-4 space-y-2.5">
                <Link href={`/tai-khoan/don-hang/${order.code}`}>
                  <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 shadow-sm">
                    Xem chi tiết đơn hàng của tôi <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>

                <Link href="/san-pham" className="block text-center">
                  <Button variant="outline" size="sm" className="w-full text-xs text-slate-600">
                    Tiếp tục mua hàng
                  </Button>
                </Link>
              </div>

              {/* Lưu ý thanh toán */}
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 text-[11px] leading-relaxed space-y-1">
                <strong>💡 Lưu ý quan trọng:</strong>
                <p>
                  Sau khi bạn chuyển khoản thành công, hệ thống ban quản trị sẽ đối soát và xác nhận chuyển trạng thái đơn hàng sang <strong>Đang xử lý (PROCESSING)</strong> trong vòng 15-30 phút.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
