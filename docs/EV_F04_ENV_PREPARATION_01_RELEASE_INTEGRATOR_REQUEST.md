# EV-F04-ENV-PREPARATION-01 — YÊU CẦU CHUẨN BỊ MÔI TRƯỜNG CÔ LẬP

**Dự án:** E Vibe — Nông Sản B2B  
**Feature:** F04 — Membership & Quarterly KPI  
**Người soạn:** ChatGPT 2 — F04 Coordinator  
**Đơn vị thực hiện:** Release Integrator, dưới sự điều phối của ChatGPT 1 — Main Coordinator  
**Trạng thái:** `ENVIRONMENT PREPARATION APPROVED`; `QA-F04-02 EXECUTION NOT YET AUTHORIZED`  
**Loại tài liệu:** `DRAFT / FILE CREATED IN CHAT SANDBOX — NOT COMMITTED TO PROJECT GIT`

## 1. Mục đích

Chuẩn bị **môi trường kiểm thử cô lập, tối giản** để QA-F04-02 tự thực thi bằng chứng còn thiếu: targeted tests, production build, Prisma/PostgreSQL runtime, Checkout FEFO concurrency, quarterly idempotency và Legacy Bronze runtime. Không thay đổi mã nguồn để làm test PASS; không merge F04 vào Beta.

**QA Target HEAD cố định:** `486bcc16c91aada2bbf6d82c0ea420fc269e4779`  
**F04 branch:** `f04_membership_bootstrap_readiness`  
**F04 DEV worktree (chỉ để đối chiếu, không tự sửa):** `C:\Users\epicg\.gemini\antigravity\worktrees\TMĐT Website\f04_membership_bootstrap_readiness`.

## 2. Công việc được phép chuẩn bị

1. Kiểm tra kết quả `EV-F02-ENV-VERIFICATION-01` để biết có thể **tái sử dụng công cụ/dịch vụ PostgreSQL** không; tuyệt đối không dùng chung database hay dữ liệu kiểm thử F02 với F04.
2. Xác minh đúng Git SHA được sử dụng để build/test; ghi nguyên SHA trong báo cáo. Không cần tạo nhánh backup hoặc thêm hệ thống CI/Docker mới nếu không cần.
3. Chuẩn bị **database PostgreSQL test RIÊNG** cho F04 (database độc lập hoặc cấu trúc cách ly được chứng minh đủ an toàn), không phải Neon Beta/Production, không chứa dữ liệu người dùng thực.
4. Soát `prisma/schema.prisma`, migration hiện có, `package.json` và biến môi trường; xác minh schema delta F04: `MembershipTier`, `User.membershipTier/tierUpdatedAt`, 5 snapshot fields trên `Order`, `MembershipEvaluationLog` và `@@unique([userId, evaluationQuarter])`.
5. Nếu cần áp dụng migration lên **database test cô lập**, chỉ Release Integrator thực hiện sau khi rà soát lệnh và xác nhận đích kết nối. Không thực hiện migration trên Neon Beta/Production; không đổi schema/source để đạt PASS.
6. Cung cấp cho QA cách chạy test trong môi trường phù hợp; chỉ chia sẻ biến môi trường thử nghiệm qua kênh được phép, không đưa mật khẩu vào log, Markdown hoặc chat.
7. Cấp quyền cho QA chạy test có ghi dữ liệu **chỉ trên database test cô lập**; nếu không thể đảm bảo, chỉ cho phép QA làm static checks và đánh dấu PostgreSQL `NOT RUN`.

## 3. Điều kiện bàn giao môi trường cho QA-F04-02

| Điều kiện | Bằng chứng cần có | Trạng thái ban đầu |
|---|---|---|
| Chính xác source F04 HEAD | SHA `486bcc16...`, `git status`, commit ancestry | CHƯA XÁC MINH BỞI RI |
| Dependencies + scripts build | `package.json`, runtime versions, cách chạy build không sửa source | CHƯA XÁC MINH |
| PostgreSQL test có thể kết nối | Thử kết nối tới DB độc lập, không in credential | CHƯA XÁC MINH |
| F04 schema có thể sử dụng | Migration/schema inspect trên DB test, unique constraint, Prisma Client compatible | CHƯA XÁC MINH |
| Dữ liệu seed thử nghiệm hợp lệ | Test customers, orders, batches, evaluations; không dùng dữ liệu thật | CHƯA XÁC MINH |
| Phân quyền test DB | QA chỉ được ghi/xóa dữ liệu cô lập do RI cấp phép | CHƯA XÁC MINH |
| F02 environment independence | Không sửa DB F02 hoặc trộn fixtures | CHƯA XÁC MINH |

Nếu thiếu PostgreSQL cô lập hoặc cấu hình build an toàn, **không tự triển khai hạ tầng phức tạp/mua dịch vụ**. Báo blocker, chỉ bàn giao phần kiểm thử thực hiện được.

## 4. Dữ liệu kiểm thử cần chuẩn bị

Xem `EV_F04_QA02_POSTGRES_SCENARIOS_AND_TEST_DATA.md`:
- CUSTOMER legacy `membershipTier=null`, CUSTOMER các tier Đồng/Bạc/Vàng/Kim Cương, ADMIN/STAFF.
- CustomerGroup 3% và 8%, sản phẩm thường, hàng mẫu, giỏ 49,99 kg / 50 kg / >50 kg; cước gốc đủ để thử cap 100.000 VND.
- Hai Checkout đồng thời tranh cùng một số lượng tồn FEFO giới hạn; kịch bản rollback.
- Dữ liệu quý sát mốc 16/03, 17/03, 20/03 và tháng thứ hai; log xét hạng trùng; đã có log quý mới hơn.
- Order/complaint/refund **chỉ khi** contract tương thích F02 được kiểm tra; không tự ghép nhánh F02/F04 để tạo fixture.

## 5. Không thuộc quyền nhiệm vụ này

- Không merge/push `beta`/`main`, không deploy Vercel.
- Không chạy migration Neon Beta/Production, không đưa credentials thật vào tài liệu.
- Không sửa source F01/F02/F03/F04 hoặc Prisma Schema.
- Không kích hoạt Quarterly Scheduler.
- Không cấp phép QA-F04-02 tự chạy; **quyền cấp slot thuộc Main Coordinator**.
- Không cập nhật trực tiếp `EVIBE_PROJECT_HANDOFF.md` nếu chưa được Main Coordinator giao.

## 6. Báo cáo bắt buộc của Release Integrator

Tạo file Markdown thực tế trong khu vực làm việc được phép, đặt tên đề xuất:

`EV_F04_ENV_PREPARATION_01_REPORT.md`

Báo cáo gồm: Agent, source SHA, environment isolation, PostgreSQL availability, schema/migration checks, test setup, test fixtures, commands thực tế (nếu có), vấn đề P0–P3, mỗi gap `READY/UNAVAILABLE/UNVERIFIED`, kết luận `ENV_READY_FOR_QA` hoặc `ENV_BLOCKED`, đường dẫn và documentation commit SHA nếu có.

**Chỉ sau khi RI bàn giao bằng chứng môi trường, Main Coordinator mới quyết định cấp slot thực thi QA-F04-02.**

**END — EV-F04-ENV-PREPARATION-01**
