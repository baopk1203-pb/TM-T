# Nền tảng Thương mại Điện tử Nông sản B2B (Vietnamese Agri-Produce B2B)

Hệ thống sàn giao dịch nông sản B2B trực tuyến kết nối trực tiếp giữa Hợp tác xã/Nhà vườn và các Đại lý bán sỉ, Siêu thị, Cửa hàng thực phẩm sạch.

---

## ⚡ Hướng dẫn chạy 100% Offline cục bộ qua npm

Hệ thống được tích hợp sẵn cơ chế **Embedded PostgreSQL**, cho phép chạy hoàn toàn độc lập **100% offline** mà không cần kết nối internet hay cài đặt Docker/PostgreSQL toàn cục.

### 1. Khởi chạy hệ thống offline
Tại thư mục `nong-san-b2b`:
```bash
cd nong-san-b2b
npm run dev
```
*(hoặc `npm run dev:offline`)*

Lệnh trên sẽ tự động:
1. Khởi động PostgreSQL cục bộ tại cổng `5432` lưu dữ liệu bền vững tại thư mục `./data/local-db/`.
2. Tự động kiểm tra và tạo cơ sở dữ liệu `nong_san_b2b`.
3. Tự động đồng bộ cấu trúc bảng Prisma (`prisma db push`) và nạp dữ liệu mẫu ban đầu (`seed data`) nếu chưa có.
4. Mở máy chủ phát triển Next.js tại `http://localhost:3000`.
5. Khi bạn bấm `Ctrl + C` để dừng, hệ thống sẽ tự động tắt an toàn tiến trình PostgreSQL cục bộ.

### 2. Vị trí lưu trữ dữ liệu cục bộ
- Toàn bộ dữ liệu PostgreSQL (bảng, chỉ mục, tài khoản, đơn hàng) được lưu bền vững tại:
  ```
  nong-san-b2b/data/local-db/
  ```
- Dữ liệu được bảo toàn qua các lần tắt/mở ứng dụng. Thư mục này đã được thêm vào `.gitignore` để tránh đẩy dữ liệu nhị phân lên kho mã nguồn.

### 3. Tài khoản demo có sẵn (sau khi seed)
| Loại tài khoản | Email đăng nhập | Mật khẩu | Vai trò |
| :--- | :--- | :--- | :--- |
| **Quản trị viên (Admin)** | `admin@nongsanb2b.vn` | `AdminPassword@123` | Quản trị toàn sàn, xác duyệt đơn, quản lý nhà vườn & giá bậc |
| **Đại lý cấp 1** | `daily1@nongsanb2b.vn` | `Demo@123` | Chiết khấu 5%, đặt sỉ khối lượng lớn |
| **Siêu thị** | `sieuthi@nongsanb2b.vn` | `Demo@123` | Chiết khấu 3%, đặt sỉ định kỳ |
| **Cửa hàng tạp hóa** | `taphoa@nongsanb2b.vn` | `Demo@123` | Giá niêm yết chuẩn, mua sỉ & đặt mẫu thử |

---

## 🛠️ Các lệnh quản trị cơ sở dữ liệu cục bộ

- `npm run db:local:start`: Khởi động riêng tiến trình PostgreSQL cục bộ.
- `npm run db:local:push`: Đồng bộ Prisma Schema vào cơ sở dữ liệu cục bộ.
- `npm run db:local:seed`: Nạp lại dữ liệu hạt giống mẫu vào database cục bộ.
- `npm run db:generate`: Sinh Prisma Client mới nhất.
- `npm run dev:online`: Khởi chạy kết nối trực tiếp đến Cloud Neon PostgreSQL (yêu cầu internet).

---

## 🧪 Kiểm thử và Đảm bảo chất lượng mã nguồn

```bash
npm run typecheck    # Kiểm tra kiểu TypeScript (0 lỗi)
npm run lint         # Kiểm tra chuẩn mã nguồn ESLint (0 lỗi)
npm test             # Chạy 88/88 Vitest unit test
npm run build        # Biên dịch và kiểm tra đóng gói Next.js production
```
