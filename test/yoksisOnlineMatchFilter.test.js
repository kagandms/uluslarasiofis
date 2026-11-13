import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/server/worker.js';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { deriveStaffPasswordHash } from '../src/server/auth/passwordHash.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const SESSION_TOKEN = 'yoksis-match-session-token-0123456789012345';
const PASSWORD_HASH = await deriveStaffPasswordHash('Yoksis match test password 2026');

async function createFixture() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    await database.prepare(`INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES ('staff-1', 'test.staff', 'test.staff', ?, 'Test Staff', 'reviewer')`).bind(PASSWORD_HASH).run();
    await database.prepare(`INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at, last_seen_at)
        VALUES ('session-1', 'staff-1', ?, '2099-01-01T00:00:00.000Z', ?)`).bind(
        await hashSessionToken(SESSION_TOKEN), new Date().toISOString()
    ).run();
    // Forwarded applications: one matches by full name only, one by student number only; a draft must never match.
    await database.prepare(`INSERT INTO students (id, student_number, normalized_student_number) VALUES
        ('student-name', '99999999', '99999999'), ('student-number', '20260002', '20260002'),
        ('student-draft', '20260003', '20260003')`).run();
    await database.prepare(`INSERT INTO applications (id, student_id, application_type, status, first_name, last_name)
        VALUES ('app-name', 'student-name', 'initial', 'sent_to_migration', 'Ayşe', 'Yılmaz'),
               ('app-number', 'student-number', 'initial', 'migration_approved', 'Farklı', 'İsim'),
               ('app-draft', 'student-draft', 'initial', 'draft', 'Zeynep', 'Kaya')`).run();
    return { database, environment: { DB: database, STAFF_SHARED_USERNAME: 'test.staff' } };
}

function request(path, { body } = {}) {
    const headers = new Headers({ Origin: 'https://portal.test', 'Content-Type': 'application/json' });
    headers.set('Cookie', `staff_session=${SESSION_TOKEN}`);
    return new Request(`https://portal.test/api/staff/yoksis-document-audit/${path}`, {
        method: 'POST', headers, body: JSON.stringify(body)
    });
}

function verifiedRecord(applicationNumber, studentNumber, firstName, lastName) {
    return {
        entry: { applicationNumber, studentNumber },
        result: {
            status: 'verified',
            identity: { applicationNumber, studentNumber, firstName, lastName, phone: '5000000000' },
            applicationStatus: 'İşlem Tamamlandı',
            documents: []
        }
    };
}

async function seedAuditRecords(environment) {
    const response = await worker.fetch(request('records', { body: {
        scanId: 'scan-match-1',
        records: [
            verifiedRecord('2026-01-0000001', '20260001', 'AYŞE', 'YILMAZ'),   // name matches an online application
            verifiedRecord('2026-01-0000002', '20260002', 'MEHMET', 'DEMİR'),  // student number matches
            verifiedRecord('2026-01-0000003', '20260003', 'ZEYNEP', 'KAYA')    // only a draft exists, so it is not matched
        ]
    } }), environment, {});
    assert.equal(response.status, 200);
}

async function queryAudit(environment, body) {
    const response = await worker.fetch(request('query', { body: { q: '', status: 'all', page: 1, pageSize: 50, ...body } }), environment, {});
    assert.equal(response.status, 200);
    return response.json();
}

test('YÖKSİS match filter separates records by online application name or student number', async () => {
    const { environment } = await createFixture();
    await seedAuditRecords(environment);

    const all = await queryAudit(environment, { match: 'all' });
    const matched = await queryAudit(environment, { match: 'matched' });
    const unmatched = await queryAudit(environment, { match: 'unmatched' });

    assert.equal(all.total, 3);
    assert.equal(matched.total, 2);
    assert.equal(unmatched.total, 1);
    assert.deepEqual(matched.records.map((record) => record.application_number).sort(), ['2026-01-0000001', '2026-01-0000002']);
    assert.deepEqual(unmatched.records.map((record) => record.application_number), ['2026-01-0000003']);
});

test('match filter pages after matching and combines with the search text', async () => {
    const { environment } = await createFixture();
    await seedAuditRecords(environment);

    const firstPage = await queryAudit(environment, { match: 'matched', pageSize: 1, page: 1 });
    const secondPage = await queryAudit(environment, { match: 'matched', pageSize: 1, page: 2 });
    assert.equal(firstPage.total, 2);
    assert.equal(firstPage.records.length, 1);
    assert.equal(secondPage.records.length, 1);
    assert.notEqual(firstPage.records[0].application_number, secondPage.records[0].application_number);

    const searched = await queryAudit(environment, { match: 'matched', q: 'zeynep' });
    assert.equal(searched.total, 0, 'an unmatched record is excluded by the match filter even when the search finds it');
});

test('match filter rejects unknown values', async () => {
    const { environment } = await createFixture();
    const response = await worker.fetch(request('query', { body: { match: 'online-only' } }), environment, {});
    assert.equal(response.status, 400);
});
