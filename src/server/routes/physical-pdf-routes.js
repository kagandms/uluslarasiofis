import { PDFDocument } from 'pdf-lib';
import { ApiError } from '../domain/errors.js';
import { MAX_PHYSICAL_PDF_BYTES, requirePhysicalVersion } from '../domain/physical-intake-policy.js';
import { hashScannerValue } from '../domain/scanner-policy.js';
import { createSafeFilename } from './documentRoutes.js';

function conflict() {
    return new ApiError(409, 'PHYSICAL_UPDATE_CONFLICT', 'Kayıt değişti. Güncel kaydı açıp tekrar deneyin.');
}

async function readBoundedPdf(request) {
    if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/pdf' || !request.body) {
        throw new ApiError(415, 'PDF_REQUIRED', 'PDF dosyası seçin.');
    }
    if (Number(request.headers.get('Content-Length')) > MAX_PHYSICAL_PDF_BYTES) throw new ApiError(413, 'PDF_TOO_LARGE', 'PDF en fazla 10 MB olabilir.');
    const reader = request.body.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            total += chunk.value.byteLength;
            if (total > MAX_PHYSICAL_PDF_BYTES) { await reader.cancel(); throw new ApiError(413, 'PDF_TOO_LARGE', 'PDF en fazla 10 MB olabilir.'); }
            chunks.push(chunk.value);
        }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
}

/** Validates a bounded staff PDF. @param {Uint8Array} bytes PDF content. @returns {Promise<void>} Validated document. @throws {ApiError} Invalid PDF. */
export async function validatePhysicalPdf(bytes) {
    if (bytes.length < 8 || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new ApiError(400, 'INVALID_PDF', 'Geçerli bir PDF seçin.');
    try {
        const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
        if (pdf.getPageCount() < 1 || pdf.getPageCount() > 300) throw new Error('Unsupported page count');
    } catch (error) {
        console.error('Physical PDF format validation failed.', { errorName: error.name });
        throw new ApiError(400, 'INVALID_PDF', 'PDF okunamadı. Şifresiz, geçerli bir PDF seçin (en fazla 300 sayfa).');
    }
}

function requireFileIdentity(request) {
    const fileId = request.headers.get('X-Pdf-Id');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId || '')) {
        throw new ApiError(400, 'PDF_ID_REQUIRED', 'PDF kimliği doğrulanamadı. Tekrar deneyin.');
    }
    return fileId;
}

async function reservePdf(context, payload) {
    const existing = await context.repository.file(payload.fileId);
    if (existing) {
        if (existing.intake_id !== context.intake.id || existing.sha256 !== payload.sha256) throw conflict();
        if (existing.upload_status === 'finalized') return { file: existing, isReplay: true };
        throw new ApiError(409, existing.upload_status === 'failed' ? 'PDF_RETRY_REQUIRED' : 'UPLOAD_IN_PROGRESS',
            existing.upload_status === 'failed' ? 'Yükleme tamamlanamadı; yeniden kaydet tuşuna basın.' : 'Bu PDF yükleniyor. Biraz sonra tekrar deneyin.');
    }
    const file = await context.repository.reserveFile({ id: context.intake.id, version: payload.version,
        fileId: payload.fileId, byteSize: payload.bytes.length, sha256: payload.sha256, now: context.now,
        storageKey: `quarantine/${crypto.randomUUID()}`,
        filename: `ikamet_${context.intake.student_number}.pdf`, staffId: context.staff.id });
    if (!file) throw conflict();
    return { file, isReplay: false };
}

async function discardIncompletePdf(context, file) {
    const changed = await context.repository.failFile(file.id);
    if (changed.meta.changes !== 1) return;
    try { await context.environment.DOCUMENTS.delete(file.storage_key); }
    catch (error) { console.error('Incomplete physical PDF cleanup failed.', { errorName: error.name, fileId: file.id }); }
}

async function storeReservedPdf(context, payload) {
    const reserved = await reservePdf(context, payload);
    if (reserved.isReplay) return reserved.file;
    try {
        await context.environment.DOCUMENTS.put(reserved.file.storage_key, payload.bytes, { httpMetadata: { contentType: 'application/pdf' } });
        const metadata = await context.environment.DOCUMENTS.head(reserved.file.storage_key);
        if (!metadata || metadata.size !== payload.bytes.length) throw new ApiError(502, 'PDF_STORAGE_FAILED', 'PDF saklanamadı. Tekrar deneyin.');
        const saved = await context.repository.finalizeFile({ id: context.intake.id, version: payload.version,
            fileId: payload.fileId, now: context.now, staffId: context.staff.id, requestId: context.requestId });
        if (!saved) throw conflict();
    } catch (error) {
        console.error('Physical PDF save failed.', { errorName: error.name, fileId: payload.fileId });
        const stored = await context.repository.file(payload.fileId);
        if (stored?.upload_status === 'finalized') return stored;
        await discardIncompletePdf(context, reserved.file);
        throw error;
    }
    return context.repository.file(payload.fileId);
}

/** Persists an immutable staff PDF version pending antivirus scanning.
 * @param {Request} request Authorized same-origin request. @param {object} context Intake, staff and bindings.
 * @returns {Promise<object>} Confirmed file identity. @throws {ApiError} Invalid, stale or unavailable upload.
 */
export async function savePhysicalPdf(request, context) {
    const fileId = requireFileIdentity(request);
    const version = requirePhysicalVersion(Number(request.headers.get('If-Match')));
    const bytes = await readBoundedPdf(request);
    await validatePhysicalPdf(bytes);
    const file = await storeReservedPdf(context, { fileId, version, bytes, sha256: await hashScannerValue(bytes) });
    return { saved: true, file_id: file.id };
}

/** Opens a finalized PDF after verifying its stored content digest.
 * @param {object} context Authorized receipt and bindings. @param {object} options File identity and disposition.
 * @returns {Promise<Response>} Private PDF stream. @throws {ApiError} Unavailable or changed file.
 */
export async function openPhysicalPdf(context, options) {
    if (context.intake.deleted_at || options.fileId !== context.intake.current_pdf_id) {
        throw new ApiError(404, 'PDF_NOT_FOUND', 'PDF bulunamadı.');
    }
    const file = await context.repository.file(options.fileId);
    if (!file || file.intake_id !== context.intake.id || file.upload_status !== 'finalized') throw new ApiError(404, 'PDF_NOT_FOUND', 'PDF bulunamadı.');
    if (file.scan_status !== 'clean') throw new ApiError(409, 'PDF_SCAN_PENDING', 'PDF güvenlik taramasını geçmedi. Kaydı daha sonra yenileyin.');
    const head = await context.environment.DOCUMENTS.head(file.storage_key);
    if (!head || head.size !== file.byte_size || !head.etag) throw new ApiError(404, 'PDF_NOT_FOUND', 'PDF dosyası bulunamadı.');
    const object = await context.environment.DOCUMENTS.get(file.storage_key, { onlyIf: { etagMatches: head.etag } });
    if (!object || typeof object.arrayBuffer !== 'function' || object.etag !== head.etag || object.size !== file.byte_size) throw new ApiError(409, 'PDF_CHANGED', 'PDF şu anda açılamıyor. Tekrar deneyin.');
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (bytes.length !== file.byte_size || await hashScannerValue(bytes) !== file.sha256) {
        throw new ApiError(409, 'PDF_CHANGED', 'PDF içeriği kayıtla eşleşmiyor. Dosya şu anda açılamıyor.');
    }
    return new Response(bytes, { headers: { 'Content-Type': 'application/pdf',
        'Content-Disposition': `${options.action === 'download' ? 'attachment' : 'inline'}; filename="${createSafeFilename(file.original_filename)}"`,
        'Content-Length': String(file.byte_size), 'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" } });
}

/**
 * Removes the current PDF from the receipt while preserving private revision records for audit.
 * @param {Request} request Same-origin staff request with the expected version and file identity.
 * @param {object} context Authorized intake and repository context.
 * @returns {Promise<{removed: boolean}>} Confirmed removal.
 * @throws {ApiError} When the record, file identity or version changed.
 */
export async function removePhysicalPdf(request, context) {
    const fileId = requireFileIdentity(request);
    const version = requirePhysicalVersion(Number(request.headers.get('If-Match')));
    const changed = await context.repository.removeCurrentPdf({ id: context.intake.id, fileId, version,
        now: context.now, staffId: context.staff.id, requestId: context.requestId });
    if (!changed) throw conflict();
    return { removed: true };
}
