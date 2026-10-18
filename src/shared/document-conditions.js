/** Persisted answers that select the current residence document requirements. */
export const DOCUMENT_ANSWER_FIELDS = Object.freeze([
    'host_is_married', 'minor_family_status', 'minor_parents_identified', 'insurance_basis'
]);
export const ACCOMMODATION_TYPES = Object.freeze([
    'rental_contract', 'own_home', 'dormitory', 'hotel', 'undertaking'
]);
export const DOCUMENT_ANSWER_OPTIONS = Object.freeze({
    host_is_married: ['yes', 'no'],
    minor_parents_identified: ['yes', 'no'],
    minor_family_status: ['both_parents', 'divorced', 'deceased', 'single_parent', 'absent'],
    insurance_basis: ['system_verified', 'bilateral_agreement', 'gss_pending']
});

/** @param {object} application Persisted or public application. @returns {string|null} Current accommodation choice with legacy fallback. */
export function readAccommodationType(application) {
    return application.accommodation_type || application.address_evidence_type || null;
}

/** @param {object} application Application facts. @returns {string[]} Conditional questions requiring an explicit answer. */
export function listRequiredDocumentAnswers(application) {
    const fields = [];
    if (readAccommodationType(application) === 'undertaking') fields.push('host_is_married');
    if (application.is_under_18 === true || application.is_under_18 === 1) {
        fields.push('minor_family_status', 'minor_parents_identified');
    }
    fields.push('insurance_basis');
    return fields;
}

/** @param {object} application Application facts. @returns {string[]} Missing or invalid conditional answers. */
export function listMissingDocumentAnswers(application) {
    return listRequiredDocumentAnswers(application)
        .filter((field) => !DOCUMENT_ANSWER_OPTIONS[field].includes(application[field]));
}
