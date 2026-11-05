import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { listDocumentPolicies, listPublicDocumentOverview, readDocumentPolicy, mapDocumentRequirementCodeForTypeSwitch } from '../src/server/domain/documentPolicy.js';
import { listDocumentPolicies as listPreviousPolicies, readDocumentPolicy as readPreviousPolicy } from '../src/server/domain/document-policy-v2.js';
import { listDocumentPolicies as listLegacyPolicies, readDocumentPolicy as readLegacyPolicy } from '../src/server/domain/document-policy-v1.js';
import { readDocumentConditionSql } from '../src/server/repositories/d1/document-condition-sql.js';

const COMMON = ['residence_application_form', 'passport', 'student_certificate', 'health_insurance', 'residence_permit_fee'];
const BRANCHES = {
    rental_contract: ['address_rental_contract'],
    own_home: ['address_title_deed', 'address_numbering', 'address_dask'],
    dormitory: ['address_dormitory', 'dormitory_tax_certificate', 'dormitory_signature_circular'],
    hotel: ['address_hotel'],
    undertaking: ['address_undertaking', 'host_residence_certificate', 'home_utility_bill'],
    residence_certificate: ['address_residence_certificate']
};

function scenarios() {
    const values = [];
    for (const type of ['initial', 'renewal', 'transition']) {
        for (const accommodation of Object.keys(BRANCHES)) {
            for (const isUnder18 of [false, true]) {
                for (const hostMarried of ['yes', 'no']) {
                    for (const hostTurkish of ['yes', 'no']) {
                        for (const fingerprint of [null, '', 'FP-123']) {
                            values.push({ type, isUnder18, context: {
                                final_document_policy: 1, document_policy_version: 2,
                                application_type: type === 'transition' ? 'renewal' : type,
                                application_route: type === 'transition' ? 'transition' : 'standard',
                                address_evidence_type: accommodation,
                                accommodation_type: accommodation === 'residence_certificate' ? null : accommodation,
                                is_under_18: Number(isUnder18), host_is_married: hostMarried,
                                host_is_turkish: hostTurkish,
                                fingerprint_status: fingerprint === null ? 'not_registered' : 'registered',
                                fingerprint_code: fingerprint, insurance_basis: 'gss_pending'
                            } });
                        }
                    }
                }
            }
        }
    }
    return values;
}

test('final document list covers every type, accommodation, age, host and fingerprint combination', () => {
    for (const { type, isUnder18, context } of scenarios()) {
        const policies = listDocumentPolicies(type, isUnder18, context);
        const expected = [...COMMON, ...BRANCHES[context.address_evidence_type]];
        if (type === 'renewal' || (type === 'transition' && context.fingerprint_code)) expected.push('uets');
        if (isUnder18) expected.push('minor_consent');
        if (context.address_evidence_type === 'undertaking') {
            if (context.host_is_married === 'yes') expected.push('host_spouse_undertaking');
            if (context.host_is_turkish === 'yes') expected.push('host_population_record');
        }
        assert.deepEqual(policies.map(({ code }) => code).sort(), expected.sort(), JSON.stringify(context));
        for (const policy of policies) {
            assert.equal(policy.required, policy.code !== 'address_dask');
            assert.equal(mapDocumentRequirementCodeForTypeSwitch(policy.code), policy.code);
            assert.deepEqual(readDocumentPolicy(policy.code, type, isUnder18, context), policy);
        }
    }
});

test('final upload SQL guards agree with policy applicability, including negative branches', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`CREATE TABLE applications (
        application_type TEXT, application_route TEXT, accommodation_type TEXT, address_evidence_type TEXT,
        is_under_18 INTEGER, host_is_married TEXT, host_is_turkish TEXT,
        fingerprint_status TEXT, fingerprint_code TEXT
    )`);
    const allScenarios = scenarios();
    const policies = new Map();
    for (const { type, isUnder18, context } of allScenarios) {
        for (const policy of listDocumentPolicies(type, isUnder18, context)) policies.set(policy.code, policy);
    }
    try {
        for (const { type, isUnder18, context } of allScenarios) {
            database.exec('DELETE FROM applications');
            database.prepare('INSERT INTO applications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
                context.application_type, context.application_route, context.accommodation_type,
                context.address_evidence_type, context.is_under_18, context.host_is_married,
                context.host_is_turkish, context.fingerprint_status, context.fingerprint_code
            );
            for (const policy of policies.values()) {
                const matches = Boolean(database.prepare(`SELECT 1 FROM applications WHERE 1=1 ${readDocumentConditionSql(policy.conditional_rule)}`).get());
                assert.equal(matches, Boolean(readDocumentPolicy(policy.code, type, isUnder18, context)), `${policy.code}: ${JSON.stringify(context)}`);
            }
        }
    } finally {
        database.close();
    }
});

test('submitted v1 and v2 snapshots retain their previous requirements', () => {
    for (const type of ['initial', 'renewal', 'transition']) {
        for (const isUnder18 of [false, true]) {
            const context = { final_document_policy: 0, document_policy_version: 2,
                address_evidence_type: 'undertaking', host_is_married: 'yes',
                insurance_basis: 'bilateral_agreement', minor_parents_identified: 'no' };
            assert.deepEqual(listDocumentPolicies(type, isUnder18, context), listPreviousPolicies(type, isUnder18, context));
            context.document_policy_version = 1;
            assert.deepEqual(listDocumentPolicies(type, isUnder18, context), listLegacyPolicies(type, isUnder18, context));
        }
    }
});

test('v1 and v2 health-insurance SQL guards match each snapshot across application types', () => {
    const database = new DatabaseSync(':memory:');
    database.exec('CREATE TABLE applications (application_type TEXT, document_policy_version INTEGER, insurance_basis TEXT)');
    const insuranceBases = ['bilateral_agreement', 'system_verified', 'gss_pending', null];
    const versions = [
        { version: 1, readPolicy: readLegacyPolicy, allows: (type, basis) => ['initial', 'renewal'].includes(type) && basis === 'bilateral_agreement' },
        { version: 2, readPolicy: readPreviousPolicy, allows: (type, basis) => basis === 'bilateral_agreement' || (['renewal', 'transition'].includes(type) && basis === 'system_verified') }
    ];
    try {
        for (const { version, readPolicy, allows } of versions) {
            for (const applicationType of ['initial', 'renewal', 'transition']) {
                for (const insurance_basis of insuranceBases) {
                    database.exec('DELETE FROM applications');
                    database.prepare('INSERT INTO applications VALUES (?, ?, ?)').run(applicationType, version, insurance_basis);
                    const sqlAllows = Boolean(database.prepare(`SELECT 1 FROM applications WHERE 1=1 ${readDocumentConditionSql('health_insurance_document')}`).get());
                    const context = { document_policy_version: version, final_document_policy: 0, insurance_basis };
                    const policy = readPolicy('health_insurance', applicationType, false, context);
                    const expected = allows(applicationType, insurance_basis);
                    assert.equal(Boolean(policy), expected, `v${version} domain: ${applicationType}/${insurance_basis}`);
                    assert.equal(sqlAllows, expected, `v${version} SQL: ${applicationType}/${insurance_basis}`);
                }
            }
        }
    } finally {
        database.close();
    }
});

test('common insurance document never depends on insurance basis and DASK appears only for own home', () => {
    for (const insurance_basis of ['system_verified', 'bilateral_agreement', 'gss_pending', null]) {
        for (const applicationType of ['initial', 'renewal', 'transition']) {
            assert.equal(readDocumentPolicy('health_insurance', applicationType, false, {
                final_document_policy: 1, document_policy_version: 3, insurance_basis
            }).required, true);
        }
    }
    assert.equal(readDocumentPolicy('address_dask', 'initial', false, 'own_home').required, false);
    assert.equal(readDocumentPolicy('address_dask', 'initial', false, 'rental_contract'), null);
    const overview = listPublicDocumentOverview();
    assert.equal(overview.find(({ code }) => code === 'address_residence_certificate').group_key, 'address_evidence');
    assert.equal(overview.find(({ code }) => code === 'uets').scope_key, 'homeDocumentConditional');
    for (const code of ['visa', 'photographs', 'birth_certificate_under18', 'parent_permit_copy', 'minor_family_evidence', 'address_hotel_receipt']) {
        assert.equal(overview.some((policy) => policy.code === code), false, code);
    }
});
