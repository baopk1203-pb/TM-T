# EV-IMP-01B-APPLY-PREP: GÓI MIGRATION PRISMA & BÁO CÁO SẴN SÀNG TRIỂN KHAI DATABASE

> **Tài liệu:** Báo cáo Chuẩn bị Gói Migration Prisma Thực tế F01 (Real Prisma Migration Package & Pre-Apply Readiness)  
> **Dự án:** E Vibe — Sàn Thương mại Điện tử B2B Phân phối Nông sản & Trái cây  
> **Mã nhiệm vụ:** `EV-IMP-01B-APPLY-PREP`  
> **Phiên bản:** `1.0.0`  
> **Ngày lập:** 24/10/2026  
> **Tác giả:** Senior Backend Engineer, Prisma Migration Specialist & PostgreSQL Database Architect  
> **Trạng thái:** `PACKAGE READY — OFFLINE QUALITY GATES 100% PASS — STRICTLY NO DATABASE APPLY — AWAITING PO AUTHORIZATION`  
> **Chế độ thực thi:** `PRISMA SCHEMA & OFFLINE MIGRATION DDL COMPLETE — ZERO NEON WRITES — ZERO COMMIT — ZERO PUSH`

---

## 1. THÔNG TIN GIT VÀ HIỆN TRẠNG WORKING TREE

- **Nhánh Git:** `beta`
- **Git HEAD Baseline:** `f50e348` (*feat(inventory): implement pure domain FEFO engine and inventory contract (EV-IMP-01A)*)
- **Trạng thái Working Tree:**
  - `modified: nong-san-b2b/prisma/schema.prisma` (Đã cập nhật đầy đủ enum, model `InventoryLedger`, `OrderItemBatchAllocation`, và các quan hệ).
  - `modified: nong-san-b2b/src/lib/domain/inventory.ts` (Pure domain FEFO engine, Invariants, QC Adjustment 2 chiều, Allocation lifecycle).
  - `modified: nong-san-b2b/tests/unit/inventory.test.ts` (Bộ unit test 43 tests chuyên sâu cho F01).
  - `modified: nong-san-b2b/tests/unit/packaging-integrity.test.ts` (Bổ sung `inventoryTrackingEnabled: false` cho mock product trong unit test).
  - `untracked: nong-san-b2b/prisma/migrations/20261023235900_add_f01_inventory_ledger/migration.sql` (File DDL migration độc lập chuẩn Prisma).
  - `untracked: docs/EV_IMP_01B_SCHEMA_PREFLIGHT.md` (Tài liệu tiền kiểm schema & migration đã QA duyệt).
  - `untracked: docs/EV_IMP_01B_FIX_REPORT.md` (Báo cáo khắc phục thiết kế theo QA).
  - `untracked: docs/EV_IMP_01B_APPLY_PREPARATION_REPORT.md` (Báo cáo này).
- **Cam kết an toàn:**
  - **TUYỆT ĐỐI CHƯA GHI VÀO NEON DATABASE**: Không chạy `prisma migrate deploy`, `prisma db push` hay bất kỳ SQL script nào trên Neon Preview.
  - **TUYỆT ĐỐI CHƯA COMMIT HAY PUSH**: Toàn bộ files vẫn nằm nguyên trong working tree để Product Owner và QA kiểm tra.

---

## 2. DANH SÁCH CÁC TỆP TIN THAY ĐỔI / TẠO MỚI

| STT | Đường dẫn tệp tin | Hành động | Nội dung chính |
|:---:|:---|:---:|:---|
| 1 | `nong-san-b2b/prisma/schema.prisma` | **Modified** | Bổ sung 3 enum, 2 model mới, quan hệ trên `Product`, `Batch`, `Order`, `OrderItem`. |
| 2 | `nong-san-b2b/prisma/migrations/20261023235900_add_f01_inventory_ledger/migration.sql` | **Created** | DDL SQL hoàn chỉnh gồm Enums, Tables, Columns, Foreign Keys (`ON DELETE RESTRICT`), Partial Unique Index và CHECK Constraints. |
| 3 | `nong-san-b2b/tests/unit/packaging-integrity.test.ts` | **Modified** | Bổ sung `inventoryTrackingEnabled: false` cho `existingProduct` mock data để khớp schema Prisma. |
| 4 | `nong-san-b2b/src/lib/domain/inventory.ts` | **Modified** | Pure FEFO Engine, Invariant Verification, Allocation math. |
| 5 | `nong-san-b2b/tests/unit/inventory.test.ts` | **Modified** | 43 unit tests kiểm thử FEFO, Invariant, Allocation, QC 2 chiều. |
| 6 | `docs/EV_IMP_01B_APPLY_PREPARATION_REPORT.md` | **Created** | Tài liệu bàn giao gói migration và hướng dẫn apply. |

---

## 3. MÃ PRISMA SCHEMA HOÀN CHỈNH (`prisma/schema.prisma`)

Dưới đây là phần khai báo chi tiết các Enum, Models và Fields được bổ sung vào schema Prisma:

```prisma
// ==========================================
// 1. CÁC ENUM MỚI CHO QUẢN LÝ TỒN KHO & LÔ
// ==========================================

enum BatchStatus {
  UNVERIFIED
  ACTIVE
  LOCKED_QC
  EXPIRED
  DEPLETED
}

enum InventoryLedgerType {
  IMPORT
  RESERVATION_HOLD
  RESERVATION_RELEASE
  DISPATCH_OUT
  SHRINKAGE_LOSS
  QC_ADJUSTMENT
  QC_ADJUSTMENT_ADD
  QC_ADJUSTMENT_SUB
}

enum AllocationStatus {
  HOLD_PENDING
  ALLOCATED_CONFIRMED
  PARTIALLY_DISPATCHED
  DISPATCHED
  RELEASED
}

// ==========================================
// 2. MỞ RỘNG CÁC MODEL HIỆN HỮU
// ==========================================

model Product {
  // ... các trường hiện hữu giữ nguyên ...
  inventoryTrackingEnabled Boolean          @default(false)
  // ...
  batches                  Batch[]
}

model Batch {
  id             String                      @id @default(cuid())
  code           String                      @unique
  productId      String
  farmId         String
  harvestDate    DateTime                    @db.Date
  quantityGrams  Int
  harvestGrams   Int?
  expiryDate     DateTime?                   @db.Date
  status         BatchStatus                 @default(UNVERIFIED)
  isFefoEligible Boolean                     @default(false)
  qcNotes        String?                     @db.Text
  verifiedAt     DateTime?
  verifiedById   String?
  note           String?
  product        Product                     @relation(fields: [productId], references: [id])
  farm           Farm                        @relation(fields: [farmId], references: [id])
  orderItems     OrderItem[]
  ledgerEntries  InventoryLedger[]
  allocations    OrderItemBatchAllocation[]
  createdAt      DateTime                    @default(now())

  @@index([productId, status])
  @@index([expiryDate])
}

model Order {
  // ... các trường hiện hữu giữ nguyên ...
  items            OrderItem[]
  transactions     PaymentTransaction[]
  events           OrderEvent[]
  complaints       Complaint[]
  inventoryLedgers InventoryLedger[]
  createdAt        DateTime             @default(now())
  updatedAt        DateTime             @updatedAt
}

model OrderItem {
  id               String                      @id @default(cuid())
  orderId          String
  productId        String
  packagingId      String
  productName      String
  packagingName    String
  isSample         Boolean
  quantity         Int
  orderedGrams     Int
  unitPricePerKg   Int
  lineTotal        Int
  actualGrams      Int?
  finalLineTotal   Int?
  batchId          String?
  order            Order                       @relation(fields: [orderId], references: [id], onDelete: Cascade)
  batch            Batch?                      @relation(fields: [batchId], references: [id])
  packaging        Packaging                   @relation(fields: [packagingId], references: [id])
  allocations      OrderItemBatchAllocation[]
  inventoryLedgers InventoryLedger[]
}

// ==========================================
// 3. CÁC MODEL MỚI ĐƯỢC BỔ SUNG
// ==========================================

model InventoryLedger {
  id             String              @id @default(cuid())
  batchId        String
  orderId        String?
  orderItemId    String?
  type           InventoryLedgerType
  quantityGrams  Int
  idempotencyKey String?             @unique
  referenceCode  String?
  actorId        String?
  notes          String?             @db.Text
  createdAt      DateTime            @default(now())
  batch          Batch               @relation(fields: [batchId], references: [id], onDelete: Restrict)
  order          Order?              @relation(fields: [orderId], references: [id], onDelete: Restrict)
  orderItem      OrderItem?          @relation(fields: [orderItemId], references: [id], onDelete: Restrict)

  @@index([batchId, type])
  @@index([orderId])
  @@index([createdAt])
}

model OrderItemBatchAllocation {
  id              String           @id @default(cuid())
  orderItemId     String
  batchId         String
  allocatedGrams  Int
  dispatchedGrams Int              @default(0)
  releasedGrams   Int              @default(0)
  status          AllocationStatus @default(HOLD_PENDING)
  holdExpiresAt   DateTime?
  releasedAt      DateTime?
  idempotencyKey  String?          @unique
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
  orderItem       OrderItem        @relation(fields: [orderItemId], references: [id], onDelete: Restrict)
  batch           Batch            @relation(fields: [batchId], references: [id], onDelete: Restrict)

  @@index([orderItemId, batchId])
  @@index([orderItemId])
  @@index([batchId])
  @@index([status])
}
```

---

## 4. ĐƯỜNG DẪN & TOÀN BỘ NỘI DUNG TỆP MIGRATION SQL

- **Đường dẫn tệp:** `nong-san-b2b/prisma/migrations/20261023235900_add_f01_inventory_ledger/migration.sql`
- **Toàn bộ nội dung SQL DDL:**

```sql
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
```

---

## 5. ĐỐI CHIẾU CÁC RÀNG BUỘC & CHỈ MỤC CHUẨN QA

| Thành phần | Định nghĩa | Đánh giá Tuân thủ |
|:---|:---|:---|
| **Foreign Keys `RESTRICT`** | 1. `InventoryLedger.batchId` $\rightarrow$ `Batch(id)` `ON DELETE RESTRICT`<br>2. `InventoryLedger.orderId` $\rightarrow$ `Order(id)` `ON DELETE RESTRICT`<br>3. `InventoryLedger.orderItemId` $\rightarrow$ `OrderItem(id)` `ON DELETE RESTRICT`<br>4. `OrderItemBatchAllocation.orderItemId` $\rightarrow$ `OrderItem(id)` `ON DELETE RESTRICT`<br>5. `OrderItemBatchAllocation.batchId` $\rightarrow$ `Batch(id)` `ON DELETE RESTRICT` | **PASS (100%)**<br>Bảo toàn tuyệt đối vết kiểm toán biosecurity. Không cho phép xóa vật lý bất kỳ dòng đơn hay lô hàng nào đã có biến động kho. |
| **Partial Unique Index** | `CREATE UNIQUE INDEX "OrderItemBatchAllocation_active_unique_idx" ON "OrderItemBatchAllocation"("orderItemId", "batchId") WHERE "status" IN ('HOLD_PENDING', 'ALLOCATED_CONFIRMED', 'PARTIALLY_DISPATCHED');` | **PASS (100%)**<br>Cho phép tái phân bổ (re-allocation) từ cùng một lô sau khi bản ghi cũ đã chuyển `RELEASED`. |
| **Database CHECK Constraints** | 1. `chk_allocation_allocated_positive`: `allocatedGrams > 0`<br>2. `chk_allocation_dispatched_nonneg`: `dispatchedGrams >= 0`<br>3. `chk_allocation_released_nonneg`: `releasedGrams >= 0`<br>4. `chk_allocation_mass_balance`: `dispatchedGrams + releasedGrams <= allocatedGrams`<br>5. `chk_ledger_quantity_positive`: `quantityGrams > 0` | **PASS (100%)**<br>Bảo toàn khối lượng bất biến ở cấp độ PostgreSQL engine, chặn đứng hoàn toàn hiện tượng số âm hoặc thất thoát khối lượng. |

---

## 6. ĐÁNH GIÁ TÍNH TƯƠNG THÍCH NGƯỢC (BACKWARD COMPATIBILITY)

1. **Không có trường `NOT NULL` nào thiếu `DEFAULT` trên các bảng hiện hữu:**
   - Cột mới trên `Product`: `inventoryTrackingEnabled` là `BOOLEAN NOT NULL DEFAULT false`.
   - Cột mới trên `Batch`:
     - `expiryDate`: `DATE NULL`
     - `harvestGrams`: `INTEGER NULL`
     - `isFefoEligible`: `BOOLEAN NOT NULL DEFAULT false`
     - `qcNotes`: `TEXT NULL`
     - `status`: `BatchStatus NOT NULL DEFAULT 'UNVERIFIED'`
     - `verifiedAt`: `TIMESTAMP NULL`
     - `verifiedById`: `TEXT NULL`
   - Tất cả bản ghi `Product` và `Batch` hiện có trên database giữ nguyên giá trị, không bị lỗi khi chạy DDL.
2. **Không có thao tác phá hủy dữ liệu (Additive-Only):**
   - Không có `DROP TABLE`, `DROP COLUMN`, `RENAME COLUMN`, hay `ALTER COLUMN TYPE`.
   - Các bảng mới (`InventoryLedger`, `OrderItemBatchAllocation`) khởi tạo hoàn toàn độc lập và rỗng.
3. **Không làm gãy API hoặc Server Actions hiện hành:**
   - Các API Storefront, Cart, Checkout, Admin Đơn hàng, Nhà vườn, Vận chuyển hiện tại hoạt động bình thường mà không bị gián đoạn hay phát sinh lỗi kiểu dữ liệu.

---

## 7. QUY TRÌNH ROLLBACK & PHỤC HỒI KHÔNG PHÁ HỦY (NON-DESTRUCTIVE RECOVERY RUNBOOK)

> [!IMPORTANT]
> **NGUYÊN TẮC BẤT BIẾN: ROLLBACK ỨNG DỤNG KHÔNG ĐỒNG NGHĨA ROLLBACK DỮ LIỆU.**  
> Migration F01 là **100% Additive-Only** (chỉ bổ sung bảng và cột mới có default hoặc nullable). Mã nguồn hiện tại hoàn toàn tương thích và chạy bình thường trên schema đã mở rộng. Tuyệt đối **KHÔNG sử dụng** `DROP TABLE ... CASCADE`, `DROP COLUMN` không kiểm soát hoặc xóa thủ công `_prisma_migrations` trong tình huống vận hành bình thường.

Quy trình ứng phó phân tách thành 3 kịch bản chuẩn mực:

### Kịch bản A: Migration CSDL thành công nhưng Ứng dụng mới gặp lỗi / chưa tương thích
1. **Dừng rollout ứng dụng mới:** Không deploy thêm hoặc revert bản build trên Vercel Preview về commit tương thích gần nhất.
2. **Giữ nguyên Schema CSDL đã mở rộng:** Không thực hiện bất kỳ lệnh `DROP TABLE` hay `DROP COLUMN` nào trên CSDL Neon.
3. **Tại sao an toàn?** Do toàn bộ cột mới trên `Product` và `Batch` đều có giá trị mặc định (`inventoryTrackingEnabled = false`, `isFefoEligible = false`, `status = UNVERIFIED`) hoặc `NULL`, các bảng `InventoryLedger` và `OrderItemBatchAllocation` chưa có dữ liệu và không bị ứng dụng cũ gọi tới. Bản build ứng dụng cũ hoạt động hoàn toàn bình thường 100% trên schema mới.

### Kịch bản B: Migration CSDL thất bại giữa chừng (Failed Migration / Interrupted DDL)
1. **Dừng tự động retry:** Không cố gắng chạy lặp lại lệnh deploy khi chưa xác định rõ trạng thái DDL.
2. **Kiểm tra trạng thái thực tế trên CSDL:**
   - Đọc bảng `_prisma_migrations` để xác định bản ghi lỗi:
     ```sql
     SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count 
     FROM "_prisma_migrations" ORDER BY started_at DESC LIMIT 5;
     ```
   - Kiểm tra xem các đối tượng DDL (Enum, Table, Index, Constraint) đã được tạo một phần hay chưa qua `information_schema.tables` và `pg_type`.
3. **Quy trình xử lý theo chuẩn Prisma Migrate:**
   - **Tuyệt đối không dùng `prisma migrate resolve` một cách mù quáng.**
   - Nếu lỗi xảy ra trước khi bất kỳ thay đổi DDL nào được commit: Kiểm tra và sửa lỗi kết nối/timeout, sau đó mới thử lại.
   - Nếu DDL bị dừng dở dang (partial apply): Kỹ sư PostgreSQL phân tích từng lệnh DDL trong `migration.sql` chưa hoàn tất, đưa schema về trạng thái nhất quán, và chỉ đánh dấu `--applied` hoặc `--rolled-back` khi và chỉ khi đối chiếu trạng thái thực tế đã chuẩn xác và có sự phê duyệt của PO/Lead Architect.

### Kịch bản C: Khôi phục Dữ liệu Cần thiết (Data Restoration via Neon Backup Snapshot)
1. **Sử dụng Bản sao lưu Độc lập đã kiểm chứng:** Khôi phục từ Neon Branch Snapshot hoặc PITR restore point đã được tạo và xác nhận trước khi APPLY.
2. **Đánh giá tổn thất giao dịch:** Đánh giá các đơn hàng hoặc dữ liệu phát sinh giữa thời điểm snapshot và thời điểm quyết định khôi phục để có phương án bù trừ dữ liệu.
3. **Cập nhật Chuỗi kết nối Vercel Beta:**
   - **LƯU Ý QUAN TRỌNG:** Trong Neon Serverless PostgreSQL, mỗi branch có một Endpoint Hostname riêng biệt (ví dụ: `ep-backup-xyz...aws.neon.tech`).
   - Nếu chuyển Vercel Beta sang trỏ vào branch backup, bắt buộc phải cập nhật biến môi trường `DATABASE_URL` trên Vercel Project Settings và trigger redeploy.
   - Tuyệt đối không tự ý chuyển đổi branch kết nối khi chưa có quyết định phê duyệt bằng văn bản từ Product Owner.

---

## 8. KẾT QUẢ QUALITY GATES OFFLINE

Tất cả các lệnh kiểm thử chất lượng mã nguồn đều đã được thực thi và đạt **PASS 100%**:

| Kiểm tra | Lệnh thực thi | Kết quả | Chi tiết |
|:---|:---|:---:|:---|
| **Prisma Validate** | `npx prisma validate` | **PASS** | *The schema at prisma\schema.prisma is valid 🚀* |
| **Prisma Generate** | `npx prisma generate` | **PASS** | Tạo thành công Prisma Client types nội bộ cho TypeScript. |
| **Vitest Unit Tests** | `npm test` | **PASS** | **546/546 tests PASS (36 test suites, 100%)** |
| **ESLint** | `npm run lint` | **PASS** | 0 errors, 1 warning không liên quan (`local-db.ts`). |
| **TypeScript Typecheck** | `npm run typecheck` | **PASS** | 0 type errors, types khớp 100% với Prisma client mới. |
| **Production Build** | `npm run build` | **PASS** | Next.js 16.4.0 (Turbopack) build thành công 100%, 0 lỗi biên dịch. |

---

## 9. CÁC HẠNG MỤC CHƯA ĐƯỢC XÁC THỰC RUNTIME (UNVERIFIED RUNTIME ITEMS)

Do tuân thủ tuyệt đối quy định an toàn (`STRICTLY NO DATABASE APPLY` khi chưa có phê duyệt chính thức từ Product Owner):
1. **Chưa áp dụng DDL trực tiếp lên Neon Postgres:** Gói migration mới tồn tại dưới dạng file SQL tĩnh trong `prisma/migrations/20261023235900_add_f01_inventory_ledger/migration.sql`.
2. **Thời gian khóa bảng (Lock contention):** Mặc dù các lệnh `ALTER TABLE ADD COLUMN` đều có giá trị mặc định hằng số (metadata-only update trong PostgreSQL 11+ với O(1) time), thời gian cấp khóa AccessExclusiveLock trên bảng `Product` và `Batch` tại Neon Preview chưa được đo đạc trực tiếp.

---

## 10. RỦI RO ĐÃ ĐƯỢC KHẮC PHỤC TRONG NHIỆM VỤ AN TOÀN (EV-IMP-01B-SAFETY-FIX)

1. **Khắc phục Kịch bản An toàn `safe-preview-migrate.ps1` (FIX-02):**
   - Loại bỏ hoàn toàn giá trị hardcode HEAD của Phase 8. Script hiện tại nhận `-ApprovedCommitSha` từ tham số hoặc file artifact phê duyệt độc lập, triệt tiêu nguy cơ tự tham chiếu commit.
   - Bổ sung xác thực quan hệ với `origin/beta` (ngăn branch diverged).
   - Nhận diện chính xác migration F01 `20261023235900_add_f01_inventory_ledger` với SHA256 checksum: `14A35A7CAB52CAE9BCB3D6651520F00C2796A4C590C069A43863EAE6FE93F0E5`.
   - Bổ sung Gate G4 kiểm tra DDL additive-only (chặn `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `CASCADE`).
   - Tích hợp Gate G5 với Neon Backup & Recovery Checklist.
   - Bổ sung bộ xác minh Post-Verification kiểm tra trực tiếp các bảng, cột, Partial Index và 5 CHECK constraints của F01.
   - Bộ 32 test cases offline (`safe-preview-migrate.test.ps1`) đạt **100% PASS**.

2. **Khắc phục Nguy cơ Lỗi Thời gian Thực thi Deployment (FIX-03):**
   - Thiết kế trình tự chuẩn: **Migrate Database Trước $\rightarrow$ Push Code Triển khai Vercel Sau**.
   - Bảo đảm Vercel Beta Preview không bao giờ chạy bản build với Prisma Client mới trước khi database Neon có schema tương ứng.

---

## 11. TRÌNH TỰ DEPLOYMENT & ĐIỀU KIỆN TIÊN QUYẾT TRƯỚC KHI APPLY (PRE-APPLY CONDITIONS)

### 11.1. Trình tự 12 bước bảo đảm an toàn tuyệt đối cho Vercel Beta (FIX-03)
1. **DEV** hoàn thiện schema, SQL DDL, script an toàn, tests và tài liệu (Đã hoàn thành trong `EV-IMP-01B-APPLY-PREP` & `EV-IMP-01B-SAFETY-FIX`).
2. **QA** kiểm tra độc lập và phê duyệt gói migration cùng safety script.
3. **DEV** tạo commit **cục bộ** trên nhánh `beta` (chưa push lên remote).
4. Đối chiếu commit hash, migration SQL SHA256 và danh sách file thay đổi. PO phê duyệt commit SHA.
5. **PO** thực hiện checklist sao lưu trên Neon Console, tạo branch snapshot `backup-pre-f01-inventory-...` và ghi lại định danh snapshot.
6. Kỹ sư thực thi kiểm tra an toàn ở chế độ Read-Only:
   ```powershell
   powershell -File .\scripts\safe-preview-migrate.ps1 -Mode Preflight -ApprovedCommitSha <APPROVED_SHA> -ExpectedHost <PREVIEW_DIRECT_HOST>
   ```
7. **PO** phê duyệt chính thức cho phép chuyển sang bước APPLY trong nhiệm vụ riêng.
8. Kỹ sư thực thi APPLY có kiểm soát:
   ```powershell
   powershell -File .\scripts\safe-preview-migrate.ps1 -Mode Apply -ApprovedCommitSha <APPROVED_SHA> -ExpectedHost <PREVIEW_DIRECT_HOST> -BackupSnapshotId <SNAPSHOT_ID>
   ```
9. Script chạy xác minh tự động hậu migration (Post-Verification F01) và ghi nhận kết quả.
10. **CHỈ KHI VÀ CHỈ KHI** bước 9 thành công 100%, DEV mới thực hiện push commit đã duyệt lên remote:
    ```bash
    git push origin beta
    ```
11. Vercel Beta Preview tự động trigger build và deploy code mới trên nền database đã có sẵn schema F01.
12. Tiến hành smoke test trên URL Beta và đối chiếu deployment SHA của Vercel với Git commit SHA đã duyệt. Hoàn toàn không tác động đến nhánh `main` hoặc Production.

### 11.2. Checklist Tiên quyết Dành cho Product Owner trước APPLY (FIX-04)
- [x] Gói migration SQL F01 đã kiểm tra cú pháp và đối chiếu SHA256 (`14A35A7C...`).
- [x] Script `safe-preview-migrate.ps1` đã hoàn tất cập nhật và 32/32 tests PASS.
- [x] Schema Prisma đã khớp và 100% Quality Gates offline PASS (546 unit tests).
- [ ] PO đăng nhập Neon Console, tạo branch snapshot backup từ `preview-beta`.
- [ ] PO ghi lại Hostname Direct Connection của branch `preview-beta` (port 5432).
- [ ] PO phê duyệt Commit SHA chính thức và cấp phép thực thi nhiệm vụ APPLY.

---

## 12. LỆNH ĐỀ XUẤT CHO BƯỚC APPLY (PROPOSED COMMAND — CHƯA CHẠY)

> [!CAUTION]
> **CẢNH BÁO: LỆNH DƯỚI ĐÂY CHỈ MANG TÍNH ĐỀ XUẤT VÀ CHƯA ĐƯỢC CHẠY TRONG NHIỆM VỤ NÀY.**

Khi Product Owner cấp phép cho nhiệm vụ APPLY, kỹ sư sẽ thực thi script an toàn đã được tích hợp đầy đủ Hard Gates G0–G6 từ thư mục `nong-san-b2b`:

```powershell
# [NOT EXECUTED — CHƯA CHẠY TRONG NHIỆM VỤ NÀY]
# Áp dụng migration F01 có kiểm soát qua safe-preview-migrate.ps1:
cd nong-san-b2b
powershell -ExecutionPolicy Bypass -File .\scripts\safe-preview-migrate.ps1 `
    -Mode Apply `
    -ApprovedCommitSha "<APPROVED_COMMIT_SHA>" `
    -ExpectedHost "<PREVIEW_DIRECT_HOST>" `
    -BackupSnapshotId "<BACKUP_SNAPSHOT_ID>"
```

---

## 13. BẢNG TỔNG HỢP TRẠNG THÁI NGHIỆM THU

| Hạng mục kiểm tra | Tiêu chuẩn đánh giá | Kết quả thực tế | Trạng thái |
|:---|:---|:---:|:---:|
| **Git Working Tree** | Branch `beta`, HEAD `f50e348`, chưa commit, chưa push | Hoàn toàn nguyên vẹn | **PASS** |
| **Prisma Schema Update** | Đầy đủ 3 Enum, 2 Model, 5 Quan hệ `RESTRICT` | Hoàn tất trong `schema.prisma` | **PASS** |
| **Migration SQL File** | Nằm trong `prisma/migrations/20261023235900.../migration.sql` | Đã tạo với 100% DDL chuẩn | **PASS** |
| **Database Safeguards** | Partial Unique Index + 5 CHECK Constraints | Có mặt đầy đủ trong SQL DDL | **PASS** |
| **Safety Script G0-G6** | `safe-preview-migrate.ps1` cập nhật F01, approved commit, non-self-referencing | 32/32 tests S1-S32 PASS | **PASS** |
| **Non-Destructive Rollback** | Runbook 3 kịch bản, loại bỏ hoàn toàn `DROP TABLE ... CASCADE` | Đã cập nhật chi tiết | **PASS** |
| **Deployment Sequencing** | Quy trình 12 bước: Migrate DB trước $\rightarrow$ Push code sau | Đã thiết kế & ghi nhận | **PASS** |
| **Zero Neon Apply** | Không thực hiện bất kỳ lệnh ghi nào vào database | Tuân thủ tuyệt đối | **PASS** |
| **Quality Gates** | 4 lệnh (`validate`, `test` 546/546, `lint`, `typecheck`, `build`) | 100% PASS | **PASS** |

---
*Báo cáo được lập và lưu trữ tại `docs/EV_IMP_01B_APPLY_PREPARATION_REPORT.md`.*
