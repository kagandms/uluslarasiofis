import { ApiError } from '../domain/errors.js';
import { requireStaff } from '../auth/staffAuth.js';
import { readJsonBody } from '../http/requestBody.js';
import { recognizeStaffDocument } from '../services/ocrProvider.js';
import { requireMethod, requireSameOrigin } from './shared.js';

const MAX_OCR_IMAGE_BYTES = 15_000_000;
const MAX_JSON_BYTES = Math.ceil(MAX_OCR_IMAGE_BYTES * 4 / 3) + 4096;

function decodeBase64Image(encodedImage) {
    if (typeof encodedImage !== 'string' || encodedImage.length > MAX_JSON_BYTES) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Belge görüntüsü gerekli.');
    }
    const base64 = encodedImage.includes(',') ? encodedImage.slice(encodedImage.indexOf(',') + 1) : encodedImage;
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Belge görüntüsü okunamadı.');
    }
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function readImageBody(request) {
    const contentType = request.headers.get('Content-Type') || '';
    if (contentType.startsWith('application/json')) {
        const body = await readJsonBody(request, MAX_JSON_BYTES);
        return decodeBase64Image(body.imageContent);
    }
    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > MAX_OCR_IMAGE_BYTES) throw new ApiError(413, 'REQUEST_TOO_LARGE', 'Belge görüntüsü boyut sınırını aşıyor.');
    const imageBytes = new Uint8Array(await request.arrayBuffer());
    if (imageBytes.length > MAX_OCR_IMAGE_BYTES) throw new ApiError(413, 'REQUEST_TOO_LARGE', 'Belge görüntüsü boyut sınırını aşıyor.');
    return imageBytes;
}

/**
 * Authenticates and forwards one bounded image to the configured OCR provider.
 * @param {Request} request Fetch API request.
 * @param {object} environment Worker bindings with provider credentials.
 * @returns {Promise<object>} OCR response compatible with the existing staff client.
 * @throws {ApiError} When authorization, input, or provider checks fail.
 */
export async function recognizeDocument(request, environment) {
    requireMethod(request, 'POST');
    await requireStaff(request, environment);
    requireSameOrigin(request);
    const imageBytes = await readImageBody(request);
    if (imageBytes.length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'Belge görüntüsü boş.');
    if (imageBytes.length > MAX_OCR_IMAGE_BYTES) throw new ApiError(413, 'REQUEST_TOO_LARGE', 'Belge görüntüsü boyut sınırını aşıyor.');
    return recognizeStaffDocument(imageBytes, environment);
}
