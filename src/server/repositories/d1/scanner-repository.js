const CURRENT_JOB = `EXISTS (
    SELECT 1 FROM document_revision_files AS files
    JOIN document_revisions AS revisions ON revisions.id = files.revision_id
    JOIN upload_intents AS intents ON intents.revision_file_id = files.id
    WHERE files.id = document_scan_jobs.file_id AND files.revision_id = document_scan_jobs.revision_id
      AND files.storage_key = document_scan_jobs.storage_key AND files.byte_size = document_scan_jobs.byte_size
      AND files.media_type = document_scan_jobs.media_type AND files.upload_status = 'finalized'
      AND files.scan_status = 'pending' AND files.cleanup_status = 'none'
      AND revisions.is_current = 1 AND intents.status = 'completed'
)`;
const RECONCILE_INSERT = `INSERT OR IGNORE INTO document_scan_jobs
    (id,file_id,revision_id,storage_key,byte_size,media_type,available_at,created_at,updated_at)
    SELECT lower(hex(randomblob(16))), files.id, files.revision_id, files.storage_key, files.byte_size, files.media_type,
      strftime('%Y-%m-%dT%H:%M:%fZ',max(datetime(intents.expires_at),datetime(intents.completed_at,'+300 seconds'))), ?, ?
    FROM document_revision_files AS files
    JOIN document_revisions AS revisions ON revisions.id=files.revision_id
    JOIN upload_intents AS intents ON intents.revision_file_id=files.id AND intents.status='completed'
    WHERE files.upload_status='finalized' AND files.scan_status='pending'
      AND files.cleanup_status='none' AND revisions.is_current=1
      AND NOT EXISTS (SELECT 1 FROM document_scan_jobs WHERE file_id=files.id)`;

/** @param {D1Database} database Binding. @param {string} now UTC time. @returns {Promise<void>} Repairs queue state without assigning clean. */
async function reconcile(database, now) {
    await database.batch([
        database.prepare(RECONCILE_INSERT).bind(now, now),
        database.prepare(`UPDATE document_scan_jobs SET status='stale',updated_at=?
            WHERE status IN ('queued','leased') AND NOT ${CURRENT_JOB}`).bind(now),
        database.prepare(`UPDATE document_scan_jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,
            result_code='lease_expired',available_at=?,updated_at=?,lease_token_hash=NULL
            WHERE status='leased' AND lease_until<=?`).bind(now, now, now),
        database.prepare(`UPDATE document_revision_files SET scan_status='failed'
            WHERE scan_status='pending' AND id IN (SELECT file_id FROM document_scan_jobs WHERE status='failed')`)
    ]);
}

/** @param {D1Database} database Binding. @param {object} input Runner identity and time. @returns {Promise<object|null>} Atomically leased job. */
async function claim(database, input) {
    const leaseUntil = new Date(new Date(input.now).valueOf() + 300_000).toISOString();
    return database.prepare(`UPDATE document_scan_jobs SET status='leased',attempts=attempts+1,
        runner_id=?,lease_token_hash=?,lease_until=?,updated_at=?,object_etag=NULL,content_sha256=NULL
        WHERE id=(SELECT id FROM document_scan_jobs WHERE status='queued' AND available_at<=?
            AND attempts<3 AND ${CURRENT_JOB} ORDER BY available_at,id LIMIT 1)
          AND status='queued' RETURNING *
    `).bind(input.runnerId, input.tokenHash, leaseUntil, input.now, input.now).first();
}

/** @param {D1Database} database Binding. @param {object} input Staff authority and job. @returns {Promise<boolean>} Audited retry. */
async function retry(database, input) {
    const results = await database.batch([
        database.prepare(`UPDATE document_scan_jobs SET status='queued',attempts=0,available_at=?,updated_at=?,
            lease_token_hash=NULL,content_sha256=NULL,object_etag=NULL,outcome=NULL,result_code='operator_retry'
            WHERE id=? AND status='failed' AND EXISTS (
                SELECT 1 FROM document_revision_files AS files JOIN document_revisions AS revisions ON revisions.id=files.revision_id
                WHERE files.id=document_scan_jobs.file_id AND files.scan_status='failed'
                  AND files.upload_status='finalized' AND files.cleanup_status='none' AND revisions.is_current=1)`)
            .bind(input.now, input.now, input.jobId),
        database.prepare(`UPDATE document_revision_files SET scan_status='pending'
            WHERE id=(SELECT file_id FROM document_scan_jobs WHERE id=? AND status='queued') AND changes()=1`).bind(input.jobId),
        database.prepare(`INSERT INTO audit_events(id,event_type,actor_type,actor_staff_id,request_id,safe_metadata_json,created_at)
            SELECT ?,'scanner.retry_requested','staff',?,?,'{"result":"requeued"}',? WHERE changes()=1`)
            .bind(crypto.randomUUID(), input.staffId, input.requestId, input.now)
    ]);
    return results[0].meta.changes === 1;
}

/** @param {D1Database} database Binding. @param {object} input Exact leased job evidence. @returns {Promise<boolean>} Durable result CAS. */
async function persistResult(database, input) {
    const { job, result, now, tokenHash } = input;
    const isRetry = result.outcome === 'failed' && job.attempts < 3;
    const availableAt = new Date(new Date(now).valueOf() + job.attempts * 60_000).toISOString();
    const results = await database.batch([
        database.prepare(`UPDATE document_scan_jobs SET status=?,outcome=?,result_code=?,engine_version=?,signature_version=?,
            signature_updated_at=?,scanned_at=?,updated_at=?,available_at=?
            WHERE id=? AND status='leased' AND lease_token_hash=? AND lease_until>?
              AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND object_etag IS ? AND content_sha256 IS ? AND ${CURRENT_JOB}`)
            .bind(isRetry ? 'queued' : result.outcome === 'failed' ? 'failed' : 'complete', result.outcome, result.result_code,
                result.engine_version, result.signature_version, result.signature_updated_at, result.scanned_at, now,
                availableAt, job.id, tokenHash, now, job.object_etag, job.content_sha256),
        database.prepare(`UPDATE document_revision_files SET scan_status=? WHERE id=? AND revision_id=? AND scan_status='pending'
            AND changes()=1`).bind(isRetry ? 'pending' : result.outcome, job.file_id, job.revision_id),
        database.prepare(`INSERT INTO audit_events(id,event_type,actor_type,document_record_id,request_id,safe_metadata_json,created_at)
            SELECT ?,'scanner.result_recorded','system',document_record_id,?,?,? FROM document_revisions
            WHERE id=? AND changes()=1`).bind(crypto.randomUUID(), `scanner_${crypto.randomUUID()}`, JSON.stringify({ outcome: result.outcome,
                resultCode: result.result_code, attempt: job.attempts }), now, job.revision_id)
    ]);
    return results[0].meta.changes === 1;
}

/** @param {D1Database} database Binding. @param {object} input Current job and digest. @returns {Promise<boolean>} Whether content was pinned. */
async function bindContent(database, { job, tokenHash, now, etag, sha256 }) {
    const changed = await database.prepare(`UPDATE document_scan_jobs SET object_etag=?,content_sha256=?
        WHERE id=? AND status='leased' AND lease_token_hash=? AND lease_until>? AND ${CURRENT_JOB}
          AND lease_until>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (object_etag IS NULL OR object_etag=?)
          AND (content_sha256 IS NULL OR content_sha256=?)`)
        .bind(etag, sha256, job.id, tokenHash, now, etag, sha256).run();
    return changed.meta.changes === 1;
}

/** @param {D1Database} database Binding. @param {object} input Bounded engine metadata. @returns {Promise<void>} Persisted health. */
async function recordHeartbeat(database, input) {
    await database.prepare(`INSERT INTO scanner_heartbeats(runner_id,health,engine_version,signature_version,signature_updated_at,seen_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(runner_id) DO UPDATE SET health=excluded.health,engine_version=excluded.engine_version,
        signature_version=excluded.signature_version,signature_updated_at=excluded.signature_updated_at,seen_at=excluded.seen_at`)
        .bind(input.runner_id,input.health,input.engine_version,input.signature_version,input.signature_updated_at,input.now).run();
}

/** @param {D1Database} database Binding. @returns {Promise<object>} Counts and safe health metadata. */
async function readStatus(database) {
    const [counts, runners, latest, failures] = await Promise.all([
        database.prepare('SELECT status,count(*) AS count FROM document_scan_jobs GROUP BY status').all(),
        database.prepare('SELECT * FROM scanner_heartbeats ORDER BY seen_at DESC LIMIT 10').all(),
        database.prepare("SELECT max(scanned_at) AS last_successful_scan FROM document_scan_jobs WHERE outcome='clean'").first(),
        database.prepare("SELECT id,attempts,result_code,updated_at FROM document_scan_jobs WHERE status='failed' ORDER BY updated_at DESC LIMIT 20").all()
    ]);
    return { jobs: counts.results, runners: runners.results, ...latest, failed_jobs: failures.results };
}

/** Creates durable scanner operations. @param {D1Database} database D1 binding. @returns {object} Scanner repository. */
export function createScannerRepository(database) {
    return Object.freeze({
        reconcile: (now) => reconcile(database, now),
        claim: (input) => claim(database, input),
        retry: (input) => retry(database, input),
        persistResult: (input) => persistResult(database, input),
        findLease: ({ jobId, tokenHash, now }) => database.prepare(`SELECT * FROM document_scan_jobs
            WHERE id=? AND status='leased' AND lease_token_hash=? AND lease_until>? AND ${CURRENT_JOB}`)
            .bind(jobId, tokenHash, now).first(),
        bindContent: (input) => bindContent(database,input),
        heartbeat: (input) => recordHeartbeat(database,input),
        readStatus: () => readStatus(database)
    });
}
