import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/server/worker.js';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { deriveStaffPasswordHash } from '../src/server/auth/passwordHash.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const SESSION_TOKEN = 'work-hours-session-token-012345678901234567';
const PASSWORD_HASH = await deriveStaffPasswordHash('Yoksis audit test password 2026');

async function createFixture() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    await database.prepare(`INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES ('staff-1', 'test.staff', 'test.staff', ?, 'Test Staff', 'reviewer')`).bind(PASSWORD_HASH).run();
    await database.prepare(`INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at, last_seen_at)
        VALUES ('session-1', 'staff-1', ?, '2099-01-01T00:00:00.000Z', ?)`).bind(
        await hashSessionToken(SESSION_TOKEN), new Date().toISOString()
    ).run();
    return { database, environment: { DB: database, STAFF_SHARED_USERNAME: 'test.staff' } };
}

function request(path, { body, hasSession = true, origin = 'https://portal.test' } = {}) {
    const headers = new Headers({ Origin: origin, 'Content-Type': 'application/json' });
    if (hasSession) headers.set('Cookie', `staff_session=${SESSION_TOKEN}`);
    return new Request(`https://portal.test/api/staff/yoksis-document-audit/${path}`, {
        method: 'POST', headers, body: JSON.stringify(body)
    });
}

function record(applicationNumber, studentNumber, status, identity = {}) {
    return {
        entry: { applicationNumber, studentNumber },
        result: status === 'verified' ? {
            status,
            identity: {
                applicationNumber, studentNumber, firstName: identity.firstName || 'AYŞE',
                lastName: identity.lastName || 'TEST', phone: '5000000000',
                ...(identity.passportNumber ? { passportNumber: identity.passportNumber } : {})
            },
            applicationStatus: identity.applicationStatus || 'İşlem Tamamlandı',
            documents: []
        } : { status }
    };
}

test('shared YÖKSİS result reads and writes require the authenticated staff session', async () => {
    const { environment } = await createFixture();
    const write = await worker.fetch(request('records', { body: { scanId: 'scan-1', records: [] }, hasSession: false }), environment, {});
    const query = await worker.fetch(request('query', { body: { q: '', status: 'all', page: 1, pageSize: 50 }, hasSession: false }), environment, {});

    assert.equal(write.status, 401);
    assert.equal(query.status, 401);
});

test('shared YÖKSİS records upsert by application and support status, passport search, and pagination', async () => {
    const { database, environment } = await createFixture();
    const saved = await worker.fetch(request('records', { body: {
        scanId: 'scan-1', records: [
            record('2026-00-0000001', '2600000001', 'verified', { firstName: 'AYŞE', passportNumber: 'U12345678' }),
            record('2026-00-0000002', '2600000002', 'verified', { firstName: 'MEHMET', applicationStatus: 'İşlem Bekliyor' }),
            record('2026-00-0000003', '2600000003', 'verified', { firstName: 'SELİN', applicationStatus: 'Reddedildi' }),
            record('2026-00-0000004', '2600000004', 'verified', { firstName: 'ELİF', applicationStatus: 'Eksik Belge Bekliyor' })
        ]
    } }), environment, {});
    assert.equal(saved.status, 200);

    const updated = await worker.fetch(request('records', { body: {
        scanId: 'scan-2', records: [record('2026-00-0000001', '2600000001', 'verified', {
            firstName: 'AYŞE', passportNumber: 'U12345678', applicationStatus: 'İşlem Bekliyor'
        })]
    } }), environment, {});
    assert.equal(updated.status, 200);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM yoksis_document_audit_records').first().count, 4);

    const passportSearch = await worker.fetch(request('query', { body: { q: 'U12345678', status: 'pending', page: 1, pageSize: 1 } }), environment, {});
    const passportPayload = await passportSearch.json();
    assert.equal(passportSearch.status, 200);
    assert.equal(passportPayload.total, 1);
    assert.equal(passportPayload.records[0].passport_number, 'U12345678');
    assert.equal(passportPayload.records[0].application_status, 'İşlem Bekliyor');

    const rejected = await worker.fetch(request('query', { body: { q: 'selin', status: 'rejected', page: 1, pageSize: 10 } }), environment, {});
    assert.equal((await rejected.json()).total, 1);
    const missingDocuments = await worker.fetch(request('query', { body: { q: '', status: 'missing_documents', page: 1, pageSize: 10 } }), environment, {});
    assert.equal((await missingDocuments.json()).total, 1);
});

test('an unreadable retry cannot downgrade an existing verified passport record', async () => {
    const { database, environment } = await createFixture();
    await worker.fetch(request('records', { body: {
        scanId: 'scan-verified', records: [record('2026-00-0000001', '2600000001', 'verified', {
            passportNumber: 'TEST-PASSPORT-1'
        })]
    } }), environment, {});

    const retry = await worker.fetch(request('records', { body: {
        scanId: 'scan-unreadable', records: [record('2026-00-0000001', '2600000001', 'unreadable')]
    } }), environment, {});
    const stored = database.prepare(`SELECT passport_number, result_status FROM yoksis_document_audit_records
        WHERE application_number = '2026-00-0000001'`).first();

    assert.equal(retry.status, 200);
    assert.equal(stored.passport_number, 'TEST-PASSPORT-1');
    assert.equal(stored.result_status, 'verified');
});

test('shared YÖKSİS writes reject cross-origin and malformed records', async () => {
    const { database, environment } = await createFixture();
    const crossOrigin = await worker.fetch(request('records', {
        body: { scanId: 'scan-1', records: [] }, origin: 'https://other.example'
    }), environment, {});
    const malformed = await worker.fetch(request('records', { body: {
        scanId: 'scan-1', records: [record('bad-key', 'not-a-student', 'verified')]
    } }), environment, {});

    assert.equal(crossOrigin.status, 403);
    assert.equal(malformed.status, 400);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM yoksis_document_audit_records').first().count, 0);
});

test('shared YÖKSİS write failures log a safe category without record data', async () => {
    const { database, environment } = await createFixture();
    environment.DB = {
        prepare: database.prepare.bind(database),
        batch: async () => { throw new Error('FOREIGN KEY constraint failed'); }
    };
    const logs = [];
    const originalError = console.error;
    console.error = (...values) => logs.push(values);
    let response;
    try {
        response = await worker.fetch(request('records', { body: {
            scanId: 'scan-diagnostic',
            records: [record('2026-00-0000001', '2600000001', 'verified', { firstName: 'PRIVATE', lastName: 'STUDENT' })]
        } }), environment, {});
    } finally {
        console.error = originalError;
    }

    assert.equal(response.status, 500);
    assert.equal(logs.length, 2);
    assert.deepEqual(logs[0][1], {
        requestId: response.headers.get('X-Request-Id'),
        errorName: 'Error',
        failureKind: 'foreign-key-constraint',
        failureCode: 'UNCLASSIFIED',
        failureDetail: 'FOREIGN KEY constraint failed',
        recordCount: 1
    });
    assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|STUDENT|2600000001/);
});

test('shared YÖKSİS write failures classify D1 causes without logging their messages', async () => {
    const { database, environment } = await createFixture();
    environment.DB = {
        prepare: database.prepare.bind(database),
        batch: async () => {
            throw new Error('D1 operation failed', {
                cause: new Error('D1_ERROR: Network connection lost for 2026-00-0000001 2600000001 U12345678 5000000000 test@example.invalid')
            });
        }
    };
    const logs = [];
    const originalError = console.error;
    console.error = (...values) => logs.push(values);
    try {
        await worker.fetch(request('records', { body: {
            scanId: 'scan-d1-cause', records: [record('2026-00-0000001', '2600000001', 'verified')]
        } }), environment, {});
    } finally {
        console.error = originalError;
    }

    assert.equal(logs[0][1].failureKind, 'database-transient');
    assert.equal(logs[0][1].failureCode, 'D1_ERROR');
    assert.equal(logs[0][1].failureDetail, 'D1 operation failed | D1_ERROR: Network connection lost for [redacted] [redacted] [redacted] [redacted] [redacted]');
    assert.doesNotMatch(JSON.stringify(logs), /2026-00-0000001|2600000001|U12345678|5000000000|test@example\.invalid/);
});
