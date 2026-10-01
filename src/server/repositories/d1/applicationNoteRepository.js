/**
 * Creates persistence operations for student-visible application messages.
 * @param {D1Database} database Cloudflare D1 binding.
 * @returns {object} Narrow note lookup and transactional insert operations.
 */
export function createApplicationNoteRepository(database) {
    return Object.freeze({
        async listLatestStudentDocumentMessages(applicationId) {
            const result = await database.prepare(`
                SELECT document_record_id, body
                FROM (
                    SELECT application_notes.document_record_id, application_notes.body,
                           ROW_NUMBER() OVER (
                               PARTITION BY application_notes.document_record_id
                               ORDER BY application_notes.created_at DESC, application_notes.id DESC
                           ) AS message_rank
                    FROM application_notes
                    JOIN document_records
                      ON document_records.id = application_notes.document_record_id
                     AND document_records.application_id = application_notes.application_id
                    WHERE application_notes.application_id = ? AND application_notes.visibility = 'student'
                      AND application_notes.document_record_id IS NOT NULL
                )
                WHERE message_rank = 1
            `).bind(applicationId).all();
            return new Map(result.results.map((message) => [message.document_record_id, message.body]));
        },
        prepareStudentDocumentMessage({ id, applicationId, documentRecordId, staffId, body, createdAt }) {
            return database.prepare(`
                INSERT INTO application_notes (
                    id, application_id, document_record_id, author_type,
                    author_staff_id, visibility, body, created_at
                )
                SELECT ?, ?, records.id, 'staff', ?, 'student', ?, ?
                FROM document_records AS records
                JOIN document_revisions AS revisions ON revisions.document_record_id = records.id
                WHERE records.id = ? AND records.application_id = ?
                  AND revisions.is_current = 1 AND revisions.status = 'resubmission_required'
            `).bind(id, applicationId, staffId, body, createdAt, documentRecordId, applicationId);
        }
    });
}
