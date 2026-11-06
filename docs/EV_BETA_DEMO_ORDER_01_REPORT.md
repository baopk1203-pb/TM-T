# EV-BETA-DEMO-ORDER-01 — REPORT
## FINAL RECONCILIATION, HARMONIZED DELIVERY SLOTS & BETA RELEASE READINESS

**Dự án:** E Vibe — Nông Sản B2B  
**Agent:** DEV 1 — Release Integrator / Senior Full-Stack Engineer  
**Ủy quyền:** ChatGPT 1 — Main Coordinator  
**Task ID:** `EV-BETA-DEMO-ORDER-01 — FINAL RECONCILIATION & BETA RELEASE`  
**Ngày thực hiện:** 2026-10-29  
**Chế độ:** `READ-ONLY INVESTIGATION / HARMONIZED UI HOTFIX / RELEASE PREPARATION`  
**Final Verdict:** `DELIVERY SLOTS HARMONIZED & DB VERIFICATION TOOL SCRIPT AUDITED — AWAITING PO APPROVAL FOR BETA PUSH`

---

## I. THÔNG TIN PHIÊN LÀM VIỆC & GIT IDENTITIES

| Thuộc tính | Giá trị |
|---|---|
| **Task ID** | `EV-BETA-DEMO-ORDER-01 — FINAL RECONCILIATION` |
| **Worktree** | `D:\TDTU\wt_f02_f04_integration` |
| **Hotfix Branch** | `fix/qa05-delivery-slot-hotfix` |
| **Base Commit (origin/beta)** | `7ede4cfcdacb8ba6c72dea6c7568063fe244e990` |
| **Commit 1 (UI Initial Fix)** | `d9d7a54a938c5f0f35368a183dca01d1c312fb27` |
| **Commit 2 (DB Verify Tooling)** | `b3f52f4477c7fdb7dc635c91f0340ea5779c1ef3` |
| **Commit 3 (Report Initial)** | `301c4cb3a929d397130f444beff98ebcbb50ff4c` |
| **Commit 4 (Full Harmonization)** | `4e0c1c54625b50873a45cceea9fdb53d39589d97` |
| **Branch `main`** | **Untouched** (Không checkout, không merge, không push) |
| **Branch `beta`** | **Untouched** (Chưa merge/push; tuân thủ dừng chờ PO phê duyệt) |

---

## II. TASK A — TIÊU CHUẨN HÓA VÀ ĐỒNG BỘ TOÀN DIỆN KHUNG GIỜ GIAO HÀNG (DELIVERY SLOTS)

### 1. Bảng quy chuẩn khung giờ giao hàng duy nhất (Single Source of Truth)

Toàn bộ hệ thống được quy về nguồn định nghĩa duy nhất tại `src/lib/domain/delivery-date.ts` (và re-export qua `src/lib/utils.ts`):

| Slot Enum (DB) | Label Ngắn (`short`) | Label Đầy Đủ (`full`) | Khoảng giờ thực tế |
|---|---|---|---|
| `MORNING` | `Sáng (07:00 - 11:30)` | `Buổi sáng (07:00 - 11:30)` | 07:00 – 11:30 |
| `AFTERNOON` | `Chiều (13:30 - 17:30)` | `Buổi chiều (13:30 - 17:30)` | 13:30 – 17:30 |
| `EVENING` | `Tối (18:00 - 21:00)` | `Buổi tối (18:00 - 21:00)` | 18:00 – 21:00 |
| `null` / `undefined` / `""` | `Cả ngày` | `Cả ngày` | Trong ngày |

### 2. Danh sách kiểm tra rà soát 100% các điểm chạm (Touchpoints Audit)

DEV 1 đã rà soát toàn bộ codebase và thay thế triệt để các chuỗi hardcode:

| # | Điểm chạm giao diện / Thông báo | File path | Trạng thái trước | Trạng thái sau chuẩn hóa |
|---|---|---|---|---|
| 1 | **Checkout Selection** | `src/app/thanh-toan/checkout-view.tsx` | `6h – 11h`, `13h – 17h`, `18h – 21h` | Dùng `DELIVERY_TIME_SLOTS`: `07:00 - 11:30`, `13:30 - 17:30`, `18:00 - 21:00` |
| 2 | **Customer Order Detail** | `src/app/tai-khoan/don-hang/[code]/customer-order-view.tsx` | Ternary hardcode; EVENING bị fallback thành `Cả ngày` | Dùng `formatDeliveryTimeSlot(order.timeSlot)`: `Buổi sáng (07:00 - 11:30)`, `Buổi tối (18:00 - 21:00)` |
| 3 | **Admin Order Detail** | `src/app/admin/don-hang/[code]/order-detail-client.tsx` | Ternary hardcode; EVENING bị fallback thành `Cả ngày` | Dùng `formatDeliveryTimeSlot(order.timeSlot)`: Chuẩn hóa 100% |
| 4 | **Admin Order List** | `src/app/admin/don-hang/order-list-client.tsx` | Ternary hardcode; EVENING bị fallback thành `Cả ngày` | Dùng `formatDeliveryTimeSlot(order.timeSlot, 'short')` |
| 5 | **Admin Shipping Management** | `src/app/admin/van-chuyen/shipping-management-client.tsx` | Hardcode lệch giờ: `8-12h`, `13-17h`, `17-20h` | Dùng `formatDeliveryTimeSlot(item.timeSlot, 'short')` |
| 6 | **Admin Packing Slip Modal** | `src/components/admin/packing-slip-modal.tsx` | Hardcode switch: `08:00 - 12:00`, `13:00 - 17:00`, `17:00 - 20:00` | Dùng `formatDeliveryTimeSlot(slot, 'short')` |
| 7 | **Customer Dashboard** | `src/app/tai-khoan/page.tsx` | Object map thiếu slot hoặc sai giờ | Chuẩn hóa `07:00 - 11:30`, `13:30 - 17:30`, `18:00 - 21:00` |
| 8 | **Customer Recurring** | `src/app/tai-khoan/dinh-ky/recurring-client.tsx` | `TIME_SLOT_LABELS` lệch giờ | Chuẩn hóa `07:00 - 11:30`, `13:30 - 17:30`, `18:00 - 21:00` |
| 9 | **Admin Recurring** | `src/app/admin/dinh-ky/admin-recurring-client.tsx` | `TIME_SLOT_NAMES` lệch giờ | Chuẩn hóa `07:00 - 11:30`, `13:30 - 17:30`, `18:00 - 21:00` |
| 10 | **Order Placed Email** | `src/lib/email/templates.ts` (Order Placed) | Ternary hardcode thiếu EVENING | Dùng `formatDeliveryTimeSlot(data.order.timeSlot)` |
| 11 | **Order Shipping Email** | `src/lib/email/templates.ts` (Shipping) | Ternary hardcode thiếu EVENING | Dùng `formatDeliveryTimeSlot(data.order.timeSlot)` |

👉 **Xác nhận:** Không còn bất kỳ file nào trong hệ thống hiển thị `06:00–11:00`, `08:00–12:00`, `13:00–17:00`, `17:00–20:00` hoặc làm fallback slot `EVENING` thành `Cả ngày`.

---

## III. TASK B — KIỂM DUYỆT BỘ CÔNG CỤ XÁC MINH CSDL LIVE (`scripts/secure-beta-verify-order.*`)

### 1. Bảng đối chiếu 9 Tiêu chí An toàn (Safety Directives Checklist)

| # | Tiêu chí an toàn | Triển khai trong Script | Trạng thái Audit |
|---|---|---|---|
| 1 | **Fail-Closed khi thiếu biến môi trường hoặc sai host** | Cả `.ps1` (Assert-TargetDatabaseSafety) và `.ts` (Fail-Closed Guards) đều kiểm tra rỗng, kiểm tra host suffix `.c-7.us-east-2.aws.neon.tech` và cluster ID `b5f117np`. Thoát ngay lập tức với Exit 1 nếu sai. | **ĐẠT** |
| 2 | **Chặn tuyệt đối endpoint Production** | Blocklist `ep-square-scene-b5ddgxil` được tích hợp cứng ở đầu file PowerShell và TypeScript. Phát hiện là abort ngay. | **ĐẠT** |
| 3 | **100% Chỉ đọc (No mutations, No DDL)** | Chỉ dùng Prisma `findUnique` và `findMany` với mệnh đề `select` tường minh. 0 câu lệnh `create`, `update`, `delete`, `upsert`, `$executeRaw`. | **ĐẠT** |
| 4 | **Bảo vệ dữ liệu cá nhân (No PII logged)** | Loại bỏ hoàn toàn các trường: `user.phone`, `user.email`, `user.name`, `addressSnapshot`, `customerNote`, `recipientName`, `recipientPhone`. Chỉ truy vấn ID, vai trò, hạng thành viên, thông số tiền và lô hàng. | **ĐẠT** |
| 5 | **Không lộ credentials qua CLI arguments** | PowerShell dùng `Read-Host -AsSecureString` che ký tự nhập. Chuỗi kết nối được truyền sang process TypeScript qua bộ nhớ `$env:DATABASE_URL` (không truyền qua CLI args). Khối `finally` xóa sạch `$env:DATABASE_URL = $null`. | **ĐẠT** |
| 6 | **Xử lý trạng thái reservation hết hạn** | Script so sánh `alloc.holdExpiresAt` với `new Date()` hiện tại. Hiển thị rõ: `Allocated Quantity` tại thời điểm tạo đơn, và trạng thái hiện tại (`ACTIVE` hay `EXPIRED - Thời hạn 10p đã qua`). | **ĐẠT** |
| 7 | **Khớp chính xác tên quan hệ Prisma** | Đã sửa `order.inventoryLedgers` và `batch.ledgerEntries` khớp 100% schema. Không lỗi quan hệ. | **ĐẠT** |
| 8 | **Kiểm thử tự động các cổng an toàn** | Script test `tests/unit/secure-beta-verify-order.test.ps1` kiểm tra 5 kịch bản (Production, sai host, sai DB name, sai scheme, host hợp lệ). | **5/5 PASS** |
| 9 | **Không tự ý chạy lên Live DB** | DEV 1 tuân thủ tuyệt đối không chạy script lên Live Neon trong phiên này. Toàn bộ mã nguồn được bàn giao nguyên bản để PO kiểm duyệt. | **ĐẠT** |

---

### 2. Toàn văn mã nguồn Script để Coordinator & PO kiểm tra

#### File 1: `scripts/secure-beta-verify-order.ps1`
```powershell
# scripts/secure-beta-verify-order.ps1
# ==============================================================================
# SECURE ONE-TIME NEON PREVIEW-BETA DEMO ORDER VERIFICATION SCRIPT
# TASK: EV-BETA-DEMO-ORDER-01
# DESIGN STANDARD: Main Coordinator Safety Directives
# ==============================================================================

[CmdletBinding()]
param(
    [string]$OrderCode = "DH-261029-ASRT",
    [System.Security.SecureString]$TestSecureConnectionString = $null,
    [switch]$TestValidateOnly = $false
)

$ErrorActionPreference = 'Stop'

$APPROVED_TARGET_HOST   = "ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech"
$PRODUCTION_ENDPOINT_ID = "ep-square-scene-b5ddgxil"
$EXPECTED_DATABASE_NAME = "neondb"
$EXPECTED_PORT          = 5432
$ALLOWED_SCHEMES        = @("postgres", "postgresql")

$appRoot = (Resolve-Path "$PSScriptRoot\..").Path

function Assert-TargetDatabaseSafety {
    param([string]$ConnectionString)

    if ([string]::IsNullOrWhiteSpace($ConnectionString)) {
        throw "FAIL-CLOSED: Chuoi ket noi rong."
    }

    if ($ConnectionString.ToLower().Contains($PRODUCTION_ENDPOINT_ID.ToLower())) {
        throw "FAIL-CLOSED (GUARD 1): Phat hien Production Endpoint ($PRODUCTION_ENDPOINT_ID)! Tuyet doi cam truy van tren Production."
    }

    $uri = $null
    try {
        $uri = [System.Uri]::new($ConnectionString)
    } catch {
        throw "FAIL-CLOSED: Dinh dang URI chuoi ket noi khong hop le."
    }

    if ($ALLOWED_SCHEMES -notcontains $uri.Scheme.ToLower()) {
        throw "FAIL-CLOSED: Scheme khong hop le ($($uri.Scheme)). Chi chap nhan postgres:// hoac postgresql://"
    }

    if (-not $uri.Host.ToLower().EndsWith(".c-7.us-east-2.aws.neon.tech")) {
        throw "FAIL-CLOSED: Host phai thuoc Neon AWS US-East-2 (.c-7.us-east-2.aws.neon.tech)."
    }

    if ($uri.Host.ToLower() -ne $APPROVED_TARGET_HOST.ToLower() -and $uri.Host.ToLower() -ne $APPROVED_TARGET_HOST.ToLower().Replace("b5f117np", "b5f117np-pooler")) {
        throw "FAIL-CLOSED: Host ($($uri.Host)) khong khop voi target da duoc phe duyet ($APPROVED_TARGET_HOST)."
    }

    $dbName = $uri.AbsolutePath.TrimStart('/')
    if ($dbName.ToLower() -ne $EXPECTED_DATABASE_NAME.ToLower()) {
        throw "FAIL-CLOSED: Database name ($dbName) khong dung voi database phe duyet ($EXPECTED_DATABASE_NAME)."
    }
}

# 1. Thu thap connection string
$connStr = $null
if ($PSBoundParameters.ContainsKey('TestSecureConnectionString') -and $null -ne $TestSecureConnectionString) {
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($TestSecureConnectionString)
    try {
        $connStr = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
} elseif (-not [string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
    $connStr = $env:DATABASE_URL
    Write-Host "[INFO] Su dung DATABASE_URL tu session process hien tai." -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "================================================================================" -ForegroundColor Yellow
    Write-Host "  E VIBE -- ONE-TIME SECURE DEMO ORDER VERIFICATION" -ForegroundColor Yellow
    Write-Host "  Vui long dan chuoi ket noi Neon Preview-Beta (Input duoc che giau bao mat):" -ForegroundColor Yellow
    Write-Host "================================================================================" -ForegroundColor Yellow
    Write-Host ""

    $secureInput = Read-Host -Prompt "Neon Preview-Beta Connection String" -AsSecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureInput)
    try {
        $connStr = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

# 2. Validate safety gates
try {
    Assert-TargetDatabaseSafety -ConnectionString $connStr
    Write-Host "[PASS] Target Database Safety Gate: Verified $APPROVED_TARGET_HOST / $EXPECTED_DATABASE_NAME" -ForegroundColor Green
} catch {
    Write-Error "[ABORT] $_"
    exit 1
}

if ($TestValidateOnly) {
    Write-Host "[TEST] Validate-only flag active. Exit 0." -ForegroundColor Green
    exit 0
}

# 3. Thuc thi truy van Read-Only
Push-Location $appRoot
try {
    $env:DATABASE_URL = $connStr
    $env:DIRECT_URL   = $connStr

    Write-Host ""
    Write-Host "[EXEC] Dang thuc thi truy van SELECT doc du lieu tu Neon Preview-Beta..." -ForegroundColor Cyan
    npx tsx scripts/secure-beta-verify-order.ts $OrderCode
    $exitCode = $LASTEXITCODE

    if ($exitCode -eq 0) {
        Write-Host ""
        Write-Host "[SUCCESS] Truy van xac minh hoan tat thanh cong!" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "[FAIL] Script truy van tra ve exit code: $exitCode" -ForegroundColor Red
        exit $exitCode
    }
} finally {
    $env:DATABASE_URL = $null
    $env:DIRECT_URL   = $null
    $connStr = $null
    Pop-Location
}
```

#### File 2: `scripts/secure-beta-verify-order.ts`
```typescript
import { PrismaClient } from '@prisma/client'

// ==============================================================================
// FAIL-CLOSED SAFETY GUARDS
// ==============================================================================
const dbUrl = process.env.DATABASE_URL || ''
const APPROVED_HOST = 'ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech'
const PRODUCTION_HOST = 'ep-square-scene-b5ddgxil'

if (!dbUrl) {
  console.error('[FAIL-CLOSED] DATABASE_URL is empty! Aborting execution.')
  process.exit(1)
}
if (dbUrl.includes(PRODUCTION_HOST)) {
  console.error('[FAIL-CLOSED CRITICAL] Production database detected! Aborting execution immediately.')
  process.exit(1)
}
if (!dbUrl.includes('c-7.us-east-2.aws.neon.tech') || !dbUrl.includes('b5f117np')) {
  console.error(`[FAIL-CLOSED] Target host does not match approved Preview-Beta target (${APPROVED_HOST})!`)
  process.exit(1)
}

const prisma = new PrismaClient()

async function main() {
  const orderCode = process.argv[2] || 'DH-261029-ASRT'

  console.log(`\n================================================================================`)
  console.log(`  E VIBE — NEON PREVIEW-BETA DEMO ORDER READ-ONLY VERIFICATION`)
  console.log(`  Target Order : ${orderCode}`)
  console.log(`  Target Host  : ${APPROVED_HOST}`)
  console.log(`  Mode         : 100% READ-ONLY (No mutations, No DDL, No PII logged)`)
  console.log(`================================================================================\n`)

  // 1. Fetch target Order (strictly excluding customer PII: no phone, email, recipient name, address details)
  const order = await prisma.order.findUnique({
    where: { code: orderCode },
    select: {
      id: true,
      code: true,
      type: true,
      status: true,
      paymentOption: true,
      subtotal: true,
      baseShippingFee: true,
      shippingDiscountAmount: true,
      shippingFee: true,
      total: true,
      depositAmount: true,
      finalSubtotal: true,
      finalTotal: true,
      groupDiscountPercent: true,
      membershipTierSnapshot: true,
      membershipDiscountPercent: true,
      combinedDiscountPercent: true,
      deliveryDate: true,
      timeSlot: true,
      paymentDueAt: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          role: true,
          membershipTier: true,
          group: {
            select: {
              name: true,
              discountPercent: true,
            },
          },
        },
      },
      items: {
        select: {
          id: true,
          productName: true,
          packagingName: true,
          quantity: true,
          orderedGrams: true,
          unitPricePerKg: true,
          lineTotal: true,
          batchId: true,
          allocations: {
            select: {
              id: true,
              batchId: true,
              allocatedGrams: true,
              dispatchedGrams: true,
              releasedGrams: true,
              status: true,
              holdExpiresAt: true,
              releasedAt: true,
              createdAt: true,
              batch: {
                select: {
                  code: true,
                  status: true,
                  isFefoEligible: true,
                  harvestDate: true,
                  expiryDate: true,
                },
              },
            },
          },
        },
      },
      inventoryLedgers: {
        select: {
          id: true,
          type: true,
          quantityGrams: true,
          idempotencyKey: true,
          referenceCode: true,
          createdAt: true,
          batch: {
            select: {
              code: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
      transactions: {
        select: {
          id: true,
          type: true,
          status: true,
          method: true,
          amount: true,
          reference: true,
          createdAt: true,
        },
      },
      events: {
        select: {
          id: true,
          type: true,
          fromStatus: true,
          toStatus: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!order) {
    console.error(`[FAIL] Order ${orderCode} NOT FOUND on Neon Preview-Beta!`)
    process.exit(1)
  }

  // --- TASK A: ORDER FINANCIAL RECONCILIATION ---
  console.log(`--- [TASK A: FINANCIAL & ORDER ATTRIBUTES] ---`)
  console.log(`Order Code              : ${order.code}`)
  console.log(`Order Type              : ${order.type}`)
  console.log(`Order Status            : ${order.status}`)
  console.log(`Payment Option          : ${order.paymentOption}`)
  console.log(`Delivery Date (DB Date) : ${order.deliveryDate ? order.deliveryDate.toISOString().split('T')[0] : 'N/A'}`)
  console.log(`TimeSlot Enum (DB Code) : ${order.timeSlot ?? 'N/A'}`)
  console.log(`Merchandise Subtotal    : ${order.subtotal.toLocaleString('vi-VN')} VND (Expected: 3.720.000)`)
  console.log(`Base Shipping Fee       : ${order.baseShippingFee?.toLocaleString('vi-VN') ?? 'N/A'} VND (Expected: 466.000)`)
  console.log(`Shipping Discount       : ${order.shippingDiscountAmount?.toLocaleString('vi-VN') ?? '0'} VND (Expected: 23.300)`)
  console.log(`Final Shipping Fee      : ${order.shippingFee.toLocaleString('vi-VN')} VND (Expected: 442.700)`)
  console.log(`Order Total             : ${order.total.toLocaleString('vi-VN')} VND (Expected: 4.162.700)`)
  console.log(`Deposit Amount (30%)    : ${order.depositAmount.toLocaleString('vi-VN')} VND (Expected: 1.249.000)`)
  console.log(`Payment Due At          : ${order.paymentDueAt ? order.paymentDueAt.toISOString() : 'N/A'}`)
  console.log(`Order Created At (UTC)  : ${order.createdAt.toISOString()}`)

  // --- TASK C: F04 MEMBERSHIP SNAPSHOT RECONCILIATION ---
  console.log(`\n--- [TASK C: F04 MEMBERSHIP SNAPSHOTS] ---`)
  console.log(`Current User Tier       : ${order.user?.membershipTier ?? 'N/A'}`)
  console.log(`User Group Discount     : ${order.groupDiscountPercent}% (Expected: 5%)`)
  console.log(`membershipTierSnapshot  : ${order.membershipTierSnapshot ?? 'NULL'} (Expected: BRONZE)`)
  console.log(`membershipDiscountPct   : ${order.membershipDiscountPercent}% (Expected: 2%)`)
  console.log(`combinedDiscountPct     : ${order.combinedDiscountPercent}% (Expected: 7%)`)
  console.log(`baseShippingFee Snapshot: ${order.baseShippingFee?.toLocaleString('vi-VN') ?? 'NULL'} VND`)
  console.log(`shippingDiscount Snapshot: ${order.shippingDiscountAmount?.toLocaleString('vi-VN') ?? 'NULL'} VND`)

  // --- TASK B: FEFO ALLOCATION & INVENTORY LEDGER ---
  console.log(`\n--- [TASK B: F01 FEFO ALLOCATION & RESERVATION] ---`)
  console.log(`Items count: ${order.items.length}`)

  let totalAllocatedGrams = 0
  for (const item of order.items) {
    console.log(`  Item: ${item.productName} | ${item.packagingName}`)
    console.log(`  Quantity: ${item.quantity} packages | Ordered: ${item.orderedGrams / 1000} kg | Unit Price: ${item.unitPricePerKg.toLocaleString('vi-VN')} VND/kg | Total: ${item.lineTotal.toLocaleString('vi-VN')} VND`)
    console.log(`  Allocations count: ${item.allocations.length}`)

    for (const alloc of item.allocations) {
      totalAllocatedGrams += alloc.allocatedGrams
      const isExpired = alloc.holdExpiresAt && new Date() > alloc.holdExpiresAt
      console.log(`    - Allocation ID     : ${alloc.id}`)
      console.log(`      Batch Code        : ${alloc.batch.code}`)
      console.log(`      Batch Status      : ${alloc.batch.status}`)
      console.log(`      FEFO Eligible     : ${alloc.batch.isFefoEligible}`)
      console.log(`      Expiry Date       : ${alloc.batch.expiryDate ? alloc.batch.expiryDate.toISOString().split('T')[0] : 'N/A'}`)
      console.log(`      Allocated Quantity: ${alloc.allocatedGrams / 1000} kg (${alloc.allocatedGrams} g)`)
      console.log(`      Allocation Status : ${alloc.status}`)
      console.log(`      Hold Expires At   : ${alloc.holdExpiresAt ? alloc.holdExpiresAt.toISOString() : 'N/A'}`)
      console.log(`      Hold Time Status  : ${isExpired ? 'EXPIRED (Thời hạn 10p đã qua)' : 'ACTIVE (Trong thời hạn)'}`)
      console.log(`      Released Quantity : ${alloc.releasedGrams / 1000} kg`)
      console.log(`      Released At       : ${alloc.releasedAt ? alloc.releasedAt.toISOString() : 'N/A'}`)
    }
  }
  console.log(`Total Allocated Grams: ${totalAllocatedGrams / 1000} kg (${totalAllocatedGrams} g) (Target: 50 kg)`)

  console.log(`\nInventory Ledgers for this Order (${order.inventoryLedgers.length} records):`)
  for (const l of order.inventoryLedgers) {
    console.log(`  - Ledger [${l.type}] Batch: ${l.batch.code} | Qty: ${l.quantityGrams / 1000} kg | Key: ${l.idempotencyKey} | Ref: ${l.referenceCode} | At: ${l.createdAt.toISOString()}`)
  }

  // Query all Ri6 batches to verify FEFO candidate selection priority
  const ri6Batches = await prisma.batch.findMany({
    where: {
      product: { slug: 'sau-rieng-ri6' },
    },
    include: {
      ledgerEntries: {
        select: {
          type: true,
          quantityGrams: true,
        },
      },
      allocations: {
        select: {
          allocatedGrams: true,
          releasedGrams: true,
          status: true,
        },
      },
    },
    orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
  })

  console.log(`\n--- [SẦU RIÊNG RI6 BATCHES CANDIDATE EVALUATION] ---`)
  for (const b of ri6Batches) {
    const importGrams = b.ledgerEntries.filter((l) => l.type === 'IMPORT').reduce((s, l) => s + l.quantityGrams, 0)
    const holdGrams = b.ledgerEntries.filter((l) => l.type === 'RESERVATION_HOLD').reduce((s, l) => s + l.quantityGrams, 0)
    const relGrams = b.ledgerEntries.filter((l) => l.type === 'RESERVATION_RELEASE').reduce((s, l) => s + l.quantityGrams, 0)
    const dispGrams = b.ledgerEntries.filter((l) => l.type === 'DISPATCH_OUT').reduce((s, l) => s + l.quantityGrams, 0)
    const availGrams = importGrams - (holdGrams - relGrams) - dispGrams

    console.log(`  - Batch: ${b.code} | Status: ${b.status} | FEFO: ${b.isFefoEligible} | Expiry: ${b.expiryDate ? b.expiryDate.toISOString().split('T')[0] : 'N/A'}`)
    console.log(`    Imported: ${importGrams / 1000} kg | Net Hold: ${(holdGrams - relGrams) / 1000} kg | Available: ${availGrams / 1000} kg`)
  }

  console.log(`\n--- [PAYMENT TRANSACTIONS & ORDER EVENTS] ---`)
  console.log(`Transactions (${order.transactions.length}):`)
  for (const tx of order.transactions) {
    console.log(`  - Tx [${tx.type}] ${tx.method} | Status: ${tx.status} | Amount: ${tx.amount.toLocaleString('vi-VN')} VND | Ref: ${tx.reference ?? 'N/A'}`)
  }
  console.log(`Order Events (${order.events.length}):`)
  for (const evt of order.events) {
    console.log(`  - Event: ${evt.type} | Transition: ${evt.fromStatus ?? 'INIT'} -> ${evt.toStatus ?? 'N/A'} | At: ${evt.createdAt.toISOString()}`)
  }

  console.log(`\n================================================================================`)
  console.log(`  VERIFICATION FINISHED: 100% READ-ONLY SELECT COMPLETED WITH 0 MUTATIONS`)
  console.log(`================================================================================\n`)
}

main()
  .catch((e) => {
    console.error('[EXECUTION ERROR]', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
```

---

## IV. TASK C — BẰNG CHỨNG KIỂM THỬ XÁC NHẬN (QUALITY GATE EVIDENCE)

### 1. Targeted Unit Tests (22/22 PASS)
```bash
npm test tests/unit/qa05-delivery-slot.test.ts tests/unit/delivery-date.test.ts tests/unit/cc01-product-preview-pipeline.test.ts
```
**Kết quả:**
- `cc01-product-preview-pipeline.test.ts`: **6/6 PASS**
- `delivery-date.test.ts`: **9/9 PASS**
- `qa05-delivery-slot.test.ts`: **7/7 PASS** (bao gồm test case xác nhận không một format nào biến `EVENING` thành `Cả ngày`)
- **Tổng cộng: 22/22 PASS** (Thời gian chạy: 159 ms).

### 2. PowerShell Script Safety Tests (5/5 PASS)
```powershell
powershell -ExecutionPolicy Bypass -File tests/unit/secure-beta-verify-order.test.ps1
```
**Kết quả:**
- `[PASS] Reject Production Endpoint`
- `[PASS] Reject Wrong Host`
- `[PASS] Reject Wrong Database Name`
- `[PASS] Reject Non-Postgres Scheme`
- `[PASS] Accept Valid Approved Target Host`
- **Tổng cộng: 5/5 PASS**.

### 3. TypeScript Typecheck (0 Errors)
```bash
npm run typecheck
# Exit code: 0
```

### 4. Production Build Verification (0 Errors)
```bash
npm run build
# ✓ Compiled successfully in 1957ms
# ✓ Generating static pages (15/15) in 202ms
# Exit code: 0
```

---

## V. TỔNG KẾT & TRẠNG THÁI CHỜ PHÊ DUYỆT (RELEASE GATE)

```
================================================================================
STATUS               : ALL IMPLEMENTATION, HARMONIZATION & TESTS COMPLETED
WORKTREE             : D:\TDTU\wt_f02_f04_integration
BRANCH               : fix/qa05-delivery-slot-hotfix
HEAD COMMIT          : 4e0c1c54625b50873a45cceea9fdb53d39589d97
PRISMA SCHEMA DIFF   : 0 CHANGES
MIGRATIONS           : 0 NEW MIGRATIONS
BRANCH MAIN          : STRICTLY UNTOUCHED
BRANCH BETA          : READY FOR FAST-FORWARD MERGE (ON HOLD PENDING PO APPROVAL)
================================================================================
```

**DEV 1 báo cáo hoàn tất và xin dừng tại cổng chờ:**
1. Xin PO phê duyệt chuẩn hóa khung giờ giao hàng (`MORNING: 07:00–11:30`, `AFTERNOON: 13:30–17:30`, `EVENING: 18:00–21:00`).
2. Xin quyết định của PO/Coordinator về việc thực thi script `secure-beta-verify-order.ps1` trên Neon Preview-Beta.
3. Khi nhận được lệnh phê duyệt, DEV 1 sẽ lập tức:
   - Fast-forward merge `fix/qa05-delivery-slot-hotfix` vào `beta`.
   - Push lên `origin/beta`.
   - Giám sát Vercel Preview Deployment đạt `status: ● Ready`.
   - Bàn giao link và commit SHA cho ChatGPT Work để smoke test browser pass duy nhất.
