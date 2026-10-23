import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import test from 'node:test';

const identitySource = await readFile(new URL('../ykn_eklenti-main/yoksis-student-identity.js', import.meta.url), 'utf8');

function createMatcher() {
    const dom = new JSDOM('', { runScripts: 'outside-only' });
    dom.window.eval(identitySource);
    return { dom, matches: dom.window.YknStudentIdentity.matches };
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
