import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/server/worker.js';
import { TestD1Database } from './helpers/d1-test-binding.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { createScannerRepository } from '../src/server/repositories/d1/scanner-repository.js';

const SECRET = 's'.repeat(43);
const KEY = 'quarantine/00000000-0000-4000-8000-000000000001';
const BYTES = new TextEncoder().encode('%PDF-1.7\nsynthetic scan fixture\n%%EOF');
function fixture() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    database.exec(`
        INSERT INTO students(id, student_number, normalized_student_number) VALUES ('s', 'SCAN', 'SCAN');
        INSERT INTO applications(id, student_id, application_type) VALUES ('a', 's', 'initial');
        INSERT INTO document_records(id, application_id, requirement_id, application_type) VALUES ('d', 'a', 'req-initial-passport', 'initial');
        INSERT INTO document_revisions(id, document_record_id, revision_number, status, is_current, submitted_by_type) VALUES ('r', 'd', 1, 'submitted', 1, 'student');
        INSERT INTO document_revision_files(id,revision_id,page_order,storage_key,original_filename,media_type,byte_size,upload_status,scan_status)
          VALUES ('f','r',0,'${KEY}','synthetic.pdf','application/pdf',${BYTES.length},'finalized','pending');
        INSERT INTO upload_intents(id, revision_file_id, idempotency_key, expires_at,status,completed_at)
          VALUES ('i','f','ik','2026-01-01T00:00:00.000Z','completed','2026-01-01T00:00:00.000Z');
    `);
    let etag = 'object-v1';
    const bucket = {
        head: async () => ({ etag, size: BYTES.length, httpMetadata: { contentType: 'application/pdf' } }),
        get: async (_key, options) => options?.onlyIf?.etagMatches !== etag ? null : ({ etag, size: BYTES.length,
            httpMetadata: { contentType: 'application/pdf' }, arrayBuffer: async () => BYTES.slice().buffer })
    };
    return { database, environment: { DB: database, DOCUMENTS: bucket, SCANNER_SECRET: SECRET, APP_ENV: 'local' },
        changeObject: () => { etag = 'object-v2'; } };
}
async function request(environment, path, { method = 'POST', body = {}, secret = SECRET, token } = {}) {
    return worker.fetch(new Request(`https://scanner.test/api/scanner/${path}`, { method,
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...(token ? { 'X-Scan-Lease': token } : {}) },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) }), environment);
}
async function lease(environment) {
    const response = await request(environment, 'claim', { body: { runner_id: 'synthetic-mac' } });
    assert.equal(response.status, 200);
    return (await response.json()).job;
}
async function resultBody(environment, job) {
    const response = await request(environment, `jobs/${job.id}/content`, { method: 'GET', token: job.lease_token });
    assert.equal(response.status, 200);
    const sha256 = response.headers.get('X-Content-SHA256');
    await response.arrayBuffer();
    return { file_id: job.file_id, revision_id: job.revision_id, storage_key: job.storage_key, byte_size: job.byte_size,
        object_etag: response.headers.get('X-Object-ETag'), sha256, outcome: 'clean', result_code: 'scanned',
        engine_version: '1.5.4', signature_version: '1234', signature_updated_at: new Date().toISOString(),
        scanned_at: new Date().toISOString(), full_scan: true, policy_version: 'clamav-full-v1' };
}

test('scanner requires dedicated secret; staff or anonymous callers cannot claim or submit results', async () => {
    const { environment } = fixture();

    const response = await request(environment, 'claim', { secret: 'wrong', body: { runner_id: 'mac' } });

    assert.equal(response.status, 401);
    assert.equal((await request(environment, 'jobs/random/result', { secret: 'wrong' })).status, 401);
});

test('authorized exact-content clean result is durable; replay and a different lease are rejected', async () => {
    const { environment, database } = fixture();
    const job = await lease(environment);
    const body = await resultBody(environment, job);

    const denied = await request(environment, `jobs/${job.id}/result`, { body, token: 'wrong' });
    const response = await request(environment, `jobs/${job.id}/result`, { body, token: job.lease_token });

    assert.equal(denied.status, 409);
    assert.equal(response.status, 200);
    assert.equal(database.prepare("SELECT scan_status FROM document_revision_files WHERE id='f'").first().scan_status, 'clean');
    assert.equal((await request(environment, `jobs/${job.id}/result`, { body, token: job.lease_token })).status, 409);
    const storedJob = database.prepare('SELECT * FROM document_scan_jobs').first();
    assert.equal(storedJob.content_sha256, body.sha256);
    assert.equal(storedJob.engine_version, '1.5.4');
});

test('mismatched file, digest, object, old revision, stale signatures and incomplete scan cannot become clean', async () => {
    for (const failure of ['file', 'digest', 'object', 'revision', 'stale', 'partial', 'expired']) {
        const { environment, database, changeObject } = fixture();
        const job = await lease(environment);
        const body = await resultBody(environment, job);
        if (failure === 'file') body.file_id = 'another-file';
        if (failure === 'digest') body.sha256 = '0'.repeat(64);
        if (failure === 'object') changeObject();
        if (failure === 'revision') database.exec("UPDATE document_revisions SET is_current=0 WHERE id='r'");
        if (failure === 'stale') body.signature_updated_at = '2026-01-01T00:00:00.000Z';
        if (failure === 'partial') body.full_scan = false;
        if (failure === 'expired') database.exec("UPDATE document_scan_jobs SET lease_until='2026-01-01T00:00:00.000Z'");

        const response = await request(environment, `jobs/${job.id}/result`, { body, token: job.lease_token });

        assert.ok(response.status >= 400, failure);
        assert.equal(database.prepare("SELECT scan_status FROM document_revision_files WHERE id='f'").first().scan_status, 'pending', failure);
    }
});

test('unsafe result blocks file; engine failure retries then persists failed without content download', async () => {
    const unsafeFixture = fixture();
    const unsafeJob = await lease(unsafeFixture.environment);
    const unsafeBody = { ...await resultBody(unsafeFixture.environment, unsafeJob), outcome: 'unsafe', result_code: 'malware' };
    assert.equal((await request(unsafeFixture.environment, `jobs/${unsafeJob.id}/result`, { body: unsafeBody, token: unsafeJob.lease_token })).status, 200);
    assert.equal(unsafeFixture.database.prepare("SELECT scan_status FROM document_revision_files WHERE id='f'").first().scan_status, 'unsafe');
    const { database, environment } = fixture();
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const job = await lease(environment);
        const body = { file_id: job.file_id, revision_id: job.revision_id, storage_key: job.storage_key, byte_size: job.byte_size,
            object_etag: null, sha256: null, outcome: 'failed', result_code: 'engine_unavailable', engine_version: null,
            signature_version: null, signature_updated_at: null, scanned_at: new Date().toISOString(), full_scan: false, policy_version: 'clamav-full-v1' };

        assert.equal((await request(environment, `jobs/${job.id}/result`, { body, token: job.lease_token })).status, 200);
        database.exec("UPDATE document_scan_jobs SET available_at='2026-01-01T00:00:00.000Z'");
    }
    assert.equal(database.prepare("SELECT scan_status FROM document_revision_files WHERE id='f'").first().scan_status, 'failed');
    assert.equal((await createScannerRepository(database).readStatus()).failed_jobs.length, 1);
});

test('a lease that expires during result I/O is rejected at the database commit boundary', async () => {
    const { environment, database } = fixture();
    const job = await lease(environment);
    const body = await resultBody(environment, job);
    const readHead = environment.DOCUMENTS.head;
    environment.DOCUMENTS.head = async () => {
        database.prepare('UPDATE document_scan_jobs SET lease_until=?').bind(new Date(Date.now() + 5).toISOString()).run();
        await new Promise((resolve) => setTimeout(resolve, 20));
        return readHead();
    };

    const response = await request(environment, `jobs/${job.id}/result`, { body, token: job.lease_token });

    assert.equal(response.status, 409);
    assert.equal(database.prepare("SELECT scan_status FROM document_revision_files WHERE id='f'").first().scan_status, 'pending');
});

test('ready heartbeat requires real, fresh signature time and complete engine metadata', async () => {
    const { environment, database } = fixture();
    const ready = { runner_id: 'mac', health: 'ready', engine_version: '1.5.4', signature_version: '28141',
        signature_updated_at: new Date().toISOString() };

    for (const change of [{ signature_updated_at: '2026-99-99TinvalidZ' }, { signature_updated_at: '2026-01-01T00:00:00.000Z' }, { engine_version: null }]) {
        const response = await request(environment, 'heartbeat', { body: { ...ready, ...change } });
        assert.equal(response.status, 400);
    }

    assert.equal(database.prepare('SELECT count(*) AS count FROM scanner_heartbeats').first().count, 0);
    assert.equal((await request(environment, 'heartbeat', { body: ready })).status, 200);
});
