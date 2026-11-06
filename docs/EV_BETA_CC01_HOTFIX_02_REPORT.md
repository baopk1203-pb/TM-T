# BÁO CÁO ĐIỀU TRA NGUYÊN NHÂN GỐC RỄ & KHẮC PHỤC CC-01 RUNTIME
## EV-BETA-CC01-HOTFIX-02: TARGETED CC-01 RUNTIME FIX — PRODUCT PRICING PREVIEW

- **Dự án:** E Vibe — Nông Sản B2B
- **Vai trò:** DEV 1 — Release Integrator / Senior Full-Stack Engineer
- **Ủy quyền:** ChatGPT 1 — Main Coordinator
- **Chế độ:** `TARGETED HOTFIX / NO BETA PUSH`
- **Nhánh thực thi cách ly:** `fix/cc01-runtime-fix-02`
- **Worktree:** `D:\TDTU\wt_f02_f04_integration`
- **Base SHA:** `fe7612cce70192141986ba2fc3c73ff4c1ad03c3` (`origin/beta`)
- **Hotfix Commit SHA:** `353ea2b99ac65272882da15ca3f51a72c26b1a04`
- **Trạng thái:** `COMPLETED — PENDING COORDINATOR MERGE/PUSH AUTHORIZATION`

---

## I. XÁC MINH DANH TÍNH BẢN PHÁT HÀNH HIỆN HỮU (DEPLOYMENT IDENTITY CHECK)

1. **Xác minh Git Remote & Vercel Preview**:
   - `origin/beta` HEAD: `fe7612cce70192141986ba2fc3c73ff4c1ad03c3`.
   - Vercel Deployment ID: `dpl_DWj5Tcqp2ydjSZVVXjeSTftcuSGv`.
   - Vercel Build Git Commit: `fe7612cce70192141986ba2fc3c73ff4c1ad03c3`.
   - Alias `https://nong-san-b2b-git-beta-baopk.vercel.app` đã trỏ đúng deployment trên.
2. **Kiểm tra mã nguồn thực tế trong SHA `fe7612c`**:
   - `src/app/san-pham/[slug]/page.tsx`: ĐÃ truy xuất đúng `membershipTier`, `membershipDiscountPercent` (2%), và `combinedDiscountPercent` (7%) từ database.
   - `src/app/san-pham/[slug]/product-detail-view.tsx`: Dòng tính toán bảng giá (`calculateCustomerUnitPrice(tier.pricePerKg, combinedDiscount)`) ĐÃ dùng 7% $\rightarrow$ **Bảng giá hiển thị đúng 74.400 đ/kg và 69.750 đ/kg** (khớp chính xác với quan sát của QA).
   - Tuy nhiên, trong `fe7612c`:
     - Nhãn cột bảng giá vẫn ghi `Giá Của Bạn (-{userDiscount}%)` (-5%).
     - Badge bảng giá vẫn ghi `Chiết khấu đối tác của bạn: -{userDiscount}%` (-5%).
     - `product-order-box.tsx` vẫn gọi `priceCart` với `groupDiscountPercent: userDiscount` (chưa truyền `membershipTier`).
   - **Kết luận xác minh**: Lỗi **KHÔNG** phải do Vercel cache hay sai deployment alias, mà thực sự tồn tại ở cấp mã nguồn do script vá trước đó bị trượt các khối thay thế vì lệch chuẩn xuống dòng Windows CRLF (`\r\n` vs `\n`).

---

## II. NGUYÊN NHÂN GỐC RỄ (ROOT CAUSE ANALYSIS)

Dù Server Component `page.tsx` đã truyền đúng `user.membershipTier` và `user.combinedDiscountPercent` xuống, nhưng trong `product-order-box.tsx`:

1. **Hàm `priceCart` trong `useMemo` không nhận `membershipTier`**:
   ```typescript
   // Mã nguồn bị lỗi trong fe7612c:
   const quoteResult = useMemo(() => {
     return priceCart({
       lines,
       products: [pricingProduct],
       groupDiscountPercent: userDiscount, // Chỉ nhận 5%!
     })
   }, [quantities, pricingProduct, userDiscount, product.id])
   ```
   Do không nhận `membershipTier` hay `membershipDiscountPercent`, engine `priceCart` mặc định coi chiết khấu chỉ là 5%. Kết quả:
   - Đơn giá áp dụng: $80.000 \times 0.95 = \mathbf{76.000\text{ đ/kg}}$ (thay vì 74.400 đ/kg).
   - Thành tiền 50 kg: $76.000 \times 50 = \mathbf{3.800.000\text{ đ}}$ (thay vì 3.720.000 đ).

2. **Gợi ý bậc tiếp theo (Next Tier Suggestion) dùng công thức cục bộ với `userDiscount`**:
   ```typescript
   // Mã nguồn bị lỗi trong fe7612c:
   (summary.nextTier.pricePerKg * (100 - userDiscount)) / 100 // 75.000 * 0.95 = 71.250 đ/kg!
   ```
   Thay vì dùng hàm thuần `calculateCustomerUnitPrice(summary.nextTier.pricePerKg, combinedDiscount)` để ra **69.750 đ/kg**.

3. **Nhãn chiết khấu bị gắn cứng vào `userDiscount`**:
   - `product-order-box.tsx`: `Chiết khấu: -{userDiscount}%` $\rightarrow$ hiển thị **-5%**.
   - `product-detail-view.tsx`: `Chiết khấu đối tác của bạn: -{userDiscount}%` và `Giá Của Bạn (-{userDiscount}%)` $\rightarrow$ hiển thị **-5%**.

---

## III. NỘI DUNG KHẮC PHỤC TỐI GIẢN (MINIMAL HOTFIX)

Đã áp dụng bản vá chuẩn hóa trên nhánh `fix/cc01-runtime-fix-02` (commit `353ea2b99ac65272882da15ca3f51a72c26b1a04`):

### 1. File `nong-san-b2b/src/app/san-pham/[slug]/product-order-box.tsx`
- **Truyền đầy đủ Membership vào `priceCart`**:
  ```typescript
  return priceCart({
    lines,
    products: [pricingProduct],
    groupDiscountPercent: userDiscount,
    membershipTier: user?.membershipTier,
    membershipDiscountPercent: user?.membershipDiscountPercent,
  })
  ```
- **Đồng bộ gợi ý bậc tiếp theo qua hàm dùng chung**:
  ```typescript
  calculateCustomerUnitPrice(summary.nextTier.pricePerKg, combinedDiscount) // = 69.750 đ/kg
  ```
- **Chuẩn hóa badge preview**:
  Hiển thị phân rã rõ ràng:
  `Chiết khấu: -7% (Nhóm: -5% • Hạng Đồng: -2%)` khi có ưu đãi hạng.

### 2. File `nong-san-b2b/src/app/san-pham/[slug]/product-detail-view.tsx`
- **Chuẩn hóa tiêu đề cột bảng giá**:
  `Giá Của Bạn (-7%)` (hoặc `Giá Của Bạn (-5%)` nếu không có hạng).
- **Chuẩn hóa badge bảng giá**:
  `Ưu đãi kết hợp: -7% (Đại lý cấp 1: -5% • Hạng Đồng: -2%)`.

---

## IV. BẰNG CHỨNG KIỂM TRA & BẢO ĐẢM TÍNH BẤT BIẾN (INVARIANT PROOF)

Đã tạo bộ kiểm thử hồi quy mới: **`tests/unit/cc01-product-preview-pipeline.test.ts`**.

```typescript
// Trích xuất từ test:
it('3. Invariant Rule: PDP TABLE = PDP PREVIEW = CART QUOTE = CHECKOUT QUOTE', () => {
  expect(tableUnitPrice).toBe(74_400)
  expect(previewQuote.productSummaries[0].unitPricePerKg).toBe(74_400)
  expect(cartQuote.productSummaries[0].unitPricePerKg).toBe(74_400)
  expect(checkoutQuote.productSummaries[0].unitPricePerKg).toBe(74_400)

  expect(previewQuote.subtotal).toBe(3_720_000)
  expect(cartQuote.subtotal).toBe(3_720_000)
  expect(checkoutQuote.subtotal).toBe(3_720_000)
})
```

### Kết quả kiểm chứng thực tế:
1. **TypeScript Typecheck:** `npm run typecheck` $\rightarrow$ **`EXIT CODE 0`** (0 errors).
2. **Targeted Test Suites:** **`74/74 tests PASS`**
   - `tests/unit/cc01-product-preview-pipeline.test.ts`: **6/6 passed**.
   - `tests/unit/cart-summary.test.ts`: **15/15 passed**.
   - `tests/unit/pricing-cart.test.ts`: **13/13 passed**.
   - `tests/unit/membership-integration.test.ts`: **40/40 passed**.
3. **Next.js Production Build:** `npm run build` $\rightarrow$ **`EXIT CODE 0`**
   - Compile Turbopack trong 1.97s.
   - Toàn bộ 15 static/dynamic routes tối ưu hóa thành công.

---

## V. ĐỐI CHIẾU TIÊU CHÍ CHẤP NHẬN (ACCEPTANCE CRITERIA)

| Tiêu chí | Kỳ vọng | Kết quả sau Hotfix 02 | Trạng thái |
| :--- | :--- | :--- | :---: |
| **PDP Table Unit Price** | 74.400 VND/kg | `74.400 VND/kg` | **PASS** |
| **PDP Preview Unit Price** | 74.400 VND/kg | `74.400 VND/kg` | **PASS** |
| **PDP Preview Subtotal (50kg)** | 3.720.000 VND | `3.720.000 VND` | **PASS** |
| **Next Tier Price (≥200kg)** | 69.750 VND/kg | `69.750 VND/kg` | **PASS** |
| **PDP Table Header & Badge** | Hiện rõ Combined 7% (Nhóm 5% + Đồng 2%) | `Giá Của Bạn (-7%)` & `Ưu đãi kết hợp: -7%` | **PASS** |
| **PDP Preview Badge** | Hiện rõ Combined 7% (Nhóm 5% + Đồng 2%) | `Chiết khấu: -7% (Nhóm: -5% • Hạng Đồng: -2%)` | **PASS** |
| **Tính bất biến 4 tầng** | `TABLE = PREVIEW = CART = CHECKOUT` | Đồng nhất 100% tại `74.400 VND/kg` | **PASS** |

---

## VI. DANH SÁCH TẬP TIN THAY ĐỔI (CHANGED FILES)

```text
M  nong-san-b2b/src/app/san-pham/[slug]/product-detail-view.tsx
M  nong-san-b2b/src/app/san-pham/[slug]/product-order-box.tsx
A  nong-san-b2b/tests/unit/cc01-product-preview-pipeline.test.ts
```

- **Prisma Schema:** 0 changes.
- **Migrations:** 0 new migrations.
- **Database:** 0 mutations.

---

## VII. PHÁN QUYẾT CUỐI CÙNG & TRẠNG THÁI KHÓA AN TOÀN

**`CC-01 HOTFIX 02 — SOURCE READY / BETA RELEASE PENDING`**

`BETA PUSH — NOT AUTHORIZED`  
`VERCEL DEPLOYMENT — NOT AUTHORIZED`

DEV 1 đã hoàn tất việc sửa lỗi và kiểm chứng ở cấp mã nguồn trên nhánh cách ly `fix/cc01-runtime-fix-02` (commit `353ea2b99ac65272882da15ca3f51a72c26b1a04`), tuyệt đối không tự ý push hay deploy. Kính chờ chỉ thị phê duyệt từ Main Coordinator!
