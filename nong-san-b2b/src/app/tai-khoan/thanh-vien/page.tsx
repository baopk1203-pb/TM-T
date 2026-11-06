import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getServerAuthSession } from '@/lib/auth'
import { getMembershipDashboardData } from '@/lib/server/membership-dashboard'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Award,
  Calendar,
  Clock,
  ShieldCheck,
  TrendingUp,
  AlertCircle,
  Truck,
  Percent,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function MembershipDashboardPage() {
  const session = await getServerAuthSession()
  if (!session?.user?.id) {
    redirect('/dang-nhap?callbackUrl=/tai-khoan/thanh-vien')
  }

  const data = await getMembershipDashboardData(session.user.id)
  if (!data) {
    redirect('/dang-nhap')
  }

  return (
    <div className="space-y-6">
      {/* Tiêu đề trang */}
      <div>
        <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
          <Link href="/tai-khoan" className="hover:text-slate-900">
            Tài khoản
          </Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-slate-900 font-medium">Hạng thành viên & KPI</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Hạng Thành Viên & Thẻ Điểm KPI</h1>
        <p className="text-sm text-slate-600 mt-1">
          Chương trình đối tác thân thiết B2B với chiết khấu minh bạch và quyền lợi vận chuyển theo quý.
        </p>
      </div>

      {/* Thông báo bảo lưu 15 ngày cuối quý (nếu thuộc diện) */}
      {data.nextEvaluation.isCarryoverUser && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 sm:p-5 flex items-start gap-3.5">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1 text-sm">
            <div className="font-semibold text-amber-900">Chính sách bảo lưu 15 ngày cuối quý</div>
            <p className="text-amber-800 leading-relaxed">{data.nextEvaluation.carryoverMessage}</p>
          </div>
        </div>
      )}

      {/* Overview Cards: Hạng hiện tại & Điểm KPI gần nhất */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: Hạng hiện tại */}
        <Card className="rounded-2xl border-slate-200 shadow-sm md:col-span-1">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
              <Award className="w-4 h-4 text-emerald-600" /> Hạng hiện tại
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900 flex items-center justify-between">
              <span>{data.tierDisplayName}</span>
              <Badge variant="outline" className={`text-xs px-2.5 py-0.5 font-semibold ${data.tierBadgeColor}`}>
                {data.tierDisplayName}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-slate-600 pt-1">
            <div>
              <span className="text-slate-500">Trạng thái: </span>
              <strong className="text-slate-800 font-medium">{data.tierStatusLabel}</strong>
            </div>
            {data.tierUpdatedAtText && (
              <div>
                <span className="text-slate-500">Cập nhật: </span>
                <span className="text-slate-700">{data.tierUpdatedAtText}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Card 2: Điểm KPI gần nhất */}
        <Card className="rounded-2xl border-slate-200 shadow-sm md:col-span-1">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-blue-600" /> Điểm KPI gần nhất
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900">
              {data.latestEvaluation ? (
                <span className="text-emerald-700">
                  {data.latestEvaluation.score} <span className="text-sm font-normal text-slate-500">/ 100 điểm</span>
                </span>
              ) : (
                <span className="text-slate-400 text-lg font-medium">Chưa đánh giá</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600 pt-1">
            {data.latestEvaluation ? (
              <div className="space-y-1">
                <div>
                  <span className="text-slate-500">Kỳ xét: </span>
                  <strong className="text-slate-800">{data.latestEvaluation.quarterName}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Ngày xét: </span>
                  <span className="text-slate-700">{data.latestEvaluation.evaluatedAtText}</span>
                </div>
              </div>
            ) : (
              <p className="text-slate-500 italic">
                Đang tích lũy doanh số và sản lượng cho kỳ đánh giá đầu tiên.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Card 3: Kỳ xét hạng dự kiến tiếp theo */}
        <Card className="rounded-2xl border-slate-200 shadow-sm md:col-span-1">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-purple-600" /> Kỳ xét hạng tiếp theo
            </CardDescription>
            <CardTitle className="text-xl font-bold text-slate-900">
              {data.nextEvaluation.nextEvaluationDateText}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600 pt-1 space-y-1">
            <div>
              <span className="text-slate-500">Quý đánh giá: </span>
              <strong className="text-slate-800">{data.nextEvaluation.quarterBeingEvaluatedText}</strong>
            </div>
            <p className="text-slate-500 text-[11px] leading-tight">
              Tự động xét duyệt định kỳ vào ngày 01 của mỗi quý dương lịch.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Bảng chính sách quyền lợi 4 hạng */}
      <Card className="rounded-2xl border-slate-200 shadow-sm overflow-hidden">
        <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-4">
          <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            Chính Sách Quyền Lợi Hạng Thành Viên B2B
          </CardTitle>
          <CardDescription className="text-xs text-slate-500">
            Chiết khấu sản phẩm và hỗ trợ chi phí vận chuyển theo từng mức xếp hạng (Thang điểm 0–100).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100/75 text-xs text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 sm:px-6">Hạng thành viên</th>
                  <th className="py-3 px-4">Thang điểm KPI</th>
                  <th className="py-3 px-4">Chiết khấu sản phẩm</th>
                  <th className="py-3 px-4">Giảm phí vận chuyển</th>
                  <th className="py-3 px-4 sm:px-6 text-right">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {data.benefitsTable.map((row) => (
                  <tr
                    key={row.tier}
                    className={`transition-colors ${
                      row.isCurrent ? 'bg-emerald-50/50 font-medium' : 'hover:bg-slate-50/60'
                    }`}
                  >
                    <td className="py-3.5 px-4 sm:px-6">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{row.name}</span>
                        {row.isCurrent && (
                          <Badge className="bg-emerald-600 text-white text-[10px] px-2 py-0.2">Hạng của bạn</Badge>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-slate-600">{row.scoreRange}</td>
                    <td className="py-3.5 px-4">
                      <span className="text-emerald-700 font-semibold flex items-center gap-1">
                        <Percent className="w-3.5 h-3.5 text-emerald-600" />
                        -{row.productDiscountPercent}%
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="text-blue-700 font-semibold flex items-center gap-1">
                        <Truck className="w-3.5 h-3.5 text-blue-600" />
                        -{row.shippingDiscountPercent}%
                      </span>
                    </td>
                    <td className="py-3.5 px-4 sm:px-6 text-right">
                      {row.isCurrent ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-semibold">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Đang áp dụng
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Ghi chú điều kiện chính sách */}
          <div className="bg-slate-50 border-t border-slate-100 p-4 sm:px-6 text-xs text-slate-600 space-y-1.5">
            <div className="font-semibold text-slate-800">Điều kiện áp dụng chính sách:</div>
            <ul className="list-disc pl-5 space-y-1 text-slate-600">
              <li>
                <strong>Trần chiết khấu cộng dồn:</strong> Tổng chiết khấu sản phẩm (nhóm khách hàng + hạng thành viên) tối đa không vượt quá <strong>10%</strong>.
              </li>
              <li>
                <strong>Ngưỡng giảm phí vận chuyển:</strong> Ưu đãi giảm phí vận chuyển theo hạng chỉ áp dụng cho các đơn hàng đạt tổng khối lượng từ <strong>50 kg</strong> trở lên.
              </li>
              <li>
                <strong>Mức giảm ship tối đa:</strong> Mức giảm phí vận chuyển tối đa là <strong>100.000 đ / đơn hàng</strong>.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Lịch sử xét hạng định kỳ */}
      <Card className="rounded-2xl border-slate-200 shadow-sm overflow-hidden">
        <CardHeader className="border-b border-slate-100 bg-slate-50/50 pb-4">
          <CardTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Clock className="w-5 h-5 text-slate-600" />
            Lịch Sử Xét Hạng Thành Viên
          </CardTitle>
          <CardDescription className="text-xs text-slate-500">
            Lịch sử điểm KPI và kết quả thăng / giáng hạng qua các quý dương lịch.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.history.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                <Clock className="w-6 h-6" />
              </div>
              <div className="font-medium text-slate-800 text-sm">Chưa có lịch sử xét hạng</div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Tài khoản của bạn chưa qua kỳ đánh giá định kỳ nào. Dữ liệu giao dịch đang được tự động tích lũy và sẽ hiển thị kết quả tại đây sau kỳ xét duyệt tiếp theo.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100/75 text-xs text-slate-700 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4 sm:px-6">Kỳ đánh giá</th>
                    <th className="py-3 px-4">Điểm KPI</th>
                    <th className="py-3 px-4">Hạng trước</th>
                    <th className="py-3 px-4">Hạng mới</th>
                    <th className="py-3 px-4 sm:px-6 text-right">Ngày xét duyệt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {data.history.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3.5 px-4 sm:px-6 font-semibold text-slate-900">{item.quarterName}</td>
                      <td className="py-3.5 px-4">
                        <span className="font-bold text-emerald-700">{item.score}</span>{' '}
                        <span className="text-xs text-slate-500">/ 100</span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">{item.previousTierName}</td>
                      <td className="py-3.5 px-4">
                        <Badge variant="outline" className="font-semibold text-xs px-2 py-0.5">
                          {item.newTierName}
                        </Badge>
                      </td>
                      <td className="py-3.5 px-4 sm:px-6 text-right text-xs text-slate-500">
                        {item.evaluatedAtText}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
