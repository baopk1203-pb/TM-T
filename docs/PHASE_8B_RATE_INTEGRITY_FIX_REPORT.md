# BÁO CÁO KỸ THUẬT: SỬA LỖI BẢO VỆ TOÀN VẸN BẢNG CƯỚC & DELETE/UPDATE GUARD
## DEV-TASK-23-FIX01 — SHIPPING RATE INTEGRITY & DELETE GUARD

- **Dự án:** Sàn thương mại điện tử B2B Nông sản (`nong-san-b2b`)
- **Nhiệm vụ:** `DEV-TASK-23-FIX01` (Sửa phát hiện QA `OBS-8B-01` từ QA-TASK-23)
- **Độ ưu tiên:** **MAJOR / P1 — SHIPPING RATE CONFIGURATION INTEGRITY**
- **Nhánh:** `beta`
- **HEAD Baseline:** `e96986b` (`feat(shipping): complete phase 8A shipping engine and preorder settlement fix`)
- **Trạng thái thực hiện:** HOÀN THÀNH — READY FOR INDEPENDENT QA AUDIT (`QA-TASK-23-FIX01`)

---

## 1. NGUYÊN NHÂN GỐC & RỦI RO (ROOT CAUSE ANALYSIS)

### 1.1. Phát hiện từ QA-TASK-23 (`OBS-8B-01`)
Trong quá trình audit Batch 8B, QA phát hiện Server Action `deleteShippingRate` cho phép Admin xóa bất kỳ bản ghi `ShippingRate` nào theo ID mà không kiểm tra:
1. Bản ghi bị xóa có phải là bậc cước cơ sở (`minGrams = 0`) hay không.
2. Còn các bậc cước phụ (`minGrams > 0`) của loại xe đó đang tồn tại hay không.
3. Bảng cước có bị xóa sạch về 0 bản ghi, gây rơi về default ngầm ngoài ý muốn hay không.
4. Tương tự, `updateShippingRate` cho phép Admin chuyển `isActive = false` đối với bậc cước cơ sở duy nhất.

### 1.2. Hậu quả vận hành và tài chính
- Trong `src/lib/services/shipping.ts`, hàm `getEffectiveShippingRates()` tải toàn bộ bảng cước hoạt động từ DB nếu có ít nhất 1 bản ghi trong DB.
- Khi DB có bản ghi, hệ thống yêu cầu **bắt buộc phải có bậc cơ sở `minGrams = 0`** cho cả 2 loại xe `NORMAL` và `COLD`.
- Nếu Admin vô tình xóa hoặc tắt bậc `0kg` của xe `NORMAL` (trong khi vẫn còn bậc `500kg`), `getEffectiveShippingRates()` sẽ ném lỗi:
  > *"Thiếu cấu hình cước cơ sở (minGrams = 0) cho loại xe NORMAL..."*
- Khi lỗi này xảy ra, toàn bộ quy trình:
  - Báo giá cước tại màn hình Checkout (`calculateCheckoutShipping`)
  - Báo giá đơn hàng đặt trước Pre-order (`calculatePreorderShipping`)
  - Báo giá đơn hàng định kỳ Recurring (`calculateRecurringShipping`)
  đều bị sập và trả lỗi, làm gián đoạn toàn bộ hoạt động mua hàng trên hệ thống.

---

## 2. NGUYÊN TẮC BẤT BIẾN CẤU HÌNH (CONFIGURATION INVARIANT)

Quy định cấu hình bảng cước vận chuyển B2B được chuẩn hóa như sau:
> **INVARIANT BẢNG CƯỚC:**
> Khi cấu hình bảng cước trong cơ sở dữ liệu đang có hiệu lực (DB có ít nhất 1 bản ghi `ShippingRate`), hệ thống **BẮT BUỘC** phải duy trì:
> 1. Ít nhất một bậc cước cơ sở đang hoạt động (`minGrams = 0`, `isActive = true`) cho loại xe `NORMAL`.
> 2. Ít nhất một bậc cước cơ sở đang hoạt động (`minGrams = 0`, `isActive = true`) cho loại xe `COLD`.
> 3. Không cho phép xóa bậc cước cơ sở (`minGrams = 0`) khi vẫn còn các bậc cước tải trọng phụ (`minGrams > 0`) của cùng loại xe.
> 4. Không cho phép xóa bậc cước cuối cùng trong hệ thống để đưa cấu hình về trạng thái rỗng thông qua thao tác xóa thông thường.

---

## 3. CÁC THAY ĐỔI KỸ THUẬT ĐÃ THỰC HIỆN

### 3.1. Server Action: `src/actions/shipping-admin.ts`

Tất cả các Server Action quản lý cấu hình cước đã được tái cấu trúc và bọc trong Prisma Transaction (`db.$transaction`) nhằm đảm bảo tính toàn vẹn và chống race condition:

1. **`initializeDefaultShippingRates`**:
   - Chạy bên trong `db.$transaction`.
   - Bắt lỗi Prisma `P2002` (Unique constraint violation trên `[vehicleType, minGrams]`) một cách êm dịu, giúp nhiều request khởi tạo đồng thời từ nhiều Admin không bao giờ gây crash hệ thống và luôn đảm bảo tính idempotent.

2. **`createShippingRate`**:
   - Chạy bên trong `db.$transaction`.
   - Kiểm tra trùng lặp bậc cước trước khi tạo, chống ghi đè hoặc lỗi unique constraint.

3. **`updateShippingRate`**:
   - Chạy bên trong `db.$transaction`.
   - **Guard tiền điều kiện (Pre-check Guard):** Nếu thao tác cố gắng vô hiệu hóa (`isActive: false`) một bậc cước cơ sở (`minGrams = 0`), kiểm tra xem còn bậc cơ sở `0kg` nào khác của cùng loại xe đang active hay không. Nếu là bậc duy nhất, lập tức từ chối và thông báo rõ ràng bằng tiếng Việt.
   - **Guard hậu điều kiện (Post-condition Atomic Verification):** Sau khi cập nhật, truy vấn lại toàn bộ các bậc đang active trong transaction để kiểm tra Invariant. Nếu thiếu `NORMAL 0g` hoặc `COLD 0g`, giao dịch lập tức Rollback và ném ngoại lệ.

4. **`deleteShippingRate`**:
   - Chạy bên trong `db.$transaction`.
   - **Guard 1 (Bảo vệ bảng rỗng):** Nếu `totalCount <= 1`, từ chối xóa vì không cho phép xóa bậc cước cuối cùng về rỗng.
   - **Guard 2 (Bảo vệ bậc cước phụ thuộc):** Nếu bậc cần xóa là bậc cơ sở (`minGrams = 0`), đếm số bậc cước phụ (`minGrams > 0`) của loại xe đó. Nếu vẫn còn bậc phụ, từ chối xóa kèm thông báo: *"Không thể xóa bậc cước cơ sở (0kg) của loại xe ... khi vẫn còn các bậc cước tải trọng khác ... đang tồn tại."*
   - **Guard 3 (Bảo vệ bậc cơ sở duy nhất):** Nếu là bậc `0kg` duy nhất của loại xe, từ chối xóa.
   - **Guard 4 (Post-condition Atomic Verification):** Sau thao tác xóa, kiểm tra lại danh sách các bậc active còn lại trong transaction. Nếu vi phạm invariant (thiếu `NORMAL 0g` hoặc `COLD 0g`), transaction bị Rollback ngay lập tức.
   - Lưu audit log `admin.shipping_rate.delete` chỉ khi thao tác xóa và kiểm tra invariant thành công hoàn toàn.

---

## 4. BỘ TEST HỒI QUY (REGRESSION SUITE T1 – T10)

Đã bổ sung bộ kiểm thử chuyên sâu 10 test cases trong `tests/unit/shipping-admin.test.ts` (mục 9):

| Mã Test | Mô tả kịch bản kiểm thử | Kết quả mong đợi | Trạng thái |
| :--- | :--- | :--- | :---: |
| **T1** | Xóa bậc `NORMAL 0g` khi còn bậc `500kg` | REJECT với thông báo bậc phụ đang tồn tại | **PASS** |
| **T2** | Xóa bậc `COLD 0g` khi còn bậc `500kg` | REJECT với thông báo bậc phụ đang tồn tại | **PASS** |
| **T3** | Xóa bậc `0g` duy nhất đang hoạt động của một loại xe | REJECT bảo vệ cấu hình cơ sở DB | **PASS** |
| **T4** | Xóa bậc phụ `500kg`, còn bậc `0g` hợp lệ | PASS, xóa thành công và revalidate cache | **PASS** |
| **T5** | Vô hiệu hóa (`isActive = false`) bậc cơ sở cuối cùng qua update | REJECT, yêu cầu duy trì ít nhất 1 bậc active | **PASS** |
| **T6** | Không có bản ghi DB từ đầu (Default Engine) | Fallback DEFAULT hoạt động bình thường, không ghi DB | **PASS** |
| **T7** | Cố tình xóa dần các bậc để đưa bảng về rỗng | REJECT ở bậc cuối cùng, không cho bảng rỗng | **PASS** |
| **T8** | Hai request initialize defaults đồng thời (Race condition) | Không trùng lặp, xử lý nhất quán (bắt P2002) | **PASS** |
| **T9** | Hai request thay đổi cấu hình đồng thời phá vỡ Invariant | Post-condition check phát hiện và Rollback transaction | **PASS** |
| **T10**| Các thao tác bị từ chối không làm ảnh hưởng snapshot Order/Shipment | Toàn vẹn dữ liệu đơn hàng và vận đơn lịch sử | **PASS** |

---

## 5. KẾT QUẢ KIỂM THỬ VÀ QUALITY GATES

1. **Unit Test Suite:**
   - File `tests/unit/shipping-admin.test.ts`: **42/42 tests PASS** (32 tests Phase 8B + 10 tests T1–T10).
   - Toàn bộ dự án: **30 test files, 404/404 unit tests PASS (100%)**.
2. **Prisma Validate:**
   - Lệnh: `npx prisma validate`
   - Kết quả: **PASS** (Schema hợp lệ, 0 lỗi).
3. **ESLint:**
   - Lệnh: `npm run lint`
   - Kết quả: **PASS** (0 errors, 1 warning không liên quan trong script).
4. **TypeScript Typecheck:**
   - Lệnh: `npm run typecheck` (`tsc --noEmit`)
   - Kết quả: **PASS** (0 errors).
5. **Next.js Production Build:**
   - Lệnh: `npm run build`
   - Kết quả: **PASS** (Next.js 16.4.0 Turbopack biên dịch thành công toàn bộ static và dynamic routes, bao gồm `/admin/van-chuyen`).
6. **Git Diff Check:**
   - Lệnh: `git diff --check`
   - Kết quả: **PASS** (0 lỗi định dạng whitespace, 0 conflict markers).
7. **Bảo vệ GAP-01 (Neon Database Isolation):**
   - Không thực hiện bất kỳ lệnh `prisma migrate deploy`, `prisma db push`, hay script kết nối nào đến Neon DB remote.

---

## 6. DANH SÁCH FILE THAY ĐỔI TRONG DEV-TASK-23-FIX01

1. `nong-san-b2b/src/actions/shipping-admin.ts` (Sửa đổi & bổ sung Guard Delete/Update, bọc $transaction)
2. `nong-san-b2b/tests/unit/shipping-admin.test.ts` (Cập nhật mocks và thêm bộ test T1–T10)
3. `docs/PHASE_8B_RATE_INTEGRITY_FIX_REPORT.md` (Báo cáo kỹ thuật chi tiết)

---

## 7. TRẠNG THÁI HIỆN TẠI & BƯỚC TIẾP THEO

- Tất cả thay đổi của Phase 8B và bản sửa lỗi `DEV-TASK-23-FIX01` đều đang được giữ ở trạng thái **UNCOMMITTED** trên nhánh `beta` theo đúng chỉ thị an toàn của Product Owner.
- Hệ thống đã sẵn sàng cho quy trình kiểm thử độc lập: **QA-TASK-23-FIX01**.
- **Không tự ý commit, push hay deploy** trước khi có quyết định chấp thuận chính thức từ Product Owner.
