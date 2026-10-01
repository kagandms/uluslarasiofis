import { ApiError } from './errors.js';

/**
 * Reduces an untrusted browser filename to a safe display name.
 * @param {string} filename Original filename from the request body.
 * @returns {string} Sanitized filename suitable for stored metadata.
 */
export function sanitizeStudentFilename(filename) {
    const leafName = filename.split(/[\\/]/).pop() || 'document';
    const safeName = leafName.normalize('NFKC').replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^[. ]+|[. ]+$/g, '');
    return (safeName || 'document').slice(0, 120);
}

/**
 * Validates student upload metadata against the active centralized policy.
 * @param {object} body Parsed untrusted upload request body.
 * @param {object} policy Active server-owned document policy.
 * @returns {{code: string, filename: string, mediaType: string, byteSize: number}} Safe metadata.
 * @throws {ApiError} When the code, filename, media type, or size is invalid.
 */
export function readStudentUploadMetadata(body, policy) {
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    const filename = typeof body?.filename === 'string' ? body.filename.trim() : '';
    const mediaType = typeof body?.media_type === 'string' ? body.media_type.trim().toLowerCase() : '';
    const byteSize = body?.byte_size;
    const acceptedMediaTypes = policy?.accepted_media_types;
    const maxByteSize = policy?.max_byte_size;
    if (!/^[a-z0-9_]{1,80}$/.test(code)
        || !filename || filename.length > 255
        || !Array.isArray(acceptedMediaTypes) || !acceptedMediaTypes.includes(mediaType)
        || !Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > maxByteSize) {
        const errorCode = Number.isSafeInteger(byteSize) && byteSize > maxByteSize ? 'FILE_TOO_LARGE' : 'INVALID_FILE';
        throw new ApiError(400, errorCode, 'Belge biçimini ve boyutunu kontrol edip tekrar deneyin.');
    }
    return { code, filename: sanitizeStudentFilename(filename), mediaType, byteSize };
}
