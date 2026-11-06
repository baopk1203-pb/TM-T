# QA-F04-02 — TARGETED EVIDENCE CLOSURE
## E VIBE — F04 MEMBERSHIP & QUARTERLY KPI

**Agent:** Antigravity Independent QA  
**Người điều phối:** ChatGPT 1 — Main Coordinator; ChatGPT 2 — F04 Coordinator  
**TRẠNG THÁI:** `PROMPT PREPARED — EXECUTION NOT YET AUTHORIZED`  
**Loại tài liệu:** `DRAFT / FILE CREATED IN CHAT SANDBOX — NOT COMMITTED TO PROJECT GIT`

> **KHÔNG CHẠY PROMPT NÀY CHO ĐẾN KHI MAIN COORDINATOR PHÁT LỆNH `QA-F04-02 EXECUTION AUTHORIZED` VÀ RI XÁC NHẬN MÔI TRƯỜNG.**

## 1. Phạm vi và mục tiêu

QA-F04-01 đã hoàn tất với verdict **`QA_PARTIAL / BLOCKED`**, không phát hiện P0/P1 trong source review nhưng còn thiếu independent execution và DB evidence. Nhiệm vụ này **không** test lại toàn bộ tính năng, mà chỉ đóng các gap:

- `GAP-TEST-01`: QA thực thi targeted tests/typecheck/lint.
- `GAP-BUILD-01`: QA xác minh production build.
- `GAP-DB-01`: Prisma/PostgreSQL schema/runtime compatibility.
- `GAP-CONCUR-01`: Checkout/FEFO rollback & race, Quarterly Evaluation concurrency/idempotency.
- `GAP-F02-01`: F02/F04 financial contract review; integration `UNVERIFIED` nếu chưa có bản kết hợp hợp lệ.
- `GAP-UI-01`: Browser E2E để dành cho vòng được cấp quyền riêng, **không tự deploy**.

Không sửa source code, schema, migration, package scripts, dependencies hoặc cấu hình để ép test PASS.

## 2. Git/Document pre-flight

**F04 source worktree:** `C:\Users\epicg\.gemini\antigravity\worktrees\TMĐT Website\f04_membership_bootstrap_readiness`  
**Branch:** `f04_membership_bootstrap_readiness`  
**QA target SHA:** `486bcc16c91aada2bbf6d82c0ea420fc269e4779`  
**Latest code commit:** `0c48d4ad74716eedd7ccc5b738face7faa70b4e9`.

1. Kiểm tra Main Coordinator đã cấp phép QA-F04-02 và slot QA thực sự rảnh; nếu chưa, `BLOCKED — NOT AUTHORIZED`, dừng.
2. Xác nhận RI cung cấp build environment và/hoặc isolated PostgreSQL test environment; chỉ chạy test nào có điều kiện an toàn.
3. Ghi worktree QA, branch, exact tested HEAD, commit ancestry và Git status. Nếu khác SHA mục tiêu: `BLOCKED — SHA MISMATCH`, không tự chuyển branch/reset/cherry-pick.
4. Đọc `docs/EV_F04_PO_DECISION_01_LEGACY_MEMBERSHIP_POLICY.md`, `docs/EV_F04_QA_ACCEPTANCE_MATRIX_PO01_UPDATED.md`, `docs/EV_F04_06B_CRITICAL_RECONCILIATION_REPORT.md` và báo cáo `EV_F04_INDEPENDENT_QA_REPORT.md` (bản được RI lưu nếu có).
5. Nếu môi trường test/build không truy cập được bản SHA chuẩn, không báo PASS trên snapshot khác.

## 3. Independent targeted execution

Trong thư mục app `nong-san-b2b`, trước hết xem `package.json` và cách chạy test được cấu hình. Nếu dependencies đã sẵn sàng, chạy những lệnh phù hợp dưới đây mà không chỉnh sửa source:

```bash
npx vitest run tests/unit/membership.test.ts tests/unit/membership-kpi.test.ts tests/unit/membership-evaluation.test.ts tests/unit/membership-dashboard.test.ts tests/unit/membership-integration.test.ts
npm run typecheck
npm run lint
```

Đối với production build, kiểm tra script có thực trong `package.json` rồi mới chạy (thông thường `npm run build`); không chạy nếu build đòi thao tác bên ngoài hoặc ghi vào database thật. Chỉ chạy full unit regression (`npx vitest run tests/unit`) nếu môi trường cho phép và giúp khẳng định không có hồi quy; không bắt buộc chạy lại nếu thiếu dependencies.

Lưu output thực tế, số test pass/fail, thời gian, môi trường và exit code. Không sử dụng `756/756 DEV PASS` như bằng chứng QA.

## 4. PostgreSQL riêng và migration compatibility

Chỉ thực hiện khi RI cung cấp **database test F04 cô lập**, schema đã được RI chuẩn bị, kết nối rõ ràng không trỏ Neon Beta/Production và quyền test đã được cấp.

- Xác minh Prisma Client và runtime queries trên `User`, `Order`, `MembershipEvaluationLog` khớp schema F04.
- Kiểm tra unique `(userId, evaluationQuarter)`.
- Legacy B2B `role=CUSTOMER`, `membershipTier=null`: server resolve BRONZE, Pricing 2%, Shipping 5% từ 50kg cap 100.000, Dashboard hiển thị Đồng; **DB tier vẫn null** sau các thao tác chỉ đọc/tính giá.
- Admin/Staff tier null không được nhận quyền lợi; các hạng khác không bị reset.
- Đảm bảo checkout snapshot đúng và quy tắc cap 10%.

Không tự tạo/chạy migration; không thay đổi schema để test PASS. Nếu RI chưa chuẩn bị database: `POSTGRESQL NOT RUN / GAP-DB-01 OPEN`.

## 5. Transaction và concurrency

Nếu được cấp phép test ghi dữ liệu trên isolated DB, dùng fixtures test do RI chuẩn bị, chạy có kiểm soát:

1. **Checkout rollback:** cố ý tạo tình huống checkout fail, xác nhận tồn kho/reservations/Order/OrderEvent không ghi dở dang.
2. **Checkout FEFO race:** hai request đồng thời tranh cùng batch tồn giới hạn; kiểm tra không oversell, reservation và tồn sau test nhất quán.
3. **Quarterly idempotency:** hai lần xét cùng user/quý, kể cả song song, chỉ một log cho `(userId,evaluationQuarter)`; không lên/xuống hạng hai lần.
4. **Stale quarter:** không ghi đè tier kỳ mới bằng kết quả kỳ cũ.

Giới hạn tải nhỏ phù hợp demo học thuật; không stress test Neon, không kích hoạt scheduler.

Nếu chỉ kiểm tra static transaction hoặc mocks: ghi `SOURCE REVIEW ONLY — DB CONCURRENCY UNVERIFIED`.

## 6. Financial compatibility F02/F04

Đối chiếu read-only contract: `finalTotal`, `total`, `refundCompensation`, complaint states, eligible order status `COMPLETED`, exclusion of pending/open complaint; không được double-subtract hoặc cộng doanh thu chưa hợp lệ. Không tự merge F02 và F04.

Nếu chưa có bản kết hợp hợp lệ và test data đã cấp quyền: ghi `UNVERIFIED — F02 INTEGRATION DEPENDENCY` cho end-to-end cross-feature, không gắn PASS giả.

## 7. Browser E2E

Không tự triển khai Preview/Beta. Sử dụng `EV_F04_QA02_BROWSER_CHECKLIST_AND_GAP_TRACKER.md` làm danh sách chuẩn bị cho vòng Browser QA riêng khi được Main Coordinator cấp quyền trên môi trường hợp lệ đã deploy đúng commit. `GAP-UI-01` được giữ `NOT RUN` nếu chưa có môi trường.

## 8. Evidence matrix & bug severity

Sử dụng `EV_F04_QA02_POSTGRES_SCENARIOS_AND_TEST_DATA.md` và gap tracker.

Với mỗi bước: `PASS`, `FAIL`, `NOT RUN`, `UNVERIFIED` hoặc `BLOCKED`; mô tả command, actual output, expected, exact SHA và loại bằng chứng (unit/runtime/DB). Ghi bugs P0/P1/P2/P3 kèm reproduction, expected/actual, impacted files, severity, phạm vi ảnh hưởng.

Không tự sửa bug, không tự giao DEV hotfix.

## 9. Báo cáo bắt buộc

Sau khi **được cấp phép chạy QA-F04-02**, tạo file Markdown thực tế trong khu vực QA được phép:

`docs/EV_F04_QA02_TARGETED_EVIDENCE_CLOSURE_REPORT.md`

Nội dung: Feature/Task ID, agent, worktree/branch, tested SHA, authorization, environment setup, commands/outputs, targeted tests, build, schema/runtime, Legacy Bronze L1–L6 runtime, FEFO checkout concurrency/rollback, quarterly idempotency, F02 contract, Browser deferred, gap tracker trước/sau, bugs severity, verdict và next action.

Nếu quy định QA worktree không cho phép ghi file, ghi `REPORT FILE NOT CREATED` và xuất **toàn bộ** nội dung Markdown để RI lưu documentation-only; không ghi vào worktree DEV hay shared repo.

**Không tự nâng F04 lên `QA_PASSED`/`READY FOR INTEGRATION` chỉ vì một phần test PASS.** Kết luận `QA_PASSED`, `QA_PARTIAL / BLOCKED`, hoặc `QA_FAILED` phải theo các cổng nghiệm thu và bằng chứng thực tế; Main Coordinator vẫn quyết định release/integration.

## 10. Lệnh cấm

Không tự merge/push/deploy Beta/Production; không migration Neon; không ghi Beta/Production; không kích hoạt cron; không sửa source/schema; không tự tạo workflow phức tạp; không báo cáo giả PASS; không thay đổi lịch QA chung.

**END — QA-F04-02 (PREPARED ONLY; NOT AUTHORIZED TO EXECUTE)**
