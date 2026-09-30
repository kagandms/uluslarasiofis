import { ApiError } from '../domain/errors.js';
import { requireStaff } from '../auth/staffAuth.js';
import { readJsonBody } from '../http/requestBody.js';
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

function mapAzureResult(payload) {
    const annotations = [{ description: '' }];
    const lines = [];
    for (const block of payload.readResult?.blocks || []) {
        for (const line of block.lines || []) {
            lines.push(line.text);
            for (const word of line.words || []) {
                annotations.push({
                    description: word.text,
                    boundingPoly: { vertices: word.boundingPolygon || [] }
                });
            }
        }
    }
    annotations[0].description = lines.join('\n');
    return { responses: [{ textAnnotations: annotations }] };
}

async function readAzure(imageBytes, environment) {
    if (!environment.AZURE_VISION_KEY || !environment.AZURE_VISION_ENDPOINT) return null;
    let endpoint;
    try {
        endpoint = new URL(environment.AZURE_VISION_ENDPOINT);
    } catch {
        return null;
    }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) return null;
    endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/computervision/imageanalysis:analyze`;
    endpoint.search = '?features=read&api-version=2023-10-01';
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Ocp-Apim-Subscription-Key': environment.AZURE_VISION_KEY, 'Content-Type': 'application/octet-stream' },
            body: imageBytes,
            signal: AbortSignal.timeout(20_000)
        });
        if (!response.ok) return null;
        return mapAzureResult(await response.json());
    } catch {
        return null;
    }
}

async function readGoogle(imageBytes, apiKey) {
    if (!apiKey) throw new ApiError(503, 'OCR_UNAVAILABLE', 'Belge şu anda otomatik okunamıyor. Lütfen tekrar deneyin.', true);
    let binary = '';
    for (let offset = 0; offset < imageBytes.length; offset += 32_768) {
        binary += String.fromCharCode(...imageBytes.subarray(offset, offset + 32_768));
    }
    const imageContent = btoa(binary);
    let response;
    try {
        response = await fetch(`https://eu-vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requests: [{ image: { content: imageContent }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }], imageContext: { languageHints: ['tr', 'en'] } }]
            }),
            signal: AbortSignal.timeout(20_000)
        });
    } catch {
        throw new ApiError(502, 'OCR_PROVIDER_FAILURE', 'Belge şu anda otomatik okunamıyor. Lütfen tekrar deneyin.', true);
    }
    if (!response.ok) throw new ApiError(502, 'OCR_PROVIDER_FAILURE', 'Belge şu anda otomatik okunamıyor. Lütfen tekrar deneyin.', true);
    try {
        return await response.json();
    } catch {
        throw new ApiError(502, 'OCR_PROVIDER_FAILURE', 'Belge şu anda otomatik okunamıyor. Lütfen tekrar deneyin.', true);
    }
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
    const azureResult = await readAzure(imageBytes, environment);
    if (azureResult) return azureResult;
    return readGoogle(imageBytes, environment.GOOGLE_VISION_API_KEY);
}
