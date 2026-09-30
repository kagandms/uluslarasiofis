import { requireApplicationSession } from '../auth/applicationAuth.js';
import { ApiError } from '../domain/errors.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { extractPassportIdentityCandidates } from '../../shared/passport/identityParser.js';
import { recognizePublicPassportImage } from '../services/ocrProvider.js';
import { enforceRateLimit, requireMethod, requireSameOrigin } from './shared.js';

const MAX_PASSPORT_OCR_IMAGE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function readMediaType(request) {
    const mediaType = (request.headers.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase();
    if (!SUPPORTED_IMAGE_TYPES.has(mediaType)) {
        throw new ApiError(415, 'UNSUPPORTED_OCR_MEDIA_TYPE', 'Bu görüntü biçimi otomatik okunamıyor.');
    }
    return mediaType;
}

function hasImageSignature(mediaType, imageBytes) {
    if (mediaType === 'image/jpeg') return imageBytes[0] === 0xff && imageBytes[1] === 0xd8;
    if (mediaType === 'image/png') return imageBytes.subarray(0, 8).join(',') === '137,80,78,71,13,10,26,10';
    return imageBytes.length >= 12
        && new TextDecoder().decode(imageBytes.subarray(0, 4)) === 'RIFF'
        && new TextDecoder().decode(imageBytes.subarray(8, 12)) === 'WEBP';
}

function validateDeclaredLength(request) {
    const declaredLength = request.headers.get('Content-Length');
    if (declaredLength === null) return;
    if (!/^\d+$/.test(declaredLength)) {
        throw new ApiError(400, 'INVALID_OCR_PAYLOAD', 'Görüntü verisi okunamadı.');
    }
    if (Number(declaredLength) > MAX_PASSPORT_OCR_IMAGE_BYTES) {
        throw new ApiError(413, 'REQUEST_TOO_LARGE', 'Görüntü boyutu izin verilen sınırı aşıyor.');
    }
}

async function readImageChunks(reader) {
    const chunks = [];
    let byteLength = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            byteLength += value.byteLength;
            if (byteLength > MAX_PASSPORT_OCR_IMAGE_BYTES) {
                throw new ApiError(413, 'REQUEST_TOO_LARGE', 'Görüntü boyutu izin verilen sınırı aşıyor.');
            }
            chunks.push(value);
        }
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(400, 'INVALID_OCR_PAYLOAD', 'Görüntü verisi okunamadı.');
    } finally {
        reader.releaseLock();
    }
    return { chunks, byteLength };
}

function combineImageChunks(chunks, byteLength) {
    const imageBytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
        imageBytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return imageBytes;
}

async function readImageBytes(request) {
    validateDeclaredLength(request);
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError(400, 'INVALID_OCR_PAYLOAD', 'Görüntü verisi okunamadı.');
    const { chunks, byteLength } = await readImageChunks(reader);
    if (byteLength === 0) throw new ApiError(400, 'INVALID_OCR_PAYLOAD', 'Görüntü verisi boş.');
    return combineImageChunks(chunks, byteLength);
}

function readRecognizedText(providerResponse) {
    const text = providerResponse?.responses?.[0]?.textAnnotations?.[0]?.description;
    return typeof text === 'string' ? text : '';
}

function hasCandidateValue(fields) {
    return Object.values(fields).some((value) => typeof value === 'string' && value.length > 0);
}

async function requireFinalizedPassport(application, repositories) {
    const requirements = await repositories.documents.listStudentRequirements(application.id);
    const passport = requirements.find((requirement) => requirement.code === 'passport'
        && requirement.revision_status === 'submitted'
        && requirement.upload_status === 'finalized');
    if (!passport) throw new ApiError(409, 'PASSPORT_NOT_FINALIZED', 'Önce pasaport belgesini yükleyip doğrulayın.');
}

/**
 * Recognizes a transient passport image for the current draft owner without persisting OCR output.
 * @param {Request} request Worker request carrying one image body.
 * @param {object} environment Worker bindings with D1 and Azure Vision configuration.
 * @returns {Promise<object>} Student-safe candidate fields only.
 * @throws {ApiError} When owner, application, document, request, or OCR checks fail.
 */
export async function recognizeCurrentPassport(request, environment) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const session = await requireApplicationSession(request, environment);
    const repositories = createD1Repositories(environment.DB);
    await enforceRateLimit(repositories, request, {
        endpoint: 'public-passport-ocr', maxRequests: 5, windowSeconds: 900
    });
    const application = await repositories.applications.findById(session.application_id);
    if (!application) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
    if (application.status !== 'draft') throw new ApiError(409, 'APPLICATION_NOT_EDITABLE', 'Bu başvuru artık düzenlenemez.');
    await requireFinalizedPassport(application, repositories);

    const mediaType = readMediaType(request);
    const imageBytes = await readImageBytes(request);
    if (!hasImageSignature(mediaType, imageBytes)) {
        throw new ApiError(400, 'INVALID_OCR_PAYLOAD', 'Görüntü verisi okunamadı.');
    }
    const providerResponse = await recognizePublicPassportImage(imageBytes, environment);
    const fields = extractPassportIdentityCandidates(readRecognizedText(providerResponse));
    if (!hasCandidateValue(fields)) {
        throw new ApiError(422, 'OCR_NO_PASSPORT_FIELDS', 'Pasaport bilgileri otomatik okunamadı.');
    }
    return { fields };
}
