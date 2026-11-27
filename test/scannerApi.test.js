import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/server/worker.js';
import { TestD1Database } from './helpers/d1-test-binding.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { createScannerRepository } from '../src/server/repositories/d1/scanner-repository.js';

const SECRET = 's'.repeat(43);
const APPLICATION_ID = 'a1111111-1111-4111-8111-111111111111';
const KEY = 'quarantine/00000000-0000-4000-8000-000000000001';
const BYTES = new TextEncoder().encode('%PDF-1.7\nsynthetic scan fixture\n%%EOF');
function fixture() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    database.exec(`
        INSERT INTO students(id, student_number, normalized_student_number) VALUES ('s', 'SCAN', 'SCAN');
        INSERT INTO applications(id, student_id, application_type) VALUES ('${APPLICATION_ID}', 's', 'initial');
        INSERT INTO document_records(id, application_id, requirement_id, application_type) VALUES ('d', '${APPLICATION_ID}', 'req-initial-passport', 'initial');
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

test('scoped scanner claim leases only jobs belonging to the requested applications', async () => {
    const { environment } = fixture();

    const outOfScope = await request(environment, 'claim', {
        body: { runner_id: 'synthetic-mac', application_ids: ['b2222222-2222-4222-8222-222222222222'] }
    });
    const inScope = await request(environment, 'claim', {
        body: { runner_id: 'synthetic-mac', application_ids: [APPLICATION_ID] }
    });
    const job = (await inScope.json()).job;

    assert.equal((await outOfScope.json()).job, null);
    assert.equal(job.file_id, 'f');
});

test('scanner rejects malformed, empty, duplicate and oversized application scopes', async () => {
    const { environment } = fixture();
    const invalidScopes = [[], ['not-an-id'], [APPLICATION_ID, APPLICATION_ID], Array(51).fill(APPLICATION_ID)];

    for (const application_ids of invalidScopes) {
        const response = await request(environment, 'claim', { body: { runner_id: 'synthetic-mac', application_ids } });
        assert.equal(response.status, 400);
    }
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

test('unsupported content is terminal for the current revision and cannot be operator-retried', async () => {
    const { environment, database } = fixture();
    const job = await lease(environment);
    const body = await resultBody(environment, job);
    body.outcome = 'failed';
    body.result_code = 'unsupported_content';
    body.full_scan = false;

    const response = await request(environment, `jobs/${job.id}/result`, { body, token: job.lease_token });

    assert.equal(response.status, 200);
    const storedJob = database.prepare('SELECT status,attempts,outcome,result_code FROM document_scan_jobs').first();
    assert.equal(storedJob.status, 'failed');
    assert.equal(storedJob.attempts, 1);
    assert.equal(storedJob.outcome, 'failed');
    assert.equal(storedJob.result_code, 'unsupported_content');
    assert.equal(database.prepare("SELECT scan_status FROM document_revision_files WHERE id='f'").first().scan_status, 'failed');
    assert.equal(await createScannerRepository(database).retry({
        jobId: job.id, now: new Date().toISOString(), staffId: 'staff-reviewer', requestId: 'req-test'
    }), false);
    assert.equal(database.prepare('SELECT attempts FROM document_scan_jobs').first().attempts, 1);
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

test('ready heartbeat accepts signature_updated_at up to 72 hours old and rejects 4 days old', async () => {
    const { environment, database } = fixture();
    const ready = { runner_id: 'mac', health: 'ready', engine_version: '1.5.4', signature_version: '28141' };
    const acceptedTimestamp = new Date(Date.now() - 48 * 3_600_000).toISOString();
    const rejectedTimestamp = new Date(Date.now() - 4 * 86_400_000).toISOString();

    const rejected = await request(environment, 'heartbeat', { body: { ...ready, signature_updated_at: rejectedTimestamp } });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).error.code, 'INVALID_SCANNER_INPUT');
    assert.equal(database.prepare('SELECT count(*) AS count FROM scanner_heartbeats').first().count, 0);

    const accepted = await request(environment, 'heartbeat', { body: { ...ready, signature_updated_at: acceptedTimestamp } });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).recorded, true);
    assert.equal(database.prepare('SELECT count(*) AS count FROM scanner_heartbeats').first().count, 1);
});

test('scan result accepts signature_updated_at 48 hours old and rejects 4 days old', async () => {
    const staleFixture = fixture();
    const staleJob = await lease(staleFixture.environment);
    const staleBody = {
        ...await resultBody(staleFixture.environment, staleJob),
        signature_updated_at: new Date(Date.now() - 4 * 86_400_000).toISOString()
    };
    const rejected = await request(staleFixture.environment, `jobs/${staleJob.id}/result`, { body: staleBody, token: staleJob.lease_token });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).error.code, 'INVALID_SCAN_RESULT');
    assert.equal(staleFixture.database.prepare("SELECT scan_status FROM document_revision_files WHERE id='f'").first().scan_status, 'pending');

    const freshFixture = fixture();
    const freshJob = await lease(freshFixture.environment);
    const freshBody = {
        ...await resultBody(freshFixture.environment, freshJob),
        signature_updated_at: new Date(Date.now() - 48 * 3_600_000).toISOString()
    };
    const accepted = await request(freshFixture.environment, `jobs/${freshJob.id}/result`, { body: freshBody, token: freshJob.lease_token });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).recorded, true);
    assert.equal(freshFixture.database.prepare("SELECT scan_status FROM document_revision_files WHERE id='f'").first().scan_status, 'clean');
});

test('scanner heartbeat records health without reconciling the queue', async () => {
    const { environment, database } = fixture();
    const originalPrepare = database.prepare.bind(database);
    const reconciliationQueries = [];
    database.prepare = (sql) => {
        if (sql.includes('INSERT OR IGNORE INTO document_scan_jobs')) reconciliationQueries.push(sql);
        return originalPrepare(sql);
    };
    const body = { runner_id: 'mac', health: 'ready', engine_version: '1.5.4', signature_version: '28141',
        signature_updated_at: new Date().toISOString() };

    const response = await request(environment, 'heartbeat', { body });

    assert.equal(response.status, 200);
    assert.equal(reconciliationQueries.length, 0);
});

test('production scanner claims leave queue repair to the five-minute schedule', async () => {
    const { environment, database } = fixture();
    environment.APP_ENV = 'production';
    const originalPrepare = database.prepare.bind(database);
    const reconciliationQueries = [];
    database.prepare = (sql) => {
        if (sql.includes('INSERT OR IGNORE INTO document_scan_jobs')) reconciliationQueries.push(sql);
        return originalPrepare(sql);
    };

    const response = await request(environment, 'claim', { body: { runner_id: 'production-runner' } });

    assert.equal(response.status, 200);
    assert.equal(reconciliationQueries.length, 0);
});

test('staging scanner claims do not run recurring queue reconciliation', async () => {
    const { environment, database } = fixture();
    environment.APP_ENV = 'staging';
    const originalPrepare = database.prepare.bind(database);
    const reconciliationQueries = [];
    database.prepare = (sql) => {
        if (sql.includes('INSERT OR IGNORE INTO document_scan_jobs')) reconciliationQueries.push(sql);
        return originalPrepare(sql);
    };

    const response = await request(environment, 'claim', { body: { runner_id: 'staging-runner' } });

    assert.equal(response.status, 200);
    assert.equal(reconciliationQueries.length, 0);
});

test('scanner status reads do not reconcile or write the queue', async () => {
    const { environment, database } = fixture();
    const originalPrepare = database.prepare.bind(database);
    const reconciliationQueries = [];
    database.prepare = (sql) => {
        if (sql.includes('INSERT OR IGNORE INTO document_scan_jobs')) reconciliationQueries.push(sql);
        return originalPrepare(sql);
    };

    const response = await request(environment, 'status', { method: 'GET' });

    assert.equal(response.status, 200);
    assert.equal(reconciliationQueries.length, 0);
});

test('scanner status reads job counts from the maintained status table', async () => {
    const { database } = fixture();
    const statements = [];
    const observedDatabase = {
        prepare(sql) {
            statements.push(sql);
            return database.prepare(sql);
        },
        batch: statements_ => database.batch(statements_)
    };

    const scanner = createScannerRepository(observedDatabase);
    await scanner.reconcile('2026-10-30T00:00:00.000Z');
    const status = await scanner.readStatus();

    const countsSql = statements.find(sql => sql.includes('GROUP BY status')
        || sql.includes('FROM document_scan_job_status_counts'));
    assert.ok(countsSql);
    const plan = database.prepare(`EXPLAIN QUERY PLAN ${countsSql}`).all().results
        .map(row => row.detail).join('\n');
    assert.deepEqual(status.jobs.map(row => ({ status: row.status, count: row.count })),
        [{ status: 'queued', count: 1 }]);
    assert.match(countsSql, /FROM document_scan_job_status_counts/);
    assert.doesNotMatch(plan, /SCAN document_scan_jobs/);
});

test('production five-minute schedule repairs the scanner queue', async () => {
    const { environment, database } = fixture();
    environment.APP_ENV = 'production';
    const originalPrepare = database.prepare.bind(database);
    const reconciliationQueries = [];
    database.prepare = (sql) => {
        if (sql.includes('INSERT OR IGNORE INTO document_scan_jobs')) reconciliationQueries.push(sql);
        return originalPrepare(sql);
    };

    await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: new Date('2026-10-07T12:05:00.000Z') }, environment);

    assert.equal(reconciliationQueries.length, 1);
});

test('replacement scan resumes review only after all current documents are clean and office requests are resolved', async () => {
    for (const condition of ['ready', 'requested', 'pending', 'unsafe', 'failed']) {
        const { environment, database } = fixture();
        database.prepare("UPDATE applications SET status='resubmission_required' WHERE id=?").bind(APPLICATION_ID).run();
        database.prepare(`INSERT INTO application_notes(id,application_id,document_record_id,visibility,body,author_type)
            VALUES ('note',?,'d','student','Please replace','system')`).bind(APPLICATION_ID).run();
        if (condition === 'requested') {
            database.prepare(`INSERT INTO document_records(id,application_id,requirement_id,application_type,review_status)
                VALUES ('requested',?,'req-initial-photographs','initial','resubmission_required')`).bind(APPLICATION_ID).run();
        }
        if (condition === 'pending') {
            database.exec(`INSERT INTO document_revision_files(id,revision_id,page_order,storage_key,original_filename,media_type,byte_size,upload_status,scan_status)
                VALUES ('other','r',1,'quarantine/other','other.pdf','application/pdf',12,'finalized','pending')`);
        }
        const job = await lease(environment);
        const body = await resultBody(environment, job);
        if (condition === 'unsafe') Object.assign(body, { outcome: 'unsafe', result_code: 'malware' });
        if (condition === 'failed') Object.assign(body, { outcome: 'failed', result_code: 'engine_unavailable', full_scan: false,
            object_etag: null, sha256: null, engine_version: null, signature_version: null, signature_updated_at: null });
        const response = await request(environment, `jobs/${job.id}/result`, { body, token: job.lease_token });
        assert.equal(response.status, 200, condition);
        assert.equal(database.prepare('SELECT status FROM applications WHERE id=?').bind(APPLICATION_ID).first().status,
            condition === 'ready' ? 'under_review' : 'resubmission_required', condition);
    }
});

test('readStatus returns current non-deleted failed and unsafe jobs with applicant metadata and caps at 50', async () => {
    const { environment, database } = fixture();
    const repository = createScannerRepository(database);

    // Seed 1 superseded (is_current=0) failed revision: must NOT be listed
    database.exec(`
        INSERT INTO students(id, student_number, normalized_student_number) VALUES ('s-sup', 'SUP-1', 'SUP-1');
        INSERT INTO applications(id, student_id, application_type, status, first_name, last_name)
          VALUES ('app-sup', 's-sup', 'initial', 'under_review', 'Eski', 'Revizyon');
        INSERT INTO document_records(id, application_id, requirement_id, application_type)
          VALUES ('d-sup', 'app-sup', 'req-initial-passport', 'initial');
        INSERT INTO document_revisions(id, document_record_id, revision_number, status, is_current, submitted_by_type)
          VALUES ('r-sup-old', 'd-sup', 1, 'submitted', 0, 'student'),
                 ('r-sup-new', 'd-sup', 2, 'submitted', 1, 'student');
        INSERT INTO document_revision_files(id, revision_id, page_order, storage_key, original_filename, media_type, byte_size, upload_status, scan_status)
          VALUES ('f-sup-old', 'r-sup-old', 0, 'quarantine/sup-old', 'old.pdf', 'application/pdf', 20, 'finalized', 'failed'),
                 ('f-sup-new', 'r-sup-new', 0, 'quarantine/sup-new', 'new.pdf', 'application/pdf', 20, 'finalized', 'clean');
    `);

    // Seed 1 deleted application with failed file: must NOT be listed
    database.exec(`
        INSERT INTO staff_users(id, username, normalized_username, password_hash, display_name, role)
          VALUES ('staff-del', 'staffdel', 'staffdel', 'hash', 'Staff Del', 'admin');
        INSERT INTO students(id, student_number, normalized_student_number) VALUES ('s-del', 'DEL-1', 'DEL-1');
        INSERT INTO applications(id, student_id, application_type, status, first_name, last_name)
          VALUES ('app-del', 's-del', 'initial', 'under_review', 'Silinen', 'Basvuru');
        INSERT INTO application_deletions(application_id, previous_status, state, deleted_by_staff_id, deleted_at, purge_started_at)
          VALUES ('app-del', 'under_review', 'soft_deleted', 'staff-del', '2026-11-27T00:00:00.000Z', NULL);
        INSERT INTO document_records(id, application_id, requirement_id, application_type)
          VALUES ('d-del', 'app-del', 'req-initial-passport', 'initial');
        INSERT INTO document_revisions(id, document_record_id, revision_number, status, is_current, submitted_by_type)
          VALUES ('r-del', 'd-del', 1, 'submitted', 1, 'student');
        INSERT INTO document_revision_files(id, revision_id, page_order, storage_key, original_filename, media_type, byte_size, upload_status, scan_status)
          VALUES ('f-del', 'r-del', 0, 'quarantine/del', 'del.pdf', 'application/pdf', 20, 'finalized', 'failed');
    `);

    // Seed 51 current non-deleted failed/unsafe files (i=0 and i=1 are newest; i=50 is oldest and capped out)
    for (let i = 0; i < 51; i += 1) {
        const suffix = String(i).padStart(2, '0');
        const reverseSec = String(50 - i).padStart(2, '0');
        const scanStatus = i === 0 ? 'unsafe' : 'failed';
        const resultCode = i === 0 ? 'malware' : 'scan_timeout';
        const appStatus = i === 0 ? 'submitted' : i === 1 ? 'sent_to_migration' : 'under_review';
        database.exec(`
            INSERT INTO students(id, student_number, normalized_student_number) VALUES ('s-${suffix}', 'STU-${suffix}', 'STU-${suffix}');
            INSERT INTO applications(id, student_id, application_type, status, first_name, last_name)
              VALUES ('app-${suffix}', 's-${suffix}', 'initial', '${appStatus}', 'Ad${suffix}', 'Soyad${suffix}');
            INSERT INTO document_records(id, application_id, requirement_id, application_type)
              VALUES ('d-${suffix}', 'app-${suffix}', 'req-initial-passport', 'initial');
            INSERT INTO document_revisions(id, document_record_id, revision_number, status, is_current, submitted_by_type)
              VALUES ('r-${suffix}', 'd-${suffix}', 1, 'submitted', 1, 'student');
            INSERT INTO document_revision_files(id, revision_id, page_order, storage_key, original_filename, media_type, byte_size, upload_status, scan_status)
              VALUES ('f-${suffix}', 'r-${suffix}', 0, 'quarantine/f-${suffix}', 'doc.pdf', 'application/pdf', 20, 'finalized', '${scanStatus}');
            INSERT INTO upload_intents(id, revision_file_id, idempotency_key, expires_at, status, completed_at)
              VALUES ('i-${suffix}', 'f-${suffix}', 'ik-${suffix}', '2026-11-27T01:00:00.000Z', 'completed', '2026-11-27T00:00:00.000Z');
            INSERT INTO document_scan_jobs(id, file_id, revision_id, storage_key, byte_size, media_type, status, outcome, result_code, attempts, available_at, created_at, updated_at)
              VALUES ('job-${suffix}', 'f-${suffix}', 'r-${suffix}', 'quarantine/f-${suffix}', 20, 'application/pdf',
                      '${i === 0 ? 'complete' : 'failed'}', '${scanStatus}', '${resultCode}', 3,
                      '2026-11-27T00:00:00.000Z', '2026-11-27T00:00:00.000Z', '2026-11-27T00:00:${reverseSec}.000Z');
        `);
    }

    const status = await repository.readStatus();
    assert.equal(status.actionable_failed_total, 51);
    assert.equal(status.failed_jobs.length, 50);
    assert.equal(status.failed_jobs.some((job) => job.application_id === 'app-sup'), false);
    assert.equal(status.failed_jobs.some((job) => job.application_id === 'app-del'), false);
    assert.equal(status.failed_jobs.some((job) => job.application_id === 'app-50'), false);

    // Check unsafe item (i=0) and sent_to_migration item (i=1)
    const unsafeJob = status.failed_jobs.find((job) => job.application_id === 'app-00');
    assert.ok(unsafeJob);
    assert.equal(unsafeJob.scan_status, 'unsafe');
    assert.equal(unsafeJob.student_number, 'STU-00');
    assert.equal(unsafeJob.first_name, 'Ad00');
    assert.equal(unsafeJob.last_name, 'Soyad00');
    assert.equal(unsafeJob.document_code, 'passport');
    assert.equal(unsafeJob.revision_number, 1);
    assert.equal(unsafeJob.application_status, 'submitted');
    assert.equal(unsafeJob.can_request_resubmission, true);

    const migrationJob = status.failed_jobs.find((job) => job.application_id === 'app-01');
    assert.ok(migrationJob);
    assert.equal(migrationJob.can_request_resubmission, false);

    // Machine-only /api/scanner/status omits applicant PII
    const machineResponse = await request(environment, 'status', { method: 'GET' });
    assert.equal(machineResponse.status, 200);
    const machineStatus = await machineResponse.json();
    assert.equal(machineStatus.failed_jobs[0].student_number, undefined);
    assert.equal(machineStatus.failed_jobs[0].first_name, undefined);
});

test('readStatus excludes unfinalized files, incomplete upload intents, and unaccepted media types', async () => {
    const { database } = fixture();
    const repository = createScannerRepository(database);

    database.exec(`
        INSERT INTO students(id, student_number, normalized_student_number)
          VALUES ('s-unfin', 'U-1', 'U-1'), ('s-intent', 'U-2', 'U-2'), ('s-mime', 'U-3', 'U-3');
        INSERT INTO applications(id, student_id, application_type, status, first_name, last_name)
          VALUES ('app-unfin', 's-unfin', 'initial', 'under_review', 'A', 'B'),
                 ('app-intent', 's-intent', 'initial', 'under_review', 'C', 'D'),
                 ('app-mime', 's-mime', 'initial', 'under_review', 'E', 'F');
        INSERT INTO document_records(id, application_id, requirement_id, application_type)
          VALUES ('d-unfin', 'app-unfin', 'req-initial-passport', 'initial'),
                 ('d-intent', 'app-intent', 'req-initial-passport', 'initial'),
                 ('d-mime', 'app-mime', 'req-initial-passport', 'initial');
        INSERT INTO document_revisions(id, document_record_id, revision_number, status, is_current, submitted_by_type)
          VALUES ('r-unfin', 'd-unfin', 1, 'submitted', 1, 'student'),
                 ('r-intent', 'd-intent', 1, 'submitted', 1, 'student'),
                 ('r-mime', 'd-mime', 1, 'submitted', 1, 'student');
        INSERT INTO document_revision_files(id, revision_id, page_order, storage_key, original_filename, media_type, byte_size, upload_status, scan_status)
          VALUES ('f-unfin', 'r-unfin', 0, 'quarantine/u1', 'u1.pdf', 'application/pdf', 20, 'uploaded', 'failed'),
                 ('f-intent', 'r-intent', 0, 'quarantine/u2', 'u2.pdf', 'application/pdf', 20, 'finalized', 'failed'),
                 ('f-mime', 'r-mime', 0, 'quarantine/u3', 'u3.txt', 'text/plain', 20, 'finalized', 'failed');
        INSERT INTO upload_intents(id, revision_file_id, idempotency_key, expires_at, status, completed_at)
          VALUES ('i-unfin', 'f-unfin', 'ik-u1', '2026-11-27T01:00:00.000Z', 'completed', '2026-11-27T00:00:00.000Z'),
                 ('i-intent', 'f-intent', 'ik-u2', '2026-11-27T01:00:00.000Z', 'pending', NULL),
                 ('i-mime', 'f-mime', 'ik-u3', '2026-11-27T01:00:00.000Z', 'completed', '2026-11-27T00:00:00.000Z');
    `);

    const status = await repository.readStatus();
    assert.equal(status.actionable_failed_total, 0);
    assert.deepEqual(status.failed_jobs, []);
});
