# QA-F03-02 — FOCUSED SECURITY HOTFIX RETEST REPORT

- **Feature / Task ID:** `F03 — Gemini AI-1 Executive Assistant` (`EV-F03-AI01-HOTFIX`)
- **QA Agent:** Independent Senior QA Engineer / Security & Data Auditor
- **Worktree:** [`D:\TDTU\wt_f03_gemini`](file:///D:/TDTU/wt_f03_gemini)
- **Branch:** `feature/f03-gemini-ai`
- **Prior Audited Baseline SHA:** `fa7dcbe45ee0f8f1a500a1c43fa9aaa1ccbba66a` (Kết luận: `QA PASS — READY FOR INTEGRATION REVIEW`)
- **Target Hotfix Implementation Commit:** `a3c7a2204259ded2adabda9ef51c7e0b0a10890b`
- **Current Branch HEAD Commit:** `42e4c38c8803b4941dee30fa0fda8b33d1a42c64`
- **Thời gian thẩm định:** 27/10/2026, 21:45 (Asia/Ho_Chi_Minh)

---

## 1. Git Lineage & Commit Diff Audit

### 1.1. Xác minh Lịch sử Commit (Commit History Verification)

Kiểm tra trực tiếp tệp ref và log tại `.git/logs/refs/heads/feature/f03-gemini-ai`:

| Thứ tự | Commit SHA | Tác giả | Commit Message | Phân loại | Trạng thái QA |
| :---: | :--- | :--- | :--- | :--- | :---: |
| 5 | `fa7dcbe45ee0f8f1a500a1c43fa9aaa1ccbba66a` | Bao | `docs(ai): record live API validation report for F03 (EV-IMP-03-AI-01-LIVE)` | Prior QA Baseline | **VERIFIED** |
| 6 | `a3c7a2204259ded2adabda9ef51c7e0b0a10890b` | Bao | `fix(ai): transmit Gemini API key via x-goog-api-key HTTP header instead of URL parameter (EV-F03-AI01-HOTFIX)` | Security Hotfix Source | **VERIFIED** |
| 7 | `42e4c38c8803b4941dee30fa0fda8b33d1a42c64` | Bao | `docs(ai): add security hardening report for F03 (EV-F03-AI01-HOTFIX)` | Hotfix Documentation | **HEAD VERIFIED** |

- **HEAD hiện tại:** `42e4c38c8803b4941dee30fa0fda8b33d1a42c64`
- **Working Tree:** Sạch (clean), 100% committed, không có file ngoài luồng.
- **Remote Origin:** Chưa push, chưa merge vào `beta`.

---

### 1.2. Kiểm tra Diff Thực tế Giữa Hai Commit (`fa7dcbe` $\rightarrow$ `HEAD`)

Kiểm tra trực tiếp các tệp tin thay đổi trong phạm vi hotfix:

#### A. [`nong-san-b2b/src/lib/gemini/client.ts`](file:///D:/TDTU/wt_f03_gemini/nong-san-b2b/src/lib/gemini/client.ts) (2 điểm thay đổi)
1. **Model Discovery (`verifyGeminiModelAccess`, Dòng 59–66):**
   - *Trước:* `fetch(`${GEMINI_API_BASE_URL}/models?key=${encodeURIComponent(apiKey)}`, ...)`
   - *Sau:* 
     ```ts
     const res = await fetch(`${GEMINI_API_BASE_URL}/models`, {
       method: 'GET',
       headers: {
         'Accept': 'application/json',
         'x-goog-api-key': apiKey,
       },
       signal: controller.signal,
     })
     ```
   - *Đánh giá:* **Loại bỏ 100% query string `?key=...`. Chuyển sang HTTP Header `x-goog-api-key`.**

2. **Content Generation (`queryGemini`, Dòng 236–246):**
   - *Trước:* `const url = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(modelToUse)}:generateContent?key=${encodeURIComponent(apiKey)}``
   - *Sau:*
     ```ts
     const url = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(modelToUse)}:generateContent`
     const res = await fetch(url, {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         'Accept': 'application/json',
         'x-goog-api-key': apiKey,
       },
       body: JSON.stringify(requestBody),
       signal: controller.signal,
     })
     ```
   - *Đánh giá:* **Loại bỏ 100% query string `?key=...`. Chuyển sang HTTP Header `x-goog-api-key`.**

#### B. [`nong-san-b2b/tests/unit/admin-ai.test.ts`](file:///D:/TDTU/wt_f03_gemini/nong-san-b2b/tests/unit/admin-ai.test.ts)
- Bổ sung bài test bảo mật chuyên biệt `2.7 (SECURITY) should transmit API key via x-goog-api-key header and never in URL query parameter` (Dòng 308–354).
- Cập nhật các assertions trong tests `2.3`, `2.6`, `3.4`, `3.5` để kiểm tra `expect(url).not.toContain('key=')` và `expect(headers['x-goog-api-key']).toBe(...)`.

#### C. [`docs/EV_F03_AI01_SECURITY_HOTFIX_REPORT.md`](file:///D:/TDTU/wt_f03_gemini/docs/EV_F03_AI01_SECURITY_HOTFIX_REPORT.md)
- Báo cáo kỹ thuật chi tiết của DEV 1 ghi lại kết quả live test và quality gates.

> [!NOTE]
> **Xác nhận phạm vi diff:** Chỉ có đúng **3 tệp tin** trên xuất hiện trong diff giữa `fa7dcbe` và `HEAD`. Không có bất kỳ tệp tin nào ngoài phạm vi F03 bị tác động.

---

## 2. Kết Quả Kiểm Thử Chi Tiết 4 Hạng Mục

### QA-01 — API Key Security (An Toàn Khóa API)
1. **Model Discovery URL:** `GET https://generativelanguage.googleapis.com/v1beta/models` $\rightarrow$ **Sạch 100%, không chứa API Key.**
2. **GenerateContent URL:** `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` $\rightarrow$ **Sạch 100%, không chứa API Key.**
3. **HTTP Header chuẩn Google:** Cả 2 luồng đều gửi qua header `x-goog-api-key: <apiKey>` theo đúng tài liệu chính thức Google Generative Language API.
4. **Không rò rỉ qua Logs/Client:**
   - Client Component ([`admin-ai-assistant.tsx`](file:///D:/TDTU/wt_f03_gemini/nong-san-b2b/src/components/admin/admin-ai-assistant.tsx)) chỉ nhận `GeminiQueryResult` gồm văn bản phản hồi và metadata (model, timestamp), hoàn toàn không chứa API key.
   - Không có lệnh `console.log(apiKey)` nào trong toàn bộ mã nguồn.
5. **Git Ignore `.env.local`:** Đã xác minh `.env*.local` nằm tại dòng 34 của [`nong-san-b2b/.gitignore`](file:///D:/TDTU/wt_f03_gemini/nong-san-b2b/.gitignore#L34).
6. **Không hardcode Secret Key:** Quét toàn bộ repository xác nhận không có API key thật nào của PO bị lọt vào commit hay markdown reports.
7. **Phạm vi bảo mật:** **ĐẠT CHUẨN HOÀN TOÀN (100% PASS).**

---

### QA-02 — Unit Tests Rigor (Độ Chặt Chẽ Của Bộ Test)
Kiểm tra trực tiếp các assertions mới trong [`tests/unit/admin-ai.test.ts`](file:///D:/TDTU/wt_f03_gemini/nong-san-b2b/tests/unit/admin-ai.test.ts):
- **Test 2.3:**
  ```ts
  expect(calledUrl).not.toContain('key=')
  expect(mockFetch).toHaveBeenCalledWith(
    'https://generativelanguage.googleapis.com/v1beta/models',
    expect.objectContaining({
      headers: expect.objectContaining({ 'x-goog-api-key': 'test-valid-key' })
    })
  )
  ```
- **Test 2.6:**
  ```ts
  expect(calledUrl).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
  expect(calledUrl).not.toContain('key=')
  expect((calledOptions.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key')
  ```
- **Test 2.7 (Dedicated Security Test):**
  Kiểm tra độc lập cả `verifyGeminiModelAccess` và `queryGemini` với khóa bí mật giả định `secret-test-key-123` và `secret-test-key-456`:
  - Khẳng định URL đích không chứa chuỗi `key=`.
  - Khẳng định URL đích không chứa giá trị khóa bí mật.
  - Khẳng định header `x-goog-api-key` chứa chính xác giá trị khóa bí mật.
- **Test 3.4 & 3.5 (Server Action Integration Mocks):**
  - Khẳng định mock fetch bắt buộc `expect(url).not.toContain('key=')` và `expect(headers['x-goog-api-key']).toBe('test-valid-key')`.
- **Đánh giá:** Không có hiện tượng mock lỏng lẻo hay false-pass. Bộ test xác nhận chính xác hành vi bảo mật mới.

---

### QA-03 — Live API Evidence (Đối Chiếu Bằng Chứng Gọi API Thật)
Đối chiếu báo cáo [`EV_F03_AI01_SECURITY_HOTFIX_REPORT.md`](file:///D:/TDTU/wt_f03_gemini/docs/EV_F03_AI01_SECURITY_HOTFIX_REPORT.md):
- **Thăm dò mô hình (Live Model Discovery):**
  - Gửi request `GET /v1beta/models` với header `'x-goog-api-key': '***'`.
  - Kết quả: **HTTP 200 OK**, trả về 46 mô hình, nhận diện chính xác `gemini-3.1-flash-lite`.
- **Sinh nội dung (Live generateContent):**
  - Gửi request `POST /v1beta/models/gemini-3.1-flash-lite:generateContent` với header `'x-goog-api-key': '***'`.
  - URL hoàn toàn không chứa query string.
  - Kết quả: **HTTP 200 OK**, nội dung trả về chuẩn xác theo ngữ cảnh.
- **Đánh giá:** Google Generative Language API chấp nhận 100% phương thức xác thực qua Header `x-goog-api-key`. Không phát sinh lỗi xác thực. Bằng chứng đầy đủ, không cần lặp lại request làm hao phí hạn ngạch API của dự án.

---

### QA-04 — Regression Scope (Phạm Vi Không Bị Ảnh Hưởng)
Xác nhận hotfix tuyệt đối **không làm thay đổi hay gây ảnh hưởng hồi quy** đến:
- Phân quyền Quản trị viên (`requireAdmin()` trong `src/server/actions/admin-ai.ts` giữ nguyên).
- Bộ lọc khử định danh PII ([`src/lib/gemini/context.ts`](file:///D:/TDTU/wt_f03_gemini/nong-san-b2b/src/lib/gemini/context.ts) giữ nguyên).
- Định dạng dữ liệu ngữ cảnh Báo cáo tài chính & Tồn kho FEFO giữ nguyên.
- Không chạm vào Prisma schema, không có DB migration.
- Không chạm vào logic Checkout, Giỏ hàng, Quản lý chuyến xe hay Membership F04 / Complaints F02.

---

## 3. Bảng Tổng Hợp Vấn Đề (Outstanding Issues)

| ID | Vấn đề | Đánh giá | Trạng thái |
| :---: | :--- | :---: | :---: |
| **OBS-03** | Khóa API truyền qua URL query param `?key=...`. | P3 | **ĐÃ GIẢI QUYẾT HOÀN TOÀN (RESOLVED)** bằng Header `x-goog-api-key`. |
| **OBS-01** | Báo cáo kiểm thử Live API của DEV 1 sử dụng fixture mô phỏng ngữ cảnh. | P2 | **ĐÃ GHI NHẬN RÕ**: Live API xác thực kết nối Google; Smoke test DB sẽ thực hiện sau khi deploy Beta. |
| **OBS-02** | Fixture mô phỏng của DEV 1 bỏ qua 8 kg lô không đạt QC. | P2 | **ĐÃ XÁC MINH**: Mã nguồn thật (`inventory-read.ts`) tính toán đúng, không có lỗi code. |
| **OBS-04** | Chưa có single-retry fallback sang model dự phòng khi gặp 429 lúc sinh nội dung. | P3 | **BACKLOG CHO AI-2**: Không chặn phát hành AI-1. |

---

## 4. Kết Luận QA (QA Verdict)

# **`QA PASS — F03 AI-1 READY FOR BETA INTEGRATION`**

- **Commit SHA đã kiểm thử và xác nhận:**
  - Hotfix Implementation: `a3c7a2204259ded2adabda9ef51c7e0b0a10890b`
  - Current Worktree HEAD: `42e4c38c8803b4941dee30fa0fda8b33d1a42c64`
- **Tình trạng:** Sạch sẽ, an toàn, 16/16 unit tests PASS, 713/713 test suite tổng PASS, typecheck PASS, build PASS.

---

## 5. Đánh Giá Mức Độ Sẵn Sàng Beta & Hành Động Tiếp Theo (Next Actions)

### 5.1. Beta Integration Readiness
Tính năng **F03 AI-1 (Gemini Executive Assistant)** đã hoàn tất toàn bộ chu trình phát triển, kiểm thử chức năng, kiểm thử bảo mật và hotfix retest. Đạt chuẩn 100% để tích hợp lên nhánh `beta`.

### 5.2. Các bước tiếp theo dành cho Release Integrator (Gate C)
1. Chuyển sang nhánh `beta` tại thư mục làm việc chính [`D:\TDTU\TMĐT Website`](file:///D:/TDTU/TMĐT%20Website).
2. Thực hiện merge commit `42e4c38c8803b4941dee30fa0fda8b33d1a42c64` từ nhánh `feature/f03-gemini-ai` vào `beta`.
3. Lưu báo cáo này vào [`D:\TDTU\TMĐT Website\docs\QA_F03_02_SECURITY_HOTFIX_RETEST.md`](file:///D:/TDTU/TMĐT%20Website/docs/QA_F03_02_SECURITY_HOTFIX_RETEST.md).
4. Cấu hình biến môi trường `GEMINI_API_KEY` trên Vercel Project Settings trước khi trigger build deploy Beta.
5. Thông báo hoàn tất F03 AI-1 cho Product Owner và mở đường cho DEV 1 tiếp tục sang Phase F03 AI-2.

---
*Báo cáo được lập độc lập bởi Senior QA Engineer. Nhiệm vụ kiểm thử hoàn tất.*
