import { isValidPhoneNumber } from '../../shared/phoneNumber.js';
import { listDocumentPolicies } from '../domain/documentPolicy.js';
import { createD1Repositories } from '../repositories/d1/index.js';

const APPLICATION_TYPES = new Set(['initial', 'renewal']);
const ADDRESS_EVIDENCE_TYPES = new Set(['rental_contract', 'residence_certificate', 'undertaking']);
const ACCEPTED_REVISION_STATUSES = new Set(['submitted', 'approved']);
const ACCEPTED_SCAN_STATUSES = new Set(['pending', 'clean']);
const REQUIRED_FIELDS = Object.freeze([
    'student_number', 'application_type', 'student_email', 'student_phone', 'first_name',
    'last_name', 'passport_number', 'nationality', 'date_of_birth', 'is_under_18',
    'address_evidence_type'
]);

function isPresentText(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function isValidDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
        && parsed.valueOf() <= Date.now();
}

function isTrue(value) {
    return value === true || value === 1;
}

function isValidCoreField(field, application) {
    const value = application[field];
    if (field === 'application_type') return APPLICATION_TYPES.has(value);
    if (field === 'student_email') return isPresentText(value) && value.trim().length <= 254
        && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
    if (field === 'student_phone') return isValidPhoneNumber(value) && value.trim().length <= 40;
    if (field === 'date_of_birth') return isValidDate(value);
    if (field === 'is_under_18') return value === 0 || value === 1 || typeof value === 'boolean';
    if (field === 'address_evidence_type') return ADDRESS_EVIDENCE_TYPES.has(value);
    return isPresentText(value) && value.trim().length <= 255;
}

function isCurrentFinalizedDocument(document) {
    return (document.has_current_revision === true || document.has_current_revision === 1)
        && ACCEPTED_REVISION_STATUSES.has(document.revision_status)
        && document.upload_status === 'finalized'
        && ACCEPTED_SCAN_STATUSES.has(document.scan_status)
        && (document.cleanup_status === null || document.cleanup_status === 'none')
        && document.upload_intent_status === 'completed';
}

function uniqueSorted(values) {
    return [...new Set(values)].sort();
}

function readMissingFields(application, declarationVersion) {
    const missingFields = REQUIRED_FIELDS.filter((field) => !isValidCoreField(field, application));
    if (!isPresentText(application.student_number) || application.student_number.length > 64) missingFields.push('student_number');
    if (application.fingerprint_status !== 'registered' || !isPresentText(application.fingerprint_code)
        || application.fingerprint_code.trim().length > 128 || /[\u0000-\u001f\u007f]/u.test(application.fingerprint_code)) {
        missingFields.push('fingerprint_status');
    }
    if (!isTrue(application.contact_acknowledgement_accepted_current)) missingFields.push('contact_acknowledgement');
    if (!application.declaration_accepted_at || application.declaration_version !== declarationVersion) {
        missingFields.push('declaration');
    }
    return uniqueSorted(missingFields);
}

function readMissingDocuments(policies, documents) {
    const documentByCode = new Map(documents.map((document) => [document.code, document]));
    return uniqueSorted(policies.filter((policy) => policy.required).filter((policy) => {
        const document = documentByCode.get(policy.code);
        return !document || !isTrue(document.has_active_requirement)
            || !isTrue(document.is_required) || !isCurrentFinalizedDocument(document);
    }).map((policy) => policy.code));
}

function readReasonCodes(application, missingFields, missingDocuments, declarationVersion) {
    const reasonCodes = [];
    if (!application.id) reasonCodes.push('APPLICATION_NOT_FOUND');
    if (application.status !== 'draft') reasonCodes.push('APPLICATION_NOT_DRAFT');
    if (!isTrue(application.contact_acknowledgement_accepted_current)) reasonCodes.push('CONTACT_ACKNOWLEDGEMENT_REQUIRED');
    if (!application.declaration_accepted_at || application.declaration_version !== declarationVersion) {
        reasonCodes.push('DECLARATION_REQUIRED');
    }
    if (missingFields.some((field) => !['contact_acknowledgement', 'declaration'].includes(field))) {
        reasonCodes.push('APPLICATION_FIELDS_INCOMPLETE');
    }
    if (missingDocuments.length > 0) reasonCodes.push('REQUIRED_DOCUMENTS_INCOMPLETE');
    return uniqueSorted(reasonCodes);
}

/**
 * Evaluates the persisted application snapshot against the current server-owned document policy.
 * @param {object} application Persisted application and current acknowledgement state.
 * @param {Array<object>} policies Applicable document policies from `documentPolicy.js`.
 * @param {Array<object>} documents D1 states for active requirement codes.
 * @param {{declarationVersion: string}} versions Current configured declaration version; contact acknowledgement is resolved by the D1 audit repository.
 * @returns {{status: 'ready'|'not_ready', reason_codes: string[], missing_fields: string[], missing_documents: string[]}} Stable readiness result without internal identifiers.
 */
export function evaluateSubmissionReadiness(application, policies, documents, versions) {
    const persistedApplication = application || {};
    const missingFields = readMissingFields(persistedApplication, versions.declarationVersion);
    const missingDocuments = readMissingDocuments(policies, documents);
    const stableReasons = readReasonCodes(persistedApplication, missingFields, missingDocuments, versions.declarationVersion);
    return Object.freeze({
        status: stableReasons.length === 0 ? 'ready' : 'not_ready',
        reason_codes: stableReasons,
        missing_fields: missingFields,
        missing_documents: missingDocuments
    });
}

/**
 * Loads current D1 application and document state before evaluating submission readiness.
 * @param {string} applicationId Application selected only from the authenticated session.
 * @param {object} environment Worker bindings containing D1.
 * @param {string} declarationVersion Validated configured declaration version.
 * @returns {Promise<object>} Deterministic readiness result.
 */
export async function readSubmissionReadiness(applicationId, environment, declarationVersion) {
    const repositories = createD1Repositories(environment.DB);
    const application = await repositories.applications.findById(applicationId);
    if (!application) {
        return Object.freeze({
            status: 'not_ready', reason_codes: ['APPLICATION_NOT_FOUND'],
            missing_fields: [], missing_documents: []
        });
    }
    const policies = listDocumentPolicies(
        application.application_type,
        application.is_under_18 === 1,
        application.address_evidence_type ?? null
    );
    const documents = await repositories.documents.listSubmissionRequirementStates(applicationId);
    return evaluateSubmissionReadiness(application, policies, documents, {
        declarationVersion
    });
}
