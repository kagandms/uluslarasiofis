import { requireSingleJpegContainer } from '../domain/jpeg-container-policy.js';
import { PDFDocument } from 'pdf-lib';
import { ApiError } from '../domain/errors.js';
import { hashScannerValue } from '../domain/scanner-policy.js';
import { requireSameOrigin } from './shared.js';
import { requireTransferOwner, ACTIVE_TRANSFER_STAFF, enforceTransferRate } from './mobile-transfer-security.js';
import { readSharedStaffUsername } from '../config/sharedStaffAccount.js';
import { MAX_TRANSFER_FILE_BYTES, MAX_TRANSFER_FILES, MAX_TRANSFER_TOTAL_BYTES, MAX_TRANSFER_UPLOAD_REQUESTS_PER_MINUTE, MAX_TRANSFER_IMAGE_PIXELS } from '../../config/mobile-transfer-policy.js';

async function readPhotoBytes(request) {
    if (request.headers.get('Content-Type') !== 'image/jpeg' || !request.body) throw new ApiError(415, 'PHOTO_FORMAT', 'JPG fotoğraf gerekli.');
    const reader = request.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            total += chunk.value.length;
            if (total > MAX_TRANSFER_FILE_BYTES) { await reader.cancel(); throw new ApiError(413, 'PHOTO_TOO_LARGE', 'Fotoğraf en fazla 8 MB olabilir.'); }
            chunks.push(chunk.value);
        }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    await validateJpeg(bytes);
    return bytes;
}

async function validateJpeg(bytes) {
    try {
        requireSingleJpegContainer(bytes);
        const pdf = await PDFDocument.create();
        const image = await pdf.embedJpg(bytes);
        if (image.width * image.height > MAX_TRANSFER_IMAGE_PIXELS || !image.width || !image.height) throw new Error('Invalid JPEG dimensions');
    } catch (error) {
        console.error('Mobile JPEG validation failed.', { errorName: error.name });
        throw new ApiError(415, 'PHOTO_FORMAT', 'Geçerli JPG fotoğraf gerekli.');
    }
}

async function reservePhoto(context, payload) {
    const { environment, transferId } = context;
    const existing = await environment.DB.prepare('SELECT * FROM mobile_document_transfer_files WHERE id=?').bind(payload.id).first();
    if (existing) {
        if (existing.transfer_id !== transferId || existing.sha256 !== payload.sha256) throw new ApiError(409, 'PHOTO_CONFLICT', 'Fotoğraf kimliği farklı içerikle kullanılmış.');
        if (['finalized', 'consumed'].includes(existing.upload_status)) return { isReplay: true, file: existing };
        if (existing.upload_status === 'failed') {
            const resumed = await environment.DB.prepare(`UPDATE mobile_document_transfer_files SET upload_status='uploading'
                WHERE id=? AND upload_status='failed' RETURNING *`).bind(payload.id).first();
            if (resumed) return { isReplay: false, file: resumed };
        }
        throw new ApiError(409, 'UPLOAD_IN_PROGRESS', 'Fotoğraf işleniyor. Biraz sonra tekrar deneyin.');
    }
    const storageKey = `quarantine/${crypto.randomUUID()}`;
    const file = await environment.DB.prepare(`INSERT INTO mobile_document_transfer_files
        (id,transfer_id,storage_key,byte_size,created_at,upload_status,sha256)
        SELECT ?,id,?,?,?,'uploading',? FROM mobile_document_transfers
        WHERE id=? AND expires_at>unixepoch() AND file_count<? AND byte_count+?<=? AND ${ACTIVE_TRANSFER_STAFF} RETURNING *`)
        .bind(payload.id, storageKey, payload.bytes.length, Date.now(), payload.sha256, transferId,
            MAX_TRANSFER_FILES, payload.bytes.length, MAX_TRANSFER_TOTAL_BYTES, readSharedStaffUsername(environment)).first();
    if (!file) throw new ApiError(409, 'TRANSFER_LIMIT', 'Aktarım kapandı veya fotoğraf sınırına ulaştı.');
    return { isReplay: false, file };
}

async function storePhoto(context, payload) {
    let reservation;
    try { reservation = await reservePhoto(context, payload); }
    catch (error) {
        console.error('Mobile photo reservation failed.', { errorName: error.name });
        if (String(error.message).includes('UNIQUE constraint')) throw new ApiError(409, 'UPLOAD_IN_PROGRESS', 'Fotoğraf işleniyor. Tekrar deneyin.');
        throw error;
    }
    if (reservation.isReplay) return;
    const { environment, transferId } = context;
    const { file } = reservation;
    try {
        await environment.DOCUMENTS.put(file.storage_key, payload.bytes, { httpMetadata: { contentType: 'image/jpeg' } });
        await requireTransferOwner(environment, transferId);
        const saved = await environment.DB.prepare(`UPDATE mobile_document_transfer_files SET upload_status='finalized'
            WHERE id=? AND upload_status='uploading' AND EXISTS (SELECT 1 FROM mobile_document_transfers
            WHERE id=? AND expires_at>unixepoch() AND ${ACTIVE_TRANSFER_STAFF})`)
            .bind(file.id, transferId, readSharedStaffUsername(environment)).run();
        if (saved.meta.changes !== 1) throw new ApiError(410, 'TRANSFER_EXPIRED', 'Aktarım kapandı.');
    } catch (error) {
        console.error('Mobile photo storage failed.', { errorName: error.name });
        await environment.DOCUMENTS.delete(file.storage_key);
        await environment.DB.prepare("UPDATE mobile_document_transfer_files SET upload_status='failed' WHERE id=?").bind(file.id).run();
        throw error;
    }
}

/** Uploads one immutable, idempotent JPEG under an active paired staff session.
 * @param {Request} request Same-origin phone request. @param {object} context Authorized transfer and bindings.
 * @returns {Promise<object>} Receipt. @throws {ApiError} Invalid file, limits or stale owner.
 */
export async function uploadMobilePhoto(request, context) {
    requireSameOrigin(request);
    await requireTransferOwner(context.environment, context.transferId);
    await enforceTransferRate({ request, environment: context.environment }, `photo:${context.transferId}`, MAX_TRANSFER_UPLOAD_REQUESTS_PER_MINUTE);
    const id = request.headers.get('X-Photo-Id')?.toLowerCase();
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id || '')) throw new ApiError(400, 'PHOTO_ID', 'Fotoğraf kimliği geçersiz.');
    const bytes = await readPhotoBytes(request);
    await storePhoto(context, { id, bytes, sha256: await hashScannerValue(bytes) });
    return { id, received: true };
}
