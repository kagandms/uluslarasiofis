import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import {
    arePrintSettingsAvailable, createPrintUploadPayload, DEFAULT_PRINT_SETTINGS, getMaximumCopies,
    isValidCopies, normalizePrintCapabilities, summarizePrintSettings
} from '../src/public/printSettings.js';

test('print page exposes a five-language selector and a three-step guide while keeping multi-file upload', () => {
    const html = readFileSync(new URL('../yazdir/index.html', import.meta.url), 'utf8');
    const document = new JSDOM(html).window.document;

    assert.equal(document.documentElement.lang, 'en');
    assert.ok(document.querySelector('#print-language'));
    assert.equal(document.querySelectorAll('#print-language option').length, 5);
    assert.equal(document.querySelector('#print-file-input').multiple, true);
    assert.equal(document.querySelector('#print-add-file').textContent.trim(), 'Select a file');
    assert.equal(document.querySelector('#print-add-file').classList.contains('primary-button'), true);
    assert.equal(document.querySelector('#print-basket').hidden, true);
    assert.equal(document.querySelector('#print-message').hidden, true);
    assert.equal(document.querySelector('#print-submit').textContent, 'Send to print queue');
    const template = document.querySelector('#print-file-template').content;
    assert.equal(template.querySelectorAll('[data-setting]').length, 4);
    assert.equal(template.querySelectorAll('.print-settings-grid:not(.advanced-settings .print-settings-grid)').length, 0);
    assert.equal(template.querySelectorAll('.advanced-settings [data-setting]').length, 4);
    assert.equal(template.querySelector('[data-setting="paper_size"]').value, 'A4');
    assert.equal(template.querySelector('[data-setting="color_mode"]').value, 'monochrome');
    assert.equal(template.querySelector('[data-setting="orientation"]').value, 'portrait');
    assert.equal(template.querySelector('[data-setting="copies"]').value, '1');
    assert.equal(template.querySelector('.advanced-settings').open, false);
    assert.equal(template.querySelector('[data-setting="color_mode"] option[value="color"]').disabled, true);
    assert.equal(template.querySelector('[data-pages="all"]').checked, true);
    assert.equal(template.querySelector('.page-range-input').hidden, true);
    assert.equal(template.querySelector('.page-selection-hint').hidden, true);
    assert.deepEqual([...document.querySelectorAll('.print-stepper li')].map((step) => step.textContent.replace(/^\d+/, '').trim()),
        ['Choose file', 'Check print', 'Send to queue']);
    assert.equal(document.querySelector('.print-guide').open, false);
    assert.match(document.querySelector('.print-guide').textContent, /Optional printing guide/);
    assert.equal(document.querySelectorAll('.print-guide-steps li').length, 3);
    assert.equal(document.querySelector('.print-help details').open, false);
    assert.equal(template.querySelector('.advanced-settings summary').textContent, 'Change print settings');
    const stylesheet = readFileSync(new URL('../src/public/print.css', import.meta.url), 'utf8');
    const script = readFileSync(new URL('../src/public/print.js', import.meta.url), 'utf8');
    assert.match(stylesheet, /@media \(max-width: 430px\)/);
    assert.match(stylesheet, /:focus-visible/);
    assert.match(stylesheet, /\.primary-button[^\n]*min-height:\s*62px/);
    assert.doesNotMatch(script, /Document sent to the printer|Please collect your document/);
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
