import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listDocumentPolicies, listPublicDocumentOverview, readDocumentPolicy } from '../src/server/domain/documentPolicy.js';

test('document policies reconcile the registered residence list and renewal-only UETS rule', () => {
    const initial = listDocumentPolicies('initial', false);
    const renewal = listDocumentPolicies('renewal', false);

    assert.deepEqual(initial.map(({ code }) => code), [
        'residence_application_form', 'passport_identity', 'photographs', 'health_insurance',
        'student_certificate', 'residence_permit_fee', 'address_document', 'fingerprint', 'home_utility_bill'
    ]);
    assert.equal(renewal.some(({ code }) => code === 'uets'), true);
    assert.equal(initial.some(({ code }) => code === 'uets'), false);
    assert.equal(initial.some(({ code }) => code === 'birth_certificate_under18'), false);
    assert.equal(listDocumentPolicies('initial', true).some(({ code, required }) => code === 'birth_certificate_under18' && required), true);
});

test('document policy supplies safe labels, formats, byte limits and no storage metadata', () => {
    const policy = readDocumentPolicy('passport_identity', 'initial', false);

    assert.equal(policy.label_key, 'documentPassportIdentity');
    assert.equal(policy.description_key, 'documentPassportIdentityHelp');
    assert.deepEqual(policy.accepted_media_types, ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
    assert.equal(policy.max_byte_size, 10 * 1024 * 1024);
    assert.equal('storage_key' in policy, false);
    assert.equal(readDocumentPolicy('fingerprint', 'initial', false).code, 'fingerprint');
    assert.equal(readDocumentPolicy('uets', 'initial', false), null);
});

test('public document overview uses each current policy once and identifies conditional requirements', () => {
    const overview = listPublicDocumentOverview();
    const byCode = new Map(overview.map((policy) => [policy.code, policy]));

    assert.equal(overview.length, 11);
    assert.equal(new Set(overview.map(({ code }) => code)).size, overview.length);
    assert.equal(byCode.get('uets').scope_key, 'homeDocumentRenewal');
    assert.equal(byCode.get('birth_certificate_under18').scope_key, 'homeDocumentUnder18');
    assert.equal(byCode.get('fingerprint').scope_key, 'homeDocumentConditional');
    assert.equal(byCode.get('passport_identity').scope_key, 'homeDocumentAllApplications');
    assert.equal(overview.every(({ label_key, scope_key }) => label_key && scope_key), true);
});
