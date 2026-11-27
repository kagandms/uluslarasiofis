import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateApplicationReference } from '../src/server/auth/applicationAccessCode.js';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { getIstanbulTodayIso, shiftIsoCalendarDate } from '../src/server/domain/yoksisAuditPolicy.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const ORIGIN = 'https://portal.test';

function createEnvironment() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const objects = new Map();
    const environment = {
        DB: database,
        APP_ENV: 'test',
        STAFF_SHARED_USERNAME: 'reviewer-1',
        DOCUMENTS: {
            async head(key) { return objects.get(key) ?? null; },
            async put(key, body, options = {}) {
                objects.set(key, { size: body.byteLength, etag: `etag-${key}`, httpMetadata: options.httpMetadata ?? {} });
            },
            async get(key) {
                return objects.has(key) ? { body: new Response('doc').body, size: objects.get(key).size } : null;
            },
            async delete(key) { objects.delete(key); }
        }
    };
    return { database, environment };
}

function makeRequest(path, { method = 'GET', body, cookie, origin = ORIGIN } = {}) {
    const headers = new Headers({ Origin: origin });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (cookie) headers.set('Cookie', cookie);
    return new Request(`${ORIGIN}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
}

async function callApi(environment, path, options = {}) {
    const response = await worker.fetch(makeRequest(path, options), environment, {});
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    return { response, json };
}

async function seedStaff(environment, database, {
    id = 'reviewer-1',
    token = 'reviewer-session-token-00000000000000000000',
    role = 'reviewer'
} = {}) {
    environment.STAFF_SHARED_USERNAME = id;
    await database.prepare(`
        INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES (?, ?, ?, 'test-hash', ?, ?)
    `).bind(id, id, id, `Staff ${id}`, role).run();
    await database.prepare(`
        INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at)
        VALUES (?, ?, ?, ?)
    `).bind(crypto.randomUUID(), id, await hashSessionToken(token), new Date(Date.now() + 600_000).toISOString()).run();
    return `staff_session=${token}`;
}

async function seedApplication(database, {
    id = crypto.randomUUID(),
    studentNumber,
    firstName = 'Ayşe',
    lastName = 'Yılmaz',
    status = 'sent_to_migration',
    referenceNumber = generateApplicationReference(),
    createdAt = new Date().toISOString(),
    updatedAt = new Date().toISOString()
} = {}) {
    const studentId = `student-${id}`;
    await database.prepare(`
        INSERT INTO students (id, student_number, normalized_student_number)
        VALUES (?, ?, ?)
    `).bind(studentId, studentNumber, studentNumber.trim().toUpperCase()).run();
    await database.prepare(`
        INSERT INTO applications (
            id, student_id, reference_number, application_type, status,
            first_name, last_name, is_under_18, address_evidence_type,
            document_policy_version, created_at, updated_at, submitted_at
        ) VALUES (?, ?, ?, 'initial', ?, ?, ?, 0, 'rental_contract', 1, ?, ?, ?)
    `).bind(id, studentId, referenceNumber, status, firstName, lastName, createdAt, updatedAt, createdAt).run();
    return { id, studentId, studentNumber, referenceNumber, updatedAt };
}

async function seedApplicationSession(database, applicationId, token = 'student-session-token-000000000000000000000') {
    await database.prepare(`
        INSERT INTO application_sessions (id, application_id, token_hash, expires_at)
        VALUES (?, ?, ?, ?)
    `).bind(crypto.randomUUID(), applicationId, await hashSessionToken(token), new Date(Date.now() + 3_600_000).toISOString()).run();
    return `application_session=${token}`;
}

async function importExcel(environment, cookie, {
    importId = `imp-${crypto.randomUUID().slice(0, 8)}`,
    exportedAt = '2026-11-27 10:00',
    final = true,
    rows
}) {
    const { response, json } = await callApi(environment, '/api/staff/yoksis-document-audit/import', {
        method: 'POST',
        cookie,
        body: { importId, exportedAt, final, rows }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(json.rejected, []);
    return { importId, json };
}

function makeExcelRow({
    applicationNumber,
    studentNumber,
    fullName,
    gocStatus,
    missingDeadline = null,
    missingNote = '',
    gocLastQueryAt = getIstanbulTodayIso(),
    recordDate = getIstanbulTodayIso()
}) {
    return {
        applicationNumber,
        studentNumber,
        fullName,
        unit: 'Mühendislik',
        program: 'Bilgisayar',
        processType: 'İlk Başvuru',
        transactionCount: 1,
        gocStatus,
        missingDeadline,
        missingNote,
        gocLastQueryAt,
        recordDate
    };
}

test('C01 each Excel status maps to the expected sync outcome (approved, missing_documents, reviewing, unqueried=no change)', async () => {
    const { database, environment } = createEnvironment();
    const staffCookie = await seedStaff(environment, database);

    const appApproved = await seedApplication(database, {
        id: 'app-c01-approved',
        studentNumber: '2601000001',
        firstName: 'Deniz',
        lastName: 'Kaya',
        status: 'sent_to_migration'
    });
    const appMissing = await seedApplication(database, {
        id: 'app-c01-missing',
        studentNumber: '2601000002',
        firstName: 'Elif',
        lastName: 'Demir',
        status: 'sent_to_migration'
    });
    const appClearMissing = await seedApplication(database, {
        id: 'app-c01-clear',
        studentNumber: '2601000003',
        firstName: 'Mert',
        lastName: 'Arslan',
        status: 'sent_to_migration'
    });
    await database.prepare(`
        INSERT INTO migration_office_states (
            record_kind, record_id, application_number, state, note, deadline,
            goc_last_query_at, import_id, updated_by_staff_id, updated_at
        ) VALUES ('online', ?, '2026-00-0000003', 'missing_documents', 'Eski eksik', '2026-12-01', '2026-11-10', 'imp-prev', 'reviewer-1', ?)
    `).bind(appClearMissing.id, new Date().toISOString()).run();

    const appReviewingNeedsAttention = await seedApplication(database, {
        id: 'app-c01-review',
        studentNumber: '2601000004',
        firstName: 'Zeynep',
        lastName: 'Çelik',
        status: 'under_review'
    });
    const appUnqueried = await seedApplication(database, {
        id: 'app-c01-unqueried',
        studentNumber: '2601000005',
        firstName: 'Can',
        lastName: 'Yıldız',
        status: 'sent_to_migration'
    });

    const { importId } = await importExcel(environment, staffCookie, {
        importId: 'imp-c01',
        rows: [
            makeExcelRow({
                applicationNumber: '2026-00-0000001',
                studentNumber: appApproved.studentNumber,
                fullName: 'Deniz Kaya',
                gocStatus: 'İşlem Tamamlandı'
            }),
            makeExcelRow({
                applicationNumber: '2026-00-0000002',
                studentNumber: appMissing.studentNumber,
                fullName: 'Elif Demir',
                gocStatus: 'Eksik Belge İstendi',
                missingNote: 'AKTİF ÖĞRENCİ BELGESİ',
                missingDeadline: '2026-12-20'
            }),
            makeExcelRow({
                applicationNumber: '2026-00-0000003',
                studentNumber: appClearMissing.studentNumber,
                fullName: 'Mert Arslan',
                gocStatus: 'İşlem Bekliyor'
            }),
            makeExcelRow({
                applicationNumber: '2026-00-0000004',
                studentNumber: appReviewingNeedsAttention.studentNumber,
                fullName: 'Zeynep Çelik',
                gocStatus: 'Değerlendirme Aşamasında'
            }),
            makeExcelRow({
                applicationNumber: '2026-00-0000005',
                studentNumber: appUnqueried.studentNumber,
                fullName: 'Can Yıldız',
                gocStatus: 'Sorgulanmadı'
            })
        ]
    });

    const preview = await callApi(environment, '/api/staff/yoksis-document-audit/sync/preview', {
        method: 'POST',
        cookie: staffCookie,
        body: {}
    });
    assert.equal(preview.response.status, 200);
    assert.equal(preview.json.import_id, importId);
    assert.equal(preview.json.manual.length, 0);

    const changeById = new Map(preview.json.changes.map((item) => [item.record_id, item]));
    assert.equal(changeById.get(appApproved.id)?.target_state, 'approved');
    assert.equal(changeById.get(appMissing.id)?.target_state, 'missing_documents');
    assert.equal(changeById.get(appMissing.id)?.note, 'AKTİF ÖĞRENCİ BELGESİ');
    assert.equal(changeById.get(appMissing.id)?.deadline, '2026-12-20');
    assert.equal(changeById.get(appClearMissing.id)?.target_state, 'reviewing');
    assert.equal(changeById.get(appClearMissing.id)?.reason, 'missing_documents_cleared');
    assert.equal(changeById.has(appUnqueried.id), false);

    assert.equal(preview.json.needsAttention.length, 1);
    assert.equal(preview.json.needsAttention[0].record_id, appReviewingNeedsAttention.id);
    assert.equal(preview.json.needsAttention[0].target_state, 'reviewing');
    assert.equal(preview.json.needsAttention[0].reason, 'not_sent_to_migration');

    const applyItems = [...preview.json.changes, ...preview.json.needsAttention].map((item) => ({
        record_kind: item.record_kind,
        record_id: item.record_id,
        application_number: item.application_number,
        version: item.version
    }));
    const apply = await callApi(environment, '/api/staff/yoksis-document-audit/sync/apply', {
        method: 'POST',
        cookie: staffCookie,
        body: { import_id: importId, items: applyItems }
    });
    assert.equal(apply.response.status, 200);
    assert.equal(apply.json.applied.length, 4);
    assert.deepEqual(apply.json.conflicts, []);

    const rowApproved = await database.prepare('SELECT status FROM applications WHERE id = ?').bind(appApproved.id).first();
    const stateApproved = await database.prepare("SELECT state FROM migration_office_states WHERE record_kind = 'online' AND record_id = ?").bind(appApproved.id).first();
    assert.equal(rowApproved.status, 'migration_approved');
    assert.equal(stateApproved.state, 'approved');

    const rowMissing = await database.prepare('SELECT status FROM applications WHERE id = ?').bind(appMissing.id).first();
    const stateMissing = await database.prepare("SELECT state, note, deadline FROM migration_office_states WHERE record_kind = 'online' AND record_id = ?").bind(appMissing.id).first();
    assert.equal(rowMissing.status, 'sent_to_migration');
    assert.equal(stateMissing.state, 'missing_documents');
    assert.equal(stateMissing.note, 'AKTİF ÖĞRENCİ BELGESİ');
    assert.equal(stateMissing.deadline, '2026-12-20');

    const rowClear = await database.prepare('SELECT status FROM applications WHERE id = ?').bind(appClearMissing.id).first();
    const stateClear = await database.prepare("SELECT state, note, deadline FROM migration_office_states WHERE record_kind = 'online' AND record_id = ?").bind(appClearMissing.id).first();
    assert.equal(rowClear.status, 'sent_to_migration');
    assert.equal(stateClear.state, 'reviewing');
    assert.equal(stateClear.note, '');
    assert.equal(stateClear.deadline, null);

    const rowReview = await database.prepare('SELECT status FROM applications WHERE id = ?').bind(appReviewingNeedsAttention.id).first();
    const stateReview = await database.prepare("SELECT state FROM migration_office_states WHERE record_kind = 'online' AND record_id = ?").bind(appReviewingNeedsAttention.id).first();
    assert.equal(rowReview.status, 'sent_to_migration');
    assert.equal(stateReview.state, 'reviewing');

    const rowUnqueried = await database.prepare('SELECT status FROM applications WHERE id = ?').bind(appUnqueried.id).first();
    const stateUnqueried = await database.prepare("SELECT state FROM migration_office_states WHERE record_kind = 'online' AND record_id = ?").bind(appUnqueried.id).first();
    assert.equal(rowUnqueried.status, 'sent_to_migration');
    assert.equal(stateUnqueried, null);
});

test('C02 application numbers with middle groups 00, 13, 99 are accepted and synced', async () => {
    const { database, environment } = createEnvironment();
    const staffCookie = await seedStaff(environment, database);

    const app00 = await seedApplication(database, { id: 'app-c02-00', studentNumber: '2602000001', firstName: 'Ali', lastName: 'Ak' });
    const app13 = await seedApplication(database, { id: 'app-c02-13', studentNumber: '2602000002', firstName: 'Veli', lastName: 'Gök' });
    const app99 = await seedApplication(database, { id: 'app-c02-99', studentNumber: '2602000003', firstName: 'Seda', lastName: 'Nur' });

    const { importId } = await importExcel(environment, staffCookie, {
        importId: 'imp-c02-mid',
        rows: [
            makeExcelRow({ applicationNumber: '2026-00-1000001', studentNumber: app00.studentNumber, fullName: 'Ali Ak', gocStatus: 'İşlem Tamamlandı' }),
            makeExcelRow({ applicationNumber: '2026-13-1000002', studentNumber: app13.studentNumber, fullName: 'Veli Gök', gocStatus: 'İşlem Tamamlandı' }),
            makeExcelRow({ applicationNumber: '2026-99-1000003', studentNumber: app99.studentNumber, fullName: 'Seda Nur', gocStatus: 'İşlem Tamamlandı' })
        ]
    });

    const preview = await callApi(environment, '/api/staff/yoksis-document-audit/sync/preview', {
        method: 'POST',
        cookie: staffCookie,
        body: {}
    });
    assert.equal(preview.response.status, 200);
    assert.equal(preview.json.changes.length, 3);
    assert.deepEqual(
        preview.json.changes.map((c) => c.application_number).sort(),
        ['2026-00-1000001', '2026-13-1000002', '2026-99-1000003']
    );

    const apply = await callApi(environment, '/api/staff/yoksis-document-audit/sync/apply', {
        method: 'POST',
        cookie: staffCookie,
        body: {
            import_id: importId,
            items: preview.json.changes.map((item) => ({
                record_kind: item.record_kind,
                record_id: item.record_id,
                application_number: item.application_number,
                version: item.version
            }))
        }
    });
    assert.equal(apply.response.status, 200);
    assert.equal(apply.json.applied.length, 3);
});

test('C02 record_date 29 and 30 days older pass date guard; 31 days older and empty go to manual', async () => {
    const { database, environment } = createEnvironment();
    const staffCookie = await seedStaff(environment, database);

    const portalCreatedAtUtc = '2026-11-27T07:00:00.000Z';
    const portalDateIstanbul = '2026-11-27';

    const app29 = await seedApplication(database, { id: 'app-c02-29', studentNumber: '2602000029', firstName: 'Ece', lastName: 'Tan', createdAt: portalCreatedAtUtc });
    const app30 = await seedApplication(database, { id: 'app-c02-30', studentNumber: '2602000030', firstName: 'Cem', lastName: 'Tan', createdAt: portalCreatedAtUtc });
    const app31 = await seedApplication(database, { id: 'app-c02-31', studentNumber: '2602000031', firstName: 'Ege', lastName: 'Tan', createdAt: portalCreatedAtUtc });
    const appEmpty = await seedApplication(database, { id: 'app-c02-empty', studentNumber: '2602000032', firstName: 'Ada', lastName: 'Tan', createdAt: portalCreatedAtUtc });

    await importExcel(environment, staffCookie, {
        importId: 'imp-c02-dates',
        rows: [
            makeExcelRow({
                applicationNumber: '2026-00-2000029',
                studentNumber: app29.studentNumber,
                fullName: 'Ece Tan',
                gocStatus: 'İşlem Tamamlandı',
                recordDate: shiftIsoCalendarDate(portalDateIstanbul, -29)
            }),
            makeExcelRow({
                applicationNumber: '2026-00-2000030',
                studentNumber: app30.studentNumber,
                fullName: 'Cem Tan',
                gocStatus: 'İşlem Tamamlandı',
                recordDate: shiftIsoCalendarDate(portalDateIstanbul, -30)
            }),
            makeExcelRow({
                applicationNumber: '2026-00-2000031',
                studentNumber: app31.studentNumber,
                fullName: 'Ege Tan',
                gocStatus: 'İşlem Tamamlandı',
                recordDate: shiftIsoCalendarDate(portalDateIstanbul, -31)
            }),
            makeExcelRow({
                applicationNumber: '2026-00-2000032',
                studentNumber: appEmpty.studentNumber,
                fullName: 'Ada Tan',
                gocStatus: 'İşlem Tamamlandı',
                recordDate: null
            })
        ]
    });

    const preview = await callApi(environment, '/api/staff/yoksis-document-audit/sync/preview', {
        method: 'POST',
        cookie: staffCookie,
        body: {}
    });
    assert.equal(preview.response.status, 200);
    assert.deepEqual(
        preview.json.changes.map((c) => c.record_id).sort(),
        [app29.id, app30.id].sort()
    );

    const manualById = new Map(preview.json.manual.map((m) => [m.record_id, m]));
    assert.equal(manualById.get(app31.id)?.reason, 'older_application');
    assert.equal(manualById.get(appEmpty.id)?.reason, 'missing_record_date');
});

test('C03 short name matches; open different name and single word go to nameCheck while protected goes to manual', async () => {
    const { database, environment } = createEnvironment();
    const staffCookie = await seedStaff(environment, database);

    const appShort = await seedApplication(database, { id: 'app-c03-short', studentNumber: '2603000001', firstName: 'Ayşe Fatma', lastName: 'Yılmaz' });
    const appDiff = await seedApplication(database, { id: 'app-c03-diff', studentNumber: '2603000002', firstName: 'Mehmet', lastName: 'Demir' });
    const appSingle = await seedApplication(database, { id: 'app-c03-single', studentNumber: '2603000003', firstName: 'Ali', lastName: 'Kaya' });
    const appClosed = await seedApplication(database, { id: 'app-c03-closed', studentNumber: '2603000004', firstName: 'Hasan', lastName: 'Çelik', status: 'completed' });

    await importExcel(environment, staffCookie, {
        importId: 'imp-c03-names',
        rows: [
            makeExcelRow({ applicationNumber: '2026-00-3000001', studentNumber: appShort.studentNumber, fullName: 'AYŞE YILMAZ', gocStatus: 'İşlem Tamamlandı' }),
            makeExcelRow({ applicationNumber: '2026-00-3000002', studentNumber: appDiff.studentNumber, fullName: 'Ahmet Yılmaz', gocStatus: 'İşlem Tamamlandı' }),
            makeExcelRow({ applicationNumber: '2026-00-3000003', studentNumber: appSingle.studentNumber, fullName: 'Ali', gocStatus: 'İşlem Tamamlandı' }),
            makeExcelRow({ applicationNumber: '2026-00-3000004', studentNumber: appClosed.studentNumber, fullName: 'Kemal Öztürk', gocStatus: 'İşlem Tamamlandı' })
        ]
    });

    const preview = await callApi(environment, '/api/staff/yoksis-document-audit/sync/preview', {
        method: 'POST',
        cookie: staffCookie,
        body: {}
    });
    assert.equal(preview.response.status, 200);
    assert.deepEqual(preview.json.changes.map((c) => c.record_id), [appShort.id]);
    assert.equal(preview.json.needsAttention.length, 0);
    const nameCheckById = new Map(preview.json.nameCheck.map((item) => [item.record_id, item]));
    assert.equal(nameCheckById.get(appDiff.id)?.name_level, 'different');
    assert.equal(nameCheckById.get(appSingle.id)?.name_level, 'different');
    assert.equal(preview.json.nameCheck.length, 2);
    const manualById = new Map(preview.json.manual.map((m) => [m.record_id, m]));
    assert.equal(manualById.get(appClosed.id)?.reason, 'name_mismatch');
    assert.equal(preview.json.manual.length, 1);
});

test('C03 two open records for the same student go to manual even when only online is selected', async () => {
    const { database, environment } = createEnvironment();
    const staffCookie = await seedStaff(environment, database);

    const onlineApp = await seedApplication(database, {
        id: 'app-c03-online',
        studentNumber: '2603000099',
        firstName: 'Hakan',
        lastName: 'Öztürk',
        status: 'sent_to_migration'
    });
    await database.prepare(`
        INSERT INTO physical_intakes (
            id, student_number, first_name, last_name, passport_number,
            application_type, application_route, linked_application_id,
            submitted_at, updated_at, created_by_staff_id, status
        ) VALUES (?, ?, 'Hakan', 'Öztürk', 'P9990001', 'initial', 'standard', NULL, ?, ?, 'reviewer-1', 'under_review')
    `).bind('phys-c03-open', onlineApp.studentNumber, new Date().toISOString(), new Date().toISOString()).run();

    await importExcel(environment, staffCookie, {
        importId: 'imp-c03-multi',
        rows: [
            makeExcelRow({
                applicationNumber: '2026-00-3000099',
                studentNumber: onlineApp.studentNumber,
                fullName: 'Hakan Öztürk',
                gocStatus: 'İşlem Tamamlandı'
            })
        ]
    });

    const preview = await callApi(environment, '/api/staff/yoksis-document-audit/sync/preview', {
        method: 'POST',
        cookie: staffCookie,
        body: {}
    });
    assert.equal(preview.response.status, 200);
    assert.equal(preview.json.changes.length, 0);
    assert.equal(preview.json.manual.length, 1);
    assert.equal(preview.json.manual[0].record_kind, 'online');
    assert.equal(preview.json.manual[0].record_id, onlineApp.id);
    assert.equal(preview.json.manual[0].reason, 'multiple_open_records');
});

test('C04 preview changes nothing; unselected record stays unchanged; re-applying is idempotent', async () => {
    const { database, environment } = createEnvironment();
    const staffCookie = await seedStaff(environment, database);

    const appA = await seedApplication(database, { id: 'app-c04-a', studentNumber: '2604000001', firstName: 'Selin', lastName: 'Aksoy' });
    const appB = await seedApplication(database, { id: 'app-c04-b', studentNumber: '2604000002', firstName: 'Burak', lastName: 'Koç' });

    const { importId } = await importExcel(environment, staffCookie, {
        importId: 'imp-c04',
        rows: [
            makeExcelRow({ applicationNumber: '2026-00-4000001', studentNumber: appA.studentNumber, fullName: 'Selin Aksoy', gocStatus: 'İşlem Tamamlandı' }),
            makeExcelRow({ applicationNumber: '2026-00-4000002', studentNumber: appB.studentNumber, fullName: 'Burak Koç', gocStatus: 'İşlem Tamamlandı' })
        ]
    });

    const beforeApps = (await database.prepare('SELECT id, status, updated_at FROM applications ORDER BY id').all()).results;
    const beforeStates = (await database.prepare('SELECT * FROM migration_office_states').all()).results;
    const beforeAuditCount = (await database.prepare('SELECT COUNT(*) AS cnt FROM audit_events').first()).cnt;

    const preview = await callApi(environment, '/api/staff/yoksis-document-audit/sync/preview', {
        method: 'POST',
        cookie: staffCookie,
        body: {}
    });
    assert.equal(preview.response.status, 200);
    assert.equal(preview.json.changes.length, 2);

    const afterPreviewApps = (await database.prepare('SELECT id, status, updated_at FROM applications ORDER BY id').all()).results;
    const afterPreviewStates = (await database.prepare('SELECT * FROM migration_office_states').all()).results;
    const afterPreviewAuditCount = (await database.prepare('SELECT COUNT(*) AS cnt FROM audit_events').first()).cnt;
    assert.deepEqual(afterPreviewApps, beforeApps);
    assert.deepEqual(afterPreviewStates, beforeStates);
    assert.equal(afterPreviewAuditCount, beforeAuditCount);

    const itemA = preview.json.changes.find((c) => c.record_id === appA.id);
    const applyPayload = {
        import_id: importId,
        items: [{
            record_kind: itemA.record_kind,
            record_id: itemA.record_id,
            application_number: itemA.application_number,
            version: itemA.version
        }]
    };

    const firstApply = await callApi(environment, '/api/staff/yoksis-document-audit/sync/apply', {
        method: 'POST',
        cookie: staffCookie,
        body: applyPayload
    });
    assert.equal(firstApply.response.status, 200);
    assert.equal(firstApply.json.applied.length, 1);
    assert.equal(firstApply.json.applied[0].record_id, appA.id);
    assert.deepEqual(firstApply.json.conflicts, []);

    const rowB = await database.prepare('SELECT status, updated_at FROM applications WHERE id = ?').bind(appB.id).first();
    const stateB = await database.prepare("SELECT * FROM migration_office_states WHERE record_kind = 'online' AND record_id = ?").bind(appB.id).first();
    assert.equal(rowB.status, 'sent_to_migration');
    assert.equal(rowB.updated_at, appB.updatedAt);
    assert.equal(stateB, null);

    const secondApply = await callApi(environment, '/api/staff/yoksis-document-audit/sync/apply', {
        method: 'POST',
        cookie: staffCookie,
        body: applyPayload
    });
    assert.equal(secondApply.response.status, 200);
    assert.equal(secondApply.json.applied.length, 1);
    assert.equal(secondApply.json.applied[0].idempotent, true);
    assert.deepEqual(secondApply.json.conflicts, []);

    const rowA = await database.prepare('SELECT status FROM applications WHERE id = ?').bind(appA.id).first();
    assert.equal(rowA.status, 'migration_approved');
});

test('C05 conflict and no write when record or Excel changes after preview', async () => {
    const { database, environment } = createEnvironment();
    const staffCookie = await seedStaff(environment, database);

    const appRecordConflict = await seedApplication(database, { id: 'app-c05-rec', studentNumber: '2605000001', firstName: 'Kaan', lastName: 'Eren' });
    const appImportConflict = await seedApplication(database, { id: 'app-c05-imp', studentNumber: '2605000002', firstName: 'Nisa', lastName: 'Şen' });

    const { importId: import1 } = await importExcel(environment, staffCookie, {
        importId: 'imp-c05-1',
        rows: [
            makeExcelRow({ applicationNumber: '2026-00-5000001', studentNumber: appRecordConflict.studentNumber, fullName: 'Kaan Eren', gocStatus: 'İşlem Tamamlandı' }),
            makeExcelRow({ applicationNumber: '2026-00-5000002', studentNumber: appImportConflict.studentNumber, fullName: 'Nisa Şen', gocStatus: 'İşlem Tamamlandı' })
        ]
    });

    const preview1 = await callApi(environment, '/api/staff/yoksis-document-audit/sync/preview', {
        method: 'POST',
        cookie: staffCookie,
        body: {}
    });
    assert.equal(preview1.response.status, 200);
    const itemRec = preview1.json.changes.find((c) => c.record_id === appRecordConflict.id);
    const itemImp = preview1.json.changes.find((c) => c.record_id === appImportConflict.id);

    // 1. Record modified after preview
    await database.prepare("UPDATE applications SET updated_at = '2099-01-01T00:00:00.000Z' WHERE id = ?")
        .bind(appRecordConflict.id).run();

    const applyRecConflict = await callApi(environment, '/api/staff/yoksis-document-audit/sync/apply', {
        method: 'POST',
        cookie: staffCookie,
        body: {
            import_id: import1,
            items: [{
                record_kind: itemRec.record_kind,
                record_id: itemRec.record_id,
                application_number: itemRec.application_number,
                version: itemRec.version
            }]
        }
    });
    assert.equal(applyRecConflict.response.status, 200);
    assert.deepEqual(applyRecConflict.json.applied, []);
    assert.equal(applyRecConflict.json.conflicts.length, 1);
    assert.equal(applyRecConflict.json.conflicts[0].reason, 'version_conflict');

    const rowRec = await database.prepare('SELECT status FROM applications WHERE id = ?').bind(appRecordConflict.id).first();
    const stateRec = await database.prepare("SELECT * FROM migration_office_states WHERE record_kind = 'online' AND record_id = ?").bind(appRecordConflict.id).first();
    assert.equal(rowRec.status, 'sent_to_migration');
    assert.equal(stateRec, null);

    // 2. Newer Excel import finalized after preview
    await importExcel(environment, staffCookie, {
        importId: 'imp-c05-2',
        rows: [
            makeExcelRow({ applicationNumber: '2026-00-5000002', studentNumber: appImportConflict.studentNumber, fullName: 'Nisa Şen', gocStatus: 'İşlem Tamamlandı' })
        ]
    });

    const applyImpConflict = await callApi(environment, '/api/staff/yoksis-document-audit/sync/apply', {
        method: 'POST',
        cookie: staffCookie,
        body: {
            import_id: import1,
            items: [{
                record_kind: itemImp.record_kind,
                record_id: itemImp.record_id,
                application_number: itemImp.application_number,
                version: itemImp.version
            }]
        }
    });
    assert.equal(applyImpConflict.response.status, 200);
    assert.deepEqual(applyImpConflict.json.applied, []);
    assert.equal(applyImpConflict.json.conflicts.length, 1);
    assert.equal(applyImpConflict.json.conflicts[0].reason, 'import_changed');

    const rowImp = await database.prepare('SELECT status FROM applications WHERE id = ?').bind(appImportConflict.id).first();
    const stateImp = await database.prepare("SELECT * FROM migration_office_states WHERE record_kind = 'online' AND record_id = ?").bind(appImportConflict.id).first();
    assert.equal(rowImp.status, 'sent_to_migration');
    assert.equal(stateImp, null);
});

test('C06 older-query Excel cannot clear newer missing_documents; newer-query reviewing clears it', async () => {
    const { database, environment } = createEnvironment();
    const staffCookie = await seedStaff(environment, database);

    const app = await seedApplication(database, { id: 'app-c06', studentNumber: '2606000001', firstName: 'Emre', lastName: 'Yalçın' });

    const { importId: imp1 } = await importExcel(environment, staffCookie, {
        importId: 'imp-c06-1',
        rows: [
            makeExcelRow({
                applicationNumber: '2026-00-6000001',
                studentNumber: app.studentNumber,
                fullName: 'Emre Yalçın',
                gocStatus: 'Eksik Belge İstendi',
                missingNote: 'Pasaport fotokopisi',
                missingDeadline: '2026-12-30',
                gocLastQueryAt: '2026-11-20'
            })
        ]
    });
    const preview1 = await callApi(environment, '/api/staff/yoksis-document-audit/sync/preview', { method: 'POST', cookie: staffCookie, body: {} });
    await callApi(environment, '/api/staff/yoksis-document-audit/sync/apply', {
        method: 'POST',
        cookie: staffCookie,
        body: {
            import_id: imp1,
            items: [{
                record_kind: 'online',
                record_id: app.id,
                application_number: '2026-00-6000001',
                version: preview1.json.changes[0].version
            }]
        }
    });

    // Older query date (2026-11-15 < 2026-11-20) with "İşlem Bekliyor"
    await importExcel(environment, staffCookie, {
        importId: 'imp-c06-old',
        rows: [
            makeExcelRow({
                applicationNumber: '2026-00-6000001',
                studentNumber: app.studentNumber,
                fullName: 'Emre Yalçın',
                gocStatus: 'İşlem Bekliyor',
                gocLastQueryAt: '2026-11-15'
            })
        ]
    });
    const previewOld = await callApi(environment, '/api/staff/yoksis-document-audit/sync/preview', { method: 'POST', cookie: staffCookie, body: {} });
    assert.equal(previewOld.json.changes.length, 0);
    assert.equal(previewOld.json.manual.length, 1);
    assert.equal(previewOld.json.manual[0].reason, 'stale_query_conflict');

    const stateAfterOld = await database.prepare("SELECT state, note, deadline FROM migration_office_states WHERE record_kind = 'online' AND record_id = ?").bind(app.id).first();
    assert.equal(stateAfterOld.state, 'missing_documents');
    assert.equal(stateAfterOld.note, 'Pasaport fotokopisi');
    assert.equal(stateAfterOld.deadline, '2026-12-30');

    // Newer query date (2026-11-25 > 2026-11-20) with "İşlem Bekliyor"
    const { importId: impNew } = await importExcel(environment, staffCookie, {
        importId: 'imp-c06-new',
        rows: [
            makeExcelRow({
                applicationNumber: '2026-00-6000001',
                studentNumber: app.studentNumber,
                fullName: 'Emre Yalçın',
                gocStatus: 'İşlem Bekliyor',
                gocLastQueryAt: '2026-11-25'
            })
        ]
    });
    const previewNew = await callApi(environment, '/api/staff/yoksis-document-audit/sync/preview', { method: 'POST', cookie: staffCookie, body: {} });
    assert.equal(previewNew.json.manual.length, 0);
    assert.equal(previewNew.json.changes.length, 1);
    assert.equal(previewNew.json.changes[0].target_state, 'reviewing');
    assert.equal(previewNew.json.changes[0].reason, 'missing_documents_cleared');

    const applyNew = await callApi(environment, '/api/staff/yoksis-document-audit/sync/apply', {
        method: 'POST',
        cookie: staffCookie,
        body: {
            import_id: impNew,
            items: [{
                record_kind: 'online',
                record_id: app.id,
                application_number: '2026-00-6000001',
                version: previewNew.json.changes[0].version
            }]
        }
    });
    assert.equal(applyNew.json.applied.length, 1);

    const stateAfterNew = await database.prepare("SELECT state, note, deadline FROM migration_office_states WHERE record_kind = 'online' AND record_id = ?").bind(app.id).first();
    assert.equal(stateAfterNew.state, 'reviewing');
    assert.equal(stateAfterNew.note, '');
    assert.equal(stateAfterNew.deadline, null);
});

test('C07 student sees missing_documents warning and deadline without note or application_number; warning disappears when approved or reverted', async () => {
    const { database, environment } = createEnvironment();
    const staffCookie = await seedStaff(environment, database);

    // Part 1: missing_documents -> approved
    const app1 = await seedApplication(database, {
        id: 'app-c07-1',
        studentNumber: '2607000001',
        firstName: 'Yusuf',
        lastName: 'Korkmaz',
        referenceNumber: 'ITU-7K9M-4X2P'
    });
    const studentCookie1 = await seedApplicationSession(database, app1.id, 'student-session-c07-1-000000000000000000000');

    const secretNote = 'GİZLİ AÇIKLAMA PASAPORT';
    const eIkametNo = '2026-00-7777777';
    const { importId: imp1 } = await importExcel(environment, staffCookie, {
        importId: 'imp-c07-1',
        rows: [
            makeExcelRow({
                applicationNumber: eIkametNo,
                studentNumber: app1.studentNumber,
                fullName: 'Yusuf Korkmaz',
                gocStatus: 'Eksik Belge İstendi',
                missingNote: secretNote,
                missingDeadline: '2026-12-18'
            })
        ]
    });
    const preview1 = await callApi(environment, '/api/staff/yoksis-document-audit/sync/preview', { method: 'POST', cookie: staffCookie, body: {} });
    await callApi(environment, '/api/staff/yoksis-document-audit/sync/apply', {
        method: 'POST',
        cookie: staffCookie,
        body: {
            import_id: imp1,
            items: [{
                record_kind: 'online',
                record_id: app1.id,
                application_number: eIkametNo,
                version: preview1.json.changes[0].version
            }]
        }
    });

    const currentTracking = await callApi(environment, '/api/public/applications/current/tracking', { cookie: studentCookie1 });
    assert.equal(currentTracking.response.status, 200);
    assert.equal(currentTracking.json.application.migration_missing_documents, true);
    assert.equal(currentTracking.json.application.migration_missing_deadline, '2026-12-18');
    assert.equal(JSON.stringify(currentTracking.json).includes(secretNote), false);
    assert.equal(JSON.stringify(currentTracking.json).includes(eIkametNo), false);

    const lookupTracking = await callApi(environment, '/api/public/applications/tracking-lookup', {
        method: 'POST',
        body: { reference_number: app1.referenceNumber }
    });
    assert.equal(lookupTracking.response.status, 200);
    assert.equal(lookupTracking.json.application.migration_missing_documents, true);
    assert.equal(lookupTracking.json.application.migration_missing_deadline, '2026-12-18');
    assert.equal(JSON.stringify(lookupTracking.json).includes(secretNote), false);
    assert.equal(JSON.stringify(lookupTracking.json).includes(eIkametNo), false);

    // Approve via Excel sync -> warning disappears
    const { importId: impApprove } = await importExcel(environment, staffCookie, {
        importId: 'imp-c07-approve',
        rows: [
            makeExcelRow({
                applicationNumber: eIkametNo,
                studentNumber: app1.studentNumber,
                fullName: 'Yusuf Korkmaz',
                gocStatus: 'İşlem Tamamlandı'
            })
        ]
    });
    const previewApprove = await callApi(environment, '/api/staff/yoksis-document-audit/sync/preview', { method: 'POST', cookie: staffCookie, body: {} });
    await callApi(environment, '/api/staff/yoksis-document-audit/sync/apply', {
        method: 'POST',
        cookie: staffCookie,
        body: {
            import_id: impApprove,
            items: [{
                record_kind: 'online',
                record_id: app1.id,
                application_number: eIkametNo,
                version: previewApprove.json.changes[0].version
            }]
        }
    });

    const afterApproveCurrent = await callApi(environment, '/api/public/applications/current/tracking', { cookie: studentCookie1 });
    assert.equal(afterApproveCurrent.json.application.status, 'migration_approved');
    assert.equal(afterApproveCurrent.json.application.migration_missing_documents, undefined);
    assert.equal(afterApproveCurrent.json.application.migration_missing_deadline, undefined);

    const afterApproveLookup = await callApi(environment, '/api/public/applications/tracking-lookup', {
        method: 'POST',
        body: { reference_number: app1.referenceNumber }
    });
    assert.equal(afterApproveLookup.json.application.migration_missing_documents, undefined);

    // Part 2: missing_documents -> reverted to under_review -> warning disappears
    const app2 = await seedApplication(database, {
        id: 'app-c07-2',
        studentNumber: '2607000002',
        firstName: 'Sinem',
        lastName: 'Polat',
        referenceNumber: 'ITU-8L2N-5Y3Q'
    });
    const studentCookie2 = await seedApplicationSession(database, app2.id, 'student-session-c07-2-000000000000000000000');

    const { importId: imp2 } = await importExcel(environment, staffCookie, {
        importId: 'imp-c07-2',
        rows: [
            makeExcelRow({
                applicationNumber: '2026-00-7777778',
                studentNumber: app2.studentNumber,
                fullName: 'Sinem Polat',
                gocStatus: 'Eksik Belge İstendi',
                missingNote: 'Sigorta poliçesi',
                missingDeadline: '2026-12-22'
            })
        ]
    });
    const preview2 = await callApi(environment, '/api/staff/yoksis-document-audit/sync/preview', { method: 'POST', cookie: staffCookie, body: {} });
    const app2Change = preview2.json.changes.find((c) => c.record_id === app2.id);
    await callApi(environment, '/api/staff/yoksis-document-audit/sync/apply', {
        method: 'POST',
        cookie: staffCookie,
        body: {
            import_id: imp2,
            items: [{
                record_kind: 'online',
                record_id: app2.id,
                application_number: '2026-00-7777778',
                version: app2Change.version
            }]
        }
    });

    const beforeRevert = await callApi(environment, '/api/public/applications/current/tracking', { cookie: studentCookie2 });
    assert.equal(beforeRevert.json.application.migration_missing_documents, true);

    const app2Row = await database.prepare('SELECT updated_at FROM applications WHERE id = ?').bind(app2.id).first();
    const revert = await callApi(environment, `/api/staff/applications/${app2.id}/status`, {
        method: 'POST',
        cookie: staffCookie,
        body: { target_status: 'under_review', expected_updated_at: app2Row.updated_at }
    });
    assert.equal(revert.response.status, 200);
    assert.equal(revert.json.application_status, 'under_review');

    const afterRevertCurrent = await callApi(environment, '/api/public/applications/current/tracking', { cookie: studentCookie2 });
    assert.equal(afterRevertCurrent.json.application.status, 'under_review');
    assert.equal(afterRevertCurrent.json.application.migration_missing_documents, undefined);
    assert.equal(afterRevertCurrent.json.application.migration_missing_deadline, undefined);
});

test('C07 sent_to_migration with reviewing overlay shows no warning in owner tracking, public lookup, chatbot, or physical lookup', async () => {
    const { database, environment } = createEnvironment();
    const staffCookie = await seedStaff(environment, database);

    // 1. Online application: missing_documents -> newer-query reviewing (still sent_to_migration)
    const app = await seedApplication(database, {
        id: 'app-c07-reviewing',
        studentNumber: '2607000003',
        firstName: 'Kerem',
        lastName: 'Yılmaz',
        referenceNumber: 'ITU-9M3P-6Z4R'
    });
    const studentCookie = await seedApplicationSession(database, app.id, 'student-session-c07-3-000000000000000000000');
    const eIkametNo = '2026-00-7777779';
    const secretNote = 'ÖZEL NOT PASAPORT';

    const { importId: impMiss } = await importExcel(environment, staffCookie, {
        importId: 'imp-c07-rev-1',
        rows: [
            makeExcelRow({
                applicationNumber: eIkametNo,
                studentNumber: app.studentNumber,
                fullName: 'Kerem Yılmaz',
                gocStatus: 'Eksik Belge İstendi',
                missingNote: secretNote,
                missingDeadline: '2026-12-19',
                gocLastQueryAt: '2026-11-20'
            })
        ]
    });
    const previewMiss = await callApi(environment, '/api/staff/yoksis-document-audit/sync/preview', { method: 'POST', cookie: staffCookie, body: {} });
    await callApi(environment, '/api/staff/yoksis-document-audit/sync/apply', {
        method: 'POST',
        cookie: staffCookie,
        body: {
            import_id: impMiss,
            items: [{
                record_kind: 'online',
                record_id: app.id,
                application_number: eIkametNo,
                version: previewMiss.json.changes[0].version
            }]
        }
    });

    const chatWhileMissing = await callApi(environment, '/api/public/chat', {
        method: 'POST',
        body: {
            messages: [{ role: 'user', content: `Başvurumun durumu nedir? ${app.referenceNumber}` }],
            language: 'tr'
        }
    });
    assert.equal(chatWhileMissing.response.status, 200);
    assert.ok(chatWhileMissing.json.reply.includes('Göç İdaresi dosyanız için eksik evrak istiyor'));
    assert.ok(chatWhileMissing.json.reply.includes('19.12.2026'));
    assert.equal(chatWhileMissing.json.reply.includes(secretNote), false);
    assert.equal(chatWhileMissing.json.reply.includes(eIkametNo), false);

    // Clear missing_documents via newer-query "İşlem Bekliyor" -> status stays sent_to_migration, overlay becomes reviewing
    const { importId: impClear } = await importExcel(environment, staffCookie, {
        importId: 'imp-c07-rev-2',
        rows: [
            makeExcelRow({
                applicationNumber: eIkametNo,
                studentNumber: app.studentNumber,
                fullName: 'Kerem Yılmaz',
                gocStatus: 'İşlem Bekliyor',
                gocLastQueryAt: '2026-11-25'
            })
        ]
    });
    const previewClear = await callApi(environment, '/api/staff/yoksis-document-audit/sync/preview', { method: 'POST', cookie: staffCookie, body: {} });
    assert.equal(previewClear.json.changes.length, 1);
    assert.equal(previewClear.json.changes[0].target_state, 'reviewing');
    await callApi(environment, '/api/staff/yoksis-document-audit/sync/apply', {
        method: 'POST',
        cookie: staffCookie,
        body: {
            import_id: impClear,
            items: [{
                record_kind: 'online',
                record_id: app.id,
                application_number: eIkametNo,
                version: previewClear.json.changes[0].version
            }]
        }
    });

    const ownerAfterClear = await callApi(environment, '/api/public/applications/current/tracking', { cookie: studentCookie });
    assert.equal(ownerAfterClear.response.status, 200);
    assert.equal(ownerAfterClear.json.application.status, 'sent_to_migration');
    assert.equal(ownerAfterClear.json.application.migration_missing_documents, undefined);
    assert.equal(ownerAfterClear.json.application.migration_missing_deadline, undefined);

    const lookupAfterClear = await callApi(environment, '/api/public/applications/tracking-lookup', {
        method: 'POST',
        body: { reference_number: app.referenceNumber }
    });
    assert.equal(lookupAfterClear.response.status, 200);
    assert.equal(lookupAfterClear.json.application.status, 'sent_to_migration');
    assert.equal(lookupAfterClear.json.application.migration_missing_documents, undefined);
    assert.equal(lookupAfterClear.json.application.migration_missing_deadline, undefined);

    const chatAfterClear = await callApi(environment, '/api/public/chat', {
        method: 'POST',
        body: {
            messages: [{ role: 'user', content: `Başvurumun durumu nedir? ${app.referenceNumber}` }],
            language: 'tr'
        }
    });
    assert.equal(chatAfterClear.response.status, 200);
    assert.equal(chatAfterClear.json.reply.includes('eksik evrak'), false);
    assert.equal(chatAfterClear.json.reply.includes('19.12.2026'), false);
    assert.equal(chatAfterClear.json.reply.includes('2026-12-19'), false);

    // 2. Physical record: sent_to_migration with missing_documents vs reviewing overlay
    const physicalId = 'phys-c07-reviewing';
    const physicalRef = 'ITU-26-7K9M4X2';
    const nowIso = new Date().toISOString();
    await database.prepare(`
        INSERT INTO physical_intakes (
            id, student_number, first_name, last_name, passport_number,
            application_type, application_route, linked_application_id,
            tracking_reference, application_date, submitted_at, updated_at, created_by_staff_id, status
        ) VALUES (?, '2607000099', 'Bora', 'Şahin', 'P7779991', 'initial', 'standard', NULL, ?, '2026-11-27', ?, ?, 'reviewer-1', 'sent_to_migration')
    `).bind(physicalId, physicalRef, nowIso, nowIso).run();

    await database.prepare(`
        INSERT INTO migration_office_states (
            record_kind, record_id, application_number, state, note, deadline,
            goc_last_query_at, import_id, updated_by_staff_id, updated_at
        ) VALUES ('physical', ?, '2026-00-7777780', 'missing_documents', 'Gizli fiziksel not', '2026-12-21', '2026-11-20', 'imp-phys-1', 'reviewer-1', ?)
    `).bind(physicalId, nowIso).run();

    const physMissing = await callApi(environment, '/api/public/physical-intakes/tracking-lookup', {
        method: 'POST',
        body: { tracking_reference: physicalRef }
    });
    assert.equal(physMissing.response.status, 200);
    assert.equal(physMissing.json.found, true);
    assert.equal(physMissing.json.office_status, 'sent_to_migration');
    assert.equal(physMissing.json.migration_missing_documents, true);
    assert.equal(physMissing.json.migration_missing_deadline, '2026-12-21');
    assert.equal(JSON.stringify(physMissing.json).includes('Gizli fiziksel not'), false);
    assert.equal(JSON.stringify(physMissing.json).includes('2026-00-7777780'), false);

    await database.prepare(`
        UPDATE migration_office_states
        SET state = 'reviewing', note = '', deadline = NULL, goc_last_query_at = '2026-11-25', updated_at = ?
        WHERE record_kind = 'physical' AND record_id = ?
    `).bind(new Date().toISOString(), physicalId).run();

    const physReviewing = await callApi(environment, '/api/public/physical-intakes/tracking-lookup', {
        method: 'POST',
        body: { tracking_reference: physicalRef }
    });
    assert.equal(physReviewing.response.status, 200);
    assert.equal(physReviewing.json.found, true);
    assert.equal(physReviewing.json.office_status, 'sent_to_migration');
    assert.equal(physReviewing.json.migration_missing_documents, undefined);
    assert.equal(physReviewing.json.migration_missing_deadline, undefined);
    assert.equal(JSON.stringify(physReviewing.json).includes('2026-12-21'), false);
    assert.equal(JSON.stringify(physReviewing.json).includes('21.12.2026'), false);
});

test('C08 filters (missing_documents, approved, stale query) return exact counts and pagination; permanent delete cleans up overlay', async () => {
    const { database, environment } = createEnvironment();
    const adminCookie = await seedStaff(environment, database, {
        id: 'admin-c08',
        token: 'admin-session-token-00000000000000000000000',
        role: 'admin'
    });

    // Seed 3 sent_to_migration with missing_documents, 1 sent_to_migration with reviewing, 2 migration_approved
    const missingApps = [];
    for (let i = 1; i <= 3; i += 1) {
        const app = await seedApplication(database, {
            id: `app-c08-miss-${i}`,
            studentNumber: `260800000${i}`,
            firstName: 'Eksik',
            lastName: `Öğrenci${i}`,
            status: 'sent_to_migration'
        });
        missingApps.push(app);
        await database.prepare(`
            INSERT INTO migration_office_states (
                record_kind, record_id, application_number, state, note, deadline,
                goc_last_query_at, import_id, updated_by_staff_id, updated_at
            ) VALUES ('online', ?, ?, 'missing_documents', 'Belge eksik', '2026-12-25', '2026-11-10', 'imp-c08', 'admin-c08', ?)
        `).bind(app.id, `2026-00-800000${i}`, new Date().toISOString()).run();
    }

    const reviewingApp = await seedApplication(database, {
        id: 'app-c08-rev-1',
        studentNumber: '2608000004',
        firstName: 'İnceleme',
        lastName: 'Öğrenci',
        status: 'sent_to_migration'
    });
    await database.prepare(`
        INSERT INTO migration_office_states (
            record_kind, record_id, application_number, state, note, deadline,
            goc_last_query_at, import_id, updated_by_staff_id, updated_at
        ) VALUES ('online', ?, '2026-00-8000004', 'reviewing', '', NULL, '2026-11-26', 'imp-c08', 'admin-c08', ?)
    `).bind(reviewingApp.id, new Date().toISOString()).run();

    for (let i = 5; i <= 6; i += 1) {
        await seedApplication(database, {
            id: `app-c08-app-${i}`,
            studentNumber: `260800000${i}`,
            firstName: 'Onaylı',
            lastName: `Öğrenci${i}`,
            status: 'migration_approved'
        });
    }

    // 1. Staff applications filter: migration_missing_documents with pagination
    const missPage1 = await callApi(environment, '/api/staff/applications/query', {
        method: 'POST',
        cookie: adminCookie,
        body: { status: 'migration_missing_documents', page: 1, page_size: 2 }
    });
    assert.equal(missPage1.response.status, 200);
    assert.equal(missPage1.json.pagination.total_items, 3);
    assert.equal(missPage1.json.pagination.total_pages, 2);
    assert.equal(missPage1.json.items.length, 2);
    assert.ok(missPage1.json.items.every((item) => item.migration_office?.state === 'missing_documents'));

    const missPage2 = await callApi(environment, '/api/staff/applications/query', {
        method: 'POST',
        cookie: adminCookie,
        body: { status: 'migration_missing_documents', page: 2, page_size: 2 }
    });
    assert.equal(missPage2.response.status, 200);
    assert.equal(missPage2.json.items.length, 1);
    assert.equal(missPage2.json.items[0].migration_office?.state, 'missing_documents');

    // 2. Staff applications filter: migration_approved with pagination
    const approvedPage1 = await callApi(environment, '/api/staff/applications/query', {
        method: 'POST',
        cookie: adminCookie,
        body: { status: 'migration_approved', page: 1, page_size: 1 }
    });
    assert.equal(approvedPage1.response.status, 200);
    assert.equal(approvedPage1.json.pagination.total_items, 2);
    assert.equal(approvedPage1.json.pagination.total_pages, 2);
    assert.equal(approvedPage1.json.items.length, 1);
    assert.equal(approvedPage1.json.items[0].status, 'migration_approved');

    // 3. YÖKSİS audit query filters: missing_documents, successful, staleQueryOnly
    const todayIso = getIstanbulTodayIso();
    const staleDate = shiftIsoCalendarDate(todayIso, -10);
    await importExcel(environment, adminCookie, {
        importId: 'imp-c08-audit',
        rows: [
            makeExcelRow({ applicationNumber: '2026-00-8100001', studentNumber: '2608100001', fullName: 'A1 B1', gocStatus: 'Eksik Belge İstendi', gocLastQueryAt: staleDate }),
            makeExcelRow({ applicationNumber: '2026-00-8100002', studentNumber: '2608100002', fullName: 'A2 B2', gocStatus: 'Eksik Belge İstendi', gocLastQueryAt: todayIso }),
            makeExcelRow({ applicationNumber: '2026-00-8100003', studentNumber: '2608100003', fullName: 'A3 B3', gocStatus: 'İşlem Tamamlandı', gocLastQueryAt: staleDate }),
            makeExcelRow({ applicationNumber: '2026-00-8100004', studentNumber: '2608100004', fullName: 'A4 B4', gocStatus: 'İşlem Tamamlandı', gocLastQueryAt: todayIso }),
            makeExcelRow({ applicationNumber: '2026-00-8100005', studentNumber: '2608100005', fullName: 'A5 B5', gocStatus: 'İşlem Bekliyor', gocLastQueryAt: null })
        ]
    });

    const auditMissing = await callApi(environment, '/api/staff/yoksis-document-audit/query', {
        method: 'POST',
        cookie: adminCookie,
        body: { status: 'missing_documents', page: 1, pageSize: 1 }
    });
    assert.equal(auditMissing.response.status, 200);
    assert.equal(auditMissing.json.total, 2);
    assert.equal(auditMissing.json.records.length, 1);

    const auditSuccessful = await callApi(environment, '/api/staff/yoksis-document-audit/query', {
        method: 'POST',
        cookie: adminCookie,
        body: { status: 'successful', page: 1, pageSize: 1 }
    });
    assert.equal(auditSuccessful.response.status, 200);
    assert.equal(auditSuccessful.json.total, 2);
    assert.equal(auditSuccessful.json.records.length, 1);

    const auditStale1 = await callApi(environment, '/api/staff/yoksis-document-audit/query', {
        method: 'POST',
        cookie: adminCookie,
        body: { staleQueryOnly: true, page: 1, pageSize: 1 }
    });
    assert.equal(auditStale1.response.status, 200);
    assert.equal(auditStale1.json.total, 2);
    assert.equal(auditStale1.json.records.length, 1);

    const auditStale2 = await callApi(environment, '/api/staff/yoksis-document-audit/query', {
        method: 'POST',
        cookie: adminCookie,
        body: { staleQueryOnly: true, page: 2, pageSize: 1 }
    });
    assert.equal(auditStale2.response.status, 200);
    assert.equal(auditStale2.json.records.length, 1);

    // 4. Permanent deletion cleans up migration_office_states
    const targetAppId = missingApps[0].id;
    const del = await callApi(environment, `/api/staff/applications/${targetAppId}/delete`, {
        method: 'POST',
        cookie: adminCookie,
        body: { confirmed: true }
    });
    assert.equal(del.response.status, 200);
    assert.equal(del.json.purged, true);
    assert.equal(typeof del.json.requestId, 'string');
    assert.ok(del.json.requestId.length > 0);

    const remainingApp = await database.prepare('SELECT id FROM applications WHERE id = ?').bind(targetAppId).first();
    const remainingOverlay = await database.prepare("SELECT * FROM migration_office_states WHERE record_kind = 'online' AND record_id = ?").bind(targetAppId).first();
    assert.equal(remainingApp, null);
    assert.equal(remainingOverlay, null);
});
