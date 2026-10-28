# scripts/secure-beta-migrate.ps1
# ==============================================================================
# SECURE ONE-TIME PRISMA MIGRATION RUNNER FOR NEON PREVIEW-BETA
# TASK: EV-BETA-RELEASE-F02-F04-01 (E VIBE NONG SAN B2B)
# ==============================================================================

[CmdletBinding()]
param(
    [string]$ExpectedHost = "ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech",
    [string]$ProductionEndpointId = "ep-square-scene-b5ddgxil"
)

$ErrorActionPreference = 'Stop'

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   E VIBE B2B - ONE-TIME SECURE MIGRATION: F02 AND F04 -> BETA   " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Kiem tra thu muc lam viec va migration artifacts
$f04MigPath = "prisma/migrations/20261028203000_f04_membership_and_quarterly_kpi/migration.sql"
$f02MigPath = "prisma/migrations/20261028213000_f02_two_way_complaints/migration.sql"

if (-not (Test-Path $f04MigPath) -or -not (Test-Path $f02MigPath)) {
    Write-Host "[LOI KHOI DONG] Khong tim thay file migration F04/F02!" -ForegroundColor Red
    Write-Host "Vui long mo PowerShell va dieu huong dung vao thu muc worktree:" -ForegroundColor Yellow
    Write-Host "  cd 'D:\TDTU\wt_f02_f04_integration\nong-san-b2b'" -ForegroundColor White
    exit 1
}

# 2. Nhap an Connection String qua SecureString (Khong hien thi, khong ghi history)
Write-Host "Vui long dan Direct Connection String cua Neon preview-beta." -ForegroundColor Yellow
Write-Host "(Chuoi ket noi se duoc an hoan toan va khong luu vao lich su lenh)" -ForegroundColor DarkGray
$secureConn = Read-Host -Prompt "Direct Connection String" -AsSecureString

if ($null -eq $secureConn -or $secureConn.Length -eq 0) {
    Write-Host "[HUY BO] Chuoi ket noi rong. Da dung thuc thi." -ForegroundColor Red
    exit 1
}

# 3. Giai ma tam thoi trong bo nho tien trinh de validate an toan
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureConn)
$plainConn = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

try {
    # 4. Kiem tra cu phap va Hostname Safety Guard
    $uri = [System.Uri]$plainConn
    $dbHost = $uri.Host.ToLower()
    $dbName = $uri.AbsolutePath.Trim('/')

    # HARD GUARD 1: Blocklist Production
    if ($dbHost -match $ProductionEndpointId) {
        Write-Host ""
        Write-Host "[CHOT CHAN AN TOAN KICH HOAT] CANH BAO NGUY HIEM!" -ForegroundColor Red -BackgroundColor DarkRed
        Write-Host "Hostname '$dbHost' thuoc co so du lieu PRODUCTION ($ProductionEndpointId)!" -ForegroundColor Red
        Write-Host "TUYET DOI KHONG CHAY MIGRATION TREN PRODUCTION!" -ForegroundColor Red
        exit 1
    }

    # HARD GUARD 2: Direct Connection Only (Chan -pooler)
    if ($dbHost -match '-pooler') {
        Write-Host ""
        Write-Host "[CHOT CHAN AN TOAN KICH HOAT] LOI POOLER CONNECTION!" -ForegroundColor Red
        Write-Host "Hostname '$dbHost' su dung pooled endpoint (-pooler)." -ForegroundColor Red
        Write-Host "Prisma Migrate DDL bat buoc phai su dung Direct Connection (port 5432)." -ForegroundColor Yellow
        exit 1
    }

    # HARD GUARD 3: Positive Target Match Neon preview-beta
    if ($dbHost -notmatch 'ep-fancy-waterfall-b5f117np') {
        Write-Host ""
        Write-Host "[CHOT CHAN AN TOAN KICH HOAT] SAI DATABASE DICH!" -ForegroundColor Red
        Write-Host "Hostname '$dbHost' khong khop voi Neon preview-beta ('$ExpectedHost')." -ForegroundColor Red
        exit 1
    }

    Write-Host ""
    Write-Host "[PASS] Xac thuc muc tieu an toan:" -ForegroundColor Green
    Write-Host "  -> Hostname: $dbHost" -ForegroundColor Cyan
    Write-Host "  -> Database: $dbName" -ForegroundColor Cyan
    Write-Host "  -> Phan vung: Neon branch 'preview-beta' (Dung moi truong)" -ForegroundColor Green
    Write-Host ""

    # 5. Gan bien moi truong rieng cho tien trinh hien tai
    $env:DATABASE_URL = $plainConn

    # 6. Thuc thi Buoc 1: Kiem tra baseline
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray
    Write-Host "BUOC 1: KIEM TRA TRANG THAI BASELINE TRUOC MIGRATION..." -ForegroundColor Cyan
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray
    npx prisma migrate status
    Write-Host ""

    # 7. Thuc thi Buoc 2: Chay Prisma Migrate Deploy
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray
    Write-Host "BUOC 2: TIEN HANH THUC THI MIGRATION (F04 + F02)..." -ForegroundColor Cyan
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray
    npx prisma migrate deploy

    if ($LASTEXITCODE -ne 0) {
        throw "Prisma migrate deploy tra ve ma loi $LASTEXITCODE."
    }
    Write-Host ""

    # 8. Thuc thi Buoc 3: Xac minh lai trang thai
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray
    Write-Host "BUOC 3: XAC MINH TRANG THAI CUOI CUNG..." -ForegroundColor Cyan
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray
    npx prisma migrate status

    Write-Host ""
    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host "   MIGRATION HOAN TAT THANH CONG 100%! CO SO DU LIEU DA SAN SANG " -ForegroundColor Green
    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host "PO hay sao chep toan bo output tren va phan hoi: 'Migration da hoan tat thanh cong'." -ForegroundColor Yellow
}
catch {
    Write-Host ""
    Write-Host "[LOI THUC THI MIGRATION] $_" -ForegroundColor Red
    exit 1
}
finally {
    # 9. Don dep sach se bo nho va bien tien trinh
    $env:DATABASE_URL = $null
    [System.Environment]::SetEnvironmentVariable('DATABASE_URL', $null, 'Process')
    $plainConn = $null
    [System.GC]::Collect()
    Write-Host ""
    Write-Host "[BAO MAT] Da xoa hoan toan chuoi ket noi khoi bo nho tien trinh." -ForegroundColor DarkGray
}
