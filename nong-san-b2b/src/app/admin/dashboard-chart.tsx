'use client'

import { useSyncExternalStore } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { formatVND } from '@/lib/money'
import { TrendingUp, Sparkles } from 'lucide-react'

export interface ChartRevenuePoint {
  periodKey?: string
  displayLabel?: string
  date?: string
  revenue: number
  orderCount: number
  totalKg?: number
}

interface DashboardChartProps {
  points: ChartRevenuePoint[]
  totalRevenue: number
  totalOrders: number
}

const emptySubscribe = () => () => {}

export function DashboardChart({ points, totalRevenue, totalOrders }: DashboardChartProps) {
  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  )

  if (!isMounted) {
    return (
      <div className="w-full h-64 bg-slate-50/60 rounded-2xl flex items-center justify-center border border-slate-100">
        <span className="text-xs text-slate-400 font-medium">Đang tải biểu đồ doanh thu...</span>
      </div>
    )
  }

  if (!points || points.length === 0 || totalRevenue === 0) {
    return (
      <div className="w-full h-64 bg-slate-50/60 rounded-2xl flex flex-col items-center justify-center border border-slate-100 text-center p-6 space-y-2">
        <TrendingUp className="w-8 h-8 text-slate-300" />
        <p className="text-xs font-semibold text-slate-600">Chưa có giao dịch phát sinh trong 7 ngày qua</p>
        <p className="text-[11px] text-slate-400 max-w-xs">
          Biểu đồ sẽ tự động hiển thị khi có đơn hàng được thanh toán hoặc giao dịch thành công.
        </p>
      </div>
    )
  }

  // Format date label for chart (DD/MM)
  const chartData = points.map((p) => {
    const rawDate = p.date || p.periodKey || ''
    const parts = rawDate.split('-')
    const shortLabel = p.displayLabel || (parts.length === 3 ? `${parts[2]}/${parts[1]}` : rawDate)
    return {
      date: p.displayLabel || rawDate,
      displayDate: shortLabel,
      revenue: p.revenue,
      orderCount: p.orderCount,
    }
  })

  return (
    <div className="space-y-4">
      <div className="w-full h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
            <XAxis
              dataKey="displayDate"
              stroke="#64748B"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: '#E2E8F0' }}
            />
            <YAxis
              stroke="#64748B"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => {
                if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}M`
                if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`
                return String(v)
              }}
            />
            <Tooltip
              formatter={(val: unknown) => [formatVND(Number(val) || 0), 'Doanh thu']}
              labelFormatter={(label, payload) => {
                const item = payload && payload[0]?.payload as { date?: string; orderCount?: number } | undefined
                return `Ngày ${item?.date || label} (${item?.orderCount || 0} đơn)`
              }}
              contentStyle={{
                backgroundColor: '#0F172A',
                border: 'none',
                borderRadius: '1rem',
                color: '#FFFFFF',
                fontSize: '12px',
                padding: '8px 12px',
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
              }}
            />
            <Bar
              dataKey="revenue"
              fill="#059669"
              radius={[6, 6, 0, 0]}
              maxBarSize={44}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs text-slate-500 gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
          <span>Tổng doanh thu 7 ngày: <strong className="text-slate-900 font-bold">{formatVND(totalRevenue)}</strong></span>
        </div>
        <span>Tổng đơn phát sinh: <strong className="text-slate-900 font-bold">{totalOrders} đơn</strong></span>
      </div>
    </div>
  )
}
