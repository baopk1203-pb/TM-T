-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('UNVERIFIED', 'ACTIVE', 'LOCKED_QC', 'EXPIRED', 'DEPLETED');

-- CreateEnum
CREATE TYPE "InventoryLedgerType" AS ENUM ('IMPORT', 'RESERVATION_HOLD', 'RESERVATION_RELEASE', 'DISPATCH_OUT', 'SHRINKAGE_LOSS', 'QC_ADJUSTMENT', 'QC_ADJUSTMENT_ADD', 'QC_ADJUSTMENT_SUB');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('HOLD_PENDING', 'ALLOCATED_CONFIRMED', 'PARTIALLY_DISPATCHED', 'DISPATCHED', 'RELEASED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "inventoryTrackingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "expiryDate" DATE,
ADD COLUMN     "harvestGrams" INTEGER,
ADD COLUMN     "isFefoEligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "qcNotes" TEXT,
ADD COLUMN     "status" "BatchStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- CreateTable
CREATE TABLE "InventoryLedger" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "orderId" TEXT,
    "orderItemId" TEXT,
    "type" "InventoryLedgerType" NOT NULL,
    "quantityGrams" INTEGER NOT NULL,
    "idempotencyKey" TEXT,
    "referenceCode" TEXT,
    "actorId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemBatchAllocation" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "allocatedGrams" INTEGER NOT NULL,
    "dispatchedGrams" INTEGER NOT NULL DEFAULT 0,
    "releasedGrams" INTEGER NOT NULL DEFAULT 0,
    "status" "AllocationStatus" NOT NULL DEFAULT 'HOLD_PENDING',
    "holdExpiresAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItemBatchAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLedger_idempotencyKey_key" ON "InventoryLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "InventoryLedger_batchId_type_idx" ON "InventoryLedger"("batchId", "type");

-- CreateIndex
CREATE INDEX "InventoryLedger_orderId_idx" ON "InventoryLedger"("orderId");

-- CreateIndex
CREATE INDEX "InventoryLedger_createdAt_idx" ON "InventoryLedger"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItemBatchAllocation_idempotencyKey_key" ON "OrderItemBatchAllocation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OrderItemBatchAllocation_orderItemId_batchId_idx" ON "OrderItemBatchAllocation"("orderItemId", "batchId");

-- CreateIndex
CREATE INDEX "OrderItemBatchAllocation_orderItemId_idx" ON "OrderItemBatchAllocation"("orderItemId");

-- CreateIndex
CREATE INDEX "OrderItemBatchAllocation_batchId_idx" ON "OrderItemBatchAllocation"("batchId");

-- CreateIndex
CREATE INDEX "OrderItemBatchAllocation_status_idx" ON "OrderItemBatchAllocation"("status");

-- CreateIndex (Partial Unique Index for active allocations per QA FIX-03)
CREATE UNIQUE INDEX "OrderItemBatchAllocation_active_unique_idx" ON "OrderItemBatchAllocation"("orderItemId", "batchId") WHERE "status" IN ('HOLD_PENDING', 'ALLOCATED_CONFIRMED', 'PARTIALLY_DISPATCHED');

-- CreateIndex
CREATE INDEX "Batch_productId_status_idx" ON "Batch"("productId", "status");

-- CreateIndex
CREATE INDEX "Batch_expiryDate_idx" ON "Batch"("expiryDate");

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemBatchAllocation" ADD CONSTRAINT "OrderItemBatchAllocation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemBatchAllocation" ADD CONSTRAINT "OrderItemBatchAllocation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheckConstraints (QA FIX-04)
ALTER TABLE "OrderItemBatchAllocation"
  ADD CONSTRAINT "chk_allocation_allocated_positive" CHECK ("allocatedGrams" > 0),
  ADD CONSTRAINT "chk_allocation_dispatched_nonneg" CHECK ("dispatchedGrams" >= 0),
  ADD CONSTRAINT "chk_allocation_released_nonneg" CHECK ("releasedGrams" >= 0),
  ADD CONSTRAINT "chk_allocation_mass_balance" CHECK ("dispatchedGrams" + "releasedGrams" <= "allocatedGrams");

ALTER TABLE "InventoryLedger"
  ADD CONSTRAINT "chk_ledger_quantity_positive" CHECK ("quantityGrams" > 0);
