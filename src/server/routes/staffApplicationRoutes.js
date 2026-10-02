import { ApiError } from '../domain/errors.js';
import { listDocumentPolicies } from '../domain/documentPolicy.js';
import { evaluateApplicationTransition, listApplicationStatusTransitions } from '../domain/applicationStateMachine.js';
import { requireStaff } from '../auth/staffAuth.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { readJsonBody } from '../http/requestBody.js';
import { requireMethod, requireSameOrigin } from './shared.js';

const STAFF_ROLES = Object.freeze(['reviewer', 'admin']);
const APPLICATION_STATUS_FILTERS = Object.freeze({
    all: null,
    new: Object.freeze(['submitted']),
    under_review: Object.freeze(['under_review']),
    resubmission_required: Object.freeze(['resubmission_required']),
    approved: Object.freeze(['approved_for_processing']),
    migration: Object.freeze(['sent_to_migration', 'migration_approved']),
    completed: Object.freeze(['completed']),
    terminal: Object.freeze(['completed', 'cancelled', 'rejected']),
    cancelled: Object.freeze(['cancelled']),
    rejected: Object.freeze(['rejected'])
});
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 120;
const READABLE_REVISION_STATUSES = new Set(['submitted', 'approved', 'resubmission_required']);

function readSearchTerm(value) {
    if (value === undefined) return '';
    if (typeof value !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', 'Arama metnini kontrol edip tekrar deneyin.');
    const searchTerm = value.trim();
    if (searchTerm.length > MAX_SEARCH_LENGTH) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Arama metnini kontrol edip tekrar deneyin.');
    }
    return searchTerm;
}

function readPageNumber(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Sayfalama bilgilerini kontrol edip tekrar deneyin.');
    }
    return value;
}

function escapeLikeTerm(value) {
    return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

function readApplicationQuery(body) {
    const allowedKeys = new Set(['q', 'status', 'page', 'page_size']);
    if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Arama ve filtre bilgilerini kontrol edip tekrar deneyin.');
    }
    const statusFilter = body.status ?? 'all';
    if (typeof statusFilter !== 'string' || !Object.hasOwn(APPLICATION_STATUS_FILTERS, statusFilter)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru durumu filtresini kontrol edip tekrar deneyin.');
    }
    const pageSize = readPageNumber(body.page_size, 25, MAX_PAGE_SIZE);
    const maximumPage = Math.floor(Number.MAX_SAFE_INTEGER / pageSize);
    return {
        searchTerm: readSearchTerm(body.q),
        statuses: APPLICATION_STATUS_FILTERS[statusFilter],
        page: readPageNumber(body.page, 1, maximumPage),
        pageSize
    };
}

function createQueueItemDto(application) {
    return {
        id: application.id,
        student_number: application.student_number,
        first_name: application.first_name,
        last_name: application.last_name,
        application_type: application.application_type,
        status: application.status,
        submitted_at: application.submitted_at,
        updated_at: application.updated_at
    };
}

function createApplicationDetailDto(application) {
    return {
        id: application.id,
        reference_number: application.reference_number ?? null,
        student_number: application.student_number,
        status: application.status,
        application_type: application.application_type,
        created_at: application.created_at,
        updated_at: application.updated_at,
        submitted_at: application.submitted_at,
        first_name: application.first_name,
        last_name: application.last_name,
        email: application.student_email,
        phone: application.student_phone,
        passport_number: application.passport_number,
        nationality: application.nationality,
        date_of_birth: application.date_of_birth,
        is_under_18: application.is_under_18 === null ? null : application.is_under_18 === 1,
        address_evidence_type: application.address_evidence_type ?? null,
        fingerprint_status: application.fingerprint_status ?? null,
        fingerprint_code: application.fingerprint_code ?? null,
        declaration_version: application.declaration_version ?? null,
        declaration_accepted_at: application.declaration_accepted_at ?? null,
        contact_acknowledgement_accepted_current: application.contact_acknowledgement_accepted_current === 1,
        contact_acknowledgement_accepted_at: application.contact_acknowledgement_accepted_at ?? null
    };
}

function readSafeFilename(filename) {
    if (typeof filename !== 'string') return null;
    const safeFilename = filename.replace(/[\\/\u0000-\u001F\u007F]/g, '').trim();
    return safeFilename ? safeFilename.slice(0, 255) : null;
}

function createDocumentDetailDtos(application, storedRequirements) {
    const requirementsByCode = new Map(storedRequirements.map((requirement) => [requirement.code, requirement]));
    return listDocumentPolicies(
        application.application_type,
        application.is_under_18 === 1,
        application.address_evidence_type ?? null
    ).map((policy) => {
        const requirement = requirementsByCode.get(policy.code) || {};
        const hasFinalizedCurrentDocument = READABLE_REVISION_STATUSES.has(requirement.revision_status)
            && requirement.upload_status === 'finalized'
            && requirement.current_cleanup_status === 'none'
            && requirement.upload_intent_status === 'completed'
            && policy.accepted_media_types.includes(requirement.media_type);
        const hasSafeCurrentDocument = hasFinalizedCurrentDocument && requirement.scan_status === 'clean';
        return {
            code: policy.code,
            label_key: policy.label_key,
            required: policy.required,
            access_available: hasSafeCurrentDocument,
            can_approve: hasSafeCurrentDocument && requirement.revision_status === 'submitted'
                && ['pending', 'under_review'].includes(requirement.review_status)
                && ['under_review', 'resubmission_required'].includes(application.status),
            can_request_resubmission: hasFinalizedCurrentDocument
                && ['clean', 'unsafe', 'failed'].includes(requirement.scan_status) && requirement.revision_status === 'submitted'
                && ['pending', 'under_review'].includes(requirement.review_status)
                && ['under_review', 'resubmission_required'].includes(application.status),
            revision_number: requirement.revision_number ?? null,
            review_status: requirement.review_status ?? null,
            revision_status: requirement.revision_status ?? null,
            upload_status: requirement.upload_status ?? null,
            scan_status: requirement.scan_status ?? null,
            cleanup_status: requirement.cleanup_status ?? null,
            filename: readSafeFilename(requirement.original_filename),
            ...(typeof requirement.student_message === 'string' ? { student_message: requirement.student_message } : {})
        };
    });
}

function readAllowedStatusTransitions(application, requirements) {
    const requirementsByCode = new Map(requirements.map((requirement) => [requirement.code, requirement]));
    const applicableRequirements = listDocumentPolicies(
        application.application_type,
        application.is_under_18 === 1,
        application.address_evidence_type ?? null
    ).map((policy) => ({ ...requirementsByCode.get(policy.code), is_required: policy.required ? 1 : 0 }));
    const hasResubmissionRequiredDocuments = applicableRequirements.some((requirement) =>
        requirement.review_status === 'resubmission_required' || requirement.revision_status === 'resubmission_required');
    const allRequiredDocumentsApproved = applicableRequirements.filter((requirement) => requirement.is_required === 1)
        .every((requirement) => requirement.review_status === 'approved'
            && requirement.revision_status === 'approved'
            && requirement.upload_status === 'finalized'
            && requirement.scan_status === 'clean'
            && requirement.current_cleanup_status === 'none'
            && requirement.upload_intent_status === 'completed');
    return listApplicationStatusTransitions(application.status).filter((targetStatus) =>
        evaluateApplicationTransition(application.status, targetStatus, {
            hasResubmissionRequiredDocuments, allRequiredDocumentsApproved
        }).allowed);
}

/**
 * Returns one staff-filtered, paginated page of non-draft applications.
 * @param {Request} request Same-origin POST request from an authenticated staff member.
 * @param {object} environment Worker bindings containing D1.
 * @returns {Promise<object>} Staff-safe queue items and pagination metadata.
 * @throws {ApiError} When method, origin, session, role, or query data is invalid.
 */
export async function queryStaffApplications(request, environment) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    await requireStaff(request, environment, STAFF_ROLES);
    const query = readApplicationQuery(await readJsonBody(request));
    const offset = (query.page - 1) * query.pageSize;
    const result = await createD1Repositories(environment.DB).applications.queryStaffApplications({
        statuses: query.statuses,
        searchPattern: query.searchTerm ? escapeLikeTerm(query.searchTerm) : null,
        pageSize: query.pageSize,
        offset
    });
    return {
        items: result.items.map(createQueueItemDto),
        pagination: {
            page: query.page,
            page_size: query.pageSize,
            total_items: result.totalItems,
            total_pages: result.totalItems === 0 ? 0 : Math.ceil(result.totalItems / query.pageSize)
        }
    };
}

/**
 * Returns one non-draft application detail and its current policy-based document metadata.
 * @param {Request} request Authenticated staff GET request.
 * @param {object} environment Worker bindings containing D1.
 * @param {string} applicationId Exact application identifier from the route.
 * @returns {Promise<object>} Explicit staff detail DTO with no storage or session capabilities.
 * @throws {ApiError} When method, staff session, or application visibility is invalid.
 */
export async function readStaffApplicationDetail(request, environment, applicationId) {
    requireMethod(request, 'GET');
    await requireStaff(request, environment, STAFF_ROLES);
    const repositories = createD1Repositories(environment.DB);
    const application = await repositories.applications.findById(applicationId);
    if (!application || application.status === 'draft') {
        throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');
    }
    const [storedRequirements, studentMessages] = await Promise.all([
        repositories.documents.listStudentRequirements(application.id),
        repositories.applicationNotes.listLatestStudentDocumentMessages(application.id)
    ]);
    const requirementsWithMessages = storedRequirements.map((requirement) => ({
        ...requirement,
        student_message: studentMessages.get(requirement.document_record_id)
    }));
    return {
        application: createApplicationDetailDto(application),
        allowed_status_transitions: readAllowedStatusTransitions(application, storedRequirements),
        documents: createDocumentDetailDtos(application, requirementsWithMessages)
    };
}
