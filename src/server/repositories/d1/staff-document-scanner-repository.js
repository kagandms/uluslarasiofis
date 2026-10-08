const CURRENT_JOB = `EXISTS (SELECT 1 FROM staff_scan_files files
 WHERE files.file_id=staff_document_scan_jobs.file_id AND files.revision_id=staff_document_scan_jobs.revision_id
 AND files.storage_key=staff_document_scan_jobs.storage_key AND files.byte_size=staff_document_scan_jobs.byte_size
 AND files.media_type=staff_document_scan_jobs.media_type AND files.upload_status='finalized' AND files.scan_status='pending')`;
const TERMINAL_CODES = new Set(['unsupported_content', 'policy_blocked']);

/** Reconciles private staff documents without assigning a clean verdict.
 * @param {D1Database} database Binding. @param {string} now UTC timestamp.
 * @returns {Promise<void>} Queue repair. @throws {Error} D1 failure.
 */
async function reconcile(database, now) {
    await database.batch([
        database.prepare(`INSERT OR IGNORE INTO staff_document_scan_jobs
            (id,file_id,revision_id,storage_key,byte_size,media_type,available_at,created_at,updated_at)
            SELECT 'staff_'||lower(hex(randomblob(16))),file_id,revision_id,storage_key,byte_size,media_type,?,?,?
            FROM staff_scan_files WHERE upload_status='finalized' AND scan_status='pending'`).bind(now, now, now),
        database.prepare(`UPDATE staff_document_scan_jobs SET status='stale',updated_at=?
            WHERE status IN ('queued','leased') AND NOT ${CURRENT_JOB}`).bind(now),
        database.prepare(`UPDATE staff_document_scan_jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,
            result_code='lease_expired',available_at=?,updated_at=?,lease_token_hash=NULL
            WHERE status='leased' AND lease_until<=?`).bind(now, now, now),
        database.prepare(`UPDATE physical_intake_files SET scan_status='failed' WHERE scan_status='pending'
            AND 'physical_'||id IN (SELECT file_id FROM staff_document_scan_jobs WHERE status='failed')`),
        database.prepare(`UPDATE mobile_document_transfer_files SET scan_status='failed' WHERE scan_status='pending'
            AND 'mobile_'||id IN (SELECT file_id FROM staff_document_scan_jobs WHERE status='failed')`)
    ]);
}

/** @param {D1Database} database Binding. @param {object} input Lease credentials.
 * @returns {Promise<object|null>} Atomic lease. @throws {Error} D1 failure.
 */
async function claim(database, input) {
    const leaseUntil = new Date(Date.parse(input.now) + 300_000).toISOString();
    return database.prepare(`UPDATE staff_document_scan_jobs SET status='leased',attempts=attempts+1,
        runner_id=?,lease_token_hash=?,lease_until=?,updated_at=?,object_etag=NULL,content_sha256=NULL
        WHERE id=(SELECT id FROM staff_document_scan_jobs WHERE status='queued' AND available_at<=?
            AND attempts<3 AND ${CURRENT_JOB} ORDER BY available_at,id LIMIT 1)
        AND status='queued' RETURNING *`).bind(input.runnerId, input.tokenHash, leaseUntil, input.now, input.now).first();
}

/** @param {D1Database} database Binding. @param {object} input Exact content evidence.
 * @returns {Promise<boolean>} Content pinned. @throws {Error} D1 failure.
 */
async function bindContent(database, { job, tokenHash, now, etag, sha256 }) {
    const changed = await database.prepare(`UPDATE staff_document_scan_jobs SET object_etag=?,content_sha256=?
        WHERE id=? AND status='leased' AND lease_token_hash=? AND lease_until>? AND ${CURRENT_JOB}
        AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (object_etag IS NULL OR object_etag=?)
        AND (content_sha256 IS NULL OR content_sha256=?)
        AND EXISTS(SELECT 1 FROM staff_scan_files files WHERE files.file_id=staff_document_scan_jobs.file_id AND files.sha256=?)`)
        .bind(etag, sha256, job.id, tokenHash, now, etag, sha256, sha256).run();
    return changed.meta.changes === 1;
}

/** @param {D1Database} database Binding. @param {object} input Validated scanner result.
 * @returns {Promise<boolean>} Durable verdict. @throws {Error} D1 failure.
 */
async function persistResult(database, input) {
    const { job, result, now, tokenHash } = input;
    const isRetry = result.outcome === 'failed' && job.attempts < 3 && !TERMINAL_CODES.has(result.result_code);
    const availableAt = new Date(Date.parse(now) + job.attempts * 60_000).toISOString();
    const targetTable = job.file_id.startsWith('physical_') ? 'physical_intake_files' : 'mobile_document_transfer_files';
    const targetId = job.file_id.replace(/^(physical_|mobile_)/, '');
    const results = await database.batch([
        database.prepare(`UPDATE staff_document_scan_jobs SET status=?,outcome=?,result_code=?,engine_version=?,signature_version=?,
            signature_updated_at=?,scanned_at=?,updated_at=?,available_at=? WHERE id=? AND status='leased'
            AND lease_token_hash=? AND lease_until>? AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now')
            AND object_etag IS ? AND content_sha256 IS ? AND ${CURRENT_JOB}`)
            .bind(isRetry ? 'queued' : result.outcome === 'failed' ? 'failed' : 'complete', result.outcome, result.result_code,
                result.engine_version, result.signature_version, result.signature_updated_at, result.scanned_at, now,
                availableAt, job.id, tokenHash, now, job.object_etag, job.content_sha256),
        database.prepare(`UPDATE ${targetTable} SET scan_status=? WHERE id=? AND scan_status='pending' AND changes()=1`)
            .bind(isRetry ? 'pending' : result.outcome, targetId),
        database.prepare(`INSERT INTO audit_events(id,event_type,actor_type,request_id,safe_metadata_json,created_at)
            SELECT ?,'staff_document.scan_result','system',?,?,? WHERE changes()=1`)
            .bind(crypto.randomUUID(), `scanner_${crypto.randomUUID()}`, JSON.stringify({ fileId: job.file_id, outcome: result.outcome }), now)
    ]);
    return results[0].meta.changes === 1;
}

/** Creates the supplemental queue used by the existing scanner API and agent.
 * @param {D1Database} database Binding. @returns {object} Private staff document operations.
 */
export function createStaffDocumentScannerRepository(database) {
    return Object.freeze({
        reconcile: now => reconcile(database, now), claim: input => claim(database, input),
        bindContent: input => bindContent(database, input), persistResult: input => persistResult(database, input),
        findLease: ({ jobId, tokenHash, now }) => database.prepare(`SELECT * FROM staff_document_scan_jobs
            WHERE id=? AND status='leased' AND lease_token_hash=? AND lease_until>? AND ${CURRENT_JOB}`)
            .bind(jobId, tokenHash, now).first()
    });
}
