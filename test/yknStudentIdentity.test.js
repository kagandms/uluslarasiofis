import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import test from 'node:test';

const identitySource = await readFile(new URL('../ykn_eklenti-main/yoksis-student-identity.js', import.meta.url), 'utf8');

function createMatcher() {
    const dom = new JSDOM('', { runScripts: 'outside-only' });
    dom.window.eval(identitySource);
    return {
        dom,
        matches: dom.window.YknStudentIdentity.matches,
        explain: dom.window.YknStudentIdentity.explain
    };
}

test('matches the same passport regardless of punctuation and case', () => {
    const { dom, matches } = createMatcher();
    try {
        assert.equal(matches({ expectedPassport: 'ab-123', currentDocument: 'AB 123' }), true);
    } finally { dom.window.close(); }
});

test('accepts exact name, surname, and birth date when document numbers differ', () => {
    const { dom, matches } = createMatcher();
    try {
        assert.equal(matches({
            expectedPassport: 'AB123',
            currentDocument: 'MRZ-AB123-OTHER',
            expectedName: 'Kevin Idi',
            currentName: 'KEVIN IDI',
            expectedSurname: 'Mwali',
            currentSurname: 'MWALI',
            expectedBirthDate: '2003-06-19',
            currentBirthDate: '19.06.2003'
        }), true);
    } finally { dom.window.close(); }
});

test('rejects a document mismatch when the birth date differs', () => {
    const { dom, matches } = createMatcher();
    try {
        assert.equal(matches({
            expectedPassport: 'AB123',
            currentDocument: 'CD456',
            expectedName: 'Kevin',
            currentName: 'Kevin',
            expectedSurname: 'Mwali',
            currentSurname: 'Mwali',
            expectedBirthDate: '2003-06-19',
            currentBirthDate: '20.06.2003'
        }), false);
    } finally { dom.window.close(); }
});

test('rejects a document mismatch without a complete secondary identity', () => {
    const { dom, matches } = createMatcher();
    try {
        assert.equal(matches({
            expectedPassport: 'AB123', currentDocument: 'CD456',
            expectedName: 'Kevin', currentName: 'Kevin',
            expectedSurname: 'Mwali', currentSurname: 'Mwali'
        }), false);
    } finally { dom.window.close(); }
});

test('explain matches result with matches() across all identity cases and exposes only booleans/null', () => {
    const { dom, matches, explain } = createMatcher();
    try {
        const cases = [
            {
                name: 'same passport',
                input: { expectedPassport: 'ab-123', currentDocument: 'AB 123' },
                expectedFlags: {
                    expectedPassportPresent: true,
                    currentDocumentPresent: true,
                    passportEqual: true,
                    passportMismatch: false,
                    expectedNamePresent: false,
                    nameEqual: false,
                    expectedSurnamePresent: false,
                    surnameEqual: false,
                    expectedBirthDatePresent: false,
                    expectedBirthDateValid: false,
                    currentBirthDatePresent: false,
                    currentBirthDateValid: false,
                    birthDateEqual: false,
                    birthYearEqual: false,
                    birthMonthEqual: false,
                    birthDayEqual: false,
                    birthDayMonthSwappedEqual: false,
                    result: true
                }
            },
            {
                name: 'different passport + same name/surname/birth date',
                input: {
                    expectedPassport: 'AB123',
                    currentDocument: 'CD456',
                    expectedName: 'Kevin Idi',
                    currentName: 'KEVIN IDI',
                    expectedSurname: 'Mwali',
                    currentSurname: 'MWALI',
                    expectedBirthDate: '2003-06-19',
                    currentBirthDate: '19.06.2003'
                },
                expectedFlags: {
                    expectedPassportPresent: true,
                    currentDocumentPresent: true,
                    passportEqual: false,
                    passportMismatch: true,
                    expectedNamePresent: true,
                    nameEqual: true,
                    expectedSurnamePresent: true,
                    surnameEqual: true,
                    expectedBirthDatePresent: true,
                    expectedBirthDateValid: true,
                    currentBirthDatePresent: true,
                    currentBirthDateValid: true,
                    birthDateEqual: true,
                    birthYearEqual: true,
                    birthMonthEqual: true,
                    birthDayEqual: true,
                    birthDayMonthSwappedEqual: false,
                    result: true
                }
            },
            {
                name: 'different passport + no expected birth date',
                input: {
                    expectedPassport: 'AB123',
                    currentDocument: 'CD456',
                    expectedName: 'Kevin',
                    currentName: 'Kevin',
                    expectedSurname: 'Mwali',
                    currentSurname: 'Mwali',
                    currentBirthDate: '19.06.2003'
                },
                expectedFlags: {
                    expectedPassportPresent: true,
                    currentDocumentPresent: true,
                    passportEqual: false,
                    passportMismatch: true,
                    expectedNamePresent: true,
                    nameEqual: true,
                    expectedSurnamePresent: true,
                    surnameEqual: true,
                    expectedBirthDatePresent: false,
                    expectedBirthDateValid: false,
                    currentBirthDatePresent: true,
                    currentBirthDateValid: true,
                    birthDateEqual: false,
                    birthYearEqual: false,
                    birthMonthEqual: false,
                    birthDayEqual: false,
                    birthDayMonthSwappedEqual: false,
                    result: false
                }
            },
            {
                name: 'different birth date',
                input: {
                    expectedPassport: 'AB123',
                    currentDocument: 'CD456',
                    expectedName: 'Kevin',
                    currentName: 'Kevin',
                    expectedSurname: 'Mwali',
                    currentSurname: 'Mwali',
                    expectedBirthDate: '2003-06-19',
                    currentBirthDate: '20.06.2003'
                },
                expectedFlags: {
                    expectedPassportPresent: true,
                    currentDocumentPresent: true,
                    passportEqual: false,
                    passportMismatch: true,
                    expectedNamePresent: true,
                    nameEqual: true,
                    expectedSurnamePresent: true,
                    surnameEqual: true,
                    expectedBirthDatePresent: true,
                    expectedBirthDateValid: true,
                    currentBirthDatePresent: true,
                    currentBirthDateValid: true,
                    birthDateEqual: false,
                    birthYearEqual: true,
                    birthMonthEqual: true,
                    birthDayEqual: false,
                    birthDayMonthSwappedEqual: false,
                    result: false
                }
            },
            {
                name: 'different year only',
                input: {
                    expectedPassport: 'AB123',
                    currentDocument: 'CD456',
                    expectedName: 'Kevin',
                    currentName: 'Kevin',
                    expectedSurname: 'Mwali',
                    currentSurname: 'Mwali',
                    expectedBirthDate: '2000-01-10',
                    currentBirthDate: '10.01.1999'
                },
                expectedFlags: {
                    expectedPassportPresent: true,
                    currentDocumentPresent: true,
                    passportEqual: false,
                    passportMismatch: true,
                    expectedNamePresent: true,
                    nameEqual: true,
                    expectedSurnamePresent: true,
                    surnameEqual: true,
                    expectedBirthDatePresent: true,
                    expectedBirthDateValid: true,
                    currentBirthDatePresent: true,
                    currentBirthDateValid: true,
                    birthDateEqual: false,
                    birthYearEqual: false,
                    birthMonthEqual: true,
                    birthDayEqual: true,
                    birthDayMonthSwappedEqual: false,
                    result: false
                }
            },
            {
                name: 'day and month swapped',
                input: {
                    expectedPassport: 'AB123',
                    currentDocument: 'CD456',
                    expectedName: 'Kevin',
                    currentName: 'Kevin',
                    expectedSurname: 'Mwali',
                    currentSurname: 'Mwali',
                    expectedBirthDate: '2000-01-10',
                    currentBirthDate: '2000-10-01'
                },
                expectedFlags: {
                    expectedPassportPresent: true,
                    currentDocumentPresent: true,
                    passportEqual: false,
                    passportMismatch: true,
                    expectedNamePresent: true,
                    nameEqual: true,
                    expectedSurnamePresent: true,
                    surnameEqual: true,
                    expectedBirthDatePresent: true,
                    expectedBirthDateValid: true,
                    currentBirthDatePresent: true,
                    currentBirthDateValid: true,
                    birthDateEqual: false,
                    birthYearEqual: true,
                    birthMonthEqual: false,
                    birthDayEqual: false,
                    birthDayMonthSwappedEqual: true,
                    result: false
                }
            },
            {
                name: 'surname differs',
                input: {
                    expectedPassport: 'AB123',
                    currentDocument: 'CD456',
                    expectedName: 'Kevin',
                    currentName: 'Kevin',
                    expectedSurname: 'Mwali',
                    currentSurname: 'Banda',
                    expectedBirthDate: '2003-06-19',
                    currentBirthDate: '19.06.2003'
                },
                expectedFlags: {
                    expectedPassportPresent: true,
                    currentDocumentPresent: true,
                    passportEqual: false,
                    passportMismatch: true,
                    expectedNamePresent: true,
                    nameEqual: true,
                    expectedSurnamePresent: true,
                    surnameEqual: false,
                    expectedBirthDatePresent: true,
                    expectedBirthDateValid: true,
                    currentBirthDatePresent: true,
                    currentBirthDateValid: true,
                    birthDateEqual: true,
                    birthYearEqual: true,
                    birthMonthEqual: true,
                    birthDayEqual: true,
                    birthDayMonthSwappedEqual: false,
                    result: false
                }
            },
            {
                name: 'empty inputs',
                input: {},
                expectedFlags: {
                    expectedPassportPresent: false,
                    currentDocumentPresent: false,
                    passportEqual: false,
                    passportMismatch: false,
                    expectedNamePresent: false,
                    nameEqual: false,
                    expectedSurnamePresent: false,
                    surnameEqual: false,
                    expectedBirthDatePresent: false,
                    expectedBirthDateValid: false,
                    currentBirthDatePresent: false,
                    currentBirthDateValid: false,
                    birthDateEqual: false,
                    birthYearEqual: false,
                    birthMonthEqual: false,
                    birthDayEqual: false,
                    birthDayMonthSwappedEqual: false,
                    result: null
                }
            },
            {
                name: 'one date invalid',
                input: {
                    expectedPassport: 'AB123',
                    currentDocument: 'CD456',
                    expectedName: 'Kevin',
                    currentName: 'Kevin',
                    expectedSurname: 'Mwali',
                    currentSurname: 'Mwali',
                    expectedBirthDate: '2000-01-10',
                    currentBirthDate: 'not-a-date'
                },
                expectedFlags: {
                    expectedPassportPresent: true,
                    currentDocumentPresent: true,
                    passportEqual: false,
                    passportMismatch: true,
                    expectedNamePresent: true,
                    nameEqual: true,
                    expectedSurnamePresent: true,
                    surnameEqual: true,
                    expectedBirthDatePresent: true,
                    expectedBirthDateValid: true,
                    currentBirthDatePresent: true,
                    currentBirthDateValid: false,
                    birthDateEqual: false,
                    birthYearEqual: false,
                    birthMonthEqual: false,
                    birthDayEqual: false,
                    birthDayMonthSwappedEqual: false,
                    result: false
                }
            },
            {
                name: 'invalid date strings',
                input: {
                    expectedPassport: 'AB123',
                    currentDocument: 'CD456',
                    expectedName: 'Kevin',
                    currentName: 'Kevin',
                    expectedSurname: 'Mwali',
                    currentSurname: 'Mwali',
                    expectedBirthDate: '2003-02-30',
                    currentBirthDate: 'not-a-date'
                },
                expectedFlags: {
                    expectedPassportPresent: true,
                    currentDocumentPresent: true,
                    passportEqual: false,
                    passportMismatch: true,
                    expectedNamePresent: true,
                    nameEqual: true,
                    expectedSurnamePresent: true,
                    surnameEqual: true,
                    expectedBirthDatePresent: true,
                    expectedBirthDateValid: false,
                    currentBirthDatePresent: true,
                    currentBirthDateValid: false,
                    birthDateEqual: false,
                    birthYearEqual: false,
                    birthMonthEqual: false,
                    birthDayEqual: false,
                    birthDayMonthSwappedEqual: false,
                    result: false
                }
            }
        ];

        for (const testCase of cases) {
            const rawExplained = explain(testCase.input);
            const serialized = JSON.stringify(rawExplained);
            const explained = JSON.parse(serialized);
            const matched = matches(testCase.input);
            assert.equal(explained.result, matched, `${testCase.name}: explain.result must equal matches()`);
            assert.deepEqual(explained, testCase.expectedFlags, `${testCase.name}: flags mismatch`);

            for (const [key, value] of Object.entries(explained)) {
                if (key === 'result') {
                    assert.ok(value === null || typeof value === 'boolean', `${testCase.name}: result must be boolean or null`);
                } else {
                    assert.equal(typeof value, 'boolean', `${testCase.name}: ${key} must be boolean`);
                }
            }
            for (const rawValue of Object.values(testCase.input)) {
                const text = String(rawValue || '').trim();
                if (text) {
                    assert.equal(serialized.includes(text), false, `${testCase.name}: serialized output leaked ${text}`);
                }
            }
        }
    } finally { dom.window.close(); }
});
