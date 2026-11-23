import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { TestD1Database } from './helpers/d1-test-binding.js';

const MIGRATION_DIRECTORY = new URL('../migrations/', import.meta.url);
const IMPORT_MIGRATION = '0046_yoksis_audit_import.sql';

test('YÖKSİS Excel import migration adds import ledger table and preserves existing scan records', () => {
    const database = new TestD1Database();
    const priorMigrations = readdirSync(MIGRATION_DIRECTORY)
        .filter((name) => name.endsWith('.sql') && name < IMPORT_MIGRATION)
        .sort();
    for (const migration of priorMigrations) {
        database.exec(readFileSync(new URL(migration, MIGRATION_DIRECTORY), 'utf8'));
    }

    database.prepare(`INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES (?, ?, ?, ?, ?, ?)`).bind('staff-1', 'staff', 'STAFF', 'hash', 'Staff User', 'admin').run();
    database.prepare(`INSERT INTO yoksis_document_audit_records (
        application_number, student_number, first_name, last_name, passport_number, phone,
        application_status, status_category, result_status, search_text, scanned_at, updated_by_staff_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        '2026-11-0000001', '12345678', 'AYŞE', 'TEST', 'U12345678', '5000000000',
        'İşlem Tamamlandı', 'successful', 'verified', 'ayse test 12345678 u12345678',
        '2026-11-03T00:00:00Z', 'staff-1'
    ).run();

    database.exec(readFileSync(new URL(IMPORT_MIGRATION, MIGRATION_DIRECTORY), 'utf8'));

    const importTableColumns = database.prepare('PRAGMA table_info(yoksis_audit_imports)').all().results
        .map((column) => column.name);
    assert.deepEqual(importTableColumns, [
        'id', 'uploaded_at', 'uploaded_by_staff_id', 'exported_at', 'row_count', 'finalized_at'
    ]);

    const existing = database.prepare(`
        SELECT application_number, source, last_seen_import_id, unit, program,
               missing_deadline, goc_last_query_at, last_transaction_type, transaction_count
        FROM yoksis_document_audit_records
        WHERE application_number = '2026-11-0000001'
    `).first();
    assert.deepEqual({ ...existing }, {
        application_number: '2026-11-0000001',
        source: 'scan',
        last_seen_import_id: null,
        unit: '',
        program: '',
        missing_deadline: null,
        goc_last_query_at: null,
        last_transaction_type: '',
        transaction_count: 1
    });

    assert.throws(() => database.prepare(`
        INSERT INTO yoksis_document_audit_records (
            application_number, student_number, status_category, result_status, search_text,
            scanned_at, updated_by_staff_id, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        '2026-11-0000002', '12345679', 'pending', 'verified', 'bad source',
        '2026-11-23T00:00:00Z', 'staff-1', 'manual'
    ).run(), /CHECK constraint failed/);

    assert.throws(() => database.prepare(`
        INSERT INTO yoksis_document_audit_records (
            application_number, student_number, status_category, result_status, search_text,
            scanned_at, updated_by_staff_id, transaction_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        '2026-11-0000003', '12345680', 'pending', 'verified', 'bad count',
        '2026-11-23T00:00:00Z', 'staff-1', 0
    ).run(), /CHECK constraint failed/);

    database.prepare(`
        INSERT INTO yoksis_audit_imports (id, uploaded_at, uploaded_by_staff_id, exported_at, row_count, finalized_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).bind('imp-1', '2026-11-23T10:00:00Z', 'staff-1', '2026-11-23 13:07', 1, '2026-11-23T10:00:05Z').run();

    database.prepare(`
        INSERT INTO yoksis_document_audit_records (
            application_number, student_number, first_name, status_category, result_status, search_text,
            scanned_at, updated_by_staff_id, source, last_seen_import_id, unit, program,
            missing_deadline, goc_last_query_at, last_transaction_type, transaction_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        '2026-11-0000004', '12345681', 'ALİ VELİ', 'missing_documents', 'verified', 'ali veli 12345681',
        '2026-11-23T10:00:00Z', 'staff-1', 'excel', 'imp-1', 'Mühendislik', 'Bilgisayar',
        '2026-12-06', '2026-11-23', 'Eksik Evrak', 2
    ).run();

    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all().results, []);
});
