import assert from 'node:assert/strict';
import test from 'node:test';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const OCR_PATH = '/api/public/applications/current/passport/ocr';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const PASSPORT_MRZ = [
    'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
    'L898902C36UTO7408122F1204159ZE184226B<<<<<10'
];

function createEnvironment(options = {}) {
    const database = new TestD1Database();
    applyAllMigrations(database);
    return {
        database,
        environment: {
            DB: database,
            AZURE_VISION_ENDPOINT: 'https://vision.example.test/',
            AZURE_VISION_KEY: 'test-azure-key',
            GOOGLE_VISION_API_KEY: 'test-google-key',
            ...options
        }
    };
}

function createRequest(path, { method = 'POST', cookie, origin = 'https://portal.test', contentType = 'image/jpeg', body = IMAGE_BYTES, clientAddress = '203.0.113.25' } = {}) {
    const headers = new Headers({ Origin: origin, 'CF-Connecting-IP': clientAddress });
    if (cookie) headers.set('Cookie', cookie);
    if (contentType) headers.set('Content-Type', contentType);
    return new Request(`https://portal.test${path}`, { method, headers, body });
}

async function createApplicant(environment, studentNumber) {
    const response = await worker.fetch(new Request('https://portal.test/api/public/applications', {
        method: 'POST',
        headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json' },
        body: JSON.stringify({
            student_number: studentNumber,
            application_type: 'initial',
            email: `${studentNumber}@example.edu`,
            phone: '5551112233'
        })
    }), environment, {});
    assert.equal(response.status, 201);
    const cookie = response.headers.get('Set-Cookie').split(';')[0];
    const application = environment.DB.prepare(`
        SELECT applications.id FROM applications
        JOIN students ON students.id = applications.student_id
        WHERE students.student_number = ?
    `).bind(studentNumber).first();
    return { cookie, applicationId: application.id };
}

function seedFinalizedPassport(database, applicationId) {
    const requirement = database.prepare(`
        SELECT id FROM document_requirements
        WHERE code = 'passport' AND application_type = 'initial' AND is_active = 1
    `).first();
    database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type)
        VALUES (?, ?, ?, 'initial')
    `).bind(`record-${applicationId}`, applicationId, requirement.id).run();
    database.prepare(`
        INSERT INTO document_revisions (id, document_record_id, revision_number, status, is_current, submitted_by_type)
        VALUES (?, ?, 1, 'submitted', 1, 'student')
    `).bind(`revision-${applicationId}`, `record-${applicationId}`).run();
    database.prepare(`
        INSERT INTO document_revision_files (
            id, revision_id, page_order, storage_key, original_filename, media_type,
            byte_size, upload_status, scan_status
        ) VALUES (?, ?, 0, ?, 'passport.jpg', 'image/jpeg', 4, 'finalized', 'pending')
    `).bind(`file-${applicationId}`, `revision-${applicationId}`, `quarantine/${applicationId}`).run();
}

function azureTextResponse(lines = PASSPORT_MRZ) {
    return new Response(JSON.stringify({
        provider_debug: 'provider-secret-sentinel',
        readResult: { blocks: [{ lines: lines.map((text) => ({ text, words: [] })) }] }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function withFetch(fetchMock, callback) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
        await callback();
    } finally {
        globalThis.fetch = originalFetch;
    }
}

test('public passport OCR requires an active owner session and rejects an expired session', async () => {
    const { environment, database } = createEnvironment();
    const owner = await createApplicant(environment, 'OCR-SESSION-1');
    const missing = await worker.fetch(createRequest(OCR_PATH), environment, {});
    const malformed = await worker.fetch(createRequest(OCR_PATH, { cookie: 'application_session=invalid-token' }), environment, {});
    const sessionToken = owner.cookie.split('=')[1];
    await database.prepare('UPDATE application_sessions SET expires_at = ? WHERE token_hash = ?')
        .bind(new Date(Date.now() - 60_000).toISOString(), await hashSessionToken(sessionToken)).run();
    const expired = await worker.fetch(createRequest(OCR_PATH, { cookie: owner.cookie }), environment, {});

    assert.equal(missing.status, 401);
    assert.equal(malformed.status, 401);
    assert.equal(expired.status, 401);
});

test('public passport OCR rejects cross-origin requests before provider access', async () => {
    const { environment } = createEnvironment();
    const owner = await createApplicant(environment, 'OCR-ORIGIN-1');
    let providerCallCount = 0;
    await withFetch(async () => {
        providerCallCount += 1;
        return azureTextResponse();
    }, async () => {
        const response = await worker.fetch(createRequest(OCR_PATH, { cookie: owner.cookie, origin: 'https://attacker.test' }), environment, {});
        assert.equal(response.status, 403);
        assert.equal((await response.json()).error.code, 'CROSS_ORIGIN_REQUEST');
    });
    assert.equal(providerCallCount, 0);
});

test('public passport OCR uses only the current owner and requires an editable draft', async () => {
    const { environment, database } = createEnvironment();
    const ownerA = await createApplicant(environment, 'OCR-OWNER-A');
    const ownerB = await createApplicant(environment, 'OCR-OWNER-B');
    seedFinalizedPassport(database, ownerB.applicationId);
    const unrelatedDocument = await worker.fetch(createRequest(`${OCR_PATH}?application_id=${ownerB.applicationId}`, { cookie: ownerA.cookie }), environment, {});
    await database.prepare("UPDATE applications SET status = 'submitted' WHERE id = ?").bind(ownerB.applicationId).run();
    const lockedApplication = await worker.fetch(createRequest(OCR_PATH, { cookie: ownerB.cookie }), environment, {});

    assert.equal(unrelatedDocument.status, 409);
    assert.equal((await unrelatedDocument.json()).error.code, 'PASSPORT_NOT_FINALIZED');
    assert.equal(lockedApplication.status, 409);
    assert.equal((await lockedApplication.json()).error.code, 'APPLICATION_NOT_EDITABLE');
});

test('public passport OCR requires the current finalized passport revision', async () => {
    const { environment } = createEnvironment();
    const owner = await createApplicant(environment, 'OCR-DOCUMENT-1');
    const response = await worker.fetch(createRequest(OCR_PATH, { cookie: owner.cookie }), environment, {});

    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'PASSPORT_NOT_FINALIZED');
});

test('public passport OCR enforces image media types and bounded payloads', async () => {
    const { environment, database } = createEnvironment();
    const owner = await createApplicant(environment, 'OCR-PAYLOAD-1');
    seedFinalizedPassport(database, owner.applicationId);
    const unsupported = await worker.fetch(createRequest(OCR_PATH, { cookie: owner.cookie, contentType: 'application/pdf' }), environment, {});
    const oversized = await worker.fetch(createRequest(OCR_PATH, {
        cookie: owner.cookie,
        body: new Uint8Array(MAX_IMAGE_BYTES + 1)
    }), environment, {});

    assert.equal(unsupported.status, 415);
    assert.equal((await unsupported.json()).error.code, 'UNSUPPORTED_OCR_MEDIA_TYPE');
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error.code, 'REQUEST_TOO_LARGE');
});

test('public passport OCR rate-limits authenticated image recognition requests', async () => {
    const { environment, database } = createEnvironment();
    const owner = await createApplicant(environment, 'OCR-LIMIT-1');
    seedFinalizedPassport(database, owner.applicationId);
    let providerCallCount = 0;
    await withFetch(async () => {
        providerCallCount += 1;
        return azureTextResponse();
    }, async () => {
        const responses = [];
        for (let index = 0; index < 6; index += 1) {
            responses.push(await worker.fetch(createRequest(OCR_PATH, { cookie: owner.cookie }), environment, {}));
        }

        assert.deepEqual(responses.slice(0, 5).map(({ status }) => status), [200, 200, 200, 200, 200]);
        assert.equal(responses[5].status, 429);
        assert.equal((await responses[5].json()).error.code, 'RATE_LIMITED');
    });
    assert.equal(providerCallCount, 5);
});

test('public passport OCR returns only candidates and leaves application and passport data unchanged', async () => {
    const { environment, database } = createEnvironment();
    const owner = await createApplicant(environment, 'OCR-SUCCESS-1');
    seedFinalizedPassport(database, owner.applicationId);
    let providerCallCount = 0;
    await withFetch(async (url) => {
        providerCallCount += 1;
        assert.match(String(url), /^https:\/\/vision\.example\.test\//);
        return azureTextResponse();
    }, async () => {
        const beforeApplication = database.prepare(`
            SELECT first_name, last_name, passport_number, nationality, date_of_birth
            FROM applications WHERE id = ?
        `).bind(owner.applicationId).first();
        const beforeRevisionCount = database.prepare(`
            SELECT COUNT(*) AS count FROM document_revisions
            WHERE document_record_id = ?
        `).bind(`record-${owner.applicationId}`).first().count;
        const response = await worker.fetch(createRequest(OCR_PATH, { cookie: owner.cookie }), environment, {});
        const payload = await response.json();
        const afterApplication = database.prepare(`
            SELECT first_name, last_name, passport_number, nationality, date_of_birth
            FROM applications WHERE id = ?
        `).bind(owner.applicationId).first();
        const afterRevisionCount = database.prepare(`
            SELECT COUNT(*) AS count FROM document_revisions
            WHERE document_record_id = ?
        `).bind(`record-${owner.applicationId}`).first().count;
        const currentFile = database.prepare(`
            SELECT storage_key, upload_status, scan_status FROM document_revision_files
            WHERE id = ?
        `).bind(`file-${owner.applicationId}`).first();

        assert.equal(response.status, 200);
        assert.deepEqual(payload.fields, {
            first_name: 'ANNA MARIA',
            last_name: 'ERIKSSON',
            passport_number: 'L898902C3',
            nationality: 'UTO',
            date_of_birth: '1974-08-12'
        });
        assert.deepEqual(afterApplication, beforeApplication);
        assert.equal(afterRevisionCount, beforeRevisionCount);
        assert.deepEqual({ ...currentFile }, {
            storage_key: `quarantine/${owner.applicationId}`,
            upload_status: 'finalized',
            scan_status: 'pending'
        });
        assert.doesNotMatch(JSON.stringify(payload), /P<UTO|ZE184|provider-secret|rawText|boundingPoly|storage_key|signed|revision_id/i);
    });
    assert.equal(providerCallCount, 1);
});

test('public passport OCR returns safe errors for provider failure and unhelpful text without Google fallback', async () => {
    const { environment, database } = createEnvironment();
    const owner = await createApplicant(environment, 'OCR-FAILURE-1');
    seedFinalizedPassport(database, owner.applicationId);
    const requestedUrls = [];
    await withFetch(async (url) => {
        requestedUrls.push(String(url));
        return requestedUrls.length === 1
            ? new Response(JSON.stringify({ error: 'sensitive-provider-body' }), { status: 503 })
            : azureTextResponse(['residence permit applicant record']);
    }, async () => {
        const providerFailure = await worker.fetch(createRequest(OCR_PATH, { cookie: owner.cookie }), environment, {});
        const noFields = await worker.fetch(createRequest(OCR_PATH, { cookie: owner.cookie }), environment, {});
        const providerFailurePayload = await providerFailure.json();
        const noFieldsPayload = await noFields.json();

        assert.equal(providerFailure.status, 502);
        assert.equal(providerFailurePayload.error.code, 'OCR_PROVIDER_FAILURE');
        assert.equal(noFields.status, 422);
        assert.equal(noFieldsPayload.error.code, 'OCR_NO_PASSPORT_FIELDS');
        assert.doesNotMatch(JSON.stringify(providerFailurePayload), /sensitive-provider-body|test-azure-key/i);
        assert.doesNotMatch(JSON.stringify(noFieldsPayload), /residence permit applicant record/i);
        assert.ok(requestedUrls.every((url) => !url.includes('googleapis')));
    });
});
