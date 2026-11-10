import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION } from '../src/config/constants.js';
import { createD1Repositories } from '../src/server/repositories/d1/index.js';
import { createScannerRepository } from '../src/server/repositories/d1/scanner-repository.js';
import { createPhysicalIntakeRepository } from '../src/server/repositories/d1/physical-intake-repository.js';
import { applyAllMigrations } from './helpers/apply-migrations.js';
import { TestD1Database } from './helpers/d1-test-binding.js';

function setup() {
    const database = new TestD1Database();
    applyAllMigrations(database);
    return { database, repositories: createD1Repositories(database) };
}

async function createDraft(repositories, applicationId) {
    return repositories.applications.createDraft({
        applicationId, studentId: applicationId, studentNumber: applicationId, applicationType: 'initial',
        studentEmail: `${applicationId}@example.edu`, studentPhone: '+905551112233'
    });
}

const OLD_LOOKUP = `SELECT applications.*, students.student_number,
    EXISTS (SELECT 1 FROM audit_events WHERE audit_events.application_id = applications.id
        AND audit_events.event_type = 'application.contact_responsibility_accepted'
        AND json_extract(audit_events.safe_metadata_json, '$.version') = ?) AS contact_acknowledgement_accepted_current,
    (SELECT audit_events.created_at FROM audit_events WHERE audit_events.application_id = applications.id
        AND audit_events.event_type = 'application.contact_responsibility_accepted'
        AND json_extract(audit_events.safe_metadata_json, '$.version') = ?
        ORDER BY audit_events.created_at DESC LIMIT 1) AS contact_acknowledgement_accepted_at
    FROM applications JOIN students ON students.id = applications.student_id WHERE applications.id = ?`;

test('findById and findByReferenceNumber return the same acknowledgement fields as the previous two-subquery lookup', async () => {
    const { database, repositories } = setup();
    for (const id of ['ack-none', 'ack-current', 'ack-old-version', 'ack-two-events']) await createDraft(repositories, id);
    const insert = (id, applicationId, version, createdAt) => database.prepare(`
        INSERT INTO audit_events (id, event_type, actor_type, application_id, request_id, safe_metadata_json, created_at)
        VALUES (?, 'application.contact_responsibility_accepted', 'student', ?, 'req', ?, ?)`)
        .bind(id, applicationId, JSON.stringify({ version }), createdAt).run();
    await insert('e1', 'ack-current', CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION, '2026-11-01T10:00:00.000Z');
    await insert('e2', 'ack-old-version', 'an-older-version', '2026-11-01T10:00:00.000Z');
    await insert('e3', 'ack-two-events', CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION, '2026-11-01T10:00:00.000Z');
    await insert('e4', 'ack-two-events', CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION, '2026-11-02T10:00:00.000Z');

    for (const id of ['ack-none', 'ack-current', 'ack-old-version', 'ack-two-events']) {
        const expected = database.prepare(OLD_LOOKUP)
            .bind(CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION, CONTACT_RESPONSIBILITY_ACKNOWLEDGEMENT_VERSION, id).first();
        const actual = await repositories.applications.findById(id);
        assert.equal(Number(actual.contact_acknowledgement_accepted_current), Number(expected.contact_acknowledgement_accepted_current), id);
        assert.equal(actual.contact_acknowledgement_accepted_at ?? null, expected.contact_acknowledgement_accepted_at ?? null, id);
        assert.equal(actual.student_number, expected.student_number);
        assert.equal(actual.id, id);
        if (actual.reference_number) {
            const byReference = await repositories.applications.findByReferenceNumber(actual.reference_number);
            assert.equal(byReference?.id, id);
            assert.equal(Number(byReference.contact_acknowledgement_accepted_current), Number(expected.contact_acknowledgement_accepted_current));
        }
    }
    assert.equal(await repositories.applications.findById('missing'), null);
});

function addPendingFile(database, applicationId, code, suffix) {
    const requirement = database.prepare('SELECT id FROM document_requirements WHERE code = ? AND application_type = ?').bind(code, 'initial').first();
    assert.ok(requirement, 'missing requirement ' + code);
    database.prepare('INSERT INTO document_records (id, application_id, requirement_id, application_type) VALUES (?, ?, ?, ?)')
        .bind('record-' + suffix, applicationId, requirement.id, 'initial').run();
    database.prepare("INSERT INTO document_revisions (id, document_record_id, revision_number, status, is_current, submitted_by_type) VALUES (?, ?, 1, 'submitted', 1, 'student')")
        .bind('revision-' + suffix, 'record-' + suffix).run();
    database.prepare("INSERT INTO document_revision_files (id, revision_id, page_order, storage_key, original_filename, media_type, byte_size, upload_status, scan_status) VALUES (?, ?, 0, ?, 'x.pdf', 'application/pdf', 1024, 'finalized', 'pending')")
        .bind('file-' + suffix, 'revision-' + suffix, 'quarantine/' + suffix).run();
    return 'file-' + suffix;
}

test('reconcile only fails pending files whose scan job failed, and its new UPDATE is driven by the failed jobs', async () => {
    const { database, repositories } = setup();
    await createDraft(repositories, 'app-reconcile');
    const now = '2026-11-10T10:00:00.000Z';
    const files = {
        failedJob: addPendingFile(database, 'app-reconcile', 'passport', 'a'),
        staleJob: addPendingFile(database, 'app-reconcile', 'health_insurance', 'b'),
        queuedJob: addPendingFile(database, 'app-reconcile', 'student_certificate', 'c')
    };
    const insertJob = (file, status) => database.prepare(`INSERT INTO document_scan_jobs (id,file_id,revision_id,storage_key,byte_size,media_type,status,available_at,created_at,updated_at)
        VALUES (?,?,?,?,1024,'application/pdf',?,?,?,?)`).bind('job-' + file, file, file.replace('file-', 'revision-'), 'quarantine/' + file, status, now, now, now).run();
    insertJob(files.failedJob, 'failed'); insertJob(files.staleJob, 'stale'); insertJob(files.queuedJob, 'queued');

    const oldIds = database.prepare("SELECT id FROM document_revision_files WHERE scan_status='pending' AND id IN (SELECT file_id FROM document_scan_jobs WHERE status='failed') ORDER BY id").all().results.map((r) => r.id);
    const newIds = database.prepare("SELECT id FROM document_revision_files WHERE id IN (SELECT file_id FROM document_scan_jobs WHERE status='failed') AND +scan_status='pending' ORDER BY id").all().results.map((r) => r.id);
    assert.deepEqual(newIds, oldIds);
    assert.deepEqual(newIds, [files.failedJob]);
    const plan = database.prepare("EXPLAIN QUERY PLAN SELECT id FROM document_revision_files WHERE id IN (SELECT file_id FROM document_scan_jobs WHERE status='failed') AND +scan_status='pending'")
        .all().results.map((row) => row.detail).join('\n');
    assert.doesNotMatch(plan, /idx_revision_files_scan_pending \(scan_status=\?\)/);

    await createScannerRepository(database).reconcile(now);
    const state = (file) => database.prepare('SELECT scan_status FROM document_revision_files WHERE id = ?').bind(file).first().scan_status;
    assert.equal(state(files.failedJob), 'failed');
    assert.equal(state(files.staleJob), 'pending');
    assert.equal(state(files.queuedJob), 'pending');
});

test('physical intake list keeps order, paging, filters and per-row receipt columns after paging ids first', async () => {
    const { database } = setup();
    database.prepare("INSERT INTO staff_users (id, username, normalized_username, password_hash, display_name, role) VALUES ('s1','staff-one','staff-one','h','Staff One','reviewer')").run();
    for (let index = 0; index < 7; index += 1) {
        const at = `2026-11-0${index + 1}T10:00:00.000Z`;
        database.prepare(`INSERT INTO physical_intakes (id, student_number, first_name, last_name, passport_number, application_type, status, submitted_at, updated_at, created_by_staff_id)
            VALUES (?, ?, 'Ada', 'Lovelace', ?, 'initial', 'under_review', ?, ?, 's1')`).bind('i' + index, 'S-i' + index, 'P-i' + index, at, at).run();
    }
    // The shared test binding's batch() only reports write metadata, so run the batched reads one by one.
    const readableBatch = {
        prepare: (text) => { captured.push(text); return database.prepare(text); },
        batch: async (statements) => Promise.all(statements.map((statement) => statement.all()))
    };
    const captured = [];
    const repository = createPhysicalIntakeRepository(readableBatch);
    const list = (extra) => repository.list({ statuses: null, q: '', isDeleted: false, fromDate: null, toDate: null, page: 1, pageSize: 3, ...extra });
    const first = await list({ page: 1 });
    assert.deepEqual(first.items.map((row) => row.id), ['i6', 'i5', 'i4']);
    assert.equal(first.pagination.total, 7);
    assert.deepEqual((await list({ page: 2 })).items.map((row) => row.id), ['i3', 'i2', 'i1']);
    assert.deepEqual((await list({ page: 3 })).items.map((row) => row.id), ['i0']);
    for (const row of first.items) assert.ok('receipt_state' in row && 'receipt_print_status' in row);
    // Equivalence with the previous single-select page query, executed on the same rows.
    const pageSql = captured.find((text) => text.includes('LIMIT ? OFFSET ?') && !text.includes('count('));
    const previous = pageSql.replace(/WHERE id IN \(\s*SELECT id FROM physical_intakes WHERE ([\s\S]*?)\s+ORDER BY updated_at DESC,submitted_at DESC,id DESC LIMIT \? OFFSET \?\)\s+ORDER BY[^]*$/,
        'WHERE $1 ORDER BY updated_at DESC,submitted_at DESC,id DESC LIMIT ? OFFSET ?');
    assert.notEqual(previous, pageSql);
    for (const [limit, offset] of [[3, 0], [3, 3], [5, 5]]) {
        const oldRows = database.prepare(previous).bind(limit, offset).all().results.map((row) => JSON.stringify(row));
        const newRows = database.prepare(pageSql).bind(limit, offset).all().results.map((row) => JSON.stringify(row));
        assert.deepEqual(newRows, oldRows);
    }
    assert.deepEqual((await list({ q: 'S-i2' })).items.map((row) => row.id), ['i2']);
    assert.deepEqual((await list({ statuses: ['approved_for_processing'] })).items, []);
});

test('the acknowledgement lookup seeks the partial index instead of scanning all audit events of the application', () => {
    const { database } = setup();
    const plan = database.prepare(`EXPLAIN QUERY PLAN SELECT audit_events.created_at FROM audit_events
        WHERE audit_events.application_id = ? AND audit_events.event_type = 'application.contact_responsibility_accepted'
          AND json_extract(audit_events.safe_metadata_json, '$.version') = ? ORDER BY audit_events.created_at DESC LIMIT 1`)
        .bind('x', 'v').all().results.map((row) => row.detail).join('\n');
    assert.match(plan, /idx_audit_events_contact_acknowledgement/);
    const indexes = database.prepare("SELECT name FROM pragma_index_list('applications')").all().results.map((row) => row.name);
    assert.ok(indexes.includes('idx_applications_staff_order'));
    const partial = database.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_audit_events_contact_acknowledgement'").first().sql;
    assert.match(partial, /WHERE event_type = 'application\.contact_responsibility_accepted'/);
});

test('migration 0041 leaves the scanner claim plan on the pending index and no duplicate scan_status index remains', () => {
    const { database } = setup();
    const indexes = database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='document_revision_files'").all().results.map((r) => r.name);
    assert.equal(indexes.includes('idx_document_files_scan_status'), false);
    assert.ok(indexes.includes('idx_revision_files_scan_pending'));
    const plan = database.prepare("EXPLAIN QUERY PLAN SELECT id FROM document_revision_files WHERE scan_status='pending' AND upload_status='finalized' AND cleanup_status='none' AND revision_id=?")
        .bind('r').all().results.map((row) => row.detail).join('\n');
    assert.match(plan, /idx_revision_files_scan_pending/);
});
