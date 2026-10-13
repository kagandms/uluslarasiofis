import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPrintLocale, savePrintLocale } from '../src/public/i18n/print-locale.js';
import { PRINT_LOCALES } from '../src/public/i18n/printMessages.js';

function createView(savedLocale = null) {
    return { navigator: { languages: ['ru-RU', 'en-US'], language: 'tr-TR' },
        localStorage: { getItem: () => savedLocale, setItem: () => {} }, console: { warn: () => {} } };
}

test('explicit supported print preferences override browser language', () => {
    for (const locale of PRINT_LOCALES) {
        const view = createView(locale);

        const preference = readPrintLocale(view);

        assert.equal(preference, locale);
    }
});

test('missing and malformed preferences fall back to browser language', () => {
    for (const savedLocale of [null, '', 'invalid', 'ar-SA', 'TR', 'en<script>']) {
        const view = createView(savedLocale);

        const preference = readPrintLocale(view);

        assert.equal(preference, 'ru');
    }
});

test('blocked storage reports the original error and still detects browser language', () => {
    const view = createView();
    const failure = new Error('Storage unavailable');
    const warnings = [];
    Object.defineProperty(view, 'localStorage', { get: () => { throw failure; } });
    view.console.warn = (...warning) => warnings.push(warning);

    const preference = readPrintLocale(view);
    const isSaved = savePrintLocale(view, 'ar');

    assert.equal(preference, 'ru');
    assert.equal(isSaved, false);
    assert.equal(warnings.length, 2);
    assert.ok(warnings.every((warning) => warning[1] === failure));
});

test('only supported explicit preferences are persisted under the new storage key', () => {
    const view = createView();
    const writes = [];
    view.localStorage.setItem = (...args) => writes.push(args);

    const isSaved = savePrintLocale(view, 'tk');

    assert.equal(isSaved, true);
    assert.deepEqual(writes, [['print.locale.v2', 'tk']]);
    assert.throws(() => savePrintLocale(view, 'fr'), RangeError);
    assert.equal(writes.length, 1);
});
