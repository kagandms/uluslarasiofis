"""Opt-in native workerd/local D1/R2 acceptance; refuses remote targets and emits no credentials."""
from __future__ import annotations

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


@dataclass(frozen=True)
class Revision:
    """Local synthetic file/job identity, never an authorization token."""
    file_identifier: str
    revision_identifier: str
    job_identifier: str


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
    headers.update(options.get('headers', {}))
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


def create_application(settings: Settings, student_number: str | None = None) -> Application:
    """Create one synthetic draft using the real API and capture owner authority in memory."""
    reply = send(settings, '/api/public/applications', {'method': 'POST', 'body': {
        'student_number': student_number or 'NATIVE-' + secrets.token_hex(4), 'application_type': 'initial',
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


def authenticate_staff(settings: Settings) -> str:
    """Bootstrap/login a synthetic LOCAL admin through supported APIs; never SQL credentials."""
    password = secrets.token_urlsafe(24)
    token = (settings.configuration.parent / 'staff-bootstrap-token').read_text()
    credentials = {'username': 'integration-native-reviewer', 'password': password}
    bootstrap = send(settings, '/api/staff/auth/bootstrap', {'method': 'POST',
        'headers': {'X-Staff-Bootstrap-Token': token},
        'body': {**credentials, 'display_name': 'Synthetic Local Admin'}})
    expect(bootstrap, 201, 'local staff bootstrap')
    authenticated = send(settings, '/api/staff/auth/login', {'method': 'POST', 'body': credentials})
    expect(authenticated, 200, 'local staff login')
    assert authenticated.cookie
    return authenticated.cookie


def finalize_file(settings: Settings, application: Application, options: dict[str, str]) -> Revision:
    """Use real upload-intent/finalize API with CLI local R2 bytes; no browser PUT claim."""
    fixture = settings.fixtures / options['fixture']
    replacement = options.get('kind') == 'replacement'
    prefix = '/api/public/applications/current/documents/'
    reply = send(settings, prefix + ('resubmission-upload-intent' if replacement else 'upload-intent'), {
        'method': 'POST', 'cookie': application.cookie, 'body': {'code': options.get('code', 'passport'), 'filename': 'synthetic-document',
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
    pending = query(settings, "SELECT files.id, files.revision_id, files.scan_status, jobs.id AS job_id "
        "FROM document_revision_files AS files JOIN document_scan_jobs AS jobs ON jobs.file_id=files.id "
        f"WHERE files.storage_key='{key}'")
    assert pending[0]['scan_status'] == 'pending'
    if options.get('queue') != 'deferred':
        query(settings, "UPDATE document_scan_jobs SET available_at='2026-01-01T00:00:00.000Z' "
            f"WHERE id='{pending[0]['job_id']}' AND status='queued'")
    return Revision(str(pending[0]['id']), str(pending[0]['revision_id']), str(pending[0]['job_id']))


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
    expect(manifest, 200 if is_clean and options.get('archive') != 'blocked' else 404, 'archive gate')
    if not is_clean:
        expect(send(settings, base + '/passport/approve', {'method': 'POST', 'cookie': cookie,
            'body': {'expected_revision_number': options['revision']}}), 409, 'review gate')
        return
    expected_bytes = (settings.fixtures / 'clean.pdf').read_bytes()
    assert download.content == expected_bytes
    if options.get('archive') == 'blocked':
        return
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


def read_support_candidates(settings: Settings, lookup: dict[str, str]) -> list[dict[str, object]]:
    """Exercise the operator's SELECT generator and explicit LOCAL D1 lookup; never reset in SQL."""
    prepared = settings.configuration.parent / ('lookup-' + secrets.token_hex(4) + '.sql')
    try:
        completed = subprocess.run(['node', 'scripts/pilot/draft-support-query.mjs', str(prepared)],
            input=json.dumps(lookup), capture_output=True, text=True, timeout=30, check=False)
        assert completed.returncode == 0, 'support query preparation'
        assert prepared.stat().st_mode & 0o077 == 0, 'support query permissions'
        return query(settings, prepared.read_text())
    finally:
        prepared.unlink(missing_ok=True)


def prove_lost_draft(settings: Settings, staff_cookie: str) -> None:
    """Simulate institutional verification, then discover/reset a nameless draft through supported authority."""
    student_number = 'LOST-' + secrets.token_hex(4)
    application = create_application(settings, student_number)
    for lookup in ({'kind': 'reference', 'value': application.reference},
                   {'kind': 'student-number', 'value': student_number}):
        candidates = read_support_candidates(settings, lookup)
        assert len(candidates) == 1 and candidates[0]['application_id'] == application.identifier
        assert set(candidates[0]) == {'application_id', 'reference_number', 'status'}
        assert candidates[0]['status'] == 'draft'
    listed = send(settings, '/api/staff/applications/query', {'method': 'POST',
        'cookie': staff_cookie, 'body': {'q': student_number}})
    expect(listed, 200, 'draft query')
    assert listed.decode()['items'] == []
    expect(send(settings, f'/api/staff/applications/{application.identifier}', {'cookie': staff_cookie}), 404, 'draft hidden')
    expect(send(settings, '/api/public/applications', {'method': 'POST', 'body': {
        'student_number': student_number, 'application_type': 'initial',
        'email': 'synthetic@example.invalid', 'phone': '+905551112233'}}), 409, 'lost draft duplicate')
    second = login(settings, application, application.code)
    expect(second, 200, 'lost draft second owner')
    reset = send(settings, f'/api/staff/applications/{application.identifier}/reset-access-code',
        {'method': 'POST', 'cookie': staff_cookie, 'body': {}})
    expect(reset, 200, 'lost draft reset')
    assert reset.decode()['reference_number'] == application.reference
    for cookie in (application.cookie, second.cookie):
        expect(send(settings, '/api/public/applications/current', {'cookie': cookie}), 401, 'lost draft revoked owner')
    expect(login(settings, application, application.code), 401, 'lost draft old code')
    expect(login(settings, application, str(reset.decode()['access_code'])), 200, 'lost draft new code')


def complete_fields(settings: Settings, application: Application) -> None:
    """Populate synthetic fields and acknowledgements using owner APIs; no SQL workflow bypass."""
    current = send(settings, '/api/public/applications/current', {'cookie': application.cookie})
    updated = send(settings, '/api/public/applications/current', {'method': 'PATCH', 'cookie': application.cookie,
        'body': {'lock_version': current.decode()['application']['lock_version'], 'first_name': 'Synthetic',
        'last_name': 'Student', 'passport_number': 'SYNTHETIC', 'nationality': 'Turkish',
        'date_of_birth': '2000-01-01', 'is_under_18': False, 'address_evidence_type': 'rental_contract',
        'fingerprint_status': 'registered', 'fingerprint_code': 'SYNTHETIC-FP'}})
    expect(updated, 200, 'synthetic fields')
    for path, version in (('contact-acknowledgement', 'contact-reachability-v1'),
                          ('declaration', 'student-information-accuracy-v1')):
        expect(send(settings, '/api/public/applications/current/' + path, {'method': 'POST',
            'cookie': application.cookie, 'body': {'accepted': True, 'version': version}}), 200, path)


def submit_pending_application(settings: Settings, application: Application) -> None:
    """Finalize actual local objects for all required policies and submit while their scans remain pending."""
    complete_fields(settings, application)
    expression = ("import {listDocumentPolicies} from './src/server/domain/documentPolicy.js';"
        "process.stdout.write(JSON.stringify(listDocumentPolicies('initial',false,'rental_contract')"
        ".filter(p=>p.required&&p.code!=='passport').map(p=>p.code)));")
    completed = subprocess.run(['node', '--input-type=module', '-e', expression],
        capture_output=True, text=True, timeout=30, check=False)
    assert completed.returncode == 0, 'required policy lookup'
    for code in json.loads(completed.stdout):
        finalize_file(settings, application, {'fixture': 'clean.pdf', 'media_type': 'application/pdf',
            'code': code, 'queue': 'deferred'})
    submitted = send(settings, '/api/public/applications/current/submit',
        {'method': 'POST', 'cookie': application.cookie, 'body': {}})
    expect(submitted, 200, 'pending submit')
    assert submitted.decode()['application']['status'] == 'submitted'


def start_review(settings: Settings, application: Application, staff_cookie: str) -> None:
    """Use the existing Start Review transition before initial non-clean recovery."""
    detail = send(settings, f'/api/staff/applications/{application.identifier}', {'cookie': staff_cookie})
    expect(detail, 200, 'submitted detail')
    expect(send(settings, f'/api/staff/applications/{application.identifier}/status', {'method': 'POST',
        'cookie': staff_cookie, 'body': {'target_status': 'under_review',
            'expected_updated_at': detail.decode()['application']['updated_at']}}), 200, 'start review')


def replace_from_second_owner(settings: Settings, application: Application) -> Revision:
    """Use new-device owner authority and reject replacement of an unrequested code."""
    second = login(settings, application, application.code)
    expect(second, 200, 'recovery second device')
    assert second.cookie and second.cookie != application.cookie
    remote_owner = Application(application.identifier, application.reference, application.code, second.cookie)
    eligibility = send(settings, '/api/public/applications/current/documents/resubmission-eligibility',
        {'cookie': second.cookie})
    expect(eligibility, 200, 'recovery eligibility')
    assert [(row['code'], row['mode']) for row in eligibility.decode()['documents']] == [('passport', 'first_replacement')]
    expect(send(settings, '/api/public/applications/current/documents/resubmission-upload-intent', {
        'method': 'POST', 'cookie': second.cookie, 'body': {'code': 'student_certificate',
        'filename': 'synthetic', 'media_type': 'application/pdf', 'byte_size': 20}}), 409, 'unrequested replacement')
    return finalize_file(settings, remote_owner, {'fixture': 'clean.pdf', 'media_type': 'application/pdf', 'kind': 'replacement'})


def prove_initial_recovery(settings: Settings, staff_cookie: str, scenario: dict[str, object]) -> None:
    """Prove actual initial unsafe/terminal failed → reasoned replacement → actual clean/approval."""
    application = create_application(settings)
    initial = finalize_file(settings, application, {'fixture': str(scenario['fixture']), 'media_type': str(scenario['media_type'])})
    submit_pending_application(settings, application)
    for _attempt in range(int(scenario['attempts'])):
        query(settings, "UPDATE document_scan_jobs SET available_at='2026-01-01T00:00:00.000Z' "
            f"WHERE id='{initial.job_identifier}' AND status='queued'")
        run_scanner(settings, str(scenario['outcome']))
    result = query(settings, f"SELECT status, attempts FROM document_scan_jobs WHERE id='{initial.job_identifier}'")[0]
    assert result['attempts'] == scenario['attempts'] and result['status'] == scenario['job_status']
    start_review(settings, application, staff_cookie)
    gates = {'cookie': staff_cookie, 'revision': 1, 'outcome': scenario['outcome']}
    check_gates(settings, application, gates)
    request_replacement(settings, application, {'cookie': staff_cookie, 'revision': 1})
    replacement = replace_from_second_owner(settings, application)
    assert replacement.job_identifier != initial.job_identifier and replacement.revision_identifier != initial.revision_identifier
    check_gates(settings, application, {**gates, 'revision': 2, 'outcome': 'pending'})
    run_scanner(settings, 'clean')
    check_gates(settings, application, {**gates, 'revision': 2, 'outcome': 'clean', 'archive': 'blocked'})
    expect(send(settings, f'/api/staff/applications/{application.identifier}/documents/passport/approve', {
        'method': 'POST', 'cookie': staff_cookie, 'body': {'expected_revision_number': 2}}), 200, 'recovered approval')
    assert query(settings, f"SELECT scan_status FROM document_revision_files WHERE id='{initial.file_identifier}'")[0]['scan_status'] == scenario['outcome']


def write_safe_evidence(settings: Settings, runtime: dict[str, object]) -> None:
    """Write only assertion labels and safe engine/runtime metadata after the whole run passes."""
    evidence = {'status': 'PASS', 'runtime': runtime, 'scans': query(settings,
            'SELECT status,attempts,outcome,result_code,engine_version,signature_version,signature_updated_at,scanned_at FROM document_scan_jobs ORDER BY rowid'),
            'checks': ['20-shared-IP-drafts-and-public-lookups', 'single-active-campus-draft', 'staff-detail-reference-without-code-hash',
                'distinct-owner-sessions', '65-valid-same-NAT-logins', 'invalid-and-reference-only-denial',
                'PATCH-conflict', 'initial-clean', 'replacement-clean', 'replacement-EICAR-unsafe', 'pending-unsafe-staff-gates',
                'exact-download-archive-bytes', 'scanner-auth-denial', 'staff-reset-revocation', 'owner-regeneration', 'terminal-denial', 'tmp-empty',
                'supported-local-staff-bootstrap-login', 'lost-draft-private-read-only-lookup-api-reset',
                'lost-draft-old-code-cookies-rejected-stable-reference', 'pending-owner-submit-and-staff-start-review',
                'initial-unsafe-recovery', 'initial-terminal-failed-recovery', 'distinct-owner-requested-replacement-only',
                'new-current-pending-job-real-clean-access-approval-old-verdict-preserved', 'ZIP-blocked-while-other-documents-pending'],
            'limitations': ['synthetic-local-identity-check', 'local-R2-CLI-PUT', 'legacy-synthetic-review-state',
                'synthetic-queue-clock', 'other-required-submit-files-remain-pending', 'no-physical-browser-or-remote-UAT']}
    settings.output.write_text(json.dumps(evidence, indent=2) + '\n')


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
        staff_cookie = authenticate_staff(settings)
        prove_scanning(settings, application, staff_cookie)
        prove_reset(settings, application, (staff_cookie, second_cookie))
        prove_lost_draft(settings, staff_cookie)
        prove_initial_recovery(settings, staff_cookie, {'fixture': 'eicar.png', 'media_type': 'image/png',
            'outcome': 'unsafe', 'attempts': 1, 'job_status': 'complete'})
        prove_initial_recovery(settings, staff_cookie, {'fixture': 'encrypted.pdf', 'media_type': 'application/pdf',
            'outcome': 'failed', 'attempts': 3, 'job_status': 'failed'})
        write_safe_evidence(settings, runtime)
        LOGGER.info('native_acceptance PASS; safe evidence saved')
        return 0
    except Exception as error:
        LOGGER.error('native_acceptance FAILED type=%s detail=%s', type(error).__name__, str(error) if isinstance(error, AssertionError) else 'redacted')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
