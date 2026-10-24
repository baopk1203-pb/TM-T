# BÁO CÁO HOTFIX GATE G5: BẮT BUỘC SAO LƯU NEON PREVIEW ĐÃ XÁC MINH TRƯỚC KHI APPLY MIGRATION (EV-IMP-01B-G5-HOTFIX)

**Dự án:** E Vibe — Nền tảng TMĐT B2B Nông sản – Trái cây  
**Giai đoạn:** Cải tiến F01 (Inventory Ledger & Batch Reservation Model)  
**Tác vụ:** `EV-IMP-01B-G5-HOTFIX`  
**Chức danh:** Senior DevOps Engineer & Database Reliability Engineer  
**Thời điểm thực hiện:** 24/10/2026  
**Trạng thái kiểm thử:** **PASS (39/39 PowerShell Tests, 546/546 Vitest, Lint 0 errors, Typecheck 0 errors, Build PASS)**  

---

## 1. Trạng Thái Git HEAD và Working Tree

- **Nhánh Git hiện tại:** `beta`
- **Git HEAD hiện tại:** `5b9812f545b6cd4eba25075c80876802b92992a4` (`5b9812f` - local package commit từ `EV-IMP-01B-LOCAL-COMMIT`)
- **Trạng thái so với remote:** `ahead 1` so với `origin/beta` (tuyệt đối chưa push lên GitHub).
- **Trạng thái Working Tree:**
  - **Không có bất kỳ commit mới nào được tạo trong tác vụ này** (tuân thủ nghiêm ngặt quy tắc Zero-Commit).
  - Có 2 tệp tin tracked được sửa đổi trực tiếp phục vụ hotfix G5:
    - [`nong-san-b2b/scripts/safe-preview-migrate.ps1`](file:///d:/TMĐT%20Website/nong-san-b2b/scripts/safe-preview-migrate.ps1)
    - [`nong-san-b2b/tests/unit/safe-preview-migrate.test.ps1`](file:///d:/TMĐT%20Website/nong-san-b2b/tests/unit/safe-preview-migrate.test.ps1)
  - Prisma Schema và migration SQL giữ nguyên 100% hash `14A35A7CAB52CAE9BCB3D6651520F00C2796A4C590C069A43863EAE6FE93F0E5`.

---

## 2. Nguyên Nhân Kỹ Thuật Dẫn Đến Đường Bypass G5

Trong phiên bản script trước đó (`EV-IMP-01B-SAFETY-FIX`), Gate G5 tồn tại 2 sơ hở an toàn nghiêm trọng cho phép bỏ qua yêu cầu sao lưu:

1. **Sơ hở Interactive Mode Waiver (Hỏi xác nhận bỏ qua):**
   - Tại dòng 360–367 cũ, khi người vận hành không nhập Backup ID, script hiển thị câu hỏi:
     `CANH BAO: Ban CHUA nhap Backup ID! Ban co chac chan muon tiep tuc ma khong co backup snapshot khong? (y/N)`
   - Nếu người vận hành bấm `y`, script chấp nhận và trả về trạng thái `WAIVED_WITHOUT_BACKUP_ID` với `CanProceed = $true`.
   - Điều này tạo ra một "đường thoát hiểm" nguy hiểm, khiến lệnh `npx prisma migrate deploy` có thể chạy trên Neon Preview mà không có bất kỳ điểm phục hồi (Restore Point) nào được bảo đảm trước đó.
2. **Sơ hở Waiver Flag (`-SkipRecoveryChecklist`):**
   - Cờ `-SkipRecoveryChecklist` vốn được thiết kế cho test harness offline nhưng lại không được chặn trong `Mode Apply`, cho phép bất kỳ lời gọi lệnh nào có cờ này vượt qua Gate G5 với trạng thái `WAIVED_BY_PO`.
3. **Lẫn lộn giữa Ghi nhận chuỗi ID và Xác minh thực tế:**
   - Script cũ chỉ cần người vận hành truyền một chuỗi bất kỳ qua `-BackupSnapshotId` là tự động gắn nhãn `VERIFIED_BACKUP`, bất kể chuỗi đó là dummy (`"test"`, `"dummy"`) hay chưa từng được đối chiếu trên Neon Console.

---

## 3. Danh Sách File và Các Vùng Dòng Đã Sửa Đổi

### Tệp 1: [`nong-san-b2b/scripts/safe-preview-migrate.ps1`](file:///d:/TMĐT%20Website/nong-san-b2b/scripts/safe-preview-migrate.ps1)
- **Dòng 25–28:** Bổ sung tham số `[switch]$BackupVerifiedByPO = $false` tại chữ ký chính của script; cập nhật chú thích cờ `-SkipRecoveryChecklist` (bị cấm tuyệt đối trong Apply).
- **Dòng 294–306:** Thêm hàm thẩm định định dạng snapshot `Test-BackupSnapshotFormat` (chặn chuỗi rỗng, chặn blacklist dummy `'dummy', 'test', 'none', 'fake', 'abc', '123'`, yêu cầu độ dài 8–100 ký tự hợp chuẩn Neon branch).
- **Dòng 308–420:** Tái cấu trúc toàn diện hàm `Test-RecoveryReadiness`:
  - Chặn đứng cờ `-SkipRecoveryChecklist` khi `$Mode -eq 'Apply'`.
  - Loại bỏ hoàn toàn khối `confirmWithout` (`y/N`).
  - Thẩm định chặt chẽ định dạng Backup ID.
  - Phân tách rõ rệt 2 trạng thái `BACKUP_ID_RECORDED` và `BACKUP_VERIFIED`.
  - Chế độ Preflight: Giữ nguyên khả năng chạy dry-run read-only an toàn (`PREFLIGHT_CHECKED`).
- **Dòng 760 & 842–852:** Cập nhật hàm điều khiển `Invoke-SafePreviewMigration`:
  - Tiếp nhận và chuyển tiếp tham số `-BackupVerifiedByPO`.
  - Bổ sung Hard Gate Guard tại Bước 4: Nếu `Mode Apply` mà trạng thái không đạt chuẩn `BACKUP_VERIFIED` thì fail-closed ngay lập tức.
- **Dòng 1047:** Cập nhật dòng thực thi controller khi chạy trực tiếp file script.

### Tệp 2: [`nong-san-b2b/tests/unit/safe-preview-migrate.test.ps1`](file:///d:/TMĐT%20Website/nong-san-b2b/tests/unit/safe-preview-migrate.test.ps1)
- **Dòng 198–202 (S12):** Cập nhật test case S12 kiểm tra chuẩn trạng thái mới `BACKUP_VERIFIED`.
- **Dòng 209–265 (S13, S14, S15):** Thay thế cờ waiver `-SkipRecoveryChecklist` thành bộ tham số chuẩn tuân thủ `-BackupSnapshotId "backup-pre-f01-inventory-20261024-test" -BackupVerifiedByPO`.
- **Dòng 450–545 (S32–S39):** Bổ sung 7 test case kiểm thử chuyên sâu cho Gate G5 chống bypass:
  - S33: Chặn cờ `-SkipRecoveryChecklist` trong Apply.
  - S34: Chặn Backup ID giả mạo (`'dummy'`).
  - S35: Chặn Apply khi có ID nhưng thiếu xác minh PO (`BACKUP_ID_RECORDED`).
  - S36: Preflight không cần backup ID (Read-only `PREFLIGHT_CHECKED`).
  - S37: Preflight có ID nhưng chưa xác minh (`BACKUP_ID_RECORDED` vẫn cho phép dry-run).
  - S38: Interactive Apply để trống Backup ID -> FAIL-CLOSED (không cho bypass).
  - S39: Interactive Apply nhập `'y'` nhằm thử bypass kiểu cũ -> FAIL-CLOSED.

---

## 4. Bảng So Sánh Hành Vi Interactive Mode (Trước vs Sau)

| Tình huống tương tác | Hành vi TRƯỚC Hotfix | Hành vi SAU Hotfix | Đánh giá an toàn |
| :--- | :--- | :--- | :--- |
| **Người vận hành nhấn Enter (bỏ trống Backup ID)** | Hiện cảnh báo và hỏi: *"Ban co chac chan muon tiep tuc ma khong co backup snapshot khong? (y/N)"* | Dừng ngay lập tức với lỗi: `HARD GATE G5 FAILED: Thao tac APPLY bi dung do nguoi van hanh khong nhap Backup Snapshot ID! Tuyet doi khong co co che bo qua (waiver) nao trong Apply.` | **FAIL-CLOSED 100%**. Không còn đường bypass. |
| **Người vận hành nhập `y` khi script yêu cầu Backup ID** | Trạng thái ghi nhận `WAIVED_WITHOUT_BACKUP_ID`, cho phép tiến hành Apply. | Bị chặn ngay tại `Test-BackupSnapshotFormat` vì chuỗi `'y'` là dummy, ngắn hơn 8 ký tự -> Ném ngoại lệ `HARD GATE G5 FAILED: Backup ID 'y' khong hop le hoac la gia tri gia mao`. | **TRIỆT TIÊU TOÀN BỘ BYPASS**. |
| **Người vận hành nhập Backup ID hợp lệ** | Tự động coi là `VERIFIED_BACKUP` và cho phép Apply mà không cần kiểm chứng. | Chuyển sang trạng thái `BACKUP_ID_RECORDED`. Script yêu cầu xác minh thứ cấp: *"Ban da vao Neon Console va xac minh branch tren dang ton tai o trang thai 'Ready' chua? (y/N)"*. Chỉ khi PO xác nhận `y` mới nâng cấp lên `BACKUP_VERIFIED`. Nếu không, dừng Apply. | **BẢO ĐẢM XÁC THỰC 2 LỚP**. |

---

## 5. Bảng So Sánh Hành Vi Non-Interactive Mode (Trước vs Sau)

| Tham số truyền vào | Hành vi TRƯỚC Hotfix | Hành vi SAU Hotfix | Đánh giá an toàn |
| :--- | :--- | :--- | :--- |
| `safe-preview-migrate.ps1 -Mode Apply -NonInteractive` (thiếu `-BackupSnapshotId`) | Báo lỗi nhưng thông điệp hướng dẫn có thể dùng `-SkipRecoveryChecklist`. | Ném ngoại lệ `HARD GATE G5 FAILED: Che do Apply (Non-Interactive) bat buoc phai truyen '-BackupSnapshotId <ID>' va co xac minh! Khong duoc phep de trong.` | **BẮT BUỘC THAM SỐ**. |
| `-Mode Apply -BackupSnapshotId "dummy" -NonInteractive` | Cho phép chạy và coi là `VERIFIED_BACKUP`. | Ném ngoại lệ `HARD GATE G5 FAILED: Backup ID 'dummy' khong hop le hoac la gia tri gia mao...` | **CHẶN GIÁ TRỊ RÁC / DUMMY**. |
| `-Mode Apply -BackupSnapshotId "<ValidID>" -NonInteractive` (thiếu `-BackupVerifiedByPO`) | Cho phép chạy và coi là `VERIFIED_BACKUP`. | Ghi nhận `BACKUP_ID_RECORDED`, dừng Apply: `HARD GATE G5 FAILED: Backup ID '...' da duoc ghi nhan (BACKUP_ID_RECORDED), nhung chua co xac minh tu PO (-BackupVerifiedByPO)...` | **BẮT BUỘC BẰNG CHỨNG XÁC MINH**. |
| `-Mode Apply -SkipRecoveryChecklist` | Bỏ qua backup, trả về `WAIVED_BY_PO` và cho phép Apply. | Ném ngoại lệ `HARD GATE G5 FAILED: Co bypass/waiver (-SkipRecoveryChecklist) bi CAM TUYET DOI trong che do Apply!` | **CẤM HOÀN TOÀN WAIVER TRONG APPLY**. |

---

## 6. Bằng Chứng Chống Bypass (Fail-Closed Evidence)

Hệ thống đã loại bỏ 100% mọi đường dẫn logic có thể dẫn đến việc thực thi `npx prisma migrate deploy` mà thiếu xác minh backup:

```text
[Mode Apply]
   │
   ├── Có cờ -SkipRecoveryChecklist? ──────────> [THROWN: WAIVER CẤM TUYỆT ĐỐI]
   │
   ├── BackupSnapshotId rỗng?
   │     ├── Non-Interactive ─────────────────> [THROWN: THIẾU THAM SỐ BẮT BUỘC]
   │     └── Interactive: Prompt trống ────────> [THROWN: DỪNG APPLY, KHÔNG CÓ WAIVER]
   │
   ├── Format BackupSnapshotId hợp lệ?
   │     └── Chứa dummy ('dummy', 'fake', <8) ─> [THROWN: ĐỊNH DẠNG HOẶC DUMMY KHÔNG HỢP LỆ]
   │
   └── Đã được PO xác minh (Ready trên Neon Console)?
         ├── Non-Interactive: Thiếu switch ────> [THROWN: DỪNG TẠI BACKUP_ID_RECORDED]
         ├── Interactive: PO không chọn 'y' ───> [THROWN: DỪNG TẠI BACKUP_ID_RECORDED]
         └── PO xác minh thành công ───────────> [PASS: BACKUP_VERIFIED] ──> Tiếp tục G3 & Apply
```

Không tồn tại bất kỳ ngã rẽ mã nguồn nào trả về `CanProceed = $true` cho `Mode Apply` nếu không đạt được trạng thái `BACKUP_VERIFIED`.

---

## 7. Thiết Kế Phân Biệt Hai Trạng Thái: Backup Recorded vs Backup Verified

Nhằm tuân thủ nguyên tắc trung thực của Database Reliability Engineering, hệ thống phân biệt tường minh:

1. **`BACKUP_ID_RECORDED` (Đã ghi nhận chuỗi nhận diện):**
   - **Định nghĩa:** Chuỗi định danh backup branch hoặc snapshot đã được người vận hành nhập hoặc truyền qua tham số, và đã vượt qua bộ lọc cấu trúc định dạng (`Test-BackupSnapshotFormat`).
   - **Giới hạn:** Hệ thống ghi nhận tên chuỗi nhưng **CHƯA KIỂM CHỨNG** được thực thể đó có thực sự tồn tại và sẵn sàng trên hạ tầng Neon hay không.
   - **Quyền hạn:** **KHÔNG ĐƯỢC PHÉP CHẠY APPLY**. Chỉ được phép sử dụng trong chế độ Preflight Dry-Run để kiểm tra tĩnh.
2. **`BACKUP_VERIFIED` (Đã kiểm chứng điểm phục hồi):**
   - **Định nghĩa:** Đã có bằng chứng đối chiếu xác nhận rằng:
     - Branch backup đã được tạo trên đúng project Neon E Vibe.
     - Branch được tạo từ đúng source branch `preview-beta`.
     - Trạng thái compute và storage của branch backup trên Neon Console đạt trạng thái `Ready`.
   - **Cơ chế xác minh:**
     - Trong môi trường hiện tại, để bảo mật tuyệt đối, **hệ thống không lưu trữ Neon Management API Key trong biến môi trường của repository**.
     - Do đó, bước xác minh được thực hiện thủ công thông qua checklist đối chiếu của Product Owner trên giao diện [Neon Console](https://console.neon.tech).
     - Bằng chứng xác minh được ghi nhận thông qua xác nhận trực tiếp của PO trên terminal (`y`) hoặc qua tham số minh thị `-BackupVerifiedByPO`.
   - **Ghi chú giới hạn ghi vào log:**
     `[GHI CHU GIOI HAN]: Xac minh duoc thuc hien thu cong qua PO checklist tren Neon Console do Neon API Key khong duoc luu tru tren moi truong de bao dam an toan tuyet doi.`

---

## 8. Kết Quả Bộ Kiểm Thử PowerShell (39/39 PASS)

Toàn bộ 39 bài kiểm thử hồi quy độc lập trong [`tests/unit/safe-preview-migrate.test.ps1`](file:///d:/TMĐT%20Website/nong-san-b2b/tests/unit/safe-preview-migrate.test.ps1) đã chạy thành công 100%:

```text
=================================================================
   BAT DAU CHAY 39 TEST CASES OFFLINE (EV-IMP-01B-G5-HOTFIX)     
   Current Real Git HEAD: 5b9812f545b6cd4eba25075c80876802b92992a4                              
=================================================================

[PASS] S1: Sai Git branch -> STOP
[PASS] S2: Sai ApprovedCommitSha -> STOP
[PASS] S3: Host Production da biet -> STOP
[PASS] S4: Host khong thuoc allowlist -> STOP
[PASS] S5: Host trung allowlist nhung pooled -> STOP
[PASS] S6: Connection string sai dinh dang -> STOP
[PASS] S7: Prisma status exit 1 do loi ket noi -> STOP
[PASS] S8: Prisma status exit 1 voi F01 singular -> EXPECTED_PENDING
[PASS] S9: Co hai migrations pending (plural) -> STOP
[PASS] S10: Migration Phase 8 baseline chua applied -> STOP
[PASS] S11: Migration F01 da applied -> NO-OP
[PASS] S12: G5 ghi nhan Backup Snapshot hop le va duoc PO xac minh (BACKUP_VERIFIED)
[PASS] S13: Nguoi dung khong xac nhan deploy -> STOP an toan
[PASS] S14: Deploy exit code khac 0 -> STOP
[PASS] S15: Post-check exit code khac 0 -> STOP
[PASS] S16: Moi gate PASS tren mock -> Preflight ONLY hoan tat khong goi deploy
[PASS] S17: Script bi gian doan / ket thuc -> DATABASE_URL duoc don sach
[PASS] S18: Expected host rong -> STOP
[PASS] S19: Tuong thich nguoc mock dang migration(s) -> EXPECTED_PENDING
[PASS] S20: State B: Authentication failed (P1000) -> STOP
[PASS] S21: State D: Failed migration in history -> STOP
[PASS] S22: State E: Divergent migration history -> STOP
[PASS] S23: State F: Database not managed by Prisma -> STOP
[PASS] S24: State H: Unrecognized status output -> STOP
[PASS] S25: Redaction Engine che giau 100% secrets va duong dan Windows
[PASS] S26: Read-only DB check hop le (baselines da applied, 0 failed) -> PASS
[PASS] S27: Read-only DB check phat hien failed migration -> STOP
[PASS] S28: Dual-Proof: DB lech thi Preflight phai STOP
[PASS] S29: SHA256 sai lech -> STOP (G4)
[PASS] S30: DDL chua DROP TABLE CASCADE -> STOP (G4)
[PASS] S31: Thieu ApprovedCommitSha -> STOP (G0)
[PASS] S32: G5 NonInteractive khong co backup ID -> STOP (G5)
[PASS] S33: G5 Co bypass/waiver (-SkipRecoveryChecklist) trong Apply -> STOP (G5)
[PASS] S34: G5 Backup ID gia mao hoac sai dinh dang ('dummy') -> STOP (G5)
[PASS] S35: G5 NonInteractive co ID nhung chua PO xac minh -> STOP (G5)
[PASS] S36: G5 Preflight khong co backup ID -> PASS read-only (PREFLIGHT_CHECKED)
[PASS] S37: G5 Preflight co backup ID nhung chua verify -> PASS (BACKUP_ID_RECORDED)
[PASS] S38: G5 Interactive Apply de trong backup ID -> STOP
[PASS] S39: G5 Interactive Apply nhap 'y' (thu bypass cu) -> STOP

=================================================================
   TONG KET BANG KET QUA KIEM THU OFFLINE (S1 - S39)             
=================================================================
TONG SO TEST: 39 | PASS: 39 | FAIL: 0
```

---

## 9. Kết Quả Các Quality Gates Toàn Hệ Thống

| Quality Gate | Lệnh thực thi | Kết quả | Chi tiết kiểm chứng |
| :--- | :--- | :--- | :--- |
| **PowerShell Syntax** | `[Parser]::ParseFile()` | **PASS** | 0 cú pháp lỗi trên cả 2 tệp script và test |
| **PowerShell Tests** | `safe-preview-migrate.test.ps1` | **PASS (39/39)** | 100% test cases đạt, bao phủ toàn bộ G0–G6 |
| **Prisma Validation** | `npx prisma validate` | **PASS** | Schema `prisma/schema.prisma` hợp lệ |
| **Vitest Unit Tests** | `npm test` | **PASS (546/546)** | 36 test files, 546/546 assertions passed |
| **ESLint Analysis** | `npm run lint` | **PASS** | 0 errors, 1 warning không liên quan |
| **TypeScript Check** | `npm run typecheck` | **PASS** | 0 errors trên toàn bộ codebase |
| **Turbopack Build** | `npm run build` | **PASS** | 13/13 static/dynamic routes build thành công |

---

## 10. Giải Thích Gốc Rễ Lỗi Next.js Build Lần Đầu (Root Cause Analysis)

### Nhật ký thực tế (Trích xuất từ log hệ thống):
```text
▲ Next.js 16.4.0 (Turbopack)
...
✓ Compiled successfully in 1232ms
  Finished TypeScript in 2.9s ...
✓ Generating static pages using 11 workers (13/13) in 184ms
  Finalizing page optimization ...

> Build error occurred
Error [SecurityFatalError]: Your version of Next.js is affected by a known security vulnerability.
**We strongly recommend you upgrade Next.js.**
This command stopped to show the upgrade recommendation. Retry the same command to continue the original task.
...
Reference: https://registry.npmjs.org/-/npm/v1/security/advisories/bulk
    at ignore-listed frames {
  exitCode: 1
}
```

### Phân tích nguyên nhân:
1. **Bản chất lỗi:** Đây **KHÔNG PHẢI** là lỗi mã nguồn ứng dụng, không phải lỗi biên dịch TypeScript, và không phải lỗi định cấu hình Turbopack hay Next.js.
2. **Cơ chế hoạt động:** Next.js phiên bản 16.4.0 tích hợp tính năng **Security Advisory Nudge** từ hệ sinh thái npm. Khi phát hiện phiên bản Next.js đang chạy có thông báo bảo mật trong cơ sở dữ liệu `npm security advisories`, lệnh build lần đầu trong một phiên làm việc sẽ chủ động ngắt tiến trình bằng ngoại lệ `SecurityFatalError` với mã lỗi `exit code 1` nhằm buộc lập trình viên chú ý đến khuyến nghị bảo mật.
3. **Phân biệt tính lặp lại:** Khi chạy lại lệnh `npm run build` ngay sau đó, Next.js nhận diện cờ ghi nhận và in thông báo:
   `⚠ Your version of Next.js is affected by a known security vulnerability. This command is continuing after the upgrade reminder.`
   Sau đó hoàn thành quá trình tối ưu và tạo trang với mã thành công `exit code 0`.
4. **Kết luận:** Đây là **cơ chế nhắc nhở bảo mật của framework (Security Advisory Interruption)** mang tính tạm thời trong phiên, hoàn toàn không phải lỗi hỏng build lặp lại (reproducible build defect).

---

## 11. Giải Thích Gốc Rễ Exit Code 1 Của Secrets Scan

Trong phiên làm việc trước, một số lệnh kiểm tra secrets trả về exit code 1. Qua kiểm tra nhật ký chi tiết:

1. **Lần 1 (Step 11138 & 11140):**
   - **Lệnh chạy:** Đoạn mã PowerShell nội tuyến phức tạp qua `powershell -Command "..."`.
   - **Lỗi thực tế:** `MissingVariableNameAfterForeach`, `MissingArgument`.
   - **Nguyên nhân:** Cú pháp chuỗi nhiều dòng bị PowerShell nội suy sai dấu nháy kép trên môi trường Windows CLI dẫn đến lỗi cú pháp phân tích mã (Parser Error). Lệnh thoát với mã 1 do **lỗi cú pháp script**, không phải do phát hiện bí mật.
2. **Lần 2 (Step 11168):**
   - **Lệnh chạy:** `git diff --cached | grep -iE "(api_key|password|secret|bearer|private_key)"`
   - **Lỗi thực tế:** `grep : The term 'grep' is not recognized as the name of a cmdlet... CommandNotFoundException`
   - **Nguyên nhân:** Lệnh `grep` là tiện ích Unix/Linux, không có sẵn trong môi trường mặc định của Windows PowerShell. Lệnh thoát với mã 1 do **CommandNotFoundException**.
3. **Lần 3 (Step 11169 - Lệnh chuẩn Windows PowerShell):**
   - **Lệnh chạy:** `git diff --cached | Select-String -Pattern "password|secret|bearer|private_key"`
   - **Kết quả:** Thoát với mã `0`. Kết quả đầu ra chỉ chứa các từ khóa trong tên biến khử trùng (`Redact-SensitiveText`) và chú thích kỹ thuật trong `safe-preview-migrate.ps1`. **Hoàn toàn không có mật khẩu, token, connection string hay private key thực tế nào tồn tại trong mã nguồn**.

---

## 12. Danh Mục Các Rủi Ro Còn Mở (Open Risks)

1. **Xác minh thủ công từ PO:** Do không tích hợp Neon Management API token vào mã nguồn, Gate G5 dựa trên việc PO đăng nhập vào [Neon Console](https://console.neon.tech) để kiểm tra branch backup thực sự tồn tại ở trạng thái `Ready`. Nếu PO nhập nhầm hoặc chưa tạo branch thật mà xác nhận `y`, hệ thống sẽ không có bản sao lưu vật lý thực sự.
2. **Nguy cơ nhầm lẫn Endpoint:** Khi chuyển sang branch backup để kiểm tra dữ liệu, Hostname kết nối của Neon sẽ thay đổi hoàn toàn (ví dụ: `ep-backup-pre-f01-....neon.tech`). Tuyệt đối không trỏ biến môi trường `DATABASE_URL` của môi trường Preview Vercel sang branch backup trừ khi có chỉ đạo khôi phục (Disaster Recovery).
3. **Khuyến nghị nâng cấp Next.js:** Thông báo nhắc nhở nâng cấp bảo mật của Next.js 16.4.0 vẫn sẽ hiển thị nhắc nhở cho đến khi thư viện được nâng cấp theo lộ trình riêng.

---

## 13. Hướng Dẫn Dành Cho Độc Lập QA (QA Re-test Checklist)

QA độc lập có thể kiểm chứng lại kết quả hotfix này bằng các bước hoàn toàn offline:

1. **Kiểm tra trạng thái Git:**
   - Chạy `git status`: Xác nhận chỉ có 2 file `safe-preview-migrate.ps1` và `safe-preview-migrate.test.ps1` bị sửa đổi, chưa được commit.
   - Chạy `git rev-parse HEAD`: Xác nhận vẫn ở `5b9812f545b6cd4eba25075c80876802b92992a4`.
2. **Chạy bộ kiểm thử PowerShell:**
   - Chạy lệnh:
     ```powershell
     powershell -ExecutionPolicy Bypass -File nong-san-b2b/tests/unit/safe-preview-migrate.test.ps1
     ```
   - Xác nhận: Toàn bộ 39 test cases (S1 đến S39) đều hiển thị `[PASS]`, tổng kết `PASS: 39 | FAIL: 0`.
3. **Kiểm tra Quality Gates:**
   - Chạy: `npx prisma validate` -> PASS.
   - Chạy: `npm test` -> 546/546 PASS.
   - Chạy: `npm run lint` -> 0 errors.
   - Chạy: `npm run typecheck` -> 0 errors.
   - Chạy: `npm run build` -> Hoàn tất thành công.
4. **Kiểm tra thủ công khả năng chống bypass:**
   - Thử gọi hàm:
     ```powershell
     . nong-san-b2b/scripts/safe-preview-migrate.ps1
     Test-RecoveryReadiness -Mode Apply -SkipPrompt:$true
     ```
   - Xác nhận ném lỗi: `Co bypass/waiver (-SkipRecoveryChecklist) bi CAM TUYET DOI trong che do Apply!`.

---

## 14. BẢNG CAM KẾT VÀ XÁC NHẬN AN TOÀN TUYỆT ĐỐI

Kỹ sư phụ trách xác nhận các cam kết an toàn đã được tuân thủ nghiêm ngặt:

- [x] **Xác nhận KHÔNG tạo bất kỳ commit mới nào trong nhiệm vụ này (ZERO-COMMIT).**
- [x] **Xác nhận KHÔNG push lên remote `origin/beta` hoặc bất kỳ remote nào.**
- [x] **Xác nhận KHÔNG kích hoạt deploy lên Vercel.**
- [x] **Xác nhận KHÔNG chạy migration Preflight hoặc Apply trên cơ sở dữ liệu Neon.**
- [x] **Xác nhận KHÔNG ghi bất kỳ dữ liệu hay DDL nào vào Neon.**
- [x] **Xác nhận KHÔNG chỉnh sửa Prisma Schema hoặc tệp migration SQL đã được QA nghiệm thu.**

---

**KẾT THÚC NHIỆM VỤ: DỪNG HOÀN TOÀN TẠI ĐÂY, SẴN SÀNG CHỜ QA ĐỘC LẬP TÁI KIỂM ĐỊNH.**
