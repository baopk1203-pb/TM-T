# BÁO CÁO SỬA LỖI IDEMPOTENCY ĐIỀU CHỈNH TỒN KHO (EV-F01-ADMIN-ADJUSTMENT-IDEMPOTENCY-HOTFIX-01)
## HOTFIX REPORT: ADMIN INVENTORY ADJUSTMENT IDEMPOTENCY REINFORCEMENT

**Dự án:** E Vibe — Nông Sản B2B  
**Vai trò:** DEV 4 — Senior Full-Stack Engineer  
**Người điều phối:** ChatGPT 1 — Main Coordinator  
**Độ ưu tiên:** P1 — Demo Release Blocker  
**Phán quyết:** **`ADMIN ADJUSTMENT IDEMPOTENCY — FIXED / BETA READY`**

---

## 1. NGUYÊN NHÂN GỐC RỄ (ROOT CAUSE)

Trước bản vá:
1. Giao diện quản trị ([`batch-management.tsx`](file:///C:/Users/epicg/.gemini/antigravity/worktrees/TM%C4%90T%20Website/enable_admin_inventory_adjustment/nong-san-b2b/src/app/admin/lo-hang/batch-management.tsx)) khi gọi Server Action [`adminAdjustStock()`](file:///C:/Users/epicg/.gemini/antigravity/worktrees/TM%C4%90T%20Website/enable_admin_inventory_adjustment/nong-san-b2b/src/server/actions/inventory-operations.ts) không truyền tham số `idempotencyKey` (để `undefined`).
2. Tầng domain ([`inventory-operations.ts`](file:///C:/Users/epicg/.gemini/antigravity/worktrees/TM%C4%90T%20Website/enable_admin_inventory_adjustment/nong-san-b2b/src/lib/domain/inventory-operations.ts)) fallback về chuỗi `ADJUST:${batchId}:${type}:${Date.now()}`.
3. Trong kịch bản mất phản hồi mạng (network timeout / dropped response) hoặc người dùng click thử lại (retry), mỗi lần submit sinh ra một timestamp `Date.now()` mới. Cơ chế chống ghi trùng `tx.inventoryLedger.findUnique({ where: { idempotencyKey } })` không nhận diện được giao dịch retry, tiềm ẩn rủi ro ghi bút toán điều chỉnh kép.
4. Server Action và Transaction trước đó chưa có cơ chế kiểm tra Payload Mismatch (nếu một key được tái sử dụng với khối lượng hoặc loại điều chỉnh khác, hệ thống sẽ âm thầm trả về kết quả cũ).

---

## 2. GIẢI PHÁP & CÁC FILE ĐÃ SỬA ĐỔI (CHANGED FILES)

### Danh sách file:
```text
M  nong-san-b2b/src/app/admin/lo-hang/batch-management.tsx
M  nong-san-b2b/src/lib/domain/inventory-operations.ts
M  nong-san-b2b/src/lib/services/inventory-write.ts
M  nong-san-b2b/src/server/actions/inventory-operations.ts
M  nong-san-b2b/tests/unit/admin-inventory-adjustment.test.ts
M  nong-san-b2b/tests/integration/f01-admin-inventory-adjustment.test.ts
A  docs/EV_F01_ADMIN_ADJUSTMENT_IDEMPOTENCY_HOTFIX_01_REPORT.md
```

### Chi tiết các cải tiến bảo vệ:
1. **Quản lý Idempotency Key tại UI (`batch-management.tsx`):**
   - Bổ sung hàm xuất `generateAdjustmentIdempotencyKey(batchId)` sinh UUIDv4 ngẫu nhiên bảo mật (CSPRNG qua Web Crypto API `crypto.randomUUID()`).
   - Khởi tạo và lưu `adjustIdempotencyKey` vào state ngay khi mở Modal Điều chỉnh (trước lần gửi đầu tiên).
   - Bảo toàn nguyên vẹn `adjustIdempotencyKey` khi request gặp lỗi hoặc timeout, đảm bảo nút Retry gửi lại đúng key cũ.
   - Khi người dùng thay đổi loại điều chỉnh (`adjustType`) hoặc khối lượng (`adjustKg`), tự động tái tạo key mới tương ứng với payload mới.
   - Giải phóng key khi hoàn thành thành công hoặc đóng/hủy modal.
2. **Bảo vệ Payload Mismatch ở Tầng Service Transaction (`inventory-write.ts`):**
   - Khi tìm thấy `existingLedger`, kiểm tra chặt chẽ `batchId`, `type`, và `quantityGrams`.
   - Nếu phát hiện cùng `idempotencyKey` nhưng khác dữ liệu điều chỉnh, transaction lập tức từ chối với lỗi: `Payload mismatch`.
3. **Bắt buộc Idempotency Key tại Server Action (`inventory-operations.ts`):**
   - [`adminAdjustStock`](file:///C:/Users/epicg/.gemini/antigravity/worktrees/TM%C4%90T%20Website/enable_admin_inventory_adjustment/nong-san-b2b/src/server/actions/inventory-operations.ts) yêu cầu bắt buộc cung cấp `idempotencyKey` hợp lệ (tối thiểu 8 ký tự), chặn đứng việc client bỏ qua key.
4. **CSPRNG Fallback tại Domain Layer (`inventory-operations.ts`):**
   - Loại bỏ hoàn toàn `Date.now()`, thay thế bằng CSPRNG UUID fallback nếu caller nội bộ không truyền key.

---

## 3. THÔNG TIN COMMIT & PHÁT HÀNH (RELEASE METRICS)

- **Hotfix Code SHA:** `c80aeb716573c9ee5da465aa9098939c3628bb94`
- **Target Branch:** `origin/beta`
- **Canonical Beta URL:** https://nong-san-b2b-git-beta-baopk.vercel.app

---

## 4. KẾT QUẢ KIỂM THỬ MỤC TIÊU (TARGETED TESTS)

Toàn bộ 4 tầng kiểm thử chất lượng đã hoàn thành và đạt 100%:

| Bộ kiểm thử | Số lượng test | Kết quả | Chi tiết kiểm chứng |
| :--- | :---: | :---: | :--- |
| **Unit Tests (Adjustment & Idempotency)** | 16 tests | **PASS (100%)** | Key generation, state guards, domain CSPRNG fallback |
| **Domain Operations Unit Suite** | 27 tests | **PASS (100%)** | Toàn bộ kiểm thử tính toán và bất biến tồn kho |
| **PostgreSQL Integration Suite** | 15 tests | **PASS (100%)** | Real DB transaction, double-submit, missing key, payload mismatch, retry simulation |
| **TypeScript Typecheck (`tsc --noEmit`)** | Toàn dự án | **PASS (0 errors)** | Không phát sinh lỗi kiểu dữ liệu |
| **ESLint Linter (`npm run lint`)** | Toàn dự án | **PASS (0 errors)** | Không có lỗi linting |
| **Next.js Production Build (`npm run build`)** | 15 routes | **PASS (0 errors)** | Compile và đóng gói Turbopack hoàn tất |

---

## 5. ĐÁNH GIÁ ĐỘC LẬP & QA VERDICT

- [x] **Double-click Guard:** Client vô hiệu hóa nút submit ngay khi click.
- [x] **Network Retry:** Gửi lại cùng `idempotencyKey`, Sổ cái không bị ghi thêm dòng nào, số dư không cộng dồn.
- [x] **Payload Tampering / Mismatch:** Từ chối ngay nếu cùng key nhưng khác khối lượng/loại.
- [x] **Independent Operations:** Thao tác mới sinh UUID mới, không bị chặn nhầm.
- [x] **FEFO Invariants:** Physical >= 0, Available >= 0, Reserved giữ nguyên.

**QA Verdict:** **`PASS / READY FOR BETA INTEGRATION`**

---

## 6. VẤN ĐỀ TỒN ĐỌNG (OUTSTANDING ISSUES)
- Không có vấn đề tồn đọng kỹ thuật.
- Cơ sở dữ liệu live Neon và đơn hàng lịch sử được giữ nguyên vẹn 100%.

---

## 7. KẾT LUẬN CUỐI CÙNG (FINAL VERDICT)

# `ADMIN ADJUSTMENT IDEMPOTENCY — FIXED / BETA READY`
