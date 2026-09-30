import { ApiError } from '../domain/errors.js';

const PROVIDER_TIMEOUT_MS = 20_000;

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

function readAzureEndpoint(environment) {
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
    return endpoint;
}

async function requestAzureVision(imageBytes, environment) {
    const endpoint = readAzureEndpoint(environment);
    if (!endpoint) return { status: 'unavailable' };
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Ocp-Apim-Subscription-Key': environment.AZURE_VISION_KEY,
                'Content-Type': 'application/octet-stream'
            },
            body: imageBytes,
            signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
        });
        if (!response.ok) return { status: 'failed' };
        return { status: 'success', result: mapAzureResult(await response.json()) };
    } catch {
        return { status: 'failed' };
    }
}

function encodeImage(imageBytes) {
    let binary = '';
    for (let offset = 0; offset < imageBytes.length; offset += 32_768) {
        binary += String.fromCharCode(...imageBytes.subarray(offset, offset + 32_768));
    }
    return btoa(binary);
}

async function requestGoogleVision(imageBytes, apiKey) {
    if (!apiKey) throw new ApiError(503, 'OCR_UNAVAILABLE', 'Belge şu anda otomatik okunamıyor. Lütfen tekrar deneyin.', true);
    let response;
    try {
        response = await fetch(`https://eu-vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requests: [{ image: { content: encodeImage(imageBytes) }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }], imageContext: { languageHints: ['tr', 'en'] } }]
            }),
            signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
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
 * Recognizes one staff document using the existing Azure-first, Google-fallback policy.
 * @param {Uint8Array} imageBytes Bounded image bytes supplied by the staff route.
 * @param {object} environment Worker bindings with provider credentials.
 * @returns {Promise<object>} Existing OCR annotation response contract.
 */
export async function recognizeStaffDocument(imageBytes, environment) {
    const azure = await requestAzureVision(imageBytes, environment);
    if (azure.status === 'success') return azure.result;
    return requestGoogleVision(imageBytes, environment.GOOGLE_VISION_API_KEY);
}

/**
 * Recognizes one public passport image with Azure only and safe manual-entry errors.
 * @param {Uint8Array} imageBytes Bounded passport image bytes supplied by the owner route.
 * @param {object} environment Worker bindings with Azure credentials.
 * @returns {Promise<object>} Existing normalized OCR annotation response contract.
 * @throws {ApiError} When Azure is unavailable or cannot complete recognition.
 */
export async function recognizePublicPassportImage(imageBytes, environment) {
    const azure = await requestAzureVision(imageBytes, environment);
    if (azure.status === 'unavailable') {
        throw new ApiError(503, 'OCR_UNAVAILABLE', 'Belge şu anda otomatik okunamıyor. Lütfen tekrar deneyin.', true);
    }
    if (azure.status === 'failed') {
        throw new ApiError(502, 'OCR_PROVIDER_FAILURE', 'Belge şu anda otomatik okunamıyor. Lütfen tekrar deneyin.', true);
    }
    return azure.result;
}
