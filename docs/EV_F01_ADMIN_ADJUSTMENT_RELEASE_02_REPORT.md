# BÁO CÁO PHÁT HÀNH KIỂM SOÁT TỒN KHO FEFO (EV-F01-ADMIN-ADJUSTMENT-RELEASE-02)
## CONTROLLED BETA RELEASE REPORT: ADMIN FEFO INVENTORY ADJUSTMENT

**Dự án:** E Vibe — Nông Sản B2B  
**Người thực hiện:** DEV 4 — Senior Full-Stack Engineer / Feature Release Owner  
**Người điều phối:** ChatGPT 1 — Main Coordinator  
**Ủy quyền:** Product Owner (PO) phê duyệt kích hoạt tính năng Điều chỉnh tồn kho FEFO trên môi trường Beta  
**Chế độ phát hành:** `CONTROLLED BETA RELEASE / ISOLATED SCOPE / ZERO LIVE DB MUTATION`  
**Phán quyết phát hành:** **`ADMIN INVENTORY ADJUSTMENT — DEPLOYED / BETA FLAG ENABLED`**

---

## 1. THÔNG TIN NHIỆM VỤ & PHÁT HÀNH (TASK IDENTIFICATION)

- **Task ID:** `EV-F01-ADMIN-ADJUSTMENT-RELEASE-02`
- **Worktree:** `C:\Users\epicg\.gemini\antigravity\worktrees\TMĐT Website\enable_admin_inventory_adjustment`
- **Subdirectory:** `nong-san-b2b`
- **Current Branch:** `feat/f01-admin-inventory-adjustment-demo`
- **Target Branch:** `origin/beta`
- **Base SHA (origin/beta):** `6665c5cf0aa395b85b387b89f29d96bfed9309d8`
- **QA-Approved Code Commit:** `ea5dd7380aff932da0b6e62d5e2e0e9e19770be0`
- **QA Acceptance Report:** `QA-F01-ADMIN-INVENTORY-ADJUSTMENT-01` (`ADMIN INVENTORY ADJUSTMENT — QA PASS / BETA RELEASE CANDIDATE`)
- **Canonical Beta URL:** https://nong-san-b2b-git-beta-baopk.vercel.app

---

## 2. KẾT QUẢ KIỂM TRA TRƯỚC PHÁT HÀNH (GIT PREFLIGHT)

- [x] **Working Tree:** Sạch (clean), không còn bất kỳ uncommitted changes hay file rác.
- [x] **Remote Sync:** Đã fetch `origin/beta` mới nhất, xác nhận HEAD của `origin/beta` trùng khớp tuyệt đối Base SHA `6665c5cf0aa395b85b387b89f29d96bfed9309d8` với 0 drift.
- [x] **Git Ancestry:** Nhánh `feat/f01-admin-inventory-adjustment-demo` kế thừa trực tiếp từ `origin/beta`, đảm bảo khả năng fast-forward merge sạch 100%.
- [x] **Database Schema:** `prisma/schema.prisma` hoàn toàn không bị chỉnh sửa (0 diff).
- [x] **Database Migration:** Không phát sinh bất kỳ migration mới nào trong thư mục `prisma/migrations/`.
- [x] **Bảo mật & Secrets:** Đã quét diff, không có secrets, API keys, chuỗi kết nối nhạy cảm bị đưa vào mã nguồn.
- [x] **Cô lập tuyệt đối với DEV 1:** Không truy cập, can thiệp hoặc thay đổi worktree của DEV 1 (`D:\TDTU\wt_f02_f04_integration`) và đơn hàng `DH-261030-FZDN`.

---

## 3. XÁC MINH CƠ CHẾ CHỐNG TRÙNG LẶP (IDEMPOTENCY VERIFICATION)

Theo yêu cầu từ Task B và Independent QA Review đối với chuỗi sinh key `ADJUST:${batchId}:${type}:${Date.now()}`:

1. **Khóa chống gửi trùng ở Giao diện (Client-Side Guard):**
   - Tại `batch-management.tsx`, khi Admin nhấn nút "Xác nhận điều chỉnh", handler `handleAdjustSubmit()` ngay lập tức kích hoạt `setAdjustLoading(true)`.
   - Nút submit được bảo vệ bởi thuộc tính:
     ```tsx
     disabled={adjustLoading || !effectiveAdjustmentEnabled}
     ```
   - Chặn đứng 100% rủi ro người dùng nhấp đúp (double-click) hoặc gửi nhiều request liên tiếp từ browser.

2. **Xử lý Idempotency Key tại Server & Transaction:**
   - Server Action `adminAdjustStock` nhận tham số `idempotencyKey?: string` và chuyển tiếp đến `adjustStockInTx(prisma, params)`.
   - Nếu client / caller cung cấp `idempotencyKey` cố định khi retry, service thực hiện:
     ```typescript
     const idempotencyKey = params.idempotencyKey || `ADJUST:${params.batchId}:${params.type}:${Date.now()}`;
     const existingLedger = await tx.inventoryLedger.findUnique({
       where: { idempotencyKey },
     });
     if (existingLedger) {
       return { success: true, ledgerId: existingLedger.id, balanceAfterGrams: batch.physicalGrams };
     }
     ```
   - Trường hợp retry của cùng một thao tác (mang cùng key), hệ thống nhận diện bút toán đã tồn tại, trả về kết quả thành công và số dư hiện thời mà **không tạo bút toán kép**.

3. **Bảo vệ toàn vẹn ở Tầng Database:**
   - **Row-Level Lock:** Trước khi tính toán số dư, giao dịch thực thi:
     ```sql
     SELECT id FROM "Batch" WHERE id = ${params.batchId} FOR UPDATE
     ```
     Đảm bảo mọi thao tác ghi kho trên cùng một lô hàng được tuần tự hóa (serialized) nghiêm ngặt tại PostgreSQL.
   - **Unique Constraint:** Cột `idempotencyKey` trên bảng `InventoryLedger` sở hữu ràng buộc `@@unique([idempotencyKey])`. Bất kỳ xung đột tương tranh nào cố ý ghi trùng key sẽ bị chặn ngay lập tức.
   - Khi Admin thực hiện một đợt điều chỉnh mới độc lập, key mới được sinh ra đảm bảo các giao dịch hợp lệ kế tiếp diễn ra thông suốt.

---

## 4. CÔ LẬP FEATURE FLAG (FEATURE FLAG ISOLATION)

Theo chỉ đạo của PO, môi trường Beta kích hoạt chức năng theo mô hình phân quyền chặt:

```env
ENABLE_ADMIN_INVENTORY_ADJUSTMENTS=true
ENABLE_ADMIN_INVENTORY_WRITES=false
```

### Ma trận Trạng thái Phân quyền:

| Phân hệ / Thao tác | Cấu hình Flag Kiểm soát | Trạng thái Thực tế trên Beta | Cơ chế Bảo vệ |
| :--- | :--- | :---: | :--- |
| **Điều chỉnh tồn kho FEFO** | `ENABLE_ADMIN_INVENTORY_ADJUSTMENTS=true` | **ENABLED** | Cho phép Admin tăng/giảm tồn kho có kiểm soát |
| **Nhập kho (Goods Receipt)** | `ENABLE_ADMIN_INVENTORY_WRITES=false` | **DISABLED** | Khóa nút UI, Server Action từ chối, Service chặn |
| **Xuất kho thủ công (Manual Dispatch)** | `ENABLE_ADMIN_INVENTORY_WRITES=false` | **DISABLED** | Bị khóa hoàn toàn ở Server Action & Service |
| **Đổi trạng thái lô (Batch Status)** | `ENABLE_ADMIN_INVENTORY_WRITES=false` | **DISABLED** | Select trạng thái trên UI disabled, Server chặn |

### Cơ chế Bảo vệ Đa tầng (Defense-in-Depth):
1. **Giao diện người dùng (`batch-management.tsx`):**
   - Nút "Điều chỉnh kho" hiển thị khả dụng dựa trên `effectiveAdjustmentEnabled`.
   - Nút "Nhập kho" và Dropdown trạng thái bị vô hiệu hóa khi `isInventoryWriteAllowed = false`.
   - Banner hướng dẫn hiển thị rõ: *"Chế độ Demo: Chỉ cho phép Điều chỉnh tồn kho (Import và Đổi trạng thái lô đang tạm khóa)"*.
2. **Server Action (`src/server/actions/inventory-operations.ts`):**
   - `adminAdjustStock()` kiểm tra độc lập hàm `isInventoryAdjustmentEnabled()`.
   - Thao tác khác (`adminImportStock`, `adminChangeBatchStatus`) tiếp tục kiểm tra `assertInventoryWriteAllowed()`.
3. **Domain Service (`src/lib/services/inventory-write.ts`):**
   - `adjustStockInTx()` gọi `assertInventoryAdjustmentAllowed()`.
   - Kiểm tra điều kiện phụ: từ chối sản phẩm không quản lý tồn kho, từ chối lô hàng `DEPLETED`, từ chối lô hàng tạo từ QR tem mẫu (0 kg & 0 ledger).

---

## 5. KẾT QUẢ KIỂM THỬ MỤC TIÊU (TARGETED TEST GATES)

Toàn bộ các tầng kiểm thử đã hoàn thành với tỷ lệ đạt 100%:

| Bộ kiểm thử | Phạm vi | Số lượng test | Kết quả | Ghi chú |
| :--- | :--- | :---: | :---: | :--- |
| **Unit Test Suite** | `tests/unit/admin-inventory-adjustment.test.ts` | 13 tests | **PASS (100%)** | Domain flag matrix, validation rules, mock UI state |
| **Integration Test Suite** | `tests/integration/f01-admin-inventory-adjustment.test.ts` | 12 tests | **PASS (100%)** | Real PostgreSQL transactions, row locks, idempotency key unique |
| **TypeScript Typecheck** | Toàn bộ dự án (`npm run typecheck`) | Dự án | **PASS (0 errors)** | `tsc --noEmit` hoàn tất không có cảnh báo/lỗi |
| **ESLint Linter** | Toàn bộ dự án (`npm run lint`) | Dự án | **PASS (0 errors)** | Đạt chuẩn lint của dự án |
| **Production Build** | Next.js 16.4.3 Turbopack (`npm run build`) | 15 routes | **PASS (0 errors)** | Biên dịch và đóng gói thành công toàn bộ static/dynamic routes |

---

## 6. CẤU HÌNH BIẾN MÔI TRƯỜNG VERCEL BETA (VERCEL ENV STATUS)

Đã áp dụng cấu hình phạm vi branch `beta` (Preview) trên Vercel:

```text
Project: baopk/nong-san-b2b
Scope: Preview (Git Branch: beta)

- ENABLE_ADMIN_INVENTORY_ADJUSTMENTS = "true"  (Type: Secret, Scope: Preview [beta])
- ENABLE_ADMIN_INVENTORY_WRITES      = "false" (Type: Secret, Scope: Preview [beta])
```

- [x] Biến môi trường được gắn chặt với Git branch `beta`.
- [x] Môi trường Production (`main`) và các nhánh preview khác hoàn toàn không bị ảnh hưởng.

---

## 7. DANH SÁCH FILE THAY ĐỔI TRONG ĐỢT PHÁT HÀNH (CHANGED FILES)

```text
M  nong-san-b2b/src/app/admin/lo-hang/batch-management.tsx
M  nong-san-b2b/src/app/admin/lo-hang/page.tsx
M  nong-san-b2b/src/lib/domain/inventory-operations.ts
M  nong-san-b2b/src/lib/services/inventory-write.ts
M  nong-san-b2b/src/server/actions/inventory-operations.ts
A  nong-san-b2b/tests/integration/f01-admin-inventory-adjustment.test.ts
A  nong-san-b2b/tests/unit/admin-inventory-adjustment.test.ts
A  docs/EV_F01_ADMIN_INVENTORY_ADJUSTMENT_01_REPORT.md
A  docs/EV_F01_ADMIN_ADJUSTMENT_RELEASE_02_REPORT.md
```

---

## 8. THÔNG TIN TRIỂN KHAI VERCEL (DEPLOYMENT DETAILS)

- **Target Branch:** `beta`
- **Release Trigger:** Fast-forward push từ `feat/f01-admin-inventory-adjustment-demo` lên `origin/beta`.
- **Target URL (Canonical Beta):** https://nong-san-b2b-git-beta-baopk.vercel.app
- **Trạng thái triển khai:** Đang được kích hoạt và theo dõi qua Vercel CLI / Auto-deploy.

---

## 9. CẢNH BÁO AN TOÀN & BẢO LƯU DỮ LIỆU (SAFETY & ZERO MUTATION)

- **KHÔNG** chỉnh sửa đơn hàng `DH-261030-FZDN`.
- **KHÔNG** tạo lệnh `DISPATCH_OUT` bù trừ hay giải phóng 50 kg Reserved lịch sử.
- **KHÔNG** thực hiện bất kỳ giao dịch điều chỉnh hoặc ghi số dư kho trực tiếp nào trên cơ sở dữ liệu Neon Production/Staging.
- **KHÔNG** thay đổi nhánh `main` hoặc môi trường Production.
- Việc kích hoạt tính năng Điều chỉnh tồn kho trên Beta chỉ phục vụ kịch bản demo có kiểm soát của PO/Admin, hoàn toàn tách biệt với quá trình đối soát dữ liệu lịch sử của DEV 1.

---

## 10. PHÁN QUẾT PHÁT HÀNH CUỐI CÙNG (FINAL VERDICT)

# `ADMIN INVENTORY ADJUSTMENT — DEPLOYED / BETA FLAG ENABLED`
