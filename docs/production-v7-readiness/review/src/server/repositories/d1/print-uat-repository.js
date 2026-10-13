import { PRINT_UAT_SLOT_ID } from '../../domain/print-uat-policy.js';

/**
 * Atomically consume the persistent v7 UAT slot before creating its single job.
 * @param {object} database D1 binding.
 * @param {{jobId: string, now: string}} reservation Safe reservation metadata.
 * @returns {Promise<boolean>} Whether this request reserved the slot.
 */
export async function reservePrintUatSlot(database, reservation) {
    const recorded = await database.prepare(`INSERT INTO audit_events (
        id,event_type,actor_type,request_id,safe_metadata_json,created_at
    ) VALUES (?, 'print.uat_slot_reserved', 'system', ?, ?, ?)
        ON CONFLICT(id) DO NOTHING RETURNING id`).bind(PRINT_UAT_SLOT_ID,
        reservation.jobId, JSON.stringify({ job_id: reservation.jobId }), reservation.now).first();
    return Boolean(recorded);
}

/**
 * Read the reserved job without disclosing tokens or document contents.
 * @param {object} database D1 binding.
 * @returns {Promise<string|null>} Reserved job ID, including after print-row cleanup.
 */
export async function readPrintUatJobId(database) {
    const reservation = await database.prepare(`SELECT json_extract(safe_metadata_json, '$.job_id') AS job_id
        FROM audit_events WHERE id=? AND event_type='print.uat_slot_reserved'`)
        .bind(PRINT_UAT_SLOT_ID).first();
    return reservation?.job_id || null;
}
