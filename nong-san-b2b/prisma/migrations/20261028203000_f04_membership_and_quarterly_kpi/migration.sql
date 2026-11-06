-- ==============================================================================
-- MIGRATION ARTIFACT: 20261028203000_f04_membership_and_quarterly_kpi
-- FEATURE: F04 — Membership & Quarterly KPI (E Vibe B2B)
-- DESIGN STANDARD: EV-F04-PO-DECISION-01 & EV-F04-MIGRATION-PLAN-01R
-- STRATEGY: Two-Step DDL for Legacy Bronze (Preserves NULL on existing accounts)
-- TRANSACTION SAFETY: Explicit BEGIN / COMMIT Transaction Boundaries (BUG-F04-MIG-ART-01)
-- ==============================================================================

BEGIN;

-- 1. CreateEnum: MembershipTier
CREATE TYPE "MembershipTier" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'DIAMOND');

-- 2. AlterTable: User (Two-Step DDL for Legacy Bronze Policy)
-- Step 1: Add nullable columns without default (ensures existing legacy B2B users remain NULL in DB)
ALTER TABLE "User" ADD COLUMN     "membershipTier" "MembershipTier",
ADD COLUMN     "tierUpdatedAt" TIMESTAMP(3);

-- Step 2: Set default 'BRONZE' for subsequent INSERT statements (aligns with Prisma Schema @default(BRONZE))
ALTER TABLE "User" ALTER COLUMN "membershipTier" SET DEFAULT 'BRONZE';

-- 3. AlterTable: Order (Additive-only Financial Snapshots & Shipping Discounts)
ALTER TABLE "Order" ADD COLUMN     "baseShippingFee" INTEGER,
ADD COLUMN     "combinedDiscountPercent" INTEGER DEFAULT 0,
ADD COLUMN     "membershipDiscountPercent" INTEGER DEFAULT 0,
ADD COLUMN     "membershipTierSnapshot" "MembershipTier",
ADD COLUMN     "shippingDiscountAmount" INTEGER DEFAULT 0;

-- 4. CreateTable: MembershipEvaluationLog
CREATE TABLE "MembershipEvaluationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "evaluationQuarter" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "previousTier" "MembershipTier",
    "newTier" "MembershipTier" NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipEvaluationLog_pkey" PRIMARY KEY ("id")
);

-- 5. CreateIndex: Foreign Key Index on userId
CREATE INDEX "MembershipEvaluationLog_userId_idx" ON "MembershipEvaluationLog"("userId");

-- 6. CreateIndex: Unique Constraint per User per Evaluation Quarter
CREATE UNIQUE INDEX "MembershipEvaluationLog_userId_evaluationQuarter_key" ON "MembershipEvaluationLog"("userId", "evaluationQuarter");

-- 7. AddForeignKey: Cascading Delete from User to MembershipEvaluationLog
ALTER TABLE "MembershipEvaluationLog" ADD CONSTRAINT "MembershipEvaluationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
