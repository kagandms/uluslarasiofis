import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { TestD1Database } from './helpers/d1-test-binding.js';

const MIGRATIONS_URL = new URL('../migrations/', import.meta.url);
const MIGRATION_NAME = '0033_d1_rows_read_indexes_and_scan_counts.sql';

function applyMigrationsBeforeStatusCounts(database) {
    const migrations = readdirSync(MIGRATIONS_URL)
        .filter((filename) => filename.endsWith('.sql') && filename < MIGRATION_NAME)
        .sort();
    for (const filename of migrations) {
        database.exec(readFileSync(new URL(filename, MIGRATIONS_URL), 'utf8'));
    }
}

function seedScanFile(database, suffix) {
    database.exec(`
        INSERT INTO students(id,student_number,normalized_student_number)
            VALUES ('student-${suffix}','S-${suffix}','S-${suffix}');
        INSERT INTO applications(id,student_id,application_type)
            VALUES ('application-${suffix}','student-${suffix}','initial');
        INSERT INTO document_records(id,application_id,requirement_id,application_type)
            VALUES ('record-${suffix}','application-${suffix}','req-initial-passport','initial');
        INSERT INTO document_revisions(id,document_record_id,revision_number,status,is_current,submitted_by_type)
            VALUES ('revision-${suffix}','record-${suffix}',1,'submitted',1,'student');
        INSERT INTO document_revision_files(id,revision_id,page_order,storage_key,original_filename,media_type,byte_size,upload_status,scan_status)
            VALUES ('file-${suffix}','revision-${suffix}',0,'private/file-${suffix}','evidence.pdf','application/pdf',100,'finalized','pending');
    `);
}

function insertScanJob(database, suffix, status = 'queued') {
    database.prepare(`INSERT INTO document_scan_jobs
        (id,file_id,revision_id,storage_key,byte_size,media_type,status,available_at,created_at,updated_at)
        VALUES (?, ?, ?, ?, 100, 'application/pdf', ?, '2026-10-28T00:00:00Z', '2026-10-28T00:00:00Z', '2026-10-28T00:00:00Z')`)
        .bind(`job-${suffix}`, `file-${suffix}`, `revision-${suffix}`, `private/file-${suffix}`, status)
        .run();
}

function readCounts(database) {
    return database.prepare('SELECT status, job_count FROM document_scan_job_status_counts ORDER BY status')
        .all().results.map(({ status, job_count }) => ({ status, job_count }));
}

test('0033 backfills scan job counts and keeps them exact through inserts, transitions, and deletes', () => {
    const database = new TestD1Database();
    applyMigrationsBeforeStatusCounts(database);

    seedScanFile(database, 'queued');
    seedScanFile(database, 'failed');
    seedScanFile(database, 'later');
    insertScanJob(database, 'queued');
    insertScanJob(database, 'failed', 'failed');

    database.exec(readFileSync(new URL(MIGRATION_NAME, MIGRATIONS_URL), 'utf8'));
    assert.deepEqual(readCounts(database), [
        { status: 'failed', job_count: 1 },
        { status: 'queued', job_count: 1 }
    ]);

    insertScanJob(database, 'later');
    assert.deepEqual(readCounts(database), [
        { status: 'failed', job_count: 1 },
        { status: 'queued', job_count: 2 }
    ]);

    database.prepare("UPDATE document_scan_jobs SET status='leased' WHERE id='job-later'").run();
    database.prepare("UPDATE document_scan_jobs SET status='complete' WHERE id='job-failed'").run();
    assert.deepEqual(readCounts(database), [
        { status: 'complete', job_count: 1 },
        { status: 'failed', job_count: 0 },
        { status: 'leased', job_count: 1 },
        { status: 'queued', job_count: 1 }
    ]);

    database.prepare("DELETE FROM document_scan_jobs WHERE id='job-later'").run();
    assert.deepEqual(readCounts(database), [
        { status: 'complete', job_count: 1 },
        { status: 'failed', job_count: 0 },
        { status: 'leased', job_count: 0 },
        { status: 'queued', job_count: 1 }
    ]);
});
