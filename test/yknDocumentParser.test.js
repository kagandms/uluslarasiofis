import assert from 'node:assert/strict';
import test from 'node:test';
import { extractPassportDatesFromText, extractYoksisIdFromText } from '../src/utils/ykn-document-parser.js';

test('extracts a labeled YÖKSİS ID from acceptance letter text', () => {
    const result = extractYoksisIdFromText('Acceptance information - YÖKSİS ID: ABC-123-XY');

    assert.equal(result, 'ABC-123-XY');
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
