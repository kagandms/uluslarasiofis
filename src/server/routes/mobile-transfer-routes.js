import { hashScannerValue } from '../domain/scanner-policy.js';
import { uploadMobilePhoto } from './mobile-photo-upload.js';
import { requireTransferOwner, ACTIVE_TRANSFER_STAFF, enforceTransferRate } from './mobile-transfer-security.js';
import { readSharedStaffUsername } from '../config/sharedStaffAccount.js';
import { readJsonBody } from '../http/requestBody.js';
import { ApiError } from '../domain/errors.js';
import { requirePhysicalStaff } from './physical-access-routes.js';
import { readPhysicalGate, hasPhysicalTransferSchema } from '../config/physical-intake-gate.js';
import { createOpaqueSessionToken, hashSessionToken, readCookie } from '../auth/sessionToken.js';
import { requireMethod, requireSameOrigin } from './shared.js';
import { MAX_TRANSFER_CLAIM_REQUESTS_PER_MINUTE, TRANSFER_TTL_SECONDS } from '../../config/mobile-transfer-policy.js';

const PHONE_COOKIE = 'mobile_transfer_session';
const nowSeconds = () => Math.floor(Date.now() / 1000);
const unavailable = () => new ApiError(410, 'TRANSFER_EXPIRED', 'Aktarım bağlantısı geçersiz veya süresi dolmuş. PC’den yeni QR açın.');

async function getStaffHash(request, environment) {
    await requirePhysicalStaff(request, environment);
    return hashSessionToken(readCookie(request, 'staff_session'));
}

async function requireTransfer(request, environment, transferId, audience) {
    const tokenHash = audience === 'staff' ? await getStaffHash(request, environment)
        : await hashSessionToken(readCookie(request, PHONE_COOKIE) || '');
    const column = audience === 'staff' ? 'staff_token_hash' : 'phone_token_hash';
    const transfer = await environment.DB.prepare(`SELECT * FROM mobile_document_transfers WHERE id=? AND ${column}=? AND expires_at>?`)
        .bind(transferId, tokenHash, nowSeconds()).first();
    if (!transfer) throw unavailable();
    await requireTransferOwner(environment, transferId);
    return transfer;
}

async function createTransfer(request, environment) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const staffHash = await getStaffHash(request, environment);
    const count = await environment.DB.prepare('SELECT COUNT(*) AS total FROM mobile_document_transfers WHERE staff_token_hash=? AND expires_at>?')
        .bind(staffHash, nowSeconds()).first();
    if (count.total >= 5) throw new ApiError(429, 'TRANSFER_LIMIT', 'Önce açık aktarım pencerelerini kapatın.');
    const id = crypto.randomUUID();
    const claimToken = createOpaqueSessionToken();
    const expiresAt = Math.min(nowSeconds() + TRANSFER_TTL_SECONDS, readPhysicalGate(environment).expiresAt ?? Infinity);
    const created = await environment.DB.prepare(`INSERT INTO mobile_document_transfers(id,staff_token_hash,claim_token_hash,expires_at) SELECT ?,?,?,? WHERE (SELECT count(*) FROM mobile_document_transfers WHERE staff_token_hash=? AND expires_at>?)<5`)
        .bind(id, staffHash, await hashSessionToken(claimToken), expiresAt, staffHash, nowSeconds()).run();
    if (created.meta.changes !== 1) throw new ApiError(429, 'TRANSFER_LIMIT', 'Aktarım sınırına ulaşıldı.');
    return { id, claimToken, expiresAt };
}

async function claimTransfer(request, environment) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    await enforceTransferRate({ request, environment }, 'claim', MAX_TRANSFER_CLAIM_REQUESTS_PER_MINUTE);
    const { token: body } = await readJsonBody(request, 128);
    if (typeof body !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body)) throw unavailable();
    const candidate = await environment.DB.prepare('SELECT id FROM mobile_document_transfers WHERE claim_token_hash=?').bind(await hashSessionToken(body)).first();
    if (!candidate) throw unavailable();
    await requireTransferOwner(environment, candidate.id);
    const phoneToken = createOpaqueSessionToken();
    const result = await environment.DB.prepare(`UPDATE mobile_document_transfers SET phone_token_hash=? WHERE claim_token_hash=? AND phone_token_hash IS NULL AND expires_at>? AND ${ACTIVE_TRANSFER_STAFF} RETURNING id,expires_at`)
        .bind(await hashSessionToken(phoneToken), await hashSessionToken(body), nowSeconds(), readSharedStaffUsername(environment)).first();
    if (!result) throw unavailable();
    return new Response(JSON.stringify(result), { headers: {
        'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'Set-Cookie': `${PHONE_COOKIE}=${phoneToken}; HttpOnly; Secure; SameSite=Strict; Path=/api/mobile-transfer; Max-Age=${Math.max(0, result.expires_at - nowSeconds())}`
    } });
}

async function listPhotos(environment, transferId) {
    const files = await environment.DB.prepare(`SELECT id,byte_size FROM mobile_document_transfer_files WHERE transfer_id=? AND upload_status='finalized' ORDER BY created_at,id`).bind(transferId).all();
    return { files: files.results };
}

async function accessPhoto(request, environment, transferId, photoId) {
    const file = await environment.DB.prepare('SELECT * FROM mobile_document_transfer_files WHERE id=? AND transfer_id=?').bind(photoId, transferId).first();
    if (!file) throw new ApiError(404, 'PHOTO_NOT_FOUND', 'Fotoğraf bulunamadı.');
    if (file.upload_status !== 'finalized') throw new ApiError(409, 'PHOTO_NOT_READY', 'Fotoğraf yüklemesi tamamlanmadı.');
    if (request.method === 'DELETE') {
        requireSameOrigin(request);
        await environment.DOCUMENTS.delete(file.storage_key);
        await environment.DB.prepare("UPDATE mobile_document_transfer_files SET upload_status='consumed' WHERE id=? AND transfer_id=?").bind(photoId, transferId).run();
        return { received: true };
    }
    requireMethod(request, 'GET');
    const head = await environment.DOCUMENTS.head(file.storage_key);
    if (!head || head.size !== file.byte_size) throw new ApiError(404, 'PHOTO_NOT_FOUND', 'Fotoğraf bulunamadı.');
    const object = await environment.DOCUMENTS.get(file.storage_key, { onlyIf: { etagMatches: head.etag } });
    if (!object || object.etag !== head.etag) throw new ApiError(409, 'PHOTO_CHANGED', 'Fotoğraf değişti.');
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.length !== file.byte_size || await hashScannerValue(bytes) !== file.sha256) throw new ApiError(409, 'PHOTO_CHANGED', 'Fotoğraf değişti.');
    return new Response(bytes, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}

async function removeTransfer(environment, transferId) {
    await environment.DB.prepare('UPDATE mobile_document_transfers SET expires_at=0 WHERE id=?').bind(transferId).run();
    const files = await environment.DB.prepare('SELECT storage_key FROM mobile_document_transfer_files WHERE transfer_id=?').bind(transferId).all();
    if (files.results.length) await environment.DOCUMENTS.delete(files.results.map(file => file.storage_key));
    await environment.DB.batch([
        environment.DB.prepare('DELETE FROM mobile_document_transfer_files WHERE transfer_id=?').bind(transferId),
        environment.DB.prepare('DELETE FROM mobile_document_transfers WHERE id=?').bind(transferId)
    ]);
}

async function routeStaffTransfer(request, environment, pathname) {
    const staffMatch = pathname.match(/^\/api\/staff\/mobile-transfers\/([0-9a-f-]{36})(?:\/files\/([0-9a-f-]{36}))?$/);
    if (!staffMatch) throw new ApiError(404, 'NOT_FOUND', 'Aktarım bulunamadı.');
    await requireTransfer(request, environment, staffMatch[1], 'staff');
    if (staffMatch[2]) return accessPhoto(request, environment, staffMatch[1], staffMatch[2]);
    if (request.method === 'DELETE') {
        requireSameOrigin(request);
        await removeTransfer(environment, staffMatch[1]);
        return { closed: true };
    }
    requireMethod(request, 'GET');
    return listPhotos(environment, staffMatch[1]);
}

/**
 * Routes temporary staff-to-phone photo transfers with session-bound PC access.
 * @param {Request} request Incoming request.
 * @param {object} environment D1 and private R2 bindings.
 * @returns {Promise<object|Response>} Authorized result.
 * @throws {ApiError} For invalid sessions, limits or methods.
 */
export async function handleMobileTransfer(request, environment) {
    if (!['staging', 'production'].includes(environment.APP_ENV)) throw new ApiError(404, 'NOT_FOUND', 'Aktarım bulunamadı.');
    if (!environment.DB || !environment.DOCUMENTS) throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Aktarım hizmeti kullanılamıyor.');
    if (readPhysicalGate(environment).mode === 'off') throw new ApiError(403, 'PHYSICAL_INTAKE_DISABLED', 'Fiziksel başvuru şu anda kapalı.');
    if (!await hasPhysicalTransferSchema(environment)) throw new ApiError(503, 'PHYSICAL_SCHEMA_NOT_READY', 'Fiziksel başvuru hazırlığı tamamlanmadı.');
    const pathname = new URL(request.url).pathname;
    if (pathname === '/api/staff/mobile-transfers') return createTransfer(request, environment);
    if (pathname === '/api/mobile-transfer/claim') return claimTransfer(request, environment);
    const phoneMatch = pathname.match(/^\/api\/mobile-transfer\/([0-9a-f-]{36})\/photos$/);
    if (phoneMatch) {
        requireMethod(request, 'POST');
        await requireTransfer(request, environment, phoneMatch[1], 'phone');
        return uploadMobilePhoto(request, { environment, transferId: phoneMatch[1] });
    }
    return routeStaffTransfer(request, environment, pathname);
}

/**
 * Deletes expired temporary transfers; no application documents are touched.
 * @param {object} environment D1 and private R2 bindings.
 * @returns {Promise<void>} Resolves after cleanup.
 * @throws {Error} When storage/database cleanup fails.
 */
export async function cleanupMobileTransfers(environment) {
    if (!['staging', 'production'].includes(environment.APP_ENV) || !environment.DB || !environment.DOCUMENTS) return;
    const schema = await environment.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mobile_transfer_rate_limits'").first();
    if (!schema) return;
    await environment.DB.prepare('DELETE FROM mobile_transfer_rate_limits WHERE window<?').bind(Math.floor(Date.now()/60000)-60).run();
    const expired = await environment.DB.prepare('SELECT id FROM mobile_document_transfers WHERE expires_at<=? LIMIT 20').bind(nowSeconds()).all();
    for (const transfer of expired.results) await removeTransfer(environment, transfer.id);
}
