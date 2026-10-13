import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { buildStudentPrintGuideHtml } from '../scripts/lib/student-print-guide.mjs';
import { PRINT_GUIDE_MESSAGES } from '../src/public/i18n/print-guide-messages.js';
import { PRINT_MESSAGES } from '../src/public/i18n/printMessages.js';

function createOptions(printUrl = 'https://portal.test/yazdir/') {
    return { template: readFileSync(new URL('../scripts/templates/student-print-guide.html', import.meta.url), 'utf8'),
        printUrl, qrSvg: '<svg aria-label="Print QR"></svg>', logo: 'data:image/png;base64,TEST',
        latinFont: 'data:font/ttf;base64,LATIN', arabicFont: 'data:font/ttf;base64,ARABIC' };
}

test('desk guide provides four instructions in each language and an RTL Arabic section', () => {
    const options = createOptions();

    const document = new JSDOM(buildStudentPrintGuideHtml(options)).window.document;

    assert.deepEqual([...document.querySelectorAll('.language-section')].map((section) => section.lang), ['tr', 'tk', 'ru', 'en', 'ar']);
    assert.equal(document.querySelectorAll('.language-section li').length, 20);
    assert.equal(document.querySelector('[lang=ar]').dir, 'rtl');
    assert.equal(document.querySelector('.address a').href, options.printUrl);
    assert.equal(document.querySelectorAll('svg').length, 1);
    assert.ok([...document.images].every((image) => image.src.startsWith('data:')));
    assert.doesNotMatch(document.documentElement.outerHTML, /\{\{\w+\}\}|https:\/\/fonts/);
});

test('poster buttons match the live printing translations in all five languages', () => {
    for (const [locale, messages] of Object.entries(PRINT_GUIDE_MESSAGES)) {
        const buttonName = PRINT_MESSAGES[locale].submit;

        assert.ok(messages.print.includes(buttonName), `${locale} poster must name the actual submit button`);
        assert.equal(Object.values(messages).length, 4);
        assert.ok(Object.values(messages).every((message) => typeof message === 'string' && message.trim()));
    }
});

test('desk guide rejects insecure and non-print addresses', () => {
    for (const printUrl of ['http://portal.test/yazdir/', 'https://portal.test/', 'https://portal.test/yazdir/?mode=staff',
        'https://portal.test/yazdir/#token', 'https://user:password@portal.test/yazdir/']) {
        const options = createOptions(printUrl);

        assert.throws(() => buildStudentPrintGuideHtml(options), TypeError);
    }
});
