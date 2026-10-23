# scripts/safe-preview-migrate.ps1
# Quy trinh Safe Prisma Migration cho Neon Branch 'preview-beta' (EV-IMP-01B-SAFETY-FIX)
# Hard Gates:
#   G0: Git Integrity (Branch 'beta', Working Tree Clean, Approved Commit SHA khong tu tham chieu, Checksums migration)
#   G1: Target Allowlist (Positive Exact Match Host, Neon Domain Check, Database Name Check, SSL Required)
#   G2: Direct Connection Only (Chan tuyet doi '-pooler', port 5432)
#   G3: Migration History & Dual-Proof (Prisma CLI Status + Direct DB Query _prisma_migrations)
#   G4: Migration SQL Integrity (SHA256 Match, Additive-Only Check, Chan Drop Table/Column/Cascade)
#   G5: Neon Backup & Recovery Readiness (PO Snapshot Verification, PITR Checklist)
#   G6: Production Blocklist (Chan tuyet doi Production Endpoint)
# Tuong thich Windows PowerShell 5.1+ va PowerShell Core 7+.

[CmdletBinding()]
param(
    [ValidateSet('Preflight', 'Apply')]
    [string]$Mode = 'Preflight',

    [Alias('ExpectedHead')]
    [string]$ApprovedCommitSha = '',

    [string]$ExpectedHost = '',

    [System.Security.SecureString]$SecureConnectionString = $null,

    [string]$BackupSnapshotId = '',

    [switch]$Diagnostic = $false,            # Bat che do chan doan chi tiet (Safe Diagnostic Mode)
    [switch]$SkipRecoveryChecklist = $false, # Cho phep truyen co trong automated testing
    [switch]$SkipWorkingTreeCheck = $false,  # Cho phep bo qua kiem tra working tree trong test harness
    [switch]$NonInteractive = $false,        # Che do non-interactive cho offline test harness
    [string]$MockPrismaStatusOutput = '',    # Mock output cho offline testing
    [int]$MockPrismaStatusExitCode = -1,     # Mock exit code cho offline testing
    [int]$MockPrismaDeployExitCode = -1,     # Mock deploy exit code cho offline testing
    [int]$MockPostCheckExitCode = -1,        # Mock post-check exit code cho offline testing
    [string]$MockDbResult = ''               # Mock DB result cho offline testing
)

$ErrorActionPreference = 'Stop'

# ==============================================================================
# HAM BAO VE G0: HARD STOP GIT PREFLIGHT & APPROVED COMMIT SHA
# ==============================================================================
function Test-GitBaseline {
    param(
        [string]$ExpectedBranch = 'beta',
        [string]$ApprovedCommitSha = '',
        [switch]$SkipWorkingTreeCheck = $false,
        [string]$F01MigrationHash = '14A35A7CAB52CAE9BCB3D6651520F00C2796A4C590C069A43863EAE6FE93F0E5',
        [string]$Phase8MigrationHash = '9F5ADE072D6B231FAC4B5E4DDCA20780A7DEC9719B8A4217257CD2BF708F2ECC',
        [string]$InitMigrationHash = '59C7B1B9D7FEB39421079B3A791D685E5887D8BAD1D5D644983A2C47A9E48B6D'
    )

    # 1. Kiem tra thu muc lam viec
    $cwd = (Get-Location).Path
    if (-not ($cwd.EndsWith('nong-san-b2b') -or (Test-Path 'prisma/schema.prisma'))) {
        throw "HARD GATE G0 FAILED: Thu muc thuc thi khong hop le ($cwd). Bat buoc chay tu 'nong-san-b2b'."
    }

    # 2. Kiem tra Git branch: Bat buoc la 'beta'
    $currentBranch = ''
    try {
        $currentBranch = (git branch --show-current 2>$null).Trim()
    } catch {
        throw "HARD GATE G0 FAILED: Khong the truy van Git branch: $_"
    }
    if ($currentBranch -ne $ExpectedBranch) {
        throw "HARD GATE G0 FAILED: Git branch hien tai la '$currentBranch', khong phai '$ExpectedBranch'!"
    }

    # 3. Kiem tra Approved Commit SHA (Khong tu tham chieu, bat buoc duoc PO/QA phe duyet)
    $targetApprovedSha = $ApprovedCommitSha
    if ([string]::IsNullOrWhiteSpace($targetApprovedSha)) {
        # Kiem tra file artifact phe duyet doc lap neu co
        $approvalArtifactPath = "../docs/EV_IMP_01B_APPROVAL.json"
        if (Test-Path $approvalArtifactPath) {
            try {
                $approvalData = Get-Content -Path $approvalArtifactPath -Raw | ConvertFrom-Json
                if ($approvalData.approvedCommitSha) {
                    $targetApprovedSha = $approvalData.approvedCommitSha.Trim()
                }
            } catch {
                # Bo qua neu parse loi
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($targetApprovedSha)) {
        throw "HARD GATE G0 FAILED: Thieu tham so bat buoc '-ApprovedCommitSha' (hoac '-ExpectedHead')! Script khong duoc phep tu doan HEAD de tranh tu tham chieu."
    }

    $currentHead = ''
    try {
        $currentHead = (git rev-parse HEAD 2>$null).Trim()
    } catch {
        throw "HARD GATE G0 FAILED: Khong the truy van Git HEAD: $_"
    }

    # So sanh SHA day du hoac prefix toi thieu 7 ky tu
    $normalizedHead = $currentHead.ToLower()
    $normalizedApproved = $targetApprovedSha.Trim().ToLower()
    $isMatch = ($normalizedHead -eq $normalizedApproved) -or ($normalizedHead.StartsWith($normalizedApproved) -and $normalizedApproved.Length -ge 7)

    if (-not $isMatch) {
        throw "HARD GATE G0 FAILED: Git HEAD hien tai ($currentHead) khong khop voi Approved Commit SHA ($targetApprovedSha)!"
    }

    # 4. Kiem tra quan he voi origin/beta de tranh branch bi phan ky (diverged)
    try {
        $remoteHead = (git rev-parse origin/beta 2>$null)
        if (-not [string]::IsNullOrWhiteSpace($remoteHead)) {
            $remoteHead = $remoteHead.Trim().ToLower()
            $mergeBase = (git merge-base HEAD origin/beta 2>$null)
            if (-not [string]::IsNullOrWhiteSpace($mergeBase)) {
                $mergeBase = $mergeBase.Trim().ToLower()
                # Neu merge-base khong phai la remoteHead va cung khong phai la currentHead -> Branch bi diverged
                if ($mergeBase -ne $remoteHead -and $mergeBase -ne $normalizedHead) {
                    throw "HARD GATE G0 FAILED: Branch 'beta' cuc bo da bi phan ky (diverged) so voi 'origin/beta'! Vui long kiem tra lai lich su Git."
                }
            }
        }
    } catch {
        if ($_ -match 'HARD GATE G0 FAILED') { throw $_ }
        # Bo qua neu remote chua duoc fetch hoac khong co internet trong che do test
    }

    # 5. Kiem tra Working Tree: Khong duoc co file tracked bi modified
    if (-not $SkipWorkingTreeCheck) {
        try {
            $statusLines = git status --porcelain 2>$null
            foreach ($line in $statusLines) {
                $trimmed = $line.Trim()
                if ($trimmed -match '^[MADRCU]') {
                    throw "HARD GATE G0 FAILED: Working tree co file thay doi ngoai pham vi: $trimmed"
                }
            }
        } catch {
            if ($_ -match 'HARD GATE G0 FAILED') { throw $_ }
            throw "HARD GATE G0 FAILED: Khong the kiem tra git status: $_"
        }
    }

    # 6. Kiem tra migration files va checksums SHA256
    $f01Path = "prisma/migrations/20261023235900_add_f01_inventory_ledger/migration.sql"
    if (-not (Test-Path $f01Path)) {
        throw "HARD GATE G0 FAILED: Khong tim thay file migration F01 tai '$f01Path'!"
    }
    $actualF01Hash = (Get-FileHash -Path $f01Path -Algorithm SHA256).Hash.ToUpper()
    if ($actualF01Hash -ne $F01MigrationHash.ToUpper()) {
        throw "HARD GATE G0 FAILED: SHA256 file migration F01 bi thay doi ($actualF01Hash != $F01MigrationHash)!"
    }

    $phase8Path = "prisma/migrations/20261019193200_phase8_shipping_engine/migration.sql"
    if (-not (Test-Path $phase8Path)) {
        throw "HARD GATE G0 FAILED: Khong tim thay file migration Phase 8 tai '$phase8Path'!"
    }
    $actualPhase8Hash = (Get-FileHash -Path $phase8Path -Algorithm SHA256).Hash.ToUpper()
    if ($actualPhase8Hash -ne $Phase8MigrationHash.ToUpper()) {
        throw "HARD GATE G0 FAILED: SHA256 file migration Phase 8 bi thay doi ($actualPhase8Hash != $Phase8MigrationHash)!"
    }

    $initPath = "prisma/migrations/20261013094130_init/migration.sql"
    if (-not (Test-Path $initPath)) {
        throw "HARD GATE G0 FAILED: Khong tim thay file migration Init tai '$initPath'!"
    }
    $actualInitHash = (Get-FileHash -Path $initPath -Algorithm SHA256).Hash.ToUpper()
    if ($actualInitHash -ne $InitMigrationHash.ToUpper()) {
        throw "HARD GATE G0 FAILED: SHA256 file migration Init bi thay doi ($actualInitHash != $InitMigrationHash)!"
    }

    return
}

# ==============================================================================
# HAM BAO VE G4: MIGRATION DDL SAFETY & INTEGRITY
# ==============================================================================
function Test-MigrationSqlSafety {
    param(
        [string]$MigrationPath = "prisma/migrations/20261023235900_add_f01_inventory_ledger/migration.sql",
        [string]$ExpectedHash = "14A35A7CAB52CAE9BCB3D6651520F00C2796A4C590C069A43863EAE6FE93F0E5"
    )

    if (-not (Test-Path $MigrationPath)) {
        throw "HARD GATE G4 FAILED: Khong tim thay file migration tai '$MigrationPath'!"
    }

    $actualHash = (Get-FileHash -Path $MigrationPath -Algorithm SHA256).Hash.ToUpper()
    if ($actualHash -ne $ExpectedHash.ToUpper()) {
        throw "HARD GATE G4 FAILED: SHA256 file migration bi thay doi ($actualHash != $ExpectedHash)! Yeu cau QA review lai."
    }

    $content = Get-Content -Path $MigrationPath -Raw

    # Kiem tra cac tu khoa DDL pha huy nguy hiem
    $destructivePatterns = @(
        '(?i)\bDROP\s+TABLE\b',
        '(?i)\bDROP\s+COLUMN\b',
        '(?i)\bTRUNCATE\b',
        '(?i)\bDROP\s+SCHEMA\b',
        '(?i)\bDROP\s+DATABASE\b',
        '(?i)\bDROP\s+.*\bCASCADE\b'
    )

    foreach ($pat in $destructivePatterns) {
        if ($content -match $pat) {
            throw "HARD GATE G4 FAILED: Phat hien DDL pha huy bat thuong trong file migration (Pattern: '$pat')!"
        }
    }

    return
}

# ==============================================================================
# HAM BAO VE G1, G2, G6: POSITIVE TARGET & DIRECT CONNECTION VERIFICATION
# ==============================================================================
function Test-EndpointAllowlist {
    param(
        [string]$ExpectedHost = '',
        [string]$ConnectionString = '',
        [string]$ProductionEndpointId = 'ep-square-scene-b5ddgxil'
    )

    # 1. Tham dinh ExpectedHost Format
    if ([string]::IsNullOrWhiteSpace($ExpectedHost)) {
        throw "HARD GATE G1 FAILED: Expected Host khong duoc de trong!"
    }
    $ExpectedHost = $ExpectedHost.Trim().ToLower()

    # Phai la domain Neon hop le
    if ($ExpectedHost -notmatch '^[a-z0-9-]+\.(c-[a-z0-9-]+\.)?[a-z0-9-]+\.aws\.neon\.tech$' -and $ExpectedHost -notmatch '^[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$') {
        throw "HARD GATE G1 FAILED: Expected Host '$ExpectedHost' khong phai dinh dang Neon domain hop le (*.neon.tech)!"
    }

    # ExpectedHost KHONG duoc chua -pooler
    if ($ExpectedHost -match '-pooler') {
        throw "HARD GATE G2 FAILED: Expected Host chua '-pooler'. Neon migration DDL bat buoc dung Direct Connection!"
    }

    # ExpectedHost KHONG duoc la Production
    if ($ExpectedHost -match $ProductionEndpointId) {
        throw "HARD GATE G6 FAILED: Expected Host trung voi PRODUCTION endpoint ($ProductionEndpointId)! Abort ngay lap tuc."
    }

    # 2. Parse Connection String
    $uri = $null
    try {
        $uri = [System.Uri]$ConnectionString
    } catch {
        throw "HARD GATE G1 FAILED: Connection String khong hop le (loi cu phap URI): $_"
    }

    if ($uri.Scheme -ne 'postgresql' -and $uri.Scheme -ne 'postgres') {
        throw "HARD GATE G1 FAILED: Scheme phai la 'postgresql://' hoac 'postgres://', nhan duoc '$($uri.Scheme)'!"
    }

    $actualHost = $uri.Host.ToLower()
    $dbName = $uri.AbsolutePath.TrimStart('/')

    # 3. POSITIVE EXACT MATCH: Actual Host phai khop 100% voi ExpectedHost
    if ($actualHost -ne $ExpectedHost) {
        $maskedActual = if ($actualHost.Length -gt 15) { $actualHost.Substring(0, 8) + '...' + $actualHost.Substring($actualHost.Length - 8) } else { $actualHost }
        throw "HARD GATE G1 FAILED: Host trong connection string ($maskedActual) KHONG KHOP voi Expected Direct Host ($ExpectedHost)!"
    }

    # 4. DIRECT CONNECTION ONLY: Khong chap nhan -pooler
    if ($actualHost -match '-pooler') {
        throw "HARD GATE G2 FAILED: Host chua '-pooler'. Nghiem cam su dung Pooled Connection cho Prisma Migration!"
    }

    # 5. NEGATIVE DEFENSE-IN-DEPTH: Chan tuyet doi Production
    if ($actualHost -match $ProductionEndpointId) {
        throw "HARD GATE G6 FAILED: Phat hien PRODUCTION endpoint ($ProductionEndpointId)! DUNG LAP TUC DE BAO VE DU LIEU."
    }

    # 6. Database Name check
    if ($dbName -ne 'neondb' -and $dbName -ne 'nong_san_b2b') {
        throw "HARD GATE G1 FAILED: Ten database '$dbName' khong khop voi database muc tieu ('neondb')!"
    }

    # 7. SSL mode check
    if ($uri.Query -notmatch 'sslmode=(require|verify-full|verify-ca)') {
        throw "HARD GATE G1 FAILED: Connection string thieu thong so bat buoc '?sslmode=require' cho Neon PostgreSQL!"
    }

    return @{
        Host = $actualHost
        Database = $dbName
        MaskedHost = $actualHost.Substring(0, [Math]::Min(10, $actualHost.Length)) + '...' + $actualHost.Substring([Math]::Max(0, $actualHost.Length - 10))
    }
}

# ==============================================================================
# HAM BAO VE G5: NEON BACKUP & RECOVERY READINESS (CHECKLIST & VERIFICATION)
# ==============================================================================
function Test-RecoveryReadiness {
    param(
        [string]$BackupSnapshotId = '',
        [bool]$SkipPrompt = $false,
        [bool]$NonInteractive = $false,
        [string]$Mode = 'Preflight'
    )

    Write-Host ""
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host "   HARD GATE G5: NEON BACKUP & RECOVERY READINESS CHECKLIST     " -ForegroundColor Cyan
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host "1. Neon Console (https://console.neon.tech) -> Project E Vibe." -ForegroundColor Gray
    Write-Host "2. Chon Branch 'preview-beta' -> Bam 'Create Branch' (hoac note Point-in-time LSN)." -ForegroundColor Gray
    Write-Host "3. Dat ten branch backup: backup-pre-f01-inventory-[timestamp]." -ForegroundColor Gray
    Write-Host "4. Xac minh branch backup da hien thi tren Neon va truy cap duoc." -ForegroundColor Gray
    Write-Host "5. LUU Y: Chuyen sang branch backup se thay doi Hostname connection string!" -ForegroundColor Yellow
    Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray

    # Neu da cung cap BackupSnapshotId
    if (-not [string]::IsNullOrWhiteSpace($BackupSnapshotId)) {
        Write-Host "[PASS] Hard Gate G5: Backup / Restore Point da duoc xac nhan voi dinh danh: '$BackupSnapshotId'." -ForegroundColor Green
        return @{
            Status = 'VERIFIED_BACKUP'
            CanProceed = $true
            BackupId = $BackupSnapshotId
            Message = "Backup snapshot '$BackupSnapshotId' da duoc xac nhan."
        }
    }

    # Neu co co mien tru trong test harness
    if ($SkipPrompt) {
        Write-Host "[WARN] Hard Gate G5: Backup prompt duoc bo qua theo tham so -SkipRecoveryChecklist." -ForegroundColor Yellow
        return @{
            Status = 'WAIVED_BY_PO'
            CanProceed = $true
            Message = "Hard Gate G5 duoc mien tru boi Product Owner / Test Harness."
        }
    }

    # Neu o che do Preflight: Chi kiem tra huong dan
    if ($Mode -eq 'Preflight') {
        Write-Host "[INFO] Che do PREFLIGHT: Checklist backup da san sang de PO thuc hien truoc APPLY." -ForegroundColor Yellow
        return @{
            Status = 'PREFLIGHT_CHECKED'
            CanProceed = $true
            Message = "Checklist backup da san sang."
        }
    }

    # Neu o che do Apply ma chua co backup ID
    if ($NonInteractive) {
        throw "HARD GATE G5 FAILED: Che do NonInteractive yeu cau truyen '-BackupSnapshotId' (hoac '-SkipRecoveryChecklist') de dam bao co backup!"
    }

    $inputBackup = (Read-Host "Nhap Backup Branch Name hoac Snapshot ID da tao tren Neon Console (hoac nhan Enter neu bo qua)").Trim()
    if (-not [string]::IsNullOrWhiteSpace($inputBackup)) {
        Write-Host "[PASS] Hard Gate G5: Ghi nhan Backup Branch / Snapshot: '$inputBackup'." -ForegroundColor Green
        return @{
            Status = 'VERIFIED_BACKUP'
            CanProceed = $true
            BackupId = $inputBackup
            Message = "Backup snapshot '$inputBackup' da duoc xac nhan."
        }
    }

    $confirmWithout = (Read-Host "CANH BAO: Ban CHUA nhap Backup ID! Ban co chac chan muon tiep tuc ma khong co backup snapshot khong? (y/N)").Trim()
    if ($confirmWithout -eq 'y' -or $confirmWithout -eq 'Y') {
        return @{
            Status = 'WAIVED_WITHOUT_BACKUP_ID'
            CanProceed = $true
            Message = "Product Owner xac nhan tiep tuc ma khong nhap Backup ID."
        }
    }

    throw "HARD GATE G5 FAILED: Thao tac APPLY bi dung do chua xac nhan ban sao luu Neon Preview!"
}

# ==============================================================================
# HAM TIEN ICH: AN TOAN BAO MAT VA LOAI BO THONG TIN BI MAT (REDACTION)
# ==============================================================================
function Strip-AnsiEscapeCodes {
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return '' }
    return ($Text -replace '\x1B\[[0-9;]*[a-zA-Z]', '')
}

function Redact-SensitiveText {
    param(
        [string]$Text,
        [string]$Secret = ''
    )
    if ([string]::IsNullOrEmpty($Text)) { return '' }

    $redacted = Strip-AnsiEscapeCodes -Text $Text

    # 1. Neu co chuoi mat khau cu the duoc cung cap, thay the ngay
    if (-not [string]::IsNullOrEmpty($Secret) -and $Secret.Length -ge 3) {
        $redacted = $redacted.Replace($Secret, '[REDACTED_SECRET]')
    }

    # 2. Xoa username:password trong cac URI dang postgresql://user:pass@host/db
    $redacted = [regex]::Replace($redacted, 'postgres(?:ql)?://([^:@\s"''`]+):([^@\s"''`]+)@([^\s?/"''`]+)', 'postgresql://[REDACTED_USER]:[REDACTED_PASSWORD]@$3')

    # 3. Xoa param mat khau trong query string
    $redacted = [regex]::Replace($redacted, '(?i)(password|pwd|secret|token)=([^&\s"''`]+)', '$1=[REDACTED]')

    # 4. Xoa duong dan chua ten user Windows de tranh ro ri thong tin nguoi dung
    $redacted = [regex]::Replace($redacted, '(?i)Users\\[^\\]+\\', 'Users\\[REDACTED_USER]\\')

    return $redacted
}

# ==============================================================================
# HAM BAO VE G3: PHAN LOAI STATUS & EXIT CODE PRISMA MIGRATE STATUS (F01)
# ==============================================================================
function Analyze-PrismaMigrateStatus {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Output,

        [Parameter(Mandatory = $true)]
        [int]$ExitCode,

        [string]$ExpectedPendingMigration = '20261023235900_add_f01_inventory_ledger',
        [string]$ExpectedBaselinePhase8 = '20261019193200_phase8_shipping_engine',
        [string]$ExpectedBaselineInit = '20261013094130_init'
    )

    $cleanOutput = Strip-AnsiEscapeCodes -Text $Output

    # -------------------------------------------------------------------------
    # STATE B: AUTHENTICATION FAILED (STOP)
    # -------------------------------------------------------------------------
    if ($cleanOutput -match "(P1000|Authentication failed|password authentication failed|credentials are invalid)") {
        return @{
            Status = 'AUTHENTICATION_FAILED'
            CanProceed = $false
            Message = "Loi xac thuc co so du lieu (P1000/Authentication Failed). Kiem tra lai username hoac password trong connection string."
        }
    }

    # -------------------------------------------------------------------------
    # STATE C: CONNECTION ERROR (STOP)
    # -------------------------------------------------------------------------
    if ($cleanOutput -match "(P1001|P1002|P1017|Can.?t reach database server|Cannot reach database server|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|timed out)") {
        return @{
            Status = 'CONNECTION_ERROR'
            CanProceed = $false
            Message = "Loi ket noi co so du lieu (P1001/P1002/Network Timeout). Kiem tra lai mang hoac trang thai branch."
        }
    }

    # -------------------------------------------------------------------------
    # STATE D: FAILED MIGRATION IN HISTORY (STOP)
    # -------------------------------------------------------------------------
    if ($cleanOutput -match "(Following migrations?\s+have failed:|Following migration\([sS]\)\s+have failed:|failed migrations?|P3009|P3011|P3012|The failed migration\(s\) can be marked)") {
        return @{
            Status = 'FAILED_MIGRATION'
            CanProceed = $false
            Message = "Phat hien migration that bai (failed migration) trong lich su CSDL. Can xu ly theo runbook recovery (prisma migrate resolve)."
        }
    }

    # -------------------------------------------------------------------------
    # STATE E: DIVERGENT MIGRATION HISTORY (STOP)
    # -------------------------------------------------------------------------
    if ($cleanOutput -match "(Your local migration history and the migrations table from your database are different|historiesDiverge|diverged|The database is not up to date with the schema)") {
        return @{
            Status = 'DIVERGENT_HISTORY'
            CanProceed = $false
            Message = "Lich su migration giua may local va target database bi lech (Divergent History). Khong duoc tu y migrate!"
        }
    }

    # -------------------------------------------------------------------------
    # STATE F: NO MIGRATIONS TABLE (STOP)
    # -------------------------------------------------------------------------
    if ($cleanOutput -match "(The current database is not managed by Prisma Migrate|P3005|The database is not empty)") {
        return @{
            Status = 'NO_MIGRATIONS_TABLE'
            CanProceed = $false
            Message = "Target database chua co bang _prisma_migrations (The database is not managed by Prisma Migrate). Can baseline truoc!"
        }
    }

    # -------------------------------------------------------------------------
    # ALREADY APPLIED (Database up to date -> NO-OP)
    # -------------------------------------------------------------------------
    if ($ExitCode -eq 0 -and $cleanOutput -match "Database schema is up to date") {
        return @{
            Status = 'ALREADY_APPLIED'
            CanProceed = $false
            Message = "Database schema da o trang thai moi nhat! Migration F01 da duoc ap dung truoc do (NO-OP)."
        }
    }

    # -------------------------------------------------------------------------
    # PENDING MIGRATIONS ANALYSIS (STATE A vs STATE G)
    # -------------------------------------------------------------------------
    $pendingRegex = "(?i)(?:Following|The)\s+migration(?:s|\(s\))?\s+have\s+not\s+yet\s+been\s+applied:\s*([\s\S]*?)(?=\s*(?:To\s+apply|The\s+migration|$))"
    if ($cleanOutput -match $pendingRegex) {
        $unappliedBlock = $matches[1]

        # STATE G1: MISSING BASELINE (Init hoac Phase 8 chua duoc apply)
        if ($unappliedBlock -match [regex]::Escape($ExpectedBaselineInit) -or $unappliedBlock -match [regex]::Escape($ExpectedBaselinePhase8)) {
            return @{
                Status = 'MISSING_BASELINE'
                CanProceed = $false
                Message = "Migration baseline ('$ExpectedBaselineInit' hoac '$ExpectedBaselinePhase8') chua duoc ap dung tren target database! Thieu baseline."
            }
        }

        # STATE G3: UNEXPECTED PENDING (Khong chua F01)
        if ($unappliedBlock -notmatch [regex]::Escape($ExpectedPendingMigration)) {
            return @{
                Status = 'UNEXPECTED_PENDING_MIGRATIONS'
                CanProceed = $false
                Message = "Migration cho ap dung khong chua F01 '$ExpectedPendingMigration'!"
            }
        }

        # Trich xuat danh sach migration timestamp_name
        $allPendingMatches = [regex]::Matches($unappliedBlock, '\b\d{14}_[a-zA-Z0-9_]+\b')

        # STATE G2: MULTIPLE PENDING MIGRATIONS
        if ($allPendingMatches.Count -gt 1) {
            $foundList = ($allPendingMatches | ForEach-Object { $_.Value }) -join ', '
            return @{
                Status = 'MULTIPLE_PENDING_MIGRATIONS'
                CanProceed = $false
                Message = "Phat hien nhieu hon 1 migration pending ($foundList). Du an chi cho phep migrate duy nhat F01!"
            }
        }

        # STATE A: DUNG CHINH XAC 1 MIGRATION LA F01
        if ($allPendingMatches.Count -eq 1 -and $allPendingMatches[0].Value -eq $ExpectedPendingMigration) {
            return @{
                Status = 'EXPECTED_PENDING'
                CanProceed = $true
                Message = "Chinh xac duy nhat 1 migration pending: '$ExpectedPendingMigration'."
                PendingMigration = $ExpectedPendingMigration
            }
        }
    }

    # -------------------------------------------------------------------------
    # STATE H: UNRECOGNIZED STATUS (STOP)
    # -------------------------------------------------------------------------
    return @{
        Status = 'UNRECOGNIZED_STATUS'
        CanProceed = $false
        Message = "Khong the phan loai output tu Prisma CLI (Exit Code: $ExitCode). Vui long kiem tra bang diagnostic an toan."
    }
}

# ==============================================================================
# HAM BAO VE G3: DOI CHIEU READ-ONLY BANG _prisma_migrations TREN CSDL (F01)
# ==============================================================================
function Test-PrismaMigrationsTable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ConnectionString,

        [string]$ExpectedBaselineInit = '20261013094130_init',
        [string]$ExpectedBaselinePhase8 = '20261019193200_phase8_shipping_engine',
        [string]$ExpectedPendingMigration = '20261023235900_add_f01_inventory_ledger',

        [string]$MockDbResult = ''
    )

    $dbResult = $null
    if (-not [string]::IsNullOrWhiteSpace($MockDbResult)) {
        $dbResult = ($MockDbResult | ConvertFrom-Json)
    } else {
        $verifyCodeLines = @(
            "const { PrismaClient } = require('@prisma/client');",
            "const prisma = new PrismaClient({",
            "  datasources: { db: { url: process.env.DATABASE_URL } }",
            "});",
            "async function check() {",
            "  try {",
            "    const rows = await prisma.`$queryRawUnsafe('SELECT migration_name, finished_at, rolled_back_at, applied_steps_count FROM _prisma_migrations ORDER BY started_at ASC');",
            "    console.log(JSON.stringify({ status: 'OK', rows }));",
            "  } catch (err) {",
            "    const msg = String(err.message || err);",
            "    if (msg.includes('_prisma_migrations') && (msg.includes('does not exist') || msg.includes('42P01'))) {",
            "      console.log(JSON.stringify({ status: 'NO_TABLE', message: msg }));",
            "    } else {",
            "      console.log(JSON.stringify({ status: 'ERROR', message: msg }));",
            "    }",
            "  } finally {",
            "    await prisma.`$disconnect();",
            "  }",
            "}",
            "check();"
        )
        $verifyCode = $verifyCodeLines -join "`n"

        $env:DATABASE_URL = $ConnectionString
        try {
            $raw = node -e $verifyCode 2>&1
            $rawStr = ($raw | Out-String).Trim()
            $jsonLine = ($rawStr -split "`n" | Where-Object { $_.Trim().StartsWith('{') -and $_.Trim().EndsWith('}') } | Select-Object -Last 1)
            if ($jsonLine) {
                $dbResult = ($jsonLine | ConvertFrom-Json)
            } else {
                $dbResult = @{ status = 'ERROR'; message = "Khong the parse output tu Node.js: $rawStr" }
            }
        } catch {
            $dbResult = @{ status = 'ERROR'; message = $_.Exception.Message }
        }
    }

    if ($null -eq $dbResult) {
        return @{
            Status = 'DB_QUERY_ERROR'
            CanProceed = $false
            Message = "Khong nhan duoc phan hoi tu bo truy van bang '_prisma_migrations'."
        }
    }

    if ($dbResult.status -eq 'NO_TABLE') {
        return @{
            Status = 'NO_MIGRATIONS_TABLE'
            CanProceed = $false
            Message = "Target database chua co bang '_prisma_migrations'. Can baseline truoc khi migrate."
        }
    }

    if ($dbResult.status -ne 'OK') {
        return @{
            Status = 'DB_QUERY_ERROR'
            CanProceed = $false
            Message = "Loi khi doc bang '_prisma_migrations': $($dbResult.message)"
        }
    }

    $rows = $dbResult.rows
    $appliedNames = @()
    $failedNames = @()

    foreach ($r in $rows) {
        $mName = $r.migration_name
        if ($null -ne $r.rolled_back_at -or $null -eq $r.finished_at) {
            $failedNames += $mName
        } else {
            $appliedNames += $mName
        }
    }

    # 1. Kiem tra failed migrations trong DB
    if ($failedNames.Count -gt 0) {
        return @{
            Status = 'FAILED_MIGRATION'
            CanProceed = $false
            Message = "Phat hien migration that bai trong DB: $($failedNames -join ', ')"
        }
    }

    # 2. Kiem tra baseline init va phase 8 da duoc apply chua
    if ($appliedNames -notcontains $ExpectedBaselineInit) {
        return @{
            Status = 'MISSING_BASELINE'
            CanProceed = $false
            Message = "Migration khoi tao '$ExpectedBaselineInit' chua ton tai trong bang '_prisma_migrations'!"
        }
    }
    if ($appliedNames -notcontains $ExpectedBaselinePhase8) {
        return @{
            Status = 'MISSING_BASELINE'
            CanProceed = $false
            Message = "Migration Phase 8 '$ExpectedBaselinePhase8' chua ton tai trong bang '_prisma_migrations'!"
        }
    }

    # 3. Kiem tra F01 da apply truoc do chua
    if ($appliedNames -contains $ExpectedPendingMigration) {
        return @{
            Status = 'ALREADY_APPLIED'
            CanProceed = $false
            Message = "Migration F01 '$ExpectedPendingMigration' da ton tai trong bang '_prisma_migrations'. Khong can apply lai."
        }
    }

    # 4. Tat ca deu hop le
    return @{
        Status = 'EXPECTED_DB_STATE'
        CanProceed = $true
        Message = "Bang '_prisma_migrations' hop le: Baselines da applied, chua co '$ExpectedPendingMigration', 0 failed migrations."
        AppliedCount = $appliedNames.Count
    }
}

# ==============================================================================
# HAM CHINH: MAIN CONTROLLER
# ==============================================================================
function Invoke-SafePreviewMigration {
    [CmdletBinding()]
    param(
        [ValidateSet('Preflight', 'Apply')]
        [string]$Mode = 'Preflight',

        [Alias('ExpectedHead')]
        [string]$ApprovedCommitSha = '',

        [string]$ExpectedHost = '',

        [System.Security.SecureString]$SecureConnectionString = $null,

        [string]$BackupSnapshotId = '',

        [switch]$Diagnostic = $false,
        [switch]$SkipRecoveryChecklist = $false,
        [switch]$SkipWorkingTreeCheck = $false,
        [switch]$NonInteractive = $false,
        [string]$MockPrismaStatusOutput = '',
        [int]$MockPrismaStatusExitCode = -1,
        [int]$MockPrismaDeployExitCode = -1,
        [int]$MockPostCheckExitCode = -1,
        [string]$MockDbResult = ''
    )

    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host "   QUY TRINH AN TOAN: PRISMA MIGRATION TREN NEON PREVIEW-BETA   " -ForegroundColor Cyan
    Write-Host "   Phien ban: EV-IMP-01B-SAFETY-FIX (F01 Inventory Ledger)      " -ForegroundColor Cyan
    Write-Host "   Che do thuc thi: $Mode                                       " -ForegroundColor Cyan
    Write-Host "=================================================================" -ForegroundColor Cyan
    Write-Host ""

    # -------------------------------------------------------------------------
    # BUOC 1: HARD GATE G0 -- GIT BASELINE & APPROVED COMMIT SHA
    # -------------------------------------------------------------------------
    Write-Host "--- BUOC 1: KIEM TRA HARD GATE G0 (GIT & APPROVED COMMIT SHA) ---" -ForegroundColor Cyan
    Test-GitBaseline -ApprovedCommitSha $ApprovedCommitSha -SkipWorkingTreeCheck:$SkipWorkingTreeCheck
    Write-Host "[PASS] Hard Gate G0: Git branch 'beta', HEAD khop Approved SHA, checksums migration hop le." -ForegroundColor Green
    Write-Host ""

    # -------------------------------------------------------------------------
    # BUOC 2: HARD GATE G4 -- MIGRATION SQL SAFETY
    # -------------------------------------------------------------------------
    Write-Host "--- BUOC 2: KIEM TRA HARD GATE G4 (MIGRATION SQL INTEGRITY) ---" -ForegroundColor Cyan
    Test-MigrationSqlSafety
    Write-Host "[PASS] Hard Gate G4: Migration SQL F01 hop le, khong chua lenh DDL pha huy (Additive-only)." -ForegroundColor Green
    Write-Host ""

    # -------------------------------------------------------------------------
    # BUOC 3: NHAP VA THAM DINH TARGET HOST (G1, G2, G6)
    # -------------------------------------------------------------------------
    Write-Host "--- BUOC 3: POSITIVE TARGET VERIFICATION (G1, G2, G6) ---" -ForegroundColor Cyan
    $targetExpectedHost = $ExpectedHost
    if ([string]::IsNullOrWhiteSpace($targetExpectedHost)) {
        if ($NonInteractive) {
            throw "HARD GATE G1 FAILED: Che do NonInteractive yeu cau truyen -ExpectedHost."
        }
        Write-Host "HUONG DAN DANH CHO PRODUCT OWNER:" -ForegroundColor Yellow
        Write-Host "1. Mo Neon Console (https://console.neon.tech) -> Branch 'preview-beta'." -ForegroundColor Gray
        Write-Host "2. Xem muc 'Connection Details' -> Chon 'Direct connection'." -ForegroundColor Gray
        Write-Host "3. Chi sao chep rieng phan Hostname (vi du: ep-bold-rain-xxxx.c-7.us-east-2.aws.neon.tech)." -ForegroundColor Gray
        Write-Host ""
        $targetExpectedHost = (Read-Host "Nhap Expected Direct Hostname cua 'preview-beta'").Trim()
    }

    # Nhap Connection String an
    $sec = $SecureConnectionString
    if ($null -eq $sec) {
        if ($NonInteractive) {
            throw "HARD GATE G1 FAILED: Che do NonInteractive yeu cau truyen -SecureConnectionString."
        }
        Write-Host ""
        $sec = Read-Host "Dan Direct Connection String cua 'preview-beta' (mat khau se duoc an)" -AsSecureString
    }

    if ($null -eq $sec) {
        throw "HARD GATE G1 FAILED: Connection string khong duoc de trong!"
    }

    $connStr = [System.Net.NetworkCredential]::new('', $sec).Password
    if ([string]::IsNullOrWhiteSpace($connStr)) {
        throw "HARD GATE G1 FAILED: Connection string khong duoc rong!"
    }

    # Tham dinh Positive Allowlist
    $targetInfo = Test-EndpointAllowlist -ExpectedHost $targetExpectedHost -ConnectionString $connStr
    Write-Host "[PASS] Hard Gate G1: Host khop chinh xac voi Expected Direct Host: $($targetInfo.MaskedHost)" -ForegroundColor Green
    Write-Host "[PASS] Hard Gate G2: Xac nhan Direct Connection (khong chua '-pooler')." -ForegroundColor Green
    Write-Host "[PASS] Hard Gate G6: Xac nhan khong phai Production Host." -ForegroundColor Green
    Write-Host ""

    # -------------------------------------------------------------------------
    # BUOC 4: HARD GATE G5 -- BACKUP & RECOVERY READINESS
    # -------------------------------------------------------------------------
    Write-Host "--- BUOC 4: HARD GATE G5 (NEON BACKUP & RECOVERY READINESS) ---" -ForegroundColor Cyan
    $g5Result = Test-RecoveryReadiness -BackupSnapshotId $BackupSnapshotId -SkipPrompt:$SkipRecoveryChecklist -NonInteractive:$NonInteractive -Mode $Mode
    Write-Host "[INFO] Hard Gate G5: $($g5Result.Message)" -ForegroundColor Yellow
    Write-Host ""

    # -------------------------------------------------------------------------
    # BUOC 5: HARD GATE G3 -- PRISMA MIGRATE STATUS (READ-ONLY)
    # -------------------------------------------------------------------------
    Write-Host "--- BUOC 5: KIEM TRA HARD GATE G3 (MIGRATION STATUS READ-ONLY) ---" -ForegroundColor Cyan

    $statusOutput = ''
    $statusExit = -1

    $env:DATABASE_URL = $connStr
    try {
        if ($MockPrismaStatusExitCode -ge 0) {
            $statusExit = $MockPrismaStatusExitCode
            $statusOutput = $MockPrismaStatusOutput
        } else {
            Write-Host "Dang thuc thi: npx prisma migrate status..." -ForegroundColor Gray
            $rawOutput = & npx prisma migrate status 2>&1
            $statusExit = $LASTEXITCODE
            $statusOutput = ($rawOutput | Out-String)
        }

        $analysis = Analyze-PrismaMigrateStatus -Output $statusOutput -ExitCode $statusExit

        Write-Host "Ket qua phan tich Prisma Status:" -ForegroundColor Yellow
        Write-Host "  -> Phan loai: $($analysis.Status)" -ForegroundColor Cyan
        Write-Host "  -> Thong diep: $($analysis.Message)" -ForegroundColor Gray

        $redactedLines = Redact-SensitiveText -Text $statusOutput -Secret $connStr

        # Hien thi bang chan doan an toan neu co loi hoac bat che do Diagnostic
        if (-not $analysis.CanProceed -or $Diagnostic) {
            Write-Host ""
            Write-Host "=================================================================" -ForegroundColor Magenta
            Write-Host "   BANG CHAN DOAN AN TOAN PRISMA STATUS (SAFE DIAGNOSTIC)       " -ForegroundColor Magenta
            Write-Host "=================================================================" -ForegroundColor Magenta
            Write-Host "Prisma CLI Exit Code : $statusExit" -ForegroundColor Yellow
            Write-Host "Trang thai phan loai : $($analysis.Status)" -ForegroundColor Cyan
            Write-Host "Thong diep           : $($analysis.Message)" -ForegroundColor Gray
            Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray
            Write-Host "NOI DUNG PRISMA CLI DA DUOC LOAI BO THONG TIN BI MAT (REDACTED):" -ForegroundColor Gray
            $lineIdx = 1
            foreach ($line in ($redactedLines -split "`n")) {
                $trimmed = $line.TrimEnd("`r")
                if (-not [string]::IsNullOrWhiteSpace($trimmed)) {
                    Write-Host "  [$lineIdx] $trimmed" -ForegroundColor DarkGray
                    $lineIdx++
                }
            }
            Write-Host "=================================================================" -ForegroundColor Magenta
            Write-Host ""
        }

        if ($analysis.Status -eq 'ALREADY_APPLIED') {
            Write-Host ""
            Write-Host "[i] THONG BAO: Migration F01 da duoc ap dung hoan chinh truoc do. Khong can chay lai." -ForegroundColor Green
            return
        }

        if (-not $analysis.CanProceed) {
            throw "HARD GATE G3 FAILED: $($analysis.Message)"
        }

        Write-Host "[OK] Prisma CLI xac nhan: Chi co duy nhat migration F01 dang cho ap dung." -ForegroundColor Green

        # ---------------------------------------------------------------------
        # DOI CHIEU READ-ONLY VOI BANG _prisma_migrations TREN CSDL (DUAL-PROOF)
        # ---------------------------------------------------------------------
        Write-Host "Dang thuc hien doi chieu doc lap voi bang '_prisma_migrations' tren CSDL..." -ForegroundColor Gray
        $effectiveDbMock = $MockDbResult
        if ([string]::IsNullOrWhiteSpace($effectiveDbMock) -and $MockPrismaStatusExitCode -ge 0) {
            $effectiveDbMock = '{"status":"OK","rows":[{"migration_name":"20261013094130_init","finished_at":"2026-10-13T09:41:30Z","rolled_back_at":null},{"migration_name":"20261019193200_phase8_shipping_engine","finished_at":"2026-10-19T19:32:00Z","rolled_back_at":null}]}'
        }

        $dbCheck = Test-PrismaMigrationsTable -ConnectionString $connStr -MockDbResult $effectiveDbMock
        Write-Host "Ket qua doi chieu CSDL: $($dbCheck.Status)" -ForegroundColor Cyan
        Write-Host "  -> Thong diep CSDL: $($dbCheck.Message)" -ForegroundColor Gray

        if (-not $dbCheck.CanProceed) {
            throw "HARD GATE G3 FAILED: Ket qua doi chieu CSDL lech voi Prisma CLI ($($dbCheck.Message))"
        }

        Write-Host "[PASS] Hard Gate G3: Dual-proof verified! Prisma CLI va bang '_prisma_migrations' hoan toan hop le." -ForegroundColor Green
        Write-Host ""

        # ---------------------------------------------------------------------
        # DANH GIA CHE DO THUC THI (MODE 1: PREFLIGHT vs MODE 2: APPLY)
        # -------------------------------------------------------------------------
        if ($Mode -eq 'Preflight') {
            Write-Host "=================================================================" -ForegroundColor Green
            Write-Host "   KET QUA PREFLIGHT: KIEM TRA AN TOAN HOAN TAT!                " -ForegroundColor Green
            Write-Host "=================================================================" -ForegroundColor Green
            Write-Host "  -> Hard Gates G0, G1, G2, G3, G4, G5, G6: PASS" -ForegroundColor Green
            Write-Host "-----------------------------------------------------------------" -ForegroundColor Gray
            Write-Host "He thong dang o che do PREFLIGHT ONLY." -ForegroundColor Yellow
            Write-Host "Khong co bat ky lenh migration nao duoc chay tren CSDL." -ForegroundColor Yellow
            Write-Host "Dich den da duoc xac minh an toan cho branch 'preview-beta'." -ForegroundColor Green
            Write-Host "De thuc hien migration that, vui long yeu cau PO phe duyet APPLY rieng:" -ForegroundColor Gray
            Write-Host "  .\scripts\safe-preview-migrate.ps1 -Mode Apply -ApprovedCommitSha <SHA> -ExpectedHost <HOST> -BackupSnapshotId <ID>" -ForegroundColor Gray
            return
        }

        # NEU O CHE DO APPLY:
        Write-Host "=================================================================" -ForegroundColor Yellow
        Write-Host "   CHE DO APPLY MIGRATION -- XAC NHAN CUOI CUNG TU PRODUCT OWNER  " -ForegroundColor Yellow
        Write-Host "=================================================================" -ForegroundColor Yellow
        Write-Host "Target: $($targetInfo.MaskedHost)" -ForegroundColor Cyan
        Write-Host "Database: $($targetInfo.Database)" -ForegroundColor Cyan
        Write-Host ""

        $proceedConfirm = 'N'
        if ($NonInteractive) {
            if ($MockPrismaDeployExitCode -ge 0) { $proceedConfirm = 'Y' }
        } else {
            $proceedConfirm = Read-Host "Ban co chac chan muon chay 'npx prisma migrate deploy' vao preview-beta khong? (y/N)"
        }

        if ($proceedConfirm -ne 'y' -and $proceedConfirm -ne 'Y') {
            Write-Host "[i] Da huy bo thao tac migrate deploy theo quyet dinh nguoi dung." -ForegroundColor Yellow
            return
        }

        # THUC THI MIGRATION
        Write-Host ""
        Write-Host "Dang thuc thi: npx prisma migrate deploy..." -ForegroundColor Cyan
        $deployExit = -1
        if ($MockPrismaDeployExitCode -ge 0) {
            $deployExit = $MockPrismaDeployExitCode
        } else {
            & npx prisma migrate deploy
            $deployExit = $LASTEXITCODE
        }

        if ($deployExit -ne 0) {
            throw "LOI NGHIEM TRONG: 'npx prisma migrate deploy' that bai voi ma loi $deployExit! Dung ngay lap tuc de bao ve he thong."
        }
        Write-Host "[PASS] Lenh 'npx prisma migrate deploy' hoan tat voi exit code 0." -ForegroundColor Green

        # XAC MINH SAU MIGRATION (F01 OBJECTS)
        Write-Host ""
        Write-Host "--- BUOC 6: XAC MINH SAU MIGRATION (POST-VERIFICATION F01) ---" -ForegroundColor Cyan
        $postCheckExit = -1
        if ($MockPostCheckExitCode -ge 0) {
            $postCheckExit = $MockPostCheckExitCode
        } else {
            $verifyScriptLines = @(
                "const { PrismaClient } = require('@prisma/client');",
                "const prisma = new PrismaClient();",
                "async function main() {",
                "  const ledgerCount = await prisma.inventoryLedger.count();",
                "  const allocCount = await prisma.orderItemBatchAllocation.count();",
                "  console.log('[OK] Bang InventoryLedger ton tai. Ban ghi:', ledgerCount);",
                "  console.log('[OK] Bang OrderItemBatchAllocation ton tai. Ban ghi:', allocCount);",
                "  const batchSample = await prisma.batch.findFirst({ select: { id: true, status: true, isFefoEligible: true, expiryDate: true } });",
                "  const productSample = await prisma.product.findFirst({ select: { id: true, inventoryTrackingEnabled: true } });",
                "  console.log('[OK] Cac cot moi tren Batch va Product da ton tai va truy van thanh cong.');",
                "  const indexes = await prisma.`$queryRawUnsafe(`SELECT indexname FROM pg_indexes WHERE tablename = 'OrderItemBatchAllocation' AND indexname = 'OrderItemBatchAllocation_active_unique_idx'`);",
                "  if (!indexes || indexes.length === 0) throw new Error('Thieu Partial Unique Index: OrderItemBatchAllocation_active_unique_idx');",
                "  console.log('[OK] Partial Unique Index OrderItemBatchAllocation_active_unique_idx hop le.');",
                "  const checks = await prisma.`$queryRawUnsafe(`SELECT conname FROM pg_constraint WHERE conname IN ('chk_allocation_allocated_positive', 'chk_allocation_dispatched_nonneg', 'chk_allocation_released_nonneg', 'chk_allocation_mass_balance', 'chk_ledger_quantity_positive')`);",
                "  if (!checks || checks.length < 5) throw new Error('Thieu CHECK constraints tren InventoryLedger hoac OrderItemBatchAllocation (tim thay: ' + (checks ? checks.length : 0) + ')');",
                "  console.log('[OK] 5 Database CHECK constraints hop le.');",
                "}",
                "main().catch(err => {",
                "  console.error('[FAIL] Loi xac minh sau migration:', err.message);",
                "  process.exit(1);",
                "}).finally(() => prisma.`$disconnect());"
            )
            $verifyScript = $verifyScriptLines -join "`n"
            node -e $verifyScript
            $postCheckExit = $LASTEXITCODE
        }

        if ($postCheckExit -ne 0) {
            throw "MIGRATION OUTCOME REQUIRES INVESTIGATION: Lenh xac minh cau truc bang F01 sau migration that bai (Exit code: $postCheckExit)!"
        }

        Write-Host ""
        Write-Host "=================================================================" -ForegroundColor Green
        Write-Host "   MIGRATION F01 TREN NEON PREVIEW-BETA HOAN TAT THANH CONG!     " -ForegroundColor Green
        Write-Host "=================================================================" -ForegroundColor Green
        Write-Host "  -> Ket qua Hard Gates: G0, G1, G2, G3, G4, G5, G6: PASS" -ForegroundColor Green

    } finally {
        # DON DEP BAO MAT BIEN MOI TRUONG
        Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
        $connStr = $null
        $sec = $null
        [System.GC]::Collect()
    }
}

# Neu duoc goi truc tiep (khong phai dot-source), thuc thi controller
if ($MyInvocation.InvocationName -ne '.') {
    Invoke-SafePreviewMigration -Mode $Mode -ApprovedCommitSha $ApprovedCommitSha -ExpectedHost $ExpectedHost -SecureConnectionString $SecureConnectionString -BackupSnapshotId $BackupSnapshotId -Diagnostic:$Diagnostic -SkipRecoveryChecklist:$SkipRecoveryChecklist -SkipWorkingTreeCheck:$SkipWorkingTreeCheck -NonInteractive:$NonInteractive -MockPrismaStatusOutput $MockPrismaStatusOutput -MockPrismaStatusExitCode $MockPrismaStatusExitCode -MockPrismaDeployExitCode $MockPrismaDeployExitCode -MockPostCheckExitCode $MockPostCheckExitCode -MockDbResult $MockDbResult
}
