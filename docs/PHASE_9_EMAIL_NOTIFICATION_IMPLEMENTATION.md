# BÁO CÁO KỸ THUẬT: HỆ THỐNG THÔNG BÁO EMAIL ĐƠN HÀNG B2B (PHASE 9 & HOTFIX DEV-TASK-45)
**Mã nhiệm vụ:** `DEV-TASK-44` & `DEV-TASK-45`
**Nhánh Git:** `beta`
**Baseline Git Commit:** `fea0509`
**Môi trường thực hiện:** Local Development (Zero DB Migration, Zero Cloud Modification)
**Ngày thực hiện:** 20/10/2026

---

## 1. TỔNG QUAN & HAI LỖI P1 ĐÃ SỬA (DEV-TASK-45)

Tiếp nhận kết luận `CONDITIONAL PASS` từ `QA-TASK-44`, bản hotfix `DEV-TASK-45` đã xử lý triệt để 2 điểm P1 mà không mở rộng kiến trúc sang queue/Redis/Zalo:

### 1.1. FIX P1 #1 — Quản lý vòng đời Promise trên Vercel Serverless
- **Nguyên nhân:** Trước đây các Server Actions gọi `void sendOrderNotification(...).catch(...)` khiến Promise bị thả nổi (floating promise). Trên môi trường Vercel Serverless, runtime có thể đóng băng hoặc kết thúc ngay khi Server Action trả response, làm gián đoạn kết nối SMTP hoặc việc ghi `OrderEvent`.
- **Giải pháp:**
  1. Thay toàn bộ 10 điểm gọi `void sendOrderNotification(...)` tại 5 file Server Actions (`order.ts`, `preorder.ts`, `recurring.ts`, `admin-order.ts`, `order-lifecycle.ts`) bằng `await sendOrderNotification(...)` đặt trong khối `try / catch`, thực thi **chỉ sau khi `db.$transaction` đã commit thành công**.
  2. Bổ sung cơ chế **Timeout cứng (mặc định `5000ms`, cấu hình được qua `SMTP_TIMEOUT_MS`)** tại `NodemailerAdapter` thông qua cả cấu hình `connectionTimeout`/`greetingTimeout`/`socketTimeout` của Nodemailer lẫn `Promise.race` đóng kết nối chủ động khi quá hạn.
  3. Bảo đảm Server Action không bao giờ bị treo vô hạn và mọi lỗi SMTP đều không làm thay đổi hay rollback kết quả nghiệp vụ đã commit.

### 1.2. FIX P1 #2 — Chặn False-Success (`EMAIL_SENT` giả) khi thiếu cấu hình SMTP
- **Nguyên nhân:** `getEmailAdapter()` trước đây chỉ kiểm tra `SMTP_HOST && SMTP_USER` và tự động fallback về `MockEmailAdapter` khi thiếu cấu hình, dẫn tới nguy cơ ghi `EMAIL_SENT_*` giả trên Vercel Preview/Production.
- **Giải pháp:**
  1. **Trên Vercel (`VERCEL === '1'` hoặc có `VERCEL_ENV`):** Tuyệt đối **KHÔNG** bao giờ sử dụng `MockEmailAdapter` (kể cả khi đặt `EMAIL_PROVIDER=mock`).
  2. **Ngoài Vercel:** Chỉ sử dụng `MockEmailAdapter` khi chạy kiểm thử (`NODE_ENV === 'test'`) hoặc khi bật chủ động tại Local (`EMAIL_PROVIDER === 'mock'`).
  3. **Kiểm tra đầy đủ biến SMTP (`validateSmtpConfig()`):** Bắt buộc đủ 4 biến `SMTP_HOST`, `SMTP_PORT` (số nguyên `1..65535`), `SMTP_USER`, `SMTP_PASS`. Hỗ trợ đồng thời `SMTP_FROM` và alias `MAIL_FROM` cho địa chỉ người gửi.
  4. **Khi thiếu cấu hình SMTP:** Trả về `UnconfiguredEmailAdapter`, **tuyệt đối không ghi `EMAIL_SENT_*`**, mà ghi `OrderEvent` loại `EMAIL_SKIPPED_${type}` với `reason: 'MISSING_SMTP_CONFIG'` để Admin theo dõi trên `/admin/thong-bao`.
  5. **Không chặn lần gửi hợp lệ về sau:** Cơ chế kiểm tra trùng lặp chỉ tìm bản ghi `EMAIL_SENT_*`. Các bản ghi `EMAIL_SKIPPED_*` hoặc `EMAIL_FAILED_*` không chặn việc gửi lại khi SMTP đã được cấu hình.
  6. **Bảo mật thông tin xác thực (`sanitizeSmtpError()`):** Tự động ẩn (`[REDACTED]`) mọi giá trị `SMTP_PASS`, `SMTP_USER` hoặc chuỗi `user:pass@host` khỏi log và `OrderEvent` khi SMTP báo lỗi.
  7. **Phân định rõ phạm vi xác nhận:** Trạng thái thành công (`SMTP_ACCEPTED`) phản ánh máy chủ SMTP đã chấp nhận gửi email (`250 OK`), không đồng nghĩa với việc email đã vào inbox hoặc khách hàng đã đọc.

---

## 2. GIỚI HẠN BEST-EFFORT & SEQUENTIAL DEDUPLICATION

Theo yêu cầu của Product Owner cho phạm vi MVP/Demo hiện tại:
1. **Sequential Deduplication:** Hệ thống sử dụng truy vấn `db.orderEvent.findFirst({ where: { orderId, type: idempotencyKey } })` trước khi gửi và ghi `EMAIL_SENT_*` sau khi gửi. Cơ chế này ngăn chặn hiệu quả các lời gọi tuần tự lặp lại, nhưng **không tuyên bố chống trùng tuyệt đối (exactly-once)** trước kịch bản race condition đồng thời (2 request song song cùng đi qua `findFirst` trước khi một bên kịp ghi `EMAIL_SENT_*`).
2. **Best-effort Post-commit Delivery:** Không sử dụng hàng đợi phân tán (Redis/BullMQ) hay bảng outbox riêng. Nếu kết nối SMTP đứt gãy đúng lúc đặt đơn, sự kiện được ghi nhận minh bạch là `EMAIL_FAILED_*` tại `/admin/thong-bao` mà không tự động retry ngầm (tránh rủi ro gửi trùng email hàng loạt).

---

## 3. DANH SÁCH BIẾN MÔI TRƯỜNG (ENV) CẦN CẤU HÌNH TRÊN VERCEL BETA

Để kích hoạt gửi email thật trên Vercel Preview (`beta`), cần cấu hình các biến môi trường sau trong Vercel Project Settings -> Environment Variables (Preview):

| Tên biến ENV | Bắt buộc | Mô tả / Giá trị mẫu |
|---|---|---|
| `SMTP_HOST` | **Bắt buộc** | Máy chủ SMTP (VD: `smtp.gmail.com`, `smtp.resend.com`, `smtp-relay.brevo.com`) |
| `SMTP_PORT` | **Bắt buộc** | Cổng SMTP hợp lệ `1..65535` (VD: `587` cho STARTTLS hoặc `465` cho SSL/TLS) |
| `SMTP_USER` | **Bắt buộc** | Tài khoản đăng nhập SMTP (VD: địa chỉ email hoặc `resend` / API user) |
| `SMTP_PASS` | **Bắt buộc** | Mật khẩu ứng dụng (App Password) hoặc API Key của SMTP |
| `SMTP_FROM` *(hoặc `MAIL_FROM`)* | Khuyến nghị | Địa chỉ hiển thị người gửi (VD: `Nông Sản B2B <no-reply@ten-mien-da-xac-thuc.vn>`). Hệ thống hỗ trợ cả `SMTP_FROM` và `MAIL_FROM`. |
| `SMTP_SECURE` | Tùy chọn | `'true'` nếu dùng SSL/TLS trực tiếp (mặc định tự bật khi `SMTP_PORT=465`) |
| `SMTP_TIMEOUT_MS` | Tùy chọn | Thời gian chờ tối đa mỗi lần gửi SMTP tính bằng ms (mặc định: `5000`) |

*(Lưu ý: Tại Local Development khi không muốn gửi email thật, có thể đặt `EMAIL_PROVIDER=mock` trong `.env.local`. Biến này bị vô hiệu hóa hoàn toàn trên Vercel).*

---

## 4. KẾT QUẢ KIỂM THỬ & 5 CỔNG CHẤT LƯỢNG

1. `npm run lint`: **PASS** (0 errors).
2. `npm run typecheck`: **PASS** (0 errors).
3. `npm test`: **PASS** (**34/34 test files, 485/485 unit tests PASSED**).
   - Bổ sung kiểm thử đầy đủ tại `tests/unit/email-notifications.test.ts` (25 tests) và `tests/unit/admin-payment.test.ts` (8 tests).
4. `npm run build`: **PASS** (Next.js 16.4.0 Turbopack build thành công).
5. `git diff --check`: **PASS** (0 formatting/whitespace errors).

**Kết luận:** `READY FOR SMTP CONFIGURATION`
