import { MAX_PENDING_PRINT_JOBS } from '../../domain/printPolicy.js';

/** Builds the shared atomic queue reservation statement. @param {D1Database} database Binding. @param {object} input Validated intent. @returns {object} Bound statement. */
export function buildPrintIntentStatement(database, input) {
    return database.prepare(`INSERT INTO print_jobs (
                id,idempotency_key_hash,upload_token_hash,tracking_token_hash,storage_key,media_type,byte_size,copies,
                paper_size,color_mode,duplex,orientation,source,created_by_staff_id,created_by_staff_role,
                status,available_at,created_at,updated_at,expires_at,purge_after
            ) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'uploading',?,?,?,?,?
              WHERE (SELECT count(*) FROM print_jobs WHERE status IN
                    ('uploading','queued','leased','ready','submission_started') AND cleanup_status='none') < ?
                AND (SELECT health FROM printer_heartbeats ORDER BY seen_at DESC LIMIT 1)='ready'
                AND (SELECT seen_at FROM printer_heartbeats ORDER BY seen_at DESC LIMIT 1)>=?
                AND (SELECT settings_protocol FROM printer_heartbeats ORDER BY seen_at DESC LIMIT 1)>=?
                AND (SELECT is_paused FROM print_queue_controls WHERE id='global')=0
                AND (? IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ','now') < ?)
                ON CONFLICT(idempotency_key_hash) DO NOTHING
            RETURNING *`).bind(input.id, input.idempotencyHash, input.uploadTokenHash, input.trackingTokenHash,
                input.storageKey, input.mediaType, input.byteSize, input.copies, input.paperSize, input.colorMode,
                input.duplex, input.orientation || 'portrait', input.source || 'student', input.createdByStaffId || null,
                input.createdByStaffRole || null,
                input.now, input.now, input.now, input.expiresAt, input.purgeAfter,
                MAX_PENDING_PRINT_JOBS, input.heartbeatCutoff, input.requiredProtocol || 0,
                input.uatExpiresAt || null, input.uatExpiresAt || null);
}
