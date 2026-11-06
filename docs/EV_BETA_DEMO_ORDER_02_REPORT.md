# EV-BETA-DEMO-ORDER-02 — REPORT
## FINAL SECURITY HARDENING, DELIVERY SLOT HARMONIZATION & AUTHORIZED BETA RELEASE

**Dự án:** E Vibe — Nông Sản B2B  
**Agent:** DEV 1 — Release Integrator / Senior Full-Stack Engineer  
**Ủy quyền:** Product Owner (PO) & ChatGPT 1 — Main Coordinator  
**Task ID:** `EV-BETA-DEMO-ORDER-02`  
**Ngày thực hiện:** 2026-10-29  
**Chế độ thực thi:** `TARGETED SECURITY HARDENING / APPROVED DELIVERY SLOT POLICY / CONDITIONAL BETA DEPLOYMENT`  
**Final Verdict:** `DELIVERY SLOT HOTFIX — DEPLOYED / BROWSER QA PENDING`  
`DB VERIFICATION TOOL — SECURITY HARDENED / LIVE EXECUTION PENDING`  
`EV BETA DEMO ORDER — DB EVIDENCE PENDING`

---

## I. THÔNG TIN PHIÊN LÀM VIỆC & GIT IDENTITIES

| Thuộc tính | Giá trị |
|---|---|
| **Task ID** | `EV-BETA-DEMO-ORDER-02` |
| **Repository Chính** | `D:\TDTU\TMĐT Website` (`D:\TMĐT Website`) |
| **Worktree Cô Lập** | `D:\TDTU\wt_f02_f04_integration` |
| **Branch Phát triển** | `fix/qa05-delivery-slot-hotfix` |
| **Branch Phát hành** | `beta` (Fast-forward merge) |
| **Target Remote** | `origin/beta` |
| **Base Commit SHA** | `7ede4cfcdacb8ba6c72dea6c7568063fe244e990` |
| **Code Hotfix SHA** | `aa31f7ceb777ad84324e118f9884ab5ce485352d` |
| **Full Release SHA** | `e8ebc1328ebbc19f9fe6cbfa97ef87ca8681335b` |
| **Vercel Deployment ID** | `dpl_AZBoM1JeyzzXiLKwG2wNw4XCDFYB` |
| **Deployment URL** | https://nong-san-b2b-1xlbwuduz-baopk.vercel.app |
| **Canonical Beta URL** | https://nong-san-b2b-git-beta-baopk.vercel.app |
| **Deployment Status** | `● Ready` (Build duration: 39s) |
| **Đơn hàng Demo mục tiêu** | `DH-261029-ASRT` |
| **Branch `main`** | **STRICTLY UNTOUCHED** (Không checkout, không merge, không push) |

---

## II. QUYẾT ĐỊNH CHÍNH THỨC CỦA PRODUCT OWNER (PO)

- **Decision ID:** `EV-PO-DELIVERY-SLOT-DECISION-01`
- **Trạng thái:** `PO APPROVED — FINAL POLICY`
- **Chính sách khung giờ giao hàng chuẩn toàn hệ thống:**

| Enum (Database) | Tên tiếng Việt | Khung giờ chuẩn | Ý nghĩa nghiệp vụ |
|---|---|---|---|
| `MORNING` | Buổi sáng | **07:00 – 11:30** | Giao buổi sáng cho đại lý / cửa hàng |
| `AFTERNOON` | Buổi chiều | **13:30 – 17:30** | Giao ca chiều trước giờ đóng cửa |
| `EVENING` | Buổi tối | **18:00 – 21:00** | Giao ca tối cho nhà hàng, quán ăn, sự kiện |
| `null` / `undefined` | Cả ngày | Trong ngày | Đơn hàng linh hoạt hoặc chưa chọn khung giờ |

---

## III. TASK A — KẾT QUẢ ĐỒNG BỘ TOÀN DIỆN KHUNG GIỜ GIAO HÀNG (DELIVERY SLOTS)

### 1. Kiến trúc nguồn định nghĩa duy nhất (Single Source of Truth)
Toàn bộ logic được tập trung tại `src/lib/domain/delivery-date.ts` và re-export qua `src/lib/utils.ts`:
- `DELIVERY_TIME_SLOTS`: Danh sách hằng số các tùy chọn khung giờ.
- `DELIVERY_SLOT_MAP`: Map tra cứu O(1) theo mã enum `MORNING`, `AFTERNOON`, `EVENING`.
- `formatDeliveryTimeSlot(slot, style)`: Hàm thuần chuyển đổi format `full` (`Buổi sáng (07:00 - 11:30)`) và `short` (`Sáng (07:00 - 11:30)`).

### 2. Rà soát và chuẩn hóa 11 điểm chạm trong toàn bộ hệ thống
1. **Checkout Selection (`checkout-view.tsx`):**
   - Sử dụng `DELIVERY_TIME_SLOTS.map(...)`.
   - Hiển thị nhãn nút chuẩn: `Sáng (07:00 - 11:30)`, `Chiều (13:30 - 17:30)`, `Tối (18:00 - 21:00)`.
2. **Customer Order Detail (`customer-order-view.tsx`):**
   - Sử dụng `formatDeliveryTimeSlot(order.timeSlot)`.
   - Hiển thị `Buổi sáng (07:00 - 11:30)`. Khắc phục triệt để lỗi fallback `EVENING` thành `Cả ngày`.
3. **Admin Order Detail (`order-detail-client.tsx`):**
   - Sử dụng `formatDeliveryTimeSlot(order.timeSlot)`.
   - Bổ sung tùy chọn `EVENING` (`Buổi tối (18:00 - 21:00)`) trong select box gán khung giờ giao thu hoạch.
4. **Admin Order List (`order-list-client.tsx`):**
   - Sử dụng `formatDeliveryTimeSlot(order.timeSlot, 'short')`.
5. **Admin Shipping Management (`shipping-management-client.tsx`):**
   - Loại bỏ chuỗi hardcode cũ (`8-12h`, `13-17h`, `17-20h`), sử dụng `formatDeliveryTimeSlot(item.timeSlot, 'short')`.
6. **Admin Packing Slip Modal (`packing-slip-modal.tsx`):**
   - Loại bỏ switch hardcode cũ (`08:00 - 12:00`), sử dụng `formatDeliveryTimeSlot(slot, 'short')`.
7. **Customer Dashboard (`tai-khoan/page.tsx`):**
   - Chuẩn hóa từ điển `timeSlotLabels` thành `07:00 - 11:30`, `13:30 - 17:30`, `18:00 - 21:00`.
8. **Customer Recurring Orders (`recurring-client.tsx`):**
   - Chuẩn hóa `TIME_SLOT_LABELS` đồng bộ toàn bộ dropdown và danh sách đơn định kỳ.
9. **Admin Recurring Orders (`admin-recurring-client.tsx`):**
   - Chuẩn hóa `TIME_SLOT_NAMES` khớp chuẩn 100%.
10. **Order Placed Email Template (`email/templates.ts`):**
    - Sử dụng `formatDeliveryTimeSlot(data.order.timeSlot)`.
11. **Order Shipping Email Template (`email/templates.ts`):**
    - Sử dụng `formatDeliveryTimeSlot(data.order.timeSlot)`.

> [!NOTE]
> **Xác nhận Acceptance Criteria:** `DELIVERY SLOT POLICY — FULLY HARMONIZED`. Không còn bất kỳ file nào trong hệ thống hiển thị `06:00–11:00`, `08:00–12:00`, `13:00–17:00`, `17:00–20:00` hoặc làm fallback slot `EVENING` thành `Cả ngày`.

---

## IV. TASK B — BẢO MẬT & KIỂM DUYỆT BỘ CÔNG CỤ XÁC MINH NEON

Hai công cụ đã được Security Hardening toàn diện:
- `nong-san-b2b/scripts/secure-beta-verify-order.ps1`
- `nong-san-b2b/scripts/secure-beta-verify-order.ts`

### 1. Chi tiết 4 Hạng mục Security Hardening (B1 – B4)
1. **B1. Connection String Safety Parse & Validation:**
   - Sử dụng strict URL parser (`System.Uri` trong PowerShell, `URL` trong TypeScript).
   - Kiểm tra scheme hợp lệ: `postgres:` hoặc `postgresql:`.
   - Hostname bắt buộc kết thúc bằng `.c-7.us-east-2.aws.neon.tech`.
   - Hostname bắt buộc khớp target đã phê duyệt: `ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech` (hoặc `-pooler`).
   - Chặn đứng Production endpoint: `ep-square-scene-b5ddgxil`.
   - Database name bắt buộc là `neondb`.
   - Port bắt buộc là `5432`.
   - SSL mode bắt buộc: Phải có tham số `sslmode=require`, `sslmode=verify-ca` hoặc `sslmode=verify-full`.
   - Chặn tham số query redirect nguy hiểm (`host=`, `options=`).
2. **B2. Credential Protection:**
   - Nhận connection string qua `Read-Host -AsSecureString` che giấu ký tự.
   - Không truyền credentials qua command-line arguments.
   - Không in credentials ra màn hình, file log, hoặc file báo cáo.
   - Lọc bỏ mật khẩu trong thông báo lỗi (`sanitized = msg.replace(/:[^/@]+@/, ':***@')`).
   - Bảo toàn biến môi trường: Lưu `$originalDbUrl = $env:DATABASE_URL` và `$originalDirectUrl = $env:DIRECT_URL`, hoàn trả nguyên trạng trong khối `finally`.
   - Nếu session PowerShell có sẵn `DATABASE_URL`, kiểm tra qua Safety Gate trước khi sử dụng.
3. **B3. Read-Only Enforcement:**
   - 100% câu lệnh chỉ đọc: `prisma.order.findUnique` và `prisma.batch.findMany` với mệnh đề `select` tường minh.
   - Tuyệt đối 0 thao tác `create`, `update`, `delete`, `upsert`, `$executeRaw`, DDL hoặc migration.
4. **B4. Strict Order Target Enforcement:**
   - Tham số Order Code bị khóa cứng vào mã `DH-261029-ASRT`.
   - Mọi mã đơn hàng khác bị từ chối ngay lập tức ở cả PowerShell và TypeScript.

---

## V. TASK C — NĂNG LỰC ĐỐI SOÁT FEFO & RESERVATION LỊCH SỬ

Script `scripts/secure-beta-verify-order.ts` đã được tích hợp logic đối soát chuyên sâu:
1. **Phân biệt thời hạn giữ hàng (Reservation Evaluation):**
   - So sánh `alloc.holdExpiresAt` với `new Date()`.
   - Phân biệt rõ:
     - `RELEASED BY TRANSACTION`: Khi `alloc.status === 'RELEASED'` hoặc `releasedGrams > 0` hoặc có `releasedAt`.
     - `EXPIRED BY TIME`: Khi `alloc.status === 'ACTIVE'` nhưng thời điểm hiện tại đã vượt quá `holdExpiresAt` (chứng minh thời hạn 10p đã qua nhưng chưa kích hoạt transaction hủy/giải phóng).
     - `ACTIVE`: Khi đang trong thời hạn giữ chỗ hợp lệ.
2. **Tính toán tồn kho đa chiều (Comprehensive Ledger Balance):**
   - Tổng hợp đầy đủ các loại Ledger trong domain:
     - Nhập kho: `IMPORT` (+)
     - Xuất kho: `DISPATCH_OUT` (-)
     - Hao hụt: `SHRINKAGE_LOSS` (-)
     - Giữ chỗ: `RESERVATION_HOLD` (+)
     - Giải phóng: `RESERVATION_RELEASE` (-)
     - Điều chỉnh kiểm kê: `QC_ADJUSTMENT`, `QC_ADJUSTMENT_ADD` (+), `QC_ADJUSTMENT_SUB` (-)
   - Áp dụng công thức chuẩn: `rawPhysicalStockGrams = import - dispatch - shrinkage + qcAdjustment`, `rawReservedGrams = hold - release - dispatch`, `rawAvailableGrams = rawPhysicalStockGrams - rawReservedGrams`.
3. **Đánh giá ưu tiên FEFO (Candidate Priority):**
   - Truy vấn toàn bộ các lô Sầu Riêng Ri6 xếp theo thứ tự `expiryDate: 'asc'`.
   - Đối chiếu lô được phân bổ trong `DH-261029-ASRT` có phải là lô có hạn sử dụng gần nhất còn khả dụng hay không.
   - Kết luận rõ ràng: `FEFO ALLOCATION — PASS` khi khối lượng đủ 50 kg và lô khớp thứ tự ưu tiên.

---

## VI. TASK D — NĂNG LỰC TRUY VẤN SNAPSHOT F04 (MEMBERSHIP QUERY READINESS)

Script `scripts/secure-beta-verify-order.ts` đã sẵn sàng đọc và đối chiếu 100% các trường Snapshot trên `Order`:

| Trường Prisma Schema | Giá trị kỳ vọng cho `DH-261029-ASRT` | Trạng thái sẵn sàng |
|---|---|---|
| `order.membershipTierSnapshot` | `BRONZE` | Sẵn sàng đọc trực tiếp |
| `order.groupDiscountPercent` | `5` (%) | Sẵn sàng đọc trực tiếp |
| `order.membershipDiscountPercent` | `2` (%) | Sẵn sàng đọc trực tiếp |
| `order.combinedDiscountPercent` | `7` (%) | Sẵn sàng đọc trực tiếp |
| `order.baseShippingFee` | `466000` (VND) | Sẵn sàng đọc trực tiếp |
| `order.shippingDiscountAmount` | `23300` (VND) | Sẵn sàng đọc trực tiếp |
| `order.shippingFee` | `442700` (VND) | Sẵn sàng đọc trực tiếp |
| `order.subtotal` | `3720000` (VND) | Sẵn sàng đọc trực tiếp |
| `order.total` | `4162700` (VND) | Sẵn sàng đọc trực tiếp |
| `order.depositAmount` | `1249000` (VND) | Sẵn sàng đọc trực tiếp |

> [!NOTE]
> **Trạng thái:** `F04 SNAPSHOT QUERY — READY / LIVE VERIFICATION PENDING`. DEV 1 tuyệt đối không tuyên bố database đã pass khi chưa chạy script trực tiếp trên Neon.

---

## VII. TASK E — KẾT QUẢ KIỂM THỬ XÁC MINH (OFFLINE QUALITY GATES)

### 1. PowerShell Script Security Gates Tests (10/10 PASS)
```powershell
powershell -ExecutionPolicy Bypass -File tests/unit/secure-beta-verify-order.test.ps1
```
- `[PASS] Reject Production Endpoint (ep-square-scene-b5ddgxil)`
- `[PASS] Reject Wrong Host`
- `[PASS] Reject Wrong Database Name`
- `[PASS] Reject Non-Postgres Scheme`
- `[PASS] Reject Wrong Port (e.g. 5433)`
- `[PASS] Reject Missing or Disabled SSL (sslmode=disable)`
- `[PASS] Reject Missing SSL parameter completely`
- `[PASS] Reject Non-Approved Order Code (DH-999999-XXXX)`
- `[PASS] Accept Valid Approved Target Host & Default Port`
- `[PASS] Accept Valid Approved Target Pooler Host`
- **Kết quả: 10/10 PASS. 0 credential leak.**

### 2. Targeted Delivery Slot Unit Tests (22/22 PASS)
```bash
npm test tests/unit/qa05-delivery-slot.test.ts tests/unit/delivery-date.test.ts tests/unit/cc01-product-preview-pipeline.test.ts
```
- `cc01-product-preview-pipeline.test.ts`: **6/6 PASS**
- `delivery-date.test.ts`: **9/9 PASS**
- `qa05-delivery-slot.test.ts`: **7/7 PASS**
- **Tổng cộng: 22/22 PASS (Duration: 156 ms)**.

### 3. TypeScript Typecheck
```bash
npm run typecheck
# Exit code: 0 (0 errors)
```

### 4. Production Build Verification
```bash
npm run build
# ✓ Compiled successfully in 1493ms
# ✓ Generating static pages (15/15) in 219ms
# Exit code: 0 (0 errors)
```

---

## VIII. TASK F — GIT PREFLIGHT & CHANGED FILES

- **Clean Working Tree:** Verified.
- **Fetch `origin/beta`:** Verified (`7ede4cfcdacb8ba6c72dea6c7568063fe244e990`).
- **Git Lineage:** Linear ancestry verified.
- **Prisma Schema Diff:** **0 changes**.
- **Migration Artifacts:** **0 new migrations**.
- **Merge Mode:** Fast-Forward (`7ede4cf` -> `e8ebc13`).
- **Danh sách file thay đổi:**
  ```text
  docs/EV_BETA_DEMO_ORDER_01_REPORT.md
  docs/EV_BETA_DEMO_ORDER_02_REPORT.md
  nong-san-b2b/scripts/secure-beta-verify-order.ps1
  nong-san-b2b/scripts/secure-beta-verify-order.ts
  nong-san-b2b/src/app/admin/dinh-ky/admin-recurring-client.tsx
  nong-san-b2b/src/app/admin/don-hang/[code]/order-detail-client.tsx
  nong-san-b2b/src/app/admin/don-hang/order-list-client.tsx
  nong-san-b2b/src/app/admin/van-chuyen/shipping-management-client.tsx
  nong-san-b2b/src/app/tai-khoan/dinh-ky/recurring-client.tsx
  nong-san-b2b/src/app/tai-khoan/don-hang/[code]/customer-order-view.tsx
  nong-san-b2b/src/app/tai-khoan/page.tsx
  nong-san-b2b/src/app/thanh-toan/checkout-view.tsx
  nong-san-b2b/src/components/admin/packing-slip-modal.tsx
  nong-san-b2b/src/lib/domain/delivery-date.ts
  nong-san-b2b/src/lib/email/templates.ts
  nong-san-b2b/src/lib/utils.ts
  nong-san-b2b/tests/unit/qa05-delivery-slot.test.ts
  nong-san-b2b/tests/unit/secure-beta-verify-order.test.ps1
  ```

---

## IX. TASK G — KẾT QUẢ TRIỂN KHAI VERCEL BETA

- **Branch:** `beta`
- **Release SHA:** `e8ebc1328ebbc19f9fe6cbfa97ef87ca8681335b`
- **Vercel Deployment ID:** `dpl_AZBoM1JeyzzXiLKwG2wNw4XCDFYB`
- **Deployment Status:** `● Ready`
- **Build Duration:** 39s
- **Canonical Alias:** https://nong-san-b2b-git-beta-baopk.vercel.app
- **Direct Preview URL:** https://nong-san-b2b-1xlbwuduz-baopk.vercel.app

---

## X. TASK H — THÔNG TIN BÀN GIAO BROWSER QA (CHATGPT WORK)

Bàn giao ChatGPT Work kiểm tra Focused Browser Smoke (Single Pass):
1. **Trang Checkout (`/thanh-toan`):**
   - Kiểm tra các nút khung giờ giao hiển thị đúng nhãn: `Sáng (07:00 - 11:30)`, `Chiều (13:30 - 17:30)`, `Tối (18:00 - 21:00)`.
2. **Trang Chi tiết đơn hàng của khách (`/tai-khoan/don-hang/DH-261029-ASRT`):**
   - Khung giờ giao hiển thị nhất quán: `Buổi sáng (07:00 - 11:30)`.
3. **Trang Quản trị đơn hàng (`/admin/don-hang/DH-261029-ASRT`):**
   - Khung giờ giao hiển thị: `Buổi sáng (07:00 - 11:30)`.
   - Select box gán ngày thu hoạch có đủ 3 khung giờ (`Buổi sáng`, `Buổi chiều`, `Buổi tối`).
4. **Trang Danh sách đơn hàng Admin (`/admin/don-hang`):**
   - Cột Khung giờ hiển thị: `Sáng (07:00 - 11:30)`.
5. **Đơn hàng demo `DH-261029-ASRT`:**
   - Các thông số tài chính (3.720.000 đ tiền hàng, 466.000 đ cước gốc, giảm cước 23.300 đ, tổng 4.162.700 đ, cọc 1.249.000 đ) giữ nguyên vẹn.

---

## XI. GIỚI HẠN BẮT BUỘC (DATABASE SAFETY)

- DEV 1 tuân thủ nghiêm ngặt: **CHƯA chạy `secure-beta-verify-order.ps1` hoặc script TypeScript trên Neon Live**.
- Không truy cập credentials Production.
- Không sửa dữ liệu Neon.
- Không tạo đơn hàng mới.
- Công cụ đã sẵn sàng 100% để PO hoặc Main Coordinator kích hoạt an toàn trong 30 giây khi có quyết định.

---

## XII. PHÁN QUYẾT CUỐI CÙNG (FINAL VERDICT)

```
================================================================================
DELIVERY SLOT HOTFIX     : DEPLOYED / BROWSER QA PENDING
DB VERIFICATION TOOL     : SECURITY HARDENED / LIVE EXECUTION PENDING
EV BETA DEMO ORDER       : DB EVIDENCE PENDING
RELEASE SHA              : e8ebc1328ebbc19f9fe6cbfa97ef87ca8681335b
DEPLOYMENT ID            : dpl_AZBoM1JeyzzXiLKwG2wNw4XCDFYB
CANONICAL BETA URL       : https://nong-san-b2b-git-beta-baopk.vercel.app
================================================================================
```
