'use client'

import { useState } from 'react'
import { SeasonStatus } from '@prisma/client'
import { Search, Filter, RefreshCw, X, Sparkles, Building2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ProductCard } from '@/components/shop/product-card'

interface ProductItem {
  id: string
  slug: string
  name: string
  images: string[]
  seasonStatus: SeasonStatus
  requiresCold: boolean
  moqGrams: number
  leadTimeDays: number
  preorderOpen: boolean
  preorderPricePerKg: number | null
  farmId: string
  farm: {
    id: string
    name: string
    province: string
  }
  priceTiers: {
    minGrams: number
    pricePerKg: number
  }[]
}

interface FarmOption {
  id: string
  name: string
  province: string
}

export function CatalogBrowser({
  products,
  farms,
  userDiscountPercent = 0,
}: {
  products: ProductItem[]
  farms: FarmOption[]
  userDiscountPercent?: number
}) {
  const [search, setSearch] = useState('')
  const [selectedSeason, setSelectedSeason] = useState<string>('ALL')
  const [selectedFarm, setSelectedFarm] = useState<string>('ALL')

  const resetFilters = () => {
    setSearch('')
    setSelectedSeason('ALL')
    setSelectedFarm('ALL')
  }

  const seasonCounts = {
    ALL: products.length,
    [SeasonStatus.HARVESTING]: products.filter(
      (p) => p.seasonStatus === SeasonStatus.HARVESTING
    ).length,
    [SeasonStatus.UPCOMING]: products.filter(
      (p) => p.seasonStatus === SeasonStatus.UPCOMING
    ).length,
    [SeasonStatus.OFF_SEASON]: products.filter(
      (p) => p.seasonStatus === SeasonStatus.OFF_SEASON
    ).length,
  }

  const seasonChips = [
    { key: 'ALL', label: 'Tất cả vụ mùa', count: seasonCounts.ALL },
    {
      key: SeasonStatus.HARVESTING,
      label: 'Đang thu hoạch',
      count: seasonCounts[SeasonStatus.HARVESTING],
      dotColor: 'bg-emerald-500',
    },
    {
      key: SeasonStatus.UPCOMING,
      label: 'Sắp vào vụ',
      count: seasonCounts[SeasonStatus.UPCOMING],
      dotColor: 'bg-amber-500',
    },
    {
      key: SeasonStatus.OFF_SEASON,
      label: 'Hết vụ mùa',
      count: seasonCounts[SeasonStatus.OFF_SEASON],
      dotColor: 'bg-slate-400',
    },
  ]

  const farmLabels: Record<string, string> = {
    ALL: 'Tất cả nhà vườn',
    ...Object.fromEntries(farms.map((f) => [f.id, `${f.name} (${f.province})`])),
  }

  const normalizeText = (text: string): string => {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd')
      .trim()
  }

  const filtered = products.filter((p) => {
    const query = normalizeText(search)
    const matchSearch =
      query === '' ||
      normalizeText(p.name).includes(query) ||
      normalizeText(p.farm.name).includes(query) ||
      normalizeText(p.farm.province).includes(query)

    const matchSeason =
      selectedSeason === 'ALL' || p.seasonStatus === selectedSeason

    const matchFarm = selectedFarm === 'ALL' || p.farmId === selectedFarm

    return matchSearch && matchSeason && matchFarm
  })

  const isFiltering =
    search.trim() !== '' || selectedSeason !== 'ALL' || selectedFarm !== 'ALL'

  return (
    <div className="space-y-8">
      {/* STITCH FILTER WORKSPACE CONTROL DECK */}
      <div className="rounded-3xl bg-white p-5 sm:p-6 border border-slate-200/90 shadow-xs space-y-5">
        {/* Row 1: Search & Farm Selector */}
        <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <Input
              placeholder="Tìm theo tên trái cây, giống quả, nhà vườn liên kết..."
              className="pl-11 pr-9 h-11 bg-slate-50/80 border-slate-200/90 rounded-full text-sm focus-visible:ring-emerald-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="w-full md:w-64">
              <Select
                value={selectedFarm}
                onValueChange={(val) => {
                  if (val) setSelectedFarm(val)
                }}
              >
                <SelectTrigger className="bg-slate-50/80 border-slate-200/90 rounded-full h-11 text-xs truncate px-4">
                  <div className="flex items-center gap-2 truncate">
                    <Building2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <SelectValue placeholder="Nhà vườn">
                      {farmLabels[selectedFarm] || 'Nhà vườn'}
                    </SelectValue>
                  </div>
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="ALL">Tất cả nhà vườn ({farms.length})</SelectItem>
                  {farms.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name} ({f.province})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isFiltering && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="h-11 px-4 rounded-full text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                <span>Đặt lại</span>
              </Button>
            )}
          </div>
        </div>

        {/* Row 2: Horizontal Season Filter Switcher (Stitch Pill Switcher) */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1 border-t border-slate-100">
          <span className="text-xs font-semibold text-slate-500 mr-1 shrink-0 uppercase tracking-wider text-[11px]">
            Mùa vụ:
          </span>
          {seasonChips.map((chip) => {
            const isActive = selectedSeason === chip.key
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => setSelectedSeason(chip.key)}
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200/80'
                }`}
              >
                {chip.dotColor && !isActive && (
                  <span className={`w-2 h-2 rounded-full ${chip.dotColor}`} />
                )}
                <span>{chip.label}</span>
                <span
                  className={`text-[11px] px-1.5 py-0.2 rounded-full ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-white text-slate-500 border border-slate-200/60'
                  }`}
                >
                  {chip.count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* RESULTS HEADER & PARTNER STATUS */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-slate-500 px-1">
        <div className="flex items-center gap-2">
          <span>
            Hiển thị <strong className="text-slate-900 font-bold">{filtered.length}</strong> sản phẩm phù hợp
          </span>
          {isFiltering && (
            <span className="text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              Đang lọc kết quả
            </span>
          )}
        </div>

        {userDiscountPercent > 0 && (
          <div className="inline-flex items-center gap-1.5 text-emerald-800 font-semibold bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 shadow-2xs">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            <span>Đang áp dụng chiết khấu đối tác B2B: -{userDiscountPercent}%</span>
          </div>
        )}
      </div>

      {/* PRODUCT GRID RESPONSIVE (STITCH 4-COLUMN MATRIX) */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-3xl border border-slate-200/90 p-8 space-y-4 shadow-xs">
          <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
            <Filter className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="font-heading font-bold text-base text-slate-800">
              Không tìm thấy sản phẩm phù hợp
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
              Vui lòng thử thay đổi từ khóa tìm kiếm hoặc lọc lại theo trạng thái vụ mùa khác.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={resetFilters}
            className="rounded-full px-5 text-xs border-slate-300 hover:border-emerald-400 hover:bg-emerald-50/50"
          >
            Xóa bộ lọc
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filtered.map((p) => (
            <ProductCard
              key={p.id}
              slug={p.slug}
              name={p.name}
              images={p.images}
              seasonStatus={p.seasonStatus}
              requiresCold={p.requiresCold}
              moqGrams={p.moqGrams}
              leadTimeDays={p.leadTimeDays}
              preorderOpen={p.preorderOpen}
              preorderPricePerKg={p.preorderPricePerKg}
              farm={p.farm}
              priceTiers={p.priceTiers}
              userDiscountPercent={userDiscountPercent}
            />
          ))}
        </div>
      )}
    </div>
  )
}
