import { ApiError } from '../domain/errors.js';
import { requireStaff } from '../auth/staffAuth.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { createDocumentStorage } from '../storage/documentStorage.js';
import { requireMethod } from './shared.js';

/**
 * Removes paths, control characters, and unsupported characters from a download filename.
 * @param {string} filename Original private document filename.
 * @returns {string} Safe ASCII filename for Content-Disposition.
 */
export function createSafeFilename(filename) {
    const leafName = filename.split(/[\\/]/).pop() || 'document';
    const safeName = leafName.normalize('NFKC').replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^[. ]+|[. ]+$/g, '');
    return (safeName || 'document').slice(0, 120);
}

/**
 * Checks whether the existing private-document media allowlist accepts a media type.
 * @param {string} mediaType Persisted document media type.
 * @returns {boolean} True when staff may receive document content in this type.
 */
export function isSafeDocumentMediaType(mediaType) {
    return ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(mediaType);
}

/**
 * Builds the shared, private attachment response for a validated current document.
 * @param {object} file Authorized file metadata owned by the server.
 * @param {object} object Private R2 object with a readable body.
 * @returns {Response} Safe attachment response.
 */
export function createPrivateAttachmentResponse(file, object) {
    const headers = new Headers({
        'Content-Type': file.media_type,
        'Content-Disposition': `attachment; filename="${createSafeFilename(file.original_filename)}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
    });
    if (Number.isSafeInteger(file.byte_size) && file.byte_size >= 0) headers.set('Content-Length', String(file.byte_size));
    return new Response(object.body, { status: 200, headers });
}

/**
 * Returns clean finalized document bytes to an authenticated staff member.
 * @param {Request} request Fetch API request.
 * @param {object} environment Worker D1 and private R2 bindings.
 * @param {string} fileId Persisted document file identifier.
 * @returns {Promise<Response>} Private attachment response.
 * @throws {ApiError} When authorization, metadata, or storage checks fail.
 */
export async function readPrivateDocument(request, environment, fileId) {
    requireMethod(request, 'GET');
    await requireStaff(request, environment);
    if (!environment.DB || !environment.DOCUMENTS) {
        throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Belge hizmeti şu anda kullanılamıyor. Daha sonra tekrar deneyin.', true);
    }
    if (typeof fileId !== 'string' || fileId.length < 1 || fileId.length > 128) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Belge bulunamadı.');
    const file = await createD1Repositories(environment.DB).documents.findPrivateFileById(fileId);
    if (!file || !isSafeDocumentMediaType(file.media_type)) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Belge bulunamadı.');
    const storage = createDocumentStorage(environment);
    const object = await storage.get(file.storage_key);
    if (!object?.body) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Belge bulunamadı.');
    return createPrivateAttachmentResponse(file, object);
}
