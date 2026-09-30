import assert from 'node:assert/strict';
import test from 'node:test';
import { extractPassportIdentityCandidates } from '../src/shared/passport/identityParser.js';

const VALID_TD3_MRZ = [
    'P<TURDEMIR<<KAGAN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<',
    'U123456784TUR0205159M3205155<<<<<<<<<<<<<<02'
].join('\n');

const EMPTY_CANDIDATES = {
    first_name: null,
    last_name: null,
    passport_number: null,
    nationality: null,
    date_of_birth: null
};

test('extracts only the public identity candidates from a valid TD3 passport MRZ', () => {
    const result = extractPassportIdentityCandidates(VALID_TD3_MRZ);

    assert.deepEqual(result, {
        first_name: 'KAGAN',
        last_name: 'DEMIR',
        passport_number: 'U12345678',
        nationality: 'TUR',
        date_of_birth: '2002-05-15'
    });
});

test('normalizes OCR spacing around a complete MRZ without changing its values', () => {
    const spacedMrz = VALID_TD3_MRZ.split('\n')
        .map((line) => [...line].join(' '))
        .join('\n');

    assert.deepEqual(extractPassportIdentityCandidates(spacedMrz), {
        first_name: 'KAGAN',
        last_name: 'DEMIR',
        passport_number: 'U12345678',
        nationality: 'TUR',
        date_of_birth: '2002-05-15'
    });
});

test('returns null candidates for non-passport and incomplete OCR text', () => {
    assert.deepEqual(extractPassportIdentityCandidates('Residence permit, applicant: Anna Eriksson'), EMPTY_CANDIDATES);
    assert.deepEqual(extractPassportIdentityCandidates('P<UTOERIKSSON<<ANNA<MARIA'), EMPTY_CANDIDATES);
    assert.deepEqual(extractPassportIdentityCandidates(null), EMPTY_CANDIDATES);
});

test('omits a date of birth when the MRZ birth-date check digit is invalid', () => {
    const invalidBirthCheck = `${VALID_TD3_MRZ.slice(0, 64)}3${VALID_TD3_MRZ.slice(65)}`;

    assert.deepEqual(extractPassportIdentityCandidates(invalidBirthCheck), {
        first_name: 'KAGAN',
        last_name: 'DEMIR',
        passport_number: 'U12345678',
        nationality: 'TUR',
        date_of_birth: null
    });
});
