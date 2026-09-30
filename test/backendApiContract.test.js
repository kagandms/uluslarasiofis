import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createR2DocumentStorage } from '../src/server/storage/r2DocumentStorage.js';
import { deriveStaffPasswordHash } from '../src/server/auth/passwordHash.js';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const TEST_PASSWORD = 'Test-only passphrase 2026';
const PASSWORD_HASH = await deriveStaffPasswordHash(TEST_PASSWORD);

function createEnvironment(options = {}) {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const storedObjects = new Map();
    const bucket = {
        async put(key, body) {
            storedObjects.set(key, body);
            return { key };
        },
        async get(key) {
            const body = storedObjects.get(key);
            return body ? { key, body: new Response(body).body, httpMetadata: { contentType: 'application/pdf' } } : null;
        },
        async head(key) {
            return storedObjects.has(key) ? { key } : null;
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
        APP_ENV: 'test',
        ...options
    };
    return { environment, database, storedObjects };
}

async function seedStaff(database, { id, username, role = 'reviewer', isActive = true, passwordHash = PASSWORD_HASH }) {
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

async function readJson(response) {
    return response.json();
}

test('staff login creates a D1-backed HttpOnly session and returns no bearer token', async () => {
    const { environment, database } = createEnvironment();
    await seedStaff(database, { id: 'staff-admin', username: 'admin', role: 'admin' });

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
    await seedStaff(database, { id: 'staff-reviewer', username: 'reviewer' });

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

test('disabled staff cannot create a session', async () => {
    const { environment, database } = createEnvironment();
    await seedStaff(database, { id: 'staff-disabled', username: 'disabled', isActive: false });

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

test('admin-only staff account APIs reject reviewers and allow admins', async () => {
    const { environment, database } = createEnvironment();
    const reviewerSessionToken = 'r'.repeat(43);
    const adminSessionToken = 'a'.repeat(43);
    await seedStaff(database, { id: 'staff-reviewer', username: 'reviewer' });
    await seedStaff(database, { id: 'staff-admin', username: 'admin', role: 'admin' });
    await seedStaffSession(database, 'staff-reviewer', reviewerSessionToken);
    await seedStaffSession(database, 'staff-admin', adminSessionToken);

    const reviewerResponse = await worker.fetch(createRequest('/api/staff/users', {
        cookie: `staff_session=${reviewerSessionToken}`
    }), environment, {});
    const adminResponse = await worker.fetch(createRequest('/api/staff/users', {
        cookie: `staff_session=${adminSessionToken}`
    }), environment, {});

    assert.equal(reviewerResponse.status, 403);
    assert.equal((await readJson(reviewerResponse)).error.code, 'FORBIDDEN');
    assert.equal(adminResponse.status, 200);
    const adminPayload = await readJson(adminResponse);
    assert.equal(adminPayload.users.length, 2);
    assert.doesNotMatch(JSON.stringify(adminPayload), /password_hash|pbkdf/i);
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

test('staff accounts cannot deactivate their own administrator session', async () => {
    const { environment, database } = createEnvironment();
    const sessionToken = 'a'.repeat(43);
    await seedStaff(database, { id: 'staff-admin', username: 'admin', role: 'admin' });
    await seedStaffSession(database, 'staff-admin', sessionToken);
    const response = await worker.fetch(createRequest('/api/staff/users/staff-admin/active', {
        method: 'PATCH', cookie: `staff_session=${sessionToken}`, body: { is_active: false }
    }), environment, {});

    assert.equal(response.status, 409);
    assert.equal((await readJson(response)).error.code, 'CANNOT_DEACTIVATE_SELF');
    assert.equal(database.prepare("SELECT is_active FROM staff_users WHERE id = 'staff-admin'").first().is_active, 1);
});

test('staff APIs reject requests without a D1-backed session', async () => {
    const { environment } = createEnvironment();
    const response = await worker.fetch(createRequest('/api/staff/users'), environment, {});

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

    assert.equal(createResponse.status, 201);
    assert.match(sessionCookie, /^application_session=.+; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=43200$/);
    assert.equal(createPayload.application.status, 'draft');
    assert.equal(createPayload.application.application_type, 'initial');
    assert.doesNotMatch(JSON.stringify(createPayload), /token_hash|storage_key|password_hash/i);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'application.draft_created'").first().count, 1);
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
    await seedStaff(database, { id: 'staff-reviewer', username: 'reviewer' });
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

test('initial admin bootstrap stays closed when any staff account already exists', async () => {
    const { environment, database } = createEnvironment();
    await seedStaff(database, { id: 'staff-reviewer', username: 'reviewer', role: 'reviewer' });
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


test('application submit endpoint requires a session, same origin, and fails closed until readiness exists', async () => {
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

test('staff idle timeout refreshes active sessions without touching every request', async () => {
    const { environment, database } = createEnvironment();
    const token = 'i'.repeat(43);
    await seedStaff(database, { id: 'staff-reviewer', username: 'reviewer' });
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
    await seedStaff(database, { id: 'staff-reviewer', username: 'reviewer' });
    await seedStaff(database, { id: 'staff-disabled', username: 'disabled', isActive: false });
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
    await seedStaff(database, { id: 'staff-reviewer', username: 'reviewer' });
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
    await seedStaff(database, { id: 'staff-reviewer', username: 'reviewer' });
    await seedStaffSession(database, 'staff-reviewer', token);
    database.exec(`CREATE TRIGGER reject_staff_logout_audit BEFORE INSERT ON audit_events WHEN NEW.event_type = 'staff.logout' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;`);

    const response = await worker.fetch(createRequest('/api/staff/auth/logout', { method: 'POST', cookie: `staff_session=${token}` }), environment, {});

    assert.equal(response.status, 500);
    assert.equal(database.prepare('SELECT revoked_at FROM staff_sessions').first().revoked_at, null);
});

test('login, password reset, account state, and bootstrap actions leave audit evidence', async () => {
    const { environment, database } = createEnvironment();
    const adminToken = 'z'.repeat(43);
    const targetToken = 'y'.repeat(43);
    await seedStaff(database, { id: 'staff-admin', username: 'admin', role: 'admin' });
    await seedStaff(database, { id: 'staff-target', username: 'target' });
    await seedStaffSession(database, 'staff-admin', adminToken);
    await seedStaffSession(database, 'staff-target', targetToken);

    const loginResponse = await worker.fetch(createRequest('/api/staff/auth/login', { method: 'POST', body: { username: 'admin', password: TEST_PASSWORD } }), environment, {});
    const resetResponse = await worker.fetch(createRequest('/api/staff/users/staff-target/password', {
        method: 'PATCH', cookie: `staff_session=${adminToken}`, body: { password: 'New secure password 2026' }
    }), environment, {});
    const inactiveResponse = await worker.fetch(createRequest('/api/staff/users/staff-target/active', {
        method: 'PATCH', cookie: `staff_session=${adminToken}`, body: { is_active: false }
    }), environment, {});
    const activeResponse = await worker.fetch(createRequest('/api/staff/users/staff-target/active', {
        method: 'PATCH', cookie: `staff_session=${adminToken}`, body: { is_active: true }
    }), environment, {});
    const createUserResponse = await worker.fetch(createRequest('/api/staff/users', {
        method: 'POST', cookie: `staff_session=${adminToken}`,
        body: { username: 'new.reviewer', password: 'Another secure password 2026', display_name: 'New Reviewer', role: 'reviewer' }
    }), environment, {});

    assert.equal(loginResponse.status, 200);
    assert.equal(resetResponse.status, 200);
    assert.equal(inactiveResponse.status, 200);
    assert.equal(activeResponse.status, 200);
    assert.equal(createUserResponse.status, 201);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'staff.login'").first().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'staff.password_reset'").first().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'staff.user_status_changed'").first().count, 2);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'staff.user_created'").first().count, 1);
    assert.equal(database.prepare("SELECT is_active FROM staff_users WHERE id = 'staff-target'").first().is_active, 1);
    assert.ok(database.prepare('SELECT revoked_at FROM staff_sessions WHERE token_hash = ?').bind(await hashSessionToken(targetToken)).first().revoked_at);
    assert.doesNotMatch(JSON.stringify(await readJson(resetResponse)), /password_hash|pbkdf|token_hash/i);
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
        method: 'PATCH', cookie, body: {
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
        method: 'PATCH', cookie, body: { application_type: 'renewal' }
    }), environment, {});
    const changedPayload = await readJson(changed);
    const resumed = await worker.fetch(createRequest('/api/public/applications/current', { cookie }), environment, {});
    const resumedPayload = await readJson(resumed);
    const renewalRequirements = await worker.fetch(createRequest('/api/public/applications/current/documents', { cookie }), environment, {});
    const changedBack = await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH', cookie, body: { application_type: 'initial' }
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
        method: 'PATCH', cookie, body: { application_type: 'renewal' }
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
        method: 'PATCH', cookie, body: { address_evidence_type: 'all_documents' }
    }), environment, {});
    const saved = await worker.fetch(createRequest('/api/public/applications/current/autosave', {
        method: 'PATCH', cookie, body: { address_evidence_type: 'undertaking' }
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
