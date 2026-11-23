import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { createD1Repositories } from '../src/server/repositories/d1/index.js';
import {
    planStaffApplicationFieldChanges,
    validateStaffApplicationFieldEditBody
} from '../src/server/domain/staffApplicationFieldEdit.js';
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

let syntheticSeedCounter = 0;

async function seedOnlineApplication(database, {
    id = crypto.randomUUID(),
    studentNumber = `T${String(++syntheticSeedCounter).padStart(4, '0')}`,
    status = 'under_review',
    applicationType = 'initial',
    applicationRoute = 'standard',
    referenceNumber = null,
    firstName = 'Test',
    lastName = 'Öğrenci',
    studentEmail = 'test.ogrenci@example.test',
    studentPhone = '+905551112233',
    passportNumber = `TP${String(syntheticSeedCounter).padStart(4, '0')}`,
    nationality = 'Testland',
    dateOfBirth = '2000-05-15',
    residenceApplicationDate = '2026-11-10',
    isUnder18 = 0,
    lockVersion = 1,
    updatedAt = '2026-11-10T09:00:00.000Z',
    accessCodeHash = 'b'.repeat(64),
    transitionForeignId = null,
    transitionCardSerial = null,
    transitionCardNumber = null
} = {}) {
    const studentId = `student-${id}`;
    await database.prepare(`
        INSERT INTO students (id, student_number, normalized_student_number)
        VALUES (?, ?, ?)
    `).bind(studentId, studentNumber, studentNumber.toUpperCase()).run();
    await database.prepare(`
        INSERT INTO applications (
            id, student_id, application_type, application_route, status, is_under_18,
            address_evidence_type, document_policy_version, reference_number,
            access_code_hash, access_code_version, lock_version,
            first_name, last_name, student_email, student_phone,
            passport_number, nationality, date_of_birth, residence_application_date,
            transition_foreign_id, transition_card_serial, transition_card_number,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'rental_contract', 1, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        id, studentId, applicationType, applicationRoute, status, isUnder18,
        referenceNumber, accessCodeHash, lockVersion,
        firstName, lastName, studentEmail, studentPhone,
        passportNumber, nationality, dateOfBirth, residenceApplicationDate,
        transitionForeignId, transitionCardSerial, transitionCardNumber,
        updatedAt
    ).run();
    return id;
}

async function seedOwnerSession(database, applicationId, token = 'owner-session-token-000000000000000000000') {
    await database.prepare(`
        INSERT INTO application_sessions (id, application_id, token_hash, expires_at)
        VALUES (?, ?, ?, '2099-01-01T00:00:00.000Z')
    `).bind(crypto.randomUUID(), applicationId, await hashSessionToken(token)).run();
    return `application_session=${token}`;
}

test('PATCH updates multiple applicant fields, increments lock_version, exposes lock_version on GET, and supports reviewer and admin', async () => {
    const { environment, database } = createEnvironment();
    const applicationId = await seedOnlineApplication(database, {
        id: 'app-multi-1',
        studentNumber: 'T1001',
        referenceNumber: 'ITU-7K9M-4X2P',
        status: 'submitted'
    });
    const reviewerCookie = await seedStaff(environment, database, {
        id: 'reviewer-1',
        username: 'reviewer-1',
        role: 'reviewer',
        lastSeenAt: '2026-11-20T10:14:00.000Z'
    });

    const initialGet = await withFixedDate('2026-11-20T10:14:00.000Z', async () => {
        return worker.fetch(createRequest(`/api/staff/applications/${applicationId}`, {
            cookie: reviewerCookie
        }), environment);
    });
    assert.equal(initialGet.status, 200);
    const initialDetail = await initialGet.json();
    assert.equal(initialDetail.application.lock_version, 1);

    const patchTime = '2026-11-20T10:15:00.000Z';
    const response = await withFixedDate(patchTime, async () => {
        return worker.fetch(createRequest(`/api/staff/applications/${applicationId}`, {
            method: 'PATCH',
            cookie: reviewerCookie,
            body: {
                lock_version: 1,
                fields: {
                    first_name: '  Yeni Ad  ',
                    last_name: '  Yeni Soyad  ',
                    email: '  yeni.ad@example.test  ',
                    phone: '  0555 222 33 44  ',
                    passport_number: '  tp 9001/a  ',
                    nationality: '  Deneme Ülkesi  ',
                    date_of_birth: '2001-06-20',
                    residence_application_date: '2026-11-18'
                }
            }
        }), environment);
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.changed_fields, [
        'date_of_birth',
        'email',
        'first_name',
        'last_name',
        'nationality',
        'passport_number',
        'phone',
        'residence_application_date'
    ]);
    assert.equal(payload.application.lock_version, 2);
    assert.equal(payload.application.updated_at, patchTime);
    assert.equal(payload.application.first_name, 'Yeni Ad');
    assert.equal(payload.application.last_name, 'Yeni Soyad');
    assert.equal(payload.application.email, 'yeni.ad@example.test');
    assert.equal(payload.application.phone, '0555 222 33 44');
    assert.equal(payload.application.passport_number, 'TP 9001/A');
    assert.equal(payload.application.nationality, 'Deneme Ülkesi');
    assert.equal(payload.application.date_of_birth, '2001-06-20');
    assert.equal(payload.application.residence_application_date, '2026-11-18');
    assert.equal(payload.application.reference_number, 'ITU-7K9M-4X2P');

    // İkinci düzenleme admin rolü ile lock_version=2 üzerinden yapılabilmeli
    const adminCookie = await seedStaff(environment, database, {
        id: 'admin-1',
        username: 'admin-1',
        token: 'admin-session-token-000000000000000000000',
        role: 'admin'
    });
    const adminPatch = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}`, {
        method: 'PATCH',
        cookie: adminCookie,
        body: {
            lock_version: 2,
            fields: { nationality: 'Güncel Ülke' }
        }
    }), environment);
    assert.equal(adminPatch.status, 200);
    const adminPayload = await adminPatch.json();
    assert.equal(adminPayload.application.lock_version, 3);
    assert.deepEqual(adminPayload.changed_fields, ['nationality']);

    const afterGet = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}`, {
        cookie: adminCookie
    }), environment);
    assert.equal(afterGet.status, 200);
    assert.equal((await afterGet.json()).application.lock_version, 3);
});

test('correcting student_number updates students row, findByReferenceNumber, and public access flow while leaving credentials intact', async () => {
    const { environment, database } = createEnvironment();
    const applicationId = await seedOnlineApplication(database, {
        id: 'app-stu-fix-1',
        studentNumber: 'TEST-YANLIS-NO',
        referenceNumber: 'ITU-7K9M-4X2P',
        accessCodeHash: 'c'.repeat(64)
    });
    const ownerCookie = await seedOwnerSession(database, applicationId, 'owner-session-keep-000000000000000000000');
    const staffCookie = await seedStaff(environment, database);

    const response = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}`, {
        method: 'PATCH',
        cookie: staffCookie,
        body: {
            lock_version: 1,
            fields: { student_number: '  t2026_01  ' }
        }
    }), environment);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.changed_fields, ['student_number']);
    assert.equal(payload.application.student_number, 'T2026_01');
    assert.equal(payload.application.lock_version, 2);

    const studentRow = database.prepare(`
        SELECT student_number, normalized_student_number
        FROM students WHERE id = ?
    `).bind(`student-${applicationId}`).first();
    assert.deepEqual({ ...studentRow }, {
        student_number: 'T2026_01',
        normalized_student_number: 'T2026_01'
    });

    const appRow = database.prepare(`
        SELECT access_code_hash, access_code_version, reference_number
        FROM applications WHERE id = ?
    `).bind(applicationId).first();
    assert.equal(appRow.access_code_hash, 'c'.repeat(64));
    assert.equal(appRow.access_code_version, 1);
    assert.equal(appRow.reference_number, 'ITU-7K9M-4X2P');

    const repositories = createD1Repositories(database);
    const foundByRef = await repositories.applications.findByReferenceNumber('ITU-7K9M-4X2P');
    assert.equal(foundByRef.student_number, 'T2026_01');

    // Eski öğrenci numarası ile erişim reddedilir
    const oldAccess = await worker.fetch(createRequest('/api/public/applications/access', {
        method: 'POST',
        body: { reference_number: 'ITU-7K9M-4X2P', student_number: 'TEST-YANLIS-NO' }
    }), environment);
    assert.equal(oldAccess.status, 401);
    assert.equal((await oldAccess.json()).error.code, 'INVALID_CREDENTIALS');

    // Yeni öğrenci numarası ile erişim 200 döner
    const newAccess = await worker.fetch(createRequest('/api/public/applications/access', {
        method: 'POST',
        body: { reference_number: 'ITU-7K9M-4X2P', student_number: 't2026_01' }
    }), environment);
    assert.equal(newAccess.status, 200);
    const accessPayload = await newAccess.json();
    assert.equal(accessPayload.success, true);
    assert.equal(accessPayload.application.student_number, 'T2026_01');

    // Mevcut öğrenci oturumu korunur
    const currentRes = await worker.fetch(createRequest('/api/public/applications/current', {
        cookie: ownerCookie
    }), environment);
    assert.equal(currentRes.status, 200);
    assert.equal((await currentRes.json()).application.student_number, 'T2026_01');
});

test('student_number rejects spaces, Turkish letters, name-like strings, and duplicate student numbers', async () => {
    const { environment, database } = createEnvironment();
    const firstId = await seedOnlineApplication(database, {
        id: 'app-stu-val-1',
        studentNumber: 'T1001'
    });
    await seedOnlineApplication(database, {
        id: 'app-stu-val-2',
        studentNumber: 'T1002'
    });
    const cookie = await seedStaff(environment, database);

    for (const invalidStudentNumber of ['Test Öğrenci', 'T 1001', 'ÖĞR1001', '', '   ', 'A'.repeat(65), 'T1001\u200b']) {
        const res = await worker.fetch(createRequest(`/api/staff/applications/${firstId}`, {
            method: 'PATCH',
            cookie,
            body: { lock_version: 1, fields: { student_number: invalidStudentNumber } }
        }), environment);
        assert.equal(res.status, 400, `Expected 400 for student_number=${JSON.stringify(invalidStudentNumber)}`);
        assert.equal((await res.json()).error.code, 'VALIDATION_ERROR');
    }

    const duplicate = await worker.fetch(createRequest(`/api/staff/applications/${firstId}`, {
        method: 'PATCH',
        cookie,
        body: { lock_version: 1, fields: { student_number: 't1002' } }
    }), environment);
    assert.equal(duplicate.status, 409);
    const duplicateJson = await duplicate.json();
    assert.equal(duplicateJson.error.code, 'STUDENT_NUMBER_IN_USE');
    assert.equal(duplicateJson.error.message, 'Bu öğrenci numarası başka bir kayıtta kullanılıyor.');
    assert.equal(database.prepare('SELECT student_id FROM applications WHERE id = ?').bind(firstId).first().student_id, `student-${firstId}`);
    assert.equal(database.prepare('SELECT student_number FROM students WHERE id = ?').bind(`student-${firstId}`).first().student_number, 'T1001');
});

test('lock_version mismatch returns 409 APPLICATION_UPDATE_CONFLICT without modifying DB', async () => {
    const { environment, database } = createEnvironment();
    const applicationId = await seedOnlineApplication(database, {
        id: 'app-lock-1',
        firstName: 'Başlangıç',
        lockVersion: 3
    });
    const cookie = await seedStaff(environment, database);

    const conflict = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}`, {
        method: 'PATCH',
        cookie,
        body: { lock_version: 2, fields: { first_name: 'Değişmemeli' } }
    }), environment);
    assert.equal(conflict.status, 409);
    const json = await conflict.json();
    assert.equal(json.error.code, 'APPLICATION_UPDATE_CONFLICT');
    assert.equal(json.error.message, 'Başvuru başka biri tarafından güncellendi. Sayfayı yenileyip tekrar deneyin.');

    const stored = database.prepare('SELECT first_name, lock_version FROM applications WHERE id = ?').bind(applicationId).first();
    assert.equal(stored.first_name, 'Başlangıç');
    assert.equal(stored.lock_version, 3);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM audit_events').first().count, 0);
});

test('record status and deletion rules enforce 409 for draft/terminal, 404 for deleted/missing, and 200 for all active statuses', async () => {
    const { environment, database } = createEnvironment();
    const cookie = await seedStaff(environment, database);

    for (const blockedStatus of ['draft', 'completed', 'cancelled', 'rejected']) {
        const id = await seedOnlineApplication(database, { status: blockedStatus });
        const res = await worker.fetch(createRequest(`/api/staff/applications/${id}`, {
            method: 'PATCH',
            cookie,
            body: { lock_version: 1, fields: { first_name: 'Deneme' } }
        }), environment);
        assert.equal(res.status, 409, `Expected 409 for status=${blockedStatus}`);
        assert.equal((await res.json()).error.code, 'APPLICATION_NOT_EDITABLE');
    }

    for (const deletionState of ['soft_deleted', 'purge_pending']) {
        const deletedId = await seedOnlineApplication(database, { status: 'under_review' });
        await database.prepare(`
            INSERT INTO application_deletions (application_id, previous_status, state, deleted_by_staff_id, deleted_at)
            VALUES (?, 'under_review', ?, 'reviewer-1', '2026-11-15T10:00:00.000Z')
        `).bind(deletedId, deletionState).run();
        const res = await worker.fetch(createRequest(`/api/staff/applications/${deletedId}`, {
            method: 'PATCH',
            cookie,
            body: { lock_version: 1, fields: { first_name: 'Deneme' } }
        }), environment);
        assert.equal(res.status, 404, `Expected 404 for deletion state=${deletionState}`);
        assert.equal((await res.json()).error.code, 'APPLICATION_NOT_FOUND');
    }

    const missing = await worker.fetch(createRequest('/api/staff/applications/nonexistent-app-id', {
        method: 'PATCH',
        cookie,
        body: { lock_version: 1, fields: { first_name: 'Deneme' } }
    }), environment);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'APPLICATION_NOT_FOUND');

    for (const editableStatus of [
        'submitted',
        'under_review',
        'resubmission_required',
        'approved_for_processing',
        'sent_to_migration',
        'migration_approved'
    ]) {
        const id = await seedOnlineApplication(database, { status: editableStatus, firstName: 'Eski' });
        const res = await worker.fetch(createRequest(`/api/staff/applications/${id}`, {
            method: 'PATCH',
            cookie,
            body: { lock_version: 1, fields: { first_name: 'Güncel' } }
        }), environment);
        assert.equal(res.status, 200, `Expected 200 for editable status=${editableStatus}`);
        assert.equal((await res.json()).application.first_name, 'Güncel');
    }
});

test('PATCH requires same-origin, valid staff session, and reviewer or admin role', async () => {
    const { environment, database } = createEnvironment();
    const applicationId = await seedOnlineApplication(database, { id: 'app-sec-1' });
    const ownerCookie = await seedOwnerSession(database, applicationId);
    const staffCookie = await seedStaff(environment, database);

    // Oturumsuz ve öğrenci oturumu -> 401
    for (const cookie of [undefined, ownerCookie]) {
        const res = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}`, {
            method: 'PATCH',
            cookie,
            body: { lock_version: 1, fields: { first_name: 'Yetkisiz' } }
        }), environment);
        assert.equal(res.status, 401);
        assert.equal((await res.json()).error.code, 'UNAUTHORIZED');
    }

    // Same-origin yoksa veya farklı origin ise -> 403 CROSS_ORIGIN_REQUEST
    for (const origin of [null, 'https://attacker.test']) {
        const res = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}`, {
            method: 'PATCH',
            cookie: staffCookie,
            origin,
            body: { lock_version: 1, fields: { first_name: 'Köken' } }
        }), environment);
        assert.equal(res.status, 403);
        assert.equal((await res.json()).error.code, 'CROSS_ORIGIN_REQUEST');
    }

    // Yanlış personel rolü -> 403 FORBIDDEN
    const originalPrepare = database.prepare.bind(database);
    const wrappedEnv = {
        ...environment,
        DB: {
            prepare(sql) {
                const stmt = originalPrepare(sql);
                if (!sql.includes('FROM staff_sessions')) return stmt;
                return {
                    bind(...values) {
                        const bound = stmt.bind(...values);
                        return {
                            first() {
                                const row = bound.first();
                                return row ? { ...row, role: 'read_only' } : null;
                            },
                            all() { return bound.all(); },
                            run() { return bound.run(); }
                        };
                    }
                };
            }
        }
    };
    const wrongRole = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}`, {
        method: 'PATCH',
        cookie: staffCookie,
        body: { lock_version: 1, fields: { first_name: 'SaltOkunur' } }
    }), wrappedEnv);
    assert.equal(wrongRole.status, 403);
    assert.equal((await wrongRole.json()).error.code, 'FORBIDDEN');

    // Desteklenmeyen HTTP yöntemi -> 405 METHOD_NOT_ALLOWED
    const wrongMethod = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}`, {
        method: 'DELETE',
        cookie: staffCookie
    }), environment);
    assert.equal(wrongMethod.status, 405);
    assert.equal((await wrongMethod.json()).error.code, 'METHOD_NOT_ALLOWED');
});

test('request validation rejects unknown keys, forbidden fields, invalid field values, control chars, and invisible format chars with 400', async () => {
    const { environment, database } = createEnvironment();
    const applicationId = await seedOnlineApplication(database, {
        id: 'app-val-1',
        applicationRoute: 'transition'
    });
    const cookie = await seedStaff(environment, database);

    const invalidBodies = [
        {},
        { lock_version: 1 },
        { fields: { first_name: 'Test' } },
        { lock_version: 1, fields: { first_name: 'Test' }, extra: true },
        { lock_version: 0, fields: { first_name: 'Test' } },
        { lock_version: '1', fields: { first_name: 'Test' } },
        { lock_version: 1, fields: {} },
        { lock_version: 1, fields: { unknown_field: 'değer' } },
        // Hiçbir zaman düzenlenemeyen alanlar
        { lock_version: 1, fields: { status: 'completed' } },
        { lock_version: 1, fields: { application_type: 'renewal' } },
        { lock_version: 1, fields: { application_route: 'standard' } },
        { lock_version: 1, fields: { is_under_18: true } },
        { lock_version: 1, fields: { address_evidence_type: 'dormitory' } },
        { lock_version: 1, fields: { accommodation_type: 'dormitory' } },
        { lock_version: 1, fields: { host_is_married: 'yes' } },
        { lock_version: 1, fields: { minor_family_status: 'both_parents' } },
        { lock_version: 1, fields: { insurance_basis: 'system_verified' } },
        { lock_version: 1, fields: { transition_contact_preference: 'email' } },
        { lock_version: 1, fields: { transition_change_province: 'no' } },
        { lock_version: 1, fields: { fingerprint_status: 'registered' } },
        { lock_version: 1, fields: { fingerprint_code: 'FP-1' } },
        { lock_version: 1, fields: { reference_number: 'ITU-2345-6789' } },
        { lock_version: 1, fields: { declaration_version: 'v2' } },
        { lock_version: 1, fields: { academic_year_start_date: '2026-09-01' } },
        // Alan değeri doğrulama ihlalleri
        { lock_version: 1, fields: { first_name: 'Test2' } },
        { lock_version: 1, fields: { first_name: '---' } },
        { lock_version: 1, fields: { last_name: '123' } },
        { lock_version: 1, fields: { first_name: 'Test\u0000Ad' } },
        { lock_version: 1, fields: { first_name: 'Test\u200bAd' } },
        { lock_version: 1, fields: { last_name: 'Test\ufeffSoyad' } },
        { lock_version: 1, fields: { email: 'gecersiz-eposta' } },
        { lock_version: 1, fields: { phone: 'telefon-yok' } },
        { lock_version: 1, fields: { phone: '+90 555 111 22 33 44 55 66' } },
        { lock_version: 1, fields: { phone: '0555\t1112233' } },
        { lock_version: 1, fields: { passport_number: '-INVALID' } },
        { lock_version: 1, fields: { passport_number: 'AB@123' } },
        { lock_version: 1, fields: { nationality: '   ' } },
        { lock_version: 1, fields: { date_of_birth: '2000-02-30' } },
        { lock_version: 1, fields: { date_of_birth: '2099-01-01' } },
        { lock_version: 1, fields: { date_of_birth: '1850-01-01' } },
        { lock_version: 1, fields: { residence_application_date: null } },
        { lock_version: 1, fields: { residence_application_date: '' } },
        { lock_version: 1, fields: { residence_application_date: '2026-02-30' } },
        { lock_version: 1, fields: { residence_application_date: '2099-01-01' } },
        { lock_version: 1, fields: { transition_foreign_id: '' } },
        { lock_version: 1, fields: { transition_card_serial: '   ' } },
        { lock_version: 1, fields: { transition_card_number: 'A'.repeat(256) } }
    ];

    for (const body of invalidBodies) {
        const res = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}`, {
            method: 'PATCH',
            cookie,
            body
        }), environment);
        assert.equal(res.status, 400, `Expected 400 for body=${JSON.stringify(body)}`);
        assert.equal((await res.json()).error.code, 'VALIDATION_ERROR');
    }

    // 12'den fazla anahtar reddedilir (birim doğrulayıcı testi)
    const thirteenKeys = Object.fromEntries(Array.from({ length: 13 }, (_, index) => [`field_${index}`, 'x']));
    assert.throws(
        () => validateStaffApplicationFieldEditBody({ lock_version: 1, fields: thirteenKeys }, { today: '2026-11-20' }),
        (error) => error.status === 400 && error.code === 'VALIDATION_ERROR'
    );
});

test('transition fields return 409 FIELD_NOT_APPLICABLE on standard applications and succeed on transition applications', async () => {
    const { environment, database } = createEnvironment();
    const standardId = await seedOnlineApplication(database, {
        id: 'app-std-1',
        applicationRoute: 'standard'
    });
    const transitionId = await seedOnlineApplication(database, {
        id: 'app-trn-1',
        applicationType: 'renewal',
        applicationRoute: 'transition',
        transitionForeignId: '99112233445',
        transitionCardSerial: 'TR01',
        transitionCardNumber: '123456'
    });
    const cookie = await seedStaff(environment, database);

    for (const field of ['transition_foreign_id', 'transition_card_serial', 'transition_card_number']) {
        const blocked = await worker.fetch(createRequest(`/api/staff/applications/${standardId}`, {
            method: 'PATCH',
            cookie,
            body: { lock_version: 1, fields: { [field]: '12345' } }
        }), environment);
        assert.equal(blocked.status, 409);
        assert.equal((await blocked.json()).error.code, 'FIELD_NOT_APPLICABLE');
    }

    const updated = await worker.fetch(createRequest(`/api/staff/applications/${transitionId}`, {
        method: 'PATCH',
        cookie,
        body: {
            lock_version: 1,
            fields: {
                transition_foreign_id: '  99887766554  ',
                transition_card_serial: '  TR02  ',
                transition_card_number: '  654321  '
            }
        }
    }), environment);
    assert.equal(updated.status, 200);
    const payload = await updated.json();
    assert.deepEqual(payload.changed_fields, [
        'transition_card_number',
        'transition_card_serial',
        'transition_foreign_id'
    ]);
    assert.equal(payload.application.transition_foreign_id, '99887766554');
    assert.equal(payload.application.transition_card_serial, 'TR02');
    assert.equal(payload.application.transition_card_number, '654321');
});

test('document policy guard blocks birth or residence date edits that flip is_under_18 without writing any field', async () => {
    const { environment, database } = createEnvironment();
    const adultAppId = await seedOnlineApplication(database, {
        id: 'app-age-adult-1',
        firstName: 'Başlangıç',
        dateOfBirth: '2000-01-10',
        residenceApplicationDate: '2026-11-10',
        isUnder18: 0
    });
    const borderAppId = await seedOnlineApplication(database, {
        id: 'app-age-border-1',
        dateOfBirth: '2008-11-15',
        residenceApplicationDate: '2026-11-10',
        isUnder18: 1
    });
    const cookie = await seedStaff(environment, database, { lastSeenAt: '2026-11-20T09:59:00.000Z' });

    // 18+ olan başvurunun doğum tarihini 18 yaş altına çekmek + başka alan göndermek: tüm istek reddedilir, hiçbir alan yazılmaz
    const blockedDob = await withFixedDate('2026-11-20T10:00:00.000Z', async () => {
        return worker.fetch(createRequest(`/api/staff/applications/${adultAppId}`, {
            method: 'PATCH',
            cookie,
            body: {
                lock_version: 1,
                fields: {
                    first_name: 'Yazılmamalı',
                    date_of_birth: '2012-03-01'
                }
            }
        }), environment);
    });
    assert.equal(blockedDob.status, 409);
    const dobJson = await blockedDob.json();
    assert.equal(dobJson.error.code, 'POLICY_FIELD_CHANGE_BLOCKED');
    assert.equal(
        dobJson.error.message,
        'Bu değişiklik 18 yaş durumunu değiştirir ve belge listesini etkiler; bu alan için ayrı onay gerekir.'
    );
    const untouchedAdult = database.prepare('SELECT first_name, date_of_birth, is_under_18, lock_version FROM applications WHERE id = ?')
        .bind(adultAppId).first();
    assert.deepEqual({ ...untouchedAdult }, {
        first_name: 'Başlangıç',
        date_of_birth: '2000-01-10',
        is_under_18: 0,
        lock_version: 1
    });

    // İkamet başvuru tarihini değiştirip 18 yaş sınırını aşmak da engellenir
    const blockedResidenceDate = await withFixedDate('2026-11-20T10:00:00.000Z', async () => {
        return worker.fetch(createRequest(`/api/staff/applications/${borderAppId}`, {
            method: 'PATCH',
            cookie,
            body: {
                lock_version: 1,
                fields: { residence_application_date: '2026-11-18' }
            }
        }), environment);
    });
    assert.equal(blockedResidenceDate.status, 409);
    assert.equal((await blockedResidenceDate.json()).error.code, 'POLICY_FIELD_CHANGE_BLOCKED');

    // Aynı yaş grubu içinde kalan doğum tarihi düzeltmesi izinli ve is_under_18 değişmez
    const allowedDob = await withFixedDate('2026-11-20T10:00:00.000Z', async () => {
        return worker.fetch(createRequest(`/api/staff/applications/${adultAppId}`, {
            method: 'PATCH',
            cookie,
            body: {
                lock_version: 1,
                fields: { date_of_birth: '2001-01-10' }
            }
        }), environment);
    });
    assert.equal(allowedDob.status, 200);
    const allowedPayload = await allowedDob.json();
    assert.equal(allowedPayload.application.date_of_birth, '2001-01-10');
    assert.equal(allowedPayload.application.is_under_18, false);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM audit_events').first().count, 1);

    // Saf planlayıcı da doğum tarihinden önceki başvuru tarihini 400 ile reddeder
    assert.throws(
        () => planStaffApplicationFieldChanges({
            application: { date_of_birth: '2000-05-01', residence_application_date: '2026-11-10', is_under_18: 0, application_route: 'standard' },
            validatedFields: { residence_application_date: '1999-01-01' },
            today: '2026-11-20'
        }),
        (error) => error.status === 400 && error.code === 'VALIDATION_ERROR'
    );
});

test('audit row records only changedFields without PII values, and audit failure rolls back both applications and students', async () => {
    const { environment, database } = createEnvironment();
    const applicationId = await seedOnlineApplication(database, {
        id: 'app-audit-1',
        studentNumber: 'OLDNO1',
        firstName: 'EskiAd',
        lastName: 'EskiSoyad'
    });
    const cookie = await seedStaff(environment, database);

    const updated = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}`, {
        method: 'PATCH',
        cookie,
        body: {
            lock_version: 1,
            fields: {
                first_name: 'YeniAdSentetik',
                last_name: 'YeniSoyadSentetik',
                student_number: 'NEWNO1'
            }
        }
    }), environment);
    assert.equal(updated.status, 200);

    const auditRow = database.prepare(`
        SELECT event_type, actor_type, actor_staff_id, application_id, safe_metadata_json
        FROM audit_events
        WHERE event_type = 'staff.application_fields_corrected'
    `).first();
    assert.deepEqual({ ...auditRow }, {
        event_type: 'staff.application_fields_corrected',
        actor_type: 'staff',
        actor_staff_id: 'reviewer-1',
        application_id: applicationId,
        safe_metadata_json: JSON.stringify({ changedFields: 'first_name,last_name,student_number' })
    });
    assert.doesNotMatch(auditRow.safe_metadata_json, /EskiAd|EskiSoyad|OLDNO1|YeniAdSentetik|YeniSoyadSentetik|NEWNO1/);

    // Audit insert hata verdiğinde applications ve students birlikte geri alınmalı
    database.exec(`
        CREATE TRIGGER reject_field_edit_audit
        BEFORE INSERT ON audit_events
        WHEN NEW.event_type = 'staff.application_fields_corrected'
        BEGIN
            SELECT RAISE(ABORT, 'audit unavailable');
        END;
    `);
    const failed = await worker.fetch(createRequest(`/api/staff/applications/${applicationId}`, {
        method: 'PATCH',
        cookie,
        body: {
            lock_version: 2,
            fields: {
                first_name: 'GeriAlinmali',
                student_number: 'ROLLED99'
            }
        }
    }), environment);
    assert.equal(failed.status, 500);
    const appAfterRollback = database.prepare('SELECT first_name, lock_version FROM applications WHERE id = ?')
        .bind(applicationId).first();
    assert.deepEqual({ ...appAfterRollback }, { first_name: 'YeniAdSentetik', lock_version: 2 });
    const studentAfterRollback = database.prepare('SELECT student_number, normalized_student_number FROM students WHERE id = ?')
        .bind(`student-${applicationId}`).first();
    assert.deepEqual({ ...studentAfterRollback }, { student_number: 'NEWNO1', normalized_student_number: 'NEWNO1' });
});

test('no-op PATCH returns 200 with empty changed_fields and writes neither DB updates nor audit events', async () => {
    const { environment, database } = createEnvironment();
    const initialUpdatedAt = '2026-11-10T09:00:00.000Z';
    const applicationId = await seedOnlineApplication(database, {
        id: 'app-noop-1',
        studentNumber: 'T5555',
        firstName: 'Test',
        lastName: 'Öğrenci',
        passportNumber: 'TP5555',
        lockVersion: 2,
        updatedAt: initialUpdatedAt
    });
    const cookie = await seedStaff(environment, database, { lastSeenAt: '2026-11-20T11:59:00.000Z' });

    const response = await withFixedDate('2026-11-20T12:00:00.000Z', async () => {
        return worker.fetch(createRequest(`/api/staff/applications/${applicationId}`, {
            method: 'PATCH',
            cookie,
            body: {
                lock_version: 2,
                fields: {
                    student_number: '  t5555  ',
                    first_name: '  Test  ',
                    last_name: 'Öğrenci',
                    passport_number: ' tp5555 '
                }
            }
        }), environment);
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.changed_fields, []);
    assert.equal(payload.application.lock_version, 2);
    assert.equal(payload.application.updated_at, initialUpdatedAt);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM audit_events').first().count, 0);
});
