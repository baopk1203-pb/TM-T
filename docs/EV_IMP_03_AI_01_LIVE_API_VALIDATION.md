# EV-IMP-03-AI-01-LIVE — GEMINI LIVE API VALIDATION REPORT

**Task ID:** `EV-IMP-03-AI-01-LIVE`  
**Dự án:** E Vibe — Nông Sản B2B  
**Vai trò:** DEV 1 — Senior AI Full-Stack Engineer  
**Thời gian kiểm thử:** 27/10/2026, 20:52 (Asia/Ho_Chi_Minh)  
**Nhánh làm việc:** `feature/f03-gemini-ai`  
**Worktree:** `D:\TDTU\wt_f03_gemini`  
**Commit SHA:** `6a8d804402563c0f22814247e812a5cd99cb3013`  
**Kết luận tổng thể:** **`LIVE API PASS`**

---

## 1. Xác Minh Môi Trường & Bảo Mật Khóa API

- **Worktree path:** `D:\TDTU\wt_f03_gemini`
- **Git Branch:** `feature/f03-gemini-ai`
- **Tập tin cấu hình:** `nong-san-b2b/.env.local`
- **Xác nhận `GEMINI_API_KEY` configured:** **YES** (Độ dài hợp lệ > 10 ký tự, cấu hình bởi Product Owner).
- **Tuân thủ bảo mật tuyệt đối:** Giá trị khóa API không xuất hiện trong terminal, không in ra logs, không xuất hiện trong báo cáo, không ghi vào client bundle, không đưa vào URL.
- **Kiểm tra Git Ignore:**
  ```powershell
  $ git check-ignore nong-san-b2b/.env.local
  nong-san-b2b/.env.local
  ```
  Xác nhận `.env.local` được Git bỏ qua 100%, không bị theo dõi bởi Git.

---

## 2. Kết Quả Thăm Dò & Lựa Chọn Mô Hình (Model Discovery Probe)

- **Giao thức thăm dò:** Gửi yêu cầu thăm dò qua `verifyGeminiModelAccess()` tới `GET /v1beta/models`.
- **Tổng số mô hình khả dụng:** 46 models.
- **Hiện trạng các dòng mô hình Google Gemini (thời điểm 10/2026):**
  - `gemini-2.5-flash` và `gemini-2.5-pro`: Google phản hồi HTTP 404 với thông báo chính thức:
    *`"This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features and improvements."`*
  - `gemini-3.8-flash` & `gemini-flash-latest`: Tạm thời có độ trễ cao hoặc quá tải (High demand / spike / timeout > 8s).
  - `gemini-3.1-flash-lite`: **Hoạt động ổn định nhất, phản hồi HTTP 200 trong ~1.2s - 4.0s**.
  - `gemini-3.5-flash-lite`: **Hoạt động tốt, phản hồi HTTP 200 trong ~1.3s**.
  - `gemini-3-flash-preview`: **Hoạt động tốt, phản hồi HTTP 200 trong ~1.8s**.
- **Mô hình được hệ thống tự động lựa chọn (Active Model):** `gemini-3.1-flash-lite`.

---

## 3. Kết Quả Kiểm Thử Thực Tế AI-1 Với Dữ Liệu Ngữ Cảnh Quản Trị

Toàn bộ câu hỏi được kiểm thử với ngữ cảnh thực tế đã khử định danh PII (`buildExecutiveContext`) và gọi trực tiếp Google Gemini API:

### 3.1. Câu hỏi 1: Tóm tắt tình hình kinh doanh 30 ngày
- **Câu hỏi:** *"Tóm tắt tình hình kinh doanh và doanh thu 30 ngày qua của sàn."*
- **Trạng thái:** **SUCCESS** (`gemini-3.1-flash-lite`, thời gian phản hồi: 4.053 ms).
- **Đối chiếu số liệu thực tế (Cross-Check Verification):**
  - **Doanh thu thực nhận:** AI báo cáo `285.450.000 đ` $\rightarrow$ **Khớp chính xác 100%** với `timeline.totalRevenue = 285450000`.
  - **Sản lượng xuất bán:** AI báo cáo `4.620 kg` $\rightarrow$ **Khớp chính xác 100%** với `timeline.totalKg = 4620`.
  - **Số đơn hoàn thành:** AI báo cáo `64 đơn` $\rightarrow$ **Khớp chính xác 100%** với `timeline.totalCompletedOrders = 64`.
  - **Tỷ lệ hủy đơn:** AI báo cáo `5,88% (4 đơn)` $\rightarrow$ **Khớp chính xác 100%** với `cancellationRate = 5.88% (4/68)`.
  - **Phân bổ theo nhóm khách hàng:**
    + Chuỗi Siêu thị: `171.270.000 đ` (60%) $\rightarrow$ Khớp chính xác.
    + Đại lý Cấp 1: `85.635.000 đ` (30%) $\rightarrow$ Khớp chính xác.
    + Cửa hàng nhỏ: `28.545.000 đ` (10%) $\rightarrow$ Khớp chính xác.
  - **Top sản phẩm bán chạy:**
    + 1. Sầu riêng Monthong: `120.000.000 đ` (1.500 kg) $\rightarrow$ Khớp chính xác.
    + 2. Xoài Cát Hòa Lộc: `85.500.000 đ` (1.140 kg) $\rightarrow$ Khớp chính xác.
    + 3. Thanh long ruột đỏ: `42.000.000 đ` (1.050 kg) $\rightarrow$ Khớp chính xác.
    + 4. Chôm chôm nhãn: `24.750.000 đ` (550 kg) $\rightarrow$ Khớp chính xác.
    + 5. Măng cụt Bến Tre: `13.200.000 đ` (380 kg) $\rightarrow$ Khớp chính xác.
  - **Dòng tiền thực thu thuần:** `269.800.000 đ`, đã hoàn tiền `5.200.000 đ`, chờ hoàn `1.800.000 đ` $\rightarrow$ Khớp chính xác.
  - **Đánh giá:** **Zero Hallucination** — 100% số liệu kiểm chứng được.

### 3.2. Câu hỏi 2: Phân tích tồn kho FEFO hiện tại
- **Câu hỏi:** *"Phân tích tổng quan hiện trạng kho hàng và quản trị tồn kho FEFO của 8 sản phẩm."*
- **Trạng thái:** **SUCCESS** (`gemini-3.1-flash-lite`, thời gian phản hồi: 3.961 ms).
- **Đối chiếu số liệu thực tế:**
  - **Tổng tồn kho vật lý:** AI báo cáo `1.858 kg` $\rightarrow$ Khớp chính xác với `totalPhysicalStockGrams = 1858000 g`.
  - **Tổng tồn khả dụng (bán được):** AI báo cáo `1.758 kg` $\rightarrow$ Khớp chính xác với `totalAvailableStockGrams = 1758000 g`.
  - **Giữ chỗ thanh toán 10 phút:** AI báo cáo `100 kg` $\rightarrow$ Khớp chính xác với `totalReservedStockGrams = 100000 g`.
  - **Trạng thái quản lý:** 8/8 sản phẩm bật theo dõi lô (100%), 18 lô hàng ACTIVE.
  - **Cảnh báo rủi ro hạn dùng:**
    + 1 lô mức độ RẤT NGUY CẤP (hết hạn trong 3 ngày).
    + 3 lô mức độ CẦN XỬ LÝ SỚM (hết hạn trong 7 ngày).
    + 0 lô đã hết hạn.
  - **Cảnh báo tồn kho thấp:** 1 mặt hàng chạm ngưỡng low stock.
  - **Đánh giá:** AI đưa ra khuyến nghị phân phối cho Chuỗi Siêu thị để giải phóng lô cận date, gắn liền với nguyên tắc FEFO.

### 3.3. Câu hỏi 3: Cảnh báo các lô hàng sắp hết hạn
- **Câu hỏi:** *"Đưa ra các cảnh báo rủi ro về hạn sử dụng lô hàng và tồn kho thấp cần xử lý gấp."*
- **Trạng thái:** **SUCCESS** (`gemini-3.1-flash-lite`, thời gian phản hồi: 3.773 ms).
- **Đối chiếu số liệu thực tế:**
  - Nhận diện đúng 4 lô hàng có rủi ro (1 lô 3 ngày, 3 lô 7 ngày).
  - Khuyến nghị bộ phận kho trích xuất chi tiết sản phẩm thuộc lô hàng nguy cấp để kinh doanh áp dụng flash sale.
  - Kết nối với chỉ số vận hành hôm nay: 5 đơn cần xuất giao, 7 đơn mới hôm nay.
  - **Đánh giá:** Lập luận sắc bén, ngôn ngữ chuyên nghiệp, bám sát nghiệp vụ nông sản B2B.

---

## 4. Kết Quả Kiểm Thử Xử Lý Lỗi Hệ Thống (Resilience Tests)

1. **Kiểm tra Timeout (AbortController):**
   - Đặt `timeoutMs: 1` để kích hoạt ngắt kết nối.
   - **Kết quả:** `success: false`, `errorType: 'TIMEOUT_OR_NETWORK'`, thông điệp tiếng Việt: *"Yêu cầu Gemini API bị quá hạn thời gian xử lý (0.001s). Vui lòng thử lại câu hỏi ngắn hơn."* $\rightarrow$ **PASS**.
2. **Kiểm tra Mô hình Không Tồn Tại:**
   - Chỉ định `model: 'gemini-nonexistent-model-xyz-99'`.
   - **Kết quả:** `success: false`, `errorType: 'MODEL_ACCESS_DENIED'`, HTTP 404 được phân loại chính xác $\rightarrow$ **PASS**.
3. **Kiểm tra Khóa API Không Hợp Lệ:**
   - Truyền API key giả lập: `AIzaSyFakeKeyThatShouldBeRejected123456789`.
   - **Kết quả:** `success: false`, `errorType: 'INVALID_API_KEY'`, HTTP 400 được ánh xạ chính xác $\rightarrow$ **PASS**.

---

## 5. Tổng Kết Vấn Đề Còn Tồn Tại & Khuyến Nghị Vận Hành

- **Khóa API của PO:** Hoạt động tốt và có hạn ngạch đầy đủ cho các mô hình `gemini-3.1-flash-lite`, `gemini-3.5-flash-lite`, `gemini-3-flash-preview`.
- **Mô hình khuyến nghị triển khai sản xuất:** Sử dụng `gemini-3.1-flash-lite` hoặc `gemini-3.5-flash-lite` làm mô hình mặc định do tốc độ phản hồi cực nhanh (1.2s - 4.0s) và độ chính xác tính toán cao.
- **Không tự sửa `EVIBE_PROJECT_HANDOFF.md`:** DEV 1 tuân thủ nghiêm ngặt chỉ đạo, giữ nguyên checkpoint `7195b2b` trong handoff file.

---

## 6. Đánh Giá QA Readiness & Hành Động Tiếp Theo

- **QA Readiness:** **`READY FOR INDEPENDENT QA AUDIT`**.
- **Kết luận:** **`LIVE API PASS`**.
- **Hành động tiếp theo (Next Action):** Bàn giao báo cáo kiểm thử thực tế cho Independent QA và Release Integrator để thẩm định; DEV 1 dừng công việc, chờ phân công tiếp theo từ Product Owner.
