import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as documentPolicy from '../src/server/domain/documentPolicy.js';
import { listDocumentPolicies, listPublicDocumentOverview, readDocumentPolicy } from '../src/server/domain/documentPolicy.js';

test('document policies expose separate passport and residence-card uploads without fingerprint files', () => {
    const policies = listDocumentPolicies('initial', false);
    const codes = policies.map(({ code }) => code);

    assert.ok(codes.includes('passport'));
    assert.ok(codes.includes('residence_card'));
    assert.ok(!codes.includes('passport_identity'));
    assert.ok(!codes.includes('fingerprint'));
    assert.equal(readDocumentPolicy('passport', 'initial', false).label_key, 'documentPassport');
    assert.equal(readDocumentPolicy('residence_card', 'initial', false).label_key, 'documentResidenceCard');
});

test('address policy exposes exactly the selected one-of-three evidence branch', () => {
    const unselected = listDocumentPolicies('initial', false);
    const rental = listDocumentPolicies('initial', false, 'rental_contract');
    const residence = listDocumentPolicies('initial', false, 'residence_certificate');
    const undertaking = listDocumentPolicies('initial', false, 'undertaking');

    assert.equal(unselected.some(({ code }) => code.startsWith('address_') || code.startsWith('host_')), false);
    assert.deepEqual(rental.filter(({ conditional_rule }) => conditional_rule?.startsWith('address_')).map(({ code }) => code), [
        'address_rental_contract'
    ]);
    assert.deepEqual(residence.filter(({ conditional_rule }) => conditional_rule?.startsWith('address_')).map(({ code }) => code), [
        'address_residence_certificate'
    ]);
    assert.deepEqual(undertaking.filter(({ conditional_rule }) => conditional_rule?.startsWith('address_')).map(({ code }) => code), [
        'address_undertaking', 'host_residence_certificate', 'host_identity_copy'
    ]);
    assert.equal(readDocumentPolicy('host_residence_certificate', 'initial', false, 'rental_contract'), null);
    assert.deepEqual(readDocumentPolicy('host_residence_certificate', 'initial', false, 'undertaking').accepted_media_types, [
        'application/pdf'
    ]);
});

test('renewal-only UETS and under-18 certificate applicability stay canonical', () => {
    assert.equal(listDocumentPolicies('renewal', false).some(({ code }) => code === 'uets'), true);
    assert.equal(listDocumentPolicies('initial', false).some(({ code }) => code === 'uets'), false);
    assert.equal(listDocumentPolicies('initial', false).some(({ code }) => code === 'birth_certificate_under18'), false);
    assert.equal(listDocumentPolicies('initial', true).some(({ code, required }) => code === 'birth_certificate_under18' && required), true);
});

test('public overview derives the new concise policy and address alternatives without legacy uploads', () => {
    const overview = listPublicDocumentOverview();
    const byCode = new Map(overview.map((policy) => [policy.code, policy]));

    assert.equal(new Set(overview.map(({ code }) => code)).size, overview.length);
    assert.ok(byCode.has('passport'));
    assert.ok(byCode.has('residence_card'));
    assert.ok(!byCode.has('passport_identity'));
    assert.ok(!byCode.has('fingerprint'));
    assert.equal(byCode.get('uets').scope_key, 'homeDocumentRenewal');
    assert.equal(byCode.get('birth_certificate_under18').scope_key, 'homeDocumentUnder18');
    assert.equal(byCode.get('address_rental_contract').group_key, 'address_evidence');
    assert.equal(byCode.get('address_residence_certificate').group_key, 'address_evidence');
    assert.equal(byCode.get('address_undertaking').group_key, 'address_evidence');
});

test('application type remapping explicitly recognizes every legacy and current stable document code', () => {
    const codes = [
        'residence_application_form', 'passport_identity', 'passport', 'residence_card', 'photographs',
        'health_insurance', 'uets', 'student_certificate', 'residence_permit_fee', 'address_document',
        'address_rental_contract', 'address_residence_certificate', 'address_undertaking',
        'host_residence_certificate', 'host_identity_copy', 'fingerprint', 'home_utility_bill',
        'birth_certificate_under18'
    ];

    assert.equal(typeof documentPolicy.mapDocumentRequirementCodeForTypeSwitch, 'function');
    assert.deepEqual(codes.map((code) => documentPolicy.mapDocumentRequirementCodeForTypeSwitch(code)), codes);
    assert.equal(documentPolicy.mapDocumentRequirementCodeForTypeSwitch('legacy_unknown'), null);
});
