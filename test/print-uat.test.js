import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, PageSizes } from 'pdf-lib';
import worker from '../src/server/worker.js';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { readPrintUatPolicy, requirePrintUatContent } from '../src/server/domain/print-uat-policy.js';
import { createPrintRepository } from '../src/server/repositories/d1/printRepository.js';
import { runPrintCleanup } from '../src/server/services/printCleanupService.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const PDF_BYTES = await createSyntheticPdf();
const PRINTER_SECRET = 'A'.repeat(48);
const STAFF_TOKEN = 'S'.repeat(43);
const STAFF_HEADERS = { Cookie: `staff_session=${STAFF_TOKEN}` };
const MACHINE_HEADERS = { Authorization: `Bearer ${PRINTER_SECRET}` };

/**
 * Create a deterministic portrait PDF entirely from synthetic test content.
 * @returns {Promise<Uint8Array>} One unrotated A4 page with visible orientation markers.
 */
async function createSyntheticPdf() {
    const document = await PDFDocument.create();
    const fixtureDate = new Date('2026-01-01T00:00:00.000Z');
    document.setCreationDate(fixtureDate);
    document.setModificationDate(fixtureDate);
    const page = document.addPage(PageSizes.A4);
    page.drawText('SYNTHETIC PRINT UAT - TOP', { x: 40, y: 790, size: 14 });
    page.drawText('BOTTOM - A4 PORTRAIT SOURCE', { x: 40, y: 40, size: 14 });
    return await document.save({ useObjectStreams: false });
}

function request(path, options = {}) {
    const headers = new Headers({ Origin: 'https://portal.test', 'CF-Connecting-IP': '198.51.100.30', ...options.headers });
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    return new Request(`https://portal.test${path}`, { method: options.method || 'GET', headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body) });
}

function wrapAsyncStatement(statement) {
    return { bind: (...values) => wrapAsyncStatement(statement.bind(...values)),
        first: () => statement.first(), run: () => statement.run(),
        async all() { return statement.all(); } };
}

function createTestDatabase() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const prepareStatement = database.prepare.bind(database);
    // Real D1 all() returns a Promise; the shared SQLite adapter is synchronous.
    database.prepare = (sql) => wrapAsyncStatement(prepareStatement(sql));
    return database;
}

async function seedStaff(database) {
    await database.prepare(`INSERT INTO staff_users(id,username,normalized_username,password_hash,display_name,role)
        VALUES('uat-staff','uat-staff','uat-staff','test-hash','UAT Staff','reviewer')`).run();
    await database.prepare(`INSERT INTO staff_sessions(id,staff_user_id,token_hash,expires_at)
        VALUES('uat-session','uat-staff',?,?)`).bind(await hashSessionToken(STAFF_TOKEN),
        new Date(Date.now() + 3_600_000).toISOString()).run();
}

function createTestBucket(objects) {
    return {
        async head(key) { const object = objects.get(key); return object ? { size: object.size,
            etag: object.etag, httpMetadata: { contentType: object.type } } : null; },
        async get(key) { return objects.get(key) || null; }, async delete(key) { objects.delete(key); },
        async put(key, bytes, options) {
            assert.equal(options.onlyIf.etagDoesNotMatch, '*');
            if (objects.has(key)) return null;
            const object = Object.assign(new Blob([bytes], { type: options.httpMetadata.contentType }), { etag: 'test-etag' });
            objects.set(key, object);
            return object;
        }
    };
}

async function createEnvironment() {
    const database = createTestDatabase();
    const objects = new Map();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', PDF_BYTES));
    const environment = { DB: database, PRINT_FILES: createTestBucket(objects), APP_ENV: 'test', STAFF_SHARED_USERNAME: 'uat-staff', PRINT_ENABLED: 'false', PRINTER_SECRET,
    PRINT_BUCKET_NAME: 'test-print', R2_ACCOUNT_ID: 'account', PRINT_R2_ACCESS_KEY_ID: 'test-access',
    PRINT_R2_SECRET_ACCESS_KEY: 'test-secret', PRINT_UAT_ENABLED: 'true',
    PRINT_UAT_STARTED_AT: new Date(Date.now() - 1000).toISOString(),
    PRINT_UAT_EXPIRES_AT: new Date(Date.now() + 600_000).toISOString(),
    PRINT_UAT_DOCUMENT_SHA256: [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('') };
    await seedStaff(database);
    await worker.fetch(request('/api/printer/heartbeat', { method: 'POST', headers: MACHINE_HEADERS,
        body: { printer_id: 'uat-printer', runner_id: 'uat-runner', printer_name: 'Mock Kyocera',
            health: 'ready', settings_protocol: 3 } }), environment);
    return { environment, database, objects };
}

function uploadPayload(overrides = {}) {
    return { byte_size: PDF_BYTES.length, media_type: 'application/pdf', copies: 1, paper_size: 'A4',
        color_mode: 'monochrome', duplex: 'simplex', orientation: 'landscape',
        idempotency_key: 'a'.repeat(64), upload_token: 'b'.repeat(64), tracking_token: 'c'.repeat(64), ...overrides };
}

async function createIntent(context, overrides = {}) {
    return worker.fetch(request('/api/public/print/upload-intents', { method: 'POST',
        headers: STAFF_HEADERS, body: uploadPayload(overrides) }), context.environment);
}

async function finalize(context, jobId) {
    return worker.fetch(request(`/api/public/print/jobs/${jobId}/finalize`, { method: 'POST',
        headers: { ...STAFF_HEADERS, 'X-Print-Upload-Token': 'b'.repeat(64) }, body: {} }), context.environment);
}

function putObject(context, jobId, bytes = PDF_BYTES) {
    const { storage_key: storageKey } = context.database.prepare('SELECT storage_key FROM print_jobs WHERE id=?').bind(jobId).first();
    context.objects.set(storageKey, Object.assign(new Blob([bytes], { type: 'application/pdf' }), { etag: 'test-etag' }));
}

test('synthetic UAT fixture is one unrotated A4 portrait page with independently selected landscape printing', async () => {
    const document = await PDFDocument.load(PDF_BYTES);
    const [page] = document.getPages();

    assert.equal(document.getPageCount(), 1);
    assert.deepEqual([page.getWidth(), page.getHeight()], PageSizes.A4);
    assert.equal(page.getRotation().angle, 0);
    assert.ok(page.getHeight() > page.getWidth());
    assert.equal(uploadPayload().orientation, 'landscape');
    assert.equal(uploadPayload().byte_size, PDF_BYTES.length);
});

test('UAT policy fails closed for missing, malformed, future, expired and oversized windows', () => {
    const now = Date.now();
    const base = { PRINT_ENABLED: 'false', PRINT_UAT_ENABLED: 'true', PRINT_UAT_DOCUMENT_SHA256: 'a'.repeat(64),
        PRINT_UAT_STARTED_AT: new Date(now - 1000).toISOString(), PRINT_UAT_EXPIRES_AT: new Date(now + 1000).toISOString() };
    const invalid = [{ PRINT_ENABLED: undefined }, { PRINT_ENABLED: false }, { PRINT_ENABLED: 'TRUE' }, { PRINT_UAT_ENABLED: true }, { PRINT_UAT_ENABLED: 'TRUE' }, { PRINT_UAT_ENABLED: undefined },
        { PRINT_UAT_STARTED_AT: undefined }, { PRINT_UAT_EXPIRES_AT: 'invalid' }, { PRINT_UAT_EXPIRES_AT: 123 },
        { PRINT_UAT_STARTED_AT: '2026-01-01 12:00:00' },
        { PRINT_UAT_STARTED_AT: new Date(now + 500).toISOString() },
        { PRINT_UAT_EXPIRES_AT: new Date(now).toISOString() },
        { PRINT_UAT_EXPIRES_AT: new Date(now + 900_000).toISOString() }, { PRINT_UAT_DOCUMENT_SHA256: 'wrong' }];

    for (const override of invalid) assert.equal(readPrintUatPolicy({ ...base, ...override }, now), null);
    assert.ok(readPrintUatPolicy(base, now));
    assert.equal(readPrintUatPolicy(base, NaN), null);
});

test('UAT requires real staff sessions even when students forge browser or machine headers', async () => {
    const { environment, database } = await createEnvironment();

    for (const headers of [{}, MACHINE_HEADERS, { 'X-Print-UAT': 'true' },
        { Cookie: `application_session=${STAFF_TOKEN}` }, { Cookie: 'staff_session=forged' }]) {
        const response = await worker.fetch(request('/api/public/print/upload-intents', {
            method: 'POST', headers, body: uploadPayload() }), environment);
        assert.equal(response.status, 401);
    }
    assert.equal(database.prepare('SELECT count(*) AS count FROM print_jobs').first().count, 0);
});

test('UAT rejects inactive, revoked, idle, expired and non-shared staff identities', async () => {
    for (const mutation of ["UPDATE staff_users SET is_active=0", "UPDATE staff_sessions SET revoked_at=datetime('now')",
        "UPDATE staff_sessions SET last_seen_at='2000-01-01T00:00:00.000Z'",
        "UPDATE staff_sessions SET expires_at='2000-01-01T00:00:00.000Z'",
        "UPDATE staff_users SET username='other-staff'"]) {
        const context = await createEnvironment();
        await context.database.prepare(mutation).run();

        const response = await createIntent(context);

        assert.equal(response.status, 401, mutation);
        assert.equal(context.database.prepare('SELECT count(*) AS count FROM print_jobs').first().count, 0);
    }
});

test('UAT availability and job tracking require staff while machine claims still require the printer secret', async () => {
    const { environment } = await createEnvironment();

    const staff = await worker.fetch(request('/api/staff/print/uat/status', { headers: STAFF_HEADERS }), environment);
    const anonymous = await worker.fetch(request('/api/public/print/status'), environment);
    const tracking = await worker.fetch(request('/api/public/print/jobs/status'), environment);
    const machine = await worker.fetch(request('/api/printer/claim', { method: 'POST', body: { runner_id: 'uat-runner' } }), environment);

    assert.equal(staff.status, 200);
    const status = await staff.json();
    assert.equal(status.available, true);
    assert.equal(status.options.limits.max_copies, 1);
    assert.equal(status.options.limits.max_page_copies, 200);
    assert.equal(anonymous.status, 200);
    assert.equal((await anonymous.json()).available, false);
    assert.equal(tracking.status, 401);
    assert.equal(machine.status, 401);
});

test('UAT rejects cross-origin creation and finalization with a valid staff cookie', async () => {
    const context = await createEnvironment();

    for (const path of ['/api/public/print/upload-intents', '/api/public/print/jobs/job-1/finalize']) {
        const response = await worker.fetch(request(path, { method: 'POST',
            headers: { ...STAFF_HEADERS, Origin: 'https://attacker.test' }, body: uploadPayload() }), context.environment);
        assert.equal(response.status, 403);
    }
    assert.equal(context.database.prepare('SELECT count(*) AS count FROM print_jobs').first().count, 0);
});

test('UAT accepts only one PDF copy with A4 monochrome simplex settings', async () => {
    for (const overrides of [{ copies: 2 }, { media_type: 'image/png' }, { paper_size: 'A3' },
        { color_mode: 'color' }, { duplex: 'duplexlong' }]) {
        const context = await createEnvironment();

        const response = await createIntent(context, overrides);

        assert.equal(response.status, 400);
        assert.equal(context.database.prepare('SELECT count(*) AS count FROM print_jobs').first().count, 0);
    }
});

test('concurrent UAT intents reserve only one job regardless of supplied idempotency keys', async () => {
    const context = await createEnvironment();

    const responses = await Promise.all([createIntent(context), createIntent(context, {
        idempotency_key: 'd'.repeat(64), upload_token: 'e'.repeat(64), tracking_token: 'f'.repeat(64) })]);

    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 503]);
    assert.equal(context.database.prepare('SELECT count(*) AS count FROM print_jobs').first().count, 1);
});

test('repeated UAT submission reuses the same intent rather than adding another job', async () => {
    const context = await createEnvironment();

    const first = await (await createIntent(context)).json();
    const second = await (await createIntent(context)).json();

    assert.equal(first.job_id, second.job_id);
    assert.equal(context.database.prepare('SELECT count(*) AS count FROM print_jobs').first().count, 1);
});

test('a wrong synthetic PDF cannot be finalized or claimed', async () => {
    const context = await createEnvironment();
    const { job_id: jobId } = await (await createIntent(context)).json();
    const changed = PDF_BYTES.slice();
    changed[changed.length - 1] ^= 1;
    putObject(context, jobId, changed);

    const response = await finalize(context, jobId);
    const claim = await worker.fetch(request('/api/printer/claim', { method: 'POST', headers: MACHINE_HEADERS,
        body: { runner_id: 'uat-runner' } }), context.environment);

    assert.equal(response.status, 415);
    assert.equal((await response.json()).error.code, 'PRINT_UAT_DOCUMENT_INVALID');
    assert.equal((await claim.json()).job, null);
});

test('staff UAT follows the existing complete lifecycle with protocol 3 while public printing remains false', async () => {
    const context = await createEnvironment();
    const { job_id: jobId } = await (await createIntent(context)).json();
    assert.equal((await upload(context, jobId)).status, 200);

    assert.equal((await finalize(context, jobId)).status, 200);
    const claimed = await worker.fetch(request('/api/printer/claim', { method: 'POST', headers: MACHINE_HEADERS,
        body: { runner_id: 'uat-runner' } }), context.environment);
    const job = (await claimed.json()).job;
    const headers = { ...MACHINE_HEADERS, 'X-Print-Lease': job.lease_token };
    const content = await worker.fetch(request(`/api/printer/jobs/${jobId}/content`, { headers }), context.environment);
    assert.deepEqual(new Uint8Array(await content.arrayBuffer()), PDF_BYTES);
    for (const [action, body] of [['validation-result', { status: 'ready', page_count: 1 }],
        ['submission-started', {}], ['result', { status: 'submitted', result_code: 'submitted', spooler_job_id: 'mock-spool-1' }]]) {
        const response = await worker.fetch(request(`/api/printer/jobs/${jobId}/${action}`, {
            method: 'POST', headers, body }), context.environment);
        assert.equal(response.status, 200, action);
    }
    const repeated = await worker.fetch(request(`/api/printer/jobs/${jobId}/submission-started`, {
        method: 'POST', headers, body: {} }), context.environment);

    assert.equal(job.orientation, 'landscape');
    assert.equal(job.copies, 1);
    assert.equal(context.environment.PRINT_ENABLED, 'false');
    assert.equal(context.database.prepare('SELECT status FROM print_jobs WHERE id=?').bind(jobId).first().status, 'submitted');
    assert.equal(repeated.status, 409);
});

test('UAT rejects content replaced after finalization before it can reach the Agent', async () => {
    const context = await createEnvironment();
    const { job_id: jobId } = await (await createIntent(context)).json();
    putObject(context, jobId);
    await finalize(context, jobId);
    const claim = await worker.fetch(request('/api/printer/claim', { method: 'POST', headers: MACHINE_HEADERS,
        body: { runner_id: 'uat-runner' } }), context.environment);
    const job = (await claim.json()).job;
    const changed = PDF_BYTES.slice();
    changed[changed.length - 1] ^= 1;
    putObject(context, jobId, changed);

    const response = await worker.fetch(request(`/api/printer/jobs/${jobId}/content`, {
        headers: { ...MACHINE_HEADERS, 'X-Print-Lease': job.lease_token } }), context.environment);

    assert.equal(response.status, 415);
});

test('expired UAT windows stop work and preserve authenticated recovery', async () => {
    const { environment } = await createEnvironment();
    environment.PRINT_UAT_EXPIRES_AT = new Date(Date.now() - 1).toISOString();

    const creation = await worker.fetch(request('/api/public/print/upload-intents', {
        method: 'POST', headers: STAFF_HEADERS, body: uploadPayload() }), environment);
    const claim = await worker.fetch(request('/api/printer/claim', { method: 'POST', headers: MACHINE_HEADERS,
        body: { runner_id: 'uat-runner' } }), environment);
    const recovery = await worker.fetch(request('/api/printer/reconcile', {
        headers: { ...MACHINE_HEADERS, 'X-Printer-Runner': 'uat-runner' } }), environment);

    assert.equal(creation.status, 503);
    assert.equal(claim.status, 503);
    assert.equal(recovery.status, 200);
    await assert.rejects(requirePrintUatContent(PDF_BYTES, environment), { code: 'PRINT_DISABLED' });
});

test('enabling normal production disables UAT restrictions and keeps existing public behavior', async () => {
    const context = await createEnvironment();
    context.environment.PRINT_ENABLED = 'true';

    const response = await worker.fetch(request('/api/public/print/upload-intents', {
        method: 'POST', body: uploadPayload({ copies: 2 }) }), context.environment);

    assert.equal(response.status, 200);
    assert.equal(readPrintUatPolicy(context.environment), null);
});


test('staff UAT upload capabilities point to the authenticated Worker rather than R2 signed URLs', async () => {
    const context = await createEnvironment();

    const intent = await (await createIntent(context)).json();

    assert.equal(intent.upload.url, `/api/public/print/jobs/${intent.job_id}/upload`);
    assert.equal(intent.upload.method, 'PUT');
    assert.equal(intent.upload.url.includes('X-Amz'), false);
});

test('changing UAT windows and purging a test row cannot reserve a second v7 job', async () => {
    const context = await createEnvironment();
    const first = await (await createIntent(context)).json();
    await context.database.prepare('DELETE FROM print_jobs WHERE id=?').bind(first.job_id).run();
    context.environment.PRINT_UAT_STARTED_AT = new Date(Date.now() - 2000).toISOString();
    context.environment.PRINT_UAT_EXPIRES_AT = new Date(Date.now() + 300_000).toISOString();

    const response = await createIntent(context, { idempotency_key: 'd'.repeat(64) });

    assert.equal(response.status, 503);
    assert.equal(context.database.prepare('SELECT count(*) AS count FROM print_jobs').first().count, 0);
});


async function upload(context, jobId, options = {}) {
    const headers = new Headers({ Origin: 'https://portal.test', ...STAFF_HEADERS,
        'Content-Type': 'application/pdf', 'X-Print-Upload-Token': 'b'.repeat(64), ...options.headers });
    const request = new Request(`https://portal.test/api/public/print/jobs/${jobId}/upload`, {
        method: 'PUT', headers, body: options.bytes || PDF_BYTES, duplex: 'half' });
    return worker.fetch(request, context.environment);
}

test('UAT upload rechecks staff authorization, origin and upload token at the actual byte-write boundary', async () => {
    const context = await createEnvironment();
    const { job_id: jobId } = await (await createIntent(context)).json();

    for (const [headers, status] of [[{ Cookie: '' }, 401], [{ Cookie: `application_session=${STAFF_TOKEN}` }, 401],
        [{ Cookie: 'staff_session=forged' }, 401], [{ Origin: 'https://attacker.test' }, 403],
        [{ Origin: '' }, 403], [{ 'X-Print-Upload-Token': 'd'.repeat(64) }, 409]]) {
        const response = await upload(context, jobId, { headers });
        assert.equal(response.status, status);
        assert.equal(context.objects.size, 0);
    }
    await context.database.prepare("UPDATE staff_sessions SET revoked_at=datetime('now')").run();
    assert.equal((await upload(context, jobId)).status, 401);
    assert.equal(context.objects.size, 0);
});

test('only real fixture bytes can reach R2 and replayed or concurrent PUTs cannot overwrite them', async () => {
    const context = await createEnvironment();
    const { job_id: jobId } = await (await createIntent(context)).json();
    const changed = PDF_BYTES.slice();
    changed[changed.length - 1] ^= 1;

    assert.equal((await upload(context, jobId, { bytes: changed })).status, 415);
    assert.equal(context.objects.size, 0);
    assert.equal((await upload(context, jobId, { bytes: PDF_BYTES.slice(0, -1) })).status, 409);
    assert.equal((await upload(context, jobId, { bytes: new Uint8Array(PDF_BYTES.length + 1) })).status, 409);
    const responses = await Promise.all([upload(context, jobId), upload(context, jobId)]);

    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal(context.objects.size, 1);
    assert.deepEqual(new Uint8Array(await [...context.objects.values()][0].arrayBuffer()), PDF_BYTES);
});

test('a revoked session during streaming upload is rejected before R2 stores any bytes', async () => {
    const context = await createEnvironment();
    const { job_id: jobId } = await (await createIntent(context)).json();
    let hasReadBody = false;
    const stream = new ReadableStream({ async pull(controller) {
        hasReadBody = true;
        await context.database.prepare("UPDATE staff_sessions SET revoked_at=datetime('now')").run();
        controller.enqueue(PDF_BYTES);
        controller.close();
    } }, { highWaterMark: 0 });

    const response = await upload(context, jobId, { bytes: stream });

    assert.equal(hasReadBody, true);
    assert.equal(response.status, 401);
    assert.equal(context.objects.size, 0);
});

test('expiry during streaming upload rejects the bytes before R2 storage', async () => {
    const context = await createEnvironment();
    const { job_id: jobId } = await (await createIntent(context)).json();
    const stream = new ReadableStream({ pull(controller) {
        context.environment.PRINT_UAT_EXPIRES_AT = new Date(Date.now() - 1).toISOString();
        controller.enqueue(PDF_BYTES);
        controller.close();
    } }, { highWaterMark: 0 });

    const response = await upload(context, jobId, { bytes: stream });

    assert.equal(response.status, 503);
    assert.equal(context.objects.size, 0);
});

test('expiry while the final upload-intent lookup is pending prevents the R2 write', async () => {
    const context = await createEnvironment();
    const { job_id: jobId } = await (await createIntent(context)).json();
    const originalPrepare = context.database.prepare.bind(context.database);
    let lookups = 0;
    const wrapLookup = (statement) => ({ ...statement,
        bind: (...values) => wrapLookup(statement.bind(...values)),
        async first() {
            const result = await statement.first();
            lookups += 1;
            if (lookups === 2) context.environment.PRINT_UAT_EXPIRES_AT = new Date(Date.now() - 1).toISOString();
            return result;
        }
    });
    context.database.prepare = (sql) => sql.includes("upload_token_hash=? AND status='uploading'")
        ? wrapLookup(originalPrepare(sql)) : originalPrepare(sql);

    const response = await upload(context, jobId);

    assert.equal(lookups, 2);
    assert.equal(response.status, 503);
    assert.equal(context.objects.size, 0);
});

test('revocation or expiry during finalize cannot move an uploaded job into the queue', async () => {
    for (const failure of ['revoked', 'expired']) {
        const context = await createEnvironment();
        const { job_id: jobId } = await (await createIntent(context)).json();
        await upload(context, jobId);
        const object = [...context.objects.values()][0];
        const originalRead = object.arrayBuffer.bind(object);
        object.arrayBuffer = async () => {
            if (failure === 'revoked') await context.database.prepare("UPDATE staff_sessions SET revoked_at=datetime('now')").run();
            if (failure === 'expired') context.environment.PRINT_UAT_EXPIRES_AT = new Date(Date.now() - 1).toISOString();
            return originalRead();
        };

        const response = await finalize(context, jobId);

        assert.equal(response.status, failure === 'revoked' ? 401 : 503);
        assert.equal(context.database.prepare('SELECT status FROM print_jobs WHERE id=?').bind(jobId).first().status, 'uploading');
    }
});

test('different valid staff sessions share one atomic UAT reservation', async () => {
    const context = await createEnvironment();
    const otherToken = 'T'.repeat(43);
    await context.database.prepare(`INSERT INTO staff_sessions(id,staff_user_id,token_hash,expires_at)
        VALUES('other-session','uat-staff',?,?)`).bind(await hashSessionToken(otherToken),
        new Date(Date.now() + 60_000).toISOString()).run();

    const responses = await Promise.all([createIntent(context), worker.fetch(request('/api/public/print/upload-intents', {
        method: 'POST', headers: { Cookie: `staff_session=${otherToken}` }, body: uploadPayload({
            idempotency_key: 'd'.repeat(64), upload_token: 'e'.repeat(64), tracking_token: 'f'.repeat(64) }) }), context.environment)]);

    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 503]);
    assert.equal(context.database.prepare('SELECT count(*) AS count FROM print_jobs').first().count, 1);
    assert.equal(context.database.prepare("SELECT count(*) AS count FROM audit_events WHERE id='staff-print-uat-v7'").first().count, 1);
});

test('closing UAT preserves retention cleanup and its permanent one-job reservation', async () => {
    const context = await createEnvironment();
    const { job_id: jobId } = await (await createIntent(context)).json();
    await upload(context, jobId);
    context.environment.PRINT_UAT_ENABLED = 'false';

    assert.equal((await upload(context, jobId)).status, 503);
    assert.equal((await finalize(context, jobId)).status, 503);
    await runPrintCleanup(context.environment, new Date(Date.now() + 25 * 60 * 60_000).toISOString());

    assert.equal(context.objects.size, 0);
    assert.equal(context.database.prepare('SELECT count(*) AS count FROM print_jobs').first().count, 0);
    assert.equal(context.database.prepare("SELECT count(*) AS count FROM audit_events WHERE id='staff-print-uat-v7'").first().count, 1);
    context.environment.PRINT_UAT_ENABLED = 'true';
    assert.equal((await createIntent(context)).status, 503);
});

test('database clock rejects expired queue, ready and submission transitions even with a stale handler timestamp', async () => {
    const context = await createEnvironment();
    const { job_id: jobId } = await (await createIntent(context)).json();
    const repository = createPrintRepository(context.database);
    const now = new Date().toISOString();
    const expired = new Date(Date.now() - 1000).toISOString();

    assert.equal(await repository.markQueued({ id: jobId, tokenHash: await hashSessionToken('b'.repeat(64)),
        now, expiresAt: new Date(Date.now() + 100_000).toISOString(), uatExpiresAt: expired }), false);
    await upload(context, jobId);
    await finalize(context, jobId);
    assert.equal(await repository.claim({ now, runnerId: 'uat-runner', leaseTokenHash: 'c'.repeat(64),
        jobId, uatExpiresAt: expired }), null);
    const claim = await worker.fetch(request('/api/printer/claim', { method: 'POST', headers: MACHINE_HEADERS,
        body: { runner_id: 'uat-runner' } }), context.environment);
    const job = (await claim.json()).job;
    const tokenHash = await hashSessionToken(job.lease_token);
    assert.equal(await repository.markReady({ id: jobId, tokenHash, now, pageCount: 1, uatExpiresAt: expired }), false);
    await repository.markReady({ id: jobId, tokenHash, now, pageCount: 1 });
    assert.equal(await repository.markSubmissionStarted({ id: jobId, tokenHash, now, uatExpiresAt: expired }), false);
});

test('UAT machine work cannot target unrelated jobs or an older settings protocol', async () => {
    const context = await createEnvironment();
    const { job_id: jobId } = await (await createIntent(context, { orientation: 'portrait' })).json();
    await upload(context, jobId);
    await finalize(context, jobId);
    await context.database.prepare('UPDATE printer_heartbeats SET settings_protocol=2').run();

    const claim = await worker.fetch(request('/api/printer/claim', { method: 'POST', headers: MACHINE_HEADERS,
        body: { runner_id: 'uat-runner' } }), context.environment);
    assert.equal((await claim.json()).job, null);
    for (const action of ['content', 'validation-result', 'submission-started']) {
        const response = await worker.fetch(request(`/api/printer/jobs/unrelated-job/${action}`, {
            method: action === 'content' ? 'GET' : 'POST', headers: MACHINE_HEADERS,
            body: action === 'content' ? undefined : {} }), context.environment);
        assert.equal(response.status, 403);
    }
    assert.equal((await finalize(context, 'unrelated-job')).status, 403);
});

test('public status stays available and closed independently of staff cookies and UAT configuration', async () => {
    const context = await createEnvironment();

    for (const headers of [{}, STAFF_HEADERS, { Cookie: 'staff_session=forged' }]) {
        const response = await worker.fetch(request('/api/public/print/status', { headers }), context.environment);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).available, false);
    }
    const privateStatus = await worker.fetch(request('/api/staff/print/uat/status'), context.environment);
    assert.equal(privateStatus.status, 401);
});

test('the server enforces the exact 15 minute boundary and rejects client hash and filename claims', async () => {
    const context = await createEnvironment();
    const startedAt = Date.now();
    const policy = { ...context.environment, PRINT_UAT_STARTED_AT: new Date(startedAt).toISOString(),
        PRINT_UAT_EXPIRES_AT: new Date(startedAt + 900_000).toISOString() };

    assert.ok(readPrintUatPolicy(policy, startedAt));
    assert.ok(readPrintUatPolicy(policy, startedAt + 899_999));
    assert.equal(readPrintUatPolicy(policy, startedAt + 900_000), null);
    assert.equal(readPrintUatPolicy({ ...policy, PRINT_UAT_EXPIRES_AT: new Date(startedAt + 900_001).toISOString() }, startedAt), null);
    for (const overrides of [{ sha256: context.environment.PRINT_UAT_DOCUMENT_SHA256 }, { filename: 'same-portrait-source.pdf' }]) {
        assert.equal((await createIntent(context, overrides)).status, 400);
    }
    assert.equal(context.database.prepare('SELECT count(*) AS count FROM print_jobs').first().count, 0);
});

test('expired UAT windows reject all mutation stages while keeping public status and authenticated heartbeat', async () => {
    const context = await createEnvironment();
    context.environment.PRINT_UAT_EXPIRES_AT = new Date(Date.now() - 1).toISOString();

    for (const [path, method, headers] of [
        ['/api/public/print/upload-intents', 'POST', STAFF_HEADERS],
        ['/api/public/print/jobs/expired-job/upload', 'PUT', STAFF_HEADERS],
        ['/api/public/print/jobs/expired-job/finalize', 'POST', STAFF_HEADERS],
        ['/api/printer/claim', 'POST', MACHINE_HEADERS],
        ['/api/printer/jobs/expired-job/content', 'GET', MACHINE_HEADERS],
        ['/api/printer/jobs/expired-job/validation-result', 'POST', MACHINE_HEADERS],
        ['/api/printer/jobs/expired-job/submission-started', 'POST', MACHINE_HEADERS]]) {
        assert.equal((await worker.fetch(request(path, { method, headers }), context.environment)).status, 503);
    }
    const status = await worker.fetch(request('/api/public/print/status'), context.environment);
    assert.equal(status.status, 200);
    assert.equal((await status.json()).available, false);
    const heartbeat = await worker.fetch(request('/api/printer/heartbeat', { method: 'POST', headers: MACHINE_HEADERS,
        body: { printer_id: 'uat-printer', runner_id: 'uat-runner', printer_name: 'Mock Kyocera', health: 'ready', settings_protocol: 3 } }), context.environment);
    assert.equal(heartbeat.status, 200);
    assert.equal(context.objects.size, 0);
});

test('database clock prevents job creation after UAT expiry even if a stale request time is supplied', async () => {
    const { database } = await createEnvironment();
    const now = new Date().toISOString();

    const job = await createPrintRepository(database).createUploadIntent({ id: 'expired-intent',
        idempotencyHash: 'fresh-idempotency', uploadTokenHash: 'upload-hash', trackingTokenHash: 'tracking-hash',
        storageKey: 'print/11111111-1111-4111-8111-111111111111', mediaType: 'application/pdf', byteSize: PDF_BYTES.length,
        copies: 1, paperSize: 'A4', colorMode: 'monochrome', duplex: 'simplex', orientation: 'portrait',
        now, expiresAt: new Date(Date.now() + 600_000).toISOString(), purgeAfter: new Date(Date.now() + 86_400_000).toISOString(),
        heartbeatCutoff: new Date(Date.now() - 60_000).toISOString(), requiredProtocol: 3,
        uatExpiresAt: new Date(Date.now() - 1000).toISOString() });

    assert.equal(job, null);
    assert.equal(database.prepare('SELECT count(*) AS count FROM print_jobs').first().count, 0);
});
