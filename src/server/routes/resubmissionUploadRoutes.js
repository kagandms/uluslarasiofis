import { evaluateResubmissionEligibility } from '../domain/resubmissionUploadPolicy.js';
import { readDocumentPolicy, listDocumentPolicies } from '../domain/documentPolicy.js';
import { readStudentUploadMetadata } from '../domain/studentUploadMetadata.js';
import { ApiError } from '../domain/errors.js';
import { requireApplicationSession } from '../auth/applicationAuth.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { createDocumentStorage } from '../storage/documentStorage.js';
import { readJsonBody } from '../http/requestBody.js';
import { routeResult } from '../http/routeResult.js';
import { requireMethod, requireSameOrigin } from './shared.js';

const INTENT_LIFETIME_SECONDS = 600;
const SIGNED_PUT_LIFETIME_SECONDS = 300;

function requireExactKeys(body, allowedKeys) {
    if (Object.keys(body).every((key) => allowedKeys.includes(key))) return;
    throw new ApiError(400, 'VALIDATION_ERROR', 'Belge yüklemesini kontrol edip tekrar deneyin.');
}

function createEligibilityInput(row, policy) {
    return {
        application: { id: row.application_id, status: row.application_status },
        policyIsApplicable: Boolean(policy && row.is_required),
        documentRecord: row.document_record_id ? {
            id: row.document_record_id, applicationId: row.application_id, reviewStatus: row.review_status
        } : null,
        currentRevision: row.current_revision_id ? {
            id: row.current_revision_id, documentRecordId: row.document_record_id,
            status: row.revision_status, isCurrent: row.is_current === 1,
            file: {
                uploadStatus: row.upload_status, scanStatus: row.scan_status,
                cleanupStatus: row.cleanup_status, intentStatus: row.upload_intent_status
            }
        } : null,
        hasStudentMessageForDocument: row.has_student_message_for_document === 1
    };
}

function readEligibleRow(rows, code) {
    const row = rows.find((entry) => entry.code === code);
    if (!row) return null;
    const policy = readDocumentPolicy(code, row.application_type, row.is_under_18 === 1,
        row.address_evidence_type ?? null);
    const eligibility = evaluateResubmissionEligibility(createEligibilityInput(row, policy));
    if (!eligibility.allowed) return null;
    return { row, policy, mode: eligibility.mode };
}

function requireApplication(row) {
    if (row?.application_id) return;
    throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
}

async function readOwnerContext(request, environment) {
    const session = await requireApplicationSession(request, environment);
    const repositories = createD1Repositories(environment.DB);
    const application = await repositories.applications.findById(session.application_id);
    if (!application) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
    const rows = await repositories.resubmissionUploads.readEligibility(application.id);
    return { application, repositories, rows };
}

function createIntentResponse(intentId, capability, expiresAt) {
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

function createCleanupStorage(environment) {
    try {
        return createDocumentStorage(environment);
    } catch {
        return null;
    }
}

async function retryExpiredCleanup(repositories, applicationId, storage, code) {
    if (!storage) return;
    const cleanupFiles = await repositories.resubmissionUploads.listRetryableCleanup(applicationId, code);
    for (const file of cleanupFiles) {
        try {
            await storage.delete(file.storage_key);
            await repositories.resubmissionUploads.markCleanupComplete(applicationId, file.id);
        } catch {
            // A pending cleanup is retried on a later owner-only mutation.
        }
    }
}

async function expireAbandonedIntents(repositories, applicationId) {
    const expiredIntents = await repositories.resubmissionUploads.listExpiredPendingIntents(applicationId);
    for (const intent of expiredIntents) {
        await repositories.resubmissionUploads.expireIntent(applicationId, intent.id, new Date().toISOString());
    }
}

/**
 * Returns a non-authoritative replacement hint for the owner tracking UI.
 * @param {Request} request Owner-session GET request.
 * @param {object} environment Worker bindings containing D1.
 * @returns {Promise<{documents: Array<object>}>} Policy-safe eligible document hints.
 * @throws {ApiError} When the owner session or application cannot be read.
 */
export async function readCurrentResubmissionEligibility(request, environment) {
    requireMethod(request, 'GET');
    const { application, repositories, rows } = await readOwnerContext(request, environment);
    await expireAbandonedIntents(repositories, application.id);
    await retryExpiredCleanup(repositories, application.id, createCleanupStorage(environment));
    const policies = listDocumentPolicies(application.application_type,
        application.is_under_18 === 1, application.address_evidence_type ?? null);
    const documents = rows.flatMap((row) => {
        const policy = policies.find((entry) => entry.code === row.code);
        const eligibility = evaluateResubmissionEligibility(createEligibilityInput(row, policy));
        if (!eligibility.allowed) return [];
        return [{
            code: row.code, label_key: policy.label_key, mode: eligibility.mode,
            accepted_media_types: policy.accepted_media_types, max_byte_size: policy.max_byte_size
        }];
    });
    return { documents };
}

/**
 * Creates an owner-bound replacement revision and quarantine upload capability.
 * @param {Request} request Same-origin request containing code and safe file metadata.
 * @param {object} environment Worker bindings for D1 and private R2.
 * @param {string} requestId Worker request correlation ID.
 * @returns {Promise<object>} Opaque intent and signed upload capability response.
 * @throws {ApiError} When session, policy, metadata, storage, or persisted-state checks fail.
 */
export async function createCurrentResubmissionUploadIntent(request, environment, requestId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const { application, repositories, rows } = await readOwnerContext(request, environment);
    const body = await readJsonBody(request);
    requireExactKeys(body, ['code', 'filename', 'media_type', 'byte_size']);
    await expireAbandonedIntents(repositories, application.id);
    const requestedCode = typeof body.code === 'string' ? body.code.trim() : '';
    const eligible = readEligibleRow(rows, requestedCode);
    if (!eligible) throw new ApiError(409, 'RESUBMISSION_NOT_AVAILABLE', 'Bu belge için güvenli yeniden yükleme açılamıyor.');
    const metadata = readStudentUploadMetadata(body, eligible.policy);
    await retryExpiredCleanup(repositories, application.id, createCleanupStorage(environment));

    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.valueOf() + INTENT_LIFETIME_SECONDS * 1000).toISOString();
    const storage = createDocumentStorage(environment);
    const storageKey = storage.createQuarantineKey();
    const intentId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    let capability;
    try {
        capability = await storage.createWriteOnceUploadCapability(storageKey, {
            contentType: metadata.mediaType, expiresInSeconds: SIGNED_PUT_LIFETIME_SECONDS
        });
    } catch {
        throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Belge yükleme hizmeti şu anda kullanılamıyor.', true);
    }
    const created = await repositories.resubmissionUploads.createIntent({
        applicationId: application.id, applicationType: application.application_type,
        isUnder18: application.is_under_18 === 1,
        addressEvidenceType: application.address_evidence_type ?? null,
        code: metadata.code, requirementId: eligible.row.requirement_id,
        conditionalRule: eligible.policy.conditional_rule,
        documentRecordId: eligible.row.document_record_id,
        expectedCurrentRevisionId: eligible.row.current_revision_id, mode: eligible.mode,
        revisionId, fileId, storageKey, filename: metadata.filename, mediaType: metadata.mediaType,
        byteSize: metadata.byteSize, intentId, idempotencyKey: crypto.randomUUID(), expiresAt, createdAt
    });
    if (!created) throw new ApiError(409, 'RESUBMISSION_UPLOAD_CONFLICT', 'Belge durumu değişti. Listeyi yenileyip tekrar deneyin.');
    return routeResult(createIntentResponse(intentId, capability, expiresAt), { status: 201 });
}

function requireIntentId(body) {
    requireExactKeys(body, ['intent_id']);
    if (typeof body.intent_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.intent_id)) return body.intent_id;
    throw new ApiError(400, 'VALIDATION_ERROR', 'Belge yüklemesini doğrulayıp tekrar deneyin.');
}

function objectMatchesIntent(object, intent, policy) {
    return Boolean(object && policy && object.size === intent.byte_size
        && object.size <= policy.max_byte_size
        && policy.accepted_media_types.includes(object.httpMetadata?.contentType)
        && object.httpMetadata?.contentType === intent.media_type);
}

async function invalidateIntentAndQueueCleanup(repositories, intent, status = 'rejected') {
    if (status === 'expired') {
        await repositories.resubmissionUploads.expireIntent(intent.application_id, intent.id, new Date().toISOString());
        return;
    }
    await repositories.resubmissionUploads.invalidatePendingIntent(
        intent.application_id, intent.document_record_id, intent.id, new Date().toISOString());
}

/**
 * Verifies the quarantine object and atomically makes the replacement current.
 * @param {Request} request Same-origin request containing only the opaque intent ID.
 * @param {object} environment Worker bindings for D1 and private R2.
 * @param {string} requestId Worker request correlation ID for the atomic audit record.
 * @returns {Promise<object>} Student-safe finalized document state.
 * @throws {ApiError} When owner authority, intent, eligibility, object, or finalize guard fails.
 */
export async function finalizeCurrentResubmissionUpload(request, environment, requestId) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const { application, repositories, rows } = await readOwnerContext(request, environment);
    const intentId = requireIntentId(await readJsonBody(request));
    const intent = await repositories.resubmissionUploads.findIntent(application.id, intentId);
    if (!intent) throw new ApiError(404, 'UPLOAD_INTENT_NOT_FOUND', 'Belge yüklemesi bu başvuru için bulunamadı.');
    if (intent.intent_status !== 'pending') {
        throw new ApiError(409, 'UPLOAD_INTENT_UNAVAILABLE', 'Belge yükleme bağlantısı artık kullanılamıyor.');
    }
    if (Date.parse(intent.expires_at) <= Date.now()) {
        await invalidateIntentAndQueueCleanup(repositories, intent, 'expired');
        await retryExpiredCleanup(repositories, application.id, createCleanupStorage(environment), intent.code);
        throw new ApiError(409, 'UPLOAD_INTENT_EXPIRED', 'Belge yükleme süresi doldu. Yeni bir yükleme başlatın.');
    }
    const eligible = readEligibleRow(rows, intent.code);
    if (!eligible || eligible.row.document_record_id !== intent.document_record_id
        || eligible.row.current_revision_id !== intent.expected_current_revision_id
        || eligible.mode !== intent.mode) {
        await invalidateIntentAndQueueCleanup(repositories, intent);
        throw new ApiError(409, 'RESUBMISSION_UPLOAD_CONFLICT', 'Belge durumu değişti. Listeyi yenileyip tekrar deneyin.');
    }

    const storage = createDocumentStorage(environment);
    const object = await storage.head(intent.storage_key);
    if (!objectMatchesIntent(object, intent, eligible.policy)) {
        await invalidateIntentAndQueueCleanup(repositories, intent);
        throw new ApiError(409, object ? 'UPLOAD_OBJECT_MISMATCH' : 'UPLOAD_OBJECT_MISSING',
            'Yüklenen belge doğrulanamadı. Güvenli bir yeniden yükleme başlatın.');
    }
    const finalizedAt = new Date().toISOString();
    const finalized = await repositories.resubmissionUploads.finalizeReplacement({
        applicationId: application.id, applicationType: application.application_type,
        isUnder18: application.is_under_18 === 1,
        addressEvidenceType: application.address_evidence_type ?? null,
        requirementId: intent.requirement_id, code: intent.code,
        documentRecordId: intent.document_record_id,
        expectedCurrentRevisionId: intent.expected_current_revision_id,
        replacementRevisionId: intent.revision_id, replacementFileId: intent.file_id,
        intentId: intent.id, mode: intent.mode, revisionNumber: intent.revision_number,
        finalizedAt, requestId, auditId: crypto.randomUUID()
    });
    if (!finalized) {
        await invalidateIntentAndQueueCleanup(repositories, intent);
        throw new ApiError(409, 'RESUBMISSION_UPLOAD_CONFLICT', 'Belge durumu değişti. Güvenli yeniden yükleme başlatın.');
    }
    return { document: { code: intent.code, revision_number: intent.revision_number,
        upload_status: 'finalized', scan_status: 'pending' } };
}
