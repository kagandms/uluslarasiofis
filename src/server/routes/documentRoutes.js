import { ApiError } from '../domain/errors.js';
import { requireStaff } from '../auth/staffAuth.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { createR2DocumentStorage } from '../storage/r2DocumentStorage.js';
import { requireMethod } from './shared.js';

function createSafeFilename(filename) {
    const leafName = filename.split(/[\\/]/).pop() || 'document';
    const safeName = leafName.normalize('NFKC').replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^[. ]+|[. ]+$/g, '');
    return (safeName || 'document').slice(0, 120);
}

function isSafeMediaType(mediaType) {
    return ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(mediaType);
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
    if (!file || !isSafeMediaType(file.media_type)) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Belge bulunamadı.');
    const storage = createR2DocumentStorage(environment.DOCUMENTS);
    const object = await storage.get(file.storage_key);
    if (!object?.body) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Belge bulunamadı.');
    const headers = new Headers({
        'Content-Type': file.media_type,
        'Content-Disposition': `attachment; filename="${createSafeFilename(file.original_filename)}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
    });
    if (Number.isSafeInteger(file.byte_size) && file.byte_size >= 0) headers.set('Content-Length', String(file.byte_size));
    return new Response(object.body, { status: 200, headers });
}
