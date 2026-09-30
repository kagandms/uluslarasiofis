import { ApiError } from '../domain/errors.js';
import { listDocumentPolicies } from '../domain/documentPolicy.js';
import { requireApplicationSession } from '../auth/applicationAuth.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { requireMethod } from './shared.js';

function isStudentVisibleFile(requirement) {
    return requirement?.upload_status === 'finalized'
        && ['pending', 'clean'].includes(requirement.scan_status);
}

function readStudentDocumentStatus(requirement) {
    if (requirement?.review_status === 'resubmission_required'
        || requirement?.revision_status === 'resubmission_required') return 'resubmission_required';
    if (requirement?.review_status === 'approved' || requirement?.revision_status === 'approved') return 'approved';
    if (requirement?.review_status === 'under_review') return 'under_review';
    if (isStudentVisibleFile(requirement)) return 'waiting_review';
    return 'not_uploaded';
}

function createTrackingDocumentDto(policy, requirement) {
    return {
        code: policy.code,
        label_key: policy.label_key,
        required: policy.required,
        revision_number: requirement?.revision_number ?? null,
        status: readStudentDocumentStatus(requirement),
        filename: isStudentVisibleFile(requirement) ? requirement.original_filename ?? null : null
    };
}

/**
 * Reads current application tracking data using only the authenticated applicant session.
 * @param {Request} request Request carrying the applicant HttpOnly session cookie.
 * @param {object} environment Worker bindings containing D1.
 * @returns {Promise<object>} Student-safe application and applicable document tracking DTO.
 * @throws {ApiError} When the session or its application is unavailable.
 */
export async function readCurrentApplicationTracking(request, environment) {
    requireMethod(request, 'GET');
    const session = await requireApplicationSession(request, environment);
    const repositories = createD1Repositories(environment.DB);
    const application = await repositories.applications.findById(session.application_id);
    if (!application) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Başvuru bulunamadı.');

    const policies = listDocumentPolicies(
        application.application_type,
        application.is_under_18 === 1,
        application.address_evidence_type ?? null
    );
    const storedRequirements = await repositories.documents.listStudentRequirements(application.id);
    const requirementsByCode = new Map(storedRequirements.map((requirement) => [requirement.code, requirement]));

    return {
        application: {
            student_number: application.student_number,
            status: application.status,
            application_type: application.application_type,
            created_at: application.created_at ?? null,
            updated_at: application.updated_at ?? null,
            submitted_at: application.submitted_at ?? null
        },
        documents: policies.map((policy) => createTrackingDocumentDto(policy, requirementsByCode.get(policy.code)))
    };
}
