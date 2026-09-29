import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateStudentDocumentRequirements } from '../src/server/domain/documentRequirements.js';

const baseRequirements = [
    { code: 'passport_identity', is_required: 1, display_order: 2 },
    { code: 'fingerprint', is_required: 1, display_order: 9 },
    { code: 'birth_certificate_under18', is_required: 1, display_order: 11 }
];

test('adult applications do not receive the conditional birth certificate requirement', () => {
    const requirements = calculateStudentDocumentRequirements(baseRequirements, { is_under_18: 0 });

    assert.deepEqual(requirements.map(({ code }) => code), ['passport_identity', 'fingerprint']);
});

test('under-18 applications receive one required birth certificate and retain the existing fingerprint requirement', () => {
    const requirements = calculateStudentDocumentRequirements(baseRequirements, { is_under_18: 1 });

    assert.deepEqual(requirements.map(({ code }) => code), ['passport_identity', 'fingerprint', 'birth_certificate_under18']);
    assert.equal(requirements.find(({ code }) => code === 'birth_certificate_under18').is_required, 1);
    assert.equal(requirements.filter(({ code }) => code === 'fingerprint').length, 1);
});

test('the age rule does not invent parental consent or other documents', () => {
    const requirements = calculateStudentDocumentRequirements(baseRequirements, { is_under_18: 1 });

    assert.equal(requirements.some(({ code }) => code.includes('parental') || code.includes('guardian')), false);
});

test('an existing equivalent birth certificate code is reused without a duplicate requirement', () => {
    const requirements = calculateStudentDocumentRequirements([
        ...baseRequirements,
        { code: 'birth_certificate', is_required: 0, display_order: 12 }
    ], { is_under_18: true });

    assert.equal(requirements.filter(({ code }) => code === 'birth_certificate' || code === 'birth_certificate_under18').length, 1);
    assert.equal(requirements.find(({ code }) => code === 'birth_certificate' || code === 'birth_certificate_under18').is_required, 1);
});
