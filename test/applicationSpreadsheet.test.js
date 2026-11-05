import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';
import worker from '../src/server/worker.js';

const TOKEN = 'spreadsheet-session-token-0000000000000000';
const todaySheetName = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul' }).format(new Date()).replaceAll('/', '.');

function setup() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    return { database, environment: { DB: database, APP_ENV: 'test', STAFF_SHARED_USERNAME: 'reviewer-1' } };
}

function request(path, { method = 'GET', body, cookie, origin = 'https://portal.test' } = {}) {
    const headers = new Headers({ Origin: origin });
    if (cookie) headers.set('Cookie', cookie);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    return new Request(`https://portal.test${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
}

async function seedStaff(database) {
    await database.prepare(`INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES ('reviewer-1', 'reviewer-1', 'reviewer-1', 'test-hash', 'Reviewer', 'reviewer')`).run();
    await database.prepare(`INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at)
        VALUES ('session-1', 'reviewer-1', ?, ?)`)
        .bind(await hashSessionToken(TOKEN), new Date(Date.now() + 60_000).toISOString()).run();
    return `staff_session=${TOKEN}`;
}

async function seedApplication(database, { id, status = 'submitted', passport = '0012345',
    submittedAt = new Date().toISOString(), updatedAt = new Date().toISOString() } = {}) {
    const applicationId = id || crypto.randomUUID();
    await database.prepare(`INSERT INTO students (id, student_number, normalized_student_number)
        VALUES (?, ?, ?)`)
        .bind(`student-${applicationId}`, `STU-${applicationId}`, `STU-${applicationId}`).run();
    await database.prepare(`INSERT INTO applications (id, student_id, application_type, status, first_name, last_name, passport_number, submitted_at, updated_at)
        VALUES (?, ?, 'initial', ?, 'Ada', 'Student', ?, ?, ?)`)
        .bind(applicationId, `student-${applicationId}`, status, passport, status === 'draft' ? null : submittedAt, updatedAt).run();
    return applicationId;
}

test('spreadsheet transfer rejects unauthenticated and cross-origin requests', async () => {
    const { environment, database } = setup();
    const applicationId = await seedApplication(database);
    const path = `/api/staff/applications/${applicationId}/spreadsheet`;

    const unauthenticated = await worker.fetch(request(path, { method: 'POST', body: { action: 'add' } }), environment);
    const crossOrigin = await worker.fetch(request(path, {
        method: 'POST', cookie: await seedStaff(database), origin: 'https://attacker.test', body: { action: 'add' }
    }), environment);

    assert.equal(unauthenticated.status, 401);
    assert.equal(crossOrigin.status, 403);
});

test('spreadsheet transfer rejects drafts before calling Apps Script', async () => {
    const { environment, database } = setup();
    const applicationId = await seedApplication(database, { status: 'draft' });
    const cookie = await seedStaff(database);

    const response = await worker.fetch(request(`/api/staff/applications/${applicationId}/spreadsheet`, {
        method: 'POST', cookie, body: { action: 'add' }
    }), environment);

    assert.equal(response.status, 404);
    assert.equal(environment.appsScriptCalls, undefined);
});

test('spreadsheet add targets today even when the application was last updated on an earlier date', async () => {
    const { environment, database } = setup();
    const submittedAt = '2026-10-26T11:53:00.000Z';
    const updatedAt = '2026-10-27T08:26:00.000Z';
    const applicationId = await seedApplication(database, { submittedAt, updatedAt });
    const cookie = await seedStaff(database);
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
        const payload = JSON.parse(options.body);
        calls.push(payload);
        return new Response(JSON.stringify({
            success: true, state: 'present', sheetName: payload.targetSheetName, recordKey: applicationId
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    environment.APPS_SCRIPT_URL = 'https://script.google.com/macros/s/test/exec';
    environment.APPS_SCRIPT_API_KEY = 'test-key';

    try {
        const response = await worker.fetch(request(`/api/staff/applications/${applicationId}/spreadsheet`, {
            method: 'POST', cookie, body: { action: 'add' }
        }), environment);
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.deepEqual({ state: result.state, sheetName: result.sheetName }, { state: 'present', sheetName: todaySheetName });
        assert.deepEqual({ action: calls[0].action, applicationId: calls[0].applicationId,
            verifyExisting: calls[0].verifyExisting,
            firstName: calls[0].firstName, lastName: calls[0].lastName, passportNumber: calls[0].passportNumber,
            targetSheetName: calls[0].targetSheetName, submittedAt: calls[0].submittedAt }, {
            action: 'residenceAdd', applicationId, verifyExisting: 'false',
            firstName: 'Ada', lastName: 'Student', passportNumber: '0012345', targetSheetName: todaySheetName,
            submittedAt: undefined
        });
        assert.equal(database.prepare('SELECT state FROM application_spreadsheet_records WHERE application_id=?')
            .bind(applicationId).first().state, 'present');
        const queue = await worker.fetch(request('/api/staff/applications/query', {
            method: 'POST', cookie, body: { q: `STU-${applicationId}` }
        }), environment);
        assert.deepEqual((await queue.json()).items[0].spreadsheet, { state: 'present', sheetName: todaySheetName });
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('spreadsheet add does not confirm an Apps Script response for a different date', async () => {
    const { environment, database } = setup();
    const applicationId = await seedApplication(database);
    const cookie = await seedStaff(database);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
        success: true, state: 'present', sheetName: '27.10.2026', recordKey: applicationId
    }));
    environment.APPS_SCRIPT_URL = 'https://script.google.com/macros/s/test/exec';
    environment.APPS_SCRIPT_API_KEY = 'test-key';

    try {
        const response = await worker.fetch(request(`/api/staff/applications/${applicationId}/spreadsheet`, {
            method: 'POST', cookie, body: { action: 'add' }
        }), environment);
        assert.equal(response.status, 502);
        assert.equal(database.prepare('SELECT state FROM application_spreadsheet_records WHERE application_id=?')
            .bind(applicationId).first().state, 'pending_add');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('an ambiguous spreadsheet response remains pending and a retry reconciles it with the same key', async () => {
    const { environment, database } = setup();
    const applicationId = await seedApplication(database);
    const cookie = await seedStaff(database);
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
        const payload = JSON.parse(options.body);
        calls.push(payload);
        if (calls.length === 1) throw new Error('upstream response lost');
        return new Response(JSON.stringify({ success: true, state: 'present', sheetName: payload.targetSheetName, recordKey: applicationId }), { status: 200 });
    };
    environment.APPS_SCRIPT_URL = 'https://script.google.com/macros/s/test/exec';
    environment.APPS_SCRIPT_API_KEY = 'test-key';

    try {
        const path = `/api/staff/applications/${applicationId}/spreadsheet`;
        const first = await worker.fetch(request(path, { method: 'POST', cookie, body: { action: 'add' } }), environment);
        const pending = database.prepare('SELECT state, operation_id, record_key FROM application_spreadsheet_records WHERE application_id=?')
            .bind(applicationId).first();
        assert.equal(first.status, 502);
        assert.equal(pending.state, 'pending_add');
        const queue = await worker.fetch(request('/api/staff/applications/query', {
            method: 'POST', cookie, body: { q: `STU-${applicationId}` }
        }), environment);
        assert.deepEqual((await queue.json()).items[0].spreadsheet, { state: 'pending', action: 'add' });
        const second = await worker.fetch(request(path, { method: 'POST', cookie, body: { action: 'add' } }), environment);
        assert.equal(second.status, 200);
        assert.equal(calls[0].verifyExisting, 'false');
        assert.equal(calls[1].verifyExisting, 'true');
        assert.equal(calls[1].recordKey, pending.record_key);
        assert.equal(database.prepare('SELECT state FROM application_spreadsheet_records WHERE application_id=?')
            .bind(applicationId).first().state, 'present');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('spreadsheet upstream failures log safe diagnostic codes without applicant data', async t => {
    const { environment, database } = setup();
    const applicationId = await seedApplication(database);
    const cookie = await seedStaff(database);
    const originalFetch = globalThis.fetch;
    const warnings = [];
    t.mock.method(console, 'warn', (...args) => warnings.push(args));
    globalThis.fetch = async () => new Response(JSON.stringify({ success: false, error: 'Yetkisiz erisim' }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
    });
    environment.APPS_SCRIPT_URL = 'https://script.google.com/macros/s/test/exec';
    environment.APPS_SCRIPT_API_KEY = 'test-key';

    try {
        const response = await worker.fetch(request(`/api/staff/applications/${applicationId}/spreadsheet`, {
            method: 'POST', cookie, body: { action: 'add' }
        }), environment);

        assert.equal(response.status, 502);
        assert.deepEqual(warnings, [[ 'Apps Script spreadsheet transfer failed.', {
            action: 'add', code: 'UPSTREAM_FAILURE', reason: 'UNAUTHORIZED'
        } ]]);
        assert.equal(JSON.stringify(warnings).includes(applicationId), false);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('an ambiguous remove remains pending and a retry confirms the row is absent', async () => {
    const { environment, database } = setup();
    const applicationId = await seedApplication(database);
    const cookie = await seedStaff(database);
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
        const payload = JSON.parse(options.body);
        calls.push(payload);
        if (calls.length === 1) return new Response(JSON.stringify({
            success: true, state: 'present', sheetName: payload.targetSheetName, recordKey: payload.recordKey
        }));
        if (calls.length === 2) throw new Error('upstream response lost');
        return new Response(JSON.stringify({ success: true, state: 'absent', recordKey: payload.recordKey }));
    };
    environment.APPS_SCRIPT_URL = 'https://script.google.com/macros/s/test/exec';
    environment.APPS_SCRIPT_API_KEY = 'test-key';

    try {
        const path = `/api/staff/applications/${applicationId}/spreadsheet`;
        const transfer = action => worker.fetch(request(path, { method: 'POST', cookie, body: { action } }), environment);
        assert.equal((await transfer('add')).status, 200);
        assert.equal((await transfer('remove')).status, 502);
        const pending = database.prepare('SELECT state, operation_id, record_key FROM application_spreadsheet_records WHERE application_id=?')
            .bind(applicationId).first();
        assert.equal(pending.state, 'pending_remove');
        const queue = await worker.fetch(request('/api/staff/applications/query', {
            method: 'POST', cookie, body: { q: `STU-${applicationId}` }
        }), environment);
        assert.deepEqual((await queue.json()).items[0].spreadsheet, { state: 'pending', action: 'remove' });

        assert.equal((await transfer('remove')).status, 200);
        assert.deepEqual(calls.slice(1).map(call => [call.action, call.recordKey]), [
            ['residenceRemove', applicationId], ['residenceRemove', pending.record_key]
        ]);
        assert.deepEqual(calls.slice(1).map(call => call.sheetName), [todaySheetName, todaySheetName]);
        assert.equal(database.prepare('SELECT state FROM application_spreadsheet_records WHERE application_id=?')
            .bind(applicationId).first().state, 'absent');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('same-name applications use separate transfer keys and remove the stored row after the date changes', async () => {
    const { environment, database } = setup();
    const firstId = await seedApplication(database);
    const secondId = await seedApplication(database);
    await database.prepare("UPDATE applications SET first_name='Ada', last_name='Student' WHERE id IN (?, ?)")
        .bind(firstId, secondId).run();
    const cookie = await seedStaff(database);
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
        const payload = JSON.parse(options.body);
        calls.push(payload);
        return new Response(JSON.stringify(payload.action === 'residenceRemove'
            ? { success: true, state: 'absent', recordKey: payload.recordKey }
            : { success: true, state: 'present', sheetName: payload.targetSheetName, recordKey: payload.recordKey }));
    };
    environment.APPS_SCRIPT_URL = 'https://script.google.com/macros/s/test/exec';
    environment.APPS_SCRIPT_API_KEY = 'test-key';

    try {
        const transfer = async (id, action) => worker.fetch(request(`/api/staff/applications/${id}/spreadsheet`, {
            method: 'POST', cookie, body: { action }
        }), environment);
        assert.equal((await transfer(firstId, 'add')).status, 200);
        assert.equal((await transfer(secondId, 'add')).status, 200);
        assert.equal((await transfer(firstId, 'remove')).status, 200);
        assert.equal((await transfer(firstId, 'add')).status, 200);

        assert.deepEqual(calls.map(call => [call.action, call.recordKey]), [
            ['residenceAdd', firstId], ['residenceAdd', secondId],
            ['residenceRemove', firstId], ['residenceAdd', firstId]
        ]);
        assert.equal(database.prepare('SELECT state FROM application_spreadsheet_records WHERE application_id=?')
            .bind(firstId).first().state, 'present');
        assert.equal(database.prepare('SELECT status FROM applications WHERE id=?').bind(firstId).first().status, 'submitted');
        assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE application_id=? AND event_type LIKE '%yoksis%'")
            .bind(firstId).first().count, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('concurrent add requests share one idempotency key and both return the confirmed state', async () => {
    const { environment, database } = setup();
    const applicationId = await seedApplication(database);
    const cookie = await seedStaff(database);
    const keys = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
        const payload = JSON.parse(options.body);
        keys.push(payload.recordKey);
        await new Promise(resolve => setTimeout(resolve, 10));
        return new Response(JSON.stringify({ success: true, state: 'present', sheetName: payload.targetSheetName, recordKey: payload.recordKey }));
    };
    environment.APPS_SCRIPT_URL = 'https://script.google.com/macros/s/test/exec';
    environment.APPS_SCRIPT_API_KEY = 'test-key';

    try {
        const path = `/api/staff/applications/${applicationId}/spreadsheet`;
        const [first, second] = await Promise.all([1, 2].map(() => worker.fetch(request(path, {
            method: 'POST', cookie, body: { action: 'add' }
        }), environment)));
        assert.deepEqual([first.status, second.status], [200, 200]);
        assert.deepEqual(keys, [applicationId, applicationId]);
        assert.equal(database.prepare('SELECT COUNT(*) AS count FROM application_spreadsheet_records WHERE application_id=?')
            .bind(applicationId).first().count, 1);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('spreadsheet add rejects a missing passport before calling the upstream service', async () => {
    const { environment, database } = setup();
    const applicationId = await seedApplication(database, { passport: '' });
    const cookie = await seedStaff(database);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('must not call upstream'); };
    environment.APPS_SCRIPT_URL = 'https://script.google.com/macros/s/test/exec';
    environment.APPS_SCRIPT_API_KEY = 'test-key';

    try {
        const response = await worker.fetch(request(`/api/staff/applications/${applicationId}/spreadsheet`, {
            method: 'POST', cookie, body: { action: 'add' }
        }), environment);
        assert.equal(response.status, 409);
        assert.equal((await response.json()).error.code, 'SPREADSHEET_DATA_MISSING');
        assert.equal(database.prepare('SELECT COUNT(*) AS count FROM application_spreadsheet_records').first().count, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('rejected submitted applications can remove an existing spreadsheet row but cannot be added', async () => {
    const { environment, database } = setup();
    const applicationId = await seedApplication(database, { status: 'rejected' });
    const cookie = await seedStaff(database);
    await database.prepare(`INSERT INTO application_spreadsheet_records
        (application_id,record_key,state,sheet_name,operation_id,last_actor_staff,updated_at)
        VALUES(?,?,'present','03.11.2026','operation-1','reviewer-1',?)`)
        .bind(applicationId, applicationId, new Date().toISOString()).run();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ success: true, state: 'absent', recordKey: applicationId }));
    environment.APPS_SCRIPT_URL = 'https://script.google.com/macros/s/test/exec';
    environment.APPS_SCRIPT_API_KEY = 'test-key';

    try {
        const path = `/api/staff/applications/${applicationId}/spreadsheet`;
        const removal = await worker.fetch(request(path, { method: 'POST', cookie, body: { action: 'remove' } }), environment);
        assert.equal(removal.status, 200);
        const add = await worker.fetch(request(path, { method: 'POST', cookie, body: { action: 'add' } }), environment);
        assert.equal(add.status, 404);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
