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

async function setFingerprintRegistration(environment, cookie, status, code = null) {
    return worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie, body: { fingerprint_status: status, fingerprint_code: code }
    }), environment, {});
}

async function putSignedFile(environment, url, contentType, bytes = new Uint8Array([37, 80, 68, 70])) {
    const pathParts = new URL(url).pathname.split('/').filter(Boolean);
    const storageKey = pathParts.slice(-2).join('/');
    await environment.DOCUMENTS.put(storageKey, bytes, { httpMetadata: { contentType } });
    return storageKey;
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

test('contact acknowledgement is accepted only explicitly, is versioned, and is idempotent', async () => {
    const { environment, database } = createEnvironment();
    const created = await createDraft(environment, '2026123899');
    const applicationId = database.prepare('SELECT id FROM applications').first().id;
    const acceptanceEvents = () => database.prepare(`
        SELECT event_type, json_extract(safe_metadata_json, '$.version') AS version
        FROM audit_events WHERE application_id = ? AND event_type = 'application.contact_responsibility_accepted'
    `).bind(applicationId).all();

    const current = await worker.fetch(createRequest('/api/public/applications/current', { cookie: created.cookie }), environment, {});
    const currentPayload = await current.json();
    assert.equal(currentPayload.application.contact_acknowledgement.accepted_current, false);
    assert.equal((await acceptanceEvents()).results.length, 0);

    const accept = (version) => worker.fetch(createRequest('/api/public/applications/current/contact-acknowledgement', {
        method: 'POST', cookie: created.cookie, body: { accepted: true, version }
    }), environment, {});
    const stale = await accept('contact-reachability-v0');
    assert.equal(stale.status, 409);

    const first = await accept('contact-reachability-v1');
    const firstPayload = await first.json();
    const repeated = await accept('contact-reachability-v1');
    const events = await acceptanceEvents();

    assert.equal(first.status, 200);
    assert.equal(firstPayload.application.contact_acknowledgement.accepted_version, 'contact-reachability-v1');
    assert.equal(firstPayload.application.contact_acknowledgement.accepted_current, true);
    assert.equal(repeated.status, 200);
    assert.equal(events.results.length, 1);
    assert.equal(events.results[0].version, 'contact-reachability-v1');
});

test('contact acknowledgement rejects a malformed persisted phone without recording acceptance', async () => {
    const { environment, database } = createEnvironment();
    const created = await createDraft(environment, '2026123898');
    const applicationId = database.prepare('SELECT id FROM applications').first().id;
    const invalidPhone = await worker.fetch(createRequest('/api/public/applications/current/autosave', {
        method: 'PATCH', cookie: created.cookie, body: { student_phone: 'not a phone' }
    }), environment, {});
    const response = await worker.fetch(createRequest('/api/public/applications/current/contact-acknowledgement', {
        method: 'POST', cookie: created.cookie,
        body: { accepted: true, version: 'contact-reachability-v1' }
    }), environment, {});
    const acceptanceEvents = await database.prepare(`
        SELECT id FROM audit_events
        WHERE application_id = ? AND event_type = 'application.contact_responsibility_accepted'
    `).bind(applicationId).all();

    assert.equal(invalidPhone.status, 200);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'CONTACT_INFORMATION_INCOMPLETE');
    assert.equal(acceptanceEvents.results.length, 0);
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
    assert.equal(minorPayload.requirements.some(({ code }) => code === 'fingerprint'), false);
    assert.equal(minorPayload.requirements.some(({ code }) => code.includes('parental') || code.includes('guardian')), false);
    assert.equal(database.prepare('SELECT is_under_18 FROM applications').first().is_under_18, 1);
});

test('address evidence choices select one server-enforced branch and branch changes preserve an uploaded object', async () => {
    const { environment, database, storedObjects } = createEnvironment();
    const created = await createDraft(environment, '2026123990');
    const updateAddress = (addressEvidenceType) => worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie: created.cookie, body: { address_evidence_type: addressEvidenceType }
    }), environment, {});
    const readRequirements = async () => {
        const response = await worker.fetch(createRequest('/api/public/applications/current/documents', { cookie: created.cookie }), environment, {});
        return { response, payload: await response.json() };
    };

    const undertakingSaved = await updateAddress('undertaking');
    const undertakingRequirements = await readRequirements();
    const codes = undertakingRequirements.payload.requirements.map(({ code }) => code);
    const wrongBranchIntent = await worker.fetch(createRequest('/api/public/applications/current/documents/upload-intent', {
        method: 'POST', cookie: created.cookie,
        body: { code: 'address_rental_contract', filename: 'rental.pdf', media_type: 'application/pdf', byte_size: 4 }
    }), environment, {});
    const intentResponse = await worker.fetch(createRequest('/api/public/applications/current/documents/upload-intent', {
        method: 'POST', cookie: created.cookie,
        body: { code: 'address_undertaking', filename: 'undertaking.pdf', media_type: 'application/pdf', byte_size: 4 }
    }), environment, {});
    assert.equal(intentResponse.status, 201);
    const intent = await intentResponse.json();
    const storageKey = await putSignedFile(environment, intent.upload.url, 'application/pdf');

    await updateAddress('rental_contract');
    const rentalRequirements = await readRequirements();
    const finalize = await worker.fetch(createRequest('/api/public/applications/current/documents/finalize', {
        method: 'POST', cookie: created.cookie, body: { intent_id: intent.upload.intent_id }
    }), environment, {});

    assert.equal(undertakingSaved.status, 200);
    assert.equal(undertakingRequirements.response.status, 200);
    assert.equal(wrongBranchIntent.status, 404);
    assert.equal((await wrongBranchIntent.json()).error.code, 'DOCUMENT_REQUIREMENT_NOT_FOUND');
    assert.deepEqual(codes.filter((code) => code.startsWith('address_') || code.startsWith('host_')), [
        'address_undertaking', 'host_residence_certificate', 'host_identity_copy'
    ]);
    assert.equal(intentResponse.status, 201);
    assert.equal(rentalRequirements.response.status, 200);
    assert.deepEqual(rentalRequirements.payload.requirements.filter(({ code }) => code.startsWith('address_') || code.startsWith('host_')).map(({ code }) => code), [
        'address_rental_contract'
    ]);
    assert.equal(finalize.status, 404);
    assert.equal((await finalize.json()).error.code, 'DOCUMENT_REQUIREMENT_NOT_FOUND');
    assert.equal(storedObjects.has(storageKey), true);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM document_records').first().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM document_revisions').first().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM document_revision_files').first().count, 1);
});

test('inactive compatibility requirements stay hidden and cannot start uploads', async () => {
    const { environment, database } = createEnvironment();
    const created = await createDraft(environment, '2026123991');
    const requirementsResponse = await worker.fetch(createRequest('/api/public/applications/current/documents', { cookie: created.cookie }), environment, {});
    const requirements = await requirementsResponse.json();
    await setFingerprintRegistration(environment, created.cookie, 'registered', 'FP-X/15');

    const fingerprintIntent = await worker.fetch(createRequest('/api/public/applications/current/documents/upload-intent', {
        method: 'POST', cookie: created.cookie,
        body: { code: 'fingerprint', filename: 'fingerprint.pdf', media_type: 'application/pdf', byte_size: 4 }
    }), environment, {});
    const legacyPassportIntent = await worker.fetch(createRequest('/api/public/applications/current/documents/upload-intent', {
        method: 'POST', cookie: created.cookie,
        body: { code: 'passport_identity', filename: 'old-passport.pdf', media_type: 'application/pdf', byte_size: 4 }
    }), environment, {});
    const inactiveRows = database.prepare(`
        SELECT is_active FROM document_requirements WHERE code IN ('fingerprint', 'passport_identity', 'address_document')
    `).all().results;

    assert.equal(requirements.requirements.some(({ code }) => ['fingerprint', 'passport_identity', 'address_document', 'uets'].includes(code)), false);
    assert.equal(fingerprintIntent.status, 404);
    assert.equal(legacyPassportIntent.status, 404);
    assert.equal(inactiveRows.every(({ is_active }) => is_active === 0), true);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM upload_intents').first().count, 0);
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

test('fingerprint registration stays separate from document uploads', async () => {
    const { environment, database } = createEnvironment();
    const created = await createDraft(environment, '2026123950');
    const createIntent = (code) => worker.fetch(createRequest('/api/public/applications/current/documents/upload-intent', {
        method: 'POST', cookie: created.cookie,
        body: { code, filename: 'document.pdf', media_type: 'application/pdf', byte_size: 4 }
    }), environment, {});

    const unanswered = await createIntent('fingerprint');
    await setFingerprintRegistration(environment, created.cookie, 'not_registered');
    const notRegistered = await createIntent('fingerprint');
    await setFingerprintRegistration(environment, created.cookie, 'registered', 'FP-X/15');
    const registered = await createIntent('fingerprint');
    const passport = await createIntent('passport');

    for (const response of [unanswered, notRegistered, registered]) {
        assert.equal(response.status, 404);
        assert.equal((await response.json()).error.code, 'DOCUMENT_REQUIREMENT_NOT_FOUND');
    }
    assert.equal(passport.status, 201);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM upload_intents').first().count, 1);
    assert.equal(database.prepare('SELECT fingerprint_status FROM applications').first().fingerprint_status, 'registered');
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
        body: { code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: 4 }
    }), environment, {});
    const token = created.cookie.split('=')[1];
    await database.prepare('UPDATE application_sessions SET expires_at = ? WHERE token_hash = ?')
        .bind(new Date(Date.now() - 1000).toISOString(), await hashSessionToken(token)).run();
    const expiredSession = await worker.fetch(createRequest('/api/public/applications/current/documents/upload-intent', {
        method: 'POST', cookie: created.cookie,
        body: { code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: 4 }
    }), environment, {});

    assert.equal(crossOrigin.status, 403);
    assert.equal(expiredSession.status, 401);
});

test('staging signing diagnostics stay server-side while upload intent keeps its safe error contract', async (t) => {
    const { environment } = createEnvironment();
    const created = await createDraft(environment, '2026123916');
    environment.APP_ENV = 'staging';
    environment.R2_BUCKET_NAME = 'invalid/bucket-name';
    environment.R2_ACCESS_KEY_ID = 'TEST-ACCESS-KEY-PRIVATE';
    environment.R2_SECRET_ACCESS_KEY = 'TEST-SECRET-KEY-PRIVATE';
    const serverLogs = [];
    t.mock.method(console, 'error', (...args) => serverLogs.push(args));

    const response = await worker.fetch(createRequest('/api/public/applications/current/documents/upload-intent', {
        method: 'POST', cookie: created.cookie,
        body: { code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: 4 }
    }), environment, {});
    const payload = await response.json();
    const responseText = JSON.stringify(payload);
    const signingLog = serverLogs.find(([message]) => message === 'Student document upload capability failed.');
    const diagnosticFields = signingLog?.[1];

    assert.equal(response.status, 503);
    assert.equal(payload.error.code, 'STORAGE_UNAVAILABLE');
    assert.doesNotMatch(responseText, /TEST-ACCESS-KEY-PRIVATE|TEST-SECRET-KEY-PRIVATE|STORAGE_SIGNING_CONFIGURATION_ERROR|stack|R2 signing configuration/);
    assert.equal(diagnosticFields.storageSigningStage, 'AwsClient');
    assert.equal(diagnosticFields.errorName, 'DocumentStorageError');
    assert.equal(diagnosticFields.errorCode, 'STORAGE_SIGNING_CONFIGURATION_ERROR');
    assert.match(diagnosticFields.errorMessage, /R2 signing configuration is unavailable/);
    assert.match(diagnosticFields.errorStack, /createSigner/);
    assert.doesNotMatch(JSON.stringify(diagnosticFields), /TEST-ACCESS-KEY-PRIVATE|TEST-SECRET-KEY-PRIVATE/);
});

test('passport uploads use direct R2 capabilities and replacement creates a new current revision', async () => {
    const { environment, database } = createEnvironment();
    const created = await createDraft(environment, '2026123913');
    const createIntent = async (filename) => worker.fetch(createRequest('/api/public/applications/current/documents/upload-intent', {
        method: 'POST', cookie: created.cookie,
        body: { code: 'passport', filename, media_type: 'application/pdf', byte_size: 4 }
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
        WHERE students.student_number = '2026123913' AND requirements.code = 'passport'
        ORDER BY revisions.revision_number
    `).all().results;

    assert.equal(firstIntentResponse.status, 201);
    assert.equal(firstIntent.upload.method, 'PUT');
    assert.equal(firstIntent.upload.required_headers['content-type'], 'application/pdf');
    assert.equal(firstIntent.upload.required_headers['if-none-match'], '*');
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

test('draft application-type changes preserve finalized document metadata and the R2 object', async () => {
    const { environment, database, storedObjects } = createEnvironment();
    const created = await createDraft(environment, '2026123960');
    const intentResponse = await worker.fetch(createRequest('/api/public/applications/current/documents/upload-intent', {
        method: 'POST', cookie: created.cookie,
        body: { code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: 4 }
    }), environment, {});
    const intent = await intentResponse.json();
    const storageKey = await putSignedFile(environment, intent.upload.url, 'application/pdf');
    const finalizeResponse = await worker.fetch(createRequest('/api/public/applications/current/documents/finalize', {
        method: 'POST', cookie: created.cookie, body: { intent_id: intent.upload.intent_id }
    }), environment, {});

    const typeChange = await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie: created.cookie, body: { application_type: 'renewal' }
    }), environment, {});
    const file = database.prepare(`
        SELECT records.id AS record_id, records.application_type, requirements.code,
               revisions.revision_number, files.storage_key, files.upload_status
        FROM document_records AS records
        JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
        JOIN document_revisions AS revisions ON revisions.document_record_id = records.id
        JOIN document_revision_files AS files ON files.revision_id = revisions.id
    `).first();

    assert.equal(intentResponse.status, 201);
    assert.equal(finalizeResponse.status, 200);
    assert.equal(typeChange.status, 200);
    assert.equal(file.application_type, 'renewal');
    assert.equal(file.code, 'passport');
    assert.equal(file.revision_number, 1);
    assert.equal(file.storage_key, storageKey);
    assert.equal(file.upload_status, 'finalized');
    assert.equal(storedObjects.has(storageKey), true);
});

test('host residence certificate accepts PDF only', async () => {
    const { environment, database } = createEnvironment();
    const created = await createDraft(environment, '2026123951');
    await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie: created.cookie, body: { address_evidence_type: 'undertaking' }
    }), environment, {});
    const imageIntent = await worker.fetch(createRequest('/api/public/applications/current/documents/upload-intent', {
        method: 'POST', cookie: created.cookie,
        body: { code: 'host_residence_certificate', filename: 'host.png', media_type: 'image/png', byte_size: 4 }
    }), environment, {});

    assert.equal(imageIntent.status, 400);
    assert.equal((await imageIntent.json()).error.code, 'INVALID_FILE');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM upload_intents').first().count, 0);
});

test('finalize rejects a wrong-size object and does not mark the document complete', async () => {
    const { environment, database } = createEnvironment();
    const created = await createDraft(environment, '2026123914');
    const intentResponse = await worker.fetch(createRequest('/api/public/applications/current/documents/upload-intent', {
        method: 'POST', cookie: created.cookie,
        body: { code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: 5 }
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
