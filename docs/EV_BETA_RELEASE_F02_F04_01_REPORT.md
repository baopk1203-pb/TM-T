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

## II. KẾT LUẬN PHÁT HÀNH HIỆN TẠI (CURRENT RELEASE STATUS)

> ### **`F02/F04 BETA RELEASE — PREFLIGHT GATES 1-4 VERIFIED / AWAITING DIRECT NEON CREDENTIAL`**

### 📋 TIẾN TRÌNH THẨM ĐỊNH MỚI NHẤT (SAU KHI PO ĐĂNG NHẬP VERCEL CLI):
1. ✅ **Vercel CLI Authentication:** Đã xác minh thành công tài khoản `baopk1203-pb` qua `npx vercel whoami`.
2. ✅ **Vercel Project & Branch Scope:** Đã xác minh dự án `baopk/nong-san-b2b` với cấu hình môi trường nhánh riêng biệt cho `Preview (beta)`. Biến `DATABASE_URL` được định nghĩa chính thức trong Preview scope.
3. 🔒 **Vercel Zero-Trust Security Redaction:** Vercel CLI từ chối trích xuất giá trị plaintext của `DATABASE_URL` về máy local (`! 3 Secret values cannot be pulled from the 'preview' Environment. Wrote '[SENSITIVE]' as placeholders`). Đây là cơ chế bảo mật tiêu chuẩn của Vercel đối với biến kiểu `Secret`, bảo vệ credentials không bị lộ qua CLI.
4. ✅ **Đối chiếu Release Candidate HEAD & Lineage:** Đã đối chiếu toàn bộ lịch sử Git. Khẳng định **Zero Code Divergence** (Mọi khác biệt SHA trước đó chỉ xuất phát từ các commit tài liệu báo cáo `docs/*.md`). Phép thử 3-Way Merge đạt **0 xung đột (Clean Merge 100%)**.

---

## III. SOURCE IDENTITIES & RELEASE CANDIDATE AUDIT

| Thuộc tính | Giá trị kiểm tra / SHA | Ghi chú kỹ thuật |
| :--- | :--- | :--- |
| **Official Repository** | `D:\TDTU\TMĐT Website` | Thư mục repo chính thức của dự án |
| **Target Branch** | `beta` | Nhánh phát hành Beta Preview |
| **Integration Worktree** | `D:\TDTU\wt_f02_f04_integration` | Worktree cô lập của DEV 1 |
| **Release Candidate Branch** | `test/f02-f04-integration` | Nhánh ứng viên release candidate |
| **Common Ancestor SHA** | `34fc2591c3877ed92c4642e4f01c629c0d02227f` | Điểm phân nhánh chung (`beta` base) |
| **Source Integration Commit** | `053dabcd82185093d0ce7966dd71814e81b778d5` | 39 tệp mã nguồn F02 + F04 + Cross Financial contract |
| **F02 Migration Commit** | `9902a930776b3c46a6fbb8d56b006fc454cbfb40` | Tệp migration SQL F02 hoàn chỉnh có explicit transaction |
| **Candidate HEAD (Worktree)**| `7592c287e53098001894b2f4f9a2a6209aa71a24` | HEAD hiện tại trên worktree (bao gồm các báo cáo release) |
| **Local Beta HEAD (Repo)** | `a699465cbd3d275b10eae54834518bac9cd20b68` | HEAD hiện tại trên repo chính |
| **Remote `origin/beta` HEAD** | `8746c08958ba0cd1f14c0d74cea68a6e623d14d5` | HEAD trên remote GitHub |
| **3-Way Merge Simulation** | **0 conflicts (Sạch 100%)** | Xác nhận qua `git merge-tree` độc lập |

---

## IV. BẢNG TỔNG HỢP PREFLIGHT GATES

| Tiêu chuẩn Preflight | Kết quả thực tế | Trạng thái | Đánh giá kỹ thuật |
| :--- | :--- | :---: | :--- |
| **1. Vercel CLI Session** | `npx vercel whoami` ➔ `baopk1203-pb` | **PASS** | Đã đăng nhập hợp lệ |
| **2. Vercel Project & Scope** | `baopk/nong-san-b2b` ➔ `Preview (beta)` | **PASS** | Nhận diện đúng project & branch override |
| **3. Blocklist Production** | `ep-square-scene-b5ddgxil` được blocklist nghiêm ngặt | **PASS** | Chặn đứng hoàn toàn truy cập Production |
| **4. Release Candidate Lineage** | 100% mã nguồn F02 + F04 tập trung tại `053dabc` và `9902a93` | **PASS** | Zero code divergence, 0 conflicts |
| **5. Direct Neon Connection** | Vercel CLI redact `[SENSITIVE]`, không thể pull plaintext | **AWAITING PO** | Cần chuỗi kết nối trực tiếp để chạy migrate |
| **6. Remote Prisma Migration** | Sẵn sàng chạy ngay khi có kết nối trực tiếp | **READY** | 5/5 migrations đã PASS trên test engine |
| **7. Git Push Safety Guard** | Chặn push cho tới khi migration hoàn tất | **HELD** | Tuân thủ Deployment Ordering Rule |

---

## V. ĐÚNG MỘT THAO TÁC CẦN THIẾT DÀNH CHO PRODUCT OWNER

Để DEV 1 hoàn tất toàn bộ quy trình phát hành tự động mà không làm lộ credentials trong chat:

### 🎯 THAO TÁC DUY NHẤT:
PO mở **PowerShell** trên máy tính và chạy **ĐÚNG MỘT DÒNG LỆNH**:

```powershell
[System.Environment]::SetEnvironmentVariable("DATABASE_URL", "<DAN_CHUOI_DIRECT_NEON_PREVIEW_BETA_TAI_DAY>", "User")
```

> **Cách lấy chuỗi kết nối:**
> 1. Truy cập [Neon Console](https://console.neon.tech) ➔ Chọn project **E Vibe / nong-san-b2b**.
> 2. Chọn branch **`preview-beta`**.
> 3. Tại mục **Connection Details**, chọn **Direct connection** (không chọn Pooled connection).
> 4. Sao chép chuỗi kết nối (dạng `postgres://...@ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require`) và dán vào lệnh trên.

Sau khi chạy xong, PO chỉ cần phản hồi trong chat: **`"Đã set DATABASE_URL"`**.

### 🤖 CÁC BƯỚC DEV 1 TỰ ĐỘNG THỰC THI NGAY SAU ĐÓ:
1. Đọc biến môi trường tạm thời từ User scope.
2. Kiểm tra an toàn hostname (xác nhận đúng `ep-fancy-waterfall-b5f117np`, cấm tuyệt đối production).
3. Thực thi `npx prisma migrate deploy` và kiểm tra `npx prisma migrate status`.
4. **Xóa ngay lập tức** biến môi trường khỏi User scope để dọn dẹp sạch sẽ (`SetEnvironmentVariable("DATABASE_URL", $null, "User")`).
5. Thực hiện Git Merge vào `beta` và `git push origin beta`.
6. Giám sát Vercel Preview Build hoàn tất và chạy Smoke Test.

---
*Báo cáo được cập nhật bởi DEV 1 — Release Integrator.*  
*Thời điểm ghi nhận: 2026-10-28 22:25:00 (UTC+7)*
