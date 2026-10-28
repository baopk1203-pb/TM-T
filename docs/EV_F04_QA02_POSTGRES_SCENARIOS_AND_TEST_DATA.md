# EV-F04-QA02 — POSTGRESQL SCENARIOS & TEST DATA REQUIREMENTS

**Feature:** F04 — Membership & Quarterly KPI  
**QA Target HEAD:** `486bcc16c91aada2bbf6d82c0ea420fc269e4779`  
**Trạng thái:** `QA-F04-02 PREPARATION APPROVED / EXECUTION NOT AUTHORIZED`  
**Loại tài liệu:** `DRAFT / FILE CREATED IN CHAT SANDBOX — NOT COMMITTED TO PROJECT GIT`

> Áp dụng khi Main Coordinator cấp slot và Release Integrator cung cấp PostgreSQL thử nghiệm cô lập. QA không tự chạy migration. Không ghi dữ liệu Neon Beta/Production. Giới hạn các thao tác ghi vào test DB được cho phép.

## 1. Ma trận kiểm thử targeted

| ID | Cấp độ | Test data tối thiểu | Thao tác & kết quả kỳ vọng | Bằng chứng | Gate |
|---|---|---|---|---|---|
| **F04-PG-01** | Runtime/schema | DB thử nghiệm riêng có migration F04; Prisma Client đúng SHA | Prisma query `User`, `Order`, `MembershipEvaluationLog` hoạt động; unique `(userId,evaluationQuarter)` tồn tại; không thiếu cột/bảng | schema inspect + query/log đã ẩn secrets | GAP-DB-01 |
| **F04-PG-02** | Legacy Bronze | CUSTOMER `membershipTier=null`; ADMIN tier null; CUSTOMER GOLD | Khách null nhận BRONZE hiệu lực nhưng DB vẫn null sau thao tác đọc/tính giá; ADMIN không hưởng; GOLD không bị hạ | Trước/sau DB và output server | GAP-DB-01 |
| **F04-PG-03** | Pricing/Checkout | CUSTOMER null, CustomerGroup 3%, hàng thường/hàng mẫu | Hàng thường giảm 2% Membership (cộng nhóm=5%), cap tổng 10%; hàng mẫu không giảm; OrderEvent có snapshot phù hợp | Order totals, snapshot JSON; không lộ PII | GAP-DB-01 |
| **F04-PG-04** | Shipping threshold/cap | 49,99 kg, 50 kg; BRONZE, cước gốc 200.000; cước 3.000.000 | 49,99 kg giảm 0; 50 kg giảm 10.000; cước 3m giảm tối đa 100.000; tổng không âm | Calculator + Checkout result | GAP-DB-01 |
| **F04-PG-05** | Transaction rollback | Checkout với điều kiện lỗi có chủ ý trong test DB (vd. validation hoặc không đủ hàng) | Không tạo Order/OrderEvent mồ côi; số lượng tồn và reservation không bị trừ dở dang | DB state before/after + error response | GAP-CONCUR-01 |
| **F04-PG-06** | FEFO race | Hai request checkout cùng tranh số lượng tồn batch giới hạn, cùng product | Tổng lượng giữ chỗ không vượt lượng có sẵn; không oversell; kết quả phù hợp với cơ chế khóa; không deadlock kéo dài | Log 2 giao dịch + tồn thực sau test | GAP-CONCUR-01 |
| **F04-PG-07** | Quarterly idempotency | 1 CUSTOMER có đơn đủ điều kiện Q1, chưa có log Q1 | Hai lần xét cùng `evaluationQuarter` (có thể đồng thời) tạo **tối đa một** log, tier và score không bị áp dụng trùng | Số log, tier, lỗi cạnh tranh, retries | GAP-CONCUR-01 |
| **F04-PG-08** | Quarterly stale run | Tài khoản có log quý mới hơn, sau đó thử xử lý quý cũ | Không ghi đè `User.membershipTier` của quý mới hơn; theo contract có thể ghi log lịch sử hợp lệ | User tier before/after, logs | GAP-CONCUR-01 |
| **F04-PG-09** | Carryover 15 ngày | Đăng ký 16/03 (ngoài), 17/03 (trong), 20/03; giao dịch Q1/Q2 | Đúng nhánh skip; Q1 sử dụng ×1.2 với đăng ký tháng cuối; Q2 ×1.0; 1 điểm kỷ luật gốc; không trùng active weeks | KPI inputs, evaluation results, logs | GAP-DB-01 |
| **F04-PG-10** | Settlement refund contract | Dữ liệu đơn đã hoàn tất; `finalTotal`, `refundCompensation`, complaint status | Không double-subtract; không ghi nhận đơn có khiếu nại chưa hợp lệ; xác minh riêng phần F02 khi có phiên bản kết hợp hợp lệ | Query/contract diff; F02 combined khi sẵn sàng | GAP-F02-01 |

**Lưu ý:** Bài test tương tranh không cần stress hàng nghìn request. Một vài lượt test có điều kiện được điều khiển là đủ cho mục tiêu demo học thuật; phải ghi rõ phạm vi kiểm thử và không tuyên bố chứng minh tuyệt đối không có race condition.

## 2. Dữ liệu tối thiểu (không chứa dữ liệu thật)

| Nhóm | Fixtures đề xuất | Mục đích |
|---|---|---|
| Người dùng | `legacy_null_customer`, `bronze_customer`, `silver_customer`, `gold_customer`, `diamond_customer`, `admin_null`, `staff_null` | Tier & authorization; không backfill |
| CustomerGroup | Group 3%; Group 8% | Cộng dồn 5%, cap 10% |
| Products | Hàng thường; hàng mẫu; đơn vị khối lượng/bao bì chính xác | Pricing, exemption, weight calculation |
| Shipping | Quote gốc 200.000 VND và 3.000.000 VND | Test ngưỡng 50 kg và cap 100k |
| Inventory | 1–2 batch FEFO, số dư đủ cho 1 checkout nhưng không đủ cho 2 checkout | Concurrency/rollback |
| Quarterly data | Orders `COMPLETED`, dữ liệu Revenue/Volume/Active Weeks, cancel/expiry; boundary dates | Model B, carryover, idempotency |
| Evaluation logs | Q1 có/không có log; có log quý mới hơn | Unique key/stale-run guards |
| F02 contract | Một khoản refund bồi thường hợp lệ và một khiếu nại còn mở | Net revenue; phụ thuộc phiên bản hợp nhất |

## 3. Quy trình thao tác an toàn

1. RI xác nhận source SHA, database độc lập, quyền hạn và kế hoạch cleanup.
2. RI khởi tạo schema và fixtures trong database test; kiểm tra không trỏ về Neon Beta/Production.
3. QA chỉ chạy khi Main Coordinator cấp `QA-F04-02 EXECUTION AUTHORIZED`.
4. QA lưu outputs, SHA, số test, và trạng thái `PASS/FAIL/NOT RUN/UNVERIFIED` cho từng test ID.
5. QA không sửa code/config để vượt lỗi; nếu migration mismatch, dừng scenario và báo RI.
6. RI dọn fixture/test DB nếu đó là phần được phê duyệt; không động vào database khác.

## 4. Định nghĩa PASS / chưa PASS

- `SOURCE REVIEW PASS`: chỉ đọc code, **không** tự suy ra `RUNTIME PASS`.
- `UNIT PASS`: command thực thi độc lập và assertions chạy thành công.
- `POSTGRESQL PASS`: test thực thi kết nối database cô lập, evidence rõ.
- `CONCURRENCY PASS`: kịch bản tranh chấp thực chạy thành công với bằng chứng trạng thái DB; nêu rõ giới hạn tải/thời gian.
- `UNVERIFIED`: chưa có môi trường hoặc chưa có phiên bản F02/F04 kết hợp; không coi là bug nếu chưa có bằng chứng.

**END — EV-F04-QA02 TEST SCENARIOS**
