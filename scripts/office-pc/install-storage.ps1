<#
.SYNOPSIS
    Installs the encrypted document store (SeaweedFS S3 on 127.0.0.1:9000) as a Windows service.
.DESCRIPTION
    DRAFT (2026-11-13): written from the reports of the first office PC, NOT yet run on any machine.
    Run it first with -DryRun, in an elevated Windows PowerShell 5.1, on a CLEAN machine that passes
    verify-office-pc.ps1. It never downloads anything: you pass files that you downloaded from the
    official release pages, together with the SHA-256 values published there; a mismatch stops it.
    It creates C:\Goc, services svc-gocdepo and svc-cloudflared (the tunnel service is installed but
    left on manual start until a token exists; see install-tunnel.ps1), two S3 identities
    (an admin identity for this machine and a Worker identity limited to one bucket), and the bucket.
    Generated keys are written only to files protected by ACLs; nothing secret is printed.
    The Worker identity is saved to C:\Goc\config\worker-s3.txt (Administrators only) so that the owner can
    copy the two values into the Worker secrets by hand.
.PARAMETER WeedZip
    SeaweedFS windows_amd64 zip from the official release page.
.PARAMETER WinSwExe
    WinSW-x64.exe from the official release page (used as the service wrapper).
.PARAMETER CloudflaredExe
    cloudflared.exe for Windows amd64 from the official release page.
.EXAMPLE
    .\install-storage.ps1 -WeedZip .\windows_amd64.zip -WeedZipSha256 <hex> -WinSwExe .\WinSW-x64.exe -WinSwSha256 <hex> -CloudflaredExe .\cloudflared.exe -CloudflaredSha256 <hex> -DryRun
#>
param(
    [Parameter(Mandatory = $true)][string]$WeedZip,
    [Parameter(Mandatory = $true)][string]$WeedZipSha256,
    [Parameter(Mandatory = $true)][string]$WinSwExe,
    [Parameter(Mandatory = $true)][string]$WinSwSha256,
    [Parameter(Mandatory = $true)][string]$CloudflaredExe,
    [Parameter(Mandatory = $true)][string]$CloudflaredSha256,
    [string]$GocRoot = 'C:\Goc',
    [string]$Bucket = 'documents',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$admins = '*S-1-5-32-544'
$system = '*S-1-5-18'
$users = '*S-1-5-32-545'

function Invoke-Step([string]$Text, [scriptblock]$Action) {
    if ($DryRun) { Write-Host ("DRY  " + $Text); return }
    Write-Host ("RUN  " + $Text)
    & $Action
}

function Assert-Hash([string]$Path, [string]$Expected) {
    if (-not (Test-Path -LiteralPath $Path)) { throw ("File not found: " + $Path) }
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    if ($actual -ne $Expected.Trim().ToUpperInvariant()) { throw ("SHA-256 mismatch for " + $Path + ". Stopping.") }
    Write-Host ("OK   sha256 verified: " + $Path)
}

function Set-StrictAcl([string]$Path, [string[]]$Grants) {
    & icacls.exe $Path /inheritance:r | Out-Null
    foreach ($grant in $Grants) { & icacls.exe $Path /grant:r $grant | Out-Null }
}

function New-RandomString([int]$Length, [string]$Alphabet) {
    $bytes = New-Object byte[] $Length
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $chars = foreach ($b in $bytes) { $Alphabet[$b % $Alphabet.Length] }
    return -join $chars
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-S3Status([string]$Url) {
    try { return [int](Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5).StatusCode }
    catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } else { return 0 } }
}

# ---- Preconditions ------------------------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Run this script in an elevated PowerShell.' }
Assert-Hash $WeedZip $WeedZipSha256
Assert-Hash $WinSwExe $WinSwSha256
Assert-Hash $CloudflaredExe $CloudflaredSha256

$bin = Join-Path $GocRoot 'bin'
$config = Join-Path $GocRoot 'config'
$storage = Join-Path $GocRoot 'storage'
$logs = Join-Path $GocRoot 'logs'
$tunnelDir = Join-Path $GocRoot 'cloudflared'

# ---- Folders and binaries -----------------------------------------------------------------
foreach ($dir in @($GocRoot, $bin, $config, $storage, $logs, $tunnelDir)) {
    Invoke-Step ("create folder " + $dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
}
Invoke-Step 'extract weed.exe from the zip' {
    $tmp = Join-Path $env:TEMP ('weed-' + [guid]::NewGuid().ToString('N'))
    Expand-Archive -LiteralPath $WeedZip -DestinationPath $tmp -Force
    $weed = Get-ChildItem -Path $tmp -Recurse -Filter 'weed.exe' | Select-Object -First 1
    if (-not $weed) { throw 'weed.exe was not found in the zip.' }
    Copy-Item -LiteralPath $weed.FullName -Destination (Join-Path $bin 'weed.exe') -Force
    Remove-Item -LiteralPath $tmp -Recurse -Force
}
Invoke-Step 'copy cloudflared.exe' { Copy-Item -LiteralPath $CloudflaredExe -Destination (Join-Path $bin 'cloudflared.exe') -Force }
foreach ($name in @('svc-gocdepo', 'svc-cloudflared')) {
    Invoke-Step ("copy the service wrapper as " + $name + ".exe") { Copy-Item -LiteralPath $WinSwExe -Destination (Join-Path $bin ($name + '.exe')) -Force }
}

# ---- Service definitions (same as the first office PC) ------------------------------------
$depotXml = @"
<service>
  <id>svc-gocdepo</id>
  <name>Topkapi Goc Belge Deposu (S3)</name>
  <description>Local S3-compatible document store (127.0.0.1:9000, $storage)</description>
  <executable>$bin\weed.exe</executable>
  <arguments>server -dir="$storage" -ip=127.0.0.1 -ip.bind=127.0.0.1 -master.telemetry=false -filer=true -s3=true -s3.port=9000 -s3.ip.bind=127.0.0.1 -s3.port.iceberg=0 -s3.port.lance=0 -s3.config="$config\s3.json"</arguments>
  <workingdirectory>$storage</workingdirectory>
  <logpath>$logs</logpath>
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>5</keepFiles></log>
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="5 sec"/>
</service>
"@
$tunnelXml = @"
<service>
  <id>svc-cloudflared</id>
  <name>Topkapi Goc Cloudflare Tunnel (cloudflared)</name>
  <description>Cloudflare Tunnel connector; token is read from a file, never from the command line</description>
  <executable>$bin\cloudflared.exe</executable>
  <arguments>tunnel --no-autoupdate run --token-file "$tunnelDir\tunnel.token"</arguments>
  <workingdirectory>$tunnelDir</workingdirectory>
  <logpath>$logs</logpath>
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>5</keepFiles></log>
  <startmode>Automatic</startmode>
  <onfailure action="restart" delay="5 sec"/>
</service>
"@
Invoke-Step 'write the two service XML files' {
    Write-Utf8NoBom (Join-Path $bin 'svc-gocdepo.xml') $depotXml
    Write-Utf8NoBom (Join-Path $bin 'svc-cloudflared.xml') $tunnelXml
}

# ---- S3 identities (generated here, never printed) ----------------------------------------
$base32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
$alnum = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
$adminAccess = 'GOCA' + (New-RandomString 16 $base32)
$adminSecret = New-RandomString 40 $alnum
$workerAccess = 'GOCW' + (New-RandomString 16 $base32)
$workerSecret = New-RandomString 40 $alnum
$s3Config = [ordered]@{ identities = @(
        [ordered]@{ name = 'gocdepo-local'; credentials = @([ordered]@{ accessKey = $adminAccess; secretKey = $adminSecret }); actions = @('Admin', 'Read', 'Write', 'List', 'Tagging') },
        [ordered]@{ name = 'goc-worker'; credentials = @([ordered]@{ accessKey = $workerAccess; secretKey = $workerSecret }); actions = @(('Read:' + $Bucket), ('Write:' + $Bucket), ('List:' + $Bucket)) }
    ) }
Invoke-Step 'write s3.json (identities) and worker-s3.txt (owner copies the Worker values into Worker secrets)' {
    Write-Utf8NoBom (Join-Path $config 's3.json') ($s3Config | ConvertTo-Json -Depth 10)
    $workerText = "S3_ENDPOINT=http://127.0.0.1:9000`r`nS3_REGION=us-east-1`r`nS3_BUCKET=$Bucket`r`nS3_ACCESS_KEY_ID=$workerAccess`r`nS3_SECRET_ACCESS_KEY=$workerSecret`r`n"
    Write-Utf8NoBom (Join-Path $config 'worker-s3.txt') $workerText
}

# ---- Services, then ACLs (the NT SERVICE accounts only resolve after the service exists) --
foreach ($name in @('svc-gocdepo', 'svc-cloudflared')) {
    Invoke-Step ("install service " + $name + " with a virtual service account") {
        & (Join-Path $bin ($name + '.exe')) install | Out-Host
        & sc.exe config $name obj= ("NT SERVICE\" + $name) | Out-Host
        & sc.exe sidtype $name unrestricted | Out-Host
    }
}
Invoke-Step 'keep svc-cloudflared on manual start until a tunnel token exists' { & sc.exe config 'svc-cloudflared' start= demand | Out-Host }
Invoke-Step 'apply folder and file permissions' {
    Set-StrictAcl $GocRoot @(($system + ':(OI)(CI)F'), ($admins + ':(OI)(CI)F'), ($users + ':(OI)(CI)RX'))
    Set-StrictAcl $bin @(($system + ':(OI)(CI)F'), ($admins + ':(OI)(CI)F'), ($users + ':(OI)(CI)RX'))
    Set-StrictAcl $storage @(($system + ':(OI)(CI)F'), ($admins + ':(OI)(CI)F'), ('NT SERVICE\svc-gocdepo:(OI)(CI)F'))
    Set-StrictAcl $logs @(($system + ':(OI)(CI)F'), ($admins + ':(OI)(CI)F'), ('NT SERVICE\svc-gocdepo:(OI)(CI)M'), ('NT SERVICE\svc-cloudflared:(OI)(CI)M'))
    Set-StrictAcl $tunnelDir @(($system + ':(OI)(CI)F'), ($admins + ':(OI)(CI)F'), ('NT SERVICE\svc-cloudflared:(OI)(CI)RX'))
    Set-StrictAcl $config @(($system + ':(OI)(CI)F'), ($admins + ':(OI)(CI)F'), ('NT SERVICE\svc-gocdepo:(RX)'))
    # s3.json: readable only by the store's own service account (and SYSTEM); an administrator cannot read it.
    Set-StrictAcl (Join-Path $config 's3.json') @(($system + ':F'), ('NT SERVICE\svc-gocdepo:R'))
    Set-StrictAcl (Join-Path $config 'worker-s3.txt') @(($admins + ':F'))
}

# ---- Start the store and create the bucket ------------------------------------------------
Invoke-Step 'start svc-gocdepo' { Start-Service -Name 'svc-gocdepo' }
Invoke-Step 'wait for the local S3 endpoint (an unauthenticated request must be refused with 403)' {
    $status = 0
    for ($i = 0; $i -lt 30 -and $status -ne 403; $i++) { Start-Sleep -Seconds 2; $status = Get-S3Status 'http://127.0.0.1:9000/' }
    if ($status -ne 403) { throw ("S3 endpoint did not answer 403 (last status " + $status + ").") }
}
Invoke-Step ("create bucket '" + $Bucket + "' with the admin identity") {
    $cfg = Join-Path $env:TEMP ('s3req-' + [guid]::NewGuid().ToString('N') + '.cfg')
    $lines = @('url = "http://127.0.0.1:9000/' + $Bucket + '"', ('user = "' + $adminAccess + ':' + $adminSecret + '"'), 'aws-sigv4 = "aws:amz:us-east-1:s3"', 'request = "PUT"')
    Write-Utf8NoBom $cfg ($lines -join "`n")
    try {
        $code = (& curl.exe -s -o NUL -w '%{http_code}' -K $cfg)
        if ($code -ne '200' -and $code -ne '409') { throw ("Bucket creation returned HTTP " + $code) }
        Write-Host ("OK   bucket request answered " + $code + " (409 means it already existed)")
    } finally { Remove-Item -LiteralPath $cfg -Force -ErrorAction SilentlyContinue }
}

Write-Host ''
Write-Host 'Done. Next steps:'
Write-Host ' 1. Run verify-office-pc.ps1 (look for FAIL lines).'
Write-Host (' 2. Copy the two Worker S3 values from ' + (Join-Path $config 'worker-s3.txt') + ' into the Worker secrets by hand (never into chat or the repo).')
Write-Host ' 3. Create or reuse the Cloudflare tunnel, save its token file on this PC, then run install-tunnel.ps1.'
Write-Host ' 4. Create the Workers VPC service (HTTP, 127.0.0.1, port 9000) if this is a new tunnel.'
