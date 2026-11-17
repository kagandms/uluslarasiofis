import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

function createEnvironment() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    return {
        database,
        environment: {
            DB: database,
            APP_ENV: 'test',
            STAFF_SHARED_USERNAME: 'reviewer-1'
        }
    };
}

function createRequest(path, { method = 'GET', body, cookie, origin = 'https://portal.test' } = {}) {
    const headers = new Headers();
    if (origin !== null) headers.set('Origin', origin);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (cookie) headers.set('Cookie', cookie);
    return new Request(`https://portal.test${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
}

async function seedStaff(environment, database, {
    id = 'reviewer-1',
    username = id,
    token = 'reviewer-session-token-000000000000000000',
    role = 'reviewer',
    displayName = 'Görevli Kullanıcı'
} = {}) {
    environment.STAFF_SHARED_USERNAME = username;
    await database.prepare(`
        INSERT OR IGNORE INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES (?, ?, ?, 'test-hash', ?, ?)
    `).bind(id, username, username.toLowerCase(), displayName, role).run();
    await database.prepare(`
        INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at, last_seen_at)
        VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)
    `).bind(crypto.randomUUID(), id, await hashSessionToken(token), new Date().toISOString()).run();
    return `staff_session=${token}`;
}

// Her tohumlanan kayıt için benzersiz sentetik numara üretir
let syntheticSeedCounter = 0;

async function seedOnlineApplication(database, {
    id = crypto.randomUUID(),
    studentNumber = `SYN-${String(++syntheticSeedCounter).padStart(4, '0')}-${id}`,
    passportNumber = null,
    firstName = 'Sentetik',
    lastName = 'Başvuran',
    status = 'under_review',
    referenceNumber = null,
    updatedAt = '2026-11-17T10:00:00.000Z'
} = {}) {
    const studentId = `student-${id}`;
    await database.prepare(`
        INSERT INTO students (id, student_number, normalized_student_number)
        VALUES (?, ?, ?)
    `).bind(studentId, studentNumber, studentNumber.toUpperCase()).run();
    await database.prepare(`
        INSERT INTO applications (
            id, student_id, passport_number, first_name, last_name, application_type, status, is_under_18,
            address_evidence_type, document_policy_version, reference_number, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'initial', ?, 0, 'rental_contract', 1, ?, ?)
    `).bind(id, studentId, passportNumber, firstName, lastName, status, referenceNumber, updatedAt).run();
    return id;
}

async function seedPhysicalIntake(database, {
    id = crypto.randomUUID(),
    staffId = 'reviewer-1',
    studentNumber = `PHY-${String(++syntheticSeedCounter).padStart(4, '0')}-${id}`,
    passportNumber = `PASS-${String(++syntheticSeedCounter).padStart(4, '0')}-${id}`
} = {}) {
    const now = '2026-11-10T09:00:00.000Z';
    await database.prepare(`
        INSERT INTO physical_intakes (
            id, student_number, first_name, last_name, passport_number,
            application_type, application_route, submitted_at, updated_at,
            created_by_staff_id, status, tracking_reference, application_date
        ) VALUES (?, ?, 'Sentetik', 'Fiziksel', ?, 'initial', 'standard', ?, ?, ?, 'under_review', NULL, '2026-11-10')
    `).bind(id, studentNumber, passportNumber, now, now, staffId).run();
    return id;
}

async function queryApplications(environment, cookie, body) {
    const response = await worker.fetch(createRequest('/api/staff/applications/query', {
        method: 'POST',
        cookie,
        body
    }), environment);
    return { response, payload: await response.json() };
}

test('has_note filters online applications by yes, no, all, and absent while isolating physical notes and counting pages', async () => {
    const { environment, database } = createEnvironment();
    const cookie = await seedStaff(environment, database);

    await seedOnlineApplication(database, {
        id: 'app-note-1',
        firstName: 'Ortak',
        lastName: 'Birinci',
        status: 'under_review',
        updatedAt: '2026-11-17T10:03:00.000Z'
    });
    await seedOnlineApplication(database, {
        id: 'app-note-2',
        firstName: 'Ortak',
        lastName: 'İkinci',
        status: 'under_review',
        updatedAt: '2026-11-17T10:02:00.000Z'
    });
    await seedOnlineApplication(database, {
        id: 'app-note-3',
        firstName: 'Farklı',
        lastName: 'Üçüncü',
        status: 'approved_for_processing',
        updatedAt: '2026-11-17T10:01:00.000Z'
    });

    // Yalnızca app-note-1 için online not eklenir; app-note-2 kimliğiyle fiziksel not eklenmesi online filtreyi etkilememelidir
    const putOnline = await worker.fetch(createRequest('/api/staff/record-notes/online/app-note-1', {
        method: 'PUT',
        cookie,
        body: { body: 'Evrak kontrol notu' }
    }), environment);
    assert.equal(putOnline.status, 200);

    await seedPhysicalIntake(database, { id: 'app-note-2', staffId: 'reviewer-1' });
    const putPhysical = await worker.fetch(createRequest('/api/staff/record-notes/physical/app-note-2', {
        method: 'PUT',
        cookie,
        body: { body: 'Fiziksel kayıt notu' }
    }), environment);
    assert.equal(putPhysical.status, 200);

    const absentResult = await queryApplications(environment, cookie, {});
    assert.equal(absentResult.response.status, 200);
    assert.deepEqual(absentResult.payload.items.map((item) => item.id), ['app-note-1', 'app-note-2', 'app-note-3']);
    assert.equal(absentResult.payload.pagination.total_items, 3);

    const allResult = await queryApplications(environment, cookie, { has_note: 'all' });
    assert.equal(allResult.response.status, 200);
    assert.deepEqual(allResult.payload.items.map((item) => item.id), ['app-note-1', 'app-note-2', 'app-note-3']);
    assert.equal(allResult.payload.pagination.total_items, 3);

    const yesResult = await queryApplications(environment, cookie, { has_note: 'yes' });
    assert.equal(yesResult.response.status, 200);
    assert.deepEqual(yesResult.payload.items.map((item) => item.id), ['app-note-1']);
    assert.equal(yesResult.payload.pagination.total_items, 1);

    const noResult = await queryApplications(environment, cookie, { has_note: 'no' });
    assert.equal(noResult.response.status, 200);
    assert.deepEqual(noResult.payload.items.map((item) => item.id), ['app-note-2', 'app-note-3']);
    assert.equal(noResult.payload.pagination.total_items, 2);

    // Ayrı COUNT(*) sorgusunun da aynı not koşulunu kullandığını doğrulamak için page_size=1 ile sayfala
    const pagedNoFirst = await queryApplications(environment, cookie, { has_note: 'no', page: 1, page_size: 1 });
    assert.equal(pagedNoFirst.response.status, 200);
    assert.deepEqual(pagedNoFirst.payload.items.map((item) => item.id), ['app-note-2']);
    assert.equal(pagedNoFirst.payload.pagination.total_items, 2);
    assert.equal(pagedNoFirst.payload.pagination.total_pages, 2);

    const pagedNoSecond = await queryApplications(environment, cookie, { has_note: 'no', page: 2, page_size: 1 });
    assert.equal(pagedNoSecond.response.status, 200);
    assert.deepEqual(pagedNoSecond.payload.items.map((item) => item.id), ['app-note-3']);
    assert.equal(pagedNoSecond.payload.pagination.total_items, 2);
    assert.equal(pagedNoSecond.payload.pagination.total_pages, 2);
});

test('has_note combines with status and search filters', async () => {
    const { environment, database } = createEnvironment();
    const cookie = await seedStaff(environment, database);

    await seedOnlineApplication(database, {
        id: 'app-combo-1',
        firstName: 'Ortak',
        lastName: 'Birinci',
        status: 'under_review',
        updatedAt: '2026-11-17T10:03:00.000Z'
    });
    await seedOnlineApplication(database, {
        id: 'app-combo-2',
        firstName: 'Ortak',
        lastName: 'İkinci',
        status: 'under_review',
        updatedAt: '2026-11-17T10:02:00.000Z'
    });
    await seedOnlineApplication(database, {
        id: 'app-combo-3',
        firstName: 'Farklı',
        lastName: 'Üçüncü',
        status: 'approved_for_processing',
        updatedAt: '2026-11-17T10:01:00.000Z'
    });

    const putNote = await worker.fetch(createRequest('/api/staff/record-notes/online/app-combo-1', {
        method: 'PUT',
        cookie,
        body: { body: 'Birleştirme testi notu' }
    }), environment);
    assert.equal(putNote.status, 200);

    const underReviewYes = await queryApplications(environment, cookie, { status: 'under_review', has_note: 'yes' });
    assert.equal(underReviewYes.response.status, 200);
    assert.deepEqual(underReviewYes.payload.items.map((item) => item.id), ['app-combo-1']);
    assert.equal(underReviewYes.payload.pagination.total_items, 1);

    const underReviewNo = await queryApplications(environment, cookie, { status: 'under_review', has_note: 'no' });
    assert.equal(underReviewNo.response.status, 200);
    assert.deepEqual(underReviewNo.payload.items.map((item) => item.id), ['app-combo-2']);
    assert.equal(underReviewNo.payload.pagination.total_items, 1);

    const approvedYes = await queryApplications(environment, cookie, { status: 'approved', has_note: 'yes' });
    assert.equal(approvedYes.response.status, 200);
    assert.deepEqual(approvedYes.payload.items, []);
    assert.equal(approvedYes.payload.pagination.total_items, 0);

    const approvedNo = await queryApplications(environment, cookie, { status: 'approved', has_note: 'no' });
    assert.equal(approvedNo.response.status, 200);
    assert.deepEqual(approvedNo.payload.items.map((item) => item.id), ['app-combo-3']);
    assert.equal(approvedNo.payload.pagination.total_items, 1);

    const searchYes = await queryApplications(environment, cookie, { q: 'Ortak', has_note: 'yes' });
    assert.equal(searchYes.response.status, 200);
    assert.deepEqual(searchYes.payload.items.map((item) => item.id), ['app-combo-1']);
    assert.equal(searchYes.payload.pagination.total_items, 1);

    const searchNo = await queryApplications(environment, cookie, { q: 'Ortak', has_note: 'no' });
    assert.equal(searchNo.response.status, 200);
    assert.deepEqual(searchNo.payload.items.map((item) => item.id), ['app-combo-2']);
    assert.equal(searchNo.payload.pagination.total_items, 1);

    const searchAll = await queryApplications(environment, cookie, { q: 'Ortak', has_note: 'all' });
    assert.equal(searchAll.response.status, 200);
    assert.deepEqual(searchAll.payload.items.map((item) => item.id), ['app-combo-1', 'app-combo-2']);
    assert.equal(searchAll.payload.pagination.total_items, 2);
});

test('has_note validation rejects invalid values with VALIDATION_ERROR', async () => {
    const { environment, database } = createEnvironment();
    const cookie = await seedStaff(environment, database);

    for (const invalidValue of ['maybe', '', null, 123, true, ['yes']]) {
        const { response, payload } = await queryApplications(environment, cookie, { has_note: invalidValue });
        assert.equal(response.status, 400);
        assert.equal(payload.error.code, 'VALIDATION_ERROR');
        assert.equal(payload.error.message, 'Not filtresini kontrol edip tekrar deneyin.');
    }
});

test('staff queue DTO includes passport_number when present and null when absent', async () => {
    const { environment, database } = createEnvironment();
    const cookie = await seedStaff(environment, database);

    await seedOnlineApplication(database, {
        id: 'app-passport-1',
        passportNumber: 'SYN-PASS-001',
        updatedAt: '2026-11-17T10:02:00.000Z'
    });
    await seedOnlineApplication(database, {
        id: 'app-passport-2',
        passportNumber: null,
        updatedAt: '2026-11-17T10:01:00.000Z'
    });

    const { response, payload } = await queryApplications(environment, cookie, {});
    assert.equal(response.status, 200);
    assert.deepEqual(
        payload.items.map((item) => ({ id: item.id, passport_number: item.passport_number })),
        [
            { id: 'app-passport-1', passport_number: 'SYN-PASS-001' },
            { id: 'app-passport-2', passport_number: null }
        ]
    );
});
