import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { createPortFixture, portRequest, registerPortPdf } from './physical-port-fixtures.js';
import { purgePhysicalIntakeById } from '../src/server/services/physicalIntakePurge.js';

const BASE = '/api/staff/physical-intakes';
const METADATA = {
    first_name: 'Synthetic',
    last_name: 'Student',
    passport_number: 'PURGE-TEST-01',
    application_type: 'initial',
    application_date: '2026-10-12',
    student_number: '202600001'
};

function createMemoryBucket() {
    const objects = new Map();
    const objectFor = (key) => {
        const entry = objects.get(key);
        if (!entry) return null;
        return {
            key,
            etag: createHash('sha256').update(entry.bytes).digest('hex'),
            size: entry.bytes.length,
            httpMetadata: entry.options?.httpMetadata,
            body: new Response(entry.bytes).body,
            arrayBuffer: async () => entry.bytes.slice().buffer
        };
    };
    const bucket = {
        async put(key, bytes, options = {}) {
            if (options?.onlyIf?.etagDoesNotMatch === '*' && objects.has(key)) return null;
            objects.set(key, { bytes: new Uint8Array(bytes), options });
            return objectFor(key);
        },
        async head(key) {
            return objectFor(key);
        },
        async get(key, options) {
            const object = objectFor(key);
            if (options?.onlyIf?.etagMatches && options.onlyIf.etagMatches !== object?.etag) return null;
            return object;
        },
        async delete(keys) {
            for (const key of Array.isArray(keys) ? keys : [keys]) {
                objects.delete(key);
            }
        },
        async list(options = {}) {
            const prefix = options.prefix || '';
            const matching = [...objects.keys()]
                .filter((key) => key.startsWith(prefix))
                .sort()
                .map((key) => ({ key, size: objects.get(key).bytes.length }));
            return { objects: matching, truncated: false };
        }
    };
    return { bucket, objects };
}

async function createPurgeFixture({ role = 'admin' } = {}) {
    const context = await createPortFixture();
    const documents = createMemoryBucket();
    const printFiles = createMemoryBucket();
    context.storage = documents.bucket;
    context.objects = documents.objects;
    context.printStorage = printFiles.bucket;
    context.printObjects = printFiles.objects;
    Object.assign(context.environment, {
        DOCUMENTS: documents.bucket,
        PRINT_FILES: printFiles.bucket,
        PRINT_ENABLED: 'true',
        PHYSICAL_RECEIPTS_CREATE_ENABLED: 'true',
        PUBLIC_PORTAL_ORIGIN: 'https://portal.test',
        PUBLIC_PORTAL_ORIGIN_ALLOWLIST: 'https://portal.test'
    });
    await context.database.prepare('UPDATE staff_users SET role = ? WHERE id = ?').bind(role, 'staff').run();
    await context.database.prepare(`
        INSERT INTO printer_heartbeats (printer_id, runner_id, health, printer_name, seen_at, settings_protocol)
        VALUES ('synthetic', 'agent', 'ready', 'Synthetic', ?, 3)
    `).bind(new Date().toISOString()).run();
    return context;
}

async function a4PdfBytes(marker = 0) {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]);
    page.drawText(`Synthetic ${marker}`, { x: 24, y: 780, size: 12 });
    return pdf.save();
}

async function registerMetadataIntake(context, metadataOverrides = {}) {
    const reservationResponse = await portRequest(context, `${BASE}/reference-reservations`, {
        method: 'POST',
        cookie: context.staffCookie,
        json: {
            draft_id: crypto.randomUUID(),
            application_date: metadataOverrides.application_date || METADATA.application_date,
            application_type: metadataOverrides.application_type || METADATA.application_type
        }
    });
    assert.equal(reservationResponse.status, 200, await reservationResponse.clone().text());
    const reservation = await reservationResponse.json();
    const registrationId = crypto.randomUUID();
    const registrationResponse = await portRequest(context, `${BASE}/registrations`, {
        method: 'POST',
        cookie: context.staffCookie,
        json: {
            registration_id: registrationId,
            reservation_id: reservation.id,
            ...METADATA,
            ...metadataOverrides
        }
    });
    assert.equal(registrationResponse.status, 200, await registrationResponse.clone().text());
    return { ...(await registrationResponse.json()), reservation };
}

function sha256Hex(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

function deleteRequest(context, intakeId, body, options = {}) {
    return portRequest(context, `${BASE}/${intakeId}`, {
        method: 'DELETE',
        cookie: options.cookie ?? context.staffCookie,
        json: body,
        headers: options.headers
    });
}

test('full permanent purge removes every mapped DB row and R2 object, leaves only the anonymized audit event, and preserves linked online application and unrelated records', async () => {
    const context = await createPurgeFixture({ role: 'admin' });
    const database = context.database;

    // Seed a linked online application with its own student, note, and audit row.
    const onlineStudentId = 'student-linked-online';
    const onlineAppId = 'app-linked-online';
    await database.prepare(`
        INSERT INTO students (id, student_number, normalized_student_number)
        VALUES (?, '202600001', '202600001')
    `).bind(onlineStudentId).run();
    await database.prepare(`
        INSERT INTO applications (id, student_id, application_type, status, first_name, last_name)
        VALUES (?, ?, 'initial', 'under_review', 'Online', 'Kept')
    `).bind(onlineAppId, onlineStudentId).run();
    await database.prepare(`
        INSERT INTO staff_record_notes (
            record_kind, record_id, body, created_by_staff_id, created_at, updated_by_staff_id, updated_at
        ) VALUES ('online', ?, 'Online note stays', 'staff', '2026-10-12T08:00:00.000Z', 'staff', '2026-10-12T08:00:00.000Z')
    `).bind(onlineAppId).run();
    await database.prepare(`
        INSERT INTO audit_events (id, event_type, actor_type, actor_staff_id, application_id, request_id, safe_metadata_json, created_at)
        VALUES ('online-audit-1', 'application.submitted', 'student', NULL, ?, 'req-online-1', '{}', '2026-10-12T08:00:00.000Z')
    `).bind(onlineAppId).run();

    // Seed an unrelated physical intake that must survive untouched.
    const kept = await registerPortPdf(context, crypto.randomUUID(), {
        receipt: { student_number: '202699999', first_name: 'Other', last_name: 'Kept', passport_number: 'KEPT-999' }
    });
    const keptFileKey = (await database.prepare('SELECT storage_key FROM physical_intake_files WHERE intake_id = ?')
        .bind(kept.id).first()).storage_key;
    await database.prepare(`
        INSERT INTO staff_record_notes (
            record_kind, record_id, body, created_by_staff_id, created_at, updated_by_staff_id, updated_at
        ) VALUES ('physical', ?, 'Kept physical note', 'staff', '2026-10-12T08:00:00.000Z', 'staff', '2026-10-12T08:00:00.000Z')
    `).bind(kept.id).run();

    // Create target physical intake with reservation, receipt, print attempt + print job, download lease,
    // 2 PDF revisions, scan job, linked online application, staff record note, and multiple audit events.
    const registration = await registerMetadataIntake(context);
    const intakeId = registration.intake.id;
    const receiptId = registration.receipts[0].id;
    const trackingReference = registration.intake.tracking_reference;

    await database.prepare('UPDATE physical_intakes SET linked_application_id = ? WHERE id = ?')
        .bind(onlineAppId, intakeId).run();

    const receiptUpload = await portRequest(context, `${BASE}/${intakeId}/receipts/${receiptId}/content`, {
        method: 'PUT',
        cookie: context.staffCookie,
        headers: { 'Content-Type': 'application/pdf' },
        body: await a4PdfBytes(1)
    });
    assert.equal(receiptUpload.status, 200, await receiptUpload.clone().text());

    const downloadLease = await portRequest(context, `${BASE}/${intakeId}/receipts/${receiptId}?download=1`, {
        cookie: context.staffCookie
    });
    assert.equal(downloadLease.status, 200);

    const printResponse = await portRequest(context, `${BASE}/${intakeId}/receipts/${receiptId}/print`, {
        method: 'POST',
        cookie: context.staffCookie,
        json: { creation_id: crypto.randomUUID(), decision: 'print' }
    });
    assert.equal(printResponse.status, 200, await printResponse.clone().text());

    const file1Id = crypto.randomUUID();
    const pdf1Upload = await portRequest(context, `${BASE}/${intakeId}/pdf`, {
        method: 'POST',
        cookie: context.staffCookie,
        headers: { 'Content-Type': 'application/pdf', 'If-Match': '1', 'X-Pdf-Id': file1Id },
        body: await a4PdfBytes(2)
    });
    assert.equal(pdf1Upload.status, 200, await pdf1Upload.clone().text());

    const file2Id = crypto.randomUUID();
    const pdf2Upload = await portRequest(context, `${BASE}/${intakeId}/pdf`, {
        method: 'POST',
        cookie: context.staffCookie,
        headers: { 'Content-Type': 'application/pdf', 'If-Match': '2', 'X-Pdf-Id': file2Id },
        body: await a4PdfBytes(3)
    });
    assert.equal(pdf2Upload.status, 200, await pdf2Upload.clone().text());

    const statusUpdate = await portRequest(context, `${BASE}/${intakeId}/status`, {
        method: 'PATCH',
        cookie: context.staffCookie,
        json: { lock_version: 3, status: 'approved_for_processing' }
    });
    assert.equal(statusUpdate.status, 200, await statusUpdate.clone().text());

    const file1Row = await database.prepare('SELECT * FROM physical_intake_files WHERE id = ?').bind(file1Id).first();
    await database.prepare(`
        INSERT INTO physical_document_scan_jobs (
            id, file_id, revision_id, storage_key, byte_size, media_type, status, attempts, available_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'application/pdf', 'queued', 0, '2026-10-12T10:00:00.000Z', '2026-10-12T10:00:00.000Z', '2026-10-12T10:00:00.000Z')
    `).bind(crypto.randomUUID(), file1Row.id, file1Row.id, file1Row.storage_key, file1Row.byte_size).run();

    const noteResponse = await portRequest(context, `/api/staff/record-notes/physical/${intakeId}`, {
        method: 'PUT',
        cookie: context.staffCookie,
        json: { body: 'Fiziksel teslim için gizli personel notu' }
    });
    assert.equal(noteResponse.status, 200, await noteResponse.clone().text());

    // Verify all mapped rows and R2 objects exist before purge.
    const targetDocKeysBefore = [
        ...(await database.prepare('SELECT storage_key FROM physical_intake_files WHERE intake_id = ?').bind(intakeId).all()).results.map((row) => row.storage_key),
        ...(await database.prepare('SELECT artefact_key FROM physical_intake_receipts WHERE intake_id = ?').bind(intakeId).all()).results.map((row) => row.artefact_key)
    ];
    const targetPrintJob = await database.prepare(`
        SELECT print_jobs.id, print_jobs.storage_key
        FROM print_jobs
        JOIN physical_receipt_print_attempts AS attempts ON attempts.job_id = print_jobs.id
        WHERE attempts.intake_id = ?
    `).bind(intakeId).first();
    assert.equal(targetDocKeysBefore.length, 3);
    assert.ok(targetPrintJob?.storage_key);
    assert.equal((await context.environment.DOCUMENTS.list()).objects.length, 4); // 3 target + 1 kept
    assert.equal((await context.environment.PRINT_FILES.list()).objects.length, 1);

    const currentIntake = await database.prepare('SELECT lock_version FROM physical_intakes WHERE id = ?').bind(intakeId).first();
    const deleteResponse = await deleteRequest(context, intakeId, {
        lock_version: currentIntake.lock_version,
        confirmed: true
    });
    assert.equal(deleteResponse.status, 200, await deleteResponse.clone().text());
    const deletePayload = await deleteResponse.json();
    assert.equal(deletePayload.purged, true);

    // Table-by-table assertions: zero rows remain for the purged intake.
    assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM physical_intakes WHERE id = ?').bind(intakeId).first()).count, 0);
    assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM physical_intake_files WHERE intake_id = ?').bind(intakeId).first()).count, 0);
    assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM physical_document_scan_jobs').first()).count, 0);
    assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM physical_intake_receipts WHERE intake_id = ?').bind(intakeId).first()).count, 0);
    assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM physical_receipt_print_attempts WHERE intake_id = ?').bind(intakeId).first()).count, 0);
    assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM print_jobs WHERE id = ?').bind(targetPrintJob.id).first()).count, 0);
    assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM staff_record_notes WHERE record_kind = 'physical' AND record_id = ?").bind(intakeId).first()).count, 0);

    // Bucket listings: every target R2 object is gone, while unrelated intake's object remains.
    const remainingDocKeys = (await context.environment.DOCUMENTS.list()).objects.map((object) => object.key);
    assert.deepEqual(remainingDocKeys, [keptFileKey]);
    const remainingPrintKeys = (await context.environment.PRINT_FILES.list()).objects.map((object) => object.key);
    assert.deepEqual(remainingPrintKeys, []);

    // Audit assertions: no prior audit rows reference the purged intake, and exactly one anonymized purge event exists.
    const allAudits = (await database.prepare('SELECT * FROM audit_events').all()).results;
    const referencingAudits = allAudits.filter((row) =>
        row.safe_metadata_json.includes(intakeId)
        || row.safe_metadata_json.includes(receiptId)
        || row.safe_metadata_json.includes(file1Id)
        || row.safe_metadata_json.includes(file2Id)
    );
    assert.deepEqual(referencingAudits, []);

    const purgeAudits = allAudits.filter((row) => row.event_type === 'physical_intake.permanently_purged');
    assert.equal(purgeAudits.length, 1);
    const purgeAudit = purgeAudits[0];
    assert.equal(purgeAudit.actor_type, 'staff');
    assert.equal(purgeAudit.actor_staff_id, 'staff');
    assert.equal(purgeAudit.application_id, null);
    assert.equal(purgeAudit.document_record_id, null);
    assert.deepEqual(JSON.parse(purgeAudit.safe_metadata_json), {
        intake_id_sha256: sha256Hex(intakeId)
    });
    for (const forbidden of [intakeId, METADATA.first_name, METADATA.last_name, METADATA.student_number, METADATA.passport_number, trackingReference]) {
        assert.equal(purgeAudit.safe_metadata_json.includes(forbidden), false, `audit must not include ${forbidden}`);
    }

    // Linked online application and its data remain completely untouched.
    const linkedApplication = await database.prepare('SELECT id, status, first_name, last_name FROM applications WHERE id = ?').bind(onlineAppId).first();
    assert.deepEqual({ ...linkedApplication }, {
        id: onlineAppId,
        status: 'under_review',
        first_name: 'Online',
        last_name: 'Kept'
    });
    assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM staff_record_notes WHERE record_kind = 'online' AND record_id = ?").bind(onlineAppId).first()).count, 1);
    assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE application_id = ?').bind(onlineAppId).first()).count, 1);

    // Reservation tombstone remains intact so the tracking reference can never be reused.
    const tombstone = await database.prepare('SELECT consumed_intake_id, tracking_reference FROM physical_reference_reservations WHERE id = ?')
        .bind(registration.reservation.id).first();
    assert.equal(tombstone.consumed_intake_id, intakeId);
    assert.equal(tombstone.tracking_reference, trackingReference);

    // Unrelated physical intake and its note/audit remain untouched.
    assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM physical_intakes WHERE id = ?').bind(kept.id).first()).count, 1);
    assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM staff_record_notes WHERE record_kind = 'physical' AND record_id = ?").bind(kept.id).first()).count, 1);
    assert.equal(allAudits.some((row) => row.safe_metadata_json.includes(kept.id)), true);

    assert.deepEqual((await database.prepare('PRAGMA foreign_key_check').all()).results, []);
});

test('completed and processing-closed physical intake with current_pdf_id purges cleanly', async () => {
    const context = await createPurgeFixture({ role: 'admin' });
    const registration = await registerPortPdf(context);
    const intakeId = registration.id;

    const closeResponse = await portRequest(context, `${BASE}/${intakeId}/close`, {
        method: 'POST',
        cookie: context.staffCookie,
        json: { lock_version: 1, reason: 'Processed at office' }
    });
    assert.equal(closeResponse.status, 200, await closeResponse.clone().text());

    const response = await deleteRequest(context, intakeId, { lock_version: 2, confirmed: true });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).purged, true);
    assert.equal((await context.database.prepare('SELECT COUNT(*) AS count FROM physical_intakes WHERE id = ?').bind(intakeId).first()).count, 0);
    assert.equal((await context.database.prepare('SELECT COUNT(*) AS count FROM physical_intake_files WHERE intake_id = ?').bind(intakeId).first()).count, 0);
    assert.equal((await context.environment.DOCUMENTS.list()).objects.length, 0);
    assert.deepEqual((await context.database.prepare('PRAGMA foreign_key_check').all()).results, []);
});

test('wrong lock_version returns 409 without deleting DB rows or R2 objects', async () => {
    const context = await createPurgeFixture({ role: 'admin' });
    const registration = await registerPortPdf(context);

    const response = await deleteRequest(context, registration.id, { lock_version: 99, confirmed: true });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'PHYSICAL_UPDATE_CONFLICT');
    assert.equal((await context.database.prepare('SELECT COUNT(*) AS count FROM physical_intakes WHERE id = ?').bind(registration.id).first()).count, 1);
    assert.equal((await context.environment.DOCUMENTS.list()).objects.length, 1);
});

test('missing, false, non-boolean confirmed or extra body fields return 400 without deleting', async () => {
    const context = await createPurgeFixture({ role: 'admin' });
    const registration = await registerPortPdf(context);

    const invalidBodies = [
        {},
        { lock_version: 1 },
        { lock_version: 1, confirmed: false },
        { lock_version: 1, confirmed: 'true' },
        { lock_version: 1, confirmed: 1 },
        { lock_version: 1, confirmed: null },
        { confirmed: true },
        { lock_version: 0, confirmed: true },
        { lock_version: '1', confirmed: true },
        { lock_version: 1, confirmed: true, extra: true }
    ];

    for (const body of invalidBodies) {
        const response = await deleteRequest(context, registration.id, body);
        assert.equal(response.status, 400, JSON.stringify(body));
    }

    assert.equal((await context.database.prepare('SELECT COUNT(*) AS count FROM physical_intakes WHERE id = ?').bind(registration.id).first()).count, 1);
    assert.equal((await context.environment.DOCUMENTS.list()).objects.length, 1);
});

test('reviewer role and cross-origin requests are rejected with 403 without deleting', async () => {
    const context = await createPurgeFixture({ role: 'reviewer' });
    const registration = await registerPortPdf(context);

    const reviewerDelete = await deleteRequest(context, registration.id, { lock_version: 1, confirmed: true });
    assert.equal(reviewerDelete.status, 403);
    assert.equal((await reviewerDelete.json()).error.code, 'FORBIDDEN');

    await context.database.prepare("UPDATE staff_users SET role = 'admin' WHERE id = 'staff'").run();
    const crossOriginDelete = await deleteRequest(context, registration.id, { lock_version: 1, confirmed: true }, {
        headers: { Origin: 'https://attacker.test' }
    });
    assert.equal(crossOriginDelete.status, 403);
    assert.equal((await crossOriginDelete.json()).error.code, 'CROSS_ORIGIN_REQUEST');

    assert.equal((await context.database.prepare('SELECT COUNT(*) AS count FROM physical_intakes WHERE id = ?').bind(registration.id).first()).count, 1);
    assert.equal((await context.environment.DOCUMENTS.list()).objects.length, 1);
});

test('R2 failure returns retryable 503 without half-deleting DB rows, and retrying succeeds cleanly', async () => {
    const context = await createPurgeFixture({ role: 'admin' });
    const registration = await registerPortPdf(context);
    const secondFileId = crypto.randomUUID();
    const secondUpload = await portRequest(context, `${BASE}/${registration.id}/pdf`, {
        method: 'POST',
        cookie: context.staffCookie,
        headers: { 'Content-Type': 'application/pdf', 'If-Match': '1', 'X-Pdf-Id': secondFileId },
        body: await a4PdfBytes(9)
    });
    assert.equal(secondUpload.status, 200);

    const originalDelete = context.environment.DOCUMENTS.delete.bind(context.environment.DOCUMENTS);
    let deleteAttempts = 0;
    context.environment.DOCUMENTS.delete = async (key) => {
        deleteAttempts += 1;
        if (deleteAttempts === 2) throw new Error('synthetic transient R2 delete failure');
        return originalDelete(key);
    };

    const failed = await deleteRequest(context, registration.id, { lock_version: 2, confirmed: true });
    assert.equal(failed.status, 503);
    const failedPayload = await failed.json();
    assert.equal(failedPayload.error.code, 'PHYSICAL_PURGE_RETRY_REQUIRED');
    assert.equal(failedPayload.error.retryable, true);
    assert.equal((await context.database.prepare('SELECT COUNT(*) AS count FROM physical_intakes WHERE id = ?').bind(registration.id).first()).count, 1);
    assert.equal((await context.database.prepare('SELECT COUNT(*) AS count FROM physical_intake_files WHERE intake_id = ?').bind(registration.id).first()).count, 2);
    assert.equal((await context.database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'physical_intake.permanently_purged'").first()).count, 0);

    context.environment.DOCUMENTS.delete = originalDelete;
    const retried = await deleteRequest(context, registration.id, { lock_version: 2, confirmed: true });
    assert.equal(retried.status, 200, await retried.clone().text());
    assert.equal((await retried.json()).purged, true);
    assert.equal((await context.database.prepare('SELECT COUNT(*) AS count FROM physical_intakes WHERE id = ?').bind(registration.id).first()).count, 0);
    assert.equal((await context.database.prepare('SELECT COUNT(*) AS count FROM physical_intake_files WHERE intake_id = ?').bind(registration.id).first()).count, 0);
    assert.equal((await context.environment.DOCUMENTS.list()).objects.length, 0);
    assert.equal((await context.database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'physical_intake.permanently_purged'").first()).count, 1);
});

test('D1 batch failure returns retryable 503 and retrying the same delete succeeds cleanly', async () => {
    const context = await createPurgeFixture({ role: 'admin' });
    const registration = await registerPortPdf(context);

    const originalBatch = context.database.batch.bind(context.database);
    let shouldFailBatch = true;
    context.database.batch = async (statements) => {
        if (shouldFailBatch) {
            shouldFailBatch = false;
            throw new Error('synthetic transient D1 batch failure');
        }
        return originalBatch(statements);
    };

    const failed = await deleteRequest(context, registration.id, { lock_version: 1, confirmed: true });
    assert.equal(failed.status, 503);
    const failedPayload = await failed.json();
    assert.equal(failedPayload.error.code, 'PHYSICAL_PURGE_RETRY_REQUIRED');
    assert.equal(failedPayload.error.retryable, true);
    assert.equal((await context.database.prepare('SELECT COUNT(*) AS count FROM physical_intakes WHERE id = ?').bind(registration.id).first()).count, 1);

    const retried = await deleteRequest(context, registration.id, { lock_version: 1, confirmed: true });
    assert.equal(retried.status, 200, await retried.clone().text());
    assert.equal((await retried.json()).purged, true);
    assert.equal((await context.database.prepare('SELECT COUNT(*) AS count FROM physical_intakes WHERE id = ?').bind(registration.id).first()).count, 0);
    assert.equal((await context.environment.DOCUMENTS.list()).objects.length, 0);
});

test('unknown intake id returns 404', async () => {
    const context = await createPurgeFixture({ role: 'admin' });

    const missingUuid = await deleteRequest(context, crypto.randomUUID(), { lock_version: 1, confirmed: true });
    assert.equal(missingUuid.status, 404);
    assert.equal((await missingUuid.json()).error.code, 'PHYSICAL_NOT_FOUND');

    const invalidId = await deleteRequest(context, 'not-a-valid-uuid', { lock_version: 1, confirmed: true });
    assert.equal(invalidId.status, 404);
});

test('purging an old soft-deleted intake works via purgePhysicalIntakeById and HTTP DELETE, while deleted query filter is rejected and normal lists keep hiding old soft-deleted rows', async () => {
    const context = await createPurgeFixture({ role: 'admin' });
    const first = await registerPortPdf(context, crypto.randomUUID(), {
        receipt: { student_number: 'OLD-DEL-1', passport_number: 'OLD-DEL-1' }
    });
    const second = await registerPortPdf(context, crypto.randomUUID(), {
        receipt: { student_number: 'OLD-DEL-2', passport_number: 'OLD-DEL-2' }
    });
    const active = await registerPortPdf(context, crypto.randomUUID(), {
        receipt: { student_number: 'ACTIVE-1', passport_number: 'ACTIVE-1' }
    });

    const deletedAt = '2026-10-01T10:00:00.000Z';
    for (const id of [first.id, second.id]) {
        await context.database.prepare('UPDATE physical_intakes SET deleted_at = ?, lock_version = 4 WHERE id = ?')
            .bind(deletedAt, id).run();
        await context.database.prepare(`
            INSERT INTO audit_events (id, event_type, actor_type, actor_staff_id, request_id, safe_metadata_json, created_at)
            VALUES (?, 'physical_intake.delete', 'staff', 'staff', 'legacy-soft-delete', ?, ?)
        `).bind(crypto.randomUUID(), JSON.stringify({ physicalIntakeId: id }), deletedAt).run();
    }

    // Normal list keeps excluding old soft-deleted rows until cleanup runs.
    const normalList = await portRequest(context, `${BASE}/query`, {
        method: 'POST',
        cookie: context.staffCookie,
        json: { status: 'all', page: 1, page_size: 25 }
    });
    assert.equal(normalList.status, 200);
    assert.deepEqual((await normalList.json()).items.map((item) => item.id), [active.id]);

    // Removed 'deleted' listing filter is rejected.
    const deletedList = await portRequest(context, `${BASE}/query`, {
        method: 'POST',
        cookie: context.staffCookie,
        json: { status: 'deleted', page: 1, page_size: 25 }
    });
    assert.equal(deletedList.status, 400);

    // One-off cleanup caller invokes purgePhysicalIntakeById with expectedLockVersion = null and staff = null.
    const directPurge = await purgePhysicalIntakeById({
        environment: context.environment,
        intakeId: first.id,
        staff: null,
        requestId: 'cleanup-legacy-soft-deleted'
    });
    assert.deepEqual(directPurge, { purged: true });
    assert.equal((await context.database.prepare('SELECT COUNT(*) AS count FROM physical_intakes WHERE id = ?').bind(first.id).first()).count, 0);
    assert.equal((await context.database.prepare('SELECT COUNT(*) AS count FROM physical_intake_files WHERE intake_id = ?').bind(first.id).first()).count, 0);
    const cleanupAudit = await context.database.prepare("SELECT * FROM audit_events WHERE request_id = 'cleanup-legacy-soft-deleted'").first();
    assert.equal(cleanupAudit.event_type, 'physical_intake.permanently_purged');
    assert.equal(cleanupAudit.actor_type, 'system');
    assert.equal(cleanupAudit.actor_staff_id, null);
    assert.deepEqual(JSON.parse(cleanupAudit.safe_metadata_json), { intake_id_sha256: sha256Hex(first.id) });

    // HTTP DELETE also purges an old soft-deleted intake when lock_version matches.
    const httpPurge = await deleteRequest(context, second.id, { lock_version: 4, confirmed: true });
    assert.equal(httpPurge.status, 200, await httpPurge.clone().text());
    assert.equal((await httpPurge.json()).purged, true);
    assert.equal((await context.database.prepare('SELECT COUNT(*) AS count FROM physical_intakes WHERE id = ?').bind(second.id).first()).count, 0);

    // Active intake and its single PDF object remain untouched.
    assert.equal((await context.database.prepare('SELECT COUNT(*) AS count FROM physical_intakes WHERE id = ?').bind(active.id).first()).count, 1);
    assert.equal((await context.environment.DOCUMENTS.list()).objects.length, 1);
});

test('restore route is gone and returns 404', async () => {
    const context = await createPurgeFixture({ role: 'admin' });
    const registration = await registerPortPdf(context);
    await context.database.prepare('UPDATE physical_intakes SET deleted_at = ? WHERE id = ?')
        .bind('2026-10-01T10:00:00.000Z', registration.id).run();

    const response = await portRequest(context, `${BASE}/${registration.id}/restore`, {
        method: 'POST',
        cookie: context.staffCookie,
        json: { lock_version: 1 }
    });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'NOT_FOUND');
});
