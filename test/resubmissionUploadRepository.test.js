import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateResubmissionEligibility } from '../src/server/domain/resubmissionUploadPolicy.js';
import { readStudentUploadMetadata } from '../src/server/domain/studentUploadMetadata.js';
import { createResubmissionUploadRepository } from '../src/server/repositories/d1/resubmissionUploadRepository.js';
import { TestD1Database } from './helpers/d1-test-binding.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';

const APPLICATION_ID = 'app-resubmit-a';
const DOCUMENT_RECORD_ID = 'record-resubmit-a';
const CURRENT_REVISION_ID = 'revision-resubmit-1';
const CURRENT_FILE_ID = 'file-resubmit-1';
const CURRENT_INTENT_ID = 'intent-resubmit-current';

async function createRepositoryFixture() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    await database.prepare(`
        INSERT INTO students (id, student_number, normalized_student_number)
        VALUES ('student-resubmit-a', 'RE-SUBMIT-A', 'RE-SUBMIT-A')
    `).run();
    await database.prepare(`
        INSERT INTO applications (id, student_id, application_type, status, is_under_18,
            last_activity_at, created_at, updated_at)
        VALUES (?, 'student-resubmit-a', 'initial', 'resubmission_required', 0,
            '2026-09-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')
    `).bind(APPLICATION_ID).run();
    await database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type, review_status)
        VALUES (?, ?, 'req-initial-passport', 'initial', 'resubmission_required')
    `).bind(DOCUMENT_RECORD_ID, APPLICATION_ID).run();
    await database.prepare(`
        INSERT INTO document_revisions (id, document_record_id, revision_number, status, is_current, submitted_by_type)
        VALUES (?, ?, 1, 'resubmission_required', 1, 'student')
    `).bind(CURRENT_REVISION_ID, DOCUMENT_RECORD_ID).run();
    await database.prepare(`
        INSERT INTO document_revision_files (id, revision_id, page_order, storage_key, original_filename,
            media_type, byte_size, upload_status, scan_status, cleanup_status)
        VALUES (?, ?, 0, 'quarantine/current-reviewed', 'passport.pdf', 'application/pdf', 100,
            'finalized', 'clean', 'none')
    `).bind(CURRENT_FILE_ID, CURRENT_REVISION_ID).run();
    await database.prepare(`
        INSERT INTO upload_intents (id, revision_file_id, idempotency_key, expires_at, status, completed_at)
        VALUES (?, ?, 'key-current', '2026-09-02T00:00:00.000Z', 'completed', '2026-08-30T00:00:00.000Z')
    `).bind(CURRENT_INTENT_ID, CURRENT_FILE_ID).run();
    await database.prepare(`
        INSERT INTO application_notes (id, application_id, document_record_id, author_type,
            visibility, body, created_at)
        VALUES ('note-resubmit-a', ?, ?, 'system', 'student', 'Belgeyi yeniden gönderin.', '2026-09-01T00:00:00.000Z')
    `).bind(APPLICATION_ID, DOCUMENT_RECORD_ID).run();
    return { database, repository: createResubmissionUploadRepository(database) };
}

async function createReplacementIntent(repository, {
    intentId = 'intent-resubmit-next', revisionId = 'revision-resubmit-2', fileId = 'file-resubmit-2',
    storageKey = 'quarantine/replacement-2', idempotencyKey = 'key-replacement-2',
    createdAt = '2026-10-01T00:00:00.000Z', expiresAt = '2026-10-01T00:10:00.000Z',
    expectedCurrentRevisionId = CURRENT_REVISION_ID, mode = 'first_replacement'
} = {}) {
    return repository.createIntent({
        applicationId: APPLICATION_ID, applicationType: 'initial', code: 'passport',
        requirementId: 'req-initial-passport', conditionalRule: null,
        documentRecordId: DOCUMENT_RECORD_ID, expectedCurrentRevisionId, mode,
        revisionId, fileId, storageKey, filename: 'passport-new.pdf',
        mediaType: 'application/pdf', byteSize: 123, intentId, idempotencyKey, expiresAt, createdAt
    });
}

function validFirstReplacement() {
    return {
        application: { id: 'app-a', status: 'resubmission_required' },
        policyIsApplicable: true,
        documentRecord: { id: 'record-a', applicationId: 'app-a', reviewStatus: 'resubmission_required' },
        currentRevision: {
            id: 'revision-a', documentRecordId: 'record-a', status: 'resubmission_required', isCurrent: true,
            file: { uploadStatus: 'finalized', scanStatus: 'clean', cleanupStatus: 'none', intentStatus: 'completed' }
        },
        hasStudentMessageForDocument: true,
        hasPendingCleanupForRecord: false
    };
}

function readRows(statement) {
    return statement.all().results.map((row) => ({ ...row }));
}

function readRow(statement) {
    const row = statement.first();
    return row ? { ...row } : null;
}

function createFinalizeInput(overrides = {}) {
    return {
        applicationId: APPLICATION_ID, applicationType: 'initial', isUnder18: false,
        addressEvidenceType: null, requirementId: 'req-initial-passport', code: 'passport',
        documentRecordId: DOCUMENT_RECORD_ID, expectedCurrentRevisionId: CURRENT_REVISION_ID,
        replacementRevisionId: 'revision-resubmit-2', replacementFileId: 'file-resubmit-2',
        intentId: 'intent-resubmit-next', mode: 'first_replacement', revisionNumber: 2,
        finalizedAt: '2026-10-01T00:02:00.000Z', requestId: 'request-resubmit-1',
        auditId: 'audit-resubmit-1',
        ...overrides
    };
}

test('allows a first replacement only for the exact current persisted resubmission request', () => {
    const result = evaluateResubmissionEligibility(validFirstReplacement());

    assert.deepEqual(result, { allowed: true, mode: 'first_replacement' });
});

test('reasoned first replacement accepts completed unsafe/failed files but rejects pending or incomplete intent', () => {
    for (const scanStatus of ['unsafe', 'failed']) {
        const input = validFirstReplacement();
        input.currentRevision.file.scanStatus = scanStatus;

        assert.deepEqual(evaluateResubmissionEligibility(input), { allowed: true, mode: 'first_replacement' });
    }
    for (const change of [{ scanStatus: 'pending' }, { intentStatus: 'pending' }, { intentStatus: null }]) {
        const input = validFirstReplacement();
        Object.assign(input.currentRevision.file, change);

        assert.deepEqual(evaluateResubmissionEligibility(input), { allowed: false, mode: null });
    }
});

test('does not let a student-visible message alone authorize replacement', () => {
    const messageOnly = {
        ...validFirstReplacement(),
        application: { id: 'app-a', status: 'under_review' },
        documentRecord: { id: 'record-a', applicationId: 'app-a', reviewStatus: 'pending' },
        currentRevision: null
    };

    assert.deepEqual(evaluateResubmissionEligibility(messageOnly), { allowed: false, mode: null });
});

test('rejects first replacement for an unrelated, approved, stale, non-current, or inapplicable document', () => {
    const cases = [
        { ...validFirstReplacement(), documentRecord: { id: 'record-a', applicationId: 'app-b', reviewStatus: 'resubmission_required' } },
        { ...validFirstReplacement(), documentRecord: { id: 'record-a', applicationId: 'app-a', reviewStatus: 'approved' } },
        { ...validFirstReplacement(), currentRevision: { ...validFirstReplacement().currentRevision, status: 'approved' } },
        { ...validFirstReplacement(), currentRevision: { ...validFirstReplacement().currentRevision, isCurrent: false } },
        { ...validFirstReplacement(), currentRevision: { ...validFirstReplacement().currentRevision, documentRecordId: 'record-b' } },
        { ...validFirstReplacement(), policyIsApplicable: false },
        { ...validFirstReplacement(), hasStudentMessageForDocument: false },
        { ...validFirstReplacement(), currentRevision: { ...validFirstReplacement().currentRevision,
            file: { ...validFirstReplacement().currentRevision.file, cleanupStatus: 'pending' } } }
    ];

    for (const eligibility of cases) {
        assert.deepEqual(evaluateResubmissionEligibility(eligibility), { allowed: false, mode: null });
    }
});

test('allows another replacement only when the current submitted revision scan is unsafe or failed', () => {
    for (const scanStatus of ['unsafe', 'failed']) {
        const priorReplacement = {
            ...validFirstReplacement(),
            documentRecord: { id: 'record-a', applicationId: 'app-a', reviewStatus: 'pending' },
            currentRevision: {
                id: 'revision-b', documentRecordId: 'record-a', status: 'submitted', isCurrent: true,
                file: { uploadStatus: 'finalized', scanStatus, cleanupStatus: 'none', intentStatus: 'completed' }
            }
        };

        assert.deepEqual(evaluateResubmissionEligibility(priorReplacement), { allowed: true, mode: 'unsafe_scan_retry' });
    }
});

test('denies retry for pending/clean scan, approved/under-review state, or pending cleanup', () => {
    const base = {
        ...validFirstReplacement(),
        documentRecord: { id: 'record-a', applicationId: 'app-a', reviewStatus: 'pending' },
        currentRevision: {
            id: 'revision-b', documentRecordId: 'record-a', status: 'submitted', isCurrent: true,
            file: { uploadStatus: 'finalized', scanStatus: 'pending', cleanupStatus: 'none', intentStatus: 'completed' }
        }
    };
    const cases = [
        base,
        { ...base, currentRevision: { ...base.currentRevision, file: { ...base.currentRevision.file, scanStatus: 'clean' } } },
        { ...base, currentRevision: { ...base.currentRevision, status: 'approved' } },
        { ...base, documentRecord: { ...base.documentRecord, reviewStatus: 'under_review' } },
        { ...base, currentRevision: { ...base.currentRevision,
            file: { ...base.currentRevision.file, cleanupStatus: 'pending' } } },
        { ...base, hasStudentMessageForDocument: false }
    ];

    for (const eligibility of cases) {
        assert.deepEqual(evaluateResubmissionEligibility(eligibility), { allowed: false, mode: null });
    }
});

test('allows a fresh replacement while cleanup for an invalidated non-current attempt remains pending', () => {
    const eligibility = { ...validFirstReplacement(), hasPendingCleanupForRecord: true };

    assert.deepEqual(evaluateResubmissionEligibility(eligibility), { allowed: true, mode: 'first_replacement' });
});

test('sanitizes upload filenames while preserving policy code and verified metadata shape', () => {
    const metadata = readStudentUploadMetadata({
        code: 'passport',
        filename: '../../Yeni Pasaport.pdf',
        media_type: 'APPLICATION/PDF',
        byte_size: 123
    }, { accepted_media_types: ['application/pdf'], max_byte_size: 500 });

    assert.deepEqual(metadata, {
        code: 'passport', filename: 'Yeni Pasaport.pdf', mediaType: 'application/pdf', byteSize: 123
    });
});

test('rejects upload metadata outside the active centralized policy', () => {
    assert.throws(() => readStudentUploadMetadata({
        code: 'passport', filename: 'passport.pdf', media_type: 'application/pdf', byte_size: 501
    }, { accepted_media_types: ['application/pdf'], max_byte_size: 500 }), { code: 'FILE_TOO_LARGE' });

    assert.throws(() => readStudentUploadMetadata({
        code: 'passport', filename: 'passport.pdf', media_type: 'application/x-msdownload', byte_size: 10
    }, { accepted_media_types: ['application/pdf'], max_byte_size: 500 }), { code: 'INVALID_FILE' });
});

test('creates the next pending revision on the same record without changing the reviewed current revision', async () => {
    const { database, repository } = await createRepositoryFixture();

    const created = await createReplacementIntent(repository);

    assert.equal(created, true);
    const records = readRows(database.prepare(`SELECT id FROM document_records WHERE application_id = ?`).bind(APPLICATION_ID));
    assert.deepEqual(records, [{ id: DOCUMENT_RECORD_ID }]);
    const revisions = readRows(database.prepare(`
        SELECT id, revision_number, status, is_current FROM document_revisions
        WHERE document_record_id = ? ORDER BY revision_number
    `).bind(DOCUMENT_RECORD_ID));
    assert.deepEqual(revisions, [
        { id: CURRENT_REVISION_ID, revision_number: 1, status: 'resubmission_required', is_current: 1 },
        { id: 'revision-resubmit-2', revision_number: 2, status: 'pending_scan', is_current: 0 }
    ]);
    assert.equal(database.prepare(`SELECT review_status FROM document_records WHERE id = ?`).bind(DOCUMENT_RECORD_ID).first().review_status,
        'resubmission_required');
    assert.equal(database.prepare(`SELECT upload_status FROM document_revision_files WHERE id = 'file-resubmit-2'`).first().upload_status, 'intent');
    assert.equal((await repository.findIntent(APPLICATION_ID, 'intent-resubmit-next')).intent_status, 'pending');
});

test('a newer intent invalidates the previous non-current attempt but preserves the requested current revision', async () => {
    const { database, repository } = await createRepositoryFixture();
    await createReplacementIntent(repository);

    const createdNewer = await createReplacementIntent(repository, {
        intentId: 'intent-resubmit-newer', revisionId: 'revision-resubmit-3', fileId: 'file-resubmit-3',
        storageKey: 'quarantine/replacement-3', idempotencyKey: 'key-replacement-3'
    });

    assert.equal(createdNewer, true);
    assert.equal(database.prepare(`SELECT status FROM upload_intents WHERE id = 'intent-resubmit-next'`).first().status, 'rejected');
    assert.deepEqual(readRows(database.prepare(`
        SELECT revision_number, status, is_current FROM document_revisions
        WHERE document_record_id = ? ORDER BY revision_number
    `).bind(DOCUMENT_RECORD_ID)), [
        { revision_number: 1, status: 'resubmission_required', is_current: 1 },
        { revision_number: 2, status: 'superseded', is_current: 0 },
        { revision_number: 3, status: 'pending_scan', is_current: 0 }
    ]);
    assert.equal(database.prepare(`SELECT cleanup_status FROM document_revision_files WHERE id = 'file-resubmit-2'`).first().cleanup_status,
        'pending');
    assert.equal(database.prepare(`SELECT status FROM upload_intents WHERE id = 'intent-resubmit-newer'`).first().status, 'pending');
});

test('replacement cleanup waits until the invalidated capability expiry and lists only non-current replacement files', async () => {
    const { database, repository } = await createRepositoryFixture();
    await createReplacementIntent(repository, { expiresAt: '2999-01-01T00:00:00.000Z' });
    await repository.invalidatePendingIntent(APPLICATION_ID, DOCUMENT_RECORD_ID, 'intent-resubmit-next', '2026-10-01T00:01:00.000Z');

    assert.deepEqual(await repository.listRetryableCleanup(APPLICATION_ID, 'passport'), []);
    await database.prepare(`UPDATE upload_intents SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = 'intent-resubmit-next'`).run();
    const cleanupFiles = await repository.listRetryableCleanup(APPLICATION_ID, 'passport');

    assert.deepEqual(cleanupFiles.map(({ id, storage_key }) => ({ id, storage_key })), [
        { id: 'file-resubmit-2', storage_key: 'quarantine/replacement-2' }
    ]);
    assert.equal(await repository.markCleanupComplete(APPLICATION_ID, 'file-resubmit-2'), true);
    assert.equal(database.prepare(`SELECT cleanup_status FROM document_revision_files WHERE id = 'file-resubmit-2'`).first().cleanup_status,
        'complete');
    assert.equal(database.prepare(`SELECT cleanup_status FROM document_revision_files WHERE id = ?`).bind(CURRENT_FILE_ID).first().cleanup_status,
        'none');
});

test('finalize atomically swaps the current revision, updates application state, completes intent, and writes safe audit', async () => {
    const { database, repository } = await createRepositoryFixture();
    await createReplacementIntent(repository);
    const finalized = await repository.finalizeReplacement(createFinalizeInput());

    assert.equal(finalized, true);
    assert.deepEqual(readRows(database.prepare(`
        SELECT id, status, is_current FROM document_revisions WHERE document_record_id = ? ORDER BY revision_number
    `).bind(DOCUMENT_RECORD_ID)), [
        { id: CURRENT_REVISION_ID, status: 'superseded', is_current: 0 },
        { id: 'revision-resubmit-2', status: 'submitted', is_current: 1 }
    ]);
    assert.equal(database.prepare(`SELECT review_status FROM document_records WHERE id = ?`).bind(DOCUMENT_RECORD_ID).first().review_status,
        'pending');
    assert.deepEqual(readRow(database.prepare(`
        SELECT upload_status, scan_status FROM document_revision_files WHERE id = 'file-resubmit-2'
    `)), { upload_status: 'finalized', scan_status: 'pending' });
    assert.deepEqual(readRow(database.prepare(`SELECT status, completed_at FROM upload_intents WHERE id = 'intent-resubmit-next'`)), {
        status: 'completed', completed_at: '2026-10-01T00:02:00.000Z'
    });
    assert.deepEqual(readRow(database.prepare(`SELECT status, updated_at, last_activity_at FROM applications WHERE id = ?`).bind(APPLICATION_ID)), {
        status: 'resubmission_required', updated_at: '2026-10-01T00:02:00.000Z', last_activity_at: '2026-10-01T00:02:00.000Z'
    });
    const audit = database.prepare(`SELECT event_type, safe_metadata_json FROM audit_events WHERE id = 'audit-resubmit-1'`).first();
    assert.equal(audit.event_type, 'student.document_resubmitted');
    assert.deepEqual(JSON.parse(audit.safe_metadata_json), {
        documentCode: 'passport', revisionNumber: 2, documentStatus: 'submitted', result: 'success'
    });
});

test('a guarded finalize step miss rolls back every earlier D1 mutation', async (context) => {
    const mutationCases = [
        ['old current revision', async (database) => {
            await database.prepare(`UPDATE document_revisions SET status = 'approved' WHERE id = ?`).bind(CURRENT_REVISION_ID).run();
        }, { expectedCurrentRevisionId: 'stale-current-revision' }],
        ['replacement revision', async (database) => {
            await database.prepare(`UPDATE document_revisions SET status = 'superseded' WHERE id = 'revision-resubmit-2'`).run();
        }],
        ['replacement file', async (database) => {
            await database.prepare(`UPDATE document_revision_files SET upload_status = 'rejected' WHERE id = 'file-resubmit-2'`).run();
        }],
        ['document state', async (database) => {
            await database.prepare(`UPDATE document_records SET review_status = 'approved' WHERE id = ?`).bind(DOCUMENT_RECORD_ID).run();
        }],
        ['application state', async (database) => {
            await database.prepare(`UPDATE applications SET status = 'submitted' WHERE id = ?`).bind(APPLICATION_ID).run();
        }],
        ['intent state', async (database) => {
            await database.prepare(`UPDATE upload_intents SET status = 'rejected' WHERE id = 'intent-resubmit-next'`).run();
        }]
    ];

    for (const [stepName, arrangeMismatch, overrides = {}] of mutationCases) {
        await context.test(`rolls back when ${stepName} guard misses`, async () => {
            const { database, repository } = await createRepositoryFixture();
            await createReplacementIntent(repository);
            await arrangeMismatch(database);
            const before = readFinalizeState(database);

            const result = await repository.finalizeReplacement(createFinalizeInput({
                requestId: 'request-resubmit-stale', auditId: 'audit-resubmit-stale', ...overrides
            }));

            assert.equal(result, false);
            assert.deepEqual(readFinalizeState(database), before);
            assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'student.document_resubmitted'`).first().count, 0);
        });
    }
});

test('an audit insert failure rolls back revision, document, application, and intent mutations', async () => {
    const { database, repository } = await createRepositoryFixture();
    await createReplacementIntent(repository);
    await database.prepare(`
        INSERT INTO audit_events (id, event_type, actor_type, request_id, safe_metadata_json)
        VALUES ('duplicate-audit-id', 'test.existing', 'system', 'existing-request', '{}')
    `).run();
    const before = readFinalizeState(database);

    await assert.rejects(repository.finalizeReplacement(createFinalizeInput({
        requestId: 'request-resubmit-audit-failure', auditId: 'duplicate-audit-id'
    })), /UNIQUE constraint failed/);

    assert.deepEqual(readFinalizeState(database), before);
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'student.document_resubmitted'`).first().count, 0);
});

function readFinalizeState(database) {
    return {
        revisions: readRows(database.prepare(`
            SELECT id, status, is_current FROM document_revisions WHERE document_record_id = ? ORDER BY revision_number
        `).bind(DOCUMENT_RECORD_ID)),
        file: readRow(database.prepare(`
            SELECT upload_status, scan_status, cleanup_status FROM document_revision_files WHERE id = 'file-resubmit-2'
        `)),
        document: readRow(database.prepare(`SELECT review_status, updated_at FROM document_records WHERE id = ?`).bind(DOCUMENT_RECORD_ID)),
        intent: readRow(database.prepare(`SELECT status, completed_at FROM upload_intents WHERE id = 'intent-resubmit-next'`)),
        application: readRow(database.prepare(`SELECT status, updated_at, last_activity_at FROM applications WHERE id = ?`).bind(APPLICATION_ID)),
        auditCount: database.prepare(`SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'student.document_resubmitted'`).first().count
    };
}
