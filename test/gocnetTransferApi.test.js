import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApplicationGocnetRepository } from '../src/server/repositories/d1/applicationGocnetRepository.js';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';
import worker from '../src/server/worker.js';

function createRepository() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    database.prepare(`INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES ('staff-1', 'reviewer', 'reviewer', 'test-hash', 'Reviewer', 'reviewer')`).run();
    database.prepare(`INSERT INTO students (id, student_number, normalized_student_number)
        VALUES ('student-1', 'STU-1', 'STU-1')`).run();
    database.prepare(`INSERT INTO applications (id, student_id, application_type, status, submitted_at)
        VALUES ('app-1', 'student-1', 'initial', 'submitted', '2026-11-05T10:00:00.000Z')`).run();
    return { database, repository: createApplicationGocnetRepository(database) };
}

test('gocnet attempts atomically lock one application and one registration fingerprint', async () => {
    const { database, repository } = createRepository();
    const input = { id: 'attempt-1', applicationId: 'app-1', staffId: 'staff-1', applicationNumberHash: 'a'.repeat(64),
        manifestFingerprint: 'b'.repeat(64), pdfSha256: 'c'.repeat(64), createdAt: '2026-11-05T10:00:00.000Z' };
    await repository.createAttempt(input);
    await assert.rejects(repository.createAttempt({ ...input, id: 'attempt-2' }), (error) => error.code === 'GOCNET_ATTEMPT_CONFLICT');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM application_gocnet_attempts').first().count, 1);
    const stored = database.prepare('SELECT * FROM application_gocnet_attempts').first();
    assert.equal(Object.hasOwn(stored, 'application_number'), false);
    assert.equal(stored.application_number_hash, 'a'.repeat(64));
});

test('gocnet attempts serialize concurrent staff starts for the same registration number', async () => {
    const { database, repository } = createRepository();
    database.prepare(`INSERT INTO students (id, student_number, normalized_student_number)
        VALUES ('student-2', 'STU-2', 'STU-2')`).run();
    database.prepare(`INSERT INTO applications (id, student_id, application_type, status, submitted_at)
        VALUES ('app-2', 'student-2', 'initial', 'submitted', '2026-11-05T10:00:00.000Z')`).run();
    const makeAttempt = (id, applicationId) => repository.createAttempt({
        id, applicationId, staffId: 'staff-1', applicationNumberHash: 'a'.repeat(64),
        manifestFingerprint: 'b'.repeat(64), pdfSha256: 'c'.repeat(64), createdAt: '2026-11-05T10:00:00.000Z'
    });
    const outcomes = await Promise.allSettled([makeAttempt('attempt-1', 'app-1'), makeAttempt('attempt-2', 'app-2')]);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected' && outcome.reason.code === 'GOCNET_ATTEMPT_CONFLICT').length, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM application_gocnet_attempts').first().count, 1);
});

test('gocnet events enforce monotonic transitions and make repeated event IDs idempotent', async () => {
    const { database, repository } = createRepository();
    await repository.createAttempt({ id: 'attempt-1', applicationId: 'app-1', staffId: 'staff-1',
        applicationNumberHash: 'a'.repeat(64), manifestFingerprint: 'b'.repeat(64), pdfSha256: 'c'.repeat(64),
        createdAt: '2026-11-05T10:00:00.000Z' });
    const event = { attemptId: 'attempt-1', applicationId: 'app-1', eventId: 'event-1', actorStaffId: 'staff-1', sequence: 1, state: 'querying', createdAt: '2026-11-05T10:00:01.000Z' };
    assert.equal((await repository.appendEvent(event)).state, 'querying');
    assert.equal((await repository.appendEvent(event)).state, 'querying');
    await assert.rejects(repository.appendEvent({ ...event, remoteRecordId: 'unexpected-record' }),
        (error) => error.code === 'GOCNET_EVENT_CONFLICT');
    await assert.rejects(repository.appendEvent({ ...event, eventId: 'event-2', sequence: 3, state: 'saving' }),
        (error) => error.code === 'GOCNET_EVENT_CONFLICT');
    await assert.rejects(repository.appendEvent({ ...event, eventId: 'event-3', sequence: 2, state: 'uploading' }),
        (error) => error.code === 'GOCNET_EVENT_CONFLICT');
    await repository.appendEvent({ ...event, eventId: 'event-4', sequence: 2, state: 'outcome_unknown' });
    await assert.rejects(repository.createAttempt({ id: 'attempt-2', applicationId: 'app-1', staffId: 'staff-1',
        applicationNumberHash: 'd'.repeat(64), manifestFingerprint: 'e'.repeat(64), pdfSha256: 'f'.repeat(64),
        createdAt: '2026-11-05T10:00:02.000Z' }), (error) => error.code === 'GOCNET_ATTEMPT_CONFLICT');
});

test('gocnet attempt routes reject unauthenticated and cross-origin requests before reading documents', async () => {
    const { database } = createRepository();
    const path = '/api/staff/applications/app-1/gocnet-attempts';
    const createRequest = (origin, cookie) => new Request(`https://portal.test${path}`, {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify({ applicationNumber: '2026-04-0644400', manifestFingerprint: 'b'.repeat(64), pdfSha256: 'c'.repeat(64) })
    });
    const token = 'gocnet-session-token-0000000000000';
    await database.prepare(`INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at)
        VALUES ('session-1', 'staff-1', ?, ?)`)
        .bind(await hashSessionToken(token), new Date(Date.now() + 60_000).toISOString()).run();
    const environment = { DB: database, APP_ENV: 'test', STAFF_SHARED_USERNAME: 'reviewer' };
    const unauthenticated = await worker.fetch(createRequest('https://portal.test'), environment);
    const crossOrigin = await worker.fetch(createRequest('https://attacker.test', `staff_session=${token}`), environment);
    assert.equal(unauthenticated.status, 401);
    assert.equal(crossOrigin.status, 403);
});
