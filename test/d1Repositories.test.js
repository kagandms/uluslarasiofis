import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createD1Repositories } from '../src/server/repositories/d1/index.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

const migrationSql = readFileSync(new URL('../migrations/0001_backend_foundation.sql', import.meta.url), 'utf8');

function createRepositories() {
    const database = new TestD1Database();
    database.exec(migrationSql);
    return { database, repositories: createD1Repositories(database) };
}

test('student repository finds students by normalized student number', async () => {
    const { repositories } = createRepositories();
    await repositories.applications.createDraft({
        applicationId: '11111111-1111-4111-8111-111111111111',
        studentId: '22222222-2222-4222-8222-222222222222',
        studentNumber: '  ab-123  ',
        applicationType: 'initial',
        studentEmail: 'student@example.edu',
        studentPhone: '+905551112233'
    });

    const student = await repositories.students.findByStudentNumber('AB-123');
    assert.equal(student.student_number, 'ab-123');
    assert.equal(student.normalized_student_number, 'AB-123');
});

test('staff repository preserves one active administrator when deactivating the last admin', async () => {
    const { database, repositories } = createRepositories();
    await database.prepare(`
        INSERT INTO staff_users (
            id, username, normalized_username, password_hash, display_name, role
        ) VALUES ('admin-1', 'admin', 'admin', 'test-hash', 'Admin', 'admin')
    `).run();
    const changed = await repositories.staff.setActive('admin-1', false, new Date().toISOString());

    assert.equal(changed, false);
    assert.equal(database.prepare("SELECT is_active FROM staff_users WHERE id = 'admin-1'").first().is_active, 1);
});

test('application repository maps duplicate active applications to a domain conflict', async () => {
    const { repositories, database } = createRepositories();
    const studentId = '22222222-2222-4222-8222-222222222222';
    await repositories.applications.createDraft({
        applicationId: '11111111-1111-4111-8111-111111111111',
        studentId,
        studentNumber: 'AB-123',
        applicationType: 'initial',
        studentEmail: 'student@example.edu',
        studentPhone: '+905551112233'
    });

    await assert.rejects(
        repositories.applications.createDraft({
            applicationId: '33333333-3333-4333-8333-333333333333',
            studentId: '44444444-4444-4444-8444-444444444444',
            studentNumber: ' ab-123 ',
            applicationType: 'renewal',
            studentEmail: 'student@example.edu',
            studentPhone: '+905551112233'
        }),
        (error) => error.code === 'APPLICATION_ALREADY_ACTIVE'
    );

    const studentCount = database.prepare('SELECT COUNT(*) AS count FROM students').first().count;
    const applicationCount = database.prepare('SELECT COUNT(*) AS count FROM applications').first().count;
    assert.equal(studentCount, 1);
    assert.equal(applicationCount, 1);
});

test('document repository exposes only finalized clean current revision files', async () => {
    const { repositories, database } = createRepositories();
    const applicationId = '11111111-1111-4111-8111-111111111111';
    const studentId = '22222222-2222-4222-8222-222222222222';
    await repositories.applications.createDraft({
        applicationId,
        studentId,
        studentNumber: 'AB-123',
        applicationType: 'initial',
        studentEmail: 'student@example.edu',
        studentPhone: '+905551112233'
    });
    const requirementId = 'req-initial-passport-identity';
    database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type)
        VALUES ('document-1', ?, ?, 'initial')
    `).bind(applicationId, requirementId).run();
    database.prepare(`
        INSERT INTO document_revisions (id, document_record_id, revision_number, status, submitted_by_type)
        VALUES ('revision-1', 'document-1', 1, 'submitted', 'student')
    `).run();
    database.prepare(`
        INSERT INTO document_revision_files (
            id, revision_id, page_order, storage_key, original_filename,
            media_type, byte_size, upload_status, scan_status
        ) VALUES ('file-1', 'revision-1', 0, 'quarantine/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'passport.pdf',
            'application/pdf', 1024, 'finalized', 'clean')
    `).run();

    const accessibleFile = await repositories.documents.findPrivateFileById('file-1');
    assert.equal(accessibleFile.storage_key, 'quarantine/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    database.prepare("UPDATE document_revision_files SET scan_status = 'unsafe' WHERE id = 'file-1'").run();
    assert.equal(await repositories.documents.findPrivateFileById('file-1'), null);
});


test('application submission transitions and audit are atomic and repeated calls have no duplicate effect', async () => {
    const { database, repositories } = createRepositories();
    await repositories.applications.createDraft({
        applicationId: '11111111-1111-4111-8111-111111111111',
        studentId: '22222222-2222-4222-8222-222222222222',
        studentNumber: 'AB-123',
        applicationType: 'initial',
        studentEmail: 'student@example.edu',
        studentPhone: '+905551112233'
    });
    const transition = {
        applicationId: '11111111-1111-4111-8111-111111111111',
        submittedAt: '2026-09-29T12:00:00.000Z',
        auditEventId: '33333333-3333-4333-8333-333333333333',
        requestId: 'req_submit_1'
    };

    const submitted = await repositories.applications.submitDraft(transition);
    const repeated = await repositories.applications.submitDraft({ ...transition, auditEventId: '44444444-4444-4444-8444-444444444444', requestId: 'req_submit_2' });

    assert.equal(submitted.status, 'submitted');
    assert.equal(submitted.submitted_at, transition.submittedAt);
    assert.equal(repeated, null);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'application.submitted'").first().count, 1);
});

test('application submission audit failure rolls back the state transition', async () => {
    const { database, repositories } = createRepositories();
    await repositories.applications.createDraft({
        applicationId: '11111111-1111-4111-8111-111111111111',
        studentId: '22222222-2222-4222-8222-222222222222',
        studentNumber: 'AB-123',
        applicationType: 'initial',
        studentEmail: 'student@example.edu',
        studentPhone: '+905551112233'
    });
    database.exec(`CREATE TRIGGER reject_submit_audit BEFORE INSERT ON audit_events WHEN NEW.event_type = 'application.submitted' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;`);

    await assert.rejects(repositories.applications.submitDraft({
        applicationId: '11111111-1111-4111-8111-111111111111',
        submittedAt: '2026-09-29T12:00:00.000Z',
        auditEventId: '33333333-3333-4333-8333-333333333333',
        requestId: 'req_submit_1'
    }));

    assert.equal(database.prepare('SELECT status FROM applications').first().status, 'draft');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'application.submitted'").first().count, 0);
});
