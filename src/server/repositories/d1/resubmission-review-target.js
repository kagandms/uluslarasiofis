/**
 * Reads current finalized metadata for a reasoned replacement, without file access capabilities.
 * @param {D1Database} database D1 binding.
 * @param {{applicationId: string, code: string}} input Exact application and policy code.
 * @returns {Promise<object|null>} Current revision facts; never an R2 key or signed URL.
 * @throws {Error} When the database read fails.
 */
export async function findCurrentResubmissionTarget(database, input) {
    return database.prepare(`
        SELECT records.id AS document_record_id, revisions.id AS revision_id,
               revisions.revision_number, revisions.status AS revision_status,
               records.review_status, files.scan_status, files.media_type
        FROM applications
        JOIN document_records AS records ON records.application_id = applications.id
        JOIN document_requirements AS requirements ON requirements.id = records.requirement_id
        JOIN document_revisions AS revisions ON revisions.document_record_id = records.id
        JOIN document_revision_files AS files ON files.revision_id = revisions.id AND files.page_order = 0
        JOIN upload_intents AS intents ON intents.revision_file_id = files.id
        WHERE applications.id = ? AND applications.status IN ('under_review', 'resubmission_required')
          AND records.application_type = applications.application_type
          AND requirements.application_type = applications.application_type
          AND requirements.code = ? AND requirements.is_active = 1
          AND revisions.is_current = 1
          AND revisions.status IN ('submitted', 'approved', 'resubmission_required')
          AND files.upload_status = 'finalized' AND files.scan_status IN ('clean', 'unsafe', 'failed')
          AND files.cleanup_status = 'none' AND intents.status = 'completed'
        LIMIT 1
    `).bind(input.applicationId, input.code).first();
}
