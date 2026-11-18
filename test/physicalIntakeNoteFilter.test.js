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
            DOCUMENTS: {},
            APP_ENV: 'staging',
            PHYSICAL_INTAKE_MODE: 'on',
            STAFF_SHARED_USERNAME: 'reviewer-1'
        }
    };
}

function createRequest(path, { method = 'POST', body, cookie, origin = 'https://portal.test' } = {}) {
    const headers = new Headers({ Origin: origin });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (cookie) headers.set('Cookie', cookie);
    return new Request(`https://portal.test${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
}

async function seedStaff(environment, database) {
    const token = 'reviewer-session-token-000000000000000000';
    environment.STAFF_SHARED_USERNAME = 'reviewer-1';
    await database.prepare(`
        INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES ('reviewer-1', 'reviewer-1', 'reviewer-1', 'test-hash', 'Görevli Kullanıcı', 'reviewer')
    `).run();
    await database.prepare(`
        INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at, last_seen_at)
        VALUES (?, 'reviewer-1', ?, '2099-01-01T00:00:00.000Z', ?)
    `).bind(crypto.randomUUID(), await hashSessionToken(token), new Date().toISOString()).run();
    return `staff_session=${token}`;
}

async function seedPhysicalIntake(database, {
    id,
    studentNumber,
    firstName,
    lastName,
    passportNumber,
    status = 'under_review',
    updatedAt = '2026-11-10T09:00:00.000Z'
}) {
    await database.prepare(`
        INSERT INTO physical_intakes (
            id, student_number, first_name, last_name, passport_number,
            application_type, application_route, submitted_at, updated_at,
            created_by_staff_id, status, application_date
        ) VALUES (?, ?, ?, ?, ?, 'initial', 'standard', ?, ?, 'reviewer-1', ?, '2026-11-10')
    `).bind(id, studentNumber, firstName, lastName, passportNumber, updatedAt, updatedAt, status).run();
    return id;
}

async function queryPhysicalIntakes(environment, cookie, body) {
    return worker.fetch(createRequest('/api/staff/physical-intakes/query', {
        method: 'POST',
        cookie,
        body
    }), environment);
}

test('physical intake query filters by has_note (yes, no, all, absent) and returns passport_number as stored', async () => {
    const { environment, database } = createEnvironment();
    const cookie = await seedStaff(environment, database);

    // Sentetik fiziksel teslim kayıtları ve bunlardan biri için personel notu oluşturulur
    const notedId = await seedPhysicalIntake(database, {
        id: '11111111-1111-4111-8111-111111111111',
        studentNumber: 'SYN-26-0001',
        firstName: 'Ada',
        lastName: 'Deneme',
        passportNumber: 'SYN-PASS-101',
        status: 'under_review',
        updatedAt: '2026-11-10T11:00:00.000Z'
    });
    const unnotedEmptyPassportId = await seedPhysicalIntake(database, {
        id: '22222222-2222-4222-8222-222222222222',
        studentNumber: 'SYN-26-0002',
        firstName: 'Bora',
        lastName: 'Sentetik',
        passportNumber: '',
        status: 'under_review',
        updatedAt: '2026-11-10T10:00:00.000Z'
    });
    const approvedId = await seedPhysicalIntake(database, {
        id: '33333333-3333-4333-8333-333333333333',
        studentNumber: 'SYN-26-0003',
        firstName: 'Cem',
        lastName: 'Örnek',
        passportNumber: 'SYN-PASS-103',
        status: 'approved_for_processing',
        updatedAt: '2026-11-10T09:00:00.000Z'
    });

    const saveNoteResponse = await worker.fetch(createRequest(`/api/staff/record-notes/physical/${notedId}`, {
        method: 'PUT',
        cookie,
        body: { body: 'Sentetik personel inceleme notu' }
    }), environment);
    assert.equal(saveNoteResponse.status, 200);

    // has_note alanı gönderilmediğinde tüm kayıtlar ve ham passport_number değerleri döner
    const absentResponse = await queryPhysicalIntakes(environment, cookie, {});
    assert.equal(absentResponse.status, 200);
    const absentPayload = await absentResponse.json();
    assert.equal(absentPayload.pagination.total, 3);
    assert.deepEqual(
        absentPayload.items.map((item) => ({ id: item.id, passport_number: item.passport_number })),
        [
            { id: notedId, passport_number: 'SYN-PASS-101' },
            { id: unnotedEmptyPassportId, passport_number: '' },
            { id: approvedId, passport_number: 'SYN-PASS-103' }
        ]
    );

    // has_note: 'all' tüm kayıtları korur
    const allResponse = await queryPhysicalIntakes(environment, cookie, { has_note: 'all' });
    assert.equal(allResponse.status, 200);
    const allPayload = await allResponse.json();
    assert.equal(allPayload.pagination.total, 3);
    assert.deepEqual(allPayload.items.map((item) => item.id), [notedId, unnotedEmptyPassportId, approvedId]);

    // has_note: 'yes' yalnızca personel notu bulunan fiziksel kaydı getirir
    const yesResponse = await queryPhysicalIntakes(environment, cookie, { has_note: 'yes' });
    assert.equal(yesResponse.status, 200);
    const yesPayload = await yesResponse.json();
    assert.equal(yesPayload.pagination.total, 1);
    assert.deepEqual(
        yesPayload.items.map((item) => ({ id: item.id, passport_number: item.passport_number })),
        [{ id: notedId, passport_number: 'SYN-PASS-101' }]
    );

    // has_note: 'no' personel notu olmayan kayıtları ve boş pasaport değerini olduğu gibi getirir
    const noResponse = await queryPhysicalIntakes(environment, cookie, { has_note: 'no' });
    assert.equal(noResponse.status, 200);
    const noPayload = await noResponse.json();
    assert.equal(noPayload.pagination.total, 2);
    assert.deepEqual(
        noPayload.items.map((item) => ({ id: item.id, passport_number: item.passport_number })),
        [
            { id: unnotedEmptyPassportId, passport_number: '' },
            { id: approvedId, passport_number: 'SYN-PASS-103' }
        ]
    );
});

test('physical intake status filter and q search continue working alongside has_note', async () => {
    const { environment, database } = createEnvironment();
    const cookie = await seedStaff(environment, database);

    const notedId = await seedPhysicalIntake(database, {
        id: '44444444-4444-4444-8444-444444444444',
        studentNumber: 'SYN-26-0101',
        firstName: 'Deniz',
        lastName: 'Kaya',
        passportNumber: 'SYN-PASS-201',
        status: 'under_review',
        updatedAt: '2026-11-10T12:00:00.000Z'
    });
    const unnotedUnderReviewId = await seedPhysicalIntake(database, {
        id: '55555555-5555-4555-8555-555555555555',
        studentNumber: 'SYN-26-0102',
        firstName: 'Ege',
        lastName: 'Yılmaz',
        passportNumber: 'SYN-PASS-202',
        status: 'under_review',
        updatedAt: '2026-11-10T11:00:00.000Z'
    });
    const approvedId = await seedPhysicalIntake(database, {
        id: '66666666-6666-4666-8666-666666666666',
        studentNumber: 'SYN-26-0103',
        firstName: 'Fırat',
        lastName: 'Demir',
        passportNumber: 'SYN-PASS-203',
        status: 'approved_for_processing',
        updatedAt: '2026-11-10T10:00:00.000Z'
    });

    const saveNoteResponse = await worker.fetch(createRequest(`/api/staff/record-notes/physical/${notedId}`, {
        method: 'PUT',
        cookie,
        body: { body: 'Durum ve arama testi notu' }
    }), environment);
    assert.equal(saveNoteResponse.status, 200);

    // Mevcut status filtresi has_note olmadan ve has_note ile çalışmayı sürdürür
    const approvedResponse = await queryPhysicalIntakes(environment, cookie, { status: 'approved' });
    assert.equal(approvedResponse.status, 200);
    const approvedPayload = await approvedResponse.json();
    assert.equal(approvedPayload.pagination.total, 1);
    assert.equal(approvedPayload.items[0].id, approvedId);

    const underReviewResponse = await queryPhysicalIntakes(environment, cookie, { status: 'under_review' });
    assert.equal(underReviewResponse.status, 200);
    const underReviewPayload = await underReviewResponse.json();
    assert.equal(underReviewPayload.pagination.total, 2);
    assert.deepEqual(underReviewPayload.items.map((item) => item.id), [notedId, unnotedUnderReviewId]);

    const approvedWithNoteResponse = await queryPhysicalIntakes(environment, cookie, {
        status: 'approved',
        has_note: 'yes'
    });
    assert.equal(approvedWithNoteResponse.status, 200);
    const approvedWithNotePayload = await approvedWithNoteResponse.json();
    assert.equal(approvedWithNotePayload.pagination.total, 0);
    assert.deepEqual(approvedWithNotePayload.items, []);

    // Mevcut q araması pasaport numarası ve not filtresiyle birlikte çalışır
    const searchYesResponse = await queryPhysicalIntakes(environment, cookie, {
        q: 'SYN-PASS-201',
        has_note: 'yes'
    });
    assert.equal(searchYesResponse.status, 200);
    const searchYesPayload = await searchYesResponse.json();
    assert.equal(searchYesPayload.pagination.total, 1);
    assert.equal(searchYesPayload.items[0].id, notedId);

    const searchNoResponse = await queryPhysicalIntakes(environment, cookie, {
        q: 'SYN-PASS-201',
        has_note: 'no'
    });
    assert.equal(searchNoResponse.status, 200);
    const searchNoPayload = await searchNoResponse.json();
    assert.equal(searchNoPayload.pagination.total, 0);
    assert.deepEqual(searchNoPayload.items, []);
});

test('physical intake query rejects invalid has_note values with VALIDATION_ERROR', async () => {
    const { environment, database } = createEnvironment();
    const cookie = await seedStaff(environment, database);

    for (const invalidValue of ['invalid', '', null, 123, true]) {
        const response = await queryPhysicalIntakes(environment, cookie, { has_note: invalidValue });
        assert.equal(response.status, 400);
        const payload = await response.json();
        assert.equal(payload.error.code, 'VALIDATION_ERROR');
        assert.equal(payload.error.message, 'Not filtresini kontrol edip tekrar deneyin.');
    }
});
