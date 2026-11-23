import assert from 'node:assert/strict';
import test from 'node:test';
import { scorePassportPageText } from '../src/utils/passportPageScore.js';
import { evaluatePassportPage } from '../src/services/passportDocumentGuard.js';

const VALID_PASSPORT_OCR = [
    'REPUBLIC OF EXAMPLE',
    'PASSPORT / PASSEPORT',
    'Surname / Nom: YILMAZ',
    'Given Names: AHMET',
    'Passport No: AB1234567',
    'Date of Birth: 01 JAN 2000',
    'Date of Expiry: 01 JAN 2030',
    'P<EXMYILMAZ<<AHMET<<<<<<<<<<<<<<<<<<<<<<<<<<',
    'AB12345674EXM0001012M3001015<<<<<<<<<<<<<<04'
].join('\n');

const DIPLOMA_OCR = [
    'HIGH SCHOOL DIPLOMA',
    'This certifies that AHMET YILMAZ',
    'Passport No: AB1234567',
    'has completed the secondary education program',
    'Date of Issue: 15 JUN 2024'
].join('\n');

const ACCEPTANCE_LETTER_OCR = [
    'ISTANBUL TOPKAPI UNIVERSITY',
    'ACCEPTANCE LETTER',
    'Student Name: AHMET YILMAZ',
    'Passport Number: AB1234567',
    'Program: Computer Engineering',
    'YOKSIS Registration Code: 1234567890'
].join('\n');

test('scorePassportPageText scores MRZ passport biodata higher than non-passport text', () => {
    const passportScore = scorePassportPageText(VALID_PASSPORT_OCR, 'AHMET YILMAZ', 'AB1234567');
    const diplomaScore = scorePassportPageText(DIPLOMA_OCR, 'AHMET YILMAZ', 'AB1234567');

    assert.ok(passportScore >= 180);
    assert.ok(passportScore > diplomaScore);
    assert.equal(scorePassportPageText('', 'AHMET YILMAZ', 'AB1234567'), 0);
});

test('evaluatePassportPage accepts MRZ page with matching passport number', () => {
    const result = evaluatePassportPage({
        text: VALID_PASSPORT_OCR,
        studentName: 'FARKLI ISIM',
        passportNo: 'AB1234567'
    });

    assert.equal(result.isPassport, true);
    assert.equal(result.hasMrz, true);
    assert.equal(result.passportNoMatched, true);
    assert.equal(result.nameMatched, false);
    assert.ok(result.score > 0);
    assert.equal(typeof result.reason, 'string');
    assert.ok(result.reason.length > 0);
});

test('evaluatePassportPage accepts MRZ page when passport number is missing in OCR but student name matches', () => {
    const ocrWithoutPassportNo = [
        'PASSPORT',
        'YILMAZ AHMET',
        'P<EXMYILMAZ<<AHMET<<<<<<<<<<<<<<<<<<<<<<<<<<',
        'XXXXXXXXX4EXM0001012M3001015<<<<<<<<<<<<<<04'
    ].join('\n');

    const result = evaluatePassportPage({
        text: ocrWithoutPassportNo,
        studentName: 'Ahmet Yilmaz',
        passportNo: 'AB1234567'
    });

    assert.equal(result.isPassport, true);
    assert.equal(result.hasMrz, true);
    assert.equal(result.passportNoMatched, false);
    assert.equal(result.nameMatched, true);
});

test('evaluatePassportPage accepts two 30+ char MRZ-like lines containing < even without P< or <<<', () => {
    const degradedMrzOcr = [
        'PASSPORT',
        'POEXMYILMAZ<AHMET<00000000000000000000000000',
        'AB12345674EXM0001012M30010150000000000000<04'
    ].join('\n');

    const result = evaluatePassportPage({
        text: degradedMrzOcr,
        studentName: 'AHMET YILMAZ',
        passportNo: 'AB1234567'
    });

    assert.equal(result.hasMrz, true);
    assert.equal(result.isPassport, true);
});

test('evaluatePassportPage rejects diploma and acceptance letter without MRZ even if name and passport number match', () => {
    const diploma = evaluatePassportPage({
        text: DIPLOMA_OCR,
        studentName: 'AHMET YILMAZ',
        passportNo: 'AB1234567'
    });
    assert.equal(diploma.hasMrz, false);
    assert.equal(diploma.isPassport, false);
    assert.equal(diploma.passportNoMatched, true);
    assert.equal(diploma.nameMatched, true);

    const acceptance = evaluatePassportPage({
        text: ACCEPTANCE_LETTER_OCR,
        studentName: 'AHMET YILMAZ',
        passportNo: 'AB1234567'
    });
    assert.equal(acceptance.hasMrz, false);
    assert.equal(acceptance.isPassport, false);
});

test('evaluatePassportPage rejects MRZ page belonging to a different student', () => {
    const result = evaluatePassportPage({
        text: VALID_PASSPORT_OCR,
        studentName: 'ZEYNEP KAYA',
        passportNo: 'ZZ9999999'
    });

    assert.equal(result.hasMrz, true);
    assert.equal(result.passportNoMatched, false);
    assert.equal(result.nameMatched, false);
    assert.equal(result.isPassport, false);
});

test('evaluatePassportPage rejects empty or non-string OCR text', () => {
    const empty = evaluatePassportPage({
        text: '',
        studentName: 'AHMET YILMAZ',
        passportNo: 'AB1234567'
    });
    assert.equal(empty.isPassport, false);
    assert.equal(empty.hasMrz, false);
    assert.equal(empty.passportNoMatched, false);
    assert.equal(empty.nameMatched, false);
    assert.equal(empty.score, 0);

    const missing = evaluatePassportPage();
    assert.equal(missing.isPassport, false);
    assert.equal(missing.score, 0);
});
