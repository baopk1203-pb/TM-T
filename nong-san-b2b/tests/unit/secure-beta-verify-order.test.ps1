# tests/unit/secure-beta-verify-order.test.ps1
# Unit safety tests for secure-beta-verify-order.ps1

$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot "..\..\scripts\secure-beta-verify-order.ps1"

function ConvertTo-Secure {
    param([string]$str)
    $ss = New-Object System.Security.SecureString
    foreach ($c in $str.ToCharArray()) {
        $ss.AppendChar($c)
    }
    $ss.MakeReadOnly()
    return $ss
}

$tests = @(
    @{
        Name = "Reject Production Endpoint"
        Conn = "postgresql://user:pass@ep-square-scene-b5ddgxil.c-7.us-east-2.aws.neon.tech:5432/neondb?sslmode=require"
        ExpectFail = $true
    },
    @{
        Name = "Reject Wrong Host"
        Conn = "postgresql://user:pass@ep-other-host-12345.c-7.us-east-2.aws.neon.tech:5432/neondb?sslmode=require"
        ExpectFail = $true
    },
    @{
        Name = "Reject Wrong Database Name"
        Conn = "postgresql://user:pass@ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech:5432/wrongdb?sslmode=require"
        ExpectFail = $true
    },
    @{
        Name = "Reject Non-Postgres Scheme"
        Conn = "mysql://user:pass@ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech:5432/neondb"
        ExpectFail = $true
    },
    @{
        Name = "Accept Valid Approved Target Host"
        Conn = "postgresql://user:pass@ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech:5432/neondb?sslmode=require"
        ExpectFail = $false
    }
)

$passed = 0
$failed = 0

foreach ($t in $tests) {
    $sec = ConvertTo-Secure $t.Conn
    $hasError = $false
    $lastError = ""
    try {
        & $scriptPath -TestSecureConnectionString $sec -TestValidateOnly | Out-Null
    } catch {
        $hasError = $true
        $lastError = $_.Exception.Message
    }

    if ($hasError -eq $t.ExpectFail) {
        Write-Host "[PASS] $($t.Name)" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "[FAIL] $($t.Name) (Expected Fail: $($t.ExpectFail), Got Error: $hasError)" -ForegroundColor Red
        $failed++
    }
}

Write-Host "`nTest Results: $passed Passed, $failed Failed."
if ($failed -gt 0) { exit 1 } else { exit 0 }
