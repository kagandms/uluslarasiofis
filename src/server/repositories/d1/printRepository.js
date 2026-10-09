import {
    DEFAULT_PRINT_LIMITS, MAX_PENDING_PRINT_JOBS, PRINT_FAILURE_RETENTION_MS, PRINT_LEASE_MS, PRINT_MAX_ATTEMPTS,
    PRINT_ROW_RETENTION_MS, PRINT_SUCCESS_RETENTION_MS
} from '../../domain/printPolicy.js';

function addMilliseconds(value, amount) {
    return new Date(Date.parse(value) + amount).toISOString();
}

export function createPrintRepository(database) {
    if (!database) throw new TypeError('A D1 database binding is required.');
    return Object.freeze({
        async readPublicStatus(now, limits = DEFAULT_PRINT_LIMITS) {
            const [heartbeat, queue, controls] = await Promise.all([
                database.prepare(`SELECT health, seen_at, settings_protocol FROM printer_heartbeats
                    ORDER BY seen_at DESC LIMIT 1`).first(),
                database.prepare(`SELECT count(*) AS count FROM print_jobs WHERE status IN
                    ('uploading','queued','leased','ready','submission_started') AND cleanup_status='none'`).first(),
                database.prepare(`SELECT is_paused FROM print_queue_controls WHERE id='global'`).first()
            ]);
            const heartbeatAge = heartbeat ? Date.parse(now) - Date.parse(heartbeat.seen_at) : Infinity;
            const heartbeatIsFresh = heartbeat && heartbeat.health === 'ready' && heartbeatAge >= -30_000 && heartbeatAge <= 60_000;
            const settingsProtocol = heartbeatIsFresh ? heartbeat?.settings_protocol || 0 : 0;
            return { available: Boolean(heartbeatIsFresh && queue.count < MAX_PENDING_PRINT_JOBS && limits.isValid
                    && controls?.is_paused === 0), queuePaused: controls?.is_paused !== 0,
                settingsProtocol, limits: { max_copies: settingsProtocol >= 2 ? limits.maxCopies : Math.min(limits.maxCopies, 3),
                    max_page_copies: limits.maxPageCopies } };
        },
        async createUploadIntent(input) {
            const orientation = input.orientation || 'portrait';
            const result = await database.prepare(`INSERT INTO print_jobs (
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
                input.duplex, orientation, input.source || 'student', input.createdByStaffId || null,
                input.createdByStaffRole || null,
                input.now, input.now, input.now, input.expiresAt, input.purgeAfter,
                MAX_PENDING_PRINT_JOBS, input.heartbeatCutoff, input.requiredProtocol || 0,
                input.uatExpiresAt || null, input.uatExpiresAt || null).first();
            if (result) return result;
            const existing = await database.prepare('SELECT * FROM print_jobs WHERE idempotency_key_hash=?').bind(input.idempotencyHash).first();
            if (existing && existing.upload_token_hash === input.uploadTokenHash
                && existing.tracking_token_hash === input.trackingTokenHash && existing.byte_size === input.byteSize
                && existing.media_type === input.mediaType && existing.copies === input.copies
                && existing.paper_size === input.paperSize && existing.color_mode === input.colorMode
                && existing.duplex === input.duplex && existing.orientation === orientation) return existing;
            return null;
        },
        findByIdempotencyHash: (hash) => database.prepare('SELECT * FROM print_jobs WHERE idempotency_key_hash=?').bind(hash).first(),
        findUploadIntent: ({ id, tokenHash, now }) => database.prepare(`SELECT * FROM print_jobs
            WHERE id=? AND upload_token_hash=? AND status='uploading' AND expires_at>? AND cleanup_status='none'`)
            .bind(id, tokenHash, now).first(),
        markQueued: async ({ id, tokenHash, now, expiresAt, uatExpiresAt = null }) => {
            const result = await database.prepare(`UPDATE print_jobs SET status='queued',page_count=NULL,
                available_at=?,updated_at=?,expires_at=? WHERE id=? AND upload_token_hash=?
                AND status='uploading' AND expires_at>? AND cleanup_status='none'
                AND (SELECT health FROM printer_heartbeats ORDER BY seen_at DESC LIMIT 1)='ready'
                AND (SELECT seen_at FROM printer_heartbeats ORDER BY seen_at DESC LIMIT 1)>=?
                AND (SELECT count(*) FROM print_jobs WHERE status IN
                    ('uploading','queued','leased','ready','submission_started') AND cleanup_status='none' AND id<>?) < ?
                AND (? IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ','now') < ?)`)
                .bind(now, now, expiresAt, id, tokenHash, now,
                    new Date(Date.parse(now) - 60_000).toISOString(), id, MAX_PENDING_PRINT_JOBS,
                    uatExpiresAt, uatExpiresAt).run();
            return result.meta.changes === 1;
        },
        async claim({ now, runnerId, leaseTokenHash, limits = DEFAULT_PRINT_LIMITS,
            jobId = null, minimumProtocol = 0, uatExpiresAt = null }) {
            const leaseUntil = addMilliseconds(now, PRINT_LEASE_MS);
            return database.prepare(`UPDATE print_jobs SET status='leased',attempts=attempts+1,runner_id=?,
                lease_token_hash=?,lease_until=?,updated_at=?
                WHERE id=(SELECT id FROM print_jobs WHERE status='queued' AND available_at<=?
                    AND (? IS NULL OR id=?)
                    AND (? IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ','now') < ?)
                    AND attempts<? AND cleanup_status='none'
                    AND (SELECT is_paused FROM print_queue_controls WHERE id='global')=0
                    AND EXISTS (SELECT 1 FROM printer_heartbeats WHERE runner_id=? AND health='ready'
                        AND settings_protocol>=?
                        AND seen_at>=? AND ((settings_protocol>=3 AND copies<=?) OR
                            (settings_protocol=2 AND copies<=? AND orientation='portrait') OR
                            (settings_protocol=1 AND copies<=3 AND orientation='portrait') OR
                            (settings_protocol=0 AND copies<=3 AND orientation='portrait' AND paper_size='A4'
                                AND color_mode='monochrome' AND duplex='simplex')))
                    ORDER BY created_at,id LIMIT 1)
                AND status='queued' RETURNING *`).bind(runnerId, leaseTokenHash, leaseUntil, now,
                    now, jobId, jobId, uatExpiresAt, uatExpiresAt, PRINT_MAX_ATTEMPTS, runnerId,
                    minimumProtocol, new Date(Date.parse(now) - 60_000).toISOString(),
                    limits.maxCopies, limits.maxCopies).first();
        },
        findLease: ({ id, tokenHash, now }) => database.prepare(`SELECT * FROM print_jobs
            WHERE id=? AND status IN ('leased','ready','submission_started') AND lease_token_hash=?
            AND lease_until>? AND cleanup_status='none'`).bind(id, tokenHash, now).first(),
        markReady: async ({ id, tokenHash, now, pageCount, maxPageCopies = 200, uatExpiresAt = null }) => {
            const result = await database.prepare(`UPDATE print_jobs SET status='ready',page_count=?,updated_at=?
                WHERE id=? AND status='leased' AND lease_token_hash=? AND lease_until>? AND cleanup_status='none'
                AND ? * copies <= ?
                AND (? IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ','now') < ?)`)
                .bind(pageCount, now, id, tokenHash, now, pageCount, maxPageCopies, uatExpiresAt, uatExpiresAt).run();
            return result.meta.changes === 1;
        },
        markValidationFailed: async ({ id, tokenHash, now, resultCode }) => {
            const result = await database.prepare(`UPDATE print_jobs SET status='failed',result_code=?,updated_at=?,
                expires_at=? WHERE id=? AND status='leased' AND lease_token_hash=? AND lease_until>?`)
                .bind(resultCode, now, addMilliseconds(now, PRINT_FAILURE_RETENTION_MS), id, tokenHash, now).run();
            return result.meta.changes === 1;
        },
        touchLease: async ({ id, tokenHash, now }) => {
            const result = await database.prepare(`UPDATE print_jobs SET lease_until=?,updated_at=?
                WHERE id=? AND status='leased' AND lease_token_hash=? AND lease_until>?`)
                .bind(addMilliseconds(now, PRINT_LEASE_MS), now, id, tokenHash, now).run();
            return result.meta.changes === 1;
        },
        markSubmissionStarted: async ({ id, tokenHash, now, uatExpiresAt = null }) => {
            const result = await database.prepare(`UPDATE print_jobs SET status='submission_started',
                submission_started_at=?,updated_at=? WHERE id=? AND status='ready'
                AND lease_token_hash=? AND lease_until>? AND cleanup_status='none'
                AND (? IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ','now') < ?)`)
                .bind(now, now, id, tokenHash, now, uatExpiresAt, uatExpiresAt).run();
            return result.meta.changes === 1;
        },
        async recordResult({ id, tokenHash, now, result }) {
            const resultTime = result.status === 'submitted' ? addMilliseconds(now, PRINT_SUCCESS_RETENTION_MS)
                : addMilliseconds(now, PRINT_FAILURE_RETENTION_MS);
            const changed = await database.prepare(`UPDATE print_jobs SET status=?,result_code=?,spooler_job_id=?,
                updated_at=?,expires_at=? WHERE id=? AND status='submission_started'
                AND lease_token_hash=? AND lease_until>? AND cleanup_status='none'`)
                .bind(result.status, result.resultCode, result.spoolerJobId, now, resultTime, id, tokenHash, now).run();
            if (changed.meta.changes === 1) return true;
            const existing = await database.prepare(`SELECT status,result_code FROM print_jobs
                WHERE id=? AND lease_token_hash=?`).bind(id, tokenHash).first();
            return existing?.status === result.status && existing.result_code === result.resultCode;
        },
        async heartbeat(input) {
            await database.prepare(`INSERT INTO printer_heartbeats(
                printer_id,runner_id,health,printer_name,seen_at,settings_protocol
            ) VALUES(?,?,?,?,?,?) ON CONFLICT(printer_id) DO UPDATE SET runner_id=excluded.runner_id,
                health=excluded.health,printer_name=excluded.printer_name,seen_at=excluded.seen_at,
                settings_protocol=excluded.settings_protocol`)
                .bind(input.printerId, input.runnerId, input.health, input.printerName, input.now,
                    input.settingsProtocol || 0).run();
        },
        async readStaffStatus(now) {
            const [heartbeat, jobs, controls] = await Promise.all([
                database.prepare(`SELECT printer_id,runner_id,health,printer_name,seen_at FROM printer_heartbeats
                    ORDER BY seen_at DESC LIMIT 1`).first(),
                database.prepare(`SELECT status,count(*) AS count FROM print_jobs GROUP BY status`).all(),
                database.prepare(`SELECT is_paused,updated_by_staff_id,updated_at,version
                    FROM print_queue_controls WHERE id='global'`).first()
            ]);
            const heartbeatAge = heartbeat ? Date.parse(now) - Date.parse(heartbeat.seen_at) : Infinity;
            const online = Boolean(heartbeat && heartbeat.health === 'ready' && heartbeatAge >= -30_000 && heartbeatAge <= 60_000);
            const pendingStatuses = new Set(['uploading', 'queued', 'leased', 'ready', 'submission_started']);
            const counts = Object.fromEntries(jobs.results.map(({ status, count }) => [status, count]));
            const pending = jobs.results.reduce((sum, job) => sum + (pendingStatuses.has(job.status) ? job.count : 0), 0);
            return { printer: heartbeat ? { ...heartbeat, online } : { online: false }, jobs: jobs.results,
                counts: { pending, processing: (counts.leased || 0) + (counts.ready || 0) + (counts.submission_started || 0),
                    submitted: counts.submitted || 0, queued: counts.queued || 0 },
                queue: controls ? { paused: controls.is_paused === 1, updated_by_staff_id: controls.updated_by_staff_id,
                    updated_at: controls.updated_at, version: controls.version }
                    : { paused: true, updated_by_staff_id: null, updated_at: null, version: null } };
        },
        async listStaffJobs({ status = null, source = null, from = null, to = null, limit = 25,
            beforeCreatedAt = null, beforeId = null, now = new Date().toISOString() }) {
            const activeOnly = status === 'active' ? 1 : 0;
            const selectedStatus = activeOnly ? null : status;
            const result = await database.prepare(`SELECT id,source,status,media_type,byte_size,page_count,copies,
                paper_size,color_mode,duplex,orientation,created_by_staff_id,created_at,updated_at,expires_at,
                runner_id,lease_until,submission_started_at,spooler_job_id,result_code
                FROM print_jobs WHERE purge_after>?
                    AND (?=0 OR status IN ('uploading','queued','leased','ready','submission_started'))
                    AND (? IS NULL OR status=?) AND (? IS NULL OR source=?)
                    AND (? IS NULL OR created_at>=?) AND (? IS NULL OR created_at<?)
                    AND (? IS NULL OR created_at<? OR (created_at=? AND id<?))
                ORDER BY created_at DESC,id DESC LIMIT ?`).bind(now, activeOnly, selectedStatus, selectedStatus,
                source, source, from, from, to, to, beforeCreatedAt, beforeCreatedAt, beforeCreatedAt,
                beforeId, limit + 1).all();
            const jobs = result.results.slice(0, limit);
            const hasMore = result.results.length > limit;
            return { jobs, hasMore, nextCursor: hasMore && jobs.length
                ? { created_at: jobs[jobs.length - 1].created_at, id: jobs[jobs.length - 1].id } : null };
        },
        findStaffJobControlState(id) {
            return database.prepare(`SELECT id,status,runner_id,lease_token_hash,submission_started_at,cleanup_status
                FROM print_jobs WHERE id=?`).bind(id).first();
        },
        async setQueuePaused({ paused, actorStaffId, actorRole, now }) {
            const eventType = paused ? 'queue_paused' : 'queue_resumed';
            const result = await database.batch([
                database.prepare(`UPDATE print_queue_controls SET is_paused=?,updated_by_staff_id=?,updated_at=?,version=version+1
                    WHERE id='global' AND is_paused<>?`).bind(paused ? 1 : 0, actorStaffId, now, paused ? 1 : 0),
                database.prepare(`INSERT INTO print_queue_audit
                    (id,event_type,actor_staff_id,actor_role,occurred_at)
                    SELECT ?,?,?,?,? WHERE changes()=1`).bind(crypto.randomUUID(), eventType,
                    actorStaffId, actorRole, now)
            ]);
            return result[0].meta.changes === 1;
        },
        async cancelJob({ id, expectedStatus, actorStaffId, actorRole, now }) {
            if (!['uploading', 'queued'].includes(expectedStatus)) return false;
            const result = await database.batch([
                database.prepare(`UPDATE print_jobs SET status='cancelled',result_code='cancelled_by_staff',
                    upload_token_hash=NULL,lease_token_hash=NULL,lease_until=NULL,runner_id=NULL,updated_at=?
                    WHERE id=? AND status=? AND status IN ('uploading','queued') AND runner_id IS NULL
                    AND lease_token_hash IS NULL AND submission_started_at IS NULL AND cleanup_status='none'`)
                    .bind(now, id, expectedStatus),
                database.prepare(`INSERT INTO print_queue_audit
                    (id,event_type,actor_staff_id,actor_role,job_id,previous_status,occurred_at)
                    SELECT ?, 'job_cancelled', ?, ?, ?, ?, ? WHERE changes()=1`).bind(
                    crypto.randomUUID(), actorStaffId, actorRole, id, expectedStatus, now)
            ]);
            return result[0].meta.changes === 1;
        },
        findByTrackingHash: (hash) => database.prepare(`SELECT status FROM print_jobs
            WHERE tracking_token_hash=? AND purge_after>?`).bind(hash, new Date().toISOString()).first(),
        listSubmissionStarted: (runnerId) => database.prepare(`SELECT id,submission_started_at,spooler_job_id
            FROM print_jobs WHERE status='submission_started' AND runner_id=? ORDER BY submission_started_at`)
            .bind(runnerId).all().then((result) => result.results),
        async reconcile(now) {
            const expiredLeaseTime = new Date(Date.parse(now) - PRINT_LEASE_MS).toISOString();
            await database.batch([
                database.prepare(`UPDATE print_jobs SET status=CASE WHEN attempts<? THEN 'queued' ELSE 'failed' END,
                    result_code='lease_expired',lease_token_hash=NULL,lease_until=NULL,runner_id=NULL,updated_at=?
                    WHERE status IN ('leased','ready') AND lease_until<=? AND submission_started_at IS NULL
                    AND cleanup_status='none'`).bind(PRINT_MAX_ATTEMPTS, now, now),
                database.prepare(`UPDATE print_jobs SET status='unknown',result_code='submission_unknown',updated_at=?
                    WHERE status='submission_started' AND submission_started_at<=? AND cleanup_status='none'`)
                    .bind(now, expiredLeaseTime),
                database.prepare(`UPDATE print_jobs SET status='expired',lease_token_hash=NULL,lease_until=NULL,updated_at=?
                    WHERE status IN ('uploading','queued','leased','ready') AND expires_at<=?
                    AND submission_started_at IS NULL AND cleanup_status='none'`).bind(now, now),
                database.prepare(`UPDATE print_jobs SET cleanup_status='pending',updated_at=? WHERE expires_at<=?
                    AND status IN ('expired','failed','unknown','submitted','cancelled') AND cleanup_status='none'`)
                    .bind(now, now),
                database.prepare(`UPDATE print_jobs SET cleanup_status='complete',storage_deleted_at=?,updated_at=?
                    WHERE cleanup_status='pending' AND storage_key IS NULL`).bind(now, now)
            ]);
            const result = await database.prepare(`SELECT id,storage_key FROM print_jobs WHERE cleanup_status='pending'
                AND storage_key IS NOT NULL ORDER BY expires_at LIMIT 50`).all();
            return result.results;
        },
        async markObjectDeleted({ id, now }) {
            const result = await database.prepare(`UPDATE print_jobs SET storage_key=NULL,cleanup_status='complete',
                storage_deleted_at=?,upload_token_hash=NULL,updated_at=? WHERE id=? AND cleanup_status='pending'`)
                .bind(now, now, id).run();
            return result.meta.changes === 1;
        },
        async incrementCleanupAttempt({ id, now }) {
            await database.prepare(`UPDATE print_jobs SET cleanup_attempts=cleanup_attempts+1,updated_at=?
                WHERE id=? AND cleanup_status='pending'`).bind(now, id).run();
        },
        purgeOldRows: async (now) => database.prepare(`DELETE FROM print_jobs
            WHERE cleanup_status='complete' AND purge_after<=?`).bind(now).run()
    });
}
