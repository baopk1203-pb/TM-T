-- ==============================================================================
-- MIGRATION ARTIFACT: 20261028213000_f02_two_way_complaints
-- FEATURE: F02 — Two-Way Complaints & 48-Hour SLA (E Vibe B2B)
-- DESIGN STANDARD: EV-F02-QA-GAPS-01 & EV-F02-ENV-VERIFICATION-02
-- TRANSACTION SAFETY: Explicit BEGIN / COMMIT Transaction Boundaries
-- ==============================================================================

BEGIN;

-- 1. CreateEnum: ComplaintResolutionType
CREATE TYPE "ComplaintResolutionType" AS ENUM ('REFUND_MONEY', 'REPLACE_GOODS', 'REJECT_COMPLAINT');

-- 2. AlterEnum: ComplaintStatus (Two-Way Lifecycle States)
ALTER TYPE "ComplaintStatus" ADD VALUE 'PROPOSED';
ALTER TYPE "ComplaintStatus" ADD VALUE 'UNDER_REVIEW';
ALTER TYPE "ComplaintStatus" ADD VALUE 'CUSTOMER_ACCEPTED';
ALTER TYPE "ComplaintStatus" ADD VALUE 'WITHDRAWN';

-- 3. AlterTable: Complaint (Two-Way Proposal, SLA & Review Fields)
ALTER TABLE "Complaint" ADD COLUMN     "autoClosedAt" TIMESTAMP(3),
ADD COLUMN     "customerAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "isFinalProposal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "proposalAmount" INTEGER,
ADD COLUMN     "proposalNotes" TEXT,
ADD COLUMN     "proposalType" "ComplaintResolutionType",
ADD COLUMN     "proposedAt" TIMESTAMP(3),
ADD COLUMN     "reReviewCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reReviewReason" TEXT,
ADD COLUMN     "reReviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewDueAt" TIMESTAMP(3);

COMMIT;
