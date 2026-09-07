import assert from 'node:assert/strict';
import test from 'node:test';
import { extractPassportDatesFromText, extractYoksisIdFromText } from '../src/utils/ykn-document-parser.js';

test('extracts a labeled YÖKSİS ID from acceptance letter text', () => {
    const result = extractYoksisIdFromText('Acceptance information - YÖKSİS ID: ABC-123-XY');

    assert.equal(result, 'ABC-123-XY');
});

test('extracts Topkapı YOKSIS ID from real acceptance letter text', () => {
    const textEn = 'Sedat GÖZCÜ Vice Head of International Relations Department YOKSIS ID: 0F0-881-60 You can scan the QR code';
    assert.equal(extractYoksisIdFromText(textEn), '0F0-881-60');

    const textTr = 'Sedat GÖZCÜ Uluslararası İlişkiler Daire Başkan Yardımcısı YÖKSİS ID: 0F0-881-60 Kare kodu taratarak';
    assert.equal(extractYoksisIdFromText(textTr), '0F0-881-60');
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
