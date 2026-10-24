// Immutable policy snapshot for applications submitted before migration 0025.
const MEDIA_TYPES = Object.freeze(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const APPLICATION_TYPES = Object.freeze(['initial', 'renewal']);
const POLICIES = Object.freeze([
    { code: 'residence_application_form', order: 1, label: 'documentResidenceApplicationForm', help: 'documentResidenceApplicationFormHelp' },
    { code: 'passport', order: 2, label: 'documentPassport', help: 'documentPassportHelp' },
    { code: 'residence_card', order: 3, label: 'documentResidenceCard', help: 'documentResidenceCardHelp' },
    { code: 'photographs', order: 4, label: 'documentPhotographs', help: 'documentPhotographsHelp' },
    { code: 'health_insurance', order: 5, label: 'documentHealthInsurance', help: 'documentHealthInsuranceHelp', conditional_rule: 'health_insurance_document' },
    { code: 'uets', order: 6, label: 'documentUets', help: 'documentUetsHelp', application_types: ['renewal'] },
    { code: 'student_certificate', order: 7, label: 'documentStudentCertificate', help: 'documentStudentCertificateHelp' },
    { code: 'residence_permit_fee', order: 8, label: 'documentResidencePermitFee', help: 'documentResidencePermitFeeHelp' },
    {
        code: 'address_rental_contract', order: 9, label: 'documentAddressRentalContract', help: 'documentAddressRentalContractHelp',
        address_evidence_type: 'rental_contract'
    },
    {
        code: 'address_residence_certificate', order: 10, label: 'documentAddressResidenceCertificate', help: 'documentAddressResidenceCertificateHelp',
        address_evidence_type: 'residence_certificate'
    },
    {
        code: 'address_undertaking', order: 11, label: 'documentAddressUndertaking', help: 'documentAddressUndertakingHelp',
        address_evidence_type: 'undertaking'
    },
    {
        code: 'host_residence_certificate', order: 12, label: 'documentHostResidenceCertificate', help: 'documentHostResidenceCertificateHelp',
        address_evidence_type: 'undertaking', parent_code: 'address_undertaking'
    },
    {
        code: 'host_identity_copy', order: 13, label: 'documentHostIdentityCopy', help: 'documentHostIdentityCopyHelp',
        address_evidence_type: 'undertaking', parent_code: 'address_undertaking'
    },
    { code: 'home_utility_bill', order: 14, label: 'documentHomeUtilityBill', help: 'documentHomeUtilityBillHelp' },
    {
        code: 'birth_certificate_under18', order: 15, label: 'documentBirthCertificateUnder18', help: 'documentBirthCertificateUnder18Help',
        conditional_rule: 'under18'
    }
].map((policy) => Object.freeze({
    code: policy.code,
    application_types: Object.freeze([...(policy.application_types || APPLICATION_TYPES)]),
    required: true,
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

function isPolicyApplicable(policy, applicationType, isUnder18, addressEvidenceType) {
    const context = addressEvidenceType && typeof addressEvidenceType === 'object'
        ? addressEvidenceType : { address_evidence_type: addressEvidenceType };
    if (!policy.active || !policy.application_types.includes(applicationType)) return false;
    if (policy.conditional_rule === 'under18' && !isUnder18) return false;
    if (policy.conditional_rule === 'health_insurance_document') return context.insurance_basis === 'bilateral_agreement';
    return !policy.address_evidence_type || policy.address_evidence_type === context.address_evidence_type;
}

function createStudentPolicyDto(policy) {
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
 * @param {string|null} addressEvidenceType Persisted address evidence choice.
 * @returns {object|null} Safe policy metadata source, or null when inapplicable.
 */
export function readDocumentPolicy(code, applicationType, isUnder18, addressEvidenceType = null) {
    const policy = POLICIES.find((entry) => entry.code === code);
    return policy && isPolicyApplicable(policy, applicationType, isUnder18, addressEvidenceType)
        ? createStudentPolicyDto(policy) : null;
}

/**
 * Lists safe document policies in product-defined order for the current application.
 * @param {string} applicationType Application type loaded from D1.
 * @param {boolean} isUnder18 Server-calculated age condition.
 * @param {string|null} addressEvidenceType Persisted address evidence choice.
 * @returns {Array<object>} Safe student policy metadata.
 */
export function listDocumentPolicies(applicationType, isUnder18, addressEvidenceType = null) {
    return POLICIES.filter((policy) => isPolicyApplicable(policy, applicationType, isUnder18, addressEvidenceType))
        .sort((left, right) => left.display_order - right.display_order)
        .map(createStudentPolicyDto);
}

