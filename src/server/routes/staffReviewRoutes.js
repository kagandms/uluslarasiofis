import { requireStaff } from '../auth/staffAuth.js';
import { evaluateApplicationTransition } from '../domain/applicationStateMachine.js';
import { listDocumentPolicies, readDocumentPolicy } from '../domain/documentPolicy.js';
import { ApiError } from '../domain/errors.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { readJsonBody } from '../http/requestBody.js';
import { requireMethod, requireSameOrigin } from './shared.js';

const STAFF_ROLES = Object.freeze(['reviewer', 'admin']);

function requireOnlyKeys(body, allowedKeys) {
    if (Object.keys(body).some((key) => !allowedKeys.includes(key))) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'İşlem bilgilerini kontrol edip tekrar deneyin.');
    }
}

function readExpectedRevisionNumber(value) {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Belge revizyonunu kontrol edip tekrar deneyin.');
    }
    return value;
}

function readResubmissionReason(value) {
    if (typeof value !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', 'Açıklama alanını kontrol edip tekrar deneyin.');
    const reason = value.trim();
    const length = [...reason].length;
    const visibleLength = [...reason.replace(/[\s\p{C}]/gu, '')].length;
    if (visibleLength < 3 || length > 1000) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Açıklama 3 ile 1000 karakter arasında olmalıdır.');
    }
    return reason;
}

function requireApplication(application) {
    if (!application || application.status === 'draft') {
        throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
    }
}

async function resolveReviewTarget(repositories, applicationId, code, expectedRevisionNumber) {
    const application = await repositories.applications.findById(applicationId);
    requireApplication(application);
    if (!readDocumentPolicy(code, application.application_type, application.is_under_18 === 1,
        application.address_evidence_type ?? null)) {
        throw new ApiError(404, 'DOCUMENT_NOT_AVAILABLE', 'Belge mevcut değil veya incelemeye uygun değil.');
    }
    const document = await repositories.documents.findCurrentPrivateFileByApplicationAndCode(applicationId, code);
    if (!document) throw new ApiError(409, 'DOCUMENT_NOT_REVIEWABLE', 'Belge güncel ve güvenli incelemeye uygun değil.');
    if (document.revision_number !== expectedRevisionNumber || document.revision_status !== 'submitted') {
        throw new ApiError(409, 'DOCUMENT_REVIEW_CONFLICT', 'Belge başka bir işlem nedeniyle değişti. Güncel durumu yeniden yükleyin.');
    }
    if (!['pending', 'under_review'].includes(document.review_status)
        || !['under_review', 'resubmission_required'].includes(application.status)
        || document.upload_status !== 'finalized' || document.upload_intent_status !== 'completed'
        || document.scan_status !== 'clean' || document.cleanup_status !== 'none') {
        throw new ApiError(409, 'DOCUMENT_NOT_REVIEWABLE', 'Belge güncel ve güvenli incelemeye uygun değil.');
    }
    const policy = readDocumentPolicy(code, application.application_type, application.is_under_18 === 1,
        application.address_evidence_type ?? null);
    if (!policy.accepted_media_types.includes(document.media_type)) {
        throw new ApiError(409, 'DOCUMENT_NOT_REVIEWABLE', 'Belge güncel ve güvenli incelemeye uygun değil.');
    }
    return { application, document };
}

function reviewConflict() {
    return new ApiError(409, 'DOCUMENT_REVIEW_CONFLICT', 'Belge başka bir işlem nedeniyle değişti. Güncel durumu yeniden yükleyin.');
}

async function resolveResubmissionTarget({ repositories, applicationId, code, revisionNumber }) {
    const application = await repositories.applications.findById(applicationId);
    requireApplication(application);
    const policy = readDocumentPolicy(code, application.application_type, application.is_under_18 === 1,
        application.address_evidence_type ?? null);
    if (!policy) throw new ApiError(404, 'DOCUMENT_NOT_AVAILABLE', 'Belge mevcut değil veya yenilemeye uygun değil.');
    const document = await repositories.applicationReviews.findCurrentDocumentForResubmission(applicationId, code);
    if (!document) throw new ApiError(409, 'DOCUMENT_NOT_REVIEWABLE', 'Belge güncel ve yenilemeye uygun değil.');
    if (document.revision_number !== revisionNumber || document.revision_status !== 'submitted') {
        throw reviewConflict();
    }
    if (!['pending', 'under_review'].includes(document.review_status)
        || !policy.accepted_media_types.includes(document.media_type)) {
        throw new ApiError(409, 'DOCUMENT_NOT_REVIEWABLE', 'Belge güncel ve yenilemeye uygun değil.');
    }
    return document;
}

/**
 * Approves a safe, current application document revision for an authenticated reviewer.
 * @param {{request: Request, environment: object, applicationId: string, code: string, requestId: string}} input Staff route context.
 * @returns {Promise<object>} Safe mutation result.
 */
export async function approveStaffApplicationDocument({ request, environment, applicationId, code, requestId }) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const staff = await requireStaff(request, environment, STAFF_ROLES);
    const body = await readJsonBody(request);
    requireOnlyKeys(body, ['expected_revision_number']);
    const revisionNumber = readExpectedRevisionNumber(body.expected_revision_number);
    const repositories = createD1Repositories(environment.DB);
    const { document } = await resolveReviewTarget(repositories, applicationId, code, revisionNumber);
    const now = new Date().toISOString();
    const approved = await repositories.applicationReviews.approveCurrentDocument({
        applicationId, documentRecordId: document.document_record_id, revisionId: document.revision_id,
        revisionNumber, code, staffId: staff.id, now, requestId, auditId: crypto.randomUUID()
    });
    if (!approved) throw reviewConflict();
    return { document_status: 'approved', revision_number: revisionNumber };
}

/** Reopens an approved current document for review while retaining its clean scan verdict. */
export async function unapproveStaffApplicationDocument({ request, environment, applicationId, code, requestId }) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const staff = await requireStaff(request, environment, STAFF_ROLES);
    const body = await readJsonBody(request);
    requireOnlyKeys(body, ['expected_revision_number']);
    const revisionNumber = readExpectedRevisionNumber(body.expected_revision_number);
    const repositories = createD1Repositories(environment.DB);
    const application = await repositories.applications.findById(applicationId);
    requireApplication(application);
    if (!readDocumentPolicy(code, application.application_type, application.is_under_18 === 1,
        application.address_evidence_type ?? null)) {
        throw new ApiError(404, 'DOCUMENT_NOT_AVAILABLE', 'Belge mevcut değil veya incelemeye uygun değil.');
    }
    const document = await repositories.documents.findCurrentPrivateFileByApplicationAndCode(applicationId, code);
    if (!document || document.revision_number !== revisionNumber || document.revision_status !== 'approved'
        || document.review_status !== 'approved' || !['under_review', 'resubmission_required'].includes(application.status)
        || document.upload_status !== 'finalized' || document.upload_intent_status !== 'completed'
        || document.scan_status !== 'clean' || document.cleanup_status !== 'none') throw reviewConflict();
    const updated = await repositories.applicationReviews.unapproveCurrentDocument({
        applicationId, documentRecordId: document.document_record_id, revisionId: document.revision_id,
        revisionNumber, code, staffId: staff.id, now: new Date().toISOString(), requestId, auditId: crypto.randomUUID()
    });
    if (!updated) throw reviewConflict();
    return { document_status: 'under_review', revision_number: revisionNumber };
}

/**
 * Requests replacement of a finalized current document without opening it; stores the reason atomically.
 * @param {{request: Request, environment: object, applicationId: string, code: string, requestId: string}} input Staff route context.
 * @returns {Promise<object>} Safe mutation result.
 */
export async function requestStaffDocumentResubmission({ request, environment, applicationId, code, requestId }) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const staff = await requireStaff(request, environment, STAFF_ROLES);
    const body = await readJsonBody(request);
    requireOnlyKeys(body, ['expected_revision_number', 'reason']);
    const revisionNumber = readExpectedRevisionNumber(body.expected_revision_number);
    const reason = readResubmissionReason(body.reason);
    const repositories = createD1Repositories(environment.DB);
    const document = await resolveResubmissionTarget({ repositories, applicationId, code, revisionNumber });
    const now = new Date().toISOString();
    const updated = await repositories.applicationReviews.requestCurrentDocumentResubmission({
        applicationId, documentRecordId: document.document_record_id, revisionId: document.revision_id,
        revisionNumber, expectedScanStatus: document.scan_status, code, staffId: staff.id, reason, now, requestId,
        auditId: crypto.randomUUID(), noteId: crypto.randomUUID()
    });
    if (!updated) throw reviewConflict();
    return { application_status: 'resubmission_required', document_status: 'resubmission_required', revision_number: revisionNumber };
}

/**
 * Applies one guarded staff status transition to a non-draft application.
 * @param {{request: Request, environment: object, applicationId: string, requestId: string}} input Staff route context.
 * @returns {Promise<object>} Safe status result.
 */
export async function transitionStaffApplicationStatus({ request, environment, applicationId, requestId }) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const staff = await requireStaff(request, environment, STAFF_ROLES);
    const body = await readJsonBody(request);
    requireOnlyKeys(body, ['target_status', 'expected_updated_at']);
    if (typeof body.target_status !== 'string' || typeof body.expected_updated_at !== 'string'
        || !body.expected_updated_at.trim() || body.expected_updated_at.length > 64) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru durumu ve sürümü kontrol edip tekrar deneyin.');
    }
    const repositories = createD1Repositories(environment.DB);
    const application = await repositories.applications.findById(applicationId);
    requireApplication(application);
    if (application.updated_at !== body.expected_updated_at) {
        throw new ApiError(409, 'APPLICATION_STATE_CONFLICT', 'Başvuru başka bir işlem nedeniyle değişti. Güncel durumu yeniden yükleyin.');
    }
    const storedRequirements = await repositories.documents.listStudentRequirements(applicationId);
    const requirementsByCode = new Map(storedRequirements.map((requirement) => [requirement.code, requirement]));
    const requirements = listDocumentPolicies(application.application_type, application.is_under_18 === 1,
        application.address_evidence_type ?? null).map((policy) => ({
        ...requirementsByCode.get(policy.code), is_required: policy.required ? 1 : 0
    }));
    const transition = evaluateApplicationTransition(application.status, body.target_status, {
        hasResubmissionRequiredDocuments: requirements.some((requirement) =>
            requirement.review_status === 'resubmission_required' || requirement.revision_status === 'resubmission_required'),
        allRequiredDocumentsApproved: requirements.filter((requirement) => requirement.is_required === 1)
            .every((requirement) => requirement.review_status === 'approved'
                && requirement.revision_status === 'approved'
                && requirement.upload_status === 'finalized' && requirement.scan_status === 'clean'
                && requirement.current_cleanup_status === 'none' && requirement.upload_intent_status === 'completed')
    });
    if (!transition.allowed) {
        const code = transition.code === 'APPLICATION_NOT_READY_FOR_APPROVAL'
            ? transition.code : transition.code === 'RESUBMISSION_DOCUMENTS_REMAIN'
                ? 'APPLICATION_NOT_READY_FOR_REVIEW' : 'INVALID_APPLICATION_TRANSITION';
        throw new ApiError(409, code, code === 'APPLICATION_NOT_READY_FOR_APPROVAL'
            ? 'İşlem onayı için tüm zorunlu belgeler onaylanmış olmalıdır.'
            : code === 'APPLICATION_NOT_READY_FOR_REVIEW'
                ? 'Yeniden yükleme bekleyen belgeler tamamlanmadan inceleme sürdürülemez.'
                : 'Bu başvuru durum geçişine izin verilmiyor.');
    }
    const now = new Date().toISOString();
    const updated = await repositories.applicationReviews.transitionApplicationStatus({
        applicationId, currentStatus: application.status, expectedUpdatedAt: body.expected_updated_at,
        targetStatus: body.target_status, staffId: staff.id, now, requestId, auditId: crypto.randomUUID()
    });
    if (!updated) {
        throw new ApiError(409, 'APPLICATION_STATE_CONFLICT', 'Başvuru başka bir işlem nedeniyle değişti. Güncel durumu yeniden yükleyin.');
    }
    return { application_status: body.target_status, updated_at: now };
}
