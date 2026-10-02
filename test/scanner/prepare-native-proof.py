"""Prepare a private, isolated LOCAL acceptance harness; never executes migrations or deploys."""
from __future__ import annotations

import json
import logging
import os
import secrets
import subprocess
from pathlib import Path

LOGGER = logging.getLogger(__name__)


def write_configuration(repository: Path, directory: Path) -> None:
    """Write local-only Wrangler inputs and synthetic secrets; raises on a remote binding."""
    configuration = json.loads((repository / 'wrangler.jsonc').read_text())
    configuration.pop('env')
    for binding in configuration['d1_databases'] + configuration['r2_buckets']:
        if binding.get('remote') is not False:
            raise ValueError('remote_binding_rejected')
    configuration['main'] = str(repository / 'test/scanner/native-worker-probe.js')
    configuration['assets']['directory'] = str(repository / 'dist/client')
    configuration['d1_databases'][0]['migrations_dir'] = str(repository / 'migrations')
    (directory / 'wrangler.json').write_text(json.dumps(configuration))
    secret = secrets.token_urlsafe(32)
    bootstrap_token = secrets.token_urlsafe(32)
    (directory / 'secret').write_text(secret)
    (directory / 'staff-bootstrap-token').write_text(bootstrap_token)
    (directory / '.dev.vars').write_text('SCANNER_SECRET=' + secret + '\nR2_ACCOUNT_ID=' + 'a' * 32
        + '\nR2_ACCESS_KEY_ID=synthetic-native-key\nR2_SECRET_ACCESS_KEY=synthetic-native-secret\n'
        + 'STAFF_SHARED_USERNAME=integration-native-reviewer\nSTAFF_BOOTSTRAP_TOKEN=' + bootstrap_token + '\n')


def create_certificate(directory: Path) -> None:
    """Generate one-day loopback TLS material in the private proof directory."""
    completed = subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout',
        str(directory / 'key.pem'), '-out', str(directory / 'cert.pem'), '-days', '1', '-subj', '/CN=localhost',
        '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], capture_output=True, timeout=30, check=False)
    if completed.returncode:
        raise RuntimeError('certificate_setup_failed')


def main() -> int:
    """Prepare a new owned directory, refusing reuse; return a redacted status."""
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    os.umask(0o077)
    try:
        repository = Path(__file__).resolve().parents[2]
        directory = Path(os.environ['NATIVE_PROOF_DIR']).resolve()
        if directory.parent != repository / '.wrangler':
            raise ValueError('owned_private_directory_required')
        directory.mkdir(mode=0o700, exist_ok=False)
        write_configuration(repository, directory)
        create_certificate(directory)
        state = Path(os.environ['SCANNER_REAL_STATE']).resolve()
        completed = subprocess.run([str(state / 'venv/bin/python'), 'scripts/scanner/create_fixtures.py',
            str(directory / 'fixtures')], cwd=repository, capture_output=True, timeout=30, check=False)
        if completed.returncode:
            raise RuntimeError('fixture_setup_failed')
        LOGGER.info('native_proof_prepared; local-only config and private synthetic credentials')
        return 0
    except Exception as error:
        LOGGER.error('native_proof_setup_failed type=%s', type(error).__name__)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
