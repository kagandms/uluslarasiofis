import { OFFICIAL_APPLICATION_RETENTION_DAYS } from '../../../config/constants.js';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function addUtcDays(timestamp, days) {
    const timestampMilliseconds = Date.parse(timestamp);
    if (!Number.isFinite(timestampMilliseconds)) throw new TypeError('Application timestamp must be valid.');
    return new Date(timestampMilliseconds + days * MILLISECONDS_PER_DAY).toISOString();
}

/**
 * Creates atomic persistence operations for staff application and document review.
 * @param {D1Database} database Cloudflare D1 binding.
 * @param {object} notes Student-visible application note repository.
 * @returns {object} Conditional, audit-coupled review mutations.
 */
export function createApplicationReviewRepository(database, notes) {
    return Object.freeze({
        async transitionApplicationStatus({ applicationId, currentStatus, expectedUpdatedAt, targetStatus, staffId, now, requestId, auditId }) {
            const isCompleted = targetStatus === 'completed';
            const terminalAt = isCompleted ? now : null;
            const retentionDueAt = isCompleted ? addUtcDays(now, OFFICIAL_APPLICATION_RETENTION_DAYS) : null;
            const results = await database.batch([
                database.prepare(`
                    UPDATE applications SET status = ?, updated_at = ?, last_activity_at = ?,
                        terminal_at = ?, retention_due_at = ?
                    WHERE id = ? AND status = ? AND updated_at = ?
                `).bind(targetStatus, now, now, terminalAt, retentionDueAt,
                    applicationId, currentStatus, expectedUpdatedAt),
                database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, actor_staff_id, application_id, request_id, safe_metadata_json
                    ) SELECT ?, ?, 'staff', ?, ?, ?, ? WHERE changes() = 1
                `).bind(auditId, targetStatus === 'under_review' && currentStatus === 'submitted'
                    ? 'staff.application_review_started' : 'staff.application_status_changed',
                staffId, applicationId, requestId, JSON.stringify({ applicationStatus: targetStatus, result: 'success' }))
            ]);
            return results[0]?.meta?.changes === 1 && results[1]?.meta?.changes === 1;
        },
        async approveCurrentDocument({ applicationId, documentRecordId, revisionId, revisionNumber, code, staffId, now, requestId, auditId }) {
            const results = await database.batch([
                database.prepare(`
                    UPDATE document_revisions
                    SET status = 'approved', reviewed_at = ?, reviewed_by_staff_id = ?
                    WHERE id = ? AND document_record_id = ? AND revision_number = ?
                      AND is_current = 1 AND status = 'submitted'
                      AND EXISTS (
                        SELECT 1 FROM document_records AS records
                        JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                        JOIN applications ON applications.id = records.application_id
                        JOIN document_revision_files AS files ON files.revision_id = document_revisions.id
                        JOIN upload_intents AS intents ON intents.revision_file_id = files.id
                        WHERE records.id = document_revisions.document_record_id
                          AND records.application_id = ? AND records.review_status IN ('pending', 'under_review')
                          AND applications.status IN ('under_review', 'resubmission_required')
                          AND requirements.is_active = 1 AND files.upload_status = 'finalized'
                          AND files.scan_status = 'clean' AND files.cleanup_status = 'none'
                          AND intents.status = 'completed'
                      )
                `).bind(now, staffId, revisionId, documentRecordId, revisionNumber, applicationId),
                database.prepare(`
                    UPDATE document_records SET review_status = 'approved', updated_at = ?
                    WHERE id = ? AND application_id = ? AND review_status IN ('pending', 'under_review')
                      AND changes() = 1 AND EXISTS (
                        SELECT 1 FROM document_revisions
                        WHERE id = ? AND document_record_id = document_records.id
                          AND is_current = 1 AND status = 'approved'
                      )
                `).bind(now, documentRecordId, applicationId, revisionId),
                database.prepare(`
                    UPDATE applications SET updated_at = ?, last_activity_at = ?
                    WHERE id = ? AND status IN ('under_review', 'resubmission_required') AND changes() = 1
                `).bind(now, now, applicationId),
                database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, actor_staff_id, application_id,
                        document_record_id, request_id, safe_metadata_json
                    ) SELECT ?, 'staff.document_approved', 'staff', ?, ?, ?, ?, ? WHERE changes() = 1
                `).bind(auditId, staffId, applicationId, documentRecordId, requestId,
                    JSON.stringify({ documentCode: code, revisionNumber, documentStatus: 'approved', result: 'success' }))
            ]);
            return results.every((result) => result?.meta?.changes === 1);
        },
        async requestCurrentDocumentResubmission({ applicationId, documentRecordId, revisionId, revisionNumber, code, staffId, reason, now, requestId, auditId, noteId }) {
            const results = await database.batch([
                database.prepare(`
                    UPDATE document_revisions
                    SET status = 'resubmission_required', reviewed_at = ?, reviewed_by_staff_id = ?
                    WHERE id = ? AND document_record_id = ? AND revision_number = ?
                      AND is_current = 1 AND status = 'submitted'
                      AND EXISTS (
                        SELECT 1 FROM document_records AS records
                        JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
                        JOIN applications ON applications.id = records.application_id
                        JOIN document_revision_files AS files ON files.revision_id = document_revisions.id
                        JOIN upload_intents AS intents ON intents.revision_file_id = files.id
                        WHERE records.id = document_revisions.document_record_id
                          AND records.application_id = ? AND records.review_status IN ('pending', 'under_review')
                          AND applications.status IN ('under_review', 'resubmission_required')
                          AND requirements.is_active = 1 AND files.upload_status = 'finalized'
                          AND files.scan_status = 'clean' AND files.cleanup_status = 'none'
                          AND intents.status = 'completed'
                      )
                `).bind(now, staffId, revisionId, documentRecordId, revisionNumber, applicationId),
                database.prepare(`
                    UPDATE document_records SET review_status = 'resubmission_required', updated_at = ?
                    WHERE id = ? AND application_id = ? AND review_status IN ('pending', 'under_review')
                      AND changes() = 1 AND EXISTS (
                        SELECT 1 FROM document_revisions
                        WHERE id = ? AND document_record_id = document_records.id
                          AND is_current = 1 AND status = 'resubmission_required'
                      )
                `).bind(now, documentRecordId, applicationId, revisionId),
                database.prepare(`
                    UPDATE applications SET status = 'resubmission_required', updated_at = ?, last_activity_at = ?
                    WHERE id = ? AND status IN ('under_review', 'resubmission_required') AND changes() = 1
                `).bind(now, now, applicationId),
                notes.prepareStudentDocumentMessage({
                    id: noteId, applicationId, documentRecordId, staffId, body: reason, createdAt: now
                }),
                database.prepare(`
                    INSERT INTO audit_events (
                        id, event_type, actor_type, actor_staff_id, application_id,
                        document_record_id, request_id, safe_metadata_json
                    ) SELECT ?, 'staff.document_resubmission_requested', 'staff', ?, ?, ?, ?, ?
                    WHERE changes() = 1
                `).bind(auditId, staffId, applicationId, documentRecordId, requestId,
                    JSON.stringify({ documentCode: code, revisionNumber,
                        documentStatus: 'resubmission_required', applicationStatus: 'resubmission_required', result: 'success' }))
            ]);
            return results.every((result) => result?.meta?.changes === 1);
        }
    });
}
