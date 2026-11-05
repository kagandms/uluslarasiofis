import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { requestGocnetCorrection } from '../src/staff/gocnet-correction-dialog.js';

test('registration correction shows the first-page preview, lists OCR candidates, and returns the selected value', async () => {
    const dom = new JSDOM('<body></body>', { url: 'https://portal.test/yetkili/' });
    const previousDocument = globalThis.document;
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    globalThis.document = dom.window.document;
    URL.createObjectURL = () => 'blob:form-preview';
    URL.revokeObjectURL = () => {};
    try {
        const resultPromise = requestGocnetCorrection({
            code: 'REGISTRATION_NUMBER_CONFIRMATION_REQUIRED',
            message: 'Birden fazla aday bulundu.',
            candidates: ['2026-04-0644400', '2026-04-0644401'],
            formFile: new dom.window.File(['pdf'], 'form.pdf', { type: 'application/pdf' })
        });
        const dialog = document.querySelector('dialog');
        assert.equal(dialog.querySelector('iframe').src, 'blob:form-preview#page=1');
        const select = dialog.querySelector('select');
        select.value = '2026-04-0644401';
        select.dispatchEvent(new dom.window.Event('change'));
        dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
        assert.deepEqual(await resultPromise, { registrationNumberCorrection: '2026-04-0644401' });
        assert.equal(document.querySelector('dialog'), null);
    } finally {
        globalThis.document = previousDocument;
        URL.createObjectURL = originalCreateObjectUrl;
        URL.revokeObjectURL = originalRevokeObjectUrl;
        dom.window.close();
    }
});

test('phone correction is per-attempt input and can be cancelled before creating an attempt', async () => {
    const dom = new JSDOM('<body></body>', { url: 'https://portal.test/yetkili/' });
    const previousDocument = globalThis.document;
    globalThis.document = dom.window.document;
    try {
        const resultPromise = requestGocnetCorrection({ code: 'TURKISH_MOBILE_REQUIRED', message: 'Telefon gerekli.' });
        const dialog = document.querySelector('dialog');
        dialog.querySelector('input[type="tel"]').value = '+90 532 123 45 67';
        dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
        assert.deepEqual(await resultPromise, { phoneCorrection: '+90 532 123 45 67' });

        const cancelledPromise = requestGocnetCorrection({ code: 'TURKISH_MOBILE_REQUIRED', message: 'Telefon gerekli.' });
        document.querySelector('dialog button[type="button"]').click();
        assert.equal(await cancelledPromise, null);
    } finally {
        globalThis.document = previousDocument;
        dom.window.close();
    }
});
