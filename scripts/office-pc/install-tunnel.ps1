<#
.SYNOPSIS
    Puts the Cloudflare tunnel token in place and starts the svc-cloudflared service.
.DESCRIPTION
    DRAFT (2026-11-13), not yet run on any machine. Run install-storage.ps1 first. Use -DryRun first.
    The token file (created from the Cloudflare dashboard, never pasted into chat) is moved to
    C:\Goc\cloudflared\tunnel.token, readable only by SYSTEM, Administrators and the service account.
    The service is switched to automatic start only after the token exists, because a connector without
    a token crash-loops. If the old office PC still runs the same tunnel, stop its svc-cloudflared first.
.PARAMETER TokenFile
    Path of the file that contains only the tunnel token (one line). It is moved, not copied.
#>
param(
    [Parameter(Mandatory = $true)][string]$TokenFile,
    [string]$GocRoot = 'C:\Goc',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$admins = '*S-1-5-32-544'
$system = '*S-1-5-18'

function Invoke-Step([string]$Text, [scriptblock]$Action) {
    if ($DryRun) { Write-Host ("DRY  " + $Text); return }
    Write-Host ("RUN  " + $Text)
    & $Action
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Run this script in an elevated PowerShell.' }
if (-not (Get-Service -Name 'svc-cloudflared' -ErrorAction SilentlyContinue)) { throw 'svc-cloudflared is not installed; run install-storage.ps1 first.' }
if (-not (Test-Path -LiteralPath $TokenFile)) { throw ('Token file not found: ' + $TokenFile) }
if ((Get-Item -LiteralPath $TokenFile).Length -lt 50) { throw 'The token file looks too short to be a tunnel token.' }

$destination = Join-Path $GocRoot 'cloudflared\tunnel.token'
Invoke-Step 'move the token file into place (content is not read or printed)' { Move-Item -LiteralPath $TokenFile -Destination $destination -Force }
Invoke-Step 'restrict the token file: svc-cloudflared read, SYSTEM and Administrators full' {
    & icacls.exe $destination /inheritance:r | Out-Null
    & icacls.exe $destination /grant:r ($system + ':F') ($admins + ':F') 'NT SERVICE\svc-cloudflared:R' | Out-Null
}
Invoke-Step 'switch svc-cloudflared to automatic start and start it' {
    & sc.exe config 'svc-cloudflared' start= auto | Out-Host
    Start-Service -Name 'svc-cloudflared'
}
Invoke-Step 'check that the service stays running' {
    Start-Sleep -Seconds 10
    $svc = Get-Service -Name 'svc-cloudflared'
    if ($svc.Status -ne 'Running') { throw 'svc-cloudflared is not running. Check C:\Goc\logs\svc-cloudflared.err.log.' }
    Write-Host 'OK   svc-cloudflared is running. Confirm "Healthy" for the tunnel in the Cloudflare dashboard.'
}
Write-Host 'Delete every other copy of the token file (USB drive, downloads) now.'
