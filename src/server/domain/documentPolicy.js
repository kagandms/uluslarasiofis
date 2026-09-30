const MEDIA_TYPES = Object.freeze(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const APPLICATION_TYPES = Object.freeze(['initial', 'renewal']);
const TYPE_SWITCH_CODE_MAP = Object.freeze({
    residence_application_form: 'residence_application_form',
    passport_identity: 'passport_identity',
    passport: 'passport',
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
    fingerprint: 'fingerprint',
    home_utility_bill: 'home_utility_bill',
    birth_certificate_under18: 'birth_certificate_under18'
});

const POLICIES = Object.freeze([
    { code: 'residence_application_form', order: 1, label: 'documentResidenceApplicationForm', help: 'documentResidenceApplicationFormHelp' },
    { code: 'passport', order: 2, label: 'documentPassport', help: 'documentPassportHelp' },
    { code: 'residence_card', order: 3, label: 'documentResidenceCard', help: 'documentResidenceCardHelp' },
    { code: 'photographs', order: 4, label: 'documentPhotographs', help: 'documentPhotographsHelp' },
    { code: 'health_insurance', order: 5, label: 'documentHealthInsurance', help: 'documentHealthInsuranceHelp' },
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
        address_evidence_type: 'undertaking', parent_code: 'address_undertaking', accepted_media_types: ['application/pdf']
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
    if (!policy.active || !policy.application_types.includes(applicationType)) return false;
    if (policy.conditional_rule === 'under18' && !isUnder18) return false;
    return !policy.address_evidence_type || policy.address_evidence_type === addressEvidenceType;
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

/**
 * Lists unique policy labels for the public landing page across application types, age groups, and address choices.
 * @returns {Array<object>} Public-safe policy labels with applicability and grouping metadata.
 */
export function listPublicDocumentOverview() {
    return POLICIES.map((policy) => {
        const scopeKey = policy.conditional_rule === 'under18' ? 'homeDocumentUnder18'
            : (policy.application_types.length === 1 ? 'homeDocumentRenewal' : 'homeDocumentAllApplications');
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
