# EV-F04-QA02 — BROWSER CHECKLIST (DEFERRED) & VERIFICATION GAP TRACKER

**QA Target HEAD:** `486bcc16c91aada2bbf6d82c0ea420fc269e4779`  
**Trạng thái:** Chuẩn bị; Browser E2E **không thuộc quyền tự triển khai Beta**.  
**Loại tài liệu:** `DRAFT / FILE CREATED IN CHAT SANDBOX — NOT COMMITTED TO PROJECT GIT`

## 1. Bảng theo dõi các khoảng trống QA-F04-01

| ID | Mức độ | Trạng thái ban đầu | Bằng chứng đóng gap | Owner / Điều kiện |
|---|---|---|---|---|
| **GAP-DB-01** | P1 Gate | `UNVERIFIED` | Schema F04, migration compatibility và runtime query PASS trên PostgreSQL test độc lập, đúng SHA | Release Integrator chuẩn bị DB; QA xác minh sau cấp slot |
| **GAP-CONCUR-01** | P1 Gate | `UNVERIFIED` | Checkout FEFO race+rollback và Quarterly Evaluation idempotency chạy có bằng chứng DB | RI chuẩn bị fixtures; QA chạy có quyền test DB |
| **GAP-BUILD-01** | Evidence Gate | `NOT RUN` | QA tự chạy production build thành công, ghi command, environment, output và SHA | QA + RI chuẩn bị build env |
| **GAP-TEST-01** | Evidence Gate | `DEV REPORTED PASS; QA NOT EXECUTED` | QA tự thực thi targeted F04 tests, ghi số pass/fail; typecheck/lint; regression toàn bộ nếu phù hợp | QA-F04-02 sau slot |
| **GAP-F02-01** | P2 | `UNVERIFIED` | Financial contract review độc lập; integration test F02/F04 chỉ khi có bản kết hợp được cho phép | Main Coordinator + RI + QA |
| **GAP-UI-01** | P2 | `BROWSER E2E NOT RUN` | Browser check trên môi trường hợp lệ đang chạy đúng commit, không tạo dữ liệu thật | Main Coordinator cấp phép Browser QA riêng sau triển khai phù hợp |

Trạng thái có thể dùng: `NOT RUN`, `UNVERIFIED`, `BLOCKED`, `IN PROGRESS`, `PASS`, `FAIL`. Chỉ thay đổi khi có evidence. Không đổi nguyên verdict QA-F04-01; ghi kết quả ở vòng QA-F04-02 riêng.

## 2. Browser E2E Acceptance Checklist — CHƯA KÍCH HOẠT

> Thực hiện sau khi Main Coordinator cho phép browser QA trên môi trường đã deploy đúng phiên bản F04. Không merge/push/deploy Beta để làm checklist. Chỉ dùng tài khoản test được cấp phép; không tạo giao dịch tài chính thật hoặc thay đổi dữ liệu Beta/Production.

| ID | Kiểm tra trình duyệt | Kỳ vọng | Trạng thái |
|---|---|---|---|
| **F04-UI-01** | Chưa đăng nhập mở `/tai-khoan/thanh-vien` | Chuyển `/dang-nhap` hoặc chặn truy cập an toàn | NOT RUN |
| **F04-UI-02** | CUSTOMER Bronze đăng nhập Dashboard | Badge **Đồng**, bảng 4 hạng/quyền lợi đúng tiếng Việt | NOT RUN |
| **F04-UI-03** | CUSTOMER legacy tier null | Hiển thị Đồng, không tự nâng hạng hoặc tạo KPI giả | NOT RUN |
| **F04-UI-04** | CUSTOMER tier Silver/Gold/Diamond | Hiển thị đúng hạng đã lưu; không bị reset về Đồng | NOT RUN |
| **F04-UI-05** | Mở Dashboard chưa có evaluation log | Empty state rõ ràng, không hiển thị điểm giả hoặc lỗi 500 | NOT RUN |
| **F04-UI-06** | CUSTOMER thuộc nhóm bảo lưu | Thông báo ngày đánh giá kế tiếp và giải thích bảo lưu đúng | NOT RUN |
| **F04-UI-07** | Cart/Checkout đã có dữ liệu test hợp lệ | Phân biệt chiết khấu hàng thường/hàng mẫu, tổng chiết khấu không vượt 10% | NOT RUN |
| **F04-UI-08** | Giỏ hàng test dưới 50kg / từ 50kg | Shipping Membership chỉ áp dụng từ 50kg, cap 100k | NOT RUN |
| **F04-UI-09** | Điều hướng trực tiếp/tamper query params | Không đọc lịch sử Membership của người khác | NOT RUN |
| **F04-UI-10** | Responsive desktop/mobile | Không vỡ layout; nhãn quyền lợi rõ ràng | NOT RUN |

## 3. Báo cáo Browser QA khi được cấp phép

Ghi rõ: URL/môi trường, exact deployed commit, tài khoản test loại nào (không lộ PII/credentials), từng test PASS/FAIL/NOT RUN, screenshot không chứa dữ liệu nhạy cảm, bug severity, kết luận độc lập và blockers.

Browser E2E chưa chạy **không có nghĩa là đã phát hiện lỗi**. Nếu cần deploy Beta để chạy, Main Coordinator/Release Integrator phải phê duyệt riêng theo quy trình release; QA không tự deploy.

**END — EV-F04-QA02 BROWSER & GAPS**
