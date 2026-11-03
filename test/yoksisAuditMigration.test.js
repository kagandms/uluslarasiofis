import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { TestD1Database } from './helpers/d1-test-binding.js';

const MIGRATION_DIRECTORY = new URL('../migrations/', import.meta.url);
const CURRENT_MIGRATION = '0034_yoksis_document_audit.sql';
const FIX_MIGRATION = '0035_yoksis_audit_glob_limit.sql';

test('YÖKSİS audit constraint migration preserves rows and indexes while accepting valid application numbers', () => {
    const database = new TestD1Database();
    for (const migration of readdirSync(MIGRATION_DIRECTORY).filter((name) => name.endsWith('.sql')
        && name <= CURRENT_MIGRATION).sort()) {
        database.exec(readFileSync(new URL(migration, MIGRATION_DIRECTORY), 'utf8'));
    }
    database.prepare(`INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES (?, ?, ?, ?, ?, ?)`).bind('staff-1', 'staff', 'STAFF', 'hash', 'Staff', 'admin').run();
    database.prepare(`INSERT INTO yoksis_document_audit_records (
        application_number, student_number, status_category, result_status, search_text, scanned_at, updated_by_staff_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
        '2026-11-0000001', '12345678', 'successful', 'verified', 'sample', '2026-11-03T00:00:00Z', 'staff-1'
    ).run();

    database.exec(readFileSync(new URL(FIX_MIGRATION, MIGRATION_DIRECTORY), 'utf8'));

    assert.deepEqual(database.prepare('SELECT application_number, student_number FROM yoksis_document_audit_records').all().results
        .map(({ application_number, student_number }) => ({ application_number, student_number })), [
            { application_number: '2026-11-0000001', student_number: '12345678' }
        ]);
    assert.deepEqual(database.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'yoksis_document_audit_records' ORDER BY name")
        .all().results.map(({ name }) => name), [
        'idx_yoksis_audit_status_scanned', 'idx_yoksis_audit_student_number', 'sqlite_autoindex_yoksis_document_audit_records_1'
    ]);
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all().results, []);
    assert.throws(() => database.prepare(`INSERT INTO yoksis_document_audit_records (
        application_number, student_number, status_category, result_status, search_text, scanned_at, updated_by_staff_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
        '2026x110000001', '12345678', 'successful', 'verified', 'sample', '2026-11-03T00:00:00Z', 'staff-1'
    ).run(), /CHECK constraint failed/);
});
