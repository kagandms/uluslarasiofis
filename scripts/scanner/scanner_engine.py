from __future__ import annotations

import logging
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from scanner_config import ScannerConfig

LOGGER = logging.getLogger(__name__)
POLICY_VERSION = 'clamav-full-v1'
MAX_BYTES = 10 * 1024 * 1024

@dataclass(frozen=True)
class Signature:
    version: str
    updated_at: datetime

@dataclass(frozen=True)
class ScanVerdict:
    outcome: str
    code: str
    full_scan: bool = False

@dataclass(frozen=True)
class EngineHealth:
    health: str
    engine_version: str | None = None
    signature: Signature | None = None


def read_signature(database_directory: Path, now: datetime) -> Signature:
    """Read daily CVD/CLD build time, never filesystem mtime; raises ValueError if stale."""
    daily = next((database_directory / name for name in ('daily.cld', 'daily.cvd') if (database_directory / name).exists()), None)
    if daily is None:
        raise ValueError('signature_stale')
    with daily.open('rb') as signature_file:
        fields = signature_file.read(512).decode('ascii', errors='strict').strip().split(':')
    if len(fields) != 9 or fields[0] != 'ClamAV-VDB' or not fields[2].isdigit():
        raise ValueError('signature_stale')
    updated_at = datetime.fromtimestamp(int(fields[8]), timezone.utc)
    age_seconds = (now - updated_at).total_seconds()
    if not 0 <= age_seconds <= 86400:
        raise ValueError('signature_stale')
    return Signature(fields[2], updated_at)


def read_engine_health(config: ScannerConfig) -> EngineHealth:
    """Check installed engine and signature identity; returns a safe degraded state on error."""
    try:
        signature = read_signature(config.database_directory, datetime.now(timezone.utc))
        for component in ('main', 'bytecode'):
            if not any((config.database_directory / f'{component}.{suffix}').exists() for suffix in ('cvd', 'cld')):
                return EngineHealth('engine_unavailable')
        completed = subprocess.run([config.clamscan, f'--cvdcertsdir={config.certificates_directory}',
            f'--database={config.database_directory}', '--version'], capture_output=True, text=True, timeout=10, check=False)
        version_match = re.fullmatch(r'ClamAV ([\w.+-]+)/([0-9]+)/[^\n]+\n?', completed.stdout)
        if completed.returncode != 0 or completed.stderr.strip() or not version_match or version_match[2] != signature.version:
            return EngineHealth('engine_unavailable')
        return EngineHealth('ready', version_match[1], signature)
    except ValueError:
        LOGGER.warning('engine_health_degraded code=signature_stale')
        return EngineHealth('signature_stale')
    except (OSError, subprocess.TimeoutExpired):
        LOGGER.warning('engine_health_degraded code=engine_unavailable')
        return EngineHealth('engine_unavailable')


def classify_scan(exit_code: int, stdout: str, stderr: str) -> ScanVerdict:
    """Classify bounded ClamAV output; missing evidence, limits and encryption never return clean."""
    policy_markers = ('Heuristics.Limits.', 'Heuristics.Encrypted.', 'Heuristics.Broken.')
    if any(marker in stdout for marker in policy_markers):
        return ScanVerdict('failed', 'policy_blocked')
    if stderr.strip() or re.search(r'\b(?:WARNING|ERROR|SKIPPED)\b', stdout, re.IGNORECASE):
        return ScanVerdict('failed', 'scan_error')
    if exit_code == 1 and re.search(r' FOUND\s*$', stdout, re.MULTILINE):
        return ScanVerdict('unsafe', 'malware')
    if exit_code == 0 and re.search(r'^Scanned files:\s+1\s*$', stdout, re.MULTILINE) and re.search(r'^Infected files:\s+0\s*$', stdout, re.MULTILINE):
        return ScanVerdict('clean', 'scanned', True)
    return ScanVerdict('failed', 'scan_error')


def build_scan_command(config: ScannerConfig, document_path: Path) -> list[str]:
    """Build an explicit fail-closed policy with soft timeouts disabled and a parent wall timeout."""
    return [config.clamscan, f'--database={config.database_directory}',
        f'--cvdcertsdir={config.certificates_directory}', f'--tempdir={document_path.parent}',
        '--official-db-only=yes', '--disable-cache', '--scan-pdf=yes', '--scan-image=yes',
        '--alert-exceeds-max=yes', '--alert-encrypted=yes', '--alert-broken=yes', '--alert-broken-media=yes',
        '--max-filesize=11M', '--max-scansize=100M', '--max-files=1000', '--max-recursion=16',
        '--max-scantime=0', '--max-embeddedpe=100M', '--max-htmlnormalize=100M', '--max-htmlnotags=100M',
        '--max-scriptnormalize=100M', '--pcre-max-filesize=100M', '--bytecode-timeout=60000', str(document_path)]


def scan_document(config: ScannerConfig, document_path: Path) -> ScanVerdict:
    """Scan exactly one private file; raises no raw engine diagnostics or document names."""
    try:
        completed = subprocess.run(build_scan_command(config, document_path), capture_output=True,
            text=True, timeout=config.scan_timeout_seconds, check=False)
        verdict = classify_scan(completed.returncode, completed.stdout, completed.stderr)
        if verdict.outcome == 'failed':
            LOGGER.warning('scan_failed code=%s', verdict.code)
        return verdict
    except subprocess.TimeoutExpired:
        LOGGER.warning('scan_failed code=scan_timeout')
        return ScanVerdict('failed', 'scan_timeout')
    except OSError:
        LOGGER.warning('scan_failed code=engine_unavailable')
        return ScanVerdict('failed', 'engine_unavailable')
