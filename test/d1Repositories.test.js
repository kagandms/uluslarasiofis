import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createD1Repositories } from '../src/server/repositories/d1/index.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

function createRepositories() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    return { database, repositories: createD1Repositories(database) };
}

async function createDraft(repositories, applicationId, studentId, applicationType) {
    return repositories.applications.createDraft({
        applicationId,
        studentId,
        studentNumber: studentId,
        applicationType,
        studentEmail: `${studentId}@example.edu`,
        studentPhone: '+905551112233'
    });
}

function addFinalizedDocument(database, applicationId, applicationType, code, suffix) {
    const requirement = database.prepare(`
        SELECT id FROM document_requirements WHERE code = ? AND application_type = ?
    `).bind(code, applicationType).first();
    assert.ok(requirement, `missing requirement ${applicationType}:${code}`);
    const recordId = `record-${suffix}`;
    const revisionId = `revision-${suffix}`;
    const fileId = `file-${suffix}`;
    database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type)
        VALUES (?, ?, ?, ?)
    `).bind(recordId, applicationId, requirement.id, applicationType).run();
    database.prepare(`
        INSERT INTO document_revisions (id, document_record_id, revision_number, status, is_current, submitted_by_type)
        VALUES (?, ?, 1, 'submitted', 1, 'student')
    `).bind(revisionId, recordId).run();
    database.prepare(`
        INSERT INTO document_revision_files (
            id, revision_id, page_order, storage_key, original_filename, media_type, byte_size, upload_status, scan_status
        ) VALUES (?, ?, 0, ?, ?, 'application/pdf', 1024, 'finalized', 'clean')
    `).bind(fileId, revisionId, `quarantine/${suffix}`, `${code}.pdf`).run();
    return { recordId, revisionId, fileId, storageKey: `quarantine/${suffix}` };
}

async function changeDraftType(repositories, applicationId, applicationType, suffix) {
    return repositories.applications.updateDraft(applicationId, { applicationType }, {
        auditEventId: `type-change-${suffix}`,
        requestId: `request-${suffix}`
    });
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

test('draft application type changes work in both directions without creating a second application', async () => {
    const { database, repositories } = createRepositories();
    const initialApplicationId = 'app-type-initial';
    const renewalApplicationId = 'app-type-renewal';
    await createDraft(repositories, initialApplicationId, 'type-student-initial', 'initial');
    await createDraft(repositories, renewalApplicationId, 'type-student-renewal', 'renewal');

    const renewal = await changeDraftType(repositories, initialApplicationId, 'renewal', 'initial-to-renewal');
    const initial = await changeDraftType(repositories, renewalApplicationId, 'initial', 'renewal-to-initial');

    assert.equal(renewal.id, initialApplicationId);
    assert.equal(renewal.application_type, 'renewal');
    assert.equal(initial.id, renewalApplicationId);
    assert.equal(initial.application_type, 'initial');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM applications').first().count, 2);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'application.application_type_changed'").first().count, 2);
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all().results, []);
});

test('repeated application type switches preserve shared and renewal-only document history', async () => {
    const { database, repositories } = createRepositories();
    const applicationId = 'app-repeated-switch';
    await createDraft(repositories, applicationId, 'type-student-repeat', 'initial');
    const passport = addFinalizedDocument(database, applicationId, 'initial', 'passport', 'passport-repeat');

    let application = await changeDraftType(repositories, applicationId, 'renewal', 'switch-1');
    assert.equal(application.application_type, 'renewal');
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all().results, []);
    const uets = addFinalizedDocument(database, applicationId, 'renewal', 'uets', 'uets-repeat');

    application = await changeDraftType(repositories, applicationId, 'initial', 'switch-2');
    assert.equal(application.application_type, 'initial');
    const archivedUetsRequirement = database.prepare(`
        SELECT requirements.is_required, requirements.is_active
        FROM document_records AS records
        JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
        WHERE records.id = ?
    `).bind(uets.recordId).first();
    assert.deepEqual({ ...archivedUetsRequirement }, { is_required: 0, is_active: 0 });
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all().results, []);

    application = await changeDraftType(repositories, applicationId, 'renewal', 'switch-3');
    const documents = database.prepare(`
        SELECT records.id, records.application_type, requirements.code, requirements.is_active
        FROM document_records AS records
        JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
        WHERE records.application_id = ? ORDER BY requirements.code
    `).bind(applicationId).all().results;
    const history = database.prepare(`
        SELECT revisions.id AS revision_id, files.id AS file_id, files.storage_key
        FROM document_records AS records
        JOIN document_revisions AS revisions ON revisions.document_record_id = records.id
        JOIN document_revision_files AS files ON files.revision_id = revisions.id
        WHERE records.application_id = ? ORDER BY files.id
    `).bind(applicationId).all().results;

    assert.equal(application.application_type, 'renewal');
    assert.deepEqual(documents.map(({ id, application_type, code }) => ({ id, application_type, code })), [
        { id: passport.recordId, application_type: 'renewal', code: 'passport' },
        { id: uets.recordId, application_type: 'renewal', code: 'uets' }
    ]);
    assert.deepEqual(history.map(({ revision_id, file_id, storage_key }) => ({ revision_id, file_id, storage_key })), [
        { revision_id: passport.revisionId, file_id: passport.fileId, storage_key: passport.storageKey },
        { revision_id: uets.revisionId, file_id: uets.fileId, storage_key: uets.storageKey }
    ]);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM document_records WHERE application_id = ?').bind(applicationId).first().count, 2);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM document_revisions').first().count, 2);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM document_revision_files').first().count, 2);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'application.application_type_changed'").first().count, 3);
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all().results, []);
});

test('application type remap aborts without changing a draft when a requirement code has no explicit compatibility mapping', async () => {
    const { database, repositories } = createRepositories();
    const applicationId = 'app-unmapped-record';
    await createDraft(repositories, applicationId, 'type-student-unmapped', 'initial');
    database.prepare(`
        INSERT INTO document_requirements (id, code, application_type, is_required, display_order)
        VALUES ('req-initial-unmapped', 'legacy_unknown', 'initial', 1, 99)
    `).run();
    database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type)
        VALUES ('record-unknown', ?, 'req-initial-unmapped', 'initial')
    `).bind(applicationId).run();

    await assert.rejects(
        changeDraftType(repositories, applicationId, 'renewal', 'unmapped'),
        (error) => error.code === 'APPLICATION_TYPE_CHANGE_BLOCKED'
    );

    const application = await repositories.applications.findById(applicationId);
    const record = database.prepare('SELECT application_type, requirement_id FROM document_records WHERE id = ?').bind('record-unknown').first();
    assert.equal(application.application_type, 'initial');
    assert.deepEqual({ ...record }, { application_type: 'initial', requirement_id: 'req-initial-unmapped' });
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'application.application_type_changed'").first().count, 0);
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all().results, []);
});

test('draft application type audit contains only the previous and new types and ignores unchanged values', async () => {
    const { database, repositories } = createRepositories();
    const applicationId = 'app-type-audit';
    await createDraft(repositories, applicationId, 'type-student-audit', 'initial');

    await changeDraftType(repositories, applicationId, 'initial', 'same-type');
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'application.application_type_changed'").first().count, 0);
    await changeDraftType(repositories, applicationId, 'renewal', 'changed-type');

    const event = database.prepare(`
        SELECT safe_metadata_json FROM audit_events WHERE event_type = 'application.application_type_changed'
    `).first();
    assert.deepEqual(JSON.parse(event.safe_metadata_json), { previous_application_type: 'initial', new_application_type: 'renewal' });
});

test('non-draft applications reject application type changes', async () => {
    const { database, repositories } = createRepositories();
    const applicationId = 'app-type-submitted';
    await createDraft(repositories, applicationId, 'type-student-submitted', 'initial');
    database.prepare("UPDATE applications SET status = 'submitted' WHERE id = ?").bind(applicationId).run();

    const application = await changeDraftType(repositories, applicationId, 'renewal', 'submitted');

    assert.equal(application, null);
    assert.equal(database.prepare('SELECT application_type FROM applications WHERE id = ?').bind(applicationId).first().application_type, 'initial');
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all().results, []);
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
