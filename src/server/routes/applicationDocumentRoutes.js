import { ApiError } from '../domain/errors.js';
import { calculateStudentDocumentRequirements } from '../domain/documentRequirements.js';
import { requireApplicationSession } from '../auth/applicationAuth.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { createDocumentStorage } from '../storage/documentStorage.js';
import { readJsonBody } from '../http/requestBody.js';
import { routeResult } from '../http/routeResult.js';
import { requireMethod, requireSameOrigin } from './shared.js';

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const UPLOAD_INTENT_SECONDS = 10 * 60;
const ALLOWED_MEDIA_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

function requireUploadMetadata(body) {
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
    const mediaType = typeof body.media_type === 'string' ? body.media_type.trim().toLowerCase() : '';
    const byteSize = body.byte_size;
    if (!/^[a-z0-9_]{1,80}$/.test(code)
        || !filename || filename.length > 255
        || !ALLOWED_MEDIA_TYPES.has(mediaType)
        || !Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MAX_DOCUMENT_BYTES) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Belge adı, biçimi veya boyutunu kontrol edip tekrar deneyin.');
    }
    return { code, filename: createSafeFilename(filename), mediaType, byteSize };
}

function createSafeFilename(filename) {
    const leafName = filename.split(/[\\/]/).pop() || 'document';
    const safeName = leafName.normalize('NFKC').replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^[. ]+|[. ]+$/g, '');
    return (safeName || 'document').slice(0, 120);
}

async function readCurrentStudentRequirements(session, environment) {
    const repositories = createD1Repositories(environment.DB);
    const application = await repositories.applications.findById(session.application_id);
    if (!application) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
    const storedRequirements = await repositories.documents.listStudentRequirements(application.id);
    const requirements = calculateStudentDocumentRequirements(storedRequirements, application);
    return { application, repositories, requirements };
}

function createStudentRequirementDto(requirement) {
    return {
        code: requirement.code,
        is_required: Boolean(requirement.is_required),
        revision_number: requirement.revision_number ?? null,
        review_status: requirement.review_status ?? null,
        revision_status: requirement.revision_status ?? null,
        upload_status: requirement.upload_status ?? null,
        scan_status: requirement.scan_status ?? null,
        filename: requirement.original_filename ?? null
    };
}

function requireDraftApplication(application) {
    if (application.status !== 'draft') {
        throw new ApiError(409, 'APPLICATION_NOT_EDITABLE', 'Bu başvuru artık düzenlenemez.');
    }
}

function requireOwnedRequirement(requirements, code) {
    const requirement = requirements.find((entry) => entry.code === code);
    if (requirement) return requirement;
    throw new ApiError(404, 'DOCUMENT_REQUIREMENT_NOT_FOUND', 'Bu başvuru için belge gereksinimi bulunamadı.');
}

function createUploadResponse(intentId, capability, expiresAt) {
    return {
        upload: {
            intent_id: intentId,
            method: capability.method,
            url: capability.url,
            required_headers: capability.requiredHeaders,
            capability_expires_at: capability.expiresAt,
            intent_expires_at: expiresAt
        }
    };
}

/**
 * Reads the server-calculated residence-document set for the current application owner.
 * @param {Request} request Worker request.
 * @param {object} environment Worker bindings.
 * @returns {Promise<object>} Student-safe requirements without internal identifiers or storage keys.
 * @throws {ApiError} When the owner session or application is unavailable.
 */
export async function readCurrentStudentDocumentRequirements(request, environment) {
    requireMethod(request, 'GET');
    const session = await requireApplicationSession(request, environment);
    const { application, requirements } = await readCurrentStudentRequirements(session, environment);
    return {
        application: { is_under_18: application.is_under_18 === 1 },
        requirements: requirements.map(createStudentRequirementDto)
    };
}

/**
 * Creates an owner-bound revision and a short-lived direct-to-R2 upload capability.
 * @param {Request} request Worker request.
 * @param {object} environment Worker bindings.
 * @returns {Promise<object>} Upload capability and opaque intent reference.
 * @throws {ApiError} When ownership, requirement, file metadata, or storage configuration is invalid.
 */
export async function createCurrentStudentDocumentUploadIntent(request, environment) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const session = await requireApplicationSession(request, environment);
    const metadata = requireUploadMetadata(await readJsonBody(request));
    const { application, repositories, requirements } = await readCurrentStudentRequirements(session, environment);
    requireDraftApplication(application);
    requireOwnedRequirement(requirements, metadata.code);
    const requirement = await repositories.documents.findStudentRequirementId(application.application_type, metadata.code);
    if (!requirement) throw new ApiError(404, 'DOCUMENT_REQUIREMENT_NOT_FOUND', 'Bu başvuru için belge gereksinimi bulunamadı.');

    const now = new Date();
    const expiresAt = new Date(now.valueOf() + UPLOAD_INTENT_SECONDS * 1000).toISOString();
    const storage = createDocumentStorage(environment);
    const storageKey = storage.createQuarantineKey();
    const intentId = crypto.randomUUID();
    let capability;
    try {
        capability = await storage.createUploadCapability(storageKey, {
            contentType: metadata.mediaType,
            expiresInSeconds: 300
        });
    } catch (error) {
        console.error('Student document upload capability failed.', {
            errorName: error?.name || 'UnknownError',
            errorCode: error?.code || 'STORAGE_SIGNING_ERROR'
        });
        throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Belge yükleme hizmeti şu anda kullanılamıyor.', true);
    }

    const created = await repositories.documents.createStudentUploadIntent({
        applicationId: application.id,
        requirementId: requirement.id,
        documentRecordId: crypto.randomUUID(),
        revisionId: crypto.randomUUID(),
        fileId: crypto.randomUUID(),
        storageKey,
        filename: metadata.filename,
        mediaType: metadata.mediaType,
        byteSize: metadata.byteSize,
        intentId,
        idempotencyKey: crypto.randomUUID(),
        expiresAt,
        createdAt: now.toISOString()
    });
    if (!created) throw new ApiError(409, 'DOCUMENT_REQUIREMENT_CHANGED', 'Belge gereksinimi değişti. Listeyi yenileyip tekrar deneyin.');
    return routeResult(createUploadResponse(intentId, capability, expiresAt), { status: 201 });
}

function isEligibleRequirement(requirements, code) {
    return requirements.some((requirement) => requirement.code === code);
}

function createFinalizedDocumentDto(intent) {
    return {
        code: intent.code,
        revision_number: intent.revision_number,
        upload_status: 'finalized',
        scan_status: 'pending'
    };
}

/**
 * Verifies the uploaded R2 object, then makes its revision the current student document.
 * @param {Request} request Worker request.
 * @param {object} environment Worker bindings.
 * @returns {Promise<object>} Student-safe finalized document state.
 * @throws {ApiError} When the upload intent, object, owner session, or current requirement is invalid.
 */
export async function finalizeCurrentStudentDocument(request, environment) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const session = await requireApplicationSession(request, environment);
    const body = await readJsonBody(request);
    if (typeof body.intent_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.intent_id)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Belge yüklemesini doğrulayıp tekrar deneyin.');
    }
    const { application, repositories, requirements } = await readCurrentStudentRequirements(session, environment);
    requireDraftApplication(application);
    const intent = await repositories.documents.findStudentUploadIntent(application.id, body.intent_id);
    if (!intent || !isEligibleRequirement(requirements, intent.code)) {
        throw new ApiError(404, 'DOCUMENT_REQUIREMENT_NOT_FOUND', 'Belge yüklemesi bu başvuru için bulunamadı.');
    }
    if (intent.intent_status === 'completed') return { document: createFinalizedDocumentDto(intent) };
    if (intent.intent_status !== 'pending') throw new ApiError(409, 'UPLOAD_INTENT_UNAVAILABLE', 'Belge yükleme bağlantısı artık kullanılamıyor.');
    if (new Date(intent.expires_at).valueOf() <= Date.now()) {
        await repositories.documents.expireStudentUploadIntent(application.id, intent.id);
        throw new ApiError(409, 'UPLOAD_INTENT_EXPIRED', 'Belge yükleme süresi doldu. Yeni bir yükleme başlatın.');
    }

    const storage = createDocumentStorage(environment);
    const object = await storage.head(intent.storage_key);
    if (!object) throw new ApiError(409, 'UPLOAD_OBJECT_MISSING', 'Yüklenen belge bulunamadı. Yüklemeyi yeniden deneyin.');
    const actualSize = object.size;
    const actualMediaType = object.httpMetadata?.contentType;
    if (actualSize !== intent.byte_size || actualSize > MAX_DOCUMENT_BYTES || actualMediaType !== intent.media_type) {
        await repositories.documents.rejectStudentUpload(application.id, intent.id);
        await storage.delete(intent.storage_key);
        throw new ApiError(409, 'UPLOAD_OBJECT_MISMATCH', 'Yüklenen belge bilgileri doğrulanamadı. Yeni bir yükleme başlatın.');
    }

    const finalizedAt = new Date().toISOString();
    const finalized = await repositories.documents.finalizeStudentUpload({
        applicationId: application.id,
        intentId: intent.id,
        fileId: intent.file_id,
        revisionId: intent.revision_id,
        documentRecordId: intent.document_record_id,
        finalizedAt
    });
    if (!finalized) {
        const refreshedIntent = await repositories.documents.findStudentUploadIntent(application.id, intent.id);
        if (refreshedIntent?.intent_status !== 'completed') {
            throw new ApiError(409, 'UPLOAD_INTENT_UNAVAILABLE', 'Belge yükleme bağlantısı artık kullanılamıyor.');
        }
        return { document: createFinalizedDocumentDto(refreshedIntent) };
    }
    return { document: createFinalizedDocumentDto(intent) };
}
