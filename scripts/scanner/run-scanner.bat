@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ===================================================
echo   Istanbul Topkapi Universitesi - ClamAV Runner
echo ===================================================

:: Default target: staging (or passed as argument %1)
if "%~1"=="" (
    set "SCANNER_ORIGIN=https://goc-staging.topkapiuni.workers.dev"
) else (
    set "SCANNER_ORIGIN=%~1"
)

set "SCANNER_RUNNER_ID=okul-pc-runner-1"
set "SCANNER_STATE_DIR=%USERPROFILE%\.uluslarasiofis-scanner"
set "SCANNER_DATABASE_DIR=%SCANNER_STATE_DIR%\signatures"
set "SCANNER_SECRET_FILE=%SCANNER_STATE_DIR%\scanner.secret"

:: Add default ClamAV installation path to PATH if present
if exist "C:\Program Files\ClamAV" (
    set "PATH=C:\Program Files\ClamAV;%PATH%"
)

:: Check Python
where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [HATA] Python bulunamadi!
    echo Lutfen python.org adresinden Python 3.11 veya 3.12 indirip kurun.
    echo Kurulum yaparken "Add python.exe to PATH" kutucugunu mutlaka isaretleyin.
    pause
    exit /b 1
)

:: Ensure state and signatures directories exist
if not exist "%SCANNER_STATE_DIR%" mkdir "%SCANNER_STATE_DIR%"
if not exist "%SCANNER_DATABASE_DIR%" mkdir "%SCANNER_DATABASE_DIR%"

:: Check secret file
if not exist "%SCANNER_SECRET_FILE%" (
    echo [HATA] scanner.secret dosyasi bulunamadi!
    echo Konum: %SCANNER_SECRET_FILE%
    echo.
    echo Lutfen Mac'inizdeki scanner.secret dosyasini bu klasore kopyalayin:
    echo %SCANNER_STATE_DIR%
    pause
    exit /b 1
)

:: Install required python packages if not installed
python -c "import pypdf, PIL" >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [BILGI] Gerekli Python paketleri yukleniyor...
    python -m pip install -r scripts\scanner\requirements.txt
)

:: Generate freshclam.conf if not present
if not exist "%SCANNER_STATE_DIR%\freshclam.conf" (
    (
        echo DatabaseDirectory %SCANNER_DATABASE_DIR%
        echo DatabaseMirror database.clamav.net
        echo Checks 12
        echo ScriptedUpdates yes
    ) > "%SCANNER_STATE_DIR%\freshclam.conf"
)

:: Check if signatures exist
if not exist "%SCANNER_DATABASE_DIR%\daily.cvd" if not exist "%SCANNER_DATABASE_DIR%\daily.cld" (
    echo [BILGI] Ilk calisma: Virus imzalari indiriliyor (bu birkac dakika surebilir)...
    freshclam --config-file="%SCANNER_STATE_DIR%\freshclam.conf"
)

echo.
echo [BASARILI] Tarayici baslatiliyor...
echo Hedef Sunucu: %SCANNER_ORIGIN%
echo Runner ID:    %SCANNER_RUNNER_ID%
echo.

python scripts\scanner\runner.py
pause
