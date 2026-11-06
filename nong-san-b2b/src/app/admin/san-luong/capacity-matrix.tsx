'use client'

import { useState } from 'react'
import { SeasonStatus } from '@prisma/client'
import { CalendarRange, Save, Loader2, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from 'sonner'
import { gramsToKg, kgToGrams } from '@/lib/money'
import { setWeeklyCapacity } from '@/server/actions/capacity'

interface WeekInfo {
  weekIndex: number
  weekStart: Date | string
  label: string
}

interface ProductInfo {
  id: string
  name: string
  slug: string
  moqGrams: number
  seasonStatus: SeasonStatus
  farm: { name: string }
}

interface CapacityRecord {
  id: string
  productId: string
  weekStart: Date | string
  maxGrams: number
}

export function CapacityMatrix({
  weeks,
  products,
  initialCapacities,
}: {
  weeks: WeekInfo[]
  products: ProductInfo[]
  initialCapacities: CapacityRecord[]
}) {
  // Matrix data key: `${productId}_${weekIndex}` -> number in kg
  const [matrix, setMatrix] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {}

    products.forEach((p) => {
      weeks.forEach((w, wIdx) => {
        const key = `${p.id}_${wIdx}`
        const wStartTime = new Date(w.weekStart).getTime()

        const match = initialCapacities.find(
          (c) =>
            c.productId === p.id &&
            new Date(c.weekStart).getTime() === wStartTime
        )

        initial[key] = match ? gramsToKg(match.maxGrams) : 0
      })
    })

    return initial
  })

  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({})

  const handleValueChange = (productId: string, weekIndex: number, val: number) => {
    const key = `${productId}_${weekIndex}`
    setMatrix((prev) => ({ ...prev, [key]: val }))
  }

  const handleSaveCell = async (productId: string, weekIndex: number) => {
    const key = `${productId}_${weekIndex}`
    const kg = matrix[key] || 0
    const week = weeks[weekIndex]

    setSavingKeys((prev) => ({ ...prev, [key]: true }))
    try {
      const res = await setWeeklyCapacity(productId, week.weekStart, kgToGrams(kg))
      if (!res.success) {
        toast.error('Lỗi khi lưu sản lượng')
      } else {
        toast.success(
          kg > 0
            ? `Đã cập nhật ${kg.toLocaleString('vi-VN')} kg cho ${week.label}`
            : `Đã mở không giới hạn cho ${week.label}`
        )
      }
    } catch {
      toast.error('Lỗi kết nối máy chủ')
    } finally {
      setSavingKeys((prev) => ({ ...prev, [key]: false }))
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 sm:p-7 rounded-3xl border border-slate-200/90 shadow-card">
        <div className="space-y-1">
          <h1 className="font-heading text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2.5">
            <CalendarRange className="w-6 h-6 text-emerald-600" />
            Năng Lực Sản Lượng Theo Tuần
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Kiểm soát tổng sản lượng nông sản tươi nhận đặt trong 4 tuần tới (nhập 0 để mở Không giới hạn).
          </p>
        </div>
      </div>

      <div className="bg-amber-50/80 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 flex items-start gap-3">
        <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="leading-relaxed">
          <strong>Cơ chế nông sản B2B:</strong> Nông sản tươi cắt theo lứa thu hoạch nên hệ thống dùng <strong>Weekly Capacity</strong> thay cho tồn kho tĩnh. Khi khách đặt hàng, hệ thống cộng dồn tổng kg của các đơn cùng tuần giao; nếu vượt quá mức tối đa này, hệ thống sẽ chặn nhận thêm đơn mới.
        </div>
      </div>

      <div className="bg-white rounded-3xl border border-slate-200/90 overflow-hidden shadow-card">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="w-64 font-bold text-slate-900">Sản phẩm & Vườn</TableHead>
                <TableHead className="w-24 text-center font-bold text-slate-700">MOQ</TableHead>
                {weeks.map((w) => (
                  <TableHead key={w.weekIndex} className="text-center font-bold text-slate-900 min-w-[200px]">
                    <div>{w.label}</div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.id} className="hover:bg-slate-50/80">
                  <TableCell className="font-medium">
                    <div className="font-bold text-slate-900">{p.name}</div>
                    <div className="text-xs text-slate-500">Vườn: {p.farm.name}</div>
                    <div className="mt-1">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          p.seasonStatus === SeasonStatus.HARVESTING
                            ? 'border-emerald-300 text-emerald-700 bg-emerald-50'
                            : p.seasonStatus === SeasonStatus.UPCOMING
                            ? 'border-amber-300 text-amber-700 bg-amber-50'
                            : 'border-slate-300 text-slate-600'
                        }`}
                      >
                        {p.seasonStatus === SeasonStatus.HARVESTING
                          ? 'Đang thu hoạch'
                          : p.seasonStatus === SeasonStatus.UPCOMING
                          ? 'Sắp vào vụ'
                          : 'Hết vụ'}
                      </Badge>
                    </div>
                  </TableCell>

                  <TableCell className="text-center font-semibold text-slate-700 text-xs">
                    {gramsToKg(p.moqGrams)} kg
                  </TableCell>

                  {weeks.map((w) => {
                    const key = `${p.id}_${w.weekIndex}`
                    const currentKg = matrix[key] || 0
                    const isSaving = savingKeys[key] || false

                    return (
                      <TableCell key={w.weekIndex} className="p-3">
                        <div className="flex flex-col gap-1.5 bg-slate-50 p-2 rounded-lg border border-slate-100">
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              min={0}
                              step={100}
                              className="h-8 text-xs bg-white font-semibold"
                              value={currentKg}
                              onChange={(e) =>
                                handleValueChange(
                                  p.id,
                                  w.weekIndex,
                                  parseFloat(e.target.value) || 0
                                )
                              }
                            />
                            <span className="text-xs text-slate-500 shrink-0">kg</span>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleSaveCell(p.id, w.weekIndex)}
                              disabled={isSaving}
                              className="h-8 w-8 p-0 bg-white text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 shrink-0"
                            >
                              {isSaving ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Save className="w-3.5 h-3.5" />
                              )}
                            </Button>
                          </div>

                          <div className="text-[11px] text-slate-500 flex items-center justify-between">
                            <span>
                              {currentKg > 0 ? (
                                <span className="text-emerald-700 font-medium">
                                  {(currentKg / 1000).toFixed(1)} tấn
                                </span>
                              ) : (
                                <span className="text-slate-400 italic">Không giới hạn</span>
                              )}
                            </span>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  handleValueChange(p.id, w.weekIndex, 5000)
                                }}
                                className="text-[10px] text-slate-600 hover:text-slate-900 underline"
                              >
                                5T
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  handleValueChange(p.id, w.weekIndex, 10000)
                                }}
                                className="text-[10px] text-slate-600 hover:text-slate-900 underline"
                              >
                                10T
                              </button>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
