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
