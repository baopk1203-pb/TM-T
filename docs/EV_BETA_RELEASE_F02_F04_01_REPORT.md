# EV-BETA-RELEASE-F02-F04-01 — CONTROLLED FAST-TRACK BETA DEPLOYMENT REPORT
## DỰ ÁN E VIBE — NÔNG SẢN B2B (F02 COMPLAINTS & F04 MEMBERSHIP)

---

## I. THÔNG TIN BÁO CÁO & ỦY QUYỀN

- **Mã nhiệm vụ (Task ID):** `EV-BETA-RELEASE-F02-F04-01`
- **Tên nhiệm vụ:** `CONTROLLED FAST-TRACK BETA DEPLOYMENT`
- **Vai trò:** DEV 1 — Release Integrator
- **Ủy quyền:** ChatGPT 1 — Main Coordinator
- **Chỉ thị bổ sung:** `MAIN COORDINATOR — SECURE NEON UNBLOCK`
- **Chế độ thực thi:** `CONDITIONAL BETA RELEASE AUTHORIZED`
- **Mục tiêu:** Triển khai đồng thời F02 (Two-Way Complaints & 48-Hour SLA) và F04 (Membership & Quarterly KPI) lên nhánh `beta` và Vercel Beta Preview; cung cấp giải pháp One-Time Secure Migration cho PO tuân thủ an toàn credentials tuyệt đối.

---

## II. KẾT LUẬN HIỆN TẠI (CURRENT RELEASE STATUS)

> ### **`F02/F04 BETA RELEASE — AWAITING SECURE NEON PREVIEW ACCESS`**

### 📋 QUYẾT ĐỊNH CỦA MAIN COORDINATOR:
1. **Bác bỏ phương án lưu `DATABASE_URL` tại scope "User" của Windows:** Tránh rủi ro lưu trữ credentials lâu dài trên hệ điều hành và tránh lệch đồng bộ tiến trình.
2. **Áp dụng cơ chế One-Time Process-Only Secure Migration:** Chuỗi kết nối chỉ được nạp trong bộ nhớ của đúng một tiến trình PowerShell duy nhất thông qua cơ chế nhập ẩn `Read-Host -AsSecureString` (không hiển thị mật khẩu, không ghi vào command history).
3. **Bàn giao Script thực thi an toàn chuyên dụng:** Script [`scripts/secure-beta-migrate.ps1`](file:///D:/TDTU/wt_f02_f04_integration/nong-san-b2b/scripts/secure-beta-migrate.ps1) đã được DEV 1 tạo lập, kiểm tra cú pháp (0 errors) và trang bị 3 chốt chặn an toàn (Hard Guards).
4. **Quy tắc kiểm soát phát hành:** Giữ vững nguyên tắc **DB Migration PASS trước ➔ Git Merge & Push Beta sau**. Tuyệt đối không can thiệp nhánh `main` và bảo vệ toàn vẹn Production Database.

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
| **Candidate HEAD (Worktree)**| `c31eddb37fba0223eb009ce4a49622d057a6e1ce` | HEAD trên worktree (đã bao gồm các báo cáo release) |
| **Local Beta HEAD (Repo)** | `251d6bd5e69bf8f47dc66213fc81a1796191b7d5` | HEAD trên repo chính |
| **Remote `origin/beta` HEAD** | `8746c08958ba0cd1f14c0d74cea68a6e623d14d5` | HEAD trên remote GitHub |
| **3-Way Merge Simulation** | **0 conflicts (Sạch 100%)** | Xác nhận qua `git merge-tree` độc lập |

---

## IV. BẢNG TỔNG HỢP HARD GUARDS TRONG `secure-beta-migrate.ps1`

| Chốt chặn | Cơ chế kiểm tra | Hành vi khi vi phạm | Trạng thái |
| :--- | :--- | :--- | :---: |
| **Guard 1: Blocklist Production** | Quét chuỗi hostname phát hiện `ep-square-scene-b5ddgxil` | **ABORT NGAY LẬP TỨC** — Ngăn tuyệt đối ghi dữ liệu vào Production | **PASS** |
| **Guard 2: Direct Connection Only** | Phát hiện hậu tố `-pooler` trong connection string | **ABORT NGAY LẬP TỨC** — Bắt buộc dùng Direct Port 5432 cho DDL | **PASS** |
| **Guard 3: Positive Match Target** | So khớp bắt buộc với endpoint `ep-fancy-waterfall-b5f117np` | **ABORT NGAY LẬP TỨC** — Ngăn kết nối nhầm sang database khác | **PASS** |
| **Guard 4: Zero History Leakage** | `Read-Host -AsSecureString` | Không lưu lệnh và credentials vào file `ConsoleHost_history.txt` | **PASS** |
| **Guard 5: Ephemeral Memory Lifecycle**| Khối `try / finally` tự động xóa biến `$env:DATABASE_URL` và gọi Garbage Collector | Chuỗi kết nối bị xóa sổ khỏi bộ nhớ ngay cả khi lệnh gặp lỗi | **PASS** |

---

## V. HƯỚNG DẪN DUY NHẤT DÀNH CHO PRODUCT OWNER (PO RUNBOOK)

PO chỉ cần mở **PowerShell** trên máy tính và chạy **ĐÚNG MỘT LỆNH**:

```powershell
powershell -ExecutionPolicy Bypass -File "D:\TDTU\wt_f02_f04_integration\nong-san-b2b\scripts\secure-beta-migrate.ps1"
```

### Tiến trình thực thi trên màn hình:
1. Script hiển thị tiêu đề và yêu cầu:
   ```
   Direct Connection String: ****************************************************
   ```
2. PO dán chuỗi Direct Connection của Neon `preview-beta` (chuỗi dạng `postgres://...@ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require`) rồi nhấn **Enter**.
3. Script tự động thực thi tuần tự:
   - Xác thực hostname an toàn (`preview-beta`).
   - Kiểm tra baseline migration (`prisma migrate status`).
   - Áp dụng migration F04 & F02 (`prisma migrate deploy`).
   - Xác nhận trạng thái cơ sở dữ liệu mới nhất (`Database schema is up to date!`).
   - Tự động xóa sạch credentials khỏi bộ nhớ tiến trình (`finally`).
4. Kết thúc với thông báo:
   ```
   =================================================================
      MIGRATION HOAN TAT THANH CONG 100%! CO SO DU LIEU DA SAN SANG 
   =================================================================
   ```

---

## VI. HÀNH ĐỘNG CỦA DEV 1 SAU KHI PO BÁO HOÀN TẤT MIGRATION

Sau khi PO phản hồi trong chat: **`"Migration đã hoàn tất thành công"`** (kèm output xác nhận):
1. DEV 1 thực hiện merge candidate vào nhánh `beta` tại repo chính `D:\TDTU\TMĐT Website`:
   ```bash
   git merge c31eddb
   ```
2. DEV 1 thực hiện push lên remote GitHub:
   ```bash
   git push origin beta
   ```
3. Giám sát Vercel Preview Deployment kích hoạt tự động trên commit mới.
4. Thực hiện Smoke Test tối giản trên URL `https://nong-san-b2b-git-beta-baopk.vercel.app`.
5. Đóng gói báo cáo hoàn tất phát hành Beta Release F02 + F04.

---
*Báo cáo được lập và kiểm soát bởi DEV 1 — Release Integrator.*  
*Thời điểm ghi nhận: 2026-10-28 22:35:00 (UTC+7)*
