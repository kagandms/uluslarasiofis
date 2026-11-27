import { ApiError } from '../domain/errors.js';
import { listApplicationDocumentPolicies } from '../domain/documentPolicy.js';
import { requireApplicationSession } from '../auth/applicationAuth.js';
import { createD1Repositories } from '../repositories/d1/index.js';
import { readPublicMigrationMissingDocuments } from '../repositories/d1/migrationOfficeStateReader.js';
import { isValidApplicationReference, normalizeApplicationReference } from '../auth/applicationAccessCode.js';
import { enforceRateLimit, requireMethod, requireSameOrigin } from './shared.js';
import { readJsonBody } from '../http/requestBody.js';
import { APPLICATION_TRACKING_RATE_LIMIT } from '../security/application-rate-limits.js';

function isStudentVisibleFile(requirement) {
    return requirement?.upload_status === 'finalized'
        && ['pending', 'clean'].includes(requirement.scan_status);
}

export function readStudentDocumentStatus(requirement) {
    if (requirement?.review_status === 'resubmission_required'
        || requirement?.revision_status === 'resubmission_required') return 'resubmission_required';
    if (requirement?.review_status === 'approved' || requirement?.revision_status === 'approved') return 'approved';
    if (requirement?.review_status === 'under_review') return 'under_review';
    if (requirement?.upload_status === 'finalized'
        && ['unsafe', 'failed'].includes(requirement.scan_status)) return 'contact_office';
    if (isStudentVisibleFile(requirement)) return 'waiting_review';
    return 'not_uploaded';
}

function readStudentDocumentMessage(requirement) {
    if (readStudentDocumentStatus(requirement) !== 'resubmission_required'
        || typeof requirement?.student_message !== 'string') return undefined;
    return requirement.student_message;
}

function createTrackingDocumentDto(policy, requirement) {
    const studentMessage = readStudentDocumentMessage(requirement);
    return {
        code: policy.code,
        label_key: policy.label_key,
        required: policy.required,
        revision_number: requirement?.revision_number ?? null,
        status: readStudentDocumentStatus(requirement),
        filename: isStudentVisibleFile(requirement) ? requirement.original_filename ?? null : null,
        ...(studentMessage ? { student_message: studentMessage } : {})
    };
}

function createPublicTrackingDocumentDto(policy, requirement) {
    const studentMessage = readStudentDocumentMessage(requirement);
    return {
        code: policy.code,
        label_key: policy.label_key,
        required: policy.required,
        status: readStudentDocumentStatus(requirement),
        ...(studentMessage ? { student_message: studentMessage } : {})
    };
}

function createTrackingApplicationDto(application, rejectionReason = null, migrationMissing = null) {
    return {
        status: application.status,
        application_type: application.application_route === 'transition' ? 'transition' : application.application_type,
        created_at: application.created_at ?? null,
        updated_at: application.updated_at ?? null,
        submitted_at: application.submitted_at ?? null,
        ...(application.status === 'rejected' && typeof rejectionReason === 'string'
            ? { rejection_reason: rejectionReason } : {}),
        ...(application.status === 'sent_to_migration' && migrationMissing?.migration_missing_documents === true
            ? migrationMissing : {})
    };
}

function createDocumentTrackingView(application, storedRequirements, createDto) {
    const policies = listApplicationDocumentPolicies(application);
    const requirementsByCode = new Map(storedRequirements.map((requirement) => [requirement.code, requirement]));
    return policies.map((policy) => createDto(policy, requirementsByCode.get(policy.code)));
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

    const [storedRequirements, studentMessages, migrationMissing] = await Promise.all([
        repositories.documents.listStudentRequirements(application.id),
        repositories.applicationNotes.listLatestStudentDocumentMessages(application.id),
        readPublicMigrationMissingDocuments(environment.DB, {
            recordKind: 'online',
            recordId: application.id,
            status: application.status
        })
    ]);
    const requirementsWithMessages = storedRequirements.map((requirement) => ({
        ...requirement, student_message: studentMessages.get(requirement.document_record_id)
    }));

    return {
        application: { ...createTrackingApplicationDto(application, null, migrationMissing),
            student_number: application.student_number,
            reference_number: application.reference_number ?? null },
        documents: createDocumentTrackingView(application, requirementsWithMessages, createTrackingDocumentDto)
    };
}

/**
 * Reads a privacy-minimized public tracking view for one application reference number.
 * @param {object} repositories D1 repository collection.
 * @param {string} referenceNumber Candidate application reference number.
 * @returns {Promise<{found: boolean, application: object|null, documents: object[]}>} Public-safe tracking result.
 */
export async function readPublicTrackingByReference(repositories, referenceNumber, database = null) {
    const normalizedReference = normalizeApplicationReference(referenceNumber);
    if (!isValidApplicationReference(normalizedReference)) {
        return { found: false, application: null, documents: [] };
    }
    const application = await repositories.applications.findTrackableByReferenceNumber(normalizedReference);
    if (!application) return { found: false, application: null, documents: [] };

    const [storedRequirements, studentMessages, rejectionReason, migrationMissing] = await Promise.all([
        repositories.documents.listStudentRequirements(application.id),
        repositories.applicationNotes.listLatestStudentDocumentMessages(application.id),
        application.status === 'rejected'
            ? repositories.applicationNotes.readLatestStudentApplicationRejection(application.id)
            : null,
        readPublicMigrationMissingDocuments(database, {
            recordKind: 'online',
            recordId: application.id,
            status: application.status
        })
    ]);
    const requirementsWithMessages = storedRequirements.map((requirement) => ({
        ...requirement, student_message: studentMessages.get(requirement.document_record_id)
    }));
    return {
        found: true,
        application: createTrackingApplicationDto(application, rejectionReason, migrationMissing),
        documents: createDocumentTrackingView(application, requirementsWithMessages, createPublicTrackingDocumentDto)
    };
}

/**
 * Reads a privacy-minimized public tracking view by unguessable application reference.
 * @param {Request} request Same-origin JSON POST request.
 * @param {object} environment Worker bindings containing D1.
 * @returns {Promise<object>} Public-safe tracking result, or an indistinguishable not-found result.
 * @throws {ApiError} When method, origin, body, or rate policy is invalid.
 */
export async function lookupApplicationTracking(request, environment) {
    requireMethod(request, 'POST');
    requireSameOrigin(request);
    const body = await readJsonBody(request);
    if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'reference_number')) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru kodunu kontrol edip tekrar deneyin.');
    }

    const referenceNumber = normalizeApplicationReference(body.reference_number);
    if (!isValidApplicationReference(referenceNumber)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Başvuru kodunu kontrol edip tekrar deneyin.');
    }

    const repositories = createD1Repositories(environment.DB);
    await enforceRateLimit(repositories, request, APPLICATION_TRACKING_RATE_LIMIT);
    return readPublicTrackingByReference(repositories, referenceNumber, environment.DB);
}
