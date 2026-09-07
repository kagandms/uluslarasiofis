import assert from 'node:assert/strict';
import test from 'node:test';
import { extractPassportDatesFromText, extractYoksisIdFromText, isValidYoksisId } from '../src/utils/ykn-document-parser.js';

test('extracts a labeled YÖKSİS ID from acceptance letter text', () => {
    const result = extractYoksisIdFromText('Acceptance information - YÖKSİS ID: ABC-123-XY');

    assert.equal(result, 'ABC-123-XY');
});

test('extracts Topkapı YOKSIS ID from real acceptance letter text', () => {
    const textEn = 'Sedat GÖZCÜ Vice Head of International Relations Department YOKSIS ID: 0F0-881-60 You can scan the QR code';
    assert.equal(extractYoksisIdFromText(textEn), '0F0-881-60');

    const textTr = 'Sedat GÖZCÜ Uluslararası İlişkiler Daire Başkan Yardımcısı YÖKSİS ID: 0F0-881-60 Kare kodu taratarak';
    assert.equal(extractYoksisIdFromText(textTr), '0F0-881-60');

    const textRushana = 'Sedat GÖZCÜ Vice Head of International Relations Department YOKSIS ID: 821-EC2-34 You can scan the QR code';
    assert.equal(extractYoksisIdFromText(textRushana), '821-EC2-34');
});

test('rejects SVG-ICON-3HX and css artifacts from YOKSIS ID candidates', () => {
    assert.equal(extractYoksisIdFromText('svg-icon-3hx'), '');
    assert.equal(extractYoksisIdFromText('Metronic badge svg-icon-3hx element'), '');
    assert.equal(extractYoksisIdFromText('class="svg-icon svg-icon-3hx" YOKSIS ID: 821-EC2-34'), '821-EC2-34');
    assert.equal(isValidYoksisId('SVG-ICON-3HX'), false);
    assert.equal(isValidYoksisId('821-EC2-34'), true);
    assert.equal(isValidYoksisId('0F0-881-60'), true);
    assert.equal(isValidYoksisId('2024-05-12'), false);
});

test('extracts passport issue and expiry dates from labeled text', () => {
    const result = extractPassportDatesFromText(
        'Date of Issue: 11.03.2026 Date of Expiry: 11.03.2031'
    );

    assert.deepEqual(result, { issueDate: '2026-03-11', expiryDate: '2031-03-11' });
});

test('rejects invalid passport date order instead of guessing', () => {
    const result = extractPassportDatesFromText(
        'Düzenlenme Tarihi: 11.03.2031 Geçerlilik Tarihi: 11.03.2026'
    );

    assert.deepEqual(result, { issueDate: '', expiryDate: '' });
});
