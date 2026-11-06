'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PaymentOption, TimeSlot } from '@prisma/client'
import {
  createRecurringSchedule,
  createRecurringFromOrder,
  updateRecurringSchedule,
  toggleRecurringSchedule,
  deleteRecurringSchedule,
  confirmRecurringDraft,
} from '@/actions/recurring'
import { quoteCart } from '@/actions/cart'
import { PriceCartResult } from '@/lib/domain/pricing'
import { computeDepositAmount } from '@/lib/domain/settlement'
import { formatVND, gramsToKgText } from '@/lib/money'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  CalendarDays,
  Plus,
  Trash2,
  Edit3,
  Power,
  CheckCircle2,
  Clock,
  MapPin,
  FileCheck2,
  Sparkles,
  ArrowRight,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'

export interface CatalogPackagingItem {
  id: string
  name: string
  weightGrams: number
}

export interface CatalogProductItem {
  id: string
  name: string
  moqGrams: number
  leadTimeDays: number
  packagings: CatalogPackagingItem[]
}

export interface CustomerAddressItem {
  id: string
  label: string
  recipient: string
  phone: string
  street: string
  ward: string
  district: string
  province: string
  isDefault: boolean
}

export interface RecurringScheduleClientItem {
  id: string
  name: string
  weekdays: number[]
  timeSlot: TimeSlot
  addressId: string
  paymentOption: PaymentOption
  isActive: boolean
  createdAt: string
  upcomingDates: string[]
  items: Array<{
    id: string
    productId: string
    packagingId: string
    quantity: number
    productName: string
    packagingName: string
    weightGrams: number
  }>
  ordersCount: number
}

export interface DraftOrderClientItem {
  id: string
  code: string
  scheduleId: string | null
  scheduleName: string | null
  deliveryDate: string | null
  timeSlot: TimeSlot | null
  paymentOption: PaymentOption
  subtotal: number
  shippingFee: number
  total: number
  depositAmount: number
  customerNote: string | null
  items: Array<{
    id: string
    productId: string
    packagingId: string
    productName: string
    packagingName: string
    quantity: number
    orderedGrams: number
    unitPricePerKg: number
    lineTotal: number
  }>
}

export interface CompletedOrderSummaryItem {
  id: string
  code: string
  deliveredAt: string | null
  timeSlot: TimeSlot | null
  paymentOption: PaymentOption
  addressId: string | null
  total: number
  items: Array<{
    productId: string
    packagingId: string
    productName: string
    packagingName: string
    quantity: number
    orderedGrams: number
  }>
}

interface RecurringClientProps {
  schedules: RecurringScheduleClientItem[]
  draftOrders: DraftOrderClientItem[]
  completedOrders: CompletedOrderSummaryItem[]
  products: CatalogProductItem[]
  addresses: CustomerAddressItem[]
  initialFromOrderCode?: string
}

const WEEKDAY_OPTIONS = [
  { value: 1, short: 'T2', label: 'Thứ Hai' },
  { value: 2, short: 'T3', label: 'Thứ Ba' },
  { value: 3, short: 'T4', label: 'Thứ Tư' },
  { value: 4, short: 'T5', label: 'Thứ Năm' },
  { value: 5, short: 'T6', label: 'Thứ Sáu' },
  { value: 6, short: 'T7', label: 'Thứ Bảy' },
  { value: 7, short: 'CN', label: 'Chủ Nhật' },
]

const TIME_SLOT_LABELS: Record<TimeSlot, string> = {
  [TimeSlot.MORNING]: 'Sáng (07:00 - 11:30)',
  [TimeSlot.AFTERNOON]: 'Chiều (13:30 - 17:30)',
  [TimeSlot.EVENING]: 'Tối (18:00 - 21:00)',
}

export function formatWeekdaysText(weekdays: number[]): string {
  const sorted = [...weekdays].sort((a, b) => a - b)
  return sorted
    .map((w) => WEEKDAY_OPTIONS.find((opt) => opt.value === w)?.label || `Thứ ${w}`)
    .join(', ')
}

export function RecurringClient({
  schedules,
  draftOrders,
  completedOrders,
  products,
  addresses,
  initialFromOrderCode,
}: RecurringClientProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Modal Tạo / Sửa lịch thủ công
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formWeekdays, setFormWeekdays] = useState<number[]>([1, 4])
  const [formTimeSlot, setFormTimeSlot] = useState<TimeSlot>(TimeSlot.MORNING)
  const [formAddressId, setFormAddressId] = useState<string>(
    addresses.find((a) => a.isDefault)?.id || addresses[0]?.id || ''
  )
  const [formPaymentOption, setFormPaymentOption] = useState<PaymentOption>(
    PaymentOption.DEPOSIT_30
  )
  const [formItems, setFormItems] = useState<
    Array<{ productId: string; packagingId: string; quantity: number }>
  >([])
  const [schedulePreviewQuote, setSchedulePreviewQuote] = useState<PriceCartResult | null>(null)
  const [isQuotingSchedule, setIsQuotingSchedule] = useState(false)

  // Modal Tạo nhanh từ đơn COMPLETED (khởi tạo sẵn nếu có ?fromOrder=DH-...)
  const initialMatchedOrder = initialFromOrderCode
    ? completedOrders.find((o) => o.code === initialFromOrderCode) ?? null
    : null
  const defaultAddrId = addresses.find((a) => a.isDefault)?.id || addresses[0]?.id || ''

  const [fromOrderModalOpen, setFromOrderModalOpen] = useState(Boolean(initialMatchedOrder))
  const [selectedCompletedOrder, setSelectedCompletedOrder] =
    useState<CompletedOrderSummaryItem | null>(initialMatchedOrder)
  const [fromOrderName, setFromOrderName] = useState(
    initialMatchedOrder ? `Lịch định kỳ từ đơn ${initialMatchedOrder.code}` : ''
  )
  const [fromOrderWeekdays, setFromOrderWeekdays] = useState<number[]>([1, 4])
  const [fromOrderTimeSlot, setFromOrderTimeSlot] = useState<TimeSlot>(
    initialMatchedOrder?.timeSlot ?? TimeSlot.MORNING
  )
  const [fromOrderAddressId, setFromOrderAddressId] = useState<string>(
    initialMatchedOrder?.addressId && addresses.some((a) => a.id === initialMatchedOrder.addressId)
      ? initialMatchedOrder.addressId
      : defaultAddrId
  )
  const [fromOrderPaymentOption, setFromOrderPaymentOption] = useState<PaymentOption>(
    initialMatchedOrder?.paymentOption ?? PaymentOption.DEPOSIT_30
  )

  // Modal Xác nhận đơn nháp (DRAFT -> PENDING_CONFIRMATION)
  const [confirmDraftModalOpen, setConfirmDraftModalOpen] = useState(false)
  const [activeDraft, setActiveDraft] = useState<DraftOrderClientItem | null>(null)
  const [draftLines, setDraftLines] = useState<
    Array<{
      productId: string
      packagingId: string
      productName: string
      packagingName: string
      quantity: number
    }>
  >([])
  const [draftPaymentOption, setDraftPaymentOption] = useState<PaymentOption>(
    PaymentOption.DEPOSIT_30
  )
  const [draftNote, setDraftNote] = useState('')
  const [draftQuote, setDraftQuote] = useState<PriceCartResult | null>(null)
  const [isQuotingDraft, setIsQuotingDraft] = useState(false)

  // Tính báo giá preview cho form tạo/sửa lịch định kỳ
  useEffect(() => {
    if (!scheduleModalOpen || formItems.length === 0) {
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      if (!cancelled) setIsQuotingSchedule(true)
      try {
        const res = await quoteCart(
          formItems.filter((i) => i.productId && i.packagingId && i.quantity > 0)
        )
        if (!cancelled) {
          setSchedulePreviewQuote(res.quote)
        }
      } catch {
        if (!cancelled) setSchedulePreviewQuote(null)
      } finally {
        if (!cancelled) setIsQuotingSchedule(false)
      }
    }, 200)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [scheduleModalOpen, formItems])

  // Tính báo giá preview khi khách điều chỉnh số lượng đơn nháp
  useEffect(() => {
    if (!confirmDraftModalOpen || draftLines.length === 0) {
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      if (!cancelled) setIsQuotingDraft(true)
      try {
        const res = await quoteCart(
          draftLines
            .filter((i) => i.quantity > 0)
            .map((i) => ({
              productId: i.productId,
              packagingId: i.packagingId,
              quantity: i.quantity,
            }))
        )
        if (!cancelled) {
          setDraftQuote(res.quote)
        }
      } catch {
        if (!cancelled) setDraftQuote(null)
      } finally {
        if (!cancelled) setIsQuotingDraft(false)
      }
    }, 200)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [confirmDraftModalOpen, draftLines])

  const openCreateScheduleModal = () => {
    const defaultProd = products[0]
    const defaultPkg = defaultProd?.packagings[0]
    setEditingScheduleId(null)
    setFormName('Lịch giao sỉ hàng tuần')
    setFormWeekdays([1, 4])
    setFormTimeSlot(TimeSlot.MORNING)
    setFormAddressId(addresses.find((a) => a.isDefault)?.id || addresses[0]?.id || '')
    setFormPaymentOption(PaymentOption.DEPOSIT_30)
    setFormItems(
      defaultProd && defaultPkg
        ? [
            {
              productId: defaultProd.id,
              packagingId: defaultPkg.id,
              quantity: Math.max(1, Math.ceil(defaultProd.moqGrams / defaultPkg.weightGrams)),
            },
          ]
        : []
    )
    setScheduleModalOpen(true)
  }

  const openEditScheduleModal = (sched: RecurringScheduleClientItem) => {
    setEditingScheduleId(sched.id)
    setFormName(sched.name)
    setFormWeekdays(sched.weekdays)
    setFormTimeSlot(sched.timeSlot)
    setFormAddressId(
      addresses.some((a) => a.id === sched.addressId)
        ? sched.addressId
        : addresses.find((a) => a.isDefault)?.id || addresses[0]?.id || ''
    )
    setFormPaymentOption(sched.paymentOption)
    setFormItems(
      sched.items.map((i) => ({
        productId: i.productId,
        packagingId: i.packagingId,
        quantity: i.quantity,
      }))
    )
    setScheduleModalOpen(true)
  }

  const openCreateFromOrderModal = (order: CompletedOrderSummaryItem) => {
    setSelectedCompletedOrder(order)
    setFromOrderName(`Lịch định kỳ từ đơn ${order.code}`)
    setFromOrderWeekdays([1, 4])
    setFromOrderTimeSlot(order.timeSlot ?? TimeSlot.MORNING)
    const fallbackAddr = addresses.find((a) => a.isDefault)?.id || addresses[0]?.id || ''
    setFromOrderAddressId(
      order.addressId && addresses.some((a) => a.id === order.addressId)
        ? order.addressId
        : fallbackAddr
    )
    setFromOrderPaymentOption(order.paymentOption)
    setFromOrderModalOpen(true)
  }

  const openDraftConfirmationModal = (draft: DraftOrderClientItem) => {
    setActiveDraft(draft)
    setDraftLines(
      draft.items.map((item) => ({
        productId: item.productId,
        packagingId: item.packagingId,
        productName: item.productName,
        packagingName: item.packagingName,
        quantity: item.quantity,
      }))
    )
    setDraftPaymentOption(draft.paymentOption)
    setDraftNote(draft.customerNote ?? '')
    setConfirmDraftModalOpen(true)
  }

  const toggleWeekdayInList = (
    day: number,
    list: number[],
    setter: (next: number[]) => void
  ) => {
    if (list.includes(day)) {
      setter(list.filter((d) => d !== day))
    } else {
      setter([...list, day].sort((a, b) => a - b))
    }
  }

  const handleAddScheduleLine = () => {
    const prod = products[0]
    const pkg = prod?.packagings[0]
    if (!prod || !pkg) return
    setFormItems((prev) => [
      ...prev,
      {
        productId: prod.id,
        packagingId: pkg.id,
        quantity: Math.max(1, Math.ceil(prod.moqGrams / pkg.weightGrams)),
      },
    ])
  }

  const handleSaveSchedule = async () => {
    if (!formName.trim()) {
      toast.error('Vui lòng nhập tên lịch định kỳ')
      return
    }
    if (formWeekdays.length === 0) {
      toast.error('Vui lòng chọn ít nhất 1 ngày giao hàng trong tuần')
      return
    }
    if (!formAddressId) {
      toast.error('Vui lòng chọn địa chỉ nhận hàng')
      return
    }
    if (formItems.length === 0) {
      toast.error('Vui lòng thêm ít nhất 1 sản phẩm vào lịch định kỳ')
      return
    }

    setIsSubmitting(true)
    try {
      const payload = {
        name: formName.trim(),
        weekdays: formWeekdays,
        timeSlot: formTimeSlot,
        addressId: formAddressId,
        paymentOption: formPaymentOption,
        items: formItems,
      }

      const res = editingScheduleId
        ? await updateRecurringSchedule({ ...payload, scheduleId: editingScheduleId })
        : await createRecurringSchedule(payload)

      if (!res.success) {
        toast.error(res.error || 'Không thể lưu lịch định kỳ')
        return
      }

      toast.success(
        editingScheduleId
          ? 'Đã cập nhật lịch giao định kỳ'
          : 'Đã tạo lịch giao định kỳ thành công!'
      )
      setScheduleModalOpen(false)
      router.refresh()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCreateFromOrder = async () => {
    if (!selectedCompletedOrder) return
    if (!fromOrderName.trim()) {
      toast.error('Vui lòng nhập tên lịch định kỳ')
      return
    }
    if (fromOrderWeekdays.length === 0) {
      toast.error('Vui lòng chọn ít nhất 1 ngày giao trong tuần')
      return
    }

    setIsSubmitting(true)
    try {
      const res = await createRecurringFromOrder({
        orderId: selectedCompletedOrder.id,
        name: fromOrderName.trim(),
        weekdays: fromOrderWeekdays,
        timeSlot: fromOrderTimeSlot,
        addressId: fromOrderAddressId,
        paymentOption: fromOrderPaymentOption,
      })

      if (!res.success) {
        toast.error(res.error || 'Không thể tạo lịch định kỳ từ đơn hàng này')
        return
      }

      toast.success(`Đã tạo lịch định kỳ từ đơn ${selectedCompletedOrder.code}!`)
      setFromOrderModalOpen(false)
      router.refresh()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleToggleSchedule = async (sched: RecurringScheduleClientItem) => {
    setIsSubmitting(true)
    try {
      const nextState = !sched.isActive
      const res = await toggleRecurringSchedule(sched.id, nextState)
      if (!res.success) {
        toast.error(res.error || 'Không thể đổi trạng thái lịch định kỳ')
        return
      }
      toast.success(
        nextState
          ? `Đã bật lịch định kỳ "${sched.name}"`
          : `Đã tạm dừng lịch định kỳ "${sched.name}"`
      )
      router.refresh()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteSchedule = async (sched: RecurringScheduleClientItem) => {
    setIsSubmitting(true)
    try {
      const res = await deleteRecurringSchedule(sched.id)
      if (!res.success) {
        toast.error(res.error || 'Không thể xóa lịch định kỳ')
        return
      }
      toast.success(`Đã xóa lịch định kỳ "${sched.name}"`)
      router.refresh()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleConfirmDraft = async () => {
    if (!activeDraft) return
    const validLines = draftLines.filter((l) => l.quantity > 0)
    if (validLines.length === 0) {
      toast.error('Đơn hàng phải có ít nhất 1 sản phẩm với số lượng > 0')
      return
    }

    setIsSubmitting(true)
    try {
      const res = await confirmRecurringDraft({
        orderId: activeDraft.id,
        paymentOption: draftPaymentOption,
        items: validLines.map((l) => ({
          productId: l.productId,
          packagingId: l.packagingId,
          quantity: l.quantity,
        })),
        customerNote: draftNote,
      })

      if (!res.success || !res.orderCode) {
        toast.error(res.error || 'Không thể xác nhận đơn nháp')
        return
      }

      toast.success('Đã xác nhận đơn nháp! Đang chuyển tới trang thanh toán VietQR...')
      setConfirmDraftModalOpen(false)
      router.push(`/thanh-toan/${res.orderCode}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  const draftPreviewSubtotal = draftQuote?.subtotal ?? activeDraft?.subtotal ?? 0
  const draftPreviewTotal = draftPreviewSubtotal + (activeDraft?.shippingFee ?? 0)
  const draftPreviewDeposit = computeDepositAmount(draftPreviewTotal)

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
              <CalendarDays className="w-6 h-6 text-emerald-600" /> Đơn Hàng Định Kỳ
            </h1>
            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-xs">
              Tự động tạo đơn nháp
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Thiết lập lịch giao trái cây sỉ cố định hàng tuần. Hệ thống tự động tạo đơn nháp trước
            kỳ giao để bạn kiểm tra giá, chỉnh sửa số lượng và chủ động xác nhận thanh toán.
          </p>
        </div>

        <Button
          onClick={openCreateScheduleModal}
          disabled={addresses.length === 0 || products.length === 0}
          className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm gap-1.5"
        >
          <Plus className="w-4 h-4" /> Tạo lịch định kỳ mới
        </Button>
      </div>

      {addresses.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-xs sm:text-sm text-amber-900">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <span>
              Bạn cần thêm ít nhất một địa chỉ nhận hàng trong Sổ địa chỉ trước khi tạo lịch giao
              định kỳ.
            </span>
          </div>
          <Link href="/tai-khoan/dia-chi">
            <Button size="sm" variant="outline" className="border-amber-300 text-amber-900 text-xs">
              Thêm địa chỉ ngay
            </Button>
          </Link>
        </div>
      )}

      {/* Khối 1: Đơn nháp chờ xác nhận (DRAFT) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
            <FileCheck2 className="w-5 h-5 text-amber-600" />
            Đơn nháp chờ bạn xác nhận ({draftOrders.length})
          </h2>
          <span className="text-xs text-slate-500">
            Hệ thống không bao giờ tự trừ tiền khi bạn chưa xác nhận
          </span>
        </div>

        {draftOrders.length === 0 ? (
          <Card className="border-slate-200 bg-slate-50/60">
            <CardContent className="p-5 text-xs sm:text-sm text-slate-600 flex items-center justify-between gap-4">
              <span>
                Hiện chưa có đơn nháp nào đang chờ xác nhận. Khi tới chu kỳ giao hàng trong vòng 7
                ngày tới, đơn nháp sẽ xuất hiện tại đây.
              </span>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {draftOrders.map((draft) => (
              <Card
                key={draft.id}
                className="border-amber-300 bg-amber-50/30 shadow-xs hover:border-amber-400 transition-all"
              >
                <CardContent className="p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200/70 pb-3">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="font-mono font-bold text-base text-slate-900">
                        {draft.code}
                      </span>
                      <Badge className="bg-amber-100 text-amber-900 border-amber-300 text-xs">
                        Đơn nháp chờ xác nhận
                      </Badge>
                      {draft.scheduleName && (
                        <span className="text-xs text-slate-600 font-medium">
                          • Lịch: <strong>{draft.scheduleName}</strong>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-slate-700 font-medium">
                      {draft.deliveryDate && (
                        <span className="flex items-center gap-1">
                          <CalendarDays className="w-3.5 h-3.5 text-emerald-600" />
                          Ngày giao dự kiến:{' '}
                          <strong>
                            {new Date(draft.deliveryDate).toLocaleDateString('vi-VN', {
                              timeZone: 'UTC',
                            })}
                          </strong>
                        </span>
                      )}
                      {draft.timeSlot && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          {TIME_SLOT_LABELS[draft.timeSlot]}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Mặt hàng trong đơn nháp */}
                  <div className="space-y-2 text-xs sm:text-sm">
                    {draft.items.map((item) => (
                      <div
                        key={item.id}
                        className="flex justify-between items-center text-slate-700 bg-white/80 rounded-lg px-3 py-2 border border-amber-100"
                      >
                        <div>
                          <span className="font-semibold text-slate-900">{item.productName}</span>
                          <span className="text-slate-500 ml-1.5">({item.packagingName})</span>
                        </div>
                        <div className="text-right font-medium">
                          <span>
                            {item.quantity} phần ({gramsToKgText(item.orderedGrams)})
                          </span>
                          <span className="mx-1.5 text-slate-300">•</span>
                          <span className="text-emerald-700 font-semibold">
                            {formatVND(item.unitPricePerKg)}/kg
                          </span>
                          <span className="mx-1.5 text-slate-300">→</span>
                          <span className="font-bold text-slate-900">
                            {formatVND(item.lineTotal)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-amber-200/60">
                    <div className="space-y-0.5">
                      <div className="text-xs text-slate-500">
                        Tạm tính theo giá hiện hành:{' '}
                        <strong className="text-base text-emerald-700 font-extrabold">
                          {formatVND(draft.total)}
                        </strong>{' '}
                        (Cọc 30%: {formatVND(draft.depositAmount)})
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Link href={`/tai-khoan/don-hang/${draft.code}`}>
                        <Button size="sm" variant="outline" className="text-xs">
                          Chi tiết đơn
                        </Button>
                      </Link>
                      <Button
                        size="sm"
                        onClick={() => openDraftConfirmationModal(draft)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5"
                      >
                        Kiểm tra & Xác nhận thanh toán <ArrowRight className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Khối 2: Danh sách Lịch giao định kỳ */}
      <section className="space-y-3">
        <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-emerald-600" />
          Lịch giao hàng định kỳ của bạn ({schedules.length})
        </h2>

        {schedules.length === 0 ? (
          <Card className="border-dashed border-2 border-slate-200 py-10 text-center">
            <CardContent className="space-y-3 max-w-md mx-auto">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                <CalendarDays className="w-6 h-6" />
              </div>
              <h3 className="text-sm sm:text-base font-bold text-slate-800">
                Bạn chưa thiết lập lịch giao định kỳ nào
              </h3>
              <p className="text-xs text-slate-500">
                Tạo lịch định kỳ mới hoặc chọn từ một đơn hàng đã hoàn thành bên dưới để nhận đơn
                nháp tự động mỗi tuần.
              </p>
              <Button
                size="sm"
                onClick={openCreateScheduleModal}
                disabled={addresses.length === 0 || products.length === 0}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Tạo lịch định kỳ đầu tiên
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {schedules.map((sched) => {
              const addr = addresses.find((a) => a.id === sched.addressId)
              return (
                <Card
                  key={sched.id}
                  className={`border transition-all ${
                    sched.isActive
                      ? 'border-slate-200 bg-white'
                      : 'border-slate-200 bg-slate-50/70 opacity-80'
                  }`}
                >
                  <CardContent className="p-5 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2.5">
                          <h3 className="font-bold text-base text-slate-900">{sched.name}</h3>
                          <Badge
                            variant="outline"
                            className={
                              sched.isActive
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 text-xs'
                                : 'bg-slate-100 text-slate-600 border-slate-300 text-xs'
                            }
                          >
                            {sched.isActive ? 'Đang hoạt động' : 'Đã tạm dừng'}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                          <span className="flex items-center gap-1 font-medium text-emerald-700">
                            <CalendarDays className="w-3.5 h-3.5" />
                            {formatWeekdaysText(sched.weekdays)}
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            {TIME_SLOT_LABELS[sched.timeSlot]}
                          </span>
                          <span>•</span>
                          <span>
                            Mặc định:{' '}
                            <strong>
                              {sched.paymentOption === PaymentOption.DEPOSIT_30
                                ? 'Đặt cọc 30%'
                                : 'Thanh toán 100%'}
                            </strong>
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isSubmitting}
                          onClick={() => handleToggleSchedule(sched)}
                          className="text-xs gap-1"
                        >
                          <Power className="w-3.5 h-3.5" />
                          {sched.isActive ? 'Tạm dừng' : 'Bật lại'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isSubmitting}
                          onClick={() => openEditScheduleModal(sched)}
                          className="text-xs gap-1"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Sửa
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isSubmitting}
                          onClick={() => handleDeleteSchedule(sched)}
                          className="text-xs text-rose-600 border-rose-200 hover:bg-rose-50 gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Xóa
                        </Button>
                      </div>
                    </div>

                    {/* Danh sách sản phẩm trong lịch */}
                    <div className="space-y-1.5 text-xs sm:text-sm">
                      {sched.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex justify-between items-center text-slate-700 bg-slate-50 px-3 py-2 rounded-lg"
                        >
                          <div>
                            <span className="font-semibold text-slate-900">{item.productName}</span>
                            <span className="text-slate-500 ml-1.5">({item.packagingName})</span>
                          </div>
                          <div className="font-semibold text-slate-800">
                            {item.quantity} phần ({gramsToKgText(item.weightGrams * item.quantity)})
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Địa chỉ & Ngày giao dự kiến sắp tới */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 text-xs text-slate-500">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>
                          {addr
                            ? `${addr.label} — ${addr.recipient} (${addr.phone}), ${addr.district}, ${addr.province}`
                            : 'Địa chỉ mặc định của tài khoản'}
                        </span>
                      </div>

                      {sched.isActive && sched.upcomingDates.length > 0 && (
                        <div className="text-emerald-700 font-medium">
                          Kỳ giao tới:{' '}
                          {sched.upcomingDates
                            .map((d) =>
                              new Date(d).toLocaleDateString('vi-VN', { timeZone: 'UTC' })
                            )
                            .join(', ')}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      {/* Khối 3: Đặt định kỳ nhanh từ đơn đã COMPLETED */}
      {completedOrders.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-600" />
            Đặt định kỳ nhanh từ đơn hàng đã hoàn thành
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {completedOrders.map((order) => (
              <Card key={order.id} className="border-slate-200">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm text-slate-900">
                        {order.code}
                      </span>
                      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[11px]">
                        Hoàn tất
                      </Badge>
                    </div>
                    <span className="text-xs font-bold text-emerald-700">
                      {formatVND(order.total)}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 space-y-1">
                    {order.items.slice(0, 2).map((item, idx) => (
                      <div key={idx} className="flex justify-between">
                        <span className="truncate pr-2">
                          {item.productName} ({item.packagingName})
                        </span>
                        <span className="font-medium shrink-0">
                          {item.quantity} phần ({gramsToKgText(item.orderedGrams)})
                        </span>
                      </div>
                    ))}
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openCreateFromOrderModal(order)}
                    className="w-full text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50 gap-1.5"
                  >
                    <CalendarDays className="w-3.5 h-3.5" /> Đặt định kỳ từ đơn này
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Modal 1: Tạo / Chỉnh sửa lịch định kỳ thủ công */}
      <Dialog open={scheduleModalOpen} onOpenChange={setScheduleModalOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingScheduleId ? 'Chỉnh sửa lịch giao định kỳ' : 'Tạo lịch giao định kỳ mới'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs sm:text-sm">
            <div className="space-y-1.5">
              <Label>Tên lịch định kỳ</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="VD: Lịch giao trái cây Thứ 2 & Thứ 5 cho chuỗi cửa hàng"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Chọn các thứ giao hàng trong tuần (1 = Thứ Hai ... 7 = Chủ Nhật)</Label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_OPTIONS.map((opt) => {
                  const selected = formWeekdays.includes(opt.value)
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() =>
                        toggleWeekdayInList(opt.value, formWeekdays, setFormWeekdays)
                      }
                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                        selected
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-emerald-300'
                      }`}
                    >
                      {opt.label} ({opt.short})
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Khung giờ giao hàng</Label>
                <select
                  value={formTimeSlot}
                  onChange={(e) => setFormTimeSlot(e.target.value as TimeSlot)}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-xs sm:text-sm bg-white"
                >
                  <option value={TimeSlot.MORNING}>{TIME_SLOT_LABELS[TimeSlot.MORNING]}</option>
                  <option value={TimeSlot.AFTERNOON}>{TIME_SLOT_LABELS[TimeSlot.AFTERNOON]}</option>
                  <option value={TimeSlot.EVENING}>{TIME_SLOT_LABELS[TimeSlot.EVENING]}</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Hình thức thanh toán mặc định</Label>
                <select
                  value={formPaymentOption}
                  onChange={(e) => setFormPaymentOption(e.target.value as PaymentOption)}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-xs sm:text-sm bg-white"
                >
                  <option value={PaymentOption.DEPOSIT_30}>Đặt cọc 30% trước khi giao</option>
                  <option value={PaymentOption.FULL}>Thanh toán 100% giá trị đơn</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Địa chỉ nhận hàng</Label>
              <select
                value={formAddressId}
                onChange={(e) => setFormAddressId(e.target.value)}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-xs sm:text-sm bg-white"
              >
                {addresses.map((addr) => (
                  <option key={addr.id} value={addr.id}>
                    {addr.label} — {addr.recipient} ({addr.phone}) • {addr.street}, {addr.district},{' '}
                    {addr.province}
                  </option>
                ))}
              </select>
            </div>

            {/* Danh sách sản phẩm */}
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <Label className="font-bold">Sản phẩm & Quy cách định kỳ</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleAddScheduleLine}
                  className="h-7 text-xs gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Thêm dòng sản phẩm
                </Button>
              </div>

              <div className="space-y-2.5">
                {formItems.map((line, index) => {
                  const selectedProd =
                    products.find((p) => p.id === line.productId) || products[0]
                  const packagings = selectedProd?.packagings || []

                  return (
                    <div
                      key={index}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-slate-50 p-2.5 rounded-lg border border-slate-200"
                    >
                      <div className="sm:col-span-5">
                        <select
                          value={line.productId}
                          onChange={(e) => {
                            const newProdId = e.target.value
                            const prod = products.find((p) => p.id === newProdId)
                            const firstPkg = prod?.packagings[0]
                            setFormItems((prev) =>
                              prev.map((it, idx) =>
                                idx === index
                                  ? {
                                      productId: newProdId,
                                      packagingId: firstPkg?.id || '',
                                      quantity: firstPkg
                                        ? Math.max(
                                            1,
                                            Math.ceil((prod?.moqGrams || 1000) / firstPkg.weightGrams)
                                          )
                                        : 1,
                                    }
                                  : it
                              )
                            )
                          }}
                          className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
                        >
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} (MOQ: {gramsToKgText(p.moqGrams)})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-4">
                        <select
                          value={line.packagingId}
                          onChange={(e) => {
                            const newPkgId = e.target.value
                            setFormItems((prev) =>
                              prev.map((it, idx) =>
                                idx === index ? { ...it, packagingId: newPkgId } : it
                              )
                            )
                          }}
                          className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs bg-white"
                        >
                          {packagings.map((pk) => (
                            <option key={pk.id} value={pk.id}>
                              {pk.name} ({gramsToKgText(pk.weightGrams)})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-2">
                        <Input
                          type="number"
                          min={1}
                          value={line.quantity}
                          onChange={(e) => {
                            const val = Math.max(1, parseInt(e.target.value, 10) || 1)
                            setFormItems((prev) =>
                              prev.map((it, idx) =>
                                idx === index ? { ...it, quantity: val } : it
                              )
                            )
                          }}
                          className="h-8 text-xs text-center bg-white"
                        />
                      </div>

                      <div className="sm:col-span-1 flex justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={formItems.length <= 1}
                          onClick={() =>
                            setFormItems((prev) => prev.filter((_, idx) => idx !== index))
                          }
                          className="h-8 w-8 p-0 text-rose-500 hover:text-rose-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Báo giá tạm tính cho lịch */}
              {schedulePreviewQuote && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-600">
                      Giá trị ước tính mỗi chuyến (theo bảng giá hiện hành):
                    </span>
                    <span className="font-bold text-emerald-700 text-sm">
                      {isQuotingSchedule ? 'Đang tính...' : formatVND(schedulePreviewQuote.subtotal)}
                    </span>
                  </div>
                  {schedulePreviewQuote.errors.length > 0 && (
                    <div className="text-rose-600 font-medium">
                      {schedulePreviewQuote.errors.map((err, i) => (
                        <div key={i}>• {err}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setScheduleModalOpen(false)}
              disabled={isSubmitting}
            >
              Hủy
            </Button>
            <Button
              type="button"
              onClick={handleSaveSchedule}
              disabled={
                isSubmitting ||
                isQuotingSchedule ||
                Boolean(schedulePreviewQuote && schedulePreviewQuote.errors.length > 0)
              }
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isSubmitting ? 'Đang lưu...' : editingScheduleId ? 'Lưu thay đổi' : 'Tạo lịch định kỳ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal 2: Tạo lịch định kỳ từ đơn COMPLETED */}
      <Dialog open={fromOrderModalOpen} onOpenChange={setFromOrderModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Đặt định kỳ từ đơn hàng {selectedCompletedOrder?.code}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs sm:text-sm">
            <div className="space-y-1.5">
              <Label>Tên lịch định kỳ</Label>
              <Input
                value={fromOrderName}
                onChange={(e) => setFromOrderName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Chọn các thứ giao hàng trong tuần</Label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_OPTIONS.map((opt) => {
                  const selected = fromOrderWeekdays.includes(opt.value)
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() =>
                        toggleWeekdayInList(opt.value, fromOrderWeekdays, setFromOrderWeekdays)
                      }
                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                        selected
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-white text-slate-700 border-slate-200'
                      }`}
                    >
                      {opt.label} ({opt.short})
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Khung giờ giao</Label>
                <select
                  value={fromOrderTimeSlot}
                  onChange={(e) => setFromOrderTimeSlot(e.target.value as TimeSlot)}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-xs bg-white"
                >
                  <option value={TimeSlot.MORNING}>{TIME_SLOT_LABELS[TimeSlot.MORNING]}</option>
                  <option value={TimeSlot.AFTERNOON}>{TIME_SLOT_LABELS[TimeSlot.AFTERNOON]}</option>
                  <option value={TimeSlot.EVENING}>{TIME_SLOT_LABELS[TimeSlot.EVENING]}</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Thanh toán mặc định</Label>
                <select
                  value={fromOrderPaymentOption}
                  onChange={(e) => setFromOrderPaymentOption(e.target.value as PaymentOption)}
                  className="w-full rounded-md border border-slate-200 px-3 py-2 text-xs bg-white"
                >
                  <option value={PaymentOption.DEPOSIT_30}>Đặt cọc 30%</option>
                  <option value={PaymentOption.FULL}>Thanh toán 100%</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Địa chỉ nhận hàng</Label>
              <select
                value={fromOrderAddressId}
                onChange={(e) => setFromOrderAddressId(e.target.value)}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-xs bg-white"
              >
                {addresses.map((addr) => (
                  <option key={addr.id} value={addr.id}>
                    {addr.label} — {addr.recipient} ({addr.phone}), {addr.district}, {addr.province}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setFromOrderModalOpen(false)}
              disabled={isSubmitting}
            >
              Hủy
            </Button>
            <Button
              type="button"
              onClick={handleCreateFromOrder}
              disabled={isSubmitting}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isSubmitting ? 'Đang tạo...' : 'Xác nhận tạo lịch định kỳ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal 3: Kiểm tra giá, sửa số lượng & Xác nhận đơn nháp (DRAFT -> PENDING_CONFIRMATION) */}
      <Dialog open={confirmDraftModalOpen} onOpenChange={setConfirmDraftModalOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              Xác nhận đơn nháp định kỳ {activeDraft?.code}
            </DialogTitle>
          </DialogHeader>

          {activeDraft && (
            <div className="space-y-4 py-2 text-xs sm:text-sm">
              <div className="rounded-lg bg-slate-50 p-3 border border-slate-200 flex flex-wrap justify-between gap-2 text-xs">
                <span>
                  Ngày giao hàng:{' '}
                  <strong>
                    {activeDraft.deliveryDate
                      ? new Date(activeDraft.deliveryDate).toLocaleDateString('vi-VN', {
                          timeZone: 'UTC',
                        })
                      : 'Chưa xác định'}
                  </strong>
                </span>
                {activeDraft.timeSlot && (
                  <span>Khung giờ: {TIME_SLOT_LABELS[activeDraft.timeSlot]}</span>
                )}
              </div>

              <div className="space-y-2">
                <Label className="font-bold">Điều chỉnh số lượng (tính lại giá bậc tự động)</Label>
                {draftLines.map((line, idx) => (
                  <div
                    key={`${line.productId}-${line.packagingId}`}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 bg-white"
                  >
                    <div>
                      <div className="font-semibold text-slate-900">{line.productName}</div>
                      <div className="text-xs text-slate-500">Quy cách: {line.packagingName}</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">Số lượng:</span>
                      <Input
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(e) => {
                          const qty = Math.max(1, parseInt(e.target.value, 10) || 1)
                          setDraftLines((prev) =>
                            prev.map((it, i) => (i === idx ? { ...it, quantity: qty } : it))
                          )
                        }}
                        className="w-20 h-8 text-center text-xs"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Hình thức thanh toán */}
              <div className="space-y-1.5">
                <Label className="font-bold">Chọn hình thức thanh toán</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setDraftPaymentOption(PaymentOption.DEPOSIT_30)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      draftPaymentOption === PaymentOption.DEPOSIT_30
                        ? 'border-emerald-600 bg-emerald-50/60 ring-1 ring-emerald-600'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="font-bold text-slate-900 text-xs">Đặt cọc 30%</div>
                    <div className="text-emerald-700 font-extrabold text-sm mt-0.5">
                      {formatVND(draftPreviewDeposit)}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDraftPaymentOption(PaymentOption.FULL)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      draftPaymentOption === PaymentOption.FULL
                        ? 'border-emerald-600 bg-emerald-50/60 ring-1 ring-emerald-600'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="font-bold text-slate-900 text-xs">Thanh toán 100%</div>
                    <div className="text-emerald-700 font-extrabold text-sm mt-0.5">
                      {formatVND(draftPreviewTotal)}
                    </div>
                  </button>
                </div>
              </div>

              {/* Báo giá realtime */}
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3.5 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-600">Tổng giá trị đơn hàng (theo giá hiện hành):</span>
                  <span className="font-extrabold text-emerald-800 text-sm">
                    {isQuotingDraft ? 'Đang tính lại giá...' : formatVND(draftPreviewTotal)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Số tiền cần chuyển khoản VietQR ngay:</span>
                  <span className="font-bold text-slate-900">
                    {formatVND(
                      draftPaymentOption === PaymentOption.DEPOSIT_30
                        ? draftPreviewDeposit
                        : draftPreviewTotal
                    )}
                  </span>
                </div>

                {draftQuote && draftQuote.errors.length > 0 && (
                  <div className="pt-1.5 text-rose-600 font-medium">
                    {draftQuote.errors.map((err, i) => (
                      <div key={i}>• {err}</div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <Label>Ghi chú đơn hàng (tùy chọn)</Label>
                <Input
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  placeholder="Ghi chú giờ nhận hàng hoặc yêu cầu đóng gói..."
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDraftModalOpen(false)}
              disabled={isSubmitting}
            >
              Để sau
            </Button>
            <Button
              type="button"
              onClick={handleConfirmDraft}
              disabled={
                isSubmitting ||
                isQuotingDraft ||
                Boolean(draftQuote && draftQuote.errors.length > 0)
              }
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
            >
              {isSubmitting ? 'Đang xác nhận...' : 'Xác nhận và Thanh toán VietQR'}
              <ArrowRight className="w-4 h-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
