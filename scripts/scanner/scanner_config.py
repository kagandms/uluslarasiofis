from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping
from urllib.parse import urlsplit

@dataclass(frozen=True)
class ScannerConfig:
    origin: str
    secret: str
    runner_id: str
    state_directory: Path
    database_directory: Path
    certificates_directory: Path
    clamscan: str
    freshclam: str
    freshclam_config: Path
    ca_file: str | None
    scan_timeout_seconds: int
    application_ids: tuple[str, ...] = ()
    idle_poll_seconds: int = 10
    active_poll_seconds: int = 3
    active_window_seconds: int = 180


def _read_bounded_int(
    settings: Mapping[str, str],
    key: str,
    default: int,
    minimum: int,
    maximum: int,
    error_code: str,
) -> int:
    """Parse and range-check an integer setting; raises ValueError with error_code on invalid input."""
    raw = settings.get(key, str(default))
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(error_code) from exc
    if not minimum <= value <= maximum:
        raise ValueError(error_code)
    return value


def read_secret(secret_path: Path) -> str:
    """Read a private secret file; raises ValueError for unsafe permissions/content."""
    if secret_path.is_symlink():
        raise ValueError('secret_file_invalid')
    if os.name != 'nt' and secret_path.stat().st_mode & 0o077:
        raise ValueError('secret_file_permissions')
    secret = secret_path.read_text().strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{43,128}', secret):
        raise ValueError('secret_file_invalid')
    return secret


def load_config(settings: Mapping[str, str]) -> ScannerConfig:
    """Load portable environment config; raises ValueError for invalid authority/paths."""
    origin = settings.get('SCANNER_ORIGIN', '')
    parsed_origin = urlsplit(origin)
    if parsed_origin.scheme != 'https' or not parsed_origin.hostname:
        raise ValueError('SCANNER_ORIGIN requires HTTPS')
    if parsed_origin.username or parsed_origin.password or parsed_origin.query or parsed_origin.fragment or parsed_origin.path not in ('', '/'):
        raise ValueError('SCANNER_ORIGIN requires an origin only')
    runner_id = settings.get('SCANNER_RUNNER_ID', '')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', runner_id):
        raise ValueError('runner_id_invalid')
    state = Path(settings['SCANNER_STATE_DIR']).resolve()
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name != 'nt' and state.stat().st_mode & 0o077:
        raise ValueError('state_directory_permissions')
    timeout = _read_bounded_int(settings, 'SCANNER_SCAN_TIMEOUT_SECONDS', 120, 1, 120, 'scan_timeout_invalid')
    idle_poll = _read_bounded_int(settings, 'SCANNER_IDLE_POLL_SECONDS', 10, 2, 120, 'idle_poll_invalid')
    active_poll = _read_bounded_int(settings, 'SCANNER_ACTIVE_POLL_SECONDS', 3, 1, 30, 'active_poll_invalid')
    active_window = _read_bounded_int(settings, 'SCANNER_ACTIVE_WINDOW_SECONDS', 180, 0, 900, 'active_window_invalid')
    raw_application_ids = settings.get('SCANNER_APPLICATION_IDS', '')
    application_ids = tuple(value.strip() for value in raw_application_ids.split(',') if value.strip())
    if len(application_ids) > 50 or len(set(application_ids)) != len(application_ids) or any(
        not re.fullmatch(r'[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}', value, re.IGNORECASE)
        for value in application_ids
    ):
        raise ValueError('application_scope_invalid')
    secret = read_secret(Path(settings['SCANNER_SECRET_FILE']))
    return ScannerConfig(origin.rstrip('/'), secret, runner_id, state,
        Path(settings.get('SCANNER_DATABASE_DIR', str(state / 'signatures'))),
        Path(settings.get('SCANNER_CERTS_DIR', str(Path(__file__).parent / 'certs'))),
        settings.get('SCANNER_CLAMSCAN', 'clamscan'),
        settings.get('SCANNER_FRESHCLAM', 'freshclam'), state / 'freshclam.conf', settings.get('SCANNER_CA_FILE'), timeout,
        application_ids, idle_poll, active_poll, active_window)
