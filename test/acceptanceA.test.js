import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { PUBLIC_MESSAGES, SUPPORTED_LOCALES } from '../src/public/i18n/messages.js';
import { PHYSICAL_RECEIPT_MESSAGES } from '../src/public/i18n/physical-receipt-messages.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import {
    withTestApplicationPrivacyNotice,
    withTestApplicationPrivacyNoticeVersion
} from './helpers/application-privacy-notice.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const ORIGIN = 'https://portal.test';
const SCANNER_SECRET = 'scanner-secret-token-00000000000000000000000';

function createEnvironment(extra = {}) {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const objects = new Map();
    const bucket = {
        async head(key) {
            return objects.get(key) ?? null;
        },
        async put(key, body, options = {}) {
            objects.set(key, {
                size: body.byteLength,
                etag: `etag-${key}`,
                httpMetadata: options.httpMetadata ?? {}
            });
        },
        async delete(key) {
            objects.delete(key);
        }
    };
    const environment = withTestApplicationPrivacyNotice({
        DB: database,
        DOCUMENTS: bucket,
        APP_ENV: 'test',
        STAFF_SHARED_USERNAME: 'reviewer-1',
        SCANNER_SECRET,
        R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
        R2_BUCKET_NAME: 'private-documents',
        R2_ACCESS_KEY_ID: 'test-access-key',
        R2_SECRET_ACCESS_KEY: 'test-secret-key',
        ...extra
    });
    return { database, environment, objects };
}

function createRequest(path, { method = 'GET', cookie, body, origin = ORIGIN, headers: extraHeaders = {} } = {}) {
    const headers = new Headers(extraHeaders);
    if (origin !== null) headers.set('Origin', origin);
    if (cookie) headers.set('Cookie', cookie);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const payload = path === '/api/public/applications' && method === 'POST' && body !== undefined
        ? withTestApplicationPrivacyNoticeVersion(body)
        : body;
    return new Request(`${ORIGIN}${path}`, {
        method,
        headers,
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
    });
}

async function seedStaff(
    environment,
    database,
    {
        id = 'reviewer-1',
        username = id,
        displayName = 'Reviewer One',
        token = 'staff-session-token-00000000000000000000001',
        role = 'reviewer'
    } = {}
) {
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    environment.STAFF_SHARED_USERNAME = username;
    await database.prepare(`
        INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES (?, ?, ?, 'test-hash', ?, ?)
        ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name
    `).bind(id, username, username.toLowerCase(), displayName, role).run();
    await database.prepare(`
        INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at)
        VALUES (?, ?, ?, ?)
    `).bind(
        crypto.randomUUID(),
        id,
        await hashSessionToken(token),
        new Date(Date.now() + 60 * 60 * 1000).toISOString()
    ).run();
    return `staff_session=${token}`;
}

async function createApplicant(environment, studentNumber, applicationType = 'initial') {
    const response = await worker.fetch(createRequest('/api/public/applications', {
        method: 'POST',
        body: {
            student_number: studentNumber,
            application_type: applicationType,
            email: `${studentNumber.toLowerCase()}@example.edu`,
            phone: '+905551112233'
        }
    }), environment, {});
    assert.equal(response.status, 201);
    return response.headers.get('Set-Cookie').split(';')[0];
}

function findApplicationByStudentNumber(database, studentNumber) {
    return database.prepare(`
        SELECT applications.*
        FROM applications
        JOIN students ON students.id = applications.student_id
        WHERE students.normalized_student_number = ?
        ORDER BY applications.created_at DESC, applications.id DESC
        LIMIT 1
    `).bind(studentNumber.trim().toUpperCase()).first();
}

async function seedDocument(
    database,
    applicationId,
    applicationType = 'initial',
    code = 'passport',
    {
        reviewStatus = 'pending',
        revisionStatus = 'submitted',
        revisionNumber = 1,
        scanStatus = 'clean',
        uploadStatus = 'finalized',
        cleanupStatus = 'none',
        isCurrent = 1
    } = {}
) {
    const requirement = database.prepare(`
        SELECT id FROM document_requirements
        WHERE application_type = ? AND code = ? AND is_active = 1
    `).bind(applicationType, code).first();
    assert.ok(requirement, `Expected active requirement for ${applicationType}/${code}`);

    let record = database.prepare(`
        SELECT id FROM document_records
        WHERE application_id = ? AND requirement_id = ?
    `).bind(applicationId, requirement.id).first();

    if (!record) {
        const documentRecordId = crypto.randomUUID();
        await database.prepare(`
            INSERT INTO document_records (id, application_id, requirement_id, application_type, review_status)
            VALUES (?, ?, ?, ?, ?)
        `).bind(documentRecordId, applicationId, requirement.id, applicationType, reviewStatus).run();
        record = { id: documentRecordId };
    } else {
        await database.prepare(`
            UPDATE document_records SET review_status = ? WHERE id = ?
        `).bind(reviewStatus, record.id).run();
    }

    const revisionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    await database.prepare(`
        INSERT INTO document_revisions (id, document_record_id, revision_number, status, is_current, submitted_by_type)
        VALUES (?, ?, ?, ?, ?, 'student')
    `).bind(revisionId, record.id, revisionNumber, revisionStatus, isCurrent).run();
    await database.prepare(`
        INSERT INTO document_revision_files (
            id, revision_id, page_order, storage_key, original_filename,
            media_type, byte_size, upload_status, scan_status, cleanup_status
        ) VALUES (?, ?, 0, ?, ?, 'application/pdf', 128, ?, ?, ?)
    `).bind(fileId, revisionId, `quarantine/${crypto.randomUUID()}`, `${code}-v${revisionNumber}.pdf`, uploadStatus, scanStatus, cleanupStatus).run();
    await database.prepare(`
        INSERT INTO upload_intents (id, revision_file_id, idempotency_key, expires_at, status, completed_at)
        VALUES (?, ?, ?, '2999-01-01T00:00:00.000Z', 'completed', '2026-11-27T08:00:00.000Z')
    `).bind(crypto.randomUUID(), fileId, crypto.randomUUID()).run();

    return { documentRecordId: record.id, revisionId, fileId };
}

test('A01 sent_to_migration ve migration_approved yeni metinleri ogrenci takibinde 5 dilde doner; eski metin hicbir yanitta yok', async () => {
    const { database, environment } = createEnvironment();
    const cookie = await createApplicant(environment, 'A01-STU-001');
    const application = findApplicationByStudentNumber(database, 'A01-STU-001');
    assert.ok(application?.reference_number);

    const expectedPublic = {
        tr: {
            sent_to_migration: 'Göç İdaresi dosyanızı inceliyor',
            migration_approved: 'Göç İdaresi tarafından onaylandı'
        },
        en: {
            sent_to_migration: 'The Migration Authority is reviewing your file',
            migration_approved: 'Approved by Migration Authority'
        },
        ru: {
            sent_to_migration: 'Миграционное управление рассматривает ваше дело',
            migration_approved: 'Одобрено Миграционным управлением'
        },
        tk: {
            sent_to_migration: 'Migrasiýa edarasy faýlyňyzy gözden geçirýär',
            migration_approved: 'Migrasiýa edarasy tarapyndan tassyklandy'
        },
        ar: {
            sent_to_migration: 'تقوم إدارة الهجرة بمراجعة ملفك',
            migration_approved: 'تمت الموافقة من قِبل إدارة الهجرة'
        }
    };

    const legacyPhrases = [
        'Göç İdaresine gönderildi',
        'Göç idaresine gönderildi',
        'Göç İdaresine iletildi',
        'Sent to Migration Authority',
        'Sent to migration authority',
        'Отправлена в Миграционное управление',
        'Отправлено в Миграционное управление',
        'Migrasiýa edarasyna iberildi',
        'تم الإرسال إلى إدارة الهجرة'
    ];

    assert.deepEqual([...SUPPORTED_LOCALES].sort(), ['ar', 'en', 'ru', 'tk', 'tr']);
    for (const locale of SUPPORTED_LOCALES) {
        const messages = PUBLIC_MESSAGES[locale];
        assert.equal(messages.applicationStatus_sent_to_migration, expectedPublic[locale].sent_to_migration);
        assert.equal(messages.applicationStatus_migration_approved, expectedPublic[locale].migration_approved);

        const receiptMessages = PHYSICAL_RECEIPT_MESSAGES[locale];
        assert.ok(receiptMessages.sent_to_migration);
        assert.ok(receiptMessages.migration_approved);

        for (const legacy of legacyPhrases) {
            assert.equal(messages.applicationStatus_sent_to_migration.includes(legacy), false);
            assert.equal(messages.applicationStatus_migration_approved.includes(legacy), false);
            assert.equal(receiptMessages.sent_to_migration.includes(legacy), false);
            assert.equal(receiptMessages.migration_approved.includes(legacy), false);
        }
    }

    for (const status of ['sent_to_migration', 'migration_approved']) {
        await database.prepare('UPDATE applications SET status = ? WHERE id = ?').bind(status, application.id).run();

        const ownerResponse = await worker.fetch(
            createRequest('/api/public/applications/current/tracking', { cookie }),
            environment,
            {}
        );
        assert.equal(ownerResponse.status, 200);
        const ownerText = await ownerResponse.text();
        const ownerPayload = JSON.parse(ownerText);
        assert.equal(ownerPayload.application.status, status);

        const lookupResponse = await worker.fetch(
            createRequest('/api/public/applications/tracking-lookup', {
                method: 'POST',
                body: { reference_number: application.reference_number },
                headers: { 'CF-Connecting-IP': '198.51.100.10' }
            }),
            environment,
            {}
        );
        assert.equal(lookupResponse.status, 200);
        const lookupText = await lookupResponse.text();
        const lookupPayload = JSON.parse(lookupText);
        assert.equal(lookupPayload.found, true);
        assert.equal(lookupPayload.application.status, status);

        for (const legacy of legacyPhrases) {
            assert.equal(ownerText.includes(legacy), false);
            assert.equal(lookupText.includes(legacy), false);
        }
    }
});

test('A02 Gonderildi basvuruda taramadan gecemeyen belge: incelemeye al ve tekrar iste -> ogrenci takibinde yeniden yukleme ve sebep gorunur', async () => {
    const { database, environment } = createEnvironment();
    const staffCookie = await seedStaff(environment, database);
    const studentCookie = await createApplicant(environment, 'A02-STU-001');
    const application = findApplicationByStudentNumber(database, 'A02-STU-001');

    const submittedAt = '2026-11-27T07:00:00.000Z';
    await database.prepare(`
        UPDATE applications
        SET status = 'submitted', submitted_at = ?, updated_at = ?, document_policy_version = 1
        WHERE id = ?
    `).bind(submittedAt, submittedAt, application.id).run();

    await seedDocument(database, application.id, 'initial', 'passport', {
        reviewStatus: 'pending',
        revisionStatus: 'submitted',
        revisionNumber: 1,
        scanStatus: 'failed'
    });

    const startReviewRes = await worker.fetch(createRequest(`/api/staff/applications/${application.id}/status`, {
        method: 'POST',
        cookie: staffCookie,
        body: { target_status: 'under_review', expected_updated_at: submittedAt }
    }), environment, {});
    assert.equal(startReviewRes.status, 200);
    const startReviewBody = await startReviewRes.json();
    assert.equal(startReviewBody.application_status, 'under_review');

    const reason = 'Belge güvenlik taramasından geçemedi, lütfen okunaklı bir PDF yükleyin.';
    const resubRes = await worker.fetch(
        createRequest(`/api/staff/applications/${application.id}/documents/passport/request-resubmission`, {
            method: 'POST',
            cookie: staffCookie,
            body: { expected_revision_number: 1, reason }
        }),
        environment,
        {}
    );
    assert.equal(resubRes.status, 200);
    const resubBody = await resubRes.json();
    assert.equal(resubBody.application_status, 'resubmission_required');
    assert.equal(resubBody.document_status, 'resubmission_required');

    const trackingRes = await worker.fetch(
        createRequest('/api/public/applications/current/tracking', { cookie: studentCookie }),
        environment,
        {}
    );
    assert.equal(trackingRes.status, 200);
    const trackingPayload = await trackingRes.json();
    assert.equal(trackingPayload.application.status, 'resubmission_required');
    const passportDoc = trackingPayload.documents.find((doc) => doc.code === 'passport');
    assert.ok(passportDoc);
    assert.equal(passportDoc.status, 'resubmission_required');
    assert.equal(passportDoc.student_message, reason);

    const eligibilityRes = await worker.fetch(
        createRequest('/api/public/applications/current/documents/resubmission-eligibility', { cookie: studentCookie }),
        environment,
        {}
    );
    assert.equal(eligibilityRes.status, 200);
    const eligibilityPayload = await eligibilityRes.json();
    const eligiblePassport = eligibilityPayload.documents.find((doc) => doc.code === 'passport');
    assert.ok(eligiblePassport);
    assert.equal(eligiblePassport.mode, 'first_replacement');

    const lookupRes = await worker.fetch(createRequest('/api/public/applications/tracking-lookup', {
        method: 'POST',
        body: { reference_number: application.reference_number },
        headers: { 'CF-Connecting-IP': '198.51.100.11' }
    }), environment, {});
    assert.equal(lookupRes.status, 200);
    const lookupPayload = await lookupRes.json();
    const lookupPassport = lookupPayload.documents.find((doc) => doc.code === 'passport');
    assert.equal(lookupPassport?.status, 'resubmission_required');
    assert.equal(lookupPassport?.student_message, reason);
});

test('A03 Goce iletilmis basvuruda tekrar isteme reddedilir, kayit degismez', async () => {
    const { database, environment } = createEnvironment();
    const staffCookie = await seedStaff(environment, database);
    await createApplicant(environment, 'A03-STU-001');
    const application = findApplicationByStudentNumber(database, 'A03-STU-001');

    const updatedAt = '2026-11-27T07:30:00.000Z';
    await database.prepare(`
        UPDATE applications
        SET status = 'sent_to_migration', submitted_at = ?, updated_at = ?, document_policy_version = 1
        WHERE id = ?
    `).bind(updatedAt, updatedAt, application.id).run();

    const { documentRecordId, revisionId } = await seedDocument(database, application.id, 'initial', 'passport', {
        reviewStatus: 'approved',
        revisionStatus: 'approved',
        revisionNumber: 1,
        scanStatus: 'clean'
    });

    const notesBefore = database.prepare('SELECT count(*) AS count FROM application_notes WHERE application_id = ?').bind(application.id).first().count;
    const auditsBefore = database.prepare('SELECT count(*) AS count FROM audit_events WHERE application_id = ?').bind(application.id).first().count;

    const existingRes = await worker.fetch(
        createRequest(`/api/staff/applications/${application.id}/documents/passport/request-resubmission`, {
            method: 'POST',
            cookie: staffCookie,
            body: { expected_revision_number: 1, reason: 'Göç aşamasında tekrar istenemez.' }
        }),
        environment,
        {}
    );
    assert.equal(existingRes.status, 409);

    const missingRes = await worker.fetch(
        createRequest(`/api/staff/applications/${application.id}/documents/student_certificate/request-resubmission`, {
            method: 'POST',
            cookie: staffCookie,
            body: { expected_revision_number: null, reason: 'Eksik belge de istenemez.' }
        }),
        environment,
        {}
    );
    assert.equal(missingRes.status, 409);

    const appAfter = database.prepare('SELECT status, updated_at FROM applications WHERE id = ?').bind(application.id).first();
    const recordAfter = database.prepare('SELECT review_status FROM document_records WHERE id = ?').bind(documentRecordId).first();
    const revisionAfter = database.prepare('SELECT status FROM document_revisions WHERE id = ?').bind(revisionId).first();
    const notesAfter = database.prepare('SELECT count(*) AS count FROM application_notes WHERE application_id = ?').bind(application.id).first().count;
    const auditsAfter = database.prepare('SELECT count(*) AS count FROM audit_events WHERE application_id = ?').bind(application.id).first().count;

    assert.equal(appAfter.status, 'sent_to_migration');
    assert.equal(appAfter.updated_at, updatedAt);
    assert.equal(recordAfter.review_status, 'approved');
    assert.equal(revisionAfter.status, 'approved');
    assert.equal(notesAfter, notesBefore);
    assert.equal(auditsAfter, auditsBefore);
});

test('A04 Ayni istek iki kez ve eski revizyon numarasiyla 409 doner, veri bozulmaz', async () => {
    const { database, environment } = createEnvironment();
    const staffCookie = await seedStaff(environment, database);

    // 1) Duplicate request with same expected_revision_number
    await createApplicant(environment, 'A04-DUP-001');
    const dupApp = findApplicationByStudentNumber(database, 'A04-DUP-001');
    await database.prepare(`UPDATE applications SET status = 'under_review', document_policy_version = 1 WHERE id = ?`).bind(dupApp.id).run();
    const dupDoc = await seedDocument(database, dupApp.id, 'initial', 'passport', {
        reviewStatus: 'pending',
        revisionStatus: 'submitted',
        revisionNumber: 1,
        scanStatus: 'clean'
    });

    const firstRes = await worker.fetch(
        createRequest(`/api/staff/applications/${dupApp.id}/documents/passport/request-resubmission`, {
            method: 'POST',
            cookie: staffCookie,
            body: { expected_revision_number: 1, reason: 'İlk geçerli tekrar isteme sebebi' }
        }),
        environment,
        {}
    );
    assert.equal(firstRes.status, 200);

    const notesAfterFirst = database.prepare('SELECT body FROM application_notes WHERE document_record_id = ?').bind(dupDoc.documentRecordId).all().results;
    const auditsAfterFirst = database.prepare('SELECT count(*) AS count FROM audit_events WHERE application_id = ?').bind(dupApp.id).first().count;
    assert.equal(notesAfterFirst.length, 1);

    const duplicateRes = await worker.fetch(
        createRequest(`/api/staff/applications/${dupApp.id}/documents/passport/request-resubmission`, {
            method: 'POST',
            cookie: staffCookie,
            body: { expected_revision_number: 1, reason: 'İkinci yinelenen istek sebebi' }
        }),
        environment,
        {}
    );
    assert.equal(duplicateRes.status, 409);
    const duplicateBody = await duplicateRes.json();
    assert.equal(duplicateBody.error.code, 'DOCUMENT_REVIEW_CONFLICT');

    const notesAfterDuplicate = database.prepare('SELECT body FROM application_notes WHERE document_record_id = ?').bind(dupDoc.documentRecordId).all().results;
    const auditsAfterDuplicate = database.prepare('SELECT count(*) AS count FROM audit_events WHERE application_id = ?').bind(dupApp.id).first().count;
    const dupRevisionAfter = database.prepare('SELECT status FROM document_revisions WHERE id = ?').bind(dupDoc.revisionId).first();
    assert.equal(notesAfterDuplicate.length, 1);
    assert.equal(notesAfterDuplicate[0].body, 'İlk geçerli tekrar isteme sebebi');
    assert.equal(auditsAfterDuplicate, auditsAfterFirst);
    assert.equal(dupRevisionAfter.status, 'resubmission_required');

    // 2) Stale revision number when current revision is 2
    await createApplicant(environment, 'A04-STALE-002');
    const staleApp = findApplicationByStudentNumber(database, 'A04-STALE-002');
    await database.prepare(`UPDATE applications SET status = 'under_review', document_policy_version = 1 WHERE id = ?`).bind(staleApp.id).run();
    await seedDocument(database, staleApp.id, 'initial', 'passport', {
        reviewStatus: 'pending',
        revisionStatus: 'resubmission_required',
        revisionNumber: 1,
        scanStatus: 'clean',
        isCurrent: 0
    });
    const staleDocV2 = await seedDocument(database, staleApp.id, 'initial', 'passport', {
        reviewStatus: 'pending',
        revisionStatus: 'submitted',
        revisionNumber: 2,
        scanStatus: 'clean',
        isCurrent: 1
    });

    const staleRes = await worker.fetch(
        createRequest(`/api/staff/applications/${staleApp.id}/documents/passport/request-resubmission`, {
            method: 'POST',
            cookie: staffCookie,
            body: { expected_revision_number: 1, reason: 'Eski revizyon numarasıyla istek' }
        }),
        environment,
        {}
    );
    assert.equal(staleRes.status, 409);
    assert.equal((await staleRes.json()).error.code, 'DOCUMENT_REVIEW_CONFLICT');

    const v2RevisionAfter = database.prepare('SELECT status FROM document_revisions WHERE id = ?').bind(staleDocV2.revisionId).first();
    const staleNotes = database.prepare('SELECT count(*) AS count FROM application_notes WHERE application_id = ?').bind(staleApp.id).first().count;
    assert.equal(v2RevisionAfter.status, 'submitted');
    assert.equal(staleNotes, 0);
});

test('A05 Yenisi yuklenmis eski hatali dosya ve silinmis basvuru tarama listesinde yok; tarama makinesi ucu kisisel veri dondurmez', async () => {
    const { database, environment } = createEnvironment();
    const staffCookie = await seedStaff(environment, database);

    // 1) Replaced failed file (v1 failed is_current=0, v2 clean is_current=1)
    await createApplicant(environment, 'A05-REPLACED');
    const replacedApp = findApplicationByStudentNumber(database, 'A05-REPLACED');
    await database.prepare(`UPDATE applications SET status = 'under_review' WHERE id = ?`).bind(replacedApp.id).run();
    await seedDocument(database, replacedApp.id, 'initial', 'passport', {
        reviewStatus: 'pending',
        revisionStatus: 'resubmission_required',
        revisionNumber: 1,
        scanStatus: 'failed',
        isCurrent: 0
    });
    await seedDocument(database, replacedApp.id, 'initial', 'passport', {
        reviewStatus: 'pending',
        revisionStatus: 'submitted',
        revisionNumber: 2,
        scanStatus: 'clean',
        isCurrent: 1
    });

    // 2) Deleted application with failed current file
    await createApplicant(environment, 'A05-DELETED');
    const deletedApp = findApplicationByStudentNumber(database, 'A05-DELETED');
    await database.prepare(`UPDATE applications SET status = 'under_review' WHERE id = ?`).bind(deletedApp.id).run();
    await seedDocument(database, deletedApp.id, 'initial', 'passport', {
        reviewStatus: 'pending',
        revisionStatus: 'submitted',
        revisionNumber: 1,
        scanStatus: 'failed',
        isCurrent: 1
    });
    await database.prepare(`
        INSERT INTO application_deletions (application_id, previous_status, state, deleted_by_staff_id, deleted_at)
        VALUES (?, 'under_review', 'soft_deleted', 'reviewer-1', '2026-11-27T08:00:00.000Z')
    `).bind(deletedApp.id).run();

    // 3) Active application with failed current file and PII
    await createApplicant(environment, 'A05-ACTIVE');
    const activeApp = findApplicationByStudentNumber(database, 'A05-ACTIVE');
    await database.prepare(`
        UPDATE applications
        SET status = 'under_review', first_name = 'GizliAd', last_name = 'GizliSoyad'
        WHERE id = ?
    `).bind(activeApp.id).run();
    await seedDocument(database, activeApp.id, 'initial', 'passport', {
        reviewStatus: 'pending',
        revisionStatus: 'submitted',
        revisionNumber: 1,
        scanStatus: 'failed',
        isCurrent: 1
    });

    const staffScannerRes = await worker.fetch(
        createRequest('/api/staff/scanner/status', { cookie: staffCookie }),
        environment,
        {}
    );
    assert.equal(staffScannerRes.status, 200);
    const staffScannerPayload = await staffScannerRes.json();
    assert.equal(staffScannerPayload.failed_jobs.length, 1);
    assert.equal(staffScannerPayload.failed_jobs[0].application_id, activeApp.id);
    assert.equal(staffScannerPayload.actionable_failed_total, 1);

    const machineScannerRes = await worker.fetch(
        createRequest('/api/scanner/status', {
            origin: null,
            headers: { Authorization: `Bearer ${SCANNER_SECRET}` }
        }),
        environment,
        {}
    );
    assert.equal(machineScannerRes.status, 200);
    const machineText = await machineScannerRes.text();
    const machinePayload = JSON.parse(machineText);
    assert.equal(machinePayload.failed_jobs.length, 1);
    const machineJob = machinePayload.failed_jobs[0];
    assert.equal(machineJob.application_id, undefined);
    assert.equal(machineJob.student_number, undefined);
    assert.equal(machineJob.first_name, undefined);
    assert.equal(machineJob.last_name, undefined);
    assert.equal(machineJob.document_code, undefined);
    assert.doesNotMatch(machineText, /GizliAd|GizliSoyad|A05-ACTIVE|A05-DELETED|A05-REPLACED/);
});

test('A06 Soru notu: ekle, duzenle, sil; iki personel cakismasinda 409 ve ilk not korunur; 1000 kabul, 1001 ret', async () => {
    const { database, environment } = createEnvironment();
    const staff1Cookie = await seedStaff(environment, database, {
        id: 'reviewer-1',
        username: 'reviewer-1',
        displayName: 'Yetkili Bir',
        token: 'staff-session-token-a06-0000000000000000001'
    });
    const env2 = { ...environment };
    const staff2Cookie = await seedStaff(env2, database, {
        id: 'reviewer-2',
        username: 'reviewer-2',
        displayName: 'Yetkili Iki',
        token: 'staff-session-token-a06-0000000000000000002'
    });

    const createRes = await worker.fetch(createRequest('/api/public/inquiries', {
        method: 'POST',
        body: {
            first_name: 'Deniz',
            last_name: 'Kaya',
            phone: '+905551234567',
            email: 'deniz.kaya@example.edu',
            message: 'İkamet randevusu hakkında bilgi almak istiyorum.',
            language: 'tr'
        }
    }), environment, {});
    assert.equal(createRes.status, 201);

    const inquiry = database.prepare('SELECT id FROM office_inquiries ORDER BY created_at DESC LIMIT 1').first();
    assert.ok(inquiry?.id);

    // Add note
    const addRes = await worker.fetch(createRequest(`/api/staff/inquiries/${inquiry.id}/note`, {
        method: 'PUT',
        cookie: staff1Cookie,
        body: { note: 'İlk personel notu', expected_note_updated_at: null }
    }), environment, {});
    assert.equal(addRes.status, 200);
    const addedItem = (await addRes.json()).item;
    assert.equal(addedItem.staff_note, 'İlk personel notu');
    assert.equal(addedItem.staff_note_updated_by_name, 'Yetkili Bir');
    assert.ok(addedItem.staff_note_updated_at);

    // Concurrent edit conflict by second staff with stale expected_note_updated_at
    const conflictRes = await worker.fetch(createRequest(`/api/staff/inquiries/${inquiry.id}/note`, {
        method: 'PUT',
        cookie: staff2Cookie,
        body: { note: 'İkinci personelin çakışan notu', expected_note_updated_at: null }
    }), env2, {});
    assert.equal(conflictRes.status, 409);
    assert.equal((await conflictRes.json()).error.code, 'INQUIRY_NOTE_CONFLICT');
    const rowAfterConflict = database.prepare('SELECT staff_note FROM office_inquiries WHERE id = ?').bind(inquiry.id).first();
    assert.equal(rowAfterConflict.staff_note, 'İlk personel notu');

    // Edit note
    const editRes = await worker.fetch(createRequest(`/api/staff/inquiries/${inquiry.id}/note`, {
        method: 'PUT',
        cookie: staff1Cookie,
        body: { note: 'Güncellenmiş personel notu', expected_note_updated_at: addedItem.staff_note_updated_at }
    }), environment, {});
    assert.equal(editRes.status, 200);
    const editedItem = (await editRes.json()).item;
    assert.equal(editedItem.staff_note, 'Güncellenmiş personel notu');

    // Delete note (empty/whitespace clears it)
    const clearRes = await worker.fetch(createRequest(`/api/staff/inquiries/${inquiry.id}/note`, {
        method: 'PUT',
        cookie: staff1Cookie,
        body: { note: '   ', expected_note_updated_at: editedItem.staff_note_updated_at }
    }), environment, {});
    assert.equal(clearRes.status, 200);
    const clearedItem = (await clearRes.json()).item;
    assert.equal(clearedItem.staff_note, null);
    assert.equal(clearedItem.staff_note_updated_at, null);

    // Length boundary: 1000 accepted, 1001 rejected
    const note1000 = 'N'.repeat(1000);
    const accept1000Res = await worker.fetch(createRequest(`/api/staff/inquiries/${inquiry.id}/note`, {
        method: 'PUT',
        cookie: staff1Cookie,
        body: { note: note1000, expected_note_updated_at: null }
    }), environment, {});
    assert.equal(accept1000Res.status, 200);
    const saved1000 = (await accept1000Res.json()).item;
    assert.equal(saved1000.staff_note.length, 1000);

    const reject1001Res = await worker.fetch(createRequest(`/api/staff/inquiries/${inquiry.id}/note`, {
        method: 'PUT',
        cookie: staff1Cookie,
        body: { note: 'X'.repeat(1001), expected_note_updated_at: saved1000.staff_note_updated_at }
    }), environment, {});
    assert.equal(reject1001Res.status, 400);
    assert.equal((await reject1001Res.json()).error.code, 'VALIDATION_ERROR');
    const rowAfterReject = database.prepare('SELECT staff_note FROM office_inquiries WHERE id = ?').bind(inquiry.id).first();
    assert.equal(rowAfterReject.staff_note, note1000);
});

test('A07 Not hicbir herkese acik yanitta ve denetim kaydinda yok; oturumsuz 401, baska koken 403; soru silinince not da gider', async () => {
    const { database, environment } = createEnvironment();
    const staffCookie = await seedStaff(environment, database);

    const publicCreateRes = await worker.fetch(createRequest('/api/public/inquiries', {
        method: 'POST',
        body: {
            first_name: 'Mert',
            last_name: 'Demir',
            phone: '+905559876543',
            message: 'Öğrenci belgesi hakkında sorum var.',
            language: 'tr'
        }
    }), environment, {});
    assert.equal(publicCreateRes.status, 201);
    const publicCreateText = await publicCreateRes.text();
    assert.equal(publicCreateText.includes('staff_note'), false);

    const inquiry = database.prepare('SELECT id FROM office_inquiries ORDER BY created_at DESC LIMIT 1').first();
    assert.ok(inquiry?.id);

    // Unauthenticated -> 401
    const unauthRes = await worker.fetch(createRequest(`/api/staff/inquiries/${inquiry.id}/note`, {
        method: 'PUT',
        body: { note: 'Oturumsuz deneme', expected_note_updated_at: null }
    }), environment, {});
    assert.equal(unauthRes.status, 401);

    // Cross-origin -> 403
    const crossOriginRes = await worker.fetch(createRequest(`/api/staff/inquiries/${inquiry.id}/note`, {
        method: 'PUT',
        cookie: staffCookie,
        origin: 'https://evil.test',
        body: { note: 'Başka köken denemesi', expected_note_updated_at: null }
    }), environment, {});
    assert.equal(crossOriginRes.status, 403);

    // Save secret note and verify it never appears in audit_events
    const secretNote = 'GIZLI_IC_NOT_DENETIMDE_GORUNMEMELI';
    const saveRes = await worker.fetch(createRequest(`/api/staff/inquiries/${inquiry.id}/note`, {
        method: 'PUT',
        cookie: staffCookie,
        body: { note: secretNote, expected_note_updated_at: null }
    }), environment, {});
    assert.equal(saveRes.status, 200);

    const auditRows = database.prepare('SELECT event_type, safe_metadata_json FROM audit_events').all().results;
    assert.ok(auditRows.some((row) => row.event_type === 'staff.office_inquiry_note_saved'));
    for (const row of auditRows) {
        assert.equal((row.safe_metadata_json || '').includes(secretNote), false);
    }

    // Delete inquiry -> note is also deleted
    const deleteRes = await worker.fetch(createRequest(`/api/staff/inquiries/${inquiry.id}`, {
        method: 'DELETE',
        cookie: staffCookie
    }), environment, {});
    assert.equal(deleteRes.status, 200);
    const deletePayload = await deleteRes.json();
    assert.equal(deletePayload.deleted, true);
    assert.equal(typeof deletePayload.requestId, 'string');

    const inquiryAfterDelete = database.prepare('SELECT * FROM office_inquiries WHERE id = ?').bind(inquiry.id).first();
    assert.equal(inquiryAfterDelete, null);

    const listRes = await worker.fetch(createRequest('/api/staff/inquiries', { cookie: staffCookie }), environment, {});
    assert.equal(listRes.status, 200);
    const listPayload = await listRes.json();
    assert.equal(listPayload.items.some((item) => item.id === inquiry.id), false);
});
