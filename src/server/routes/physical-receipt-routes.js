import { isPhysicalReceiptCreationEnabled, hasPhysicalReceiptSchema } from '../config/physical-receipt-config.js';
import { ApiError } from '../domain/errors.js';
import { readCookie,hashSessionToken } from '../auth/sessionToken.js';
import { readJsonBody } from '../http/requestBody.js';
import { requireMethod } from './shared.js';
import { createRateLimitRepository } from '../repositories/d1/rateLimitRepository.js';
import { consumePublicRateLimit } from '../security/requestRateLimit.js';
import { createPhysicalReceiptRepository } from '../repositories/d1/physical-receipt-repository.js';
import { readIstanbulDay,readReceiptPortalOrigin,requireReceiptUuid,validateReceiptMetadata } from '../domain/physical-tracking-policy.js';
import { requirePhysicalVersion,requirePhysicalRejectionReason } from '../domain/physical-intake-policy.js';
import { reservePhysicalReference,registerPhysicalReceipt } from './physical-receipt-registration.js';
import { bindReceiptContent,readReceiptPdfBody,readStoredReceiptBytes } from '../services/physical-receipt-content.js';
import { createReceiptPrint,resumeReceiptPrint,cancelReceiptPrint } from '../services/physical-receipt-print-service.js';

function readReceiptDto(receipt,intake) {
    return { id:receipt.id,intake_id:receipt.intake_id,document_version:receipt.document_version,snapshot:JSON.parse(receipt.snapshot_json),
        template_version:receipt.template_version,metadata_version:receipt.metadata_version,state:receipt.state,
        sha256:receipt.sha256,byte_size:receipt.byte_size,is_stale:receipt.metadata_version!==intake.metadata_version,is_expired:Date.parse(receipt.expires_at)<=Date.now(),expires_at:receipt.expires_at };
}

async function enforceStaffLimit(context,kind) {
    const repository = createRateLimitRepository(context.environment.DB);
    const limits = kind==='resume' ? [[context.sessionHash,120,60,'session']] : [[context.sessionHash,60,300,'session'],[context.staff.id,120,300,'staff']];
    for (const [identity,maxRequests,windowSeconds,scope] of limits) {
        if (!await consumePublicRateLimit(repository,{endpoint:`physical-receipt-${kind}-${scope}`,identity,
            nowSeconds:Math.floor(Date.parse(context.now)/1000),maxRequests,windowSeconds})) throw new ApiError(429,'RATE_LIMITED','Bir süre sonra tekrar deneyin.',true);
    }
}

async function readContext(request,context) {
    const receipts = createPhysicalReceiptRepository(context.environment.DB);
    const sessionHash = await hashSessionToken(readCookie(request,'staff_session'));
    return {...context,receipts,sessionHash};
}

async function mutateMetadata(request,context,action) {
    requireMethod(request,action==='metadata'?'PATCH':'POST');
    const body = await readJsonBody(request,8192);
    const version = requirePhysicalVersion(body.lock_version);
    let changed;
    try {
        if (action==='metadata') {
            const {lock_version: ignoredVersion,...fields}=body;
            changed=await context.receipts.mutateMetadata({metadata:validateReceiptMetadata(fields),version,intakeId:context.intake.id,
                staffId:context.staff.id,requestId:context.requestId,now:context.now});
        } else {
            if (Object.keys(body).some(key=>!['lock_version','reason'].includes(key))) throw new ApiError(400,'VALIDATION_ERROR','İstek alanları geçersiz.');
            if (action==='reopen' && context.staff.role!=='admin') throw new ApiError(403,'FORBIDDEN','Yeniden açma admin yetkisindedir.');
            changed=await context.receipts.closeProcessing({version,intakeId:context.intake.id,isReopening:action==='reopen',
                reason:requirePhysicalRejectionReason(body.reason),staffId:context.staff.id,requestId:context.requestId,now:context.now});
        }
    } catch (error) {
        console.error('Physical metadata update failed.',{errorName:error.name});
        if (/physical_active_passport_conflict|UNIQUE/.test(String(error.message))) throw new ApiError(409,'PHYSICAL_ALREADY_EXISTS','Bu pasaport/tür için aktif kayıt var.');
        throw error;
    }
    if (!changed) throw new ApiError(409,'PHYSICAL_UPDATE_CONFLICT','Kayıt değişti veya kapalı. Yenileyin.');
    return {intake:await context.repository.find(context.intake.id)};
}

async function createDocument(request,context) {
    requireMethod(request,'POST');
    const body=await readJsonBody(request,2048);
    if (Object.keys(body).some(key=>!['creation_id','lock_version'].includes(key))) throw new ApiError(400,'VALIDATION_ERROR','İstek alanları geçersiz.');
    const creationId=requireReceiptUuid(body.creation_id);
    const existing=await context.receipts.byCreation(creationId);
    if (existing) {
        if (existing.intake_id!==context.intake.id) throw new ApiError(409,'RECEIPT_CONFLICT','İşlem kimliği başka kayda ait.');
        return readReceiptDto(existing,context.intake);
    }
    if (requirePhysicalVersion(body.lock_version)!==context.intake.lock_version || context.intake.deleted_at || !context.intake.tracking_reference) throw new ApiError(409,'PHYSICAL_UPDATE_CONFLICT','Güncel takip kaydı gerekli.');
    const portalOrigin=readReceiptPortalOrigin(context.environment);
    if (!portalOrigin) throw new ApiError(503,'PORTAL_ORIGIN_INVALID','Portal adresi yapılandırılmalı.');
    const receipt=await context.receipts.createReceipt({intake:context.intake,creationId,receiptId:crypto.randomUUID(),portalOrigin,
        now:context.now,staffId:context.staff.id,requestId:context.requestId});
    if (!receipt) throw new ApiError(409,'RECEIPT_STALE','Bilgiler değişti; kaydı yenileyin.');
    return readReceiptDto(receipt,context.intake);
}

async function routeDocument(request,context,match) {
    const receipt=await context.receipts.receipt(match[3]);
    if (!receipt || receipt.intake_id!==context.intake.id || context.intake.deleted_at) throw new ApiError(404,'NOT_FOUND','A4 bulunamadı.');
    if (match[4]==='content') {
        requireMethod(request,'PUT');
        return readReceiptDto(await bindReceiptContent(context,receipt,await readReceiptPdfBody(request)),context.intake);
    }
    if (match[4]==='print') {
        requireMethod(request,'POST');
        const body=await readJsonBody(request,8192);
        if (Object.keys(body).some(key=>!['creation_id','decision','acknowledged_attempt_id','risk_confirmed','reason'].includes(key)) || !['print','reprint','manual'].includes(body.decision)) throw new ApiError(400,'VALIDATION_ERROR','Basım kararı geçersiz.');
        const creationId=requireReceiptUuid(body.creation_id);
        const replay=await context.environment.DB.prepare('SELECT id FROM physical_receipt_print_attempts WHERE creation_id=?').bind(creationId).first();
        if (!replay) await enforceStaffLimit(context,'print');
        return createReceiptPrint(context,receipt,{creationId,decision:body.decision,
            acknowledgedAttemptId:body.risk_confirmed===true?requireReceiptUuid(body.acknowledged_attempt_id):null,
            reason:body.risk_confirmed===true?requirePhysicalRejectionReason(body.reason):null});
    }
    requireMethod(request,'GET');
    if (!new URL(request.url).searchParams.has('download') && !new URL(request.url).searchParams.has('preview')) return readReceiptDto(receipt,context.intake);
    const lease=await context.environment.DB.prepare(`UPDATE physical_intake_receipts SET download_lease_until=? WHERE id=? AND state='ready' AND purge_claim_until IS NULL`).bind(new Date(Date.parse(context.now)+120_000).toISOString(),receipt.id).run();
    if (!lease.meta.changes) throw new ApiError(409,'RECEIPT_PURGED','Yeni A4 sürümü hazırlayın.');
    const bytes=await readStoredReceiptBytes(context.environment,receipt);
    return new Response(bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':`${new URL(request.url).searchParams.has('preview')?'inline':'attachment'}; filename="${context.intake.tracking_reference}.pdf"`,
        'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}});
}

/** Handles additive receipt routes; null delegates to legacy endpoints. @param {Request} request Staff. @param {object} baseContext Authorized context. @param {string} pathname Route.
 * @returns {Promise<object|Response|null>} Route result. @throws {ApiError} Authority, scope or state violation. */
export async function handlePhysicalReceiptRoute(request,baseContext,pathname) {
    const match=pathname.match(/^\/api\/staff\/physical-intakes\/([0-9a-f-]{36})\/(metadata|close|reopen|receipts(?:\/([0-9a-f-]{36})(?:\/(content|print))?)?|print-attempts(?:\/([0-9a-f-]{36})\/(resume|cancel))?)$/i);
    const isRoot=['config','reference-reservations','registrations'].some(action=>pathname===`/api/staff/physical-intakes/${action}`);
    if (!match && !isRoot) return null;
    if (!await hasPhysicalReceiptSchema(baseContext.environment)) throw new ApiError(503,'RECEIPTS_SCHEMA_NOT_READY','A4 hazırlığı tamamlanmadı.');
    const context=await readContext(request,baseContext);
    if (isRoot) return routeReceiptRoot(request, context, pathname);
    context.intake=await context.repository.find(match[1]);
    if (!context.intake) throw new ApiError(404,'NOT_FOUND','Kayıt bulunamadı.');
    if (['metadata','close','reopen'].includes(match[2])) return mutateMetadata(request,context,match[2]);
    if (match[2]==='receipts') return createDocument(request,context);
    if (match[3]) return routeDocument(request,context,match);
    await enforceStaffLimit(context,'resume');
    if (!match[5]) {
        requireMethod(request,'GET');
        return {attempts:(await context.receipts.attempts(context.intake.id)).results};
    }
    requireMethod(request,'POST');
    const attempt=await context.receipts.attempt(match[5]);
    if (!attempt || attempt.intake_id!==context.intake.id || context.intake.deleted_at) throw new ApiError(404,'NOT_FOUND','Baskı bulunamadı.');
    return match[6]==='cancel'?cancelReceiptPrint(context,attempt):resumeReceiptPrint(context,attempt);
}

async function routeReceiptRoot(request, context, pathname) {
    if (pathname.endsWith('/config')) {
        requireMethod(request,'GET');
        return {today:readIstanbulDay(),portal_origin:readReceiptPortalOrigin(context.environment),create_enabled:isPhysicalReceiptCreationEnabled(context.environment),staff_role:context.staff.role};
    }
    await enforceStaffLimit(context,pathname.endsWith('/reference-reservations')?'reservation':'registration');
    if (pathname.endsWith('/reference-reservations')) {
        const reservation = await reservePhysicalReference(request,context);
        return { id:reservation.id,tracking_reference:reservation.tracking_reference,application_date:reservation.application_date,expires_at:reservation.expires_at };
    }
    const intake=await registerPhysicalReceipt(request,context);
    if (intake.conflict) return Response.json({error:{code:'PHYSICAL_ALREADY_EXISTS',message:'Bu pasaport/tür için aktif kayıt var.'},matches:intake.matches},{status:409,headers:{'Cache-Control':'no-store'}});
    return {intake,receipts:(await context.receipts.receipts(intake.id)).results.map(receipt=>readReceiptDto(receipt,intake))};
}
