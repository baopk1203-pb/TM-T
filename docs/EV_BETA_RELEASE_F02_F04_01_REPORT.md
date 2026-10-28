# EV-BETA-RELEASE-F02-F04-01 — CONTROLLED FAST-TRACK BETA DEPLOYMENT REPORT
## DỰ ÁN E VIBE — NÔNG SẢN B2B (F02 COMPLAINTS & F04 MEMBERSHIP)

---

## I. THÔNG TIN BÁO CÁO & ỦY QUYỀN

- **Mã nhiệm vụ (Task ID):** `EV-BETA-RELEASE-F02-F04-01`
- **Tên nhiệm vụ:** `CONTROLLED FAST-TRACK BETA DEPLOYMENT`
- **Vai trò:** DEV 1 — Release Integrator
- **Ủy quyền:** ChatGPT 1 — Main Coordinator
- **Chế độ thực thi:** `CONDITIONAL BETA RELEASE AUTHORIZED`
- **Mục tiêu:** Triển khai đồng thời F02 (Two-Way Complaints & 48-Hour SLA) và F04 (Membership & Quarterly KPI) lên nhánh `beta` và Vercel Beta Preview; thực hiện quy trình Preflight, Migration, Git Integration, Deploy và Smoke Test.

---

## II. KẾT LUẬN PHÁT HÀNH (FINAL RELEASE VERDICT)

> ### **`F02/F04 BETA RELEASE — BLOCKED AT PREFLIGHT`**

### ⚠️ NGUYÊN NHÂN CHẶN AN TOÀN THEO CHỈ THỊ FAIL-CLOSED:
1. **Thiếu chuỗi kết nối trực tiếp đến Neon Preview-Beta:** Cấu hình local `.env` hiện trỏ `localhost`, còn `.env.production` trỏ Production host (`ep-square-scene-b5ddgxil`) — bị chặn tuyệt đối bởi chốt chặn an toàn (Hard Guard Blocklist). Chuỗi kết nối đến Neon Preview (`ep-fancy-waterfall-b5f117np`) không được lưu trong môi trường tiến trình hoặc file để bảo đảm an toàn credential.
2. **Vercel CLI ở trạng thái Logged Out:** Phiên làm việc CLI ghi nhận `Vercel CLI 63.1.2: Logged out`, không thể tự động trích xuất biến môi trường `DATABASE_URL` từ Vercel Preview Project.
3. **Quy tắc Deployment Ordering (An toàn thứ tự phát hành):** Tuyệt đối **KHÔNG PUSH** mã nguồn F02/F04 lên nhánh `beta` trước khi cơ sở dữ liệu Neon hoàn tất Migration, nhằm ngăn ngừa Vercel Preview kích hoạt deploy tự động gây lỗi runtime truy vấn cột/bảng chưa tồn tại trên database trực tiếp.

---

## III. SOURCE IDENTITIES & RELEASE CANDIDATE

| Thuộc tính | Giá trị kiểm tra / SHA | Ghi chú |
| :--- | :--- | :--- |
| **Official Repository** | `D:\TDTU\TMĐT Website` | Thư mục repo chính thức của dự án |
| **Target Branch** | `beta` | Nhánh phát hành Beta Preview |
| **Integration Worktree** | `D:\TDTU\wt_f02_f04_integration` | Worktree cô lập của DEV 1 |
| **Release Candidate Branch** | `test/f02-f04-integration` | Nhánh ứng viên release candidate |
| **Final Candidate HEAD** | `4dd7cdbfd3fdc218255c0cb20d3dc377766ea6b5` | HEAD hoàn tất tích hợp, tests và migration artifacts |
| **Beta Base SHA** | `34fc2591c3877ed92c4642e4f01c629c0d02227f` | Baseline `beta` chứa F01 và F03 Gemini AI-1 |
| **Integration Commit** | `053dabcd82185093d0ce7966dd71814e81b778d5` | Commit tích hợp mã nguồn F02 + F04 + Cross Financial |
| **F02 Migration Commit** | `9902a930776b3c46a6fbb8d56b006fc454cbfb40` | Commit tạo F02 Migration SQL Artifact chính thức |
| **Report Intake Commit** | `4dd7cdbfd3fdc218255c0cb20d3dc377766ea6b5` | Báo cáo DB Readiness ghi nhận vào candidate |
| **Candidate Working Tree** | Clean (`nothing to commit, working tree clean`) | 0 modified, 0 untracked |

---

## IV. KẾT QUẢ KIỂM TRA BƯỚC 1 — BETA PREFLIGHT

Toàn bộ 8 tiêu chí Preflight được kiểm tra nghiêm ngặt:

| Tiêu chuẩn Preflight | Kết quả thực tế | Trạng thái | Đánh giá an toàn |
| :--- | :--- | :---: | :--- |
| **1. HEAD thực tế nhánh `beta`** | Local: `7dfb099` (ahead 4 doc commits)<br>Remote `origin/beta`: `8746c08` | **PASS** | Nhánh sạch, đồng bộ tuyến tính |
| **2. Release Candidate HEAD** | `4dd7cdb` tại `wt_f02_f04_integration` | **PASS** | Đúng SHA, working tree sạch 100% |
| **3. Thay đổi Git chưa bảo toàn** | Không có thay đổi mã nguồn nào bị thất thoát; các tệp untracked là docs | **PASS** | Toàn vẹn lịch sử Git |
| **4. Vercel deployment branch** | Vercel Webhook liên kết nhánh `beta`; Deployment gần nhất `7377933697` tại `8746c08` | **PASS** | Xác nhận đúng Preview scope qua `gh api` |
| **5. Xác định Database đích** | Known Host: `ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech`<br>Local `.env`: `localhost`<br>Local `.env.production`: `ep-square-scene-b5ddgxil` (PROD) | **FAIL-CLOSED** | **Không có credential kết nối Neon Preview** |
| **6. Xác nhận không phải Production** | Production Host `ep-square-scene-b5ddgxil` được blocklist nghiêm ngặt | **PASS** | Chặn đứng hoàn toàn truy cập Production |
| **7. Lịch sử Migration trên DB đích** | Không thể truy vấn từ xa do thiếu chuỗi kết nối live | **BLOCKED** | Không thể đối chiếu `_prisma_migrations` |
| **8. Kiểm tra Schema compatibility** | Không thể truy vấn từ xa do thiếu chuỗi kết nối live | **BLOCKED** | Không thể đối chiếu trực tiếp trên Neon Beta |

---

## V. THẨM ĐỊNH MỤC TIÊU CƠ SỞ DỮ LIỆU (DATABASE TARGET VERIFICATION)

### 1. Phân định ranh giới hạ tầng Neon:
- **Production Endpoint (CẤM TUYỆT ĐỐI):** `ep-square-scene-b5ddgxil` — Đang được khai báo trong `.env.production`. Chốt chặn fail-closed ngăn ngừa việc sử dụng nhầm tệp này cho môi trường Beta.
- **Preview Beta Endpoint:** `ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech` (Neon branch `preview-beta`, database `neondb`).

### 2. Hiện trạng Credential:
- Theo chính sách bảo mật của PO từ các phase trước, thông tin đăng nhập Neon không được lưu vào Git, không ghi vào file unencrypted và không hiển thị trên transcript.
- `Vercel CLI` trên máy chủ hiện đang ở trạng thái `Logged out`, do đó không thể tự động đồng bộ biến môi trường `DATABASE_URL` từ Vercel Preview.

---

## VI. TRẠNG THÁI PRISMA MIGRATIONS

- **Tình trạng Artifacts:** Sẵn sàng 100% tại `prisma/migrations/`:
  1. `20261013094130_init` (Core B2B)
  2. `20261019193200_phase8_shipping_engine` (Phase 8 Shipping)
  3. `20261023235900_add_f01_inventory_ledger` (F01 FEFO Ledger)
  4. `20261028203000_f04_membership_and_quarterly_kpi` (F04 Membership DDL)
  5. `20261028213000_f02_two_way_complaints` (F02 Complaints DDL)
- **Kiểm chứng Offline (Embedded PostgreSQL 18.4):** Đã kiểm chứng 5/5 migrations chạy thành công bằng `prisma migrate deploy`, `prisma migrate status` trả về `Database schema is up to date!`, Zero Schema Drift.
- **Trạng thái trên Neon Beta:** **CHƯA THỰC THI (PENDING REMOTE APPLY)** do chờ người vận hành cung cấp kết nối hoặc tự thực thi theo runbook.

---

## VII. TRẠNG THÁI GIT INTEGRATION

- **Đánh giá 3-Way Merge (`git merge-tree`):**
  - Thực hiện mô phỏng merge giữa `beta` (`7dfb099`) và Release Candidate (`4dd7cdb`): **0 xung đột (Zero Conflicts)**.
  - Toàn bộ 41 tệp thay đổi của F02 và F04 sẽ tích hợp sạch sẽ vào `beta`.
- **Trạng thái Push:** **CHẶN PUSH AN TOÀN (PUSH WITHHELD)**:
  - Do Vercel có webhook tự động build khi có push lên `origin/beta`, việc push code trước khi migrate database sẽ dẫn đến việc Vercel triển khai mã nguồn mới kết nối với database chưa có các cột/bảng F02/F04.
  - Tuân thủ nguyên tắc an toàn kiến trúc: **DB Migration TRƯỚC, Git Push SAU**.

---

## VIII. TRẠNG THÁI VERCEL DEPLOYMENT

- **Vercel Preview URL:** `https://nong-san-b2b-git-beta-baopk.vercel.app`
- **Deployment hiện tại:** `https://nong-san-b2b-83w6nzsf0-baopk.vercel.app` (trên commit `8746c08`, trạng thái `SUCCESS`).
- **Xác thực HTTP:** Phản hồi `HTTP/1.1 302 Found` kèm tiêu đề bảo vệ `Vercel SSO Protection`.
- **Trạng thái sẵn sàng:** Vercel webhook hoạt động bình thường, sẽ tự động biên dịch và triển khai ngay khi nhận commit push từ nhánh `beta`.

---

## IX. KẾ HOẠCH HÀNH ĐỘNG KHẮC PHỤC (UNBLOCK RUNBOOK)

Để hoàn tất việc triển khai bản phát hành F02 + F04 lên Beta, DEV 1 đề xuất **phương án xử lý ngắn nhất** gồm 2 tùy chọn:

### TÙY CHỌN 1 (KHUYẾN NGHỊ — NGƯỜI VẬN HÀNH CHẠY MIGRATION TRỰC TIẾP):
Người vận hành / PO mở một cửa sổ PowerShell tại thư mục `nong-san-b2b` trong repo chính hoặc worktree và chạy tuần tự 3 lệnh:

```powershell
# Bước 1: Điều hướng vào thư mục ứng dụng
cd "D:\TDTU\wt_f02_f04_integration\nong-san-b2b"

# Bước 2: Thiết lập chuỗi kết nối Direct của Neon preview-beta (thay thế chuỗi thực tế)
$env:DATABASE_URL = "postgres://<USER>:<PASSWORD>@ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require"

# Bước 3: Chạy migration và kiểm tra trạng thái
npx prisma migrate deploy
npx prisma migrate status
```

Sau khi hoàn tất, phản hồi cho DEV 1: **"Migration đã chạy thành công"**. DEV 1 sẽ ngay lập tức thực hiện Git Merge `beta`, push lên `origin/beta`, theo dõi Vercel Preview Deploy và thực hiện Smoke Test.

---

### TÙY CHỌN 2 (CẤP QUYỀN MÔI TRƯỜNG CHO DEV 1):
Người vận hành thiết lập biến môi trường `$env:DATABASE_URL` trong phiên làm việc hoặc đăng nhập Vercel CLI (`npx vercel login`). DEV 1 sẽ tự động hoàn tất toàn bộ chuỗi:
1. `prisma migrate deploy` trên Neon Beta.
2. Kiểm tra `prisma migrate status` và đối chiếu schema.
3. Merge candidate `4dd7cdb` vào `beta`.
4. `git push origin beta`.
5. Giám sát Vercel Preview Build hoàn tất.
6. Thực hiện Smoke Test và báo cáo kết quả cuối cùng.

---

## X. TỔNG KẾT RỦI RO & BẢO TOÀN HỆ THỐNG

| Đối tượng | Trạng thái bảo vệ |
| :--- | :--- |
| **Nhánh `main` & Production** | **AN TOÀN TUYỆT ĐỐI (0 writes, 0 pushes)** |
| **Production Neon Database** | **AN TOÀN TUYỆT ĐỐI (Blocklist bảo vệ 100%)** |
| **Nhánh `beta` remote** | **AN TOÀN TUYỆT ĐỐI (Chưa bị push đè khi DB chưa sẵn sàng)** |
| **Mã nguồn Release Candidate** | **ĐÃ HOÀN TẤT & ĐÓNG GÓI SẠCH TẠI `4dd7cdb`** |

---
*Báo cáo được lập bởi DEV 1 — Release Integrator theo chỉ thị Fail-Closed.*  
*Thời điểm ghi nhận: 2026-10-28 22:00:00 (UTC+7)*
