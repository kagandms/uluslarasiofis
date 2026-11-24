import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { purgeApplicationById } from '../src/server/routes/staffApplicationDeletionRoutes.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const ALL_STATUSES = [
    'draft',
    'submitted',
    'under_review',
    'resubmission_required',
    'approved_for_processing',
    'sent_to_migration',
    'migration_approved',
    'completed',
    'cancelled',
    'rejected'
];

function createEnvironment() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const storedObjects = new Map();
    const bucket = {
        async put(key, body) {
            storedObjects.set(key, body);
            return { key };
        },
        async head(key) {
            return storedObjects.has(key) ? { key } : null;
        },
        async get(key) {
            return storedObjects.has(key) ? { key, body: new Response(storedObjects.get(key)).body } : null;
        },
        async delete(key) {
            storedObjects.delete(key);
        }
    };
    const environment = {
        DB: database,
        DOCUMENTS: bucket,
        APP_ENV: 'test',
        STAFF_SHARED_USERNAME: 'admin-1'
    };
    return { database, environment, storedObjects };
}

function createRequest(path, { method = 'POST', body, rawBody, cookie, origin = 'https://portal.test' } = {}) {
    const headers = new Headers();
    if (origin !== null) headers.set('Origin', origin);
    if (body !== undefined || rawBody !== undefined) headers.set('Content-Type', 'application/json');
    if (cookie) headers.set('Cookie', cookie);
    return new Request(`https://portal.test${path}`, {
        method,
        headers,
        body: rawBody !== undefined ? rawBody : (body === undefined ? undefined : JSON.stringify(body))
    });
}

async function seedStaff(environment, database, {
    id = 'admin-1',
    username = id,
    token = `${id}-session-token-000000000000000000000`,
    role = 'admin'
} = {}) {
    environment.STAFF_SHARED_USERNAME = username;
    await database.prepare(`
        INSERT OR IGNORE INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES (?, ?, ?, 'test-hash', ?, ?)
    `).bind(id, username, username.toLowerCase(), `Staff ${username}`, role).run();
    await database.prepare(`
        INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at)
        VALUES (?, ?, ?, ?)
    `).bind(crypto.randomUUID(), id, await hashSessionToken(token), new Date(Date.now() + 60_000).toISOString()).run();
    return `staff_session=${token}`;
}

async function seedOwnerSession(database, applicationId, token = `owner-${applicationId}-0000000000000000`) {
    await database.prepare(`
        INSERT INTO application_sessions (id, application_id, token_hash, expires_at)
        VALUES (?, ?, ?, ?)
    `).bind(crypto.randomUUID(), applicationId, await hashSessionToken(token), new Date(Date.now() + 60_000).toISOString()).run();
    return `application_session=${token}`;
}

async function seedApplication(database, {
    id = crypto.randomUUID(),
    studentId = `student-${id}`,
    studentNumber = `STU-${id.slice(0, 12)}`,
    status = 'under_review'
} = {}) {
    await database.prepare(`
        INSERT OR IGNORE INTO students (id, student_number, normalized_student_number)
        VALUES (?, ?, ?)
    `).bind(studentId, studentNumber, studentNumber.toUpperCase()).run();
    await database.prepare(`
        INSERT INTO applications (
            id, student_id, application_type, status, first_name, last_name, passport_number,
            submitted_at, is_under_18, address_evidence_type, document_policy_version
        ) VALUES (?, ?, 'initial', ?, 'Ada', 'Lovelace', 'PASS-001', ?, 0, 'rental_contract', 1)
    `).bind(id, studentId, status, status === 'draft' ? null : new Date().toISOString()).run();
    return { applicationId: id, studentId };
}

async function seedDocumentWithObject(database, storedObjects, applicationId, code = 'passport') {
    const requirement = await database.prepare(`
        SELECT id FROM document_requirements
        WHERE application_type = 'initial' AND code = ? AND is_active = 1
    `).bind(code).first();
    assert.ok(requirement, `missing requirement ${code}`);
    const documentRecordId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    const intentId = crypto.randomUUID();
    const scanJobId = crypto.randomUUID();
    const storageKey = `quarantine/${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    await database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type, review_status)
        VALUES (?, ?, ?, 'initial', 'pending')
    `).bind(documentRecordId, applicationId, requirement.id).run();
    await database.prepare(`
        INSERT INTO document_revisions (id, document_record_id, revision_number, status, is_current, submitted_by_type)
        VALUES (?, ?, 1, 'submitted', 1, 'student')
    `).bind(revisionId, documentRecordId).run();
    await database.prepare(`
        INSERT INTO document_revision_files (
            id, revision_id, page_order, storage_key, original_filename, media_type, byte_size, upload_status, scan_status
        ) VALUES (?, ?, 0, ?, ?, 'application/pdf', 20, 'finalized', 'clean')
    `).bind(fileId, revisionId, storageKey, `${code}.pdf`).run();
    await database.prepare(`
        INSERT INTO upload_intents (id, revision_file_id, idempotency_key, expires_at, status, completed_at)
        VALUES (?, ?, ?, ?, 'completed', ?)
    `).bind(intentId, fileId, crypto.randomUUID(), new Date(Date.now() + 60_000).toISOString(), now).run();
    await database.prepare(`
        INSERT INTO document_scan_jobs (
            id, file_id, revision_id, storage_key, byte_size, media_type, available_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 20, 'application/pdf', ?, ?, ?)
    `).bind(scanJobId, fileId, revisionId, storageKey, now, now, now).run();
    storedObjects.set(storageKey, `bytes-${code}`);
    return { documentRecordId, revisionId, fileId, intentId, scanJobId, storageKey };
}

async function sha256Hex(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

test('permanent delete removes all database rows and R2 objects and leaves only the anonymised audit event', async () => {
    const { database, environment, storedObjects } = createEnvironment();
    const adminCookie = await seedStaff(environment, database, { id: 'admin-1', role: 'admin' });
    const { applicationId, studentId } = await seedApplication(database, { status: 'under_review' });
    const ownerCookie = await seedOwnerSession(database, applicationId);
    const passport = await seedDocumentWithObject(database, storedObjects, applicationId, 'passport');
    const photo = await seedDocumentWithObject(database, storedObjects, applicationId, 'photographs');
    const now = new Date().toISOString();

    await database.prepare(`
        INSERT INTO notifications (id, application_id, channel, template_key, language, created_by_staff_id)
        VALUES ('notif-1', ?, 'whatsapp', 'manual_test', 'tr', 'admin-1')
    `).bind(applicationId).run();
    await database.prepare(`
        INSERT INTO notification_outbox (id, notification_id, idempotency_key)
        VALUES ('outbox-1', 'notif-1', 'idem-notif-1')
    `).run();
    await database.prepare(`
        INSERT INTO idempotency_records (scope, idempotency_key, request_fingerprint, resource_id, expires_at)
        VALUES ('submit', 'idem-app-1', 'fp-1', ?, ?)
    `).bind(applicationId, now).run();
    await database.prepare(`
        INSERT INTO assignments (id, application_id, staff_user_id, assigned_by_staff_id)
        VALUES ('assign-1', ?, 'admin-1', 'admin-1')
    `).bind(applicationId).run();
    await database.prepare(`
        INSERT INTO application_notes (id, application_id, author_type, author_staff_id, visibility, body)
        VALUES ('note-1', ?, 'staff', 'admin-1', 'staff', 'Dahili not')
    `).bind(applicationId).run();
    await database.prepare(`
        INSERT INTO audit_events (id, event_type, actor_type, actor_staff_id, application_id, document_record_id, request_id, safe_metadata_json, created_at)
        VALUES ('audit-existing-1', 'staff.document_approved', 'staff', 'admin-1', ?, ?, 'req-old', '{}', ?)
    `).bind(applicationId, passport.documentRecordId, now).run();
    await database.prepare(`
        INSERT INTO application_spreadsheet_records (application_id, record_key, state, sheet_name, operation_id, last_actor_staff, updated_at)
        VALUES (?, ?, 'absent', NULL, 'op-1', 'admin-1', ?)
    `).bind(applicationId, applicationId, now).run();

    assert.equal(storedObjects.size, 2);

    const response = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}/delete`, {
        cookie: adminCookie,
        body: { confirmed: true }
    }), environment);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.purged, true);

    assert.equal(storedObjects.size, 0);
    assert.equal(storedObjects.has(passport.storageKey), false);
    assert.equal(storedObjects.has(photo.storageKey), false);

    assert.equal(database.prepare('SELECT COUNT(*) AS c FROM applications WHERE id=?').bind(applicationId).first().c, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS c FROM students WHERE id=?').bind(studentId).first().c, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS c FROM application_deletions WHERE application_id=?').bind(applicationId).first().c, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS c FROM application_sessions WHERE application_id=?').bind(applicationId).first().c, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS c FROM document_records WHERE application_id=?').bind(applicationId).first().c, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS c FROM document_revisions').first().c, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS c FROM document_revision_files').first().c, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS c FROM upload_intents').first().c, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS c FROM document_scan_jobs').first().c, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS c FROM notifications WHERE application_id=?').bind(applicationId).first().c, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS c FROM notification_outbox').first().c, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS c FROM idempotency_records WHERE resource_id=?').bind(applicationId).first().c, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS c FROM assignments WHERE application_id=?').bind(applicationId).first().c, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS c FROM application_notes WHERE application_id=?').bind(applicationId).first().c, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS c FROM application_spreadsheet_records WHERE application_id=?').bind(applicationId).first().c, 0);

    const audits = database.prepare('SELECT * FROM audit_events').all().results;
    assert.equal(audits.length, 1);
    assert.equal(audits[0].event_type, 'application.permanently_purged');
    assert.equal(audits[0].actor_type, 'system');
    assert.equal(audits[0].actor_staff_id, null);
    assert.equal(audits[0].application_id, null);
    assert.equal(audits[0].document_record_id, null);
    assert.deepEqual(JSON.parse(audits[0].safe_metadata_json), {
        application_id_sha256: await sha256Hex(applicationId)
    });
    assert.equal(audits[0].safe_metadata_json.includes(applicationId), false);

    // Owner session is gone
    const ownerResponse = await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'GET',
        cookie: ownerCookie
    }), environment);
    assert.equal(ownerResponse.status, 401);
});

test('permanent delete works from every application status', async () => {
    const { database, environment, storedObjects } = createEnvironment();
    const adminCookie = await seedStaff(environment, database, { id: 'admin-1', role: 'admin' });

    for (const status of ALL_STATUSES) {
        const { applicationId, studentId } = await seedApplication(database, {
            id: `app-status-${status}`,
            studentNumber: `STU-${status}`,
            status
        });
        const doc = await seedDocumentWithObject(database, storedObjects, applicationId, 'passport');
        const response = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}/delete`, {
            cookie: adminCookie,
            body: { confirmed: true }
        }), environment);
        assert.equal(response.status, 200, `delete must succeed for status=${status}`);
        assert.equal((await response.json()).purged, true);
        assert.equal(database.prepare('SELECT id FROM applications WHERE id=?').bind(applicationId).first(), null);
        assert.equal(database.prepare('SELECT id FROM students WHERE id=?').bind(studentId).first(), null);
        assert.equal(storedObjects.has(doc.storageKey), false);
    }
    assert.equal(
        database.prepare("SELECT COUNT(*) AS c FROM audit_events WHERE event_type='application.permanently_purged'").first().c,
        ALL_STATUSES.length
    );
});

test('permanent delete preserves student row when another application references the same student', async () => {
    const { database, environment } = createEnvironment();
    const adminCookie = await seedStaff(environment, database, { id: 'admin-1', role: 'admin' });
    const sharedStudentId = 'student-shared-1';
    const first = await seedApplication(database, {
        id: 'app-shared-completed',
        studentId: sharedStudentId,
        studentNumber: 'STU-SHARED',
        status: 'completed'
    });
    const second = await seedApplication(database, {
        id: 'app-shared-active',
        studentId: sharedStudentId,
        studentNumber: 'STU-SHARED',
        status: 'under_review'
    });

    const firstDelete = await worker.fetch(createRequest(`/api/staff/applications/${first.applicationId}/delete`, {
        cookie: adminCookie,
        body: { confirmed: true }
    }), environment);
    assert.equal(firstDelete.status, 200);
    assert.ok(database.prepare('SELECT id FROM students WHERE id=?').bind(sharedStudentId).first());

    const secondDelete = await worker.fetch(createRequest(`/api/staff/applications/${second.applicationId}/delete`, {
        cookie: adminCookie,
        body: { confirmed: true }
    }), environment);
    assert.equal(secondDelete.status, 200);
    assert.equal(database.prepare('SELECT id FROM students WHERE id=?').bind(sharedStudentId).first(), null);
});

test('permanent delete enforces authentication, same-origin, admin role, method, and body size/shape', async () => {
    const { database, environment } = createEnvironment();
    const { applicationId } = await seedApplication(database, { status: 'under_review' });
    const reviewerCookie = await seedStaff(environment, database, { id: 'reviewer-1', role: 'reviewer' });
    const adminCookie = await seedStaff(environment, database, { id: 'admin-1', role: 'admin' });
    const path = `/api/staff/applications/${applicationId}/delete`;

    // Unauthenticated -> 401
    const unauth = await worker.fetch(createRequest(path, { body: { confirmed: true } }), environment);
    assert.equal(unauth.status, 401);

    // Cross-origin -> 403
    const crossOrigin = await worker.fetch(createRequest(path, {
        cookie: adminCookie,
        origin: 'https://attacker.test',
        body: { confirmed: true }
    }), environment);
    assert.equal(crossOrigin.status, 403);

    // Wrong HTTP method -> 405
    for (const method of ['GET', 'DELETE', 'PATCH']) {
        const wrongMethod = await worker.fetch(createRequest(path, { method, cookie: adminCookie }), environment);
        assert.equal(wrongMethod.status, 405);
    }

    // Reviewer role -> 403
    environment.STAFF_SHARED_USERNAME = 'reviewer-1';
    const reviewerForbidden = await worker.fetch(createRequest(path, {
        cookie: reviewerCookie,
        body: { confirmed: true }
    }), environment);
    assert.equal(reviewerForbidden.status, 403);

    // Admin with invalid bodies -> 400 INVALID_DELETE_REQUEST
    environment.STAFF_SHARED_USERNAME = 'admin-1';
    const invalidBodies = [
        {},
        { confirmed: false },
        { confirmed: 'true' },
        { confirmed: 1 },
        { confirmed: null },
        { confirmed: true, extra: true },
        { ok: true }
    ];
    for (const body of invalidBodies) {
        const res = await worker.fetch(createRequest(path, { cookie: adminCookie, body }), environment);
        assert.equal(res.status, 400, `expected 400 for body ${JSON.stringify(body)}`);
        assert.equal((await res.json()).error.code, 'INVALID_DELETE_REQUEST');
    }
    for (const rawBody of ['', 'not-json', 'null', '[]', 'true']) {
        const res = await worker.fetch(createRequest(path, { cookie: adminCookie, rawBody }), environment);
        assert.equal(res.status, 400, `expected 400 for raw body ${rawBody}`);
        assert.equal((await res.json()).error.code, 'INVALID_DELETE_REQUEST');
    }

    // Body > 1 KB -> 413
    const oversized = await worker.fetch(createRequest(path, {
        cookie: adminCookie,
        body: { confirmed: true, pad: 'x'.repeat(1100) }
    }), environment);
    assert.equal(oversized.status, 413);

    // Application remains untouched after all rejected attempts
    assert.ok(database.prepare('SELECT id FROM applications WHERE id=?').bind(applicationId).first());
    assert.equal(database.prepare('SELECT COUNT(*) AS c FROM application_deletions WHERE application_id=?').bind(applicationId).first().c, 0);
});

test('spreadsheet guard rejects non-absent transfer states with 409 and causes no side effects', async () => {
    const { database, environment, storedObjects } = createEnvironment();
    const adminCookie = await seedStaff(environment, database, { id: 'admin-1', role: 'admin' });
    const now = new Date().toISOString();

    for (const spreadsheetState of ['present', 'pending_add', 'pending_remove']) {
        const { applicationId } = await seedApplication(database, {
            id: `app-sheet-${spreadsheetState}`,
            studentNumber: `STU-SHEET-${spreadsheetState}`,
            status: 'under_review'
        });
        const ownerCookie = await seedOwnerSession(database, applicationId);
        const doc = await seedDocumentWithObject(database, storedObjects, applicationId, 'passport');
        await database.prepare(`
            INSERT INTO application_spreadsheet_records
                (application_id, record_key, state, sheet_name, operation_id, last_actor_staff, updated_at)
            VALUES (?, ?, ?, ?, ?, 'admin-1', ?)
        `).bind(applicationId, applicationId, spreadsheetState, spreadsheetState === 'present' ? '24.11.2026' : null, `op-${spreadsheetState}`, now).run();

        const res = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}/delete`, {
            cookie: adminCookie,
            body: { confirmed: true }
        }), environment);
        assert.equal(res.status, 409, `expected 409 for spreadsheet state=${spreadsheetState}`);
        const payload = await res.json();
        assert.equal(payload.error.code, 'APPLICATION_SPREADSHEET_TRANSFER_PRESENT');
        assert.equal(payload.error.message, 'Kalıcı silmeden önce E-Tablo kaydını kaldırın.');

        // No purge_pending row inserted, no R2 deletion, no session revocation
        assert.equal(database.prepare('SELECT COUNT(*) AS c FROM application_deletions WHERE application_id=?').bind(applicationId).first().c, 0);
        assert.equal(storedObjects.has(doc.storageKey), true);
        assert.equal(database.prepare('SELECT COUNT(*) AS c FROM application_sessions WHERE application_id=?').bind(applicationId).first().c, 1);
        const ownerCheck = await worker.fetch(createRequest('/api/public/applications/current', {
            method: 'GET',
            cookie: ownerCookie
        }), environment);
        assert.equal(ownerCheck.status, 200);
    }
});

test('R2 failure returns retryable 503, leaves purge_pending hidden from queue, and retry succeeds', async () => {
    const { database, environment, storedObjects } = createEnvironment();
    const adminCookie = await seedStaff(environment, database, { id: 'admin-1', role: 'admin' });
    const { applicationId } = await seedApplication(database, { status: 'submitted' });
    const doc = await seedDocumentWithObject(database, storedObjects, applicationId, 'passport');

    let failDelete = true;
    const baseDelete = environment.DOCUMENTS.delete.bind(environment.DOCUMENTS);
    environment.DOCUMENTS.delete = async (key) => {
        if (failDelete) throw new Error('R2 temporary outage');
        return baseDelete(key);
    };

    const first = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}/delete`, {
        cookie: adminCookie,
        body: { confirmed: true }
    }), environment);
    assert.equal(first.status, 503);
    const firstPayload = await first.json();
    assert.equal(firstPayload.error.code, 'APPLICATION_PURGE_RETRY_REQUIRED');
    assert.equal(firstPayload.error.retryable, true);

    const deletion = database.prepare('SELECT state, previous_status, deleted_by_staff_id, deleted_at, purge_started_at FROM application_deletions WHERE application_id=?')
        .bind(applicationId).first();
    assert.equal(deletion.state, 'purge_pending');
    assert.equal(deletion.previous_status, 'submitted');
    assert.equal(deletion.deleted_by_staff_id, 'admin-1');
    assert.ok(deletion.deleted_at);
    assert.ok(deletion.purge_started_at);

    // purge_pending application is excluded from the normal queue
    const queueRes = await worker.fetch(createRequest('/api/staff/applications/query', {
        cookie: adminCookie,
        body: { status: 'all' }
    }), environment);
    assert.equal(queueRes.status, 200);
    assert.equal((await queueRes.json()).items.some((item) => item.id === applicationId), false);

    // Retry succeeds
    failDelete = false;
    const retry = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}/delete`, {
        cookie: adminCookie,
        body: { confirmed: true }
    }), environment);
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).purged, true);
    assert.equal(storedObjects.has(doc.storageKey), false);
    assert.equal(database.prepare('SELECT id FROM applications WHERE id=?').bind(applicationId).first(), null);
    assert.equal(database.prepare('SELECT COUNT(*) AS c FROM application_deletions WHERE application_id=?').bind(applicationId).first().c, 0);
});

test('DB batch failure returns retryable 503 with purge_pending intact and retry succeeds', async () => {
    const { database, environment } = createEnvironment();
    const adminCookie = await seedStaff(environment, database, { id: 'admin-1', role: 'admin' });
    const { applicationId } = await seedApplication(database, { status: 'under_review' });

    const originalBatch = database.batch.bind(database);
    let failBatch = true;
    database.batch = async (statements) => {
        if (failBatch) throw new Error('transient D1 error');
        return originalBatch(statements);
    };

    const failed = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}/delete`, {
        cookie: adminCookie,
        body: { confirmed: true }
    }), environment);
    assert.equal(failed.status, 503);
    const failedPayload = await failed.json();
    assert.equal(failedPayload.error.code, 'APPLICATION_PURGE_RETRY_REQUIRED');
    assert.equal(failedPayload.error.retryable, true);
    assert.equal(database.prepare('SELECT state FROM application_deletions WHERE application_id=?').bind(applicationId).first().state, 'purge_pending');

    failBatch = false;
    const retried = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}/delete`, {
        cookie: adminCookie,
        body: { confirmed: true }
    }), environment);
    assert.equal(retried.status, 200);
    assert.equal((await retried.json()).purged, true);
    assert.equal(database.prepare('SELECT id FROM applications WHERE id=?').bind(applicationId).first(), null);
});

test('deleting unknown id returns 404 and deleting twice returns 200 then 404', async () => {
    const { database, environment } = createEnvironment();
    const adminCookie = await seedStaff(environment, database, { id: 'admin-1', role: 'admin' });
    const { applicationId } = await seedApplication(database, { status: 'submitted' });

    const unknown = await worker.fetch(createRequest('/api/staff/applications/does-not-exist/delete', {
        cookie: adminCookie,
        body: { confirmed: true }
    }), environment);
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error.code, 'APPLICATION_NOT_FOUND');

    const first = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}/delete`, {
        cookie: adminCookie,
        body: { confirmed: true }
    }), environment);
    assert.equal(first.status, 200);

    const second = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}/delete`, {
        cookie: adminCookie,
        body: { confirmed: true }
    }), environment);
    assert.equal(second.status, 404);
    assert.equal((await second.json()).error.code, 'APPLICATION_NOT_FOUND');
});

test('already soft_deleted applications can still be permanently deleted via HTTP and purgeApplicationById', async () => {
    const { database, environment, storedObjects } = createEnvironment();
    const adminCookie = await seedStaff(environment, database, { id: 'admin-1', role: 'admin' });
    const now = new Date().toISOString();

    // Case 1: soft_deleted via HTTP /delete
    const first = await seedApplication(database, { id: 'app-soft-http', studentNumber: 'STU-SOFT-1', status: 'submitted' });
    const firstDoc = await seedDocumentWithObject(database, storedObjects, first.applicationId, 'passport');
    await database.prepare(`
        INSERT INTO application_deletions (application_id, previous_status, state, deleted_by_staff_id, deleted_at)
        VALUES (?, 'submitted', 'soft_deleted', 'admin-1', ?)
    `).bind(first.applicationId, now).run();

    const httpDelete = await worker.fetch(createRequest(`/api/staff/applications/${first.applicationId}/delete`, {
        cookie: adminCookie,
        body: { confirmed: true }
    }), environment);
    assert.equal(httpDelete.status, 200);
    assert.equal((await httpDelete.json()).purged, true);
    assert.equal(database.prepare('SELECT id FROM applications WHERE id=?').bind(first.applicationId).first(), null);
    assert.equal(storedObjects.has(firstDoc.storageKey), false);

    // Case 2: exported purgeApplicationById handles none, soft_deleted, and purge_pending directly
    const noneApp = await seedApplication(database, { id: 'app-core-none', studentNumber: 'STU-CORE-1', status: 'draft' });
    const softApp = await seedApplication(database, { id: 'app-core-soft', studentNumber: 'STU-CORE-2', status: 'completed' });
    const pendingApp = await seedApplication(database, { id: 'app-core-pending', studentNumber: 'STU-CORE-3', status: 'rejected' });

    await database.prepare(`
        INSERT INTO application_deletions (application_id, previous_status, state, deleted_by_staff_id, deleted_at)
        VALUES (?, 'completed', 'soft_deleted', 'admin-1', ?)
    `).bind(softApp.applicationId, now).run();
    await database.prepare(`
        INSERT INTO application_deletions (application_id, previous_status, state, deleted_by_staff_id, deleted_at, purge_started_at)
        VALUES (?, 'rejected', 'purge_pending', 'admin-1', ?, ?)
    `).bind(pendingApp.applicationId, now, now).run();

    const staff = { id: 'admin-1', role: 'admin' };
    for (const app of [noneApp, softApp, pendingApp]) {
        const result = await purgeApplicationById({
            environment,
            applicationId: app.applicationId,
            staff,
            requestId: `req-${app.applicationId}`
        });
        assert.deepEqual(result, { purged: true });
        assert.equal(database.prepare('SELECT id FROM applications WHERE id=?').bind(app.applicationId).first(), null);
    }
});

test('removed queue filters archive_all and deleted return 400 and removed deletion routes return 404', async () => {
    const { database, environment } = createEnvironment();
    const adminCookie = await seedStaff(environment, database, { id: 'admin-1', role: 'admin' });
    const { applicationId } = await seedApplication(database, { status: 'under_review' });

    for (const removedStatus of ['archive_all', 'deleted']) {
        const res = await worker.fetch(createRequest('/api/staff/applications/query', {
            cookie: adminCookie,
            body: { status: removedStatus }
        }), environment);
        assert.equal(res.status, 400, `expected 400 for removed filter=${removedStatus}`);
        assert.equal((await res.json()).error.code, 'VALIDATION_ERROR');
    }

    for (const removedAction of ['archive', 'restore', 'purge']) {
        const res = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}/${removedAction}`, {
            cookie: adminCookie,
            body: {}
        }), environment);
        assert.equal(res.status, 404, `expected 404 for removed route=/${removedAction}`);
        assert.equal((await res.json()).error.code, 'NOT_FOUND');
    }
});
