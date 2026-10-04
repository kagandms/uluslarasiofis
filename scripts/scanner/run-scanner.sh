#!/usr/bin/env bash
set -euo pipefail

# ClamAV runner starter script for uluslarasiofis
export SCANNER_ORIGIN="${SCANNER_ORIGIN:-https://goc-staging.topkapiuni.workers.dev}"
export SCANNER_RUNNER_ID="${SCANNER_RUNNER_ID:-macbook-runner-1}"
export SCANNER_STATE_DIR="${SCANNER_STATE_DIR:-$HOME/.local/share/uluslarasiofis-scanner}"
export SCANNER_DATABASE_DIR="${SCANNER_DATABASE_DIR:-$SCANNER_STATE_DIR/signatures}"
export SCANNER_CERTS_DIR="${SCANNER_CERTS_DIR:-/opt/homebrew/etc/clamav/certs}"
export SCANNER_CLAMSCAN="${SCANNER_CLAMSCAN:-/opt/homebrew/bin/clamscan}"
export SCANNER_FRESHCLAM="${SCANNER_FRESHCLAM:-/opt/homebrew/bin/freshclam}"
export SCANNER_SECRET_FILE="${SCANNER_SECRET_FILE:-$SCANNER_STATE_DIR/scanner.secret}"

VENV_PYTHON="$SCANNER_STATE_DIR/venv/bin/python"

if [[ ! -x "$VENV_PYTHON" ]]; then
    echo "Python venv not found at $VENV_PYTHON. Please check $SCANNER_STATE_DIR/venv." >&2
    exit 1
fi

if [[ ! -f "$SCANNER_SECRET_FILE" ]]; then
    echo "Scanner secret file not found at $SCANNER_SECRET_FILE." >&2
    exit 1
fi

echo "Starting ClamAV scanner runner connecting to $SCANNER_ORIGIN..."
exec "$VENV_PYTHON" scripts/scanner/runner.py "$@"
