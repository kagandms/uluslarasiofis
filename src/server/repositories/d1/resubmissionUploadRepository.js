import { createScanJobStatement } from './scanner-job-statement.js';

function readModeGuard(mode) {
    if (mode === 'first_replacement') {
        return `records.review_status = 'resubmission_required'
            AND current_revision.status = 'resubmission_required'
            AND current_file.scan_status IN ('clean', 'unsafe', 'failed')`;
    }
    if (mode === 'unsafe_scan_retry') {
        return `records.review_status = 'pending'
            AND current_revision.status = 'submitted'
            AND current_file.scan_status IN ('unsafe', 'failed')
            AND current_intent.status = 'completed'`;
    }
    throw new TypeError('Unsupported resubmission replacement mode.');
}

function bindModeFacts(input) {
    return [input.applicationType, input.isUnder18 ? 1 : 0, input.addressEvidenceType ?? null,
        input.requirementId, input.code,
        input.documentRecordId, input.expectedCurrentRevisionId];
}

function readEligibilitySql() {
    return `
        SELECT applications.id AS application_id, applications.status AS application_status,
               applications.application_type, applications.is_under_18,
               applications.address_evidence_type, requirements.id AS requirement_id,
               requirements.code, requirements.is_required,
               records.id AS document_record_id, records.review_status,
               current_revision.id AS current_revision_id, current_revision.revision_number,
               current_revision.status AS revision_status, current_revision.is_current,
               current_file.id AS file_id, current_file.original_filename,
               current_file.media_type, current_file.byte_size,
               current_file.upload_status, current_file.scan_status, current_file.cleanup_status,
               current_intent.status AS upload_intent_status,
               EXISTS (
                   SELECT 1 FROM application_notes
                   WHERE application_notes.application_id = applications.id
                     AND application_notes.document_record_id = records.id
                     AND application_notes.visibility = 'student'
               ) AS has_student_message_for_document,
               EXISTS (
                   SELECT 1 FROM document_revision_files AS cleanup_files
                   JOIN document_revisions AS cleanup_revisions ON cleanup_revisions.id = cleanup_files.revision_id
                   WHERE cleanup_revisions.document_record_id = records.id
                     AND cleanup_revisions.is_current = 0
                     AND cleanup_files.cleanup_status = 'pending'
               ) AS has_non_current_cleanup_pending
        FROM applications
        JOIN document_requirements AS requirements
          ON requirements.application_type = applications.application_type AND requirements.is_active = 1
        LEFT JOIN document_records AS records
          ON records.application_id = applications.id AND records.requirement_id = requirements.id
        LEFT JOIN document_revisions AS current_revision
          ON current_revision.document_record_id = records.id AND current_revision.is_current = 1
        LEFT JOIN document_revision_files AS current_file
          ON current_file.revision_id = current_revision.id AND current_file.page_order = 0
        LEFT JOIN upload_intents AS current_intent ON current_intent.revision_file_id = current_file.id
        WHERE applications.id = ? AND (? IS NULL OR requirements.code = ?)
        ORDER BY requirements.display_order, requirements.code
    `;
}

function readExactReplacementEligibilitySql(mode) {
    return `
        applications.status = 'resubmission_required'
        AND applications.application_type = ? AND COALESCE(applications.is_under_18, 0) IS ?
        AND applications.address_evidence_type IS ?
        AND requirements.id = ? AND requirements.code = ? AND requirements.is_active = 1
        AND records.id = ? AND records.application_id = applications.id
        AND current_revision.id = ? AND current_revision.document_record_id = records.id
        AND current_revision.is_current = 1
        AND current_file.revision_id = current_revision.id AND current_file.page_order = 0
        AND current_file.upload_status = 'finalized' AND current_file.cleanup_status <> 'pending'
        AND current_intent.status = 'completed'
        AND EXISTS (
            SELECT 1 FROM application_notes
            WHERE application_notes.application_id = applications.id
              AND application_notes.document_record_id = records.id
              AND application_notes.visibility = 'student'
        )
        AND ${readModeGuard(mode)}
    `;
}

function readRevisionMismatchError(error) {
    return /NOT NULL constraint failed: audit_events\.request_id/.test(error?.message || '');
}

function encodeIntentGuard(input) {
    // Existing schema has no expected-revision column; keep this compare-and-swap snapshot internal.
    return JSON.stringify([input.expectedCurrentRevisionId, input.mode, input.idempotencyKey]);
}

function readIntentGuard(value) {
    try {
        const [expectedCurrentRevisionId, mode] = JSON.parse(value);
        if (typeof expectedCurrentRevisionId === 'string'
            && ['first_replacement', 'unsafe_scan_retry'].includes(mode)) {
            return { expected_current_revision_id: expectedCurrentRevisionId, mode };
        }
    } catch {
        return null;
    }
    return null;
}

function readFinalizeStatements(database, input) {
    const modeGuard = readModeGuard(input.mode);
    return [
        database.prepare(`
            UPDATE document_revisions AS current_revision
            SET is_current = 0, status = 'superseded'
            WHERE current_revision.id = ? AND current_revision.document_record_id = ?
              AND current_revision.is_current = 1
              AND EXISTS (
                SELECT 1 FROM applications
                JOIN document_records AS records ON records.application_id = applications.id
                JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                JOIN document_revisions AS current_revision_check
                  ON current_revision_check.document_record_id = records.id AND current_revision_check.is_current = 1
                JOIN document_revision_files AS current_file
                  ON current_file.revision_id = current_revision_check.id AND current_file.page_order = 0
                JOIN upload_intents AS current_intent ON current_intent.revision_file_id = current_file.id
                WHERE applications.id = ? AND applications.application_type = ?
                  AND COALESCE(applications.is_under_18, 0) IS ? AND applications.address_evidence_type IS ?
                  AND requirements.id = ? AND requirements.code = ? AND requirements.is_active = 1
                  AND records.id = ? AND current_revision_check.id = ?
                  AND current_revision_check.id = current_revision.id
                  AND current_file.upload_status = 'finalized' AND current_file.cleanup_status <> 'pending'
                  AND current_intent.status = 'completed'
                  AND EXISTS (
                    SELECT 1 FROM application_notes
                    WHERE application_notes.application_id = applications.id
                      AND application_notes.document_record_id = records.id
                      AND application_notes.visibility = 'student'
                  )
                  AND ${modeGuard}
              )
        `).bind(input.expectedCurrentRevisionId, input.documentRecordId,
            input.applicationId, ...bindModeFacts(input)),
        database.prepare(`
            UPDATE document_revisions
            SET is_current = 1, status = 'submitted', uploaded_at = ?
            WHERE id = ? AND document_record_id = ? AND is_current = 0 AND status = 'pending_scan'
              AND changes() = 1
              AND EXISTS (
                SELECT 1 FROM upload_intents
                JOIN document_revision_files ON document_revision_files.id = upload_intents.revision_file_id
                WHERE upload_intents.id = ? AND upload_intents.status = 'pending'
                  AND datetime(upload_intents.expires_at) > datetime(?)
                  AND document_revision_files.id = ? AND document_revision_files.revision_id = ?
              )
        `).bind(input.finalizedAt, input.replacementRevisionId, input.documentRecordId,
            input.intentId, input.finalizedAt, input.replacementFileId, input.replacementRevisionId),
        database.prepare(`
            UPDATE document_revision_files
            SET upload_status = 'finalized', scan_status = 'pending'
            WHERE id = ? AND revision_id = ? AND upload_status = 'intent'
              AND cleanup_status = 'none' AND changes() = 1
              AND EXISTS (SELECT 1 FROM document_revisions WHERE id = ? AND is_current = 1 AND status = 'submitted')
        `).bind(input.replacementFileId, input.replacementRevisionId, input.replacementRevisionId),
        database.prepare(`
            UPDATE document_records SET review_status = 'pending', updated_at = ?
            WHERE id = ? AND application_id = ? AND review_status = ? AND changes() = 1
              AND EXISTS (
                SELECT 1 FROM document_revisions WHERE id = ? AND document_record_id = document_records.id
                  AND is_current = 1 AND status = 'submitted'
              )
        `).bind(input.finalizedAt, input.documentRecordId, input.applicationId,
            input.mode === 'first_replacement' ? 'resubmission_required' : 'pending', input.replacementRevisionId),
        database.prepare(`
            UPDATE applications SET updated_at = ?, last_activity_at = ?
            WHERE id = ? AND status = 'resubmission_required' AND changes() = 1
              AND EXISTS (
                SELECT 1 FROM document_records
                WHERE id = ? AND application_id = applications.id AND review_status = 'pending'
              )
        `).bind(input.finalizedAt, input.finalizedAt, input.applicationId, input.documentRecordId),
        database.prepare(`
            UPDATE upload_intents SET status = 'completed', completed_at = ?
            WHERE id = ? AND status = 'pending' AND revision_file_id = ? AND changes() = 1
              AND datetime(expires_at) > datetime(?)
              AND EXISTS (SELECT 1 FROM document_revisions WHERE id = ? AND is_current = 1 AND status = 'submitted')
        `).bind(input.finalizedAt, input.intentId, input.replacementFileId,
            input.finalizedAt, input.replacementRevisionId),
        database.prepare(`
            INSERT INTO audit_events (
                id, event_type, actor_type, application_id, request_id, safe_metadata_json, created_at
            ) VALUES (
                ?, 'student.document_resubmitted', 'student', ?,
                CASE WHEN changes() = 1 THEN ? ELSE NULL END, ?, ?
            )
        `).bind(input.auditId, input.applicationId, input.requestId,
            JSON.stringify({ documentCode: input.code, revisionNumber: input.revisionNumber,
                documentStatus: 'submitted', result: 'success' }), input.finalizedAt),
        createScanJobStatement(database, { fileId: input.replacementFileId, finalizedAt: input.finalizedAt })
    ];
}

/** Creates D1 persistence operations for the separate student resubmission flow. */
export function createResubmissionUploadRepository(database) {
    return Object.freeze({
        async readEligibility(applicationId, code) {
            const result = await database.prepare(readEligibilitySql())
                .bind(applicationId, code ?? null, code ?? null).all();
            if (code !== undefined) return result.results[0] ?? null;
            return result.results;
        },
        async createIntent(input) {
            const modePredicate = readExactReplacementEligibilitySql(input.mode);
            const modeValues = bindModeFacts(input);
            const results = await database.batch([
                database.prepare(`
                    INSERT INTO document_revisions (
                        id, document_record_id, revision_number, status, is_current, submitted_by_type
                    )
                    SELECT ?, records.id,
                        (SELECT COALESCE(MAX(previous.revision_number), 0) + 1
                         FROM document_revisions AS previous WHERE previous.document_record_id = records.id),
                        'pending_scan', 0, 'student'
                    FROM applications
                    JOIN document_requirements AS requirements ON requirements.application_type = applications.application_type
                    JOIN document_records AS records ON records.application_id = applications.id
                      AND records.requirement_id = requirements.id
                    JOIN document_revisions AS current_revision ON current_revision.document_record_id = records.id
                      AND current_revision.is_current = 1
                    JOIN document_revision_files AS current_file ON current_file.revision_id = current_revision.id
                      AND current_file.page_order = 0
                    JOIN upload_intents AS current_intent ON current_intent.revision_file_id = current_file.id
                    WHERE applications.id = ? AND ${modePredicate}
                    GROUP BY records.id
                `).bind(input.revisionId, input.applicationId, ...modeValues),
                database.prepare(`
                    INSERT INTO document_revision_files (
                        id, revision_id, page_order, storage_key, original_filename,
                        media_type, byte_size, upload_status, scan_status, cleanup_status, created_at
                    )
                    SELECT ?, ?, 0, ?, ?, ?, ?, 'intent', 'pending', 'none', ?
                    WHERE changes() = 1 AND EXISTS (
                        SELECT 1 FROM document_revisions WHERE id = ? AND status = 'pending_scan' AND is_current = 0
                    )
                `).bind(input.fileId, input.revisionId, input.storageKey, input.filename,
                    input.mediaType, input.byteSize, input.createdAt, input.revisionId),
                database.prepare(`
                    INSERT INTO upload_intents (id, revision_file_id, idempotency_key, expires_at, created_at)
                    SELECT ?, ?, ?, ?, ? WHERE changes() = 1
                      AND EXISTS (SELECT 1 FROM document_revision_files WHERE id = ? AND upload_status = 'intent')
                `).bind(input.intentId, input.fileId, encodeIntentGuard(input),
                    input.expiresAt, input.createdAt, input.fileId),
                database.prepare(`
                    UPDATE upload_intents SET status = 'rejected'
                    WHERE changes() = 1 AND id <> ? AND status = 'pending' AND revision_file_id IN (
                        SELECT files.id FROM document_revision_files AS files
                        JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                        WHERE revisions.document_record_id = ? AND revisions.is_current = 0
                          AND revisions.status = 'pending_scan'
                    )
                `).bind(input.intentId, input.documentRecordId),
                database.prepare(`
                    UPDATE document_revision_files SET upload_status = 'rejected',
                        cleanup_status = 'pending', cleanup_requested_at = ?
                    WHERE changes() = 1 AND revision_id IN (
                        SELECT revisions.id FROM document_revisions AS revisions
                        JOIN document_revision_files AS old_files ON old_files.revision_id = revisions.id
                        JOIN upload_intents AS old_intents ON old_intents.revision_file_id = old_files.id
                        WHERE revisions.document_record_id = ? AND revisions.is_current = 0
                      AND revisions.status = 'pending_scan' AND old_intents.status = 'rejected'
                          AND old_intents.id <> ?
                    )
                `).bind(input.createdAt, input.documentRecordId, input.intentId),
                database.prepare(`
                    UPDATE document_revisions SET status = 'superseded'
                    WHERE changes() = 1 AND document_record_id = ? AND is_current = 0 AND status = 'pending_scan'
                      AND EXISTS (
                        SELECT 1 FROM document_revision_files AS files
                        JOIN upload_intents AS intents ON intents.revision_file_id = files.id
                        WHERE files.revision_id = document_revisions.id AND files.upload_status = 'rejected'
                          AND files.cleanup_status = 'pending' AND intents.status = 'rejected' AND intents.id <> ?
                      )
                `).bind(input.documentRecordId, input.intentId)
            ]);
            return results[2]?.meta?.changes === 1;
        },
        async findIntent(applicationId, intentId) {
            const intent = await database.prepare(`
                SELECT intents.id, intents.idempotency_key, intents.status AS intent_status, intents.expires_at,
                       files.id AS file_id, files.storage_key, files.original_filename, files.media_type,
                       files.byte_size, files.upload_status, files.cleanup_status, files.scan_status,
                       revisions.id AS revision_id, revisions.revision_number, revisions.status AS revision_status,
                       revisions.is_current, records.id AS document_record_id, records.review_status,
                       applications.id AS application_id, applications.status AS application_status,
                       applications.application_type, applications.is_under_18, applications.address_evidence_type,
                       requirements.id AS requirement_id, requirements.code, requirements.is_active
                FROM upload_intents AS intents
                JOIN document_revision_files AS files ON files.id = intents.revision_file_id
                JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                JOIN document_records AS records ON records.id = revisions.document_record_id
                JOIN applications ON applications.id = records.application_id
                JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                WHERE intents.id = ? AND applications.id = ? LIMIT 1
            `).bind(intentId, applicationId).first();
            if (!intent) return null;
            const guard = readIntentGuard(intent.idempotency_key);
            if (!guard) return null;
            return { ...intent, ...guard };
        },
        async expireIntent(applicationId, intentId, expiredAt) {
            return invalidateIntent(database, { applicationId, intentId, changedAt: expiredAt, status: 'expired' });
        },
        async listExpiredPendingIntents(applicationId) {
            const result = await database.prepare(`
                SELECT intents.id
                FROM upload_intents AS intents
                JOIN document_revision_files AS files ON files.id = intents.revision_file_id
                JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                JOIN document_records AS records ON records.id = revisions.document_record_id
                WHERE records.application_id = ? AND revisions.is_current = 0
                  AND revisions.status = 'pending_scan' AND intents.status = 'pending'
                  AND datetime(intents.expires_at) <= datetime('now')
                ORDER BY intents.expires_at, intents.id
            `).bind(applicationId).all();
            return result.results;
        },
        async invalidatePendingIntent(applicationId, documentRecordId, intentId, invalidatedAt) {
            return invalidateIntent(database, {
                applicationId, documentRecordId, intentId, changedAt: invalidatedAt, status: 'rejected'
            });
        },
        async listRetryableCleanup(applicationId, code) {
            const result = await database.prepare(`
                SELECT files.id, files.storage_key
                FROM document_revision_files AS files
                JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                JOIN document_records AS records ON records.id = revisions.document_record_id
                JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                JOIN upload_intents AS intents ON intents.revision_file_id = files.id
                WHERE records.application_id = ? AND (? IS NULL OR requirements.code = ?)
                  AND revisions.is_current = 0 AND revisions.status = 'superseded'
                  AND files.upload_status = 'rejected' AND files.cleanup_status = 'pending'
                  AND intents.status IN ('expired', 'rejected')
                  AND datetime(intents.expires_at) <= datetime('now')
                ORDER BY files.cleanup_requested_at, files.id
            `).bind(applicationId, code ?? null, code ?? null).all();
            return result.results;
        },
        async markCleanupComplete(applicationId, fileId) {
            const result = await database.prepare(`
                UPDATE document_revision_files SET cleanup_status = 'complete'
                WHERE id = ? AND cleanup_status = 'pending' AND upload_status = 'rejected'
                  AND revision_id IN (
                    SELECT revisions.id FROM document_revisions AS revisions
                    JOIN document_records AS records ON records.id = revisions.document_record_id
                    WHERE records.application_id = ? AND revisions.is_current = 0 AND revisions.status = 'superseded'
                  )
                  AND EXISTS (
                    SELECT 1 FROM upload_intents WHERE upload_intents.revision_file_id = document_revision_files.id
                      AND upload_intents.status IN ('expired', 'rejected')
                      AND datetime(upload_intents.expires_at) <= datetime('now')
                  )
            `).bind(fileId, applicationId).run();
            return result.meta.changes === 1;
        },
        async finalizeReplacement(input) {
            try {
                const results = await database.batch(readFinalizeStatements(database, input));
                return results.every((result) => result?.meta?.changes === 1);
            } catch (error) {
                if (readRevisionMismatchError(error)) return false;
                throw error;
            }
        }
    });
}

async function invalidateIntent(database, { applicationId, documentRecordId, intentId, changedAt, status }) {
    const recordFilter = documentRecordId === undefined ? '' : 'AND records.id = ?';
    const recordValues = documentRecordId === undefined ? [] : [documentRecordId];
    const results = await database.batch([
        database.prepare(`
            UPDATE upload_intents SET status = ?
            WHERE id = ? AND status = 'pending' AND revision_file_id IN (
                SELECT files.id FROM document_revision_files AS files
                JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                JOIN document_records AS records ON records.id = revisions.document_record_id
                WHERE records.application_id = ? ${recordFilter}
                  AND revisions.is_current = 0 AND revisions.status = 'pending_scan'
            )
        `).bind(status, intentId, applicationId, ...recordValues),
        database.prepare(`
            UPDATE document_revision_files SET upload_status = 'rejected',
                cleanup_status = 'pending', cleanup_requested_at = ?
            WHERE id IN (SELECT revision_file_id FROM upload_intents WHERE id = ? AND status = ?)
              AND upload_status IN ('intent', 'uploaded', 'quarantined') AND changes() = 1
              AND revision_id IN (SELECT id FROM document_revisions WHERE is_current = 0 AND status = 'pending_scan')
        `).bind(changedAt, intentId, status),
        database.prepare(`
            UPDATE document_revisions SET status = 'superseded'
            WHERE id IN (SELECT files.revision_id FROM document_revision_files AS files
                         JOIN upload_intents AS intents ON intents.revision_file_id = files.id
                         WHERE intents.id = ? AND intents.status = ? AND files.cleanup_status = 'pending')
              AND is_current = 0 AND status = 'pending_scan' AND changes() = 1
        `).bind(intentId, status)
    ]);
    return results.every((result) => result?.meta?.changes === 1);
}
