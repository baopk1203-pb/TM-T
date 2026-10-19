'use client'

import { useState, useMemo, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Users,
  Building2,
  Search,
  Eye,
  UserCheck,
  MapPin,
  ShoppingBag,
  ExternalLink,
  Sparkles,
  Phone,
  Mail,
  FileText,
  TrendingUp,
  CheckCircle2,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatVND, gramsToKgText } from '@/lib/money'
import {
  filterCustomers,
  formatCustomerGroupBadge,
} from '@/lib/domain/crm'
import { updateCustomerGroup } from '@/actions/admin-crm'
import { toast } from 'sonner'
import { OrderStatus, OrderType } from '@prisma/client'

export interface AdminCustomerGroupOption {
  id: string
  code: string
  name: string
  discountPercent: number
  isDefault: boolean
}

export interface AdminCustomerAddressItem {
  id: string
  label: string
  recipient: string
  phone: string
  line: string
  ward: string
  district: string
  province: string
  isDefault: boolean
}

export interface AdminCustomerOrderItem {
  id: string
  code: string
  type: OrderType | string
  status: OrderStatus
  paymentStatus: string
  groupDiscountPercent: number
  total: number
  finalTotal: number | null
  totalGrams: number
  createdAt: string
  deliveryDate: string | null
}

export interface AdminCustomerListItem {
  id: string
  fullName: string
  email: string
  phone: string
  companyName: string | null
  taxCode: string | null
  createdAt: string
  groupId: string | null
  groupCode: string | null
  groupName: string | null
  discountPercent: number
  orderCount: number
  completedOrderCount: number
  completedRevenue: number
  activeOrderCount: number
  cancelledOrderCount: number
  draftOrderCount: number
  addresses: AdminCustomerAddressItem[]
  orders: AdminCustomerOrderItem[]
}

const ORDER_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  DRAFT: { label: 'Đơn nháp (Định kỳ)', className: 'bg-slate-100 text-slate-700 border-slate-300' },
  PREORDER_WAITING: { label: 'Chờ thu hoạch (Pre-order)', className: 'bg-purple-100 text-purple-800 border-purple-300' },
  PENDING_CONFIRMATION: { label: 'Chờ xác nhận TT', className: 'bg-amber-100 text-amber-800 border-amber-300' },
  PROCESSING: { label: 'Đang xử lý', className: 'bg-blue-100 text-blue-800 border-blue-300' },
  SHIPPING: { label: 'Đang giao hàng', className: 'bg-indigo-100 text-indigo-800 border-indigo-300' },
  DELIVERED: { label: 'Đã giao (Chờ quyết toán)', className: 'bg-teal-100 text-teal-800 border-teal-300' },
  COMPLAINT: { label: 'Đang khiếu nại', className: 'bg-rose-100 text-rose-800 border-rose-300' },
  COMPLETED: { label: 'Hoàn thành', className: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  CANCELLED: { label: 'Đã hủy', className: 'bg-slate-200 text-slate-600 border-slate-300' },
}

const ORDER_TYPE_LABELS: Record<string, string> = {
  STANDARD: 'Đơn sỉ thường',
  SAMPLE: 'Đơn mẫu thử',
  RECURRING: 'Đơn định kỳ',
  PREORDER: 'Đặt trước vụ mùa',
}

interface CustomerManagementProps {
  initialCustomers: AdminCustomerListItem[]
  groups: AdminCustomerGroupOption[]
}

export function CustomerManagementClient({
  initialCustomers,
  groups,
}: CustomerManagementProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('ALL')

  // State cho Dialog xem chi tiết khách hàng
  const [detailCustomer, setDetailCustomer] = useState<AdminCustomerListItem | null>(null)

  // State cho Dialog đổi nhóm khách hàng
  const [editingCustomer, setEditingCustomer] = useState<AdminCustomerListItem | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string>('')
  const [changeReason, setChangeReason] = useState<string>('')

  const filteredCustomers = useMemo(() => {
    return filterCustomers(initialCustomers, {
      search,
      groupCode: groupFilter,
    })
  }, [initialCustomers, search, groupFilter])

  const summary = useMemo(() => {
    const totalCustomers = initialCustomers.length
    const upgradedCustomers = initialCustomers.filter(
      (c) => c.groupCode === 'TIER1_AGENT' || c.groupCode === 'SUPERMARKET'
    ).length
    const totalOrders = initialCustomers.reduce((sum, c) => sum + c.orderCount, 0)
    const totalCompletedRevenue = initialCustomers.reduce(
      (sum, c) => sum + c.completedRevenue,
      0
    )

    return {
      totalCustomers,
      upgradedCustomers,
      totalOrders,
      totalCompletedRevenue,
    }
  }, [initialCustomers])

  const openChangeGroupModal = (customer: AdminCustomerListItem) => {
    setEditingCustomer(customer)
    const defaultGroup = groups.find((g) => g.isDefault) || groups[0]
    setSelectedGroupId(customer.groupId || defaultGroup?.id || '')
    setChangeReason('')
  }

  const handleConfirmChangeGroup = () => {
    if (!editingCustomer || !selectedGroupId) return

    startTransition(async () => {
      const result = await updateCustomerGroup({
        customerId: editingCustomer.id,
        groupId: selectedGroupId,
        reason: changeReason,
      })

      if (!result.success) {
        toast.error(result.error || 'Đổi nhóm khách hàng thất bại')
        return
      }

      toast.success(result.message || 'Đã cập nhật nhóm khách hàng thành công')
      setEditingCustomer(null)
      setChangeReason('')
      router.refresh()
    })
  }

  const selectedTargetGroup = groups.find((g) => g.id === selectedGroupId)

  const selectedGroupFilterLabel = useMemo(() => {
    if (groupFilter === 'ALL') return 'Tất cả nhóm khách hàng'
    const found = groups.find((g) => g.code === groupFilter)
    return found ? `${found.name} (-${found.discountPercent}%)` : 'Tất cả nhóm khách hàng'
  }, [groupFilter, groups])

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Quản lý Khách hàng sỉ & Phân hạng B2B (CRM)
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Tra cứu hồ sơ pháp nhân, mã số thuế, sổ địa chỉ, lịch sử mua hàng và nâng/hạ hạng đối tác chiến lược.
          </p>
        </div>
        <Link href="/admin/nhom-khach">
          <Button variant="outline" size="sm" className="gap-1.5 bg-white">
            <Sparkles className="w-4 h-4 text-emerald-600" />
            Cấu hình % Chiết khấu Nhóm
          </Button>
        </Link>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-slate-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-slate-500 uppercase">
                Tổng đối tác B2B
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                {summary.totalCustomers}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Tài khoản khách hàng sỉ
              </div>
            </div>
            <div className="w-11 h-11 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-slate-500 uppercase">
                Đại lý cấp 1 & Siêu thị
              </div>
              <div className="text-2xl font-bold text-emerald-700 mt-1">
                {summary.upgradedCustomers}
              </div>
              <div className="text-[11px] text-emerald-600 mt-0.5">
                Đang hưởng chiết khấu nhóm
              </div>
            </div>
            <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <UserCheck className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-slate-500 uppercase">
                Tổng đơn thương mại
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                {summary.totalOrders}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Không tính đơn nháp chưa duyệt
              </div>
            </div>
            <div className="w-11 h-11 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <ShoppingBag className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-slate-500 uppercase">
                Tổng doanh thu hoàn thành
              </div>
              <div className="text-xl font-bold text-emerald-700 mt-1 font-mono">
                {formatVND(summary.totalCompletedRevenue)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Chỉ tính đơn COMPLETED
              </div>
            </div>
            <div className="w-11 h-11 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="border-slate-200">
        <CardContent className="p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              placeholder="Tìm theo tên doanh nghiệp, mã số thuế, người đại diện, SĐT, email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 text-sm"
            />
          </div>

          <div className="w-full sm:w-64">
            <Select
              value={groupFilter}
              onValueChange={(val) => setGroupFilter(val || 'ALL')}
            >
              <SelectTrigger className="w-full bg-white text-sm">
                <SelectValue placeholder="Lọc theo nhóm khách">
                  {selectedGroupFilterLabel}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tất cả nhóm khách hàng</SelectItem>
                {groups.map((grp) => (
                  <SelectItem key={grp.code} value={grp.code}>
                    {grp.name} (-{grp.discountPercent}%)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Customer Table */}
      <Card className="border-slate-200 overflow-hidden">
        <CardHeader className="py-4 px-6 border-b border-slate-100 bg-slate-50/60">
          <CardTitle className="text-base font-bold text-slate-900 flex items-center justify-between">
            <span>Danh sách khách hàng doanh nghiệp ({filteredCustomers.length})</span>
            <span className="text-xs font-normal text-slate-500">
              Doanh thu tính theo tổng quyết toán (finalTotal) của các đơn COMPLETED
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead className="pl-6">Doanh nghiệp & Liên hệ</TableHead>
                <TableHead>Mã số thuế</TableHead>
                <TableHead>Nhóm khách & Chiết khấu</TableHead>
                <TableHead className="text-center">Số đơn hàng</TableHead>
                <TableHead className="text-right">Doanh thu hoàn thành</TableHead>
                <TableHead className="text-right pr-6">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCustomers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-slate-500 text-sm">
                    Không tìm thấy khách hàng nào phù hợp với bộ lọc hiện tại.
                  </TableCell>
                </TableRow>
              ) : (
                filteredCustomers.map((customer) => {
                  const badge = formatCustomerGroupBadge({
                    code: customer.groupCode,
                    name: customer.groupName,
                    discountPercent: customer.discountPercent,
                  })

                  return (
                    <TableRow key={customer.id} className="hover:bg-slate-50/60">
                      <TableCell className="pl-6 py-3.5">
                        <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                          <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>{customer.companyName || 'Chưa cập nhật tên DN'}</span>
                        </div>
                        <div className="text-xs text-slate-600 mt-1">
                          Đại diện: <strong className="text-slate-800">{customer.fullName}</strong> · {customer.phone}
                        </div>
                        <div className="text-[11px] text-slate-500">{customer.email}</div>
                      </TableCell>

                      <TableCell>
                        {customer.taxCode ? (
                          <span className="font-mono text-xs font-semibold text-slate-800 bg-slate-100 px-2 py-1 rounded">
                            {customer.taxCode}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 italic">Chưa cung cấp</span>
                        )}
                      </TableCell>

                      <TableCell>
                        <Badge variant="outline" className={`text-xs font-medium ${badge.color}`}>
                          {badge.label}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-center">
                        <div className="font-bold text-slate-900 text-sm">
                          {customer.orderCount} đơn
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {customer.completedOrderCount} hoàn thành
                          {customer.activeOrderCount > 0 ? ` · ${customer.activeOrderCount} đang xử lý` : ''}
                        </div>
                      </TableCell>

                      <TableCell className="text-right">
                        <div className="font-bold text-emerald-700 font-mono text-sm">
                          {formatVND(customer.completedRevenue)}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {customer.completedOrderCount} đơn COMPLETED
                        </div>
                      </TableCell>

                      <TableCell className="text-right pr-6">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-8 gap-1"
                            onClick={() => setDetailCustomer(customer)}
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Chi tiết
                          </Button>
                          <Button
                            size="sm"
                            className="text-xs h-8 bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                            onClick={() => openChangeGroupModal(customer)}
                          >
                            <UserCheck className="w-3.5 h-3.5" />
                            Đổi nhóm
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* DIALOG 1: XEM CHI TIẾT KHÁCH HÀNG (ĐƠN HÀNG & ĐỊA CHỈ) */}
      <Dialog
        open={!!detailCustomer}
        onOpenChange={(open) => {
          if (!open) setDetailCustomer(null)
        }}
      >
        <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
          {detailCustomer && (
            <>
              <DialogHeader>
                <DialogTitle className="text-lg font-bold flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-emerald-600" />
                  {detailCustomer.companyName || detailCustomer.fullName}
                </DialogTitle>
                <DialogDescription>
                  Hồ sơ đối tác B2B, danh sách địa chỉ nhận hàng và lịch sử giao dịch đơn hàng.
                </DialogDescription>
              </DialogHeader>

              {/* Thông tin tổng quan khách hàng */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                <div className="space-y-1.5">
                  <div className="text-slate-500 font-medium">Người đại diện & Liên hệ</div>
                  <div className="font-bold text-slate-900 text-sm">{detailCustomer.fullName}</div>
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <Phone className="w-3.5 h-3.5 text-slate-400" /> {detailCustomer.phone}
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <Mail className="w-3.5 h-3.5 text-slate-400" /> {detailCustomer.email}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="text-slate-500 font-medium">Pháp nhân & Phân hạng</div>
                  <div className="flex items-center gap-1.5 text-slate-700">
                    <FileText className="w-3.5 h-3.5 text-slate-400" />
                    MST: <strong className="font-mono">{detailCustomer.taxCode || 'Chưa cung cấp'}</strong>
                  </div>
                  <div className="pt-1">
                    <Badge
                      variant="outline"
                      className={
                        formatCustomerGroupBadge({
                          code: detailCustomer.groupCode,
                          name: detailCustomer.groupName,
                          discountPercent: detailCustomer.discountPercent,
                        }).color
                      }
                    >
                      {
                        formatCustomerGroupBadge({
                          code: detailCustomer.groupCode,
                          name: detailCustomer.groupName,
                          discountPercent: detailCustomer.discountPercent,
                        }).label
                      }
                    </Badge>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="text-slate-500 font-medium">Hiệu quả mua hàng</div>
                  <div className="text-slate-700">
                    Tổng đơn thương mại: <strong>{detailCustomer.orderCount} đơn</strong> ({detailCustomer.completedOrderCount} hoàn thành)
                  </div>
                  {detailCustomer.draftOrderCount > 0 && (
                    <div className="text-slate-500">
                      Đơn nháp định kỳ chờ duyệt: {detailCustomer.draftOrderCount}
                    </div>
                  )}
                  <div className="text-emerald-700 font-bold font-mono text-sm pt-0.5">
                    Doanh thu: {formatVND(detailCustomer.completedRevenue)}
                  </div>
                </div>
              </div>

              <Tabs defaultValue="orders" className="w-full mt-2">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="orders">
                    Lịch sử đơn hàng ({detailCustomer.orders.length})
                  </TabsTrigger>
                  <TabsTrigger value="addresses">
                    Sổ địa chỉ nhận hàng ({detailCustomer.addresses.length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="orders" className="mt-4">
                  {detailCustomer.orders.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 text-xs border border-dashed border-slate-200 rounded-xl">
                      Khách hàng này chưa có đơn hàng nào.
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50 text-xs">
                            <TableHead>Mã đơn</TableHead>
                            <TableHead>Loại đơn</TableHead>
                            <TableHead>Trạng thái</TableHead>
                            <TableHead className="text-center">CK Snapshot</TableHead>
                            <TableHead className="text-right">Khối lượng</TableHead>
                            <TableHead className="text-right">Giá trị đơn</TableHead>
                            <TableHead className="text-right">Chi tiết</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detailCustomer.orders.map((ord) => {
                            const st = ORDER_STATUS_LABELS[ord.status] || {
                              label: ord.status,
                              className: 'bg-slate-100 text-slate-700',
                            }
                            const displayAmount = ord.finalTotal ?? ord.total

                            return (
                              <TableRow key={ord.id} className="text-xs">
                                <TableCell className="font-mono font-bold text-slate-900">
                                  {ord.code}
                                  <div className="text-[11px] font-sans font-normal text-slate-400">
                                    {new Date(ord.createdAt).toLocaleDateString('vi-VN')}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {ORDER_TYPE_LABELS[ord.type] || ord.type}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className={`text-[11px] ${st.className}`}>
                                    {st.label}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-center font-mono">
                                  -{ord.groupDiscountPercent}%
                                </TableCell>
                                <TableCell className="text-right font-mono">
                                  {gramsToKgText(ord.totalGrams)}
                                </TableCell>
                                <TableCell className="text-right font-mono font-semibold text-slate-900">
                                  {formatVND(displayAmount)}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Link href={`/admin/don-hang/${ord.code}`}>
                                    <Button variant="ghost" size="sm" className="h-7 text-xs text-emerald-700 gap-1">
                                      Mở đơn <ExternalLink className="w-3 h-3" />
                                    </Button>
                                  </Link>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="addresses" className="mt-4">
                  {detailCustomer.addresses.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 text-xs border border-dashed border-slate-200 rounded-xl">
                      Khách hàng chưa lưu địa chỉ nhận hàng nào.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {detailCustomer.addresses.map((addr) => (
                        <div
                          key={addr.id}
                          className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-900 flex items-center gap-1.5">
                              <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                              {addr.label}
                            </span>
                            {addr.isDefault && (
                              <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">
                                Mặc định
                              </Badge>
                            )}
                          </div>
                          <div className="text-slate-700 font-medium">
                            Người nhận: {addr.recipient} ({addr.phone})
                          </div>
                          <div className="text-slate-500">
                            {addr.line}, {addr.ward}, {addr.district}, {addr.province}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>

              <DialogFooter className="mt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    const target = detailCustomer
                    setDetailCustomer(null)
                    openChangeGroupModal(target)
                  }}
                >
                  <UserCheck className="w-4 h-4 mr-1.5" />
                  Đổi nhóm khách hàng này
                </Button>
                <Button onClick={() => setDetailCustomer(null)}>Đóng</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* DIALOG 2: ĐỔI NHÓM KHÁCH HÀNG B2B */}
      <Dialog
        open={!!editingCustomer}
        onOpenChange={(open) => {
          if (!open) setEditingCustomer(null)
        }}
      >
        <DialogContent className="max-w-md">
          {editingCustomer && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base font-bold flex items-center gap-2">
                  <UserCheck className="w-5 h-5 text-emerald-600" />
                  Phân hạng & Đổi nhóm khách hàng
                </DialogTitle>
                <DialogDescription>
                  Thay đổi nhóm khách hàng sẽ áp dụng tỷ lệ chiết khấu mới cho các đơn hàng đặt mới từ thời điểm này. Các đơn hàng lịch sử vẫn giữ nguyên mức chiết khấu đã snapshot.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                  <div className="font-bold text-slate-900 text-sm">
                    {editingCustomer.companyName || editingCustomer.fullName}
                  </div>
                  <div className="text-slate-600">
                    Đại diện: {editingCustomer.fullName} ({editingCustomer.email})
                  </div>
                  <div className="text-slate-600">
                    Nhóm hiện tại:{' '}
                    <strong>
                      {editingCustomer.groupName || 'Cửa hàng nhỏ'} (-{editingCustomer.discountPercent}%)
                    </strong>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Chọn nhóm khách hàng mới *</Label>
                  <Select
                    value={selectedGroupId}
                    onValueChange={(val) => setSelectedGroupId(val || '')}
                  >
                    <SelectTrigger className="w-full bg-white text-sm">
                      <SelectValue placeholder="Chọn nhóm đối tác...">
                        {selectedTargetGroup
                          ? `${selectedTargetGroup.name} (Chiết khấu -${selectedTargetGroup.discountPercent}%)`
                          : 'Chọn nhóm đối tác...'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {groups.map((grp) => (
                        <SelectItem key={grp.id} value={grp.id}>
                          {grp.name} (Chiết khấu -{grp.discountPercent}%)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">
                    Ghi chú / Lý do thay đổi nhóm (Ghi nhận vào Server Audit Log)
                  </Label>
                  <Textarea
                    placeholder="Ví dụ: Đạt doanh số nhập sỉ > 50 triệu/tháng, nâng hạng lên Siêu thị..."
                    value={changeReason}
                    onChange={(e) => setChangeReason(e.target.value)}
                    rows={3}
                    className="text-xs"
                  />
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setEditingCustomer(null)}
                  disabled={isPending}
                >
                  Hủy
                </Button>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                  onClick={handleConfirmChangeGroup}
                  disabled={isPending || !selectedGroupId}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {isPending ? 'Đang cập nhật...' : 'Xác nhận đổi nhóm'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
