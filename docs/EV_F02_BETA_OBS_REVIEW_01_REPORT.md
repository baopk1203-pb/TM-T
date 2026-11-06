# BÁO CÁO ĐIỀU TRA & KHẮC PHỤC QUAN SÁT BETA F02
## EV-F02-BETA-OBS-REVIEW-01: FOCUSED POST-DEPLOY OBSERVATION REVIEW

- **Dự án:** E Vibe — Nông Sản B2B
- **Feature:** F02 — Two-Way Complaints & 48-Hour SLA (phối hợp F04 Membership & Quarterly KPI)
- **Agent:** DEV 1 — Release Integrator / Senior Full-Stack Engineer
- **Ủy quyền:** ChatGPT 1 — Main Coordinator
- **Chế độ thực thi:** `READ-ONLY INVESTIGATION & ISOLATED UI HOTFIX`
- **Nhánh thực thi cách ly:** `fix/f02-beta-obs-review-01`
- **Base Commit:** `febd9066728695782e26f2d1175ccf3375d6b993` (`origin/beta`)
- **Hotfix Commit SHA:** `61aeab82c726282915a0e0fce3de7b7ffc170ed6`
- **Trạng thái:** `COMPLETED — PENDING COORDINATOR RELEASE APPROVAL`

---

## I. TỔNG QUAN & PHÁN QUYẾT CHUNG

Sau đợt triển khai thành công song song F02 và F04 lên Beta (`345e2740adad9d6dc12b3d116593f0ef60ebbe58` / `febd906`), kiểm thử nghiệm thu trình duyệt độc lập (`QA-WORK-BETA-F02-F04-01`) đã ghi nhận 2 quan sát giao diện liên quan đến đơn hàng khiếu nại đã giải quyết `DH-261020-WBMP`.

| Mã quan sát | Hiện tượng | Phân loại | Đánh giá an toàn Backend | Nguy cơ tài chính | Giải pháp xử lý |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **OBS-F02-01** | Admin `/admin/khieu-nai` click "Xem chi tiết" khiếu nại `RESOLVED` vẫn hiện modal chứa form nhập liệu và nút "Gửi đề xuất giải quyết". | **UI UX Bug** (Thiếu view Read-Only cho trạng thái kết thúc) | **AN TOÀN TUYỆT ĐỐI (AIR-TIGHT)** | **0% (Không thể tạo hoàn tiền trùng hoặc ghi đè dữ liệu)** | Chuyển modal thành **Read-Only Detail View** cho các trạng thái không còn khả năng tác vụ (`RESOLVED`, `CUSTOMER_ACCEPTED`, `WITHDRAWN`, `PROPOSED`). |
| **OBS-F02-02** | Khách `/tai-khoan/don-hang/[code]` thấy header đơn hàng báo "Chờ hoàn tiền" nhưng box khiếu nại ghi "Đã bồi hoàn" & "Đã tất toán & giải quyết hoàn tất". | **UI Label Inconsistency** (Nhầm lẫn giữa "Đã duyệt phương án" và "Đã chuyển khoản thực tế") | **ĐÚNG THIẾT KẾ NGHIỆP VỤ TÀI CHÍNH** (`REFUND_PENDING`) | **0% (Dòng tiền chưa giải ngân, kế toán cần duyệt chi)** | Chuẩn hóa badge thành **"Đã giải quyết"** và hiển thị thông báo chi tiết: **"Đã duyệt phương án bồi hoàn (Lệnh hoàn tiền đang được kế toán xử lý chuyển khoản)"** khi đơn đang ở `REFUND_PENDING`. |

---

## II. ĐIỀU TRA KỸ THUẬT CHI TIẾT

### 1. OBS-F02-01: Form Đề Xuất Bị Mở Trên Khiếu Nại Đã Giải Quyết (`DH-261020-WBMP`)

#### A. Kiểm tra Backend State Guard & Logic Bảo vệ
1. **Action Guard (`src/actions/order-lifecycle.ts` - `proposeComplaintResolution`)**:
   ```typescript
   // Dòng 953 - 961 trong order-lifecycle.ts:
   if (complaint.status !== ComplaintStatus.OPEN && complaint.status !== ComplaintStatus.UNDER_REVIEW) {
     return {
       success: false,
       error: 'Chỉ có thể đưa ra đề xuất cho khiếu nại đang Mở (OPEN) hoặc đang Phúc tra (UNDER_REVIEW)'
     }
   }
   ```
   Nếu Admin cố tình bấm nút "Gửi đề xuất" trên giao diện hoặc gửi request trực tiếp bằng API client, Server Action **ngay lập tức từ chối và trả về lỗi**, không có bất kỳ mutation nào được thực hiện trên cơ sở dữ liệu.

2. **Domain Pure State Machine (`src/lib/domain/complaint-state.ts`)**:
   Hàm `canTransitionComplaint(currentStatus, targetStatus)` tuân thủ nghiêm ngặt máy trạng thái hữu hạn. Khi khiếu nại ở trạng thái cuối (`RESOLVED`, `WITHDRAWN`, `REJECTED`), mọi nỗ lực chuyển về `PROPOSED` đều bị cấm (`return false`).

3. **Nguy cơ Double Refund (Hoàn tiền trùng lặp)**:
   - **Hoàn toàn bằng 0**: Hàm `proposeComplaintResolution` **KHÔNG** tạo bản ghi `PaymentTransaction`.
   - Giao dịch hoàn tiền chỉ được sinh ra duy nhất một lần khi khách hàng bấm Chấp nhận đề xuất (`acceptComplaintProposal`), và tại đó hệ thống đã kiểm tra tính toàn vẹn tài chính độc lập.
   - Khi khiếu nại đã `RESOLVED`, không có luồng nào cho phép tạo thêm `PaymentTransaction` hoàn tiền.

#### B. Nguyên nhân gốc rễ (Root Cause)
File `nong-san-b2b/src/app/admin/khieu-nai/complaint-list-client.tsx` trước đây chỉ có một modal duy nhất dùng chung. Khi người dùng bấm nút "Xem chi tiết" (dòng 509):
```typescript
<Button variant="ghost" size="sm" onClick={() => setSelectedComplaint(c)}>
  <Eye className="w-3.5 h-3.5" />
  Xem chi tiết
</Button>
```
Hàm này gán `selectedComplaint = c`, kích hoạt render modal. Tuy nhiên modal lại không kiểm tra trạng thái `selectedComplaint.status` mà mặc định hiển thị form nhập kg bồi thường, số tiền bồi thường và nút submit "Gửi đề xuất giải quyết".

---

### 2. OBS-F02-02: Bất Nhất Trạng Thái "Chờ Hoàn Tiền" vs "Đã Bồi Hoàn"

#### A. Đối soát Logic Quyết toán và Luồng Kế toán B2B
1. **Bản chất nghiệp vụ**:
   - Trạng thái khiếu nại `RESOLVED` (hoặc `CUSTOMER_ACCEPTED`) đại diện cho việc **Hai bên đã đồng thuận phương án xử lý**.
   - Trạng thái thanh toán của đơn hàng (`order.paymentStatus`) đại diện cho **Tình trạng dòng tiền thực tế**.
2. **Logic mã nguồn (`src/lib/domain/settlement.ts` - `derivePaymentStatus`)**:
   ```typescript
   // Khi tồn tại giao dịch hoàn tiền có status = PENDING:
   const hasPendingRefund = transactions.some(
     (t) => t.type === 'REFUND' && t.status === 'PENDING'
   )
   if (hasPendingRefund) return 'REFUND_PENDING'
   ```
   Do đó, nhãn **"Chờ hoàn tiền"** ở đầu trang chi tiết đơn hàng là **hoàn toàn chính xác về mặt kế toán**. Tiền chưa rời khỏi tài khoản sàn cho đến khi Kế toán trưởng thực hiện lệnh chuyển khoản và gọi `confirmRefundDone(transactionId)`.

3. **Nguyên nhân gây hiểu nhầm**:
   File `nong-san-b2b/src/app/tai-khoan/don-hang/[code]/customer-order-view.tsx`:
   - Hàm `ComplaintStatusBadge` gán cứng: `case 'RESOLVED': return <Badge>Đã bồi hoàn</Badge>`.
   - Box khiếu nại hiển thị thông điệp: `<div className="font-bold">Đã tất toán & giải quyết hoàn tất</div>`.
   - Việc dùng từ "Đã bồi hoàn" và "Đã tất toán" khiến khách hàng tưởng rằng tiền đã được hoàn vào tài khoản ngân hàng của họ, trong khi thực tế tiền đang nằm ở trạng thái lệnh chi chờ kế toán duyệt (`REFUND_PENDING`).

---

## III. NỘI DUNG KHẮC PHỤC GIAO DIỆN (ISOLATED UI HOTFIX)

Đã áp dụng hotfix độc lập trên nhánh `fix/f02-beta-obs-review-01` tại commit `61aeab82c726282915a0e0fce3de7b7ffc170ed6`:

### 1. File `nong-san-b2b/src/app/admin/khieu-nai/complaint-list-client.tsx`
- Phân biệt rõ hai chế độ hiển thị trong modal:
  - **Actionable View (`OPEN`, `UNDER_REVIEW`)**: Giữ nguyên form nhập liệu đề xuất (loại bồi thường, kg xác minh, tiền bồi thường, ghi chú) kèm nút "Gửi đề xuất giải quyết" và cảnh báo SLA 48h.
  - **Read-Only Detail View (`RESOLVED`, `CUSTOMER_ACCEPTED`, `PROPOSED`, `WITHDRAWN`, `REJECTED`)**:
    - Hiển thị badge trạng thái chính thức.
    - Hiển thị tóm tắt toàn bộ hồ sơ bồi thường: Loại phương án, khối lượng xác minh (`kg`), số tiền đề xuất (`formatVND`), ghi chú gửi khách hàng và ghi chú nội bộ.
    - Hiển thị trạng thái giải ngân tài chính: Nếu đơn hàng đang `REFUND_PENDING`, hiển thị box tím giải thích rõ: *"Lệnh hoàn tiền đang ở trạng thái Chờ xử lý thanh toán (REFUND_PENDING). Cần kế toán viên hoàn tất thủ tục chuyển khoản bồi hoàn cho khách hàng."*
    - Nút tác vụ duy nhất: **"Đóng"** (không còn nút submit hay các ô input có thể chỉnh sửa).

### 2. File `nong-san-b2b/src/app/tai-khoan/don-hang/[code]/customer-order-view.tsx`
- **Chuẩn hóa nhãn Badge**: Đổi nhãn `RESOLVED` từ `"Đã bồi hoàn"` thành **`"Đã giải quyết"`** (chính xác về mặt pháp lý và thỏa thuận giữa sàn và khách).
- **Đồng bộ với trạng thái kế toán**:
  - Khi `order.paymentStatus === 'REFUND_PENDING'`:
    - Tiêu đề box hiển thị: **`"Đã duyệt phương án bồi hoàn"`** (thay vì "Đã tất toán & giải quyết hoàn tất").
    - Bổ sung chỉ dẫn minh bạch: *"Lệnh hoàn tiền đang được kế toán xử lý chuyển khoản (Chờ hoàn tiền)."*
  - Khi kế toán đã xác nhận chuyển khoản hoàn tất (`REFUNDED`):
    - Tiêu đề box giữ nguyên: **`"Đã tất toán & giải quyết hoàn tất"`**.

---

## IV. BẰNG CHỨNG KIỂM TRA & XÁC MINH HỆ THỐNG

### 1. Kiểm tra TypeScript Typecheck
- **Lệnh thực thi:** `npm run typecheck`
- **Kết quả:** `EXIT CODE 0` (0 errors).

### 2. Kiểm tra Unit & Financial Contract Tests
- **Lệnh thực thi:** `npx vitest run tests/unit/complaint-two-way.test.ts tests/unit/f02-f04-cross-financial-contract.test.ts`
- **Kết quả:** `2 passed (2)`, `41 tests passed (41)`.
  - Toàn bộ 31 tests về khiếu nại 2 chiều (SLA 48h, auto-withdraw, transition matrix, anti-race condition) đều **PASS**.
  - Toàn bộ 10 tests hợp đồng tài chính chéo F02-F04 đều **PASS**.

---

## V. HƯỚNG DẪN TẠO ĐƠN HÀNG MẪU B2B AN TOÀN (CONTROLLED DEMO ORDER RECOMMENDATION)

Để phục vụ kiểm thử end-to-end các tính năng F01, F02, F03, F04 một cách trực quan trên giao diện Beta mà không gây rủi ro tài chính hay xáo trộn kho hàng:

### 1. Quy tắc cấu hình đơn hàng demo
1. **Khối lượng tối thiểu (MOQ) & Đóng gói B2B**:
   - Chọn sản phẩm có cấu hình đóng gói sỉ rõ ràng (ví dụ: Thùng 10 kg, Thùng 20 kg hoặc Sọt 50 kg).
   - Đảm bảo khối lượng đặt mua $\ge \text{MOQ}$ của quy cách đóng gói (thông thường tối thiểu 20 kg – 50 kg).
2. **Cơ chế giữ hàng FEFO & Hạn chót thanh toán 10 phút**:
   - Khi khách hàng bấm "Đặt hàng", hệ thống tự động giữ hàng (hold inventory) theo lô có hạn sử dụng gần nhất (FEFO) và thiết lập `paymentDueAt = now + 10 phút`.
   - **Kịch bản kiểm thử**: Có thể quan sát đồng hồ đếm ngược 10 phút trên giao diện thanh toán. Nếu không thanh toán, cronjob/worker sẽ tự động hủy đơn và hoàn lại tồn kho khả dụng.
3. **Chụp Snapshot Hạng Thành Viên (F04)**:
   - Sử dụng tài khoản B2B có thứ hạng (ví dụ: Bạc hoặc Vàng) để kiểm tra: Hệ thống tự động áp dụng chiết khấu thành viên (`tierDiscountRate`) và chụp snapshot cố định vào `OrderItem` (`membershipTierAtPurchase`, `tierDiscountRateAtPurchase`, `tierDiscountAmount`).
4. **Phương thức thanh toán an toàn (Không tốn tiền thật)**:
   - Chọn phương thức: **Chuyển khoản Ngân hàng (VietQR / Mock)**.
   - Hệ thống hiển thị mã QR và thông tin chuyển khoản nhưng **không yêu cầu trừ tiền thẻ tín dụng/tài khoản thật**.
   - Admin có thể vào trang Quản trị Đơn hàng (`/admin/don-hang`) để bấm "Xác nhận đã nhận tiền" nhằm kích hoạt chuyển trạng thái đơn hàng sang `CONFIRMED` / `PROCESSING` / `DELIVERED` để tiếp tục test luồng khiếu nại F02.

---

## VI. KẾT LUẬN & KIẾN NGHỊ BÀN GIAO

- **Phán quyết cuối cùng:** `F02 OBSERVATIONS — UI HOTFIX PREPARED / RELEASE PENDING`.
- **Nhánh:** `fix/f02-beta-obs-review-01` (Worktree: `D:\TDTU\wt_f02_f04_integration`).
- **Commit:** `61aeab82c726282915a0e0fce3de7b7ffc170ed6`.
- **Độ an toàn:**
  - Database: Không thay đổi schema, không chạy migration mới, không sửa đổi dữ liệu trực tiếp trên Neon.
  - Backend: Không sửa đổi logic tính tiền hoặc chuyển trạng thái.
  - Git: Không tự ý merge hay push lên `beta` hoặc `main`.

DEV 1 bàn giao toàn bộ kết quả điều tra và commit hotfix trên nhánh cách ly. Kính đề nghị Main Coordinator xem xét phê duyệt để thực hiện merge vào `beta` và triển khai bản cập nhật UI lên Vercel Beta.
