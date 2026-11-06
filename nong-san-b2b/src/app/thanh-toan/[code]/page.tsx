import { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getServerAuthSession } from '@/lib/auth'
import { computePayableAmount } from '@/lib/domain/settlement'
import { processExpiredOrders } from '@/lib/services/order-expiration'
import { StorefrontHeader } from '@/components/shop/storefront-header'
import { StorefrontFooter } from '@/components/shop/storefront-footer'
import { PaymentView } from './payment-view'

export const metadata: Metadata = {
  title: 'Thanh Toán Đơn Hàng | E Vibe',
  description: 'Mã QR thanh toán chuyển khoản VietQR cho đơn hàng nông sản B2B.',
}

export const dynamic = 'force-dynamic'

export default async function OrderPaymentPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const session = await getServerAuthSession()

  if (!session?.user?.id) {
    redirect(`/dang-nhap?callbackUrl=/thanh-toan/${code}`)
  }

  // Tự động kiểm tra và hủy đơn quá hạn 10 phút theo giờ Server (EV-IMP-01C)
  await processExpiredOrders(new Date()).catch(() => undefined)

  const order = await db.order.findUnique({
    where: { code },
    include: {
      items: true,
      transactions: true,
    },
  })

  if (!order) {
    notFound()
  }

  // Khách chỉ được xem đơn của mình (Admin xem được tất cả)
  if (order.userId !== session.user.id && session.user.role !== 'ADMIN') {
    notFound()
  }

  const bankBin = process.env.VIETQR_BANK_BIN || '970422'
  const accountNo = process.env.VIETQR_ACCOUNT_NO || '0901234567'
  const accountName = process.env.VIETQR_ACCOUNT_NAME || 'CONG TY CP NONG SAN B2B'

  // Tính số tiền thực tế cần thanh toán sau khi trừ các giao dịch PAYMENT DONE
  const payable = computePayableAmount(order, order.transactions)
  const amountToPay = payable.amountToPay

  const vietQrUrl =
    payable.isPayable && amountToPay > 0
      ? `https://img.vietqr.io/image/${bankBin}-${accountNo}-compact2.png?amount=${amountToPay}&addInfo=${order.code}&accountName=${encodeURIComponent(accountName)}`
      : ''

  return (
    <div className="min-h-screen flex flex-col bg-slate-50/50">
      <StorefrontHeader />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <PaymentView
          order={order}
          vietQrUrl={vietQrUrl}
          bankInfo={{ bankBin, accountNo, accountName }}
          payable={payable}
        />
      </main>

      <StorefrontFooter />
    </div>
  )
}
