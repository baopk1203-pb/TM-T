# MASTER DEFERRED ISSUES & PHASE 6 CONSOLIDATED BACKLOG

> **Dự án:** Website Thương mại Điện tử B2B Nông Sản – Trái cây (Đồ án tốt nghiệp / Môn học TMĐT)  
> **Repository:** `D:\TDTU\TMĐT Website` — Nhánh làm việc: `beta`  
> **Ngày cập nhật:** 19/10/2026 (Final Checkpoint)  
> **Mục đích:** Hợp nhất toàn bộ các vấn đề, lỗi đã sửa, lỗi tồn đọng, giới hạn kiến trúc và lỗ hổng kiểm thử (Test Gaps) từ Phase 1 đến Phase 7; thiết lập danh mục duy nhất phục vụ đợt **Final Stabilization sau khi hoàn thành Phase 9** và xác lập **Release Gate cho Phase 8**.

---

## 1. NGUYÊN TẮC QUẢN LÝ VÀ CHỐNG TRÙNG MÃ (DISAMBIGUATION GUIDE)

Trong quá trình phát triển các Phase 1–7, các nhóm QA (QA Agent Antigravity và Work Cloud Browser) đã từng đặt trùng các mã lỗi `BUG-01`, `BUG-02`, `BUG-04`, `BUG-07`, `BUG-08`, `BUG-09` cho những phân hệ và lỗi hoàn toàn khác nhau. Danh mục này chuẩn hóa tiền tố định danh duy nhất:

| Tiền tố | Ý nghĩa | Ví dụ |
|---|---|---|
| **`PH6-xx`** | Các vấn đề đặc thù phát hiện hoặc xử lý trong Phase 6 (Recurring, Pre-order, Dashboard) | `PH6-01` (QW04-01: Pre-order dropdown labels) |
| **`SRC-xxx`** | Lỗi logic backend, bảo mật, tài chính do Static Code Audit phát hiện | `SRC-FIN-01` (Phạt cọc đơn FULL), `SRC-SEC-07` (Auth guard cron) |
| **`WEB-xxx`** | Lỗi giao diện, trải nghiệm hoặc asset do QA Work kiểm thử trực tiếp trên Beta | `WEB-AUTH-10` (Logout redirect), `WEB-POST-01` (Cart quantity debounce) |
| **`QW06-xxx`** | Quan sát ghi nhận trong đợt Beta Smoke Test Phase 7 | `QW06-OBS-01` (React #418), `QW06-MINOR-01` (Empty chart) |
| **`GAP-xx`** | Lỗ hổng kiểm thử (Test Gap), rủi ro tích hợp hoặc giới hạn môi trường runtime | `GAP-01` (Neon isolation), `GAP-02` (Mobile 375px) |

### Bảng phân định mã lỗi dễ gây nhầm lẫn:
- **`BUG-01`:** Phân biệt `SRC-FIN-01` (Phạt cọc 100% đơn FULL — P0, đã sửa ở commit `15f603a`) với `WEB-PRE-01` (Banner pre-order chưa có luồng riêng — P1 lịch sử, đã giải quyết ở Phase 6B commit `e6208a5`).
- **`BUG-07`:** Phân biệt `SRC-SEC-07` (Server Action `expireOrdersJob` thiếu guard — P1, đã sửa ở commit `6af7c1b`) với `WEB-PRE-01` (Work BUG-07 link pre-order vào giỏ thường).
- **`BUG-08`:** Phân biệt `SRC-QR-08` (Fallback QR text nội bộ — P2, đã sửa ở commit `a7b267a`) với Work `BUG-08` (Màn hình đơn hàng rỗng `/tai-khoan/don-hang` — đã PASS).
- **`BUG-09`:** Phân biệt Work `BUG-09` (Placeholder `/tai-khoan/dinh-ky` hiển thị "Đang phát triển" trước Phase 6 — đã giải quyết ở Phase 6A commit `9cd484a`).

---

## 2. BẢNG TỔNG HỢP MASTER DEFERRED BACKLOG

### 2.1. Chuẩn hóa tầng kiểm thử (Test Coverage Levels)
Để phản ánh chính xác mức độ xác thực và tránh ngộ nhận về độ hoàn thiện hệ thống, tài liệu phân định rõ 3 cấp độ kiểm thử:
1. **Unit / Static QA:** Kiểm tra logic thuật toán cô lập bằng unit tests thuần, mock services và rà soát tĩnh (code audit/typecheck/lint). Chưa chạm database thật.
2. **Beta Read-Only QA:** QA Work kiểm tra giao diện người dùng và luồng đọc dữ liệu trực tiếp trên môi trường Vercel Beta, tuân thủ nguyên tắc an toàn tuyệt đối **không thực hiện thao tác ghi dữ liệu**.
3. **Business E2E Write:** Kiểm thử luồng nghiệp vụ hoàn chỉnh có ghi dữ liệu thực tế xuống database (đặt cọc, tạo lịch định kỳ, quét cron sinh đơn, chốt giá vụ mùa, khách duyệt đơn, hoàn tiền khiếu nại).

> [!IMPORTANT]
> **LƯU Ý VỀ TÌNH TRẠNG KIỂM THỬ:**  
> Toàn bộ các mục được đánh dấu **`VERIFIED FIXED`** hiện tại chủ yếu dựa trên **Unit / Static QA** (100% pass) hoặc **Beta Read-Only QA** của Work.  
> **Chưa có bất kỳ mục nào thuộc Phase 6 và Phase 7 được kiểm thử Business E2E Write trên database Neon live.** Mọi luồng ghi dữ liệu phức tạp đều được ghi nhận là Test Gap cần kiểm chứng an toàn.

### 2.2. Quy định trạng thái:
- **`VERIFIED FIXED`:** Đã sửa mã nguồn và có bằng chứng QA độc lập / Work xác minh trên Vercel Beta (tầng Read-Only hoặc Unit test).
- **`FIXED LOCAL ONLY`:** Đã sửa trong source code, Unit Tests PASS 100%, Local QA chấp thuận nhưng chưa chạy kiểm thử E2E tương tác ghi dữ liệu trên Beta.
- **`CONFIRMED OPEN`:** Vấn đề tồn tại thực tế và đã có bằng chứng rõ ràng (code hoặc log console), chưa có commit sửa và QA xác minh.
- **`NEEDS VERIFICATION`:** Cần bổ sung bằng chứng môi trường runtime để kết luận.
- **`TEST GAP`:** Luồng chức năng chưa được kiểm thử runtime/E2E đầy đủ (chưa có bằng chứng lỗi).
- **`DEFERRED`:** Chủ dự án chủ động hoãn xử lý sang Phase sau hoặc đợt ổn định cuối.
- **`NOT A BUG`:** Đúng thiết kế hệ thống hoặc ghi chú tích hợp cho tương lai.

### 2.3. Quy định mức độ ưu tiên:
- **`P0`:** Lỗi nguy hiểm về dữ liệu, tài chính hoặc bảo mật nghiêm trọng (báo Product Owner ngay). *(Hiện tại: 0 mục mở)*.
- **`P1`:** Lỗi chặn luồng trình diễn đồ án (Demo Blocker). *(Hiện tại: 0 mục mở)*.
- **`P2`:** Lỗi nghiệp vụ hoặc chức năng nhưng không cản trở kịch bản demo chính.
- **`P3`:** Lỗi giao diện, câu chữ, cảnh báo console hoặc cải tiến nhỏ.
- **`TEST GAP`:** Hạng mục kiểm thử cần bổ sung trước khi bàn giao đồ án.

---

### 2.4. BẢNG THEO DÕI HỢP NHẤT TOÀN DỰ ÁN (31 MỤC)

| ID | Phase | Phân hệ | Mô tả vấn đề | Nguồn bằng chứng | Trạng thái | Ưu tiên | File liên quan | Commit sửa lỗi | Retest / Xác minh | Hướng xử lý đề xuất | Thời điểm xử lý |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **PH6-01** | Phase 6 | Pre-order | Dropdown quy cách và địa chỉ hiển thị raw CUID/UUID thay vì tên/nhãn dễ đọc (QW04-01) | QA-WORK-04 | **VERIFIED FIXED** | P3 | `preorder-box.tsx`, `preorder.ts`, `preorder.test.ts` | `a488a96` | QA-WORK-05 PASS trên Beta (Read-Only) | Dùng `formatPackagingLabel` & `formatAddressLabel` làm children `<SelectValue>` | Đã hoàn tất |
| **PH6-02** | Phase 6 | Pre-order / Dashboard | Đồng bộ trạng thái quyết định `null` và `PENDING` khi chốt giá ngoài biên độ; không ẩn nhầm nút duyệt | QA-TASK-14, QA-TASK-15 | **FIXED LOCAL ONLY** | P2 | `preorder.ts`, `customer-order-view.tsx`, `dashboard.ts` | `d0924fb` | 283/283 Unit tests PASS (suite 2) | Hàm `isPreorderAwaitingCustomerDecision` xử lý an toàn cả `null` & `PENDING` | Phase 9 E2E |
| **PH6-03** | Phase 6 | Pre-order | Khách ACCEPT giá vụ mùa: tự động gán `deliveryDate` & `timeSlot` an toàn, tuân thủ `earliestDeliveryDate` | QA-TASK-15 | **FIXED LOCAL ONLY** | P2 | `actions/preorder.ts`, `tests/unit/dashboard.test.ts` | `d0924fb` | Unit tests Integration Check B PASS | Giữ nguyên ngày Admin chọn nếu hợp lệ; fallback sang `earliestDeliveryDate` | Phase 9 E2E |
| **PH6-04** | Phase 1–5 | Pre-order / Recurring | Legacy Pre-order & Recurring (banner giỏ thường `WEB-PRE-01`, placeholder `/tai-khoan/dinh-ky` `BUG-09`) | QA-WORK-01..03, Handoff | **VERIFIED FIXED** | P1 (lịch sử trước Phase 6) | `preorder-box.tsx`, `recurring-client.tsx` | `9cd484a`, `e6208a5` | QA-WORK-04 Beta Smoke PASS (Read-Only) | Triển khai phân hệ Pre-order và Recurring chuyên biệt trong Phase 6A & 6B | Đã hoàn tất |
| **PH6-05** | Phase 6 | Recurring | Ghi nhận OrderEvent `DRAFT_EXPIRED` khi đơn nháp quá hạn xác nhận (trước ngày giao trừ leadTime) | Code audit, Phase 9 spec | **NOT A BUG** | P3 | `order-expiration.ts`, `recurring.test.ts` | `9cd484a` | Unit tests PASS | Giữ nguyên logic; nối vào Notification template `STATUS_CHANGED -> CANCELLED` ở Phase 9 | Phase 9 |
| **SRC-FIN-01** | Phase 5 | Đơn hàng / Cọc | Phạt cọc 100% tiền đơn FULL khi khách hủy ở PROCESSING (Antigravity BUG-01 cũ) | Code audit, Handoff | **VERIFIED FIXED** | P0 | `order.ts`, `settlement.ts`, `settlement.test.ts` | `15f603a` | Unit tests S2 PASS, QA-TASK-03 | Tách mức cọc quy định 30% (`depositAmount`) khỏi số tiền thanh toán ban đầu (`amountToPay`) | Đã hoàn tất |
| **SRC-FIN-02** | Phase 5 | Khiếu nại / Quyết toán | Không thể hoàn tất đơn COMPLAINT sau khi bồi hoàn (Antigravity BUG-02 cũ) | Code audit, Handoff | **VERIFIED FIXED** | P0 | `order-state.ts`, `order-detail-client.tsx` | `15f603a` | Unit tests C1–C3 PASS, QA-TASK-03 | Cho phép chuyển COMPLETED khi bồi hoàn đã thực hiện xong (`grossPaid >= targetTotal`) | Đã hoàn tất |
| **SRC-DATA-03** | Phase 2 | Sản phẩm / DB | Xóa Packaging khi Admin cập nhật sản phẩm gây vi phạm khóa ngoại OrderItem (Antigravity BUG-03 cũ) | Code audit, Handoff | **VERIFIED FIXED** | P1 | `product.ts`, `packaging-integrity.test.ts` | `85eecf5` | Unit tests PASS, QA-TASK-05 | Cập nhật theo ID ổn định, vô hiệu hóa `isActive = false` thay vì `deleteMany` | Đã hoàn tất |
| **SRC-SEC-04** | Phase 2 | Upload / File | Upload file chỉ dựa vào MIME client gửi, nguy cơ tải mã độc (Antigravity BUG-04 cũ) | Code audit, Handoff | **VERIFIED FIXED** | P1 | `storage.ts`, `upload.test.ts` | `85eecf5` | Unit tests PASS, QA-TASK-05 | Kiểm tra magic bytes signature (PNG/JPEG/WEBP) và giới hạn kích thước 5MB | Đã hoàn tất |
| **SRC-SEC-05** | Phase 4 | Cron / Bảo mật | Cron Route `/api/cron/expire-orders` fail-open khi thiếu `CRON_SECRET` | Code audit, Handoff | **VERIFIED FIXED** | P1 | `app/api/cron/expire-orders/route.ts` | `6af7c1b` | Unit tests fail-closed PASS | Bắt buộc kiểm tra `CRON_SECRET` trước khi thực thi; fail-closed 401 | Đã hoàn tất |
| **SRC-SEC-06** | Phase 1 | Xác thực | Secret xác thực dự phòng bị hardcode trong source code | Code audit, Handoff | **VERIFIED FIXED** | P1 | `lib/auth.ts`, `tests/unit/auth-secret.test.ts` | `6af7c1b` | Unit tests PASS | Xóa bỏ secret fallback; ném lỗi khi thiếu cấu hình trong môi trường | Đã hoàn tất |
| **SRC-SEC-07** | Phase 4 | Quản trị đơn | Server Action `expireOrdersJob` chưa có kiểm soát quyền rõ ràng | Code audit, Handoff | **VERIFIED FIXED** | P1 | `admin-order.ts`, `order-expiration.ts` | `6af7c1b` | Unit tests PASS | Tách service nội bộ; bọc Server Action bằng `requireAdmin()` | Đã hoàn tất |
| **SRC-CONF-01**| Phase 1 | Middleware | Middleware và Auth.js đọc biến secret không đồng bộ (`AUTH_SECRET` vs `NEXTAUTH_SECRET`) | Code audit, Handoff | **VERIFIED FIXED** | P1 | `middleware.ts`, `lib/auth.ts` | `6af7c1b` | Unit tests PASS | Chuẩn hóa hàm `getAuthSecret()` dùng chung cho toàn bộ app | Đã hoàn tất |
| **SRC-QR-08** | Phase 4 | Thanh toán | Fallback QR nội bộ là URL/text thay vì payload VietQR EMVCo tiêu chuẩn | Cost audit, Handoff | **VERIFIED FIXED** | P2 | `app/api/qr/payment/[code]/route.ts` | `a7b267a` | Unit tests VietQR payload PASS | Tự sinh chuỗi EMVCo VietQR chuẩn (NAPAS 970422) khi fallback | Đã hoàn tất |
| **SRC-DEPLOY-01** | Phase 2 | Hạ tầng / Upload | Ghi file upload vào `public/uploads` không bền vững trên Vercel Serverless | Cost audit, Handoff | **DEFERRED** | P2 | `lib/storage.ts` | Chưa triển khai | Giữ nguyên mock/local storage cho demo | Chuyển sang Supabase Storage / Vercel Blob ở Phase 9 | Phase 9 Deploy |
| **WEB-AUTH-10**| Phase 1 | Xác thực | Đăng xuất trên Beta xong bị chuyển hướng sai origin sang Vercel login | QA-WORK 18/10, Handoff | **VERIFIED FIXED** | P1 | `components/shop/user-menu.tsx`, `logout.test.ts` | `6af7c1b` | QA-WORK-03 PASS trên Beta (Read-Only) | Dùng `window.location.origin` cho `callbackUrl` khi gọi `signOut` | Đã hoàn tất |
| **WEB-IMG-04** | Phase 2 | Catalog / Dữ liệu | Ảnh Thanh Long Ruột Đỏ hiển thị quả ruột trắng | QA-WORK 18/10, Handoff | **DEFERRED** | P3 | `prisma/seed.ts` | `75b6064` (một phần) | QA-WORK-03 ghi nhận PENDING ASSET | Tìm link ảnh Unsplash thanh long ruột đỏ chuẩn để cập nhật seed | Phase 9 Polish |
| **WEB-CERT-04**| Phase 2 | Catalog / Nhà vườn | Chứng nhận VietGAP Bến Tre hết hạn hiển thị nhãn gây hiểu nhầm | QA-WORK 18/10, Handoff | **VERIFIED FIXED** | P2 | `product-detail-view.tsx` | `a7b267a` | QA-WORK-03 PASS trên Beta (Read-Only) | Hiển thị rõ nhãn "Hết hạn" và giải thích danh sách chứng nhận lịch sử | Đã hoàn tất |
| **WEB-UX-SAMPLE** | Phase 3 | Giỏ hàng | Giỏ chỉ có hàng mẫu vẫn hiển thị thông báo "Đã trừ 5% chiết khấu" | QA-WORK 18/10, Handoff | **VERIFIED FIXED** | P3 | `cart-summary.ts`, `cart-view.tsx` | `a7b267a` | QA-WORK-03 PASS trên Beta (Read-Only) | Sửa câu chữ tóm tắt: "0% / Không áp dụng cho hàng mẫu" | Đã hoàn tất |
| **WEB-POST-01**| Phase 3 | Giỏ hàng | Bấm tăng/giảm số lượng quá nhanh làm lệch báo giá và trạng thái checkout | QA-WORK-02, QA-WORK-03 | **FIXED LOCAL ONLY** | P2 | `cart-view.tsx`, `post-deploy-qa.test.ts` | `c84fba7` | QA-WORK-03 PARTIAL (hành vi tốt) | Khóa nút checkout ngay khi quantity thay đổi, sequence counter chống race condition | Phase 9 Retest |
| **QW06-OBS-01**| Phase 7 | Toàn hệ thống | `Minified React error #418` trong console do format ngày giờ thiếu timezone | QA-WORK-06 | **FIXED LOCAL ONLY** | P3 | `order-detail-client.tsx`, `customer-management.tsx`, `delivery-date.ts` | `3b67d06` | Local QA PASS (unit test 10/10 PASS, build PASS); chuẩn hóa timeZone Asia/Ho_Chi_Minh; chờ Beta runtime retest | Bổ sung `{ timeZone: 'Asia/Ho_Chi_Minh' }` qua `formatVietnamDate` & `formatVietnamDateTime` | Đã hoàn tất ở Local Hotfix (chờ Beta deploy) |
| **QW06-MINOR-01** | Phase 7 | Báo cáo | Khi có 0 đơn COMPLETED, Recharts render trục X rỗng thay vì thông điệp empty state | DEV Phase 8 Kickoff Static Audit; related to QA-WORK-06 reporting UI | **FIXED LOCAL ONLY** | P3 | `reports-client.tsx` | `3b67d06` | Local QA PASS (unit test PASS, build PASS); kiểm tra completedOrders > 0 trước khi render Recharts; chờ Beta runtime retest | Kiểm tra `isMounted && summary.completedOrdersCount > 0` trước khi render chart | Đã hoàn tất ở Local Hotfix (chờ Beta deploy) |
| **GAP-01** | Toàn dự án | Hạ tầng | Neon Preview database isolation chưa được kiểm chứng độc lập (Release Gate trước migration/deploy Phase 8) | QA-WORK-04, 06 | **TEST GAP** | P2 | Môi trường Neon / Vercel | N/A | Chưa có công cụ đo độc lập | Xác minh chuỗi connection string qua metadata an toàn; nếu chưa cô lập thì cấm migration phá hủy | Phase 8 Beta Release Gate (trước migration/deploy) |
| **GAP-02** | Toàn dự án | Giao diện | Kiểm thử giao diện Mobile (375px) chưa thực hiện được qua Cloud Browser | QA-WORK-04, 06 | **TEST GAP** | P2 | Toàn bộ giao diện storefront & admin | N/A | Cloud Browser không đổi viewport | Chạy Playwright với mobile viewport (iPhone 13 / 375px) ở Phase 9 | Phase 9 E2E |
| **GAP-03** | Phase 4 | Thanh toán | Quét mã VietQR và khớp tiền từ ứng dụng ngân hàng thực tế | Toàn bộ QA reports | **TEST GAP** | P3 | Thanh toán VietQR | N/A | Đồ án demo phi thương mại | Kiểm tra đối soát bằng mã QR giả lập trên app sandbox/mô phỏng | Phase 9 Demo |
| **GAP-04** | Phase 6 | Nghiệp vụ | Vòng đời ghi dữ liệu Recurring (tạo lịch, cron sinh đơn, duyệt đơn nháp trên DB live) | QA-WORK-04 | **TEST GAP** | P2 | Phân hệ Recurring Orders | `9cd484a` | Unit tests 15/15 PASS | Thực hiện 1 kịch bản tạo lịch và duyệt đơn nháp hoàn chỉnh trong E2E trên DB cô lập | Phase 9 E2E |
| **GAP-05** | Phase 6 | Nghiệp vụ | Vòng đời ghi dữ liệu Pre-order (đặt cọc, Admin chốt vụ, khách ACCEPT/CANCEL trên DB live) | QA-WORK-04 | **TEST GAP** | P2 | Phân hệ Pre-order | `e6208a5`, `d0924fb` | Unit tests PASS | Thực hiện 1 kịch bản chốt vụ trong và ngoài biên độ trong E2E trên DB cô lập | Phase 9 E2E |
| **GAP-06** | Phase 7 | Báo cáo | Báo cáo doanh thu Recharts với dữ liệu đơn COMPLETED thực tế | QA-WORK-06 | **TEST GAP** | P3 | Phân hệ Reports | `2c7c57e` | Unit tests 13/13 PASS | Tạo 1 đơn COMPLETED qua seed/flow để kiểm tra hiển thị cột biểu đồ thật trên DB cô lập | Phase 9 E2E |
| **GAP-07** | Phase 8 | Vận chuyển | Tích hợp Shipping Engine vào luồng xác nhận đơn nháp định kỳ và đặt trước | Phase 8 Audit | **TEST GAP** | P2 | `actions/recurring.ts`, `actions/preorder.ts` | Dự kiến Phase 8 | Cần audit ở Batch 8A | Bảo đảm `shippingFee` tính đúng vào `total` & `depositAmount` của đơn định kỳ/đặt trước | Phase 8 |
| **GAP-08** | Phase 9 | Thông báo | Kết nối các `OrderEvent` (`ORDER_CREATED`, `DRAFT_EXPIRED`...) với Email SMTP & Zalo mock | Phase 9 Spec | **TEST GAP** | P2 | `src/lib/notifications/` | Dự kiến Phase 9 | Cần triển khai ở Phase 9 | Bắt sự kiện sau commit transaction để gửi email/thông báo không chặn nghiệp vụ | Phase 9 |
| **PH8A-FIN-01** | Phase 8A | Quyết toán / Pre-order | Pre-order Shortfall Refund gây tính thiếu tiền quyết toán cuối cùng (OBS-01) | QA-TASK-20 | **FIXED LOCAL ONLY** | P0 | `settlement.ts`, `actions/preorder.ts`, `api/qr/payment/[code]/route.ts` | Dự kiến DEV-TASK-20-FIX01 | 362/362 unit tests PASS (S1–S8 regression suite) | Khấu trừ khoản hoàn cọc do hụt sản lượng đã thực hiện khỏi grossPaid khi tính số tiền còn phải trả | DEV-TASK-20-FIX01 |

---

## 3. CHI TIẾT XÁC MINH CÁC LỖI VÀ VẤN ĐỀ PHASE 6

### PH6-01 — QW04-01: Pre-order Dropdown Labels
- **Hiện tượng gốc:** Tại trang `/san-pham/mang-cut-ben-tre`, trong box "Đặt Trước Vụ Mùa", khi người dùng chọn quy cách đóng gói (ví dụ "Rổ nhựa 20kg") hoặc địa chỉ nhận hàng, sau khi đóng menu select thì ô hiển thị bị vỡ thành chuỗi CUID/UUID nội bộ thay vì tên quy cách hoặc nhãn địa chỉ.
- **Mức ưu tiên:** Lúc phát hiện là lỗi giao diện non-blocker (`P3`), không chặn đặt hàng thành công.
- **Xác minh mã nguồn:**
  - File `src/lib/domain/preorder.ts`: Bổ sung 2 hàm thuần `formatPackagingLabel(pkg)` và `formatAddressLabel(addr)`.
  - File `src/app/san-pham/[slug]/preorder-box.tsx`: Render nhãn tường minh bên trong `<SelectValue>`:
    ```tsx
    <SelectValue placeholder="Chọn quy cách...">
      {selectedPackagingLabel || 'Chọn quy cách...'}
    </SelectValue>
    ```
  - Giá trị `value` gắn với `SelectTrigger` và state truyền vào `placePreorder` (`selectedPackagingId`, `addressId`) được giữ nguyên ID gốc, bảo đảm toàn vẹn dữ liệu backend.
- **Xác minh kiểm thử & Deployment:**
  - 5 unit test cases chuyên biệt trong `tests/unit/preorder.test.ts` (suite 7).
  - Commit triển khai: `a488a96` (`fix(preorder): display readable labels in select dropdowns`).
  - QA-WORK-05 đã retest và xác nhận thành công trên Vercel Beta (tầng Read-Only).
- **Kết luận:** **`VERIFIED FIXED`** (Mức độ ưu tiên `P3`).

---

### PH6-02 — Pre-order Decision PENDING & Dashboard State
- **Hiện tượng gốc:** Cần đảm bảo khi Admin chốt giá vụ mùa ngoài biên độ cam kết, hệ thống nhận diện đồng nhất trạng thái `preorderCustomerDecision` khi có giá trị `null` hoặc `'PENDING'` để không ẩn nhầm nút Chấp nhận/Từ chối của khách, và không hiển thị thông báo đã hủy khi khách chưa có phản hồi.
- **Xác minh mã nguồn:**
  - File `src/lib/domain/preorder.ts`: Hàm `isPreorderAwaitingCustomerDecision` kiểm tra:
    ```ts
    if (order.preorderCustomerDecision === 'ACCEPT' || order.preorderCustomerDecision === 'CANCEL') {
      return false
    }
    return true // Cả 'PENDING' lẫn null / undefined đều thể hiện đang chờ khách quyết định
    ```
  - File `src/lib/domain/dashboard.ts`: Hàm `getDashboardKpiMetrics` tách biệt hoàn toàn giữa `preorderAwaitingDecisionCount` (đơn cần khách quyết định) và `preorderWaitingHarvestCount` (đơn đang chờ thu hoạch), bảo đảm 4 nhóm KPI là mutually exclusive.
  - File `src/app/tai-khoan/don-hang/[code]/customer-order-view.tsx`: Khối quyết định giá mùa vụ chỉ hiển thị banner "Đã chấp nhận" hoặc "Đã từ chối" khi `decision === 'ACCEPT'` hoặc `'CANCEL'`. Nếu là `'PENDING'` hoặc `null`, luôn hiển thị 2 nút bấm thao tác cho khách hàng.
- **Xác minh kiểm thử:**
  - `tests/unit/dashboard.test.ts` (lines 170–218, 5 test cases trong Integration Check A).
  - Commit triển khai: `d0924fb` (Batch 6C).
- **Kết luận:** **`FIXED LOCAL ONLY`** (Đã kiểm chứng đầy đủ ở tầng Unit/Domain, chờ kiểm thử E2E tương tác ghi dữ liệu trên Beta).

---

### PH6-03 — Pre-order Delivery Date & Time Slot
- **Hiện tượng gốc:** Khi khách bấm ACCEPT giá vụ mùa ngoài biên độ, đơn chuyển sang `PROCESSING` nhưng cần đảm bảo `deliveryDate` và `timeSlot` được thiết lập chính xác, không bị ghi đè thành ngày trong quá khứ và tuân thủ quy tắc thời gian chuẩn bị (`earliestDeliveryDate`).
- **Xác minh mã nguồn:**
  - File `src/actions/preorder.ts` (lines 616–625 trong `customerDecidePreorder`):
    ```ts
    const leadTime = firstItem.packaging?.product?.leadTimeDays ?? 1
    const now = new Date()
    const minDeliveryDate = earliestDeliveryDate(now, [leadTime])
    const deliveryDate =
      order.deliveryDate && isDeliveryDateValid(order.deliveryDate, minDeliveryDate)
        ? order.deliveryDate
        : minDeliveryDate
    const timeSlot = order.timeSlot ?? TimeSlot.MORNING
    ```
  - Nếu Admin đã gán ngày giao hợp lệ lúc chốt mùa vụ, hệ thống bảo lưu chính xác ngày đó. Nếu thiếu hoặc ngày đã quá hạn, tự động fallback sang `minDeliveryDate` hợp lệ gần nhất.
- **Xác minh kiểm thử:**
  - `tests/unit/dashboard.test.ts` (lines 271–300, 2 test cases trong Integration Check B).
  - Commit triển khai: `d0924fb` (Batch 6C).
- **Kết luận:** **`FIXED LOCAL ONLY`** (Local QA PASS, chờ Business E2E Write runtime trên Beta).

---

### PH6-04 — Legacy Pre-order & Recurring Issues (Đính chính mã cũ)
- **Mức ưu tiên:** `P1 (lịch sử trước Phase 6)` — Trước đây là Demo Blocker làm nghẽn kịch bản đặt hàng của khách.
- **Rà soát các mã lỗi lịch sử:**
  1. `WEB-PRE-01` (trước đây QA gọi là Work `BUG-01` hoặc `BUG-07`): Giao diện banner Pre-order trên trang chủ hứa hẹn giữ giá nhưng bấm vào lại chạy vào luồng giỏ hàng thông thường.
     $\rightarrow$ Đã giải quyết triệt để ở Batch 6B (commit `e6208a5`) với widget đặt trước vụ mùa độc lập (`preorder-box.tsx`), máy trạng thái `PREORDER_WAITING`, hợp đồng cọc 30%, biên độ ±10%.
  2. Ngày giao hàng Pre-order trước mùa vụ: Khách không phải chọn ngày giao trước khi thu hoạch (`deliveryDate = null` khi đặt).
  3. Work `BUG-09`: Route `/tai-khoan/dinh-ky` từng là placeholder 404 / đang phát triển.
     $\rightarrow$ Đã giải quyết triệt để ở Batch 6A (commit `9cd484a`) với giao diện quản lý lịch định kỳ đầy đủ, CRUD lịch, tính tiền ước tính, xác nhận đơn nháp.
- **Kết luận:** **`VERIFIED FIXED`** (Đã giải quyết triệt để trong Phase 6; đã xác minh qua QA-WORK-04 trên Vercel Beta tầng Read-Only).

---

### PH6-05 — Recurring DRAFT_EXPIRED & Tích hợp Phase 9
- **Hiện tượng:** Logic quét đơn nháp định kỳ quá hạn xác nhận (`deliveryDate - leadTimeDays < today`) phát sinh sự kiện `DRAFT_EXPIRED`.
- **Xác minh mã nguồn:**
  - File `src/lib/services/order-expiration.ts`: Xử lý nguyên tử trong transaction bằng `updateMany`, chuyển đơn sang `CANCELLED`, `cancelledBy = SYSTEM`, và ghi `OrderEvent(type = 'DRAFT_EXPIRED', fromStatus = DRAFT, toStatus = CANCELLED)`.
  - File `tests/unit/order-expiration.test.ts`: Bộ test case kiểm tra tính an toàn đồng thời (concurrency safety) và chống duplicate cancel.
  - Tương thích Phase 9: Theo bảng phân bổ sự kiện của Phase 9 (`KE_HOACH_TRIEN_KHAI.md` line 675), các đơn chuyển sang `CANCELLED` sẽ gửi thông báo lý do hủy cho khách. Sự kiện `DRAFT_EXPIRED` hoàn toàn sẵn sàng để cắm vào kênh Email/ZNS.
- **Kết luận:** **`NOT A BUG / FUTURE INTEGRATION`** (Hoạt động đúng thiết kế, sẽ nối kênh thông báo ở Phase 9).

---

## 4. MA TRẬN TEST GAPS VÀ RÀNG BUỘC AN TOÀN

Các mục dưới đây **chưa phải là BUG** mà là các khoảng trống kiểm thử do các đợt QA trên Beta trước đây đều tuân thủ nguyên tắc an toàn **Read-Only (không ghi dữ liệu)**.

### 4.1. Ràng buộc an toàn nghiêm ngặt cho việc kiểm thử
> [!CAUTION]
> **RÀNG BUỘC AN TOÀN DỮ LIỆU TUYỆT ĐỐI:**
> 1. **Điều kiện chạy E2E có ghi dữ liệu (`GAP-04`, `GAP-05`, `GAP-06`):** CHỈ ĐƯỢC PHÉP CHẠY khi đã hoàn thành xác minh `GAP-01` (xác nhận Neon Beta/Preview hoàn toàn cô lập) HOẶC chạy trên database local/ephemeral test.
> 2. **Tuyệt đối không chạy:** Bất kỳ test script tự động ghi dữ liệu (Playwright Write) hoặc cron test tự động nào trên database đang dùng chung với Production.
> 3. **Lưu ý dữ liệu mẫu `WEB-IMG-04` (ảnh thanh long ruột đỏ):** Việc cập nhật URL ảnh trong `prisma/seed.ts` **không tự động làm thay đổi** dữ liệu đã nạp trên Neon Beta hiện hữu. Cần có kế hoạch reseed hoặc cập nhật SQL có kiểm soát khi bước vào giai đoạn Final Stabilization.

### 4.2. Bảng ma trận 8 Test Gaps:
| Mã GAP | Hạng mục | Phạm vi cần kiểm chứng | Rủi ro nếu không kiểm thử | Kế hoạch kiểm chứng đề xuất | Thời điểm xử lý |
|---|---|---|---|---|---|
| **GAP-01** | Neon Database Isolation | Phân nhánh và cô lập dữ liệu giữa Neon Preview và Production | Ghi đè dữ liệu demo dùng chung nếu biến môi trường trỏ nhầm; chạy migration phá hủy dữ liệu | Kiểm tra metadata và connection string an toàn (không lộ secret). **RELEASE GATE CHO PHASE 8 BETA DEPLOYMENT**. Nếu chưa cô lập, cấm migration phá hủy. | Phase 8 Beta Release Gate (trước migration/deploy) |
| **GAP-02** | Mobile Viewport (375px) | Trải nghiệm giao diện trên màn hình di động nhỏ | Tràn ngang, vỡ flex/grid, nút bấm bị che khuất trên mobile | Bổ sung Playwright test suite chạy trên profile Mobile Chrome 375px | Phase 9 E2E |
| **GAP-03** | Thanh toán VietQR thực tế | Khách hàng dùng app ngân hàng quét mã VietQR thật | Độ dài nội dung chuyển khoản bị cắt trên một số app ngân hàng | Thử nghiệm quét thực tế bằng 1–2 ứng dụng ngân hàng thông dụng trong buổi tổng duyệt | Phase 9 Demo |
| **GAP-04** | Vòng đời ghi dữ liệu Recurring | Tạo lịch định kỳ $\rightarrow$ Cron sinh đơn nháp $\rightarrow$ Khách duyệt đơn $\rightarrow$ Thanh toán | Race condition khi cron chạy trùng thời điểm khách sửa lịch | Viết test script E2E Playwright chạy qua tài khoản test riêng trên DB đã xác minh cô lập | Phase 9 E2E |
| **GAP-05** | Vòng đời ghi dữ liệu Pre-order | Đặt cọc $\rightarrow$ Admin chốt vụ $\rightarrow$ Khách ACCEPT/CANCEL $\rightarrow$ Hoàn cọc | Lệch số tiền hoàn cọc thực tế trong giao dịch ngân hàng | Viết test script E2E Playwright giả lập kịch bản trong & ngoài biên độ trên DB đã xác minh cô lập | Phase 9 E2E |
| **GAP-06** | Báo cáo Recharts có dữ liệu | Render biểu đồ doanh thu và sản lượng khi có đơn COMPLETED | Lỗi hiển thị Recharts Tooltip hoặc trục Y khi doanh thu hàng trăm triệu | Chạy seed 1–2 đơn COMPLETED có ngày giao trong kỳ để kiểm tra Recharts trên DB đã xác minh cô lập | Phase 9 E2E |
| **GAP-07** | Tích hợp Phí ship Phase 8 | Phí ship được cộng vào đơn định kỳ và đơn đặt trước | Đơn nháp tính thiếu phí ship dẫn đến sai lệch số tiền thanh toán | Đưa vào kiểm tra ràng buộc ngay trong Batch 8A | Phase 8 |
| **GAP-08** | Tích hợp Notification Phase 9 | Các OrderEvent kích hoạt gửi Email SMTP / ZNS mock | Lỗi bất đồng bộ trong channel làm gián đoạn transaction đơn | Thiết kế channel fire-and-forget bọc try/catch sau commit ở Phase 9 | Phase 9 |

---

## 5. KẾ HOẠCH XỬ LÝ THEO GIAI ĐOẠN

Thay vì dồn toàn bộ vào đợt sau Phase 9, lộ trình xử lý các mục trong Master Backlog được phân bổ chính xác theo từng mốc phát triển:

### Mốc 1: Separate Phase 7 Hotfix — BEFORE Batch 8A (ĐÃ HOÀN TẤT LOCAL — COMMIT `3b67d06`)
Hai lỗi tồn đọng từ Phase 7 đã được xử lý trong đợt Hotfix chuyên biệt (commit `3b67d06`, 324/324 tests PASS, build PASS) trước khi bước vào Phase 8:
1. **`QW06-OBS-01` (React #418):** Thêm `{ timeZone: 'Asia/Ho_Chi_Minh' }` qua `formatVietnamDate` và `formatVietnamDateTime` tại `order-detail-client.tsx`, `customer-management.tsx`, `delivery-date.ts`. (Trạng thái: `FIXED LOCAL ONLY`).
2. **`QW06-MINOR-01` (Recharts Empty State):** Cập nhật điều kiện hiển thị biểu đồ rỗng sạch sẽ kèm icon tại `reports-client.tsx` khi có 0 đơn hàng `COMPLETED`. (Trạng thái: `FIXED LOCAL ONLY`).

### Mốc 2: Release Gate Phase 8 Beta Deployment
Trước khi apply migration hoặc deploy code phụ thuộc schema của Phase 8 (Vận chuyển) lên Vercel Beta:
1. **`GAP-01` (Neon Database Isolation):** Xác minh cấu hình môi trường giữa Preview và Production qua metadata an toàn. Nếu chưa có DB branch riêng, **tuyệt đối không chạy migration phá hủy dữ liệu**.
2. **`GAP-07` (Tích hợp Phí ship):** Bảo đảm tính tương thích của Shipping Engine với đơn Recurring và Pre-order ngay trong Batch 8A.

### Mốc 3: Final Stabilization (Sau khi hoàn tất Phase 9)
Sau khi hoàn thành Phase 9 (Thông báo đa kênh & Triển khai hoàn tất):
1. **Lưu trữ & Dữ liệu:**
   - **`SRC-DEPLOY-01` (Cloud Storage):** Cấu hình Supabase Storage hoặc Vercel Blob trong `src/lib/storage.ts` để lưu ảnh khiếu nại bền vững thay cho ephemeral `/public/uploads`.
   - **`WEB-IMG-04` (Ảnh Thanh Long Ruột Đỏ):** Cập nhật URL ảnh ruột đỏ chuẩn trong seed và reseed/update DB Beta có kiểm soát.
2. **Kiểm thử hồi quy toàn diện (Comprehensive E2E & Final Demo Acceptance):**
   - **`GAP-02` (Mobile Viewport):** Chạy Playwright test suite trên profile Mobile Chrome 375px.
   - **`GAP-03` (VietQR thực tế):** Tổng duyệt thanh toán quét mã VietQR thật trên app ngân hàng sandbox/mô phỏng.
   - **`GAP-04`, `GAP-05`, `GAP-06` (Business E2E Write):** Chạy các luồng E2E ghi dữ liệu cho Recurring, Pre-order và Báo cáo Recharts trên DB đã cô lập.
   - **`WEB-POST-01` (Debounce số lượng giỏ):** Retest hành vi concurrency trên trình duyệt thực tế.
   - **`GAP-08` (Kênh thông báo Phase 9):** Kiểm tra tích hợp Email SMTP và Mock ZNS sau commit.
