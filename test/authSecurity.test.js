import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { deriveStaffPasswordHash, verifyStaffPassword } from '../src/server/auth/passwordHash.js';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import worker from '../src/server/worker.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const migrationSql = readFileSync(new URL('../migrations/0001_backend_foundation.sql', import.meta.url), 'utf8');
const TEST_PASSWORD = 'test-only secure staff password';
const TEST_PASSWORD_HASH = await deriveStaffPasswordHash(TEST_PASSWORD);

function createEnvironment(options = {}) {
    const database = new TestD1Database();
    database.exec(migrationSql);
    return { DB: database, ...options };
}

async function seedStaff(database, passwordHash = TEST_PASSWORD_HASH) {
    await database.prepare(`
        INSERT INTO staff_users (
            id, username, normalized_username, password_hash, display_name, role
        ) VALUES ('staff-1', 'test.staff', 'test.staff', ?, 'Test Staff', 'admin')
    `).bind(passwordHash).run();
}

async function seedSession(database, token) {
    await database.prepare(`
        INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at)
        VALUES ('session-1', 'staff-1', ?, ?)
    `).bind(await hashSessionToken(token), new Date(Date.now() + 60_000).toISOString()).run();
}

function createRequest(path, { method = 'GET', body, cookie, authorization, origin = 'https://portal.test' } = {}) {
    const headers = new Headers({ Origin: origin });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (cookie) headers.set('Cookie', cookie);
    if (authorization) headers.set('Authorization', authorization);
    return new Request(`https://portal.test${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
}

test('staff login uses an individual D1 account and sets an opaque HttpOnly cookie', async () => {
    const environment = createEnvironment();
    await seedStaff(environment.DB);
    const response = await worker.fetch(createRequest('/api/staff/auth/login', {
        method: 'POST', body: { username: 'test.staff', password: TEST_PASSWORD }
    }), environment, {});
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.authenticated, true);
    assert.match(response.headers.get('Set-Cookie'), /^staff_session=.+; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=43200$/);
    assert.doesNotMatch(JSON.stringify(payload), /password_hash|token|stack/i);
});

test('staff APIs reject bearer tokens and requests without a session cookie', async () => {
    const environment = createEnvironment();
    const response = await worker.fetch(createRequest('/api/staff/auth/session', {
        authorization: 'Bearer token-that-must-not-authorize'
    }), environment, {});

    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'UNAUTHORIZED');
});

test('staff APIs report a missing D1 binding as service unavailable', async () => {
    const response = await worker.fetch(createRequest('/api/staff/auth/session'), {}, {});
    const payload = await response.json();

    assert.equal(response.status, 503);
    assert.equal(payload.error.code, 'SERVICE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(payload), /D1Database|RepositoryConfigurationError|stack/i);
});

test('staff auth rejects malformed session cookies', async () => {
    const environment = createEnvironment();
    const response = await worker.fetch(createRequest('/api/staff/auth/session', {
        cookie: 'staff_session=short-token'
    }), environment, {});

    assert.equal(response.status, 401);
});

test('staff login fails safely when the database binding is unavailable', async () => {
    const response = await worker.fetch(createRequest('/api/staff/auth/login', {
        method: 'POST', body: { username: 'test.staff', password: 'a secure passphrase' }
    }), {}, {});
    const payload = await response.json();

    assert.equal(response.status, 503);
    assert.doesNotMatch(JSON.stringify(payload), /SITE_PASSWORD|JWT_SECRET|stack|undefined/i);
});

test('staff session endpoint authenticates only an active D1 session cookie', async () => {
    const environment = createEnvironment();
    const token = 't'.repeat(43);
    await seedStaff(environment.DB);
    await seedSession(environment.DB, token);
    const response = await worker.fetch(createRequest('/api/staff/auth/session', {
        cookie: `staff_session=${token}`
    }), environment, {});
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.authenticated, true);
    assert.equal(payload.staff.id, 'staff-1');
    assert.doesNotMatch(JSON.stringify(payload), /password_hash|token_hash/i);
});

test('logout revokes the D1 session and expires its secure cookie', async () => {
    const environment = createEnvironment();
    const token = 'l'.repeat(43);
    await seedStaff(environment.DB);
    await seedSession(environment.DB, token);
    const response = await worker.fetch(createRequest('/api/staff/auth/logout', {
        method: 'POST', cookie: `staff_session=${token}`
    }), environment, {});

    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).success, true);
    assert.match(response.headers.get('Set-Cookie'), /^staff_session=; HttpOnly; Secure; SameSite=Strict; Path=\/; Max-Age=0$/);
    assert.ok(environment.DB.prepare('SELECT revoked_at FROM staff_sessions').first().revoked_at);
});

test('cross-origin staff mutations are rejected before calling upstream services', async () => {
    const environment = createEnvironment({ APPS_SCRIPT_URL: 'https://apps.example.test/exec', APPS_SCRIPT_API_KEY: 'test-key' });
    const token = 'c'.repeat(43);
    await seedStaff(environment.DB);
    await seedSession(environment.DB, token);
    const originalFetch = globalThis.fetch;
    let upstreamCalled = false;
    globalThis.fetch = async () => {
        upstreamCalled = true;
        return new Response('{"success":true}');
    };

    try {
        const response = await worker.fetch(createRequest('/api/add-tebligat', {
            method: 'POST', cookie: `staff_session=${token}`, origin: 'https://attacker.example',
            body: { sayfa: '01.01.2026', isim: 'Test' }
        }), environment, {});
        assert.equal(response.status, 403);
        assert.equal((await response.json()).error.code, 'CROSS_ORIGIN_REQUEST');
    } finally {
        globalThis.fetch = originalFetch;
    }
    assert.equal(upstreamCalled, false);
});

test('all existing protected APIs reject missing sessions before upstream requests', async () => {
    const environment = createEnvironment();
    const protectedRequests = [
        ['/api/get-all-tebligat', { method: 'GET' }],
        ['/api/search-tebligat?q=test&year=2026', { method: 'GET' }],
        ['/api/add-tebligat', { method: 'POST', body: { sayfa: '01.01.2026', isim: 'Test' } }],
        ['/api/update-tebligat', { method: 'POST', body: { sayfa: '01.01.2026', isim: 'Test', no: '1' } }],
        ['/api/unmark-tebligat', { method: 'POST', body: { sayfa: '01.01.2026', isim: 'Test', no: '1' } }],
        ['/api/remove-tebligat', { method: 'POST', body: { sayfa: '01.01.2026', isim: 'Test', no: '1' } }],
        ['/api/ocr', { method: 'POST', body: {} }]
    ];

    for (const [path, options] of protectedRequests) {
        const response = await worker.fetch(createRequest(path, options), environment, {});
        assert.equal(response.status, 401, path);
    }
});

test('legacy session route remains backed by individual staff sessions', async () => {
    const environment = createEnvironment();
    const token = 'b'.repeat(43);
    await seedStaff(environment.DB);
    await seedSession(environment.DB, token);
    const response = await worker.fetch(createRequest('/api/session', {
        cookie: `staff_session=${token}`
    }), environment, {});

    assert.equal(response.status, 200);
    assert.equal((await response.json()).authenticated, true);
});


test('staff password verification rejects malformed and legacy hashes without exposing errors', async () => {
    const validHash = await deriveStaffPasswordHash(TEST_PASSWORD);

    assert.equal(await verifyStaffPassword(TEST_PASSWORD, validHash), true);
    assert.equal(await verifyStaffPassword('a different secure passphrase', validHash), false);
    for (const malformedHash of [
        '', 'pbkdf2_sha1$600000$invalid$invalid',
        'pbkdf2_sha256$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        'pbkdf2_sha256$600000$short$short', 'pbkdf2_sha256$600000$%%%$%%%'
    ]) {
        assert.equal(await verifyStaffPassword(TEST_PASSWORD, malformedHash), false);
    }
});
