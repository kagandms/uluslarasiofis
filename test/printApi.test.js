import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/server/worker.js';
import { createPrintRepository } from '../src/server/repositories/d1/printRepository.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const PRINTER_SECRET = 'A'.repeat(48);

function createEnvironment(settings = {}) {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const objects = new Map();
    const bucket = {
        async head(key) {
            const object = objects.get(key);
            return object ? { key, size: object.size, etag: object.etag, httpMetadata: { contentType: object.type } } : null;
        },
        async get(key) { return objects.get(key) || null; },
        async delete(key) { objects.delete(key); }
    };
    return {
        database, objects,
        environment: {
            DB: database, PRINT_FILES: bucket, PRINT_BUCKET_NAME: 'test-print',
            R2_ACCOUNT_ID: 'account', PRINT_R2_ACCESS_KEY_ID: 'access', PRINT_R2_SECRET_ACCESS_KEY: 'secret',
            PRINT_ENABLED: 'true', PRINTER_SECRET, STAFF_SHARED_USERNAME: 'admin', APP_ENV: 'test', ...settings
        }
    };
}

function request(path, { method = 'GET', body, headers = {} } = {}) {
    const requestHeaders = new Headers({ 'CF-Connecting-IP': '198.51.100.20', Origin: 'https://portal.test', ...headers });
    if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
    return new Request(`https://portal.test${path}`, {
        method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body)
    });
}

function printerHeaders(secret = PRINTER_SECRET, extra = {}) {
    return { Authorization: `Bearer ${secret}`, ...extra };
}

test('public print upload, machine validation, page count, and status follow the constrained job lifecycle', async () => {
    const { environment, database, objects } = createEnvironment();
    const repository = createPrintRepository(database);
    await repository.heartbeat({ printerId: 'office-printer', runnerId: 'runner-1', health: 'ready',
        printerName: 'Office Printer', now: new Date().toISOString() });
    const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
    const tokens = { idempotency_key: 'a'.repeat(64), tracking_token: 'b'.repeat(64), upload_token: 'c'.repeat(64) };
    const intentResponse = await worker.fetch(request('/api/public/print/upload-intents', {
        method: 'POST', body: { byte_size: pdf.length, copies: 2, media_type: 'application/pdf',
            paper_size: 'A4', color_mode: 'monochrome', duplex: 'simplex', orientation: 'portrait', ...tokens }
    }), environment);
    assert.equal(intentResponse.status, 200);
    const intent = await intentResponse.json();
    assert.equal(intent.status, 'uploading');
    assert.equal(intent.upload.method, 'PUT');
    assert.equal(intent.job_id.includes('.pdf'), false);
    const uploadJob = database.prepare('SELECT storage_key FROM print_jobs WHERE id=?').bind(intent.job_id).first();
    objects.set(uploadJob.storage_key, new Blob([pdf], { type: 'application/pdf' }));
    const finalizeResponse = await worker.fetch(request(`/api/public/print/jobs/${intent.job_id}/finalize`, {
        method: 'POST', headers: { 'X-Print-Upload-Token': tokens.upload_token }
    }), environment);
    assert.equal(finalizeResponse.status, 200);
    assert.equal(database.prepare('SELECT page_count FROM print_jobs WHERE id=?').bind(intent.job_id).first().page_count, null);

    const claimResponse = await worker.fetch(request('/api/printer/claim', {
        method: 'POST', body: { runner_id: 'runner-1' }, headers: printerHeaders()
    }), environment);
    assert.equal(claimResponse.status, 200);
    const claimed = (await claimResponse.json()).job;
    assert.equal(claimed.copies, 2);
    assert.equal(claimed.paper_size, 'A4');
    assert.equal(claimed.color_mode, 'monochrome');
    assert.equal(claimed.duplex, 'simplex');
    assert.equal(claimed.orientation, 'portrait');
    assert.deepEqual(claimed.limits, { max_copies: 50, max_page_copies: 200 });
    const leaseHeader = { 'X-Print-Lease': claimed.lease_token };
    const validationResponse = await worker.fetch(request(`/api/printer/jobs/${intent.job_id}/validation-result`, {
        method: 'POST', body: { status: 'ready', page_count: 2 }, headers: printerHeaders(PRINTER_SECRET, leaseHeader)
    }), environment);
    assert.equal(validationResponse.status, 200);
    assert.equal(database.prepare('SELECT page_count FROM print_jobs WHERE id=?').bind(intent.job_id).first().page_count, 2);

    const statusResponse = await worker.fetch(request('/api/public/print/jobs/status', {
        headers: { 'X-Print-Tracking-Token': tokens.tracking_token }
    }), environment);
    assert.equal(statusResponse.status, 200);
    assert.equal((await statusResponse.json()).status, 'ready');
    const isolatedResponse = await worker.fetch(request('/api/public/print/jobs/status', {
        headers: { 'X-Print-Tracking-Token': 'd'.repeat(64) }
    }), environment);
    assert.equal(isolatedResponse.status, 404);
});

test('printer machine endpoints reject absent and invalid secrets', async () => {
    const { environment } = createEnvironment();
    for (const secret of ['', 'wrong']) {
        const response = await worker.fetch(request('/api/printer/claim', {
            method: 'POST', body: { runner_id: 'runner-1' }, headers: printerHeaders(secret)
        }), environment);
        assert.equal(response.status, 401);
    }
});

test('heartbeat protocol 3 is accepted while unsupported future protocols are rejected', async () => {
    const { environment, database } = createEnvironment();
    const legacyResponse = await worker.fetch(request('/api/printer/heartbeat', {
        method: 'POST', body: { health: 'ready', printer_id: 'printer-legacy', printer_name: 'Uluslararası Ofis', runner_id: 'runner-old' },
        headers: printerHeaders()
    }), environment);

    assert.equal(legacyResponse.status, 200);
    assert.equal(database.prepare("SELECT settings_protocol FROM printer_heartbeats WHERE printer_id='printer-legacy'")
        .first().settings_protocol, 0);
    const invalidResponse = await worker.fetch(request('/api/printer/heartbeat', {
        method: 'POST', body: { health: 'ready', printer_id: 'printer-legacy', printer_name: 'Uluslararası Ofis',
            runner_id: 'runner-old', settings_protocol: 4 }, headers: printerHeaders()
    }), environment);

    assert.equal(invalidResponse.status, 400);
});

test('public availability stays false when the isolated print bucket is not configured', async () => {
    const { environment, database } = createEnvironment();
    await createPrintRepository(database).heartbeat({ printerId: 'office-printer', runnerId: 'runner-1', health: 'ready',
        printerName: 'Office Printer', now: new Date().toISOString() });
    delete environment.PRINT_R2_SECRET_ACCESS_KEY;

    const response = await worker.fetch(request('/api/public/print/status'), environment);

    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.available, false);
    assert.deepEqual(status.options, {
        paper_sizes: ['A4'], color_modes: ['monochrome'], duplex_modes: ['simplex'],
        orientations: ['portrait'], limits: { max_copies: 3, max_page_copies: 200 }
    });
});

test('upload intent rejects altered or disabled print settings before creating a job', async () => {
    const { environment, database } = createEnvironment({ PRINT_ENABLE_COLOR: 'false' });
    await createPrintRepository(database).heartbeat({ printerId: 'office-printer', runnerId: 'runner-1', health: 'ready',
        printerName: 'Uluslararası Ofis', settingsProtocol: 3, now: new Date().toISOString() });
    const response = await worker.fetch(request('/api/public/print/upload-intents', {
        method: 'POST', body: { byte_size: 8, copies: 1, media_type: 'application/pdf',
            paper_size: 'A4', color_mode: 'color', duplex: 'simplex', orientation: 'portrait',
            idempotency_key: 'a'.repeat(64), tracking_token: 'b'.repeat(64), upload_token: 'c'.repeat(64) }
    }), environment);

    assert.equal(response.status, 400);
    assert.equal(database.prepare('SELECT count(*) AS count FROM print_jobs').first().count, 0);
});

test('configured print settings are stored and returned to the printer claim', async () => {
    const { environment, database, objects } = createEnvironment({
        PRINT_ENABLE_COLOR: 'true', PRINT_ENABLE_DUPLEX: 'true', PRINT_ENABLE_A3: 'true'
    });
    const legacyStatusResponse = await worker.fetch(request('/api/public/print/status'), environment);
    assert.deepEqual((await legacyStatusResponse.json()).options, {
        paper_sizes: ['A4'], color_modes: ['monochrome'], duplex_modes: ['simplex'],
        orientations: ['portrait'], limits: { max_copies: 3, max_page_copies: 200 }
    });
    const heartbeatResponse = await worker.fetch(request('/api/printer/heartbeat', {
        method: 'POST', body: { health: 'ready', printer_id: 'office-printer', printer_name: 'Uluslararası Ofis',
            runner_id: 'runner-1', settings_protocol: 3 }, headers: printerHeaders()
    }), environment);
    assert.equal(heartbeatResponse.status, 200);
    const capableStatusResponse = await worker.fetch(request('/api/public/print/status'), environment);
    assert.deepEqual((await capableStatusResponse.json()).options, {
        paper_sizes: ['A4', 'A3'], color_modes: ['monochrome', 'color'], duplex_modes: ['simplex', 'duplexlong'],
        orientations: ['portrait', 'landscape'], limits: { max_copies: 50, max_page_copies: 200 }
    });
    const tokens = { idempotency_key: 'd'.repeat(64), tracking_token: 'e'.repeat(64), upload_token: 'f'.repeat(64) };
    const intentResponse = await worker.fetch(request('/api/public/print/upload-intents', {
        method: 'POST', body: { byte_size: 8, copies: 3, media_type: 'application/pdf',
            paper_size: 'A3', color_mode: 'color', duplex: 'duplexlong', orientation: 'portrait', ...tokens }
    }), environment);
    assert.equal(intentResponse.status, 200);
    const intent = await intentResponse.json();

    const job = database.prepare(`SELECT paper_size,color_mode,duplex,orientation FROM print_jobs WHERE id=?`)
        .bind(intent.job_id).first();
    assert.deepEqual({ ...job }, { paper_size: 'A3', color_mode: 'color', duplex: 'duplexlong', orientation: 'portrait' });
    const object = database.prepare('SELECT storage_key FROM print_jobs WHERE id=?').bind(intent.job_id).first();
    objects.set(object.storage_key, Object.assign(
        new Blob([new Uint8Array([37,80,68,70,45,49,46,55])], { type: 'application/pdf' }),
        { etag: 'etag-test' }
    ));
    const finalizeResponse = await worker.fetch(request(`/api/public/print/jobs/${intent.job_id}/finalize`, {
        method: 'POST', headers: { 'X-Print-Upload-Token': tokens.upload_token }
    }), environment);
    assert.equal(finalizeResponse.status, 200);
    const claimResponse = await worker.fetch(request('/api/printer/claim', {
        method: 'POST', body: { runner_id: 'runner-1' }, headers: printerHeaders()
    }), environment);

    assert.equal(claimResponse.status, 200);
    const claimed = (await claimResponse.json()).job;
    assert.equal(claimed.paper_size, 'A3');
    assert.equal(claimed.color_mode, 'color');
    assert.equal(claimed.duplex, 'duplexlong');
});

test('protocol 3 carries landscape and higher copies while protocol 2 cannot claim landscape jobs', async () => {
    const { environment, database, objects } = createEnvironment({
        PRINT_MAX_COPIES_PER_JOB: '50', PRINT_MAX_PAGE_COPIES: '200'
    });
    const heartbeat = async (protocol) => worker.fetch(request('/api/printer/heartbeat', {
        method: 'POST', body: { health: 'ready', printer_id: 'office-printer', printer_name: 'Uluslararası Ofis',
            runner_id: 'runner-1', settings_protocol: protocol }, headers: printerHeaders()
    }), environment);
    assert.equal((await heartbeat(3)).status, 200);
    const tokens = { idempotency_key: '1'.repeat(64), tracking_token: '2'.repeat(64), upload_token: '3'.repeat(64) };
    const intentResponse = await worker.fetch(request('/api/public/print/upload-intents', {
        method: 'POST', body: { byte_size: 8, copies: 25, media_type: 'application/pdf', paper_size: 'A4',
            color_mode: 'monochrome', duplex: 'simplex', orientation: 'landscape', ...tokens }
    }), environment);
    assert.equal(intentResponse.status, 200);
    const intent = await intentResponse.json();
    const stored = database.prepare('SELECT storage_key FROM print_jobs WHERE id=?').bind(intent.job_id).first();
    objects.set(stored.storage_key, Object.assign(new Blob([new Uint8Array([37,80,68,70,45,49,46,55])],
        { type: 'application/pdf' }), { etag: 'etag-protocol-2' }));
    const finalizeResponse = await worker.fetch(request(`/api/public/print/jobs/${intent.job_id}/finalize`, {
        method: 'POST', headers: { 'X-Print-Upload-Token': tokens.upload_token }
    }), environment);
    assert.equal(finalizeResponse.status, 200);

    assert.equal((await heartbeat(2)).status, 200);
    const oldAgentClaim = await worker.fetch(request('/api/printer/claim', {
        method: 'POST', body: { runner_id: 'runner-1' }, headers: printerHeaders()
    }), environment);
    assert.equal((await oldAgentClaim.json()).job, null);

    assert.equal((await heartbeat(3)).status, 200);
    const newAgentClaim = await worker.fetch(request('/api/printer/claim', {
        method: 'POST', body: { runner_id: 'runner-1' }, headers: printerHeaders()
    }), environment);
    const claimed = (await newAgentClaim.json()).job;
    assert.equal(claimed.copies, 25);
    assert.equal(claimed.orientation, 'landscape');
});

test('Worker rejects a verified page count that exceeds the configured impression budget', async () => {
    const { environment, database, objects } = createEnvironment();
    const repository = createPrintRepository(database);
    await repository.heartbeat({ printerId: 'office-printer', runnerId: 'runner-1', health: 'ready',
        printerName: 'Uluslararası Ofis', settingsProtocol: 2, now: new Date().toISOString() });
    const tokens = { idempotency_key: '4'.repeat(64), tracking_token: '5'.repeat(64), upload_token: '6'.repeat(64) };
    const intentResponse = await worker.fetch(request('/api/public/print/upload-intents', {
        method: 'POST', body: { byte_size: 8, copies: 11, media_type: 'application/pdf', paper_size: 'A4',
            color_mode: 'monochrome', duplex: 'simplex', orientation: 'portrait', ...tokens }
    }), environment);
    const intent = await intentResponse.json();
    const stored = database.prepare('SELECT storage_key FROM print_jobs WHERE id=?').bind(intent.job_id).first();
    objects.set(stored.storage_key, Object.assign(new Blob([new Uint8Array([37,80,68,70,45,49,46,55])],
        { type: 'application/pdf' }), { etag: 'etag-budget' }));
    await worker.fetch(request(`/api/public/print/jobs/${intent.job_id}/finalize`, {
        method: 'POST', headers: { 'X-Print-Upload-Token': tokens.upload_token }
    }), environment);
    const claim = await worker.fetch(request('/api/printer/claim', {
        method: 'POST', body: { runner_id: 'runner-1' }, headers: printerHeaders()
    }), environment);
    const claimed = (await claim.json()).job;
    const result = await worker.fetch(request(`/api/printer/jobs/${intent.job_id}/validation-result`, {
        method: 'POST', body: { status: 'ready', page_count: 20 },
        headers: printerHeaders(PRINTER_SECRET, { 'X-Print-Lease': claimed.lease_token })
    }), environment);

    const responseBody = await result.json();
    assert.equal(responseBody.ready, false);
    assert.equal(responseBody.result_code, 'page_copy_budget_exceeded');
    const job = database.prepare('SELECT status,page_count,result_code FROM print_jobs WHERE id=?').bind(intent.job_id).first();
    assert.deepEqual({ ...job }, { status: 'failed', page_count: null, result_code: 'page_copy_budget_exceeded' });
});

test('upload intent rejects tampered orientation and copy values before creating a job', async () => {
    const { environment, database } = createEnvironment();
    await createPrintRepository(database).heartbeat({ printerId: 'office-printer', runnerId: 'runner-1', health: 'ready',
        printerName: 'Uluslararası Ofis', settingsProtocol: 2, now: new Date().toISOString() });
    const base = { byte_size: 8, copies: 1, media_type: 'application/pdf', paper_size: 'A4', color_mode: 'monochrome',
        duplex: 'simplex', orientation: 'portrait', idempotency_key: '7'.repeat(64), tracking_token: '8'.repeat(64),
        upload_token: '9'.repeat(64) };
    const invalidBodies = [
        { ...base, copies: 0 }, { ...base, copies: 1.5 }, { ...base, copies: 51 },
        { ...base, orientation: 'sideways' }, (() => { const body = { ...base }; delete body.orientation; return body; })()
    ];

    for (const body of invalidBodies) {
        const response = await worker.fetch(request('/api/public/print/upload-intents', { method: 'POST', body }), environment);
        assert.equal(response.status, 400);
    }
    assert.equal(database.prepare('SELECT count(*) AS count FROM print_jobs').first().count, 0);
});
