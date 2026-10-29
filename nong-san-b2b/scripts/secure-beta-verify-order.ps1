# scripts/secure-beta-verify-order.ps1
# ==============================================================================
# SECURE ONE-TIME NEON PREVIEW-BETA DEMO ORDER VERIFICATION SCRIPT
# TASK: EV-BETA-DEMO-ORDER-02
# DESIGN STANDARD: Main Coordinator & PO Safety Directives
# ==============================================================================

[CmdletBinding()]
param(
    [string]$OrderCode = "DH-261029-ASRT",
    [System.Security.SecureString]$TestSecureConnectionString = $null,
    [switch]$TestValidateOnly = $false
)

$ErrorActionPreference = 'Stop'

$APPROVED_ORDER_CODE    = "DH-261029-ASRT"
$APPROVED_TARGET_HOST   = "ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech"
$APPROVED_POOLER_HOST   = "ep-fancy-waterfall-b5f117np-pooler.c-7.us-east-2.aws.neon.tech"
$PRODUCTION_ENDPOINT_ID = "ep-square-scene-b5ddgxil"
$EXPECTED_DATABASE_NAME = "neondb"
$EXPECTED_PORT          = 5432
$ALLOWED_SCHEMES        = @("postgres", "postgresql")
$ALLOWED_SSL_MODES      = @("require", "verify-ca", "verify-full")

# 0. Strict Order Code Gate (Task B4)
if ($OrderCode -ne $APPROVED_ORDER_CODE) {
    Write-Error "[FAIL-CLOSED] Chi duoc phep truy van don hang demo duoc phe duyet ($APPROVED_ORDER_CODE). Ma yeu cau: '$OrderCode' bi tu choi!"
    exit 1
}

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

    # 1. Scheme Check
    if ($ALLOWED_SCHEMES -notcontains $uri.Scheme.ToLower()) {
        throw "FAIL-CLOSED: Scheme khong hop le ($($uri.Scheme)). Chi chap nhan postgres:// hoac postgresql://"
    }

    # 2. Host Suffix & Target Check
    if (-not $uri.Host.ToLower().EndsWith(".c-7.us-east-2.aws.neon.tech")) {
        throw "FAIL-CLOSED: Host phai thuoc Neon AWS US-East-2 (.c-7.us-east-2.aws.neon.tech)."
    }

    if ($uri.Host.ToLower() -ne $APPROVED_TARGET_HOST.ToLower() -and $uri.Host.ToLower() -ne $APPROVED_POOLER_HOST.ToLower()) {
        throw "FAIL-CLOSED: Host ($($uri.Host)) khong khop voi target da duoc phe duyet ($APPROVED_TARGET_HOST)."
    }

    # 3. Database Name Check
    $dbName = $uri.AbsolutePath.TrimStart('/')
    if ($dbName.ToLower() -ne $EXPECTED_DATABASE_NAME.ToLower()) {
        throw "FAIL-CLOSED: Database name ($dbName) khong dung voi database phe duyet ($EXPECTED_DATABASE_NAME)."
    }

    # 4. Port Check (B1 requirement)
    $port = if ($uri.Port -ne -1) { $uri.Port } else { 5432 }
    if ($port -ne $EXPECTED_PORT) {
        throw "FAIL-CLOSED: Port ($port) khong hop le. Bat buoc port $EXPECTED_PORT."
    }

    # 5. SSL Mode Check (B1 requirement)
    $hasValidSsl = $false
    if (-not [string]::IsNullOrWhiteSpace($uri.Query)) {
        $queryParams = $uri.Query.TrimStart('?').Split('&')
        foreach ($param in $queryParams) {
            $kv = $param.Split('=')
            if ($kv.Length -ge 2 -and $kv[0].ToLower() -eq 'sslmode') {
                if ($ALLOWED_SSL_MODES -contains $kv[1].ToLower()) {
                    $hasValidSsl = $true
                }
            }
            # Check for redirect query params
            if ($kv[0].ToLower() -eq 'host' -or $kv[0].ToLower() -eq 'options') {
                if ($kv.Length -ge 2 -and $kv[1].ToLower().Contains('.neon.tech') -and -not $kv[1].ToLower().Contains('b5f117np')) {
                    throw "FAIL-CLOSED: Phat hien redirect parameter nguy hiem trong query string!"
                }
            }
        }
    }
    if (-not $hasValidSsl) {
        throw "FAIL-CLOSED: Ket noi phai bat buoc TLS/SSL (sslmode=require hoac manh hon: $($ALLOWED_SSL_MODES -join ', '))."
    }
}

# 1. Thu thap connection string an toan (B2 requirement)
$originalDbUrl     = $env:DATABASE_URL
$originalDirectUrl = $env:DIRECT_URL
$connStr = $null

if ($PSBoundParameters.ContainsKey('TestSecureConnectionString') -and $null -ne $TestSecureConnectionString) {
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($TestSecureConnectionString)
    try {
        $connStr = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
} elseif (-not [string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
    # Validate session DATABASE_URL before accepting
    try {
        Assert-TargetDatabaseSafety -ConnectionString $env:DATABASE_URL
        $connStr = $env:DATABASE_URL
        Write-Host "[INFO] Su dung DATABASE_URL tu session hien tai (da qua safety gate)." -ForegroundColor Cyan
    } catch {
        Write-Host "[WARN] DATABASE_URL trong session khong hop le hoac khong dung target. Vui long nhap chuoi ket noi moi." -ForegroundColor Yellow
        $connStr = $null
    }
}

if ([string]::IsNullOrWhiteSpace($connStr)) {
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
    # Sanitize exception message to ensure no credentials or passwords leak
    $cleanMsg = $_.Exception.Message -replace ':[^/@]+@', ':***@'
    Write-Error "[ABORT] $cleanMsg"
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
    # Restore original environment variables to prevent polluting session (B2)
    $env:DATABASE_URL = $originalDbUrl
    $env:DIRECT_URL   = $originalDirectUrl
    $connStr = $null
    Pop-Location
}
