# QA-WORK-F03-03 — FINAL GEMINI AI-1 BETA ACCEPTANCE

## Thông tin phiên kiểm thử

- **Feature/Task ID:** F03 — Gemini AI-1 Executive Assistant / QA-WORK-F03-03.
- **QA Agent:** ChatGPT Work, kiểm thử độc lập trực tiếp bằng Cloud Browser.
- **Thời điểm:** 28/10/2026, khoảng 12:48–12:50, Asia/Ho_Chi_Minh (UTC+7).
- **Beta URL:** https://nong-san-b2b-git-beta-baopk.vercel.app
- **Trang đã kiểm tra:** `/admin/bao-cao`, `/admin/ton-kho` trên cùng hostname Beta.
- **Authentication Status:** PASS — PO đăng nhập thủ công; trang Reports và Inventory tải thực tế với quyền Admin. Không coi redirect hoặc màn hình login là bằng chứng runtime PASS. Sau kiểm thử đã logout và xác minh `/dang-nhap` trên cùng hostname Beta.
- **Deployment:** `DEPLOYMENT SHA UNVERIFIED`. HEAD `dc52d6da37209eaa1ad3f7fdf76fdd07a365ca21`, merge `a9fa35f5b8a898bf3ca944dce03cdf2dd76ad5a5`, QA-approved `2f35027c395cc3e2b2a36c40349b07da423ddd63` là thông tin DEV/PO cung cấp; chưa có bằng chứng độc lập về SHA phiên đang chạy.
- **Model hiển thị:** `gemini-3.5-flash-lite`, tại widget và cuối phản hồi. Đây là model được UI/server công bố; không xác minh trực tiếp upstream Google.
- **Phạm vi:** STRICT READ-ONLY; chỉ gửi đúng **một** câu hỏi AI, không retry và không kiểm thử lại website.

## Câu hỏi và nội dung phản hồi

Câu hỏi đã gửi một lần qua nút Gửi:

> Phân tích hiện trạng tồn kho FEFO và cảnh báo các lô hàng sắp hết hạn.

Gemini nhận yêu cầu, UI hiển thị “Gemini đang phân tích số liệu báo cáo và tồn kho FEFO...”, sau đó trả lời hoàn chỉnh bằng tiếng Việt. Các nội dung liên quan được chép từ phản hồi thực tế:

- **“FEFO (First Expired, First Out - Hết hạn trước, Xuất trước)”**.
- Physical **1.858 kg**; bán được **1.850 kg**, tương ứng **16 lô ACTIVE hợp lệ xuất kho**; giữ chỗ **0 kg**; mặt hàng tồn thấp **0**.
- **“5 lô hàng cận date duy nhất”** trong 7 ngày.
- Nhóm **≤3 ngày: 1 lô**; nhóm **>3 đến ≤7 ngày: 4 lô**; quá hạn **0 lô**.
- Liệt kê đủ 5 mã lô, HSD, khối lượng bán được đúng như bảng đối chiếu bên dưới.
- Tổng khối lượng 5 lô cận date là **440 kg**, đúng phép cộng **50 + 60 + 90 + 110 + 130**.
- Đề xuất ưu tiên xuất theo hạn sử dụng, ưu tiên lô Bơ và Ri6; đây chỉ là gợi ý AI, QA không thực hiện hành động kho.

## Kết quả từng test

| Test | Kết quả | Expected / Actual |
|---|---|---|
| Test 1 — Runtime | PASS trong lượt thử | Nhận câu hỏi, có trạng thái xử lý và phản hồi hoàn chỉnh; không thấy timeout 15s/35s, thông báo 5xx hoặc crash. |
| Test 2 — F03-WORK-03 | **PASS** | FEFO được giải thích đúng là First Expired, First Out; không dùng “nhập trước xuất trước”. Ngữ cảnh chỉ nêu 16 lô ACTIVE hợp lệ xuất kho. |
| Test 3 — F03-WORK-02 | **PASS** | Tổng duy nhất 5; chia nhóm không trùng 1 + 4. Khớp dashboard có 5 lô ≤7 ngày, trong đó 1 lô ≤3 ngày. |
| Test 4 — Tồn kho / QC | PASS trong nội dung đã nêu | Physical, Sellable, Reserved, số ACTIVE và toàn bộ các lô cảnh báo khớp UI hiện hành. Không coi UNVERIFIED hoặc LOCKED_QC là hàng bán được. AI không giải thích riêng 8 kg không đủ điều kiện bán; không đánh là lỗi vì tổng Sellable và nhóm hợp lệ vẫn đúng. |

Hai lỗi nội dung P2 của vòng QA-WORK-F03-02 **không tái hiện trong một phản hồi đã kiểm tra**. Không suy rộng thành bảo đảm mọi phản hồi tương lai đều đúng.

## Dashboard Cross-check

Dashboard Inventory hiển thị **cập nhật lúc 12:48 28/10/2026 (GMT+7)**. Đây là dữ liệu được đọc lại trong phiên mới, không lấy baseline lịch sử làm chuẩn mặc định.

| Chỉ số | Dashboard hiện hành | Gemini | Đánh giá |
|---|---:|---:|---|
| Physical | 1.858 kg | 1.858 kg | Khớp |
| Sellable Available | 1.850 kg | 1.850 kg | Khớp |
| Reserved | 0 kg | 0 kg | Khớp |
| Không đủ điều kiện bán | 8 kg | Không nêu riêng | AI không cộng vào Sellable; diễn giải riêng chưa kiểm chứng |
| ACTIVE FEFO hợp lệ | 16 lô | 16 lô | Khớp |
| Tổng lô | 20 | Không nêu | Không cần thiết để xác nhận hai hotfix |
| Lô lịch sử UNVERIFIED | 3 | Không đưa vào nhóm hợp lệ | Không thấy phân loại sai |
| Sắp hết hạn ≤7 ngày | 5 | 5 duy nhất | Khớp |
| Trong đó ≤3 ngày | 1 | 1, còn lại >3–7 ngày là 4 | Không cộng trùng |
| Đã quá hạn | 0 | 0 | Khớp |

| Lô — mã trên Dashboard và AI | Khả dụng cả hai | HSD cả hai | Số ngày còn lại cả hai |
|---|---:|---|---:|
| LO-FEFO-BO034-01 | 50 kg | 31/10/2026 | 3 |
| LO-FEFO-RI6-01 | 60 kg | 01/11/2026 | 4 |
| LO-F01E-MANGCUT-01 | 90 kg | 02/11/2026 | 5 |
| LO-F01E-XOAI-01 | 110 kg | 03/11/2026 | 6 |
| LO-F01E-MONTHONG-01 | 130 kg | 04/11/2026 | 7 |

AI viết ngày không có số 0 đứng đầu ở một số dòng; cùng ngày với Dashboard, không phải sai dữ liệu.

## Runtime, Console và bằng chứng

- Phản hồi hoàn chỉnh đã hiện ở mốc **13,953 giây sau click Gửi**. Đây là **cận trên quan sát**, gồm thao tác mở và đọc dashboard; không phải độ trễ API được đo chính xác. Không xuất hiện timeout.
- Sau phản hồi, các nút gợi ý được bật lại, nút Sao chép hiện diện. Nút Gửi disabled khi ô nhập rỗng là hợp lý; không gửi thêm câu hỏi để kiểm tra nút.
- Console thu thập chỉ thấy lỗi extension “Error sending browser metadata to extension: Object”, nguồn `chrome-extension://…/content-script.bundle.js`; không xếp là lỗi ứng dụng.
- Không quan sát React hydration error, lỗi runtime nghiêm trọng hoặc thông báo HTTP 5xx. Không thu thập toàn bộ network status nên không tuyên bố tất cả request đều thành công.
- Không thấy API Key hoặc dữ liệu cá nhân nhạy cảm không cần thiết trong nội dung AI. Không đọc secrets hoặc kiểm thử vượt quyền.
- Ảnh bằng chứng của phiên: `F03-03-FEFO-definition.jpg` (model, câu hỏi, định nghĩa đúng và tổng tồn); `F03-03-FEFO-result.jpg` (các lô và nhóm >3–7 ngày); `F03-03-inventory.jpg` (KPI kho hiện hành). Nội dung đầy đủ được ghi trong báo cáo để bàn giao độc lập với ảnh.

## Bugs / Severity và Outstanding Issues

- **F03-WORK-02 (P2): PASS retest**, không đếm trùng.
- **F03-WORK-03 (P2): PASS retest**, định nghĩa FEFO đúng.
- **Không phát hiện P0/P1/P2 mới ảnh hưởng tính đúng đắn** trong phạm vi một câu hỏi đã quan sát. Không mở bug mới.
- Chưa xác minh SHA deployment, server logs, cấu hình timeout/maxDuration, model upstream, truy vấn Neon trực tiếp, hay mọi khả năng sinh câu trả lời. Không mở rộng source audit, business E2E hoặc F02/F04.
- AI không gọi tên riêng lô LOCKED_QC và không giải thích riêng 8 kg QC; kết luận QC giới hạn ở việc phân biệt Physical/Sellable và chỉ dùng ACTIVE hợp lệ trong phản hồi. Không suy diễn đã kiểm tra lại thuật toán cấp phát FEFO.
- Không thực hiện Order, Payment, refund, CRUD, chỉnh kho, migration, source edit, push hoặc deploy. Không tự chứng nhận toàn bộ database không có thay đổi do tiến trình khác.

## QA Verdict

**WORK RETEST PASS — F03 AI-1 ELIGIBLE FOR BETA CLOSURE**

Một câu hỏi nghiệm thu nhận phản hồi hoàn chỉnh; định nghĩa FEFO chính xác, tổng số lô không trùng và các số liệu được AI nêu khớp Inventory Dashboard hiện hành. Không phát hiện lỗi ảnh hưởng tính đúng đắn trong phạm vi yêu cầu.

## Next Action

Bàn giao báo cáo cho Release Integrator/PO để quyết định đóng F03 AI-1 trong Beta scope; QA không tự đóng F03 và không bắt đầu AI-2. Không yêu cầu sửa bổ sung hoặc vòng source audit mới từ các kết quả quan sát này.

File được cung cấp để PO tải về và Release Integrator lưu vào `D:\TDTU\TMĐT Website\docs`. **Chưa ghi trực tiếp vào ổ D: hoặc repository của PO.**
