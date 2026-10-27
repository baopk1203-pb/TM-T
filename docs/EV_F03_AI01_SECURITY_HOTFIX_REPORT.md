# EV-F03-AI01-HOTFIX — GEMINI API KEY SECURITY HARDENING REPORT

- **Project:** E Vibe — Nông Sản B2B (Đồ án TMĐT)
- **Feature:** F03 — Gemini AI Admin Executive Assistant
- **Task ID:** `EV-F03-AI01-HOTFIX`
- **Role:** DEV 1 — Senior AI Full-Stack Engineer
- **Date:** 2026-10-27
- **Worktree:** `D:\TDTU\wt_f03_gemini`
- **Branch:** `feature/f03-gemini-ai`
- **Baseline QA Commit (fa7dcbe):** `fa7dcbe45ee0f8f1a500a1c43fa9aaa1ccbba66a`
- **Hotfix Commit SHA:** `a3c7a2204259ded2adabda9ef51c7e0b0a10890b`
- **Verdict:** **SECURITY HARDENING COMPLETE — READY FOR QA RE-INSPECTION**

---

## 1. Executive Summary & Root Cause Analysis

Trong đợt nghiệm thu độc lập F03 AI-1 (`QA PASS — READY FOR INTEGRATION REVIEW`), Independent QA phát hiện quan sát bảo mật:
- **`OBS-03`**: Khóa bí mật `GEMINI_API_KEY` được gửi qua URL query parameter (`?key=${apiKey}`) trong các yêu cầu REST API tới Google Gemini (`GET /v1beta/models` và `POST /v1beta/models/{model}:generateContent`).
- **Rủi ro an toàn thông tin:** Việc truyền API Key trong URL query string có thể dẫn đến việc rò rỉ khóa bí mật qua các kênh không chủ đích:
  - Proxy access logs, gateway logging, reverse proxy trace, trình duyệt history / network panel.
  - Các hệ thống logging APM bên thứ ba (DataDog, Sentry, CloudWatch) mặc định log URL đầy đủ.
- **Biện pháp khắc phục tối thiểu chuẩn Google:**
  - Theo tài liệu chính thức Google Generative Language API, Google hỗ trợ truyền API Key an toàn thông qua HTTP header:
    ```http
    x-goog-api-key: <GEMINI_API_KEY>
    ```
  - Loại bỏ hoàn toàn chuỗi `?key=...` ra khỏi tất cả các endpoint URLs.

---

## 2. Chi Tiết Các Thay Đổi Mã Nguồn

### 2.1. Cập nhật REST Client (`nong-san-b2b/src/lib/gemini/client.ts`)

#### A. Model Discovery Endpoint (`verifyGeminiModelAccess`)
- **Trước hotfix:**
  ```ts
  const res = await fetch(`${GEMINI_API_BASE_URL}/models?key=${encodeURIComponent(apiKey)}`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    signal: controller.signal,
  })
  ```
- **Sau hotfix:**
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

#### B. Content Generation Endpoint (`queryGemini`)
- **Trước hotfix:**
  ```ts
  const url = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(modelToUse)}:generateContent?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal: controller.signal,
  })
  ```
- **Sau hotfix:**
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

---

## 3. Cập Nhật Unit & Security Test Suite (`tests/unit/admin-ai.test.ts`)

Đã bổ sung và chuẩn hóa các bài test bảo mật nghiêm ngặt:
1. **Assertion URL Cleanliness:**
   - Kiểm tra `expect(calledUrl).not.toContain('key=')`.
   - Kiểm tra `expect(calledUrl).not.toContain(secretKey)`.
2. **Assertion Header Presence:**
   - Kiểm tra `expect(headers['x-goog-api-key']).toBe(secretKey)`.
3. **Thêm bài test bảo mật chuyên biệt `2.7`:**
   - `it('2.7 (SECURITY) should transmit API key via x-goog-api-key header and never in URL query parameter')`
   - Xác thực cho cả hai luồng: `verifyGeminiModelAccess` và `queryGemini`.
4. **Cập nhật mocking cho Server Action (Test 3.4 & 3.5):**
   - Chuyển `url.includes('/models?key=')` thành `url.endsWith('/models')` kết hợp assertion header `x-goog-api-key`.

---

## 4. Bằng Chứng Kiểm Định Trực Tiếp (Live API Validation Evidence)

Thực hiện kiểm thử thực tế với Google Gemini REST API trực tiếp bằng API Key thực từ `.env.local` (qua scratch probe an toàn, không in key ra log):

### 4.1. Thăm dò Mô hình Trực tiếp (Live Model Discovery)
- **Phương thức:** `GET https://generativelanguage.googleapis.com/v1beta/models`
- **Header:** `'x-goog-api-key': '***'`
- **Kết quả:**
  - `HTTP Status:` **200 OK**
  - `Models Count:` **46 models** hỗ trợ generateContent.
  - `Active Preferred Model Selected:` **`gemini-3.1-flash-lite`**

### 4.2. Sinh nội dung Trực tiếp (Live generateContent)
- **Phương thức:** `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent`
- **Header:** `'x-goog-api-key': '***'`
- **URL gửi đi:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent` (hoàn toàn không chứa `?key=`).
- **Dữ liệu ngữ cảnh thử nghiệm:** Doanh thu tháng 10: 250.000.000 đ, 50 đơn hàng hoàn thành.
- **Kết quả phản hồi từ Google:**
  - `HTTP Status:` **200 OK**
  - `Model Metadata:` `gemini-3.1-flash-lite`
  - `Nội dung phản hồi:` *"Trong tháng 10, E Vibe đạt doanh thu 250.000.000 đ từ 50 đơn hàng hoàn thành."*

---

## 5. Kết Quả Kiểm Định Nghiệm Thu (Quality Gates)

| Lệnh Kiểm Tra | Kết Quả | Chi Tiết |
|---|---|---|
| `npm run typecheck` | **PASS** | `tsc --noEmit` hoàn tất với 0 lỗi. |
| `npm run lint` | **PASS** | `eslint` 0 lỗi (1 warning không liên quan ở script DB). |
| `vitest run tests/unit/admin-ai.test.ts` | **PASS** | 16/16 unit tests passed trong 27ms. |
| `npm test` (toàn bộ dự án) | **PASS** | **47/47 test files passed**, **713/713 tests passed** (100% green). |
| `next build` | **PASS** | Build production thành công với webpack, static & dynamic routes hợp lệ. |

---

## 6. Tuân Thủ Ranh Giới Nghiêm Ngặt Của DEV 1

- [x] **Bảo mật API Key:** Tuyệt đối không log, in hoặc commit giá trị `GEMINI_API_KEY`.
- [x] **File môi trường:** File `.env.local` được Git ignore 100%, không bị commit hay thay đổi.
- [x] **Không lan man:**
  - Không bắt đầu AI-2.
  - Không can thiệp nghiệp vụ Pricing, Checkout hay FEFO.
  - Không sửa Prisma schema hay database migrations.
  - Không can thiệp công việc DEV 2 (F04) hay DEV 3 (F02).
- [x] **Quy tắc Git:**
  - Thực hiện trên đúng nhánh `feature/f03-gemini-ai` trong worktree `D:\TDTU\wt_f03_gemini`.
  - Không push lên remote origin, không merge vào `beta`, không deploy lên Vercel/Production.
  - Dừng lại bàn giao cho Independent QA Tester.
