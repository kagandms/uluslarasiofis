import { ApiError } from '../domain/errors.js';

const PRINT_JOB_DELETE_CHUNK_SIZE = 50;

async function hashIntakeId(intakeId) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(intakeId));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createRetryError(message) {
    return new ApiError(503, 'PHYSICAL_PURGE_RETRY_REQUIRED', message, true);
}

async function readPurgeTargets(database, intakeId) {
    const [filesResult, receiptsResult, printJobsResult] = await Promise.all([
        database.prepare(`
            SELECT storage_key FROM physical_intake_files
            WHERE intake_id = ? AND storage_key IS NOT NULL
            ORDER BY id
        `).bind(intakeId).all(),
        database.prepare(`
            SELECT artefact_key FROM physical_intake_receipts
            WHERE intake_id = ? AND artefact_key IS NOT NULL
            ORDER BY id
        `).bind(intakeId).all(),
        database.prepare(`
            SELECT print_jobs.id, print_jobs.storage_key
            FROM print_jobs
            JOIN physical_receipt_print_attempts AS attempts ON attempts.job_id = print_jobs.id
            WHERE attempts.intake_id = ?
            ORDER BY print_jobs.id
        `).bind(intakeId).all()
    ]);

    const documentKeys = [...new Set([
        ...(filesResult.results ?? []).map((row) => row.storage_key),
        ...(receiptsResult.results ?? []).map((row) => row.artefact_key)
    ].filter((key) => typeof key === 'string' && key.length > 0))];

    const printJobRows = printJobsResult.results ?? [];
    const printJobIds = [...new Set(printJobRows.map((row) => row.id).filter(Boolean))];
    const printStorageKeys = [...new Set(
        printJobRows.map((row) => row.storage_key).filter((key) => typeof key === 'string' && key.length > 0)
    )];

    return { documentKeys, printJobIds, printStorageKeys };
}

async function deleteBucketKeys(bucket, keys, bucketLabel) {
    if (keys.length === 0) return;
    if (!bucket || typeof bucket.delete !== 'function') {
        throw createRetryError('Fiziksel teslim dosyaları silinemedi. Lütfen tekrar deneyin.');
    }
    for (const key of keys) {
        try {
            await bucket.delete(key);
        } catch (error) {
            console.error(`Physical intake R2 deletion failed (${bucketLabel}).`, {
                errorName: error?.name || 'UnknownError'
            });
            throw createRetryError('Fiziksel teslim dosyalarının tamamı silinemedi. Lütfen tekrar deneyin.');
        }
    }
}

function buildPurgeStatements(database, {
    intakeId,
    expectedVersion,
    printJobIds,
    actorStaffId,
    requestId,
    intakeIdSha256,
    now
}) {
    const existsGuard = 'EXISTS (SELECT 1 FROM physical_intakes WHERE id = ? AND (? IS NULL OR lock_version = ?))';
    const guardBindings = [intakeId, expectedVersion, expectedVersion];

    // PRAGMA defer_foreign_keys defers the physical_intakes.current_pdf_id <-> physical_intake_files.intake_id
    // circular foreign key until COMMIT without issuing an UPDATE on physical_intakes (which would trip the
    // physical_closed_metadata trigger on closed/completed intakes). physical_reference_reservations rows are
    // intentionally preserved as tombstones so consumed tracking references can never be reused.
    const statements = [
        database.prepare('PRAGMA defer_foreign_keys = ON'),
        database.prepare(`
            DELETE FROM audit_events
            WHERE json_valid(safe_metadata_json)
              AND (
                  json_extract(safe_metadata_json, '$.physicalIntakeId') = ?
                  OR json_extract(safe_metadata_json, '$.intakeId') = ?
                  OR json_extract(safe_metadata_json, '$.physical_intake_id') = ?
                  OR json_extract(safe_metadata_json, '$.intake_id') = ?
                  OR json_extract(safe_metadata_json, '$.receiptId') IN (
                      SELECT id FROM physical_intake_receipts WHERE intake_id = ?
                  )
                  OR json_extract(safe_metadata_json, '$.fileId') IN (
                      SELECT id FROM physical_intake_files WHERE intake_id = ?
                  )
              )
              AND ${existsGuard}
        `).bind(intakeId, intakeId, intakeId, intakeId, intakeId, intakeId, ...guardBindings),
        database.prepare(`
            DELETE FROM physical_document_scan_jobs
            WHERE (
                file_id IN (SELECT id FROM physical_intake_files WHERE intake_id = ?)
                OR revision_id IN (SELECT id FROM physical_intake_files WHERE intake_id = ?)
            )
              AND ${existsGuard}
        `).bind(intakeId, intakeId, ...guardBindings),
        database.prepare(`
            DELETE FROM physical_receipt_print_attempts
            WHERE intake_id = ? AND ${existsGuard}
        `).bind(intakeId, ...guardBindings)
    ];

    // Delete linked print_jobs after physical_receipt_print_attempts so BEFORE DELETE ON print_jobs
    // updates zero attempt rows and cannot violate physical_receipt_one_live_attempt.
    for (let offset = 0; offset < printJobIds.length; offset += PRINT_JOB_DELETE_CHUNK_SIZE) {
        const chunk = printJobIds.slice(offset, offset + PRINT_JOB_DELETE_CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(',');
        statements.push(
            database.prepare(`
                DELETE FROM print_jobs
                WHERE id IN (${placeholders}) AND ${existsGuard}
            `).bind(...chunk, ...guardBindings)
        );
    }

    statements.push(
        database.prepare(`
            DELETE FROM physical_intake_receipts
            WHERE intake_id = ? AND ${existsGuard}
        `).bind(intakeId, ...guardBindings),
        database.prepare(`
            DELETE FROM physical_intake_files
            WHERE intake_id = ? AND ${existsGuard}
        `).bind(intakeId, ...guardBindings),
        database.prepare(`
            DELETE FROM staff_record_notes
            WHERE record_kind = 'physical' AND record_id = ? AND ${existsGuard}
        `).bind(intakeId, ...guardBindings),
        database.prepare(`
            DELETE FROM migration_office_states
            WHERE record_kind = 'physical' AND record_id = ? AND ${existsGuard}
        `).bind(intakeId, ...guardBindings)
    );

    const deleteIntakeIndex = statements.length;
    statements.push(
        database.prepare(`
            DELETE FROM physical_intakes
            WHERE id = ? AND (? IS NULL OR lock_version = ?)
        `).bind(intakeId, expectedVersion, expectedVersion),
        database.prepare(`
            INSERT INTO audit_events (
                id, event_type, actor_type, actor_staff_id, request_id, safe_metadata_json, created_at
            )
            SELECT ?, 'physical_intake.permanently_purged',
                   CASE WHEN ? IS NOT NULL AND EXISTS (SELECT 1 FROM staff_users WHERE id = ?) THEN 'staff' ELSE 'system' END,
                   CASE WHEN ? IS NOT NULL AND EXISTS (SELECT 1 FROM staff_users WHERE id = ?) THEN ? ELSE NULL END,
                   ?, ?, ?
            WHERE changes() = 1
        `).bind(
            crypto.randomUUID(),
            actorStaffId, actorStaffId,
            actorStaffId, actorStaffId, actorStaffId,
            requestId,
            JSON.stringify({ intake_id_sha256: intakeIdSha256 }),
            now
        )
    );

    return { statements, deleteIntakeIndex };
}

/**
 * Permanently purges one physical intake, all of its R2 objects (PDF revisions, receipt PDFs,
 * and linked print files), and all dependent D1 rows in a single retry-safe operation.
 * Linked online applications (linked_application_id) are never modified or deleted.
 *
 * @param {object} options Purge parameters.
 * @param {object} options.environment Worker bindings containing DB, DOCUMENTS, and optional PRINT_FILES.
 * @param {string} options.intakeId Physical intake UUID.
 * @param {object|null} [options.staff] Acting staff identity, or null for system cleanup.
 * @param {string|null} [options.requestId] Correlation ID recorded on the anonymized audit event.
 * @param {number|null} [options.expectedLockVersion] Optional optimistic lock version; null skips the check.
 * @returns {Promise<{purged: true}>} Confirmed permanent purge.
 * @throws {ApiError} 404 when missing, 409 on lock_version mismatch, 503 when R2 or D1 requires retry.
 */
export async function purgePhysicalIntakeById({
    environment,
    intakeId,
    staff = null,
    requestId = null,
    expectedLockVersion = null
}) {
    const database = environment?.DB;
    const documents = environment?.DOCUMENTS;
    if (!database || !documents) {
        throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Fiziksel teslim hizmeti kullanılamıyor.', true);
    }

    const intake = await database.prepare(
        'SELECT id, lock_version FROM physical_intakes WHERE id = ?'
    ).bind(intakeId).first();
    if (!intake) {
        throw new ApiError(404, 'PHYSICAL_NOT_FOUND', 'Fiziksel teslim kaydı bulunamadı.');
    }

    const expectedVersion = expectedLockVersion ?? null;
    if (expectedVersion !== null && intake.lock_version !== expectedVersion) {
        throw new ApiError(409, 'PHYSICAL_UPDATE_CONFLICT', 'Kayıt değişti. Yenileyip tekrar deneyin.');
    }

    // Delete R2 objects first (idempotent): if any object deletion fails, D1 stays intact and
    // retrying the exact same call re-reads the keys and completes cleanly.
    const { documentKeys, printJobIds, printStorageKeys } = await readPurgeTargets(database, intakeId);
    await deleteBucketKeys(documents, documentKeys, 'DOCUMENTS');
    await deleteBucketKeys(environment.PRINT_FILES, printStorageKeys, 'PRINT_FILES');

    const intakeIdSha256 = await hashIntakeId(intakeId);
    const now = new Date().toISOString();
    const safeRequestId = typeof requestId === 'string' && requestId.trim()
        ? requestId.trim()
        : `physical-purge-${crypto.randomUUID()}`;
    const actorStaffId = typeof staff?.id === 'string' && staff.id.trim() ? staff.id.trim() : null;

    const { statements, deleteIntakeIndex } = buildPurgeStatements(database, {
        intakeId,
        expectedVersion,
        printJobIds,
        actorStaffId,
        requestId: safeRequestId,
        intakeIdSha256,
        now
    });

    let results;
    try {
        results = await database.batch(statements);
    } catch (error) {
        console.error('Physical intake database purge failed.', { errorName: error?.name || 'UnknownError' });
        throw createRetryError('Fiziksel teslim verileri tamamen silinemedi. Lütfen tekrar deneyin.');
    }

    if (results[deleteIntakeIndex]?.meta?.changes !== 1) {
        if (expectedVersion !== null) {
            throw new ApiError(409, 'PHYSICAL_UPDATE_CONFLICT', 'Kayıt değişti. Yenileyip tekrar deneyin.');
        }
        throw new ApiError(404, 'PHYSICAL_NOT_FOUND', 'Fiziksel teslim kaydı bulunamadı.');
    }
    if (results[deleteIntakeIndex + 1]?.meta?.changes !== 1) {
        throw createRetryError('Fiziksel teslim silme denetimi tamamlanamadı. Lütfen tekrar deneyin.');
    }

    return { purged: true };
}
