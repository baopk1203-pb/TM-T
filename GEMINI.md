# HƯỚNG DẪN DÀNH CHO AGENT GEMINI (PROJECT CONTEXT & AGENT RULES)

Chào Gemini. Bạn đang làm việc trên dự án **Website Thương mại Điện tử B2B Nông sản – Trái cây** (Đồ án môn TMĐT).
Tất cả các quyết định nghiệp vụ, kiến trúc dữ liệu và lộ trình phát triển đã được chốt và ghi chi tiết trong tài liệu:
👉 **`docs/KE_HOACH_TRIEN_KHAI.md`** (ĐÂY LÀ NGUỒN SỰ THẬT DUY NHẤT).

---

## 1. NGUYÊN TẮC HOẠT ĐỘNG BẮT BUỘC (CRITICAL RULES)

1. **LÀM TUẦN TỰ TỪNG PHASE:**
   - Bạn PHẢI kiểm tra bảng **Tiến độ** ở cuối `docs/KE_HOACH_TRIEN_KHAI.md` để biết phase hiện tại đang làm.
   - **Tuyệt đối không nhảy cóc hoặc làm trước tính năng của phase sau**.
   - **ĐẶC BIỆT LƯU Ý:**
     - **Tính năng Vận chuyển (Shipping):** Nằm ở **Phase 8**. Ở các Phase 3–7, bạn CHỈ ĐƯỢC dùng hook giả lập `zeroShippingCalculator` trong `src/lib/domain/shipping/index.ts` (phí ship = 0 đ). KHÔNG tích hợp Google Maps hay quản lý chuyến trước Phase 8.
     - **Tính năng Thông báo (Notification):** Nằm ở **Phase 9**. Ở các Phase 4–8, bạn CHỈ ĐƯỢC ghi `OrderEvent` vào database thông qua `recordOrderEvent()`. KHÔNG tích hợp Nodemailer SMTP hay Zalo ZNS trước Phase 9.

2. **DỪNG VÀ BÁO CÁO SAU MỖI PHASE:**
   - Sau khi hoàn thành xong checklist của một phase, bạn PHẢI chạy các lệnh kiểm tra:
     ```bash
     npm run lint
     npm run typecheck
     npm test
     npm run build
     ```
   - Nếu có lỗi, phải sửa cho đến khi tất cả lệnh đều **PASS**.
   - Cập nhật dấu `[x]` và trạng thái trong bảng Tiến độ của `docs/KE_HOACH_TRIEN_KHAI.md`.
   - **Dừng lại, tóm tắt kết quả phase đó cho người dùng và xin xác nhận trước khi bắt đầu phase tiếp theo.**

3. **QUY ƯỚC DỮ LIỆU & ĐƠN VỊ TÍNH:**
   - **Tiền tệ:** Luôn dùng số nguyên VND (`Int`), ví dụ `150000` (150.000 đ). Không dùng số thực (float/double) để tránh lỗi làm tròn.
   - **Khối lượng:** Luôn lưu trữ trong database bằng đơn vị **gram (`Int`)**, ví dụ `50000` = 50 kg. Chỉ quy đổi sang kg khi hiển thị lên giao diện hoặc khi người dùng nhập vào.
   - **Server-side Calculation:** Tuyệt đối không nhận giá, chiết khấu hoặc tổng tiền từ client gửi lên. Mọi phép tính phải được tính toán lại độc lập tại backend (`src/lib/domain/pricing.ts`).

4. **KIẾN TRÚC & PHÂN TÁCH TRÁCH NHIỆM:**
   - Mọi hàm logic nghiệp vụ (tính giá, máy trạng thái đơn hàng, chốt khối lượng, chính sách hủy...) phải là **hàm thuần (pure functions)** trong thư mục `src/lib/domain/` và có unit test tương ứng bằng `vitest`.
   - Thư mục mã nguồn chính được đặt tại: `nong-san-b2b/`.
   - Ngôn ngữ: Giao diện hiển thị tiếng Việt; code, tên biến, tên cột DB và commit message dùng tiếng Anh.

---

## 2. DANH SÁCH TÀI LIỆU CẦN ĐỌC

Khi bắt đầu một tác vụ, hãy tham khảo các tài liệu sau theo thứ tự:
1. `docs/KE_HOACH_TRIEN_KHAI.md`: Kế hoạch triển khai, checklist từng phase, schema Prisma, các công thức toán và bộ test case chuẩn.
2. `Dac_ta_website_B2B_nong_san_v2.md`: Bản đặc tả nghiệp vụ chi tiết cho toàn bộ hệ thống (dùng khi cần hiểu sâu ngữ cảnh kinh doanh).

---

## 3. CHECKLIST KHI NHẬN LỆNH MỚI
Mỗi khi người dùng yêu cầu tiếp tục hoặc thực hiện một tác vụ:
1. Xác định phase hiện tại trong `docs/KE_HOACH_TRIEN_KHAI.md`.
2. Kiểm tra checklist của phase đó, xem việc gì đã làm, việc gì chưa.
3. Thực hiện công việc đúng phạm vi phase đó.
4. Chạy test và build xác thực.
5. Cập nhật tiến độ và báo cáo người dùng.
