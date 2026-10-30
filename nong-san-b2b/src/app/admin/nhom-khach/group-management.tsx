'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Percent,
  Users,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
  ArrowLeft,
  Pencil,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
  validateDiscountPercent,
  formatCustomerGroupBadge,
  MIN_GROUP_DISCOUNT_PERCENT,
  MAX_GROUP_DISCOUNT_PERCENT,
} from '@/lib/domain/crm'
import { updateCustomerGroupDiscount } from '@/actions/admin-crm'
import { toast } from 'sonner'

export interface AdminCustomerGroupItem {
  id: string
  code: string
  name: string
  discountPercent: number
  isDefault: boolean
  customerCount: number
  updatedAt: string
}

const GROUP_DESCRIPTIONS: Record<string, string> = {
  TIER1_AGENT:
    'Đối tác chiến lược nhập sản lượng lớn định kỳ. Hưởng mức chiết khấu cao nhất trên bảng giá bậc.',
  SUPERMARKET:
    'Hệ thống chuỗi siêu thị, cửa hàng thực phẩm sạch có lịch nhập hàng ổn định.',
  SMALL_SHOP:
    'Nhóm mặc định tự động gán khi khách hàng B2B mới đăng ký tài khoản trên hệ thống.',
}

interface GroupManagementProps {
  initialGroups: AdminCustomerGroupItem[]
}

export function GroupManagementClient({ initialGroups }: GroupManagementProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [editingGroup, setEditingGroup] = useState<AdminCustomerGroupItem | null>(null)
  const [discountInput, setDiscountInput] = useState<string>('')
  const [validationError, setValidationError] = useState<string | null>(null)

  const openEditModal = (group: AdminCustomerGroupItem) => {
    setEditingGroup(group)
    setDiscountInput(String(group.discountPercent))
    setValidationError(null)
  }

  const handleInputChange = (raw: string) => {
    setDiscountInput(raw)
    setValidationError(null)
  }

  const handleSaveDiscount = () => {
    if (!editingGroup) return

    const trimmed = discountInput.trim()
    if (trimmed === '' || !/^-?\d+(\.\d+)?$/.test(trimmed)) {
      setValidationError('Vui lòng nhập một số nguyên hợp lệ từ 0 đến 50')
      return
    }

    const parsed = Number(trimmed)
    const check = validateDiscountPercent(parsed)
    if (!check.valid || check.value === undefined) {
      setValidationError(check.error || 'Tỷ lệ chiết khấu không hợp lệ')
      return
    }

    startTransition(async () => {
      const result = await updateCustomerGroupDiscount({
        groupId: editingGroup.id,
        discountPercent: check.value!,
      })

      if (!result.success) {
        setValidationError(result.error || 'Cập nhật thất bại')
        toast.error(result.error || 'Cập nhật chiết khấu thất bại')
        return
      }

      toast.success(result.message || 'Đã cập nhật tỷ lệ chiết khấu thành công')
      setEditingGroup(null)
      router.refresh()
    })
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 sm:p-7 rounded-3xl border border-slate-200/90 shadow-card">
        <div className="space-y-1">
          <h1 className="font-heading text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2.5">
            <Percent className="w-6 h-6 text-emerald-600" />
            Nhóm Khách Hàng &amp; Tỷ Lệ Chiết Khấu B2B
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Quản lý chính sách chiết khấu cộng thêm theo từng hạng đối tác mua sỉ trên bảng giá bậc.
          </p>
        </div>
        <Link href="/admin/khach-hang">
          <Button variant="outline" size="sm" className="gap-1.5 bg-white rounded-full border-slate-200 hover:bg-emerald-50 hover:text-emerald-700 h-9 px-4 font-semibold text-xs">
            <ArrowLeft className="w-4 h-4" />
            Danh sách Khách hàng CRM
          </Button>
        </Link>
      </div>

      {/* Group Cards Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {initialGroups.map((group) => {
          const badge = formatCustomerGroupBadge({
            code: group.code,
            name: group.name,
            discountPercent: group.discountPercent,
          })

          return (
            <Card key={group.id} className="border-slate-200 flex flex-col justify-between">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className={`text-xs font-semibold ${badge.color}`}>
                    <Sparkles className="w-3 h-3 mr-1" />
                    {group.code}
                  </Badge>
                  {group.isDefault && (
                    <Badge className="bg-slate-800 text-white text-[10px]">
                      Nhóm mặc định khi ĐK
                    </Badge>
                  )}
                </div>
                <CardTitle className="text-lg font-bold text-slate-900 pt-2">
                  {group.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-slate-600 leading-relaxed min-h-[36px]">
                  {GROUP_DESCRIPTIONS[group.code] || 'Nhóm đối tác mua sỉ B2B.'}
                </p>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] text-slate-500">Mức chiết khấu thêm</div>
                    <div className="text-2xl font-extrabold text-emerald-700 font-mono">
                      -{group.discountPercent}%
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-slate-500">Số khách thuộc nhóm</div>
                    <div className="text-base font-bold text-slate-900 flex items-center justify-end gap-1">
                      <Users className="w-4 h-4 text-slate-400" />
                      {group.customerCount} đối tác
                    </div>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5 text-xs font-semibold"
                  onClick={() => openEditModal(group)}
                >
                  <Pencil className="w-3.5 h-3.5 text-emerald-600" />
                  Chỉnh sửa % chiết khấu
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Detailed Table */}
      <Card className="border-slate-200 overflow-hidden">
        <CardHeader className="py-4 px-6 border-b border-slate-100 bg-slate-50/60">
          <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            Bảng cấu hình chi tiết Nhóm khách hàng
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead className="pl-6">Mã nhóm</TableHead>
                <TableHead>Tên nhóm khách hàng</TableHead>
                <TableHead className="text-center">Tỷ lệ chiết khấu (%)</TableHead>
                <TableHead className="text-center">Số khách hàng</TableHead>
                <TableHead className="text-center">Mặc định ĐK</TableHead>
                <TableHead className="text-right pr-6">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialGroups.map((group) => (
                <TableRow key={group.id}>
                  <TableCell className="pl-6 font-mono text-xs font-bold text-slate-800">
                    {group.code}
                  </TableCell>
                  <TableCell className="font-semibold text-slate-900 text-sm">
                    {group.name}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant="outline"
                      className="font-mono text-xs font-bold bg-emerald-50 text-emerald-800 border-emerald-300"
                    >
                      -{group.discountPercent}%
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center text-sm font-medium text-slate-700">
                    {group.customerCount} khách
                  </TableCell>
                  <TableCell className="text-center">
                    {group.isDefault ? (
                      <Badge className="bg-emerald-600 text-white text-[10px]">Mặc định</Badge>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1"
                      onClick={() => openEditModal(group)}
                    >
                      <Percent className="w-3.5 h-3.5 text-emerald-600" />
                      Sửa % chiết khấu
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Discount Modal */}
      <Dialog
        open={!!editingGroup}
        onOpenChange={(open) => {
          if (!open) {
            setEditingGroup(null)
            setValidationError(null)
          }
        }}
      >
        <DialogContent className="max-w-md">
          {editingGroup && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base font-bold flex items-center gap-2">
                  <Percent className="w-5 h-5 text-emerald-600" />
                  Cập nhật % chiết khấu — {editingGroup.name}
                </DialogTitle>
                <DialogDescription>
                  Nhập tỷ lệ chiết khấu mới (số nguyên từ {MIN_GROUP_DISCOUNT_PERCENT}% đến{' '}
                  {MAX_GROUP_DISCOUNT_PERCENT}%). Thay đổi chỉ áp dụng cho đơn hàng mới.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <div>
                    <div className="text-slate-500">Nhóm đang chọn</div>
                    <div className="font-bold text-slate-900 text-sm mt-0.5">
                      {editingGroup.name} ({editingGroup.code})
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-slate-500">Chiết khấu hiện tại</div>
                    <div className="font-mono font-bold text-emerald-700 text-sm mt-0.5">
                      {editingGroup.discountPercent}%
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="discountPercentInput" className="text-xs font-semibold">
                    Tỷ lệ chiết khấu mới (%) *
                  </Label>
                  <div className="relative">
                    <Input
                      id="discountPercentInput"
                      type="number"
                      min={MIN_GROUP_DISCOUNT_PERCENT}
                      max={MAX_GROUP_DISCOUNT_PERCENT}
                      step={1}
                      value={discountInput}
                      onChange={(e) => handleInputChange(e.target.value)}
                      className="pr-10 font-mono text-sm"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                      %
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Chỉ chấp nhận số nguyên trong khoảng {MIN_GROUP_DISCOUNT_PERCENT}% –{' '}
                    {MAX_GROUP_DISCOUNT_PERCENT}%.
                  </p>
                  {validationError && (
                    <p className="text-xs font-medium text-rose-600 pt-1">
                      {validationError}
                    </p>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditingGroup(null)
                    setValidationError(null)
                  }}
                  disabled={isPending}
                >
                  Hủy
                </Button>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                  onClick={handleSaveDiscount}
                  disabled={isPending}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {isPending ? 'Đang lưu...' : 'Lưu tỷ lệ mới'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
