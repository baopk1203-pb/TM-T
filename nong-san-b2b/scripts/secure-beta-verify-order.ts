import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const orderCode = process.argv[2] || 'DH-261029-ASRT'

  console.log(`\n================================================================================`)
  console.log(`  E VIBE — NEON PREVIEW-BETA DEMO ORDER READ-ONLY VERIFICATION`)
  console.log(`  Target Order: ${orderCode}`)
  console.log(`  Execution Mode: 100% READ-ONLY (No Mutations, No DDL)`)
  console.log(`================================================================================\n`)

  // 1. Fetch Order with all relations
  const order = await prisma.order.findUnique({
    where: { code: orderCode },
    include: {
      user: {
        select: {
          id: true,
          role: true,
          membershipTier: true,
          group: { select: { id: true, name: true, discountPercent: true } },
        },
      },
      items: {
        include: {
          batch: true,
          allocations: {
            include: {
              batch: true,
            },
          },
        },
      },
      transactions: true,
      events: {
        orderBy: { createdAt: 'asc' },
      },
      shipment: true,
      inventoryLedgers: {
        include: { batch: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!order) {
    console.error(`[FAIL] Order ${orderCode} NOT FOUND in database!`)
    process.exit(1)
  }

  console.log(`=== TASK A: ORDER FINANCIAL & ATTRIBUTE VERIFICATION ===`)
  console.log(`Order Code               : ${order.code}`)
  console.log(`Order Status             : ${order.status}`)
  console.log(`Payment Option           : ${order.paymentOption}`)
  console.log(`Subtotal (Tiền hàng)     : ${order.subtotal.toLocaleString('vi-VN')} VND (Expected: 3.720.000)`)
  console.log(`Base Shipping Fee        : ${order.baseShippingFee?.toLocaleString('vi-VN') ?? 'N/A'} VND (Expected: 466.000)`)
  console.log(`Shipping Discount        : ${order.shippingDiscountAmount?.toLocaleString('vi-VN') ?? '0'} VND (Expected: 23.300)`)
  console.log(`Final Shipping Fee       : ${order.shippingFee.toLocaleString('vi-VN')} VND (Expected: 442.700)`)
  console.log(`Order Total (Tổng đơn)   : ${order.total.toLocaleString('vi-VN')} VND (Expected: 4.162.700)`)
  console.log(`Deposit Amount (Cọc 30%) : ${order.depositAmount.toLocaleString('vi-VN')} VND (Expected: 1.249.000)`)
  console.log(`Payment Due At           : ${order.paymentDueAt?.toISOString() ?? 'N/A'}`)
  console.log(`Delivery Date            : ${order.deliveryDate?.toISOString().split('T')[0] ?? 'N/A'}`)
  console.log(`Time Slot Code           : ${order.timeSlot ?? 'N/A'}`)

  console.log(`\n=== TASK C: F04 MEMBERSHIP SNAPSHOT VERIFICATION ===`)
  console.log(`User Membership Tier     : ${order.user?.membershipTier ?? 'N/A'}`)
  console.log(`User Group Discount      : ${order.groupDiscountPercent}% (Expected: 5%)`)
  console.log(`Tier Snapshot            : ${order.membershipTierSnapshot ?? 'N/A'} (Expected: BRONZE)`)
  console.log(`Membership Discount Pct  : ${order.membershipDiscountPercent}% (Expected: 2%)`)
  console.log(`Combined Discount Pct    : ${order.combinedDiscountPercent}% (Expected: 7%)`)
  console.log(`Base Shipping Snapshot   : ${order.baseShippingFee?.toLocaleString('vi-VN') ?? 'N/A'} VND (Expected: 466.000)`)
  console.log(`Shipping Discount Snapshot: ${order.shippingDiscountAmount?.toLocaleString('vi-VN') ?? 'N/A'} VND (Expected: 23.300)`)

  console.log(`\n=== ORDER ITEMS (${order.items.length} items) ===`)
  for (const item of order.items) {
    console.log(`- Item ID: ${item.id}`)
    console.log(`  Product Name   : ${item.productName}`)
    console.log(`  Packaging Name : ${item.packagingName}`)
    console.log(`  Quantity       : ${item.quantity} packages`)
    console.log(`  Ordered Grams  : ${item.orderedGrams.toLocaleString()} g (${item.orderedGrams / 1000} kg)`)
    console.log(`  Unit Price / kg: ${item.unitPricePerKg.toLocaleString('vi-VN')} VND/kg (Expected: 74.400)`)
    console.log(`  Line Total     : ${item.lineTotal.toLocaleString('vi-VN')} VND (Expected: 3.720.000)`)
    console.log(`  Batch ID (legacy): ${item.batchId ?? 'NULL'}`)
    console.log(`  Allocations Count: ${item.allocations.length}`)
  }

  console.log(`\n=== TASK B: F01 FEFO BATCH ALLOCATIONS ===`)
  let totalAllocatedGrams = 0
  for (const item of order.items) {
    for (const alloc of item.allocations) {
      totalAllocatedGrams += alloc.allocatedGrams
      console.log(`- Allocation ID: ${alloc.id}`)
      console.log(`  Batch Code     : ${alloc.batch.code}`)
      console.log(`  Batch Status   : ${alloc.batch.status}`)
      console.log(`  FEFO Eligible  : ${alloc.batch.isFefoEligible}`)
      console.log(`  Harvest Date   : ${alloc.batch.harvestDate.toISOString().split('T')[0]}`)
      console.log(`  Expiry Date    : ${alloc.batch.expiryDate ? alloc.batch.expiryDate.toISOString().split('T')[0] : 'N/A'}`)
      console.log(`  Allocated      : ${alloc.allocatedGrams.toLocaleString()} g (${alloc.allocatedGrams / 1000} kg)`)
      console.log(`  Allocation Status: ${alloc.status}`)
      console.log(`  Hold Expires At: ${alloc.holdExpiresAt?.toISOString() ?? 'N/A'}`)
      console.log(`  Released Grams : ${alloc.releasedGrams.toLocaleString()} g`)
      console.log(`  Released At    : ${alloc.releasedAt?.toISOString() ?? 'N/A'}`)
    }
  }
  console.log(`Total Allocated Grams: ${totalAllocatedGrams.toLocaleString()} g (${totalAllocatedGrams / 1000} kg) (Target: 50 kg)`)

  console.log(`\n=== INVENTORY LEDGERS FOR ORDER (${order.inventoryLedgers.length} records) ===`)
  for (const ledger of order.inventoryLedgers) {
    console.log(`- Ledger ID     : ${ledger.id}`)
    console.log(`  Batch Code    : ${ledger.batch.code}`)
    console.log(`  Type          : ${ledger.type}`)
    console.log(`  Quantity Grams: ${ledger.quantityGrams.toLocaleString()} g`)
    console.log(`  IdempotencyKey: ${ledger.idempotencyKey}`)
    console.log(`  ReferenceCode : ${ledger.referenceCode}`)
    console.log(`  Notes         : ${ledger.notes}`)
    console.log(`  Created At    : ${ledger.createdAt.toISOString()}`)
  }

  // Also query all Ri6 batches to verify FEFO sort order
  const ri6Product = await prisma.product.findUnique({
    where: { slug: 'sau-rieng-ri6' },
    include: {
      batches: {
        include: {
          inventoryLedgers: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
      },
    },
  })

  console.log(`\n=== ALL SẦU RIÊNG RI6 BATCHES IN DATABASE ===`)
  if (ri6Product?.batches) {
    for (const b of ri6Product.batches) {
      const imports = b.inventoryLedgers.filter(l => l.type === 'IMPORT').reduce((s, l) => s + l.quantityGrams, 0)
      const holds = b.inventoryLedgers.filter(l => l.type === 'RESERVATION_HOLD').reduce((s, l) => s + l.quantityGrams, 0)
      const releases = b.inventoryLedgers.filter(l => l.type === 'RESERVATION_RELEASE').reduce((s, l) => s + l.quantityGrams, 0)
      const dispatches = b.inventoryLedgers.filter(l => l.type === 'DISPATCH_OUT').reduce((s, l) => s + l.quantityGrams, 0)
      const avail = imports - (holds - releases) - dispatches
      console.log(`- Batch: ${b.code} | Status: ${b.status} | FEFO: ${b.isFefoEligible} | Expiry: ${b.expiryDate ? b.expiryDate.toISOString().split('T')[0] : 'N/A'}`)
      console.log(`  Imported: ${imports / 1000} kg | Active Hold: ${(holds - releases) / 1000} kg | Available: ${avail / 1000} kg`)
    }
  }

  console.log(`\n=== PAYMENT TRANSACTIONS (${order.transactions.length} txs) ===`)
  for (const tx of order.transactions) {
    console.log(`- Tx ID: ${tx.id} | Type: ${tx.type} | Status: ${tx.status} | Method: ${tx.method} | Amount: ${tx.amount.toLocaleString('vi-VN')} VND | Ref: ${tx.reference ?? 'N/A'}`)
  }

  console.log(`\n=== ORDER EVENTS (${order.events.length} events) ===`)
  for (const evt of order.events) {
    console.log(`- Event: ${evt.type} | From: ${evt.fromStatus ?? 'NULL'} -> To: ${evt.toStatus ?? 'NULL'} | Created: ${evt.createdAt.toISOString()}`)
  }

  console.log(`\n================================================================================`)
  console.log(`  VERIFICATION SCRIPT COMPLETED WITH ZERO MUTATIONS`)
  console.log(`================================================================================\n`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
