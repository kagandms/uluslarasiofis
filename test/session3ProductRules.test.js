import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

function createEnvironment() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const storedObjects = new Map();
    const bucket = {
        async put(key, body, options = {}) {
            const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
            storedObjects.set(key, { bytes, contentType: options.httpMetadata?.contentType || 'application/pdf' });
            return { key };
        },
        async head(key) {
            const object = storedObjects.get(key);
            return object ? { key, size: object.bytes.byteLength, httpMetadata: { contentType: object.contentType } } : null;
        },
        async get(key) {
            const object = storedObjects.get(key);
            return object ? { key, body: new Response(object.bytes).body, httpMetadata: { contentType: object.contentType } } : null;
        },
        async delete(key) {
            storedObjects.delete(key);
        }
    };
    return {
        database,
        storedObjects,
        environment: {
            DB: database,
            DOCUMENTS: bucket,
            R2_ACCOUNT_ID: 'a'.repeat(32),
            R2_BUCKET_NAME: 'portal-documents',
            R2_ACCESS_KEY_ID: 'test-access-key',
            R2_SECRET_ACCESS_KEY: 'test-secret-key'
        }
    };
}

function createRequest(path, { method = 'GET', body, cookie, origin = 'https://portal.test' } = {}) {
    const headers = new Headers({ Origin: origin });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (cookie) headers.set('Cookie', cookie);
    return new Request(`https://portal.test${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
}

async function createDraft(environment, studentNumber) {
    const response = await worker.fetch(createRequest('/api/public/applications', {
        method: 'POST',
        body: {
            student_number: studentNumber,
            application_type: 'initial',
            email: `${studentNumber}@example.edu`,
            phone: '+905551112233'
        }
    }), environment, {});
    return {
        response,
        payload: await response.json(),
        cookie: response.headers.get('Set-Cookie')?.split(';')[0]
    };
}

async function putSignedFile(environment, url, contentType, bytes = new Uint8Array([37, 80, 68, 70])) {
    const pathParts = new URL(url).pathname.split('/').filter(Boolean);
    const storageKey = pathParts.slice(-2).join('/');
    await environment.DOCUMENTS.put(storageKey, bytes, { httpMetadata: { contentType } });
}

test('new and Session 2 drafts expose an empty student-safe fingerprint state', async () => {
    const { environment } = createEnvironment();
    const created = await createDraft(environment, '2026123901');
    const response = await worker.fetch(createRequest('/api/public/applications/current', { cookie: created.cookie }), environment, {});
    const payload = await response.json();

    assert.equal(created.response.status, 201);
    assert.equal(payload.application.fingerprint_status, null);
    assert.equal(payload.application.fingerprint_code, null);
    assert.equal(Object.hasOwn(payload.application, 'id'), false);
    assert.equal(Object.hasOwn(payload.application, 'storage_key'), false);
});

test('registered fingerprint status persists a trimmed code without adding authorization fields', async () => {
    const { environment, database } = createEnvironment();
    const created = await createDraft(environment, '2026123902');
    const response = await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie: created.cookie,
        body: { fingerprint_status: 'registered', fingerprint_code: '  FP-A/42 x  ' }
    }), environment, {});
    const payload = await response.json();
    const row = database.prepare('SELECT fingerprint_status, fingerprint_code FROM applications').first();

    assert.equal(response.status, 200);
    assert.equal(row.fingerprint_status, 'registered');
    assert.equal(row.fingerprint_code, 'FP-A/42 x');
    assert.equal(payload.application.fingerprint_status, 'registered');
    assert.equal(payload.application.fingerprint_code, 'FP-A/42 x');
    assert.equal(Object.hasOwn(payload.application, 'application_id'), false);
    const unauthenticated = await worker.fetch(createRequest('/api/public/applications/current'), environment, {});
    assert.equal(unauthenticated.status, 401);
});

test('not-registered status clears an earlier fingerprint code and remains outstanding data', async () => {
    const { environment, database } = createEnvironment();
    const created = await createDraft(environment, '2026123903');
    await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie: created.cookie,
        body: { fingerprint_status: 'registered', fingerprint_code: 'FP-123' }
    }), environment, {});

    const response = await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie: created.cookie,
        body: { fingerprint_status: 'not_registered', fingerprint_code: 'FP-123' }
    }), environment, {});
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.application.fingerprint_status, 'not_registered');
    assert.equal(payload.application.fingerprint_code, null);
    const row = database.prepare('SELECT fingerprint_status, fingerprint_code FROM applications').first();
    assert.equal(row.fingerprint_status, 'not_registered');
    assert.equal(row.fingerprint_code, null);
});

test('fingerprint state rejects undocumented statuses and overlong codes', async () => {
    const { environment } = createEnvironment();
    const created = await createDraft(environment, '2026123904');
    const invalidStatus = await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie: created.cookie, body: { fingerprint_status: 'maybe' }
    }), environment, {});
    const longCode = await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie: created.cookie,
        body: { fingerprint_status: 'registered', fingerprint_code: 'x'.repeat(129) }
    }), environment, {});

    assert.equal(invalidStatus.status, 400);
    assert.equal(longCode.status, 400);
});

test('switching from not registered to registered leaves a missing code incomplete', async () => {
    const { environment, database } = createEnvironment();
    const created = await createDraft(environment, '2026123916');
    const update = (body) => worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie: created.cookie, body
    }), environment, {});
    await update({ fingerprint_status: 'not_registered' });
    const response = await update({ fingerprint_status: 'registered' });
    const payload = await response.json();
    const row = database.prepare('SELECT fingerprint_status, fingerprint_code FROM applications').first();

    assert.equal(response.status, 200);
    assert.equal(payload.application.fingerprint_status, 'registered');
    assert.equal(payload.application.fingerprint_code, null);
    assert.equal(row.fingerprint_status, 'registered');
    assert.equal(row.fingerprint_code, null);
});

test('fingerprint updates are owner-session and same-origin protected', async () => {
    const { environment, database } = createEnvironment();
    const studentA = await createDraft(environment, '2026123905');
    const studentB = await createDraft(environment, '2026123906');
    const otherStudentRead = await worker.fetch(createRequest('/api/public/applications/current', { cookie: studentA.cookie }), environment, {});
    const crossOriginUpdate = await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie: studentA.cookie, origin: 'https://attacker.test',
        body: { fingerprint_status: 'registered', fingerprint_code: 'FP-A' }
    }), environment, {});
    const ownerUpdate = await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie: studentB.cookie,
        body: { fingerprint_status: 'not_registered' }
    }), environment, {});

    assert.equal(otherStudentRead.status, 200);
    assert.equal(crossOriginUpdate.status, 403);
    assert.equal(ownerUpdate.status, 200);
    const states = database.prepare(`
        SELECT applications.fingerprint_status FROM applications
        JOIN students ON students.id = applications.student_id ORDER BY students.student_number
    `).all().results.map(({ fingerprint_status }) => fingerprint_status);
    assert.deepEqual(states, [null, 'not_registered']);
});

test('student number and fingerprint code do not authorize cross-application access', async () => {
    const { environment, database } = createEnvironment();
    const studentA = await createDraft(environment, '2026123917');
    const studentB = await createDraft(environment, '2026123918');
    const studentBId = database.prepare(`
        SELECT applications.id FROM applications
        JOIN students ON students.id = applications.student_id
        WHERE students.student_number = '2026123918'
    `).first().id;
    await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie: studentB.cookie,
        body: { fingerprint_status: 'registered', fingerprint_code: 'B-SECRET-CODE' }
    }), environment, {});

    const readWithIdentifier = await worker.fetch(createRequest(`/api/public/applications/current?application_id=${studentBId}&student_number=2026123918`, {
        cookie: studentA.cookie
    }), environment, {});
    const patchWithOtherApplicationId = await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie: studentA.cookie,
        body: { application_id: studentBId, fingerprint_status: 'not_registered', fingerprint_code: 'B-SECRET-CODE' }
    }), environment, {});
    const readA = await readWithIdentifier.json();
    const rowB = database.prepare(`
        SELECT applications.fingerprint_status, applications.fingerprint_code
        FROM applications WHERE applications.id = ?
    `).bind(studentBId).first();

    assert.equal(readWithIdentifier.status, 200);
    assert.equal(readA.application.student_number, '2026123917');
    assert.equal(readA.application.fingerprint_code, null);
    assert.equal(patchWithOtherApplicationId.status, 200);
    assert.equal(rowB.fingerprint_status, 'registered');
    assert.equal(rowB.fingerprint_code, 'B-SECRET-CODE');
});

test('expired application sessions cannot change fingerprint state', async () => {
    const { environment, database } = createEnvironment();
    const created = await createDraft(environment, '2026123907');
    const token = created.cookie.split('=')[1];
    await database.prepare('UPDATE application_sessions SET expires_at = ? WHERE token_hash = ?')
        .bind(new Date(Date.now() - 1000).toISOString(), await hashSessionToken(token)).run();

    const response = await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie: created.cookie, body: { fingerprint_status: 'registered' }
    }), environment, {});

    assert.equal(response.status, 401);
    assert.equal(database.prepare('SELECT fingerprint_status FROM applications').first().fingerprint_status, null);
});

test('server-calculated document requirements change with the saved under-18 state', async () => {
    const { environment, database } = createEnvironment();
    const adult = await createDraft(environment, '2026123908');
    const updateAge = async (cookie, isUnder18) => worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie, body: { is_under_18: isUnder18 }
    }), environment, {});
    const listRequirements = async (cookie) => worker.fetch(createRequest('/api/public/applications/current/documents', { cookie }), environment, {});

    await updateAge(adult.cookie, false);
    const adultResponse = await listRequirements(adult.cookie);
    const adultPayload = await adultResponse.json();
    assert.equal(adultResponse.status, 200);
    assert.equal(adultPayload.requirements.some(({ code }) => code === 'birth_certificate_under18'), false);

    await updateAge(adult.cookie, true);
    const minorResponse = await listRequirements(adult.cookie);
    const minorPayload = await minorResponse.json();
    const birthCertificate = minorPayload.requirements.find(({ code }) => code === 'birth_certificate_under18');
    assert.equal(minorResponse.status, 200);
    assert.equal(birthCertificate.is_required, true);
    assert.equal(minorPayload.requirements.filter(({ code }) => code === 'fingerprint').length, 1);
    assert.equal(minorPayload.requirements.some(({ code }) => code.includes('parental') || code.includes('guardian')), false);
    assert.equal(database.prepare('SELECT is_under_18 FROM applications').first().is_under_18, 1);
});

test('adult sessions cannot create a birth certificate upload intent by supplying its code', async () => {
    const { environment } = createEnvironment();
    const adult = await createDraft(environment, '2026123909');
    await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie: adult.cookie, body: { is_under_18: false }
    }), environment, {});

    const response = await worker.fetch(createRequest('/api/public/applications/current/documents/upload-intent', {
        method: 'POST', cookie: adult.cookie,
        body: { code: 'birth_certificate_under18', filename: 'birth.pdf', media_type: 'application/pdf', byte_size: 4 }
    }), environment, {});

    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'DOCUMENT_REQUIREMENT_NOT_FOUND');
});

test('student document requirements and upload intents are scoped to the current application session', async () => {
    const { environment } = createEnvironment();
    const studentA = await createDraft(environment, '2026123910');
    const studentB = await createDraft(environment, '2026123911');
    await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie: studentB.cookie, body: { is_under_18: true }
    }), environment, {});

    const studentARequirements = await worker.fetch(createRequest('/api/public/applications/current/documents', { cookie: studentA.cookie }), environment, {});
    const studentBRequirements = await worker.fetch(createRequest('/api/public/applications/current/documents', { cookie: studentB.cookie }), environment, {});
    const payloadA = await studentARequirements.json();
    const payloadB = await studentBRequirements.json();
    const studentBIntent = await worker.fetch(createRequest('/api/public/applications/current/documents/upload-intent', {
        method: 'POST', cookie: studentB.cookie,
        body: { code: 'birth_certificate_under18', filename: 'birth.pdf', media_type: 'application/pdf', byte_size: 4 }
    }), environment, {});
    const intentPayload = await studentBIntent.json();
    assert.equal(studentBIntent.status, 201);
    const crossStudentFinalize = await worker.fetch(createRequest('/api/public/applications/current/documents/finalize', {
        method: 'POST', cookie: studentA.cookie, body: { intent_id: intentPayload.upload.intent_id }
    }), environment, {});

    assert.equal(payloadA.requirements.some(({ code }) => code === 'birth_certificate_under18'), false);
    assert.equal(payloadB.requirements.some(({ code }) => code === 'birth_certificate_under18'), true);
    assert.equal(studentBIntent.status, 201);
    assert.equal(crossStudentFinalize.status, 404);
});

test('document upload intents reject cross-origin mutations and expired student sessions', async () => {
    const { environment, database } = createEnvironment();
    const created = await createDraft(environment, '2026123912');
    const crossOrigin = await worker.fetch(createRequest('/api/public/applications/current/documents/upload-intent', {
        method: 'POST', cookie: created.cookie, origin: 'https://attacker.test',
        body: { code: 'fingerprint', filename: 'fingerprint.pdf', media_type: 'application/pdf', byte_size: 4 }
    }), environment, {});
    const token = created.cookie.split('=')[1];
    await database.prepare('UPDATE application_sessions SET expires_at = ? WHERE token_hash = ?')
        .bind(new Date(Date.now() - 1000).toISOString(), await hashSessionToken(token)).run();
    const expiredSession = await worker.fetch(createRequest('/api/public/applications/current/documents/upload-intent', {
        method: 'POST', cookie: created.cookie,
        body: { code: 'fingerprint', filename: 'fingerprint.pdf', media_type: 'application/pdf', byte_size: 4 }
    }), environment, {});

    assert.equal(crossOrigin.status, 403);
    assert.equal(expiredSession.status, 401);
});

test('fingerprint uploads use direct R2 capabilities and replacement creates a new current revision', async () => {
    const { environment, database } = createEnvironment();
    const created = await createDraft(environment, '2026123913');
    const createIntent = async (filename) => worker.fetch(createRequest('/api/public/applications/current/documents/upload-intent', {
        method: 'POST', cookie: created.cookie,
        body: { code: 'fingerprint', filename, media_type: 'application/pdf', byte_size: 4 }
    }), environment, {});
    const finalize = async (intentId) => worker.fetch(createRequest('/api/public/applications/current/documents/finalize', {
        method: 'POST', cookie: created.cookie, body: { intent_id: intentId }
    }), environment, {});

    const firstIntentResponse = await createIntent('fingerprint-one.pdf');
    const firstIntent = await firstIntentResponse.json();
    await putSignedFile(environment, firstIntent.upload.url, 'application/pdf');
    const firstFinalizeResponse = await finalize(firstIntent.upload.intent_id);
    const firstFinalize = await firstFinalizeResponse.json();
    const secondIntentResponse = await createIntent('fingerprint-two.pdf');
    const secondIntent = await secondIntentResponse.json();
    await putSignedFile(environment, secondIntent.upload.url, 'application/pdf');
    const secondFinalizeResponse = await finalize(secondIntent.upload.intent_id);
    const secondFinalize = await secondFinalizeResponse.json();
    const duplicateFinalizeResponse = await finalize(secondIntent.upload.intent_id);
    const rows = database.prepare(`
        SELECT revisions.revision_number, revisions.status, revisions.is_current,
               files.upload_status, files.scan_status
        FROM document_revisions AS revisions
        JOIN document_records AS records ON records.id = revisions.document_record_id
        JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
        JOIN document_revision_files AS files ON files.revision_id = revisions.id
        JOIN applications ON applications.id = records.application_id
        JOIN students ON students.id = applications.student_id
        WHERE students.student_number = '2026123913' AND requirements.code = 'fingerprint'
        ORDER BY revisions.revision_number
    `).all().results;

    assert.equal(firstIntentResponse.status, 201);
    assert.equal(firstIntent.upload.method, 'PUT');
    assert.equal(firstIntent.upload.required_headers['content-type'], 'application/pdf');
    assert.equal(Object.hasOwn(firstIntent.upload, 'storage_key'), false);
    assert.equal(firstFinalizeResponse.status, 200);
    assert.equal(secondFinalizeResponse.status, 200);
    assert.equal(duplicateFinalizeResponse.status, 200);
    assert.equal(secondFinalize.document.revision_number, 2);
    assert.deepEqual(rows.map(({ revision_number, status, is_current, upload_status, scan_status }) => ({
        revision_number, status, is_current, upload_status, scan_status
    })), [
        { revision_number: 1, status: 'superseded', is_current: 0, upload_status: 'finalized', scan_status: 'pending' },
        { revision_number: 2, status: 'submitted', is_current: 1, upload_status: 'finalized', scan_status: 'pending' }
    ]);
});

test('finalize rejects a wrong-size object and does not mark the document complete', async () => {
    const { environment, database } = createEnvironment();
    const created = await createDraft(environment, '2026123914');
    const intentResponse = await worker.fetch(createRequest('/api/public/applications/current/documents/upload-intent', {
        method: 'POST', cookie: created.cookie,
        body: { code: 'fingerprint', filename: 'fingerprint.pdf', media_type: 'application/pdf', byte_size: 5 }
    }), environment, {});
    const intent = await intentResponse.json();
    await putSignedFile(environment, intent.upload.url, 'application/pdf', new Uint8Array([1, 2, 3, 4]));
    const finalizeResponse = await worker.fetch(createRequest('/api/public/applications/current/documents/finalize', {
        method: 'POST', cookie: created.cookie, body: { intent_id: intent.upload.intent_id }
    }), environment, {});

    assert.equal(finalizeResponse.status, 409);
    assert.equal((await finalizeResponse.json()).error.code, 'UPLOAD_OBJECT_MISMATCH');
    assert.equal(database.prepare("SELECT upload_status FROM document_revision_files").first().upload_status, 'rejected');
});

test('birth certificate uploaded by an under-18 student cannot be finalized after age state changes', async () => {
    const { environment, database } = createEnvironment();
    const created = await createDraft(environment, '2026123915');
    await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie: created.cookie, body: { is_under_18: true }
    }), environment, {});
    const intentResponse = await worker.fetch(createRequest('/api/public/applications/current/documents/upload-intent', {
        method: 'POST', cookie: created.cookie,
        body: { code: 'birth_certificate_under18', filename: 'birth.pdf', media_type: 'application/pdf', byte_size: 4 }
    }), environment, {});
    const intent = await intentResponse.json();
    await putSignedFile(environment, intent.upload.url, 'application/pdf');
    await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie: created.cookie, body: { is_under_18: false }
    }), environment, {});
    const finalizeResponse = await worker.fetch(createRequest('/api/public/applications/current/documents/finalize', {
        method: 'POST', cookie: created.cookie, body: { intent_id: intent.upload.intent_id }
    }), environment, {});
    const requirementsResponse = await worker.fetch(createRequest('/api/public/applications/current/documents', { cookie: created.cookie }), environment, {});
    const requirements = await requirementsResponse.json();

    assert.equal(finalizeResponse.status, 404);
    assert.equal((await finalizeResponse.json()).error.code, 'DOCUMENT_REQUIREMENT_NOT_FOUND');
    assert.equal(requirements.requirements.some(({ code }) => code === 'birth_certificate_under18'), false);
    assert.equal(database.prepare('SELECT upload_status FROM document_revision_files').first().upload_status, 'intent');
});
