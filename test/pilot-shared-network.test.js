import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';
import { withTestApplicationPrivacyNotice, withTestApplicationPrivacyNoticeVersion } from './helpers/application-privacy-notice.js';

const CAMPUS_ADDRESS = '198.51.100.120';

function createFixture(context) {
    const database = new TestD1Database();
    applyAllMigrations(database);
    context.after(() => database.database.close());
    return { database, environment: withTestApplicationPrivacyNotice({ DB: database, APP_ENV: 'test' }) };
}

function request(environment, path, options) {
    const body = path === '/api/public/applications'
        ? withTestApplicationPrivacyNoticeVersion(options.body || {}) : options.body;
    return worker.fetch(new Request(`https://portal.test${path}`, {
        method: 'POST', headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json',
            'CF-Connecting-IP': options.address || CAMPUS_ADDRESS }, body: JSON.stringify(body)
    }), environment);
}

function createDraft(environment, studentNumber, address = CAMPUS_ADDRESS) {
    return request(environment, '/api/public/applications', { address, body: {
        student_number: studentNumber, application_type: 'initial', email: 'synthetic@example.invalid', phone: '+905551112233'
    } });
}

function lookup(environment, studentNumber, address = CAMPUS_ADDRESS) {
    const referenceNumber = environment.DB.prepare(`SELECT applications.reference_number FROM applications
        JOIN students ON students.id=applications.student_id WHERE students.normalized_student_number=?`).bind(studentNumber).first()?.reference_number
        || 'ITU-7K9M-4X2P';
    return request(environment, '/api/public/applications/tracking-lookup', { address, body: { reference_number: referenceNumber } });
}

function expireWindow(database, endpoint) {
    database.prepare('UPDATE public_rate_limits SET window_started_at=? WHERE endpoint=?')
        .bind(Math.floor(Date.now() / 1000) - 901, endpoint).run();
}

function seedTrackableStudent(database, index) {
    const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    const suffix = `${alphabet[Math.floor(index / alphabet.length)]}${alphabet[index % alphabet.length]}${alphabet[(index + 3) % alphabet.length]}${alphabet[(index + 7) % alphabet.length]}`;
    const referenceNumber = `ITU-7K9M-${suffix}`;
    database.prepare('INSERT INTO students(id,student_number,normalized_student_number) VALUES(?,?,?)')
        .bind(`student-${index}`, `CAMPUS-${index}`, `CAMPUS-${index}`).run();
    database.prepare("INSERT INTO applications(id,student_id,application_type,status,reference_number) VALUES(?,?,'initial','submitted',?)")
        .bind(`application-${index}`, `student-${index}`, referenceNumber).run();
}

test('twenty distinct students can create drafts through one campus address while the single-active-application rule remains', async (context) => {
    const { environment, database } = createFixture(context);

    for (let index = 0; index < 20; index += 1) {
        const response = await createDraft(environment, `CAMPUS-${index}`);
        assert.equal(response.status, 201, `campus student ${index + 1}`);
    }
    const duplicate = await createDraft(environment, 'CAMPUS-0');

    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).error.code, 'APPLICATION_ALREADY_ACTIVE');
    assert.equal(database.prepare('SELECT count(*) AS count FROM applications').first().count, 20);
});

test('campus creation allows 120 attempts, rejects excess without a new draft, and recovers after the finite window', async (context) => {
    const { environment, database } = createFixture(context);
    for (let index = 0; index < 120; index += 1) assert.equal((await createDraft(environment, `BURST-${index}`)).status, 201);

    const excess = await createDraft(environment, 'BURST-EXCESS');

    assert.equal(excess.status, 429);
    assert.equal((await excess.json()).error.code, 'RATE_LIMITED');
    assert.equal(excess.headers.get('Set-Cookie'), null);
    assert.equal(database.prepare('SELECT count(*) AS count FROM applications').first().count, 120);
    assert.equal((await createDraft(environment, 'OTHER-NETWORK', '198.51.100.121')).status, 201);
    expireWindow(database, 'application-create');
    assert.equal((await createDraft(environment, 'AFTER-WINDOW')).status, 201);
});

test('twenty students can read their public status through one campus address without receiving owner credentials', async (context) => {
    const { environment, database } = createFixture(context);
    for (let index = 0; index < 20; index += 1) seedTrackableStudent(database, index);

    for (let index = 0; index < 20; index += 1) {
        const response = await lookup(environment, `CAMPUS-${index}`);

        assert.equal(response.status, 200, `campus status ${index + 1}`);
        const payload = await response.json();
        assert.equal(payload.found, true);
        assert.equal(payload.application.student_number, undefined);
        assert.equal(response.headers.get('Set-Cookie'), null);
        assert.doesNotMatch(JSON.stringify(payload), /reference_number|access_code|token_hash|session/i);
    }
});

test('campus status lookup is bounded at 300 requests per address and its block expires', async (context) => {
    const { environment, database } = createFixture(context);
    for (let index = 0; index < 300; index += 1) assert.equal((await lookup(environment, `STATUS-${index}`)).status, 200);

    const excess = await lookup(environment, 'STATUS-EXCESS');

    assert.equal(excess.status, 429);
    assert.equal((await excess.json()).error.code, 'RATE_LIMITED');
    assert.equal((await lookup(environment, 'OTHER-NETWORK', '198.51.100.121')).status, 200);
    expireWindow(database, 'application-tracking-lookup');
    assert.equal((await lookup(environment, 'AFTER-WINDOW')).status, 200);
});
