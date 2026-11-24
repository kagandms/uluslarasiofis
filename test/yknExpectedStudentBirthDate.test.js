import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import test from 'node:test';

const identitySource = await readFile(new URL('../ykn_eklenti-main/yoksis-student-identity.js', import.meta.url), 'utf8');
const backgroundSource = await readFile(new URL('../ykn_eklenti-main/background.js', import.meta.url), 'utf8');

function createMatcher() {
    const dom = new JSDOM('', { runScripts: 'outside-only' });
    dom.window.eval(identitySource);
    return { dom, matches: dom.window.YknStudentIdentity.matches };
}

test('matches student across document mismatch when name, surname, and birthDate match', () => {
    const { dom, matches } = createMatcher();
    try {
        assert.equal(matches({
            expectedPassport: 'I1234567',
            currentDocument: 'MRZ<<ABDULLAYEV<<KUVANCH',
            expectedName: 'KUVANCH',
            currentName: 'KUVANCH',
            expectedSurname: 'ABDULLAYEV',
            currentSurname: 'ABDULLAYEV',
            expectedBirthDate: '1998-05-07',
            currentBirthDate: '07.05.1998'
        }), true);
        assert.equal(matches({
            expectedPassport: 'I1234567',
            currentDocument: 'MRZ<<ABDULLAYEV<<KUVANCH',
            expectedName: 'KUVANCH',
            currentName: 'KUVANCH',
            expectedSurname: 'ABDULLAYEV',
            currentSurname: 'ABDULLAYEV',
            expectedBirthDate: '07.05.1998',
            currentBirthDate: '07.05.1998'
        }), true);
    } finally {
        dom.window.close();
    }
});

test('rejects document mismatch when expectedBirthDate is missing', () => {
    const { dom, matches } = createMatcher();
    try {
        assert.equal(matches({
            expectedPassport: 'I1234567',
            currentDocument: 'MRZ<<ABDULLAYEV<<KUVANCH',
            expectedName: 'KUVANCH',
            currentName: 'KUVANCH',
            expectedSurname: 'ABDULLAYEV',
            currentSurname: 'ABDULLAYEV',
            expectedBirthDate: '',
            currentBirthDate: '07.05.1998'
        }), false);
        assert.equal(matches({
            expectedPassport: 'I1234567',
            currentDocument: 'MRZ<<ABDULLAYEV<<KUVANCH',
            expectedName: 'KUVANCH',
            currentName: 'KUVANCH',
            expectedSurname: 'ABDULLAYEV',
            currentSurname: 'ABDULLAYEV',
            currentBirthDate: '07.05.1998'
        }), false);
    } finally {
        dom.window.close();
    }
});

test('rejects document mismatch when birth date differs', () => {
    const { dom, matches } = createMatcher();
    try {
        assert.equal(matches({
            expectedPassport: 'I1234567',
            currentDocument: 'MRZ<<ABDULLAYEV<<KUVANCH',
            expectedName: 'KUVANCH',
            currentName: 'KUVANCH',
            expectedSurname: 'ABDULLAYEV',
            currentSurname: 'ABDULLAYEV',
            expectedBirthDate: '1998-05-08',
            currentBirthDate: '07.05.1998'
        }), false);
    } finally {
        dom.window.close();
    }
});

test('rejects document mismatch when surname or name differs', () => {
    const { dom, matches } = createMatcher();
    try {
        assert.equal(matches({
            expectedPassport: 'I1234567',
            currentDocument: 'MRZ<<ABDULLAYEV<<KUVANCH',
            expectedName: 'KUVANCH',
            currentName: 'KUVANCH',
            expectedSurname: 'ABDULLAYEV',
            currentSurname: 'MAMEDOV',
            expectedBirthDate: '1998-05-07',
            currentBirthDate: '07.05.1998'
        }), false);
        assert.equal(matches({
            expectedPassport: 'I1234567',
            currentDocument: 'MRZ<<ABDULLAYEV<<KUVANCH',
            expectedName: 'KUVANCH',
            currentName: 'DOVRAN',
            expectedSurname: 'ABDULLAYEV',
            currentSurname: 'ABDULLAYEV',
            expectedBirthDate: '1998-05-07',
            currentBirthDate: '07.05.1998'
        }), false);
    } finally {
        dom.window.close();
    }
});

test('background.js includes birthDate in expectedStudent for Kabul-ID search', () => {
    const match = backgroundSource.match(/const expectedStudent\s*=\s*\{([\s\S]*?)\};/);
    assert.ok(match, 'expectedStudent object literal must exist in background.js');
    assert.match(
        match[1],
        /birthDate:\s*request\.data\?\.birthDate\s*\|\|\s*request\.data\?\.dogumTarihi\s*\|\|\s*''/
    );
});
