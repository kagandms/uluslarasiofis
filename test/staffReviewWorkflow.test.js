import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { OFFICIAL_APPLICATION_RETENTION_DAYS } from '../src/config/constants.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';
import worker from '../src/server/worker.js';

function createEnvironment() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    return { database, environment: { DB: database, APP_ENV: 'test', STAFF_SHARED_USERNAME: 'reviewer-1' } };
}

function attachPrivateStorage(environment) {
    const objects = new Map();
    environment.R2_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
    environment.R2_BUCKET_NAME = 'private-documents';
    environment.R2_ACCESS_KEY_ID = 'test-access-key';
    environment.R2_SECRET_ACCESS_KEY = 'test-secret-key';
    environment.DOCUMENTS = {
        async head(key) { return objects.get(key) ?? null; },
        async put(key, body, options = {}) {
            objects.set(key, { size: body.byteLength, httpMetadata: options.httpMetadata ?? {} });
        },
        async get(key) {
            return objects.has(key) ? { body: new Response('replacement-document').body,
                httpMetadata: { contentType: 'application/pdf' } } : null;
        },
        async delete(key) { objects.delete(key); }
    };
    return objects;
}

function request(path, { method = 'GET', body, cookie, origin = 'https://portal.test' } = {}) {
    const headers = new Headers({ Origin: origin });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (cookie) headers.set('Cookie', cookie);
    return new Request(`https://portal.test${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
}

async function seedStaff(environment, database, id = 'reviewer-1', token = 'reviewer-session-token-000000000000000000', role = 'reviewer') {
    const existingStaff = database.prepare('SELECT id FROM staff_users LIMIT 1').first();
    if (!existingStaff || role === 'admin') environment.STAFF_SHARED_USERNAME = id;
    await database.prepare(`
        INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES (?, ?, ?, 'test-hash', 'Reviewer', ?)
    `).bind(id, id, id, role).run();
    await database.prepare(`
        INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at)
        VALUES (?, ?, ?, ?)
    `).bind(crypto.randomUUID(), id, await hashSessionToken(token), new Date(Date.now() + 60_000).toISOString()).run();
    return `staff_session=${token}`;
}

async function seedOwnerSession(database, applicationId, token) {
    await database.prepare(`
        INSERT INTO application_sessions (id, application_id, token_hash, expires_at)
        VALUES (?, ?, ?, ?)
    `).bind(crypto.randomUUID(), applicationId, await hashSessionToken(token),
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()).run();
    return `application_session=${token}`;
}

async function seedApplication(database, { id = crypto.randomUUID(), studentNumber = id.slice(0, 12), status = 'under_review' } = {}) {
    await database.prepare(`
        INSERT INTO students (id, student_number, normalized_student_number)
        VALUES (?, ?, ?)
    `).bind(`student-${id}`, studentNumber, studentNumber.toUpperCase()).run();
    await database.prepare(`
        INSERT INTO applications (id, student_id, application_type, status, is_under_18, address_evidence_type)
        VALUES (?, ?, 'initial', ?, 0, 'rental_contract')
    `).bind(id, `student-${id}`, status).run();
    return id;
}

async function seedReviewableDocument(database, applicationId, code = 'passport', options = {}) {
    const requirement = await database.prepare(`
        SELECT id FROM document_requirements
        WHERE application_type = 'initial' AND code = ? AND is_active = 1
    `).bind(code).first();
    const documentRecordId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    await database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type, review_status)
        VALUES (?, ?, ?, 'initial', 'pending')
    `).bind(documentRecordId, applicationId, requirement.id).run();
    await database.prepare(`
        INSERT INTO document_revisions (id, document_record_id, revision_number, status, is_current, submitted_by_type)
        VALUES (?, ?, ?, ?, 1, 'student')
    `).bind(revisionId, documentRecordId, options.revisionNumber ?? 1, options.revisionStatus ?? 'submitted').run();
    await database.prepare(`
        INSERT INTO document_revision_files (
            id, revision_id, page_order, storage_key, original_filename, media_type, byte_size, upload_status, scan_status
        ) VALUES (?, ?, 0, ?, 'passport-private.pdf', 'application/pdf', 20, ?, ?)
    `).bind(fileId, revisionId, `quarantine/${crypto.randomUUID()}`,
        options.uploadStatus ?? 'finalized', options.scanStatus ?? 'clean').run();
    await database.prepare(`
        INSERT INTO upload_intents (id, revision_file_id, idempotency_key, expires_at, status, completed_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), fileId, crypto.randomUUID(), new Date(Date.now() + 60_000).toISOString(),
        options.intentStatus ?? 'completed', new Date().toISOString()).run();
    if (options.cleanupStatus) {
        await database.prepare('UPDATE document_revision_files SET cleanup_status = ? WHERE id = ?')
            .bind(options.cleanupStatus, fileId).run();
    }
    if (options.reviewStatus) {
        await database.prepare('UPDATE document_records SET review_status = ? WHERE id = ?')
            .bind(options.reviewStatus, documentRecordId).run();
    }
    return { documentRecordId, revisionId, fileId };
}

async function readJson(response) {
    return response.json();
}

test('staff identity-check detail includes the stable reference without exposing access credentials', async () => {
    const { environment, database } = createEnvironment();
    const applicationId = await seedApplication(database);
    database.prepare("UPDATE applications SET reference_number='ITU-2345-6789',access_code_hash=? WHERE id=?")
        .bind('a'.repeat(64), applicationId).run();
    const cookie = await seedStaff(environment, database);

    const response = await worker.fetch(request(`/api/staff/applications/${applicationId}`, { cookie }), environment);

    assert.equal(response.status, 200);
    const { application } = await response.json();
    assert.equal(application.reference_number, 'ITU-2345-6789');
    assert.equal(application.access_code_hash, undefined);
    assert.equal(application.access_code, undefined);
});

test('staff starts review explicitly and application status updates use optimistic concurrency', async () => {
    const { environment, database } = createEnvironment();
    const applicationId = await seedApplication(database, { status: 'submitted' });
    const cookie = await seedStaff(environment, database);
    const ownerCookie = await seedOwnerSession(database, applicationId, 'owner-session-under-review-0000000000000000');
    const initial = database.prepare('SELECT updated_at FROM applications WHERE id = ?').bind(applicationId).first();
    const detail = await worker.fetch(request(`/api/staff/applications/${applicationId}`, { cookie }), environment);
    const submittedTracking = await worker.fetch(request('/api/public/applications/current/tracking', {
        cookie: ownerCookie
    }), environment);
    assert.equal(detail.status, 200);
    assert.equal(database.prepare('SELECT status FROM applications WHERE id = ?').bind(applicationId).first().status, 'submitted');
    assert.equal((await readJson(submittedTracking)).application.status, 'submitted');

    const started = await worker.fetch(request(`/api/staff/applications/${applicationId}/status`, {
        method: 'POST', cookie, body: { target_status: 'under_review', expected_updated_at: initial.updated_at }
    }), environment);
    const stale = await worker.fetch(request(`/api/staff/applications/${applicationId}/status`, {
        method: 'POST', cookie, body: { target_status: 'under_review', expected_updated_at: initial.updated_at }
    }), environment);
    const incompleteApproval = await worker.fetch(request(`/api/staff/applications/${applicationId}/status`, {
        method: 'POST', cookie, body: {
            target_status: 'approved_for_processing',
            expected_updated_at: database.prepare('SELECT updated_at FROM applications WHERE id = ?').bind(applicationId).first().updated_at
        }
    }), environment);

    assert.equal(started.status, 200);
    assert.equal((await readJson(started)).application_status, 'under_review');
    const underReviewTracking = await worker.fetch(request('/api/public/applications/current/tracking', {
        cookie: ownerCookie
    }), environment);
    assert.equal((await readJson(underReviewTracking)).application.status, 'under_review');
    assert.equal(stale.status, 409);
    assert.equal((await readJson(stale)).error.code, 'APPLICATION_STATE_CONFLICT');
    assert.equal(incompleteApproval.status, 409);
    assert.equal((await readJson(incompleteApproval)).error.code, 'APPLICATION_NOT_READY_FOR_APPROVAL');
    const applicationLifecycle = database.prepare('SELECT terminal_at, retention_due_at FROM applications WHERE id = ?')
        .bind(applicationId).first();
    assert.equal(applicationLifecycle.terminal_at, null);
    assert.equal(applicationLifecycle.retention_due_at, null);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'staff.application_review_started'").first().count, 1);
});

test('approved workflow transitions require all applicable current required documents to be approved', async () => {
    const { environment, database } = createEnvironment();
    const applicationId = await seedApplication(database, { studentNumber: 'STUDENT-DONE' });
    const firstOwnerCookie = await seedOwnerSession(database, applicationId, 'owner-session-complete-a-00000000000000000');
    const secondOwnerCookie = await seedOwnerSession(database, applicationId, 'owner-session-complete-b-00000000000000000');
    const otherApplicationId = await seedApplication(database, { studentNumber: 'STUDENT-OTHER-DONE' });
    const otherOwnerCookie = await seedOwnerSession(database, otherApplicationId, 'owner-session-other-00000000000000000000');
    const cookie = await seedStaff(environment, database);
    const requiredCodes = [
        'residence_application_form', 'passport', 'residence_card', 'photographs', 'health_insurance',
        'student_certificate', 'residence_permit_fee', 'address_rental_contract', 'home_utility_bill'
    ];
    for (const code of requiredCodes) {
        await seedReviewableDocument(database, applicationId, code, {
            revisionStatus: 'approved', reviewStatus: 'approved'
        });
    }
    const detail = await worker.fetch(request(`/api/staff/applications/${applicationId}`, { cookie }), environment);
    assert.deepEqual((await readJson(detail)).allowed_status_transitions, ['approved_for_processing']);

    const transitions = [
        'approved_for_processing', 'sent_to_migration', 'migration_approved', 'completed'
    ];
    let expectedUpdatedAt = database.prepare('SELECT updated_at FROM applications WHERE id = ?').bind(applicationId).first().updated_at;
    const ownerTrackingBeforeComplete = await worker.fetch(request('/api/public/applications/current/tracking', {
        cookie: firstOwnerCookie
    }), environment);
    assert.equal((await readJson(ownerTrackingBeforeComplete)).application.status, 'under_review');
    for (const targetStatus of transitions) {
        if (targetStatus === 'completed') {
            const staleCompletion = await worker.fetch(request(`/api/staff/applications/${applicationId}/status`, {
                method: 'POST', cookie,
                body: { target_status: 'completed', expected_updated_at: `${expectedUpdatedAt}:stale` }
            }), environment);
            assert.equal(staleCompletion.status, 409);
            assert.equal((await readJson(staleCompletion)).error.code, 'APPLICATION_STATE_CONFLICT');
            const unchanged = database.prepare('SELECT terminal_at, retention_due_at FROM applications WHERE id = ?')
                .bind(applicationId).first();
            assert.equal(unchanged.terminal_at, null);
            assert.equal(unchanged.retention_due_at, null);
            assert.equal(database.prepare('SELECT COUNT(*) AS count FROM application_sessions WHERE application_id = ? AND revoked_at IS NOT NULL')
                .bind(applicationId).first().count, 0);
        }
        const response = await worker.fetch(request(`/api/staff/applications/${applicationId}/status`, {
            method: 'POST', cookie, body: { target_status: targetStatus, expected_updated_at: expectedUpdatedAt }
        }), environment);
        assert.equal(response.status, 200, `${targetStatus} should follow the approved state edge`);
        const payload = await readJson(response);
        expectedUpdatedAt = payload.updated_at;
        const application = database.prepare(`
            SELECT status, terminal_at, retention_due_at, updated_at, last_activity_at
            FROM applications WHERE id = ?
        `).bind(applicationId).first();
        assert.equal(application.status, targetStatus);
        if (targetStatus === 'completed') {
            assert.equal(application.terminal_at, payload.updated_at);
            assert.equal(application.updated_at, payload.updated_at);
            assert.equal(application.last_activity_at, payload.updated_at);
            assert.equal(application.retention_due_at, new Date(
                Date.parse(application.terminal_at) + OFFICIAL_APPLICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000
            ).toISOString());
        } else {
            assert.equal(application.terminal_at, null);
            assert.equal(application.retention_due_at, null);
        }
    }
    assert.equal(database.prepare('SELECT status FROM applications WHERE id = ?').bind(applicationId).first().status, 'completed');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'staff.application_status_changed'").first().count, 4);
    assert.equal(database.prepare(`
        SELECT COUNT(*) AS count FROM audit_events
        WHERE event_type = 'staff.application_status_changed'
          AND application_id = ? AND safe_metadata_json LIKE '%"applicationStatus":"completed"%'
    `).bind(applicationId).first().count, 1);
    const completedSessions = database.prepare(`
        SELECT revoked_at FROM application_sessions WHERE application_id = ? ORDER BY created_at, id
    `).bind(applicationId).all().results;
    assert.equal(completedSessions.length, 2);
    assert.ok(completedSessions.every(({ revoked_at }) => revoked_at === database.prepare(
        'SELECT terminal_at FROM applications WHERE id = ?'
    ).bind(applicationId).first().terminal_at));
    assert.equal(database.prepare('SELECT revoked_at FROM application_sessions WHERE application_id = ?')
        .bind(otherApplicationId).first().revoked_at, null);

    const revokedOwnerTracking = await worker.fetch(request('/api/public/applications/current/tracking', {
        cookie: secondOwnerCookie
    }), environment);
    assert.equal(revokedOwnerTracking.status, 401);
    const completedLookup = await worker.fetch(request('/api/public/applications/tracking-lookup', {
        method: 'POST', body: { student_number: 'STUDENT-DONE' }
    }), environment);
    const completedLookupPayload = await readJson(completedLookup);
    assert.equal(completedLookup.status, 200);
    assert.equal(completedLookupPayload.application.status, 'completed');
    assert.equal(completedLookup.headers.get('Set-Cookie'), null);
    assert.equal(database.prepare('SELECT revoked_at FROM application_sessions WHERE token_hash = ?')
        .bind(await hashSessionToken(otherOwnerCookie.split('=')[1])).first().revoked_at, null);
});

test('completion succeeds when an application has no owner sessions', async () => {
    const { environment, database } = createEnvironment();
    const applicationId = await seedApplication(database, { status: 'migration_approved' });
    const cookie = await seedStaff(environment, database);
    const expectedUpdatedAt = database.prepare('SELECT updated_at FROM applications WHERE id = ?')
        .bind(applicationId).first().updated_at;

    const response = await worker.fetch(request(`/api/staff/applications/${applicationId}/status`, {
        method: 'POST', cookie,
        body: { target_status: 'completed', expected_updated_at: expectedUpdatedAt }
    }), environment);

    assert.equal(response.status, 200);
    assert.equal(database.prepare('SELECT status FROM applications WHERE id = ?').bind(applicationId).first().status, 'completed');
});

test('failed completion audit rolls back application retention and all owner-session revocations', async () => {
    const { environment, database } = createEnvironment();
    const applicationId = await seedApplication(database, { status: 'migration_approved' });
    await seedOwnerSession(database, applicationId, 'owner-session-rollback-a-00000000000000000');
    await seedOwnerSession(database, applicationId, 'owner-session-rollback-b-00000000000000000');
    const cookie = await seedStaff(environment, database);
    database.exec(`CREATE TRIGGER reject_completion_audit BEFORE INSERT ON audit_events
        WHEN NEW.event_type = 'staff.application_status_changed'
         AND NEW.safe_metadata_json LIKE '%"applicationStatus":"completed"%'
        BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;`);
    const expectedUpdatedAt = database.prepare('SELECT updated_at FROM applications WHERE id = ?')
        .bind(applicationId).first().updated_at;

    const response = await worker.fetch(request(`/api/staff/applications/${applicationId}/status`, {
        method: 'POST', cookie,
        body: { target_status: 'completed', expected_updated_at: expectedUpdatedAt }
    }), environment);

    assert.equal(response.status, 500);
    const application = database.prepare('SELECT status, terminal_at, retention_due_at FROM applications WHERE id = ?')
        .bind(applicationId).first();
    assert.equal(application.status, 'migration_approved');
    assert.equal(application.terminal_at, null);
    assert.equal(application.retention_due_at, null);
    const sessions = database.prepare('SELECT revoked_at FROM application_sessions WHERE application_id = ?')
        .bind(applicationId).all().results;
    assert.equal(sessions.length, 2);
    assert.ok(sessions.every(({ revoked_at }) => revoked_at === null));
    assert.equal(database.prepare(`
        SELECT COUNT(*) AS count FROM audit_events
        WHERE application_id = ? AND event_type = 'staff.application_status_changed'
    `).bind(applicationId).first().count, 0);
});

test('staff approves only the current clean revision and records safe audit metadata', async () => {
    const { environment, database } = createEnvironment();
    const applicationId = await seedApplication(database);
    const { documentRecordId, revisionId } = await seedReviewableDocument(database, applicationId);
    const unrelatedDocument = await seedReviewableDocument(database, applicationId, 'address_rental_contract');
    const cookie = await seedStaff(environment, database);
    const path = `/api/staff/applications/${applicationId}/documents/passport/approve`;
    const unauthorized = await worker.fetch(request(path, { method: 'POST', body: { expected_revision_number: 1 } }), environment);
    const crossOrigin = await worker.fetch(request(path, {
        method: 'POST', cookie, origin: 'https://attacker.test', body: { expected_revision_number: 1 }
    }), environment);
    const approved = await worker.fetch(request(path, { method: 'POST', cookie, body: { expected_revision_number: 1 } }), environment);
    const repeated = await worker.fetch(request(path, { method: 'POST', cookie, body: { expected_revision_number: 1 } }), environment);

    assert.equal(unauthorized.status, 401);
    assert.equal(crossOrigin.status, 403);
    assert.equal(approved.status, 200);
    assert.equal(repeated.status, 409);
    assert.equal((await readJson(repeated)).error.code, 'DOCUMENT_REVIEW_CONFLICT');
    const reviewedRevision = database.prepare('SELECT status, reviewed_by_staff_id, reviewed_at FROM document_revisions WHERE id = ?')
        .bind(revisionId).first();
    assert.equal(reviewedRevision.status, 'approved');
    assert.equal(reviewedRevision.reviewed_by_staff_id, 'reviewer-1');
    assert.ok(reviewedRevision.reviewed_at);
    assert.equal(database.prepare('SELECT review_status FROM document_records WHERE id = ?').bind(documentRecordId).first().review_status, 'approved');
    assert.equal(database.prepare('SELECT review_status FROM document_records WHERE id = ?').bind(unrelatedDocument.documentRecordId).first().review_status, 'pending');
    assert.equal(database.prepare('SELECT status FROM document_revisions WHERE id = ?').bind(unrelatedDocument.revisionId).first().status, 'submitted');
    assert.ok(database.prepare('SELECT updated_at FROM applications WHERE id = ?').bind(applicationId).first().updated_at);
    const audit = database.prepare("SELECT event_type, safe_metadata_json FROM audit_events WHERE event_type = 'staff.document_approved'").first();
    assert.equal(audit.event_type, 'staff.document_approved');
    assert.match(audit.safe_metadata_json, /passport|revisionNumber|approved/);
    assert.doesNotMatch(audit.safe_metadata_json, /passport-private|quarantine|storage_key|https?:\/\//i);
});

test('admin approval is allowed while stale, incomplete, unsafe, and cleanup-pending revisions are rejected', async () => {
    const { environment, database } = createEnvironment();
    const adminCookie = await seedStaff(environment, database, 'admin-1', 'admin-session-token-000000000000000000000', 'admin');
    const adminApplication = await seedApplication(database);
    await seedReviewableDocument(database, adminApplication);
    const adminApproval = await worker.fetch(request(`/api/staff/applications/${adminApplication}/documents/passport/approve`, {
        method: 'POST', cookie: adminCookie, body: { expected_revision_number: 1 }
    }), environment);
    assert.equal(adminApproval.status, 200);

    const invalidStates = [
        { scanStatus: 'pending' }, { scanStatus: 'unsafe' }, { scanStatus: 'failed' },
        { uploadStatus: 'uploaded' }, { intentStatus: 'pending' }, { cleanupStatus: 'pending' }
    ];
    for (const [index, state] of invalidStates.entries()) {
        const applicationId = await seedApplication(database, { studentNumber: `UNSAFE-${index}` });
        const { revisionId } = await seedReviewableDocument(database, applicationId, 'passport', state);
        const response = await worker.fetch(request(`/api/staff/applications/${applicationId}/documents/passport/approve`, {
            method: 'POST', cookie: adminCookie, body: { expected_revision_number: 1 }
        }), environment);
        assert.equal(response.status, 409);
        assert.equal((await readJson(response)).error.code, 'DOCUMENT_NOT_REVIEWABLE');
        assert.equal(database.prepare('SELECT status FROM document_revisions WHERE id = ?').bind(revisionId).first().status, 'submitted');
    }

    const staleApplication = await seedApplication(database, { studentNumber: 'STALE-REVISION' });
    const staleDocument = await seedReviewableDocument(database, staleApplication, 'passport', { revisionNumber: 2 });
    const stale = await worker.fetch(request(`/api/staff/applications/${staleApplication}/documents/passport/approve`, {
        method: 'POST', cookie: adminCookie, body: { expected_revision_number: 1 }
    }), environment);
    assert.equal(stale.status, 409);
    assert.equal((await readJson(stale)).error.code, 'DOCUMENT_REVIEW_CONFLICT');
    assert.equal(database.prepare('SELECT status FROM document_revisions WHERE id = ?').bind(staleDocument.revisionId).first().status, 'submitted');
});

test('staff may flag another submitted document during resubmission, but cannot resume review while any flag remains', async () => {
    const { environment, database } = createEnvironment();
    const applicationId = await seedApplication(database, { status: 'resubmission_required' });
    const cookie = await seedStaff(environment, database);
    const ownerCookie = await seedOwnerSession(database, applicationId, 'owner-session-resubmission-00000000000000000');
    await seedReviewableDocument(database, applicationId, 'passport', {
        revisionStatus: 'resubmission_required', reviewStatus: 'resubmission_required'
    });
    const secondDocument = await seedReviewableDocument(database, applicationId, 'address_rental_contract');
    const requestSecond = await worker.fetch(request(
        `/api/staff/applications/${applicationId}/documents/address_rental_contract/request-resubmission`, {
            method: 'POST', cookie, body: { expected_revision_number: 1, reason: 'Address date is missing' }
        }), environment);
    assert.equal(requestSecond.status, 200);
    assert.equal(database.prepare('SELECT status FROM applications WHERE id = ?').bind(applicationId).first().status, 'resubmission_required');
    assert.equal(database.prepare('SELECT status FROM document_revisions WHERE id = ?').bind(secondDocument.revisionId).first().status,
        'resubmission_required');
    const ownerTracking = await worker.fetch(request('/api/public/applications/current/tracking', {
        cookie: ownerCookie
    }), environment);
    assert.equal((await readJson(ownerTracking)).application.status, 'resubmission_required');

    const applicationUpdatedAt = database.prepare('SELECT updated_at FROM applications WHERE id = ?').bind(applicationId).first().updated_at;
    const resume = await worker.fetch(request(`/api/staff/applications/${applicationId}/status`, {
        method: 'POST', cookie,
        body: { target_status: 'under_review', expected_updated_at: applicationUpdatedAt }
    }), environment);
    assert.equal(resume.status, 409);
    assert.equal((await readJson(resume)).error.code, 'APPLICATION_NOT_READY_FOR_REVIEW');
    assert.equal(database.prepare('SELECT status FROM applications WHERE id = ?').bind(applicationId).first().status,
        'resubmission_required');
});

test('resubmission reason, document note, application state, and audit are one atomic operation', async () => {
    const { environment, database } = createEnvironment();
    const applicationId = await seedApplication(database, { studentNumber: 'STUDENT-RESUB' });
    const { documentRecordId, revisionId } = await seedReviewableDocument(database, applicationId);
    const cookie = await seedStaff(environment, database);
    const path = `/api/staff/applications/${applicationId}/documents/passport/request-resubmission`;
    for (const reason of [undefined, '  ', 'ab', '\u0000\u0001\u0002', 'x'.repeat(1001)]) {
        const body = { expected_revision_number: 1, ...(reason === undefined ? {} : { reason }) };
        const response = await worker.fetch(request(path, { method: 'POST', cookie, body }), environment);
        assert.equal(response.status, 400);
    }
    const requested = await worker.fetch(request(path, {
        method: 'POST', cookie,
        body: { expected_revision_number: 1, reason: '  Belgenin alt kısmı kesilmiş.  ' }
    }), environment);

    assert.equal(requested.status, 200);
    assert.equal(database.prepare('SELECT status FROM applications WHERE id = ?').bind(applicationId).first().status, 'resubmission_required');
    assert.equal(database.prepare('SELECT status FROM document_revisions WHERE id = ?').bind(revisionId).first().status, 'resubmission_required');
    assert.equal(database.prepare('SELECT review_status FROM document_records WHERE id = ?').bind(documentRecordId).first().review_status, 'resubmission_required');
    const note = database.prepare(`
        SELECT application_id, document_record_id, author_type, author_staff_id, visibility, body
        FROM application_notes WHERE application_id = ?
    `).bind(applicationId).first();
    assert.deepEqual({ ...note }, {
        application_id: applicationId, document_record_id: documentRecordId,
        author_type: 'staff', author_staff_id: 'reviewer-1', visibility: 'student',
        body: 'Belgenin alt kısmı kesilmiş.'
    });
    const extraDocumentId = await seedReviewableDocument(database, applicationId, 'home_utility_bill');
    const extraDocumentAttempt = await worker.fetch(request(path, {
        method: 'POST', cookie,
        body: { expected_revision_number: 1, reason: 'Reason is valid', document_record_id: extraDocumentId.documentRecordId }
    }), environment);
    assert.equal(extraDocumentAttempt.status, 400);
    const audit = database.prepare("SELECT safe_metadata_json FROM audit_events WHERE event_type = 'staff.document_resubmission_requested'").first();
    assert.doesNotMatch(audit.safe_metadata_json, /alt kısmı kesilmiş/i);

    const otherApplicationId = await seedApplication(database, { studentNumber: 'STUDENT-OTHER' });
    const otherDocument = await seedReviewableDocument(database, applicationId, 'address_rental_contract');
    const otherApplicationDocument = await seedReviewableDocument(database, otherApplicationId);
    await database.prepare(`
        INSERT INTO application_notes (id, application_id, document_record_id, author_type, author_staff_id, visibility, body)
        VALUES (?, ?, ?, 'staff', 'reviewer-1', 'staff', 'STAFF-ONLY-SECRET')
    `).bind(crypto.randomUUID(), applicationId, documentRecordId).run();
    await database.prepare(`
        INSERT INTO application_notes (id, application_id, document_record_id, author_type, visibility, body)
        VALUES (?, ?, ?, 'student', 'student', 'OTHER-DOCUMENT-SECRET')
    `).bind(crypto.randomUUID(), applicationId, otherDocument.documentRecordId).run();
    await database.prepare(`
        INSERT INTO application_notes (id, application_id, document_record_id, author_type, visibility, body)
        VALUES (?, ?, ?, 'student', 'student', 'OTHER-APPLICATION-SECRET')
    `).bind(crypto.randomUUID(), applicationId, otherApplicationDocument.documentRecordId).run();

    const staffDetailResponse = await worker.fetch(request(`/api/staff/applications/${applicationId}`, { cookie }), environment);
    const staffDetail = await readJson(staffDetailResponse);
    assert.equal(staffDetail.documents.find((document) => document.code === 'passport').student_message,
        'Belgenin alt kısmı kesilmiş.');
    assert.doesNotMatch(JSON.stringify(staffDetail), /document_record_id|STAFF-ONLY-SECRET|OTHER-APPLICATION-SECRET/);

    const ownerToken = 'owner-session-token-000000000000000000000';
    await database.prepare(`
        INSERT INTO application_sessions (id, application_id, token_hash, expires_at)
        VALUES (?, ?, ?, ?)
    `).bind(crypto.randomUUID(), applicationId, await hashSessionToken(ownerToken), new Date(Date.now() + 60_000).toISOString()).run();
    const sessionsBeforeLookup = database.prepare('SELECT COUNT(*) AS count FROM application_sessions').first().count;
    const ownerTracking = await worker.fetch(request('/api/public/applications/current/tracking', {
        cookie: `application_session=${ownerToken}`
    }), environment);
    const publicLookup = await worker.fetch(request('/api/public/applications/tracking-lookup', {
        method: 'POST', body: { student_number: 'STUDENT-RESUB' }
    }), environment);
    const ownerPayload = await readJson(ownerTracking);
    const lookupPayload = await readJson(publicLookup);
    const ownerPassport = ownerPayload.documents.find((document) => document.code === 'passport');
    const lookupPassport = lookupPayload.documents.find((document) => document.code === 'passport');
    assert.equal(ownerPayload.application.status, 'resubmission_required');
    assert.equal(ownerPassport.status, 'resubmission_required');
    assert.equal(ownerPassport.student_message, 'Belgenin alt kısmı kesilmiş.');
    assert.equal(ownerPayload.documents.find((document) => document.code === 'address_rental_contract').student_message, 'OTHER-DOCUMENT-SECRET');
    assert.doesNotMatch(JSON.stringify(ownerPayload), /STAFF-ONLY-SECRET|OTHER-APPLICATION-SECRET/);
    assert.equal(lookupPayload.application.status, 'resubmission_required');
    assert.equal(lookupPassport.student_message, ownerPassport.student_message);
    assert.equal(lookupPayload.documents.find((document) => document.code === 'address_rental_contract').student_message, 'OTHER-DOCUMENT-SECRET');
    assert.doesNotMatch(JSON.stringify(lookupPayload), /STAFF-ONLY-SECRET|OTHER-APPLICATION-SECRET/);
    assert.equal(publicLookup.headers.get('Set-Cookie'), null);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM application_sessions').first().count, sessionsBeforeLookup);
    assert.doesNotMatch(JSON.stringify(lookupPayload), /document_record_id|author_staff_id|application_notes|noteId|staff-only/i);
});

test('resubmission audit failure rolls back document, application, and student note changes', async () => {
    const { environment, database } = createEnvironment();
    const applicationId = await seedApplication(database);
    const { documentRecordId, revisionId } = await seedReviewableDocument(database, applicationId);
    const cookie = await seedStaff(environment, database);
    database.exec(`CREATE TRIGGER reject_resubmission_audit BEFORE INSERT ON audit_events
        WHEN NEW.event_type = 'staff.document_resubmission_requested'
        BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;`);

    const response = await worker.fetch(request(`/api/staff/applications/${applicationId}/documents/passport/request-resubmission`, {
        method: 'POST', cookie, body: { expected_revision_number: 1, reason: 'Replace this document' }
    }), environment);

    assert.equal(response.status, 500);
    assert.equal(database.prepare('SELECT status FROM applications WHERE id = ?').bind(applicationId).first().status, 'under_review');
    assert.equal(database.prepare('SELECT status FROM document_revisions WHERE id = ?').bind(revisionId).first().status, 'submitted');
    assert.equal(database.prepare('SELECT review_status FROM document_records WHERE id = ?').bind(documentRecordId).first().review_status, 'pending');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM application_notes').first().count, 0);
});

test('staff reads, previews, downloads, and re-requests the finalized replacement current revision', async () => {
    const { environment, database } = createEnvironment();
    const objects = attachPrivateStorage(environment);
    const applicationId = await seedApplication(database, { status: 'resubmission_required', studentNumber: 'PHASE8E-STAFF' });
    const ownerCookie = await seedOwnerSession(database, applicationId, 'owner-session-phase8e-staff-00000000000000000');
    const staffCookie = await seedStaff(environment, database);
    const { documentRecordId, revisionId, fileId } = await seedReviewableDocument(database, applicationId, 'passport', {
        revisionStatus: 'resubmission_required', reviewStatus: 'resubmission_required'
    });
    await database.prepare(`
        INSERT INTO application_notes (id, application_id, document_record_id, author_type, author_staff_id, visibility, body)
        VALUES ('phase8e-staff-message', ?, ?, 'staff', 'reviewer-1', 'student', 'Send a clear replacement.')
    `).bind(applicationId, documentRecordId).run();

    const intentResponse = await worker.fetch(request('/api/public/applications/current/documents/resubmission-upload-intent', {
        method: 'POST', cookie: ownerCookie,
        body: { code: 'passport', filename: 'new-passport.pdf', media_type: 'application/pdf', byte_size: 20 }
    }), environment);
    const { upload } = await readJson(intentResponse);
    assert.equal(intentResponse.status, 201);
    const replacementFile = database.prepare(`
        SELECT files.id, files.storage_key FROM upload_intents AS intents
        JOIN document_revision_files AS files ON files.id = intents.revision_file_id WHERE intents.id = ?
    `).bind(upload.intent_id).first();
    await environment.DOCUMENTS.put(replacementFile.storage_key, new Uint8Array(20), {
        httpMetadata: { contentType: 'application/pdf' }
    });
    const finalized = await worker.fetch(request('/api/public/applications/current/documents/resubmission-finalize', {
        method: 'POST', cookie: ownerCookie, body: { intent_id: upload.intent_id }
    }), environment);
    assert.equal(finalized.status, 200);
    await database.prepare(`UPDATE document_revision_files SET scan_status = 'clean' WHERE id = ?`)
        .bind(replacementFile.id).run();

    const detailResponse = await worker.fetch(request(`/api/staff/applications/${applicationId}`, { cookie: staffCookie }), environment);
    const detail = await readJson(detailResponse);
    const passport = detail.documents.find((document) => document.code === 'passport');
    assert.equal(passport.revision_number, 2);
    assert.equal(passport.revision_status, 'submitted');
    assert.equal(passport.access_available, true);
    assert.equal(database.prepare(`SELECT is_current FROM document_revisions WHERE id = ?`).bind(revisionId).first().is_current, 0);
    assert.equal(database.prepare(`SELECT is_current FROM document_revisions WHERE id = ?`).bind(
        database.prepare(`SELECT revision_id FROM document_revision_files WHERE id = ?`).bind(replacementFile.id).first().revision_id
    ).first().is_current, 1);

    const preview = await worker.fetch(request(`/api/staff/applications/${applicationId}/documents/passport/preview`, {
        method: 'POST', cookie: staffCookie
    }), environment);
    assert.equal(preview.status, 200);
    const replacementStorageKey = database.prepare(`SELECT storage_key FROM document_revision_files WHERE id = ?`)
        .bind(replacementFile.id).first().storage_key;
    assert.equal(objects.has(replacementStorageKey), true);
    const download = await worker.fetch(request(`/api/staff/applications/${applicationId}/documents/passport/download`, {
        cookie: staffCookie
    }), environment);
    assert.equal(download.status, 200);
    assert.equal(await download.text(), 'replacement-document');

    const reRequest = await worker.fetch(request(`/api/staff/applications/${applicationId}/documents/passport/request-resubmission`, {
        method: 'POST', cookie: staffCookie,
        body: { expected_revision_number: 2, reason: 'The scan is not readable.' }
    }), environment);
    assert.equal(reRequest.status, 200);
    const nextIntentResponse = await worker.fetch(request('/api/public/applications/current/documents/resubmission-upload-intent', {
        method: 'POST', cookie: ownerCookie,
        body: { code: 'passport', filename: 'next-passport.pdf', media_type: 'application/pdf', byte_size: 12 }
    }), environment);
    assert.equal(nextIntentResponse.status, 201);
    const nextIntent = await readJson(nextIntentResponse);
    const nextRevision = database.prepare(`
        SELECT revisions.revision_number, revisions.is_current, revisions.status
        FROM upload_intents AS intents JOIN document_revision_files AS files ON files.id = intents.revision_file_id
        JOIN document_revisions AS revisions ON revisions.id = files.revision_id
        WHERE intents.id = ?
    `).bind(nextIntent.upload.intent_id).first();
    assert.deepEqual({ ...nextRevision }, { revision_number: 3, is_current: 0, status: 'pending_scan' });
    assert.equal(database.prepare(`SELECT MAX(revision_number) AS revision_number FROM document_revisions WHERE document_record_id = ?`)
        .bind(documentRecordId).first().revision_number, 3);
    assert.equal(database.prepare(`SELECT id FROM document_revisions WHERE document_record_id = ? AND is_current = 1`)
        .bind(documentRecordId).first().id,
    database.prepare(`SELECT revision_id FROM document_revision_files WHERE id = ?`).bind(replacementFile.id).first().revision_id);
    assert.equal(database.prepare('SELECT status FROM applications WHERE id = ?').bind(applicationId).first().status,
        'resubmission_required');
});

test('replacing one requested document does not resume review; staff must clear remaining requests explicitly', async () => {
    const { environment, database } = createEnvironment();
    attachPrivateStorage(environment);
    const applicationId = await seedApplication(database, { status: 'resubmission_required', studentNumber: 'PHASE8E-REMAINING' });
    const ownerCookie = await seedOwnerSession(database, applicationId, 'owner-session-phase8e-remain-00000000000000000');
    const staffCookie = await seedStaff(environment, database);
    const passport = await seedReviewableDocument(database, applicationId, 'passport', {
        revisionStatus: 'resubmission_required', reviewStatus: 'resubmission_required'
    });
    const address = await seedReviewableDocument(database, applicationId, 'address_rental_contract', {
        revisionStatus: 'resubmission_required', reviewStatus: 'resubmission_required'
    });
    for (const [code, documentRecordId] of [['passport', passport.documentRecordId], ['address_rental_contract', address.documentRecordId]]) {
        await database.prepare(`
            INSERT INTO application_notes (id, application_id, document_record_id, author_type, author_staff_id, visibility, body)
            VALUES (?, ?, ?, 'staff', 'reviewer-1', 'student', ?)
        `).bind(crypto.randomUUID(), applicationId, documentRecordId, `Replace ${code}.`).run();
    }

    const intentResponse = await worker.fetch(request('/api/public/applications/current/documents/resubmission-upload-intent', {
        method: 'POST', cookie: ownerCookie,
        body: { code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: 8 }
    }), environment);
    const { upload } = await readJson(intentResponse);
    const file = database.prepare(`
        SELECT files.id, files.storage_key FROM upload_intents AS intents
        JOIN document_revision_files AS files ON files.id = intents.revision_file_id WHERE intents.id = ?
    `).bind(upload.intent_id).first();
    await environment.DOCUMENTS.put(file.storage_key, new Uint8Array(8), { httpMetadata: { contentType: 'application/pdf' } });
    const finalized = await worker.fetch(request('/api/public/applications/current/documents/resubmission-finalize', {
        method: 'POST', cookie: ownerCookie, body: { intent_id: upload.intent_id }
    }), environment);
    assert.equal(finalized.status, 200);
    await database.prepare(`UPDATE document_revision_files SET scan_status = 'clean' WHERE id = ?`)
        .bind(file.id).run();
    assert.equal(database.prepare('SELECT status FROM applications WHERE id = ?').bind(applicationId).first().status,
        'resubmission_required');
    const applicationUpdatedAt = database.prepare('SELECT updated_at FROM applications WHERE id = ?').bind(applicationId).first().updated_at;
    const blockedResume = await worker.fetch(request(`/api/staff/applications/${applicationId}/status`, {
        method: 'POST', cookie: staffCookie,
        body: { target_status: 'under_review', expected_updated_at: applicationUpdatedAt }
    }), environment);
    assert.equal(blockedResume.status, 409);
    assert.equal((await readJson(blockedResume)).error.code, 'APPLICATION_NOT_READY_FOR_REVIEW');

    const addressIntentResponse = await worker.fetch(request('/api/public/applications/current/documents/resubmission-upload-intent', {
        method: 'POST', cookie: ownerCookie,
        body: { code: 'address_rental_contract', filename: 'address.pdf', media_type: 'application/pdf', byte_size: 8 }
    }), environment);
    assert.equal(addressIntentResponse.status, 201);
    const addressUpload = await readJson(addressIntentResponse);
    const addressFile = database.prepare(`
        SELECT files.id, files.storage_key FROM upload_intents AS intents
        JOIN document_revision_files AS files ON files.id = intents.revision_file_id WHERE intents.id = ?
    `).bind(addressUpload.upload.intent_id).first();
    await environment.DOCUMENTS.put(addressFile.storage_key, new Uint8Array(8), { httpMetadata: { contentType: 'application/pdf' } });
    const addressFinalized = await worker.fetch(request('/api/public/applications/current/documents/resubmission-finalize', {
        method: 'POST', cookie: ownerCookie, body: { intent_id: addressUpload.upload.intent_id }
    }), environment);
    assert.equal(addressFinalized.status, 200);
    await database.prepare(`UPDATE document_revision_files SET scan_status = 'clean' WHERE id IN (?, ?)`)
        .bind(file.id, addressFile.id).run();

    const approvePassport = await worker.fetch(request(`/api/staff/applications/${applicationId}/documents/passport/approve`, {
        method: 'POST', cookie: staffCookie, body: { expected_revision_number: 2 }
    }), environment);
    const approveAddress = await worker.fetch(request(`/api/staff/applications/${applicationId}/documents/address_rental_contract/approve`, {
        method: 'POST', cookie: staffCookie, body: { expected_revision_number: 2 }
    }), environment);
    assert.equal(approvePassport.status, 200);
    assert.equal(approveAddress.status, 200);

    const latestUpdatedAt = database.prepare('SELECT updated_at FROM applications WHERE id = ?').bind(applicationId).first().updated_at;
    const explicitResume = await worker.fetch(request(`/api/staff/applications/${applicationId}/status`, {
        method: 'POST', cookie: staffCookie,
        body: { target_status: 'under_review', expected_updated_at: latestUpdatedAt }
    }), environment);
    assert.equal(explicitResume.status, 200);
    assert.equal((await readJson(explicitResume)).application_status, 'under_review');
});
