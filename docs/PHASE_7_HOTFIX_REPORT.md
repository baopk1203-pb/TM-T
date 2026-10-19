# BÁO CÁO HOÀN THÀNH: HOTFIX PHASE 7 — REACT #418 & RECHARTS EMPTY STATE (DEV-TASK-18)

> **Dự án:** Website Thương mại Điện tử B2B Nông Sản – Trái cây  
> **Nhánh thực hiện:** `beta`  
> **Commit Code:** `3b67d06` (`fix(ui): stabilize vietnam timezone rendering and report empty states`)  
> **Commit Docs:** `3f9a590` (`docs: update master backlog after phase 7 hotfix`)  
> **Thời điểm hoàn tất:** 19/10/2026  
> **Trạng thái:** **READY FOR INDEPENDENT QA / LOCAL ACCEPTANCE** (Chưa deploy, chưa push remote)

---

## 1. NGUYÊN NHÂN ĐÃ XÁC MINH VÀ PHẦN CÒN NGHI NGỜ

### A. Đã xác minh từ mã nguồn (Confirmed Source Logic)
1. **Lệch múi giờ Hydration UTC vs UTC+7 (`QW06-OBS-01`):**
   - Vercel Serverless Function thực thi SSR trong môi trường múi giờ chuẩn quốc tế **`UTC`**.
   - Khi component gọi `Date.prototype.toLocaleString('vi-VN')` hoặc `toLocaleDateString('vi-VN')` mà **không truyền `timeZone: 'Asia/Ho_Chi_Minh'`**, Node.js trên server sẽ định dạng ngày giờ theo múi giờ máy chủ (`UTC`).
   - Khi client browser ở Việt Nam (`UTC+7`) tải HTML về và chạy hydration, JavaScript engine của trình duyệt định dạng lại giá trị theo múi giờ máy người dùng (`Asia/Ho_Chi_Minh`), gây lệch `+7 giờ` (ví dụ `05:30:00` trên server vs `12:30:00` trên client) hoặc thậm chí nhảy sang ngày hôm sau nếu tạo đơn vào buổi tối.
   - Sự không khớp này kích hoạt cảnh báo **`Minified React error #418`** (*Hydration failed because the initial UI does not match what was rendered on the server*).
2. **Recharts Empty State khi 0 đơn COMPLETED (`QW06-MINOR-01`):**
   - Hàm `buildRevenueTimeline` luôn tạo đủ 7 mốc ngày trong chu kỳ lọc (`timeline.points.length = 7`) kể cả khi không có đơn hàng nào (`revenue = 0`, `kg = 0`).
   - Component `reports-client.tsx` kiểm tra điều kiện render biểu đồ bằng `isMounted && timeline.points.length > 0`. Do độ dài mảng luôn bằng 7, Recharts vẫn cố gắng vẽ `<BarChart>` với trục Y từ `0k` đến `0k` và các cột rỗng, thay vì chuyển sang khối thông báo rỗng.

### B. Phần còn nghi ngờ (Suspected / Needs Runtime Retest)
- QA Work chỉ quan sát thấy 1 dòng log `Minified React error #418` trong console Beta tại thời điểm `12:57:43 GMT+7`, trong chuỗi thao tác: `/admin/bao-cao` $\rightarrow$ `/admin/khach-hang` $\rightarrow$ `/admin/don-hang/[code]` $\rightarrow$ `/admin/nhom-khach` $\rightarrow$ `/admin` $\rightarrow$ `/admin/bao-cao`.
- Mặc dù việc chuẩn hóa múi giờ loại bỏ hoàn toàn các điểm mismatch đã xác minh, **chưa thể tuyên bố đã diệt 100% mọi nguyên nhân tiềm ẩn của React #418 trên môi trường Vercel Beta** cho đến khi QA Work thực hiện retest trực tiếp trên trình duyệt.

---

## 2. CÁC TẬP TIN ĐÃ CHỈNH SỬA

| Tập tin | Phân hệ | Nội dung chỉnh sửa |
|---|---|---|
| `src/lib/domain/delivery-date.ts` | Domain / Date | Thêm 2 hàm chuẩn hóa: `formatVietnamDate` và `formatVietnamDateTime` sử dụng `VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh'`. |
| `src/lib/utils.ts` | Core Utility | Re-export `VIETNAM_TIMEZONE`, `formatVietnamDate`, `formatVietnamDateTime` phục vụ dùng chung UI. |
| `src/app/admin/don-hang/[code]/order-detail-client.tsx` | Admin Order | Thay thế 8 vị trí format ngày giờ không múi giờ bằng `formatVietnamDateTime` và `formatVietnamDate`. |
| `src/app/admin/khach-hang/customer-management.tsx` | Admin CRM | Chuẩn hóa format ngày tạo đơn trong lịch sử mua hàng khách hàng bằng `formatVietnamDate`. |
| `src/app/admin/bao-cao/reports-client.tsx` | Admin Reports | Siết chặt điều kiện render biểu đồ: chỉ render khi `timeline.totalCompletedOrders > 0 \|\| timeline.totalRevenue > 0`; hiển thị Empty State kèm icon `BarChart3`. |
| `tests/unit/phase7-hotfix.test.ts` | Test Suite | 10 test cases mới kiểm tra tính nhất quán múi giờ, mốc sát nửa đêm, bảo toàn logic hết hạn và điều kiện render biểu đồ. |
| `docs/MASTER_DEFERRED_ISSUES.md` | Backlog Doc | Cập nhật `QW06-OBS-01` và `QW06-MINOR-01` sang trạng thái `FIXED LOCAL ONLY` tại commit `3b67d06`. |

---

## 3. CHI TIẾT SỬA ĐỔI TIMEZONE (`QW06-OBS-01`)

### A. Hàm tiện ích dùng chung (`delivery-date.ts` & `utils.ts`)
```ts
export const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh'

export function formatVietnamDate(
  date: Date | string | number | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (!date) return ''
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('vi-VN', {
    timeZone: VIETNAM_TIMEZONE,
    ...options,
  })
}

export function formatVietnamDateTime(
  date: Date | string | number | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (!date) return ''
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('vi-VN', {
    timeZone: VIETNAM_TIMEZONE,
    ...options,
  })
}
```

### B. Các điểm thay thế trong `order-detail-client.tsx`:
1. **Dòng 542 (Header đơn hàng):**  
   - Cũ: `Tạo lúc {new Date(order.createdAt).toLocaleString('vi-VN')}`  
   - Mới: `Tạo lúc {formatVietnamDateTime(order.createdAt)}`
2. **Dòng 629 (Cảnh báo quá hạn thanh toán):**  
   - Cũ: `{new Date(order.paymentDueAt!).toLocaleString('vi-VN')}`  
   - Mới: `{formatVietnamDateTime(order.paymentDueAt)}`
3. **Dòng 691 (Ngày giao hàng dự kiến):**  
   - Cũ: `new Date(order.deliveryDate).toLocaleDateString('vi-VN')`  
   - Mới: `formatVietnamDate(order.deliveryDate)`
4. **Dòng 959 (Lịch sử giao dịch thanh toán/hoàn tiền):**  
   - Cũ: `{new Date(tx.createdAt).toLocaleString('vi-VN')}`  
   - Mới: `{formatVietnamDateTime(tx.createdAt)}`
5. **Dòng 1014 (Timeline sự kiện OrderEvent):**  
   - Cũ: `{new Date(evt.createdAt).toLocaleString('vi-VN')}`  
   - Mới: `{formatVietnamDateTime(evt.createdAt)}`
6. **Dòng 1109 (Thẻ tóm tắt thanh toán - hạn chót):**  
   - Cũ: `{new Date(order.paymentDueAt).toLocaleString('vi-VN')}`  
   - Mới: `{formatVietnamDateTime(order.paymentDueAt)}`
7. **Dòng 1314 (Dialog phân bổ lô hàng thường):**  
   - Cũ: `Thu hoạch {new Date(b.harvestDate).toLocaleDateString('vi-VN')}`  
   - Mới: `Thu hoạch {formatVietnamDate(b.harvestDate)}`
8. **Dòng 1727 (Dialog chốt vụ mùa đặt trước):**  
   - Cũ: `Thu hoạch {new Date(b.harvestDate).toLocaleDateString('vi-VN')}`  
   - Mới: `Thu hoạch {formatVietnamDate(b.harvestDate)}`

### C. Điểm thay thế trong `customer-management.tsx`:
- **Dòng 591 (Lịch sử đơn của khách trong CRM):**  
  - Cũ: `{new Date(ord.createdAt).toLocaleDateString('vi-VN')}`  
  - Mới: `{formatVietnamDate(ord.createdAt)}`

---

## 4. CHI TIẾT SỬA ĐỔI RECHARTS EMPTY STATE (`QW06-MINOR-01`)

Tại `src/app/admin/bao-cao/reports-client.tsx`:
- **Điều kiện cũ:**
  ```tsx
  {isMounted && timeline.points.length > 0 ? (
    <ResponsiveContainer>...</ResponsiveContainer>
  ) : (
    <div>Không có dữ liệu đơn hoàn thành trong khoảng thời gian này</div>
  )}
  ```
- **Điều kiện mới:**
  ```tsx
  {isMounted && timeline.points.length > 0 && (timeline.totalCompletedOrders > 0 || timeline.totalRevenue > 0) ? (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={timeline.points} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
          ...
        </BarChart>
      </ResponsiveContainer>
    </div>
  ) : (
    <div className="h-64 flex flex-col items-center justify-center text-slate-400 text-sm gap-2">
      <BarChart3 className="w-8 h-8 text-slate-300 stroke-[1.5]" />
      <p>Không có dữ liệu đơn hoàn thành trong khoảng thời gian này</p>
    </div>
  )}
  ```
- **Hiệu quả:**
  - Khi kỳ báo cáo có 0 đơn hàng `COMPLETED`: hiển thị ngay Empty State rõ ràng với biểu tượng trực quan, không render trục tọa độ rỗng.
  - Khi có đơn hàng `COMPLETED`: biểu đồ Recharts render đầy đủ dữ liệu doanh thu và sản lượng theo ngày/tuần.
  - Giữ nguyên toàn bộ logic tính toán thống kê và API backend.

---

## 5. BỘ KIỂM THỬ HỒI QUY (TESTS BỔ SUNG)

Tập tin mới: `tests/unit/phase7-hotfix.test.ts` gồm **10 test cases**:
1. `VIETNAM_TIMEZONE` đúng là `Asia/Ho_Chi_Minh`.
2. Format ngày `formatVietnamDate` bảo toàn giá trị `DD/MM/YYYY` bất kể múi giờ runtime.
3. Edge cases sát nửa đêm (23:59:59.999 vs 00:00:00.000 vs 00:00:01.000 VN) hiển thị đúng ngày chuyển tiếp.
4. Format ngày giờ `formatVietnamDateTime` bao gồm đầy đủ ngày, tháng, năm, giờ, phút, giây giờ Việt Nam.
5. Xử lý an toàn các giá trị `null`, `undefined` và chuỗi ngày rác (không ném lỗi runtime).
6. Hỗ trợ tùy biến `Intl.DateTimeFormatOptions` (như chỉ hiển thị giờ:phút).
7. Bảo toàn nguyên vẹn quy tắc nghiệp vụ `isDueOver` (đơn quá hạn thanh toán).
8. Khi có 0 đơn COMPLETED (`revenue = 0`), điều kiện render BarChart trả về `false` (kích hoạt Empty State).
9. Khi có đơn COMPLETED hợp lệ, điều kiện render BarChart trả về `true`.
10. Khi đang ở giai đoạn SSR (`isMounted = false`), không render BarChart để chống vỡ DOM hydration.

---

## 6. KẾT QUẢ QUALITY GATES

| Quality Gate | Lệnh thực thi | Kết quả | Ghi chú |
|---|---|:---:|---|
| **Unit Tests** | `npm test` | **PASS (324/324)** | 27/27 test suites PASS (tăng 10 tests so với baseline 314 tests) |
| **Linter** | `npm run lint` | **PASS (0 errors)** | 1 cảnh báo biến chưa dùng cũ trong `scripts/local-db.ts` |
| **Typecheck** | `npm run typecheck` | **PASS (0 errors)** | `tsc --noEmit` hoàn tất không có lỗi |
| **Production Build** | `npm run build` | **PASS** | Turbopack compile thành công, tối ưu 39 routes |
| **Git Diff Check** | `git diff --check` | **PASS** | 0 lỗi khoảng trắng, 0 trailing newline lỗi |

---

## 7. THÔNG TIN COMMIT VÀ TRẠNG THÁI GIT

- **Commit Code:**
  ```text
  commit 3b67d06
  Author: Bao <baopk@example.com>
  Date:   Mon Oct 19 18:56:59 2026 +07:00
      fix(ui): stabilize vietnam timezone rendering and report empty states
   6 files changed, 205 insertions(+), 12 deletions(-)
   create mode 100644 nong-san-b2b/tests/unit/phase7-hotfix.test.ts
  ```
- **Commit Documentation:**
  ```text
  commit 3f9a590
  Author: Bao <baopk@example.com>
  Date:   Mon Oct 19 18:57:48 2026 +07:00
      docs: update master backlog after phase 7 hotfix
   1 file changed, 6 insertions(+), 6 deletions(-)
  ```
- **Git Status:**
  ```text
  On branch beta
  Your branch is ahead of 'origin/beta' by 3 commits.
    (use "git push" to publish your local commits)

  nothing to commit, working tree clean
  ```
- **Tuân thủ giới hạn:** Không sửa Prisma schema, không tạo migration, không sửa Shipping Engine, không ghi DB, không push remote, không merge main.

---

## 8. CÁC ĐIỂM CẦN QA KIỂM TRA ĐỘC LẬP & RETEST TRÊN BETA

1. **Kiểm tra độc lập ở mức Local:**
   - Mở chi tiết đơn hàng `/admin/don-hang/[code]`: xác nhận ngày tạo, hạn thanh toán và dòng thời gian sự kiện hiển thị đúng giờ Việt Nam (UTC+7).
   - Mở báo cáo `/admin/bao-cao`: xác nhận khi chưa có đơn `COMPLETED`, biểu đồ hiển thị khối thông báo rỗng kèm icon thay vì vẽ trục tọa độ trắng.
2. **Kế hoạch retest trên Vercel Beta (khi Product Owner phê duyệt deploy):**
   - Mở DevTools Console khi duyệt qua các route trong chuỗi: `/admin/bao-cao` $\rightarrow$ `/admin/khach-hang` $\rightarrow$ `/admin/don-hang/[code]`.
   - Xác nhận console không còn phát sinh cảnh báo `Minified React error #418`.
   - Chuyển đổi qua lại giữa các chu kỳ lọc báo cáo (7 ngày, 30 ngày, tháng này) để kiểm chứng hành vi của Empty State.

---
*DEV đã hoàn thành toàn bộ phạm vi DEV-TASK-18, lưu checkpoint local sạch sẽ và dừng lại chờ chỉ đạo tiếp theo từ Product Owner.*
