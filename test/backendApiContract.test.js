import { readApplicationVersion } from './helpers/owner-version.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createR2DocumentStorage } from '../src/server/storage/r2DocumentStorage.js';
import { deriveStaffPasswordHash } from '../src/server/auth/passwordHash.js';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import worker from '../src/server/worker.js';
import { listDocumentPolicies } from '../src/server/domain/documentPolicy.js';
import { APPLICATION_OWNER_SESSION_DAYS, CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION } from '../src/config/constants.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const TEST_PASSWORD = 'Test-only passphrase 2026';
const PASSWORD_HASH = await deriveStaffPasswordHash(TEST_PASSWORD);

function createEnvironment(options = {}) {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const storedObjects = new Map();
    async function readObjectMetadata(key) {
        const body = storedObjects.get(key);
        if (body === undefined) return null;
        const bytes = new TextEncoder().encode(String(body));
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        const etag = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
        return { body, bytes, etag: `"${etag}"` };
    }
    const bucket = {
        async put(key, body) {
            storedObjects.set(key, body);
            return { key };
        },
        async get(key, options = {}) {
            const object = await readObjectMetadata(key);
            if (!object) return null;
            const body = options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== object.etag
                ? undefined : new Response(object.bytes).body;
            return { key, size: object.bytes.byteLength, etag: object.etag, body,
                httpMetadata: { contentType: 'application/pdf' } };
        },
        async head(key) {
            const object = await readObjectMetadata(key);
            return object ? { key, size: object.bytes.byteLength, etag: object.etag } : null;
        },
        async delete(key) {
            storedObjects.delete(key);
        }
    };
    const environment = {
        DB: database,
        DOCUMENTS: bucket,
        ASSETS: {
            async fetch(request) {
                return new Response(new URL(request.url).pathname, { headers: { 'Content-Type': 'text/html' } });
            }
        },
        STAFF_BOOTSTRAP_TOKEN: 'test-bootstrap-token-with-sufficient-entropy',
        STAFF_SHARED_USERNAME: 'admin',
        APP_ENV: 'test',
        ...options
    };
    return { environment, database, storedObjects };
}

async function seedStaff(environment, database, { id, username, role = 'reviewer', isActive = true, passwordHash = PASSWORD_HASH }) {
    const existingStaff = database.prepare('SELECT id FROM staff_users LIMIT 1').first();
    if (!existingStaff || role === 'admin') environment.STAFF_SHARED_USERNAME = username;
    await database.prepare(`
        INSERT INTO staff_users (
            id, username, normalized_username, password_hash, display_name, role, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, username, username.toLowerCase(), passwordHash, `Display ${username}`, role, isActive ? 1 : 0).run();
}

async function seedStaffSession(database, staffUserId, rawToken, { lastSeenAt, expiresAt } = {}) {
    await database.prepare(`
        INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?)
    `).bind(
        crypto.randomUUID(),
        staffUserId,
        await hashSessionToken(rawToken),
        expiresAt || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        lastSeenAt || new Date().toISOString()
    ).run();
}

function createRequest(path, { method = 'GET', body, cookie, origin = 'https://portal.test', headers: suppliedHeaders = {} } = {}) {
    const headers = new Headers(suppliedHeaders);
    headers.set('Origin', origin);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (cookie) headers.set('Cookie', cookie);
    return new Request(`https://portal.test${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
}

async function readJson(response) {
    return response.json();
}

async function seedCurrentFinalizedDocument(database, applicationId, applicationType, code) {
    const requirement = await database.prepare(`
        SELECT id FROM document_requirements WHERE application_type = ? AND code = ? AND is_active = 1
    `).bind(applicationType, code).first();
    if (!requirement) return;
    const recordId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    await database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type)
        VALUES (?, ?, ?, ?)
    `).bind(recordId, applicationId, requirement.id, applicationType).run();
    await database.prepare(`
        INSERT INTO document_revisions (id, document_record_id, revision_number, status, is_current, submitted_by_type)
        VALUES (?, ?, 1, 'submitted', 1, 'student')
    `).bind(revisionId, recordId).run();
    await database.prepare(`
        INSERT INTO document_revision_files (
            id, revision_id, page_order, storage_key, original_filename, media_type, byte_size,
            upload_status, scan_status
        ) VALUES (?, ?, 0, ?, 'document.pdf', 'application/pdf', 10, 'finalized', 'pending')
    `).bind(fileId, revisionId, `quarantine/${crypto.randomUUID()}`).run();
    await database.prepare(`
        INSERT INTO upload_intents (id, revision_file_id, idempotency_key, expires_at, status, completed_at)
        VALUES (?, ?, ?, '2026-10-01T00:00:00.000Z', 'completed', '2026-09-30T10:00:00.000Z')
    `).bind(crypto.randomUUID(), fileId, crypto.randomUUID()).run();
}

async function createReadyApplication(environment, database, studentNumber, applicationType = 'initial') {
    const response = await worker.fetch(createRequest('/api/public/applications', {
        method: 'POST',
        body: { student_number: studentNumber, application_type: applicationType, email: 'ready@example.edu', phone: '+905551112233' }
    }), environment, {});
    const cookie = response.headers.get('Set-Cookie').split(';')[0];
    const application = database.prepare('SELECT id FROM applications WHERE student_id = (SELECT id FROM students WHERE student_number = ?)')
        .bind(studentNumber).first();
    const acceptedAt = '2026-09-30T10:00:00.000Z';
    await database.prepare(`
        UPDATE applications SET first_name = 'Ayşe', last_name = 'Yılmaz', passport_number = 'P123456',
            nationality = 'Turkish', date_of_birth = '2000-01-01', is_under_18 = 0,
            address_evidence_type = 'rental_contract', fingerprint_status = 'registered', fingerprint_code = 'FP-A/42',
            declaration_version = ?, declaration_accepted_at = ?
        WHERE id = ?
    `).bind(environment.PUBLIC_DECLARATION_VERSION || 'student-information-accuracy-v1', acceptedAt, application.id).run();
    await database.prepare(`
        INSERT INTO audit_events (id, event_type, actor_type, application_id, request_id, safe_metadata_json, created_at)
        VALUES (?, 'application.contact_responsibility_accepted', 'student', ?, 'test-ready', ?, ?)
    `).bind(
        `${application.id}:contact-responsibility:${CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION}`,
        application.id,
        JSON.stringify({ version: CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION }),
        acceptedAt
    ).run();

    const policies = listDocumentPolicies(applicationType, false, 'rental_contract');
    for (const policy of policies) {
        await seedCurrentFinalizedDocument(database, application.id, applicationType, policy.code);
    }
    return { cookie, applicationId: application.id };
}

async function createStaffApplication(environment, database, studentNumber, {
    applicationType = 'initial', status = 'submitted', firstName = 'First', lastName = 'Last',
    passportNumber = 'PASS-123', updatedAt = '2026-09-30T10:00:00.000Z'
} = {}) {
    const request = createRequest('/api/public/applications', {
        method: 'POST',
        body: { student_number: studentNumber, application_type: applicationType, email: `${studentNumber}@example.edu`, phone: '+905550000000' }
    });
    const headers = new Headers(request.headers);
    headers.set('CF-Connecting-IP', studentNumber);
    const response = await worker.fetch(new Request(request, { headers }), environment, {});
    assert.equal(response.status, 201);
    const application = database.prepare(`
        SELECT applications.id FROM applications
        JOIN students ON students.id = applications.student_id
        WHERE students.normalized_student_number = ?
    `).bind(studentNumber.toLocaleUpperCase('en-US')).first();
    await database.prepare(`
        UPDATE applications SET status = ?, first_name = ?, last_name = ?, passport_number = ?,
            updated_at = ?, submitted_at = '2026-09-29T10:00:00.000Z'
        WHERE id = ?
    `).bind(status, firstName, lastName, passportNumber, updatedAt, application.id).run();
    return application.id;
}

function staffCookie(rawToken) {
    return `staff_session=${rawToken}`;
}

async function seedStaffDocument(database, applicationId, applicationType, code, {
    filename = 'review-copy.pdf', reviewStatus = 'under_review', revisionStatus = 'submitted',
    cleanupStatus = 'pending'
} = {}) {
    const requirement = await database.prepare(`
        SELECT id FROM document_requirements
        WHERE application_type = ? AND code = ? AND is_active = 1
    `).bind(applicationType, code).first();
    assert.ok(requirement, `expected active ${applicationType} policy ${code}`);
    const recordId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    await database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type, review_status)
        VALUES (?, ?, ?, ?, ?)
    `).bind(recordId, applicationId, requirement.id, applicationType, reviewStatus).run();
    await database.prepare(`
        INSERT INTO document_revisions (id, document_record_id, revision_number, status, is_current, submitted_by_type)
        VALUES (?, ?, 3, ?, 1, 'student')
    `).bind(revisionId, recordId, revisionStatus).run();
    await database.prepare(`
        INSERT INTO document_revision_files (
            id, revision_id, page_order, storage_key, original_filename, media_type, byte_size,
            upload_status, scan_status, cleanup_status
        ) VALUES (?, ?, 0, 'quarantine/secret-object-key', ?, 'application/pdf', 123, 'finalized', 'clean', ?)
    `).bind(fileId, revisionId, filename, cleanupStatus).run();
}

async function seedAccessibleStaffDocument(database, storedObjects, applicationId, applicationType, code, {
    filename = 'current-passport.pdf', mediaType = 'application/pdf', uploadStatus = 'finalized',
    scanStatus = 'clean', cleanupStatus = 'none', revisionStatus = 'submitted', isCurrent = 1,
    intentStatus = 'completed', objectExists = true
} = {}) {
    const requirement = await database.prepare(`
        SELECT id FROM document_requirements
        WHERE application_type = ? AND code = ? AND is_active = 1
    `).bind(applicationType, code).first();
    assert.ok(requirement, `expected active ${applicationType} policy ${code}`);
    const recordId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    const intentId = crypto.randomUUID();
    const storageKey = `quarantine/${crypto.randomUUID()}`;
    await database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type)
        VALUES (?, ?, ?, ?)
    `).bind(recordId, applicationId, requirement.id, applicationType).run();
    await database.prepare(`
        INSERT INTO document_revisions (id, document_record_id, revision_number, status, is_current, submitted_by_type)
        VALUES (?, ?, 1, ?, ?, 'student')
    `).bind(revisionId, recordId, revisionStatus, isCurrent).run();
    await database.prepare(`
        INSERT INTO document_revision_files (
            id, revision_id, page_order, storage_key, original_filename, media_type, byte_size,
            upload_status, scan_status, cleanup_status
        ) VALUES (?, ?, 0, ?, ?, ?, 30, ?, ?, ?)
    `).bind(fileId, revisionId, storageKey, filename, mediaType, uploadStatus, scanStatus, cleanupStatus).run();
    await database.prepare(`
        INSERT INTO upload_intents (id, revision_file_id, idempotency_key, expires_at, status)
        VALUES (?, ?, ?, '2026-10-01T00:00:00.000Z', ?)
    `).bind(intentId, fileId, `idempotency-${intentId}`, intentStatus).run();
    if (objectExists) storedObjects.set(storageKey, 'private current document bytes');
    return { recordId, revisionId, fileId, intentId, storageKey };
}

test('staff login creates a D1-backed HttpOnly session and returns no bearer token', async () => {
    const { environment, database } = createEnvironment();
    await seedStaff(environment, database, { id: 'staff-admin', username: 'admin', role: 'admin' });

    const response = await worker.fetch(createRequest('/api/staff/auth/login', {
        method: 'POST',
        body: { username: ' ADMIN ', password: TEST_PASSWORD, rememberMe: false }
    }), environment, {});
    const payload = await readJson(response);
    const cookieHeader = response.headers.get('Set-Cookie');

    assert.equal(response.status, 200);
    assert.equal(payload.authenticated, true);
    assert.equal(payload.staff.role, 'admin');
    assert.doesNotMatch(JSON.stringify(payload), /password|token|hash/i);
    assert.match(cookieHeader, /^staff_session=.+; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=43200$/);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM staff_sessions').first().count, 1);

    const sessionCookie = cookieHeader.split(';')[0];
    const sessionResponse = await worker.fetch(createRequest('/api/staff/auth/session', { cookie: sessionCookie }), environment, {});
    assert.equal((await readJson(sessionResponse)).staff.id, 'staff-admin');
});

test('staff login rejects invalid credentials with the safe error contract', async () => {
    const { environment, database } = createEnvironment();
    await seedStaff(environment, database, { id: 'staff-reviewer', username: 'reviewer' });

    const response = await worker.fetch(createRequest('/api/staff/auth/login', {
        method: 'POST',
        body: { username: 'reviewer', password: 'wrong password' }
    }), environment, {});
    const payload = await readJson(response);

    assert.equal(response.status, 401);
    assert.equal(payload.error.code, 'INVALID_CREDENTIALS');
    assert.equal(typeof payload.error.message, 'string');
    assert.equal(typeof payload.requestId, 'string');
    assert.equal(response.headers.get('x-request-id'), payload.requestId);
    assert.doesNotMatch(JSON.stringify(payload), /password_hash|sqlite|pbkdf|stack/i);
});

test('only the configured shared staff account can create a session or reuse an old individual session', async () => {
    const { environment, database } = createEnvironment();
    const reviewerToken = 'reviewer-session-token-000000000000000000';
    await seedStaff(environment, database, { id: 'staff-admin', username: 'admin', role: 'admin' });
    await seedStaff(environment, database, { id: 'staff-reviewer', username: 'reviewer' });
    await seedStaffSession(database, 'staff-reviewer', reviewerToken);

    const reviewerLogin = await worker.fetch(createRequest('/api/staff/auth/login', {
        method: 'POST', body: { username: 'reviewer', password: TEST_PASSWORD }
    }), environment, {});
    const reviewerSession = await worker.fetch(createRequest('/api/staff/auth/session', {
        cookie: staffCookie(reviewerToken)
    }), environment, {});

    assert.equal(reviewerLogin.status, 401);
    assert.equal(reviewerSession.status, 401);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM staff_sessions').first().count, 1);
});

test('staff authentication fails closed when the common account username is not configured', async () => {
    const { environment, database } = createEnvironment();
    await seedStaff(environment, database, { id: 'staff-admin', username: 'admin', role: 'admin' });
    delete environment.STAFF_SHARED_USERNAME;

    const response = await worker.fetch(createRequest('/api/staff/auth/login', {
        method: 'POST', body: { username: 'admin', password: TEST_PASSWORD }
    }), environment, {});

    assert.equal(response.status, 503);
    assert.equal((await readJson(response)).error.code, 'SERVICE_UNAVAILABLE');
});

test('disabled staff cannot create a session', async () => {
    const { environment, database } = createEnvironment();
    await seedStaff(environment, database, { id: 'staff-disabled', username: 'disabled', isActive: false });

    const response = await worker.fetch(createRequest('/api/staff/auth/login', {
        method: 'POST',
        body: { username: 'disabled', password: TEST_PASSWORD }
    }), environment, {});

    assert.equal(response.status, 401);
    assert.equal((await readJson(response)).error.code, 'INVALID_CREDENTIALS');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM staff_sessions').first().count, 0);
});

test('staff login refuses cross-origin requests before credential checks', async () => {
    const { environment } = createEnvironment();
    const response = await worker.fetch(createRequest('/api/staff/auth/login', {
        method: 'POST',
        body: { username: 'admin', password: TEST_PASSWORD },
        origin: 'https://attacker.test'
    }), environment, {});

    assert.equal(response.status, 403);
    assert.equal((await readJson(response)).error.code, 'CROSS_ORIGIN_REQUEST');
});

test('staff account management endpoints are unavailable in the shared-account model', async () => {
    const { environment, database } = createEnvironment();
    const adminSessionToken = 'a'.repeat(43);
    await seedStaff(environment, database, { id: 'staff-admin', username: 'admin', role: 'admin' });
    await seedStaffSession(database, 'staff-admin', adminSessionToken);

    const responses = await Promise.all([
        worker.fetch(createRequest('/api/staff/users', { cookie: staffCookie(adminSessionToken) }), environment, {}),
        worker.fetch(createRequest('/api/staff/users', {
            method: 'POST', cookie: staffCookie(adminSessionToken),
            body: { username: 'new.reviewer', password: 'Another secure password 2026', display_name: 'Reviewer', role: 'reviewer' }
        }), environment, {}),
        worker.fetch(createRequest('/api/staff/users/staff-admin/password', {
            method: 'PATCH', cookie: staffCookie(adminSessionToken), body: { password: 'Another secure password 2026' }
        }), environment, {})
    ]);

    for (const response of responses) {
        assert.equal(response.status, 404);
        assert.equal((await readJson(response)).error.code, 'NOT_FOUND');
    }
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM staff_users').first().count, 1);
});

test('staff login applies a temporary D1-backed failed-attempt limit', async () => {
    const { environment } = createEnvironment();
    const loginRequest = () => createRequest('/api/staff/auth/login', {
        method: 'POST', body: { username: 'unknown-user', password: TEST_PASSWORD }
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await worker.fetch(loginRequest(), environment, {});
        assert.equal(response.status, 401);
    }
    const blockedResponse = await worker.fetch(loginRequest(), environment, {});

    assert.equal(blockedResponse.status, 429);
    assert.equal((await readJson(blockedResponse)).error.code, 'RATE_LIMITED');
});

test('staff APIs reject requests without a D1-backed session', async () => {
    const { environment } = createEnvironment();
    const response = await worker.fetch(createRequest('/api/staff/applications/query', {
        method: 'POST', body: { q: '', status: 'all', page: 1, page_size: 25 }
    }), environment, {});

    assert.equal(response.status, 401);
    assert.equal((await readJson(response)).error.code, 'UNAUTHORIZED');
});

test('public routes remain available without a staff password or session', async () => {
    const { environment } = createEnvironment();

    for (const path of ['/', '/basvuru/', '/basvurum/']) {
        const response = await worker.fetch(createRequest(path), environment, {});
        assert.equal(response.status, 200, path);
        assert.equal(await response.text(), path);
    }
});

test('application API creates an opaque owner session and enforces the active application constraint', async () => {
    const { environment, database } = createEnvironment();
    const requestBody = {
        student_number: '2026123456',
        application_type: 'initial',
        email: 'student@example.edu',
        phone: '+905551112233'
    };

    const createResponse = await worker.fetch(createRequest('/api/public/applications', {
        method: 'POST',
        body: requestBody
    }), environment, {});
    const createPayload = await readJson(createResponse);
    const sessionCookie = createResponse.headers.get('Set-Cookie');
    const sessionToken = sessionCookie.split(';')[0].split('=')[1];

    assert.equal(createResponse.status, 201);
    assert.match(sessionCookie, new RegExp(`^application_session=.+; HttpOnly; Secure; SameSite=Strict; Path=\\/; Max-Age=${APPLICATION_OWNER_SESSION_DAYS * 24 * 60 * 60}$`));
    assert.equal(createPayload.application.status, 'draft');
    assert.equal(createPayload.application.application_type, 'initial');
    assert.doesNotMatch(JSON.stringify(createPayload), /token_hash|storage_key|password_hash/i);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'application.draft_created'").first().count, 1);
    const ownerSession = database.prepare(`
        SELECT sessions.token_hash, sessions.created_at, sessions.expires_at, applications.id AS application_id
        FROM application_sessions AS sessions
        JOIN applications ON applications.id = sessions.application_id
        JOIN students ON students.id = applications.student_id
        WHERE students.normalized_student_number = '2026123456'
    `).first();
    assert.equal(ownerSession.token_hash, await hashSessionToken(sessionToken));
    assert.notEqual(ownerSession.token_hash, sessionToken);
    assert.equal(Date.parse(ownerSession.expires_at) - Date.parse(ownerSession.created_at),
        APPLICATION_OWNER_SESSION_DAYS * 24 * 60 * 60 * 1000);
    const retentionMinutes = database.prepare(`
        SELECT (julianday(retention_due_at) - julianday(created_at)) * 24 * 60 AS minutes
        FROM applications
    `).first().minutes;
    assert.ok(retentionMinutes >= 43_199 && retentionMinutes <= 43_201);

    const currentCookie = sessionCookie.split(';')[0];
    const currentResponse = await worker.fetch(createRequest('/api/public/applications/current', { cookie: currentCookie }), environment, {});
    const currentPayload = await readJson(currentResponse);
    assert.equal(currentPayload.application.student_number, '2026123456');
    assert.equal(currentPayload.application.id, undefined);
    assert.equal(database.prepare('SELECT expires_at FROM application_sessions WHERE application_id = ?')
        .bind(ownerSession.application_id).first().expires_at, ownerSession.expires_at);

    const duplicateResponse = await worker.fetch(createRequest('/api/public/applications', {
        method: 'POST',
        body: { ...requestBody, application_type: 'renewal' }
    }), environment, {});
    assert.equal(duplicateResponse.status, 409);
    assert.equal((await readJson(duplicateResponse)).error.code, 'APPLICATION_ALREADY_ACTIVE');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM applications').first().count, 1);
});

test('application draft and owner session roll back when their audit event cannot be recorded', async () => {
    const { environment, database } = createEnvironment();
    database.exec(`
        CREATE TRIGGER reject_draft_audit
        BEFORE INSERT ON audit_events
        WHEN NEW.event_type = 'application.draft_created'
        BEGIN
            SELECT RAISE(ABORT, 'audit unavailable');
        END;
    `);

    const response = await worker.fetch(createRequest('/api/public/applications', {
        method: 'POST',
        body: {
            student_number: '2026123456',
            application_type: 'initial',
            email: 'student@example.edu',
            phone: '+905551112233'
        }
    }), environment, {});

    assert.equal(response.status, 500);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM applications').first().count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM application_sessions').first().count, 0);
});

test('applicant logout revokes the owner session and expires its secure cookie', async () => {
    const { environment, database } = createEnvironment();
    const created = await worker.fetch(createRequest('/api/public/applications', {
        method: 'POST',
        body: { student_number: '2026123468', application_type: 'initial', email: 'logout@example.edu', phone: '555' }
    }), environment, {});
    const ownerCookie = created.headers.get('Set-Cookie').split(';')[0];
    const tokenHash = await hashSessionToken(ownerCookie.split('=')[1]);

    const logout = await worker.fetch(createRequest('/api/public/applications/logout', {
        method: 'POST', cookie: ownerCookie
    }), environment, {});
    const afterLogout = await worker.fetch(createRequest('/api/public/applications/current/status', {
        cookie: ownerCookie
    }), environment, {});

    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('Set-Cookie'), /^application_session=; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=0$/);
    assert.ok(database.prepare('SELECT revoked_at FROM application_sessions WHERE token_hash = ?').bind(tokenHash).first().revoked_at);
    assert.equal(afterLogout.status, 401);
});

test('private documents require a staff session and clean finalized metadata', async () => {
    const { environment, database, storedObjects } = createEnvironment();
    let storageReads = 0;
    const reviewerSessionToken = 'r'.repeat(43);
    const objectKey = 'quarantine/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    environment.DOCUMENTS = {
        async get(key) {
            storageReads += 1;
            return storedObjects.has(key)
                ? { body: new Response('private file bytes').body, httpMetadata: { contentType: 'application/pdf' } }
                : null;
        }
    };
    await seedStaff(environment, database, { id: 'staff-reviewer', username: 'reviewer' });
    await seedStaffSession(database, 'staff-reviewer', reviewerSessionToken);
    await database.prepare(`
        INSERT INTO students (id, student_number, normalized_student_number)
        VALUES ('student-1', '2026123456', '2026123456')
    `).run();
    await database.prepare(`
        INSERT INTO applications (id, student_id, application_type)
        VALUES ('application-1', 'student-1', 'initial')
    `).run();
    await database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type)
        VALUES ('document-1', 'application-1', 'req-initial-passport-identity', 'initial')
    `).run();
    await database.prepare(`
        INSERT INTO document_revisions (id, document_record_id, revision_number, status, submitted_by_type)
        VALUES ('revision-1', 'document-1', 1, 'submitted', 'student')
    `).run();
    await database.prepare(`
        INSERT INTO document_revision_files (
            id, revision_id, page_order, storage_key, original_filename,
            media_type, byte_size, upload_status, scan_status
        ) VALUES ('file-1', 'revision-1', 0, ?, '../private.pdf', 'application/pdf', 18, 'finalized', 'clean')
    `).bind(objectKey).run();
    storedObjects.set(objectKey, true);

    const unauthenticatedResponse = await worker.fetch(createRequest('/api/staff/documents/file-1/content'), environment, {});
    assert.equal(unauthenticatedResponse.status, 401);
    assert.equal(storageReads, 0);

    const authorizedResponse = await worker.fetch(createRequest('/api/staff/documents/file-1/content', {
        cookie: `staff_session=${reviewerSessionToken}`
    }), environment, {});
    assert.equal(authorizedResponse.status, 200);
    assert.match(authorizedResponse.headers.get('Content-Disposition'), /^attachment; filename="private\.pdf"$/);
    assert.equal(authorizedResponse.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(await authorizedResponse.text(), 'private file bytes');
    assert.equal(storageReads, 1);

    await database.prepare("UPDATE document_revision_files SET scan_status = 'unsafe' WHERE id = 'file-1'").run();
    const unsafeResponse = await worker.fetch(createRequest('/api/staff/documents/file-1/content', {
        cookie: `staff_session=${reviewerSessionToken}`
    }), environment, {});
    assert.equal(unsafeResponse.status, 404);
    assert.equal(storageReads, 1);
});

test('unknown API errors include a correlation id and no provider details', async () => {
    const { environment } = createEnvironment();
    const response = await worker.fetch(createRequest('/api/unavailable'), environment, {});
    const payload = await readJson(response);

    assert.equal(response.status, 404);
    assert.equal(typeof payload.error.code, 'string');
    assert.equal(typeof payload.error.message, 'string');
    assert.equal(payload.requestId, response.headers.get('x-request-id'));
    assert.doesNotMatch(JSON.stringify(payload.error), /sqlite|r2|d1|stack|undefined|failed to fetch/i);
});

test('initial admin bootstrap requires a secret and closes after the first account', async () => {
    const { environment, database } = createEnvironment();
    const body = { username: 'root-admin', password: TEST_PASSWORD, display_name: 'Root Admin' };
    environment.STAFF_SHARED_USERNAME = body.username;
    const bootstrapRequest = (token) => createRequest('/api/staff/auth/bootstrap', {
        method: 'POST',
        body,
        origin: 'https://portal.test'
    });

    const rejectedRequest = await worker.fetch(bootstrapRequest(''), environment, {});
    assert.equal(rejectedRequest.status, 403);

    const authorizedRequest = createRequest('/api/staff/auth/bootstrap', {
        method: 'POST',
        body,
        origin: 'https://portal.test'
    });
    authorizedRequest.headers.set('X-Staff-Bootstrap-Token', environment.STAFF_BOOTSTRAP_TOKEN);
    const response = await worker.fetch(authorizedRequest, environment, {});
    assert.equal(response.status, 201);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM staff_users WHERE role = 'admin'").first().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'staff.admin_bootstrapped'").first().count, 1);

    const secondRequest = createRequest('/api/staff/auth/bootstrap', {
        method: 'POST',
        body,
        origin: 'https://portal.test'
    });
    secondRequest.headers.set('X-Staff-Bootstrap-Token', environment.STAFF_BOOTSTRAP_TOKEN);
    const secondResponse = await worker.fetch(secondRequest, environment, {});
    assert.equal(secondResponse.status, 409);
    assert.equal((await readJson(secondResponse)).error.code, 'BOOTSTRAP_CLOSED');
});

test('staff bootstrap and login support case-insensitive usernames containing at and hash', async () => {
    const { environment, database } = createEnvironment();
    const username = 'Shared.Admin@Office#1';
    environment.STAFF_SHARED_USERNAME = username;
    const bootstrapRequest = createRequest('/api/staff/auth/bootstrap', {
        method: 'POST',
        body: { username, password: TEST_PASSWORD, display_name: 'Test Shared Admin' }
    });
    bootstrapRequest.headers.set('X-Staff-Bootstrap-Token', environment.STAFF_BOOTSTRAP_TOKEN);

    const bootstrapResponse = await worker.fetch(bootstrapRequest, environment, {});
    const storedUser = database.prepare('SELECT username, normalized_username, password_hash FROM staff_users').first();
    assert.equal(bootstrapResponse.status, 201);
    assert.equal(storedUser.username, username);
    assert.equal(storedUser.normalized_username, 'shared.admin@office#1');
    assert.notEqual(storedUser.password_hash, TEST_PASSWORD);

    const loginResponse = await worker.fetch(createRequest('/api/staff/auth/login', {
        method: 'POST',
        body: { username: 'sHARED.aDMIN@oFFICE#1', password: TEST_PASSWORD }
    }), environment, {});

    assert.equal(loginResponse.status, 200);
    assert.match(loginResponse.headers.get('Set-Cookie'), /^staff_session=.+; HttpOnly; Secure; SameSite=Strict;/);
});

test('initial admin bootstrap stays closed when any staff account already exists', async () => {
    const { environment, database } = createEnvironment();
    await seedStaff(environment, database, { id: 'staff-reviewer', username: 'reviewer', role: 'reviewer' });
    const request = createRequest('/api/staff/auth/bootstrap', {
        method: 'POST', body: { username: 'root-admin', password: TEST_PASSWORD, display_name: 'Root Admin' }
    });
    request.headers.set('X-Staff-Bootstrap-Token', environment.STAFF_BOOTSTRAP_TOKEN);
    const response = await worker.fetch(request, environment, {});

    assert.equal(response.status, 409);
    assert.equal((await readJson(response)).error.code, 'BOOTSTRAP_CLOSED');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM staff_users').first().count, 1);
});


test('current application status is available only through its owner session', async () => {
    const { environment, database } = createEnvironment();
    const firstResponse = await worker.fetch(createRequest('/api/public/applications', {
        method: 'POST', body: { student_number: '2026123456', application_type: 'initial', email: 'a@example.edu', phone: '111' }
    }), environment, {});
    const secondResponse = await worker.fetch(createRequest('/api/public/applications', {
        method: 'POST', body: { student_number: '2026123457', application_type: 'renewal', email: 'b@example.edu', phone: '222' }
    }), environment, {});
    const firstCookie = firstResponse.headers.get('Set-Cookie').split(';')[0];
    const secondApplicationId = database.prepare("SELECT id FROM applications WHERE student_id = (SELECT id FROM students WHERE student_number = '2026123457')").first().id;
    database.prepare("UPDATE applications SET status = 'under_review' WHERE id = ?").bind(secondApplicationId).run();

    const statusResponse = await worker.fetch(createRequest(`/api/public/applications/current/status?application_id=${secondApplicationId}`, { cookie: firstCookie }), environment, {});
    const statusPayload = await readJson(statusResponse);

    assert.equal(firstResponse.status, 201);
    assert.equal(secondResponse.status, 201);
    assert.equal(statusResponse.status, 200);
    assert.equal(statusPayload.application.status, 'draft');
    assert.equal(statusPayload.application.application_type, 'initial');
    assert.equal(statusPayload.application.id, undefined);
    assert.equal(statusPayload.application.student_number, undefined);
    assert.doesNotMatch(JSON.stringify(statusPayload), /storage_key|staff|audit|password|token_hash|https?:/i);

    const firstToken = firstCookie.split('=')[1];
    await database.prepare('UPDATE application_sessions SET revoked_at = ? WHERE token_hash = ?')
        .bind(new Date().toISOString(), await hashSessionToken(firstToken)).run();
    const revokedResponse = await worker.fetch(createRequest('/api/public/applications/current/status', { cookie: firstCookie }), environment, {});
    assert.equal(revokedResponse.status, 401);
});


test('application submit endpoint requires owner session, same origin, and current readiness', async () => {
    const { environment, database } = createEnvironment();
    const path = '/api/public/applications/current/submit';
    const unauthenticated = await worker.fetch(createRequest(path, { method: 'POST' }), environment, {});
    const crossOrigin = await worker.fetch(createRequest(path, { method: 'POST', origin: 'https://attacker.test' }), environment, {});
    const created = await worker.fetch(createRequest('/api/public/applications', {
        method: 'POST', body: { student_number: '2026123458', application_type: 'initial', email: 'c@example.edu', phone: '333' }
    }), environment, {});
    const cookie = created.headers.get('Set-Cookie').split(';')[0];

    assert.equal(unauthenticated.status, 401);
    assert.equal(crossOrigin.status, 403);
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await worker.fetch(createRequest(path, { method: 'POST', cookie }), environment, {});
        const payload = await readJson(response);
        assert.equal(response.status, 409);
        assert.equal(payload.error.code, 'SUBMISSION_NOT_READY');
        assert.doesNotMatch(payload.error.message, /storage_key|password_hash|token_hash|\bd1\b|sqlite/i);
    }
    assert.equal(database.prepare('SELECT status FROM applications').first().status, 'draft');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'application.submitted'").first().count, 0);
});

test('ready application submits once through its owner session and returns only student-safe fields', async () => {
    const { environment, database } = createEnvironment();
    const first = await createReadyApplication(environment, database, '2026123990');
    const second = await createReadyApplication(environment, database, '2026123991');
    const path = '/api/public/applications/current/submit';
    const response = await worker.fetch(createRequest(`${path}?application_id=${second.applicationId}`, {
        method: 'POST', cookie: first.cookie,
        body: { application_id: second.applicationId, student_number: '2026123991' }
    }), environment, {});
    const payload = await readJson(response);
    const repeated = await worker.fetch(createRequest(path, { method: 'POST', cookie: first.cookie }), environment, {});
    const submittedTracking = await worker.fetch(createRequest('/api/public/applications/current/tracking', {
        cookie: first.cookie
    }), environment, {});

    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.application.status, 'submitted');
    assert.equal(payload.application.student_number, '2026123990');
    assert.equal(typeof payload.application.submitted_at, 'string');
    assert.equal(payload.application.id, undefined);
    assert.doesNotMatch(JSON.stringify(payload), /storage_key|session_hash|token_hash|internal-application-id/i);
    assert.equal(database.prepare('SELECT status FROM applications WHERE id = ?').bind(first.applicationId).first().status, 'submitted');
    const submittedLifecycle = database.prepare(`
        SELECT retention_due_at, terminal_at, submitted_at, updated_at, last_activity_at
        FROM applications WHERE id = ?
    `).bind(first.applicationId).first();
    assert.equal(submittedLifecycle.retention_due_at, null);
    assert.equal(submittedLifecycle.terminal_at, null);
    assert.equal(submittedLifecycle.submitted_at, payload.application.submitted_at);
    assert.equal(submittedLifecycle.updated_at, payload.application.submitted_at);
    assert.equal(submittedLifecycle.last_activity_at, payload.application.submitted_at);
    assert.equal(database.prepare('SELECT status FROM applications WHERE id = ?').bind(second.applicationId).first().status, 'draft');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'application.submitted'").first().count, 1);
    assert.equal(repeated.status, 409);
    assert.equal(submittedTracking.status, 200);
    assert.equal((await readJson(submittedTracking)).application.status, 'submitted');
    assert.equal(database.prepare('SELECT retention_due_at, terminal_at FROM applications WHERE id = ?')
        .bind(first.applicationId).first().retention_due_at, null);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'application.submitted'").first().count, 1);
});

test('staff idle timeout refreshes active sessions without touching every request', async () => {
    const { environment, database } = createEnvironment();
    const token = 'i'.repeat(43);
    await seedStaff(environment, database, { id: 'staff-reviewer', username: 'reviewer' });
    const staleTouch = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await seedStaffSession(database, 'staff-reviewer', token, { lastSeenAt: staleTouch });

    const active = await worker.fetch(createRequest('/api/staff/auth/session', { cookie: `staff_session=${token}` }), environment, {});
    const refreshedAt = database.prepare('SELECT last_seen_at FROM staff_sessions').first().last_seen_at;
    const recent = await worker.fetch(createRequest('/api/staff/auth/session', { cookie: `staff_session=${token}` }), environment, {});
    const unchangedAt = database.prepare('SELECT last_seen_at FROM staff_sessions').first().last_seen_at;

    assert.equal(active.status, 200);
    assert.equal(recent.status, 200);
    assert.ok(refreshedAt > staleTouch);
    assert.equal(unchangedAt, refreshedAt);
});

test('idle-expired, absolute-expired, and disabled staff sessions are unauthorized and never revived', async () => {
    const { environment, database } = createEnvironment();
    const idleToken = 'j'.repeat(43);
    const absoluteToken = 'k'.repeat(43);
    const disabledToken = 'm'.repeat(43);
    const expiredIdleAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    await seedStaff(environment, database, { id: 'staff-reviewer', username: 'reviewer' });
    await seedStaff(environment, database, { id: 'staff-disabled', username: 'disabled', isActive: false });
    await seedStaffSession(database, 'staff-reviewer', idleToken, { lastSeenAt: expiredIdleAt });
    await seedStaffSession(database, 'staff-reviewer', absoluteToken, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    await seedStaffSession(database, 'staff-disabled', disabledToken);

    for (const token of [idleToken, absoluteToken, disabledToken]) {
        const response = await worker.fetch(createRequest('/api/staff/auth/session', { cookie: `staff_session=${token}` }), environment, {});
        assert.equal(response.status, 401);
    }
    const lastSeenAt = database.prepare('SELECT last_seen_at FROM staff_sessions WHERE token_hash = ?')
        .bind(await hashSessionToken(idleToken)).first().last_seen_at;
    assert.equal(lastSeenAt, expiredIdleAt);
});

test('staff logout records one safe audit event and remains idempotent for expired sessions', async () => {
    const { environment, database } = createEnvironment();
    const activeToken = 'o'.repeat(43);
    const expiredToken = 'e'.repeat(43);
    await seedStaff(environment, database, { id: 'staff-reviewer', username: 'reviewer' });
    await seedStaffSession(database, 'staff-reviewer', activeToken);
    await seedStaffSession(database, 'staff-reviewer', expiredToken, { expiresAt: new Date(Date.now() - 1000).toISOString() });

    const activeLogout = await worker.fetch(createRequest('/api/staff/auth/logout', { method: 'POST', cookie: `staff_session=${activeToken}` }), environment, {});
    const repeatLogout = await worker.fetch(createRequest('/api/staff/auth/logout', { method: 'POST', cookie: `staff_session=${activeToken}` }), environment, {});
    const expiredLogout = await worker.fetch(createRequest('/api/staff/auth/logout', { method: 'POST', cookie: `staff_session=${expiredToken}` }), environment, {});

    assert.equal(activeLogout.status, 200);
    assert.equal(repeatLogout.status, 200);
    assert.equal(expiredLogout.status, 200);
    assert.match(activeLogout.headers.get('Set-Cookie'), /Max-Age=0$/);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'staff.logout'").first().count, 1);
    const audit = database.prepare("SELECT actor_staff_id, safe_metadata_json FROM audit_events WHERE event_type = 'staff.logout'").first();
    assert.equal(audit.actor_staff_id, 'staff-reviewer');
    assert.doesNotMatch(audit.safe_metadata_json, /cookie|token|o{20}/i);
});

test('staff logout audit failure rolls back revocation', async () => {
    const { environment, database } = createEnvironment();
    const token = 'f'.repeat(43);
    await seedStaff(environment, database, { id: 'staff-reviewer', username: 'reviewer' });
    await seedStaffSession(database, 'staff-reviewer', token);
    database.exec(`CREATE TRIGGER reject_staff_logout_audit BEFORE INSERT ON audit_events WHEN NEW.event_type = 'staff.logout' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;`);

    const response = await worker.fetch(createRequest('/api/staff/auth/logout', { method: 'POST', cookie: `staff_session=${token}` }), environment, {});

    assert.equal(response.status, 500);
    assert.equal(database.prepare('SELECT revoked_at FROM staff_sessions').first().revoked_at, null);
});

test('staff bootstrap rejects a username different from the configured common account', async () => {
    const { environment, database } = createEnvironment();
    const response = await worker.fetch(createRequest('/api/staff/auth/bootstrap', {
        method: 'POST',
        headers: { 'X-Staff-Bootstrap-Token': environment.STAFF_BOOTSTRAP_TOKEN },
        body: { username: 'other-account', password: TEST_PASSWORD, display_name: 'Shared staff' }
    }), environment, {});

    assert.equal(response.status, 400);
    assert.equal((await readJson(response)).error.code, 'VALIDATION_ERROR');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM staff_users').first().count, 0);
});

test('shared staff account can read application queue and detail while drafts remain excluded', async () => {
    const { environment, database } = createEnvironment();
    const draftId = await createStaffApplication(environment, database, 'STAFF-DRAFT', { status: 'draft' });
    const applicationA = await createStaffApplication(environment, database, 'STAFF-A', {
        firstName: 'Ayşe', lastName: 'Yılmaz', passportNumber: 'PASSPORT-PRIVATE-A'
    });
    const applicationB = await createStaffApplication(environment, database, 'STAFF-B', {
        firstName: 'Mert', lastName: 'Kaya', passportNumber: 'PASSPORT-PRIVATE-B'
    });
    await seedStaff(environment, database, { id: 'staff-admin-apps', username: 'admin-apps', role: 'admin' });
    await database.prepare(`
        INSERT INTO assignments (id, application_id, staff_user_id, assigned_by_staff_id)
        VALUES ('legacy-assignment', ?, 'staff-admin-apps', 'staff-admin-apps')
    `).bind(applicationA).run();
    const sharedToken = 'admin-apps-session-token-00000000000000000000';
    await seedStaffSession(database, 'staff-admin-apps', sharedToken);

    const unauthenticatedQueue = await worker.fetch(createRequest('/api/staff/applications/query', {
        method: 'POST', body: { status: 'all' }
    }), environment, {});
    const unauthenticatedDetail = await worker.fetch(createRequest(`/api/staff/applications/${applicationA}`), environment, {});
    const wrongMethod = await worker.fetch(createRequest('/api/staff/applications/query', {
        method: 'GET', cookie: staffCookie(sharedToken)
    }), environment, {});
    const crossOrigin = await worker.fetch(createRequest('/api/staff/applications/query', {
        method: 'POST', body: { status: 'all' }, cookie: staffCookie(sharedToken), origin: 'https://attacker.test'
    }), environment, {});
    const reviewerQueue = await worker.fetch(createRequest('/api/staff/applications/query', {
        method: 'POST', body: { status: 'all' }, cookie: staffCookie(sharedToken)
    }), environment, {});
    const adminDetail = await worker.fetch(createRequest(`/api/staff/applications/${applicationA}`, {
        cookie: staffCookie(sharedToken)
    }), environment, {});
    const draftDetail = await worker.fetch(createRequest(`/api/staff/applications/${draftId}`, {
        cookie: staffCookie(sharedToken)
    }), environment, {});
    const invalidDetail = await worker.fetch(createRequest('/api/staff/applications/not-a-real-id', {
        cookie: staffCookie(sharedToken)
    }), environment, {});
    const queuePayload = await reviewerQueue.json();
    const detailPayload = await adminDetail.json();

    assert.equal(unauthenticatedQueue.status, 401);
    assert.equal(unauthenticatedDetail.status, 401);
    assert.equal(wrongMethod.status, 405);
    assert.equal(crossOrigin.status, 403);
    assert.equal(reviewerQueue.status, 200);
    assert.equal(adminDetail.status, 200);
    assert.equal(draftDetail.status, 404);
    assert.equal(invalidDetail.status, 404);
    assert.equal(queuePayload.items.some((item) => item.id === draftId), false);
    assert.ok(queuePayload.items.some((item) => item.id === applicationA));
    assert.doesNotMatch(JSON.stringify(queuePayload), /assigned_staff|Atanan Personel|admin-apps/);
    assert.equal(detailPayload.application.id, applicationA);
    assert.equal(detailPayload.application.student_number, 'STAFF-A');
    assert.equal(detailPayload.application.passport_number, 'PASSPORT-PRIVATE-A');
    assert.notEqual(detailPayload.application.id, applicationB);
    assert.doesNotMatch(JSON.stringify(queuePayload), /PASSPORT-PRIVATE|password_hash|token_hash|session|storage_key|safe_metadata_json/i);
    assert.doesNotMatch(JSON.stringify(detailPayload), /password_hash|token_hash|session_id|storage_key|secret-object-key|safe_metadata_json|https?:\/\//i);
});

test('staff application queue maps every supported status filter and paginates deterministically', async () => {
    const { environment, database } = createEnvironment();
    const statuses = [
        ['new', 'submitted'], ['under_review', 'under_review'], ['resubmission_required', 'resubmission_required'],
        ['approved', 'approved_for_processing'], ['migration-sent', 'sent_to_migration'],
        ['migration-approved', 'migration_approved'], ['complete', 'completed'],
        ['cancel', 'cancelled'], ['reject', 'rejected'], ['draft-only', 'draft']
    ];
    const idByStatus = new Map();
    for (const [suffix, status] of statuses) {
        const id = await createStaffApplication(environment, database, `FILTER-${suffix}`, { status });
        idByStatus.set(status, id);
    }
    await seedStaff(environment, database, { id: 'staff-filter-reviewer', username: 'filter-reviewer' });
    const token = 'filter-reviewer-session-token-000000000000000';
    await seedStaffSession(database, 'staff-filter-reviewer', token);
    const cookie = staffCookie(token);
    const query = (body) => worker.fetch(createRequest('/api/staff/applications/query', {
        method: 'POST', body, cookie
    }), environment, {});
    const allResponse = await query({ status: 'all', page: 1, page_size: 100 });
    const all = await allResponse.json();
    assert.equal(all.pagination.total_items, 9);
    assert.equal(all.items.length, 9);
    assert.ok(all.items.every((item) => item.status !== 'draft'));

    const filterCases = [
        ['new', ['submitted']], ['under_review', ['under_review']],
        ['resubmission_required', ['resubmission_required']], ['approved', ['approved_for_processing']],
        ['migration', ['sent_to_migration', 'migration_approved']], ['completed', ['completed']],
        ['terminal', ['completed', 'cancelled', 'rejected']]
    ];
    for (const [filter, expectedStatuses] of filterCases) {
        const response = await query({ status: filter, page: 1, page_size: 100 });
        const payload = await response.json();
        assert.equal(response.status, 200);
        assert.deepEqual(payload.items.map((item) => item.status).sort(), [...expectedStatuses].sort());
    }
    const unknown = await query({ status: 'submitted OR 1=1' });
    const oversized = await query({ status: 'all', page: 1, page_size: 101 });
    const invalidPage = await query({ status: 'all', page: 0 });
    const excessiveSearch = await query({ status: 'all', q: 'x'.repeat(121) });
    assert.equal(unknown.status, 400);
    assert.equal(oversized.status, 400);
    assert.equal(invalidPage.status, 400);
    assert.equal(excessiveSearch.status, 400);

    const selected = [idByStatus.get('submitted'), idByStatus.get('under_review'), idByStatus.get('completed')];
    for (const applicationId of idByStatus.values()) {
        await database.prepare(`UPDATE applications SET updated_at = '2026-09-28T10:00:00.000Z', created_at = '2026-09-28T10:00:00.000Z' WHERE id = ?`)
            .bind(applicationId).run();
    }
    await database.prepare(`UPDATE applications SET updated_at = '2026-09-30T10:00:00.000Z' WHERE id IN (?, ?, ?)`)
        .bind(...selected).run();
    const stablePage = await (await query({ status: 'all', page: 1, page_size: 2 })).json();
    const expectedIds = [...selected].sort().reverse().slice(0, 2);
    assert.deepEqual(stablePage.items.map((item) => item.id), expectedIds);
    assert.deepEqual(stablePage.pagination, { page: 1, page_size: 2, total_items: 9, total_pages: 5 });
});

test('staff application search matches student number, names, and passport literally without echoing the query', async () => {
    const { environment, database } = createEnvironment();
    const targetId = await createStaffApplication(environment, database, 'SEARCH-123', {
        firstName: 'Ada', lastName: 'Lovelace', passportNumber: 'PASS-SEARCH-456'
    });
    const wildcardId = await createStaffApplication(environment, database, 'SEARCH-%_LITERAL', {
        firstName: 'Wild', lastName: 'Card', passportNumber: 'PASS-%_LITERAL'
    });
    await createStaffApplication(environment, database, 'SEARCH-OTHER', {
        firstName: 'Other', lastName: 'Person', passportNumber: 'PASS-OTHER'
    });
    await seedStaff(environment, database, { id: 'staff-search-reviewer', username: 'search-reviewer' });
    const token = 'search-reviewer-session-token-000000000000000';
    await seedStaffSession(database, 'staff-search-reviewer', token);
    const query = async (q) => {
        const response = await worker.fetch(createRequest('/api/staff/applications/query', {
            method: 'POST', body: { q, status: 'all' }, cookie: staffCookie(token)
        }), environment, {});
        return { response, payload: await response.json() };
    };

    for (const value of ['SEARCH-123', 'Ada Lovelace', 'PASS-SEARCH-456']) {
        const { response, payload } = await query(value);
        assert.equal(response.status, 200);
        assert.deepEqual(payload.items.map((item) => item.id), [targetId]);
        assert.doesNotMatch(JSON.stringify(payload), /PASS-SEARCH-456/);
    }
    const literal = await query('%_LITERAL');
    assert.deepEqual(literal.payload.items.map((item) => item.id), [wildcardId]);
    const injection = await query("%' OR 1=1 --");
    assert.equal(injection.payload.pagination.total_items, 0);
    assert.doesNotMatch(JSON.stringify(injection.payload), /%' OR 1=1/);
});

test('staff application detail reuses policy and excludes legacy person-assignment data', async () => {
    const { environment, database } = createEnvironment();
    const renewalId = await createStaffApplication(environment, database, 'DETAIL-RENEWAL', {
        applicationType: 'renewal', status: 'under_review'
    });
    const initialId = await createStaffApplication(environment, database, 'DETAIL-INITIAL', {
        applicationType: 'initial'
    });
    await database.prepare(`
        UPDATE applications SET is_under_18 = 1, address_evidence_type = 'undertaking',
            declaration_version = 'accuracy-v1', declaration_accepted_at = '2026-09-28T10:00:00.000Z'
        WHERE id = ?
    `).bind(renewalId).run();
    await seedStaffDocument(database, renewalId, 'renewal', 'passport', {
        filename: 'passport-safe-name.pdf', reviewStatus: 'approved', revisionStatus: 'approved'
    });
    await seedStaff(environment, database, { id: 'staff-detail-reviewer', username: 'detail-reviewer' });
    const token = 'detail-reviewer-session-token-000000000000000';
    await seedStaffSession(database, 'staff-detail-reviewer', token);
    await database.prepare(`
        INSERT INTO assignments (id, application_id, staff_user_id, assigned_by_staff_id)
        VALUES ('active-review-assignment', ?, 'staff-detail-reviewer', 'staff-detail-reviewer')
    `).bind(renewalId).run();

    const renewal = await worker.fetch(createRequest(`/api/staff/applications/${renewalId}`, {
        cookie: staffCookie(token)
    }), environment, {});
    const initial = await worker.fetch(createRequest(`/api/staff/applications/${initialId}`, {
        cookie: staffCookie(token)
    }), environment, {});
    const renewalPayload = await renewal.json();
    const initialPayload = await initial.json();
    const documents = renewalPayload.documents;
    const passport = documents.find((document) => document.code === 'passport');

    assert.equal(renewal.status, 200);
    assert.equal(renewalPayload.application.contact_acknowledgement_accepted_current, false);
    assert.equal(renewalPayload.application.declaration_version, 'accuracy-v1');
    assert.equal(Object.hasOwn(renewalPayload, 'assignment'), false);
    assert.doesNotMatch(JSON.stringify(renewalPayload), /staff-detail-reviewer|assigned_staff/);
    assert.ok(documents.some((document) => document.code === 'uets'));
    assert.ok(documents.some((document) => document.code === 'address_undertaking'));
    assert.ok(documents.some((document) => document.code === 'host_residence_certificate'));
    assert.ok(documents.some((document) => document.code === 'host_identity_copy'));
    assert.ok(documents.some((document) => document.code === 'birth_certificate_under18'));
    assert.equal(passport.revision_number, 3);
    assert.equal(passport.review_status, 'approved');
    assert.equal(passport.revision_status, 'approved');
    assert.equal(passport.upload_status, 'finalized');
    assert.equal(passport.scan_status, 'clean');
    assert.equal(passport.cleanup_status, 'pending');
    assert.equal(passport.filename, 'passport-safe-name.pdf');
    assert.equal(initialPayload.documents.some((document) => document.code === 'uets'), false);
    assert.doesNotMatch(JSON.stringify(renewalPayload), /secret-object-key|storage_key|file_id|revision_id|document_record_id|https?:\/\//i);
});

test('staff current-document preview and download share application-scoped authorization and audit safe access', async () => {
    const { environment, database, storedObjects } = createEnvironment({
        R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
        R2_BUCKET_NAME: 'private-documents', R2_ACCESS_KEY_ID: 'PUBLIC-KEY-ID-FOR-TESTS',
        R2_SECRET_ACCESS_KEY: 'NEVER-RETURN-THIS-SECRET'
    });
    const applicationA = await createStaffApplication(environment, database, 'ACCESS-A');
    const applicationB = await createStaffApplication(environment, database, 'ACCESS-B');
    const document = await seedAccessibleStaffDocument(database, storedObjects, applicationA, 'initial', 'passport', {
        filename: '../passport résumé.pdf'
    });
    await seedStaff(environment, database, { id: 'staff-access-admin', username: 'access-admin', role: 'admin' });
    const adminToken = 'access-admin-session-token-0000000000000000';
    await seedStaffSession(database, 'staff-access-admin', adminToken);
    const previewPath = `/api/staff/applications/${applicationA}/documents/passport/preview`;
    const downloadPath = `/api/staff/applications/${applicationA}/documents/passport/download`;

    const unauthenticatedPreview = await worker.fetch(createRequest(previewPath, { method: 'POST' }), environment, {});
    const unauthenticatedDownload = await worker.fetch(createRequest(downloadPath), environment, {});
    const wrongPreviewMethod = await worker.fetch(createRequest(previewPath, {
        cookie: staffCookie(adminToken)
    }), environment, {});
    const crossOriginPreview = await worker.fetch(createRequest(previewPath, {
        method: 'POST', cookie: staffCookie(adminToken), origin: 'https://attacker.test'
    }), environment, {});
    const sharedStaffPreview = await worker.fetch(createRequest(previewPath, {
        method: 'POST', cookie: staffCookie(adminToken)
    }), environment, {});
    const adminDownload = await worker.fetch(createRequest(downloadPath, {
        cookie: staffCookie(adminToken)
    }), environment, {});
    const wrongApplication = await worker.fetch(createRequest(
        `/api/staff/applications/${applicationB}/documents/passport/download`, { cookie: staffCookie(adminToken) }
    ), environment, {});
    const detailResponse = await worker.fetch(createRequest(`/api/staff/applications/${applicationA}`, {
        cookie: staffCookie(adminToken)
    }), environment, {});
    const preview = await readJson(sharedStaffPreview);
    const detail = await readJson(detailResponse);
    const auditRows = database.prepare(`
        SELECT event_type, actor_staff_id, application_id, document_record_id, request_id, safe_metadata_json
        FROM audit_events WHERE event_type IN ('staff.document_preview_issued', 'staff.document_downloaded')
        ORDER BY event_type
    `).all().results;
    const previewAudit = auditRows.find((event) => event.event_type === 'staff.document_preview_issued');
    const downloadAudit = auditRows.find((event) => event.event_type === 'staff.document_downloaded');

    assert.equal(unauthenticatedPreview.status, 401);
    assert.equal(unauthenticatedDownload.status, 401);
    assert.equal(wrongPreviewMethod.status, 405);
    assert.equal(crossOriginPreview.status, 403);
    assert.equal(sharedStaffPreview.status, 200);
    assert.equal(adminDownload.status, 200);
    assert.equal(wrongApplication.status, 404);
    assert.equal(detail.documents.find((item) => item.code === 'passport').access_available, true);
    assert.equal(preview.method, 'GET');
    assert.equal(new URL(preview.url).searchParams.get('X-Amz-Expires'), '120');
    assert.ok(Math.abs(Date.parse(preview.expires_at) - Date.now() - 120_000) < 10_000);
    assert.equal(preview.media_type, 'application/pdf');
    assert.equal(preview.filename, 'passport r_sum_.pdf');
    assert.equal(sharedStaffPreview.headers.get('Cache-Control'), 'no-store');
    assert.equal(sharedStaffPreview.headers.has('Set-Cookie'), false);
    assert.doesNotMatch(JSON.stringify(preview), /file_id|revision_id|document_record_id|storage_key|NEVER-RETURN-THIS-SECRET/);
    assert.equal(adminDownload.headers.get('Content-Type'), 'application/pdf');
    assert.equal(adminDownload.headers.get('Content-Disposition'), 'attachment; filename="passport r_sum_.pdf"');
    assert.equal(adminDownload.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(adminDownload.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(await adminDownload.text(), 'private current document bytes');
    assert.ok(previewAudit && downloadAudit);
    assert.equal(previewAudit.actor_staff_id, 'staff-access-admin');
    assert.equal(downloadAudit.actor_staff_id, 'staff-access-admin');
    assert.equal(previewAudit.application_id, applicationA);
    assert.equal(previewAudit.document_record_id, document.recordId);
    assert.equal(previewAudit.request_id, sharedStaffPreview.headers.get('x-request-id'));
    assert.deepEqual(JSON.parse(previewAudit.safe_metadata_json), {
        documentCode: 'passport', revisionNumber: 1, result: 'capability_issued'
    });
    assert.deepEqual(JSON.parse(downloadAudit.safe_metadata_json), {
        documentCode: 'passport', revisionNumber: 1, result: 'downloaded'
    });
    assert.doesNotMatch(JSON.stringify(auditRows), /storage_key|quarantine|X-Amz|passport r_sum_|NEVER-RETURN-THIS-SECRET/);
    assert.equal(database.prepare(`
        SELECT COUNT(*) AS count FROM audit_events
        WHERE application_id = ? AND event_type IN ('staff.document_preview_issued', 'staff.document_downloaded')
    `).bind(applicationB).first().count, 0);
});

test('staff current-document access rejects unsafe, incomplete, stale, missing, and inapplicable documents', async () => {
    const { environment, database, storedObjects } = createEnvironment({
        R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
        R2_BUCKET_NAME: 'private-documents', R2_ACCESS_KEY_ID: 'PUBLIC-KEY-ID-FOR-TESTS',
        R2_SECRET_ACCESS_KEY: 'NEVER-RETURN-THIS-SECRET'
    });
    const applicationId = await createStaffApplication(environment, database, 'ACCESS-INVALID');
    const draftId = await createStaffApplication(environment, database, 'ACCESS-DRAFT', { status: 'draft' });
    await database.prepare('UPDATE applications SET is_under_18 = 0, address_evidence_type = ? WHERE id = ?')
        .bind('undertaking', applicationId).run();
    const accessible = await seedAccessibleStaffDocument(database, storedObjects, applicationId, 'initial', 'passport');
    await seedAccessibleStaffDocument(database, storedObjects, applicationId, 'initial', 'address_rental_contract');
    await seedStaff(environment, database, { id: 'staff-invalid-access', username: 'invalid-access' });
    const token = 'invalid-access-session-token-0000000000000000';
    await seedStaffSession(database, 'staff-invalid-access', token);
    const requestDownload = (targetApplicationId, code = 'passport') => worker.fetch(createRequest(
        `/api/staff/applications/${targetApplicationId}/documents/${code}/download`, { cookie: staffCookie(token) }
    ), environment, {});
    const assertUnavailable = async (response) => {
        const payload = await readJson(response);
        assert.equal(response.status, 404);
        assert.equal(payload.error.code, 'DOCUMENT_NOT_AVAILABLE');
        assert.equal(payload.error.message, 'Belge mevcut değil veya erişilemiyor.');
    };

    const approvedApplication = await createStaffApplication(environment, database, 'ACCESS-APPROVED', { status: 'under_review' });
    await seedAccessibleStaffDocument(database, storedObjects, approvedApplication, 'initial', 'passport', {
        revisionStatus: 'approved'
    });
    assert.equal((await requestDownload(approvedApplication)).status, 200);

    await database.prepare("UPDATE document_revision_files SET scan_status = 'pending' WHERE id = ?").bind(accessible.fileId).run();
    await assertUnavailable(await requestDownload(applicationId));
    await database.prepare("UPDATE document_revision_files SET scan_status = 'unsafe' WHERE id = ?").bind(accessible.fileId).run();
    await assertUnavailable(await requestDownload(applicationId));
    await database.prepare("UPDATE document_revision_files SET scan_status = 'failed' WHERE id = ?").bind(accessible.fileId).run();
    await assertUnavailable(await requestDownload(applicationId));
    await database.prepare("UPDATE document_revision_files SET scan_status = 'clean', upload_status = 'uploaded' WHERE id = ?").bind(accessible.fileId).run();
    await assertUnavailable(await requestDownload(applicationId));
    await database.prepare("UPDATE document_revision_files SET upload_status = 'finalized', cleanup_status = 'pending' WHERE id = ?").bind(accessible.fileId).run();
    await assertUnavailable(await requestDownload(applicationId));
    await database.prepare("UPDATE document_revision_files SET cleanup_status = 'none' WHERE id = ?").bind(accessible.fileId).run();
    await database.prepare("UPDATE upload_intents SET status = 'pending' WHERE id = ?").bind(accessible.intentId).run();
    await assertUnavailable(await requestDownload(applicationId));
    await database.prepare("UPDATE upload_intents SET status = 'completed' WHERE id = ?").bind(accessible.intentId).run();
    await database.prepare("UPDATE document_revisions SET is_current = 0, status = 'superseded' WHERE id = ?").bind(accessible.revisionId).run();
    await assertUnavailable(await requestDownload(applicationId));
    await assertUnavailable(await requestDownload(applicationId, 'uets'));
    await assertUnavailable(await requestDownload(applicationId, 'birth_certificate_under18'));
    await assertUnavailable(await requestDownload(applicationId, 'address_rental_contract'));
    const draftResponse = await requestDownload(draftId);
    assert.equal(draftResponse.status, 404);
    assert.equal((await readJson(draftResponse)).error.code, 'APPLICATION_NOT_FOUND');
    const unknownApplication = await requestDownload('not-an-application');
    assert.equal(unknownApplication.status, 404);
    assert.equal((await readJson(unknownApplication)).error.code, 'APPLICATION_NOT_FOUND');

    const inactiveApplication = await createStaffApplication(environment, database, 'ACCESS-INACTIVE');
    await seedAccessibleStaffDocument(database, storedObjects, inactiveApplication, 'initial', 'passport');
    await database.prepare("UPDATE document_requirements SET is_active = 0 WHERE code = 'passport' AND application_type = 'initial'").run();
    await assertUnavailable(await requestDownload(inactiveApplication));
    await database.prepare("UPDATE document_requirements SET is_active = 1 WHERE code = 'passport' AND application_type = 'initial'").run();
    const missingObjectApplication = await createStaffApplication(environment, database, 'ACCESS-MISSING-OBJECT');
    await seedAccessibleStaffDocument(database, storedObjects, missingObjectApplication, 'initial', 'passport', { objectExists: false });
    await assertUnavailable(await requestDownload(missingObjectApplication));
    const unsupportedMediaApplication = await createStaffApplication(environment, database, 'ACCESS-UNSUPPORTED-MEDIA');
    await seedAccessibleStaffDocument(database, storedObjects, unsupportedMediaApplication, 'initial', 'passport', {
        mediaType: 'text/html'
    });
    await assertUnavailable(await requestDownload(unsupportedMediaApplication));

    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE event_type = ?').bind('staff.document_downloaded').first().count, 1);
});

test('staff preview signing failure returns a safe service error and issues no audited capability', async () => {
    const { environment, database, storedObjects } = createEnvironment();
    const applicationId = await createStaffApplication(environment, database, 'ACCESS-SIGNING-ERROR');
    await seedAccessibleStaffDocument(database, storedObjects, applicationId, 'initial', 'passport');
    await seedStaff(environment, database, { id: 'staff-signing-error', username: 'signing-error' });
    const token = 'signing-error-session-token-000000000000000';
    await seedStaffSession(database, 'staff-signing-error', token);

    const response = await worker.fetch(createRequest(
        `/api/staff/applications/${applicationId}/documents/passport/preview`,
        { method: 'POST', cookie: staffCookie(token) }
    ), environment, {});
    const payload = await readJson(response);

    assert.equal(response.status, 503);
    assert.equal(payload.error.code, 'SERVICE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(payload), /PUBLIC-KEY-ID-FOR-TESTS|NEVER-RETURN-THIS-SECRET|storage_key|quarantine/);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'staff.document_preview_issued'").first().count, 0);
});


test('application status rejects expired sessions and student numbers never authorize access', async () => {
    const { environment, database } = createEnvironment();
    const unauthenticated = await worker.fetch(createRequest('/api/public/applications/current/status?student_number=2026123456'), environment, {});
    const created = await worker.fetch(createRequest('/api/public/applications', {
        method: 'POST', body: { student_number: '2026123459', application_type: 'initial', email: 'expired@example.edu', phone: '444' }
    }), environment, {});
    const cookie = created.headers.get('Set-Cookie').split(';')[0];
    const token = cookie.split('=')[1];
    await database.prepare('UPDATE application_sessions SET expires_at = ? WHERE token_hash = ?')
        .bind(new Date(Date.now() - 1000).toISOString(), await hashSessionToken(token)).run();

    const expired = await worker.fetch(createRequest('/api/public/applications/current/status', { cookie }), environment, {});

    assert.equal(unauthenticated.status, 401);
    assert.equal(expired.status, 401);
});

test('application draft updates ignore fields outside the public allowlist', async () => {
    const { environment, database } = createEnvironment();
    const created = await worker.fetch(createRequest('/api/public/applications', {
        method: 'POST', body: { student_number: '2026123460', application_type: 'initial', email: 'draft@example.edu', phone: '555' }
    }), environment, {});
    const cookie = created.headers.get('Set-Cookie').split(';')[0];
    const response = await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie, body: { lock_version: await readApplicationVersion(environment, cookie),
            student_email: 'updated@example.edu', status: 'submitted', student_number: '2026999999',
            storage_key: 'quarantine/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', staff_note: 'private'
        }
    }), environment, {});
    const payload = await readJson(response);
    const row = database.prepare(`
        SELECT applications.status, applications.student_email, students.student_number
        FROM applications JOIN students ON students.id = applications.student_id
    `).first();

    assert.equal(response.status, 200);
    assert.equal(row.status, 'draft');
    assert.equal(row.student_email, 'updated@example.edu');
    assert.equal(row.student_number, '2026123460');
    assert.equal(payload.application.status, 'draft');
    assert.doesNotMatch(JSON.stringify(payload), /storage_key|staff_note|2026999999/i);
});

test('owner session can change draft application type and reload preserves it', async () => {
    const { environment, database } = createEnvironment();
    const created = await worker.fetch(createRequest('/api/public/applications', {
        method: 'POST', body: { student_number: '2026123462', application_type: 'initial', email: 'type@example.edu', phone: '777' }
    }), environment, {});
    const cookie = created.headers.get('Set-Cookie').split(';')[0];

    const initialRequirements = await worker.fetch(createRequest('/api/public/applications/current/documents', { cookie }), environment, {});
    const changed = await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie, body: { lock_version: await readApplicationVersion(environment, cookie), application_type: 'renewal' }
    }), environment, {});
    const changedPayload = await readJson(changed);
    const resumed = await worker.fetch(createRequest('/api/public/applications/current', { cookie }), environment, {});
    const resumedPayload = await readJson(resumed);
    const renewalRequirements = await worker.fetch(createRequest('/api/public/applications/current/documents', { cookie }), environment, {});
    const changedBack = await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie, body: { lock_version: await readApplicationVersion(environment, cookie), application_type: 'initial' }
    }), environment, {});
    const initialAgain = await worker.fetch(createRequest('/api/public/applications/current', { cookie }), environment, {});
    const initialAgainPayload = await readJson(initialAgain);
    const audit = database.prepare(`
        SELECT safe_metadata_json FROM audit_events WHERE event_type = 'application.application_type_changed'
        ORDER BY created_at LIMIT 1
    `).first();

    assert.equal(changed.status, 200);
    assert.equal(changedPayload.application.application_type, 'renewal');
    assert.equal(resumedPayload.application.application_type, 'renewal');
    assert.equal((await readJson(initialRequirements)).requirements.some(({ code }) => code === 'uets'), false);
    assert.equal((await readJson(renewalRequirements)).requirements.some(({ code }) => code === 'uets'), true);
    assert.equal(changedBack.status, 200);
    assert.equal(initialAgainPayload.application.application_type, 'initial');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'application.application_type_changed'").first().count, 2);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM applications').first().count, 1);
    assert.deepEqual(JSON.parse(audit.safe_metadata_json), {
        previous_application_type: 'initial', new_application_type: 'renewal'
    });

    database.prepare("UPDATE applications SET status = 'submitted'").run();
    const rejected = await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie, body: { lock_version: await readApplicationVersion(environment, cookie), application_type: 'renewal' }
    }), environment, {});
    assert.equal(rejected.status, 409);
    assert.equal((await readJson(rejected)).error.code, 'APPLICATION_NOT_EDITABLE');
    assert.equal(database.prepare('SELECT application_type FROM applications').first().application_type, 'initial');
});

test('draft address evidence is server-validated and restored after reload', async () => {
    const { environment, database } = createEnvironment();
    const created = await worker.fetch(createRequest('/api/public/applications', {
        method: 'POST', body: { student_number: '2026123463', application_type: 'initial', email: 'address@example.edu', phone: '888' }
    }), environment, {});
    const cookie = created.headers.get('Set-Cookie').split(';')[0];

    const invalid = await worker.fetch(createRequest('/api/public/applications/current/autosave', {
        method: 'PATCH', cookie, body: { lock_version: await readApplicationVersion(environment, cookie), address_evidence_type: 'all_documents' }
    }), environment, {});
    const saved = await worker.fetch(createRequest('/api/public/applications/current/autosave', {
        method: 'PATCH', cookie, body: { lock_version: await readApplicationVersion(environment, cookie), address_evidence_type: 'undertaking' }
    }), environment, {});
    const current = await worker.fetch(createRequest('/api/public/applications/current', { cookie }), environment, {});

    assert.equal(invalid.status, 400);
    assert.equal(saved.status, 200);
    assert.equal((await readJson(saved)).application.address_evidence_type, 'undertaking');
    assert.equal((await readJson(current)).application.address_evidence_type, 'undertaking');
    assert.equal(database.prepare('SELECT address_evidence_type FROM applications').first().address_evidence_type, 'undertaking');
});

test('non-draft applications cannot enter the submit path', async () => {
    const { environment, database } = createEnvironment();
    const created = await worker.fetch(createRequest('/api/public/applications', {
        method: 'POST', body: { student_number: '2026123461', application_type: 'initial', email: 'review@example.edu', phone: '666' }
    }), environment, {});
    const cookie = created.headers.get('Set-Cookie').split(';')[0];
    database.prepare("UPDATE applications SET status = 'under_review'").run();

    const response = await worker.fetch(createRequest('/api/public/applications/current/submit', { method: 'POST', cookie }), environment, {});

    assert.equal(response.status, 409);
    assert.equal((await readJson(response)).error.code, 'APPLICATION_NOT_SUBMITTABLE');
    assert.equal(database.prepare('SELECT status FROM applications').first().status, 'under_review');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'application.submitted'").first().count, 0);
});

test('archive manifest and pinned file stream require shared staff and reject revision or object changes', async () => {
    const { environment, database, storedObjects } = createEnvironment();
    const appA = await createStaffApplication(environment, database, 'ZIP-A');
    const appB = await createStaffApplication(environment, database, 'ZIP-B');
    const current = await seedAccessibleStaffDocument(database, storedObjects, appA, 'initial', 'passport');
    await database.prepare('UPDATE document_revisions SET revision_number = 2 WHERE id = ?').bind(current.revisionId).run();
    const oldRevisionId = crypto.randomUUID();
    const oldFileId = crypto.randomUUID();
    const oldIntentId = crypto.randomUUID();
    const oldStorageKey = `quarantine/${crypto.randomUUID()}`;
    await database.prepare(`INSERT INTO document_revisions (id, document_record_id, revision_number, status, is_current, submitted_by_type)
        VALUES (?, ?, 1, 'superseded', 0, 'student')`).bind(oldRevisionId, current.recordId).run();
    await database.prepare(`INSERT INTO document_revision_files (id, revision_id, page_order, storage_key, original_filename,
        media_type, byte_size, upload_status, scan_status, cleanup_status)
        VALUES (?, ?, 0, ?, 'old-private-name.pdf', 'application/pdf', 3, 'finalized', 'clean', 'none')`)
        .bind(oldFileId, oldRevisionId, oldStorageKey).run();
    await database.prepare(`INSERT INTO upload_intents (id, revision_file_id, idempotency_key, expires_at, status)
        VALUES (?, ?, ?, '2026-10-01T00:00:00.000Z', 'completed')`)
        .bind(oldIntentId, oldFileId, `old-${oldIntentId}`).run();
    storedObjects.set(oldStorageKey, 'old');
    await seedStaff(environment, database, { id: 'zip-staff', username: 'zip-admin', role: 'admin' });
    const token = 'zip-admin-session-token-0000000000000000000';
    await seedStaffSession(database, 'zip-staff', token);
    const manifestPath = `/api/staff/applications/${appA}/documents/archive-manifest`;
    const manifestDenied = await worker.fetch(createRequest(manifestPath, { method: 'POST' }), environment, {});
    const crossOriginManifest = await worker.fetch(createRequest(manifestPath, {
        method: 'POST', cookie: staffCookie(token), origin: 'https://attacker.test'
    }), environment, {});
    const manifestResponse = await worker.fetch(createRequest(manifestPath, {
        method: 'POST', cookie: staffCookie(token)
    }), environment, {});
    const manifest = await readJson(manifestResponse);
    const filePath = `/api/staff/applications/${appA}/documents/passport/archive-file`;
    const item = manifest.files[0];
    const fileUrl = (applicationId, revision = item.expected_revision_number, identity = item.object_identity) =>
        `/api/staff/applications/${applicationId}/documents/passport/archive-file?revision=${revision}&identity=${identity}`;
    const denied = await worker.fetch(createRequest(fileUrl(appA), {}), environment, {});
    const crossOriginFile = await worker.fetch(createRequest(fileUrl(appA), {
        cookie: staffCookie(token), origin: 'https://attacker.test'
    }), environment, {});
    const wrongApplication = await worker.fetch(createRequest(fileUrl(appB), { cookie: staffCookie(token) }), environment, {});
    const staleRevision = await worker.fetch(createRequest(fileUrl(appA, item.expected_revision_number + 1), {
        cookie: staffCookie(token)
    }), environment, {});
    const authorized = await worker.fetch(createRequest(fileUrl(appA), { cookie: staffCookie(token) }), environment, {});

    assert.equal(manifestDenied.status, 401);
    assert.equal(crossOriginManifest.status, 403);
    assert.equal(manifestResponse.status, 200);
    assert.equal(manifest.files.length, 1);
    assert.equal(item.entry_name, '01-passport.pdf');
    assert.equal(item.expected_revision_number, 2);
    assert.doesNotMatch(JSON.stringify(manifest), /storage_key|quarantine\/|signed|filename|file_id|revision_id/i);
    assert.equal(denied.status, 401);
    assert.equal(crossOriginFile.status, 403);
    assert.equal(wrongApplication.status, 404);
    assert.equal(staleRevision.status, 409);
    assert.equal(authorized.status, 200);
    assert.equal(await authorized.text(), 'private current document bytes');
    storedObjects.set(current.storageKey, 'replacement bytes of different identity');
    const changed = await worker.fetch(createRequest(filePath + `?revision=${item.expected_revision_number}&identity=${item.object_identity}`, {
        cookie: staffCookie(token)
    }), environment, {});
    assert.ok([404, 409].includes(changed.status));
    const audit = database.prepare("SELECT event_type FROM audit_events WHERE event_type LIKE 'staff.application_archive_%'").all().results;
    assert.deepEqual(audit.map((row) => row.event_type).sort(), [
        'staff.application_archive_document_stream_authorized', 'staff.application_archive_requested'
    ]);
});

test('archive manifest blocks pending, unsafe, cleanup-pending and missing private objects', async () => {
    for (const options of [
        { scanStatus: 'pending' }, { scanStatus: 'unsafe' }, { cleanupStatus: 'pending' }, { objectExists: false }
    ]) {
        const { environment, database, storedObjects } = createEnvironment();
        const applicationId = await createStaffApplication(environment, database, `ZIP-GATE-${crypto.randomUUID()}`);
        await seedAccessibleStaffDocument(database, storedObjects, applicationId, 'initial', 'passport', options);
        await seedStaff(environment, database, { id: 'zip-gate-staff', username: 'zip-gate-admin', role: 'admin' });
        const token = 'zip-gate-admin-session-token-0000000000000000';
        await seedStaffSession(database, 'zip-gate-staff', token);
        const response = await worker.fetch(createRequest(
            `/api/staff/applications/${applicationId}/documents/archive-manifest`,
            { method: 'POST', cookie: staffCookie(token) }
        ), environment, {});
        assert.equal(response.status, 404, JSON.stringify(options));
    }
});

test('archive body fails closed if its revision changes before the private stream completes', async () => {
    const { environment, database, storedObjects } = createEnvironment();
    const applicationId = await createStaffApplication(environment, database, 'ZIP-RACE');
    const document = await seedAccessibleStaffDocument(database, storedObjects, applicationId, 'initial', 'passport');
    await seedStaff(environment, database, { id: 'zip-race-staff', username: 'zip-race-admin', role: 'admin' });
    const token = 'zip-race-admin-session-token-0000000000000000';
    await seedStaffSession(database, 'zip-race-staff', token);
    const manifestResponse = await worker.fetch(createRequest(
        `/api/staff/applications/${applicationId}/documents/archive-manifest`,
        { method: 'POST', cookie: staffCookie(token) }
    ), environment, {});
    const { files: [file] } = await readJson(manifestResponse);
    const response = await worker.fetch(createRequest(
        `/api/staff/applications/${applicationId}/documents/passport/archive-file?revision=${file.expected_revision_number}&identity=${file.object_identity}`,
        { cookie: staffCookie(token) }
    ), environment, {});

    await database.prepare("UPDATE document_revisions SET is_current = 0, status = 'superseded' WHERE id = ?")
        .bind(document.revisionId).run();
    assert.equal(response.status, 200);
    await assert.rejects(response.text());
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type LIKE '%archive%completed%'").first().count, 0);
});
