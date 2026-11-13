import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { withTestApplicationPrivacyNotice, withTestApplicationPrivacyNoticeVersion } from './helpers/application-privacy-notice.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const API_ROOT = '/api/public/applications/current/documents';
const MASTER = Buffer.alloc(32, 5).toString('base64');

/** Minimal in-memory S3-compatible host reached through the DOCUMENT_STORE binding. */
function createFakeHost() {
    const objects = new Map();
    let counter = 0;
    const fetch = async (request) => {
        const key = decodeURIComponent(new URL(request.url).pathname.replace(/^\/documents\//, ''));
        const body = new Uint8Array(await request.arrayBuffer());
        if (request.method === 'PUT') {
            if (request.headers.get('if-none-match') === '*' && objects.has(key)) return new Response(null, { status: 412 });
            counter += 1;
            objects.set(key, { body, etag: `"e${counter}"`, meta: request.headers.get('x-amz-meta-goc-content-type') });
            return new Response(null, { status: 200, headers: { etag: `"e${counter}"` } });
        }
        if (request.method === 'DELETE') { objects.delete(key); return new Response(null, { status: 204 }); }
        const stored = objects.get(key);
        if (!stored) return new Response(null, { status: 404 });
        const headers = { etag: stored.etag, 'content-length': String(stored.body.length), 'x-amz-meta-goc-content-type': stored.meta };
        return request.method === 'GET' ? new Response(stored.body, { headers }) : new Response(null, { headers });
    };
    return { objects, fetch };
}

function createRemoteEnvironment(host, overrides = {}) {
    const DB = new TestD1Database();
    applyAllMigrations(DB);
    return {
        DB,
        APP_ENV: 'test',
        DOCUMENT_STORAGE_BACKEND: 'remote',
        DOCUMENT_STORE_ENDPOINT: 'http://127.0.0.1:9000',
        DOCUMENT_STORE_BUCKET: 'documents',
        DOCUMENT_STORE_ACCESS_KEY_ID: 'test-access',
        DOCUMENT_STORE_SECRET_ACCESS_KEY: 'test-secret',
        DOCUMENT_ENCRYPTION_KEYS: JSON.stringify({ 1: MASTER }),
        DOCUMENT_ENCRYPTION_KEY_ID: '1',
        DOCUMENT_STORE: { fetch: host.fetch },
        ...withTestApplicationPrivacyNotice({}),
        ...overrides
    };
}

async function createApplicant(environment, studentNumber) {
    const response = await worker.fetch(new Request('https://portal.test/api/public/applications', {
        method: 'POST',
        headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json' },
        body: JSON.stringify(withTestApplicationPrivacyNoticeVersion({
            student_number: studentNumber, application_type: 'initial',
            email: `${studentNumber}@example.edu`, phone: '+905551112233'
        }))
    }), environment, {});
    assert.equal(response.status, 201);
    return response.headers.get('Set-Cookie').split(';')[0];
}

function request(path, { method, cookie, origin = 'https://portal.test', headers = {}, body } = {}) {
    const requestHeaders = new Headers({ Origin: origin, ...headers });
    if (cookie) requestHeaders.set('Cookie', cookie);
    return new Request(`https://portal.test${path}`, { method, headers: requestHeaders, body });
}

test('with the remote backend a student upload passes through the Worker, is stored encrypted, and finalizes', async () => {
    const host = createFakeHost();
    const environment = createRemoteEnvironment(host);
    const cookie = await createApplicant(environment, 'REMOTE-UPLOAD-1');
    const bytes = new TextEncoder().encode('%PDF-secret-passport');
    const intentResponse = await worker.fetch(request(`${API_ROOT}/upload-intent`, {
        method: 'POST', cookie, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: bytes.byteLength })
    }), environment, {});
    assert.equal(intentResponse.status, 201, await intentResponse.clone().text());
    const { upload } = await intentResponse.json();
    assert.equal(new URL(upload.url).origin, 'https://portal.test');
    assert.match(new URL(upload.url).pathname, /\/local-upload\/[0-9a-f-]{36}$/i);

    const put = () => worker.fetch(request(new URL(upload.url).pathname, {
        method: 'PUT', cookie, body: bytes,
        headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(bytes.byteLength), 'If-None-Match': '*' }
    }), environment, {});
    assert.equal((await put()).status, 204);
    assert.equal(host.objects.size, 1);
    const stored = [...host.objects.values()][0].body;
    assert.equal(Buffer.from(stored).includes(Buffer.from('secret-passport')), false);
    assert.equal((await put()).status, 409);

    const finalized = await worker.fetch(request(`${API_ROOT}/finalize`, {
        method: 'POST', cookie, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent_id: upload.intent_id })
    }), environment, {});
    assert.equal(finalized.status, 200, await finalized.clone().text());
    assert.equal((await finalized.json()).document.upload_status, 'finalized');
});

test('the remote upload route still requires the owner session and a same-origin request', async () => {
    const host = createFakeHost();
    const environment = createRemoteEnvironment(host);
    const cookie = await createApplicant(environment, 'REMOTE-UPLOAD-AUTH');
    const otherCookie = await createApplicant(environment, 'REMOTE-UPLOAD-OTHER');
    const { upload } = await (await worker.fetch(request(`${API_ROOT}/upload-intent`, {
        method: 'POST', cookie, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: 4 })
    }), environment, {})).json();
    const path = new URL(upload.url).pathname;
    const body = new Uint8Array([37, 80, 68, 70]);
    const headers = { 'Content-Type': 'application/pdf', 'If-None-Match': '*' };
    assert.equal((await worker.fetch(request(path, { method: 'PUT', body, headers }), environment, {})).status, 401);
    assert.equal((await worker.fetch(request(path, { method: 'PUT', cookie, origin: 'https://attacker.test', body, headers }), environment, {})).status, 403);
    assert.equal((await worker.fetch(request(path, { method: 'PUT', cookie: otherCookie, body, headers }), environment, {})).status, 404);
    assert.equal(host.objects.size, 0);
});

test('a storage outage during a proxied upload answers 503 and leaves the intent retryable', async () => {
    const host = createFakeHost();
    const environment = createRemoteEnvironment(host);
    const cookie = await createApplicant(environment, 'REMOTE-UPLOAD-OUTAGE');
    const { upload } = await (await worker.fetch(request(`${API_ROOT}/upload-intent`, {
        method: 'POST', cookie, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: 4 })
    }), environment, {})).json();
    environment.DOCUMENT_STORE = { fetch: async () => { throw new Error('tunnel down'); } };
    const down = await worker.fetch(request(new URL(upload.url).pathname, {
        method: 'PUT', cookie, body: new Uint8Array([37, 80, 68, 70]),
        headers: { 'Content-Type': 'application/pdf', 'If-None-Match': '*' }
    }), environment, {});
    assert.equal(down.status, 503);
    environment.DOCUMENT_STORE = { fetch: host.fetch };
    const retry = await worker.fetch(request(new URL(upload.url).pathname, {
        method: 'PUT', cookie, body: new Uint8Array([37, 80, 68, 70]),
        headers: { 'Content-Type': 'application/pdf', 'If-None-Match': '*' }
    }), environment, {});
    assert.equal(retry.status, 204);
});

test('the resubmission upload route is closed unless the Worker-proxied upload mode is active', async () => {
    const host = createFakeHost();
    const closed = createRemoteEnvironment(host, { DOCUMENT_STORAGE_BACKEND: 'r2' });
    const path = `${API_ROOT}/resubmission-upload/00000000-0000-4000-8000-000000000000`;
    const headers = { 'Content-Type': 'application/pdf' };
    const body = new Uint8Array([37, 80, 68, 70]);
    assert.equal((await worker.fetch(request(path, { method: 'PUT', body, headers }), closed, {})).status, 404);
    const open = createRemoteEnvironment(host);
    assert.equal((await worker.fetch(request(path, { method: 'PUT', body, headers }), open, {})).status, 401);
});
