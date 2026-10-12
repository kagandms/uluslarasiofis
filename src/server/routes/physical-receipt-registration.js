import { isPhysicalReceiptCreationEnabled } from '../config/physical-receipt-config.js';
import { ApiError } from '../domain/errors.js';
import { requireReceiptUuid, requireApplicationDate, createTrackingReference, validateReceiptMetadata, readReceiptPortalOrigin } from '../domain/physical-tracking-policy.js';
import { hashScannerValue } from '../domain/scanner-policy.js';
import { readJsonBody } from '../http/requestBody.js';
import { requireMethod } from './shared.js';

/** Reserves a reference for a session-bound draft. @param {Request} request JSON. @param {object} context Authorized staff.
 * @returns {Promise<object>} Reserved reference. @throws {ApiError} Invalid/limited reservation. */
export async function reservePhysicalReference(request, context) {
    requireMethod(request,'POST');
    const body = await readJsonBody(request,2048);
    if (Object.keys(body).some(key => !['draft_id','application_date'].includes(key))) throw new ApiError(400,'VALIDATION_ERROR','Tahsis alanları geçersiz.');
    const draftId = requireReceiptUuid(body.draft_id);
    const day = requireApplicationDate(body.application_date);
    const existing = await context.receipts.draftReservation({ draftId, sessionHash: context.sessionHash });
    if (existing?.consumed_intake_id) throw new ApiError(409,'RESERVATION_CONSUMED','Kayıt oluşturulmuş; mevcut kaydı açın.');
    if (existing && existing.expires_at>context.now && existing.application_date.slice(0,4)===day.slice(0,4)) return existing;
    if (existing) await context.receipts.retireDraft({ draftId, sessionHash: context.sessionHash, expectedId: existing.id, now: context.now });
    for (let attempt=0; attempt<5; attempt++) {
        try {
            const reserved = await context.receipts.reserve({ id:crypto.randomUUID(), draftId, day, reference:createTrackingReference(day),
                staffId:context.staff.id, sessionHash:context.sessionHash, now:context.now,
                expiresAt:new Date(Date.parse(context.now)+3600_000).toISOString() });
            if (reserved) return reserved;
            const replay = await context.receipts.draftReservation({ draftId,sessionHash:context.sessionHash });
            if (replay && replay.expires_at>context.now && replay.application_date.slice(0,4)===day.slice(0,4)) return replay;
            throw new ApiError(429,'RESERVATION_LIMIT','En fazla 5 aktif taslak kullanılabilir.');
        } catch (error) {
            console.error('Physical reference reservation failed.', { errorName:error.name });
            if (!String(error.message).includes('physical_reference_reservations.tracking_reference')) throw error;
        }
    }
    throw new ApiError(503,'REFERENCE_UNAVAILABLE','Numara ayrılamadı. Tekrar deneyin.');
}

async function checkRegistrationReplay(context, input) {
    const intake = await context.repository.find(input.id);
    if (!intake) return null;
    if (intake.registration_body_hash !== input.bodyHash) throw new ApiError(409,'REGISTRATION_CONFLICT','Kaydetme kimliği farklı bilgilerle kullanıldı.');
    return intake;
}

/** Saves metadata, reservation consumption and initial receipt atomically. @param {Request} request JSON. @param {object} context Staff/bindings.
 * @returns {Promise<object>} Durable intake. @throws {ApiError} Invalid, expired or duplicate request. */
export async function registerPhysicalReceipt(request, context) {
    requireMethod(request,'POST');
    if (!isPhysicalReceiptCreationEnabled(context.environment)) throw new ApiError(403,'RECEIPTS_CREATE_DISABLED','Yeni kayıt akışı henüz etkin değil.');
    const { id, reservationUuid, metadata, bodyHash } = await readMetadataRegistration(request);
    const replay = await checkRegistrationReplay(context,{id,bodyHash});
    if (replay) return replay;
    const reservation = await context.receipts.reservation(reservationUuid);
    if (!reservation || reservation.staff_id !== context.staff.id || reservation.session_hash !== context.sessionHash
        || reservation.consumed_intake_id || reservation.expires_at<=context.now || reservation.application_date.slice(0,4)!==metadata.application_date.slice(0,4)) {
        throw new ApiError(409,'RESERVATION_EXPIRED','Numara tahsisi geçersiz; yeni numara ayırın.');
    }
    try {
        const intake = await context.receipts.register({ id, metadata, bodyHash, reservation, receiptId:crypto.randomUUID(), creationId:id,
            sessionHash:context.sessionHash,staffId:context.staff.id,requestId:context.requestId,now:context.now,
            portalOrigin:readReceiptPortalOrigin(context.environment) });
        if (!intake) throw new ApiError(409,'RESERVATION_EXPIRED','Numara tahsisi sona erdi.');
        return intake;
    } catch (error) {
        console.error('Physical metadata registration failed.', { errorName:error.name });
        const saved = await checkRegistrationReplay(context,{id,bodyHash});
        if (saved) return saved;
        if (/physical_active_passport_conflict|UNIQUE constraint/.test(String(error.message))) {
            const duplicates = (await context.receipts.duplicates(metadata)).results;
            return { conflict:true, matches:duplicates };
        }
        throw error;
    }
}

async function readMetadataRegistration(request) {
    const { registration_id: registrationId, reservation_id: reservationId, ...fields } = await readJsonBody(request,8192);
    const id = requireReceiptUuid(registrationId);
    const reservationUuid = requireReceiptUuid(reservationId);
    const metadata = validateReceiptMetadata(fields);
    const bodyHash = await hashScannerValue(JSON.stringify({ reservation_id:reservationUuid, ...metadata }));
    return { id, reservationUuid, metadata, bodyHash };
}
