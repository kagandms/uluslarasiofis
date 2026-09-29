/**
 * Creates the document metadata repository for one D1 binding.
 * @param {D1Database} database Cloudflare D1 binding.
 * @returns {{findPrivateFileById(fileId: string): Promise<object|null>}} Private document metadata operations.
 */
export function createDocumentRepository(database) {
    return Object.freeze({
        async findPrivateFileById(fileId) {
            return database.prepare(`
                SELECT files.id, files.storage_key, files.original_filename,
                       files.media_type, files.byte_size, records.application_id
                FROM document_revision_files AS files
                JOIN document_revisions AS revisions ON revisions.id = files.revision_id
                JOIN document_records AS records ON records.id = revisions.document_record_id
                WHERE files.id = ?
                  AND files.upload_status = 'finalized'
                  AND files.scan_status = 'clean'
                  AND revisions.is_current = 1
                  AND revisions.status IN ('submitted', 'approved', 'resubmission_required')
                LIMIT 1
            `).bind(fileId).first();
        }
    });
}
