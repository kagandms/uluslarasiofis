import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as documentPolicy from '../src/server/domain/documentPolicy.js';
import { listApplicationDocumentPolicies, listDocumentPolicies, listPublicDocumentOverview, readDocumentPolicy } from '../src/server/domain/documentPolicy.js';

test('document policies expose common required documents with biometric photographs but without separate visa, card or fingerprint uploads', () => {
    const policies = listDocumentPolicies('initial', false, { has_residence_card: 'yes', insurance_basis: 'bilateral_agreement' });
    const codes = policies.map(({ code }) => code);

    assert.ok(codes.includes('passport'));
    assert.equal(codes.includes('visa'), false);
    assert.equal(codes.includes('photographs'), true);
    assert.ok(!codes.includes('residence_card'));
    assert.ok(!codes.includes('passport_identity'));
    assert.ok(!codes.includes('fingerprint'));
    assert.ok(codes.includes('health_insurance'));
    assert.equal(listDocumentPolicies('initial', false, { insurance_basis: 'system_verified' })
        .find(({ code }) => code === 'health_insurance')?.required, true);
    assert.equal(readDocumentPolicy('passport', 'initial', false).label_key, 'documentPassport');
    assert.equal(readDocumentPolicy('photographs', 'initial', false).label_key, 'documentPhotographs');
    assert.equal(readDocumentPolicy('residence_card', 'renewal', false), null);
});

test('address policy exposes exactly the selected evidence branch', () => {
    const unselected = listDocumentPolicies('initial', false);
    const rental = listDocumentPolicies('initial', false, 'rental_contract');
    const residence = listDocumentPolicies('initial', false, 'residence_certificate');
    const undertaking = listDocumentPolicies('initial', false, 'undertaking');

    assert.equal(unselected.some(({ code }) => code.startsWith('address_') || code.startsWith('host_')), false);
    assert.deepEqual(rental.filter(({ conditional_rule }) => conditional_rule?.startsWith('address_')).map(({ code }) => code), [
        'address_rental_contract'
    ]);
    assert.deepEqual(residence.filter(({ code }) => code === 'address_residence_certificate').map(({ code }) => code), [
        'address_residence_certificate'
    ]);
    assert.deepEqual(undertaking.filter(({ conditional_rule }) => conditional_rule?.startsWith('address_')).map(({ code }) => code), [
        'address_undertaking', 'host_residence_certificate', 'home_utility_bill'
    ]);
    assert.equal(undertaking.some(({ code }) => code === 'host_residence_certificate'), true);
    assert.equal(undertaking.some(({ code }) => code === 'home_utility_bill'), true);
    assert.equal(rental.some(({ code }) => code === 'home_utility_bill'), false);
    assert.equal(readDocumentPolicy('host_residence_certificate', 'initial', false, 'rental_contract'), null);
    assert.deepEqual(readDocumentPolicy('host_residence_certificate', 'initial', false, 'undertaking').accepted_media_types, [
        'application/pdf', 'image/jpeg', 'image/png', 'image/webp'
    ]);
    assert.deepEqual(readDocumentPolicy('host_residence_certificate', 'initial', false, {
        document_policy_version: 1,
        address_evidence_type: 'undertaking'
    }).accepted_media_types, ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
});

test('renewal UETS includes minors and minor consent is separate', () => {
    assert.equal(listDocumentPolicies('renewal', false).some(({ code }) => code === 'uets'), true);
    assert.equal(listDocumentPolicies('renewal', true).some(({ code }) => code === 'uets'), true);
    assert.equal(listDocumentPolicies('initial', false).some(({ code }) => code === 'uets'), false);
    assert.equal(listDocumentPolicies('initial', false).some(({ code }) => code === 'birth_certificate_under18'), false);
    assert.equal(listDocumentPolicies('initial', true, { minor_parents_identified: 'no' }).some(({ code, required }) => code === 'birth_certificate_under18' && required), false);
    assert.equal(listDocumentPolicies('initial', true, { minor_parents_identified: 'yes' }).some(({ code }) => code === 'minor_consent'), true);
    assert.equal(listDocumentPolicies('initial', true, {}).some(({ code, required }) => code === 'minor_consent' && required), true);
});

test('transition UETS requires registered fingerprint code and address documents follow selected branch', () => {
    const codes = listApplicationDocumentPolicies({
        application_type: 'renewal', application_route: 'transition', is_under_18: 0,
        address_evidence_type: 'rental_contract', insurance_basis: 'bilateral_agreement',
        fingerprint_status: 'registered', fingerprint_code: 'FP-123'
    }).map(({ code }) => code);

    assert.equal(codes.includes('home_utility_bill'), false);
    assert.equal(codes.includes('address_residence_certificate'), false);
    assert.ok(codes.includes('uets'));
    assert.equal(listApplicationDocumentPolicies({
        application_type: 'renewal', application_route: 'transition', is_under_18: 1
    }).some(({ code }) => code === 'uets'), false);
});

test('student uploads follow the requested order and keep the permit fee last', () => {
    const codes = listDocumentPolicies('renewal', false, {
        address_evidence_type: 'dormitory', insurance_basis: 'bilateral_agreement'
    }).map(({ code }) => code);

    assert.deepEqual(codes, [
        'residence_application_form', 'passport', 'photographs', 'student_certificate', 'health_insurance',
        'address_dormitory', 'dormitory_tax_certificate', 'dormitory_signature_circular', 'uets', 'residence_permit_fee'
    ]);
});

test('public overview derives the new concise policy and address alternatives without legacy uploads', () => {
    const overview = listPublicDocumentOverview();
    const byCode = new Map(overview.map((policy) => [policy.code, policy]));

    assert.equal(new Set(overview.map(({ code }) => code)).size, overview.length);
    assert.ok(byCode.has('passport'));
    assert.equal(byCode.get('photographs').scope_key, 'homeDocumentAllApplications');
    assert.ok(!byCode.has('residence_card'));
    assert.ok(!byCode.has('passport_identity'));
    assert.ok(!byCode.has('fingerprint'));
    assert.equal(byCode.get('uets').scope_key, 'homeDocumentConditional');
    assert.equal(byCode.get('minor_consent').scope_key, 'homeDocumentUnder18');
    assert.equal(byCode.get('address_rental_contract').group_key, 'address_evidence');
    assert.equal(byCode.get('address_residence_certificate').group_key, 'address_evidence');
    assert.equal(byCode.get('address_residence_certificate').scope_key, 'homeDocumentConditional');
    assert.equal(byCode.has('parent_permit_copy'), false);
    assert.equal(byCode.get('address_undertaking').group_key, 'address_evidence');
});

test('application type remapping explicitly recognizes every legacy and current stable document code', () => {
    const codes = [
        'residence_application_form', 'passport_identity', 'passport', 'visa', 'residence_card', 'photographs',
        'health_insurance', 'uets', 'student_certificate', 'residence_permit_fee', 'address_document',
        'address_rental_contract', 'address_residence_certificate', 'address_undertaking',
        'host_residence_certificate', 'host_identity_copy', 'fingerprint', 'home_utility_bill', 'parent_permit_copy',
        'birth_certificate_under18'
    ];

    assert.equal(typeof documentPolicy.mapDocumentRequirementCodeForTypeSwitch, 'function');
    assert.deepEqual(codes.map((code) => documentPolicy.mapDocumentRequirementCodeForTypeSwitch(code)), codes);
    assert.equal(documentPolicy.mapDocumentRequirementCodeForTypeSwitch('legacy_unknown'), null);
});

test('biometric photographs are not required for applications submitted before the rule, but stay required for drafts and newer submissions', () => {
    const codesFor = (submittedAt) => listApplicationDocumentPolicies({
        application_type: 'initial', is_under_18: 0, submitted_at: submittedAt
    }).map(({ code }) => code);
    assert.equal(codesFor('2026-11-08T19:18:00.000Z').includes('photographs'), false);
    assert.equal(codesFor('2026-11-09T09:33:00.000Z').includes('photographs'), false);
    assert.equal(codesFor('2026-11-09T10:05:00.000Z').includes('photographs'), true);
    assert.equal(codesFor(null).includes('photographs'), true);
    assert.equal(codesFor(undefined).includes('photographs'), true);
    assert.equal(codesFor('not-a-date').includes('photographs'), true);
    assert.equal(codesFor('2026-11-08T19:18:00.000Z').includes('passport'), true);
});
