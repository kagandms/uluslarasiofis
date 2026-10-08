import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import {
    arePrintSettingsAvailable, createPrintUploadPayload, DEFAULT_PRINT_SETTINGS, getMaximumCopies,
    isValidCopies, normalizePrintCapabilities, summarizePrintSettings
} from '../src/public/printSettings.js';

test('print page exposes mobile-friendly setting controls with safe defaults', () => {
    const html = readFileSync(new URL('../yazdir/index.html', import.meta.url), 'utf8');
    const document = new JSDOM(html).window.document;

    assert.equal(document.querySelector('#print-paper-size').value, 'A4');
    assert.equal(document.querySelector('#print-color-mode').value, 'monochrome');
    assert.equal(document.querySelector('#print-duplex').value, 'simplex');
    assert.equal(document.querySelector('#print-orientation').value, 'portrait');
    assert.equal(document.querySelector('#print-copies').value, '1');
    assert.equal(document.querySelector('#print-copies').type, 'number');
    assert.equal(document.querySelector('#print-copies-increase').textContent, '+');
    assert.equal(document.querySelector('#print-paper-size option[value="A3"]').disabled, true);
    assert.equal(document.querySelector('#print-color-mode option[value="color"]').disabled, true);
    assert.equal(document.querySelector('#print-duplex option[value="duplexlong"]').disabled, true);
    assert.match(document.querySelector('#print-settings-summary').textContent, /A4/);
});

test('public settings capabilities only enable known options and fail closed', () => {
    const defaults = normalizePrintCapabilities({
        paper_sizes: ['A4', 'A3', 'LETTER'], color_modes: ['monochrome', 'color'], duplex_modes: ['simplex', 'duplexlong']
    });
    const malformed = normalizePrintCapabilities({ paper_sizes: ['A3'], color_modes: ['color'], duplex_modes: ['duplex'] });

    assert.deepEqual(defaults, {
        paper_sizes: ['A4', 'A3'], color_modes: ['monochrome', 'color'], duplex_modes: ['simplex', 'duplexlong'],
        orientations: ['portrait'], limits: { max_copies: 3, max_page_copies: 200 }
    });
    assert.deepEqual(malformed, { paper_sizes: ['A4'], color_modes: ['monochrome'], duplex_modes: ['simplex'],
        orientations: ['portrait'], limits: { max_copies: 3, max_page_copies: 200 } });
    assert.equal(arePrintSettingsAvailable(DEFAULT_PRINT_SETTINGS, malformed), true);
    assert.equal(arePrintSettingsAvailable({ ...DEFAULT_PRINT_SETTINGS, color_mode: 'color' }, malformed), false);
    assert.equal(malformed.limits.max_copies, 3);
});

test('upload request carries the exact displayed print settings', () => {
    const payload = createPrintUploadPayload({
        file: { size: 250, type: 'image/png' }, settings: { ...DEFAULT_PRINT_SETTINGS, paper_size: 'A3', color_mode: 'color',
            duplex: 'duplexlong', orientation: 'landscape', copies: '25' },
        tokens: { idempotency_key: 'i', tracking_token: 't', upload_token: 'u' }
    });

    assert.deepEqual(payload, {
        byte_size: 250, media_type: 'image/png', paper_size: 'A3', color_mode: 'color', duplex: 'duplexlong',
        orientation: 'landscape', copies: 25,
        idempotency_key: 'i', tracking_token: 't', upload_token: 'u'
    });
});

test('print summary states paper, color, sides, and copies', () => {
    assert.equal(summarizePrintSettings({ paper_size: 'A3', color_mode: 'color', duplex: 'duplexlong',
        orientation: 'landscape', copies: '2' }),
    'A3 · Renkli · Çift taraflı (uzun kenardan çevir) · Yatay · 2 kopya');
});

test('copy input accepts only positive integers within both volume limits', () => {
    const capabilities = normalizePrintCapabilities({ limits: { max_copies: 50, max_page_copies: 200 } });

    assert.equal(getMaximumCopies(capabilities, 20), 10);
    assert.equal(isValidCopies('10', 10), true);
    for (const invalid of ['0', '-1', '1.5', 'abc', '11', '']) assert.equal(isValidCopies(invalid, 10), false);
});
