import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { MAX_PHYSICAL_PDF_BYTES, MAX_PHYSICAL_RECEIPT_PDF_BYTES } from '../src/config/physical-document-limits.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const MIGRATION_NAME = '0022_physical_pdf_50mb.sql';
const MIGRATION_URL = new URL(`../migrations/${MIGRATION_NAME}`, import.meta.url);
const MIGRATION_SQL = readFileSync(MIGRATION_URL, 'utf8');
const PREVIOUS_MIGRATIONS = new URL('../migrations/', import.meta.url);

function createPreMigrationDatabase() {
    const database = new TestD1Database();
    const migrationFiles = readdirSync(PREVIOUS_MIGRATIONS)
        .filter(file => file.endsWith('.sql') && file < MIGRATION_NAME)
        .sort();
    for (const migrationFile of migrationFiles) {
        database.exec(readFileSync(new URL(migrationFile, PREVIOUS_MIGRATIONS), 'utf8'));
    }
    database.exec(`INSERT INTO staff_users(id,username,normalized_username,password_hash,display_name,role)
        VALUES('staff','synthetic','synthetic','test','Synthetic','reviewer');
        INSERT INTO physical_intakes(id,student_number,first_name,last_name,application_type,status,submitted_at,updated_at,created_by_staff_id)
        VALUES('intake','TEST-1','Synthetic','Student','initial','under_review','2026-10-13','2026-10-13','staff');
        INSERT INTO physical_intake_files(id,intake_id,revision_number,storage_key,original_filename,byte_size,sha256,upload_status,uploaded_at,created_by_staff_id)
        VALUES('file-1','intake',1,'physical/file-1','student.pdf',9437184,lower(hex(zeroblob(32))),'finalized','2026-10-13','staff');
        UPDATE physical_intakes SET current_pdf_id='file-1' WHERE id='intake';
        INSERT INTO physical_document_scan_jobs(id,file_id,revision_id,storage_key,byte_size,media_type,available_at,created_at,updated_at)
        VALUES('scan-1','file-1','file-1','physical/file-1',9437184,'application/pdf','2026-10-13','2026-10-13','2026-10-13');`);
    return database;
}

function applyMigration(database) {
    database.exec('BEGIN IMMEDIATE');
    try {
        database.exec(MIGRATION_SQL);
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
}

function insertPhysicalFile(database, options) {
    database.prepare(`INSERT INTO physical_intake_files
        (id,intake_id,revision_number,storage_key,original_filename,byte_size,sha256,upload_status,uploaded_at,created_by_staff_id)
        VALUES(?, 'intake', ?, ?, 'student.pdf', ?, ?, 'finalized', '2026-10-13', 'staff')`)
        .bind(options.id, options.revision, `physical/${options.id}`, options.bytes, 'a'.repeat(64)).run();
}

test('physical intake PDF size migration preserves records and raises only the intake PDF cap to 50 MiB', () => {
    const database = createPreMigrationDatabase();

    applyMigration(database);

    assert.equal(MAX_PHYSICAL_PDF_BYTES, 50 * 1024 * 1024);
    assert.equal(MAX_PHYSICAL_RECEIPT_PDF_BYTES, 10 * 1024 * 1024);
    assert.equal(database.prepare('SELECT current_pdf_id FROM physical_intakes WHERE id=?').bind('intake').first().current_pdf_id, 'file-1');
    assert.equal(database.prepare('SELECT byte_size FROM physical_intake_files WHERE id=?').bind('file-1').first().byte_size, 9437184);
    assert.equal(database.prepare('SELECT byte_size FROM physical_document_scan_jobs WHERE id=?').bind('scan-1').first().byte_size, 9437184);

    insertPhysicalFile(database, { id: 'file-2', revision: 2, bytes: MAX_PHYSICAL_PDF_BYTES });
    database.prepare(`INSERT INTO physical_document_scan_jobs
        (id,file_id,revision_id,storage_key,byte_size,media_type,available_at,created_at,updated_at)
        VALUES('scan-2','file-2','file-2','physical/file-2',?,'application/pdf','2026-10-13','2026-10-13','2026-10-13')`)
        .bind(MAX_PHYSICAL_PDF_BYTES).run();
    assert.throws(() => insertPhysicalFile(database, { id: 'file-3', revision: 3, bytes: MAX_PHYSICAL_PDF_BYTES + 1 }), /CHECK constraint failed/);
    assert.equal(database.prepare('PRAGMA foreign_key_check').all().results.length, 0);
});
