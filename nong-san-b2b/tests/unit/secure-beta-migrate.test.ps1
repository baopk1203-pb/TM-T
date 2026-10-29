# tests/unit/secure-beta-migrate.test.ps1
# ==============================================================================
# OFFLINE UNIT TEST SUITE: SECURE BETA MIGRATE FAIL-CLOSED GATES
# TASK: EV-BETA-RELEASE-F02-F04-01 ??? SCRIPT SAFETY FIX
# ==============================================================================

$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot "..\..\scripts\secure-beta-migrate.ps1"
if (-not (Test-Path $scriptPath)) {
    throw "Khong tim thay script secure-beta-migrate.ps1 tai: $scriptPath"
}

# Dot-source de n???p c??c h??m Assertion
# De tranh chay workflow chinh khi dot-source, ta kiem tra bang cach goi script voi -TestValidateOnly
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   CHAY BO KIEM THU OFFLINE: 16 FAIL-CLOSED TEST CASES          " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

$testsPassed = 0
$testsFailed = 0

function Run-TestCase {
    param(
        [string]$Name,
        [scriptblock]$Block,
        [string]$ExpectedErrorPattern = ""
    )

    try {
        & $Block
        if ([string]::IsNullOrEmpty($ExpectedErrorPattern)) {
            Write-Host "[PASS] $Name" -ForegroundColor Green
            $script:testsPassed++
        } else {
            Write-Host "[FAIL] $Name ??? Mong doi loi chua '$ExpectedErrorPattern' nhung khong co loi!" -ForegroundColor Red
            $script:testsFailed++
        }
    }
    catch {
        $msg = $_.Exception.Message
        if (-not [string]::IsNullOrEmpty($ExpectedErrorPattern)) {
            if ($msg -match $ExpectedErrorPattern) {
                Write-Host "[PASS] $Name (Bat dung loi: '$ExpectedErrorPattern')" -ForegroundColor Green
                $script:testsPassed++
            } else {
                Write-Host "[FAIL] $Name ??? Loi khong khop pattern! Thuc te: $msg" -ForegroundColor Red
                $script:testsFailed++
            }
        } else {
            Write-Host "[FAIL] $Name ??? Loi khong mong muon: $msg" -ForegroundColor Red
            $script:testsFailed++
        }
    }
}

function To-SecureString {
    param([string]$Plain)
    $ss = New-Object System.Security.SecureString
    foreach ($c in $Plain.ToCharArray()) {
        $ss.AppendChar($c)
    }
    $ss.MakeReadOnly()
    return $ss
}

# --- NH??M 1: KI???M CH???NG C??C CH???T CH???N M???C TI??U DATABASE (FIX 3) ---

# Case 1: Ch???n Production endpoint
Run-TestCase -Name "Case 1: Chan tuyet doi Production Host (ep-square-scene-b5ddgxil)" `
    -ExpectedErrorPattern "FAIL-CLOSED \(FIX 3 - GUARD 1\)" `
    -Block {
        $sec = To-SecureString "postgres://user:pass@ep-square-scene-b5ddgxil.c-7.us-east-2.aws.neon.tech:5432/neondb?sslmode=require"
        & $scriptPath -TestSecureConnectionString $sec -TestValidateOnly
    }

# Case 2: Ch???n Pooler endpoint (-pooler)
Run-TestCase -Name "Case 2: Chan endpoint pooled (-pooler)" `
    -ExpectedErrorPattern "FAIL-CLOSED \(FIX 3 - GUARD 2\)" `
    -Block {
        $sec = To-SecureString "postgres://user:pass@ep-fancy-waterfall-b5f117np-pooler.c-7.us-east-2.aws.neon.tech:5432/neondb?sslmode=require"
        & $scriptPath -TestSecureConnectionString $sec -TestValidateOnly
    }

# Case 3: Ch???n hostname kh??ng kh???p ch??nh x??c target
Run-TestCase -Name "Case 3: Chan hostname la khong khop Approved Target" `
    -ExpectedErrorPattern "FAIL-CLOSED \(FIX 3 - GUARD 3\)" `
    -Block {
        $sec = To-SecureString "postgres://user:pass@ep-other-wrong-host.c-7.us-east-2.aws.neon.tech:5432/neondb?sslmode=require"
        & $scriptPath -TestSecureConnectionString $sec -TestValidateOnly
    }

# Case 4: Ch???n port kh??ng ph???i 5432
Run-TestCase -Name "Case 4: Chan port khac 5432 (e.g. 5433)" `
    -ExpectedErrorPattern "FAIL-CLOSED \(FIX 3\): Port" `
    -Block {
        $sec = To-SecureString "postgres://user:pass@ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech:5433/neondb?sslmode=require"
        & $scriptPath -TestSecureConnectionString $sec -TestValidateOnly
    }

# Case 5: Ch???n database name kh??ng ph???i neondb
Run-TestCase -Name "Case 5: Chan database name sai (e.g. wrongdb)" `
    -ExpectedErrorPattern "FAIL-CLOSED \(FIX 3\): Database name" `
    -Block {
        $sec = To-SecureString "postgres://user:pass@ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech:5432/wrongdb?sslmode=require"
        & $scriptPath -TestSecureConnectionString $sec -TestValidateOnly
    }

# Case 6: Ch???n thi???u tham s??? sslmode=require
Run-TestCase -Name "Case 6: Chan connection string thieu sslmode=require" `
    -ExpectedErrorPattern "FAIL-CLOSED \(FIX 3\): Connection string thieu tham so bat buoc 'sslmode=require'" `
    -Block {
        $sec = To-SecureString "postgres://user:pass@ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech:5432/neondb"
        & $scriptPath -TestSecureConnectionString $sec -TestValidateOnly
    }

# Case 7: Ch???n protocol/scheme kh??ng h???p l???
Run-TestCase -Name "Case 7: Chan scheme khong hop le (e.g. mysql://)" `
    -ExpectedErrorPattern "FAIL-CLOSED \(FIX 3\): Protocol/Scheme" `
    -Block {
        $sec = To-SecureString "mysql://user:pass@ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech:5432/neondb?sslmode=require"
        & $scriptPath -TestSecureConnectionString $sec -TestValidateOnly
    }

# Case 8: Ch???n connection string r??-ng
Run-TestCase -Name "Case 8: Chan chuoi ket noi rong" `
    -ExpectedErrorPattern "FAIL-CLOSED \(FIX 3\): Chuoi ket noi rong" `
    -Block {
        $sec = To-SecureString "   "
        & $scriptPath -TestSecureConnectionString $sec -TestValidateOnly
    }

# Case 9: Ch???p nh???n chu??-i k???t n???i chu???n x??c c???a Neon Preview-Beta
Run-TestCase -Name "Case 9: Chap nhan chuoi hop le 100% cua Neon preview-beta" `
    -Block {
        $sec = To-SecureString "postgres://neondb_owner:dummySecretPassword123@ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech:5432/neondb?sslmode=require"
        & $scriptPath -TestSecureConnectionString $sec -TestValidateOnly
    }

# --- NH??M 2: KI???M CH???NG PH??N T??CH PRISMA STATUS EXIT CODES (FIX 2) ---

# Dot-source rieng ham test status tu script de kiem thu unit
$scriptContent = Get-Content $scriptPath -Raw
$cleanForDotSource = $scriptContent -replace '(?s)Write-Host "=======.*?Set-Location \$prevLocation.*?\}', ''
Invoke-Expression $cleanForDotSource

# Case 10: Ph??t hi???n Failed Migration trong l???ch s???
Run-TestCase -Name "Case 10: Preflight phat hien failed migration (P3009/Following migrations have failed)" `
    -ExpectedErrorPattern "FAIL-CLOSED \(FIX 2\): Phat hien migration failed" `
    -Block {
        $mockOutput = @"
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "neondb", schema "public" at "ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech:5432"

Following migration have failed:
20261023235900_add_f01_inventory_ledger
The failed migration can be marked as rolled back or applied.
"@
        Assert-PreflightMigrationStatus -Output $mockOutput -ExitCode 1
    }

# Case 11: Ph??t hi???n Divergent History
Run-TestCase -Name "Case 11: Preflight phat hien divergent migration history" `
    -ExpectedErrorPattern "FAIL-CLOSED \(FIX 2\): Lich su migration bi lech \(Divergent History\)" `
    -Block {
        $mockOutput = @"
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "neondb"
Your local migration history and the migrations table from your database are different:
The last common migration is: 20261019193200_phase8_shipping_engine
The migration have not yet been applied: 20261023235900_add_f01_inventory_ledger
"@
        Assert-PreflightMigrationStatus -Output $mockOutput -ExitCode 1
    }

# Case 12: Ph??t hi???n thi???u baseline F01 (F01 n???m trong unapplied)
Run-TestCase -Name "Case 12: Preflight phat hien thieu baseline F01 (nam trong unapplied)" `
    -ExpectedErrorPattern "FAIL-CLOSED \(FIX 2\): Migration baseline '20261023235900_add_f01_inventory_ledger' chua duoc apply" `
    -Block {
        $mockOutput = @"
3 migrations found in prisma/migrations
Following migrations have not yet been applied:
20261023235900_add_f01_inventory_ledger
20261028203000_f04_membership_and_quarterly_kpi
20261028213000_f02_two_way_complaints
To apply migrations in production run: prisma migrate deploy
"@
        Assert-PreflightMigrationStatus -Output $mockOutput -ExitCode 1
    }

# Case 13: Ph??t hi???n pending migration l??? ngo??i F04 v?? F02
Run-TestCase -Name "Case 13: Preflight phat hien migration pending la khong mong muon" `
    -ExpectedErrorPattern "FAIL-CLOSED \(FIX 2\): So luong pending migrations khong khop" `
    -Block {
        $mockOutput = @"
Following migrations have not yet been applied:
20261028203000_f04_membership_and_quarterly_kpi
20261028213000_f02_two_way_complaints
20261099999999_unexpected_migration
"@
        Assert-PreflightMigrationStatus -Output $mockOutput -ExitCode 1
    }

# Case 14: Preflight PASS ??? ????ng ch??nh x??c 2 migrations F04 v?? F02 (ExitCode 1 chu???n Prisma 6)
Run-TestCase -Name "Case 14: Preflight PASS voi dung 2 migrations F04 va F02 (ExitCode 1)" `
    -Block {
        $mockOutput = @"
5 migrations found in prisma/migrations
Datasource "db": PostgreSQL database "neondb", schema "public" at "ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech:5432"

Following migrations have not yet been applied:
20261028203000_f04_membership_and_quarterly_kpi
20261028213000_f02_two_way_complaints

To apply migrations in production run:
  prisma migrate deploy
"@
        $res = Assert-PreflightMigrationStatus -Output $mockOutput -ExitCode 1
        if ($res.PendingMigrations.Count -ne 2) { throw "So luong pending khong phai 2!" }
        if ($res.IsAlreadyApplied) { throw "Khong duoc danh dau da applied!" }
    }

# Case 15: Post-deploy FAIL n???u ExitCode kh??c 0
Run-TestCase -Name "Case 15: Post-deploy FAIL neu ExitCode khac 0" `
    -ExpectedErrorPattern "FAIL-CLOSED \(FIX 2\): Post-deploy prisma migrate status tra ve ExitCode 1" `
    -Block {
        $mockOutput = "Database schema is up to date!"
        Assert-PostDeployMigrationStatus -Output $mockOutput -ExitCode 1
    }

# Case 16: Post-deploy PASS khi ExitCode 0 v?? x??c nh???n "Database schema is up to date"
Run-TestCase -Name "Case 16: Post-deploy PASS khi ExitCode 0 va schema up to date" `
    -Block {
        $mockOutput = @"
5 migrations found in prisma/migrations
Datasource "db": PostgreSQL database "neondb", schema "public" at "ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech:5432"

Database schema is up to date!
"@
        $res = Assert-PostDeployMigrationStatus -Output $mockOutput -ExitCode 0
        if (-not $res.IsUpToDate) { throw "Khong xac nhan isUpToDate!" }
    }

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "KET QUA KIEM THU: $testsPassed / $($testsPassed + $testsFailed) PASS" -ForegroundColor $(if ($testsFailed -eq 0) { 'Green' } else { 'Red' })
Write-Host "=================================================================" -ForegroundColor Cyan

if ($testsFailed -gt 0) {
    exit 1
}
