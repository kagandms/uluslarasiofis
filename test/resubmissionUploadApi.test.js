import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const RESUBMISSION_PATH = '/api/public/applications/current/documents';

function createEnvironment() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const objects = new Map();
    const deletedKeys = [];
    const bucket = {
        async head(key) { return objects.get(key) ?? null; },
        async put(key, body, options = {}) {
            objects.set(key, { size: body.byteLength, httpMetadata: options.httpMetadata ?? {} });
        },
        async delete(key) { deletedKeys.push(key); objects.delete(key); }
    };
    return {
        database, objects, deletedKeys,
        environment: {
            DB: database, DOCUMENTS: bucket, R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
            R2_BUCKET_NAME: 'private-documents', R2_ACCESS_KEY_ID: 'test-access-key',
            R2_SECRET_ACCESS_KEY: 'test-secret-key'
        }
    };
}

function createRequest(path, { method = 'GET', cookie, body } = {}) {
    const headers = new Headers({ Origin: 'https://portal.test' });
    if (cookie) headers.set('Cookie', cookie);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    return new Request(`https://portal.test${path}`, {
        method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
}

async function createResubmissionApplicant(environment, database, studentNumber = 'RESUB-API', suffix = 'api') {
    const response = await worker.fetch(createRequest('/api/public/applications', {
        method: 'POST', body: {
            student_number: studentNumber, application_type: 'initial',
            email: `${studentNumber}@example.edu`, phone: '+905551112233'
        }
    }), environment);
    assert.equal(response.status, 201);
    const cookie = response.headers.get('Set-Cookie').split(';')[0];
    const applicationId = database.prepare(`
        SELECT applications.id FROM applications JOIN students ON students.id = applications.student_id
        WHERE students.normalized_student_number = ?
    `).bind(studentNumber).first().id;
    const requirementId = database.prepare(`
        SELECT id FROM document_requirements WHERE application_type = 'initial' AND code = 'passport'
    `).first().id;
    await database.prepare(`UPDATE applications SET status = 'resubmission_required' WHERE id = ?`).bind(applicationId).run();
    await database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type, review_status)
        VALUES (?, ?, ?, 'initial', 'resubmission_required')
    `).bind(`record-${suffix}-resubmit`, applicationId, requirementId).run();
    await database.prepare(`
        INSERT INTO document_revisions (id, document_record_id, revision_number, status, is_current, submitted_by_type)
        VALUES (?, ?, 1, 'resubmission_required', 1, 'student')
    `).bind(`revision-${suffix}-reviewed`, `record-${suffix}-resubmit`).run();
    await database.prepare(`
        INSERT INTO document_revision_files (id, revision_id, page_order, storage_key, original_filename,
            media_type, byte_size, upload_status, scan_status, cleanup_status)
        VALUES (?, ?, 0, ?,
            'passport.pdf', 'application/pdf', 100, 'finalized', 'clean', 'none')
    `).bind(`file-${suffix}-reviewed`, `revision-${suffix}-reviewed`, `quarantine/reviewed-file-${suffix}`).run();
    await database.prepare(`
        INSERT INTO upload_intents (id, revision_file_id, idempotency_key, expires_at, status, completed_at)
        VALUES (?, ?, ?, '2999-01-01T00:00:00.000Z',
            'completed', '2026-09-30T00:00:00.000Z')
    `).bind(`intent-${suffix}-reviewed`, `file-${suffix}-reviewed`, `reviewed-key-${suffix}`).run();
    await database.prepare(`
        INSERT INTO application_notes (id, application_id, document_record_id, author_type,
            visibility, body, created_at)
        VALUES (?, ?, ?, 'system', 'student',
            'Lütfen yeni bir pasaport kopyası gönderin.', '2026-09-30T00:00:00.000Z')
    `).bind(`note-${suffix}-review`, applicationId, `record-${suffix}-resubmit`).run();
    return { cookie, applicationId };
}

async function readJson(response) {
    return response.json();
}

test('resubmission routes require a valid owner session and reject lookup-shaped mutation bodies', async () => {
    const { environment, database } = createEnvironment();
    const { cookie } = await createResubmissionApplicant(environment, database);
    const route = `${RESUBMISSION_PATH}/resubmission-upload-intent`;
    const missingSession = await worker.fetch(createRequest(route, { method: 'POST', body: {
        code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: 100
    } }), environment);
    const lookupBody = await worker.fetch(createRequest(route, { method: 'POST', cookie, body: {
        student_number: 'RESUB-API', application_id: 'other', document_record_id: 'record-api-resubmit'
    } }), environment);
    const studentToken = cookie.split('=')[1];
    await database.prepare('UPDATE application_sessions SET expires_at = ? WHERE token_hash = ?')
        .bind(new Date(Date.now() - 1000).toISOString(), await hashSessionToken(studentToken)).run();
    const expiredSession = await worker.fetch(createRequest(route, { method: 'POST', cookie, body: {
        code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: 100
    } }), environment);
    const revokedApplicant = await createResubmissionApplicant(environment, database, 'RESUB-REVOKED', 'revoked');
    await database.prepare('UPDATE application_sessions SET revoked_at = ? WHERE token_hash = ?')
        .bind(new Date().toISOString(), await hashSessionToken(revokedApplicant.cookie.split('=')[1])).run();
    const revokedSession = await worker.fetch(createRequest(route, { method: 'POST', cookie: revokedApplicant.cookie, body: {
        code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: 100
    } }), environment);

    assert.equal(missingSession.status, 401);
    assert.equal(expiredSession.status, 401);
    assert.equal(revokedSession.status, 401);
    assert.equal(lookupBody.status, 400);
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM upload_intents WHERE status = 'pending'`).first().count, 0);
});

test('owner eligibility hint and replacement intent keep reviewed revision current until finalize', async () => {
    const { environment, database } = createEnvironment();
    const { cookie } = await createResubmissionApplicant(environment, database);
    const eligibilityResponse = await worker.fetch(createRequest(`${RESUBMISSION_PATH}/resubmission-eligibility`, { cookie }), environment);
    const eligibility = await readJson(eligibilityResponse);
    assert.equal(eligibilityResponse.status, 200);
    assert.deepEqual(eligibility.documents.map(({ code }) => code), ['passport']);
    assert.doesNotMatch(JSON.stringify(eligibility), /application_id|document_record_id|revision_id|storage_key/i);

    const intentResponse = await worker.fetch(createRequest(`${RESUBMISSION_PATH}/resubmission-upload-intent`, {
        method: 'POST', cookie, body: {
            code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: 100
        }
    }), environment);
    const payload = await readJson(intentResponse);
    assert.equal(intentResponse.status, 201, JSON.stringify({ payload,
        records: database.prepare(`SELECT id, revision_number, status, is_current FROM document_revisions WHERE document_record_id = 'record-api-resubmit' ORDER BY revision_number`).all().results,
        application: database.prepare(`SELECT id, application_type, status, is_under_18, address_evidence_type FROM applications`).all().results,
        files: database.prepare(`SELECT id, upload_status FROM document_revision_files ORDER BY id`).all().results,
        intents: database.prepare(`SELECT id, status FROM upload_intents ORDER BY id`).all().results }));
    assert.equal(payload.upload.method, 'PUT');
    assert.equal(payload.upload.required_headers['content-type'], 'application/pdf');
    assert.equal(database.prepare(`SELECT id FROM document_revisions WHERE is_current = 1 AND document_record_id = 'record-api-resubmit'`).first().id,
        'revision-api-reviewed');
    const replacement = database.prepare(`
        SELECT revisions.id, revisions.revision_number, revisions.status, revisions.is_current,
               intents.idempotency_key
        FROM upload_intents AS intents JOIN document_revision_files AS files ON files.id = intents.revision_file_id
        JOIN document_revisions AS revisions ON revisions.id = files.revision_id WHERE intents.id = ?
    `).bind(payload.upload.intent_id).first();
    const persistedGuard = JSON.parse(replacement.idempotency_key);
    assert.deepEqual(persistedGuard.slice(0, 2), ['revision-api-reviewed', 'first_replacement']);
    assert.equal(replacement.revision_number, 2);
    assert.equal(replacement.status, 'pending_scan');
    assert.equal(replacement.is_current, 0);
});

test('application, document, record, message, and active-policy state independently gate intent creation', async () => {
    const { environment, database } = createEnvironment();
    const { cookie } = await createResubmissionApplicant(environment, database, 'RESUB-DENIAL');
    const requirementId = database.prepare(`SELECT id FROM document_requirements WHERE code = 'passport' AND application_type = 'initial'`).first().id;
    const cases = [
        ['application no longer requests replacement', async () => {
            await database.prepare(`UPDATE applications SET status = 'under_review'`).run();
        }],
        ['approved record', async () => {
            await database.prepare(`UPDATE applications SET status = 'resubmission_required'`).run();
            await database.prepare(`UPDATE document_records SET review_status = 'approved' WHERE id = 'record-api-resubmit'`).run();
        }],
        ['approved revision', async () => {
            await database.prepare(`UPDATE document_records SET review_status = 'resubmission_required' WHERE id = 'record-api-resubmit'`).run();
            await database.prepare(`UPDATE document_revisions SET status = 'approved' WHERE id = 'revision-api-reviewed'`).run();
        }],
        ['missing exact student message', async () => {
            await database.prepare(`UPDATE document_revisions SET status = 'resubmission_required' WHERE id = 'revision-api-reviewed'`).run();
            await database.prepare(`DELETE FROM application_notes WHERE document_record_id = 'record-api-resubmit'`).run();
        }],
        ['inactive centralized requirement', async () => {
            await database.prepare(`INSERT INTO application_notes (id, application_id, document_record_id, author_type, visibility, body)
                VALUES ('note-denial-restored', (SELECT application_id FROM document_records WHERE id = 'record-api-resubmit'),
                'record-api-resubmit', 'system', 'student', 'Replace this document.')`).run();
            await database.prepare(`UPDATE document_requirements SET is_active = 0 WHERE id = ?`).bind(requirementId).run();
        }]
    ];

    for (const [description, arrange] of cases) {
        await arrange();
        const response = await worker.fetch(createRequest(`${RESUBMISSION_PATH}/resubmission-upload-intent`, {
            method: 'POST', cookie, body: {
                code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: 10
            }
        }), environment);
        assert.equal(response.status, 409, description);
    }
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM document_revisions WHERE document_record_id = 'record-api-resubmit'`).first().count, 1);
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM upload_intents WHERE status = 'pending'`).first().count, 0);
});

test('direct R2 PUT alone is not success; verified finalize changes current revision atomically', async () => {
    const { environment, database, objects } = createEnvironment();
    const { cookie, applicationId } = await createResubmissionApplicant(environment, database);
    const intentResponse = await worker.fetch(createRequest(`${RESUBMISSION_PATH}/resubmission-upload-intent`, {
        method: 'POST', cookie, body: {
            code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: 4
        }
    }), environment);
    const { upload } = await readJson(intentResponse);
    const intent = database.prepare(`
        SELECT files.storage_key FROM upload_intents JOIN document_revision_files AS files
        ON files.id = upload_intents.revision_file_id WHERE upload_intents.id = ?
    `).bind(upload.intent_id).first();
    assert.equal(upload.required_headers['if-none-match'], '*');
    await environment.DOCUMENTS.put(intent.storage_key, new Uint8Array([1, 2, 3, 4]), {
        httpMetadata: { contentType: 'application/pdf' }
    });
    assert.equal(objects.has(intent.storage_key), true);
    assert.equal(database.prepare(`SELECT id FROM document_revisions WHERE is_current = 1 AND document_record_id = 'record-api-resubmit'`).first().id,
        'revision-api-reviewed');

    const finalizeResponse = await worker.fetch(createRequest(`${RESUBMISSION_PATH}/resubmission-finalize`, {
        method: 'POST', cookie, body: { intent_id: upload.intent_id }
    }), environment);
    const payload = await readJson(finalizeResponse);
    assert.equal(finalizeResponse.status, 200, JSON.stringify(payload));
    assert.deepEqual(payload.document, {
        code: 'passport', revision_number: 2, upload_status: 'finalized', scan_status: 'pending'
    });
    assert.equal(database.prepare(`SELECT status FROM applications WHERE id = ?`).bind(applicationId).first().status,
        'resubmission_required');
    assert.equal(database.prepare(`SELECT id FROM document_revisions WHERE is_current = 1 AND document_record_id = 'record-api-resubmit'`).first().id,
        database.prepare(`SELECT id FROM document_revisions WHERE revision_number = 2 AND document_record_id = 'record-api-resubmit'`).first().id);
    const audit = database.prepare(`SELECT safe_metadata_json FROM audit_events WHERE event_type = 'student.document_resubmitted'`).first();
    assert.deepEqual(JSON.parse(audit.safe_metadata_json), {
        documentCode: 'passport', revisionNumber: 2, documentStatus: 'submitted', result: 'success'
    });
    assert.doesNotMatch(audit.safe_metadata_json, /filename|student_number|storage_key|intent-api|revision-api|record-api/i);
});

test('replaying a finalized resubmission PUT capability cannot overwrite the verified object', async () => {
    const { environment, database, objects } = createEnvironment();
    const { cookie } = await createResubmissionApplicant(environment, database, 'RESUB-REPLAY');
    const created = await worker.fetch(createRequest(`${RESUBMISSION_PATH}/resubmission-upload-intent`, {
        method: 'POST', cookie, body: {
            code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: 4
        }
    }), environment);
    const { upload } = await readJson(created);
    const file = database.prepare(`
        SELECT files.storage_key FROM upload_intents AS intents
        JOIN document_revision_files AS files ON files.id = intents.revision_file_id WHERE intents.id = ?
    `).bind(upload.intent_id).first();
    const putOnce = async (body) => {
        if (upload.required_headers['if-none-match'] === '*' && objects.has(file.storage_key)) {
            throw Object.assign(new Error('Precondition failed'), { status: 412 });
        }
        await environment.DOCUMENTS.put(file.storage_key, body, {
            httpMetadata: { contentType: upload.required_headers['content-type'] }
        });
    };

    await putOnce(new Uint8Array([1, 2, 3, 4]));
    const finalized = await worker.fetch(createRequest(`${RESUBMISSION_PATH}/resubmission-finalize`, {
        method: 'POST', cookie, body: { intent_id: upload.intent_id }
    }), environment);
    assert.equal(finalized.status, 200);
    const verifiedObject = objects.get(file.storage_key);

    await assert.rejects(putOnce(new Uint8Array([9, 9, 9, 9])), { status: 412 });
    assert.equal(objects.get(file.storage_key), verifiedObject);
    assert.equal(database.prepare(`SELECT is_current FROM document_revisions WHERE revision_number = 2`).first().is_current, 1);
});

test('owner-session revocation after capability issuance blocks finalize without mutating current state', async () => {
    const { environment, database, objects } = createEnvironment();
    const { cookie } = await createResubmissionApplicant(environment, database, 'RESUB-REVOKED-AFTER-INTENT');
    const created = await worker.fetch(createRequest(`${RESUBMISSION_PATH}/resubmission-upload-intent`, {
        method: 'POST', cookie, body: {
            code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: 4
        }
    }), environment);
    const { upload } = await readJson(created);
    const tokenHash = await hashSessionToken(cookie.split('=')[1]);
    const file = database.prepare(`
        SELECT files.id, files.storage_key FROM upload_intents AS intents
        JOIN document_revision_files AS files ON files.id = intents.revision_file_id WHERE intents.id = ?
    `).bind(upload.intent_id).first();
    await environment.DOCUMENTS.put(file.storage_key, new Uint8Array([1, 2, 3, 4]), {
        httpMetadata: { contentType: 'application/pdf' }
    });
    objects.set(file.storage_key, { size: 4, httpMetadata: { contentType: 'application/pdf' } });
    await database.prepare(`UPDATE application_sessions SET revoked_at = ? WHERE token_hash = ?`)
        .bind(new Date().toISOString(), tokenHash).run();

    const response = await worker.fetch(createRequest(`${RESUBMISSION_PATH}/resubmission-finalize`, {
        method: 'POST', cookie, body: { intent_id: upload.intent_id }
    }), environment);
    const intent = database.prepare(`SELECT status FROM upload_intents WHERE id = ?`).bind(upload.intent_id).first();
    const current = database.prepare(`SELECT id FROM document_revisions WHERE document_record_id = 'record-api-resubmit' AND is_current = 1`).first();

    assert.equal(response.status, 401);
    assert.equal(intent.status, 'pending');
    assert.equal(current.id, 'revision-api-reviewed');
    assert.equal(objects.has(file.storage_key), true);
});

test('lookup remains read-only and cannot access owner eligibility or create an upload capability', async () => {
    const { environment, database } = createEnvironment();
    await createResubmissionApplicant(environment, database, 'RESUB-LOOKUP');
    const before = database.prepare(`SELECT COUNT(*) AS count FROM upload_intents`).first().count;
    const lookup = await worker.fetch(createRequest('/api/public/applications/tracking-lookup', {
        method: 'POST', body: { student_number: 'RESUB-LOOKUP' }
    }), environment);
    const privateHint = await worker.fetch(createRequest(`${RESUBMISSION_PATH}/resubmission-eligibility`), environment);
    const payload = await readJson(lookup);

    assert.equal(lookup.status, 200);
    assert.equal(lookup.headers.get('Set-Cookie'), null);
    assert.equal(privateHint.status, 401);
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM upload_intents`).first().count, before);
    assert.doesNotMatch(JSON.stringify(payload), /intent_id|storage_key|document_record_id/i);
});

test('public passport OCR route remains absent', async () => {
    const { environment } = createEnvironment();
    const response = await worker.fetch(createRequest(`${RESUBMISSION_PATH}/passport/ocr`, { method: 'POST', body: {} }), environment);

    assert.equal(response.status, 404);
    assert.equal((await readJson(response)).error.code, 'NOT_FOUND');
});

test('missing and mismatched R2 objects are invalidated without touching the reviewed current file', async () => {
    const { environment, database, deletedKeys } = createEnvironment();
    const { cookie } = await createResubmissionApplicant(environment, database, 'RESUB-MISMATCH');
    const created = await worker.fetch(createRequest(`${RESUBMISSION_PATH}/resubmission-upload-intent`, {
        method: 'POST', cookie, body: {
            code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: 4
        }
    }), environment);
    const { upload } = await readJson(created);
    const storage = database.prepare(`
        SELECT files.storage_key, intents.expires_at FROM upload_intents AS intents
        JOIN document_revision_files AS files ON files.id = intents.revision_file_id WHERE intents.id = ?
    `).bind(upload.intent_id).first();
    await environment.DOCUMENTS.put(storage.storage_key, new Uint8Array([1, 2, 3, 4]), {
        httpMetadata: { contentType: 'image/png' }
    });

    const finalize = await worker.fetch(createRequest(`${RESUBMISSION_PATH}/resubmission-finalize`, {
        method: 'POST', cookie, body: { intent_id: upload.intent_id }
    }), environment);
    const payload = await readJson(finalize);
    const replacement = database.prepare(`
        SELECT revisions.status, revisions.is_current, files.upload_status, files.cleanup_status, intents.status AS intent_status
        FROM upload_intents AS intents JOIN document_revision_files AS files ON files.id = intents.revision_file_id
        JOIN document_revisions AS revisions ON revisions.id = files.revision_id WHERE intents.id = ?
    `).bind(upload.intent_id).first();

    assert.equal(finalize.status, 409);
    assert.equal(payload.error.code, 'UPLOAD_OBJECT_MISMATCH');
    assert.deepEqual({ ...replacement }, {
        status: 'superseded', is_current: 0, upload_status: 'rejected', cleanup_status: 'pending', intent_status: 'rejected'
    });
    assert.equal(database.prepare(`SELECT id FROM document_revisions WHERE id = 'revision-api-reviewed' AND is_current = 1`).first().id,
        'revision-api-reviewed');
    assert.deepEqual(deletedKeys, []);
});

test('missing R2 object invalidates the non-current replacement and preserves the reviewed revision', async () => {
    const { environment, database, deletedKeys } = createEnvironment();
    const { cookie } = await createResubmissionApplicant(environment, database, 'RESUB-MISSING-OBJECT');
    const created = await worker.fetch(createRequest(`${RESUBMISSION_PATH}/resubmission-upload-intent`, {
        method: 'POST', cookie, body: {
            code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: 4
        }
    }), environment);
    const { upload } = await readJson(created);

    const response = await worker.fetch(createRequest(`${RESUBMISSION_PATH}/resubmission-finalize`, {
        method: 'POST', cookie, body: { intent_id: upload.intent_id }
    }), environment);
    const payload = await readJson(response);
    const replacement = database.prepare(`
        SELECT revisions.status, revisions.is_current, files.cleanup_status, intents.status AS intent_status
        FROM upload_intents AS intents JOIN document_revision_files AS files ON files.id = intents.revision_file_id
        JOIN document_revisions AS revisions ON revisions.id = files.revision_id WHERE intents.id = ?
    `).bind(upload.intent_id).first();

    assert.equal(response.status, 409);
    assert.equal(payload.error.code, 'UPLOAD_OBJECT_MISSING');
    assert.deepEqual({ ...replacement }, {
        status: 'superseded', is_current: 0, cleanup_status: 'pending', intent_status: 'rejected'
    });
    assert.equal(database.prepare(`SELECT id FROM document_revisions WHERE id = 'revision-api-reviewed' AND is_current = 1`).first().id,
        'revision-api-reviewed');
    assert.deepEqual(deletedKeys, []);
});

test('expired abandoned intent is closed before cleanup and cannot become current', async () => {
    const { environment, database, objects, deletedKeys } = createEnvironment();
    const { cookie } = await createResubmissionApplicant(environment, database, 'RESUB-EXPIRED');
    const created = await worker.fetch(createRequest(`${RESUBMISSION_PATH}/resubmission-upload-intent`, {
        method: 'POST', cookie, body: {
            code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: 4
        }
    }), environment);
    const { upload } = await readJson(created);
    const file = database.prepare(`
        SELECT files.id, files.storage_key FROM upload_intents AS intents
        JOIN document_revision_files AS files ON files.id = intents.revision_file_id WHERE intents.id = ?
    `).bind(upload.intent_id).first();
    await environment.DOCUMENTS.put(file.storage_key, new Uint8Array([1, 2, 3, 4]), {
        httpMetadata: { contentType: 'application/pdf' }
    });
    environment.DOCUMENTS.delete = async (key) => {
        deletedKeys.push(key);
        throw new Error('temporary R2 failure');
    };
    await database.prepare(`UPDATE upload_intents SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`)
        .bind(upload.intent_id).run();

    const response = await worker.fetch(createRequest(`${RESUBMISSION_PATH}/resubmission-finalize`, {
        method: 'POST', cookie, body: { intent_id: upload.intent_id }
    }), environment);
    const payload = await readJson(response);

    assert.equal(response.status, 409);
    assert.equal(payload.error.code, 'UPLOAD_INTENT_EXPIRED');
    assert.deepEqual(deletedKeys, [file.storage_key]);
    assert.equal(database.prepare(`SELECT cleanup_status FROM document_revision_files WHERE id = ?`).bind(file.id).first().cleanup_status,
        'pending');
    environment.DOCUMENTS.delete = async (key) => {
        deletedKeys.push(key);
        objects.delete(key);
    };
    await worker.fetch(createRequest(`${RESUBMISSION_PATH}/resubmission-eligibility`, { cookie }), environment);
    assert.deepEqual(deletedKeys, [file.storage_key, file.storage_key]);
    assert.equal(database.prepare(`SELECT cleanup_status FROM document_revision_files WHERE id = ?`).bind(file.id).first().cleanup_status,
        'complete');
    assert.equal(database.prepare(`SELECT id FROM document_revisions WHERE id = 'revision-api-reviewed' AND is_current = 1`).first().id,
        'revision-api-reviewed');
});
