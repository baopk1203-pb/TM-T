# scripts/secure-beta-migrate.ps1
# ==============================================================================
# SECURE ONE-TIME PRISMA MIGRATION RUNNER FOR NEON PREVIEW-BETA
# TASK: EV-BETA-RELEASE-F02-F04-01 - SCRIPT SAFETY FIX
# DESIGN STANDARD: EV-BETA-RELEASE-F02-F04-01 (Main Coordinator Safety Directives)
# ==============================================================================

[CmdletBinding()]
param(
    # Tham so chi dung cho offline fail-closed validation harness (khong dung trong production)
    [System.Security.SecureString]$TestSecureConnectionString = $null,
    [switch]$TestValidateOnly = $false
)

$ErrorActionPreference = 'Stop'

# ==============================================================================
# HANG SO BAO MAT VA MUC TIEU CO DINH (IMMUTABLE TARGET CONSTANTS)
# ==============================================================================
$APPROVED_TARGET_HOST   = "ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech"
$PRODUCTION_ENDPOINT_ID = "ep-square-scene-b5ddgxil"
$EXPECTED_DATABASE_NAME = "neondb"
$EXPECTED_PORT          = 5432
$ALLOWED_SCHEMES        = @("postgres", "postgresql")

$EXPECTED_BASELINES = @(
    "20261013094130_init",
    "20261019193200_phase8_shipping_engine",
    "20261023235900_add_f01_inventory_ledger"
)

$EXPECTED_PENDING = @(
    "20261028203000_f04_membership_and_quarterly_kpi",
    "20261028213000_f02_two_way_complaints"
)

# ==============================================================================
# FIX 1: XAC DINH APPLICATION ROOT VA KIEM TRA MIGRATION ARTIFACTS
# ==============================================================================
$appRoot = (Resolve-Path "$PSScriptRoot\..").Path

function Assert-ApplicationRootAndArtifacts {
    param([string]$AppDir)

    $packageJsonPath = Join-Path $AppDir "package.json"
    $schemaPath      = Join-Path $AppDir "prisma/schema.prisma"
    $f04MigPath      = Join-Path $AppDir "prisma/migrations/20261028203000_f04_membership_and_quarterly_kpi/migration.sql"
    $f02MigPath      = Join-Path $AppDir "prisma/migrations/20261028213000_f02_two_way_complaints/migration.sql"

    if (-not (Test-Path $packageJsonPath)) {
        throw "FAIL-CLOSED (FIX 1): Khong tim thay package.json tai application root: $AppDir"
    }
    if (-not (Test-Path $schemaPath)) {
        throw "FAIL-CLOSED (FIX 1): Khong tim thay schema.prisma tai: $schemaPath"
    }
    if (-not (Test-Path $f04MigPath)) {
        throw "FAIL-CLOSED (FIX 1): Khong tim thay migration artifact F04 tai: $f04MigPath"
    }
    if (-not (Test-Path $f02MigPath)) {
        throw "FAIL-CLOSED (FIX 1): Khong tim thay migration artifact F02 tai: $f02MigPath"
    }
}

# ==============================================================================
# FIX 3: THAM DINH MUC TIEU CO SO DU LIEU CHINH XAC (EXACT MATCH & STRICT GATES)
# ==============================================================================
function Assert-TargetDatabaseSafety {
    param([string]$ConnectionString)

    if ([string]::IsNullOrWhiteSpace($ConnectionString)) {
        throw "FAIL-CLOSED (FIX 3): Chuoi ket noi rong."
    }

    # 1. Negative Blocklist Checks (Chan tuyet doi Production va Pooler)
    if ($ConnectionString.ToLower().Contains($PRODUCTION_ENDPOINT_ID.ToLower())) {
        throw "FAIL-CLOSED (FIX 3 - GUARD 1): Phat hien Production Endpoint ($PRODUCTION_ENDPOINT_ID)! Tuyet doi cam chay migration tren Production."
    }
    if ($ConnectionString.ToLower().Contains("-pooler")) {
        throw "FAIL-CLOSED (FIX 3 - GUARD 2): Phat hien endpoint pooled (-pooler). Prisma migrate DDL bat buoc su dung Direct Connection."
    }

    # 2. Parse URI
    $uri = $null
    try {
        $uri = [System.Uri]$ConnectionString
    } catch {
        throw "FAIL-CLOSED (FIX 3): Cu phap URI connection string khong hop le: $($_.ToString())"
    }

    # 3. Protocol / Scheme Check
    $parsedScheme = $uri.Scheme.ToLower().Trim()
    if ($ALLOWED_SCHEMES -notcontains $parsedScheme) {
        throw "FAIL-CLOSED (FIX 3): Protocol/Scheme '$parsedScheme' khong hop le. Bat buoc la 'postgres' hoac 'postgresql'."
    }

    # 4. Exact Full Hostname Match
    $parsedHost = $uri.Host.ToLower().Trim()
    if ($parsedHost -ne $APPROVED_TARGET_HOST.ToLower()) {
        throw "FAIL-CLOSED (FIX 3 - GUARD 3): Hostname '$parsedHost' khong khop chinh xac voi target duoc phe duyet ('$APPROVED_TARGET_HOST')."
    }

    # 5. Port Check (Direct connection phai la 5432)
    if ($uri.Port -ne -1 -and $uri.Port -ne $EXPECTED_PORT) {
        throw "FAIL-CLOSED (FIX 3): Port '$($uri.Port)' khong hop le. Bat buoc la port $EXPECTED_PORT (Direct Connection)."
    }

    # 6. Database Name Check
    $parsedDbName = $uri.AbsolutePath.Trim('/').ToLower()
    if ($parsedDbName -ne $EXPECTED_DATABASE_NAME.ToLower()) {
        throw "FAIL-CLOSED (FIX 3): Database name '$parsedDbName' khong hop le. Bat buoc la '$EXPECTED_DATABASE_NAME'."
    }

    # 7. SSL Mode Requirement
    $query = $uri.Query.ToLower()
    if ($query -notmatch '[?&]sslmode=(require|verify-ca|verify-full)(\&|$)') {
        throw "FAIL-CLOSED (FIX 3): Connection string thieu tham so bat buoc 'sslmode=require' (hoac verify-ca/verify-full) cho Neon."
    }

    return @{
        Host     = $parsedHost
        Database = $parsedDbName
        Port     = if ($uri.Port -eq -1) { $EXPECTED_PORT } else { $uri.Port }
    }
}

# ==============================================================================
# FIX 2: PHAN TICH PRISMA MIGRATE STATUS VA EXIT CODES
# ==============================================================================
function Strip-AnsiCodes {
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return '' }
    return ($Text -replace '\x1B\[[0-9;]*[a-zA-Z]', '')
}

function Assert-PreflightMigrationStatus {
    param(
        [string]$Output,
        [int]$ExitCode
    )

    $clean = Strip-AnsiCodes -Text $Output

    # 1. Kiem tra cac trang thai loi nghiem trong (Authentication, Connection, Timeout, Failed)
    if ($clean -match "(?i)(P1000|Authentication failed|password authentication failed|credentials are invalid)") {
        throw "FAIL-CLOSED (FIX 2): Loi xac thuc database (P1000/Authentication Failed). Kiem tra username hoac password."
    }
    if ($clean -match "(?i)(P1001|P1002|P1017|Can.?t reach database server|Cannot reach database server|ETIMEDOUT|ECONNREFUSED|ENOTFOUND)") {
        throw "FAIL-CLOSED (FIX 2): Khong the ket noi den Neon database server (P1001/P1002/Network Error)."
    }
    if ($clean -match "(?i)(Following migrations?\s+have failed|Following migration\([sS]\)\s+have failed|failed migrations?|P3009|P3011|P3012)") {
        throw "FAIL-CLOSED (FIX 2): Phat hien migration failed trong lich su CSDL! Can xu ly bang prisma migrate resolve truoc."
    }
    if ($clean -match "(?i)(Your local migration history and the migrations table from your database are different|historiesDiverge|diverged)") {
        throw "FAIL-CLOSED (FIX 2): Lich su migration bi lech (Divergent History) giua local va remote database!"
    }
    if ($clean -match "(?i)(The current database is not managed by Prisma Migrate|P3005)") {
        throw "FAIL-CLOSED (FIX 2): Database chua co bang _prisma_migrations (The database is not managed by Prisma Migrate)."
    }

    # 2. Truong hop NO-OP: Database da up-to-date (ExitCode == 0)
    if ($ExitCode -eq 0 -and $clean -match "(?i)Database schema is up to date") {
        return @{
            IsAlreadyApplied  = $true
            PendingMigrations = @()
            Message           = "Database schema da o trang thai moi nhat (F04 va F02 da duoc apply truoc do)."
        }
    }

    # 3. Truong hop hop le truoc khi migrate (Prisma 6 tra ExitCode 1 khi co pending migrations)
    $pendingRegex = "(?i)(?:Following|The)\s+migration(?:s|\(s\))?\s+have\s+not\s+yet\s+been\s+applied:\s*([\s\S]*?)(?=\s*(?:To\s+apply|The\s+migration|$))"
    if ($clean -match $pendingRegex) {
        $unappliedBlock = $matches[1]

        # Kiem tra baselines: Init, Phase 8, F01 KHONG duoc phep nam trong danh sach unapplied
        foreach ($base in $EXPECTED_BASELINES) {
            if ($unappliedBlock -match [regex]::Escape($base)) {
                throw "FAIL-CLOSED (FIX 2): Migration baseline '$base' chua duoc apply tren target database! Thieu baseline."
            }
        }

        # Trich xuat danh sach unapplied migrations
        $foundMatches = [regex]::Matches($unappliedBlock, '\b\d{14}_[a-zA-Z0-9_]+\b')
        $foundList = @($foundMatches | ForEach-Object { $_.Value })

        # So sanh chinh xac: Phai co dung 2 migrations la F04 va F02
        if ($foundList.Count -ne $EXPECTED_PENDING.Count) {
            $foundStr = $foundList -join ', '
            throw "FAIL-CLOSED (FIX 2): So luong pending migrations khong khop (Tim thay: [$foundStr], Mong doi: [20261028203000_f04..., 20261028213000_f02...])."
        }

        foreach ($exp in $EXPECTED_PENDING) {
            if ($foundList -notcontains $exp) {
                throw "FAIL-CLOSED (FIX 2): Danh sach pending thieu migration mong doi '$exp'."
            }
        }

        return @{
            IsAlreadyApplied  = $false
            PendingMigrations = $foundList
            Message           = "Preflight PASS: Tim thay dung 2 pending migrations mong doi (F04 va F02)."
        }
    }

    throw "FAIL-CLOSED (FIX 2): Ket qua prisma migrate status khong hop le (ExitCode: $ExitCode). Output:`n$clean"
}

function Assert-PostDeployMigrationStatus {
    param(
        [string]$Output,
        [int]$ExitCode
    )

    $clean = Strip-AnsiCodes -Text $Output

    # Sau khi deploy, exit code bat buoc phai la 0 va output phai xac nhan up to date
    if ($ExitCode -ne 0) {
        throw "FAIL-CLOSED (FIX 2): Post-deploy prisma migrate status tra ve ExitCode $ExitCode (bat buoc 0). Output:`n$clean"
    }

    if ($clean -notmatch "(?i)Database schema is up to date") {
        throw "FAIL-CLOSED (FIX 2): Output sau deploy khong chua 'Database schema is up to date'. Output:`n$clean"
    }

    if ($clean -match "(?i)(have not yet been applied|failed)") {
        throw "FAIL-CLOSED (FIX 2): Phat hien migration chua apply hoac bi fail sau khi deploy! Output:`n$clean"
    }

    return @{
        IsUpToDate = $true
        Message    = "Post-deploy VERIFIED: Database schema is up to date (ExitCode 0)."
    }
}

# ==============================================================================
# HAM BO TRO THUC THI NATIVE PRISMA CLI AN TOAN TRONG POWERSHELL
# ==============================================================================
function Invoke-PrismaCommand {
    param(
        [string[]]$Arguments
    )

    $tempOut = [System.IO.Path]::GetTempFileName()
    $tempErr = [System.IO.Path]::GetTempFileName()

    try {
        $npxPath = "npx.cmd"
        $resolvedNpx = (Get-Command "npx.cmd" -ErrorAction SilentlyContinue)
        if ($null -ne $resolvedNpx) {
            $npxPath = $resolvedNpx.Source
        }

        $p = Start-Process -FilePath $npxPath `
            -ArgumentList $Arguments `
            -RedirectStandardOutput $tempOut `
            -RedirectStandardError $tempErr `
            -NoNewWindow -Wait -PassThru

        $stdOut = ""
        $stdErr = ""
        if (Test-Path $tempOut) { $stdOut = (Get-Content $tempOut -Raw -ErrorAction SilentlyContinue) }
        if (Test-Path $tempErr) { $stdErr = (Get-Content $tempErr -Raw -ErrorAction SilentlyContinue) }

        $combined = ($stdOut + "`n" + $stdErr).Trim()

        return @{
            ExitCode = $p.ExitCode
            Output   = $combined
        }
    }
    finally {
        if (Test-Path $tempOut) { Remove-Item $tempOut -Force -ErrorAction SilentlyContinue }
        if (Test-Path $tempErr) { Remove-Item $tempErr -Force -ErrorAction SilentlyContinue }
    }
}

# ==============================================================================
# TIEN TRINH THUC THI CHINH (MAIN WORKFLOW)
# ==============================================================================
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   E VIBE B2B - ONE-TIME SECURE MIGRATION: F02 AND F04 -> BETA   " -ForegroundColor Cyan
Write-Host "   TASK: EV-BETA-RELEASE-F02-F04-01 | HARD GUARDS ACTIVE         " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Thuc thi FIX 1: Verify application root and migration files
Write-Host "--- BUOC 1: KIEM TRA WORKING DIRECTORY VA MIGRATION ARTIFACTS ---" -ForegroundColor Cyan
Assert-ApplicationRootAndArtifacts -AppDir $appRoot
Write-Host "[PASS] Application root hop le: $appRoot" -ForegroundColor Green
Write-Host "       Tim thay du 2 migration artifacts F04 va F02." -ForegroundColor Green
Write-Host ""

# 2. Lay connection string (Tu Test parameter neu test, hoac tu Read-Host an)
$secureConn = $TestSecureConnectionString
if ($null -eq $secureConn) {
    Write-Host "Vui long dan Direct Connection String cua Neon preview-beta." -ForegroundColor Yellow
    Write-Host "(Chuoi ket noi se duoc an hoan toan va khong luu vao lich su lenh)" -ForegroundColor DarkGray
    $secureConn = Read-Host -Prompt "Direct Connection String" -AsSecureString
}

if ($null -eq $secureConn -or $secureConn.Length -eq 0) {
    Write-Host "[HUY BO] Chuoi ket noi rong. Da dung thuc thi." -ForegroundColor Red
    throw "FAIL-CLOSED: Chuoi ket noi bi huy bo hoac de trong."
}

# 3. Giai ma an toan trong bo nho tien trinh de validate an toan
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureConn)
$plainConn = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

$prevLocation = (Get-Location).Path

try {
    # 4. Thuc thi FIX 3: Kiem tra muc tieu database an toan
    Write-Host "--- BUOC 2: THAM DINH MUC TIEU DATABASE CHINH XAC (FIX 3) ---" -ForegroundColor Cyan
    $targetInfo = Assert-TargetDatabaseSafety -ConnectionString $plainConn
    Write-Host "[PASS] Xac thuc muc tieu an toan tuyet doi:" -ForegroundColor Green
    Write-Host "  -> Hostname: $($targetInfo.Host) (EXACT MATCH PASS)" -ForegroundColor Cyan
    Write-Host "  -> Database: $($targetInfo.Database) (EXACT MATCH PASS)" -ForegroundColor Cyan
    Write-Host "  -> Port:     $($targetInfo.Port) (DIRECT PORT 5432 PASS)" -ForegroundColor Cyan
    Write-Host "  -> SSL:      sslmode=require VERIFIED" -ForegroundColor Green
    Write-Host ""

    if ($TestValidateOnly) {
        Write-Host "[TEST MODE] Validate-only hoan tat thanh cong." -ForegroundColor Green
        return
    }

    # 5. Chuyen working directory sang $appRoot de chay Prisma CLI (FIX 1)
    Set-Location $appRoot

    # 6. Thiet lap $env:DATABASE_URL trong scope tien trinh hien tai
    $env:DATABASE_URL = $plainConn

    # 7. Thuc thi FIX 2: Preflight prisma migrate status
    Write-Host "--- BUOC 3: KIEM TRA PREFLIGHT MIGRATION STATUS (FIX 2) ---" -ForegroundColor Cyan
    $statusRes = Invoke-PrismaCommand @("prisma", "migrate", "status")
    Write-Host $statusRes.Output -ForegroundColor DarkGray
    Write-Host ""

    $preflightAnalysis = Assert-PreflightMigrationStatus -Output $statusRes.Output -ExitCode $statusRes.ExitCode
    Write-Host "[PASS] $($preflightAnalysis.Message)" -ForegroundColor Green
    Write-Host ""

    # Neu da apply truoc do thi dung tai day (NO-OP)
    if ($preflightAnalysis.IsAlreadyApplied) {
        Write-Host "=================================================================" -ForegroundColor Green
        Write-Host "   DATABASE DA CAP NHAT SAN - KHONG CAN THUC THI LAI (NO-OP)     " -ForegroundColor Green
        Write-Host "=================================================================" -ForegroundColor Green
        return
    }

    # 8. Thuc thi Buoc 4: Chay Prisma Migrate Deploy
    Write-Host "--- BUOC 4: TIEN HANH THUC THI MIGRATION DEPLOY (F04 + F02) ---" -ForegroundColor Cyan
    $deployRes = Invoke-PrismaCommand @("prisma", "migrate", "deploy")
    Write-Host $deployRes.Output -ForegroundColor DarkGray
    Write-Host ""

    if ($deployRes.ExitCode -ne 0) {
        throw "FAIL-CLOSED (FIX 2): Prisma migrate deploy that bai voi ma loi $($deployRes.ExitCode)!"
    }
    if ($deployRes.Output -notmatch "(?i)(All migrations have been successfully applied|No pending migrations to apply)") {
        throw "FAIL-CLOSED (FIX 2): Output cua prisma migrate deploy khong xac nhan hoan tat thanh cong!"
    }

    Write-Host "[PASS] Prisma migrate deploy hoan tat thanh cong." -ForegroundColor Green
    Write-Host ""

    # 9. Thuc thi Buoc 5: Xac minh lai trang thai sau khi deploy (Post-Deploy Status)
    Write-Host "--- BUOC 5: XAC MINH TRANG THAI CUOI CUNG (FIX 2 POST-DEPLOY) ---" -ForegroundColor Cyan
    $postStatusRes = Invoke-PrismaCommand @("prisma", "migrate", "status")
    Write-Host $postStatusRes.Output -ForegroundColor DarkGray
    Write-Host ""

    $postAnalysis = Assert-PostDeployMigrationStatus -Output $postStatusRes.Output -ExitCode $postStatusRes.ExitCode
    Write-Host "[PASS] $($postAnalysis.Message)" -ForegroundColor Green
    Write-Host ""

    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host "   MIGRATION HOAN TAT THANH CONG 100%! CO SO DU LIEU DA SAN SANG " -ForegroundColor Green
    Write-Host "=================================================================" -ForegroundColor Green
    Write-Host "PO hay sao chep toan bo output tren va phan hoi: 'Migration da hoan tat thanh cong'." -ForegroundColor Yellow
}
catch {
    Write-Host ""
    Write-Host ("[LOI THUC THI MIGRATION] " + $_) -ForegroundColor Red
    throw $_
}
finally {
    # 10. Khoi phuc working directory ban dau
    Set-Location $prevLocation

    # 11. Xoa sach credentials khoi bien moi truong tien trinh va huy tham chieu
    $env:DATABASE_URL = $null
    [System.Environment]::SetEnvironmentVariable('DATABASE_URL', $null, 'Process')
    $plainConn = $null
    Write-Host ""
    Write-Host "[BAO MAT] Da xoa bien moi truong DATABASE_URL khoi tien trinh va huy tham chieu." -ForegroundColor DarkGray
}
