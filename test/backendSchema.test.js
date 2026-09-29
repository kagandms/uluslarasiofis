import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const migrationPath = new URL('../migrations/0001_backend_foundation.sql', import.meta.url);
const migrationSql = readFileSync(migrationPath, 'utf8');

function createDatabase() {
    const database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys = ON;');
    database.exec(migrationSql);
    return database;
}

function insertStudent(database, id, studentNumber) {
    database.prepare(`
        INSERT INTO students (id, student_number, normalized_student_number)
        VALUES (?, ?, ?)
    `).run(id, studentNumber, studentNumber.trim().toUpperCase());
}

function insertApplication(database, id, studentId, status = 'draft', applicationType = 'initial') {
    database.prepare(`
        INSERT INTO applications (id, student_id, application_type, status)
        VALUES (?, ?, ?, ?)
    `).run(id, studentId, applicationType, status);
}

test('backend migration creates the complete Session 2 data foundation', () => {
    const database = createDatabase();
    const tableNames = database.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table'
    `).all().map((row) => row.name);

    for (const tableName of [
        'students', 'applications', 'document_requirements', 'document_records',
        'document_revisions', 'document_revision_files', 'staff_users', 'staff_sessions',
        'assignments', 'application_notes', 'audit_events', 'notifications',
        'notification_outbox', 'idempotency_records', 'upload_intents', 'staff_login_attempts',
        'application_sessions', 'public_rate_limits', 'staff_bootstrap_state'
    ]) {
        assert.ok(tableNames.includes(tableName), `missing table: ${tableName}`);
    }
});

test('database allows only one active application per normalized student number', () => {
    const database = createDatabase();
    insertStudent(database, 'student-1', '2026123456');
    insertApplication(database, 'application-1', 'student-1', 'draft', 'renewal');

    assert.throws(
        () => insertApplication(database, 'application-2', 'student-1', 'submitted', 'renewal'),
        /UNIQUE constraint failed/
    );

    database.prepare("UPDATE applications SET status = 'completed', terminal_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run('application-1');
    assert.doesNotThrow(() => insertApplication(database, 'application-2', 'student-1', 'draft', 'renewal'));
});

test('database rejects unsupported application types and duplicate student numbers', () => {
    const database = createDatabase();
    insertStudent(database, 'student-1', '2026123456');

    assert.throws(() => insertStudent(database, 'student-2', '2026123456'), /UNIQUE constraint failed/);
    assert.throws(() => insertApplication(database, 'application-1', 'student-1', 'draft', 'transfer'), /CHECK constraint failed/);
});

test('database preserves document revisions and rejects orphaned records', () => {
    const database = createDatabase();
    insertStudent(database, 'student-1', '2026123456');
    insertApplication(database, 'application-1', 'student-1', 'draft', 'renewal');
    const requirementId = database.prepare(`
        SELECT id FROM document_requirements
        WHERE code = 'uets' AND application_type = 'renewal'
    `).get().id;
    const documentId = 'document-1';
    database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type)
        VALUES (?, ?, ?, 'renewal')
    `).run(documentId, 'application-1', requirementId);
    database.prepare(`
        INSERT INTO document_revisions (id, document_record_id, revision_number, status, submitted_by_type)
        VALUES ('revision-1', ?, 1, 'submitted', 'student')
    `).run(documentId);

    assert.throws(
        () => database.prepare(`
            INSERT INTO document_revisions (id, document_record_id, revision_number, status, submitted_by_type)
            VALUES ('revision-duplicate', ?, 1, 'submitted', 'student')
        `).run(documentId),
        /UNIQUE constraint failed/
    );
    assert.throws(
        () => database.prepare('DELETE FROM applications WHERE id = ?').run('application-1'),
        /FOREIGN KEY constraint failed/
    );
});

test('database enforces staff roles and unique notification idempotency keys', () => {
    const database = createDatabase();
    assert.throws(() => database.prepare(`
        INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES ('staff-1', 'reviewer', 'reviewer', 'hash', 'Reviewer', 'owner')
    `).run(), /CHECK constraint failed/);

    insertStudent(database, 'student-1', '2026123456');
    insertApplication(database, 'application-1', 'student-1');
    database.prepare(`
        INSERT INTO notifications (id, application_id, channel, template_key, language, created_by_staff_id)
        VALUES ('notification-1', 'application-1', 'whatsapp', 'manual_test', 'tr', NULL)
    `).run();
    database.prepare(`
        INSERT INTO notification_outbox (id, notification_id, idempotency_key)
        VALUES ('outbox-1', 'notification-1', 'application-submitted:application-1')
    `).run();

    assert.throws(() => database.prepare(`
        INSERT INTO notification_outbox (id, notification_id, idempotency_key)
        VALUES ('outbox-2', 'notification-1', 'application-submitted:application-1')
    `).run(), /UNIQUE constraint failed/);
});
