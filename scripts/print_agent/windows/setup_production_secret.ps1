[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# Depo kokunden calistirin; betik, kurulum klasorune (.venv ve scripts\print_agent bulunan yer) gider.
Set-Location (Resolve-Path (Join-Path $PSScriptRoot "..\..\.."))

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Topkapi Print Agent v7 - Production Secret Kurulumu" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# Check if secret is already in clipboard
$secretToTest = ""
try {
    $clip = Get-Clipboard
    if ($clip -and $clip.Trim().Length -ge 43 -and $clip.Trim().Length -le 128) {
        Write-Host "-> Panoda (Clipboard) gecerli uzunlukta secret algilandi." -ForegroundColor Green
        $secretToTest = $clip.Trim()
    }
} catch {}

if ([string]::IsNullOrWhiteSpace($secretToTest)) {
    Write-Host "Lutfen Production PRINTER_SECRET degerini giriniz (maskeli / gizli):" -ForegroundColor Yellow
    Write-Host "IPUCU: Secret'i kopyaladiysaniz SAG TIKLAYARAK yapistirabilir veya dogrudan Enter'a basabilirsiniz." -ForegroundColor DarkGray
    $secureSecret = Read-Host -Prompt "PRINTER_SECRET" -AsSecureString
    if ($null -ne $secureSecret) {
        $secretToTest = [System.Net.NetworkCredential]::new('', $secureSecret).Password
    }
}

if ([string]::IsNullOrWhiteSpace($secretToTest)) {
    Write-Host "HATA: Secret degeri bos olamaz." -ForegroundColor Red
    exit 1
}

Write-Host "Production Worker (https://goc.topkapiuni.workers.dev) ile dogrulaniyor..." -ForegroundColor Yellow

$env:TEMP_SECRET_TEST = $secretToTest
$valOutput = .\.venv\Scripts\python.exe -c @"
import sys, os, json, urllib.request, urllib.error
from pathlib import Path
sys.path.insert(0, 'scripts/print_agent')
import print_agent, secure_credentials

secret = os.environ.get('TEMP_SECRET_TEST', '')
config = print_agent.AgentConfig(
    base_url='https://goc.topkapiuni.workers.dev',
    secret=secret,
    printer_id='office-printer-01',
    runner_id='office-runner-01',
    printer_name='Uluslararası Ofis'
)
api = print_agent.PrintApi(config)
try:
    res = api.json('/api/printer/heartbeat', {
        'health': 'ready',
        'printer_id': config.printer_id,
        'printer_name': config.printer_name,
        'runner_id': config.runner_id,
        'settings_protocol': 3,
    })
    # If heartbeat succeeds, store encrypted with DPAPI
    secure_credentials.save_secret_dpapi(secret)
    print(json.dumps({'success': True, 'response': res}))
except urllib.error.HTTPError as e:
    print(json.dumps({'success': False, 'error': f'HTTP {e.code} ({e.reason})'}))
except Exception as e:
    print(json.dumps({'success': False, 'error': str(e)}))
"@

$env:TEMP_SECRET_TEST = $null
$secretToTest = $null
try { Set-Clipboard -Value "" } catch {}
[System.GC]::Collect()

$val = $valOutput | ConvertFrom-Json
if ($val.success) {
    Write-Host "-> TEBRIKLER: Production kimlik dogrulamasi BASARILI!" -ForegroundColor Green
    Write-Host "-> Secret, Windows DPAPI ile guvenli sekilde sifrelenerek kaydedildi." -ForegroundColor Green
    Write-Host "-> Pano ve gecici bellek temizlendi." -ForegroundColor Green
    exit 0
} else {
    Write-Host "HATA: Production kimlik dogrulamasi basarisiz oldu: $($val.error)" -ForegroundColor Red
    Write-Host "Lutfen Cloudflare Worker goc icin tanimlanan dogru PRINTER_SECRET degerini girdiginizden emin olunuz." -ForegroundColor Yellow
    exit 1
}
