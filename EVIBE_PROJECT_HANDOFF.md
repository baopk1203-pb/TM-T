# EVIBE_PROJECT_HANDOFF — TÀI LIỆU BÀN GIAO DỰ ÁN (TIẾNG VIỆT)

> **E Vibe — Nông Sản B2B** | Bàn giao ngữ cảnh giữa các agent | Bản ghi trạng thái: **27/10/2026** (Asia/Ho_Chi_Minh); đã đồng bộ báo cáo `EV-SPRINT-48H-00-R1`
>
> **Mục đích:** Cung cấp ngữ cảnh dự án có thể chuyển giao cho DEV 1 (F03), DEV 2 (F04), DEV 3 (F02), QA độc lập và người phụ trách tích hợp/phát hành (Release Integrator).
>
> **Thứ tự ưu tiên nguồn quyết định:** Quyết định rõ ràng mới nhất của Product Owner (PO) **>** đặc tả được PO phê duyệt **>** Git/mã nguồn đã xác minh **>** kết luận QA **>** đề xuất của DEV. Khi có mâu thuẫn, phải báo cáo; không tự âm thầm ghi đè quyết định.

## 1. Thông tin dự án và mốc phát hành

- **Repository:** `https://github.com/baopk1203-pb/TM-T.git`.
- **Nhánh làm việc:** `beta`; commit mục tiêu đóng F01: `863726919d4f6b4975fd2ef05ffb65a50c7b4dee`.
- **Website Beta:** `https://nong-san-b2b-git-beta-baopk.vercel.app`.
- **Nhánh Production:** `main`; **không sửa, push, deploy hoặc migrate Production** nếu chưa có quyền phê duyệt riêng, rõ ràng của PO.
- **Cơ sở dữ liệu cho các thay đổi Beta có kiểm soát về sau:** Neon `preview-beta`, mã nhận diện host `ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech`. Không đưa chuỗi kết nối chứa thông tin đăng nhập, mật khẩu hoặc token vào tài liệu này.
- **Mã nhận diện host Neon Production hiện tại:** `ep-square-scene-b5ddgxil` (chỉ để nhận diện; tuyệt đối không nhắm tới khi thay đổi dữ liệu).
- **Cờ chức năng ghi tồn kho Admin:** `ENABLE_ADMIN_INVENTORY_WRITES` **OFF/UNSET**; phải tiếp tục tắt, trừ khi có ủy quyền độc lập.
- **Công nghệ:** Next.js 16.4.3, React 19.3.0, Prisma 6.4.1, PostgreSQL; triển khai qua Vercel.

### Trạng thái F01 — CLOSED trong phạm vi Beta

- F01A–F01D: đã được nghiệm thu qua các vòng QA trước.
- F01E: đã hoàn tất một lần `Controlled APPLY`; QA sau APPLY và ChatGPT Work Browser Acceptance đều kết luận **FINAL PASS** trong phạm vi Beta.
- Số liệu sau F01 ghi nhận trong các báo cáo: **8/8** sản phẩm bật theo dõi tồn kho; **20 lô** (16 đủ điều kiện FEFO, 3 lô lịch sử `UNVERIFIED`, 1 lô `LOCKED_QC`); **22** bút toán `InventoryLedger`; tồn vật lý **1.858 kg**; tồn khả dụng/bán được **1.850 kg**; giữ chỗ **0 kg**; không đủ điều kiện bán **8 kg**.
- Lô QA của Bơ 034 `QA-F01D-P2-BO034-261026`: **8 kg**, trạng thái `LOCKED_QC`, không được bán.
- **Giới hạn của bằng chứng QA:** Vòng Browser Acceptance cuối của F01 chỉ thực hiện thao tác đọc; chưa kiểm thử lại luồng ghi dữ liệu UI và giao dịch E2E, đồng thời Work Browser chưa tự xác minh độc lập Deployment SHA. **Không diễn giải F01 CLOSED Beta thành sẵn sàng Production.**
- Phải bảo toàn: cơ chế Checkout chống race condition (`Product FOR SHARE` và đọc lại trạng thái thực), phân bổ FEFO, giữ chỗ/hết hạn thanh toán **10 phút** và logic chống bán vượt tồn.

## 2. Mục tiêu và thứ tự ưu tiên Sprint 48 giờ

**Thứ tự ưu tiên do PO quyết định; thay thế thứ tự cũ trong báo cáo Gap Audit của DEV:**

| Ưu tiên | Feature | Mục tiêu | Trạng thái tại thời điểm bàn giao |
| --- | --- | --- | --- |
| **P0 — đầu tiên** | **F03 — Gemini AI Admin** | AI-1 phân tích quản trị có gọi Gemini thực; AI-2 cảnh báo tồn kho/hạn dùng nếu khả thi | Chưa triển khai trong Sprint này; đã có dữ liệu báo cáo/FEFO; **dự kiến không cần migration** |
| **P0 — thứ hai** | **F04 — Membership & KPI theo quý** | 4 hạng, chiết khấu và ưu đãi ship đã duyệt, khung chấm điểm Model B, xét hạng an toàn | Đã có nền tảng `CustomerGroup`/pricing; **công thức Model B chi tiết chưa được duyệt** |
| **P1** | **F02 — Khiếu nại hai chiều** | Đề xuất/đồng ý của khách–Admin, tối đa một lần phúc tra, SLA 48 giờ, đối soát tài chính đúng | Đã có `Complaint`, UI và action cơ bản; cần mở rộng migration/workflow |
| **Tùy thời gian** | F05 — Xác nhận chính sách Checkout | Bước xác nhận, checkbox chấp thuận điều khoản, version/timestamp | Có thể hoãn nếu thiếu thời gian |
| **Tùy thời gian** | F06 — Minh bạch nhà vườn | Thông tin sản lượng/chứng nhận có căn cứ và nhãn hiển thị trung thực | Có thể hoãn nếu thiếu thời gian |

**Không tự thay đổi thứ tự ưu tiên nếu PO chưa có chỉ đạo mới.** Các agent chạy trong tài khoản Antigravity đang hoạt động dùng chung hạn mức quota; tạo thêm agent **không** làm tăng quota. Tài khoản Google AI Pro sinh viên chỉ là **phương án dự phòng chuyển tiếp tuần tự** nếu đủ điều kiện và đúng chính sách, không phải luồng phát triển song song.

## 3. Vai trò agent và cách ly môi trường

- **DEV 1 — F03:** Tích hợp Gemini, endpoint/server action chỉ Admin có quyền sử dụng, dữ liệu ngữ cảnh phân tích, AI-1 và AI-2. Cuộc trò chuyện Antigravity riêng, ưu tiên **New Worktree Mode**.
- **DEV 2 — F04:** Schema Membership, dịch vụ KPI, lịch sử hạng, UI, tích hợp chiết khấu/ship theo chính sách sau khi kiểm thử an toàn. Cuộc trò chuyện và **New Worktree Mode** riêng.
- **DEV 3 — F02:** Schema và quy trình khiếu nại, thời hạn 48 giờ, một lần phúc tra, ngăn sai lệch tài chính. Cuộc trò chuyện và **New Worktree Mode** riêng.
- **QA:** Đánh giá độc lập, tập trung các commit đã sẵn sàng. Không tự cấp GO cho chính thay đổi mình thực hiện ở vai trò DEV. Tách QA khỏi nhiệm vụ lập trình có ghi dữ liệu.
- **Release Integrator:** Một DEV hiện có được chỉ định kiêm nhiệm, **không phải DEV thứ tư**; là đầu mối duy nhất đề xuất merge/deploy sau khi QA độc lập và PO cho phép. Không để nhiều agent cùng tích hợp một lúc.
- Tên nhánh Feature **được đề xuất** (chưa xác nhận đã tồn tại): `feature/f03-gemini-ai`, `feature/f04-membership-kpi`, `feature/f02-complaints-48h` (theo đề xuất R1, chưa khởi tạo thực tế).
- Mỗi agent phải báo cáo **đường dẫn worktree thực tế**, nhánh đang ở, HEAD SHA, file thay đổi, kết quả test và thay đổi chưa commit. Không cho nhiều agent ghi vào cùng working directory.

## 4. Các quyết định nghiệp vụ đã được phê duyệt

### F02 — Khiếu nại

- Khách được mở khiếu nại trong vòng **24 giờ sau khi đơn ở trạng thái `DELIVERED`**.
- Khi Admin gửi đề xuất bồi thường, khách có **48 giờ** phản hồi (`reviewDueAt` tính từ thời điểm đề xuất).
- Khách được yêu cầu **phúc tra tối đa một lần**. Đề xuất tiếp theo của Admin là quyết định cuối cùng.
- Khách không phản hồi trước hạn: tự động chuyển khiếu nại sang `WITHDRAWN`, bồi thường **0 VND**, hoàn tất vòng đời nghiệp vụ liên quan và giải phóng doanh thu đang tạm giữ theo logic tài chính PH9-00 đã duyệt.
- Doanh thu của đơn có khiếu nại được tạm giữ đến khi xử lý xong; chỉ ghi nhận khoản bồi thường hoặc giao dịch `REFUND` khi có chấp thuận hợp lệ. Phải tránh hoàn tiền trùng, ghi nhận doanh thu hai lần và race condition với job xử lý quá hạn.
- Email nhắc trước hạn **12 giờ** chỉ là *đề xuất của DEV*, **không bắt buộc trong Sprint** nếu PO chưa phê duyệt riêng.

### F03 — Gemini AI

- Chỉ **Admin** sử dụng; phải kiểm tra quyền Admin tại server, không chỉ ẩn nút trên giao diện.
- Chỉ gọi Gemini từ server; tuyệt đối không đưa API key lên client hoặc Git. Không cho thực thi SQL tùy ý, gọi tool tùy ý hoặc cấp quyền truy cập mạng tùy ý.
- **AI-1:** Trả lời các câu hỏi vận hành/kinh doanh bằng dữ liệu phân tích và tồn kho thực, thuộc phạm vi được phép. Không hardcode câu trả lời giả danh Gemini.
- **AI-2:** Phân tích tồn kho, lô sắp hết hạn hoặc nhu cầu; **phân biệt rõ cảnh báo dựa trên quy tắc/dữ liệu với kết quả dự báo**; không bịa số liệu.
- Trước khi chọn model và phương án dự phòng, phải **kiểm tra khả năng truy cập model thực tế** bằng thông tin xác thực Gemini API được cấp cho dự án. Tên model nêu trong Gap Audit cũ không thay thế được việc kiểm tra này.
- Khi thiếu key, hết quota `429` hoặc lỗi upstream: xử lý trung thực bằng thông báo lỗi hoặc dữ liệu nền read-only được gắn nhãn rõ; **không giả lập kết quả gọi AI thành công**.
- Không gửi dữ liệu cá nhân không cần thiết, secrets hoặc thông tin định danh khách hàng (PII) tới nhà cung cấp AI.

### F04 — Membership: danh mục quyết định PAR đã được PO phê duyệt

| Mã | Quyết định chính thức |
| --- | --- |
| **PAR-10** | Trần **tổng chiết khấu cộng dồn 10%** |
| **PAR-11** | Thang điểm 0–100: **Đồng (Bronze) 0–39**, **Bạc (Silver) 40–69**, **Vàng (Gold) 70–89**, **Kim Cương (Diamond) 90–100** |
| **PAR-12** | Chiết khấu hạng: **Đồng 2%**, **Bạc 3%**, **Vàng 4%**, **Kim Cương 5%** |
| **PAR-13** | Giảm phí vận chuyển: **Đồng 5%**, **Bạc 10%**, **Vàng 15%**, **Kim Cương 20%** |
| **PAR-14** | Mức giảm phí vận chuyển tối đa **100.000 VND/đơn** |
| **PAR-15** | PO đã phê duyệt ngưỡng **50 kg**; phải đối chiếu quyết định/đặc tả gốc để biết chính xác điều kiện 50 kg áp dụng ở đâu (không tự hiểu đó là ngưỡng lên hạng) |
| **PAR-16** | Chọn **Model B — Balanced B2B Scorecard**, không chọn Model A. Bốn yếu tố: **doanh thu**, **sản lượng giao dịch**, **tần suất mua**, **độ tin cậy thanh toán** |

**Các quyết định F04 bổ sung:**

- Xét hạng vào **01/01, 01/04, 01/07, 01/10**, dùng dữ liệu của **quý liền trước**; tự động thăng/giáng hạng.
- Hệ số dành cho khách mới ở chu kỳ đầu: **tháng 1 ×1,0**, **tháng 2 ×1,1**, **tháng 3 ×1,2**; sau chu kỳ ưu đãi đầu tiên quay về **×1,0**. Trước khi viết công thức, phải đối chiếu đặc tả gốc về ngày bắt đầu tính, trường hợp vắt qua hai quý và dữ liệu nào được nhân hệ số.
- **Chưa được PO duyệt:** Trọng số chính xác của Model B (**40% doanh thu / 30% sản lượng / 20% tần suất / 10% độ tin cậy** mới là phương án đề xuất), mục tiêu chuẩn hóa, quy tắc chống chia nhỏ đơn, cách đo độ tin cậy thanh toán và xử lý dữ liệu thiếu.
- **Không được thay thế** bằng Model A doanh thu 60% + số đơn 40%; không áp dụng đề xuất cũ của DEV về chiết khấu hạng **0/1/2/3%**, giảm ship **0/10/20/30%** hoặc trần ship **50.000 VND**.
- Việc áp dụng giá/chiết khấu thực tế và tự động thay đổi hạng theo quý phụ thuộc vào công thức được duyệt và các bài test hồi quy Checkout liên quan. Không tự đặt thông số còn thiếu.

## 5. Bản đồ mã nguồn theo Gap Audit `EV-SPRINT-48H-00` (cần kiểm tra đường dẫn trong repo hiện tại)

- **F03:** Nguồn dữ liệu báo cáo (`src/server/reports.ts` hoặc đường dẫn thực tế), `/admin/bao-cao`, phần tổng hợp tồn kho/FEFO.
- **F04:** Prisma `User`, `CustomerGroup`, `src/lib/domain/pricing.ts`, các trang Admin/hồ sơ khách hàng.
- **F02:** Prisma `Complaint`, `src/actions/order-lifecycle.ts`, `/admin/khieu-nai`, `/tai-khoan/don-hang/[code]`, settlement, email và PaymentTransaction.
- **F05:** `src/actions/order.ts`, Checkout UI, các trường `Order` về chấp thuận chính sách (nếu sau này được phép làm).
- **F06:** Prisma `Farm`, `Certificate`, `WeeklyCapacity`, `/nha-vuon`, chi tiết sản phẩm và truy xuất QR.
- **Rủi ro migration:** F02 và F04 đều cần sửa `prisma/schema.prisma`, còn F05 có thể hoãn. Các DEV thiết kế trong môi trường riêng; **Release Integrator** rà soát migration tương thích, **chỉ bổ sung (additive-only)** và chạy thử trên PostgreSQL cô lập trước. Không migrate Neon Beta nếu chưa có quyền riêng rõ ràng.

## 6. Quy tắc an toàn và các cổng QA bắt buộc

1. Giữ nguyên chức năng và dữ liệu của F01 Beta. Không sửa mã nguồn Production, nhánh `main`, cơ sở dữ liệu Neon Production hay deployment Vercel Production.
2. Mỗi Feature có worktree riêng và database test hoặc mock riêng khi cần; **không ghi dữ liệu đồng thời vào Neon `preview-beta`**.
3. Không commit/dán vào báo cáo/handoff các API key, access token, mật khẩu, nội dung `.env` riêng tư, PII khách hàng hoặc signed URL.
4. Giữ `ENABLE_ADMIN_INVENTORY_WRITES` ở trạng thái **OFF**.
5. Không tự ý `git push`, deploy, Prisma migrate hoặc seed dữ liệu nếu chưa có nhiệm vụ phát hành và phê duyệt cụ thể.
6. Khi bàn giao code: cung cấp test/lint/typecheck/build phù hợp, SHA commit, tóm tắt diff, rủi ro và kết quả QA.
7. Release Integrator chỉ merge nhánh đã được QA chấp thuận, chạy kiểm thử hồi quy trên mã nguồn kết hợp, kiểm tra môi trường/phiên bản rồi deploy **chỉ lên Beta** theo nhiệm vụ phát hành được cấp quyền.
8. Browser Acceptance cho chức năng mới phải kiểm tra bản Beta thực tế và đăng nhập ứng dụng hợp lệ; những phần chưa xác minh phải ghi rõ.
9. **Không tự động tiếp tục công việc sau khi nhiệm vụ đã dừng**; ghi trạng thái vào handoff và đợi lệnh tiếp theo.

## 7. Quy trình bàn giao/checkpoint

Cập nhật mục này mỗi khi nhiệm vụ DEV tạm dừng hoặc hoàn tất (**không ghi thông tin bí mật**).

| Agent | Feature | Nhánh / worktree | HEAD SHA | Trạng thái | Việc tiếp theo / QA gate |
| --- | --- | --- | --- | --- | --- |
| DEV 1 | F03 | `feature/f03-gemini-ai` / `D:\TDTU\wt_f03_gemini` | `14a4ccd` | HOÀN TẤT AI-1 (READY FOR QA) | Targeted QA Audit cho EV-IMP-03-AI-01 |
| DEV 2 | F04 | _ghi sau khi tạo_ | _ghi nhận_ | CHƯA BẮT ĐẦU | Bootstrap + kiểm tra phần công thức Model B còn thiếu |
| DEV 3 | F02 | _ghi sau khi tạo_ | _ghi nhận_ | CHƯA BẮT ĐẦU | Bootstrap + kiểm tra schema/quy trình khiếu nại |
| QA | Độc lập | _ghi sau khi tạo_ | _ghi nhận_ | SẴN SÀNG CHỜ | Audit các thay đổi khi được bàn giao |

Mỗi lần cập nhật handoff cần ghi: **thời gian thực tế + múi giờ; nhánh/đường dẫn worktree; Git HEAD; trạng thái working tree; file đã đổi; các lệnh đã chạy và đầu ra quan sát được; quyết định đã áp dụng; blocker; một hoặc hai hành động tiếp theo; khả năng merge an toàn**. Không coi báo cáo DEV là bằng chứng QA đã tự chạy test.

## 8. Lệnh khởi tạo agent ban đầu (chưa coding nếu PO chưa giao nhiệm vụ Feature)

### DEV 2 — Khởi tạo F04

> Bạn là **DEV 2**, phụ trách F04 Membership. Hãy đọc `EVIBE_PROJECT_HANDOFF.md`; xác nhận nhánh và worktree thực tế được tách biệt, commit F01 có trong lịch sử, mã nguồn liên quan và các quyết định 4 hạng đã được PO chốt. Xác định chính xác phần công thức Model B còn thiếu. **CHỈ BOOTSTRAP READ-ONLY:** không sửa code, schema, database, Git hay deployment. Trả về báo cáo ngắn về mức độ sẵn sàng rồi chờ prompt triển khai F04 riêng.

### DEV 3 — Khởi tạo F02

> Bạn là **DEV 3**, phụ trách F02 Complaints. Hãy đọc `EVIBE_PROJECT_HANDOFF.md`; xác nhận nhánh/worktree độc lập, commit F01 có trong lịch sử, quy trình `Complaint` và các phụ thuộc settlement PH9-00. **CHỈ BOOTSTRAP READ-ONLY:** không sửa code, schema, database, Git hay deployment. Trả về báo cáo ngắn về mức độ sẵn sàng rồi chờ prompt triển khai F02 riêng.

## 9. Tài liệu/bằng chứng cần lưu giữ

- `EV_SPRINT_48H_00_GAP_AUDIT_EXECUTION_PLAN.md` — đánh giá khoảng cách kỹ thuật; **không có quyền ghi đè các quyết định PO**.
- `EV_IMP_01_FINAL_B5_CONTROLLED_APPLY_RESULT.md` — bằng chứng DEV về Controlled APPLY.
- `QA-WORK-F01-FINAL-BETA-BROWSER-ACCEPTANCE-REPORT.md` — Work Browser FINAL PASS trong phạm vi Beta.
- `QA-F01-FINAL` — QA Antigravity thẩm định mã nguồn độc lập (lưu ý việc chạy SQL trực tiếp đã bị chặn).
- Báo cáo đồng bộ lại quyết định PO sau khi được tạo.

## 10. Những phạm vi không được nhầm lẫn

- Quota tài khoản Google AI Pro dùng Antigravity và quota Gemini API mà ứng dụng E Vibe gọi là **hai hạn mức/quyền sử dụng riêng**.
- Tạo thêm Antigravity conversation hoặc worktree **không sinh ra quota mới**.
- Một tài khoản Google khác có quyền hợp lệ có thể làm việc trên cùng Git repository, nhưng hội thoại, quyền môi trường, token và trạng thái workspace **không tự chuyển theo**.
- Tài liệu này là **bản ghi ngữ cảnh có phiên bản**, **không phải** kho lưu secrets, giấy phép deploy hay lệnh tự động để agent thực thi.


## 11. Cập nhật từ báo cáo DEV R1 (đọc trước khi phân công agent)

**Nguồn:** `EV_SPRINT_48H_00_R1_PO_DECISION_SYNC.md`, thời gian báo cáo **26/10/2026 23:58 (UTC+7)**. Đây là báo cáo rà soát **READ-ONLY**, chưa có code Feature F02/F03/F04 nào được báo cáo là đã triển khai.

### 11.1. Những nội dung đã được DEV đồng bộ đúng

- F01 giữ **CLOSED trong phạm vi Beta** tại `863726919d4f6b4975fd2ef05ffb65a50c7b4dee`.
- Chiến lược mới: **DEV 1 → F03 (P0); DEV 2 → F04 (P0); DEV 3 → F02 (P1)**. F05/F06 là phương án làm sau nếu còn thời gian, không được tự ý chen vào đường găng.
- F03 **không phụ thuộc migration** và có thể triển khai sớm; chưa có bằng chứng API key hiện tại truy cập được các model Gemini đề xuất.
- F02 và F04 đều sửa `prisma/schema.prisma`. Mỗi DEV làm việc trong **worktree riêng**, Release Integrator đối chiếu và thống nhất migration additive-only trước khi xin phép chạm Neon Beta.
- Theo đề xuất R1, **tên nhánh và vị trí worktree** dự kiến:

  | Agent | Nhánh dự kiến | Worktree gợi ý trên Windows |
  | --- | --- | --- |
  | DEV 1 F03 | `feature/f03-gemini-ai` | `D:\TDTU\wt_f03_gemini` |
  | DEV 2 F04 | `feature/f04-membership-kpi` | `D:\TDTU\wt_f04_membership` |
  | DEV 3 F02 | `feature/f02-complaints-48h` | `D:\TDTU\wt_f02_complaints` |

  **Đây chỉ là đường dẫn dự kiến**. DEV phải xác nhận đường dẫn/nhánh **thực tế** sau khi tạo; không tạo worktree trùng nhánh hoặc ghi đè thư mục đã có.

### 11.2. Model B: các đề xuất DEV chưa phải quyết định PO

DEV R1 đã **đề xuất** (chưa được PO duyệt):

- Trọng số KPI: **Doanh thu 40%, Sản lượng 30%, Tuần mua hàng 20%, Kỷ luật thanh toán 10%**.
- Định mức chuẩn hóa: **80.000.000 VND doanh thu thuần, 2.000 kg sản lượng, 8 tuần active trong quý**.
- Điểm kỷ luật gốc 100: **trừ 20 điểm/đơn hủy do khách, trừ 10 điểm/đơn quá hạn thanh toán 10 phút**.
- Chống chia nhỏ đơn: đếm **tuần active** thay vì đếm số đơn.
- Làm tròn `Math.round`, kẹp `[0,100]`, dùng doanh thu thuần sau bồi thường.
- Điều kiện **đơn từ 50 kg** mới giảm phí vận chuyển: **đề xuất về vị trí áp dụng PAR-15**, không phải quyết định đã xác nhận.
- Lấy **tháng của `User.createdAt`** để áp hệ số khách hàng mới: **đề xuất**, chưa xác nhận mốc tính.

**Ràng buộc:** Không tự mã hóa những thông số trên thành quy tắc sản xuất/Checkout/Beta trước khi có quyết định PO. Có thể chuẩn bị cấu trúc Model B, unit tests cho các giá trị đã được duyệt hoặc prototype có gắn nhãn rõ ràng, nhưng không tự bật xét hạng hoặc chiết khấu tự động chưa được duyệt.

### 11.3. Những phần báo cáo R1 cần thận trọng

- R1 có diễn giải **PAR-10** là `min(10%, group + tier)` nhưng cho phép giữ riêng mức group discount trên 10% nếu có hợp đồng. **Ngoại lệ này chưa được xác nhận bằng quyết định PO trong tài liệu bàn giao hiện có**. Phải xác minh từ chính sách gốc trước khi code, không tự áp dụng làm ngoại lệ mặc định.
- R1 đề xuất **Admin gán hạng thủ công** nếu Model B chưa được duyệt. Đây là **phương án dự phòng đề xuất**, không phải sự thay thế mặc định cho quyết định PO về xét hạng tự động theo quý.
- R1 dự kiến hợp nhất F02+F04 thành **một migration**. Chỉ thực hiện khi thiết kế và hai nhánh đủ ổn định; không buộc F03 phải đợi migration, và không mặc nhiên cấp quyền chạy migration lên Beta.
- Không dùng các dự báo thời gian DEV như lời hứa hoàn thành đúng hạn; yêu cầu báo cáo commit/test thực tế.

### 11.4. Kiểm soát tài liệu handoff

- File này phải nằm ở **thư mục gốc Git repository** (đường dẫn do `git rev-parse --show-toplevel` trả về), với tên chính xác `EVIBE_PROJECT_HANDOFF.md`.
- Trước khi tạo nhánh/worktree DEV 1–3, cần **commit riêng file handoff trên local `beta`**, xác minh commit chứa file này. Khi tạo worktree phải dùng **local `beta` tại commit mới**, không dùng nhầm `origin/beta` cũ.
- Nếu `beta` đã có các commit/migration khác sau F01, **không reset hoặc ghi đè**; báo cáo HEAD hiện tại và hỏi Release Integrator xử lý.
- File handoff là tài liệu đọc và cập nhật checkpoint, **không phải giấy phép** để agent tự push/deploy/migrate/ghi Production.
- Cập nhật khi mỗi agent hoàn tất chặng: branch/HEAD, các file đã sửa, test, trạng thái QA, những quyết định còn chờ, bước tiếp theo và thời điểm.
