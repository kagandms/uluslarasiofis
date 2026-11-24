import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { openTebligatDialog } from '../src/ui/tebligatDialog.js';
import { requestExtensionAction } from '../src/staff/extension-request.js';

function createDialogDom(context) {
    const dom = new JSDOM(
        '<!doctype html><html><body><button type="button" id="opener">Aç</button></body></html>',
        { url: 'https://portal.test/yetkili/' }
    );
    context.after(() => {
        dom.window.close();
    });
    return dom;
}

async function waitUntil(predicate, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() > deadline) {
            throw new Error('Timed out waiting for condition.');
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

function attachExtensionResponder(dom, handler) {
    const postedMessages = [];
    const listener = (event) => {
        if (event.data?.source !== 'WEB_APP') return;
        postedMessages.push(event.data);
        const { action, requestId } = event.data.payload || {};
        const sendReply = (response, overrides = {}) => {
            dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
                data: {
                    source: 'EXTENSION',
                    type: 'RESPONSE',
                    action,
                    requestId,
                    response,
                    ...overrides
                },
                origin: dom.window.location.origin,
                source: dom.window
            }));
        };
        handler(event.data, sendReply);
    };
    dom.window.addEventListener('message', listener);
    return {
        postedMessages,
        detach: () => dom.window.removeEventListener('message', listener)
    };
}

test('openTebligatDialog renders YÖKSİS lookup button and two numeric YÖKSİS fields without YÖKSİS ID', (context) => {
    const dom = createDialogDom(context);
    const document = dom.window.document;
    const dialog = openTebligatDialog(document, {
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        passportNumber: 'P123',
        birthDate: '2002-04-15'
    });

    const lookupButton = dialog.querySelector('[data-action="lookup-yoksis"]');
    assert.ok(lookupButton);
    assert.equal(lookupButton.type, 'button');
    assert.equal(lookupButton.className, 'btn btn-outline');
    assert.equal(lookupButton.textContent, "YÖKSİS'ten oku");

    const basvuruInput = dialog.querySelector('[name="basvuru_kayit_no"]');
    const islemInput = dialog.querySelector('[name="islem_kayit_no"]');
    assert.ok(basvuruInput);
    assert.ok(islemInput);
    assert.equal(basvuruInput.required, true);
    assert.equal(islemInput.required, false);
    assert.equal(basvuruInput.getAttribute('inputmode'), 'numeric');
    assert.equal(islemInput.getAttribute('inputmode'), 'numeric');
    assert.equal(basvuruInput.dir, 'ltr');
    assert.equal(islemInput.dir, 'ltr');

    assert.equal(dialog.querySelector('[name="yoksis_id"]'), null);
    assert.equal(dialog.textContent.includes('YÖKSİS ID'), false);
    const labelTexts = [...dialog.querySelectorAll('label')].map((label) => label.textContent);
    assert.ok(labelTexts.includes('YÖKSİS Başvuru Kayıt No'));
    assert.ok(labelTexts.includes('YÖKSİS İşlem Kayıt No'));
});

test('YÖKSİS lookup validates E-İKAMET format before posting and does not call postMessage when invalid', async (context) => {
    const dom = createDialogDom(context);
    const document = dom.window.document;
    const { postedMessages } = attachExtensionResponder(dom, () => {});
    const dialog = openTebligatDialog(document, {});

    const eIkametInput = dialog.querySelector('[name="e_ikamet_no"]');
    const lookupButton = dialog.querySelector('[data-action="lookup-yoksis"]');
    const alert = dialog.querySelector('[role="alert"]');

    for (const invalidValue of ['', 'ABC-123', '2026-51-123', '2026-51-123456', '2026-51-12345678', '1999-51-1234567']) {
        eIkametInput.value = invalidValue;
        lookupButton.click();
        assert.equal(alert.hidden, false);
        assert.equal(alert.textContent, 'E-İKAMET başvuru numarasını 2026-00-0000000 biçiminde girin.');
        assert.equal(lookupButton.disabled, false);
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(postedMessages.length, 0);
});

test('YÖKSİS lookup disables button while pending, fills both fields on found, and clears İşlem when omitted', async (context) => {
    const dom = createDialogDom(context);
    const document = dom.window.document;
    let nextReply = null;
    const { postedMessages } = attachExtensionResponder(dom, (_data, sendReply) => {
        nextReply = sendReply;
    });
    const dialog = openTebligatDialog(document, {});

    const eIkametInput = dialog.querySelector('[name="e_ikamet_no"]');
    const lookupButton = dialog.querySelector('[data-action="lookup-yoksis"]');
    const basvuruInput = dialog.querySelector('[name="basvuru_kayit_no"]');
    const islemInput = dialog.querySelector('[name="islem_kayit_no"]');
    const status = dialog.querySelector('.tebligat-yoksis-status');

    eIkametInput.value = '2026-51-1211318';
    basvuruInput.value = '999';
    islemInput.value = '888';
    lookupButton.click();

    assert.equal(lookupButton.disabled, true);
    assert.equal(status.getAttribute('role'), 'status');
    assert.equal(status.getAttribute('aria-live'), 'polite');
    assert.equal(status.hidden, false);
    assert.equal(status.textContent, "YÖKSİS'te aranıyor…");

    await waitUntil(() => nextReply !== null);
    assert.equal(postedMessages.length, 1);
    assert.equal(postedMessages[0].payload.action, 'LOOKUP_GOCNET_RECORD');
    assert.equal(postedMessages[0].payload.applicationNumber, '2026-51-1211318');
    assert.deepEqual(Object.keys(postedMessages[0].payload).sort(), ['action', 'applicationNumber', 'requestId']);

    const replyFirst = nextReply;
    nextReply = null;
    replyFirst({
        success: true,
        requestId: postedMessages[0].payload.requestId,
        state: 'found',
        basvuruKayitNo: '1234567890',
        islemKayitNo: '987654321'
    });

    await waitUntil(() => !lookupButton.disabled);
    assert.equal(basvuruInput.value, '1234567890');
    assert.equal(islemInput.value, '987654321');
    assert.equal(status.textContent, "YÖKSİS'ten okundu. Lütfen kontrol edin.");

    // Found without islemKayitNo clears existing İşlem value and reports process not started.
    lookupButton.click();
    assert.equal(lookupButton.disabled, true);
    await waitUntil(() => nextReply !== null);
    const replySecond = nextReply;
    nextReply = null;
    replySecond({
        success: true,
        requestId: postedMessages[1].payload.requestId,
        state: 'found',
        basvuruKayitNo: '222333444'
    });

    await waitUntil(() => !lookupButton.disabled);
    assert.equal(basvuruInput.value, '222333444');
    assert.equal(islemInput.value, '');
    assert.equal(status.textContent, "Başvuru Kayıt No okundu; YÖKSİS'te işlem henüz başlatılmamış.");
});

test('YÖKSİS lookup shows no_match and unknown messages and ignores late response after dialog close', async (context) => {
    const dom = createDialogDom(context);
    const document = dom.window.document;
    let mode = 'no_match';
    let deferredReply = null;
    attachExtensionResponder(dom, (_data, sendReply) => {
        if (mode === 'no_match') {
            sendReply({ success: true, state: 'no_match' });
        } else if (mode === 'unknown') {
            sendReply({ success: false, state: 'unknown' });
        } else {
            deferredReply = sendReply;
        }
    });

    const dialog = openTebligatDialog(document, {});
    const eIkametInput = dialog.querySelector('[name="e_ikamet_no"]');
    const lookupButton = dialog.querySelector('[data-action="lookup-yoksis"]');
    const basvuruInput = dialog.querySelector('[name="basvuru_kayit_no"]');
    const islemInput = dialog.querySelector('[name="islem_kayit_no"]');
    const status = dialog.querySelector('.tebligat-yoksis-status');

    eIkametInput.value = '2026-51-1211318';
    lookupButton.click();
    await waitUntil(() => !lookupButton.disabled);
    assert.equal(status.textContent, "YÖKSİS'te bu numarayla başvuru bulunamadı.");

    mode = 'unknown';
    lookupButton.click();
    await waitUntil(() => !lookupButton.disabled);
    assert.equal(
        status.textContent,
        "YÖKSİS'ten okunamadı. YÖKSİS sekmesinin açık ve girişli olduğunu kontrol edin; numaraları elle yazabilirsiniz."
    );

    mode = 'deferred';
    lookupButton.click();
    await waitUntil(() => deferredReply !== null);
    dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(dialog.isConnected, false);

    deferredReply({
        success: true,
        state: 'found',
        basvuruKayitNo: '555666777',
        islemKayitNo: '888999000'
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(basvuruInput.value, '');
    assert.equal(islemInput.value, '');
    assert.equal(status.textContent, "YÖKSİS'te aranıyor…");
    assert.equal(lookupButton.disabled, true);
});

test('tebligatDialog validates Başvuru Kayıt No and İşlem Kayıt No on submit and allows optional blank İşlem', async (context) => {
    const dom = createDialogDom(context);
    const document = dom.window.document;
    const dialog = openTebligatDialog(document, {
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        passportNumber: 'P123',
        birthDate: '2002-04-15',
        migrationGoDate: '2026-11-24'
    });

    const form = dialog.querySelector('form');
    const eIkametInput = dialog.querySelector('[name="e_ikamet_no"]');
    const basvuruInput = dialog.querySelector('[name="basvuru_kayit_no"]');
    const islemInput = dialog.querySelector('[name="islem_kayit_no"]');
    const submitButton = dialog.querySelector('[data-action="submit-tebligat"]');
    const alert = dialog.querySelector('[role="alert"]');

    eIkametInput.value = '2026-51-1211318';
    basvuruInput.value = '';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(dialog.isConnected, true);
    assert.equal(alert.hidden, false);
    assert.equal(alert.textContent, 'YÖKSİS Başvuru Kayıt No bilgisini girin (yalnızca rakam).');

    basvuruInput.value = '1234567890';
    islemInput.value = '12-AB';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(dialog.isConnected, true);
    assert.equal(alert.hidden, false);
    assert.equal(alert.textContent, 'YÖKSİS İşlem Kayıt No yalnızca rakam içerebilir.');

    // Blank optional İşlem Kayıt No passes form validation and enters PDF preparation.
    islemInput.value = '';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(alert.hidden, true);
    assert.equal(submitButton.disabled, true);
    assert.equal(submitButton.textContent, 'PDF hazırlanıyor…');
    await waitUntil(() => !submitButton.disabled);
});

test('E-İKAMET input enforces numeric mask attributes, formats input/paste, formats auto-read, and blocks invalid short submit', async (context) => {
    const dom = createDialogDom(context);
    const document = dom.window.document;
    const dialog = openTebligatDialog(document, {
        firstName: 'Ayşe',
        lastName: 'Yılmaz',
        passportNumber: 'P123',
        birthDate: '2002-04-15',
        migrationGoDate: '2026-11-24'
    }, null, {
        readEIkametNo: async () => '2026511211318'
    });

    const form = dialog.querySelector('form');
    const label = dialog.querySelector('label[for="tebligat-eikamet-no"]');
    const eIkametInput = dialog.querySelector('[name="e_ikamet_no"]');
    const basvuruInput = dialog.querySelector('[name="basvuru_kayit_no"]');
    const submitButton = dialog.querySelector('[data-action="submit-tebligat"]');
    const alert = dialog.querySelector('[role="alert"]');

    assert.equal(label.textContent, 'E-İKAMET başvuru no');
    assert.equal(eIkametInput.getAttribute('inputmode'), 'numeric');
    assert.equal(eIkametInput.maxLength, 15);
    assert.equal(eIkametInput.placeholder, '2026-00-0000000');

    // Programmatic auto-read value is formatted through the helper.
    await waitUntil(() => eIkametInput.value === '2026-51-1211318');

    // Typing progression via input events keeps caret at the end.
    eIkametInput.value = '20265';
    eIkametInput.setSelectionRange(5, 5);
    eIkametInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(eIkametInput.value, '2026-5');
    assert.equal(eIkametInput.selectionStart, 6);

    eIkametInput.value = '2026-511';
    eIkametInput.setSelectionRange(8, 8);
    eIkametInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(eIkametInput.value, '2026-51-1');
    assert.equal(eIkametInput.selectionStart, 9);

    // Mid-string insertion preserves caret after inserted digit.
    eIkametInput.value = '2026-51-1211318';
    eIkametInput.setSelectionRange(2, 2);
    eIkametInput.value = '20926-51-1211318';
    eIkametInput.setSelectionRange(3, 3);
    eIkametInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(eIkametInput.value, '2092-65-1121131');
    assert.equal(eIkametInput.selectionStart, 3);

    // Pasting formatted or spaced digits yields canonical ####-##-#######.
    for (const pasted of ['2026-51-1211318', '202651 1211318']) {
        eIkametInput.value = pasted;
        eIkametInput.setSelectionRange(pasted.length, pasted.length);
        eIkametInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        assert.equal(eIkametInput.value, '2026-51-1211318');
        assert.equal(eIkametInput.selectionStart, 15);
    }

    // Invalid short or malformed E-İKAMET numbers block submit with inline error.
    basvuruInput.value = '1234567890';
    for (const invalidSubmitValue of ['2026-51-123456', '2026-51-123', '1999-51-1234567']) {
        eIkametInput.value = invalidSubmitValue;
        form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
        assert.equal(dialog.isConnected, true);
        assert.equal(submitButton.disabled, false);
        assert.equal(alert.hidden, false);
        assert.equal(alert.textContent, 'E-İKAMET başvuru numarasını 2026-00-0000000 biçiminde girin.');
    }
});

test('requestExtensionAction handles REQUEST_FAILED and timeout cleanly', async (context) => {
    const dom = createDialogDom(context);
    const { detach } = attachExtensionResponder(dom, (data) => {
        dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
            data: {
                source: 'EXTENSION',
                action: 'REQUEST_FAILED',
                requestId: data.payload.requestId
            },
            origin: dom.window.location.origin,
            source: dom.window
        }));
    });

    const failedResult = await requestExtensionAction(
        dom.window,
        'LOOKUP_GOCNET_RECORD',
        { applicationNumber: '2026-51-1211318' },
        500
    );
    assert.deepEqual(failedResult, { state: 'unknown' });
    detach();

    const timedOutResult = await requestExtensionAction(
        dom.window,
        'LOOKUP_GOCNET_RECORD',
        { applicationNumber: '2026-51-1211318' },
        15
    );
    assert.deepEqual(timedOutResult, { state: 'unknown' });
});
