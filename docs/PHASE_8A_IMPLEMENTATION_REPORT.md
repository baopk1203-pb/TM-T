# BÁO CÁO NGHIỆM THU KỸ THUẬT BATCH 8A
## SHIPPING ENGINE & CHECKOUT IMPLEMENTATION (DEV-TASK-20)

**Dự án:** Nông Sản B2B (E-commerce Platform)
**Nhánh Git:** `beta`
**Trạng thái triển khai:** HOÀN THÀNH TOÀN BỘ TRÊN LOCAL / STATIC ENVIRONMENT
**Tiêu chí an toàn:** ZERO Neon Remote DB Mutation (GAP-01) — Không commit trước khi QA độc lập chấp thuận.

---

## 1. GIT PREFLIGHT

- **Nhánh hiện tại:** `beta`
- **HEAD baseline trước Batch 8A:** `286df64` (`docs: update master backlog and add phase 7 hotfix report`)
- **Tình trạng working tree:** Sạch, không có conflict, không có stash dở dang. Các thay đổi chỉ thuộc phạm vi Batch 8A.
- **Cam kết an toàn:** Không chạy `git commit`, không push `origin/beta`, không merge `main`, không kích hoạt Vercel build từ xa.

---

## 2. DANH MỤC CÁC FILE ĐÃ TẠO VÀ CHỈNH SỬA

| STT | Đường dẫn file | Thao tác | Mô tả tóm tắt |
| :--- | :--- | :--- | :--- |
| 1 | `nong-san-b2b/prisma/schema.prisma` | Chỉnh sửa | Bổ sung enum `VehicleType`, `ShipmentStatus`, bảng `ShippingRate`, `Shipment`, `AppSetting`, và trường nullable trên `Order`. |
| 2 | `nong-san-b2b/prisma/migrations/20261019193200_phase8_shipping_engine/migration.sql` | **Tạo mới** | File SQL migration tương thích ngược, sinh offline không chạm remote DB. |
| 3 | `nong-san-b2b/.env.example` | Chỉnh sửa | Bổ sung biến môi trường tùy chọn `GOOGLE_MAPS_API_KEY=""`. |
| 4 | `nong-san-b2b/src/lib/domain/shipping/index.ts` | **Tạo mới** | Domain Shipping Engine: Haversine, Google Routes API fallback, bảng cước, Centroid tọa độ TP.HCM. |
| 5 | `nong-san-b2b/src/actions/order.ts` | Chỉnh sửa | Server action `calculateShippingQuoteAction` và tái tính toán cước ship an toàn ở server trong `placeOrder`. |
| 6 | `nong-san-b2b/src/actions/preorder.ts` | Chỉnh sửa | Tích hợp tính cước ship vào tổng đơn đặt trước (`total = subtotal + shippingFee`) và tiền cọc 30%. |
| 7 | `nong-san-b2b/src/actions/recurring.ts` | Chỉnh sửa | Kiểm tra báo giá cước vận chuyển và lưu snapshot vào đơn hàng định kỳ khi kích hoạt. |
| 8 | `nong-san-b2b/src/lib/services/recurring-generator.ts` | Chỉnh sửa | Tự động ước tính phí ship cho các đơn nháp định kỳ mà không làm crash cron job khi thiếu GPS. |
| 9 | `nong-san-b2b/src/app/thanh-toan/checkout-view.tsx` | Chỉnh sửa | Bổ sung Bước 3 "Phương thức & Chi phí Vận chuyển", selector loại xe (NORMAL/COLD), hiển thị badge fallback, cấm vượt 100km. |
| 10 | `nong-san-b2b/src/app/thanh-toan/page.tsx` | Chỉnh sửa | Bổ sung trường `lat` và `lng` vào truy vấn Prisma lấy danh sách địa chỉ nhận hàng. |
| 11 | `nong-san-b2b/tests/unit/shipping.test.ts` | **Tạo mới** | 23 unit tests bao quát toàn bộ domain Shipping Engine, 4 test cases bắt buộc F1–F4, mock Google API, công thức tài chính. |
| 12 | `nong-san-b2b/tests/unit/recurring.test.ts` | Chỉnh sửa | Cập nhật kỳ vọng phí vận chuyển và tổng tiền đơn định kỳ theo chuẩn Phase 8A. |

---

## 3. PRISMA SCHEMA & OFFLINE MIGRATION

### 3.1. Các thực thể mới
- **`enum VehicleType`:** `NORMAL` (Xe tiêu chuẩn thùng kín), `COLD` (Xe đông lạnh chuyên dụng).
- **`enum ShipmentStatus`:** `PENDING`, `DISPATCHED`, `DELIVERED`, `CANCELLED`.
- **`model ShippingRate`:** Bảng cấu hình bảng giá cước động (chuẩn bị sẵn sàng cho Batch 8B admin CRUD):
  - `vehicleType`, `minGrams`, `baseFee`, `perKm`, `isActive`.
- **`model Shipment`:** Quản lý vận đơn chuyên sâu:
  - `code` (unique), `orderId` (unique), `vehicleType`, `distanceKm`, `shippingFee`, `driverName`, `driverPhone`, `licensePlate`, `status`, `dispatchedAt`, `deliveredAt`, `note`.
- **`model AppSetting`:** Cấu hình hệ thống chung (Kho hàng mặc định, bán kính tối đa, API keys).

### 3.2. Mở rộng model `Order` (Backward-Compatible)
- `shippingDistanceKm Float?`: Khoảng cách vận chuyển thực tế tính toán (km).
- `shippingVehicleType VehicleType?`: Loại phương tiện sử dụng cho đơn hàng.
- `shipment Shipment?`: Quan hệ 1-1 với vận đơn tương ứng.

> [!NOTE]
> Tất cả các trường mới thêm vào model `Order` đều là **nullable (`?`)**. Đơn hàng từ Phase 1 đến Phase 7 hoàn toàn không bị ảnh hưởng, giữ nguyên tính toàn vẹn 100%.

### 3.3. Offline Migration Script
Migration file được tạo tại `prisma/migrations/20261019193200_phase8_shipping_engine/migration.sql` bằng phương pháp so sánh offline (`prisma migrate diff`), đã chạy xác thực thành công qua `npx prisma validate` và tái sinh Prisma Client qua `npx prisma generate`.

---

## 4. AN TOÀN DATABASE TỪ XA (GAP-01 ISOLATION)

- Tuân thủ tuyệt đối quy định an toàn cơ sở dữ liệu `GAP-01` (Master Deferred Backlog):
  - **KHÔNG chạy** `prisma migrate deploy` lên Neon Production/Preview.
  - **KHÔNG chạy** `prisma db push` làm thay đổi cấu trúc database từ xa.
  - **KHÔNG chạy** `db seed` hay chèn dữ liệu thử nghiệm vào môi trường Cloud.
- Quá trình build và unit test được thực hiện độc lập với schema cục bộ và database client đã sinh.

---

## 5. SHIPPING ENGINE CORE & CƠ CHẾ FALLBACK

### 5.1. Các hàm nghiệp vụ thuần (`src/lib/domain/shipping/index.ts`)
1. **`haversineKm(lat1, lon1, lat2, lon2)`:** Tính khoảng cách đường chim bay theo hình cầu Trái Đất (bán kính $R = 6371\text{ km}$).
2. **`estimateRoadDistanceKm(straightKm)`:** Ước tính khoảng cách đường bộ bằng công thức $d_{\text{road}} = \text{round}(d_{\text{straight}} \times 1.3, 1)$.
3. **`resolveVehicleType(items, requestedVehicleType)`:** Kiểm tra giỏ hàng: nếu có bất kỳ sản phẩm nào có cờ `requiresCold: true`, hệ thống tự động khóa và bắt buộc dùng `COLD`. Nếu tất cả là hàng thường, tôn trọng lựa chọn `NORMAL` hoặc `COLD` của khách hàng.
4. **`findShippingRate(rates, vehicleType, totalGrams)`:** Tra cứu bảng giá cước phù hợp nhất theo loại xe và bậc tải trọng (sắp xếp giảm dần theo `minGrams`).
5. **`computeShippingFee({ totalGrams, vehicleType, distanceKm, maxRadiusKm })`:**
   - Làm tròn lên km tiếp theo: $km_{\text{bill}} = \lceil distanceKm \rceil$.
   - Tính phí: $Fee = baseFee + km_{\text{bill}} \times perKm$.
   - Ném ngoại lệ an toàn nếu khoảng cách vượt quá $maxRadiusKm$ (100km).
6. **`resolveCentroid(addressText, district, province)`:** Bản đồ tọa độ đại diện trung tâm (Centroid) của 22 Quận/Huyện/TP. Thủ Đức thuộc TP.HCM, tự động áp dụng khi địa chỉ khách hàng chưa có tọa độ GPS ghim trên bản đồ.

### 5.2. Tích hợp Google Routes API & Fallback Matrix
- Hàm `fetchGoogleRoutesDistance` gọi Google Routes API v2 với timeout cố định 3000ms (`AbortController`).
- **Trường hợp Fallback sang Haversine $\times 1.3$:**
  - Chưa cấu hình `GOOGLE_MAPS_API_KEY` trong `.env`.
  - Google Routes API trả về mã lỗi HTTP ($\ge 400$).
  - Request bị quá thời gian chờ (Timeout > 3000ms) hoặc mất kết nối mạng.
- **Trường hợp dùng Centroid Fallback:**
  - Địa chỉ nhận hàng chưa có tọa độ GPS (`lat = null`, `lng = null`) nhưng có thông tin Quận/Huyện TP.HCM.
- **Cờ hiển thị trên giao diện:** `isEstimated: true` kèm thông báo giải thích chi tiết và huy hiệu cảnh báo màu vàng để khách hàng luôn minh bạch về giá cước.

---

## 6. GIAO DIỆN CHECKOUT & CÔNG THỨC TÀI CHÍNH

### 6.1. UI Checkout (`src/app/thanh-toan/checkout-view.tsx`)
- Thêm **Bước 3: Phương thức & Chi phí Vận chuyển** ngay trước Bước 4 (Hình thức thanh toán):
  - Card chọn loại xe: **Xe Tiêu Chuẩn (NORMAL)** vs **Xe Lạnh Chuyên Dụng (COLD)**.
  - Hiển thị badge: `Đang chọn`, `Bắt buộc theo SP`, `Nâng cấp`, `Ước tính đường bộ`.
  - Hiển thị thông tin kho xuất hàng: `Kho Tổng TP.HCM - Nông Sản B2B (TP. Thủ Đức, bán kính tối đa 100km)`.
  - Khi địa chỉ xa hơn 100km hoặc không thể tính cước: Hiển thị thông báo lỗi màu đỏ và vô hiệu hóa nút "Xác nhận đặt hàng" / "Thanh toán".

### 6.2. Đồng nhất công thức tài chính
$$\text{total} = \text{subtotal} + \text{shippingFee}$$
$$\text{depositAmount} = \left\lceil \frac{\text{total} \times 0.3}{1000} \right\rceil \times 1000$$

- Cả 2 hình thức thanh toán **FULL (100%)** và **DEPOSIT_30 (Đặt cọc 30%)** đều sử dụng chung `total` đã bao gồm `shippingFee`.
- Server Action `placeOrder` thẩm tra độc lập toàn bộ cước phí ở phía server, ngăn chặn tuyệt đối việc client can thiệp hay sửa đổi giá trị `shippingFee`.

---

## 7. TƯƠNG THÍCH ĐƠN HÀNG ĐẶT TRƯỚC (PRE-ORDER) VÀ ĐỊNH KỲ (RECURRING)

1. **Pre-order (`placePreorder`):**
   - Khi đặt trước hàng thu hoạch tương lai, hệ thống tính báo giá cước vận chuyển dựa trên địa chỉ giao hàng và loại hàng.
   - Cước ship được cộng vào `total` và tính tiền cọc 30% (`depositAmount`).
   - Các trường `shippingFee`, `shippingDistanceKm`, `shippingVehicleType` được lưu lại dưới dạng snapshot trên đơn hàng.
2. **Recurring Orders (`recurring-generator` & `confirmRecurringDraft`):**
   - Hàm `generateRecurringDraftOrders` tự động tính cước vận chuyển an toàn cho đơn hàng lặp lại định kỳ dựa trên địa chỉ đã lưu của lịch định kỳ.
   - Nếu địa chỉ thiếu GPS, hệ thống dùng Centroid hoặc gán `shippingFee = 0` kèm cảnh báo log thay vì làm crash cron job hệ thống.
   - Khi khách hàng xác nhận đơn nháp định kỳ (`confirmRecurringDraft`), cước phí được cập nhật chính xác và kiểm tra bán kính 100km.

---

## 8. KẾT QUẢ KIỂM THỬ BỐN TEST CASES BẮT BUỘC (F1 – F4)

| Test Case | Tham số đầu vào | Bậc cước áp dụng | Công thức & Khoảng cách tính cước | Kết quả thực tế | Trạng thái |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **F1** | NORMAL, 210kg, 23.4km | Base: 150.000đ, Km: 8.000đ | $\lceil 23.4 \rceil = 24\text{km} \implies 150.000 + 24 \times 8.000$ | **342.000 đ** | **PASS** |
| **F2** | COLD, 600kg, 10.2km | Base: 450.000đ, Km: 18.000đ | $\lceil 10.2 \rceil = 11\text{km} \implies 450.000 + 11 \times 18.000$ | **648.000 đ** | **PASS** |
| **F3** | NORMAL, 10kg, 0.5km | Base: 150.000đ, Km: 8.000đ | $\lceil 0.5 \rceil = 1\text{km} \implies 150.000 + 1 \times 8.000$ | **158.000 đ** | **PASS** |
| **F4** | NORMAL, 100kg, 100.1km | Max radius: 100km | $100.1\text{km} > 100\text{km}$ | **Chặn checkout & Báo lỗi bán kính** | **PASS** |

---

## 9. BÁO CÁO QUALITY GATES

1. **`npm run lint`:**
   - Kết quả: **PASS (0 errors, 1 pre-existing warning)**.
   - Đã xử lý triệt để 2 lỗi React 19 `react-hooks/set-state-in-effect`, dọn dẹp các unused variables và loại bỏ hoàn toàn `as any` trong file test.
2. **`npm run typecheck` (`tsc --noEmit`):**
   - Kết quả: **PASS (0 errors)**.
3. **`npm test` (Vitest):**
   - Kết quả: **PASS (28/28 test suites, 347/347 unit tests)**.
   - Thời gian thực thi: 1.60s.
4. **`npm run build` (`next build` Turbopack):**
   - Kết quả: **PASS (Tất cả 36 routes biên dịch và tối ưu hóa thành công)**.
5. **`git diff --check`:**
   - Kết quả: **PASS (0 lỗi whitespace hoặc conflict markers)**.

---

## 10. RỦI RO CHƯA GIẢI QUYẾT & ĐÁNH ĐỔI TÀI CHÍNH (PO REVIEW)

### Vấn đề: Phân bổ tiền cọc Pre-order và Cơ chế hoàn tiền thiếu hụt (Settlement Engine)
- **Hiện trạng cốt lõi:**
  - Logic thanh toán quyết toán Pre-order trong `src/lib/domain/settlement.ts` (`computePreorderShortfallRefund`) tính số tiền hoàn lại khi nông sản hụt sản lượng dựa trên:
    $$\text{refundAmount} = \max(0, \text{depositAmount} - \text{actualTotal})$$
  - Khi bổ sung `shippingFee` vào `total` của đơn Pre-order, `depositAmount` ($30\%$) được tính trên $(\text{subtotal} + \text{shippingFee})$.
  - Do chi phí vận chuyển là cố định theo chuyến xe và quãng đường (không phụ thuộc vào việc sản lượng thu hoạch thực tế hụt 5% hay 10%), việc gộp chung phí ship vào tổng để hoàn cọc theo tỷ lệ có thể khiến khoản tiền cọc dùng để bảo đảm chuyến xe bị khấu trừ nếu sản lượng hụt nghiêm trọng.
- **Biện pháp xử lý của DEV:**
  - DEV giữ nguyên toàn bộ mã nguồn của Settlement Engine (`src/lib/domain/settlement.ts`) theo đúng chỉ thị, không tự ý sửa đổi kiến trúc tài chính cốt lõi.
  - Đề xuất PO xem xét trong giai đoạn tối ưu hóa (Phase 8B hoặc Final Stabilization): Liệu cước vận chuyển của đơn đặt trước có cần tách riêng thành một khoản thanh toán/quyết toán độc lập sau thu hoạch hay giữ nguyên như hiện tại.

---

## 11. BẢNG KIỂM TRA CHO QA ĐỘC LẬP (QA AUDIT CHECKLIST)

QA độc lập có thể kiểm tra trực tiếp trên branch `beta` (chưa commit) theo checklist:
- [ ] `git status` hiển thị đúng danh mục 10 file modified, 2 untracked items (migration folder và unit test).
- [ ] Chạy `npm test` xác nhận 347/347 tests pass.
- [ ] Chạy `npx vitest run tests/unit/shipping.test.ts` kiểm tra 23 shipping unit tests.
- [ ] Chạy `npm run lint` xác nhận 0 errors.
- [ ] Chạy `npm run typecheck` xác nhận 0 errors.
- [ ] Chạy `npm run build` xác nhận Next.js build thành công.
- [ ] Kiểm tra file `prisma/migrations/20261019193200_phase8_shipping_engine/migration.sql` đảm bảo tất cả các cột mới trên `Order` đều là nullable.

---

## 12. GIỚI HẠN RUNTIME CHƯA XÁC MINH TRÊN MÔI TRƯỜNG CLOUD

1. **Google Maps API Key thực tế:** Do môi trường test chưa được cấp key thật có kích hoạt Routes API v2, toàn bộ quá trình kiểm thử tự động đang chạy thông qua cơ chế Fallback Haversine $\times 1.3$ và mock test. Khi có key thật trên production, cần smoke test 1 lượt gọi API thực tế.
2. **Neon Database Push:** Do tuân thủ GAP-01, cấu trúc bảng mới chưa được áp dụng trên Neon DB. Giao diện Checkout hiện tại hoạt động hoàn hảo ở mức logic và unit test, nhưng sẽ cần migration remote có kiểm soát khi PO cho phép triển khai Cloud.

---
**KẾT LUẬN DEV:** BATCH 8A ĐÃ HOÀN TẤT THÀNH CÔNG Ở PHẠM VI LOCAL. TẠM DỪNG MỌI THAO TÁC GIT COMMIT ĐỂ CHỜ KẾT QUẢ NGHIỆM THU TỪ QA ĐỘC LẬP.
