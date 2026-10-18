import Link from 'next/link'
import { StorefrontHeader } from '@/components/shop/storefront-header'
import { db } from '@/lib/db'
import { MapPin, Award, Building2, ArrowRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

export default async function FarmsDirectoryPage() {
  const farms = await db.farm.findMany({
    orderBy: { name: 'asc' },
    include: {
      certificates: {
        where: { expiresAt: { gt: new Date() } },
      },
      products: {
        where: { isActive: true },
        select: { id: true, name: true },
      },
    },
  })

  return (
    <div className="min-h-screen flex flex-col bg-slate-50/50">
      <StorefrontHeader />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-8">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            Mạng Lưới Nhà Vườn & Hợp Tác Xã Liên Kết
          </h1>
          <p className="text-sm text-slate-600 mt-1 max-w-2xl">
            Các vùng trồng chuyên canh sầu riêng, bưởi da xanh, bơ sáp và xoài cát đạt tiêu chuẩn VietGAP, GlobalGAP tại Tiền Giang, Bến Tre và Đắk Lắk.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {farms.map((f) => (
            <Card key={f.id} className="border-slate-200 overflow-hidden hover:shadow-md transition-shadow flex flex-col">
              <div className="h-48 w-full bg-slate-100 relative overflow-hidden">
                {f.images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.images[0]} alt={f.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400">
                    <Building2 className="w-12 h-12 stroke-[1.5]" />
                  </div>
                )}
                <div className="absolute top-3 right-3">
                  <Badge className="bg-slate-900/80 backdrop-blur-sm text-white">
                    {f.products.length} loại nông sản
                  </Badge>
                </div>
              </div>

              <CardContent className="p-5 flex-1 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <h3 className="font-bold text-slate-900 text-lg">{f.name}</h3>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <MapPin className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{f.addressText}, {f.province}</span>
                  </div>
                  <p className="text-xs text-slate-600 line-clamp-3 leading-relaxed">
                    {f.description}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <div className="flex flex-wrap gap-1">
                    {f.certificates.length > 0 ? (
                      f.certificates.map((cert) => (
                        <Badge
                          key={cert.id}
                          variant="outline"
                          className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300"
                        >
                          <Award className="w-3 h-3 mr-0.5 inline" /> {cert.type}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-[11px] text-slate-400 italic">Chưa có chứng nhận còn hiệu lực</span>
                    )}
                  </div>

                  <Link href={`/nha-vuon/${f.slug}`}>
                    <Button size="sm" variant="outline" className="text-xs gap-1">
                      Xem hồ sơ <ArrowRight className="w-3 h-3" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>

      <footer className="bg-white border-t border-slate-200 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-slate-500">
          <p>© 2026 Nông Sản B2B - Đồ án môn Thương mại Điện tử</p>
        </div>
      </footer>
    </div>
  )
}
