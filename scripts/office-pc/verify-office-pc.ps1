<#
.SYNOPSIS
    Read-only health and security check for the office document PC (storage, tunnel, scanner, print agent).
.DESCRIPTION
    DRAFT (2026-11-13), not yet validated on a second machine. It changes nothing, reads no secret
    values and prints no keys or tokens. Run it in an elevated PowerShell for the full set of checks;
    without elevation the checks that need it are reported as SKIP.
    Output text is ASCII on purpose so that it renders correctly in Windows PowerShell 5.1.
.PARAMETER GocRoot
    Root folder of the office setup (default C:\Goc).
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\verify-office-pc.ps1
#>
param([string]$GocRoot = 'C:\Goc')

$ErrorActionPreference = 'Continue'
$results = New-Object System.Collections.Generic.List[object]
function Add-Result([string]$Status, [string]$Area, [string]$Detail) {
    $results.Add([pscustomobject]@{ Status = $Status; Area = $Area; Detail = $Detail }) | Out-Null
}
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Add-Result 'INFO' 'session' ("elevated=" + $isAdmin)

# --- Operating system and patches ---------------------------------------------------------
try {
    $os = Get-CimInstance Win32_OperatingSystem
    Add-Result 'INFO' 'os' ("{0} build {1}" -f $os.Caption, $os.BuildNumber)
    $latest = Get-HotFix -ErrorAction Stop | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1
    if ($latest) {
        $age = [int]((Get-Date) - $latest.InstalledOn).TotalDays
        $status = if ($age -gt 120) { 'FAIL' } elseif ($age -gt 45) { 'WARN' } else { 'PASS' }
        Add-Result $status 'patches' ("latest hotfix {0} installed {1} days ago" -f $latest.HotFixID, $age)
    } else { Add-Result 'WARN' 'patches' 'no hotfix with an install date found' }
} catch { Add-Result 'WARN' 'patches' 'could not read hotfix list' }

foreach ($name in 'wuauserv', 'UsoSvc', 'BITS') {
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if (-not $svc) { Add-Result 'FAIL' 'windows-update' ("service {0} is missing (renamed or removed)" -f $name) }
    elseif ($svc.StartType -eq 'Disabled') { Add-Result 'FAIL' 'windows-update' ("service {0} is disabled" -f $name) }
    else { Add-Result 'PASS' 'windows-update' ("service {0} start type {1}" -f $name, $svc.StartType) }
}
$wuPolicy = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate'
if (Test-Path $wuPolicy) {
    $wsus = (Get-ItemProperty -Path $wuPolicy -ErrorAction SilentlyContinue).WUServer
    if ($wsus) { Add-Result 'WARN' 'windows-update' 'a WSUS server policy is set (check that it is intended)' }
}

# --- Signs of tampering seen on the previous office PC -------------------------------------
try {
    $ifeo = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options'
    $hijacked = @(Get-ChildItem $ifeo -ErrorAction Stop | Where-Object { (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).Debugger } | ForEach-Object { $_.PSChildName })
    if ($hijacked.Count -gt 0) { Add-Result 'FAIL' 'tampering' ("IFEO Debugger entries block or redirect: {0}" -f ($hijacked -join ', ')) }
    else { Add-Result 'PASS' 'tampering' 'no IFEO Debugger entries' }
} catch { Add-Result 'WARN' 'tampering' 'could not read IFEO keys' }

$runSuspicious = @()
foreach ($key in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run') {
    if (-not (Test-Path $key)) { continue }
    $props = Get-ItemProperty -Path $key
    foreach ($p in $props.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' }) {
        if ([string]$p.Value -match '(?i)\\AppData\\Roaming\\|\\ProgramData\\|\\Temp\\') { $runSuspicious += $p.Name }
    }
}
if ($runSuspicious.Count -gt 0) { Add-Result 'WARN' 'startup' ("Run entries starting from AppData/ProgramData/Temp: {0} (review each)" -f ($runSuspicious -join ', ')) }
else { Add-Result 'PASS' 'startup' 'no Run entry starts from AppData, ProgramData or Temp' }

# --- Defender, firewall, disk encryption ---------------------------------------------------
try {
    $mp = Get-MpComputerStatus -ErrorAction Stop
    Add-Result ($(if ($mp.RealTimeProtectionEnabled) { 'PASS' } else { 'FAIL' })) 'defender' ("real-time protection enabled = {0}" -f $mp.RealTimeProtectionEnabled)
    $sigAge = [int]((Get-Date) - $mp.AntivirusSignatureLastUpdated).TotalDays
    Add-Result ($(if ($sigAge -gt 7) { 'FAIL' } elseif ($sigAge -gt 2) { 'WARN' } else { 'PASS' })) 'defender' ("signatures updated {0} days ago" -f $sigAge)
} catch { Add-Result 'FAIL' 'defender' 'Defender status could not be read (service stopped or disabled by policy)' }
$defPolicy = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender'
if (Test-Path $defPolicy) {
    $dp = Get-ItemProperty -Path $defPolicy -ErrorAction SilentlyContinue
    if ($dp.DisableAntiSpyware -eq 1 -or $dp.DisableAntiVirus -eq 1) { Add-Result 'FAIL' 'defender' 'a policy disables Defender' }
}
try {
    foreach ($fw in Get-NetFirewallProfile -ErrorAction Stop) {
        Add-Result ($(if ($fw.Enabled) { 'PASS' } else { 'FAIL' })) 'firewall' ("profile {0} enabled = {1}" -f $fw.Name, $fw.Enabled)
    }
} catch { Add-Result 'WARN' 'firewall' 'could not read firewall profiles' }
if ($isAdmin) {
    try {
        $bl = Get-BitLockerVolume -MountPoint 'C:' -ErrorAction Stop
        Add-Result ($(if ($bl.ProtectionStatus -eq 'On') { 'PASS' } else { 'WARN' })) 'bitlocker' ("C: protection = {0}" -f $bl.ProtectionStatus)
    } catch { Add-Result 'WARN' 'bitlocker' 'could not read BitLocker status' }
} else { Add-Result 'SKIP' 'bitlocker' 'needs an elevated session' }

# --- Power and sign-in ---------------------------------------------------------------------
try {
    foreach ($setting in 'STANDBYIDLE', 'HIBERNATEIDLE') {
        $hex = [regex]::Matches((powercfg /query SCHEME_CURRENT SUB_SLEEP $setting | Out-String), '0x[0-9a-fA-F]{8}') | ForEach-Object { $_.Value }
        if ($hex.Count -ge 2) {
            $ac = [Convert]::ToInt64($hex[$hex.Count - 2], 16)
            Add-Result ($(if ($ac -eq 0) { 'PASS' } else { 'WARN' })) 'power' ("{0} on AC = {1} seconds (0 means never)" -f $setting, $ac)
        }
    }
} catch { Add-Result 'WARN' 'power' 'could not read the power plan' }
$logon = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -ErrorAction SilentlyContinue
Add-Result 'INFO' 'sign-in' ("AutoAdminLogon = {0} (the scanner and print agent start only after a user signs in)" -f $logon.AutoAdminLogon)

# --- Storage and tunnel --------------------------------------------------------------------
foreach ($name in 'svc-gocdepo', 'svc-cloudflared') {
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if (-not $svc) { Add-Result 'FAIL' 'services' ("{0} is not installed" -f $name); continue }
    $ok = ($svc.Status -eq 'Running' -and $svc.StartType -eq 'Automatic')
    Add-Result ($(if ($ok) { 'PASS' } else { 'FAIL' })) 'services' ("{0}: {1}, start type {2}" -f $name, $svc.Status, $svc.StartType)
}
try {
    $exposed = @()
    foreach ($conn in Get-NetTCPConnection -State Listen -ErrorAction Stop) {
        if ($conn.LocalAddress -in '127.0.0.1', '::1') { continue }
        $proc = (Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue).ProcessName
        if ($proc -match '^(weed|cloudflared)') { $exposed += ("{0}:{1} ({2})" -f $conn.LocalAddress, $conn.LocalPort, $proc) }
    }
    if ($exposed.Count -gt 0) { Add-Result 'FAIL' 'ports' ("storage or tunnel listens beyond loopback: {0}" -f ($exposed -join ', ')) }
    else { Add-Result 'PASS' 'ports' 'weed and cloudflared listen on loopback only' }
} catch { Add-Result 'WARN' 'ports' 'could not list listening ports' }
try {
    $status = 0
    try { $status = [int](Invoke-WebRequest -Uri 'http://127.0.0.1:9000/' -UseBasicParsing -TimeoutSec 5).StatusCode }
    catch { if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode } }
    Add-Result ($(if ($status -eq 403) { 'PASS' } else { 'FAIL' })) 's3' ("unauthenticated GET http://127.0.0.1:9000/ returned {0} (403 expected)" -f $status)
} catch { Add-Result 'FAIL' 's3' 'local S3 endpoint is not reachable' }
$tokenFile = Join-Path $GocRoot 'cloudflared\tunnel.token'
Add-Result ($(if ((Test-Path $tokenFile) -and ((Get-Item $tokenFile -ErrorAction SilentlyContinue).Length -gt 0)) { 'PASS' } else { 'WARN' })) 'tunnel' 'tunnel.token file present (content not read)'

# --- Folder permissions (names only, no file content) --------------------------------------
foreach ($folder in 'storage', 'config', 'cloudflared') {
    $path = Join-Path $GocRoot $folder
    if (-not (Test-Path $path)) { Add-Result 'WARN' 'acl' ("{0} does not exist" -f $path); continue }
    try {
        $acl = (icacls $path 2>&1) -join "`n"
        if ($acl -match 'Access is denied|Erisim engellendi') { Add-Result 'SKIP' 'acl' ("{0}: not readable from this session" -f $path) }
        elseif ($acl -match '(?i)Everyone|BUILTIN\\Users|Authenticated Users') { Add-Result 'FAIL' 'acl' ("{0} is open to Everyone, Users or Authenticated Users" -f $path) }
        else { Add-Result 'PASS' 'acl' ("{0} is not open to broad groups" -f $path) }
    } catch { Add-Result 'WARN' 'acl' ("could not read ACL of {0}" -f $path) }
}

# --- Disk and agents -----------------------------------------------------------------------
$drive = Get-PSDrive -Name C -ErrorAction SilentlyContinue
if ($drive) {
    $freeGb = [math]::Round($drive.Free / 1GB, 1)
    Add-Result ($(if ($freeGb -lt 20) { 'WARN' } else { 'PASS' })) 'disk' ("C: free space {0} GB" -f $freeGb)
}
try {
    $cmd = (Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction Stop | ForEach-Object { $_.CommandLine }) -join "`n"
    Add-Result ($(if ($cmd -match 'daemon\.py') { 'PASS' } else { 'WARN' })) 'scanner' 'scanner daemon process (daemon.py) running'
    Add-Result ($(if ($cmd -match 'print_agent|run_production_agent') { 'PASS' } else { 'WARN' })) 'print-agent' 'print agent process running'
} catch { Add-Result 'WARN' 'agents' 'could not list processes' }

# --- Report --------------------------------------------------------------------------------
$results | Format-Table Status, Area, Detail -AutoSize -Wrap
$fail = @($results | Where-Object Status -eq 'FAIL').Count
$warn = @($results | Where-Object Status -eq 'WARN').Count
Write-Host ("Summary: {0} FAIL, {1} WARN, {2} PASS" -f $fail, $warn, @($results | Where-Object Status -eq 'PASS').Count)
if ($fail -gt 0) { exit 1 }
