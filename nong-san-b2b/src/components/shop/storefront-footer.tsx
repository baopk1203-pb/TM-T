import Link from 'next/link'
import { BrandLogo } from '@/components/ui/brand-logo'
import { ShieldCheck, Award, QrCode } from 'lucide-react'

export function StorefrontFooter() {
  return (
    <footer className="bg-white border-t border-emerald-100/70 py-10 mt-auto transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
          {/* Cột 1: Thương hiệu E Vibe & Giới thiệu */}
          <div className="space-y-3">
            <BrandLogo size="md" />
            <p className="text-xs text-slate-600 leading-relaxed max-w-sm">
              Hệ thống phân phối sỉ trái cây tươi từ nhà vườn VietGAP/GlobalGAP tới đại lý, siêu thị và F&B.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-semibold">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> VietGAP
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-semibold">
                <Award className="w-3.5 h-3.5 text-emerald-600" /> GlobalGAP
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-semibold">
                <QrCode className="w-3.5 h-3.5 text-slate-600" /> Truy Xuất QR
              </span>
            </div>
          </div>

          {/* Cột 2: Điều hướng nhanh */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 font-heading">
              Danh mục hệ thống
            </h4>
            <ul className="space-y-2 text-xs text-slate-600">
              <li>
                <Link href="/" className="hover:text-emerald-700 transition-colors">
                  Trang chủ
                </Link>
              </li>
              <li>
                <Link href="/san-pham" className="hover:text-emerald-700 transition-colors">
                  Sản phẩm vụ mùa
                </Link>
              </li>
              <li>
                <Link href="/nha-vuon" className="hover:text-emerald-700 transition-colors">
                  Hồ sơ nhà vườn
                </Link>
              </li>
              <li>
                <Link href="/truy-xuat" className="hover:text-emerald-700 transition-colors">
                  Truy xuất QR lô hàng
                </Link>
              </li>
              <li>
                <Link href="/gio-hang" className="hover:text-emerald-700 transition-colors">
                  Giỏ hàng & Báo giá sỉ
                </Link>
              </li>
            </ul>
          </div>

          {/* Cột 3: Về nền tảng */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 font-heading">
              Về nền tảng
            </h4>
            <div className="text-xs text-slate-600 space-y-2 leading-relaxed">
              <p>
                Nền tảng thương mại điện tử B2B kết nối nhà vườn tiêu chuẩn VietGAP & GlobalGAP trực tiếp với khách hàng doanh nghiệp.
              </p>
              <p className="text-[11px] text-slate-500">
                Đồ án môn Thương mại Điện tử.
              </p>
            </div>
          </div>
        </div>

        {/* Bản quyền */}
        <div className="pt-6 border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <p>© 2026 E Vibe - Hệ thống cung ứng trái cây tận vườn. Đồ án môn Thương mại Điện tử.</p>
          <p>Mọi quyền được bảo lưu.</p>
        </div>
      </div>
    </footer>
  )
}
