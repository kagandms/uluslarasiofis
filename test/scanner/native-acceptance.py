"""Opt-in native workerd/local D1/R2 acceptance; refuses remote targets and emits no credentials."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import ssl
import subprocess
from dataclasses import dataclass
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class Settings:
    """Explicit local acceptance inputs; secrets remain in private files."""
    origin: str
    configuration: Path
    persistence: Path
    fixtures: Path
    certificate: Path
    secret_file: Path
    state: Path
    output: Path
    database: str
    bucket: str
    clamscan: str
    certificates: Path


@dataclass(frozen=True)
class Reply:
    """Bounded HTTP response including private cookie used only in this process."""
    status: int
    content: bytes
    cookie: str

    def decode(self) -> dict[str, object]:
        """Decode the API envelope; raises on malformed JSON."""
        return json.loads(self.content)


@dataclass(frozen=True)
class Application:
    """Synthetic application authority; never serialized into evidence."""
    identifier: str
    reference: str
    code: str
    cookie: str


class RejectRedirects(HTTPRedirectHandler):
    """Prevent synthetic owner cookies from leaving the explicitly local origin."""

    def redirect_request(self, *arguments: object) -> None:
        """Refuse redirects; raises a redacted operational error."""
        raise RuntimeError('redirect_rejected')


def load_settings() -> Settings:
    """Load explicit environment paths; reject any remote binding or non-loopback origin."""
    origin = os.environ['NATIVE_ORIGIN']
    parsed = urlsplit(origin)
    if (parsed.scheme != 'https' or parsed.hostname != '127.0.0.1' or parsed.username
            or parsed.query or parsed.fragment or parsed.path not in ('', '/')):
        raise ValueError('local_https_origin_required')
    configuration = Path(os.environ['NATIVE_CONFIG']).resolve()
    bindings = json.loads(configuration.read_text())
    if bindings.get('env') or bindings['vars']['APP_ENV'] != 'local':
        raise ValueError('local_configuration_required')
    for binding in bindings['d1_databases'] + bindings['r2_buckets']:
        if binding.get('remote') is not False:
            raise ValueError('remote_binding_rejected')
    return Settings(origin.rstrip('/'), configuration, Path(os.environ['NATIVE_PERSIST']).resolve(),
        Path(os.environ['NATIVE_FIXTURES']).resolve(), Path(os.environ['NATIVE_CA']).resolve(),
        Path(os.environ['NATIVE_SECRET']).resolve(), Path(os.environ['SCANNER_REAL_STATE']).resolve(),
        Path(os.environ['NATIVE_OUTPUT']).resolve(), bindings['d1_databases'][0]['database_name'],
        bindings['r2_buckets'][0]['bucket_name'], os.environ['SCANNER_CLAMSCAN'],
        Path(os.environ['SCANNER_CERTS_DIR']).resolve())


def send(settings: Settings, path: str, options: dict[str, object] | None = None) -> Reply:
    """Call only configured loopback HTTPS; HTTP failures return safe status for assertions."""
    options = options or {}
    headers = {'Origin': settings.origin, 'CF-Connecting-IP': '198.51.100.75'}
    if options.get('cookie'):
        headers['Cookie'] = str(options['cookie'])
    body = options.get('body')
    if body is not None:
        headers['Content-Type'] = 'application/json'
    request = Request(settings.origin + path, method=str(options.get('method', 'GET')), headers=headers,
        data=json.dumps(body).encode() if body is not None else None)
    opener = build_opener(RejectRedirects(), HTTPSHandler(context=ssl.create_default_context(cafile=str(settings.certificate))))
    try:
        response = opener.open(request, timeout=30)
    except HTTPError as error:
        response = error
    with response:
        return Reply(response.status, response.read(11 * 1024 * 1024),
            response.headers.get('Set-Cookie', '').split(';')[0])


def execute_local(settings: Settings, arguments: list[str]) -> str:
    """Execute Wrangler with local-only persistence and explicit config; output stays private."""
    command = ['npx', 'wrangler', *arguments, '--local', '--persist-to', str(settings.persistence),
        '--config', str(settings.configuration)]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=60, check=False)
    if completed.returncode:
        raise RuntimeError('local_cli_failed')
    return completed.stdout


def query(settings: Settings, statement: str) -> list[dict[str, object]]:
    """Execute synthetic local SQL and return rows; never prints SQL or opaque identities."""
    encoded = execute_local(settings, ['d1', 'execute', settings.database, '--command', statement, '--json'])
    return json.loads(encoded)[0]['results']


def expect(reply: Reply, status: int, label: str) -> None:
    """Assert only safe status/label; excludes response bodies with credentials."""
    assert reply.status == status, f'{label}: expected {status}, received {reply.status}'


def create_application(settings: Settings) -> Application:
    """Create one synthetic draft using the real API and capture owner authority in memory."""
    reply = send(settings, '/api/public/applications', {'method': 'POST', 'body': {
        'student_number': 'NATIVE-' + secrets.token_hex(4), 'application_type': 'initial',
        'email': 'synthetic@example.invalid', 'phone': '+905551112233'}})
    expect(reply, 201, 'create')
    credentials = reply.decode()
    current = send(settings, '/api/public/applications/current', {'cookie': reply.cookie})
    expect(current, 200, 'owner current')
    identifier = query(settings, f"SELECT id FROM applications WHERE reference_number='{credentials['reference_number']}'")[0]['id']
    return Application(str(identifier), str(credentials['reference_number']),
        str(credentials['access_code']), reply.cookie)


def login(settings: Settings, application: Application, code: str) -> Reply:
    """Attempt a real credential login without storing credentials on disk."""
    return send(settings, '/api/public/applications/access', {'method': 'POST', 'body': {
        'reference_number': application.reference, 'access_code': code}})


def prove_access(settings: Settings, application: Application) -> str:
    """Prove distinct owner cookies, invalid credentials and shared-NAT valid access."""
    second = login(settings, application, application.code)
    expect(second, 200, 'second owner')
    assert second.cookie and second.cookie != application.cookie
    current = send(settings, '/api/public/applications/current', {'cookie': second.cookie})
    assert current.decode()['application']['reference_number'] == application.reference
    wrong = login(settings, application, 'Z' * 26)
    expect(wrong, 401, 'wrong code')
    assert not wrong.cookie
    missing = send(settings, '/api/public/applications/access', {'method': 'POST', 'body': {
        'reference_number': application.reference}})
    expect(missing, 400, 'reference only')
    assert not missing.cookie
    for _ in range(65):
        expect(login(settings, application, application.code), 200, 'valid shared NAT')
    return second.cookie


def prove_conflict(settings: Settings, application: Application, second_cookie: str) -> None:
    """Prove a stale second-device autosave is rejected without replacing current fields."""
    path = '/api/public/applications/current/autosave'
    saved = send(settings, path, {'method': 'PATCH', 'cookie': application.cookie,
        'body': {'first_name': 'Synthetic Fresh', 'lock_version': 1}})
    expect(saved, 200, 'first device save')
    stale = send(settings, path, {'method': 'PATCH', 'cookie': second_cookie,
        'body': {'first_name': 'Synthetic Stale', 'lock_version': 1}})
    expect(stale, 409, 'stale second device')
    current = send(settings, '/api/public/applications/current', {'cookie': second_cookie})
    assert current.decode()['application']['first_name'] == 'Synthetic Fresh'


def prove_campus_usage(settings: Settings) -> None:
    """Verify 20 distinct native draft creates/lookups on one IP and active-student denial."""
    prefix = 'CAMPUS-' + secrets.token_hex(4)
    for index in range(20):
        student_number = prefix + '-' + str(index)
        created = send(settings, '/api/public/applications', {'method': 'POST', 'body': {
            'student_number': student_number, 'application_type': 'initial',
            'email': 'synthetic@example.invalid', 'phone': '+905551112233'}})
        expect(created, 201, 'campus draft')
        status = send(settings, '/api/public/applications/tracking-lookup', {'method': 'POST',
            'body': {'student_number': student_number}})
        expect(status, 200, 'campus public lookup')
        assert status.decode()['found'] is False and not status.cookie
    duplicate = send(settings, '/api/public/applications', {'method': 'POST', 'body': {
        'student_number': prefix + '-0', 'application_type': 'initial',
        'email': 'synthetic@example.invalid', 'phone': '+905551112233'}})
    expect(duplicate, 409, 'single active campus draft')


def seed_staff(settings: Settings) -> str:
    """Seed an ephemeral LOCAL test session, without claiming bootstrap/browser UAT."""
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    query(settings, "INSERT INTO staff_users(id,username,normalized_username,password_hash,display_name,role) "
        "VALUES('native-staff','integration-native-reviewer','integration-native-reviewer','synthetic-only','Synthetic Reviewer','reviewer'); "
        "INSERT INTO staff_sessions(id,staff_user_id,token_hash,expires_at) "
        f"VALUES('native-staff-session','native-staff','{token_hash}','2999-01-01T00:00:00.000Z')")
    return 'staff_session=' + token


def finalize_file(settings: Settings, application: Application, options: dict[str, str]) -> None:
    """Use real upload-intent/finalize API with CLI local R2 bytes; no browser PUT claim."""
    fixture = settings.fixtures / options['fixture']
    replacement = options.get('kind') == 'replacement'
    prefix = '/api/public/applications/current/documents/'
    reply = send(settings, prefix + ('resubmission-upload-intent' if replacement else 'upload-intent'), {
        'method': 'POST', 'cookie': application.cookie, 'body': {'code': 'passport', 'filename': 'synthetic-document',
            'media_type': options['media_type'], 'byte_size': fixture.stat().st_size}})
    expect(reply, 201, 'intent')
    upload = reply.decode()['upload']
    assert upload['required_headers']['if-none-match'] == '*'
    key = '/'.join(urlsplit(upload['url']).path.split('/')[-2:])
    execute_local(settings, ['r2', 'object', 'put', settings.bucket + '/' + key, '--file', str(fixture),
        '--content-type', options['media_type']])
    finalized = send(settings, prefix + ('resubmission-finalize' if replacement else 'finalize'), {
        'method': 'POST', 'cookie': application.cookie, 'body': {'intent_id': upload['intent_id']}})
    expect(finalized, 200, 'finalize')
    pending = query(settings, f"SELECT scan_status FROM document_revision_files WHERE storage_key='{key}'")
    assert pending[0]['scan_status'] == 'pending'
    query(settings, "UPDATE document_scan_jobs SET available_at='2026-01-01T00:00:00.000Z' WHERE status='queued'")


def run_scanner(settings: Settings, expected: str) -> None:
    """Execute the real runner/engine; assert result and retain only redacted evidence."""
    environment = {**os.environ, 'SCANNER_ORIGIN': settings.origin, 'SCANNER_RUNNER_ID': 'native-integration-macbook',
        'SCANNER_SECRET_FILE': str(settings.secret_file), 'SCANNER_STATE_DIR': str(settings.state),
        'SCANNER_DATABASE_DIR': str(settings.state / 'signatures'), 'SCANNER_CERTS_DIR': str(settings.certificates),
        'SCANNER_CLAMSCAN': settings.clamscan, 'SCANNER_CA_FILE': str(settings.certificate)}
    completed = subprocess.run([str(settings.state / 'venv/bin/python'), 'scripts/scanner/runner.py', '--once'],
        env=environment, capture_output=True, text=True, timeout=180, check=False)
    assert completed.returncode == 0, 'runner failed'
    assert 'outcome=' + expected in completed.stderr, 'expected real engine verdict absent'
    assert not list((settings.state / 'tmp').glob('job-*')), 'temporary residue'


def check_gates(settings: Settings, application: Application, options: dict[str, object]) -> None:
    """Verify exact downloaded bytes, preview/archive authority and non-clean review denial."""
    base = f'/api/staff/applications/{application.identifier}/documents'
    cookie = str(options['cookie'])
    is_clean = options['outcome'] == 'clean'
    download = send(settings, base + '/passport/download', {'cookie': cookie})
    expect(download, 200 if is_clean else 404, 'download gate')
    expect(send(settings, base + '/passport/preview', {'method': 'POST', 'cookie': cookie, 'body': {}}),
        200 if is_clean else 404, 'preview gate')
    manifest = send(settings, base + '/archive-manifest', {'method': 'POST', 'cookie': cookie, 'body': {}})
    expect(manifest, 200 if is_clean else 404, 'archive gate')
    if not is_clean:
        expect(send(settings, base + '/passport/approve', {'method': 'POST', 'cookie': cookie,
            'body': {'expected_revision_number': options['revision']}}), 409, 'review gate')
        return
    expected_bytes = (settings.fixtures / 'clean.pdf').read_bytes()
    assert download.content == expected_bytes
    file = manifest.decode()['files'][0]
    archive_path = base + '/passport/archive-file?' + urlencode({
        'revision': file['expected_revision_number'], 'identity': file['object_identity']})
    archived = send(settings, archive_path, {'cookie': cookie})
    expect(archived, 200, 'archive file')
    assert archived.content == expected_bytes


def request_replacement(settings: Settings, application: Application, options: dict[str, object]) -> None:
    """Request a supported replacement from the synthetic local staff session."""
    path = f'/api/staff/applications/{application.identifier}/documents/passport/request-resubmission'
    expect(send(settings, path, {'method': 'POST', 'cookie': str(options['cookie']), 'body': {
        'expected_revision_number': options['revision'], 'reason': 'Synthetic integration replacement'}}), 200, 'request replacement')


def prove_scanning(settings: Settings, application: Application, staff_cookie: str) -> None:
    """Prove initial/replacement clean and EICAR unsafe through native Worker bindings."""
    finalize_file(settings, application, {'fixture': 'clean.pdf', 'media_type': 'application/pdf'})
    query(settings, f"UPDATE applications SET status='under_review' WHERE id='{application.identifier}'")
    detail = send(settings, f'/api/staff/applications/{application.identifier}', {'cookie': staff_cookie})
    expect(detail, 200, 'staff detail')
    assert detail.decode()['application']['reference_number'] == application.reference
    assert 'access_code' not in detail.decode()['application'] and 'access_code_hash' not in detail.decode()['application']
    gates = {'cookie': staff_cookie, 'revision': 1, 'outcome': 'pending'}
    check_gates(settings, application, gates)
    run_scanner(settings, 'clean')
    check_gates(settings, application, {**gates, 'outcome': 'clean'})
    request_replacement(settings, application, {'cookie': staff_cookie, 'revision': 1})
    finalize_file(settings, application, {'fixture': 'clean.pdf', 'media_type': 'application/pdf', 'kind': 'replacement'})
    run_scanner(settings, 'clean')
    check_gates(settings, application, {**gates, 'revision': 2, 'outcome': 'clean'})
    request_replacement(settings, application, {'cookie': staff_cookie, 'revision': 2})
    finalize_file(settings, application, {'fixture': 'eicar.png', 'media_type': 'image/png', 'kind': 'replacement'})
    run_scanner(settings, 'unsafe')
    check_gates(settings, application, {**gates, 'revision': 3, 'outcome': 'unsafe'})
    expect(send(settings, '/api/scanner/claim', {'method': 'POST', 'cookie': staff_cookie,
        'body': {'runner_id': 'denied'}}), 401, 'staff cookie cannot claim')


def prove_reset(settings: Settings, application: Application, cookies: tuple[str, str]) -> None:
    """Prove reset revocation, old-code rejection, owner regeneration and terminal denial."""
    staff_cookie, second_cookie = cookies
    reset = send(settings, f'/api/staff/applications/{application.identifier}/reset-access-code',
        {'method': 'POST', 'cookie': staff_cookie, 'body': {}})
    expect(reset, 200, 'staff reset')
    for cookie in (application.cookie, second_cookie):
        expect(send(settings, '/api/public/applications/current', {'cookie': cookie}), 401, 'revoked owner')
    expect(login(settings, application, application.code), 401, 'old reset code')
    reset_code = str(reset.decode()['access_code'])
    renewed = login(settings, application, reset_code)
    expect(renewed, 200, 'reset code')
    rotated = send(settings, '/api/public/applications/current/regenerate-access-code',
        {'method': 'POST', 'cookie': renewed.cookie})
    expect(rotated, 200, 'owner regeneration')
    expect(login(settings, application, reset_code), 401, 'old regenerated code')
    current_code = str(rotated.decode()['access_code'])
    expect(login(settings, application, current_code), 200, 'regenerated code')
    query(settings, f"UPDATE applications SET status='completed' WHERE id='{application.identifier}'")
    terminal = login(settings, application, current_code)
    expect(terminal, 401, 'terminal code')
    assert not terminal.cookie


def main() -> int:
    """Run local acceptance and write only safe engine/runtime/result metadata."""
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    try:
        settings = load_settings()
        runtime = send(settings, '/__runtime_probe').decode()
        assert runtime == {'timingSafeEqual': 'function', 'equal': True, 'different': False}
        application = create_application(settings)
        second_cookie = prove_access(settings, application)
        prove_conflict(settings, application, second_cookie)
        prove_campus_usage(settings)
        staff_cookie = seed_staff(settings)
        prove_scanning(settings, application, staff_cookie)
        prove_reset(settings, application, (staff_cookie, second_cookie))
        evidence = {'status': 'PASS', 'runtime': runtime, 'scans': query(settings,
            'SELECT status,attempts,outcome,result_code,engine_version,signature_version,signature_updated_at,scanned_at FROM document_scan_jobs ORDER BY rowid'),
            'checks': ['20-shared-IP-drafts-and-public-lookups', 'single-active-campus-draft', 'staff-detail-reference-without-code-hash',
                'distinct-owner-sessions', '65-valid-same-NAT-logins', 'invalid-and-reference-only-denial',
                'PATCH-conflict', 'initial-clean', 'replacement-clean', 'replacement-EICAR-unsafe', 'pending-unsafe-staff-gates',
                'exact-download-archive-bytes', 'scanner-auth-denial', 'staff-reset-revocation', 'owner-regeneration', 'terminal-denial', 'tmp-empty'],
            'limitations': ['synthetic-local-staff-session', 'local-R2-CLI-PUT', 'synthetic-review-state', 'synthetic-queue-clock', 'no-physical-browser-or-remote-UAT']}
        settings.output.write_text(json.dumps(evidence, indent=2) + '\n')
        LOGGER.info('native_acceptance PASS; safe evidence saved')
        return 0
    except Exception as error:
        LOGGER.error('native_acceptance FAILED type=%s detail=%s', type(error).__name__, str(error) if isinstance(error, AssertionError) else 'redacted')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
