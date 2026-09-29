import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createR2DocumentStorage } from '../src/server/storage/r2DocumentStorage.js';
import { deriveStaffPasswordHash } from '../src/server/auth/passwordHash.js';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import worker from '../src/server/worker.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const migrationSql = readFileSync(new URL('../migrations/0001_backend_foundation.sql', import.meta.url), 'utf8');
const TEST_PASSWORD = 'Test-only passphrase 2026';
const PASSWORD_HASH = await deriveStaffPasswordHash(TEST_PASSWORD);

function createEnvironment(options = {}) {
    const database = new TestD1Database();
    database.exec(migrationSql);
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

async function seedStaffSession(database, staffUserId, rawToken) {
    await database.prepare(`
        INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at)
        VALUES (?, ?, ?, ?)
    `).bind(
        crypto.randomUUID(),
        staffUserId,
        await hashSessionToken(rawToken),
        new Date(Date.now() + 60 * 60 * 1000).toISOString()
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
