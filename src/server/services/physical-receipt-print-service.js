import { ApiError } from '../domain/errors.js';
import { isPrintEnabled } from '../domain/print-gate.js';
import { readPrintLimits, PRINT_UPLOAD_TTL_MS, PRINT_ROW_RETENTION_MS, PRINT_FAILURE_RETENTION_MS } from '../domain/printPolicy.js';
import { readPrintUatPolicy } from '../domain/print-uat-policy.js';
import { hashScannerValue } from '../domain/scanner-policy.js';
import { createPrintRepository } from '../repositories/d1/printRepository.js';
import { buildPrintIntentStatement } from '../repositories/d1/print-intent-statement.js';
import { readStoredReceiptBytes } from './physical-receipt-content.js';

function requirePrintBindings(environment) {
    if (!isPrintEnabled(environment)) throw new ApiError(503,'PRINT_DISABLED','Yazdırma kapalı.',true);
    if (!environment.PRINT_FILES || !readPrintLimits(environment).isValid || readPrintUatPolicy(environment)) throw new ApiError(503,'PRINT_UNAVAILABLE','Yazdırma kullanılamıyor.',true);
}

function readAttemptDto(attempt) {
    const { id,receipt_id:receiptId,status,blocks_new_attempt:blocks,submission_started_at:started,result_code:resultCode,decision } = attempt;
    return { id,receipt_id:receiptId,status,blocks_new_attempt:blocks,submission_started_at:started,result_code:resultCode,decision };
}

async function buildIntent(context, receipt, creationId) {
    const id = crypto.randomUUID();
    return { id,idempotencyHash:await hashScannerValue(`physical-receipt:${receipt.id}:${creationId}`),
        uploadTokenHash:await hashScannerValue(crypto.randomUUID()),trackingTokenHash:await hashScannerValue(crypto.randomUUID()),
        storageKey:`print/${id}`,mediaType:'application/pdf',byteSize:receipt.byte_size,copies:1,paperSize:'A4',colorMode:'monochrome',
        duplex:'simplex',orientation:'portrait',source:'staff',createdByStaffId:context.staff.id,createdByStaffRole:context.staff.role,
        requiredProtocol:0,now:context.now,expiresAt:new Date(Date.parse(context.now)+PRINT_UPLOAD_TTL_MS).toISOString(),
        purgeAfter:new Date(Date.parse(context.now)+PRINT_ROW_RETENTION_MS).toISOString(),
        heartbeatCutoff:new Date(Date.parse(context.now)-60_000).toISOString() };
}

function buildRiskAcknowledgement(context, options) {
    return context.environment.DB.prepare(`UPDATE physical_receipt_print_attempts SET blocks_new_attempt=0,
        risk_acknowledged_at=?,risk_acknowledged_by=?,risk_reason=? WHERE id=? AND intake_id=? AND blocks_new_attempt=1
        AND status IN ('leased','ready','submission_started','unknown','failed','expired')`)
        .bind(context.now,context.staff.id,options.reason,options.acknowledgedAttemptId,context.intake.id);
}

async function persistAttempt(context, receipt, options) {
    const intent = options.decision === 'manual' ? null : await buildIntent(context,receipt,options.creationId);
    const statements = [];
    if (options.acknowledgedAttemptId) statements.push(buildRiskAcknowledgement(context,options));
    if (intent) statements.push(buildPrintIntentStatement(context.environment.DB,intent));
    statements.push(context.environment.DB.prepare(`INSERT INTO physical_receipt_print_attempts
        (id,intake_id,receipt_id,creation_id,job_id,status,last_known_at,created_by_staff_id,created_at,decision,blocks_new_attempt)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),context.intake.id,receipt.id,options.creationId,intent?.id || null,
            intent ? 'uploading' : 'manual',context.now,context.staff.id,context.now,options.decision,intent ? 1 : 0));
    statements.push(context.environment.DB.prepare(`INSERT INTO audit_events
        (id,event_type,actor_type,actor_staff_id,request_id,safe_metadata_json,created_at) VALUES(?,'physical_receipt.print_decision','staff',?,?,?,?)`)
        .bind(crypto.randomUUID(),context.staff.id,context.requestId,JSON.stringify({physicalIntakeId:context.intake.id,receiptId:receipt.id,
            decision:options.decision,acknowledgedAttemptId:options.acknowledgedAttemptId || null}),context.now));
    try { await context.environment.DB.batch(statements); }
    catch (error) {
        console.error('Receipt print reservation failed.',{errorName:error.name});
        const replay = await context.environment.DB.prepare('SELECT * FROM physical_receipt_print_attempts WHERE creation_id=?').bind(options.creationId).first();
        if (replay?.intake_id===context.intake.id && replay.receipt_id===receipt.id && replay.decision===options.decision) return replay;
        if (/physical_receipt_print_unavailable/.test(String(error.message))) throw new ApiError(503,'PRINT_UNAVAILABLE','Yazıcı veya kuyruk kullanılamıyor.',true);
        if (/UNIQUE|physical_receipt_snapshot_stale|physical_receipt_reprint_required|physical_receipt_print_blocked/.test(String(error.message))) throw new ApiError(409,'PRINT_ATTEMPT_CONFLICT','Mevcut baskıyı ve güncel A4 sürümünü kontrol edin.');
        throw error;
    }
    return context.environment.DB.prepare('SELECT * FROM physical_receipt_print_attempts WHERE creation_id=?').bind(options.creationId).first();
}

/** Creates exactly one server-owned print attempt or records explicit manual printing. @param {object} context Staff scope. @param {object} receipt Ready document. @param {object} options Decision UUID/risk.
 * @returns {Promise<object>} Persistent attempt. @throws {ApiError} Stale, blocked or unavailable print. */
export async function createReceiptPrint(context, receipt, options) {
    const replay = await context.environment.DB.prepare('SELECT * FROM physical_receipt_print_attempts WHERE creation_id=?').bind(options.creationId).first();
    if (replay) {
        if (replay.intake_id!==context.intake.id || replay.receipt_id!==receipt.id || replay.decision!==options.decision) throw new ApiError(409,'PRINT_ATTEMPT_CONFLICT','İşlem kimliği farklı basım için kullanılmış.');
        return options.decision === 'manual' ? readAttemptDto(replay) : resumeReceiptPrint(context,replay);
    }
    if (receipt.expires_at<=context.now) throw new ApiError(409,'RECEIPT_EXPIRED','Yeni A4 sürümü hazırlayın.');
    if (receipt.state!=='ready' || receipt.metadata_version!==context.intake.metadata_version) throw new ApiError(409,'RECEIPT_STALE','Güncel A4 hazırlayın.');
    if (!JSON.parse(receipt.snapshot_json).portal_origin) throw new ApiError(503,'PORTAL_ORIGIN_INVALID','Portal adresi yapılandırılmalı.');
    const attempts = (await context.receipts.attempts(context.intake.id)).results;
    if (options.decision==='print' && attempts.length) throw new ApiError(409,'REPRINT_REQUIRED','Yeni baskı için açık yeniden basım kararı gerekli.');
    const blocking = attempts.find(attempt=>attempt.blocks_new_attempt===1);
    if (blocking && (options.acknowledgedAttemptId!==blocking.id || !options.reason || options.reason.trim().length<5)) throw new ApiError(409,'PRINT_BLOCKED','Mevcut baskı tamamlanmalı, güvenle iptal edilmeli veya fiziksel kontrol teyidi alınmalı.');
    if (blocking && ['uploading','queued'].includes(blocking.status)) throw new ApiError(409,'PRINT_BLOCKED','Önce mevcut işi güvenle iptal edin.');
    await readStoredReceiptBytes(context.environment,receipt);
    if (options.decision!=='manual') requirePrintBindings(context.environment);
    const attempt = await persistAttempt(context,receipt,options);
    return options.decision==='manual' ? readAttemptDto(attempt) : resumeReceiptPrint(context,attempt);
}

async function copyPrintObject(context, receipt, job) {
    const bytes = await readStoredReceiptBytes(context.environment,receipt);
    await context.environment.PRINT_FILES.put(job.storage_key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/pdf'},customMetadata:{sha256:receipt.sha256}});
    const object = await context.environment.PRINT_FILES.get(job.storage_key);
    if (!object || object.size!==receipt.byte_size || await hashScannerValue(new Uint8Array(await object.arrayBuffer()))!==receipt.sha256) throw new ApiError(409,'PRINT_UPLOAD_INVALID','Baskı içeriği doğrulanamadı.');
}

/** Resumes the same job using staff authorization rather than a browser bearer token. @param {object} context Staff scope. @param {object} attempt Durable attempt.
 * @returns {Promise<object>} Current attempt. @throws {ApiError} Expired, blocked or unavailable upload. */
export async function resumeReceiptPrint(context, attempt) {
    if (attempt.intake_id!==context.intake.id) throw new ApiError(404,'NOT_FOUND','Baskı bulunamadı.');
    const job = attempt.job_id ? await context.environment.DB.prepare('SELECT * FROM print_jobs WHERE id=?').bind(attempt.job_id).first() : null;
    if (!job) return recoverMissingPrintJob(context, attempt);
    if (job.status!=='uploading') return readAttemptDto(attempt);
    requirePrintBindings(context.environment);
    if (job.expires_at<=context.now || job.cleanup_status!=='none') {
        await context.environment.DB.prepare(`UPDATE print_jobs SET status='expired',updated_at=? WHERE id=? AND status='uploading' AND submission_started_at IS NULL`).bind(context.now,job.id).run();
        return readAttemptDto(await context.receipts.attempt(attempt.id));
    }
    const receipt = await context.receipts.receipt(attempt.receipt_id);
    if (receipt.metadata_version!==context.intake.metadata_version) throw new ApiError(409,'RECEIPT_STALE','Bilgiler değişti; eski işi iptal edip yeni A4 hazırlayın.');
    const repository = createPrintRepository(context.environment.DB);
    const status = await repository.readPublicStatus(context.now,readPrintLimits(context.environment),job.id);
    if (!status.available) throw new ApiError(503,status.queuePaused?'PRINT_QUEUE_PAUSED':'PRINT_UNAVAILABLE','Yazıcı veya kuyruk kullanılamıyor.',true);
    await copyPrintObject(context,receipt,job);
    const queued = await repository.markQueued({id:job.id,tokenHash:job.upload_token_hash,now:context.now,requiresQueueOpen:true,
        expiresAt:new Date(Date.parse(context.now)+PRINT_FAILURE_RETENTION_MS).toISOString()});
    const saved = await context.receipts.attempt(attempt.id);
    if (!queued && saved.status==='uploading') throw new ApiError(503,'PRINT_UNAVAILABLE','Baskı kuyruğa alınamadı. Aynı işten devam edin.',true);
    return readAttemptDto(saved);
}

/** Cancels only unclaimed receipt jobs; never assumes an Agent job stopped. @param {object} context Staff. @param {object} attempt Scoped attempt.
 * @returns {Promise<object>} Confirmed result. @throws {ApiError} Unsafe cancellation. */
export async function cancelReceiptPrint(context, attempt) {
    const cancelled = await createPrintRepository(context.environment.DB).cancelJob({id:attempt.job_id,expectedStatus:attempt.status,
        actorStaffId:context.staff.id,actorRole:context.staff.role,now:context.now});
    const saved = await context.receipts.attempt(attempt.id);
    if (!cancelled && saved.status!=='cancelled') throw new ApiError(409,'PRINT_CANCEL_UNSAFE','İş Agent tarafından alınmış olabilir. Fiziksel sonucu kontrol edin.');
    return readAttemptDto(saved);
}

async function recoverMissingPrintJob(context, attempt) {
        if (!['manual','submitted','failed','cancelled','expired','unknown'].includes(attempt.status)) {
            await context.environment.DB.prepare(`UPDATE physical_receipt_print_attempts SET status='unknown',last_known_at=?,
                blocks_new_attempt=CASE WHEN risk_acknowledged_at IS NULL THEN 1 ELSE 0 END WHERE id=?`).bind(context.now,attempt.id).run();
            return readAttemptDto(await context.receipts.attempt(attempt.id));
        }
        return readAttemptDto(attempt);
}
