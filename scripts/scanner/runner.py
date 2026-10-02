from __future__ import annotations

import argparse
import logging
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from scanner_config import ScannerConfig, load_config
from scanner_engine import EngineHealth, POLICY_VERSION, ScanVerdict, read_engine_health, scan_document
from scanner_job import ScanJob, parse_job
from scanner_transport import Download, ScannerTransport

LOGGER = logging.getLogger(__name__)
STOP_EVENT = threading.Event()

@dataclass(frozen=True)
class JobEvidence:
    health: EngineHealth
    verdict: ScanVerdict
    download: Download | None


def format_time(timestamp: datetime) -> str:
    """Format a timezone-aware UTC timestamp for the job protocol."""
    return timestamp.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def make_heartbeat(config: ScannerConfig, health: EngineHealth) -> dict[str, object]:
    """Serialize safe engine health to a transport DTO, excluding paths and credentials."""
    return {'runner_id': config.runner_id, 'health': health.health, 'engine_version': health.engine_version,
        'signature_version': health.signature.version if health.signature else None,
        'signature_updated_at': format_time(health.signature.updated_at) if health.signature else None}


def make_result(job: ScanJob, evidence: JobEvidence) -> dict[str, object]:
    """Serialize exact-job scan evidence; never include filenames, engine output or credentials."""
    return {'file_id': job.file_id, 'revision_id': job.revision_id, 'storage_key': job.storage_key,
        'byte_size': job.byte_size, 'object_etag': evidence.download.etag if evidence.download else None,
        'sha256': evidence.download.sha256 if evidence.download else None, 'outcome': evidence.verdict.outcome,
        'result_code': evidence.verdict.code, 'engine_version': evidence.health.engine_version,
        'signature_version': evidence.health.signature.version if evidence.health.signature else None,
        'signature_updated_at': format_time(evidence.health.signature.updated_at) if evidence.health.signature else None,
        'scanned_at': format_time(datetime.now(timezone.utc)), 'full_scan': evidence.verdict.full_scan,
        'policy_version': POLICY_VERSION}


def validate_document(document_path: Path, media_type: str) -> bool:
    """Run the document parser in a child process with a hard 20-second timeout."""
    try:
        completed = subprocess.run([sys.executable, str(Path(__file__).with_name('validate_content.py')),
            str(document_path), media_type], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20, check=False)
        return completed.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        LOGGER.warning('validation_failed code=unsupported_content')
        return False


def clean_crash_residue(temporary_root: Path) -> None:
    """Delete only private job directories older than one hour; active jobs have <=300-second leases."""
    temporary_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if temporary_root.is_symlink():
        raise ValueError('temporary_directory_invalid')
    cutoff = time.time() - 3600
    for job_directory in temporary_root.glob('job-*'):
        if job_directory.is_symlink():
            job_directory.unlink()
            continue
        if job_directory.is_dir() and job_directory.stat().st_mtime < cutoff:
            shutil.rmtree(job_directory)


def execute_job(config: ScannerConfig, transport: ScannerTransport, job: ScanJob) -> JobEvidence:
    """Download, scan and validate one job; always remove private temporary files."""
    health = read_engine_health(config)
    if health.health != 'ready':
        return JobEvidence(health, ScanVerdict('failed', health.health), None)
    try:
        download = transport.download(job)
    except Exception:
        LOGGER.warning('job_failed code=download_failed')
        return JobEvidence(health, ScanVerdict('failed', 'download_failed'), None)
    with tempfile.TemporaryDirectory(prefix='job-', dir=config.state_directory / 'tmp') as directory:
        document_path = Path(directory) / 'document'
        descriptor = os.open(document_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, 'wb') as document_file:
            document_file.write(download.content)
        verdict = scan_document(config, document_path)
        if verdict.outcome == 'clean' and not validate_document(document_path, job.media_type):
            verdict = ScanVerdict('failed', 'unsupported_content')
        after_health = read_engine_health(config)
        if after_health != health:
            verdict = ScanVerdict('failed', 'signature_stale')
        return JobEvidence(health, verdict, download)


def update_signatures(config: ScannerConfig) -> bool:
    """Update official signatures without exposing subprocess diagnostics in runner logs."""
    try:
        completed = subprocess.run([config.freshclam, f'--config-file={config.freshclam_config}'],
            capture_output=True, text=True, timeout=180, check=False)
        if completed.returncode != 0 or 'ERROR' in completed.stdout or 'ERROR' in completed.stderr:
            LOGGER.warning('signature_update_failed')
            return False
        LOGGER.info('signature_update_complete')
        return True
    except (OSError, subprocess.TimeoutExpired):
        LOGGER.warning('signature_update_failed')
        return False


def run_once(config: ScannerConfig, transport: ScannerTransport) -> bool:
    """Heartbeat then claim at most one job; degraded engines never claim fresh work."""
    health = read_engine_health(config)
    transport.request('heartbeat', make_heartbeat(config, health))
    if health.health != 'ready':
        return False
    job = parse_job(transport.request('claim', {'runner_id': config.runner_id}))
    if job is None:
        return False
    evidence = execute_job(config, transport, job)
    transport.request(f'jobs/{job.id}/result', make_result(job, evidence), job.lease_token)
    LOGGER.info('scan_result_recorded outcome=%s code=%s', evidence.verdict.outcome, evidence.verdict.code)
    return True


def run_loop(config: ScannerConfig, transport: ScannerTransport) -> None:
    """Poll durable jobs at concurrency one; network loss leaves authority in D1 until retry."""
    next_update = 0.0
    while not STOP_EVENT.is_set():
        try:
            if time.monotonic() >= next_update:
                next_update = time.monotonic() + 7200
                if not update_signatures(config):
                    next_update = 0.0
                    transport.request('heartbeat', make_heartbeat(config, EngineHealth('update_failed')))
                    STOP_EVENT.wait(60)
                    continue
            clean_crash_residue(config.state_directory / 'tmp')
            has_job = run_once(config, transport)
            if not has_job:
                STOP_EVENT.wait(30)
        except Exception:
            LOGGER.warning('runner_iteration_failed; lease_retry_remains_in_D1')
            STOP_EVENT.wait(30)


def parse_options() -> argparse.Namespace:
    """Parse local operator actions; returns the selected CLI options."""
    parser = argparse.ArgumentParser(description='Private outbound-only document scanner')
    parser.add_argument('--once', action='store_true', help='One job; signatures must already be updated')
    parser.add_argument('--status', action='store_true', help='Read safe queue health')
    parser.add_argument('--update', action='store_true', help='Update signatures then exit')
    return parser.parse_args()


def run_selected_action(config: ScannerConfig, options: argparse.Namespace) -> int:
    """Run the requested action; returns zero only when the local operation completed."""
    transport = ScannerTransport(config)
    clean_crash_residue(config.state_directory / 'tmp')
    if options.update:
        return 0 if update_signatures(config) else 1
    if options.status:
        LOGGER.info('scanner_status %s', transport.request('status'))
        return 0
    if options.once:
        run_once(config, transport)
        return 0
    run_loop(config, transport)
    return 0


def main() -> int:
    """Run portable CLI; returns a redacted failure and handles stop signals without leaking secrets."""
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    signal.signal(signal.SIGTERM, lambda *_: STOP_EVENT.set())
    signal.signal(signal.SIGINT, lambda *_: STOP_EVENT.set())
    try:
        return run_selected_action(load_config(os.environ), parse_options())
    except Exception:
        LOGGER.error('runner_stopped; check_private_configuration_and_engine')
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
