/**
 * Appends a durable job inside either finalize transaction without changing earlier statement row counts.
 * @param {D1Database} database D1 binding.
 * @param {{fileId: string, finalizedAt: string}} input Exact finalized file identity and UTC time.
 * @returns {D1PreparedStatement} Atomic conditional job insert; uniqueness deduplicates reconciliation.
 */
export function createScanJobStatement(database, { fileId, finalizedAt }) {
    return database.prepare(`
        INSERT INTO document_scan_jobs
            (id,file_id,revision_id,storage_key,byte_size,media_type,available_at,created_at,updated_at)
        SELECT lower(hex(randomblob(16))), files.id, files.revision_id, files.storage_key,
            files.byte_size, files.media_type,
            strftime('%Y-%m-%dT%H:%M:%fZ', ?), ?, ?
        FROM document_revision_files AS files
        JOIN document_revisions AS revisions ON revisions.id=files.revision_id
        JOIN upload_intents AS intents ON intents.revision_file_id=files.id AND intents.status='completed'
        WHERE files.id=? AND files.upload_status='finalized' AND files.scan_status='pending'
          AND files.cleanup_status='none' AND revisions.is_current=1
        ON CONFLICT(file_id) DO NOTHING
    `).bind(finalizedAt,finalizedAt,finalizedAt,fileId);
}
