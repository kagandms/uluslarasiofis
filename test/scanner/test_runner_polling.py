from __future__ import annotations

import sys
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

SCANNER_DIRECTORY = Path(__file__).resolve().parents[2] / 'scripts' / 'scanner'
sys.path.insert(0, str(SCANNER_DIRECTORY))

from runner import JobEvidence, run_loop  # noqa: E402
from scanner_config import ScannerConfig, load_config  # noqa: E402
from scanner_engine import EngineHealth, ScanVerdict, Signature  # noqa: E402
from scanner_transport import Download  # noqa: E402


class FakeClock:
    def __init__(self, start: float = 0.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class FakeStopEvent:
    def __init__(
        self,
        clock: FakeClock,
        *,
        max_waits: int | None = None,
        on_wait: object = None,
    ) -> None:
        self.clock = clock
        self.max_waits = max_waits
        self.on_wait = on_wait
        self.waits: list[float] = []
        self._is_set = False

    def is_set(self) -> bool:
        return self._is_set

    def set(self) -> None:
        self._is_set = True

    def wait(self, timeout: float | None = None) -> bool:
        if self._is_set:
            return True
        seconds = 0.0 if timeout is None else float(timeout)
        self.waits.append(seconds)
        self.clock.advance(seconds)
        if self.on_wait is not None:
            self.on_wait(self, len(self.waits))
        if self.max_waits is not None and len(self.waits) >= self.max_waits:
            self._is_set = True
        return self._is_set


class FakeTransport:
    def __init__(self, clock: FakeClock, claims: list[dict[str, object] | None] | None = None) -> None:
        self.clock = clock
        self.claims = list(claims or [])
        self.calls: list[tuple[float, str, object, str | None]] = []

    def request(self, path: str, body: object = None, token: str | None = None) -> object:
        self.calls.append((self.clock(), path, body, token))
        if path == 'claim':
            job = self.claims.pop(0) if self.claims else None
            return {'job': job}
        return {'recorded': True}


def make_test_config(
    root: Path,
    *,
    idle_poll_seconds: int = 10,
    active_poll_seconds: int = 3,
    active_window_seconds: int = 180,
) -> ScannerConfig:
    return ScannerConfig(
        'https://scanner.example',
        's' * 43,
        'mac-test',
        root,
        root,
        root,
        'clamscan',
        'freshclam',
        root / 'freshclam.conf',
        None,
        120,
        (),
        idle_poll_seconds,
        active_poll_seconds,
        active_window_seconds,
    )


def make_fake_job(job_id: str = 'job_1') -> dict[str, object]:
    lease_until = (
        (datetime.now(timezone.utc) + timedelta(seconds=300))
        .isoformat(timespec='milliseconds')
        .replace('+00:00', 'Z')
    )
    return {
        'id': job_id,
        'file_id': f'file_{job_id}',
        'revision_id': f'rev_{job_id}',
        'storage_key': 'quarantine/00000000-0000-4000-8000-000000000001',
        'byte_size': 128,
        'media_type': 'application/pdf',
        'lease_until': lease_until,
        'lease_token': 'a' * 64,
    }


def make_ready_health() -> EngineHealth:
    return EngineHealth('ready', '1.5.4', Signature('28141', datetime.now(timezone.utc)))


class PollingConfigTests(unittest.TestCase):
    def _base_settings(self, directory: str) -> dict[str, str]:
        secret_path = Path(directory) / 'secret'
        secret_path.write_text('s' * 43)
        secret_path.chmod(0o600)
        return {
            'SCANNER_ORIGIN': 'https://scanner.example',
            'SCANNER_SECRET_FILE': str(secret_path),
            'SCANNER_STATE_DIR': directory,
            'SCANNER_RUNNER_ID': 'mac-test',
        }

    def test_config_polling_defaults_and_bounds(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = self._base_settings(directory)

            default_cfg = load_config(base)
            self.assertEqual(default_cfg.idle_poll_seconds, 10)
            self.assertEqual(default_cfg.active_poll_seconds, 3)
            self.assertEqual(default_cfg.active_window_seconds, 180)

            min_cfg = load_config({
                **base,
                'SCANNER_IDLE_POLL_SECONDS': '2',
                'SCANNER_ACTIVE_POLL_SECONDS': '1',
                'SCANNER_ACTIVE_WINDOW_SECONDS': '0',
            })
            self.assertEqual(min_cfg.idle_poll_seconds, 2)
            self.assertEqual(min_cfg.active_poll_seconds, 1)
            self.assertEqual(min_cfg.active_window_seconds, 0)

            max_cfg = load_config({
                **base,
                'SCANNER_IDLE_POLL_SECONDS': '120',
                'SCANNER_ACTIVE_POLL_SECONDS': '30',
                'SCANNER_ACTIVE_WINDOW_SECONDS': '900',
            })
            self.assertEqual(max_cfg.idle_poll_seconds, 120)
            self.assertEqual(max_cfg.active_poll_seconds, 30)
            self.assertEqual(max_cfg.active_window_seconds, 900)

    def test_config_rejects_invalid_polling_values(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = self._base_settings(directory)
            invalid_cases = [
                ('SCANNER_IDLE_POLL_SECONDS', ('1', '121', '0', '-5', 'abc', ''), 'idle_poll_invalid'),
                ('SCANNER_ACTIVE_POLL_SECONDS', ('0', '31', '-1', 'abc', ''), 'active_poll_invalid'),
                ('SCANNER_ACTIVE_WINDOW_SECONDS', ('-1', '901', 'abc', ''), 'active_window_invalid'),
            ]
            for env_key, values, error_code in invalid_cases:
                for bad_value in values:
                    with self.subTest(env_key=env_key, bad_value=bad_value):
                        with self.assertRaisesRegex(ValueError, error_code):
                            load_config({**base, env_key: bad_value})


class RunnerPollingLoopTests(unittest.TestCase):
    def test_active_and_idle_poll_intervals(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = make_test_config(
                Path(directory),
                idle_poll_seconds=10,
                active_poll_seconds=3,
                active_window_seconds=10,
            )
            clock = FakeClock(0.0)
            stop_event = FakeStopEvent(clock, max_waits=6)
            transport = FakeTransport(clock, claims=[None, make_fake_job('job_1')])
            ready = make_ready_health()

            def fake_execute(_cfg: object, _tr: object, _job: object) -> JobEvidence:
                clock.advance(4.0)
                return JobEvidence(ready, ScanVerdict('clean', 'scanned', True), Download(b'pdf', 'b' * 64, 'etag-1'))

            with (
                patch('runner.update_signatures', return_value=True),
                patch('runner.clean_crash_residue'),
                patch('runner.read_engine_health', return_value=ready),
                patch('runner.execute_job', side_effect=fake_execute),
            ):
                run_loop(config, transport, clock=clock, stop_event=stop_event)

            self.assertEqual(stop_event.waits, [10.0, 3.0, 3.0, 3.0, 3.0, 10.0])
            claim_times = [ts for ts, path, _, _ in transport.calls if path == 'claim']
            result_times = [ts for ts, path, _, _ in transport.calls if path.endswith('/result')]
            self.assertEqual(result_times, [14.0])
            # Immediately polls again at 14.0 after finishing the job at 14.0.
            self.assertEqual(claim_times, [0.0, 10.0, 14.0, 17.0, 20.0, 23.0, 26.0])

    def test_zero_active_window_uses_idle_interval(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = make_test_config(
                Path(directory),
                idle_poll_seconds=10,
                active_poll_seconds=3,
                active_window_seconds=0,
            )
            clock = FakeClock(0.0)
            stop_event = FakeStopEvent(clock, max_waits=2)
            transport = FakeTransport(clock, claims=[make_fake_job('job_1'), None, None])
            ready = make_ready_health()

            def fake_execute(_cfg: object, _tr: object, _job: object) -> JobEvidence:
                clock.advance(2.0)
                return JobEvidence(ready, ScanVerdict('clean', 'scanned', True), Download(b'pdf', 'b' * 64, 'etag-1'))

            with (
                patch('runner.update_signatures', return_value=True),
                patch('runner.clean_crash_residue'),
                patch('runner.read_engine_health', return_value=ready),
                patch('runner.execute_job', side_effect=fake_execute),
            ):
                run_loop(config, transport, clock=clock, stop_event=stop_event)

            self.assertEqual(stop_event.waits, [10.0, 10.0])

    def test_heartbeat_cadence_at_most_once_per_60_seconds(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = make_test_config(
                Path(directory),
                idle_poll_seconds=10,
                active_poll_seconds=3,
                active_window_seconds=180,
            )
            clock = FakeClock(0.0)
            # 19 idle waits of 10 s; event is set after the 19th wait, so polls run at t = 0..180 s (19 polls)
            stop_event = FakeStopEvent(clock, max_waits=19)
            transport = FakeTransport(clock)
            ready = make_ready_health()

            with (
                patch('runner.update_signatures', return_value=True),
                patch('runner.clean_crash_residue'),
                patch('runner.read_engine_health', return_value=ready),
            ):
                run_loop(config, transport, clock=clock, stop_event=stop_event)

            heartbeat_times = [ts for ts, path, _, _ in transport.calls if path == 'heartbeat']
            claim_times = [ts for ts, path, _, _ in transport.calls if path == 'claim']
            self.assertEqual(heartbeat_times, [0.0, 60.0, 120.0, 180.0])
            self.assertEqual(len(claim_times), 19)
            for earlier, later in zip(heartbeat_times, heartbeat_times[1:]):
                self.assertGreaterEqual(later - earlier, 60.0)

    def test_heartbeat_cadence_holds_during_active_3s_polling(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = make_test_config(
                Path(directory),
                idle_poll_seconds=10,
                active_poll_seconds=3,
                active_window_seconds=180,
            )
            clock = FakeClock(0.0)
            stop_event = FakeStopEvent(clock, max_waits=25)
            transport = FakeTransport(clock, claims=[make_fake_job('job_1')])
            ready = make_ready_health()

            def fake_execute(_cfg: object, _tr: object, _job: object) -> JobEvidence:
                return JobEvidence(ready, ScanVerdict('clean', 'scanned', True), Download(b'pdf', 'b' * 64, 'etag-1'))

            with (
                patch('runner.update_signatures', return_value=True),
                patch('runner.clean_crash_residue'),
                patch('runner.read_engine_health', return_value=ready),
                patch('runner.execute_job', side_effect=fake_execute),
            ):
                run_loop(config, transport, clock=clock, stop_event=stop_event)

            heartbeat_times = [ts for ts, path, _, _ in transport.calls if path == 'heartbeat']
            self.assertEqual(heartbeat_times, [0.0, 60.0])

    def test_degraded_health_never_claims(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = make_test_config(Path(directory), idle_poll_seconds=20)
            clock = FakeClock(0.0)
            # Polls at t=0, 20, 40, 60, 80 -> 4 waits
            stop_event = FakeStopEvent(clock, max_waits=4)
            transport = FakeTransport(clock)
            ready = make_ready_health()
            health_sequence = [
                ready,
                EngineHealth('signature_stale'),
                EngineHealth('engine_unavailable'),
                EngineHealth('signature_stale'),
                EngineHealth('engine_unavailable'),
            ]

            with (
                patch('runner.update_signatures', return_value=True),
                patch('runner.clean_crash_residue'),
                patch('runner.read_engine_health', side_effect=health_sequence),
            ):
                run_loop(config, transport, clock=clock, stop_event=stop_event)

            claim_times = [ts for ts, path, _, _ in transport.calls if path == 'claim']
            heartbeats = [(ts, body['health']) for ts, path, body, _ in transport.calls if path == 'heartbeat']
            # Only the initial healthy iteration at t=0.0 could claim; all degraded iterations skipped claim.
            self.assertEqual(claim_times, [0.0])
            self.assertEqual(heartbeats, [(0.0, 'ready'), (60.0, 'signature_stale')])

    def test_stop_event_stops_wait_and_exits_promptly(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = make_test_config(Path(directory), idle_poll_seconds=10)
            clock = FakeClock(0.0)
            transport = FakeTransport(clock)
            ready = make_ready_health()

            def trigger_stop_on_first_wait(event: FakeStopEvent, _count: int) -> None:
                event.set()

            stop_event = FakeStopEvent(clock, on_wait=trigger_stop_on_first_wait)
            with (
                patch('runner.update_signatures', return_value=True) as mock_update,
                patch('runner.clean_crash_residue'),
                patch('runner.read_engine_health', return_value=ready),
            ):
                run_loop(config, transport, clock=clock, stop_event=stop_event)

            self.assertEqual(mock_update.call_count, 1)
            self.assertEqual(stop_event.waits, [10.0])
            self.assertEqual([path for _, path, _, _ in transport.calls], ['heartbeat', 'claim'])

            already_stopped = threading.Event()
            already_stopped.set()
            transport.calls.clear()
            with (
                patch('runner.update_signatures', return_value=True) as mock_update_again,
                patch('runner.clean_crash_residue'),
            ):
                run_loop(config, transport, clock=clock, stop_event=already_stopped)

            self.assertEqual(mock_update_again.call_count, 0)
            self.assertEqual(transport.calls, [])


if __name__ == '__main__':
    unittest.main()
