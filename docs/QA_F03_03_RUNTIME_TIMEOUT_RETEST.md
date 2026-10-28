# QA_F03_03_RUNTIME_TIMEOUT_RETEST.md
## BÁO CÁO THẨM ĐỊNH ĐỘC LẬP BẢN HOTFIX P1 RUNTIME TIMEOUT — F03 GEMINI AI-1

- **Feature / Task ID:** `F03 — Gemini AI-1 Executive Assistant` (`EV-F03-AI01-HOTFIX-02`)
- **Sự cố khắc phục:** `F03-WORK-01 — P1 Timeout (15s)` ghi nhận tại `QA_WORK_F03_01_BETA_BROWSER_ACCEPTANCE.md`
- **QA Agent:** Independent Senior QA Engineer / Reliability & Security Auditor
- **Thời điểm kiểm định:** 28/10/2026, 10:25 (Asia/Ho_Chi_Minh)
- **Worktree kiểm thử:** [`D:\TDTU\wt_f03_gemini`](file:///D:/TDTU/wt_f03_gemini)
- **Branch kiểm thử:** `feature/f03-gemini-ai`
- **Pre-hotfix Beta Commit:** `30c83c0eedfae9f994c52c4e5671ae5438e2fbd5`
- **Target Hotfix Implementation SHA:** `2d8281aa76fceeccd695add663e6d2e5b095ad14`
- **Current Branch HEAD SHA:** `aaebc00a6085d5c06575db82c6df6b0526f9413a`

---

## I. QA-01 — Git Lineage & Source Diff Audit

### 1.1. Lịch sử Commit trên nhánh `feature/f03-gemini-ai`

Kiểm tra trực tiếp reflog tại `.git/logs/refs/heads/feature/f03-gemini-ai`:

| STT | Commit Full SHA | Tác giả | Thông điệp Commit | Phân loại |
| :---: | :--- | :--- | :--- | :--- |
| 7 | `42e4c38c8803b4941dee30fa0fda8b33d1a42c64` | Bao | `docs(ai): add security hardening report for F03 (EV-F03-AI01-HOTFIX)` | Hotfix 01 Baseline |
| 8 | `2d8281aa76fceeccd695add663e6d2e5b095ad14` | Bao | `fix(ai): resolve Beta runtime timeout with 35s ceiling, model re-prioritization and fallback retry (EV-F03-AI01-HOTFIX-02)` | **Hotfix 02 Implementation** |
| 9 | `aaebc00a6085d5c06575db82c6df6b0526f9413a` | Bao | `docs(ai): record Beta runtime timeout investigation and hotfix report for F03 (EV-F03-AI01-HOTFIX-02)` | **HEAD / Documentation** |

- **Xác nhận HEAD:** `aaebc00a6085d5c06575db82c6df6b0526f9413a`.
- **Working Tree:** Sạch (`working tree clean`), không có file uncommitted.

---

### 1.2. Danh sách tệp tin thay đổi thực tế (Source Diff)

So sánh giữa commit baseline `42e4c38` và `HEAD`:

1. [`nong-san-b2b/src/lib/gemini/client.ts`](file:///D:/TDTU/wt_f03_gemini/nong-san-b2b/src/lib/gemini/client.ts):
   - Nâng `DEFAULT_TIMEOUT_MS` từ `15000` (15s) lên `35000` (35s).
   - Đưa `gemini-3.5-flash-lite` và `gemini-3-flash-preview` lên đầu `PREFERRED_MODELS`.
   - Bổ sung bộ nhớ đệm `cachedVerification` với `CACHE_TTL_MS = 15 phút` (900.000ms) kèm hàm `clearModelVerificationCache()`.
   - Tách hàm phụ trợ `callGeminiGenerateContent()` và tích hợp cơ chế **Fallback Retry** tự động khi gặp `SERVICE_UNAVAILABLE` (HTTP 5xx).
   - Thêm nguyên tắc số 5 (Độ dài và trọng tâm: 150–250 từ) vào `DEFAULT_SYSTEM_INSTRUCTION` nhằm hạn chế token dư thừa.
2. [`nong-san-b2b/src/lib/gemini/types.ts`](file:///D:/TDTU/wt_f03_gemini/nong-san-b2b/src/lib/gemini/types.ts):
   - Bổ sung trường tùy chọn `model?: string` vào interface `AdminAiQueryPayload`.
3. [`nong-san-b2b/src/server/actions/admin-ai.ts`](file:///D:/TDTU/wt_f03_gemini/nong-san-b2b/src/server/actions/admin-ai.ts):
   - Tiếp nhận `payload?.model` và truyền vào `queryGemini({ ..., model: payload?.model })`.
4. [`nong-san-b2b/src/components/admin/admin-ai-assistant.tsx`](file:///D:/TDTU/wt_f03_gemini/nong-san-b2b/src/components/admin/admin-ai-assistant.tsx):
   - Truyền `model: status?.activeModel` khi gọi `queryAdminExecutiveAiAction`.
   - Chuẩn hóa dependency array `[inputQuery, isPending, status]` cho React Compiler.
5. [`nong-san-b2b/src/app/admin/bao-cao/page.tsx`](file:///D:/TDTU/wt_f03_gemini/nong-san-b2b/src/app/admin/bao-cao/page.tsx):
   - Khai báo cấu hình phân bổ thời lượng Serverless Function: `export const maxDuration = 60`.
6. [`nong-san-b2b/tests/unit/admin-ai.test.ts`](file:///D:/TDTU/wt_f03_gemini/nong-san-b2b/tests/unit/admin-ai.test.ts):
   - Bổ sung `clearModelVerificationCache()` vào `beforeEach`.
   - Thêm test `2.8 (RESILIENCE)` kiểm tra fallback khi gặp HTTP 5xx.
   - Thêm test `2.9` kiểm tra ưu tiên `gemini-3.5-flash-lite`.
7. [`docs/EV_F03_AI01_RUNTIME_TIMEOUT_HOTFIX_REPORT.md`](file:///D:/TDTU/wt_f03_gemini/docs/EV_F03_AI01_RUNTIME_TIMEOUT_HOTFIX_REPORT.md):
   - Báo cáo kỹ thuật chi tiết của DEV 1.

> [!NOTE]
> **Ranh giới an toàn:** Không có bất kỳ thay đổi nào liên quan đến logic F01 (FEFO/Pricing/Checkout), F02 (Khiếu nại hai chiều) hay F04 (Membership). Không có schema migration. Không có API Key thật nào bị commit vào Git.

---

## II. QA-02 — Đánh Giá Nguyên Nhân Gốc Rễ & Ngân Sách Thời Gian (Root Cause & Timeout)

### 2.1. Xác minh nguyên nhân gốc rễ (Root Cause Verification)
- **Thực tế tái hiện:** Khi người dùng quản trị đặt các câu hỏi nghiệp vụ sâu về doanh thu hoặc tồn kho FEFO, ngữ cảnh kèm theo gồm báo cáo 30 ngày, KPI hôm nay và 20 lô hàng FEFO (~2.000 tokens). Google Gemini cần từ 10 đến 22 giây để xử lý logic, tính toán tỷ lệ hao hụt và sinh văn bản phân tích có cấu trúc.
- Ngưỡng cũ `DEFAULT_TIMEOUT_MS = 15000` (15 giây) của `AbortController` đã ngắt kết nối quá sớm khi máy chủ Google vẫn đang phản hồi bình thường.
- Kết luận: **Nguyên nhân gốc rễ DEV 1 xác định là hoàn toàn chính xác và có căn cứ thực nghiệm.**

### 2.2. Kiểm tra `AbortController` và Ngân sách Thời gian (Time Budget)
- **Trần Timeout mới:** `35.000ms` (35 giây) cho mỗi lần gọi `callGeminiGenerateContent`.
- **Cơ chế ngắt kết nối an toàn:** Sử dụng `const controller = new AbortController()`, kích hoạt qua `setTimeout(() => controller.abort(), timeoutMs)` và xóa bỏ qua `clearTimeout(timeoutId)` ngay khi nhận phản hồi.
- **Tổng ngân sách thời gian khi có Fallback:**
  - Nếu lần gọi 1 bị `AbortError` (quá hạn 35s) $\rightarrow$ `initialResult.errorType = 'TIMEOUT_OR_NETWORK'`.
  - Tại dòng 392 của `client.ts`: `const isRetryable = initialResult.errorType === 'SERVICE_UNAVAILABLE'`.
  - $\rightarrow$ **Khi đã timeout 35s, hệ thống KHÔNG retry tiếp.** Lệnh dừng lại ngay lập tức và trả thông điệp tiếng Việt: *"Yêu cầu Gemini API bị quá hạn thời gian xử lý (35s). Vui lòng thử lại câu hỏi ngắn hơn."*
  - Nếu lần gọi 1 trả về HTTP 5xx (thường phản hồi rất nhanh, dưới 2s), hệ thống mới kích hoạt fallback sang model thứ hai với trần 35s tiếp theo. Tổng thời gian tối đa: $2\text{s} + 35\text{s} \approx 37\text{s}$, an toàn nằm trong trần 60s của Serverless Function.
- **Đánh giá cấu hình Vercel `maxDuration = 60`:**
  Khai báo `export const maxDuration = 60` tại `src/app/admin/bao-cao/page.tsx` tuân thủ đúng chuẩn Next.js App Router Route Segment Config. Tuy nhiên, do chưa deploy lên Vercel:
  > **`VERCEL MAX DURATION UNVERIFIED`** *(Cần xác minh thời lượng thực tế trên Vercel Beta sau khi deploy)*.

---

## III. QA-03 — Lựa Chọn Mô Hình, Bộ Nhớ Đệm & An Toàn Tham Số (Model Selection & Security)

### 3.1. Thứ tự ưu tiên mô hình (`PREFERRED_MODELS`)
Danh sách ưu tiên mới tại dòng 20–28 của `src/lib/gemini/client.ts`:
1. `gemini-3.5-flash-lite` (Ưu tiên số 1: Tốc độ phản hồi nhanh ~8–12.8s, độ ổn định cao)
2. `gemini-3-flash-preview` (Dự phòng số 2)
3. `gemini-3.1-flash-lite` (Dự phòng số 3: Từng bị lỗi quá tải/500 trên Google Cloud)
4. `gemini-3.5-flash` / `gemini-3.8-flash` / `gemini-2.5-flash` / `gemini-1.5-flash`

### 3.2. Đánh giá Bộ nhớ đệm Model (In-Memory Cache)
- Cache lưu kết quả `ModelVerificationResult` trong biến `cachedVerification` ở bộ nhớ Node.js runtime với thời hạn 15 phút (`CACHE_TTL_MS = 15 * 60 * 1000`).
- **An toàn bảo mật:** Cache **CHỈ** lưu tên model khả dụng và trạng thái `ok: true`, tuyệt đối **KHÔNG** lưu trữ hay để lộ `GEMINI_API_KEY`.
- Giúp loại bỏ hoàn toàn cuộc gọi `GET /v1beta/models` dư thừa trước mỗi câu hỏi của Admin.

### 3.3. Cơ chế Fallback Retry (OBS-04)
- Khi model chính trả về mã lỗi HTTP $\ge 500$, `callGeminiGenerateContent` gán `errorType: 'SERVICE_UNAVAILABLE'`.
- Hàm `queryGemini` tự động tìm model kế tiếp trong `PREFERRED_MODELS` (khác model vừa gọi) và thực hiện đúng **1 lần thử lại duy nhất** (single retry).
- Không có vòng lặp vô hạn (Zero Infinite Loop). Không che lỗi bằng mock data.

### 3.4. Kiểm tra An toàn Tham số `payload.model` (Security Audit)
Client gửi `model: status?.activeModel` lên Server Action `queryAdminExecutiveAiAction`. QA tiến hành phân tích các nguy cơ tiềm ẩn:
1. **Bảo vệ Phân quyền (RBAC):** Server Action bắt buộc `await requireAdmin()` ngay tại dòng 69. Người dùng không phải Admin đều bị chặn cứng, không thể lợi dụng tham số này.
2. **Ngăn chặn URL / Header Injection:** Tại `client.ts` dòng 236:
   `const url = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent``
   Hàm `encodeURIComponent(model)` triệt tiêu hoàn toàn nguy cơ path traversal hoặc injection ký tự lạ vào URL.
3. **Phản hồi từ Google API khi truyền model lạ:** Nếu truyền model không tồn tại hoặc không được cấp phép, Google API trả về HTTP 404/403 $\rightarrow$ được map an toàn về `MODEL_ACCESS_DENIED`, không làm sập server hay lộ dữ liệu nội bộ.
4. **Khuyến nghị bổ sung (P3):** Để tuân thủ nguyên tắc phòng thủ theo chiều sâu (Defense-in-Depth), khuyến nghị DEV 1 bổ sung một kiểm tra danh sách trắng (allowlist check) nhỏ ở tầng Server Action trong các đợt refactor sau:
   `if (model && !PREFERRED_MODELS.includes(model)) modelToUse = defaultModel;`

---

## IV. QA-04 — Bằng Chứng Gọi API Thật (Live API Evidence)

Đối chiếu với bằng chứng thực nghiệm của DEV 1 trong báo cáo `EV_F03_AI01_RUNTIME_TIMEOUT_HOTFIX_REPORT.md`:
- **Model thực tế:** `gemini-3.5-flash-lite`.
- **Thời gian phản hồi:** **12.798ms (~12,8 giây)** $\rightarrow$ Đã giảm đáng kể so với ngưỡng timeout cũ 15s và nằm an toàn trong trần mới 35s.
- **Nội dung câu trả lời:** Nhận diện đúng cấu trúc FEFO, phân tích lô hàng cận date, định dạng tiền tệ VND chính xác.
- **Lưu ý quan trọng về tính xác thực của dữ liệu:**
  Số liệu trong bài test của DEV 1 (1.500 kg vật lý, 1.300 kg khả dụng, 200 kg giữ chỗ, 12 lô hàng) **KHÔNG PHẢI** là dữ liệu thực tế từ cơ sở dữ liệu Neon Beta (vốn có 1.858 kg vật lý, 1.850 kg khả dụng, 0 kg giữ chỗ, 20 lô hàng).
  $\rightarrow$ Đây là **bộ dữ liệu mô phỏng (Synthetic Context Fixture)** được truyền vào `buildExecutiveContext()` để kiểm tra độ trễ và khả năng suy luận của `gemini-3.5-flash-lite`.
  $\rightarrow$ **Kết luận:** Bài test chứng minh `gemini-3.5-flash-lite` đã giải quyết được vấn đề tốc độ phản hồi và prompt súc tích, nhưng **chưa phải là Full End-to-End Live Browser Acceptance trên Neon Beta**.

---

## V. QA-05 — Bộ Kiểm Thử Đơn Vị & Hồi Quy (Test & Regression)

1. **Bộ test AI chuyên biệt ([`tests/unit/admin-ai.test.ts`](file:///D:/TDTU/wt_f03_gemini/nong-san-b2b/tests/unit/admin-ai.test.ts)):**
   - Đạt **18/18 test cases PASS (100%)**:
     - Tests 1.1 – 1.4: Khử định danh PII và tạo ngữ cảnh facts.
     - Tests 2.1 – 2.5: Phát hiện thiếu key, HTTP 429, HTTP 400/403.
     - Test 2.6 – 2.7: URL sạch không chứa key, truyền qua header `x-goog-api-key`.
     - Test 2.8: **Fallback retry** khi model chính bị HTTP 500 (OBS-04).
     - Test 2.9: **Ưu tiên `gemini-3.5-flash-lite`** so với `gemini-3.1-flash-lite`.
     - Tests 3.1 – 3.5: Phân quyền `requireAdmin()`, kiểm tra độ dài câu hỏi, kiểm tra status action.
2. **Bộ test hồi quy toàn dự án:**
   - Đạt **715/715 test cases PASS** trên 47 test files (theo báo cáo DEV 1).
3. **Chất lượng mã nguồn:**
   - `npm run typecheck` (`tsc --noEmit`): **PASS (0 errors)**.
   - `npm run lint`: **PASS (0 errors)**, đã dọn dẹp cảnh báo React Compiler.
   - `npm run build`: **PASS**.

---

## VI. Bảng Tổng Hợp Vấn Đề (Outstanding Issues)

| ID | Mức độ | Hạng mục | Mô tả hiện trạng | Đánh giá & Khuyến nghị |
| :---: | :---: | :--- | :--- | :--- |
| **F03-WORK-01** | **P1** | Runtime Timeout | Lỗi quá hạn 15 giây trên Vercel Beta khiến widget AI không trả về câu trả lời. | **ĐÃ KHẮC PHỤC HOÀN TOÀN TRÊN MÃ NGUỒN (RESOLVED)** qua trần 35s, model 3.5-flash-lite và prompt tuning. |
| **OBS-04** | **P3** | Model Fallback | Thiếu cơ chế tự động chuyển model dự phòng khi máy chủ Google bị lỗi 5xx. | **ĐÃ GIẢI QUYẾT (RESOLVED)** tại test 2.8 và hàm `queryGemini`. |
| **OBS-06** | **P3** | Server Defense | Server Action `queryAdminExecutiveAiAction` chưa kiểm tra `payload?.model` qua danh sách trắng tĩnh (`ALLOWED_MODELS`). | Không phải lỗ hổng (do đã có `requireAdmin()`, `encodeURIComponent` và Google validate), nhưng khuyến nghị bổ sung allowlist ở đợt refactor tiếp theo. |
| **OBS-07** | **P2** | Runtime Verification | Cấu hình `maxDuration = 60` và hiệu năng thực tế trên Vercel Beta cần được kiểm chứng qua Live Browser Acceptance. | Ghi nhận trạng thái: `VERCEL MAX DURATION UNVERIFIED`. |

---

## VII. Kết Luận QA (QA Verdict)

# **`QA PASS — READY FOR BETA HOTFIX INTEGRATION`**

- **Commit Full SHA đã kiểm định:**
  - Hotfix Implementation: `2d8281aa76fceeccd695add663e6d2e5b095ad14`
  - Current Worktree HEAD: `aaebc00a6085d5c06575db82c6df6b0526f9413a`
- **Phạm vi xác nhận:**
  - 100% mã nguồn F03 AI-1 đáp ứng đúng tiêu chuẩn kỹ thuật, bảo mật và độ ổn định.
  - Không còn bất kỳ lỗi P0 hoặc P1 nào tồn tại trong phạm vi mã nguồn hotfix.
  - Khắc phục triệt để lỗi timeout 15s bằng trần 35s và tối ưu hóa thời gian suy luận của Gemini (~12.8s).
- **Lưu ý:** Báo cáo này chứng nhận chất lượng mã nguồn độc lập (**Source & Unit Quality Gate PASS**), không tự ý tuyên bố Browser Acceptance PASS khi chưa có kết quả kiểm thử thực tế trên Vercel Beta sau khi deploy.

---

## VIII. Kế Hoạch Tích Hợp Beta Dành Cho Release Integrator (Next Actions)

1. **Quy trình Merge:**
   - Chuyển sang nhánh `beta` tại thư mục làm việc chính [`D:\TDTU\TMĐT Website`](file:///D:/TDTU/TMĐT%20Website).
   - Thực hiện merge commit `aaebc00a6085d5c06575db82c6df6b0526f9413a` từ nhánh `feature/f03-gemini-ai`.
   - Kiểm tra working tree đảm bảo sạch sẽ.
2. **Lưu trữ tài liệu:**
   - Lưu báo cáo này vào [`D:\TDTU\TMĐT Website\docs\QA_F03_03_RUNTIME_TIMEOUT_RETEST.md`](file:///D:/TDTU/TMĐT%20Website/docs/QA_F03_03_RUNTIME_TIMEOUT_RETEST.md).
3. **Triển khai & Kiểm thử lại trên Beta (Post-Deploy Verification):**
   - Push commit merge lên `origin/beta` để kích hoạt Vercel Deployment.
   - Sau khi Vercel build thành công, bàn giao cho QA Browser Agent thực hiện **QA-WORK-F03-02 (Beta Browser Acceptance)**:
     - Thử nghiệm lại Q1 (Doanh thu 30 ngày) và Q2 (Tồn kho FEFO).
     - Xác nhận câu trả lời hiển thị trọn vẹn trong vòng 10–15 giây và không còn xuất hiện lỗi timeout 15s.

---
*Báo cáo được lập độc lập bởi Senior QA Engineer. Nhiệm vụ kiểm thử hoàn tất.*