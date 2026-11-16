import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createD1Repositories } from '../src/server/repositories/d1/index.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

function createRepositories() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    return { database, repositories: createD1Repositories(database) };
}

async function createDraft(repositories, applicationId, studentId, applicationType = 'initial') {
    return repositories.applications.createDraft({
        applicationId,
        studentId,
        studentNumber: studentId,
        applicationType,
        studentEmail: `${studentId}@example.edu`,
        studentPhone: '+905551112233'
    });
}

function listActiveInitialRequirements(database) {
    return database.prepare(`
        SELECT id, code, display_order
        FROM document_requirements
        WHERE application_type = 'initial' AND is_active = 1
        ORDER BY display_order, code
    `).all().results;
}

function insertDocumentRecord(database, { id, applicationId, requirementId, reviewStatus = 'pending' }) {
    database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type, review_status)
        VALUES (?, ?, ?, 'initial', ?)
    `).bind(id, applicationId, requirementId, reviewStatus).run();
}

function insertRevisionFileIntent(database, {
    revisionId,
    documentRecordId,
    revisionNumber,
    revisionStatus = 'pending_scan',
    isCurrent = 0,
    fileId,
    uploadStatus = 'intent',
    scanStatus = 'pending',
    cleanupStatus = 'none',
    intentId,
    intentStatus = 'pending',
    expiresAt = '2099-01-01T00:00:00.000Z'
}) {
    database.prepare(`
        INSERT INTO document_revisions (id, document_record_id, revision_number, status, is_current, submitted_by_type)
        VALUES (?, ?, ?, ?, ?, 'student')
    `).bind(revisionId, documentRecordId, revisionNumber, revisionStatus, isCurrent).run();
    database.prepare(`
        INSERT INTO document_revision_files (
            id, revision_id, page_order, storage_key, original_filename, media_type, byte_size,
            upload_status, scan_status, cleanup_status
        ) VALUES (?, ?, 0, ?, ?, 'application/pdf', 128, ?, ?, ?)
    `).bind(fileId, revisionId, `quarantine/${fileId}`, `${fileId}.pdf`, uploadStatus, scanStatus, cleanupStatus).run();
    if (intentId) {
        database.prepare(`
            INSERT INTO upload_intents (id, revision_file_id, idempotency_key, expires_at, status)
            VALUES (?, ?, ?, ?, ?)
        `).bind(intentId, fileId, `key-${intentId}`, expiresAt, intentStatus).run();
    }
}

function explainPlan(database, sql, ...values) {
    return database.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...values).all().results
        .map((row) => row.detail)
        .join('\n');
}

test('upload_intents rejected-cleanup queries seek by revision_file_id instead of scanning idx_upload_intents_expiry_status', () => {
    const { database } = createRepositories();

    const docRejectIntentsPlan = explainPlan(database, `
        UPDATE upload_intents SET status = 'rejected'
        WHERE revision_file_id IN (
            SELECT files.id FROM document_revision_files AS files
            JOIN document_revisions AS revisions ON revisions.id = files.revision_id
            JOIN document_records AS records ON records.id = revisions.document_record_id
            WHERE records.application_id = ? AND records.requirement_id = ?
              AND revisions.is_current = 0 AND revisions.status = 'pending_scan'
        ) AND +status = 'pending'
    `, 'app-1', 'req-1');
    assert.match(docRejectIntentsPlan, /revision_file_id=\?/);
    assert.doesNotMatch(docRejectIntentsPlan, /idx_upload_intents_expiry_status/);

    const docRejectFilesPlan = explainPlan(database, `
        UPDATE document_revision_files SET upload_status = 'rejected'
        WHERE id IN (
            SELECT intents.revision_file_id FROM upload_intents AS intents
            WHERE intents.revision_file_id IN (
                SELECT files.id FROM document_revision_files AS files
                JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                JOIN document_records AS records ON records.id = revisions.document_record_id
                WHERE records.application_id = ? AND records.requirement_id = ?
                  AND revisions.is_current = 0 AND revisions.status = 'pending_scan'
            ) AND +intents.status = 'rejected'
        )
    `, 'app-1', 'req-1');
    assert.match(docRejectFilesPlan, /revision_file_id=\?/);
    assert.doesNotMatch(docRejectFilesPlan, /idx_upload_intents_expiry_status/);

    const docDeletePlan = explainPlan(database, `
        UPDATE upload_intents SET status = 'rejected'
        WHERE revision_file_id IN (
            SELECT files.id FROM document_revision_files AS files
            JOIN document_revisions AS revisions ON revisions.id = files.revision_id
            WHERE revisions.document_record_id = ?
        ) AND +status = 'pending'
    `, 'record-1');
    assert.match(docDeletePlan, /revision_file_id=\?/);
    assert.doesNotMatch(docDeletePlan, /idx_upload_intents_expiry_status/);

    const resubRejectIntentsPlan = explainPlan(database, `
        UPDATE upload_intents SET status = 'rejected'
        WHERE changes() = 1 AND id <> ? AND +status = 'pending' AND revision_file_id IN (
            SELECT files.id FROM document_revision_files AS files
            JOIN document_revisions AS revisions ON revisions.id = files.revision_id
            WHERE revisions.document_record_id = ? AND revisions.is_current = 0
              AND revisions.status = 'pending_scan'
        )
    `, 'intent-new', 'record-1');
    assert.match(resubRejectIntentsPlan, /revision_file_id=\?/);
    assert.doesNotMatch(resubRejectIntentsPlan, /idx_upload_intents_expiry_status/);

    const resubRejectFilesPlan = explainPlan(database, `
        UPDATE document_revision_files SET upload_status = 'rejected',
            cleanup_status = 'pending', cleanup_requested_at = ?
        WHERE changes() = 1 AND revision_id IN (
            SELECT revisions.id FROM document_revisions AS revisions
            JOIN document_revision_files AS old_files ON old_files.revision_id = revisions.id
            JOIN upload_intents AS old_intents ON old_intents.revision_file_id = old_files.id
            WHERE revisions.document_record_id = ? AND revisions.is_current = 0
              AND revisions.status = 'pending_scan' AND +old_intents.status = 'rejected'
              AND old_intents.id <> ?
        )
    `, '2026-10-01T00:00:00.000Z', 'record-1', 'intent-new');
    assert.match(resubRejectFilesPlan, /document_record_id=\?/);
    assert.match(resubRejectFilesPlan, /revision_file_id=/);
    assert.doesNotMatch(resubRejectFilesPlan, /idx_upload_intents_expiry_status/);

    const cleanupScalarPlan = explainPlan(database, `
        SELECT CASE MAX(CASE cleanup_files.cleanup_status
                          WHEN 'pending' THEN 2
                          WHEN 'complete' THEN 1
                        END)
                 WHEN 2 THEN 'pending'
                 WHEN 1 THEN 'complete'
                 ELSE NULL
               END
        FROM document_revisions AS cleanup_revisions
        CROSS JOIN document_revision_files AS cleanup_files
        WHERE cleanup_files.revision_id = cleanup_revisions.id
          AND cleanup_revisions.document_record_id = ?
    `, 'record-1');
    assert.match(cleanupScalarPlan, /document_record_id=\?/);
    assert.match(cleanupScalarPlan, /revision_id=\?/);
    assert.doesNotMatch(cleanupScalarPlan, /idx_document_files_cleanup_status/);
});

test('createStudentUploadIntent rejects only non-current pending_scan files of the target application and requirement', async () => {
    const { database, repositories } = createRepositories();
    const requirements = listActiveInitialRequirements(database);
    const targetReq = requirements[0];
    const otherReq = requirements[1];

    await createDraft(repositories, 'app-target', 'PERF-STUDENT-1');
    await createDraft(repositories, 'app-other', 'PERF-STUDENT-2');

    insertDocumentRecord(database, { id: 'rec-target', applicationId: 'app-target', requirementId: targetReq.id });
    insertDocumentRecord(database, { id: 'rec-other-req', applicationId: 'app-target', requirementId: otherReq.id });
    insertDocumentRecord(database, { id: 'rec-other-app', applicationId: 'app-other', requirementId: targetReq.id });

    // 1. Eligible pending intent on non-current pending_scan revision -> flipped to rejected.
    insertRevisionFileIntent(database, {
        revisionId: 'rev-t-pending', documentRecordId: 'rec-target', revisionNumber: 1,
        revisionStatus: 'pending_scan', isCurrent: 0,
        fileId: 'file-t-pending', uploadStatus: 'intent',
        intentId: 'intent-t-pending', intentStatus: 'pending'
    });
    // 2. Already-rejected intent on non-current pending_scan revision -> file upload_status flipped to rejected.
    insertRevisionFileIntent(database, {
        revisionId: 'rev-t-pre-rej', documentRecordId: 'rec-target', revisionNumber: 2,
        revisionStatus: 'pending_scan', isCurrent: 0,
        fileId: 'file-t-pre-rej', uploadStatus: 'intent',
        intentId: 'intent-t-pre-rej', intentStatus: 'rejected'
    });
    // 3. Non-rejected (completed) intent on non-current pending_scan revision -> file & intent untouched.
    insertRevisionFileIntent(database, {
        revisionId: 'rev-t-completed', documentRecordId: 'rec-target', revisionNumber: 3,
        revisionStatus: 'pending_scan', isCurrent: 0,
        fileId: 'file-t-completed', uploadStatus: 'finalized',
        intentId: 'intent-t-completed', intentStatus: 'completed'
    });
    // 4. Non-pending_scan (submitted) non-current revision with rejected intent -> file untouched.
    insertRevisionFileIntent(database, {
        revisionId: 'rev-t-submitted', documentRecordId: 'rec-target', revisionNumber: 4,
        revisionStatus: 'submitted', isCurrent: 0,
        fileId: 'file-t-submitted', uploadStatus: 'finalized',
        intentId: 'intent-t-submitted', intentStatus: 'rejected'
    });
    // 5. Current (is_current = 1) pending_scan revision with rejected intent -> file & revision untouched.
    insertRevisionFileIntent(database, {
        revisionId: 'rev-t-current', documentRecordId: 'rec-target', revisionNumber: 5,
        revisionStatus: 'pending_scan', isCurrent: 1,
        fileId: 'file-t-current', uploadStatus: 'intent',
        intentId: 'intent-t-current', intentStatus: 'rejected'
    });
    // 6. Same application, different requirement -> untouched.
    insertRevisionFileIntent(database, {
        revisionId: 'rev-or-pending', documentRecordId: 'rec-other-req', revisionNumber: 1,
        revisionStatus: 'pending_scan', isCurrent: 0,
        fileId: 'file-or-pending', uploadStatus: 'intent',
        intentId: 'intent-or-pending', intentStatus: 'pending'
    });
    insertRevisionFileIntent(database, {
        revisionId: 'rev-or-rej', documentRecordId: 'rec-other-req', revisionNumber: 2,
        revisionStatus: 'pending_scan', isCurrent: 0,
        fileId: 'file-or-rej', uploadStatus: 'intent',
        intentId: 'intent-or-rej', intentStatus: 'rejected'
    });
    // 7. Different application, same requirement -> untouched.
    insertRevisionFileIntent(database, {
        revisionId: 'rev-oa-pending', documentRecordId: 'rec-other-app', revisionNumber: 1,
        revisionStatus: 'pending_scan', isCurrent: 0,
        fileId: 'file-oa-pending', uploadStatus: 'intent',
        intentId: 'intent-oa-pending', intentStatus: 'pending'
    });
    insertRevisionFileIntent(database, {
        revisionId: 'rev-oa-rej', documentRecordId: 'rec-other-app', revisionNumber: 2,
        revisionStatus: 'pending_scan', isCurrent: 0,
        fileId: 'file-oa-rej', uploadStatus: 'intent',
        intentId: 'intent-oa-rej', intentStatus: 'rejected'
    });

    const created = await repositories.documents.createStudentUploadIntent({
        applicationId: 'app-target',
        requirementId: targetReq.id,
        conditionalRule: null,
        documentRecordId: 'rec-target',
        revisionId: 'rev-t-new',
        fileId: 'file-t-new',
        storageKey: 'quarantine/file-t-new',
        filename: 'new.pdf',
        mediaType: 'application/pdf',
        byteSize: 256,
        intentId: 'intent-t-new',
        idempotencyKey: 'key-intent-t-new',
        expiresAt: '2099-01-01T00:00:00.000Z',
        createdAt: '2026-10-01T00:00:00.000Z'
    });

    assert.equal(created, true);

    const fileStatus = (id) => database.prepare('SELECT upload_status FROM document_revision_files WHERE id = ?').bind(id).first().upload_status;
    const intentStatus = (id) => database.prepare('SELECT status FROM upload_intents WHERE id = ?').bind(id).first().status;
    const revisionStatus = (id) => database.prepare('SELECT status FROM document_revisions WHERE id = ?').bind(id).first().status;

    assert.equal(intentStatus('intent-t-pending'), 'rejected');
    assert.equal(fileStatus('file-t-pending'), 'rejected');
    assert.equal(revisionStatus('rev-t-pending'), 'superseded');

    assert.equal(fileStatus('file-t-pre-rej'), 'rejected');
    assert.equal(revisionStatus('rev-t-pre-rej'), 'superseded');

    assert.equal(intentStatus('intent-t-completed'), 'completed');
    assert.equal(fileStatus('file-t-completed'), 'finalized');

    assert.equal(fileStatus('file-t-submitted'), 'finalized');
    assert.equal(revisionStatus('rev-t-submitted'), 'submitted');

    assert.equal(fileStatus('file-t-current'), 'intent');
    assert.equal(revisionStatus('rev-t-current'), 'pending_scan');

    assert.equal(intentStatus('intent-or-pending'), 'pending');
    assert.equal(fileStatus('file-or-pending'), 'intent');
    assert.equal(fileStatus('file-or-rej'), 'intent');
    assert.equal(revisionStatus('rev-or-pending'), 'pending_scan');

    assert.equal(intentStatus('intent-oa-pending'), 'pending');
    assert.equal(fileStatus('file-oa-pending'), 'intent');
    assert.equal(fileStatus('file-oa-rej'), 'intent');
    assert.equal(revisionStatus('rev-oa-pending'), 'pending_scan');

    assert.equal(intentStatus('intent-t-new'), 'pending');
    assert.equal(fileStatus('file-t-new'), 'intent');
    assert.equal(revisionStatus('rev-t-new'), 'pending_scan');
});

test('beginStudentDocumentDelete rejects only pending intents of the deleted document record', async () => {
    const { database, repositories } = createRepositories();
    const requirements = listActiveInitialRequirements(database);
    const targetReq = requirements[0];
    const otherReq = requirements[1];

    await createDraft(repositories, 'app-del-1', 'PERF-DEL-1');
    await createDraft(repositories, 'app-del-2', 'PERF-DEL-2');

    insertDocumentRecord(database, { id: 'rec-del-target', applicationId: 'app-del-1', requirementId: targetReq.id });
    insertDocumentRecord(database, { id: 'rec-del-other-req', applicationId: 'app-del-1', requirementId: otherReq.id });
    insertDocumentRecord(database, { id: 'rec-del-other-app', applicationId: 'app-del-2', requirementId: targetReq.id });

    insertRevisionFileIntent(database, {
        revisionId: 'rev-del-1', documentRecordId: 'rec-del-target', revisionNumber: 1,
        revisionStatus: 'pending_scan', isCurrent: 0,
        fileId: 'file-del-1', intentId: 'intent-del-1', intentStatus: 'pending'
    });
    insertRevisionFileIntent(database, {
        revisionId: 'rev-del-2', documentRecordId: 'rec-del-target', revisionNumber: 2,
        revisionStatus: 'submitted', isCurrent: 1,
        fileId: 'file-del-2', uploadStatus: 'finalized', intentId: 'intent-del-2', intentStatus: 'completed'
    });
    insertRevisionFileIntent(database, {
        revisionId: 'rev-del-or', documentRecordId: 'rec-del-other-req', revisionNumber: 1,
        revisionStatus: 'pending_scan', isCurrent: 0,
        fileId: 'file-del-or', intentId: 'intent-del-or', intentStatus: 'pending'
    });
    insertRevisionFileIntent(database, {
        revisionId: 'rev-del-oa', documentRecordId: 'rec-del-other-app', revisionNumber: 1,
        revisionStatus: 'pending_scan', isCurrent: 0,
        fileId: 'file-del-oa', intentId: 'intent-del-oa', intentStatus: 'pending'
    });

    const outcome = await repositories.documents.beginStudentDocumentDelete({
        applicationId: 'app-del-1',
        code: targetReq.code,
        requestedAt: '2026-10-01T00:00:00.000Z'
    });

    assert.deepEqual(outcome, { found: true, locked: false });
    const intentStatus = (id) => database.prepare('SELECT status FROM upload_intents WHERE id = ?').bind(id).first().status;
    assert.equal(intentStatus('intent-del-1'), 'rejected');
    assert.equal(intentStatus('intent-del-2'), 'completed');
    assert.equal(intentStatus('intent-del-or'), 'pending');
    assert.equal(intentStatus('intent-del-oa'), 'pending');
});

test('resubmissionUploadRepository.createIntent rejects only non-current pending_scan attempts on the target record', async () => {
    const { database, repositories } = createRepositories();
    const requirements = listActiveInitialRequirements(database);
    const targetReq = requirements[0];
    const otherReq = requirements[1];

    await createDraft(repositories, 'app-resub-1', 'PERF-RESUB-1');
    await createDraft(repositories, 'app-resub-2', 'PERF-RESUB-2');
    database.prepare(`UPDATE applications SET status = 'resubmission_required' WHERE id IN ('app-resub-1', 'app-resub-2')`).run();

    insertDocumentRecord(database, {
        id: 'rec-resub-target', applicationId: 'app-resub-1', requirementId: targetReq.id, reviewStatus: 'resubmission_required'
    });
    insertDocumentRecord(database, {
        id: 'rec-resub-other-req', applicationId: 'app-resub-1', requirementId: otherReq.id, reviewStatus: 'resubmission_required'
    });
    insertDocumentRecord(database, {
        id: 'rec-resub-other-app', applicationId: 'app-resub-2', requirementId: targetReq.id, reviewStatus: 'resubmission_required'
    });

    database.prepare(`
        INSERT INTO application_notes (id, application_id, document_record_id, author_type, visibility, body)
        VALUES ('note-resub-target', 'app-resub-1', 'rec-resub-target', 'system', 'student', 'Replace document.')
    `).run();

    // Current reviewed revision (must stay current and finalized).
    insertRevisionFileIntent(database, {
        revisionId: 'rev-resub-current', documentRecordId: 'rec-resub-target', revisionNumber: 1,
        revisionStatus: 'resubmission_required', isCurrent: 1,
        fileId: 'file-resub-current', uploadStatus: 'finalized', scanStatus: 'clean',
        intentId: 'intent-resub-current', intentStatus: 'completed'
    });
    // Prior non-current pending_scan attempt (must be rejected + marked pending cleanup + superseded).
    insertRevisionFileIntent(database, {
        revisionId: 'rev-resub-old-pending', documentRecordId: 'rec-resub-target', revisionNumber: 2,
        revisionStatus: 'pending_scan', isCurrent: 0,
        fileId: 'file-resub-old-pending', uploadStatus: 'intent',
        intentId: 'intent-resub-old-pending', intentStatus: 'pending'
    });
    // Non-pending_scan non-current revision with rejected intent (must stay untouched).
    insertRevisionFileIntent(database, {
        revisionId: 'rev-resub-old-submitted', documentRecordId: 'rec-resub-target', revisionNumber: 3,
        revisionStatus: 'submitted', isCurrent: 0,
        fileId: 'file-resub-old-submitted', uploadStatus: 'finalized', scanStatus: 'clean',
        intentId: 'intent-resub-old-submitted', intentStatus: 'rejected'
    });
    // Other requirement and other application pending_scan attempts (must stay untouched).
    insertRevisionFileIntent(database, {
        revisionId: 'rev-resub-or', documentRecordId: 'rec-resub-other-req', revisionNumber: 1,
        revisionStatus: 'pending_scan', isCurrent: 0,
        fileId: 'file-resub-or', uploadStatus: 'intent',
        intentId: 'intent-resub-or', intentStatus: 'pending'
    });
    insertRevisionFileIntent(database, {
        revisionId: 'rev-resub-oa', documentRecordId: 'rec-resub-other-app', revisionNumber: 1,
        revisionStatus: 'pending_scan', isCurrent: 0,
        fileId: 'file-resub-oa', uploadStatus: 'intent',
        intentId: 'intent-resub-oa', intentStatus: 'pending'
    });

    const created = await repositories.resubmissionUploads.createIntent({
        applicationId: 'app-resub-1',
        applicationType: 'initial',
        isUnder18: false,
        addressEvidenceType: null,
        requirementId: targetReq.id,
        code: targetReq.code,
        documentRecordId: 'rec-resub-target',
        expectedCurrentRevisionId: 'rev-resub-current',
        mode: 'first_replacement',
        revisionId: 'rev-resub-new',
        fileId: 'file-resub-new',
        storageKey: 'quarantine/file-resub-new',
        filename: 'replacement.pdf',
        mediaType: 'application/pdf',
        byteSize: 512,
        intentId: 'intent-resub-new',
        idempotencyKey: 'key-resub-new',
        expiresAt: '2099-01-01T00:00:00.000Z',
        createdAt: '2026-10-01T00:00:00.000Z'
    });

    assert.equal(created, true);

    const fileRow = (id) => database.prepare('SELECT upload_status, cleanup_status FROM document_revision_files WHERE id = ?').bind(id).first();
    const intentStatus = (id) => database.prepare('SELECT status FROM upload_intents WHERE id = ?').bind(id).first().status;
    const revisionStatus = (id) => database.prepare('SELECT status, is_current FROM document_revisions WHERE id = ?').bind(id).first();

    assert.equal(intentStatus('intent-resub-old-pending'), 'rejected');
    assert.deepEqual({ ...fileRow('file-resub-old-pending') }, { upload_status: 'rejected', cleanup_status: 'pending' });
    assert.deepEqual({ ...revisionStatus('rev-resub-old-pending') }, { status: 'superseded', is_current: 0 });

    assert.deepEqual({ ...fileRow('file-resub-old-submitted') }, { upload_status: 'finalized', cleanup_status: 'none' });
    assert.deepEqual({ ...revisionStatus('rev-resub-old-submitted') }, { status: 'submitted', is_current: 0 });
    assert.deepEqual({ ...revisionStatus('rev-resub-current') }, { status: 'resubmission_required', is_current: 1 });

    assert.equal(intentStatus('intent-resub-or'), 'pending');
    assert.deepEqual({ ...fileRow('file-resub-or') }, { upload_status: 'intent', cleanup_status: 'none' });
    assert.equal(intentStatus('intent-resub-oa'), 'pending');
    assert.deepEqual({ ...fileRow('file-resub-oa') }, { upload_status: 'intent', cleanup_status: 'none' });

    assert.equal(intentStatus('intent-resub-new'), 'pending');
    assert.deepEqual({ ...fileRow('file-resub-new') }, { upload_status: 'intent', cleanup_status: 'none' });
});

test('listStudentRequirements derives cleanup_status with pending > complete > null in display order', async () => {
    const { database, repositories } = createRepositories();
    const requirements = listActiveInitialRequirements(database);
    assert.ok(requirements.length >= 5, 'expected at least 5 active initial requirements');

    const [reqNoRecord, reqNoneOnly, reqCompleteOnly, reqMixedPendingWins, reqPendingOnly] = requirements;

    await createDraft(repositories, 'app-track-1', 'PERF-TRACK-1');
    await createDraft(repositories, 'app-track-other', 'PERF-TRACK-OTHER');

    // Other application has pending cleanup on reqNoRecord; must not bleed into app-track-1.
    insertDocumentRecord(database, { id: 'rec-other-app-track', applicationId: 'app-track-other', requirementId: reqNoRecord.id });
    insertRevisionFileIntent(database, {
        revisionId: 'rev-other-app-track', documentRecordId: 'rec-other-app-track', revisionNumber: 1,
        revisionStatus: 'superseded', isCurrent: 0,
        fileId: 'file-other-app-track', uploadStatus: 'rejected', cleanupStatus: 'pending'
    });

    // reqNoneOnly: only cleanup_status = 'none' -> NULL.
    insertDocumentRecord(database, { id: 'rec-none', applicationId: 'app-track-1', requirementId: reqNoneOnly.id });
    insertRevisionFileIntent(database, {
        revisionId: 'rev-none-1', documentRecordId: 'rec-none', revisionNumber: 1,
        revisionStatus: 'submitted', isCurrent: 1,
        fileId: 'file-none-1', uploadStatus: 'finalized', scanStatus: 'clean', cleanupStatus: 'none',
        intentId: 'intent-none-1', intentStatus: 'completed'
    });

    // reqCompleteOnly: one 'complete' and one 'none' -> 'complete'.
    insertDocumentRecord(database, { id: 'rec-complete', applicationId: 'app-track-1', requirementId: reqCompleteOnly.id });
    insertRevisionFileIntent(database, {
        revisionId: 'rev-comp-1', documentRecordId: 'rec-complete', revisionNumber: 1,
        revisionStatus: 'superseded', isCurrent: 0,
        fileId: 'file-comp-1', uploadStatus: 'rejected', cleanupStatus: 'complete'
    });
    insertRevisionFileIntent(database, {
        revisionId: 'rev-comp-2', documentRecordId: 'rec-complete', revisionNumber: 2,
        revisionStatus: 'submitted', isCurrent: 1,
        fileId: 'file-comp-2', uploadStatus: 'finalized', scanStatus: 'clean', cleanupStatus: 'none'
    });

    // reqMixedPendingWins: both 'complete' and 'pending' -> 'pending'.
    insertDocumentRecord(database, { id: 'rec-mixed', applicationId: 'app-track-1', requirementId: reqMixedPendingWins.id });
    insertRevisionFileIntent(database, {
        revisionId: 'rev-mix-1', documentRecordId: 'rec-mixed', revisionNumber: 1,
        revisionStatus: 'superseded', isCurrent: 0,
        fileId: 'file-mix-1', uploadStatus: 'rejected', cleanupStatus: 'complete'
    });
    insertRevisionFileIntent(database, {
        revisionId: 'rev-mix-2', documentRecordId: 'rec-mixed', revisionNumber: 2,
        revisionStatus: 'superseded', isCurrent: 0,
        fileId: 'file-mix-2', uploadStatus: 'rejected', cleanupStatus: 'pending'
    });

    // reqPendingOnly: only 'pending' -> 'pending'.
    insertDocumentRecord(database, { id: 'rec-pending', applicationId: 'app-track-1', requirementId: reqPendingOnly.id });
    insertRevisionFileIntent(database, {
        revisionId: 'rev-pend-1', documentRecordId: 'rec-pending', revisionNumber: 1,
        revisionStatus: 'superseded', isCurrent: 0,
        fileId: 'file-pend-1', uploadStatus: 'rejected', cleanupStatus: 'pending'
    });

    const rows = await repositories.documents.listStudentRequirements('app-track-1');
    const byCode = Object.fromEntries(rows.map((row) => [row.code, row]));

    assert.deepEqual(rows.map((row) => row.code), requirements.map((requirement) => requirement.code));
    assert.deepEqual(Object.keys(rows[0]), [
        'code', 'is_required', 'display_order', 'document_record_id', 'review_status',
        'revision_number', 'revision_status', 'upload_status', 'scan_status',
        'original_filename', 'media_type', 'file_id', 'current_cleanup_status',
        'upload_intent_status', 'cleanup_status'
    ]);
    assert.equal(byCode[reqNoRecord.code].cleanup_status, null);
    assert.equal(byCode[reqNoneOnly.code].cleanup_status, null);
    assert.equal(byCode[reqCompleteOnly.code].cleanup_status, 'complete');
    assert.equal(byCode[reqMixedPendingWins.code].cleanup_status, 'pending');
    assert.equal(byCode[reqPendingOnly.code].cleanup_status, 'pending');
});
