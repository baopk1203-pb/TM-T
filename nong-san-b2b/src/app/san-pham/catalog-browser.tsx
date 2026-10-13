'use client'

import { useState } from 'react'
import { SeasonStatus } from '@prisma/client'
import { Search, Filter, RefreshCw } from 'lucide-react'
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

  const filtered = products.filter((p) => {
    const matchSearch =
      search.trim() === '' ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.farm.name.toLowerCase().includes(search.toLowerCase()) ||
      p.farm.province.toLowerCase().includes(search.toLowerCase())

    const matchSeason =
      selectedSeason === 'ALL' || p.seasonStatus === selectedSeason

    const matchFarm = selectedFarm === 'ALL' || p.farmId === selectedFarm

    return matchSearch && matchSeason && matchFarm
  })

  return (
    <div className="space-y-8">
      {/* Filter and Search Bar */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <Input
            placeholder="Tìm theo tên trái cây, giống quả, nhà vườn..."
            className="pl-10 bg-slate-50 border-slate-200"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap sm:flex-nowrap gap-3 items-center">
          <div className="w-full sm:w-48">
            <Select
              value={selectedSeason}
              onValueChange={(val) => {
                if (val) setSelectedSeason(val)
              }}
            >
              <SelectTrigger className="bg-slate-50 border-slate-200 text-xs">
                <SelectValue placeholder="Mùa vụ" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tất cả vụ mùa</SelectItem>
                <SelectItem value={SeasonStatus.HARVESTING}>Đang thu hoạch</SelectItem>
                <SelectItem value={SeasonStatus.UPCOMING}>Sắp vào vụ (Pre-order)</SelectItem>
                <SelectItem value={SeasonStatus.OFF_SEASON}>Hết mùa</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="w-full sm:w-52">
            <Select
              value={selectedFarm}
              onValueChange={(val) => {
                if (val) setSelectedFarm(val)
              }}
            >
              <SelectTrigger className="bg-slate-50 border-slate-200 text-xs">
                <SelectValue placeholder="Nhà vườn" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tất cả nhà vườn</SelectItem>
                {farms.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name} ({f.province})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(search || selectedSeason !== 'ALL' || selectedFarm !== 'ALL') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Đặt lại
            </Button>
          )}
        </div>
      </div>

      {/* Results Header */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          Hiển thị <strong>{filtered.length}</strong> sản phẩm phù hợp
        </span>
        {userDiscountPercent > 0 && (
          <span className="text-emerald-700 font-semibold bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
            Đang áp dụng chiết khấu đối tác: -{userDiscountPercent}%
          </span>
        )}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200 p-8 space-y-3">
          <Filter className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="text-base font-bold text-slate-700">Không tìm thấy sản phẩm phù hợp</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Vui lòng thử thay đổi từ khóa tìm kiếm hoặc lọc lại theo trạng thái vụ mùa khác.
          </p>
          <Button variant="outline" size="sm" onClick={resetFilters} className="text-xs">
            Xóa bộ lọc
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
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
