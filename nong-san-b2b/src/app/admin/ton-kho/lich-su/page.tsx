import { InventoryLedgerType } from '@prisma/client'
import { requireAdmin } from '@/lib/auth'
import { getAdminInventoryLedgerHistory } from '@/lib/services/inventory-read'
import { LedgerHistoryClient } from './ledger-history-client'

export const dynamic = 'force-dynamic'

const VALID_LEDGER_TYPES = new Set<string>(Object.values(InventoryLedgerType))

interface AdminLedgerHistoryPageProps {
  searchParams?: Promise<{
    productId?: string
    batchId?: string
    type?: string
    dateFrom?: string
    dateTo?: string
    search?: string
    page?: string
  }>
}

export default async function AdminLedgerHistoryPage({
  searchParams,
}: AdminLedgerHistoryPageProps) {
  await requireAdmin()
  const resolved = searchParams ? await searchParams : {}

  const typeParam =
    resolved.type && VALID_LEDGER_TYPES.has(resolved.type)
      ? (resolved.type as InventoryLedgerType)
      : 'ALL'

  const pageParam = resolved.page ? Number.parseInt(resolved.page, 10) : 1

  const result = await getAdminInventoryLedgerHistory({
    productId: resolved.productId || 'ALL',
    batchId: resolved.batchId || 'ALL',
    type: typeParam,
    dateFrom: resolved.dateFrom || '',
    dateTo: resolved.dateTo || '',
    search: resolved.search || '',
    page: Number.isNaN(pageParam) ? 1 : pageParam,
    pageSize: 25,
  })

  return (
    <div className="space-y-6">
      <LedgerHistoryClient
        result={result}
        initialFilters={{
          productId: resolved.productId || 'ALL',
          batchId: resolved.batchId || 'ALL',
          type: typeParam,
          dateFrom: resolved.dateFrom || '',
          dateTo: resolved.dateTo || '',
          search: resolved.search || '',
        }}
      />
    </div>
  )
}
