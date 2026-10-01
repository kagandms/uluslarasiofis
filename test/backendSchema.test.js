import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyAllMigrations } from './helpers/apply-migrations.js';

const foundationMigration = readFileSync(new URL('../migrations/0001_backend_foundation.sql', import.meta.url), 'utf8');
const session3Migration = readFileSync(new URL('../migrations/0002_session3_fingerprint_and_birth_certificate.sql', import.meta.url), 'utf8');
const cleanupMigration = readFileSync(new URL('../migrations/0003_session3_document_cleanup.sql', import.meta.url), 'utf8');
const publicPolicyMigration = readFileSync(new URL('../migrations/0004_public_portal_document_policy.sql', import.meta.url), 'utf8');

function createDatabase() {
    const database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys = ON;');
    applyAllMigrations(database);
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

function createSession3Database() {
    const database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys = ON;');
    database.exec(foundationMigration);
    database.exec(session3Migration);
    database.exec(cleanupMigration);
    return database;
}

function applyMigrationsAfter(database, lastAppliedMigration) {
    const migrationsDirectory = new URL('../migrations/', import.meta.url);
    const migrationFiles = readdirSync(migrationsDirectory)
        .filter((filename) => filename.endsWith('.sql') && filename > lastAppliedMigration)
        .sort();
    migrationFiles.forEach((filename) => database.exec(readFileSync(new URL(filename, migrationsDirectory), 'utf8')));
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

test('public portal migration adds persisted address evidence and archives superseded requirements safely', () => {
    const database = createDatabase();
    const applicationColumns = database.prepare('PRAGMA table_info(applications)').all().map(({ name }) => name);
    const newRequirements = database.prepare(`
        SELECT code, application_type, is_required, is_active
        FROM document_requirements
        WHERE code IN ('passport_identity', 'address_document', 'fingerprint', 'uets')
        ORDER BY code, application_type
    `).all();

    assert.ok(applicationColumns.includes('address_evidence_type'));
    assert.deepEqual(newRequirements.filter(({ code }) => code !== 'uets').map(({ code, is_required, is_active }) => ({
        code, is_required, is_active
    })), [
        { code: 'address_document', is_required: 0, is_active: 0 },
        { code: 'address_document', is_required: 0, is_active: 0 },
        { code: 'fingerprint', is_required: 0, is_active: 0 },
        { code: 'fingerprint', is_required: 0, is_active: 0 },
        { code: 'passport_identity', is_required: 0, is_active: 0 },
        { code: 'passport_identity', is_required: 0, is_active: 0 }
    ]);
    assert.ok(newRequirements.some(({ code, application_type, is_required, is_active }) =>
        code === 'uets' && application_type === 'initial' && is_required === 0 && is_active === 0));
});

test('forward migration preserves a pre-existing renewal UETS document and seeds its inactive initial compatibility row', () => {
    const database = createSession3Database();
    insertStudent(database, 'legacy-student', 'legacy-1');
    insertApplication(database, 'legacy-application', 'legacy-student', 'draft', 'renewal');
    database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type)
        VALUES ('legacy-uets', 'legacy-application', 'req-renewal-uets', 'renewal')
    `).run();
    database.prepare(`
        INSERT INTO document_revisions (id, document_record_id, revision_number, status, submitted_by_type)
        VALUES ('legacy-uets-revision', 'legacy-uets', 1, 'submitted', 'student')
    `).run();
    database.prepare(`
        INSERT INTO document_revision_files (
            id, revision_id, page_order, storage_key, original_filename, media_type, byte_size, upload_status, scan_status
        ) VALUES (
            'legacy-uets-file', 'legacy-uets-revision', 0, 'quarantine/legacy-uets',
            'uets.pdf', 'application/pdf', 1024, 'finalized', 'clean'
        )
    `).run();

    applyMigrationsAfter(database, '0003_session3_document_cleanup.sql');

    const compatibilityRequirement = database.prepare(`
        SELECT is_required, is_active FROM document_requirements
        WHERE code = 'uets' AND application_type = 'initial'
    `).get();
    const preservedRows = database.prepare(`
        SELECT
            (SELECT COUNT(*) FROM document_records WHERE id = 'legacy-uets') AS records,
            (SELECT COUNT(*) FROM document_revisions WHERE id = 'legacy-uets-revision') AS revisions,
            (SELECT COUNT(*) FROM document_revision_files WHERE id = 'legacy-uets-file') AS files,
            (SELECT storage_key FROM document_revision_files WHERE id = 'legacy-uets-file') AS storage_key
    `).get();

    assert.deepEqual({ ...compatibilityRequirement }, { is_required: 0, is_active: 0 });
    assert.deepEqual({ ...preservedRows }, { records: 1, revisions: 1, files: 1, storage_key: 'quarantine/legacy-uets' });
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
});

test('Session 3 migration adds nullable fingerprint fields and only the new conditional certificate requirement', () => {
    const database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys = ON;');
    database.exec(foundationMigration);
    insertStudent(database, 'student-before-upgrade', '2026123455');
    insertApplication(database, 'application-before-upgrade', 'student-before-upgrade');
    database.exec(session3Migration);

    const application = database.prepare(`
        SELECT fingerprint_status, fingerprint_code FROM applications WHERE id = 'application-before-upgrade'
    `).get();
    const ageRequirements = database.prepare(`
        SELECT code, application_type, is_required FROM document_requirements
        WHERE code LIKE '%birth_certificate%' OR code LIKE '%parental%' OR code LIKE '%guardian%'
        ORDER BY application_type, code
    `).all();
    const fingerprintCount = database.prepare(`
        SELECT COUNT(*) AS count FROM document_requirements WHERE code = 'fingerprint'
    `).get().count;

    assert.equal(application.fingerprint_status, null);
    assert.equal(application.fingerprint_code, null);
    assert.deepEqual(ageRequirements.map(({ code, application_type, is_required }) => ({ code, application_type, is_required })), [
        { code: 'birth_certificate_under18', application_type: 'initial', is_required: 1 },
        { code: 'birth_certificate_under18', application_type: 'renewal', is_required: 1 }
    ]);
    assert.equal(fingerprintCount, 2);
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

test('document-scoped notes migration preserves existing rows and enforces its nullable document reference', () => {
    const database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys = ON;');
    database.exec(foundationMigration);
    database.exec(session3Migration);
    database.exec(cleanupMigration);
    database.exec(publicPolicyMigration);
    insertStudent(database, 'note-student', 'NOTE-001');
    insertApplication(database, 'note-application', 'note-student', 'submitted');
    database.prepare(`
        INSERT INTO application_notes (id, application_id, author_type, visibility, body)
        VALUES ('legacy-note', 'note-application', 'student', 'student', 'Existing note')
    `).run();
    applyMigrationsAfter(database, '0004_public_portal_document_policy.sql');

    const legacyNote = database.prepare('SELECT document_record_id FROM application_notes WHERE id = ?').get('legacy-note');
    const requirementId = database.prepare(`
        SELECT id FROM document_requirements WHERE code = 'passport' AND application_type = 'initial'
    `).get().id;
    database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type)
        VALUES ('note-document', 'note-application', ?, 'initial')
    `).run(requirementId);
    database.prepare(`
        INSERT INTO application_notes (id, application_id, document_record_id, author_type, visibility, body)
        VALUES ('document-note', 'note-application', 'note-document', 'student', 'student', 'Document note')
    `).run();

    assert.deepEqual({ ...legacyNote }, { document_record_id: null });
    assert.equal(database.prepare('SELECT document_record_id FROM application_notes WHERE id = ?').get('document-note').document_record_id, 'note-document');
    assert.throws(() => database.prepare(`
        INSERT INTO application_notes (id, application_id, document_record_id, author_type, visibility, body)
        VALUES ('invalid-document-note', 'note-application', 'missing-document', 'student', 'student', 'Invalid')
    `).run(), /FOREIGN KEY constraint failed/);
    assert.ok(database.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'index'
          AND name = 'idx_application_notes_document_visibility_created'
    `).get());
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
});
