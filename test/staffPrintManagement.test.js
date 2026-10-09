import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/server/worker.js';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { createPrintRepository } from '../src/server/repositories/d1/printRepository.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const PRINTER_SECRET = 'A'.repeat(48);
const STAFF_TOKEN = 's'.repeat(43);
const NOW = new Date().toISOString();

function createEnvironment(role = 'admin') {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const objects = new Map();
    const bucket = {
        async head(key) {
            const object = objects.get(key);
            return object ? { key, size: object.size, etag: object.etag,
                httpMetadata: { contentType: object.type } } : null;
        },
        async get(key) { return objects.get(key) || null; },
        async delete(key) { objects.delete(key); }
    };
    const username = `${role}@test`;
    const staffId = `staff-${role}`;
    database.prepare(`INSERT INTO staff_users
        (id,username,normalized_username,password_hash,display_name,role,is_active)
        VALUES(?,?,?,?,?,?,?)`).bind(staffId, username, username, 'test-hash', role, role, 1).run();
    return hashSessionToken(STAFF_TOKEN).then((tokenHash) => {
        database.prepare(`INSERT INTO staff_sessions(id,staff_user_id,token_hash,expires_at,last_seen_at)
            VALUES(?,?,?,?,?)`).bind(`session-${role}`, staffId, tokenHash,
            new Date(Date.now() + 60 * 60 * 1000).toISOString(), new Date().toISOString()).run();
        const environment = { DB: database, PRINT_FILES: bucket, PRINT_BUCKET_NAME: 'test-print',
            R2_ACCOUNT_ID: 'account', PRINT_R2_ACCESS_KEY_ID: 'access', PRINT_R2_SECRET_ACCESS_KEY: 'secret',
            PRINT_ENABLED: 'true', PRINT_ENABLE_COLOR: 'true', STAFF_SHARED_USERNAME: username,
            PRINTER_SECRET, APP_ENV: 'test' };
        return { database, objects, environment, cookie: `staff_session=${STAFF_TOKEN}`, staffId };
    });
}

function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
    const requestHeaders = new Headers({ Origin: 'https://portal.test', 'CF-Connecting-IP': '198.51.100.21', ...headers });
    if (cookie) requestHeaders.set('Cookie', cookie);
    if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
    return new Request(`https://portal.test${path}`, { method, headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body) });
}

async function createQueuedJob(repository, id, overrides = {}) {
    const now = new Date().toISOString();
    const job = await repository.createUploadIntent({ id, idempotencyHash: `idem-${id}`,
        uploadTokenHash: `upload-${id}`, trackingTokenHash: `track-${id}`,
        storageKey: `private/${id}`, mediaType: 'application/pdf', byteSize: 100, copies: 2,
        paperSize: 'A4', colorMode: 'monochrome', duplex: 'simplex', orientation: 'portrait',
        now, expiresAt: new Date(Date.now() + 60_000).toISOString(),
        purgeAfter: new Date(Date.now() + 86_400_000).toISOString(),
        heartbeatCutoff: new Date(Date.now() - 60_000).toISOString(), ...overrides });
    assert.ok(job);
    assert.equal(await repository.markQueued({ id, tokenHash: `upload-${id}`, now,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString() }), true);
    return job;
}

async function readyPrinter(database) {
    await createPrintRepository(database).heartbeat({ printerId: 'office', runnerId: 'agent-1',
        health: 'ready', printerName: 'Kyocera Office', settingsProtocol: 3, now: new Date().toISOString() });
}

test('staff queue APIs reject anonymous access and reveal no private object keys or bearer hashes', async () => {
    const fixture = await createEnvironment();
    await readyPrinter(fixture.database);
    const anonymous = await worker.fetch(request('/api/staff/print/management'), fixture.environment);
    assert.equal(anonymous.status, 401);
    const anonymousUpload = await worker.fetch(request('/api/staff/print/upload-intents', {
        method: 'POST', body: {}
    }), fixture.environment);
    assert.equal(anonymousUpload.status, 401);

    const job = await createQueuedJob(createPrintRepository(fixture.database), '10000000-0000-4000-8000-000000000001');
    const response = await worker.fetch(request('/api/staff/print/management', { cookie: fixture.cookie }), fixture.environment);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.canManage, true);
    assert.equal(payload.jobs[0].id, job.id);
    const serialized = JSON.stringify(payload);
    for (const privateField of ['storage_key', 'upload_token_hash', 'tracking_token_hash', 'lease_token_hash']) {
        assert.equal(serialized.includes(privateField), false);
    }
    assert.equal(serialized.includes('private/10000000-0000-4000-8000-000000000001'), false);
});

test('reviewers can inspect jobs but cannot pause, resume, or cancel', async () => {
    const fixture = await createEnvironment('reviewer');
    await readyPrinter(fixture.database);
    const repository = createPrintRepository(fixture.database);
    const job = await createQueuedJob(repository, '10000000-0000-4000-8000-000000000002');
    const management = await worker.fetch(request('/api/staff/print/management', { cookie: fixture.cookie }), fixture.environment);
    assert.equal(management.status, 200);
    assert.equal((await management.json()).canManage, false);

    const pause = await worker.fetch(request('/api/staff/print/queue/pause', {
        method: 'POST', cookie: fixture.cookie, body: {}
    }), fixture.environment);
    const cancel = await worker.fetch(request(`/api/staff/print/jobs/${job.id}/cancel`, {
        method: 'POST', cookie: fixture.cookie, body: {}
    }), fixture.environment);
    assert.equal(pause.status, 403);
    assert.equal(cancel.status, 403);
    assert.equal(fixture.database.prepare('SELECT is_paused FROM print_queue_controls WHERE id=\'global\'').first().is_paused, 0);
});

test('queue pause rejects new jobs, blocks Agent claims, preserves pending jobs, and resumes them in order', async () => {
    const fixture = await createEnvironment();
    await readyPrinter(fixture.database);
    const repository = createPrintRepository(fixture.database);
    await createQueuedJob(repository, '10000000-0000-4000-8000-000000000003');
    const earlierTokens = { idempotency_key: 'd'.repeat(64), tracking_token: 'e'.repeat(64), upload_token: 'f'.repeat(64) };
    const earlierIntent = await worker.fetch(request('/api/public/print/upload-intents', { method: 'POST', body: {
        byte_size: 8, copies: 1, media_type: 'application/pdf', paper_size: 'A4', color_mode: 'monochrome',
        duplex: 'simplex', orientation: 'portrait', ...earlierTokens
    } }), fixture.environment);
    assert.equal(earlierIntent.status, 200);
    const earlierJob = await earlierIntent.json();
    const earlierStorageKey = fixture.database.prepare('SELECT storage_key FROM print_jobs WHERE id=?')
        .bind(earlierJob.job_id).first().storage_key;
    fixture.objects.set(earlierStorageKey, new Blob([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55])],
        { type: 'application/pdf' }));
    const paused = await worker.fetch(request('/api/staff/print/queue/pause', {
        method: 'POST', cookie: fixture.cookie, body: {}
    }), fixture.environment);
    assert.equal(paused.status, 200);
    assert.equal((await paused.json()).queue.paused, true);
    assert.equal(await repository.claim({ now: new Date().toISOString(), runnerId: 'agent-1', leaseTokenHash: 'lease-paused' }), null);

    const tokens = { idempotency_key: 'a'.repeat(64), tracking_token: 'b'.repeat(64), upload_token: 'c'.repeat(64) };
    const rejected = await worker.fetch(request('/api/public/print/upload-intents', { method: 'POST', body: {
        byte_size: 100, copies: 1, media_type: 'application/pdf', paper_size: 'A4',
        color_mode: 'monochrome', duplex: 'simplex', orientation: 'portrait', ...tokens
    } }), fixture.environment);
    assert.equal(rejected.status, 503);
    assert.equal((await rejected.json()).error.code, 'PRINT_QUEUE_PAUSED');
    assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM print_jobs').first().count, 2);

    const earlierFinalize = await worker.fetch(request(`/api/public/print/jobs/${earlierJob.job_id}/finalize`, {
        method: 'POST', headers: { 'X-Print-Upload-Token': earlierTokens.upload_token }
    }), fixture.environment);
    assert.equal(earlierFinalize.status, 200);
    assert.equal(fixture.database.prepare('SELECT status FROM print_jobs WHERE id=?').bind(earlierJob.job_id).first().status, 'queued');
    const pausedStatus = await worker.fetch(request('/api/public/print/status'), fixture.environment);
    assert.equal((await pausedStatus.json()).queue_paused, true);

    const resumed = await worker.fetch(request('/api/staff/print/queue/resume', {
        method: 'POST', cookie: fixture.cookie, body: {}
    }), fixture.environment);
    assert.equal(resumed.status, 200);
    const claim = await repository.claim({ now: new Date().toISOString(), runnerId: 'agent-1', leaseTokenHash: 'lease-resumed' });
    assert.equal(claim.id, '10000000-0000-4000-8000-000000000003');
    assert.deepEqual(fixture.database.prepare(`SELECT event_type FROM print_queue_audit
        ORDER BY occurred_at,event_type`).all().results.map((row) => row.event_type), ['queue_paused', 'queue_resumed']);
});

test('an Agent lease already active at pause is allowed to continue without receiving another job', async () => {
    const fixture = await createEnvironment();
    await readyPrinter(fixture.database);
    const repository = createPrintRepository(fixture.database);
    await createQueuedJob(repository, '10000000-0000-4000-8000-000000000004');
    await createQueuedJob(repository, '10000000-0000-4000-8000-000000000005');
    const lease = await repository.claim({ now: new Date().toISOString(), runnerId: 'agent-1', leaseTokenHash: 'lease-current' });
    assert.equal(lease.id, '10000000-0000-4000-8000-000000000004');

    await worker.fetch(request('/api/staff/print/queue/pause', { method: 'POST', cookie: fixture.cookie, body: {} }), fixture.environment);
    assert.equal(await repository.markReady({ id: lease.id, tokenHash: 'lease-current', now: new Date().toISOString(), pageCount: 2 }), true);
    assert.equal(await repository.markSubmissionStarted({ id: lease.id, tokenHash: 'lease-current', now: new Date().toISOString() }), true);
    assert.equal(await repository.claim({ now: new Date().toISOString(), runnerId: 'agent-1', leaseTokenHash: 'lease-next' }), null);
});

test('only uploading and queued jobs can be cancelled; cancellation is audited and cannot be claimed again', async () => {
    const fixture = await createEnvironment();
    await readyPrinter(fixture.database);
    const repository = createPrintRepository(fixture.database);
    const queued = await createQueuedJob(repository, '10000000-0000-4000-8000-000000000006');
    const response = await worker.fetch(request(`/api/staff/print/jobs/${queued.id}/cancel`, {
        method: 'POST', cookie: fixture.cookie, body: {}
    }), fixture.environment);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'cancelled');
    assert.equal(await repository.claim({ now: new Date().toISOString(), runnerId: 'agent-1', leaseTokenHash: 'lease-after-cancel' }), null);
    assert.equal(fixture.database.prepare('SELECT event_type FROM print_queue_audit WHERE job_id=?').bind(queued.id).first().event_type, 'job_cancelled');

    await createQueuedJob(repository, '10000000-0000-4000-8000-000000000007');
    await repository.claim({ now: new Date().toISOString(), runnerId: 'agent-1', leaseTokenHash: 'lease-unsafe' });
    const unsafe = await worker.fetch(request('/api/staff/print/jobs/10000000-0000-4000-8000-000000000007/cancel', {
        method: 'POST', cookie: fixture.cookie, body: {}
    }), fixture.environment);
    assert.equal(unsafe.status, 409);
    assert.equal(fixture.database.prepare('SELECT status FROM print_jobs WHERE id=?').bind('10000000-0000-4000-8000-000000000007').first().status, 'leased');
});

test('D1 claim and cancel races have a single winner and never requeue a cancelled job', async () => {
    const cancelWinsFixture = await createEnvironment();
    await readyPrinter(cancelWinsFixture.database);
    const cancelWinsRepository = createPrintRepository(cancelWinsFixture.database);
    await createQueuedJob(cancelWinsRepository, '10000000-0000-4000-8000-000000000008');
    const cancelFirst = cancelWinsRepository.cancelJob({ id: '10000000-0000-4000-8000-000000000008', expectedStatus: 'queued',
        actorStaffId: cancelWinsFixture.staffId, actorRole: 'admin', now: new Date().toISOString() });
    const claimSecond = cancelWinsRepository.claim({ now: new Date().toISOString(), runnerId: 'agent-1', leaseTokenHash: 'lease-cancel-wins' });
    const [cancelled, noClaim] = await Promise.all([cancelFirst, claimSecond]);
    assert.equal(cancelled, true);
    assert.equal(noClaim, null);

    const claimWinsFixture = await createEnvironment();
    await readyPrinter(claimWinsFixture.database);
    const claimWinsRepository = createPrintRepository(claimWinsFixture.database);
    await createQueuedJob(claimWinsRepository, '10000000-0000-4000-8000-000000000009');
    const claimFirst = claimWinsRepository.claim({ now: new Date().toISOString(), runnerId: 'agent-1', leaseTokenHash: 'lease-claim-wins' });
    const cancelSecond = claimWinsRepository.cancelJob({ id: '10000000-0000-4000-8000-000000000009', expectedStatus: 'queued',
        actorStaffId: claimWinsFixture.staffId, actorRole: 'admin', now: new Date().toISOString() });
    const [claimed, notCancelled] = await Promise.all([claimFirst, cancelSecond]);
    assert.equal(claimed.status, 'leased');
    assert.equal(notCancelled, false);
    assert.equal(claimWinsFixture.database.prepare('SELECT status FROM print_jobs WHERE id=?').bind('10000000-0000-4000-8000-000000000009').first().status, 'leased');
});

test('staff submissions reuse print settings, color capabilities, and the same Agent queue', async () => {
    const fixture = await createEnvironment();
    await readyPrinter(fixture.database);
    const body = { byte_size: 8, copies: 2, media_type: 'application/pdf', paper_size: 'A4', color_mode: 'color',
        duplex: 'simplex', orientation: 'landscape', idempotency_key: 'd'.repeat(64),
        tracking_token: 'e'.repeat(64), upload_token: 'f'.repeat(64) };
    const response = await worker.fetch(request('/api/staff/print/upload-intents', {
        method: 'POST', cookie: fixture.cookie, body
    }), fixture.environment);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.status, 'uploading');
    const job = fixture.database.prepare(`SELECT source,created_by_staff_id,created_by_staff_role,color_mode,orientation,copies
        FROM print_jobs WHERE id=?`).bind(payload.job_id).first();
    assert.equal(job.source, 'staff');
    assert.equal(job.created_by_staff_id, fixture.staffId);
    assert.equal(job.created_by_staff_role, 'admin');
    assert.equal(job.color_mode, 'color');
    assert.equal(job.orientation, 'landscape');
    assert.equal(job.copies, 2);
    assert.equal(fixture.database.prepare('SELECT event_type FROM print_queue_audit WHERE job_id=?').bind(payload.job_id).first().event_type, 'staff_job_created');
    const stored = fixture.database.prepare('SELECT storage_key FROM print_jobs WHERE id=?').bind(payload.job_id).first();
    fixture.objects.set(stored.storage_key, new Blob([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55])],
        { type: 'application/pdf' }));
    const finalized = await worker.fetch(request(`/api/staff/print/jobs/${payload.job_id}/finalize`, {
        method: 'POST', cookie: fixture.cookie, headers: { 'X-Print-Upload-Token': body.upload_token }
    }), fixture.environment);
    assert.equal(finalized.status, 200);
    assert.equal((await createPrintRepository(fixture.database).claim({ now: new Date().toISOString(),
        runnerId: 'agent-1', leaseTokenHash: 'lease-staff-job' })).id, payload.job_id);
});

test('staff print submissions obey the live color feature flag and Agent capability validation', async () => {
    const fixture = await createEnvironment();
    fixture.environment.PRINT_ENABLE_COLOR = 'false';
    await readyPrinter(fixture.database);
    const response = await worker.fetch(request('/api/staff/print/upload-intents', {
        method: 'POST', cookie: fixture.cookie, body: { byte_size: 8, copies: 1, media_type: 'application/pdf',
            paper_size: 'A4', color_mode: 'color', duplex: 'simplex', orientation: 'portrait',
            idempotency_key: 'g'.repeat(64), tracking_token: 'h'.repeat(64), upload_token: 'i'.repeat(64) }
    }), fixture.environment);
    assert.equal(response.status, 400);
    assert.equal(fixture.database.prepare('SELECT count(*) AS count FROM print_jobs').first().count, 0);
});

test('history is paginated and preserves unknown provenance for legacy rows', async () => {
    const fixture = await createEnvironment('reviewer');
    await readyPrinter(fixture.database);
    await createQueuedJob(createPrintRepository(fixture.database), '10000000-0000-4000-8000-000000000010', { source: 'student' });
    await createQueuedJob(createPrintRepository(fixture.database), '10000000-0000-4000-8000-000000000011', { source: 'unknown' });
    await createQueuedJob(createPrintRepository(fixture.database), '10000000-0000-4000-8000-000000000012', { source: 'unknown' });
    fixture.database.prepare(`UPDATE print_jobs SET cleanup_status='complete' WHERE id=?`)
        .bind('10000000-0000-4000-8000-000000000011').run();
    const response = await worker.fetch(request('/api/staff/print/history?source=unknown&limit=1', {
        cookie: fixture.cookie
    }), fixture.environment);
    assert.equal(response.status, 200);
    const history = await response.json();
    assert.equal(history.jobs.length, 1);
    assert.equal(history.jobs[0].source, 'unknown');
    assert.equal(history.jobs[0].id, '10000000-0000-4000-8000-000000000012');
    assert.equal(history.jobs[0].storage_key, undefined);
    assert.equal(history.hasMore, true);
    const next = await worker.fetch(request(`/api/staff/print/history?source=unknown&limit=1&before_created_at=${encodeURIComponent(history.nextCursor.created_at)}&before_id=${history.nextCursor.id}`, {
        cookie: fixture.cookie
    }), fixture.environment);
    assert.equal(next.status, 200);
    const nextPage = await next.json();
    assert.equal(nextPage.jobs[0].id, '10000000-0000-4000-8000-000000000011');
    assert.equal(nextPage.jobs[0].source, 'unknown');
    assert.equal(nextPage.hasMore, false);
});
