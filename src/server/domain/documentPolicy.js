const MEDIA_TYPES = Object.freeze(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const APPLICATION_TYPES = Object.freeze(['initial', 'renewal']);

const BASE_POLICIES = Object.freeze([
    ['residence_application_form', 1, 'documentResidenceApplicationForm', 'documentResidenceApplicationFormHelp'],
    ['passport_identity', 2, 'documentPassportIdentity', 'documentPassportIdentityHelp'],
    ['photographs', 3, 'documentPhotographs', 'documentPhotographsHelp'],
    ['health_insurance', 4, 'documentHealthInsurance', 'documentHealthInsuranceHelp'],
    ['uets', 5, 'documentUets', 'documentUetsHelp', ['renewal']],
    ['student_certificate', 6, 'documentStudentCertificate', 'documentStudentCertificateHelp'],
    ['residence_permit_fee', 7, 'documentResidencePermitFee', 'documentResidencePermitFeeHelp'],
    ['address_document', 8, 'documentAddressDocument', 'documentAddressDocumentHelp'],
    ['fingerprint', 9, 'documentFingerprint', 'documentFingerprintHelp'],
    ['home_utility_bill', 10, 'documentHomeUtilityBill', 'documentHomeUtilityBillHelp']
]);

const POLICIES = Object.freeze([
    ...BASE_POLICIES.map(([code, displayOrder, labelKey, descriptionKey, applicationTypes = APPLICATION_TYPES]) => Object.freeze({
        code,
        application_types: Object.freeze([...applicationTypes]),
        required: true,
        display_order: displayOrder,
        label_key: labelKey,
        description_key: descriptionKey,
        accepted_media_types: MEDIA_TYPES,
        max_byte_size: MAX_DOCUMENT_BYTES,
        active: true,
        conditional_rule: code === 'fingerprint' ? 'fingerprint_product_requirement' : null
    })),
    Object.freeze({
        code: 'birth_certificate_under18',
        application_types: APPLICATION_TYPES,
        required: true,
        display_order: 11,
        label_key: 'documentBirthCertificateUnder18',
        description_key: 'documentBirthCertificateUnder18Help',
        accepted_media_types: MEDIA_TYPES,
        max_byte_size: MAX_DOCUMENT_BYTES,
        active: true,
        conditional_rule: 'under18'
    })
]);

function isPolicyApplicable(policy, applicationType, isUnder18) {
    if (!policy.active || !policy.application_types.includes(applicationType)) return false;
    return policy.conditional_rule !== 'under18' || isUnder18;
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
 * @returns {object|null} Safe policy metadata source, or null when inapplicable.
 */
export function readDocumentPolicy(code, applicationType, isUnder18) {
    const policy = POLICIES.find((entry) => entry.code === code);
    return policy && isPolicyApplicable(policy, applicationType, isUnder18) ? createStudentPolicyDto(policy) : null;
}

/**
 * Lists safe document policies in product-defined order for the current application.
 * @param {string} applicationType Application type loaded from D1.
 * @param {boolean} isUnder18 Server-calculated age condition.
 * @returns {Array<object>} Safe student policy metadata.
 */
export function listDocumentPolicies(applicationType, isUnder18) {
    return POLICIES.filter((policy) => isPolicyApplicable(policy, applicationType, isUnder18))
        .sort((left, right) => left.display_order - right.display_order)
        .map(createStudentPolicyDto);
}
