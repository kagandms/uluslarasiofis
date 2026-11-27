import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyAllMigrations } from './helpers/apply-migrations.js';

function createDatabase() {
    const database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys = ON;');
    applyAllMigrations(database);
    return database;
}

test('migration 0049 creates migration_office_states with expected columns, constraints, and D1-safe GLOB', () => {
    const database = createDatabase();
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
    assert.ok(tables.includes('migration_office_states'));

    const columns = database.prepare('PRAGMA table_info(migration_office_states)').all().map((row) => row.name);
    assert.deepEqual(columns, [
        'record_kind',
        'record_id',
        'application_number',
        'state',
        'note',
        'deadline',
        'goc_last_query_at',
        'import_id',
        'updated_by_staff_id',
        'updated_at'
    ]);

    const auditColumns = database.prepare('PRAGMA table_info(yoksis_document_audit_records)').all().map((row) => row.name);
    assert.ok(auditColumns.includes('record_date'));

    const tableSql = database.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'migration_office_states'"
    ).get().sql;
    const globPatterns = [...tableSql.matchAll(/GLOB\s+'([^']*)'/g)].map(([, pattern]) => pattern);
    assert.ok(globPatterns.every((pattern) => Buffer.byteLength(pattern, 'utf8') <= 50));

    database.prepare(`
        INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES ('staff-1', 'reviewer', 'reviewer', 'hash', 'Reviewer', 'reviewer')
    `).run();

    assert.throws(() => {
        database.prepare(`
            INSERT INTO migration_office_states (
                record_kind, record_id, application_number, state, note, deadline, import_id, updated_by_staff_id, updated_at
            ) VALUES ('invalid', 'rec-1', '2026-11-0000001', 'reviewing', '', NULL, 'imp-1', 'staff-1', '2026-11-27T09:00:00.000Z')
        `).run();
    }, /CHECK constraint failed/);

    assert.throws(() => {
        database.prepare(`
            INSERT INTO migration_office_states (
                record_kind, record_id, application_number, state, note, deadline, import_id, updated_by_staff_id, updated_at
            ) VALUES ('online', 'rec-1', 'bad-number', 'reviewing', '', NULL, 'imp-1', 'staff-1', '2026-11-27T09:00:00.000Z')
        `).run();
    }, /CHECK constraint failed/);

    assert.throws(() => {
        database.prepare(`
            INSERT INTO migration_office_states (
                record_kind, record_id, application_number, state, note, deadline, import_id, updated_by_staff_id, updated_at
            ) VALUES ('online', 'rec-1', '2026-11-0000001', 'unknown', '', NULL, 'imp-1', 'staff-1', '2026-11-27T09:00:00.000Z')
        `).run();
    }, /CHECK constraint failed/);
});
