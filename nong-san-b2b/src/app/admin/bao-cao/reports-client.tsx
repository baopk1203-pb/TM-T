'use client'

import { useState, useTransition, useSyncExternalStore } from 'react'
import {
  TrendingUp,
  Calendar,
  Package,
  AlertTriangle,
  Scale,
  Users,
  BarChart3,
  Filter,
  DollarSign,
  Wallet,
  Info,
  ShieldAlert,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatVND } from '@/lib/money'
import {
  DateRangePreset,
  ReportGrouping,
} from '@/lib/domain/reports'
import { BusinessReportData, getBusinessReports } from '@/server/reports'
import { AdminAiAssistant } from '@/components/admin/admin-ai-assistant'
import { toast } from 'sonner'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  PieChart,
  Pie,
} from 'recharts'

interface ReportsClientProps {
  initialData: BusinessReportData
}

const GROUP_COLORS: Record<string, string> = {
  TIER1_AGENT: '#2563eb', // Blue
  SUPERMARKET: '#059669', // Emerald
  SMALL_SHOP: '#d97706', // Amber
  UNASSIGNED: '#64748b', // Slate
}

const emptySubscribe = () => () => {}

export function ReportsClient({ initialData }: ReportsClientProps) {
  const [data, setData] = useState<BusinessReportData>(initialData)
  const [preset, setPreset] = useState<DateRangePreset>(initialData.range.preset)
  const [grouping, setGrouping] = useState<ReportGrouping>(initialData.grouping)
  const [customFrom, setCustomFrom] = useState(initialData.range.fromText)
  const [customTo, setCustomTo] = useState(initialData.range.toText)
  const [isPending, startTransition] = useTransition()
  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  )

  const handleApplyFilter = (
    newPreset: DateRangePreset,
    newGrouping: ReportGrouping = grouping
  ) => {
    setPreset(newPreset)
    setGrouping(newGrouping)

    startTransition(async () => {
      const res = await getBusinessReports({
        preset: newPreset,
        grouping: newGrouping,
        customFrom: newPreset === 'CUSTOM' ? customFrom : undefined,
        customTo: newPreset === 'CUSTOM' ? customTo : undefined,
      })

      if (res.success && res.data) {
        setData(res.data)
        toast.success('Đã cập nhật dữ liệu báo cáo')
      } else {
        toast.error(res.error || 'Không thể tải dữ liệu báo cáo')
      }
    })
  }

  const {
    timeline,
    topProducts,
    cancellationAndComplaints,
    shrinkage,
    revenueByGroup,
    cashflow,
    range,
  } = data

  const pieChartData = revenueByGroup.groups.map((g) => ({
    name: g.groupName,
    value: g.revenue,
    code: g.groupCode,
  }))

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 sm:p-7 rounded-3xl border border-slate-200/90 shadow-card">
        <div className="space-y-1">
          <h1 className="font-heading text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2.5">
            <BarChart3 className="w-6 h-6 text-emerald-600" />
            Báo Cáo &amp; Thống Kê Kinh Doanh
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Tổng hợp doanh thu đơn hoàn thành, sản lượng bán, hao hụt thực tế và cơ cấu khách hàng.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-800 border-emerald-300 rounded-full px-3 py-1 font-semibold">
            Múi giờ Asia/Ho_Chi_Minh
          </Badge>
        </div>
      </div>

      {/* Required Clarification Alert (Mục B4) */}
      <div className="bg-blue-50/80 border border-blue-200 rounded-2xl p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
        <div className="text-xs sm:text-sm text-blue-900 leading-relaxed">
          <span className="font-semibold">Quy tắc ghi nhận:</span>{' '}
          <strong>Doanh thu từ các đơn được tạo trong kỳ và hiện đã hoàn thành.</strong> Bộ lọc áp
          dụng theo ngày tạo đơn (<code className="bg-blue-100 px-1.5 py-0.5 rounded text-xs font-mono font-semibold">Order.createdAt</code>
          ) theo múi giờ Việt Nam. Doanh thu tính theo giá trị tất toán cuối cùng (
          <code className="bg-blue-100 px-1.5 py-0.5 rounded text-xs font-mono font-semibold">finalTotal ?? total</code>), không cộng dồn trực tiếp giao dịch cọc để tránh trùng số liệu.
        </div>
      </div>

      {/* F03 Admin Executive AI Assistant */}
      <AdminAiAssistant />

      {/* Date Filter & Grouping Controls */}
      <Card className="rounded-3xl border-slate-200/90 shadow-card bg-white">
        <CardContent className="p-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Presets */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-500 flex items-center gap-1.5 mr-1 uppercase font-mono">
                <Calendar className="w-3.5 h-3.5 text-emerald-600" /> Chu kỳ:
              </span>
              <Button
                size="sm"
                variant={preset === '7D' ? 'default' : 'outline'}
                className={`rounded-full text-xs font-semibold px-4 h-9 ${preset === '7D' ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs' : 'border-slate-200 text-slate-700'}`}
                onClick={() => handleApplyFilter('7D')}
                disabled={isPending}
              >
                7 ngày qua
              </Button>
              <Button
                size="sm"
                variant={preset === '30D' ? 'default' : 'outline'}
                className={`rounded-full text-xs font-semibold px-4 h-9 ${preset === '30D' ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs' : 'border-slate-200 text-slate-700'}`}
                onClick={() => handleApplyFilter('30D')}
                disabled={isPending}
              >
                30 ngày qua
              </Button>
              <Button
                size="sm"
                variant={preset === 'THIS_MONTH' ? 'default' : 'outline'}
                className={`rounded-full text-xs font-semibold px-4 h-9 ${preset === 'THIS_MONTH' ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs' : 'border-slate-200 text-slate-700'}`}
                onClick={() => handleApplyFilter('THIS_MONTH')}
                disabled={isPending}
              >
                Tháng này
              </Button>
              <Button
                size="sm"
                variant={preset === 'CUSTOM' ? 'default' : 'outline'}
                className={`rounded-full text-xs font-semibold px-4 h-9 ${preset === 'CUSTOM' ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs' : 'border-slate-200 text-slate-700'}`}
                onClick={() => setPreset('CUSTOM')}
                disabled={isPending}
              >
                Tùy chỉnh
              </Button>
            </div>

            {/* Grouping */}
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-500 flex items-center gap-1.5 uppercase font-mono">
                <Filter className="w-3.5 h-3.5 text-emerald-600" /> Gom theo:
              </span>
              <div className="inline-flex rounded-full border border-slate-200 p-1 bg-slate-100">
                <button
                  type="button"
                  onClick={() => handleApplyFilter(preset, 'DAY')}
                  disabled={isPending}
                  className={`text-xs font-semibold px-3.5 py-1 rounded-full transition-all ${
                    grouping === 'DAY'
                      ? 'bg-white text-emerald-950 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Ngày
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyFilter(preset, 'WEEK')}
                  disabled={isPending}
                  className={`text-xs font-semibold px-3.5 py-1 rounded-full transition-all ${
                    grouping === 'WEEK'
                      ? 'bg-white text-emerald-950 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Tuần
                </button>
              </div>
            </div>
          </div>

          {/* Custom Date Range Inputs */}
          {preset === 'CUSTOM' && (
            <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600">Từ ngày:</span>
                <Input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-40 h-8 text-xs"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600">Đến ngày:</span>
                <Input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="w-40 h-8 text-xs"
                />
              </div>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs"
                onClick={() => handleApplyFilter('CUSTOM')}
                disabled={isPending}
              >
                Áp dụng khoảng ngày
              </Button>
            </div>
          )}

          <div className="mt-3 text-xs text-slate-400">
            Dữ liệu đang lọc: <strong>{range.fromText}</strong> đến <strong>{range.toText}</strong>
          </div>
        </CardContent>
      </Card>

      {/* Top 4 Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-slate-200">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                Doanh thu hoàn thành
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                {formatVND(timeline.totalRevenue)}
              </div>
              <div className="text-[11px] text-emerald-600 mt-1 flex items-center gap-1 font-medium">
                <TrendingUp className="w-3 h-3" /> {timeline.totalCompletedOrders} đơn hoàn tất
              </div>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <DollarSign className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                Sản lượng xuất bán
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                {timeline.totalKg.toLocaleString('vi-VN')} kg
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                ≈ {(timeline.totalKg / 1000).toFixed(2)} tấn nông sản
              </div>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <Package className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                Hao hụt thực tế TB
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                {shrinkage.hasMeasuredData ? `${shrinkage.shrinkageRate}%` : 'Chưa có'}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {shrinkage.hasMeasuredData
                  ? `Từ ${shrinkage.measuredItemsCount} mặt hàng đã cân`
                  : 'Chưa có đơn hoàn thành cân kg'}
              </div>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <Scale className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                Tỷ lệ hủy & khiếu nại
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                {cancellationAndComplaints.cancellationRate}% / {cancellationAndComplaints.complaintRate}%
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {cancellationAndComplaints.cancelledOrdersCount} đơn hủy / {cancellationAndComplaints.complaintOrdersCount} đơn khiếu nại
              </div>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-purple-100 text-purple-700 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 1. Biểu đồ Doanh thu theo Ngày / Tuần (Recharts) */}
      <Card className="border-slate-200">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                Biểu đồ Doanh thu & Sản lượng ({grouping === 'DAY' ? 'Theo ngày' : 'Theo tuần'})
              </CardTitle>
              <CardDescription className="text-xs text-slate-500 mt-1">
                Đơn vị: VNĐ. Chỉ tính các đơn hàng đã tất toán và chuyển sang trạng thái COMPLETED.
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-xs">
              Tổng {timeline.points.length} mốc thời gian
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {isMounted && timeline.points.length > 0 && (timeline.totalCompletedOrders > 0 || timeline.totalRevenue > 0) ? (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timeline.points} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="displayLabel"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={{ stroke: '#cbd5e1' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => (v >= 1000000 ? `${(v / 1000000).toFixed(1)}Tr` : `${v / 1000}k`)}
                  />
                  <Tooltip
                    formatter={(value: unknown, name: unknown) => [
                      name === 'revenue' ? formatVND(Number(value)) : `${value} kg`,
                      name === 'revenue' ? 'Doanh thu' : 'Sản lượng',
                    ]}
                    labelFormatter={(label) => `Thời gian: ${label}`}
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="revenue" name="revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-slate-400 text-sm gap-2">
              <BarChart3 className="w-8 h-8 text-slate-300 stroke-[1.5]" />
              <p>Không có dữ liệu đơn hoàn thành trong khoảng thời gian này</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2. Top 10 Sản phẩm bán chạy nhất */}
      <Card className="border-slate-200">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Package className="w-4 h-4 text-blue-600" />
                Top 10 Sản phẩm bán chạy nhất
              </CardTitle>
              <CardDescription className="text-xs text-slate-500 mt-1">
                Chỉ tính sản phẩm thương mại của đơn COMPLETED (ưu tiên kg thực giao sau cân). Hàng mẫu thử (
                {topProducts.sampleProductsCount} gói) được tách riêng không tính vào khối lượng sỉ.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="by-revenue">
            <TabsList className="mb-4">
              <TabsTrigger value="by-revenue" className="text-xs">
                Xếp theo Doanh thu (VNĐ)
              </TabsTrigger>
              <TabsTrigger value="by-volume" className="text-xs">
                Xếp theo Khối lượng (kg)
              </TabsTrigger>
            </TabsList>

            <TabsContent value="by-revenue">
              {topProducts.topByRevenue.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <Table>
                    <TableHeader className="bg-slate-50">
                      <TableRow>
                        <TableHead className="w-12 text-center text-xs">#</TableHead>
                        <TableHead className="text-xs">Sản phẩm</TableHead>
                        <TableHead className="text-right text-xs">Khối lượng xuất (kg)</TableHead>
                        <TableHead className="text-right text-xs">Số đơn hàng</TableHead>
                        <TableHead className="text-right text-xs font-bold">Doanh thu (VNĐ)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topProducts.topByRevenue.map((p, idx) => (
                        <TableRow key={p.productId}>
                          <TableCell className="text-center text-xs font-semibold text-slate-500">
                            {idx + 1}
                          </TableCell>
                          <TableCell className="text-xs font-medium text-slate-900">
                            {p.productName}
                          </TableCell>
                          <TableCell className="text-right text-xs text-slate-700">
                            {p.totalKg.toLocaleString('vi-VN')} kg
                          </TableCell>
                          <TableCell className="text-right text-xs text-slate-700">
                            {p.orderCount}
                          </TableCell>
                          <TableCell className="text-right text-xs font-bold text-emerald-600">
                            {formatVND(p.totalRevenue)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="p-8 text-center text-sm text-slate-400">
                  Chưa có sản phẩm hoàn thành bán ra trong kỳ
                </div>
              )}
            </TabsContent>

            <TabsContent value="by-volume">
              {topProducts.topByKg.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <Table>
                    <TableHeader className="bg-slate-50">
                      <TableRow>
                        <TableHead className="w-12 text-center text-xs">#</TableHead>
                        <TableHead className="text-xs">Sản phẩm</TableHead>
                        <TableHead className="text-right text-xs font-bold text-blue-600">
                          Khối lượng xuất (kg)
                        </TableHead>
                        <TableHead className="text-right text-xs">Số đơn hàng</TableHead>
                        <TableHead className="text-right text-xs">Doanh thu (VNĐ)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topProducts.topByKg.map((p, idx) => (
                        <TableRow key={p.productId}>
                          <TableCell className="text-center text-xs font-semibold text-slate-500">
                            {idx + 1}
                          </TableCell>
                          <TableCell className="text-xs font-medium text-slate-900">
                            {p.productName}
                          </TableCell>
                          <TableCell className="text-right text-xs font-bold text-blue-700">
                            {p.totalKg.toLocaleString('vi-VN')} kg
                          </TableCell>
                          <TableCell className="text-right text-xs text-slate-700">
                            {p.orderCount}
                          </TableCell>
                          <TableCell className="text-right text-xs font-medium text-slate-900">
                            {formatVND(p.totalRevenue)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="p-8 text-center text-sm text-slate-400">
                  Chưa có sản phẩm hoàn thành bán ra trong kỳ
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* 3 & 4. Grid 2 cột: Tỷ lệ hủy/khiếu nại & Tỷ lệ hao hụt */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tỷ lệ Hủy đơn & Khiếu nại */}
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-purple-600" />
              Tỷ lệ Hủy đơn & Khiếu nại chất lượng
            </CardTitle>
            <CardDescription className="text-xs text-slate-500 mt-1">
              Mẫu số: {cancellationAndComplaints.totalOrders} đơn thương mại (loại trừ đơn nháp DRAFT chưa xác nhận).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                <div className="text-xs text-slate-500">Tỷ lệ hủy chung</div>
                <div className="text-xl font-bold text-slate-900 mt-1">
                  {cancellationAndComplaints.cancellationRate}%
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {cancellationAndComplaints.cancelledOrdersCount} / {cancellationAndComplaints.totalOrders} đơn
                </div>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                <div className="text-xs text-slate-500">Tỷ lệ phát sinh khiếu nại</div>
                <div className="text-xl font-bold text-purple-700 mt-1">
                  {cancellationAndComplaints.complaintRate}%
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {cancellationAndComplaints.complaintOrdersCount} đơn ({cancellationAndComplaints.totalComplaintsCount} vụ việc)
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-700">Phân loại đối tượng hủy đơn:</div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between p-2 rounded bg-slate-50">
                  <span className="text-slate-600">Khách hàng chủ động hủy (CUSTOMER)</span>
                  <span className="font-semibold text-slate-900">
                    {cancellationAndComplaints.byCustomerCount} đơn ({cancellationAndComplaints.byCustomerRate}%)
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-slate-50">
                  <span className="text-slate-600">Bên bán hủy do thiếu hàng/sự cố (SELLER)</span>
                  <span className="font-semibold text-slate-900">
                    {cancellationAndComplaints.bySellerCount} đơn ({cancellationAndComplaints.bySellerRate}%)
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-slate-50">
                  <span className="text-slate-600">Hệ thống tự hủy quá hạn thanh toán (SYSTEM)</span>
                  <span className="font-semibold text-slate-900">
                    {cancellationAndComplaints.bySystemCount} đơn ({cancellationAndComplaints.bySystemRate}%)
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tỷ lệ Hao hụt thực tế */}
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Scale className="w-4 h-4 text-amber-600" />
              Tỷ lệ Hao hụt khối lượng thực tế
            </CardTitle>
            <CardDescription className="text-xs text-slate-500 mt-1">
              Công thức: <code className="bg-slate-100 px-1 py-0.5 rounded">1 - Σ(actualGrams) / Σ(orderedGrams)</code>.
              Chỉ tính các mặt hàng đã hoàn tất cân hàng thực tế.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {shrinkage.hasMeasuredData ? (
              <>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
                  <div className="text-xs font-medium text-amber-800 uppercase tracking-wider">
                    Tỷ lệ hao hụt bình quân có trọng số
                  </div>
                  <div className="text-3xl font-bold text-amber-900 mt-1">
                    {shrinkage.shrinkageRate}%
                  </div>
                  <div className="text-xs text-amber-700 mt-1">
                    Chênh lệch: {(shrinkage.shrinkageGrams / 1000).toFixed(1)} kg giữa đặt và thực giao
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <div className="text-slate-500">Tổng đặt (ordered):</div>
                    <div className="text-base font-bold text-slate-900 mt-0.5">
                      {(shrinkage.totalOrderedGrams / 1000).toLocaleString('vi-VN')} kg
                    </div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <div className="text-slate-500">Tổng giao thực tế (actual):</div>
                    <div className="text-base font-bold text-slate-900 mt-0.5">
                      {(shrinkage.totalActualGrams / 1000).toLocaleString('vi-VN')} kg
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-slate-500 italic">
                  * Dữ liệu thống kê dựa trên {shrinkage.measuredItemsCount} dòng sản phẩm thuộc các đơn hàng COMPLETED có ghi nhận phiếu cân.
                </div>
              </>
            ) : (
              <div className="p-8 text-center text-sm text-slate-400">
                Chưa có dòng sản phẩm nào được nhập khối lượng cân thực tế trong khoảng thời gian này.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 5. Doanh thu theo Nhóm khách hàng HIỆN TẠI (Mục B3 & B4) */}
      <Card className="border-slate-200">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-600" />
                Doanh thu theo nhóm khách hàng hiện tại
              </CardTitle>
              <CardDescription className="text-xs text-slate-500 mt-1">
                Gom doanh thu từ đơn COMPLETED theo nhóm thành viên HIỆN TẠI của tài khoản đặt hàng.
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-xs bg-slate-50">
              {revenueByGroup.groupCount} nhóm khách
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
            {/* Chart */}
            <div className="lg:col-span-1 h-56 flex items-center justify-center">
              {isMounted && pieChartData.length > 0 && revenueByGroup.totalRevenue > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieChartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={75}
                      innerRadius={45}
                      paddingAngle={3}
                    >
                      {pieChartData.map((entry) => (
                        <Cell
                          key={`cell-${entry.code}`}
                          fill={GROUP_COLORS[entry.code] || '#94a3b8'}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(val: unknown) => formatVND(Number(val))}
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        borderRadius: '8px',
                        border: '1px solid #e2e8f0',
                        fontSize: '12px',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-xs text-slate-400 text-center">Chưa có doanh thu trong kỳ</div>
              )}
            </div>

            {/* Table */}
            <div className="lg:col-span-2 overflow-x-auto rounded-lg border border-slate-200">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-xs">Nhóm khách hàng</TableHead>
                    <TableHead className="text-right text-xs">Số đơn</TableHead>
                    <TableHead className="text-right text-xs">Tỷ trọng</TableHead>
                    <TableHead className="text-right text-xs font-bold">Doanh thu (VNĐ)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revenueByGroup.groups.map((g) => (
                    <TableRow key={g.groupId}>
                      <TableCell className="text-xs font-medium text-slate-900 flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: GROUP_COLORS[g.groupCode] || '#94a3b8' }}
                        />
                        {g.groupName}
                      </TableCell>
                      <TableCell className="text-right text-xs text-slate-700">
                        {g.orderCount}
                      </TableCell>
                      <TableCell className="text-right text-xs text-slate-700">
                        {g.percentage}%
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold text-emerald-600">
                        {formatVND(g.revenue)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {revenueByGroup.groups.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-xs text-slate-400 py-6">
                        Chưa có dữ liệu doanh thu theo nhóm khách hàng
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 6. Phân tích Dòng tiền (Cashflow Breakdown - Mục B5) */}
      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Wallet className="w-4 h-4 text-emerald-600" />
            Phân tích Dòng tiền & Đối soát thanh toán
          </CardTitle>
          <CardDescription className="text-xs text-slate-500 mt-1">
            Phân biệt rõ ràng giữa doanh thu ghi nhận đơn hoàn thành và các dòng tiền thực tế qua cổng VietQR/Ngân hàng.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-xs text-slate-500">Doanh thu đơn hoàn tất</div>
              <div className="text-lg font-bold text-slate-900 mt-1">
                {formatVND(cashflow.completedRevenue)}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">Ghi nhận kế toán</div>
            </div>

            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
              <div className="text-xs text-emerald-800">Tiền đã thanh toán (DONE)</div>
              <div className="text-lg font-bold text-emerald-900 mt-1">
                {formatVND(cashflow.totalPaid)}
              </div>
              <div className="text-[11px] text-emerald-700 mt-1">Cọc + Phần thanh toán còn lại</div>
            </div>

            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200">
              <div className="text-xs text-rose-800">Tiền đã hoàn trả (DONE)</div>
              <div className="text-lg font-bold text-rose-900 mt-1">
                {formatVND(cashflow.totalRefunded)}
              </div>
              <div className="text-[11px] text-rose-700 mt-1">Hủy đơn, bồi thường, chênh lệch</div>
            </div>

            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
              <div className="text-xs text-amber-800">Tiền chờ hoàn (PENDING)</div>
              <div className="text-lg font-bold text-amber-900 mt-1">
                {formatVND(cashflow.pendingRefund)}
              </div>
              <div className="text-[11px] text-amber-700 mt-1">Chưa trừ vào tiền thực nhận</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
