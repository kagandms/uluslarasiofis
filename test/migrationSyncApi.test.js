import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashSessionToken } from '../src/server/auth/sessionToken.js';
import { createD1Repositories } from '../src/server/repositories/d1/index.js';
import { createMigrationSyncRepository } from '../src/server/repositories/d1/migrationSyncRepository.js';
import { createPhysicalIntakeRepository } from '../src/server/repositories/d1/physical-intake-repository.js';
import { getIstanbulTodayIso, shiftIsoCalendarDate } from '../src/server/domain/yoksisAuditPolicy.js';
import { purgeApplicationById } from '../src/server/routes/staffApplicationDeletionRoutes.js';
import { purgePhysicalIntakeById } from '../src/server/services/physicalIntakePurge.js';
import worker from '../src/server/worker.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

function createEnvironment({ appEnv = 'production', physicalMode = 'on' } = {}) {
    const database = new TestD1Database();
    applyAllMigrations(database);
    const objects = new Map();
    const environment = {
        DB: database,
        APP_ENV: appEnv,
        PHYSICAL_INTAKE_MODE: physicalMode,
        STAFF_SHARED_USERNAME: 'reviewer-1',
        DOCUMENTS: {
            async delete(key) { objects.delete(key); }
        },
        PRINT_FILES: {
            async delete(key) { objects.delete(key); }
        }
    };
    return { database, environment, objects };
}

function makeRequest(path, { method = 'POST', body = {}, cookie, origin = 'https://portal.test' } = {}) {
    const headers = new Headers({ Origin: origin });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (cookie) headers.set('Cookie', cookie);
    return new Request(`https://portal.test${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
}

async function seedStaff(environment, database, id = 'reviewer-1', token = 'staff-session-token-01234567890123456789012', role = 'reviewer') {
    environment.STAFF_SHARED_USERNAME = id;
    await database.prepare(`
        INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role)
        VALUES (?, ?, ?, 'test-hash', 'Reviewer', ?)
    `).bind(id, id, id, role).run();
    await database.prepare(`
        INSERT INTO staff_sessions (id, staff_user_id, token_hash, expires_at)
        VALUES (?, ?, ?, ?)
    `).bind(crypto.randomUUID(), id, await hashSessionToken(token), new Date(Date.now() + 60_000).toISOString()).run();
    return `staff_session=${token}`;
}

async function seedImport(database, {
    importId = 'imp-1',
    exportedAt = '2026-11-27 09:00',
    finalizedAt = '2026-11-27T09:00:00.000Z',
    staffId = 'reviewer-1'
} = {}) {
    await database.prepare(`
        INSERT INTO yoksis_audit_imports (id, uploaded_at, uploaded_by_staff_id, exported_at, row_count, finalized_at)
        VALUES (?, ?, ?, ?, 1, ?)
    `).bind(importId, finalizedAt || '2026-11-27T09:00:00.000Z', staffId, exportedAt, finalizedAt).run();
}

async function seedAuditRow(database, {
    applicationNumber = '2026-11-0000001',
    studentNumber = '26000000001',
    firstName = 'AYŞE YILMAZ',
    lastName = '',
    applicationStatus = 'İşlem Tamamlandı',
    statusCategory = 'successful',
    source = 'excel',
    lastSeenImportId = 'imp-1',
    missingDeadline = null,
    recordDate = '2026-11-05',
    gocLastQueryAt = '2026-11-25',
    documents = [],
    staffId = 'reviewer-1'
} = {}) {
    await database.prepare(`
        INSERT INTO yoksis_document_audit_records (
            application_number, student_number, first_name, last_name, passport_number, phone,
            application_status, status_category, result_status, documents_json, search_text,
            scanned_at, updated_by_staff_id, source, last_seen_import_id, missing_deadline,
            record_date, goc_last_query_at
        ) VALUES (?, ?, ?, ?, '', '', ?, ?, 'verified', ?, 'search', '2026-11-27T09:00:00.000Z', ?, ?, ?, ?, ?, ?)
    `).bind(
        applicationNumber,
        studentNumber,
        firstName,
        lastName,
        applicationStatus,
        statusCategory,
        JSON.stringify(documents),
        staffId,
        source,
        lastSeenImportId,
        missingDeadline,
        recordDate,
        gocLastQueryAt
    ).run();
}

async function seedOnlineApplication(database, {
    id = crypto.randomUUID(),
    studentNumber = '26000000001',
    firstName = 'Ayşe',
    lastName = 'Yılmaz',
    status = 'sent_to_migration',
    createdAt = '2026-11-05T10:00:00.000Z',
    updatedAt = '2026-11-10T10:00:00.000Z'
} = {}) {
    const studentId = `student-${id}`;
    await database.prepare(`
        INSERT INTO students (id, student_number, normalized_student_number)
        VALUES (?, ?, ?)
    `).bind(studentId, studentNumber, studentNumber.toUpperCase()).run();
    await database.prepare(`
        INSERT INTO applications (
            id, student_id, application_type, status, first_name, last_name,
            is_under_18, address_evidence_type, document_policy_version, created_at, updated_at
        ) VALUES (?, ?, 'initial', ?, ?, ?, 0, 'rental_contract', 1, ?, ?)
    `).bind(id, studentId, status, firstName, lastName, createdAt, updatedAt).run();
    return id;
}

async function seedPhysicalIntake(database, {
    id = crypto.randomUUID(),
    studentNumber = '26000000002',
    firstName = 'Mehmet',
    lastName = 'Kaya',
    passportNumber = `P${id.slice(0, 8).toUpperCase()}`,
    status = 'sent_to_migration',
    applicationDate = '2026-11-05',
    linkedApplicationId = null,
    staffId = 'reviewer-1'
} = {}) {
    await database.prepare(`
        INSERT INTO physical_intakes (
            id, student_number, first_name, last_name, passport_number,
            application_type, application_route, linked_application_id,
            submitted_at, updated_at, created_by_staff_id, status, application_date
        ) VALUES (?, ?, ?, ?, ?, 'initial', 'standard', ?, '2026-11-05T10:00:00.000Z', '2026-11-10T10:00:00.000Z', ?, ?, ?)
    `).bind(id, studentNumber, firstName, lastName, passportNumber, linkedApplicationId, staffId, status, applicationDate).run();
    return id;
}

test('sync preview and apply reject unauthenticated (401), cross-origin (403), and >20 items (400)', async () => {
    const { database, environment } = createEnvironment();
    const cookie = await seedStaff(environment, database);

    const unauthPreview = await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/preview'), environment);
    assert.equal(unauthPreview.status, 401);

    const unauthApply = await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/apply', {
        body: { import_id: 'imp-1', items: [] }
    }), environment);
    assert.equal(unauthApply.status, 401);

    const crossOrigin = await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/preview', {
        cookie,
        origin: 'https://evil.test'
    }), environment);
    assert.equal(crossOrigin.status, 403);

    const twentyOneItems = Array.from({ length: 21 }, (_, index) => ({
        record_kind: 'online',
        record_id: `app-${index}`,
        application_number: `2026-11-${String(index + 1).padStart(7, '0')}`,
        version: '2026-11-10T10:00:00.000Z'
    }));
    const tooMany = await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/apply', {
        cookie,
        body: { import_id: 'imp-1', items: twentyOneItems }
    }), environment);
    assert.equal(tooMany.status, 400);
});

test('sync preview ignores stale and non-excel rows', async () => {
    const { database, environment } = createEnvironment();
    const cookie = await seedStaff(environment, database);
    await seedImport(database, { importId: 'imp-old', finalizedAt: '2026-11-26T09:00:00.000Z' });
    await seedImport(database, { importId: 'imp-new', finalizedAt: '2026-11-27T09:00:00.000Z' });

    await seedOnlineApplication(database, { id: 'app-stale', studentNumber: '26000000001' });
    await seedOnlineApplication(database, { id: 'app-scan', studentNumber: '26000000002' });
    await seedOnlineApplication(database, { id: 'app-fresh', studentNumber: '26000000003' });

    await seedAuditRow(database, {
        applicationNumber: '2026-11-0000001',
        studentNumber: '26000000001',
        source: 'excel',
        lastSeenImportId: 'imp-old'
    });
    await seedAuditRow(database, {
        applicationNumber: '2026-11-0000002',
        studentNumber: '26000000002',
        source: 'scan',
        lastSeenImportId: 'imp-new'
    });
    await seedAuditRow(database, {
        applicationNumber: '2026-11-0000003',
        studentNumber: '26000000003',
        source: 'excel',
        lastSeenImportId: 'imp-new'
    });

    const response = await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/preview', { cookie }), environment);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.import_id, 'imp-new');
    assert.equal(data.changes.length, 1);
    assert.equal(data.changes[0].record_id, 'app-fresh');
});

test('sync apply detects version conflict and newer import between preview and apply', async () => {
    const { database, environment } = createEnvironment();
    const cookie = await seedStaff(environment, database);
    await seedImport(database, { importId: 'imp-1', finalizedAt: '2026-11-27T09:00:00.000Z' });

    const appId = await seedOnlineApplication(database, { id: 'app-1', studentNumber: '26000000001' });
    await seedAuditRow(database, {
        applicationNumber: '2026-11-0000001',
        studentNumber: '26000000001',
        applicationStatus: 'İşlem Tamamlandı',
        lastSeenImportId: 'imp-1'
    });

    const previewRes = await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/preview', { cookie }), environment);
    const preview = await previewRes.json();
    assert.equal(preview.changes.length, 1);
    const item = preview.changes[0];

    // Concurrent staff modification changes updated_at
    await database.prepare("UPDATE applications SET updated_at = '2026-11-27T09:05:00.000Z' WHERE id = ?").bind(appId).run();

    const conflictRes = await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/apply', {
        cookie,
        body: {
            import_id: 'imp-1',
            items: [{
                record_kind: item.record_kind,
                record_id: item.record_id,
                application_number: item.application_number,
                version: item.version
            }]
        }
    }), environment);
    const conflictData = await conflictRes.json();
    assert.equal(conflictData.applied.length, 0);
    assert.equal(conflictData.conflicts.length, 1);
    assert.equal(conflictData.conflicts[0].reason, 'version_conflict');
    assert.equal(database.prepare('SELECT status FROM applications WHERE id = ?').bind(appId).first().status, 'sent_to_migration');

    // Newer import uploaded between preview and apply
    await seedImport(database, { importId: 'imp-2', finalizedAt: '2026-11-27T10:00:00.000Z' });
    const importConflictRes = await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/apply', {
        cookie,
        body: {
            import_id: 'imp-1',
            items: [{
                record_kind: item.record_kind,
                record_id: item.record_id,
                application_number: item.application_number,
                version: '2026-11-27T09:05:00.000Z'
            }]
        }
    }), environment);
    const importConflict = await importConflictRes.json();
    assert.equal(importConflict.applied.length, 0);
    assert.equal(importConflict.conflicts[0].reason, 'import_changed');
});

test('repeated apply is idempotent and audit metadata contains no PII or note text', async () => {
    const { database, environment } = createEnvironment();
    const cookie = await seedStaff(environment, database);
    await seedImport(database, { importId: 'imp-1' });
    const appId = await seedOnlineApplication(database, {
        id: 'app-missing',
        studentNumber: '26000000001',
        firstName: 'Ayşe',
        lastName: 'Yılmaz'
    });
    const secretNote = 'Özel pasaport notu 12345';
    await seedAuditRow(database, {
        applicationNumber: '2026-11-0000001',
        studentNumber: '26000000001',
        applicationStatus: 'Eksik Belge İstendi (son: 06.12.2026)',
        statusCategory: 'missing_documents',
        missingDeadline: '2026-12-06',
        documents: [{ name: secretNote, required: true }],
        lastSeenImportId: 'imp-1'
    });

    const preview = await (await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/preview', { cookie }), environment)).json();
    const item = preview.changes[0];
    const applyPayload = {
        import_id: 'imp-1',
        items: [{
            record_kind: item.record_kind,
            record_id: item.record_id,
            application_number: item.application_number,
            version: item.version
        }]
    };

    const firstApply = await (await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/apply', {
        cookie,
        body: applyPayload
    }), environment)).json();
    assert.equal(firstApply.applied.length, 1);
    assert.equal(firstApply.conflicts.length, 0);

    const secondApply = await (await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/apply', {
        cookie,
        body: applyPayload
    }), environment)).json();
    assert.equal(secondApply.applied.length, 1);
    assert.equal(secondApply.applied[0].idempotent, true);
    assert.equal(secondApply.conflicts.length, 0);

    const overlayRows = database.prepare("SELECT * FROM migration_office_states WHERE record_kind = 'online' AND record_id = ?").bind(appId).all().results;
    assert.equal(overlayRows.length, 1);
    assert.equal(overlayRows[0].state, 'missing_documents');
    assert.equal(overlayRows[0].note, secretNote);
    assert.equal(overlayRows[0].deadline, '2026-12-06');

    const auditEvents = database.prepare("SELECT safe_metadata_json FROM audit_events WHERE event_type = 'staff.yoksis_sync_applied'").all().results;
    assert.equal(auditEvents.length, 1);
    assert.doesNotMatch(auditEvents[0].safe_metadata_json, /Ayşe|Yılmaz|26000000001|2026-11-0000001|Özel pasaport/);
});

test('partially failing batch commits valid item and leaves zero half-state on failing item', async () => {
    const { database, environment } = createEnvironment();
    const cookie = await seedStaff(environment, database);
    await seedImport(database, { importId: 'imp-1' });

    const appOk = await seedOnlineApplication(database, { id: 'app-ok', studentNumber: '26000000001' });
    const physFail = await seedPhysicalIntake(database, { id: 'phys-fail', studentNumber: '26000000002' });

    await seedAuditRow(database, {
        applicationNumber: '2026-11-0000001',
        studentNumber: '26000000001',
        firstName: 'Ayşe Yılmaz',
        applicationStatus: 'İşlem Tamamlandı',
        lastSeenImportId: 'imp-1'
    });
    await seedAuditRow(database, {
        applicationNumber: '2026-11-0000002',
        studentNumber: '26000000002',
        firstName: 'Mehmet Kaya',
        applicationStatus: 'İşlem Tamamlandı',
        lastSeenImportId: 'imp-1'
    });

    const preview = await (await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/preview', { cookie }), environment)).json();
    assert.equal(preview.changes.length, 2);

    // Inject a failure on the second item's D1 batch (physical_intakes update) via a temporary trigger.
    database.exec(`
        CREATE TRIGGER fail_physical_sync
        BEFORE UPDATE ON physical_intakes
        WHEN NEW.id = 'phys-fail'
        BEGIN
            SELECT RAISE(ABORT, 'simulated batch failure');
        END;
    `);

    const applyRes = await (await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/apply', {
        cookie,
        body: {
            import_id: 'imp-1',
            items: preview.changes.map((item) => ({
                record_kind: item.record_kind,
                record_id: item.record_id,
                application_number: item.application_number,
                version: item.version
            }))
        }
    }), environment)).json();

    assert.equal(applyRes.applied.length, 1);
    assert.equal(applyRes.applied[0].record_id, appOk);
    assert.equal(applyRes.conflicts.length, 1);
    assert.equal(applyRes.conflicts[0].record_id, physFail);

    assert.equal(database.prepare('SELECT status FROM applications WHERE id = ?').bind(appOk).first().status, 'migration_approved');
    assert.equal(database.prepare('SELECT status FROM physical_intakes WHERE id = ?').bind(physFail).first().status, 'sent_to_migration');
    assert.equal(database.prepare("SELECT COUNT(*) AS cnt FROM migration_office_states WHERE record_id = ?").bind(physFail).first().cnt, 0);
});

test('leaving sent_to_migration deletes overlay row (except approval) and permanent purge removes overlay rows', async () => {
    const { database, environment } = createEnvironment();
    await seedStaff(environment, database, 'admin-1', 'admin-session-token-01234567890123456789012', 'admin');
    const repositories = createD1Repositories(database);

    const appId = await seedOnlineApplication(database, { id: 'app-leave', studentNumber: '26000000001' });
    const physId = await seedPhysicalIntake(database, { id: '11111111-1111-4111-8111-111111111111', studentNumber: '26000000002', staffId: 'admin-1' });

    await database.prepare(`
        INSERT INTO migration_office_states (
            record_kind, record_id, application_number, state, note, deadline, import_id, updated_by_staff_id, updated_at
        ) VALUES
            ('online', ?, '2026-11-0000001', 'missing_documents', 'Note', '2026-12-06', 'imp-1', 'admin-1', '2026-11-27T09:00:00.000Z'),
            ('physical', ?, '2026-11-0000002', 'missing_documents', 'Note', '2026-12-06', 'imp-1', 'admin-1', '2026-11-27T09:00:00.000Z')
    `).bind(appId, physId).run();

    // Online leaves sent_to_migration -> under_review: overlay deleted
    const leftOnline = await repositories.applicationReviews.transitionApplicationStatus({
        applicationId: appId,
        currentStatus: 'sent_to_migration',
        expectedUpdatedAt: '2026-11-10T10:00:00.000Z',
        targetStatus: 'under_review',
        rejectionReason: null,
        rejectionNoteId: null,
        staffId: 'admin-1',
        now: '2026-11-27T09:10:00.000Z',
        requestId: 'req-1',
        auditId: crypto.randomUUID()
    });
    assert.equal(leftOnline, true);
    assert.equal(database.prepare("SELECT COUNT(*) AS cnt FROM migration_office_states WHERE record_kind = 'online' AND record_id = ?").bind(appId).first().cnt, 0);

    // Physical leaves sent_to_migration -> migration_approved: overlay becomes 'approved'
    const physicalRepository = createPhysicalIntakeRepository(database);
    const approvedPhys = await physicalRepository.update({
        id: physId,
        version: 1,
        now: '2026-11-27T09:11:00.000Z',
        status: 'migration_approved',
        reason: '',
        staffId: 'admin-1',
        requestId: 'req-2'
    });
    assert.equal(approvedPhys, true);
    assert.equal(
        database.prepare("SELECT state FROM migration_office_states WHERE record_kind = 'physical' AND record_id = ?").bind(physId).first().state,
        'approved'
    );

    // Re-insert online overlay and test online permanent purge
    await database.prepare(`
        INSERT INTO migration_office_states (
            record_kind, record_id, application_number, state, note, deadline, import_id, updated_by_staff_id, updated_at
        ) VALUES ('online', ?, '2026-11-0000001', 'approved', '', NULL, 'imp-1', 'admin-1', '2026-11-27T09:12:00.000Z')
    `).bind(appId).run();

    await purgeApplicationById({
        environment,
        applicationId: appId,
        staff: { id: 'admin-1' },
        requestId: 'req-purge-online'
    });
    assert.equal(database.prepare("SELECT COUNT(*) AS cnt FROM migration_office_states WHERE record_kind = 'online' AND record_id = ?").bind(appId).first().cnt, 0);

    // Physical permanent purge removes overlay row
    await purgePhysicalIntakeById({
        environment,
        intakeId: physId,
        staff: { id: 'admin-1' },
        requestId: 'req-purge-physical'
    });
    assert.equal(database.prepare("SELECT COUNT(*) AS cnt FROM migration_office_states WHERE record_kind = 'physical' AND record_id = ?").bind(physId).first().cnt, 0);
});

async function seedDocumentRevision(database, applicationId, code, { scanStatus = 'clean', uploadStatus = 'finalized' } = {}) {
    const requirement = database.prepare(`
        SELECT id FROM document_requirements
        WHERE application_type = 'initial' AND code = ? AND is_active = 1
    `).bind(code).first();
    const documentRecordId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    database.prepare(`
        INSERT INTO document_records (id, application_id, requirement_id, application_type, review_status)
        VALUES (?, ?, ?, 'initial', 'pending')
    `).bind(documentRecordId, applicationId, requirement.id).run();
    database.prepare(`
        INSERT INTO document_revisions (id, document_record_id, revision_number, status, is_current, submitted_by_type)
        VALUES (?, ?, 1, 'submitted', 1, 'student')
    `).bind(revisionId, documentRecordId).run();
    database.prepare(`
        INSERT INTO document_revision_files (
            id, revision_id, page_order, storage_key, original_filename, media_type, byte_size, upload_status, scan_status
        ) VALUES (?, ?, 0, ?, ?, 'application/pdf', 128, ?, ?)
    `).bind(fileId, revisionId, `quarantine/${fileId}`, `${code}.pdf`, uploadStatus, scanStatus).run();
    return { documentRecordId, revisionId, fileId };
}

test('physical access guard hides physical records from preview and rejects physical apply when disabled', async () => {
    const { database, environment } = createEnvironment({ appEnv: 'production', physicalMode: 'off' });
    const cookie = await seedStaff(environment, database);
    await seedImport(database, { importId: 'imp-1' });

    const appId = await seedOnlineApplication(database, { id: 'app-online-1', studentNumber: '26000000001' });
    const physId = await seedPhysicalIntake(database, { id: '22222222-2222-4222-8222-222222222222', studentNumber: '26000000002' });

    await seedAuditRow(database, {
        applicationNumber: '2026-11-0000001',
        studentNumber: '26000000001',
        firstName: 'Ayşe Yılmaz',
        applicationStatus: 'İşlem Tamamlandı',
        lastSeenImportId: 'imp-1'
    });
    await seedAuditRow(database, {
        applicationNumber: '2026-11-0000002',
        studentNumber: '26000000002',
        firstName: 'Mehmet Kaya',
        applicationStatus: 'İşlem Tamamlandı',
        lastSeenImportId: 'imp-1'
    });

    const preview = await (await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/preview', { cookie }), environment)).json();
    assert.equal(preview.changes.length, 1);
    assert.equal(preview.changes[0].record_id, appId);

    const applyPhysical = await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/apply', {
        cookie,
        body: {
            import_id: 'imp-1',
            items: [{
                record_kind: 'physical',
                record_id: physId,
                application_number: '2026-11-0000002',
                version: 1
            }]
        }
    }), environment);
    assert.equal(applyPhysical.status, 403);
    assert.equal(database.prepare('SELECT status FROM physical_intakes WHERE id = ?').bind(physId).first().status, 'sent_to_migration');
});

test('needsAttention online record approves only clean finalized documents and writes direct_transfer audit events', async () => {
    const { database, environment } = createEnvironment();
    const cookie = await seedStaff(environment, database);
    await seedImport(database, { importId: 'imp-1' });

    const appId = await seedOnlineApplication(database, {
        id: 'app-needs-attention',
        studentNumber: '26000000001',
        status: 'under_review'
    });
    const cleanDoc = await seedDocumentRevision(database, appId, 'passport', { scanStatus: 'clean', uploadStatus: 'finalized' });
    const unsafeDoc = await seedDocumentRevision(database, appId, 'health_insurance', { scanStatus: 'unsafe', uploadStatus: 'finalized' });

    await seedAuditRow(database, {
        applicationNumber: '2026-11-0000001',
        studentNumber: '26000000001',
        firstName: 'Ayşe Yılmaz',
        applicationStatus: 'İşlem Bekliyor',
        statusCategory: 'pending',
        lastSeenImportId: 'imp-1'
    });

    const preview = await (await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/preview', { cookie }), environment)).json();
    assert.equal(preview.changes.length, 0);
    assert.equal(preview.needsAttention.length, 1);
    const item = preview.needsAttention[0];

    const applyRes = await (await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/apply', {
        cookie,
        body: {
            import_id: 'imp-1',
            items: [{
                record_kind: item.record_kind,
                record_id: item.record_id,
                application_number: item.application_number,
                version: item.version
            }]
        }
    }), environment)).json();

    assert.equal(applyRes.applied.length, 1);
    assert.equal(applyRes.conflicts.length, 0);
    assert.equal(database.prepare('SELECT status FROM applications WHERE id = ?').bind(appId).first().status, 'sent_to_migration');
    assert.equal(database.prepare('SELECT status FROM document_revisions WHERE id = ?').bind(cleanDoc.revisionId).first().status, 'approved');
    assert.equal(database.prepare('SELECT review_status FROM document_records WHERE id = ?').bind(cleanDoc.documentRecordId).first().review_status, 'approved');
    assert.equal(database.prepare('SELECT status FROM document_revisions WHERE id = ?').bind(unsafeDoc.revisionId).first().status, 'submitted');
    assert.equal(database.prepare('SELECT review_status FROM document_records WHERE id = ?').bind(unsafeDoc.documentRecordId).first().review_status, 'pending');

    const auditTypes = database.prepare('SELECT event_type FROM audit_events WHERE application_id = ? ORDER BY event_type').bind(appId).all().results.map((r) => r.event_type);
    assert.deepEqual(auditTypes, ['staff.application_documents_approved_on_migration', 'staff.yoksis_sync_applied']);
});

test('import accepts old client payload without recordDate and new payload with recordDate', async () => {
    const { database, environment } = createEnvironment();
    const cookie = await seedStaff(environment, database);

    const res = await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/import', {
        cookie,
        body: {
            importId: 'imp-compat-1',
            exportedAt: '2026-11-27 09:00',
            final: true,
            rows: [
                {
                    applicationNumber: '2026-13-1046943',
                    studentNumber: '26000000001',
                    fullName: 'ESKİ İSTEMCİ',
                    processType: 'İlk Başvuru',
                    transactionCount: 1,
                    gocStatus: 'İşlem Bekliyor'
                },
                {
                    applicationNumber: '2026-00-1046944',
                    studentNumber: '26000000002',
                    fullName: 'YENİ İSTEMCİ',
                    processType: 'İlk Başvuru',
                    transactionCount: 1,
                    gocStatus: 'İşlem Bekliyor',
                    recordDate: '2026-11-20',
                    gocLastQueryAt: '2026-11-25'
                }
            ]
        }
    }), environment);

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.storedCount, 2);
    assert.equal(data.rejected.length, 0);

    const oldRow = database.prepare('SELECT record_date FROM yoksis_document_audit_records WHERE application_number = ?')
        .bind('2026-13-1046943').first();
    const newRow = database.prepare('SELECT record_date, goc_last_query_at FROM yoksis_document_audit_records WHERE application_number = ?')
        .bind('2026-00-1046944').first();
    assert.equal(oldRow.record_date, null);
    assert.equal(newRow.record_date, '2026-11-20');
    assert.equal(newRow.goc_last_query_at, '2026-11-25');
});

test('sync apply stores goc_last_query_at and subsequent older query cannot clear missing_documents overlay', async () => {
    const { database, environment } = createEnvironment();
    const cookie = await seedStaff(environment, database);
    await seedImport(database, { importId: 'imp-1', finalizedAt: '2026-11-25T09:00:00.000Z' });
    const appId = await seedOnlineApplication(database, { id: 'app-q', studentNumber: '26000000001' });

    await seedAuditRow(database, {
        applicationNumber: '2026-13-0000001',
        studentNumber: '26000000001',
        applicationStatus: 'Eksik Belge İstendi (son: 10.12.2026)',
        statusCategory: 'missing_documents',
        missingDeadline: '2026-12-10',
        documents: [{ name: 'Sağlık sigortası', required: true }],
        recordDate: '2026-11-05',
        gocLastQueryAt: '2026-11-20',
        lastSeenImportId: 'imp-1'
    });

    const preview1 = await (await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/preview', { cookie }), environment)).json();
    const item = preview1.changes[0];
    assert.equal(item.goc_last_query_at, '2026-11-20');

    await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/apply', {
        cookie,
        body: {
            import_id: 'imp-1',
            items: [{
                record_kind: item.record_kind,
                record_id: item.record_id,
                application_number: item.application_number,
                version: item.version
            }]
        }
    }), environment);

    const overlay = database.prepare("SELECT state, goc_last_query_at FROM migration_office_states WHERE record_kind = 'online' AND record_id = ?")
        .bind(appId).first();
    assert.equal(overlay.state, 'missing_documents');
    assert.equal(overlay.goc_last_query_at, '2026-11-20');

    await seedImport(database, { importId: 'imp-2', finalizedAt: '2026-11-27T09:00:00.000Z' });
    await database.prepare(`
        UPDATE yoksis_document_audit_records
        SET application_status = 'İşlem Bekliyor', status_category = 'pending',
            documents_json = '[]', missing_deadline = NULL,
            goc_last_query_at = '2026-11-15', last_seen_import_id = 'imp-2'
        WHERE application_number = '2026-13-0000001'
    `).run();

    const preview2 = await (await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/preview', { cookie }), environment)).json();
    assert.equal(preview2.changes.length, 0);
    assert.equal(preview2.manual.length, 1);
    assert.equal(preview2.manual[0].reason, 'stale_query_conflict');
});

test('query staleQueryOnly filter runs in SQL with pagination and combines with status and match filters', async () => {
    const { database, environment } = createEnvironment();
    const cookie = await seedStaff(environment, database);
    await seedImport(database, { importId: 'imp-1' });

    const todayIso = getIstanbulTodayIso();
    const sevenDaysAgo = shiftIsoCalendarDate(todayIso, -7);
    const eightDaysAgo = shiftIsoCalendarDate(todayIso, -8);
    const fifteenDaysAgo = shiftIsoCalendarDate(todayIso, -15);

    await seedOnlineApplication(database, { id: 'app-match', studentNumber: '26000000001', firstName: 'Ayşe', lastName: 'Yılmaz' });

    // Eligible for staleQueryOnly (unfinished + >7 days or missing)
    await seedAuditRow(database, {
        applicationNumber: '2026-13-0000001',
        studentNumber: '26000000001',
        firstName: 'AYŞE YILMAZ',
        applicationStatus: 'İşlem Bekliyor',
        statusCategory: 'pending',
        gocLastQueryAt: eightDaysAgo
    });
    await seedAuditRow(database, {
        applicationNumber: '2026-13-0000002',
        studentNumber: '26000000002',
        firstName: 'ALİ DEMİR',
        applicationStatus: 'Eksik Belge İstendi',
        statusCategory: 'missing_documents',
        gocLastQueryAt: null
    });
    await seedAuditRow(database, {
        applicationNumber: '2026-13-0000003',
        studentNumber: '26000000003',
        firstName: 'VELİ KAYA',
        applicationStatus: 'İşlem Bekliyor',
        statusCategory: 'pending',
        gocLastQueryAt: fifteenDaysAgo
    });
    // Excluded: 7 days ago (not > 7)
    await seedAuditRow(database, {
        applicationNumber: '2026-13-0000004',
        studentNumber: '26000000004',
        firstName: 'YEDİ GÜN',
        applicationStatus: 'İşlem Bekliyor',
        statusCategory: 'pending',
        gocLastQueryAt: sevenDaysAgo
    });
    // Excluded: completed even though old
    await seedAuditRow(database, {
        applicationNumber: '2026-13-0000005',
        studentNumber: '26000000005',
        firstName: 'TAMAMLANDI ESKİ',
        applicationStatus: 'İşlem Tamamlandı',
        statusCategory: 'successful',
        gocLastQueryAt: fifteenDaysAgo
    });
    // Excluded: scan row
    await seedAuditRow(database, {
        applicationNumber: '2026-13-0000006',
        studentNumber: '26000000006',
        firstName: 'TARAMA SATIRI',
        applicationStatus: 'İşlem Bekliyor',
        statusCategory: 'pending',
        source: 'scan',
        gocLastQueryAt: null
    });

    const page1 = await (await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/query', {
        cookie,
        body: { staleQueryOnly: true, page: 1, pageSize: 2 }
    }), environment)).json();
    assert.equal(page1.total, 3);
    assert.equal(page1.records.length, 2);

    const page2 = await (await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/query', {
        cookie,
        body: { staleQueryOnly: true, page: 2, pageSize: 2 }
    }), environment)).json();
    assert.equal(page2.total, 3);
    assert.equal(page2.records.length, 1);

    const combinedStatus = await (await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/query', {
        cookie,
        body: { staleQueryOnly: true, status: 'missing_documents', page: 1, pageSize: 10 }
    }), environment)).json();
    assert.equal(combinedStatus.total, 1);
    assert.equal(combinedStatus.records[0].application_number, '2026-13-0000002');

    const combinedMatch = await (await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/query', {
        cookie,
        body: { staleQueryOnly: true, match: 'matched', page: 1, pageSize: 10 }
    }), environment)).json();
    assert.equal(combinedMatch.total, 1);
    assert.equal(combinedMatch.records[0].application_number, '2026-13-0000001');
});

test('multiple_open_records guard forces manual for online record when hidden physical record exists and never exposes physical details', async () => {
    const { database, environment } = createEnvironment({ appEnv: 'production', physicalMode: 'off' });
    const cookie = await seedStaff(environment, database);
    await seedImport(database, { importId: 'imp-1' });

    const appId = await seedOnlineApplication(database, {
        id: 'app-online-hidden-phys',
        studentNumber: '26000000001',
        updatedAt: '2026-11-10T10:00:00.000Z'
    });
    const physId = await seedPhysicalIntake(database, {
        id: '22222222-2222-4222-8222-222222222222',
        studentNumber: '26000000001',
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        linkedApplicationId: null
    });

    await seedAuditRow(database, {
        applicationNumber: '2026-11-0000001',
        studentNumber: '26000000001',
        firstName: 'Ayşe Yılmaz',
        applicationStatus: 'İşlem Tamamlandı',
        lastSeenImportId: 'imp-1'
    });

    const preview = await (await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/preview', { cookie }), environment)).json();
    assert.equal(preview.changes.length, 0);
    assert.equal(preview.needsAttention.length, 0);
    assert.equal(preview.manual.length, 1);
    assert.equal(preview.manual[0].record_kind, 'online');
    assert.equal(preview.manual[0].record_id, appId);
    assert.equal(preview.manual[0].reason, 'multiple_open_records');
    assert.equal(preview.manual.some((entry) => entry.record_kind === 'physical' || entry.record_id === physId), false);

    const applyRes = await (await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/apply', {
        cookie,
        body: {
            import_id: 'imp-1',
            items: [{
                record_kind: 'online',
                record_id: appId,
                application_number: '2026-11-0000001',
                version: '2026-11-10T10:00:00.000Z'
            }]
        }
    }), environment)).json();
    assert.equal(applyRes.applied.length, 0);
    assert.deepEqual(applyRes.conflicts, [{
        record_kind: 'online',
        record_id: appId,
        application_number: '2026-11-0000001',
        reason: 'version_conflict'
    }]);
    assert.equal(database.prepare('SELECT status FROM applications WHERE id = ?').bind(appId).first().status, 'sent_to_migration');
});

test('apply rejects online item with version_conflict when an unrequested unlinked open physical record exists even with physical access enabled', async () => {
    const { database, environment } = createEnvironment({ appEnv: 'production', physicalMode: 'on' });
    const cookie = await seedStaff(environment, database);
    await seedImport(database, { importId: 'imp-1' });

    const appId = await seedOnlineApplication(database, {
        id: 'app-online-with-phys',
        studentNumber: '26000000001',
        updatedAt: '2026-11-10T10:00:00.000Z'
    });
    await seedPhysicalIntake(database, {
        id: '33333333-3333-4333-8333-333333333333',
        studentNumber: '26000000001',
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        linkedApplicationId: null
    });

    await seedAuditRow(database, {
        applicationNumber: '2026-11-0000001',
        studentNumber: '26000000001',
        firstName: 'Ayşe Yılmaz',
        applicationStatus: 'İşlem Tamamlandı',
        lastSeenImportId: 'imp-1'
    });

    const applyRes = await (await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/apply', {
        cookie,
        body: {
            import_id: 'imp-1',
            items: [{
                record_kind: 'online',
                record_id: appId,
                application_number: '2026-11-0000001',
                version: '2026-11-10T10:00:00.000Z'
            }]
        }
    }), environment)).json();
    assert.equal(applyRes.applied.length, 0);
    assert.deepEqual(applyRes.conflicts, [{
        record_kind: 'online',
        record_id: appId,
        application_number: '2026-11-0000001',
        reason: 'version_conflict'
    }]);
    assert.equal(database.prepare('SELECT status FROM applications WHERE id = ?').bind(appId).first().status, 'sent_to_migration');
});

test('moving migration_approved back to sent_to_migration deletes approved overlay for both online and physical records', async () => {
    const { database, environment } = createEnvironment();
    await seedStaff(environment, database);
    await seedImport(database, { importId: 'imp-1' });
    const repositories = createD1Repositories(database);
    const physicalRepo = createPhysicalIntakeRepository(database);

    const appId = await seedOnlineApplication(database, {
        id: 'app-revert-approved',
        studentNumber: '26000000001',
        status: 'migration_approved',
        updatedAt: '2026-11-10T10:00:00.000Z'
    });
    const physId = await seedPhysicalIntake(database, {
        id: '44444444-4444-4444-8444-444444444444',
        studentNumber: '26000000002',
        status: 'migration_approved'
    });

    await database.prepare(`
        INSERT INTO migration_office_states (
            record_kind, record_id, application_number, state, note, deadline, import_id, updated_by_staff_id, updated_at
        ) VALUES
            ('online', ?, '2026-11-0000001', 'approved', '', NULL, 'imp-1', 'reviewer-1', '2026-11-10T10:00:00.000Z'),
            ('physical', ?, '2026-11-0000002', 'approved', '', NULL, 'imp-1', 'reviewer-1', '2026-11-10T10:00:00.000Z')
    `).bind(appId, physId).run();

    const onlineOk = await repositories.applicationReviews.transitionApplicationStatus({
        applicationId: appId,
        currentStatus: 'migration_approved',
        expectedUpdatedAt: '2026-11-10T10:00:00.000Z',
        targetStatus: 'sent_to_migration',
        staffId: 'reviewer-1',
        now: '2026-11-11T10:00:00.000Z',
        requestId: 'req-online-revert',
        auditId: crypto.randomUUID()
    });
    assert.equal(onlineOk, true);
    assert.equal(database.prepare('SELECT status FROM applications WHERE id = ?').bind(appId).first().status, 'sent_to_migration');
    assert.equal(
        database.prepare("SELECT 1 FROM migration_office_states WHERE record_kind = 'online' AND record_id = ?").bind(appId).first(),
        null
    );

    const physicalOk = await physicalRepo.update({
        id: physId,
        version: 1,
        status: 'sent_to_migration',
        reason: '',
        staffId: 'reviewer-1',
        now: '2026-11-11T10:00:00.000Z',
        requestId: 'req-physical-revert'
    });
    assert.equal(physicalOk, true);
    assert.equal(database.prepare('SELECT status FROM physical_intakes WHERE id = ?').bind(physId).first().status, 'sent_to_migration');
    assert.equal(
        database.prepare("SELECT 1 FROM migration_office_states WHERE record_kind = 'physical' AND record_id = ?").bind(physId).first(),
        null
    );
});

test('idempotent apply branch requires current status to match overlay result (completed or reverted -> version_conflict)', async () => {
    const { database, environment } = createEnvironment();
    const cookie = await seedStaff(environment, database);
    await seedImport(database, { importId: 'imp-1' });
    const repositories = createD1Repositories(database);

    const appId = await seedOnlineApplication(database, {
        id: 'app-idempotent-check',
        studentNumber: '26000000001',
        status: 'sent_to_migration',
        updatedAt: '2026-11-10T10:00:00.000Z'
    });
    await seedAuditRow(database, {
        applicationNumber: '2026-11-0000001',
        studentNumber: '26000000001',
        firstName: 'Ayşe Yılmaz',
        applicationStatus: 'İşlem Tamamlandı',
        lastSeenImportId: 'imp-1'
    });

    const firstApply = await (await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/apply', {
        cookie,
        body: {
            import_id: 'imp-1',
            items: [{
                record_kind: 'online',
                record_id: appId,
                application_number: '2026-11-0000001',
                version: '2026-11-10T10:00:00.000Z'
            }]
        }
    }), environment)).json();
    assert.equal(firstApply.applied.length, 1);

    // Retry while still migration_approved -> idempotent success
    const retryWhileApproved = await (await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/apply', {
        cookie,
        body: {
            import_id: 'imp-1',
            items: [{
                record_kind: 'online',
                record_id: appId,
                application_number: '2026-11-0000001',
                version: '2026-11-10T10:00:00.000Z'
            }]
        }
    }), environment)).json();
    assert.equal(retryWhileApproved.applied.length, 1);
    assert.equal(retryWhileApproved.applied[0].idempotent, true);

    // Move to completed -> overlay may still be 'approved', but status is now 'completed' -> version_conflict
    const currentUpdatedAt = database.prepare('SELECT updated_at FROM applications WHERE id = ?').bind(appId).first().updated_at;
    const completedOk = await repositories.applicationReviews.transitionApplicationStatus({
        applicationId: appId,
        currentStatus: 'migration_approved',
        expectedUpdatedAt: currentUpdatedAt,
        targetStatus: 'completed',
        staffId: 'reviewer-1',
        now: '2026-11-12T10:00:00.000Z',
        requestId: 'req-complete',
        auditId: crypto.randomUUID()
    });
    assert.equal(completedOk, true);

    const retryAfterCompleted = await (await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/apply', {
        cookie,
        body: {
            import_id: 'imp-1',
            items: [{
                record_kind: 'online',
                record_id: appId,
                application_number: '2026-11-0000001',
                version: '2026-11-10T10:00:00.000Z'
            }]
        }
    }), environment)).json();
    assert.equal(retryAfterCompleted.applied.length, 0);
    assert.deepEqual(retryAfterCompleted.conflicts, [{
        record_kind: 'online',
        record_id: appId,
        application_number: '2026-11-0000001',
        reason: 'version_conflict'
    }]);
});

test('preview and apply scope queries to relevant students and chunk IN lists below 100 parameters', async () => {
    const { database, environment } = createEnvironment();
    const cookie = await seedStaff(environment, database);
    await seedImport(database, { importId: 'imp-1' });

    const targetAppId = await seedOnlineApplication(database, {
        id: 'app-in-import',
        studentNumber: '26000000001',
        updatedAt: '2026-11-10T10:00:00.000Z'
    });
    await seedOnlineApplication(database, {
        id: 'app-not-in-import',
        studentNumber: '26000000099',
        updatedAt: '2026-11-10T10:00:00.000Z'
    });
    await seedAuditRow(database, {
        applicationNumber: '2026-11-0000001',
        studentNumber: '26000000001',
        firstName: 'Ayşe Yılmaz',
        applicationStatus: 'İşlem Tamamlandı',
        lastSeenImportId: 'imp-1'
    });

    const recordedQueries = [];
    const originalPrepare = database.prepare.bind(database);
    const instrumentedDb = new Proxy(database, {
        get(target, prop) {
            if (prop === 'prepare') {
                return (sql) => {
                    const stmt = originalPrepare(sql);
                    return {
                        bind(...params) {
                            recordedQueries.push({ sql, paramCount: params.length, params });
                            return stmt.bind(...params);
                        },
                        all: (...args) => {
                            recordedQueries.push({ sql, paramCount: 0, params: [] });
                            return stmt.all(...args);
                        },
                        first: (...args) => {
                            recordedQueries.push({ sql, paramCount: 0, params: [] });
                            return stmt.first(...args);
                        },
                        run: (...args) => stmt.run(...args)
                    };
                };
            }
            const value = target[prop];
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });

    const previewEnv = { ...environment, DB: instrumentedDb };
    await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/preview', { cookie }), previewEnv);
    const previewAuditQueries = recordedQueries.filter((entry) => entry.sql.includes('FROM yoksis_document_audit_records'));
    const previewOnlineQueries = recordedQueries.filter((entry) => entry.sql.includes('FROM applications'));
    const previewPhysicalQueries = recordedQueries.filter((entry) => entry.sql.includes('FROM physical_intakes'));
    assert.equal(previewAuditQueries.length, 1);
    assert.equal(previewOnlineQueries.length, 1);
    assert.equal(previewPhysicalQueries.length, 1);
    assert.doesNotMatch(previewOnlineQueries[0].sql, /IN \(/);
    assert.doesNotMatch(previewPhysicalQueries[0].sql, /IN \(/);

    recordedQueries.length = 0;
    await worker.fetch(makeRequest('/api/staff/yoksis-document-audit/sync/apply', {
        cookie,
        body: {
            import_id: 'imp-1',
            items: [{
                record_kind: 'online',
                record_id: targetAppId,
                application_number: '2026-11-0000001',
                version: '2026-11-10T10:00:00.000Z'
            }]
        }
    }), previewEnv);
    const applyAuditQueries = recordedQueries.filter((entry) => entry.sql.includes('FROM yoksis_document_audit_records'));
    assert.equal(applyAuditQueries.length, 1);
    assert.match(applyAuditQueries[0].sql, /IN \(/);

    // Verify chunking stays below D1's 100 bound parameter limit when > 100 student numbers are queried
    recordedQueries.length = 0;
    const syncRepo = createMigrationSyncRepository(instrumentedDb);
    const manyStudents = Array.from({ length: 120 }, (_, i) => `2600000${String(i).padStart(4, '0')}`);
    const rows = await syncRepo.listFinalizedExcelAuditRows('imp-1', { studentNumbers: manyStudents });
    assert.equal(rows.length, 1);
    const portalRows = await syncRepo.listPortalRecordsForSync({ includePhysical: true, studentNumbers: manyStudents });
    assert.equal(portalRows.length, 2);
    for (const entry of recordedQueries) {
        assert.ok(entry.paramCount < 100, `Expected < 100 bound parameters, got ${entry.paramCount}`);
    }
});

test('preview with 500 students uses a constant number of queries (one per table)', async () => {
    const { database, environment } = createEnvironment();
    const cookie = await seedStaff(environment, database);
    await seedImport(database, { importId: 'imp-500' });

    for (let i = 1; i <= 500; i += 1) {
        await seedAuditRow(database, {
            applicationNumber: `2026-11-${String(i).padStart(7, '0')}`,
            studentNumber: `2650000${String(i).padStart(4, '0')}`,
            firstName: `ÖĞRENCİ ${i}`,
            applicationStatus: 'İşlem Tamamlandı',
            lastSeenImportId: 'imp-500'
        });
    }

    const syncQueries = [];
    const originalPrepare = database.prepare.bind(database);
    const instrumentedDb = new Proxy(database, {
        get(target, prop) {
            if (prop === 'prepare') {
                return (sql) => {
                    const stmt = originalPrepare(sql);
                    return {
                        bind(...params) {
                            syncQueries.push(sql);
                            return stmt.bind(...params);
                        },
                        all: (...args) => {
                            syncQueries.push(sql);
                            return stmt.all(...args);
                        },
                        first: (...args) => {
                            syncQueries.push(sql);
                            return stmt.first(...args);
                        },
                        run: (...args) => stmt.run(...args)
                    };
                };
            }
            const value = target[prop];
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });

    const previewRes = await worker.fetch(
        makeRequest('/api/staff/yoksis-document-audit/sync/preview', { cookie }),
        { ...environment, DB: instrumentedDb }
    );
    assert.equal(previewRes.status, 200);
    assert.equal(syncQueries.filter((sql) => sql.includes('FROM yoksis_document_audit_records')).length, 1);
    assert.equal(syncQueries.filter((sql) => sql.includes('FROM applications')).length, 1);
    assert.equal(syncQueries.filter((sql) => sql.includes('FROM physical_intakes')).length, 1);
});
