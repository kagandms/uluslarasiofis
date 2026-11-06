import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { withTestApplicationPrivacyNotice, withTestApplicationPrivacyNoticeVersion } from './helpers/application-privacy-notice.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const API_ROOT = '/api/public/applications/current/documents';

class LocalR2Bucket {
    objects = new Map();
    writeOptions = [];

    async put(key, body, options = {}) {
        this.writeOptions.push(options);
        if (options.onlyIf?.etagDoesNotMatch === '*' && this.objects.has(key)) return null;
        const bytes = new Uint8Array(await new Response(body).arrayBuffer());
        const object = { key, size: bytes.byteLength, bytes, httpMetadata: options.httpMetadata };
        this.objects.set(key, object);
        return object;
    }

    async head(key) {
        const object = this.objects.get(key);
        return object ? { key, size: object.size, httpMetadata: object.httpMetadata } : null;
    }

    async delete(key) { this.objects.delete(key); }
}

function createEnvironment(overrides = {}) {
    const DB = new TestD1Database();
    applyAllMigrations(DB);
    const DOCUMENTS = new LocalR2Bucket();
    return {
        DB,
        DOCUMENTS,
        APP_ENV: 'local',
        LOCAL_DOCUMENT_UPLOADS: 'enabled',
        R2_BUCKET_NAME: 'uluslarasiofis-documents-local',
        ...withTestApplicationPrivacyNotice({}),
        ...overrides
    };
}

async function createApplicant(environment, studentNumber) {
    const response = await worker.fetch(new Request('https://portal.test/api/public/applications', {
        method: 'POST',
        headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json' },
        body: JSON.stringify(withTestApplicationPrivacyNoticeVersion({
            student_number: studentNumber,
            application_type: 'initial',
            email: `${studentNumber}@example.edu`,
            phone: '+905551112233'
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

async function createIntent(environment, cookie, { byteSize = 4, mediaType = 'application/pdf' } = {}) {
    return worker.fetch(request(`${API_ROOT}/upload-intent`, {
        method: 'POST', cookie,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'passport', filename: 'LOCAL-UAT-passport.pdf', media_type: mediaType, byte_size: byteSize })
    }), environment, {});
}

test('local document upload writes once to the bound R2 bucket and finalizes through the normal verifier', async () => {
    const environment = createEnvironment();
    const cookie = await createApplicant(environment, 'LOCAL-UAT-UPLOAD-SUCCESS');
    const intentResponse = await createIntent(environment, cookie);
    assert.equal(intentResponse.status, 201, await intentResponse.clone().text());
    const payload = await intentResponse.json();

    assert.equal(intentResponse.status, 201);
    assert.equal(new URL(payload.upload.url).origin, 'https://portal.test');
    assert.match(new URL(payload.upload.url).pathname, /\/local-upload\/[0-9a-f-]{36}$/i);
    assert.deepEqual(payload.upload.required_headers, {
        'content-type': 'application/pdf', 'if-none-match': '*'
    });

    const uploadPath = new URL(payload.upload.url).pathname;
    const body = new Uint8Array([37, 80, 68, 70]);
    const uploaded = await worker.fetch(request(uploadPath, {
        method: 'PUT', cookie, body,
        headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(body.byteLength), 'If-None-Match': '*' }
    }), environment, {});

    assert.equal(uploaded.status, 204);
    assert.equal(environment.DOCUMENTS.objects.size, 1);
    assert.deepEqual(environment.DOCUMENTS.writeOptions[0].onlyIf, { etagDoesNotMatch: '*' });

    const replayed = await worker.fetch(request(uploadPath, {
        method: 'PUT', cookie, body: new Uint8Array([1, 2, 3, 4]),
        headers: { 'Content-Type': 'application/pdf', 'Content-Length': '4', 'If-None-Match': '*' }
    }), environment, {});
    assert.equal(replayed.status, 409);
    assert.deepEqual([...environment.DOCUMENTS.objects.values()][0].bytes, body);

    const finalizeResponse = await worker.fetch(request(`${API_ROOT}/finalize`, {
        method: 'POST', cookie,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent_id: payload.upload.intent_id })
    }), environment, {});
    const finalized = await finalizeResponse.json();

    assert.equal(finalizeResponse.status, 200);
    assert.deepEqual(finalized.document, {
        code: 'passport', revision_number: 1, upload_status: 'finalized', scan_status: 'pending'
    });
    assert.equal(environment.DB.prepare("SELECT count(*) AS n FROM document_revision_files WHERE upload_status='finalized'").first().n, 1);
});

test('local upload requires the owner session and same-origin context before writing to R2', async () => {
    const environment = createEnvironment();
    const cookie = await createApplicant(environment, 'LOCAL-UAT-UPLOAD-AUTH');
    const otherCookie = await createApplicant(environment, 'LOCAL-UAT-UPLOAD-OTHER-OWNER');
    const intent = await (await createIntent(environment, cookie)).json();
    const path = new URL(intent.upload.url).pathname;
    const body = new Uint8Array([37, 80, 68, 70]);

    const missingSession = await worker.fetch(request(path, {
        method: 'PUT', body, headers: { 'Content-Type': 'application/pdf', 'If-None-Match': '*' }
    }), environment, {});
    const crossOrigin = await worker.fetch(request(path, {
        method: 'PUT', cookie, origin: 'https://attacker.test', body,
        headers: { 'Content-Type': 'application/pdf', 'If-None-Match': '*' }
    }), environment, {});
    const wrongOwner = await worker.fetch(request(path, {
        method: 'PUT', cookie: otherCookie, body,
        headers: { 'Content-Type': 'application/pdf', 'If-None-Match': '*' }
    }), environment, {});

    assert.equal(missingSession.status, 401);
    assert.equal(crossOrigin.status, 403);
    assert.equal(wrongOwner.status, 404);
    assert.equal(environment.DOCUMENTS.objects.size, 0);
});

test('local upload rejects body size and media mismatches without persisting an object', async () => {
    const environment = createEnvironment();
    const cookie = await createApplicant(environment, 'LOCAL-UAT-UPLOAD-METADATA');
    const intent = await (await createIntent(environment, cookie)).json();
    const path = new URL(intent.upload.url).pathname;

    const wrongSize = await worker.fetch(request(path, {
        method: 'PUT', cookie, body: new Uint8Array([37, 80, 68]),
        headers: { 'Content-Type': 'application/pdf', 'Content-Length': '3', 'If-None-Match': '*' }
    }), environment, {});
    assert.equal(wrongSize.status, 400);

    const wrongType = await worker.fetch(request(path, {
        method: 'PUT', cookie, body: new Uint8Array([37, 80, 68, 70]),
        headers: { 'Content-Type': 'image/png', 'Content-Length': '4', 'If-None-Match': '*' }
    }), environment, {});
    assert.equal(wrongType.status, 415);
    assert.equal(environment.DOCUMENTS.objects.size, 0);
});

test('production environment cannot opt into the local R2 upload route', async () => {
    const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
    assert.equal(config.vars.APP_ENV, 'local');
    assert.equal(config.vars.R2_BUCKET_NAME, 'uluslarasiofis-documents-local');
    assert.equal(Object.hasOwn(config.vars, 'LOCAL_DOCUMENT_UPLOADS'), false);
    for (const environmentName of ['staging', 'production']) {
        assert.notEqual(config.env[environmentName].vars.APP_ENV, 'local');
        assert.notEqual(config.env[environmentName].vars.R2_BUCKET_NAME, 'uluslarasiofis-documents-local');
    }

    for (const environmentName of ['staging', 'production']) {
        const environment = createEnvironment({
            ...config.env[environmentName].vars,
            LOCAL_DOCUMENT_UPLOADS: 'enabled',
            R2_BUCKET_NAME: 'uluslarasiofis-documents-local'
        });
        const response = await worker.fetch(request(`${API_ROOT}/local-upload/00000000-0000-4000-8000-000000000000`, {
            method: 'PUT', body: new Uint8Array([37, 80, 68, 70]),
            headers: { 'Content-Type': 'application/pdf', 'If-None-Match': '*' }
        }), environment, {});

        assert.equal(response.status, 404);
        assert.equal(environment.DOCUMENTS.objects.size, 0);
    }
});
