import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { createD1Repositories } from '../src/server/repositories/d1/index.js';
import {
    RECORD_NOTE_MAX_BODY_LENGTH,
    RECORD_NOTE_MAX_IDS,
    validateRecordIdsQuery,
    validateRecordKind,
    validateRecordNoteBody
} from '../src/server/domain/staffRecordNote.js';
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

async function withFixedDate(isoDate, callback) {
    const NativeDate = globalThis.Date;
    globalThis.Date = class extends NativeDate {
        constructor(...args) {
            super(...(args.length ? args : [isoDate]));
        }
        static now() {
            return new NativeDate(isoDate).valueOf();
        }
    };
    try {
        return await callback();
    } finally {
        globalThis.Date = NativeDate;
    }
}

async function seedStaff(environment, database, {
    id = 'reviewer-1',
    username = id,
    token = 'reviewer-session-token-000000000000000000',
    role = 'reviewer',
    displayName = 'Görevli Kullanıcı',
    lastSeenAt = new Date().toISOString()
} = {}) {
    environment.STAFF_SHARED_USERNAME = username;
    await database.prepare(`
        INSERT OR IGNORE INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES (?, ?, ?, 'test-hash', ?, ?)
    `).bind(id, username, username.toLowerCase(), displayName, role).run();
    await database.prepare(`
        INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at, last_seen_at)
        VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z', ?)
    `).bind(crypto.randomUUID(), id, await hashSessionToken(token), lastSeenAt).run();
    return `staff_session=${token}`;
}

// Her tohumlanan kayıt için benzersiz sentetik öğrenci/pasaport numarası üretir (id kırpma çakışmasını önler)
let syntheticSeedCounter = 0;

async function seedOnlineApplication(database, {
    id = crypto.randomUUID(),
    studentNumber = `SYN-${String(++syntheticSeedCounter).padStart(4, '0')}-${id}`,
    status = 'under_review',
    referenceNumber = null
} = {}) {
    const studentId = `student-${id}`;
    await database.prepare(`
        INSERT INTO students (id, student_number, normalized_student_number)
        VALUES (?, ?, ?)
    `).bind(studentId, studentNumber, studentNumber.toUpperCase()).run();
    await database.prepare(`
        INSERT INTO applications (
            id, student_id, application_type, status, is_under_18,
            address_evidence_type, document_policy_version, reference_number
        ) VALUES (?, ?, 'initial', ?, 0, 'rental_contract', 1, ?)
    `).bind(id, studentId, status, referenceNumber).run();
    return id;
}

async function seedOwnerSession(database, applicationId, token = 'owner-session-token-000000000000000000000') {
    await database.prepare(`
        INSERT INTO application_sessions (id, application_id, token_hash, expires_at)
        VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z')
    `).bind(crypto.randomUUID(), applicationId, await hashSessionToken(token)).run();
    return `application_session=${token}`;
}

async function seedPhysicalIntake(database, {
    id = crypto.randomUUID(),
    staffId = 'reviewer-1',
    studentNumber = `PHY-${String(++syntheticSeedCounter).padStart(4, '0')}-${id}`,
    passportNumber = `PASS-${String(++syntheticSeedCounter).padStart(4, '0')}-${id}`,
    trackingReference = null,
    applicationDate = '2026-11-10',
    deletedAt = null
} = {}) {
    const now = '2026-11-10T09:00:00.000Z';
    await database.prepare(`
        INSERT INTO physical_intakes (
            id, student_number, first_name, last_name, passport_number,
            application_type, application_route, submitted_at, updated_at,
            created_by_staff_id, status, tracking_reference, application_date, deleted_at
        ) VALUES (?, ?, 'Sentetik', 'Öğrenci', ?, 'initial', 'standard', ?, ?, ?, 'under_review', ?, ?, ?)
    `).bind(id, studentNumber, passportNumber, now, now, staffId, trackingReference, applicationDate, deletedAt).run();
    return id;
}

test('record notes require an authenticated staff session and allow reviewer and admin roles', async () => {
    const { environment, database } = createEnvironment();
    const applicationId = await seedOnlineApplication(database, { id: 'app-auth-1' });
    const ownerCookie = await seedOwnerSession(database, applicationId);

    for (const [path, method, body] of [
        ['/api/staff/record-notes?kind=online&ids=app-auth-1', 'GET', undefined],
        ['/api/staff/record-notes/online/app-auth-1', 'PUT', { body: 'Yetkisiz deneme' }],
        ['/api/staff/record-notes/online/app-auth-1', 'DELETE', undefined]
    ]) {
        const noSession = await worker.fetch(createRequest(path, { method, body }), environment);
        assert.equal(noSession.status, 401);
        assert.equal((await noSession.json()).error.code, 'UNAUTHORIZED');

        const studentSession = await worker.fetch(createRequest(path, { method, body, cookie: ownerCookie }), environment);
        assert.equal(studentSession.status, 401);
        assert.equal((await studentSession.json()).error.code, 'UNAUTHORIZED');
    }

    const reviewerCookie = await seedStaff(environment, database, {
        id: 'reviewer-1', username: 'reviewer-1', role: 'reviewer', displayName: 'İnceleyici'
    });
    const reviewerPut = await worker.fetch(createRequest('/api/staff/record-notes/online/app-auth-1', {
        method: 'PUT', cookie: reviewerCookie, body: { body: 'İnceleyici notu' }
    }), environment);
    assert.equal(reviewerPut.status, 200);

    const adminCookie = await seedStaff(environment, database, {
        id: 'admin-1', username: 'admin-1', token: 'admin-session-token-000000000000000000000',
        role: 'admin', displayName: 'Yönetici'
    });
    const adminGet = await worker.fetch(createRequest('/api/staff/record-notes?kind=online&ids=app-auth-1', {
        cookie: adminCookie
    }), environment);
    assert.equal(adminGet.status, 200);
    assert.equal((await adminGet.json()).notes['app-auth-1'].body, 'İnceleyici notu');
});

test('PUT and DELETE require same-origin requests', async () => {
    const { environment, database } = createEnvironment();
    await seedOnlineApplication(database, { id: 'app-origin-1' });
    const cookie = await seedStaff(environment, database);

    for (const origin of ['https://attacker.test', null]) {
        const putResponse = await worker.fetch(createRequest('/api/staff/record-notes/online/app-origin-1', {
            method: 'PUT', cookie, origin, body: { body: 'Köken testi' }
        }), environment);
        assert.equal(putResponse.status, 403);
        assert.equal((await putResponse.json()).error.code, 'CROSS_ORIGIN_REQUEST');

        const deleteResponse = await worker.fetch(createRequest('/api/staff/record-notes/online/app-origin-1', {
            method: 'DELETE', cookie, origin
        }), environment);
        assert.equal(deleteResponse.status, 403);
        assert.equal((await deleteResponse.json()).error.code, 'CROSS_ORIGIN_REQUEST');
    }
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM staff_record_notes').first().count, 0);
});

test('PUT creates then replaces a note while keeping created_at and updating updated_at for online and physical records', async () => {
    const { environment, database } = createEnvironment();
    const firstTime = '2026-11-17T10:00:00.000Z';
    const secondTime = '2026-11-17T10:05:00.000Z';
    const cookie = await seedStaff(environment, database, {
        id: 'reviewer-1', username: 'reviewer-1', displayName: 'Ayşe Görevli', lastSeenAt: firstTime
    });
    const onlineId = await seedOnlineApplication(database, { id: 'app-upsert-1' });
    const physicalId = await seedPhysicalIntake(database, {
        id: 'phy-upsert-1', staffId: 'reviewer-1', trackingReference: 'ITU-26-2345678'
    });

    const created = await withFixedDate(firstTime, async () => {
        return worker.fetch(createRequest(`/api/staff/record-notes/online/${onlineId}`, {
            method: 'PUT',
            cookie,
            body: { body: '  eksik evrak var,\nsonra aranacak  ' }
        }), environment);
    });
    assert.equal(created.status, 200);
    const createdPayload = await created.json();
    assert.deepEqual(createdPayload.note, {
        id: onlineId,
        kind: 'online',
        body: 'eksik evrak var,\nsonra aranacak',
        updated_at: firstTime,
        updated_by_name: 'Ayşe Görevli'
    });

    const replaced = await withFixedDate(secondTime, async () => {
        return worker.fetch(createRequest(`/api/staff/record-notes/online/${onlineId}`, {
            method: 'PUT',
            cookie,
            body: { body: 'evrak tamamlandı' }
        }), environment);
    });
    assert.equal(replaced.status, 200);
    const replacedPayload = await replaced.json();
    assert.deepEqual(replacedPayload.note, {
        id: onlineId,
        kind: 'online',
        body: 'evrak tamamlandı',
        updated_at: secondTime,
        updated_by_name: 'Ayşe Görevli'
    });

    const storedOnline = database.prepare(`
        SELECT body, created_at, updated_at, created_by_staff_id, updated_by_staff_id
        FROM staff_record_notes WHERE record_kind = 'online' AND record_id = ?
    `).bind(onlineId).first();
    assert.deepEqual({ ...storedOnline }, {
        body: 'evrak tamamlandı',
        created_at: firstTime,
        updated_at: secondTime,
        created_by_staff_id: 'reviewer-1',
        updated_by_staff_id: 'reviewer-1'
    });

    const physicalSaved = await withFixedDate(firstTime, async () => {
        return worker.fetch(createRequest(`/api/staff/record-notes/physical/${physicalId}`, {
            method: 'PUT',
            cookie,
            body: { body: 'dosya teslim alındı' }
        }), environment);
    });
    assert.equal(physicalSaved.status, 200);
    assert.deepEqual((await physicalSaved.json()).note, {
        id: physicalId,
        kind: 'physical',
        body: 'dosya teslim alındı',
        updated_at: firstTime,
        updated_by_name: 'Ayşe Görevli'
    });
});

test('body validation rejects empty, whitespace-only, oversized, control-character, and unknown-key payloads', async () => {
    const { environment, database } = createEnvironment();
    await seedOnlineApplication(database, { id: 'app-val-1' });
    const cookie = await seedStaff(environment, database);

    const invalidPayloads = [
        {},
        { body: '' },
        { body: '   \n   ' },
        { body: 123 },
        { body: null },
        { body: 'a'.repeat(RECORD_NOTE_MAX_BODY_LENGTH + 1) },
        { body: 'gizli\u0000not' },
        { body: 'gizli\tnot' },
        { body: 'gizli\rnot' },
        { body: 'gizli\u0007not' },
        { body: 'gizli\u007fnot' },
        { body: 'geçerli not', extra: 'bilinmeyen' }
    ];

    for (const payload of invalidPayloads) {
        const response = await worker.fetch(createRequest('/api/staff/record-notes/online/app-val-1', {
            method: 'PUT', cookie, body: payload
        }), environment);
        assert.equal(response.status, 400);
        const json = await response.json();
        assert.equal(json.error.code, 'VALIDATION_ERROR');
        assert.equal(typeof json.error.message, 'string');
    }

    const boundaryValid = await worker.fetch(createRequest('/api/staff/record-notes/online/app-val-1', {
        method: 'PUT', cookie, body: { body: 'x'.repeat(RECORD_NOTE_MAX_BODY_LENGTH) }
    }), environment);
    assert.equal(boundaryValid.status, 200);

    // Doğrudan alan doğrulayıcılarının sınır ve CRLF normalizasyonu kontrolü
    assert.equal(validateRecordNoteBody({ body: 'satır 1\r\nsatır 2' }), 'satır 1\nsatır 2');
    assert.throws(() => validateRecordKind('other'), (error) => error.code === 'VALIDATION_ERROR');
    assert.throws(() => validateRecordIdsQuery(null), (error) => error.code === 'VALIDATION_ERROR');
});

test('PUT returns 404 for unknown online ids and unknown or soft-deleted physical intakes', async () => {
    const { environment, database } = createEnvironment();
    const cookie = await seedStaff(environment, database);
    await seedPhysicalIntake(database, {
        id: 'phy-deleted-1',
        staffId: 'reviewer-1',
        deletedAt: '2026-11-12T10:00:00.000Z'
    });

    for (const path of [
        '/api/staff/record-notes/online/nonexistent-online-id',
        '/api/staff/record-notes/physical/nonexistent-physical-id',
        '/api/staff/record-notes/physical/phy-deleted-1'
    ]) {
        const response = await worker.fetch(createRequest(path, {
            method: 'PUT', cookie, body: { body: 'Kaydedilmemeli' }
        }), environment);
        assert.equal(response.status, 404);
    }

    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM staff_record_notes').first().count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM audit_events').first().count, 0);
});

test('GET returns only ids with notes and enforces max-100, id-length, and kind validation', async () => {
    const { environment, database } = createEnvironment();
    const cookie = await seedStaff(environment, database, {
        id: 'reviewer-1', username: 'reviewer-1', displayName: 'Elif Görevli'
    });
    await seedOnlineApplication(database, { id: 'app-get-1' });
    await seedOnlineApplication(database, { id: 'app-get-2' });
    await seedPhysicalIntake(database, { id: 'app-get-1', staffId: 'reviewer-1' });

    await worker.fetch(createRequest('/api/staff/record-notes/online/app-get-1', {
        method: 'PUT', cookie, body: { body: 'Yalnızca online not' }
    }), environment);
    await worker.fetch(createRequest('/api/staff/record-notes/physical/app-get-1', {
        method: 'PUT', cookie, body: { body: 'Yalnızca fiziksel not' }
    }), environment);

    const onlineResponse = await worker.fetch(createRequest(
        '/api/staff/record-notes?kind=online&ids=app-get-1,app-get-2,missing-id',
        { cookie }
    ), environment);
    assert.equal(onlineResponse.status, 200);
    const onlinePayload = await onlineResponse.json();
    assert.deepEqual(Object.keys(onlinePayload.notes), ['app-get-1']);
    assert.equal(onlinePayload.notes['app-get-1'].body, 'Yalnızca online not');
    assert.equal(onlinePayload.notes['app-get-1'].updated_by_name, 'Elif Görevli');
    assert.ok(onlinePayload.notes['app-get-1'].updated_at);

    const physicalResponse = await worker.fetch(createRequest(
        '/api/staff/record-notes?kind=physical&ids=app-get-1,missing-id',
        { cookie }
    ), environment);
    assert.equal(physicalResponse.status, 200);
    const physicalPayload = await physicalResponse.json();
    assert.deepEqual(Object.keys(physicalPayload.notes), ['app-get-1']);
    assert.equal(physicalPayload.notes['app-get-1'].body, 'Yalnızca fiziksel not');

    // Boş ids listesi hata vermeden boş harita döndürür
    const emptyIds = await worker.fetch(createRequest('/api/staff/record-notes?kind=online&ids=', { cookie }), environment);
    assert.equal(emptyIds.status, 200);
    assert.deepEqual((await emptyIds.json()).notes, {});

    // Tam 100 kimlik sınırda kabul edilir (D1 bağlı parametre limiti <= 100)
    const hundredIds = Array.from({ length: RECORD_NOTE_MAX_IDS }, (_, index) =>
        index === 0 ? 'app-get-1' : `synthetic-id-${index}`
    ).join(',');
    const maxAllowed = await worker.fetch(createRequest(`/api/staff/record-notes?kind=online&ids=${hundredIds}`, { cookie }), environment);
    assert.equal(maxAllowed.status, 200);
    assert.deepEqual(Object.keys((await maxAllowed.json()).notes), ['app-get-1']);

    // 101 kimlik, 65 karakterlik kimlik ve geçersiz kind reddedilir
    const tooManyIds = Array.from({ length: RECORD_NOTE_MAX_IDS + 1 }, (_, index) => `id-${index}`).join(',');
    for (const invalidPath of [
        `/api/staff/record-notes?kind=online&ids=${tooManyIds}`,
        `/api/staff/record-notes?kind=online&ids=${'k'.repeat(65)}`,
        '/api/staff/record-notes?kind=unknown&ids=app-get-1',
        '/api/staff/record-notes?ids=app-get-1',
        '/api/staff/record-notes?kind=online'
    ]) {
        const response = await worker.fetch(createRequest(invalidPath, { cookie }), environment);
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
    }

    // Repository doğrudan çağrıldığında IN (...) sorgusu dışında döngü yapmaz
    const repositories = createD1Repositories(database);
    const rows = await repositories.staffRecordNotes.listByIds({ kind: 'online', ids: ['app-get-1', 'app-get-2'] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].record_id, 'app-get-1');
});

test('DELETE removes an existing note and is idempotent when no note exists', async () => {
    const { environment, database } = createEnvironment();
    const cookie = await seedStaff(environment, database);
    await seedOnlineApplication(database, { id: 'app-del-1' });

    await worker.fetch(createRequest('/api/staff/record-notes/online/app-del-1', {
        method: 'PUT', cookie, body: { body: 'Silinecek not' }
    }), environment);

    const firstDelete = await worker.fetch(createRequest('/api/staff/record-notes/online/app-del-1', {
        method: 'DELETE', cookie
    }), environment);
    assert.equal(firstDelete.status, 200);
    assert.equal((await firstDelete.json()).deleted, true);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM staff_record_notes').first().count, 0);

    const secondDelete = await worker.fetch(createRequest('/api/staff/record-notes/online/app-del-1', {
        method: 'DELETE', cookie
    }), environment);
    assert.equal(secondDelete.status, 200);
    assert.equal((await secondDelete.json()).deleted, true);

    const nonexistentDelete = await worker.fetch(createRequest('/api/staff/record-notes/physical/nonexistent-id', {
        method: 'DELETE', cookie
    }), environment);
    assert.equal(nonexistentDelete.status, 200);
    assert.equal((await nonexistentDelete.json()).deleted, true);

    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'staff.record_note_deleted'").first().count, 1);
});

test('student-facing application, session, status, and tracking responses never include staff record notes', async () => {
    const { environment, database } = createEnvironment();
    const staffCookie = await seedStaff(environment, database);
    const onlineId = await seedOnlineApplication(database, {
        id: 'app-public-1',
        status: 'under_review',
        referenceNumber: 'ITU-7K9M-4X2P'
    });
    const ownerCookie = await seedOwnerSession(database, onlineId);
    const physicalId = await seedPhysicalIntake(database, {
        id: 'phy-public-1',
        staffId: 'reviewer-1',
        trackingReference: 'ITU-26-2345678'
    });
    const secretNote = 'GIZLI-PERSONEL-NOTU-SENTETIK';

    assert.equal((await worker.fetch(createRequest(`/api/staff/record-notes/online/${onlineId}`, {
        method: 'PUT', cookie: staffCookie, body: { body: secretNote }
    }), environment)).status, 200);
    assert.equal((await worker.fetch(createRequest(`/api/staff/record-notes/physical/${physicalId}`, {
        method: 'PUT', cookie: staffCookie, body: { body: secretNote }
    }), environment)).status, 200);

    const studentResponses = await Promise.all([
        worker.fetch(createRequest('/api/public/applications/current', { cookie: ownerCookie }), environment),
        worker.fetch(createRequest('/api/public/applications/current/status', { cookie: ownerCookie }), environment),
        worker.fetch(createRequest('/api/public/applications/current/tracking', { cookie: ownerCookie }), environment),
        worker.fetch(createRequest('/api/public/applications/tracking-lookup', {
            method: 'POST', body: { reference_number: 'ITU-7K9M-4X2P' }
        }), environment),
        worker.fetch(createRequest('/api/public/physical-intakes/tracking-lookup', {
            method: 'POST', body: { tracking_reference: 'ITU-26-2345678' }
        }), environment)
    ]);

    for (const response of studentResponses) {
        assert.equal(response.status, 200);
        const text = await response.text();
        assert.doesNotMatch(text, new RegExp(secretNote));
        assert.doesNotMatch(text, /staff_record_notes|updated_by_name/i);
    }
});

test('audit rows store only kind and result without note text, and failed audit rolls back note changes atomically', async () => {
    const { environment, database } = createEnvironment();
    const cookie = await seedStaff(environment, database);
    const onlineId = await seedOnlineApplication(database, { id: 'app-audit-1' });
    const physicalId = await seedPhysicalIntake(database, { id: 'phy-audit-1', staffId: 'reviewer-1' });
    const sensitiveNote = 'SADECE-NOT-TABLOSUNDA-KALMALI';

    await worker.fetch(createRequest(`/api/staff/record-notes/online/${onlineId}`, {
        method: 'PUT', cookie, body: { body: sensitiveNote }
    }), environment);
    await worker.fetch(createRequest(`/api/staff/record-notes/physical/${physicalId}`, {
        method: 'PUT', cookie, body: { body: sensitiveNote }
    }), environment);
    await worker.fetch(createRequest(`/api/staff/record-notes/online/${onlineId}`, {
        method: 'DELETE', cookie
    }), environment);

    const audits = database.prepare(`
        SELECT event_type, actor_type, actor_staff_id, application_id, safe_metadata_json
        FROM audit_events
        WHERE event_type IN ('staff.record_note_saved', 'staff.record_note_deleted')
        ORDER BY rowid
    `).all().results;
    assert.equal(audits.length, 3);
    assert.deepEqual({ ...audits[0] }, {
        event_type: 'staff.record_note_saved',
        actor_type: 'staff',
        actor_staff_id: 'reviewer-1',
        application_id: onlineId,
        safe_metadata_json: JSON.stringify({ kind: 'online', result: 'success' })
    });
    assert.deepEqual({ ...audits[1] }, {
        event_type: 'staff.record_note_saved',
        actor_type: 'staff',
        actor_staff_id: 'reviewer-1',
        application_id: null,
        safe_metadata_json: JSON.stringify({ kind: 'physical', result: 'success' })
    });
    assert.deepEqual({ ...audits[2] }, {
        event_type: 'staff.record_note_deleted',
        actor_type: 'staff',
        actor_staff_id: 'reviewer-1',
        application_id: onlineId,
        safe_metadata_json: JSON.stringify({ kind: 'online', result: 'success' })
    });
    for (const row of audits) {
        assert.doesNotMatch(row.safe_metadata_json, new RegExp(sensitiveNote));
    }

    // Denetim yazımı başarısız olduğunda fiziksel not değişikliği geri alınır
    database.exec(`
        CREATE TRIGGER reject_record_note_delete_audit
        BEFORE INSERT ON audit_events
        WHEN NEW.event_type = 'staff.record_note_deleted'
        BEGIN
            SELECT RAISE(ABORT, 'audit unavailable');
        END;
    `);
    const failedDelete = await worker.fetch(createRequest(`/api/staff/record-notes/physical/${physicalId}`, {
        method: 'DELETE', cookie
    }), environment);
    assert.equal(failedDelete.status, 500);
    assert.equal(database.prepare(`
        SELECT COUNT(*) AS count FROM staff_record_notes
        WHERE record_kind = 'physical' AND record_id = ?
    `).bind(physicalId).first().count, 1);
});
