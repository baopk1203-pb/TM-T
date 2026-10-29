import { PrismaClient } from '@prisma/client'

// ==============================================================================
// FAIL-CLOSED SAFETY GUARDS
// ==============================================================================
const dbUrl = process.env.DATABASE_URL || ''
const APPROVED_HOST = 'ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech'
const PRODUCTION_HOST = 'ep-square-scene-b5ddgxil'

if (!dbUrl) {
  console.error('[FAIL-CLOSED] DATABASE_URL is empty! Aborting execution.')
  process.exit(1)
}
if (dbUrl.includes(PRODUCTION_HOST)) {
  console.error('[FAIL-CLOSED CRITICAL] Production database detected! Aborting execution immediately.')
  process.exit(1)
}
if (!dbUrl.includes('c-7.us-east-2.aws.neon.tech') || !dbUrl.includes('b5f117np')) {
  console.error(`[FAIL-CLOSED] Target host does not match approved Preview-Beta target (${APPROVED_HOST})!`)
  process.exit(1)
}

const prisma = new PrismaClient()

async function main() {
  const orderCode = process.argv[2] || 'DH-261029-ASRT'

  console.log(`\n================================================================================`)
  console.log(`  E VIBE — NEON PREVIEW-BETA DEMO ORDER READ-ONLY VERIFICATION`)
  console.log(`  Target Order : ${orderCode}`)
  console.log(`  Target Host  : ${APPROVED_HOST}`)
  console.log(`  Mode         : 100% READ-ONLY (No mutations, No DDL, No PII logged)`)
  console.log(`================================================================================\n`)

  // 1. Fetch target Order (strictly excluding customer PII: no phone, email, recipient name, address details)
  const order = await prisma.order.findUnique({
    where: { code: orderCode },
    select: {
      id: true,
      code: true,
      type: true,
      status: true,
      paymentOption: true,
      subtotal: true,
      baseShippingFee: true,
      shippingDiscountAmount: true,
      shippingFee: true,
      total: true,
      depositAmount: true,
      finalSubtotal: true,
      finalTotal: true,
      groupDiscountPercent: true,
      membershipTierSnapshot: true,
      membershipDiscountPercent: true,
      combinedDiscountPercent: true,
      deliveryDate: true,
      timeSlot: true,
      paymentDueAt: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          role: true,
          membershipTier: true,
          group: {
            select: {
              name: true,
              discountPercent: true,
            },
          },
        },
      },
      items: {
        select: {
          id: true,
          productName: true,
          packagingName: true,
          quantity: true,
          orderedGrams: true,
          unitPricePerKg: true,
          lineTotal: true,
          batchId: true,
          allocations: {
            select: {
              id: true,
              batchId: true,
              allocatedGrams: true,
              dispatchedGrams: true,
              releasedGrams: true,
              status: true,
              holdExpiresAt: true,
              releasedAt: true,
              createdAt: true,
              batch: {
                select: {
                  code: true,
                  status: true,
                  isFefoEligible: true,
                  harvestDate: true,
                  expiryDate: true,
                },
              },
            },
          },
        },
      },
      inventoryLedgers: {
        select: {
          id: true,
          type: true,
          quantityGrams: true,
          idempotencyKey: true,
          referenceCode: true,
          createdAt: true,
          batch: {
            select: {
              code: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
      transactions: {
        select: {
          id: true,
          type: true,
          status: true,
          method: true,
          amount: true,
          reference: true,
          createdAt: true,
        },
      },
      events: {
        select: {
          id: true,
          type: true,
          fromStatus: true,
          toStatus: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!order) {
    console.error(`[FAIL] Order ${orderCode} NOT FOUND on Neon Preview-Beta!`)
    process.exit(1)
  }

  // --- TASK A: ORDER FINANCIAL RECONCILIATION ---
  console.log(`--- [TASK A: FINANCIAL & ORDER ATTRIBUTES] ---`)
  console.log(`Order Code              : ${order.code}`)
  console.log(`Order Type              : ${order.type}`)
  console.log(`Order Status            : ${order.status}`)
  console.log(`Payment Option          : ${order.paymentOption}`)
  console.log(`Delivery Date (DB Date) : ${order.deliveryDate ? order.deliveryDate.toISOString().split('T')[0] : 'N/A'}`)
  console.log(`TimeSlot Enum (DB Code) : ${order.timeSlot ?? 'N/A'}`)
  console.log(`Merchandise Subtotal    : ${order.subtotal.toLocaleString('vi-VN')} VND (Expected: 3.720.000)`)
  console.log(`Base Shipping Fee       : ${order.baseShippingFee?.toLocaleString('vi-VN') ?? 'N/A'} VND (Expected: 466.000)`)
  console.log(`Shipping Discount       : ${order.shippingDiscountAmount?.toLocaleString('vi-VN') ?? '0'} VND (Expected: 23.300)`)
  console.log(`Final Shipping Fee      : ${order.shippingFee.toLocaleString('vi-VN')} VND (Expected: 442.700)`)
  console.log(`Order Total             : ${order.total.toLocaleString('vi-VN')} VND (Expected: 4.162.700)`)
  console.log(`Deposit Amount (30%)    : ${order.depositAmount.toLocaleString('vi-VN')} VND (Expected: 1.249.000)`)
  console.log(`Payment Due At          : ${order.paymentDueAt ? order.paymentDueAt.toISOString() : 'N/A'}`)
  console.log(`Order Created At (UTC)  : ${order.createdAt.toISOString()}`)

  // --- TASK C: F04 MEMBERSHIP SNAPSHOT RECONCILIATION ---
  console.log(`\n--- [TASK C: F04 MEMBERSHIP SNAPSHOTS] ---`)
  console.log(`Current User Tier       : ${order.user?.membershipTier ?? 'N/A'}`)
  console.log(`User Group Discount     : ${order.groupDiscountPercent}% (Expected: 5%)`)
  console.log(`membershipTierSnapshot  : ${order.membershipTierSnapshot ?? 'NULL'} (Expected: BRONZE)`)
  console.log(`membershipDiscountPct   : ${order.membershipDiscountPercent}% (Expected: 2%)`)
  console.log(`combinedDiscountPct     : ${order.combinedDiscountPercent}% (Expected: 7%)`)
  console.log(`baseShippingFee Snapshot: ${order.baseShippingFee?.toLocaleString('vi-VN') ?? 'NULL'} VND`)
  console.log(`shippingDiscount Snapshot: ${order.shippingDiscountAmount?.toLocaleString('vi-VN') ?? 'NULL'} VND`)

  // --- TASK B: FEFO ALLOCATION & INVENTORY LEDGER ---
  console.log(`\n--- [TASK B: F01 FEFO ALLOCATION & RESERVATION] ---`)
  console.log(`Items count: ${order.items.length}`)

  let totalAllocatedGrams = 0
  for (const item of order.items) {
    console.log(`  Item: ${item.productName} | ${item.packagingName}`)
    console.log(`  Quantity: ${item.quantity} packages | Ordered: ${item.orderedGrams / 1000} kg | Unit Price: ${item.unitPricePerKg.toLocaleString('vi-VN')} VND/kg | Total: ${item.lineTotal.toLocaleString('vi-VN')} VND`)
    console.log(`  Allocations count: ${item.allocations.length}`)

    for (const alloc of item.allocations) {
      totalAllocatedGrams += alloc.allocatedGrams
      const isExpired = alloc.holdExpiresAt && new Date() > alloc.holdExpiresAt
      console.log(`    - Allocation ID     : ${alloc.id}`)
      console.log(`      Batch Code        : ${alloc.batch.code}`)
      console.log(`      Batch Status      : ${alloc.batch.status}`)
      console.log(`      FEFO Eligible     : ${alloc.batch.isFefoEligible}`)
      console.log(`      Expiry Date       : ${alloc.batch.expiryDate ? alloc.batch.expiryDate.toISOString().split('T')[0] : 'N/A'}`)
      console.log(`      Allocated Quantity: ${alloc.allocatedGrams / 1000} kg (${alloc.allocatedGrams} g)`)
      console.log(`      Allocation Status : ${alloc.status}`)
      console.log(`      Hold Expires At   : ${alloc.holdExpiresAt ? alloc.holdExpiresAt.toISOString() : 'N/A'}`)
      console.log(`      Hold Time Status  : ${isExpired ? 'EXPIRED (Thời hạn 10p đã qua)' : 'ACTIVE (Trong thời hạn)'}`)
      console.log(`      Released Quantity : ${alloc.releasedGrams / 1000} kg`)
      console.log(`      Released At       : ${alloc.releasedAt ? alloc.releasedAt.toISOString() : 'N/A'}`)
    }
  }
  console.log(`Total Allocated Grams: ${totalAllocatedGrams / 1000} kg (${totalAllocatedGrams} g) (Target: 50 kg)`)

  console.log(`\nInventory Ledgers for this Order (${order.inventoryLedgers.length} records):`)
  for (const l of order.inventoryLedgers) {
    console.log(`  - Ledger [${l.type}] Batch: ${l.batch.code} | Qty: ${l.quantityGrams / 1000} kg | Key: ${l.idempotencyKey} | Ref: ${l.referenceCode} | At: ${l.createdAt.toISOString()}`)
  }

  // Query all Ri6 batches to verify FEFO candidate selection priority
  const ri6Batches = await prisma.batch.findMany({
    where: {
      product: { slug: 'sau-rieng-ri6' },
    },
    include: {
      ledgerEntries: {
        select: {
          type: true,
          quantityGrams: true,
        },
      },
      allocations: {
        select: {
          allocatedGrams: true,
          releasedGrams: true,
          status: true,
        },
      },
    },
    orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
  })

  console.log(`\n--- [SẦU RIÊNG RI6 BATCHES CANDIDATE EVALUATION] ---`)
  for (const b of ri6Batches) {
    const importGrams = b.ledgerEntries.filter((l) => l.type === 'IMPORT').reduce((s, l) => s + l.quantityGrams, 0)
    const holdGrams = b.ledgerEntries.filter((l) => l.type === 'RESERVATION_HOLD').reduce((s, l) => s + l.quantityGrams, 0)
    const relGrams = b.ledgerEntries.filter((l) => l.type === 'RESERVATION_RELEASE').reduce((s, l) => s + l.quantityGrams, 0)
    const dispGrams = b.ledgerEntries.filter((l) => l.type === 'DISPATCH_OUT').reduce((s, l) => s + l.quantityGrams, 0)
    const availGrams = importGrams - (holdGrams - relGrams) - dispGrams

    console.log(`  - Batch: ${b.code} | Status: ${b.status} | FEFO: ${b.isFefoEligible} | Expiry: ${b.expiryDate ? b.expiryDate.toISOString().split('T')[0] : 'N/A'}`)
    console.log(`    Imported: ${importGrams / 1000} kg | Net Hold: ${(holdGrams - relGrams) / 1000} kg | Available: ${availGrams / 1000} kg`)
  }

  console.log(`\n--- [PAYMENT TRANSACTIONS & ORDER EVENTS] ---`)
  console.log(`Transactions (${order.transactions.length}):`)
  for (const tx of order.transactions) {
    console.log(`  - Tx [${tx.type}] ${tx.method} | Status: ${tx.status} | Amount: ${tx.amount.toLocaleString('vi-VN')} VND | Ref: ${tx.reference ?? 'N/A'}`)
  }
  console.log(`Order Events (${order.events.length}):`)
  for (const evt of order.events) {
    console.log(`  - Event: ${evt.type} | Transition: ${evt.fromStatus ?? 'INIT'} -> ${evt.toStatus ?? 'N/A'} | At: ${evt.createdAt.toISOString()}`)
  }

  console.log(`\n================================================================================`)
  console.log(`  VERIFICATION FINISHED: 100% READ-ONLY SELECT COMPLETED WITH 0 MUTATIONS`)
  console.log(`================================================================================\n`)
}

main()
  .catch((e) => {
    console.error('[EXECUTION ERROR]', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
