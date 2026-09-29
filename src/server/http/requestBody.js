import { ApiError } from '../domain/errors.js';

/**
 * Parses a bounded JSON request body for an API route.
 * @param {Request} request Fetch API request.
 * @param {number} [maxBytes] Maximum UTF-8 body size.
 * @returns {Promise<Record<string, unknown>>} Parsed object body.
 * @throws {ApiError} When the body is missing, invalid, or exceeds the limit.
 */
export async function readJsonBody(request, maxBytes = 16_384) {
    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > maxBytes) throw new ApiError(413, 'REQUEST_TOO_LARGE', 'İstek boyutu izin verilen sınırı aşıyor.');
    const bodyText = await request.text();
    if (new TextEncoder().encode(bodyText).length > maxBytes) {
        throw new ApiError(413, 'REQUEST_TOO_LARGE', 'İstek boyutu izin verilen sınırı aşıyor.');
    }
    try {
        const body = JSON.parse(bodyText);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('Expected JSON object.');
        return body;
    } catch {
        throw new ApiError(400, 'VALIDATION_ERROR', 'İstek bilgileri okunamadı. Alanları kontrol edip tekrar deneyin.');
    }
}
