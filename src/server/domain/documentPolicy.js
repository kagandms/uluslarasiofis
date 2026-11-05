import { readAccommodationType } from '../../shared/document-conditions.js';
import { listDocumentPolicies as listLegacyPolicies, readDocumentPolicy as readLegacyPolicy } from './document-policy-v1.js';
import { listDocumentPolicies as listPreviousPolicies, readDocumentPolicy as readPreviousPolicy } from './document-policy-v2.js';
const MEDIA_TYPES = Object.freeze(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const APPLICATION_TYPES = Object.freeze(['initial', 'renewal', 'transition']);
const TYPE_SWITCH_CODE_MAP = Object.freeze({
    residence_application_form: 'residence_application_form',
    passport_identity: 'passport_identity',
    passport: 'passport',
    visa: 'visa',
    residence_card: 'residence_card',
    photographs: 'photographs',
    health_insurance: 'health_insurance',
    uets: 'uets',
    student_certificate: 'student_certificate',
    residence_permit_fee: 'residence_permit_fee',
    address_document: 'address_document',
    address_rental_contract: 'address_rental_contract',
    address_residence_certificate: 'address_residence_certificate',
    address_undertaking: 'address_undertaking',
    host_residence_certificate: 'host_residence_certificate',
    host_identity_copy: 'host_identity_copy',
    address_title_deed: 'address_title_deed',
    address_numbering: 'address_numbering',
    address_dormitory: 'address_dormitory',
    address_hotel: 'address_hotel',
    address_hotel_receipt: 'address_hotel_receipt',
    host_spouse_undertaking: 'host_spouse_undertaking',
    minor_consent: 'minor_consent',
    minor_family_evidence: 'minor_family_evidence',
    parent_permit_copy: 'parent_permit_copy',
    address_dask: 'address_dask',
    dormitory_tax_certificate: 'dormitory_tax_certificate',
    dormitory_signature_circular: 'dormitory_signature_circular',
    host_population_record: 'host_population_record',
    fingerprint: 'fingerprint',
    home_utility_bill: 'home_utility_bill',
    birth_certificate_under18: 'birth_certificate_under18'
});

const POLICIES = Object.freeze([
    { code: 'residence_application_form', order: 1, label: 'documentResidenceApplicationForm', help: 'documentResidenceApplicationFormHelp' },
    { code: 'passport', order: 2, label: 'documentPassport', help: 'documentPassportHelp' },
    { code: 'student_certificate', order: 5, label: 'documentStudentCertificate', help: 'documentStudentCertificateHelp' },
    { code: 'health_insurance', order: 6, label: 'documentHealthInsurance', help: 'documentHealthInsuranceHelp' },
    { code: 'residence_permit_fee', order: 23, label: 'documentResidencePermitFee', help: 'documentResidencePermitFeeHelp' },
    { code: 'uets', order: 22, label: 'documentUets', help: 'documentUetsHelp', application_types: ['renewal', 'transition'], conditional_rule: 'final_uets' },
    { code: 'address_rental_contract', order: 7, label: 'documentAddressRentalContract', help: 'documentAddressRentalContractHelp', address_evidence_type: 'rental_contract' },
    { code: 'address_residence_certificate', order: 8, label: 'documentAddressResidenceCertificate', help: 'documentAddressResidenceCertificateHelp', address_evidence_type: 'residence_certificate' },
    { code: 'address_undertaking', order: 9, label: 'documentAddressUndertaking', help: 'documentAddressUndertakingHelp', address_evidence_type: 'undertaking' },
    { code: 'host_residence_certificate', order: 10, label: 'documentHostResidenceCertificate', help: 'documentHostResidenceCertificateHelp', address_evidence_type: 'undertaking', parent_code: 'address_undertaking' },
    { code: 'home_utility_bill', order: 11, label: 'documentHomeUtilityBill', help: 'documentHomeUtilityBillHelp', address_evidence_type: 'undertaking', parent_code: 'address_undertaking' },
    { code: 'host_population_record', order: 12, label: 'documentHostPopulationRecord', help: 'documentHostPopulationRecordHelp', address_evidence_type: 'undertaking', parent_code: 'address_undertaking', conditional_rule: 'host_population_record' },
    { code: 'address_title_deed', order: 13, label: 'documentAddressTitleDeed', help: 'documentAddressTitleDeedHelp', address_evidence_type: 'own_home' },
    { code: 'address_numbering', order: 14, label: 'documentAddressNumbering', help: 'documentAddressNumberingHelp', address_evidence_type: 'own_home', parent_code: 'address_title_deed' },
    { code: 'address_dask', required: false, order: 15, label: 'documentAddressDask', help: 'documentAddressDaskHelp', address_evidence_type: 'own_home', parent_code: 'address_title_deed' },
    { code: 'address_dormitory', order: 16, label: 'documentAddressDormitory', help: 'documentAddressDormitoryHelp', address_evidence_type: 'dormitory' },
    { code: 'dormitory_tax_certificate', order: 17, label: 'documentDormitoryTaxCertificate', help: 'documentDormitoryTaxCertificateHelp', address_evidence_type: 'dormitory', parent_code: 'address_dormitory' },
    { code: 'dormitory_signature_circular', order: 18, label: 'documentDormitorySignatureCircular', help: 'documentDormitorySignatureCircularHelp', address_evidence_type: 'dormitory', parent_code: 'address_dormitory' },
    { code: 'address_hotel', order: 19, label: 'documentAddressHotel', help: 'documentAddressHotelHelp', address_evidence_type: 'hotel' },
    { code: 'host_spouse_undertaking', order: 20, label: 'documentHostSpouseUndertaking', help: 'documentHostSpouseUndertakingHelp', address_evidence_type: 'undertaking', parent_code: 'address_undertaking', conditional_rule: 'host_spouse_undertaking' },
    { code: 'minor_consent', order: 21, label: 'documentMinorConsent', help: 'documentMinorConsentHelp', conditional_rule: 'minor_consent' }
].map((policy) => Object.freeze({
    code: policy.code,
    application_types: Object.freeze([...(policy.application_types || APPLICATION_TYPES)]),
    required: policy.required !== false,
    display_order: policy.order,
    label_key: policy.label,
    description_key: policy.help,
    accepted_media_types: Object.freeze([...(policy.accepted_media_types || MEDIA_TYPES)]),
    max_byte_size: MAX_DOCUMENT_BYTES,
    active: true,
    conditional_rule: policy.conditional_rule
        || (policy.address_evidence_type ? `address_evidence:${policy.address_evidence_type}` : null),
    address_evidence_type: policy.address_evidence_type || null,
    parent_code: policy.parent_code || null
})));

function readPolicyContext(addressContext) {
    return addressContext && typeof addressContext === 'object' ? addressContext
        : { address_evidence_type: addressContext };
}

function isPolicyApplicable(policy, applicationType, isUnder18, addressContext) {
    const context = readPolicyContext(addressContext);
    const accommodation = readAccommodationType(context);
    if (!policy.active || !policy.application_types.includes(applicationType)) return false;
    if (policy.address_evidence_type && policy.address_evidence_type !== accommodation) return false;
    switch (policy.conditional_rule) {
    case 'final_uets': return applicationType === 'renewal'
        || (applicationType === 'transition' && context.fingerprint_status === 'registered'
            && typeof context.fingerprint_code === 'string' && context.fingerprint_code.trim().length > 0);
    case 'host_population_record': return accommodation === 'undertaking' && context.host_is_turkish === 'yes';
    case 'host_spouse_undertaking': return accommodation === 'undertaking' && context.host_is_married === 'yes';
    case 'minor_consent': return isUnder18;
    default: return true;
    }
}

function createStudentPolicyDto(policy, addressContext) {
    const context = readPolicyContext(addressContext);
    return {
        code: policy.code,
        required: policy.required,
        display_order: policy.display_order,
        label_key: policy.label_key,
        description_key: policy.description_key,
        accepted_media_types: [...policy.accepted_media_types],
        max_byte_size: policy.max_byte_size,
        conditional_rule: policy.conditional_rule
    };
}

/**
 * Returns the server-owned policy for one code when it applies to the current application.
 * @param {string} code Stable public document code.
 * @param {string} applicationType Application type loaded from the owner's D1 record.
 * @param {boolean} isUnder18 Server-calculated age condition.
 * @param {object|string|null} addressEvidenceType Persisted application facts, or legacy address choice.
 * @returns {object|null} Safe policy metadata source, or null when inapplicable.
 */
export function readDocumentPolicy(code, applicationType, isUnder18, addressEvidenceType = null) {
    if (addressEvidenceType?.document_policy_version === 1) {
        return readLegacyPolicy(code, applicationType, isUnder18, addressEvidenceType);
    }
    if (addressEvidenceType?.final_document_policy === 0) {
        return readPreviousPolicy(code, applicationType, isUnder18, addressEvidenceType);
    }
    const policy = POLICIES.find((entry) => entry.code === code);
    return policy && isPolicyApplicable(policy, applicationType, isUnder18, addressEvidenceType)
        ? createStudentPolicyDto(policy, addressEvidenceType) : null;
}

/**
 * Resolves the document-policy type for a persisted application, including transfer routes.
 * @param {object} application Persisted application and route.
 * @returns {string} Current public document-policy application type.
 */
export function readDocumentPolicyApplicationType(application) {
    return application.application_route === 'transition' ? 'transition' : application.application_type;
}

/**
 * Lists applicable document policies from a persisted application.
 * @param {object} application Persisted application and applicant conditions.
 * @returns {Array<object>} Current public document policies.
 */
export function listApplicationDocumentPolicies(application) {
    return listDocumentPolicies(
        readDocumentPolicyApplicationType(application),
        application.is_under_18 === 1,
        application
    );
}

/**
 * Reads one applicable document policy from a persisted application.
 * @param {string} code Stable public document code.
 * @param {object} application Persisted application and applicant conditions.
 * @returns {object|null} Current policy metadata or null.
 */
export function readApplicationDocumentPolicy(code, application) {
    return readDocumentPolicy(
        code,
        readDocumentPolicyApplicationType(application),
        application.is_under_18 === 1,
        application
    );
}

/**
 * Lists safe document policies in product-defined order for the current application.
 * @param {string} applicationType Application type loaded from D1.
 * @param {boolean} isUnder18 Server-calculated age condition.
 * @param {object|string|null} addressEvidenceType Persisted application facts, or legacy address choice.
 * @returns {Array<object>} Safe student policy metadata.
 */
export function listDocumentPolicies(applicationType, isUnder18, addressEvidenceType = null) {
    if (addressEvidenceType?.document_policy_version === 1) {
        return listLegacyPolicies(applicationType, isUnder18, addressEvidenceType);
    }
    if (addressEvidenceType?.final_document_policy === 0) {
        return listPreviousPolicies(applicationType, isUnder18, addressEvidenceType);
    }
    return POLICIES.filter((policy) => isPolicyApplicable(policy, applicationType, isUnder18, addressEvidenceType))
        .sort((left, right) => left.display_order - right.display_order)
        .map((policy) => createStudentPolicyDto(policy, addressEvidenceType));
}

/**
 * Lists unique policy labels for the public landing page across application types, age groups, and address choices.
 * @returns {Array<object>} Public-safe policy labels with applicability and grouping metadata.
 */
export function listPublicDocumentOverview() {
    return POLICIES.map((policy) => {
        let scopeKey = 'homeDocumentAllApplications';
        if (policy.code === 'uets') scopeKey = 'homeDocumentConditional';
        else if (['under18', 'minor_consent', 'minor_family_evidence'].includes(policy.conditional_rule)) scopeKey = 'homeDocumentUnder18';
        else if (policy.conditional_rule) scopeKey = 'homeDocumentConditional';
        return Object.freeze({
            code: policy.code,
            label_key: policy.label_key,
            description_key: policy.description_key,
            scope_key: scopeKey,
            group_key: policy.address_evidence_type ? 'address_evidence' : null,
            address_evidence_type: policy.address_evidence_type,
            parent_code: policy.parent_code || null,
            required: policy.required,
            display_order: policy.display_order
        });
    }).sort((left, right) => left.display_order - right.display_order);
}

/**
 * Resolves a known stable document code to its same-code target for draft type switching.
 * @param {string} code Existing requirement code on a draft document record.
 * @returns {string|null} Explicit target code, or null for an unknown historical code.
 */
export function mapDocumentRequirementCodeForTypeSwitch(code) {
    return typeof code === 'string' && Object.hasOwn(TYPE_SWITCH_CODE_MAP, code)
        ? TYPE_SWITCH_CODE_MAP[code] : null;
}
