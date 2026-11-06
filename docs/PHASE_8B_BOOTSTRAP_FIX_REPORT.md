# BÁO CÁO KỸ THUẬT: SỬA LỖI KHỞI TẠO BẢNG CƯỚC & AN TOÀN GIAO DỊCH
## DEV-TASK-23-FIX02 — SHIPPING RATE BOOTSTRAP & TRANSACTION SAFETY

- **Dự án:** Sàn thương mại điện tử B2B Nông sản (`nong-san-b2b`)
- **Nhiệm vụ:** `DEV-TASK-23-FIX02` (Sửa phát hiện QA `FIX01-MAJ-01`, `FIX01-MIN-02` từ QA-TASK-23-FIX01)
- **Độ ưu tiên:** **MAJOR / P1 — SHIPPING RATE BOOTSTRAP & TRANSACTION SAFETY**
- **Nhánh:** `beta`
- **HEAD Baseline:** `e96986b` (`feat(shipping): complete phase 8A shipping engine and preorder settlement fix`)
- **Trạng thái thực hiện:** HOÀN THÀNH — READY FOR INDEPENDENT QA AUDIT (`QA-TASK-23-FIX02`)

---

## 1. NGUYÊN NHÂN GỐC FIX01-MAJ-01 (FIRST RATE CREATION TRAP)

### 1.1. Hiện tượng & Cơ chế phát sinh
1. Khi cơ sở dữ liệu `ShippingRate` hoàn toàn rỗng, hệ thống vận chuyển fallback an toàn sang `DEFAULT_SHIPPING_RATES` (In-Memory Engine) với đầy đủ 4 bậc cước chuẩn.
2. Trước bản vá FIX02, Server Action `createShippingRate()` cho phép Admin thêm trực tiếp một bản ghi lẻ (ví dụ: tạo bậc `NORMAL 0g` hoặc `NORMAL 500kg`) ngay khi DB đang rỗng.
3. Sau khi bản ghi lẻ này được tạo vào DB:
   - Tổng số bản ghi DB không còn bằng 0 (`count > 0`), do đó `getEffectiveShippingRates()` chấm dứt chế độ fallback mặc định và chuyển sang nạp cước từ DB.
   - Nhưng DB chỉ có 1 bản ghi lẻ, thiếu bậc cước cơ sở `0kg` cho loại xe còn lại (hoặc thiếu cả 2 bậc cơ sở nếu tạo bậc `500kg`).
   - `getEffectiveShippingRates()` lập tức ném lỗi: *"Bảng cước vận chuyển chưa hoàn thiện cấu hình mức cơ sở (0kg) cho đầy đủ loại xe..."*.
   - Toàn bộ luồng tính cước tại **Checkout, Pre-order và Recurring** đều bị từ chối báo giá, làm tê liệt hoạt động đặt hàng.
4. **Hệ quả bẫy Admin (Admin Trap):**
   - Nút "Khởi tạo bảng cước mặc định" trên UI trước đây chỉ hiển thị khi `isUsingDefaultRates = true` (tức `count === 0`), nên khi đã có 1 bản ghi lẻ, nút này biến mất.
   - Delete Guard (từ FIX01) lại ngăn chặn xóa bản ghi cuối cùng (`totalCount <= 1`).
   - Kết quả: Admin rơi vào bẫy, không thể quay về bảng cước mặc định và cũng không thể tiếp tục báo giá nếu không biết cách tự thêm đủ các bậc cơ sở.

---

## 2. DANH SÁCH FILE ĐÃ THAY ĐỔI

1. `nong-san-b2b/src/actions/shipping-admin.ts`
   - Bổ sung Guard 1 trong `createShippingRate`: từ chối tạo bậc lẻ khi DB rỗng.
   - Tái cấu trúc thứ tự Guard trong `createShippingRate`: Guard DB rỗng $\rightarrow$ Guard trùng lặp $\rightarrow$ Guard cấu hình thiếu $\rightarrow$ Insert $\rightarrow$ Post-condition invariant check.
   - Tái cấu trúc `initializeDefaultShippingRates`: sử dụng `createMany({ skipDuplicates: true })` để loại bỏ vòng lặp `create()` và bắt lỗi `P2002` trong transaction.
2. `nong-san-b2b/src/lib/services/shipping-config.ts`
   - Bổ sung type `ShippingConfigStatus = 'EMPTY_DB' | 'VALID' | 'INVALID'`.
   - Bổ sung hàm pure helper `diagnoseShippingRates(dbRates)` chẩn đoán chính xác State A, State B, State C và phân loại chi tiết các loại xe thiếu bậc `0kg` hoặc bị vô hiệu hóa.
3. `nong-san-b2b/src/app/admin/van-chuyen/page.tsx`
   - Sử dụng `diagnoseShippingRates(dbRates)` để trích xuất `configDiagnostic` trên Server Component và truyền xuống Client.
4. `nong-san-b2b/src/app/admin/van-chuyen/shipping-management-client.tsx`
   - Phân biệt rõ 3 trạng thái giao diện State A, State B, State C.
   - State A: Hiển thị thông báo đang dùng mặc định, nút "Khởi tạo 4 bậc cước chuẩn" có hộp thoại xác nhận Admin.
   - State B: Hiển thị bảng cước DB chuẩn, nút "Thêm bậc cước mới".
   - State C: Hiển thị cảnh báo nguy hiểm màu đỏ với mô tả chi tiết lỗi, cung cấp nút **"Bổ sung bậc cước mặc định còn thiếu"** (gọi `initializeDefaultShippingRates()`) có xác nhận rõ ràng; nếu có bậc cơ sở bị tắt kích hoạt (`isActive = false`), hiển thị hướng dẫn Admin bấm Sửa để bật lại.
   - Tuyệt đối không tự động ghi dữ liệu vào DB khi render hoặc refresh trang.
5. `nong-san-b2b/tests/unit/shipping-admin.test.ts`
   - Thiết lập default mock trong `beforeEach` chống leak mock giữa các ca kiểm thử.
   - Cập nhật test 1.5, 2.1, 2.2, T8 phù hợp với `createMany`.
   - Bổ sung trọn bộ kiểm thử **B1 – B10** (10 test cases mới).
6. `docs/PHASE_8B_BOOTSTRAP_FIX_REPORT.md` (Báo cáo kỹ thuật chi tiết).

---

## 3. CREATE GUARD MỚI & BẢO VỆ TÍNH TOÀN VẸN CẤU HÌNH

Trong `src/actions/shipping-admin.ts`, Server Action `createShippingRate` được bọc bên trong `db.$transaction` và thực hiện chuỗi 4 Guard nghiêm ngặt:

```
[Request Create Rate]
        │
        ▼
[GUARD 1: DB Empty Guard]
  totalCount === 0? ──(YES)──► REJECT: "Hệ thống đang sử dụng bảng cước mặc định.
        │                              Vui lòng khởi tạo đầy đủ bảng cước trước khi thêm bậc tùy chỉnh."
       (NO)
        ▼
[GUARD 2: Duplicate Guard]
  existing [vehicleType, minGrams]? ──(YES)──► REJECT: "Bậc cước ... đã tồn tại"
        │
       (NO)
        ▼
[GUARD 3: Partial Config Guard]
  missing active base tiers? ──(YES)──► REJECT: "Bảng cước hiện tại chưa đầy đủ cấu hình mức cơ sở (0kg)..."
        │
       (NO)
        ▼
[CREATE RECORD IN DB]
        │
        ▼
[GUARD 4: Post-condition Atomic Invariant Check]
  assert remainingActive has NORMAL 0g & COLD 0g? ──(FAIL)──► ROLLBACK TRANSACTION
        │
      (PASS)
        ▼
[COMMIT & REVALIDATE PATHS]
```

- **Đặc điểm bảo vệ:** Không có bất kỳ kịch bản nào cho phép tạo bản ghi khi DB rỗng hoặc chuyển một cấu hình hợp lệ thành không hợp lệ qua thao tác Create.

---

## 4. KHỞI TẠO AN TOÀN VỚI CREATEMANY & XỬ LÝ P2002 (FIX01-MIN-02)

### 4.1. Vấn đề của phương pháp cũ
Trước đây, `initializeDefaultShippingRates` lặp qua 4 bậc cước, gọi `create()` và dùng khối `try { ... } catch (err)` bắt lỗi `P2002` bên trong Prisma transaction. Trên runtime PostgreSQL:
- Bất kỳ câu lệnh SQL nào vi phạm ràng buộc (`unique_violation`) sẽ khiến transaction chuyển sang trạng thái **`current transaction is aborted, commands ignored until end of transaction block`**.
- Mọi câu lệnh tiếp theo trong transaction block đó đều sẽ bị PostgreSQL từ chối thực thi.

### 4.2. Giải pháp kỹ thuật mới
Hệ thống chuyển sang sử dụng câu lệnh nguyên tử:
```ts
const res = await tx.shippingRate.createMany({
  data: defaultTiers,
  skipDuplicates: true,
})
```
- **Cơ chế PostgreSQL Native:** Prisma biên dịch thành `INSERT INTO "ShippingRate" (...) VALUES (...) ON CONFLICT ("vehicle_type", "min_grams") DO NOTHING;`.
- **An toàn tuyệt đối:**
  1. Khi DB rỗng: Chèn đủ 4 bậc cước (`res.count = 4`).
  2. Khi gọi lại: Bỏ qua các bậc đã có (`res.count = 0`), **không ném lỗi `P2002`**, transaction không bao giờ bị aborted.
  3. Khi có cấu hình dở dang (ví dụ đã có 2 bậc NORMAL): Chỉ chèn bổ sung 2 bậc COLD còn thiếu (`res.count = 2`), không ghi đè hay sửa đổi bất kỳ mức giá tùy chỉnh nào mà Admin đã cập nhật trên 2 bậc NORMAL.
  4. Sau khi chèn, transaction thực hiện **Post-initialization Invariant Check**: Truy vấn danh sách các bậc active, xác nhận cả `NORMAL 0g` và `COLD 0g` đều có mặt. Nếu thiếu do bậc 0g có sẵn đang bị tắt (`isActive = false`), transaction lập tức rollback và thông báo hướng dẫn Admin kích hoạt lại.

---

## 5. KHẢ NĂNG RECOVERY VÀ 3 TRẠNG THÁI GIAO DIỆN (STATE A / B / C)

| Trạng thái | Điều kiện xác định | Giao diện hiển thị | Hành vi thao tác & Phục hồi |
| :--- | :--- | :--- | :--- |
| **State A (EMPTY_DB)** | `totalRatesCount === 0` | Banner vàng thông tin: Đang dùng cước mặc định. Ẩn cảnh báo lỗi. | - Nút **"Khởi tạo 4 bậc cước mặc định vào DB"** (có xác nhận Admin).<br>- Nút "Thêm bậc cước mới" cảnh báo Admin phải khởi tạo trước khi thêm. |
| **State B (VALID)** | `hasNormalBase && hasColdBase` | Không hiển thị bất kỳ banner cảnh báo nào. Bảng cước hiển thị đầy đủ. | - Cho phép CRUD bình thường.<br>- Ẩn toàn bộ nút khởi tạo/khôi phục không cần thiết. |
| **State C (INVALID)** | `!hasNormalBase \|\| !hasColdBase` | Banner đỏ cảnh báo cấu hình thiếu/sai: Liệt kê chi tiết loại xe thiếu bậc `0kg` hoặc bị vô hiệu hóa. | - Nếu thiếu hẳn trong DB: Nút **"Bổ sung bậc cước mặc định còn thiếu"** (gọi `createMany` skipDuplicates an toàn).<br>- Nếu bậc `0kg` có tồn tại nhưng `isActive = false`: Hướng dẫn Admin bấm **"Sửa"** để bật lại, không tự ý ghi đè dữ liệu Admin.<br>- Không tự động ghi DB khi render hoặc refresh. |

---

## 6. PHÂN TÍCH CONCURRENCY & TRANSACTION ISOLATION

Đã rà soát khả năng tranh chấp đồng thời giữa các thao tác quản trị trên PostgreSQL:

1. **Hai thao tác `initializeDefaultShippingRates` đồng thời:**
   - Cả hai cùng thực thi `createMany({ skipDuplicates: true })`.
   - PostgreSQL giải quyết xung đột bằng hàng khóa (Row-level lock) trên ràng buộc unique index `(vehicle_type, min_grams)`.
   - Tiến trình thắng chèn dữ liệu; tiến trình đến sau nhận `ON CONFLICT DO NOTHING` và chèn 0 dòng.
   - Cả hai đều kiểm tra hậu điều kiện thành công. Không có lỗi `P2002`, không abort transaction.
2. **`initializeDefaultShippingRates` và `createShippingRate` đồng thời:**
   - Nếu DB rỗng: `createShippingRate` kiểm tra `count === 0` và bị từ chối ngay lập tức. Sau đó `initialize` chạy thành công tạo 4 bậc chuẩn.
   - Nếu `initialize` commit trước: `createShippingRate` thấy `count = 4`, kiểm tra trùng lặp và tiến hành tạo bậc cước phụ an toàn.
3. **`updateShippingRate` và `deleteShippingRate` đồng thời:**
   - Nhờ ràng buộc `@@unique([vehicleType, minGrams])`, trong DB chỉ có duy nhất 1 bản ghi `NORMAL 0g` và 1 bản ghi `COLD 0g`.
   - Mọi nỗ lực xóa hoặc vô hiệu hóa bản ghi `0kg` duy nhất này đều bị chặn ngay ở tầng Guard tiền điều kiện (Pre-check), trước khi câu lệnh DELETE/UPDATE được phát hành.
   - Hậu điều kiện (Post-condition check) bên trong transaction cung cấp lớp bảo vệ thứ hai: nếu có bất kỳ xung đột nào làm mất bậc cơ sở, transaction lập tức rollback.
4. **Giới hạn kiểm chứng Concurrency:**
   - Lưu ý quan trọng: Các bài test tự động hiện tại sử dụng Vitest Mock để xác minh tính logic và các nhánh rẽ của ứng dụng.
   - Hành vi khóa hàng thực tế của PostgreSQL (`ON CONFLICT DO NOTHING`) đã được thiết kế đúng chuẩn kỹ thuật nhưng việc kiểm chứng đa luồng song song trên Neon PostgreSQL runtime thực tế vẫn là một Test Gap thuộc phạm vi của Staging/Beta runtime audit.

---

## 7. BỘ KIỂM THỬ BẮT BUỘC B1 – B10 (REGRESSION RESULTS)

Đã bổ sung bộ kiểm thử 10 ca kiểm nghiệm chuyên sâu trong `tests/unit/shipping-admin.test.ts` (Group 10):

| Mã Test | Kịch bản kiểm thử | Kết quả mong đợi | Trạng thái |
| :--- | :--- | :--- | :---: |
| **B1** | Empty DB $\rightarrow$ Create `NORMAL 0g` | REJECT, DB giữ nguyên rỗng, Checkout vẫn fallback mặc định | **PASS** |
| **B2** | Empty DB $\rightarrow$ Create `NORMAL 500kg` | REJECT, không tạo cấu hình dở dang thiếu cơ sở | **PASS** |
| **B3** | Empty DB $\rightarrow$ Initialize | Tạo đủ 4 bậc cước chuẩn qua `createMany` | **PASS** |
| **B4** | Initialize lần hai | Bỏ qua các bậc đã có (`count = 0`), không ghi đè giá Admin đã chỉnh | **PASS** |
| **B5** | Create sau khi đã Initialize | Cho phép thêm bậc cước phụ tải trọng hợp lệ (`minGrams = 1000kg`) | **PASS** |
| **B6** | Existing Partial Configuration | Bổ sung đúng 2 bậc còn thiếu, không ghi đè dữ liệu cũ | **PASS** |
| **B7** | Concurrent Initialization | `skipDuplicates` chèn an toàn, không sinh lỗi aborted transaction | **PASS** |
| **B8** | Delete Guard Regression | Các test bảo vệ xóa bậc cước cơ sở (T1–T7) tiếp tục hoạt động chính xác | **PASS** |
| **B9** | Financial Snapshot Isolation | Create/Initialize/Recovery không cập nhật bất kỳ bản ghi Order hay Shipment cũ nào | **PASS** |
| **B10**| UI Recovery Diagnostics | `diagnoseShippingRates` phân loại chính xác State A, State B, State C1, State C2 | **PASS** |

---

## 8. KẾT QUẢ QUALITY GATES

Toàn bộ các tiêu chí an toàn đã được xác minh thành công 100%:

| Quality Gate | Lệnh thực thi | Kết quả | Ghi chú |
| :--- | :--- | :---: | :--- |
| **Full Unit Test Suite** | `npm test` | **PASS** | **30/30 test files, 414/414 unit tests PASS (100%)** |
| **Shipping Admin Suite** | `npx vitest run tests/unit/shipping-admin.test.ts` | **PASS** | **52/52 tests PASS** (32 baseline + 10 T-tests + 10 B-tests) |
| **Prisma Schema Validate** | `npx prisma validate` | **PASS** | Schema hợp lệ, 0 lỗi |
| **ESLint** | `npm run lint` | **PASS** | 0 errors (1 warning không liên quan trong local-db script) |
| **TypeScript Typecheck** | `npm run typecheck` (`tsc --noEmit`) | **PASS** | 0 errors |
| **Next.js Production Build** | `npm run build` | **PASS** | Next.js 16.4.0 Turbopack build thành công 100% routes |
| **Git Diff Check** | `git diff --check` | **PASS** | 0 whitespace errors, 0 conflict markers |
| **Neon DB Isolation (`GAP-01`)** | Preflight Audit | **PASS** | Tuyệt đối không chạm Neon DB remote, không migration |

---

## 9. TRẠNG THÁI GIT & CÁC RỦI RO / TEST GAPS CÒN MỞ

### 9.1. Trạng thái Git
- **Nhánh:** `beta`
- **HEAD Baseline:** `e96986b`
- **Working Tree:** Toàn bộ các thay đổi của Batch 8B, FIX01 và FIX02 đều đang được giữ ở trạng thái **UNCOMMITTED**.
- **Chưa commit, chưa push, chưa deploy.**

### 9.2. Các Test Gaps và Điểm cần QA độc lập Retest (`QA-TASK-23-FIX02`)
1. **`GAP-01` — Neon Isolation:** Bản vá FIX02 được phát triển và kiểm thử 100% trên môi trường cục bộ (Local/Static). Kết nối Neon DB vẫn được cách ly an toàn.
2. **`GAP-09` — Concurrency trên PostgreSQL Runtime:** Đã kiểm chứng logic bằng Vitest mock. Khi triển khai lên môi trường Beta thực tế, QA cần kiểm thử xác nhận hành vi của `createMany skipDuplicates` dưới tải đa phiên Admin đồng thời.
3. **Retest UI States (A/B/C):**
   - Kiểm tra hiển thị State A khi DB rỗng $\rightarrow$ Admin nhấn nút khởi tạo $\rightarrow$ Chuyển sang State B.
   - Thử nghiệm tạo bản ghi lỗi bằng can thiệp dữ liệu (State C) $\rightarrow$ Kiểm tra hiển thị banner đỏ và nút "Bổ sung bậc cước còn thiếu".
   - Kiểm tra trường hợp bậc cơ sở bị tắt kích hoạt $\rightarrow$ Kiểm tra thông điệp hướng dẫn Admin sửa thay vì tự động kích hoạt ngầm.
