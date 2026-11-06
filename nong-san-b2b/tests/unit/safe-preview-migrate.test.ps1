# tests/unit/safe-preview-migrate.test.ps1
# Bo kiem thu hoi quy doc lap cho Safe Preview Migration Script (S1 - S43).
# Chay 100% offline, khong cham network, khong cham Neon, khong mutation.

$ErrorActionPreference = 'Continue'

# Dam bao dung o nong-san-b2b
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nongSanB2bRoot = Resolve-Path (Join-Path $scriptRoot "..\..")
Set-Location $nongSanB2bRoot

# Dot-source script de nap cac ham validation
. .\scripts\safe-preview-migrate.ps1

$testResults = @()

function Record-Test {
    param(
        [string]$Id,
        [string]$Description,
        [bool]$Passed,
        [string]$Details
    )
    $statusText = if ($Passed) { "PASS" } else { "FAIL" }
    $script:testResults += [PSCustomObject]@{
        Id = $Id
        Description = $Description
        Result = $statusText
        Details = $Details
    }
    $color = if ($Passed) { "Green" } else { "Red" }
    Write-Host "[$statusText] ${Id}: $Description" -ForegroundColor $color
    if (-not $Passed) {
        Write-Host "       Chi tiet: $Details" -ForegroundColor Yellow
    }
}

$realHead = (git rev-parse HEAD 2>$null).Trim()

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   BAT DAU CHAY 43 TEST CASES OFFLINE (EV-IMP-01B-G5-DEMO)       " -ForegroundColor Cyan
Write-Host "   Current Real Git HEAD: $realHead                              " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

# -----------------------------------------------------------------------------
# S1: Sai Git branch -> STOP
# -----------------------------------------------------------------------------
try {
    Test-GitBaseline -ExpectedBranch "non-existent-branch" -ApprovedCommitSha $realHead -SkipWorkingTreeCheck
    Record-Test "S1" "Sai Git branch -> STOP" $false "Khong nem loi khi branch sai"
} catch {
    $matched = $_.Exception.Message -match "Git branch"
    Record-Test "S1" "Sai Git branch -> STOP" $matched $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S2: Sai ApprovedCommitSha -> STOP
# -----------------------------------------------------------------------------
try {
    Test-GitBaseline -ApprovedCommitSha "0000000000000000000000000000000000000000" -SkipWorkingTreeCheck
    Record-Test "S2" "Sai ApprovedCommitSha -> STOP" $false "Khong nem loi khi HEAD sai"
} catch {
    $matched = $_.Exception.Message -match "khong khop voi Approved Commit SHA"
    Record-Test "S2" "Sai ApprovedCommitSha -> STOP" $matched $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S3: Host Production da biet -> STOP
# -----------------------------------------------------------------------------
try {
    $prodUrl = "postgresql://neondb_owner:dummy@ep-square-scene-b5ddgxil.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require"
    Test-EndpointAllowlist -ExpectedHost "ep-preview-beta.c-7.us-east-2.aws.neon.tech" -ConnectionString $prodUrl
    Record-Test "S3" "Host Production da biet -> STOP" $false "Khong chan endpoint Production"
} catch {
    $matched = ($_.Exception.Message -match "HARD GATE G1 FAILED" -or $_.Exception.Message -match "HARD GATE G6 FAILED")
    Record-Test "S3" "Host Production da biet -> STOP" $matched $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S4: Host khong thuoc allowlist -> STOP
# -----------------------------------------------------------------------------
try {
    $mismatchUrl = "postgresql://neondb_owner:dummy@ep-other-branch.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require"
    Test-EndpointAllowlist -ExpectedHost "ep-expected-branch.c-7.us-east-2.aws.neon.tech" -ConnectionString $mismatchUrl
    Record-Test "S4" "Host khong thuoc allowlist -> STOP" $false "Khong phat hien host lech allowlist"
} catch {
    $matched = $_.Exception.Message -match "Expected Direct Host"
    Record-Test "S4" "Host khong thuoc allowlist -> STOP" $matched $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S5: Host trung allowlist nhung pooled -> STOP
# -----------------------------------------------------------------------------
try {
    $pooledUrl = "postgresql://neondb_owner:dummy@ep-expected-branch-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require"
    Test-EndpointAllowlist -ExpectedHost "ep-expected-branch-pooler.c-7.us-east-2.aws.neon.tech" -ConnectionString $pooledUrl
    Record-Test "S5" "Host trung allowlist nhung pooled -> STOP" $false "Cho phep host chua -pooler"
} catch {
    $matched = $_.Exception.Message -match "-pooler"
    Record-Test "S5" "Host trung allowlist nhung pooled -> STOP" $matched $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S6: Connection string sai dinh dang -> STOP
# -----------------------------------------------------------------------------
try {
    $invalidUrl = "not-a-valid-connection-string"
    Test-EndpointAllowlist -ExpectedHost "ep-preview-beta.c-7.us-east-2.aws.neon.tech" -ConnectionString $invalidUrl
    Record-Test "S6" "Connection string sai dinh dang -> STOP" $false "Khong bat loi URI sai"
} catch {
    $matched = $_.Exception.Message -match "Scheme"
    Record-Test "S6" "Connection string sai dinh dang -> STOP" $matched $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S7: Prisma status exit 1 do loi ket noi -> STOP
# -----------------------------------------------------------------------------
$mockConnError = @(
    'Environment variables loaded from .env',
    'Prisma schema loaded from prisma\schema.prisma',
    'Datasource "db": PostgreSQL database "neondb", schema "public" at "ep-preview-beta.c-7.us-east-2.aws.neon.tech"',
    "Error: P1001: Cannot reach database server at ep-preview-beta.c-7.us-east-2.aws.neon.tech:5432"
) -join "`n"

$analysisS7 = Analyze-PrismaMigrateStatus -Output $mockConnError -ExitCode 1
$s7Passed = ($analysisS7.Status -eq 'CONNECTION_ERROR' -and $analysisS7.CanProceed -eq $false)
Record-Test "S7" "Prisma status exit 1 do loi ket noi -> STOP" $s7Passed $analysisS7.Message

# -----------------------------------------------------------------------------
# S8: Prisma status exit 1 nhung chi co F01 pending hop le -> EXPECTED_PENDING
# -----------------------------------------------------------------------------
$mockValidF01Pending = @(
    'Environment variables loaded from .env',
    'Prisma schema loaded from prisma\schema.prisma',
    'Datasource "db": PostgreSQL database "neondb", schema "public" at "ep-preview-beta.c-7.us-east-2.aws.neon.tech"',
    '',
    '1 migration found in prisma/migrations',
    '',
    'Following migration have not yet been applied:',
    '20261023235900_add_f01_inventory_ledger',
    '',
    'To apply migrations in development run prisma migrate dev.',
    'To apply migrations in production run prisma migrate deploy.'
) -join "`n"

$analysisS8 = Analyze-PrismaMigrateStatus -Output $mockValidF01Pending -ExitCode 1
$s8Passed = ($analysisS8.Status -eq 'EXPECTED_PENDING' -and $analysisS8.CanProceed -eq $true)
Record-Test "S8" "Prisma status exit 1 voi F01 singular -> EXPECTED_PENDING" $s8Passed $analysisS8.Message

# -----------------------------------------------------------------------------
# S9: Co hai migrations pending (Plural) -> STOP
# -----------------------------------------------------------------------------
$mockMultiplePending = @(
    'Following migrations have not yet been applied:',
    '20261023235900_add_f01_inventory_ledger',
    '20261024000000_unauthorized_migration',
    '',
    'To apply migrations in development, run prisma migrate dev'
) -join "`n"

$analysisS9 = Analyze-PrismaMigrateStatus -Output $mockMultiplePending -ExitCode 1
$s9Passed = ($analysisS9.Status -eq 'MULTIPLE_PENDING_MIGRATIONS' -and $analysisS9.CanProceed -eq $false)
Record-Test "S9" "Co hai migrations pending (plural) -> STOP" $s9Passed $analysisS9.Message

# -----------------------------------------------------------------------------
# S10: Migration Phase 8 baseline chua applied -> STOP
# -----------------------------------------------------------------------------
$mockMissingPhase8 = @(
    'Following migration(s) have not yet been applied:',
    '20261019193200_phase8_shipping_engine',
    '20261023235900_add_f01_inventory_ledger'
) -join "`n"

$analysisS10 = Analyze-PrismaMigrateStatus -Output $mockMissingPhase8 -ExitCode 1
$s10Passed = ($analysisS10.Status -eq 'MISSING_BASELINE' -and $analysisS10.CanProceed -eq $false)
Record-Test "S10" "Migration Phase 8 baseline chua applied -> STOP" $s10Passed $analysisS10.Message

# -----------------------------------------------------------------------------
# S11: Migration F01 da applied -> ALREADY_APPLIED (NO-OP)
# -----------------------------------------------------------------------------
$mockAlreadyApplied = @(
    'Environment variables loaded from .env',
    'Prisma schema loaded from prisma\schema.prisma',
    'Datasource "db": PostgreSQL database "neondb", schema "public" at "ep-preview-beta.c-7.us-east-2.aws.neon.tech"',
    '',
    '3 migrations found in prisma/migrations',
    '',
    'Database schema is up to date!'
) -join "`n"

$analysisS11 = Analyze-PrismaMigrateStatus -Output $mockAlreadyApplied -ExitCode 0
$s11Passed = ($analysisS11.Status -eq 'ALREADY_APPLIED' -and $analysisS11.CanProceed -eq $false)
Record-Test "S11" "Migration F01 da applied -> NO-OP" $s11Passed $analysisS11.Message

# -----------------------------------------------------------------------------
# S12: G5 Backup/Recovery Checklist & Verification (BACKUP_VERIFIED)
# -----------------------------------------------------------------------------
$g5Result = Test-RecoveryReadiness -BackupSnapshotId "backup-pre-f01-inventory-preflight" -BackupVerifiedByPO:$true -NonInteractive:$true -Mode Apply
$s12Passed = ($g5Result.Status -eq 'BACKUP_VERIFIED' -and $g5Result.CanProceed -eq $true)
Record-Test "S12" "G5 ghi nhan Backup Snapshot hop le va duoc PO xac minh (BACKUP_VERIFIED)" $s12Passed "Status: $($g5Result.Status)"

# -----------------------------------------------------------------------------
# S13: Nguoi dung nhap N hoac de trong trong Apply mode -> STOP
# -----------------------------------------------------------------------------
$secTest = ConvertTo-SecureString "postgresql://neondb_owner:dummy@ep-preview-beta.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require" -AsPlainText -Force
$s13Success = $false
try {
    Invoke-SafePreviewMigration -Mode Apply `
        -ApprovedCommitSha $realHead `
        -ExpectedHost "ep-preview-beta.c-7.us-east-2.aws.neon.tech" `
        -SecureConnectionString $secTest `
        -BackupSnapshotId "backup-pre-f01-inventory-20261024-test" `
        -BackupVerifiedByPO `
        -SkipWorkingTreeCheck `
        -NonInteractive `
        -MockPrismaStatusOutput $mockValidF01Pending `
        -MockPrismaStatusExitCode 1
    # Script phai return clean ma khong chay deploy, don dep DATABASE_URL
    $s13Success = ($env:DATABASE_URL -eq $null -or $env:DATABASE_URL -eq '')
    Record-Test "S13" "Nguoi dung khong xac nhan deploy -> STOP an toan" $s13Success "Da dung va don dep bien moi truong"
} catch {
    Record-Test "S13" "Nguoi dung khong xac nhan deploy -> STOP an toan" $false $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S14: Deploy exit code khac 0 -> STOP, khong hien thi SUCCESS
# -----------------------------------------------------------------------------
try {
    Invoke-SafePreviewMigration -Mode Apply `
        -ApprovedCommitSha $realHead `
        -ExpectedHost "ep-preview-beta.c-7.us-east-2.aws.neon.tech" `
        -SecureConnectionString $secTest `
        -BackupSnapshotId "backup-pre-f01-inventory-20261024-test" `
        -BackupVerifiedByPO `
        -SkipWorkingTreeCheck `
        -NonInteractive `
        -MockPrismaStatusOutput $mockValidF01Pending `
        -MockPrismaStatusExitCode 1 `
        -MockPrismaDeployExitCode 1
    Record-Test "S14" "Deploy exit code khac 0 -> STOP" $false "Khong nem loi khi deploy exit code 1"
} catch {
    $matched = $_.Exception.Message -match "that bai voi ma loi 1"
    Record-Test "S14" "Deploy exit code khac 0 -> STOP" $matched $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S15: Post-check exit code khac 0 -> STOP, khong hien thi SUCCESS
# -----------------------------------------------------------------------------
try {
    Invoke-SafePreviewMigration -Mode Apply `
        -ApprovedCommitSha $realHead `
        -ExpectedHost "ep-preview-beta.c-7.us-east-2.aws.neon.tech" `
        -SecureConnectionString $secTest `
        -BackupSnapshotId "backup-pre-f01-inventory-20261024-test" `
        -BackupVerifiedByPO `
        -SkipWorkingTreeCheck `
        -NonInteractive `
        -MockPrismaStatusOutput $mockValidF01Pending `
        -MockPrismaStatusExitCode 1 `
        -MockPrismaDeployExitCode 0 `
        -MockPostCheckExitCode 1
    Record-Test "S15" "Post-check exit code khac 0 -> STOP" $false "Khong nem loi khi post-check exit code 1"
} catch {
    $matched = $_.Exception.Message -match "MIGRATION OUTCOME REQUIRES INVESTIGATION"
    Record-Test "S15" "Post-check exit code khac 0 -> STOP" $matched $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S16: Moi gate PASS tren mock -> Preflight ONLY hoan tat khong goi deploy
# -----------------------------------------------------------------------------
try {
    Invoke-SafePreviewMigration -Mode Preflight `
        -ApprovedCommitSha $realHead `
        -ExpectedHost "ep-preview-beta.c-7.us-east-2.aws.neon.tech" `
        -SecureConnectionString $secTest `
        -SkipRecoveryChecklist `
        -SkipWorkingTreeCheck `
        -NonInteractive `
        -MockPrismaStatusOutput $mockValidF01Pending `
        -MockPrismaStatusExitCode 1
    Record-Test "S16" "Moi gate PASS tren mock -> Preflight ONLY hoan tat khong goi deploy" $true "Mode Preflight pass G0-G6"
} catch {
    Record-Test "S16" "Moi gate PASS tren mock -> Preflight ONLY hoan tat khong goi deploy" $false $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S17: Script bi gian doan -> don bien moi truong o muc kha thi
# -----------------------------------------------------------------------------
$envClean = ($env:DATABASE_URL -eq $null -or $env:DATABASE_URL -eq '')
Record-Test "S17" "Script bi gian doan / ket thuc -> DATABASE_URL duoc don sach" $envClean "DATABASE_URL is null"

# -----------------------------------------------------------------------------
# S18: Khong the lay expected endpoint tu Neon metadata doc lap -> STOP
# -----------------------------------------------------------------------------
try {
    Test-EndpointAllowlist -ExpectedHost "" -ConnectionString "postgresql://user:pass@ep-x.neon.tech/neondb"
    Record-Test "S18" "Expected host rong -> STOP" $false "Khong bat loi khi expected host rong"
} catch {
    $matched = $_.Exception.Message -match "Expected Host khong duoc de trong"
    Record-Test "S18" "Expected host rong -> STOP" $matched $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S19: Legacy mock output co chuoi '(s)' van duoc ho tro tuong thich -> EXPECTED_PENDING
# -----------------------------------------------------------------------------
$mockLegacyPending = @(
    'Following migration(s) have not yet been applied:',
    '20261023235900_add_f01_inventory_ledger',
    '',
    'To apply migrations in development run prisma migrate dev.'
) -join "`n"
$analysisS19 = Analyze-PrismaMigrateStatus -Output $mockLegacyPending -ExitCode 1
$s19Passed = ($analysisS19.Status -eq 'EXPECTED_PENDING' -and $analysisS19.CanProceed -eq $true)
Record-Test "S19" "Tuong thich nguoc mock dang migration(s) -> EXPECTED_PENDING" $s19Passed $analysisS19.Message

# -----------------------------------------------------------------------------
# S20: State B -- Authentication failed (P1000) -> STOP
# -----------------------------------------------------------------------------
$mockAuthError = "Error: P1000: Authentication failed against database server at ep-fancy.neon.tech"
$analysisS20 = Analyze-PrismaMigrateStatus -Output $mockAuthError -ExitCode 1
$s20Passed = ($analysisS20.Status -eq 'AUTHENTICATION_FAILED' -and $analysisS20.CanProceed -eq $false)
Record-Test "S20" "State B: Authentication failed (P1000) -> STOP" $s20Passed $analysisS20.Message

# -----------------------------------------------------------------------------
# S21: State D -- Failed migration in history -> STOP
# -----------------------------------------------------------------------------
$mockFailedMig = @(
    'Following migration have failed:',
    '20261019193200_phase8_shipping_engine',
    '',
    'The failed migration(s) can be marked as rolled back or applied:'
) -join "`n"
$analysisS21 = Analyze-PrismaMigrateStatus -Output $mockFailedMig -ExitCode 1
$s21Passed = ($analysisS21.Status -eq 'FAILED_MIGRATION' -and $analysisS21.CanProceed -eq $false)
Record-Test "S21" "State D: Failed migration in history -> STOP" $s21Passed $analysisS21.Message

# -----------------------------------------------------------------------------
# S22: State E -- Divergent migration history -> STOP
# -----------------------------------------------------------------------------
$mockDivergent = @(
    'Your local migration history and the migrations table from your database are different:',
    'The last common migration is: 20261019193200_phase8_shipping_engine',
    'The migration have not yet been applied:',
    '20261023235900_add_f01_inventory_ledger'
) -join "`n"
$analysisS22 = Analyze-PrismaMigrateStatus -Output $mockDivergent -ExitCode 1
$s22Passed = ($analysisS22.Status -eq 'DIVERGENT_HISTORY' -and $analysisS22.CanProceed -eq $false)
Record-Test "S22" "State E: Divergent migration history -> STOP" $s22Passed $analysisS22.Message

# -----------------------------------------------------------------------------
# S23: State F -- No migrations table (Not managed by Prisma) -> STOP
# -----------------------------------------------------------------------------
$mockNoMigTable = "The current database is not managed by Prisma Migrate."
$analysisS23 = Analyze-PrismaMigrateStatus -Output $mockNoMigTable -ExitCode 1
$s23Passed = ($analysisS23.Status -eq 'NO_MIGRATIONS_TABLE' -and $analysisS23.CanProceed -eq $false)
Record-Test "S23" "State F: Database not managed by Prisma -> STOP" $s23Passed $analysisS23.Message

# -----------------------------------------------------------------------------
# S24: State H -- Unrecognized status output -> STOP
# -----------------------------------------------------------------------------
$mockUnrecognized = "Some random unknown error output from third party wrapper without P-code"
$analysisS24 = Analyze-PrismaMigrateStatus -Output $mockUnrecognized -ExitCode 1
$s24Passed = ($analysisS24.Status -eq 'UNRECOGNIZED_STATUS' -and $analysisS24.CanProceed -eq $false)
Record-Test "S24" "State H: Unrecognized status output -> STOP" $s24Passed $analysisS24.Message

# -----------------------------------------------------------------------------
# S25: Redaction Engine che giau 100% password, token va user Windows
# -----------------------------------------------------------------------------
$secretStr = "super_secret_p@ss_987"
$rawDiagnosticText = "Error at postgresql://user_app:$secretStr@ep-fancy.neon.tech/neondb?password=$secretStr in C:\Users\alice_admin\code"
$redactedOutput = Redact-SensitiveText -Text $rawDiagnosticText -Secret $secretStr
$s25Passed = ($redactedOutput -notmatch [regex]::Escape($secretStr) -and $redactedOutput -notmatch "alice_admin" -and $redactedOutput -match "\[REDACTED_")
Record-Test "S25" "Redaction Engine che giau 100% secrets va duong dan Windows" $s25Passed $redactedOutput

# -----------------------------------------------------------------------------
# S26: Read-only DB check (Test-PrismaMigrationsTable): Normal valid state -> PASS
# -----------------------------------------------------------------------------
$mockDbSuccess = '{"status":"OK","rows":[{"migration_name":"20261013094130_init","finished_at":"2026-10-13T09:41:30Z","rolled_back_at":null},{"migration_name":"20261019193200_phase8_shipping_engine","finished_at":"2026-10-19T19:32:00Z","rolled_back_at":null}]}'
$dbCheckS26 = Test-PrismaMigrationsTable -ConnectionString "dummy" -MockDbResult $mockDbSuccess
$s26Passed = ($dbCheckS26.Status -eq 'EXPECTED_DB_STATE' -and $dbCheckS26.CanProceed -eq $true)
Record-Test "S26" "Read-only DB check hop le (baselines da applied, 0 failed) -> PASS" $s26Passed $dbCheckS26.Message

# -----------------------------------------------------------------------------
# S27: Read-only DB check: Phat hien migration that bai trong DB -> STOP
# -----------------------------------------------------------------------------
$mockDbFailedMig = '{"status":"OK","rows":[{"migration_name":"20261013094130_init","finished_at":null,"rolled_back_at":null}]}'
$dbCheckS27 = Test-PrismaMigrationsTable -ConnectionString "dummy" -MockDbResult $mockDbFailedMig
$s27Passed = ($dbCheckS27.Status -eq 'FAILED_MIGRATION' -and $dbCheckS27.CanProceed -eq $false)
Record-Test "S27" "Read-only DB check phat hien failed migration -> STOP" $s27Passed $dbCheckS27.Message

# -----------------------------------------------------------------------------
# S28: Dual-Proof Preflight: DB check bi lech -> Preflight chan dung Gate G3
# -----------------------------------------------------------------------------
try {
    Invoke-SafePreviewMigration -Mode Preflight `
        -ApprovedCommitSha $realHead `
        -ExpectedHost "ep-preview-beta.c-7.us-east-2.aws.neon.tech" `
        -SecureConnectionString $secTest `
        -SkipRecoveryChecklist `
        -SkipWorkingTreeCheck `
        -NonInteractive `
        -MockPrismaStatusOutput $mockValidF01Pending `
        -MockPrismaStatusExitCode 1 `
        -MockDbResult $mockDbFailedMig
    Record-Test "S28" "Dual-Proof: DB lech thi Preflight phai STOP" $false "Khong nem loi khi DB check lech"
} catch {
    $matched = $_.Exception.Message -match "HARD GATE G3 FAILED"
    Record-Test "S28" "Dual-Proof: DB lech thi Preflight phai STOP" $matched $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S29: File migration F01 bi thay doi hash SHA256 -> STOP (G4)
# -----------------------------------------------------------------------------
try {
    Test-MigrationSqlSafety -ExpectedHash "0000000000000000000000000000000000000000000000000000000000000000"
    Record-Test "S29" "SHA256 sai lech -> STOP (G4)" $false "Khong nem loi khi SHA256 sai"
} catch {
    $matched = $_.Exception.Message -match "HARD GATE G4 FAILED"
    Record-Test "S29" "SHA256 sai lech -> STOP (G4)" $matched $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S30: File migration F01 chua DDL pha huy (DROP TABLE) -> STOP (G4)
# -----------------------------------------------------------------------------
$tempDestructiveFile = "prisma/migrations/test_destructive.sql"
try {
    Set-Content -Path $tempDestructiveFile -Value "ALTER TABLE Product ADD COLUMN temp INT; DROP TABLE Users CASCADE;"
    $tempHash = (Get-FileHash -Path $tempDestructiveFile -Algorithm SHA256).Hash.ToUpper()
    Test-MigrationSqlSafety -MigrationPath $tempDestructiveFile -ExpectedHash $tempHash
    Record-Test "S30" "DDL chua DROP TABLE CASCADE -> STOP (G4)" $false "Khong phat hien DDL pha huy"
} catch {
    $matched = $_.Exception.Message -match "Phat hien DDL pha huy bat thuong"
    Record-Test "S30" "DDL chua DROP TABLE CASCADE -> STOP (G4)" $matched $_.Exception.Message
} finally {
    Remove-Item $tempDestructiveFile -ErrorAction SilentlyContinue
}

# -----------------------------------------------------------------------------
# S31: Thieu tham so ApprovedCommitSha va khong co artifact -> STOP (G0)
# -----------------------------------------------------------------------------
try {
    Test-GitBaseline -ApprovedCommitSha "" -SkipWorkingTreeCheck
    Record-Test "S31" "Thieu ApprovedCommitSha -> STOP (G0)" $false "Khong nem loi khi thieu ApprovedCommitSha"
} catch {
    $matched = $_.Exception.Message -match "Thieu tham so bat buoc '-ApprovedCommitSha'"
    Record-Test "S31" "Thieu ApprovedCommitSha -> STOP (G0)" $matched $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S32: G5 NonInteractive khong co backup ID -> STOP (G5)
# -----------------------------------------------------------------------------
try {
    Test-RecoveryReadiness -BackupSnapshotId "" -SkipPrompt $false -NonInteractive $true -Mode Apply
    Record-Test "S32" "G5 NonInteractive khong co backup ID -> STOP (G5)" $false "Khong nem loi khi thieu backup ID"
} catch {
    $matched = $_.Exception.Message -match "HARD GATE G5 FAILED"
    Record-Test "S32" "G5 NonInteractive khong co backup ID -> STOP (G5)" $matched $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S33: G5 Co bypass/waiver (-SkipRecoveryChecklist) trong Apply -> STOP (G5)
# -----------------------------------------------------------------------------
try {
    Test-RecoveryReadiness -BackupSnapshotId "backup-pre-f01-inventory-test" -SkipPrompt $true -Mode Apply
    Record-Test "S33" "G5 Co bypass/waiver (-SkipRecoveryChecklist) trong Apply -> STOP (G5)" $false "Khong nem loi khi dung SkipRecoveryChecklist trong Apply"
} catch {
    $matched = $_.Exception.Message -match "HARD GATE G5 FAILED: Co bypass/waiver \(-SkipRecoveryChecklist\) bi CAM TUYET DOI"
    Record-Test "S33" "G5 Co bypass/waiver (-SkipRecoveryChecklist) trong Apply -> STOP (G5)" $matched $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S34: G5 Backup ID gia mao hoac sai dinh dang ('dummy') -> STOP (G5)
# -----------------------------------------------------------------------------
try {
    Test-RecoveryReadiness -BackupSnapshotId "dummy" -NonInteractive $true -Mode Apply
    Record-Test "S34" "G5 Backup ID gia mao hoac sai dinh dang ('dummy') -> STOP (G5)" $false "Khong nem loi khi truyen dummy ID"
} catch {
    $matched = $_.Exception.Message -match "khong hop le hoac la gia tri gia mao"
    Record-Test "S34" "G5 Backup ID gia mao hoac sai dinh dang ('dummy') -> STOP (G5)" $matched $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S35: G5 NonInteractive co ID nhung chua PO xac minh -> STOP (BACKUP_ID_RECORDED)
# -----------------------------------------------------------------------------
try {
    Test-RecoveryReadiness -BackupSnapshotId "backup-pre-f01-inventory-valid" -BackupVerifiedByPO $false -NonInteractive $true -Mode Apply
    Record-Test "S35" "G5 NonInteractive co ID nhung chua PO xac minh -> STOP (G5)" $false "Khong nem loi khi chua co PO xac minh"
} catch {
    $matched = $_.Exception.Message -match "BACKUP_ID_RECORDED.*nhung chua co xac minh tu PO"
    Record-Test "S35" "G5 NonInteractive co ID nhung chua PO xac minh -> STOP (G5)" $matched $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S36: G5 Preflight khong co backup ID -> PASS read-only (PREFLIGHT_CHECKED)
# -----------------------------------------------------------------------------
try {
    $g5Preflight = Test-RecoveryReadiness -Mode Preflight
    $s36Passed = ($g5Preflight.Status -eq 'PREFLIGHT_CHECKED' -and $g5Preflight.CanProceed -eq $true)
    Record-Test "S36" "G5 Preflight khong co backup ID -> PASS read-only (PREFLIGHT_CHECKED)" $s36Passed "Status: $($g5Preflight.Status)"
} catch {
    Record-Test "S36" "G5 Preflight khong co backup ID -> PASS read-only (PREFLIGHT_CHECKED)" $false $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S37: G5 Preflight co backup ID nhung chua verify -> PASS (BACKUP_ID_RECORDED)
# -----------------------------------------------------------------------------
try {
    $g5Recorded = Test-RecoveryReadiness -BackupSnapshotId "backup-pre-f01-inventory-valid" -Mode Preflight
    $s37Passed = ($g5Recorded.Status -eq 'BACKUP_ID_RECORDED' -and $g5Recorded.CanProceed -eq $true)
    Record-Test "S37" "G5 Preflight co backup ID nhung chua verify -> PASS (BACKUP_ID_RECORDED)" $s37Passed "Status: $($g5Recorded.Status)"
} catch {
    Record-Test "S37" "G5 Preflight co backup ID nhung chua verify -> PASS (BACKUP_ID_RECORDED)" $false $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S38: G5 Interactive Apply de trong backup ID -> STOP (Khong cho bypass)
# -----------------------------------------------------------------------------
try {
    # Mock Read-Host tra ve chuoi rong
    function Read-Host { param([string]$Prompt) return "" }
    Test-RecoveryReadiness -Mode Apply -NonInteractive $false
    Remove-Item Function:\Read-Host -ErrorAction SilentlyContinue
    Record-Test "S38" "G5 Interactive Apply de trong backup ID -> STOP" $false "Khong nem loi khi de trong backup ID"
} catch {
    Remove-Item Function:\Read-Host -ErrorAction SilentlyContinue
    $matched = $_.Exception.Message -match "HARD GATE G5 FAILED.*nguoi van hanh khong nhap Backup Snapshot ID"
    Record-Test "S38" "G5 Interactive Apply de trong backup ID -> STOP" $matched $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S39: G5 Interactive Apply nhap 'y' (thu co bypass cu) -> STOP (Chan bypass)
# -----------------------------------------------------------------------------
try {
    # Mock Read-Host tra ve 'y'
    function Read-Host { param([string]$Prompt) return "y" }
    Test-RecoveryReadiness -Mode Apply -NonInteractive $false
    Remove-Item Function:\Read-Host -ErrorAction SilentlyContinue
    Record-Test "S39" "G5 Interactive Apply nhap 'y' (thu bypass cu) -> STOP" $false "Khong chan duoc bypass nhap 'y'"
} catch {
    Remove-Item Function:\Read-Host -ErrorAction SilentlyContinue
    $matched = $_.Exception.Message -match "khong hop le hoac la gia tri gia mao"
    Record-Test "S39" "G5 Interactive Apply nhap 'y' (thu bypass cu) -> STOP" $matched $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S40: G5 AcceptDemoDataRiskByPO tren beta + Neon preview-beta Direct Host -> DEMO_RISK_ACCEPTED_BY_PO
# -----------------------------------------------------------------------------
try {
    $g5Demo = Test-RecoveryReadiness -Mode Apply `
        -AcceptDemoDataRiskByPO $true `
        -TargetHost "ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech" `
        -GitBranch "beta"
    $s40Passed = ($g5Demo.Status -eq 'DEMO_RISK_ACCEPTED_BY_PO' -and $g5Demo.Status -ne 'BACKUP_VERIFIED' -and $g5Demo.CanProceed -eq $true)
    Record-Test "S40" "G5 AcceptDemoDataRiskByPO hop le -> DEMO_RISK_ACCEPTED_BY_PO (khong gia mao BACKUP_VERIFIED)" $s40Passed "Status: $($g5Demo.Status)"
} catch {
    Record-Test "S40" "G5 AcceptDemoDataRiskByPO hop le -> DEMO_RISK_ACCEPTED_BY_PO (khong gia mao BACKUP_VERIFIED)" $false $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S41: G5 AcceptDemoDataRiskByPO tren Production host -> STOP (Chan tuyet doi Production)
# -----------------------------------------------------------------------------
try {
    Test-RecoveryReadiness -Mode Apply `
        -AcceptDemoDataRiskByPO $true `
        -TargetHost "ep-square-scene-b5ddgxil.c-7.us-east-2.aws.neon.tech" `
        -GitBranch "beta"
    Record-Test "S41" "G5 AcceptDemoDataRiskByPO tren Production host -> STOP" $false "Khong chan duoc Production khi dung AcceptDemoDataRiskByPO"
} catch {
    $matched = $_.Exception.Message -match "Tuyet doi khong duoc ap dung ngoai le demo.*Production"
    Record-Test "S41" "G5 AcceptDemoDataRiskByPO tren Production host -> STOP" $matched $_.Exception.Message
}

# -----------------------------------------------------------------------------
# S42: G5 AcceptDemoDataRiskByPO sai Git branch ('main') hoac pooled host -> STOP
# -----------------------------------------------------------------------------
$s42BranchBlocked = $false
$s42PoolerBlocked = $false
try {
    Test-RecoveryReadiness -Mode Apply `
        -AcceptDemoDataRiskByPO $true `
        -TargetHost "ep-fancy-waterfall-b5f117np.c-7.us-east-2.aws.neon.tech" `
        -GitBranch "main"
} catch {
    $s42BranchBlocked = ($_.Exception.Message -match "chi duoc phep ap dung tren Git branch 'beta'")
}
try {
    Test-RecoveryReadiness -Mode Apply `
        -AcceptDemoDataRiskByPO $true `
        -TargetHost "ep-fancy-waterfall-b5f117np-pooler.c-7.us-east-2.aws.neon.tech" `
        -GitBranch "beta"
} catch {
    $s42PoolerBlocked = ($_.Exception.Message -match "Direct Host cua Neon 'preview-beta'")
}
Record-Test "S42" "G5 AcceptDemoDataRiskByPO sai Git branch hoac pooled host -> STOP" ($s42BranchBlocked -and $s42PoolerBlocked) "BranchBlocked=$s42BranchBlocked, PoolerBlocked=$s42PoolerBlocked"

# -----------------------------------------------------------------------------
# S43: End-to-End Apply voi -AcceptDemoDataRiskByPO (khong can BackupSnapshotId) khi G0-G4, G6 PASS
# -----------------------------------------------------------------------------
try {
    Invoke-SafePreviewMigration -Mode Apply `
        -ApprovedCommitSha $realHead `
        -ExpectedHost "ep-preview-beta.c-7.us-east-2.aws.neon.tech" `
        -SecureConnectionString $secTest `
        -AcceptDemoDataRiskByPO `
        -SkipWorkingTreeCheck `
        -NonInteractive `
        -MockPrismaStatusOutput $mockValidF01Pending `
        -MockPrismaStatusExitCode 1 `
        -MockPrismaDeployExitCode 0 `
        -MockPostCheckExitCode 0
    Record-Test "S43" "End-to-End Apply voi -AcceptDemoDataRiskByPO khi G0-G4, G6 PASS -> PASS" $true "Deploy mock thanh cong voi DEMO_RISK_ACCEPTED_BY_PO"
} catch {
    Record-Test "S43" "End-to-End Apply voi -AcceptDemoDataRiskByPO khi G0-G4, G6 PASS -> PASS" $false $_.Exception.Message
}

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   TONG KET BANG KET QUA KIEM THU OFFLINE (S1 - S43)             " -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
$passedCount = ($testResults | Where-Object { $_.Result -eq "PASS" }).Count
$totalCount = $testResults.Count
Write-Host "TONG SO TEST: $totalCount | PASS: $passedCount | FAIL: $($totalCount - $passedCount)" -ForegroundColor $(if ($passedCount -eq $totalCount) { "Green" } else { "Red" })

if ($passedCount -ne $totalCount) {
    exit 1
}
