import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
    PRINT_LOCALES, PRINT_MESSAGES, detectPrintLocale, getPrintMessageKeys, resolvePrintLocale,
    translatePrintMessage
} from '../src/public/i18n/printMessages.js';

test('browser locale detection maps supported regional tags and follows browser preference order', () => {
    const regionalLocales = ['tr-TR', 'en-US', 'ru-RU', 'tk-TM', 'ar-SA'];

    assert.deepEqual(regionalLocales.map((locale) => detectPrintLocale([locale])), PRINT_LOCALES);
    assert.equal(detectPrintLocale(['fr-FR', 'ru-RU', 'en-US']), 'ru');
    assert.equal(detectPrintLocale(['fr-FR', 'de-DE']), 'tr');
    assert.equal(detectPrintLocale(['TK_tm']), 'tk');
});

test('a valid saved manual locale takes priority over browser preferences', () => {
    assert.equal(resolvePrintLocale(['tr-TR'], 'ar'), 'ar');
    assert.equal(resolvePrintLocale(['ar-SA'], 'invalid'), 'ar');
    assert.equal(resolvePrintLocale(['de-DE'], null), 'tr');
});

test('all five print dictionaries contain the same complete translation keys', () => {
    const expectedKeys = getPrintMessageKeys();
    const html = readFileSync(new URL('../yazdir/index.html', import.meta.url), 'utf8');
    const script = readFileSync(new URL('../src/public/print.js', import.meta.url), 'utf8');
    const pageKeys = new Set([
        ...[...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((match) => match[1]),
        ...[...script.matchAll(/\bt\('([a-zA-Z]+)'/g)].map((match) => match[1]),
        'pageCountUnavailable', 'pageRequired', 'pageFormatInvalid', 'pageOutOfRange', 'pageDuplicate'
    ]);

    for (const locale of PRINT_LOCALES) {
        assert.deepEqual(Object.keys(PRINT_MESSAGES[locale]).sort(), expectedKeys, `${locale} keys differ`);
        for (const key of expectedKeys) {
            const translated = translatePrintMessage(locale, key, {
                count: 2, maximum: 20, name: 'file.pdf', paper: 'A4', color: 'Color',
                sides: 'Single-sided', orientation: 'Portrait', copies: '2 copies'
            });
            assert.equal(typeof translated, 'string', `${locale}.${key} must resolve to text`);
            assert.notEqual(translated, key, `${locale}.${key} must not fall back to its key`);
            assert.notEqual(translated.trim(), '', `${locale}.${key} must not be empty`);
        }
        for (const match of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) {
            assert.ok(expectedKeys.includes(match[1]), `Missing ${locale} translation for ${match[1]}`);
        }
    }
    for (const key of pageKeys) assert.ok(expectedKeys.includes(key), `Missing translation key ${key}`);
});

test('Arabic and Turkmen print strings use their required scripts', () => {
    assert.match(translatePrintMessage('ar', 'submit'), /[\u0600-\u06FF]/);
    assert.match(translatePrintMessage('tk', 'addFile'), /[A-Za-zÄÖÜäöüŇňŞşÇçÝý]/);
    assert.doesNotMatch(translatePrintMessage('tk', 'addFile'), /[\u0400-\u04FF\u0600-\u06FF]/);
    assert.equal(translatePrintMessage('ar', 'pageFormatInvalid'), 'أدخل الصفحات بهذا التنسيق: 1-5, 3,7.');
});
