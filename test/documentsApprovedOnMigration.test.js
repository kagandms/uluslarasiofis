import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { createD1Repositories } from '../src/server/repositories/d1/index.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const MIGRATIONS_URL = new URL('../migrations/', import.meta.url);
const MIGRATION_FILENAMES = readdirSync(MIGRATIONS_URL).filter((name) => name.endsWith('.sql')).sort();
const BACKFILL_FILENAME = '0043_approve_documents_of_migrated_applications.sql';

function createMigratedEnvironment() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    return {
        database,
        repositories: createD1Repositories(database),
        environment: { DB: database, APP_ENV: 'test', STAFF_SHARED_USERNAME: 'reviewer-1' }
    };
}

function seedStaffUser(database, id = 'reviewer-1') {
    database.prepare(`
        INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES (?, ?, ?, 'test-hash', 'Reviewer', 'reviewer')
    `).bind(id, id, id).run();
    return id;
}

async function seedStaffSession(environment, database, id = 'reviewer-1', token = 'staff-migration-docs-token-000000000000000') {
    environment.STAFF_SHARED_USERNAME = id;
    seedStaffUser(database, id);
    await database.prepare(`
        INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at)
        VALUES (?, ?, ?, ?)
    `).bind(crypto.randomUUID(), id, await hashSessionToken(token), '2999-01-01T00:00:00.000Z').run();
    return `staff_session=${token}`;
}

function seedApplication(database, {
    id = crypto.randomUUID(),
    studentNumber = `STU-${id.slice(0, 8)}`,
    status = 'under_review',
    updatedAt = '2026-10-15T08:30:00.000Z'
} = {}) {
    database.prepare(`
        INSERT INTO students (id, student_number, normalized_student_number)
        VALUES (?, ?, ?)
    `).bind(`student-${id}`, studentNumber, studentNumber.toUpperCase()).run();
    database.prepare(`
        INSERT INTO applications (
            id, student_id, application_type, status, is_under_18, address_evidence_type,
            document_policy_version, updated_at, last_activity_at
        ) VALUES (?, ?, 'initial', ?, 0, 'rental_contract', 1, ?, ?)
    `).bind(id, `student-${id}`, status, updatedAt, updatedAt).run();
    return id;
}

function findRequirementId(database, code) {
    const requirement = database.prepare(`
        SELECT id FROM document_requirements
        WHERE application_type = 'initial' AND code = ? AND is_active = 1
    `).bind(code).first();
    assert.ok(requirement, `active requirement missing for ${code}`);
    return requirement.id;
}

function seedDocumentRecordOnly(database, applicationId, code, reviewStatus = 'resubmission_required') {
    const documentRecordId = crypto.randomUUID();
    const requirementId = findRequirementId(database, code);
    database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type, review_status, updated_at)
        VALUES (?, ?, ?, 'initial', ?, '2026-10-10T09:00:00.000Z')
    `).bind(documentRecordId, applicationId, requirementId, reviewStatus).run();
    return { documentRecordId };
}

function seedDocumentWithRevision(database, applicationId, code, {
    reviewStatus = 'pending',
    revisionStatus = 'submitted',
    revisionNumber = 1,
    isCurrent = 1,
    uploadStatus = 'finalized',
    scanStatus = 'clean',
    cleanupStatus = 'none',
    reviewedAt = null,
    reviewedByStaffId = null,
    existingRecordId = null
} = {}) {
    const requirementId = findRequirementId(database, code);
    const documentRecordId = existingRecordId ?? crypto.randomUUID();
    if (!existingRecordId) {
        database.prepare(`
            INSERT INTO document_records (id, application_id, requirement_id, application_type, review_status, updated_at)
            VALUES (?, ?, ?, 'initial', ?, '2026-10-10T09:00:00.000Z')
        `).bind(documentRecordId, applicationId, requirementId, reviewStatus).run();
    }
    const revisionId = crypto.randomUUID();
    database.prepare(`
        INSERT INTO document_revisions (
            id, document_record_id, revision_number, status, is_current,
            submitted_by_type, reviewed_at, reviewed_by_staff_id
        ) VALUES (?, ?, ?, ?, ?, 'student', ?, ?)
    `).bind(revisionId, documentRecordId, revisionNumber, revisionStatus, isCurrent, reviewedAt, reviewedByStaffId).run();
    const fileId = crypto.randomUUID();
    database.prepare(`
        INSERT INTO document_revision_files (
            id, revision_id, page_order, storage_key, original_filename, media_type,
            byte_size, upload_status, scan_status, cleanup_status
        ) VALUES (?, ?, 0, ?, ?, 'application/pdf', 1024, ?, ?, ?)
    `).bind(fileId, revisionId, `quarantine/${crypto.randomUUID()}`, `${code}.pdf`, uploadStatus, scanStatus, cleanupStatus).run();
    return { documentRecordId, revisionId, fileId };
}

test('forward path: transition to sent_to_migration approves eligible current revisions and records while skipping unsafe/missing documents', async () => {
    const { database, repositories } = createMigratedEnvironment();
    const staffId = seedStaffUser(database, 'reviewer-1');
    const priorStaffId = seedStaffUser(database, 'reviewer-prior');
    const initialUpdatedAt = '2026-10-20T10:00:00.000Z';
    const transitionNow = '2026-11-17T11:30:00.000Z';
    const applicationId = seedApplication(database, {
        status: 'under_review',
        updatedAt: initialUpdatedAt
    });

    // Uygun revizyonlar: submitted ve resubmission_required (clean + finalized + cleanup_status='none')
    const submittedDoc = seedDocumentWithRevision(database, applicationId, 'passport', {
        reviewStatus: 'pending',
        revisionStatus: 'submitted',
        revisionNumber: 2,
        isCurrent: 1
    });
    // Önceki güncel olmayan revizyon dokunulmadan kalmalı
    const oldRevision = seedDocumentWithRevision(database, applicationId, 'passport', {
        existingRecordId: submittedDoc.documentRecordId,
        revisionStatus: 'superseded',
        revisionNumber: 1,
        isCurrent: 0
    });
    const resubmissionDoc = seedDocumentWithRevision(database, applicationId, 'student_certificate', {
        reviewStatus: 'resubmission_required',
        revisionStatus: 'resubmission_required'
    });

    // Önceden onaylanmış belge: inceleme zamanı ve personeli korunmalı
    const priorReviewedAt = '2026-10-18T14:00:00.000Z';
    const alreadyApprovedDoc = seedDocumentWithRevision(database, applicationId, 'health_insurance', {
        reviewStatus: 'approved',
        revisionStatus: 'approved',
        reviewedAt: priorReviewedAt,
        reviewedByStaffId: priorStaffId
    });

    // Revizyonu hiç yüklenmemiş belge kaydı: onaylanmamalı
    const missingRevisionDoc = seedDocumentRecordOnly(database, applicationId, 'photographs', 'resubmission_required');

    // Güvenlik taramasından geçememiş veya tarama/yükleme/temizlik bekleyen dosyalar: onaylanmamalı
    const infectedDoc = seedDocumentWithRevision(database, applicationId, 'residence_application_form', {
        reviewStatus: 'pending',
        revisionStatus: 'submitted',
        scanStatus: 'unsafe'
    });
    const pendingScanDoc = seedDocumentWithRevision(database, applicationId, 'residence_permit_fee', {
        reviewStatus: 'pending',
        revisionStatus: 'submitted',
        scanStatus: 'pending'
    });
    const unfinalizedDoc = seedDocumentWithRevision(database, applicationId, 'address_rental_contract', {
        reviewStatus: 'pending',
        revisionStatus: 'submitted',
        uploadStatus: 'uploaded'
    });
    const cleanupPendingDoc = seedDocumentWithRevision(database, applicationId, 'home_utility_bill', {
        reviewStatus: 'pending',
        revisionStatus: 'submitted',
        cleanupStatus: 'pending'
    });

    const applied = await repositories.applicationReviews.transitionApplicationStatus({
        applicationId,
        currentStatus: 'under_review',
        expectedUpdatedAt: initialUpdatedAt,
        targetStatus: 'sent_to_migration',
        rejectionReason: null,
        rejectionNoteId: null,
        staffId,
        now: transitionNow,
        requestId: 'req-forward-1',
        auditId: 'audit-status-1',
        documentsAuditId: 'audit-docs-1'
    });

    assert.equal(applied, true);

    const app = database.prepare('SELECT status, updated_at FROM applications WHERE id = ?').bind(applicationId).first();
    assert.equal(app.status, 'sent_to_migration');
    assert.equal(app.updated_at, transitionNow);

    for (const doc of [submittedDoc, resubmissionDoc]) {
        const rev = database.prepare('SELECT status, reviewed_at, reviewed_by_staff_id FROM document_revisions WHERE id = ?')
            .bind(doc.revisionId).first();
        const rec = database.prepare('SELECT review_status, updated_at FROM document_records WHERE id = ?')
            .bind(doc.documentRecordId).first();
        assert.deepEqual({ ...rev }, { status: 'approved', reviewed_at: transitionNow, reviewed_by_staff_id: staffId });
        assert.deepEqual({ ...rec }, { review_status: 'approved', updated_at: transitionNow });
    }

    const oldRevRow = database.prepare('SELECT status, reviewed_at, reviewed_by_staff_id FROM document_revisions WHERE id = ?')
        .bind(oldRevision.revisionId).first();
    assert.deepEqual({ ...oldRevRow }, { status: 'superseded', reviewed_at: null, reviewed_by_staff_id: null });

    const preservedRev = database.prepare('SELECT status, reviewed_at, reviewed_by_staff_id FROM document_revisions WHERE id = ?')
        .bind(alreadyApprovedDoc.revisionId).first();
    const preservedRec = database.prepare('SELECT review_status, updated_at FROM document_records WHERE id = ?')
        .bind(alreadyApprovedDoc.documentRecordId).first();
    assert.deepEqual({ ...preservedRev }, { status: 'approved', reviewed_at: priorReviewedAt, reviewed_by_staff_id: priorStaffId });
    assert.deepEqual({ ...preservedRec }, { review_status: 'approved', updated_at: '2026-10-10T09:00:00.000Z' });

    const missingRec = database.prepare('SELECT review_status FROM document_records WHERE id = ?')
        .bind(missingRevisionDoc.documentRecordId).first();
    assert.equal(missingRec.review_status, 'resubmission_required');

    for (const doc of [infectedDoc, pendingScanDoc, unfinalizedDoc, cleanupPendingDoc]) {
        const rev = database.prepare('SELECT status, reviewed_at, reviewed_by_staff_id FROM document_revisions WHERE id = ?')
            .bind(doc.revisionId).first();
        const rec = database.prepare('SELECT review_status FROM document_records WHERE id = ?')
            .bind(doc.documentRecordId).first();
        assert.deepEqual({ ...rev }, { status: 'submitted', reviewed_at: null, reviewed_by_staff_id: null });
        assert.equal(rec.review_status, 'pending');
    }

    const audits = database.prepare(`
        SELECT id, event_type, actor_type, actor_staff_id, application_id, document_record_id, request_id, safe_metadata_json
        FROM audit_events WHERE application_id = ? ORDER BY id
    `).bind(applicationId).all().results;
    assert.equal(audits.length, 2);
    const docsAudit = audits.find((row) => row.event_type === 'staff.application_documents_approved_on_migration');
    assert.ok(docsAudit);
    assert.deepEqual({ ...docsAudit }, {
        id: 'audit-docs-1',
        event_type: 'staff.application_documents_approved_on_migration',
        actor_type: 'staff',
        actor_staff_id: staffId,
        application_id: applicationId,
        document_record_id: null,
        request_id: 'req-forward-1',
        safe_metadata_json: JSON.stringify({ applicationStatus: 'sent_to_migration', result: 'success' })
    });
});

test('forward path: stale expected_updated_at does not update application or approve any documents', async () => {
    const { database, repositories } = createMigratedEnvironment();
    const staffId = seedStaffUser(database, 'reviewer-1');
    const actualUpdatedAt = '2026-10-20T10:00:00.000Z';
    const applicationId = seedApplication(database, {
        status: 'under_review',
        updatedAt: actualUpdatedAt
    });
    const doc = seedDocumentWithRevision(database, applicationId, 'passport', {
        reviewStatus: 'pending',
        revisionStatus: 'submitted'
    });

    const applied = await repositories.applicationReviews.transitionApplicationStatus({
        applicationId,
        currentStatus: 'under_review',
        expectedUpdatedAt: '2026-10-19T00:00:00.000Z',
        targetStatus: 'sent_to_migration',
        rejectionReason: null,
        rejectionNoteId: null,
        staffId,
        now: '2026-11-17T12:00:00.000Z',
        requestId: 'req-stale-1',
        auditId: 'audit-stale-status',
        documentsAuditId: 'audit-stale-docs'
    });

    assert.equal(applied, false);
    const app = database.prepare('SELECT status, updated_at FROM applications WHERE id = ?').bind(applicationId).first();
    assert.deepEqual({ ...app }, { status: 'under_review', updated_at: actualUpdatedAt });
    const rev = database.prepare('SELECT status, reviewed_at, reviewed_by_staff_id FROM document_revisions WHERE id = ?')
        .bind(doc.revisionId).first();
    const rec = database.prepare('SELECT review_status FROM document_records WHERE id = ?')
        .bind(doc.documentRecordId).first();
    assert.deepEqual({ ...rev }, { status: 'submitted', reviewed_at: null, reviewed_by_staff_id: null });
    assert.equal(rec.review_status, 'pending');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE application_id = ?').bind(applicationId).first().count, 0);
});

test('forward path: other target statuses do not approve documents and sent_to_migration with no newly approved docs writes no extra audit', async () => {
    const { database, repositories } = createMigratedEnvironment();
    const staffId = seedStaffUser(database, 'reviewer-1');

    // Diğer durum geçişleri belgelere dokunmamalı
    for (const [index, [fromStatus, toStatus]] of [
        ['submitted', 'under_review'],
        ['under_review', 'approved_for_processing'],
        ['sent_to_migration', 'migration_approved'],
        ['migration_approved', 'completed'],
        ['sent_to_migration', 'rejected']
    ].entries()) {
        const initialUpdatedAt = `2026-10-21T0${index}:00:00.000Z`;
        const appId = seedApplication(database, { status: fromStatus, updatedAt: initialUpdatedAt });
        const doc = seedDocumentWithRevision(database, appId, 'passport', {
            reviewStatus: 'pending',
            revisionStatus: 'submitted'
        });

        const applied = await repositories.applicationReviews.transitionApplicationStatus({
            applicationId: appId,
            currentStatus: fromStatus,
            expectedUpdatedAt: initialUpdatedAt,
            targetStatus: toStatus,
            rejectionReason: toStatus === 'rejected' ? 'Resmî gerekçe ile ret.' : null,
            rejectionNoteId: toStatus === 'rejected' ? `note-${index}` : null,
            staffId,
            now: `2026-11-17T0${index}:00:00.000Z`,
            requestId: `req-other-${index}`,
            auditId: `audit-other-${index}`
        });

        assert.equal(applied, true);
        assert.equal(database.prepare('SELECT status FROM document_revisions WHERE id = ?').bind(doc.revisionId).first().status, 'submitted');
        assert.equal(database.prepare('SELECT review_status FROM document_records WHERE id = ?').bind(doc.documentRecordId).first().review_status, 'pending');
        assert.equal(database.prepare(`
            SELECT COUNT(*) AS count FROM audit_events
            WHERE application_id = ? AND event_type = 'staff.application_documents_approved_on_migration'
        `).bind(appId).first().count, 0);
    }

    // Tüm belgeleri zaten onaylı olan başvuruda sent_to_migration ek belge denetim kaydı oluşturmamalı
    const alreadyDoneUpdatedAt = '2026-10-22T10:00:00.000Z';
    const alreadyDoneAppId = seedApplication(database, { status: 'approved_for_processing', updatedAt: alreadyDoneUpdatedAt });
    seedDocumentWithRevision(database, alreadyDoneAppId, 'passport', {
        reviewStatus: 'approved',
        revisionStatus: 'approved',
        reviewedAt: '2026-10-22T09:00:00.000Z',
        reviewedByStaffId: staffId
    });
    const ok = await repositories.applicationReviews.transitionApplicationStatus({
        applicationId: alreadyDoneAppId,
        currentStatus: 'approved_for_processing',
        expectedUpdatedAt: alreadyDoneUpdatedAt,
        targetStatus: 'sent_to_migration',
        rejectionReason: null,
        rejectionNoteId: null,
        staffId,
        now: '2026-11-17T13:00:00.000Z',
        requestId: 'req-already-done',
        auditId: 'audit-already-done-status'
    });
    assert.equal(ok, true);
    assert.equal(database.prepare(`
        SELECT COUNT(*) AS count FROM audit_events
        WHERE application_id = ? AND event_type = 'staff.application_documents_approved_on_migration'
    `).bind(alreadyDoneAppId).first().count, 0);
});

test('forward path HTTP route: direct_transfer to sent_to_migration keeps application status sent_to_migration and approves attached documents', async () => {
    const { database, environment } = createMigratedEnvironment();
    const cookie = await seedStaffSession(environment, database, 'reviewer-1');
    const updatedAt = '2026-10-25T09:00:00.000Z';
    const applicationId = seedApplication(database, { status: 'under_review', updatedAt });
    const submittedDoc = seedDocumentWithRevision(database, applicationId, 'passport', {
        reviewStatus: 'pending',
        revisionStatus: 'submitted'
    });
    const resubDoc = seedDocumentWithRevision(database, applicationId, 'visa', {
        reviewStatus: 'resubmission_required',
        revisionStatus: 'resubmission_required'
    });
    const missingDoc = seedDocumentRecordOnly(database, applicationId, 'photographs', 'pending');

    const response = await worker.fetch(new Request(`https://portal.test/api/staff/applications/${applicationId}/status`, {
        method: 'POST',
        headers: { Origin: 'https://portal.test', 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
            target_status: 'sent_to_migration',
            expected_updated_at: updatedAt,
            direct_transfer: true
        })
    }), environment);

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.application_status, 'sent_to_migration');
    assert.equal(database.prepare('SELECT status FROM applications WHERE id = ?').bind(applicationId).first().status, 'sent_to_migration');
    assert.equal(database.prepare('SELECT status FROM document_revisions WHERE id = ?').bind(submittedDoc.revisionId).first().status, 'approved');
    assert.equal(database.prepare('SELECT review_status FROM document_records WHERE id = ?').bind(submittedDoc.documentRecordId).first().review_status, 'approved');
    assert.equal(database.prepare('SELECT status FROM document_revisions WHERE id = ?').bind(resubDoc.revisionId).first().status, 'approved');
    assert.equal(database.prepare('SELECT review_status FROM document_records WHERE id = ?').bind(resubDoc.documentRecordId).first().review_status, 'approved');
    assert.equal(database.prepare('SELECT review_status FROM document_records WHERE id = ?').bind(missingDoc.documentRecordId).first().review_status, 'pending');
    assert.equal(database.prepare(`
        SELECT COUNT(*) AS count FROM audit_events
        WHERE application_id = ? AND event_type = 'staff.application_documents_approved_on_migration'
    `).bind(applicationId).first().count, 1);
});

test('backfill migration 0043 approves only eligible documents of migrated applications and is idempotent', () => {
    const database = new TestD1Database();
    for (const filename of MIGRATION_FILENAMES.filter((name) => name < BACKFILL_FILENAME)) {
        database.exec(readFileSync(new URL(filename, MIGRATIONS_URL), 'utf8'));
    }
    const staffId = seedStaffUser(database, 'reviewer-prior');
    const priorReviewedAt = '2026-09-01T10:00:00.000Z';

    const allStatuses = [
        'draft', 'submitted', 'under_review', 'resubmission_required', 'approved_for_processing',
        'sent_to_migration', 'migration_approved', 'completed', 'cancelled', 'rejected'
    ];
    const eligibleStatuses = new Set(['sent_to_migration', 'migration_approved', 'completed']);
    const seededByStatus = new Map();

    for (const [index, status] of allStatuses.entries()) {
        const day = String(index + 1).padStart(2, '0');
        const updatedAt = `2026-10-${day}T12:00:00.000Z`;
        const appId = seedApplication(database, {
            id: `app-${status}`,
            studentNumber: `BF-${index}`,
            status,
            updatedAt
        });
        const submittedDoc = seedDocumentWithRevision(database, appId, 'passport', {
            reviewStatus: 'pending',
            revisionStatus: 'submitted'
        });
        const resubDoc = seedDocumentWithRevision(database, appId, 'student_certificate', {
            reviewStatus: 'resubmission_required',
            revisionStatus: 'resubmission_required'
        });
        const infectedDoc = seedDocumentWithRevision(database, appId, 'health_insurance', {
            reviewStatus: 'pending',
            revisionStatus: 'submitted',
            scanStatus: 'unsafe'
        });
        const missingDoc = seedDocumentRecordOnly(database, appId, 'photographs', 'resubmission_required');
        const alreadyApprovedDoc = seedDocumentWithRevision(database, appId, 'visa', {
            reviewStatus: 'approved',
            revisionStatus: 'approved',
            reviewedAt: priorReviewedAt,
            reviewedByStaffId: staffId
        });
        seededByStatus.set(status, { appId, updatedAt, submittedDoc, resubDoc, infectedDoc, missingDoc, alreadyApprovedDoc });
    }

    // Zaten tüm belgeleri onaylı olan bir sent_to_migration başvurusu ek denetim kaydı almamalı
    const alreadyCleanAppId = seedApplication(database, {
        id: 'app-sent-already-approved',
        studentNumber: 'BF-CLEAN',
        status: 'sent_to_migration',
        updatedAt: '2026-10-12T12:00:00.000Z'
    });
    seedDocumentWithRevision(database, alreadyCleanAppId, 'passport', {
        reviewStatus: 'approved',
        revisionStatus: 'approved',
        reviewedAt: priorReviewedAt,
        reviewedByStaffId: staffId
    });

    const migrationSql = readFileSync(new URL(BACKFILL_FILENAME, MIGRATIONS_URL), 'utf8');
    database.exec(migrationSql);

    for (const status of allStatuses) {
        const entry = seededByStatus.get(status);
        const app = database.prepare('SELECT status, updated_at FROM applications WHERE id = ?').bind(entry.appId).first();
        assert.deepEqual({ ...app }, { status, updated_at: entry.updatedAt });

        if (eligibleStatuses.has(status)) {
            for (const doc of [entry.submittedDoc, entry.resubDoc]) {
                const rev = database.prepare('SELECT status, reviewed_at, reviewed_by_staff_id FROM document_revisions WHERE id = ?')
                    .bind(doc.revisionId).first();
                const rec = database.prepare('SELECT review_status FROM document_records WHERE id = ?')
                    .bind(doc.documentRecordId).first();
                assert.equal(rev.status, 'approved');
                assert.ok(rev.reviewed_at);
                assert.equal(rev.reviewed_by_staff_id, null);
                assert.equal(rec.review_status, 'approved');
            }
            const auditRows = database.prepare(`
                SELECT event_type, actor_type, actor_staff_id, request_id, safe_metadata_json
                FROM audit_events WHERE application_id = ?
            `).bind(entry.appId).all().results;
            assert.equal(auditRows.length, 1);
            assert.deepEqual({ ...auditRows[0] }, {
                event_type: 'system.documents_approved_for_migrated_application',
                actor_type: 'system',
                actor_staff_id: null,
                request_id: 'migration-0043',
                safe_metadata_json: JSON.stringify({ applicationStatus: status, result: 'success' })
            });
        } else {
            for (const doc of [entry.submittedDoc, entry.resubDoc]) {
                const rev = database.prepare('SELECT status, reviewed_at, reviewed_by_staff_id FROM document_revisions WHERE id = ?')
                    .bind(doc.revisionId).first();
                assert.equal(rev.status, doc === entry.submittedDoc ? 'submitted' : 'resubmission_required');
                assert.equal(rev.reviewed_at, null);
                assert.equal(rev.reviewed_by_staff_id, null);
            }
            assert.equal(database.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE application_id = ?')
                .bind(entry.appId).first().count, 0);
        }

        // Güvenli olmayan veya revizyonsuz belgeler hiçbir başvuruda onaylanmamalı
        assert.equal(database.prepare('SELECT status FROM document_revisions WHERE id = ?')
            .bind(entry.infectedDoc.revisionId).first().status, 'submitted');
        assert.equal(database.prepare('SELECT review_status FROM document_records WHERE id = ?')
            .bind(entry.infectedDoc.documentRecordId).first().review_status, 'pending');
        assert.equal(database.prepare('SELECT review_status FROM document_records WHERE id = ?')
            .bind(entry.missingDoc.documentRecordId).first().review_status, 'resubmission_required');

        // Önceden onaylı belgelerin mevcut alanları korunmalı
        const keptRev = database.prepare('SELECT status, reviewed_at, reviewed_by_staff_id FROM document_revisions WHERE id = ?')
            .bind(entry.alreadyApprovedDoc.revisionId).first();
        assert.deepEqual({ ...keptRev }, { status: 'approved', reviewed_at: priorReviewedAt, reviewed_by_staff_id: staffId });
    }

    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE application_id = ?')
        .bind(alreadyCleanAppId).first().count, 0);
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all().results, []);

    // İkinci çalıştırmada hiçbir satır değişmemeli veya yeni denetim kaydı oluşmamalı
    database.exec(`
        CREATE TRIGGER forbid_audit_on_rerun BEFORE INSERT ON audit_events
        BEGIN SELECT RAISE(ABORT, 'unexpected audit insert on rerun'); END;
        CREATE TRIGGER forbid_revision_update_on_rerun BEFORE UPDATE ON document_revisions
        BEGIN SELECT RAISE(ABORT, 'unexpected revision update on rerun'); END;
        CREATE TRIGGER forbid_record_update_on_rerun BEFORE UPDATE ON document_records
        BEGIN SELECT RAISE(ABORT, 'unexpected record update on rerun'); END;
        CREATE TRIGGER forbid_application_update_on_rerun BEFORE UPDATE ON applications
        BEGIN SELECT RAISE(ABORT, 'unexpected application update on rerun'); END;
    `);
    database.exec(migrationSql);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM audit_events').first().count, 3);
    database.database.close();
});
