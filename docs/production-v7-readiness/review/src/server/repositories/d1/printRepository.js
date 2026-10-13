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
            const [heartbeat, queue] = await Promise.all([
                database.prepare(`SELECT health, seen_at, settings_protocol FROM printer_heartbeats
                    ORDER BY seen_at DESC LIMIT 1`).first(),
                database.prepare(`SELECT count(*) AS count FROM print_jobs WHERE status IN
                    ('uploading','queued','leased','ready','submission_started') AND cleanup_status='none'`).first()
            ]);
            const heartbeatAge = heartbeat ? Date.parse(now) - Date.parse(heartbeat.seen_at) : Infinity;
            const heartbeatIsFresh = heartbeat && heartbeat.health === 'ready' && heartbeatAge >= -30_000 && heartbeatAge <= 60_000;
            const settingsProtocol = heartbeatIsFresh ? heartbeat?.settings_protocol || 0 : 0;
            return { available: Boolean(heartbeatIsFresh && queue.count < MAX_PENDING_PRINT_JOBS && limits.isValid),
                settingsProtocol, limits: { max_copies: settingsProtocol >= 2 ? limits.maxCopies : Math.min(limits.maxCopies, 3),
                    max_page_copies: limits.maxPageCopies } };
        },
        async createUploadIntent(input) {
            const orientation = input.orientation || 'portrait';
            const result = await database.prepare(`INSERT INTO print_jobs (
                id,idempotency_key_hash,upload_token_hash,tracking_token_hash,storage_key,media_type,byte_size,copies,
                paper_size,color_mode,duplex,orientation,
                status,available_at,created_at,updated_at,expires_at,purge_after
            ) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,'uploading',?,?,?,?,?
              WHERE (SELECT count(*) FROM print_jobs WHERE status IN
                    ('uploading','queued','leased','ready','submission_started') AND cleanup_status='none') < ?
                AND (SELECT health FROM printer_heartbeats ORDER BY seen_at DESC LIMIT 1)='ready'
                AND (SELECT seen_at FROM printer_heartbeats ORDER BY seen_at DESC LIMIT 1)>=?
                AND (SELECT settings_protocol FROM printer_heartbeats ORDER BY seen_at DESC LIMIT 1)>=?
                AND (? IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ','now') < ?)
                ON CONFLICT(idempotency_key_hash) DO NOTHING
            RETURNING *`).bind(input.id, input.idempotencyHash, input.uploadTokenHash, input.trackingTokenHash,
                input.storageKey, input.mediaType, input.byteSize, input.copies, input.paperSize, input.colorMode,
                input.duplex, orientation, input.now, input.now, input.now, input.expiresAt, input.purgeAfter,
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
            const [heartbeat, jobs] = await Promise.all([
                database.prepare(`SELECT printer_id,runner_id,health,printer_name,seen_at FROM printer_heartbeats
                    ORDER BY seen_at DESC LIMIT 1`).first(),
                database.prepare(`SELECT status,count(*) AS count FROM print_jobs GROUP BY status`).all()
            ]);
            const heartbeatAge = heartbeat ? Date.parse(now) - Date.parse(heartbeat.seen_at) : Infinity;
            const online = Boolean(heartbeat && heartbeat.health === 'ready' && heartbeatAge >= -30_000 && heartbeatAge <= 60_000);
            return { printer: heartbeat ? { ...heartbeat, online } : { online: false }, jobs: jobs.results };
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
