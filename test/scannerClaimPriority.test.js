import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TestD1Database } from './helpers/d1-test-binding.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { createScannerRepository } from '../src/server/repositories/d1/scanner-repository.js';
import { createScanJobStatement } from '../src/server/repositories/d1/scanner-job-statement.js';

function createFixtureDatabase() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    return database;
}

function seedQueuedJob(database, seq, {
    applicationStatus = 'submitted',
    availableAt = '2026-11-24T10:00:00.000Z',
    jobId = null,
    resultCode = null,
    attempts = 0,
    jobStatus = 'queued'
} = {}) {
    const suffix = String(seq).padStart(12, '0');
    const studentId = `student-${seq}`;
    const applicationId = `11111111-1111-4111-8111-${suffix}`;
    const recordId = `record-${seq}`;
    const revisionId = `revision-${seq}`;
    const fileId = `file-${seq}`;
    const intentId = `intent-${seq}`;
    const storageKey = `quarantine/00000000-0000-4000-8000-${suffix}`;

    database.prepare(
        'INSERT INTO students(id, student_number, normalized_student_number) VALUES (?, ?, ?)'
    ).bind(studentId, `STU-${seq}`, `STU-${seq}`).run();
    database.prepare(
        'INSERT INTO applications(id, student_id, application_type, status) VALUES (?, ?, ?, ?)'
    ).bind(applicationId, studentId, 'initial', applicationStatus).run();
    database.prepare(
        'INSERT INTO document_records(id, application_id, requirement_id, application_type) VALUES (?, ?, ?, ?)'
    ).bind(recordId, applicationId, 'req-initial-passport', 'initial').run();
    database.prepare(
        "INSERT INTO document_revisions(id, document_record_id, revision_number, status, is_current, submitted_by_type) VALUES (?, ?, 1, 'submitted', 1, 'student')"
    ).bind(revisionId, recordId).run();
    database.prepare(
        "INSERT INTO document_revision_files(id, revision_id, page_order, storage_key, original_filename, media_type, byte_size, upload_status, scan_status) VALUES (?, ?, 0, ?, ?, 'application/pdf', 128, 'finalized', 'pending')"
    ).bind(fileId, revisionId, storageKey, `doc-${seq}.pdf`).run();
    database.prepare(
        "INSERT INTO upload_intents(id, revision_file_id, idempotency_key, expires_at, status, completed_at) VALUES (?, ?, ?, ?, 'completed', ?)"
    ).bind(intentId, fileId, `ik-${seq}`, availableAt, availableAt).run();
    createScanJobStatement(database, { fileId, finalizedAt: availableAt }).run();

    if (jobId !== null) {
        database.prepare('UPDATE document_scan_jobs SET id = ? WHERE file_id = ?').bind(jobId, fileId).run();
    }
    if (resultCode !== null || attempts !== 0 || jobStatus !== 'queued') {
        database.prepare(
            `UPDATE document_scan_jobs
             SET result_code = ?, attempts = ?, status = ?,
                 lease_token_hash = CASE WHEN ? = 'leased' THEN 'lease-hash' ELSE NULL END,
                 lease_until = CASE WHEN ? = 'leased' THEN '2099-01-01T00:00:00.000Z' ELSE NULL END
             WHERE file_id = ?`
        ).bind(resultCode, attempts, jobStatus, jobStatus, jobStatus, fileId).run();
    }

    const job = database.prepare('SELECT * FROM document_scan_jobs WHERE file_id = ?').bind(fileId).first();
    return { applicationId, fileId, jobId: job.id };
}

test('claim prioritizes resubmission_required jobs created later ahead of older ordinary jobs', async () => {
    const database = createFixtureDatabase();
    const queue = createScannerRepository(database);
    const ordinary1 = seedQueuedJob(database, 1, {
        applicationStatus: 'submitted',
        availableAt: '2026-11-24T10:00:00.000Z'
    });
    const ordinary2 = seedQueuedJob(database, 2, {
        applicationStatus: 'under_review',
        availableAt: '2026-11-24T10:01:00.000Z'
    });
    const resubmission = seedQueuedJob(database, 3, {
        applicationStatus: 'resubmission_required',
        availableAt: '2026-11-24T10:05:00.000Z'
    });

    const first = await queue.claim({ now: '2026-11-24T10:10:00.000Z', runnerId: 'mac', tokenHash: 'h1' });
    const second = await queue.claim({ now: '2026-11-24T10:10:01.000Z', runnerId: 'mac', tokenHash: 'h2' });
    const third = await queue.claim({ now: '2026-11-24T10:10:02.000Z', runnerId: 'mac', tokenHash: 'h3' });
    const fourth = await queue.claim({ now: '2026-11-24T10:10:03.000Z', runnerId: 'mac', tokenHash: 'h4' });

    assert.equal(first.file_id, resubmission.fileId);
    assert.equal(second.file_id, ordinary1.fileId);
    assert.equal(third.file_id, ordinary2.fileId);
    assert.equal(fourth, null);
});

test('claim prioritizes staff_scan_requested jobs ahead of older ordinary jobs', async () => {
    const database = createFixtureDatabase();
    const queue = createScannerRepository(database);
    const ordinary = seedQueuedJob(database, 1, {
        applicationStatus: 'submitted',
        availableAt: '2026-11-24T10:00:00.000Z'
    });
    const staffRequeued = seedQueuedJob(database, 2, {
        applicationStatus: 'under_review',
        availableAt: '2026-11-24T10:02:00.000Z'
    });

    const prioritized = await queue.prioritizePendingDocument({
        applicationId: staffRequeued.applicationId,
        code: 'passport',
        now: '2026-11-24T10:05:00.000Z',
        staffId: null,
        requestId: 'req-staff-priority'
    });
    assert.equal(prioritized, true);

    const first = await queue.claim({ now: '2026-11-24T10:10:00.000Z', runnerId: 'mac', tokenHash: 'h1' });
    const second = await queue.claim({ now: '2026-11-24T10:10:01.000Z', runnerId: 'mac', tokenHash: 'h2' });
    const third = await queue.claim({ now: '2026-11-24T10:10:02.000Z', runnerId: 'mac', tokenHash: 'h3' });

    assert.equal(first.file_id, staffRequeued.fileId);
    assert.equal(second.file_id, ordinary.fileId);
    assert.equal(third, null);
});

test('claim preserves FIFO (available_at, id) order within high-priority and ordinary tiers', async () => {
    const database = createFixtureDatabase();
    const queue = createScannerRepository(database);

    seedQueuedJob(database, 1, {
        applicationStatus: 'submitted',
        availableAt: '2026-11-24T09:50:00.000Z',
        jobId: 'ord-z-early'
    });
    seedQueuedJob(database, 2, {
        applicationStatus: 'under_review',
        availableAt: '2026-11-24T09:55:00.000Z',
        jobId: 'ord-b-tie'
    });
    seedQueuedJob(database, 3, {
        applicationStatus: 'submitted',
        availableAt: '2026-11-24T09:55:00.000Z',
        jobId: 'ord-a-tie'
    });
    seedQueuedJob(database, 4, {
        applicationStatus: 'resubmission_required',
        availableAt: '2026-11-24T10:02:00.000Z',
        jobId: 'pri-z-early'
    });
    seedQueuedJob(database, 5, {
        applicationStatus: 'resubmission_required',
        availableAt: '2026-11-24T10:03:00.000Z',
        jobId: 'pri-b-tie'
    });
    seedQueuedJob(database, 6, {
        applicationStatus: 'submitted',
        resultCode: 'staff_scan_requested',
        availableAt: '2026-11-24T10:03:00.000Z',
        jobId: 'pri-a-tie'
    });

    const claimedIds = [];
    for (let index = 0; index < 6; index += 1) {
        const job = await queue.claim({
            now: '2026-11-24T10:10:00.000Z',
            runnerId: 'mac',
            tokenHash: `tok-${index}`
        });
        assert.ok(job);
        claimedIds.push(job.id);
    }

    assert.deepEqual(claimedIds, [
        'pri-z-early',
        'pri-a-tie',
        'pri-b-tie',
        'ord-z-early',
        'ord-a-tie',
        'ord-b-tie'
    ]);
    assert.equal(await queue.claim({ now: '2026-11-24T10:10:00.000Z', runnerId: 'mac', tokenHash: 'tok-end' }), null);
});

test('claim still skips attempts >= 3, leased jobs, and future available_at even when prioritized', async () => {
    const database = createFixtureDatabase();
    const queue = createScannerRepository(database);

    seedQueuedJob(database, 1, {
        applicationStatus: 'resubmission_required',
        availableAt: '2026-11-24T10:00:00.000Z',
        attempts: 3
    });
    seedQueuedJob(database, 2, {
        applicationStatus: 'submitted',
        resultCode: 'staff_scan_requested',
        availableAt: '2026-11-24T10:00:00.000Z',
        attempts: 3
    });
    seedQueuedJob(database, 3, {
        applicationStatus: 'resubmission_required',
        availableAt: '2026-11-24T10:00:00.000Z',
        jobStatus: 'leased'
    });
    seedQueuedJob(database, 4, {
        applicationStatus: 'resubmission_required',
        availableAt: '2026-11-24T10:20:00.000Z'
    });
    const ordinary = seedQueuedJob(database, 5, {
        applicationStatus: 'submitted',
        availableAt: '2026-11-24T10:05:00.000Z'
    });

    const first = await queue.claim({ now: '2026-11-24T10:10:00.000Z', runnerId: 'mac', tokenHash: 'h1' });
    const second = await queue.claim({ now: '2026-11-24T10:10:01.000Z', runnerId: 'mac', tokenHash: 'h2' });

    assert.equal(first.file_id, ordinary.fileId);
    assert.equal(second, null);
});

test('scoped claim applies applicationIds filter together with resubmission priority', async () => {
    const database = createFixtureDatabase();
    const queue = createScannerRepository(database);

    const outOfScopeResub = seedQueuedJob(database, 1, {
        applicationStatus: 'resubmission_required',
        availableAt: '2026-11-24T10:00:00.000Z'
    });
    const inScopeOrdinary = seedQueuedJob(database, 2, {
        applicationStatus: 'submitted',
        availableAt: '2026-11-24T10:01:00.000Z'
    });
    const inScopeResub = seedQueuedJob(database, 3, {
        applicationStatus: 'resubmission_required',
        availableAt: '2026-11-24T10:05:00.000Z'
    });
    const scope = [inScopeOrdinary.applicationId, inScopeResub.applicationId];

    const first = await queue.claim({
        now: '2026-11-24T10:10:00.000Z',
        runnerId: 'mac',
        tokenHash: 'h1',
        applicationIds: scope
    });
    const second = await queue.claim({
        now: '2026-11-24T10:10:01.000Z',
        runnerId: 'mac',
        tokenHash: 'h2',
        applicationIds: scope
    });
    const third = await queue.claim({
        now: '2026-11-24T10:10:02.000Z',
        runnerId: 'mac',
        tokenHash: 'h3',
        applicationIds: scope
    });

    assert.equal(first.file_id, inScopeResub.fileId);
    assert.equal(second.file_id, inScopeOrdinary.fileId);
    assert.equal(third, null);
    assert.equal(
        database.prepare('SELECT status FROM document_scan_jobs WHERE file_id = ?').bind(outOfScopeResub.fileId).first().status,
        'queued'
    );
});
