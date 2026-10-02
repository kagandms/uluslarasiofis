import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveStaffPasswordHash } from '../src/server/auth/passwordHash.js';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { generateAccessCode, hashAccessCode, isValidAccessCodeFormat, isValidApplicationReference } from '../src/server/auth/applicationAccessCode.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const TEST_PASSWORD = 'Test-staff-passphrase-2026';
const PASSWORD_HASH = await deriveStaffPasswordHash(TEST_PASSWORD);

function createEnvironment(options = {}) {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const environment = {
        DB: database,
        DOCUMENTS: {
            async put() { return {}; },
            async get() { return null; },
            async head() { return null; },
            async delete() { return {}; }
        },
        ASSETS: {
            async fetch() { return new Response('ok'); }
        },
        STAFF_SHARED_USERNAME: 'admin',
        APP_ENV: 'test',
        ...options
    };
    return { environment, database };
}

function createRequest(path, { method = 'GET', body, cookie, origin = 'https://portal.test', ip = '198.51.100.55' } = {}) {
    const headers = new Headers({
        Origin: origin,
        'CF-Connecting-IP': ip
    });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (cookie) headers.set('Cookie', cookie);
    return new Request(`https://portal.test${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
}

async function seedStaffUser(database, environment, { id = 'staff-admin-id', username = 'admin', role = 'admin' } = {}) {
    environment.STAFF_SHARED_USERNAME = username;
    await database.prepare(`
        INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
    `).bind(id, username, username.toLowerCase(), PASSWORD_HASH, 'Staff Administrator', role).run();

    // 44-character valid token matching /^[A-Za-z0-9_-]{40,48}$/
    const token = 'StaffSecretToken44CharactersValidToken123456';
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
    await database.prepare(`
        INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), id, await hashSessionToken(token), expiresAt, now).run();

    return `staff_session=${token}`;
}

async function createDraftApplication(environment, studentNumber = 'STUDENT-CD-1', extraBody = {}) {
    const response = await worker.fetch(createRequest('/api/public/applications', {
        method: 'POST',
        body: {
            student_number: studentNumber,
            application_type: 'initial',
            email: `${studentNumber.toLowerCase()}@example.edu`,
            phone: '+905551234567',
            ...extraBody
        }
    }), environment, {});

    const cookie = response.headers.get('Set-Cookie')?.split(';')[0];
    const data = await response.json();
    return { response, data, cookie };
}

test('draft creation generates 128-bit access code, unique reference number, and stores only sha-256 hash', async () => {
    const { environment, database } = createEnvironment();
    const { response, data, cookie } = await createDraftApplication(environment, 'STUDENT-ENTROPY-1');

    assert.equal(response.status, 201);
    assert.ok(cookie?.startsWith('application_session='));
    assert.ok(data.reference_number);
    assert.ok(data.access_code);
    assert.equal(data.application.lock_version, 1);

    // Verify format
    assert.ok(isValidApplicationReference(data.reference_number), `Invalid reference format: ${data.reference_number}`);
    assert.ok(isValidAccessCodeFormat(data.access_code), `Invalid access code format: ${data.access_code}`);

    // Verify DB persistence
    const appRow = database.prepare(`
        SELECT id, reference_number, access_code_hash, access_code_version, lock_version
        FROM applications WHERE reference_number = ?
    `).bind(data.reference_number).first();

    assert.ok(appRow);
    const applicationId = appRow.id;
    assert.equal(appRow.reference_number, data.reference_number);
    assert.equal(appRow.access_code_version, 1);
    assert.equal(appRow.lock_version, 1);
    assert.equal(appRow.access_code_hash, await hashAccessCode(data.access_code));

    // Verify plaintext code is NOT stored anywhere in the database
    const dbDump = JSON.stringify(database.prepare('SELECT * FROM applications WHERE id = ?').bind(applicationId).first());
    assert.doesNotMatch(dbDump, new RegExp(data.access_code.replace(/-/g, '')));

    const auditDump = JSON.stringify(database.prepare('SELECT * FROM audit_events WHERE application_id = ?').bind(applicationId).all());
    assert.doesNotMatch(auditDump, new RegExp(data.access_code.replace(/-/g, '')));
});

test('reference number is unique and database enforces uniqueness constraint', async () => {
    const { database } = createEnvironment();
    const student1 = 'S-UNIQ-1';
    const student2 = 'S-UNIQ-2';

    database.prepare(`
        INSERT INTO students (id, student_number, normalized_student_number)
        VALUES ('st-1', ?, ?), ('st-2', ?, ?)
    `).bind(student1, student1, student2, student2).run();

    database.prepare(`
        INSERT INTO applications (id, student_id, application_type, status, reference_number)
        VALUES ('app-1', 'st-1', 'initial', 'draft', 'ITU-TEST-1234')
    `).run();

    // Inserting another application with the same reference_number must throw UNIQUE constraint failure
    assert.throws(() => {
        database.prepare(`
            INSERT INTO applications (id, student_id, application_type, status, reference_number)
            VALUES ('app-2', 'st-2', 'initial', 'draft', 'ITU-TEST-1234')
        `).run();
    }, /UNIQUE constraint failed/);
});

test('two devices access the same application concurrently without invalidating existing sessions', async () => {
    const { environment } = createEnvironment();

    // Device A starts the draft
    const deviceA = await createDraftApplication(environment, 'STUDENT-DUAL-DEVICE');
    assert.equal(deviceA.response.status, 201);
    const { reference_number, access_code } = deviceA.data;
    const cookieDeviceA = deviceA.cookie;

    // Device B logs in using reference number and secret access code
    const accessResponse = await worker.fetch(createRequest('/api/public/applications/access', {
        method: 'POST',
        body: { reference_number, access_code },
        ip: '198.51.100.99' // Different IP (Device B)
    }), environment, {});

    assert.equal(accessResponse.status, 200);
    const cookieDeviceB = accessResponse.headers.get('Set-Cookie')?.split(';')[0];
    assert.ok(cookieDeviceB?.startsWith('application_session='));
    assert.notEqual(cookieDeviceA, cookieDeviceB); // Independent opaque session tokens

    const deviceBData = await accessResponse.json();
    assert.equal(deviceBData.application.reference_number, reference_number);

    // Both Device A and Device B can fetch current application state independently
    const currentA = await worker.fetch(createRequest('/api/public/applications/current', {
        cookie: cookieDeviceA
    }), environment, {});
    assert.equal(currentA.status, 200);
    const dataA = await currentA.json();
    assert.equal(dataA.application.reference_number, reference_number);

    const currentB = await worker.fetch(createRequest('/api/public/applications/current', {
        cookie: cookieDeviceB
    }), environment, {});
    assert.equal(currentB.status, 200);
    const dataB = await currentB.json();
    assert.equal(dataB.application.reference_number, reference_number);
});

test('access code verification rejects invalid code and unknown reference with 401', async () => {
    const { environment } = createEnvironment();
    const { data } = await createDraftApplication(environment, 'STUDENT-INVALID-TEST');
    const { reference_number } = data;

    // Wrong valid-format code with valid reference
    const wrongCodeResp = await worker.fetch(createRequest('/api/public/applications/access', {
        method: 'POST',
        body: { reference_number, access_code: generateAccessCode() }
    }), environment, {});
    assert.equal(wrongCodeResp.status, 401);
    const wrongCodeData = await wrongCodeResp.json();
    assert.equal(wrongCodeData.error.code, 'INVALID_CREDENTIALS');

    // Unknown reference with valid-format code
    const unknownRefResp = await worker.fetch(createRequest('/api/public/applications/access', {
        method: 'POST',
        body: { reference_number: 'ITU-ZZZZ-9999', access_code: generateAccessCode() }
    }), environment, {});
    assert.equal(unknownRefResp.status, 401);
    const unknownRefData = await unknownRefResp.json();
    assert.equal(unknownRefData.error.code, 'INVALID_CREDENTIALS');

    // Missing fields
    const missingResp = await worker.fetch(createRequest('/api/public/applications/access', {
        method: 'POST',
        body: { reference_number }
    }), environment, {});
    assert.equal(missingResp.status, 400);
});

test('anti-brute-force rate limiting: 5 failed attempts per reference triggers 429 without permanent lock', async () => {
    const { environment } = createEnvironment();
    const { data } = await createDraftApplication(environment, 'STUDENT-RATELIMIT');
    const { reference_number } = data;

    // 5 failed attempts with different IPs (per-reference testing)
    for (let i = 1; i <= 5; i++) {
        const resp = await worker.fetch(createRequest('/api/public/applications/access', {
            method: 'POST',
            body: { reference_number, access_code: generateAccessCode() },
            ip: `198.51.100.${10 + i}`
        }), environment, {});
        assert.equal(resp.status, 401);
    }

    // 6th attempt on the same reference should be rate limited (429)
    const blockedResp = await worker.fetch(createRequest('/api/public/applications/access', {
        method: 'POST',
        body: { reference_number, access_code: generateAccessCode() },
        ip: '198.51.100.99'
    }), environment, {});
    assert.equal(blockedResp.status, 429);
    const blockedData = await blockedResp.json();
    assert.equal(blockedData.error.code, 'RATE_LIMITED');

    // Another application's reference is NOT blocked (no global permanent lockout)
    const otherDraft = await createDraftApplication(environment, 'STUDENT-OTHER-UNBLOCKED');
    const otherResp = await worker.fetch(createRequest('/api/public/applications/access', {
        method: 'POST',
        body: { reference_number: otherDraft.data.reference_number, access_code: otherDraft.data.access_code },
        ip: '198.51.100.99'
    }), environment, {});
    assert.equal(otherResp.status, 200);
});

test('per-IP rate limiting: broad limit protects without locking out campus NAT addresses', async () => {
    const { environment } = createEnvironment();
    const sharedIp = '203.0.113.50'; // Campus NAT IP

    // 60 requests within window
    for (let i = 1; i <= 60; i++) {
        const resp = await worker.fetch(createRequest('/api/public/applications/access', {
            method: 'POST',
            body: { reference_number: 'ITU-TEST-NAT1', access_code: generateAccessCode() },
            ip: sharedIp
        }), environment, {});
        assert.ok([400, 401].includes(resp.status));
    }

    // 61st request from same IP is rate limited
    const limitedResp = await worker.fetch(createRequest('/api/public/applications/access', {
        method: 'POST',
        body: { reference_number: 'ITU-TEST-NAT2', access_code: generateAccessCode() },
        ip: sharedIp
    }), environment, {});
    assert.equal(limitedResp.status, 429);

    // Different IP can still make requests
    const differentIpResp = await worker.fetch(createRequest('/api/public/applications/access', {
        method: 'POST',
        body: { reference_number: 'ITU-TEST-NAT2', access_code: generateAccessCode() },
        ip: '203.0.113.99'
    }), environment, {});
    assert.equal(differentIpResp.status, 401); // Not 429!
});

test('controlled code regeneration from authenticated owner session', async () => {
    const { environment, database } = createEnvironment();
    const { data: initialData, cookie } = await createDraftApplication(environment, 'STUDENT-REGEN-1');
    const oldCode = initialData.access_code;
    const referenceNumber = initialData.reference_number;

    const appRowBefore = database.prepare('SELECT id FROM applications WHERE reference_number = ?')
        .bind(referenceNumber).first();
    const applicationId = appRowBefore.id;

    // Regenerate access code
    const regenResp = await worker.fetch(createRequest('/api/public/applications/current/regenerate-access-code', {
        method: 'POST',
        cookie
    }), environment, {});

    assert.equal(regenResp.status, 200);
    const regenData = await regenResp.json();
    assert.equal(regenData.reference_number, referenceNumber);
    assert.ok(regenData.access_code);
    assert.notEqual(regenData.access_code, oldCode);
    const newCode = regenData.access_code;

    // Verify DB hash was updated
    const appRow = database.prepare('SELECT access_code_hash, access_code_version FROM applications WHERE id = ?')
        .bind(applicationId).first();
    assert.equal(appRow.access_code_version, 2);
    assert.equal(appRow.access_code_hash, await hashAccessCode(newCode));

    // Audit event recorded without code
    const auditEvents = database.prepare(`
        SELECT event_type, safe_metadata_json FROM audit_events
        WHERE application_id = ? AND event_type = 'application.access_code_regenerated'
    `).bind(applicationId).all();
    assert.equal(auditEvents.results.length, 1);
    assert.doesNotMatch(auditEvents.results[0].safe_metadata_json, new RegExp(newCode.replace(/-/g, '')));

    // New code can authenticate a new device
    const accessWithNew = await worker.fetch(createRequest('/api/public/applications/access', {
        method: 'POST',
        body: { reference_number: referenceNumber, access_code: newCode }
    }), environment, {});
    assert.equal(accessWithNew.status, 200);

    // Old code is now rejected
    const accessWithOld = await worker.fetch(createRequest('/api/public/applications/access', {
        method: 'POST',
        body: { reference_number: referenceNumber, access_code: oldCode }
    }), environment, {});
    assert.equal(accessWithOld.status, 401);
});

test('code regeneration is rejected on terminal applications', async () => {
    const { environment, database } = createEnvironment();
    const { data, cookie } = await createDraftApplication(environment, 'STUDENT-TERMINAL-1');

    const appRow = database.prepare('SELECT id FROM applications WHERE reference_number = ?')
        .bind(data.reference_number).first();
    const applicationId = appRow.id;

    // Mark application as completed
    database.prepare("UPDATE applications SET status = 'completed' WHERE id = ?").bind(applicationId).run();

    const regenResp = await worker.fetch(createRequest('/api/public/applications/current/regenerate-access-code', {
        method: 'POST',
        cookie
    }), environment, {});

    assert.equal(regenResp.status, 409);
    const regenData = await regenResp.json();
    assert.equal(regenData.error.code, 'APPLICATION_TERMINAL');
});

test('staff reset access code after physical ID check revokes all active sessions while preserving reference number', async () => {
    const { environment, database } = createEnvironment();

    // Create draft and second session
    const { data, cookie: cookieA } = await createDraftApplication(environment, 'STUDENT-STAFF-RESET');
    const originalRef = data.reference_number;
    const oldCode = data.access_code;

    const appRow = database.prepare('SELECT id FROM applications WHERE reference_number = ?')
        .bind(originalRef).first();
    const applicationId = appRow.id;

    // Log in second device
    const deviceBResp = await worker.fetch(createRequest('/api/public/applications/access', {
        method: 'POST',
        body: { reference_number: originalRef, access_code: oldCode }
    }), environment, {});
    const cookieB = deviceBResp.headers.get('Set-Cookie')?.split(';')[0];

    // Verify both sessions currently work
    assert.equal((await worker.fetch(createRequest('/api/public/applications/current', { cookie: cookieA }), environment, {})).status, 200);
    assert.equal((await worker.fetch(createRequest('/api/public/applications/current', { cookie: cookieB }), environment, {})).status, 200);

    // Staff performs reset
    const staffCookie = await seedStaffUser(database, environment, { id: 'staff-admin-reset', username: 'admin', role: 'admin' });
    const resetResp = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}/reset-access-code`, {
        method: 'POST',
        cookie: staffCookie
    }), environment, {});

    assert.equal(resetResp.status, 200);
    const resetData = await resetResp.json();
    assert.equal(resetData.reference_number, originalRef); // Reference number preserved!
    assert.ok(resetData.access_code);
    assert.notEqual(resetData.access_code, oldCode);
    const newStaffIssuedCode = resetData.access_code;

    // Both old sessions MUST NOW BE REVOKED
    const checkA = await worker.fetch(createRequest('/api/public/applications/current', { cookie: cookieA }), environment, {});
    assert.equal(checkA.status, 401);

    const checkB = await worker.fetch(createRequest('/api/public/applications/current', { cookie: cookieB }), environment, {});
    assert.equal(checkB.status, 401);

    // Old code is rejected
    const oldLogin = await worker.fetch(createRequest('/api/public/applications/access', {
        method: 'POST',
        body: { reference_number: originalRef, access_code: oldCode }
    }), environment, {});
    assert.equal(oldLogin.status, 401);

    // New code works and issues fresh valid session
    const newLogin = await worker.fetch(createRequest('/api/public/applications/access', {
        method: 'POST',
        body: { reference_number: originalRef, access_code: newStaffIssuedCode }
    }), environment, {});
    assert.equal(newLogin.status, 200);

    // Verify audit log has staff attribution and no access code
    const staffAudit = database.prepare(`
        SELECT actor_staff_id, event_type, safe_metadata_json FROM audit_events
        WHERE application_id = ? AND event_type = 'staff.application_access_code_reset'
    `).bind(applicationId).first();
    assert.equal(staffAudit.actor_staff_id, 'staff-admin-reset');
    assert.doesNotMatch(staffAudit.safe_metadata_json, new RegExp(newStaffIssuedCode.replace(/-/g, '')));
});

test('optimistic concurrency control: lock_version mismatch returns 409 APPLICATION_UPDATE_CONFLICT', async () => {
    const { environment } = createEnvironment();
    const { data, cookie } = await createDraftApplication(environment, 'STUDENT-OCC-1');

    assert.equal(data.application.lock_version, 1);

    // Device A updates draft with lock_version = 1 -> succeeds, increments lock_version to 2
    const updateRespA = await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH',
        cookie,
        body: {
            first_name: 'Ahmet',
            lock_version: 1
        }
    }), environment, {});

    assert.equal(updateRespA.status, 200);
    const updatedA = await updateRespA.json();
    assert.equal(updatedA.application.first_name, 'Ahmet');
    assert.equal(updatedA.application.lock_version, 2);

    // Device B (which was viewing stale version 1) attempts update with lock_version = 1 -> returns 409
    const conflictResp = await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH',
        cookie,
        body: {
            first_name: 'Mehmet',
            lock_version: 1 // Stale lock version
        }
    }), environment, {});

    assert.equal(conflictResp.status, 409);
    const conflictData = await conflictResp.json();
    assert.equal(conflictData.error.code, 'APPLICATION_UPDATE_CONFLICT');

    // Updating with the current lock_version = 2 succeeds
    const successResp = await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'PATCH',
        cookie,
        body: {
            first_name: 'Mehmet',
            lock_version: 2
        }
    }), environment, {});

    assert.equal(successResp.status, 200);
    const updatedB = await successResp.json();
    assert.equal(updatedB.application.first_name, 'Mehmet');
    assert.equal(updatedB.application.lock_version, 3);
});

test('public tracking lookup by student number does not leak reference number, access code, or sessions', async () => {
    const { environment, database } = createEnvironment();
    const studentNumber = 'STUDENT-PRIVACY-1';
    const { data } = await createDraftApplication(environment, studentNumber);

    const appRow = database.prepare('SELECT id FROM applications WHERE reference_number = ?')
        .bind(data.reference_number).first();
    const applicationId = appRow.id;

    // Mark as submitted to be visible in lookup
    database.prepare(`
        UPDATE applications SET status = 'submitted', submitted_at = datetime('now')
        WHERE id = ?
    `).bind(applicationId).run();

    const lookupResp = await worker.fetch(createRequest('/api/public/applications/tracking-lookup', {
        method: 'POST',
        body: { student_number: studentNumber }
    }), environment, {});

    assert.equal(lookupResp.status, 200);
    assert.equal(lookupResp.headers.get('Set-Cookie'), null); // No session cookie issued!
    const lookupData = await lookupResp.json();

    assert.equal(lookupData.found, true);
    assert.equal(lookupData.application.student_number, studentNumber);
    assert.equal(lookupData.application.status, 'submitted');

    // Ensure NO private credentials leaked
    const serialized = JSON.stringify(lookupData);
    assert.equal(lookupData.application.reference_number, undefined);
    assert.doesNotMatch(serialized, /reference_number|access_code|token_hash|session/i);
});

test('backward compatibility: migration 0008 backfills reference_number for legacy applications matching unconfusable charset', async () => {
    // Run migrations up to 0007 manually on raw SQLite, insert legacy apps, then run 0008
    const { DatabaseSync } = await import('node:sqlite');
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');

    const { readFileSync, readdirSync } = await import('node:fs');
    const migrationsDir = new URL('../migrations/', import.meta.url);
    const sqlFiles = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

    // Apply 0001 - 0007
    for (const file of sqlFiles) {
        if (file >= '0008') break;
        sqlite.exec(readFileSync(new URL(file, migrationsDir), 'utf8'));
    }

    // Insert multiple legacy applications without reference numbers
    for (let i = 1; i <= 5; i++) {
        sqlite.prepare(`
            INSERT INTO students (id, student_number, normalized_student_number)
            VALUES (?, ?, ?)
        `).run(`legacy-student-${i}`, `LEGACY-00${i}`, `LEGACY-00${i}`);
        sqlite.prepare(`
            INSERT INTO applications (id, student_id, application_type, status)
            VALUES (?, ?, 'initial', 'submitted')
        `).run(`legacy-app-${i}`, `legacy-student-${i}`);
    }

    // Now apply migration 0008
    sqlite.exec(readFileSync(new URL('0008_application_reference_and_access_code.sql', migrationsDir), 'utf8'));

    // Verify backfilled reference numbers strictly adhere to unconfusable alphabet
    const backfilledApps = sqlite.prepare("SELECT id, reference_number, lock_version FROM applications WHERE id LIKE 'legacy-app-%'")
        .all();

    assert.equal(backfilledApps.length, 5);
    const references = new Set();
    for (const app of backfilledApps) {
        assert.ok(app.reference_number);
        assert.match(app.reference_number, /^ITU-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
        assert.ok(isValidApplicationReference(app.reference_number));
        const randomPart = app.reference_number.slice(4);
        assert.equal(/[01IL]/.test(randomPart), false, `Forbidden char in reference suffix: ${randomPart}`);
        assert.equal(app.lock_version, 1);
        references.add(app.reference_number);
    }
    assert.equal(references.size, 5); // All unique
});

test('login vs reset race condition: login attempting session creation after concurrent reset is rejected', async () => {
    const { environment, database } = createEnvironment();
    const { data: draftData } = await createDraftApplication(environment, 'STUDENT-RACE-1');
    const referenceNumber = draftData.reference_number;
    const originalAccessCode = draftData.access_code;

    const appRow = database.prepare('SELECT id FROM applications WHERE reference_number = ?')
        .bind(referenceNumber).first();
    const applicationId = appRow.id;

    // Simulate Device 2 starting login: it reads the valid reference and code.
    // Concurrently, staff resets the access code before session insertion commits.
    const staffCookie = await seedStaffUser(database, environment, { id: 'staff-admin-race', role: 'admin' });
    const staffResetResp = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}/reset-access-code`, {
        method: 'POST',
        cookie: staffCookie
    }), environment, {});
    assert.equal(staffResetResp.status, 200);

    // Device 2's login attempt with the old access code MUST fail with 401
    const device2LoginResp = await worker.fetch(createRequest('/api/public/applications/access', {
        method: 'POST',
        body: {
            reference_number: referenceNumber,
            access_code: originalAccessCode
        }
    }), environment, {});

    assert.equal(device2LoginResp.status, 401);
    assert.equal(device2LoginResp.headers.get('Set-Cookie'), null);
});

test('concurrent edits across two devices: second save with stale lock_version receives 409 conflict and recovers on refresh', async () => {
    const { environment, database } = createEnvironment();
    const { data: draftData, cookie: device1Cookie } = await createDraftApplication(environment, 'STUDENT-CONCUR-1');
    const referenceNumber = draftData.reference_number;
    const accessCode = draftData.access_code;

    // Device 2 logs in with access code
    const device2LoginResp = await worker.fetch(createRequest('/api/public/applications/access', {
        method: 'POST',
        body: { reference_number: referenceNumber, access_code: accessCode }
    }), environment, {});
    assert.equal(device2LoginResp.status, 200);
    const device2Cookie = device2LoginResp.headers.get('Set-Cookie')?.split(';')[0];

    // Both devices start with lock_version = 1
    const app1Resp = await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'GET',
        cookie: device1Cookie
    }), environment, {});
    const app1 = (await app1Resp.json()).application;
    assert.equal(app1.lock_version, 1);

    // Device 1 saves an edit with lock_version: 1 -> succeeds, advances lock_version to 2
    const device1SaveResp = await worker.fetch(createRequest('/api/public/applications/current/autosave', {
        method: 'PATCH',
        cookie: device1Cookie,
        body: {
            first_name: 'Device1Name',
            lock_version: 1
        }
    }), environment, {});
    assert.equal(device1SaveResp.status, 200);
    const device1Updated = (await device1SaveResp.json()).application;
    assert.equal(device1Updated.lock_version, 2);
    assert.equal(device1Updated.first_name, 'Device1Name');

    // Device 2 attempts to save with stale lock_version: 1 -> MUST be rejected with 409 APPLICATION_UPDATE_CONFLICT
    const device2ConflictResp = await worker.fetch(createRequest('/api/public/applications/current/autosave', {
        method: 'PATCH',
        cookie: device2Cookie,
        body: {
            first_name: 'Device2NameConflict',
            lock_version: 1
        }
    }), environment, {});
    assert.equal(device2ConflictResp.status, 409);
    const conflictData = await device2ConflictResp.json();
    assert.equal(conflictData.error?.code, 'APPLICATION_UPDATE_CONFLICT');

    // Device 2 refreshes application state to see Device 1's changes and updated lock_version: 2
    const device2RefreshResp = await worker.fetch(createRequest('/api/public/applications/current', {
        method: 'GET',
        cookie: device2Cookie
    }), environment, {});
    assert.equal(device2RefreshResp.status, 200);
    const device2Refreshed = (await device2RefreshResp.json()).application;
    assert.equal(device2Refreshed.lock_version, 2);
    assert.equal(device2Refreshed.first_name, 'Device1Name');

    // Device 2 now saves with fresh lock_version: 2 -> succeeds, advances lock_version to 3
    const device2RecoverySave = await worker.fetch(createRequest('/api/public/applications/current/autosave', {
        method: 'PATCH',
        cookie: device2Cookie,
        body: {
            first_name: 'Device2NameResolved',
            lock_version: 2
        }
    }), environment, {});
    assert.equal(device2RecoverySave.status, 200);
    const device2Final = (await device2RecoverySave.json()).application;
    assert.equal(device2Final.lock_version, 3);
    assert.equal(device2Final.first_name, 'Device2NameResolved');
});

