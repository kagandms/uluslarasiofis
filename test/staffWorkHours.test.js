import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/server/worker.js';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { deriveStaffPasswordHash } from '../src/server/auth/passwordHash.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const SESSION_TOKEN = 'work-hours-session-token-012345678901234567';
const PASSWORD_HASH = await deriveStaffPasswordHash('Work hours test password 2026');

async function createFixture() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    await database.prepare(`INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES ('staff-1', 'test.staff', 'test.staff', ?, 'Test Staff', 'admin')`).bind(PASSWORD_HASH).run();
    await database.prepare(`INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at, last_seen_at)
        VALUES ('session-1', 'staff-1', ?, '2099-01-01T00:00:00.000Z', ?)`).bind(
        await hashSessionToken(SESSION_TOKEN), new Date().toISOString()
    ).run();
    return { database, environment: { DB: database, STAFF_SHARED_USERNAME: 'test.staff' } };
}

function createRequest(path, { method = 'GET', body, hasSession = true, origin = 'https://portal.test' } = {}) {
    const headers = new Headers({ Origin: origin });
    if (hasSession) headers.set('Cookie', `staff_session=${SESSION_TOKEN}`);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    return new Request(`https://portal.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function withFixedDate(isoDate, callback) {
    const NativeDate = globalThis.Date;
    globalThis.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [isoDate])); }
        static now() { return new NativeDate(isoDate).valueOf(); }
    };
    try { return await callback(); }
    finally { globalThis.Date = NativeDate; }
}

test('work hours require an authenticated staff session', async () => {
    const { environment } = await createFixture();
    const response = await worker.fetch(createRequest('/api/staff/work-hours', { hasSession: false }), environment, {});

    assert.equal(response.status, 401);
});

test('work hours return records for the selected day and its month', async () => {
    const { database, environment } = await createFixture();
    await database.prepare(`INSERT INTO staff_work_hours (id, staff_key, work_date, minutes, created_at, updated_at)
        VALUES ('record-1', 'asaf', '2026-10-22', 450, '2026-10-22T10:00:00Z', '2026-10-22T10:00:00Z')`).run();
    const response = await worker.fetch(createRequest('/api/staff/work-hours?date=2026-10-22'), environment, {});
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.selectedDate, '2026-10-22');
    assert.equal(payload.records[0].staff_key, 'asaf');
    assert.equal(payload.records[0].minutes, 450);
});

test('work hours accept boundaries and half-hour values and update the same person-day row', async () => {
    const database = await withFixedDate('2026-10-23T10:00:00.000Z', async () => {
        const { database, environment } = await createFixture();
        for (const minutes of [0, 30, 1440]) {
            const response = await worker.fetch(createRequest('/api/staff/work-hours', {
                method: 'POST', body: { person: 'eyup', minutes }
            }), environment, {});
            assert.equal(response.status, 200);
        }
        return database;
    });

    const rows = database.prepare("SELECT work_date, minutes FROM staff_work_hours WHERE staff_key='eyup'").all().results;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].work_date, '2026-10-23');
    assert.equal(rows[0].minutes, 1440);
});

test('work hours reject invalid values, unknown people, weekends and cross-origin writes', async () => {
    for (const body of [
        { person: 'unknown', minutes: 30 },
        { person: 'asaf', minutes: -30 },
        { person: 'asaf', minutes: 25 },
        { person: 'asaf', minutes: 1470 }
    ]) {
        const { environment } = await createFixture();
        const response = await worker.fetch(createRequest('/api/staff/work-hours', { method: 'POST', body }), environment, {});
        assert.equal(response.status, 400);
    }
    const { environment, database } = await createFixture();
    const crossOrigin = await worker.fetch(createRequest('/api/staff/work-hours', {
        method: 'POST', body: { person: 'asaf', minutes: 30 }, origin: 'https://other.example'
    }), environment, {});
    assert.equal(crossOrigin.status, 403);

    for (const weekendDay of ['2026-10-24T10:00:00.000Z', '2026-10-25T10:00:00.000Z']) {
        const response = await withFixedDate(weekendDay, async () => {
            const { environment: weekendEnvironment } = await createFixture();
            return worker.fetch(createRequest('/api/staff/work-hours', {
                method: 'POST', body: { person: 'asaf', minutes: 30 }
            }), weekendEnvironment, {});
        });
        assert.equal(response.status, 409);
    }
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM staff_work_hours').first().count, 0);
});

test('work hours reject invalid selected dates before querying history', async () => {
    const { environment } = await createFixture();
    for (const date of ['2026-02-30', '2026-13-01', 'not-a-date']) {
        const response = await worker.fetch(createRequest(`/api/staff/work-hours?date=${date}`), environment, {});
        assert.equal(response.status, 400);
    }
});
