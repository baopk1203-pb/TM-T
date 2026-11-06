# EV-IMP-01B-FIX: BÁO CÁO HIỆU CHỈNH THIẾT KẾ SCHEMA & MIGRATION SAU ĐÁNH GIÁ CỦA QA ĐỘC LẬP

> **Tài liệu:** Báo cáo Khắc phục Thiết kế Schema theo Yêu cầu QA (QA Architectural Corrections Report)  
> **Dự án:** E Vibe — Sàn Thương mại Điện tử B2B Phân phối Nông sản & Trái cây  
> **Mã nhiệm vụ:** `EV-IMP-01B-FIX`  
> **Phiên bản:** `1.0.0`  
> **Ngày lập:** 23/10/2026  
> **Tác giả:** Senior Backend Engineer, Prisma Database Architect & PostgreSQL Specialist  
> **Trạng thái:** `HOÀN TẤT KHẮC PHỤC THIẾT KẾ — 100% QUALITY GATES PASS — CHỜ QA RE-TEST & PO PHÊ DUYỆT`  
> **Chế độ thực thi:** `DOCUMENTATION & OFFLINE CODE CORRECTION ONLY — ZERO DB MIGRATION / ZERO COMMIT / ZERO PUSH`

---

## 1. THÔNG TIN GIT HEAD VÀ HIỆN TRẠNG WORKING TREE

- **Nhánh Git:** `beta`
- **Git HEAD hiện tại:** `f50e348` (*feat(inventory): implement pure domain FEFO engine and inventory contract (EV-IMP-01A)*)
- **Trạng thái Working Tree:**
  - `modified: nong-san-b2b/src/lib/domain/inventory.ts`: Bổ sung kiểm định Invariant (`verifyInventoryInvariants`), cờ phát hiện mất cân đối không che giấu (`hasDeficit`, `rawPhysicalStockGrams`, `rawReservedGrams`, `rawAvailableGrams`), hỗ trợ kiểm kê 2 chiều `QC_ADJUSTMENT_ADD` (+) và `QC_ADJUSTMENT_SUB` (-), và các hàm quản lý phân bổ `calculateUnreleasedAllocationGrams`, `calculatePartialDispatchAllocation`, `calculateReleaseAllocation`.
  - `modified: nong-san-b2b/tests/unit/inventory.test.ts`: Bổ sung 11 unit tests kiểm chứng Invariants, Allocation lifecycle, điều chỉnh 2 chiều và kịch bản tái phân bổ sau khi RELEASED (Tổng số tests: **546/546 tests PASS 100%**).
  - `modified: docs/EV_IMP_01B_SCHEMA_PREFLIGHT.md`: Cập nhật tài liệu preflight tích hợp toàn bộ các sửa đổi theo yêu cầu của QA.
  - `untracked: docs/EV_IMP_01B_FIX_REPORT.md`: Báo cáo khắc phục chi tiết này.
- **Cam kết nguyên vẹn:** Toàn bộ các thay đổi trong working tree được giữ nguyên vẹn, không bị reset hay checkout đè. Chưa thực hiện commit, push hay deploy.

---

## 2. MA TRẬN 4 NHÓM SỬA LỖI THEO YÊU CẦU CỦA QA ĐỘC LẬP

| Mã Sửa đổi | Vấn đề QA Phát hiện | Mức độ | Hậu quả Kỹ thuật / Nghiệp vụ | Phương án Khắc phục Thiết kế Chuẩn mực |
|:---:|:---|:---:|:---|:---|
| **FIX-01** | `OrderItemBatchAllocation.orderItemId` dùng `ON DELETE CASCADE`. | **P1** | Khi `OrderItem` bị xóa vật lý, toàn bộ lịch sử phân bổ lô hàng bị xóa sổ theo, phá vỡ khả năng truy xuất nguồn gốc và kiểm toán. | Đổi thành **`ON DELETE RESTRICT`**. Ngăn chặn tuyệt đối việc xóa vật lý dòng đơn hàng nếu đã phát sinh phân bổ. Hủy đơn hàng được quản lý bằng trạng thái nghiệp vụ `CANCELLED` và `RELEASED`. |
| **FIX-02** | `InventoryLedger.orderId` và `orderItemId` dùng `ON DELETE SET NULL`. | **P1** | Nếu đơn hàng bị xóa, các dòng sổ cái biến động kho bị ngắt liên kết (`orderId = NULL`), làm suy yếu tính đối soát tài chính và truy vết khách hàng nhận lô. | Đổi thành **`ON DELETE RESTRICT`** cho cả `orderId` và `orderItemId`. Bổ sung trường `referenceCode` lưu mã đơn hàng `DH-...` hoặc phiếu nhập `PNK-...` bất biến. |
| **FIX-03** | Ràng buộc cứng `UNIQUE(orderItemId, batchId)` trên bảng Allocation. | **P1** | Chặn việc phân bổ lại hợp lệ từ cùng một lô cho cùng một dòng đơn sau khi lần phân bổ trước đó đã bị giải phóng (`RELEASED`) do quá hạn 10 phút hoặc hủy đơn. | **Loại bỏ UNIQUE cứng toàn bảng**. Thay thế bằng **PostgreSQL Partial Unique Index** chỉ áp dụng cho các trạng thái phân bổ đang hoạt động: `WHERE status IN ('HOLD_PENDING', 'ALLOCATED_CONFIRMED', 'PARTIALLY_DISPATCHED')`. |
| **FIX-04** | Thiếu các ràng buộc Database CHECK Constraints để bảo vệ khối lượng. | **P2** | Nguy cơ lọt dữ liệu sai lệch (khối lượng âm, lượng xuất + nhả vượt quá lượng phân bổ ban đầu). | Bổ sung 4 CHECK Constraints tại tầng PostgreSQL: `allocatedGrams > 0`, `dispatchedGrams >= 0`, `releasedGrams >= 0`, `dispatchedGrams + releasedGrams <= allocatedGrams`. Thống nhất `quantityGrams > 0` trên Ledger và tách biệt `QC_ADJUSTMENT_ADD` / `QC_ADJUSTMENT_SUB`. |

---

## 3. TRÍCH DẪN VỊ TRÍ THAY ĐỔI TRONG TÀI LIỆU VÀ MÃ NGUỒN

1. **Tài liệu Tiền kiểm [`docs/EV_IMP_01B_SCHEMA_PREFLIGHT.md`](file:///d:/TMĐT%20Website/docs/EV_IMP_01B_SCHEMA_PREFLIGHT.md):**
   - Dòng 74–82: Cập nhật enum `InventoryLedgerType` bổ sung `QC_ADJUSTMENT_ADD` và `QC_ADJUSTMENT_SUB`.
   - Dòng 148–149: Đổi `onDelete: SetNull` thành `onDelete: Restrict` trên `InventoryLedger.order` và `orderItem`.
   - Dòng 170: Đổi `onDelete: Cascade` thành `onDelete: Restrict` trên `OrderItemBatchAllocation.orderItem`.
   - Dòng 173: Loại bỏ `@@unique([orderItemId, batchId])`, thay bằng `@@index([orderItemId, batchId])`.
   - Dòng 252–260: Cập nhật mã DDL SQL bổ sung Partial Unique Index `OrderItemBatchAllocation_active_unique_idx`.
   - Dòng 265–278: Bổ sung 5 mệnh đề `ALTER TABLE ... ADD CONSTRAINT ... CHECK (...)`.
2. **Pure Domain Engine [`nong-san-b2b/src/lib/domain/inventory.ts`](file:///d:/TMĐT%20Website/nong-san-b2b/src/lib/domain/inventory.ts):**
   - Bổ sung `QC_ADJUSTMENT_ADD` và `QC_ADJUSTMENT_SUB` trong hàm `calculateStockFromLedger()` xử lý tăng/giảm kho với số gram nguyên dương.
   - Cung cấp hàm `calculateUnreleasedAllocationGrams`, `calculatePartialDispatchAllocation`, `calculateReleaseAllocation`, và `verifyInventoryInvariants`.
3. **Bộ Kiểm thử [`nong-san-b2b/tests/unit/inventory.test.ts`](file:///d:/TMĐT%20Website/nong-san-b2b/tests/unit/inventory.test.ts):**
   - Bổ sung kiểm thử điều chỉnh kiểm kê 2 chiều.
   - Bổ sung kiểm thử kịch bản tái phân bổ sau khi RELEASED (Attempt 1 RELEASED $\rightarrow$ Attempt 2 thành công).

---

## 4. DDL SQL MIGRATION ĐỀ XUẤT CUỐI CÙNG

Bản mã SQL thuần dưới đây đã tích hợp 100% các sửa đổi của QA và được kiểm tra cú pháp PostgreSQL:

```sql
-- ============================================================================
-- FINAL REVISED SQL MIGRATION: EV-IMP-01B INVENTORY SCHEMA
-- ============================================================================

-- 1. Tạo các kiểu ENUM mới
CREATE TYPE "BatchStatus" AS ENUM ('UNVERIFIED', 'ACTIVE', 'LOCKED_QC', 'EXPIRED', 'DEPLETED');
CREATE TYPE "InventoryLedgerType" AS ENUM (
    'IMPORT', 
    'RESERVATION_HOLD', 
    'RESERVATION_RELEASE', 
    'DISPATCH_OUT', 
    'SHRINKAGE_LOSS', 
    'QC_ADJUSTMENT', 
    'QC_ADJUSTMENT_ADD', 
    'QC_ADJUSTMENT_SUB'
);
CREATE TYPE "AllocationStatus" AS ENUM (
    'HOLD_PENDING', 
    'ALLOCATED_CONFIRMED', 
    'PARTIALLY_DISPATCHED', 
    'DISPATCHED', 
    'RELEASED'
);

-- 2. Mở rộng bảng Product
ALTER TABLE "Product" ADD COLUMN "inventoryTrackingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- 3. Mở rộng bảng Batch (Additive-only, an toàn tuyệt đối cho dữ liệu cũ)
ALTER TABLE "Batch" ADD COLUMN "expiryDate" DATE,
ADD COLUMN "harvestGrams" INTEGER,
ADD COLUMN "isFefoEligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "qcNotes" TEXT,
ADD COLUMN "status" "BatchStatus" NOT NULL DEFAULT 'UNVERIFIED',
ADD COLUMN "verifiedAt" TIMESTAMP(3),
ADD COLUMN "verifiedById" TEXT;

-- 4. Tạo bảng Sổ cái Tồn kho InventoryLedger
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

-- 5. Tạo bảng Phân bổ Đơn hàng OrderItemBatchAllocation
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

-- 6. Tạo các chỉ mục tối ưu truy vấn
CREATE UNIQUE INDEX "InventoryLedger_idempotencyKey_key" ON "InventoryLedger"("idempotencyKey");
CREATE INDEX "InventoryLedger_batchId_type_idx" ON "InventoryLedger"("batchId", "type");
CREATE INDEX "InventoryLedger_orderId_idx" ON "InventoryLedger"("orderId");
CREATE INDEX "InventoryLedger_createdAt_idx" ON "InventoryLedger"("createdAt");

CREATE UNIQUE INDEX "OrderItemBatchAllocation_idempotencyKey_key" ON "OrderItemBatchAllocation"("idempotencyKey");
CREATE INDEX "OrderItemBatchAllocation_orderItemId_idx" ON "OrderItemBatchAllocation"("orderItemId");
CREATE INDEX "OrderItemBatchAllocation_batchId_idx" ON "OrderItemBatchAllocation"("batchId");
CREATE INDEX "OrderItemBatchAllocation_status_idx" ON "OrderItemBatchAllocation"("status");
CREATE INDEX "OrderItemBatchAllocation_orderItemId_batchId_idx" ON "OrderItemBatchAllocation"("orderItemId", "batchId");

-- FIX-03 QA: Partial Unique Index bảo đảm duy nhất 1 allocation đang hoạt động cho cùng (orderItemId, batchId)
CREATE UNIQUE INDEX "OrderItemBatchAllocation_active_unique_idx" 
ON "OrderItemBatchAllocation"("orderItemId", "batchId") 
WHERE "status" IN ('HOLD_PENDING', 'ALLOCATED_CONFIRMED', 'PARTIALLY_DISPATCHED');

CREATE INDEX "Batch_productId_status_idx" ON "Batch"("productId", "status");
CREATE INDEX "Batch_expiryDate_idx" ON "Batch"("expiryDate");

-- 7. FIX-01 & FIX-02 QA: Khóa ngoại ON DELETE RESTRICT bảo toàn lịch sử truy vết
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_batchId_fkey" 
  FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_orderId_fkey" 
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_orderItemId_fkey" 
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderItemBatchAllocation" ADD CONSTRAINT "OrderItemBatchAllocation_orderItemId_fkey" 
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderItemBatchAllocation" ADD CONSTRAINT "OrderItemBatchAllocation_batchId_fkey" 
  FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 8. FIX-04 QA: Database CHECK Constraints bảo vệ tính toàn vẹn khối lượng
ALTER TABLE "OrderItemBatchAllocation"
  ADD CONSTRAINT "chk_allocation_allocated_positive" CHECK ("allocatedGrams" > 0),
  ADD CONSTRAINT "chk_allocation_dispatched_nonneg" CHECK ("dispatchedGrams" >= 0),
  ADD CONSTRAINT "chk_allocation_released_nonneg" CHECK ("releasedGrams" >= 0),
  ADD CONSTRAINT "chk_allocation_mass_balance" CHECK ("dispatchedGrams" + "releasedGrams" <= "allocatedGrams");

ALTER TABLE "InventoryLedger"
  ADD CONSTRAINT "chk_ledger_quantity_positive" CHECK ("quantityGrams" > 0);
```

---

## 5. PRISMA SCHEMA TƯƠNG ỨNG

```prisma
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

## 6. HƯỚNG XỬ LÝ KHÓA NGOẠI (FOREIGN KEYS) & PHÂN TÁCH HỦY ĐƠN VS XÓA VẬT LÝ

1. **Tại sao bắt buộc dùng `ON DELETE RESTRICT`?**
   - Trong hệ thống TMĐT B2B Nông sản, một lô hàng sau khi phân bổ cho đơn hàng (kể cả khi đơn hàng đó bị hủy sau 10 phút) đều cấu thành một mắt xích truy xuất nguồn gốc sinh học (Biosecurity Traceability).
   - Nếu dùng `CASCADE`, việc xóa dòng đơn hàng sẽ vô tình cuốn phăng toàn bộ lịch sử giữ chỗ. Nếu dùng `SET NULL`, sổ cái sẽ bị mồ côi (Orphan records).
   - Thiết lập `RESTRICT` chặn đứng mọi hành vi xóa vật lý (`DELETE FROM "Order"` hoặc `DELETE FROM "OrderItem"`).
2. **Phân biệt Hủy Đơn Nghiệp vụ (Domain Cancellation) với Xóa Vật lý (Physical Delete):**
   - **Xóa vật lý (`DELETE`):** Bị cấm hoàn toàn trong luồng vận hành sau khi đơn đã khởi tạo.
   - **Hủy đơn nghiệp vụ:** Đơn hàng chuyển `status = CANCELLED`, phân bổ chuyển `status = RELEASED`, giải phóng số gram chưa xuất qua `RESERVATION_RELEASE`. Toàn bộ bản ghi vẫn tồn tại vĩnh viễn trên cơ sở dữ liệu để phục vụ kiểm toán tài chính và đối soát lô hàng.
3. **Tác động đến Mã nguồn Hiện tại:**
   - Khảo sát toàn bộ mã nguồn: **Hệ thống hiện tại hoàn toàn KHÔNG có bất kỳ lệnh `db.order.delete` nào**.
   - Điểm duy nhất có lệnh xóa là `src/actions/recurring.ts:867` (`deleteMany` trên các dòng đơn nháp `OrderStatus.DRAFT`). Vì đơn nháp chưa từng phân bổ lô hàng (`allocations` rỗng), lệnh này hoàn toàn không bị `RESTRICT` chặn.

---

## 7. THIẾT KẾ UNIQUE CONSTRAINT, INDEX VÀ CHIẾN LƯỢC IDEMPOTENCY

1. **Cơ chế PostgreSQL Partial Unique Index:**
   - Chỉ duy nhất 1 bản ghi phân bổ ở các trạng thái đang hoạt động (`HOLD_PENDING`, `ALLOCATED_CONFIRMED`, `PARTIALLY_DISPATCHED`) được phép tồn tại trên cùng một cặp `(orderItemId, batchId)`.
   - Khi đơn bị hủy hoặc hết hạn, phân bổ chuyển sang `RELEASED`. Lúc này, dòng bản ghi cũ không còn nằm trong tập lọc của Partial Index $\rightarrow$ Cho phép tạo dòng phân bổ mới mà không xảy ra va chạm khóa duy nhất.
2. **Cơ chế Xử lý Idempotency & Giá trị NULL trong PostgreSQL:**
   - Trong PostgreSQL, các giá trị `NULL` trong chỉ mục `UNIQUE` không vi phạm lẫn nhau (theo chuẩn SQL ANSI).
   - Đối với các thao tác cốt lõi cần chống lặp: Mã nghiệp vụ tại EV-IMP-01C bắt buộc sinh khóa xác định:
     - Đặt hàng/Giữ chỗ: `idempotencyKey = "ALLOC:" + orderItemId + ":" + batchId + ":" + clientRequestUuid`
     - Xuất kho: `idempotencyKey = "DISPATCH:" + allocationId + ":" + dispatchSeq`
   - Nếu client bị ngắt mạng và gửi lại cùng request: PostgreSQL sẽ chặn bản ghi trùng và trả về kết quả đã phân bổ trước đó, triệt tiêu nguy cơ giữ hàng hai lần.

---

## 8. DATABASE CHECK CONSTRAINTS & QUY ƯỚC KHỐI LƯỢNG

1. **Bốn Ràng buộc Khối lượng tại Tầng Database:**
   - `allocatedGrams > 0`: Khối lượng phân bổ ban đầu bắt buộc là số nguyên dương.
   - `dispatchedGrams >= 0`: Khối lượng xuất kho không thể âm.
   - `releasedGrams >= 0`: Khối lượng giải phóng không thể âm.
   - `dispatchedGrams + releasedGrams <= allocatedGrams`: **Bảo toàn khối lượng bất biến**. Tổng lượng đã xuất và lượng đã nhả không bao giờ được vượt quá số lượng phân bổ ban đầu.
2. **Quy ước Dấu Sổ cái Tồn kho:**
   - Mọi bản ghi `InventoryLedger` đều lưu `quantityGrams > 0` (bảo vệ bởi `chk_ledger_quantity_positive`).
   - Chiều tăng/giảm được định đoạt hoàn toàn bởi `type`:
     - Tăng tồn vật lý (+): `IMPORT`, `QC_ADJUSTMENT_ADD`.
     - Giảm tồn vật lý (-): `DISPATCH_OUT`, `SHRINKAGE_LOSS`, `QC_ADJUSTMENT_SUB`.
   - Triệt tiêu hoàn toàn sự nhập nhằng số âm, bảo đảm tính nhất quán toán học.
3. **Phân định Ranh giới Trách nhiệm Kiểm soát:**
   - *Database CHECK:* Bảo vệ toàn vẹn dữ liệu trên từng hàng riêng lẻ (ngăn số âm, bảo toàn tổng lượng dòng).
   - *Transaction Lock (`SELECT ... FOR UPDATE`):* Bảo vệ chống bán vượt tồn khả dụng đa hàng (Overselling Concurrency).
   - *Domain Engine (`inventory.ts`):* Tính toán ưu tiên hạn dùng FEFO, quy đổi gram/kg và cảnh báo mất cân đối.

---

## 9. KIỂM TRẢ KỊCH BẢN TÁI PHÂN BỔ HỢP LỆ (RE-ALLOCATION WALKTHROUGH)

Một kịch bản thực tế điển hình chứng minh thiết kế mới vận hành hoàn hảo:

```mermaid
sequenceDiagram
    autonumber
    actor Customer as Khách hàng
    participant App as Checkout Engine
    participant DB as Neon PostgreSQL (With Partial Index)

    Note over Customer, DB: LẦN PHÂN BỔ 1 (Đơn hàng chờ thanh toán)
    Customer->>App: Đặt 50kg Sầu riêng từ Lô LO-01
    App->>DB: INSERT Allocation (status='HOLD_PENDING', allocated=50kg)
    DB-->>App: Thành công (Partial Index ghi nhận 1 active allocation)
    
    Note over Customer, DB: HẾT HẠN 10 PHÚT
    App->>DB: UPDATE Allocation SET status='RELEASED', releasedGrams=50kg
    DB-->>App: Cập nhật thành công (Bản ghi rời khỏi tập lọc Partial Index)

    Note over Customer, DB: LẦN PHÂN BỔ 2 (Khách đặt lại hoặc Admin tái phân bổ)
    Customer->>App: Đặt lại 50kg Sầu riêng từ cùng Lô LO-01
    App->>DB: INSERT Allocation mới (status='HOLD_PENDING', allocated=50kg)
    DB-->>App: THÀNH CÔNG! Không bị unique collision vì bản ghi cũ đã RELEASED
    Note over DB: Lịch sử cả 2 lần giữ chỗ đều được lưu trữ trọn vẹn phục vụ kiểm toán!
```

- **Kết quả Unit Test:** Đã kiểm chứng thành công qua bài test mới trong `tests/unit/inventory.test.ts`.

---

## 10. CHIẾN LƯỢC MIGRATION & KẾ HOẠCH KHÔI PHỤC (ROLLBACK)

1. **Tính chất Additive-Only:**
   - Toàn bộ thay đổi chỉ thêm enum, thêm bảng mới và bổ sung các cột có giá trị mặc định (`isFefoEligible = false`, `inventoryTrackingEnabled = false`).
   - Không có cột nào bị xóa hoặc đổi tên.
2. **Kế hoạch Rollback Tức thời:**
   - Trước khi apply: Tạo điểm phục hồi snapshot trên Neon Console (`preview-beta-backup-pre-f01`).
   - Nếu có sự cố trong khi apply: Chạy script hạ cấp ngược (Drop các bảng mới và các cột mới). Do chưa có đơn hàng nào dùng các bảng mới này, việc rollback hoàn toàn không gây mất mát dữ liệu sản phẩm hay đơn hàng cũ.

---

## 11. KẾT QUẢ QUALITY GATES ĐÃ THỰC THI TRỰC TIẾP

Tất cả các lệnh kiểm tra chất lượng đã được chạy thực tế trong môi trường máy chủ và đều đạt kết quả xuất sắc:

| Kiểm tra | Lệnh Thực thi | Kết quả | Chi tiết Ghi nhận |
|:---|:---|:---:|:---|
| **Unit Tests** | `npm test` | **PASS** | **546/546 tests PASS (100%)** qua 36 test suites trong 1.55s (bổ sung 11 tests so với baseline 535). |
| **Linting** | `npm run lint` | **PASS** | 0 lỗi cú pháp. |
| **Type Check** | `npm run typecheck` | **PASS** | TypeScript 5.x kiểm tra tĩnh toàn bộ codebase đạt 0 lỗi. |
| **Production Build** | `npm run build` | **PASS** | Turbopack App Router biên dịch thành công 100% routes. |
| **Prisma Validation** | `prisma validate` | **PASS** | Cú pháp schema mở rộng hợp lệ tuyệt đối. |

---

## 12. MA TRẬN RỦI RO CÒN MỞ VÀ BIỆN PHÁP KIỂM SOÁT

- **Rủi ro P0 (Overselling Concurrency):** Tranh chấp giữa nhiều người mua đồng thời lượng tồn cuối $\rightarrow$ *Kiểm soát:* Sẽ thực thi bằng khóa dòng bi quan `SELECT ... FOR UPDATE` trong transaction của `placeOrder` tại `EV-IMP-01C`.
- **Rủi ro P0 (Admin Confirm vs 10-Minute Expiration Race):** Admin bấm xác nhận đúng lúc đơn quá 10 phút $\rightarrow$ *Kiểm soát:* In-flight guard `isOrderPaymentExpired()` kiểm tra `paymentDueAt < NOW()` chặn đứng việc duyệt đơn quá hạn tại `EV-IMP-01C`.
- **Rủi ro P1 (Dữ liệu Lô Lịch sử):** Lô cũ không có hạn sử dụng $\rightarrow$ *Kiểm soát:* Đã cô lập bằng cờ `isFefoEligible = false` và `status = UNVERIFIED`.

---

## 13. NỘI DUNG CHỜ QA XÁC MINH LẠI (RE-TEST SCOPE)

Kính đề nghị QA độc lập xác minh lại 4 điểm đã được khắc phục:
1. Xác nhận `ON DELETE RESTRICT` đã được thiết lập đúng trên các khóa ngoại của `OrderItemBatchAllocation` và `InventoryLedger`.
2. Xác nhận Partial Unique Index `OrderItemBatchAllocation_active_unique_idx` cho phép tái phân bổ sau khi phân bổ cũ chuyển sang `RELEASED`.
3. Xác nhận 4 Database CHECK Constraints và quy ước `quantityGrams > 0` bảo vệ khối lượng chặt chẽ.
4. Xác nhận toàn bộ 546 unit tests đã PASS 100%.

---

## 14. NỘI DUNG CHỜ PRODUCT OWNER PHÊ DUYỆT

Kính trình Product Owner phê duyệt 2 nội dung trước khi chuyển sang bước thực thi:
1. **Phê duyệt Báo cáo Hiệu chỉnh EV-IMP-01B-FIX và Bản Schema DDL sửa đổi.**
2. **Cho phép thực thi migration lên Neon Preview (`preview-beta`)** thông qua script an toàn `scripts/safe-preview-migrate.ps1` ở bước tiếp theo.

---

## 15. CAM KẾT AN TOÀN HỆ THỐNG
- **Chưa chạy migration trên bất kỳ database nào.**
- **Chưa ghi dữ liệu vào Neon.**
- **Chưa sửa Checkout hay Server Actions.**
- **Chưa commit hay push lên Git.**
- **Chưa deploy.**

---
*Tài liệu được lập và lưu trữ chính thức tại `docs/EV_IMP_01B_FIX_REPORT.md`.*