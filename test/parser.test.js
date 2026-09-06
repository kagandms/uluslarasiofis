import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFields, extractFromCoordinates } from '../src/utils/parser.js';
import { formatApplicationNumberInput } from '../src/ui/formManager.js';

test('should extract a registration number from its label line', () => {
    // Arrange
    const text = 'Kayıt Numarası (Registration Number) 2026-35-0645889';

    // Act
    const result = extractFields(text);

    // Assert
    assert.equal(result.basvuruNo, '2026-35-0645889');
});

test('should extract a registration number when its label and value are on separate lines', () => {
    // Arrange
    const text = 'Kayıt Numarası\n(Registration Number)\n2026-88-0638278';

    // Act
    const result = extractFields(text);

    // Assert
    assert.equal(result.basvuruNo, '2026-88-0638278');
});

test('should not append barcode digits to a label-linked registration number', () => {
    // Arrange
    const text = 'GCGM03-92026040644400\nKayıt Numarası\n2026-04-0644400';

    // Act
    const result = extractFields(text);

    // Assert
    assert.equal(result.basvuruNo, '2026-04-0644400');
});

test('should normalize OCR confusion in numeric registration number segments', () => {
    // Arrange
    const text = 'Registration Number\n2O26-8B-O638278';

    // Act
    const result = extractFields(text);

    // Assert
    assert.equal(result.basvuruNo, '2026-88-0638278');
});

test('should leave the registration number empty when no registration label exists', () => {
    // Arrange
    const text = 'Kayıt Tarihi 03.08.2026\nTahakkuk No 202608032829186\nGİB Ödeme Tutarı 964.00 TL';

    // Act
    const result = extractFields(text);

    // Assert
    assert.equal(result.basvuruNo, '');
});

test('should prefer the value located right of the registration label over barcode text', () => {
    // Arrange
    const words = [
        createWord('GCGM03-92026040644400', 520, 20, 760, 45),
        createWord('Kayıt', 430, 120, 500, 145),
        createWord('Numarası', 430, 150, 540, 175),
        createWord('Registration', 430, 180, 560, 205),
        createWord('Number', 430, 210, 510, 235),
        createWord('2026-04-0644400', 590, 120, 760, 145)
    ];
    const extracted = {};

    // Act
    extractFromCoordinates(words, extracted);

    // Assert
    assert.equal(extracted.basvuruNo, '2026-04-0644400');
});

test('should preserve the OCR year while formatting a registration number input', () => {
    // Arrange
    const value = '2027-04-0644400';

    // Act
    const formatted = formatApplicationNumberInput(value, '2026');

    // Assert
    assert.equal(formatted, '2027-04-0644400');
});

function createWord(text, x0, y0, x1, y1) {
    return { text, bbox: { x0, y0, x1, y1 }, confidence: 1 };
}
