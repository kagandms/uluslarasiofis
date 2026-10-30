const ACCOMMODATION_SQL = 'COALESCE(applications.accommodation_type, applications.address_evidence_type)';
const CONDITIONS = Object.freeze({
    under18: "applications.is_under_18 = 1 AND (applications.document_policy_version = 1 OR applications.minor_parents_identified = 'no')",
    registered_address: `(applications.application_type = 'renewal' OR applications.application_route = 'transition' OR ${ACCOMMODATION_SQL} = 'residence_certificate')`,
    renewal: "applications.application_type = 'renewal'",
    uets: "(applications.application_type = 'renewal' OR applications.application_route = 'transition') AND applications.is_under_18 IS NOT 1",
    address_utility_bill: `(applications.application_type = 'renewal' OR applications.application_route = 'transition' OR ${ACCOMMODATION_SQL} = 'undertaking')`,
    host_spouse_undertaking: `${ACCOMMODATION_SQL} = 'undertaking' AND applications.host_is_married = 'yes'`,
    minor_consent: 'applications.is_under_18 = 1',
    minor_family_evidence: "applications.is_under_18 = 1 AND (applications.document_policy_version = 1 OR applications.minor_family_status IN ('divorced','deceased','single_parent','absent'))",
    parent_permit_copy: 'applications.is_under_18 = 1',
    minor_optional_parent_documents: 'applications.is_under_18 = 1',
    health_insurance_document: "applications.insurance_basis = 'bilateral_agreement'",
    'address_evidence:rental_contract': `${ACCOMMODATION_SQL} = 'rental_contract'`,
    'address_evidence:residence_certificate': `${ACCOMMODATION_SQL} = 'residence_certificate'`,
    'address_evidence:undertaking': `${ACCOMMODATION_SQL} = 'undertaking'`,
    'address_evidence:own_home': `${ACCOMMODATION_SQL} = 'own_home'`,
    'address_evidence:dormitory': `${ACCOMMODATION_SQL} = 'dormitory'`,
    'address_evidence:hotel': `${ACCOMMODATION_SQL} = 'hotel'`
});

/**
 * Builds a fixed SQL predicate to recheck document eligibility atomically at write time.
 * @param {string|null|undefined} conditionalRule Server-owned policy rule.
 * @returns {string} Fixed SQL clause without interpolated applicant input.
 * @throws {TypeError} When a policy has no corresponding persistence guard.
 */
export function readDocumentConditionSql(conditionalRule) {
    if (conditionalRule === null || conditionalRule === undefined) return '';
    const condition = Object.hasOwn(CONDITIONS, conditionalRule) ? CONDITIONS[conditionalRule] : null;
    if (!condition) throw new TypeError('Unsupported document policy condition.');
    return `AND (${condition})`;
}
