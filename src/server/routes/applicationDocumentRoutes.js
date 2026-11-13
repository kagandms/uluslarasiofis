import { ApiError } from '../domain/errors.js';
import { listApplicationDocumentPolicies, readApplicationDocumentPolicy } from '../domain/documentPolicy.js';
import { requireApplicationSession } from '../auth/applicationAuth.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { createDocumentStorage } from '../storage/documentStorage.js';
import { readJsonBody } from '../http/requestBody.js';
import { routeResult } from '../http/routeResult.js';
import { requireMethod, requireSameOrigin } from './shared.js';
import { readStudentUploadMetadata } from '../domain/studentUploadMetadata.js';
import { isWorkerProxiedUploadEnabled } from '../config/localDocumentUpload.js';

const UPLOAD_INTENT_SECONDS = 10 * 60;

async function readCurrentStudentRequirements(session, environment) {
    const repositories = createD1Repositories(environment.DB);
    const application = await repositories.applications.findById(session.application_id);
    if (!application) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
    const storedRequirements = await repositories.documents.listStudentRequirements(application.id);
    const policies = listApplicationDocumentPolicies(application);
    const requirements = policies.filter((policy) => storedRequirements.some((entry) => entry.code === policy.code))
        .map((policy) => {
            const stored = storedRequirements.find((entry) => entry.code === policy.code);
            return {
                ...policy,
                review_status: stored.review_status,
                revision_number: stored.revision_number,
                revision_status: stored.revision_status,
                upload_status: stored.upload_status,
                scan_status: stored.scan_status,
                original_filename: stored.original_filename,
                cleanup_status: stored.cleanup_status
            };
        });
    return { application, repositories, requirements };
}

function createStudentRequirementDto(requirement) {
    return {
        code: requirement.code,
        required: requirement.required,
        is_required: requirement.required,
        display_order: requirement.display_order,
        label_key: requirement.label_key,
        description_key: requirement.description_key,
        accepted_media_types: requirement.accepted_media_types,
        max_byte_size: requirement.max_byte_size,
        conditional_rule: requirement.conditional_rule,
        revision_number: requirement.revision_number ?? null,
        review_status: requirement.review_status ?? null,
        revision_status: requirement.revision_status ?? null,
        upload_status: requirement.upload_status ?? null,
        scan_status: requirement.scan_status ?? null,
        filename: requirement.original_filename ?? null,
        cleanup_status: requirement.cleanup_status ?? null
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

export async function readBoundedUploadBody(request, expectedSize, maximumSize) {
    const contentLengthHeader = request.headers.get('Content-Length');
    if (contentLengthHeader !== null) {
        if (!/^\d+$/u.test(contentLengthHeader)) {
            throw new ApiError(400, 'UPLOAD_SIZE_MISMATCH', 'Yüklenen belge bilgileri doğrulanamadı.');
        }
        const contentLength = Number(contentLengthHeader);
        if (!Number.isSafeInteger(contentLength) || contentLength > maximumSize) {
            throw new ApiError(413, 'FILE_TOO_LARGE', 'Belge boyutu izin verilen sınırı aşıyor.');
        }
        if (contentLength !== expectedSize) {
            throw new ApiError(400, 'UPLOAD_SIZE_MISMATCH', 'Yüklenen belge bilgileri doğrulanamadı.');
        }
    }
    if (!request.body) throw new ApiError(400, 'UPLOAD_BODY_REQUIRED', 'Belge içeriği bulunamadı.');

    const reader = request.body.getReader();
    const chunks = [];
    let totalSize = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            totalSize += chunk.value.byteLength;
            if (totalSize > maximumSize) {
                await reader.cancel();
                throw new ApiError(413, 'FILE_TOO_LARGE', 'Belge boyutu izin verilen sınırı aşıyor.');
            }
            if (totalSize > expectedSize) {
                await reader.cancel();
                throw new ApiError(400, 'UPLOAD_SIZE_MISMATCH', 'Yüklenen belge bilgileri doğrulanamadı.');
            }
            chunks.push(chunk.value);
        }
    } finally {
        reader.releaseLock();
    }
    if (totalSize !== expectedSize) {
        throw new ApiError(400, 'UPLOAD_SIZE_MISMATCH', 'Yüklenen belge bilgileri doğrulanamadı.');
    }

    const body = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return body;
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
        application: {
            application_type: application.application_type,
            address_evidence_type: application.accommodation_type || application.address_evidence_type || null,
            is_under_18: application.is_under_18 === 1
        },
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
    const { application, repositories, requirements } = await readCurrentStudentRequirements(session, environment);
    const body = await readJsonBody(request);
    const requestedCode = typeof body.code === 'string' ? body.code.trim() : '';
    requireOwnedRequirement(requirements, requestedCode);
    const policy = readApplicationDocumentPolicy(requestedCode, application);
    const metadata = readStudentUploadMetadata(body, policy);
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
    if (isWorkerProxiedUploadEnabled(environment)) {
        capability = {
            method: 'PUT',
            url: new URL(`/api/public/applications/current/documents/local-upload/${intentId}`, request.url).href,
            requiredHeaders: { 'content-type': metadata.mediaType, 'if-none-match': '*' },
            expiresAt: expiresAt
        };
    } else {
        try {
            capability = await storage.createWriteOnceUploadCapability(storageKey, {
                contentType: metadata.mediaType,
                expiresInSeconds: 300
            });
        } catch (error) {
            const diagnostics = error?.storageSigningDiagnostics;
            const logFields = {
                storageSigningStage: diagnostics?.storageSigningStage || 'unknown',
                errorName: diagnostics?.errorName || error?.name || 'UnknownError',
                errorCode: diagnostics?.errorCode || error?.code || 'STORAGE_SIGNING_ERROR'
            };
            if (environment.APP_ENV === 'staging' && diagnostics) {
                logFields.errorMessage = diagnostics.errorMessage;
                logFields.errorStack = diagnostics.errorStack;
            }
            console.error('Student document upload capability failed.', {
                ...logFields
            });
            throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Belge yükleme hizmeti şu anda kullanılamıyor.', true);
        }
    }

    const created = await repositories.documents.createStudentUploadIntent({
        applicationId: application.id,
        requirementId: requirement.id,
        conditionalRule: policy.conditional_rule,
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

/** Writes one owner-bound upload to the local R2 binding without using external signing credentials. */
export async function uploadLocalStudentDocument(request, environment, intentId) {
    requireMethod(request, 'PUT');
    if (!isWorkerProxiedUploadEnabled(environment)) {
        throw new ApiError(404, 'NOT_FOUND', 'İstenen kaynak bulunamadı.');
    }
    requireSameOrigin(request);
    if (!/^[0-9a-f-]{36}$/i.test(intentId)) {
        throw new ApiError(404, 'DOCUMENT_REQUIREMENT_NOT_FOUND', 'Belge yüklemesi bu başvuru için bulunamadı.');
    }
    const session = await requireApplicationSession(request, environment);
    const { application, repositories, requirements } = await readCurrentStudentRequirements(session, environment);
    requireDraftApplication(application);
    const intent = await repositories.documents.findStudentUploadIntent(application.id, intentId);
    if (!intent || !isEligibleRequirement(requirements, intent.code)) {
        throw new ApiError(404, 'DOCUMENT_REQUIREMENT_NOT_FOUND', 'Belge yüklemesi bu başvuru için bulunamadı.');
    }
    if (intent.intent_status !== 'pending') {
        throw new ApiError(409, 'UPLOAD_INTENT_UNAVAILABLE', 'Belge yükleme bağlantısı artık kullanılamıyor.');
    }
    if (new Date(intent.expires_at).valueOf() <= Date.now()) {
        await repositories.documents.expireStudentUploadIntent(application.id, intent.id);
        throw new ApiError(409, 'UPLOAD_INTENT_EXPIRED', 'Belge yükleme süresi doldu. Yeni bir yükleme başlatın.');
    }

    const policy = readApplicationDocumentPolicy(intent.code, application);
    const contentType = request.headers.get('Content-Type')?.trim().toLowerCase() || '';
    if (!policy || !policy.accepted_media_types.includes(contentType) || contentType !== intent.media_type) {
        throw new ApiError(415, 'INVALID_FILE', 'Belge biçimini kontrol edip tekrar deneyin.');
    }
    const body = await readBoundedUploadBody(request, intent.byte_size, policy.max_byte_size);
    const storage = createDocumentStorage(environment);
    try {
        const stored = await storage.putIfAbsent(intent.storage_key, body, contentType);
        if (!stored) throw new ApiError(409, 'UPLOAD_ALREADY_RECEIVED', 'Bu belge yüklemesi daha önce alındı.');
    } catch (error) {
        if (error instanceof ApiError) throw error;
        console.error('Local student document upload write failed.', {
            errorName: error?.name || 'UnknownError',
            errorCode: error?.code || 'R2_PUT_FAILED'
        });
        throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Belge yükleme hizmeti şu anda kullanılamıyor.', true);
    }
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
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
    const policy = readApplicationDocumentPolicy(intent.code, application);
    if (!policy || actualSize !== intent.byte_size || actualSize > policy.max_byte_size
        || !policy.accepted_media_types.includes(actualMediaType) || actualMediaType !== intent.media_type) {
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
        conditionalRule: policy.conditional_rule,
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

/**
 * Removes the current student's draft document from visibility, then retries private R2 cleanup safely.
 * @param {Request} request Owner-session DELETE request.
 * @param {object} environment Worker bindings.
 * @param {string} code Student-safe policy code from the route.
 * @returns {Promise<object>} Cleanup state without exposing file identifiers or storage keys.
 * @throws {ApiError} When the session, origin, application state, or requirement is invalid.
 */
export async function deleteCurrentStudentDocument(request, environment, code) {
    requireMethod(request, 'DELETE');
    requireSameOrigin(request);
    const session = await requireApplicationSession(request, environment);
    const { application, repositories, requirements } = await readCurrentStudentRequirements(session, environment);
    requireDraftApplication(application);
    requireOwnedRequirement(requirements, code);
    const deletion = await repositories.documents.beginStudentDocumentDelete({
        applicationId: application.id,
        code,
        requestedAt: new Date().toISOString()
    });
    if (!deletion.found) return { cleanup_status: 'complete' };
    if (deletion.locked) throw new ApiError(409, 'DOCUMENT_NOT_EDITABLE', 'Bu belge artık öğrenci tarafından değiştirilemez.');

    const storage = createDocumentStorage(environment);
    const files = await repositories.documents.listStudentDocumentCleanupFiles(application.id, code);
    for (const file of files) {
        try {
            await storage.delete(file.storage_key);
            await repositories.documents.completeStudentDocumentCleanup(application.id, code, file.id);
        } catch (error) {
            console.error('Student document cleanup remains pending.', {
                errorName: error?.name || 'UnknownError',
                errorCode: error?.code || 'STORAGE_DELETE_ERROR'
            });
        }
    }
    const remaining = await repositories.documents.listStudentDocumentCleanupFiles(application.id, code);
    return { cleanup_status: remaining.length ? 'pending' : 'complete' };
}

/**
 * Streams the owner's own current file inline so the applicant can preview what was uploaded.
 * Read-only; SameSite=Strict owner cookie authorizes it. Unsafe or failed scans are never served.
 * @param {Request} request Owner-session GET request.
 * @param {object} environment Worker D1 and private R2 bindings.
 * @param {string} code Document requirement code.
 * @returns {Promise<Response>} Sandboxed inline response.
 */
export async function previewCurrentStudentDocument(request, environment, code) {
    requireMethod(request, 'GET');
    const session = await requireApplicationSession(request, environment);
    const { application, repositories, requirements } = await readCurrentStudentRequirements(session, environment);
    requireOwnedRequirement(requirements, code);
    const file = await repositories.documents.findStudentPreviewFile(application.id, code);
    if (!file || !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.media_type)) {
        throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Belge bulunamadı.');
    }
    const object = await createDocumentStorage(environment).get(file.storage_key);
    if (!object?.body) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Belge bulunamadı.');
    const extension = file.media_type === 'application/pdf' ? 'pdf' : file.media_type.split('/')[1];
    const headers = new Headers({
        'Content-Type': file.media_type,
        'Content-Disposition': `inline; filename="${code.replace(/[^A-Za-z0-9_-]/g, '_')}.${extension}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; sandbox"
    });
    if (Number.isSafeInteger(file.byte_size) && file.byte_size >= 0) headers.set('Content-Length', String(file.byte_size));
    return new Response(object.body, { status: 200, headers });
}
