from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCANNER_DIRECTORY = Path(__file__).resolve().parents[2] / 'scripts' / 'scanner'
sys.path.insert(0, str(SCANNER_DIRECTORY))

class RunnerContractTests(unittest.TestCase):
    def test_runner_module_exists(self) -> None:
        self.assertTrue((SCANNER_DIRECTORY / 'scanner_engine.py').exists())

    def test_clean_requires_complete_summary_and_errors_never_become_clean(self) -> None:
        from scanner_engine import classify_scan
        summary = 'Engine version: 1.5.4\nScanned files: 1\nInfected files: 0\n'

        self.assertEqual(classify_scan(0, summary, '').outcome, 'clean')
        self.assertEqual(classify_scan(0, '', '').outcome, 'failed')
        self.assertEqual(classify_scan(0, summary, 'WARNING: skipped').outcome, 'failed')
        self.assertEqual(classify_scan(2, summary, '').outcome, 'failed')
        self.assertEqual(classify_scan(1, 'Heuristics.Limits.Exceeded.MaxScanSize FOUND', '').code, 'policy_blocked')
        self.assertEqual(classify_scan(1, 'Heuristics.Encrypted.PDF FOUND', '').outcome, 'failed')
        self.assertEqual(classify_scan(1, 'Win.Test.EICAR_HDB-1 FOUND', '').outcome, 'unsafe')

    def test_signature_freshness_uses_build_time_not_touch_time(self) -> None:
        from scanner_engine import read_signature
        now = datetime.now(timezone.utc)
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / 'daily.cvd'
            database_path.write_bytes(f'ClamAV-VDB:date:28141:1:90:hash:signature:builder:{int((now-timedelta(days=2)).timestamp())}'.encode().ljust(512, b' '))

            with self.assertRaisesRegex(ValueError, 'signature_stale'):
                read_signature(Path(directory), now)

    def test_config_rejects_http_and_secrets_cannot_enter_error_output(self) -> None:
        from scanner_config import load_config
        with tempfile.TemporaryDirectory() as directory:
            secret_path = Path(directory) / 'secret'
            secret_path.write_text('s' * 43)
            secret_path.chmod(0o600)
            settings = {'SCANNER_ORIGIN': 'http://localhost:9999', 'SCANNER_SECRET_FILE': str(secret_path),
                        'SCANNER_STATE_DIR': directory, 'SCANNER_RUNNER_ID': 'mac'}

            with self.assertRaisesRegex(ValueError, 'HTTPS'):
                load_config(settings)

    def test_download_requires_exact_size_and_expected_hash(self) -> None:
        from scanner_transport import verify_download
        import hashlib
        expected_hash = hashlib.sha256(b'file').hexdigest()

        verify_download(b'file', 4, expected_hash)
        with self.assertRaisesRegex(ValueError, 'content_mismatch'):
            verify_download(b'fil', 4, expected_hash)
        with self.assertRaisesRegex(ValueError, 'content_mismatch'):
            verify_download(b'xxxx', 4, expected_hash)

class RunnerFailureTests(unittest.TestCase):
    def test_update_failure_is_retried_before_claim_when_heartbeat_also_fails(self) -> None:
        from unittest.mock import Mock, patch
        from runner import run_loop
        class StopAfterTwoIterations:
            def __init__(self) -> None:
                self.wait_count = 0
            def is_set(self) -> bool:
                return self.wait_count >= 2
            def wait(self, _seconds: int) -> None:
                self.wait_count += 1
        transport = Mock()
        transport.request.side_effect = ConnectionError('synthetic network outage')

        with patch('runner.STOP_EVENT', StopAfterTwoIterations()), patch('runner.update_signatures', return_value=False) as update, patch('runner.run_once', return_value=False) as scan, patch('runner.clean_crash_residue'):
            run_loop(Mock(), transport)

        self.assertEqual(update.call_count, 2)
        scan.assert_not_called()

    def test_engine_missing_and_timeout_cannot_return_clean(self) -> None:
        from unittest.mock import patch
        import subprocess
        from scanner_config import ScannerConfig
        from scanner_engine import scan_document
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = ScannerConfig('https://example.invalid', 's' * 43, 'mac', root, root, root,
                                   '/missing/scanner', 'freshclam', root / 'freshclam.conf', None, 120)
            (root / 'document').write_bytes(b'file')

            self.assertEqual(scan_document(config, root / 'document').code, 'engine_unavailable')
            with patch('scanner_engine.subprocess.run', side_effect=subprocess.TimeoutExpired('clamscan', 120)):
                self.assertEqual(scan_document(config, root / 'document').code, 'scan_timeout')

    def test_crash_cleanup_removes_only_old_job_directories(self) -> None:
        import os
        import time
        from runner import clean_crash_residue
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old_job, active_job, unrelated = root / 'job-old', root / 'job-active', root / 'operator-notes'
            for entry in (old_job, active_job, unrelated):
                entry.mkdir()
                (entry / 'document').write_bytes(b'synthetic')
            os.utime(old_job, (time.time() - 7200, time.time() - 7200))

            clean_crash_residue(root)

            self.assertFalse(old_job.exists())
            self.assertTrue(active_job.exists())
            self.assertTrue(unrelated.exists())

    def test_private_files_are_removed_after_an_engine_error(self) -> None:
        from unittest.mock import patch
        from scanner_config import ScannerConfig
        from scanner_engine import EngineHealth, ScanVerdict, Signature
        from scanner_job import ScanJob
        from scanner_transport import Download
        from runner import execute_job
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'tmp').mkdir()
            config = ScannerConfig('https://example.invalid', 's' * 43, 'mac', root, root, root,
                                   'clamscan', 'freshclam', root / 'freshclam.conf', None, 120)
            job = ScanJob('j', 'f', 'r', 'quarantine/'+'0'*36, 4, 'application/pdf', '2999-01-01T00:00:00Z', 'a'*64)
            class Transport:
                def download(self, _job: ScanJob) -> Download:
                    return Download(b'file', 'a'*64, 'etag')
            healthy = EngineHealth('ready', '1.5.4', Signature('1', datetime.now(timezone.utc)))
            with patch('runner.read_engine_health', return_value=healthy), patch('runner.scan_document', return_value=ScanVerdict('failed', 'scan_error')):
                evidence = execute_job(config, Transport(), job)

            self.assertEqual(evidence.verdict.outcome, 'failed')
            self.assertEqual(list((root / 'tmp').iterdir()), [])

class SignatureCompletenessTests(unittest.TestCase):
    def test_partial_signature_database_is_not_ready_even_when_version_command_succeeds(self) -> None:
        from unittest.mock import patch
        import subprocess
        from scanner_config import ScannerConfig
        from scanner_engine import read_engine_health
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            timestamp=int(datetime.now(timezone.utc).timestamp())
            (root/'daily.cvd').write_bytes(f'ClamAV-VDB:date:123:1:90:hash:signature:builder:{timestamp}'.encode().ljust(512,b' '))
            config=ScannerConfig('https://example.invalid','s'*43,'mac',root,root,root,'clamscan','freshclam',root/'freshclam.conf',None,120)
            completed=subprocess.CompletedProcess([],0,'ClamAV 1.5.4/123/Fri Oct 2 2026\n','')

            with patch('scanner_engine.subprocess.run',return_value=completed):
                health=read_engine_health(config)

            self.assertEqual(health.health,'engine_unavailable')

if __name__ == '__main__':
    unittest.main()
