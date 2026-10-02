import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { TestD1Database } from './helpers/d1-test-binding.js';

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const FILENAMES = readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();

function applyMigration(database, filename) {
    database.exec(readFileSync(new URL(filename, MIGRATIONS), 'utf8'));
}

function seedLegacyPending(database) {
    database.exec(`INSERT INTO students(id,student_number,normalized_student_number) VALUES('legacy-student','LEGACY','LEGACY');
        INSERT INTO applications(id,student_id,application_type) VALUES('legacy-app','legacy-student','initial');
        INSERT INTO application_sessions(id,application_id,token_hash,expires_at) VALUES('legacy-owner','legacy-app','legacy-hash','2999-01-01T00:00:00.000Z');
        INSERT INTO document_records(id,application_id,requirement_id,application_type) VALUES('legacy-record','legacy-app','req-initial-passport','initial');
        INSERT INTO document_revisions(id,document_record_id,revision_number,status,is_current,submitted_by_type)
            VALUES('legacy-revision','legacy-record',1,'submitted',1,'student');
        INSERT INTO document_revision_files(id,revision_id,page_order,storage_key,original_filename,media_type,byte_size,upload_status,scan_status)
            VALUES('legacy-file','legacy-revision',0,'quarantine/legacy-synthetic','synthetic.pdf','application/pdf',1024,'finalized','pending');
        INSERT INTO upload_intents(id,revision_file_id,idempotency_key,expires_at,status,completed_at)
            VALUES('legacy-intent','legacy-file','legacy-key','2026-01-01T00:10:00.000Z','completed','2026-01-01T00:00:00.000Z');`);
}

test('0008 and 0009 are distinct migrations and a fresh schema has both access and durable scanner tables', () => {
    const database = new TestD1Database();

    for (const filename of FILENAMES) applyMigration(database, filename);

    assert.deepEqual(FILENAMES.filter((name) => /^000[89]_/.test(name)), [
        '0008_application_reference_and_access_code.sql', '0009_document_scanner.sql'
    ]);
    assert.equal(database.prepare('SELECT count(*) AS count FROM document_scan_jobs').first().count, 0);
    assert.ok(database.prepare('PRAGMA table_info(applications)').all().results.some(({ name }) => name === 'lock_version'));
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all().results, []);
    database.database.close();
});

test('upgrade from 0001 through 0007 preserves legacy sessions and queues pending files without inventing a clean verdict or access code', () => {
    const database = new TestD1Database();
    for (const filename of FILENAMES.filter((name) => name < '0008')) applyMigration(database, filename);
    seedLegacyPending(database);

    for (const filename of FILENAMES.filter((name) => name >= '0008')) applyMigration(database, filename);

    const application = database.prepare('SELECT reference_number,access_code_hash,access_code_version,lock_version FROM applications').first();
    assert.match(application.reference_number, /^ITU-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    assert.equal(application.access_code_hash, null);
    assert.equal(application.access_code_version, 1);
    assert.equal(application.lock_version, 1);
    assert.equal(database.prepare('SELECT revoked_at FROM application_sessions').first().revoked_at, null);
    assert.equal(database.prepare('SELECT scan_status FROM document_revision_files').first().scan_status, 'pending');
    const job = database.prepare('SELECT file_id,status,attempts,outcome,available_at FROM document_scan_jobs').first();
    assert.deepEqual({ ...job }, { file_id: 'legacy-file', status: 'queued', attempts: 0, outcome: null, available_at: '2026-01-01T00:10:00.000Z' });
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all().results, []);
    database.database.close();
});
