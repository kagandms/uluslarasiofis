import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';

const controllerSource = new vm.Script(readFileSync(new URL('../ykn_eklenti-main/gocnet-transfer-controller.js', import.meta.url), 'utf8'));
const queryFixture = readFileSync(new URL('./fixtures/gocnet-transfer/query-form.html', import.meta.url), 'utf8');

function createHarness({ auditBusy = false, sendMessage } = {}) {
    const dom = new JSDOM(queryFixture, { url: 'https://yoksis.yok.gov.tr/menu/menu.zul', runScripts: 'outside-only' });
    const listeners = [];
    dom.window.chrome = {
        runtime: {
            id: 'test-extension',
            onMessage: { addListener(listener) { listeners.push(listener); } },
            ...(sendMessage ? { sendMessage } : {})
        }
    };
    if (auditBusy) dom.window.YoksisDocumentAuditController = { isActive: () => true };
    controllerSource.runInContext(dom.getInternalVMContext());
    return { dom, listener: listeners[0] };
}

function sendQueryMessage(listener, message) {
    return new Promise((resolve) => {
        let responded = false;
        let response;
        let hasReturned = false;
        let keepOpen = false;
        keepOpen = listener(message, { id: 'test-extension' }, (value) => {
            responded = true;
            response = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
            if (hasReturned) resolve({ keepOpen, response });
        });
        hasReturned = true;
        if (responded || !keepOpen) resolve({ keepOpen, response });
    });
}

test('YÖKSİS message handler returns only an explicit no-match result', async () => {
    const { dom, listener } = createHarness();
    dom.window.document.querySelector('button').addEventListener('click', () => {
        dom.window.document.body.insertAdjacentHTML('beforeend', '<div role="dialog"><h2>Sorgu Hatası</h2><p>Başvuru sorgulama başarısız!</p><p>Hata Kodu: Veri Bulunamadı</p><p>Detay: Kayıt bulunamadı</p></div>');
    });
    let response;
    const keepsChannelOpen = listener({ action: 'YOKSIS_GOCNET_QUERY', requestId: 'request-1', portalTabId: 4,
        attemptId: '3e2c0615-f60a-4f11-bb87-eccbfce1c5aa', applicationNumber: '2099-12-99999999' },
    { id: 'test-extension' }, (value) => { response = value; });
    assert.equal(keepsChannelOpen, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(response?.requestId, 'request-1');
    assert.equal(response?.state, 'no_match');
    dom.window.close();
});

test('acknowledges only the exact active-learning success dialog and keeps transfer state', async () => {
    const { dom, listener } = createHarness();
    let acknowledged = 0;
    dom.window.document.querySelector('button').addEventListener('click', () => {
        dom.window.document.body.insertAdjacentHTML('beforeend', `<div role="dialog"><h2>Sorgulama Başarılı (YÖKSİS Verileri Dolduruldu)</h2>
            <p>Başvuru sorgulama başarılı.</p><p>YÖKSİS veritabanından öğrencinin aktif öğrenim bilgileri bulundu ve form otomatik dolduruldu.</p>
            <button>Tamam</button></div>`);
        dom.window.document.querySelector('[role="dialog"] button').addEventListener('click', () => {
            acknowledged += 1;
            dom.window.document.querySelector('[role="dialog"]').remove();
        });
    });
    let response;
    const keepOpen = listener({ action: 'YOKSIS_GOCNET_QUERY', phase: 'form', requestId: 'request-2', portalTabId: 4,
        attemptId: '3e2c0615-f60a-4f11-bb87-eccbfce1c5aa', applicationNumber: '2099-12-99999999' },
    { id: 'test-extension' }, (value) => { response = value; });
    assert.equal(keepOpen, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(response?.state, 'student_data_filled');
    assert.equal(acknowledged, 1);
    assert.equal(dom.window.document.querySelector('[role="dialog"]'), null);
    dom.window.close();
});

test('YÖKSİS query handler rejects foreign senders, malformed messages, and concurrent audit work', () => {
    const harness = createHarness({ auditBusy: true });
    let answered = false;
    const request = { action: 'YOKSIS_GOCNET_QUERY', requestId: 'request-1', portalTabId: 4,
        applicationNumber: '2099-12-99999999' };
    assert.equal(harness.listener(request, { id: 'foreign-extension' }, () => { answered = true; }), false);
    assert.equal(harness.listener({ ...request, applicationNumber: 'invalid' }, { id: 'test-extension' }, () => { answered = true; }), false);
    let response;
    assert.equal(harness.listener(request, { id: 'test-extension' }, (value) => { response = value; }), false);
    assert.equal(answered, false);
    assert.equal(response?.state, 'unknown');
    assert.equal(response?.reason, 'document_audit_active');
    assert.equal(harness.dom.window.document.querySelector('input').value, '');
    harness.dom.window.close();
});

test('YÖKSİS query handler returns controller_busy reason while another query is running', async () => {
    let releaseFirst;
    const pendingCommand = new Promise((resolve) => { releaseFirst = resolve; });
    const { dom, listener } = createHarness({ sendMessage: async () => pendingCommand });
    const firstPromise = sendQueryMessage(listener, {
        action: 'YOKSIS_GOCNET_QUERY', phase: 'form', requestId: 'busy-1', portalTabId: 4,
        attemptId: '3e2c0615-f60a-4f11-bb87-eccbfce1c5aa', applicationNumber: '2099-12-99999999'
    });
    const busyResult = await sendQueryMessage(listener, {
        action: 'YOKSIS_GOCNET_QUERY', phase: 'form', requestId: 'busy-2', portalTabId: 4,
        attemptId: '3e2c0615-f60a-4f11-bb87-eccbfce1c5aa', applicationNumber: '2099-12-99999999'
    });
    assert.equal(busyResult.keepOpen, false);
    assert.deepEqual(busyResult.response, { requestId: 'busy-2', state: 'unknown', reason: 'controller_busy' });
    releaseFirst({ success: false, error: 'form_controls_missing (inputs: 0, buttons: 0)' });
    const firstResult = await firstPromise;
    assert.equal(firstResult.response?.state, 'unknown');
    assert.equal(firstResult.response?.reason, 'form_controls_missing (inputs: 0, buttons: 0)');
    dom.window.close();
});

test('YÖKSİS query handler never leaks a stale history reason into a subsequent form answer', async () => {
    let nextFormResponse = { success: true, freshResponse: true };
    const { dom, listener } = createHarness({
        sendMessage: async (message) => {
            if (message?.command?.action === 'queryGocnetRecords') {
                return { success: false, error: 'history_section_missing (belge: 1)' };
            }
            if (message?.command?.action === 'queryGocnetForm') {
                if (nextFormResponse.insertDialog) {
                    dom.window.document.querySelector('input').value = message.command.applicationNumber;
                    dom.window.document.body.insertAdjacentHTML('beforeend', nextFormResponse.insertDialog);
                }
                return nextFormResponse.result;
            }
            return { success: false };
        }
    });

    const historyResult = await sendQueryMessage(listener, {
        action: 'YOKSIS_GOCNET_QUERY', phase: 'history', requestId: 'hist-1', portalTabId: 4,
        attemptId: '3e2c0615-f60a-4f11-bb87-eccbfce1c5aa', applicationNumber: '2099-12-99999999'
    });
    assert.deepEqual(historyResult.response, {
        requestId: 'hist-1', state: 'unknown', reason: 'history_section_missing (belge: 1)'
    });

    nextFormResponse = {
        result: { success: true, freshResponse: true },
        insertDialog: '<div role="dialog"><h2>Sorgu Hatası</h2><p>Başvuru sorgulama başarısız!</p><p>Hata Kodu: Veri Bulunamadı</p><p>Detay: Kayıt bulunamadı</p></div>'
    };
    const noMatchResult = await sendQueryMessage(listener, {
        action: 'YOKSIS_GOCNET_QUERY', phase: 'form', requestId: 'form-no-match', portalTabId: 4,
        attemptId: '3e2c0615-f60a-4f11-bb87-eccbfce1c5aa', applicationNumber: '2099-12-99999999'
    });
    assert.deepEqual(noMatchResult.response, { requestId: 'form-no-match', state: 'no_match' });

    dom.window.document.querySelector('[role="dialog"]').remove();
    nextFormResponse = { result: { success: true, freshResponse: false } };
    const staleFormResult = await sendQueryMessage(listener, {
        action: 'YOKSIS_GOCNET_QUERY', phase: 'form', requestId: 'form-stale', portalTabId: 4,
        attemptId: '3e2c0615-f60a-4f11-bb87-eccbfce1c5aa', applicationNumber: '2099-12-99999999'
    });
    assert.deepEqual(staleFormResult.response, {
        requestId: 'form-stale', state: 'unknown', reason: 'form_command_stale'
    });

    nextFormResponse = {
        result: { success: true, freshResponse: true },
        insertDialog: `<div role="dialog"><h2>Sorgulama Başarılı (YÖKSİS Verileri Dolduruldu)</h2>
            <p>Başvuru sorgulama başarılı.</p><p>YÖKSİS veritabanından öğrencinin aktif öğrenim bilgileri bulundu ve form otomatik dolduruldu.</p></div>`
    };
    const ackFailedResult = await sendQueryMessage(listener, {
        action: 'YOKSIS_GOCNET_QUERY', phase: 'form', requestId: 'form-ack-fail', portalTabId: 4,
        attemptId: '3e2c0615-f60a-4f11-bb87-eccbfce1c5aa', applicationNumber: '2099-12-99999999'
    });
    assert.deepEqual(ackFailedResult.response, {
        requestId: 'form-ack-fail', state: 'unknown', reason: 'form_ack_failed'
    });
    dom.window.close();
});

test('YÖKSİS form query uses 55 s waiter timeout, settles recognized dialog after form_click_no_response, and reports form_value_no_response', async () => {
    const waitTimeouts = [];
    const timers = [];
    let acknowledged = 0;
    const { dom, listener } = createHarness({
        sendMessage: async (message) => {
            if (message?.command?.requestId === 'form-click-late-ok') {
                dom.window.document.querySelector('input').value = message.command.applicationNumber;
                timers.push(setTimeout(() => {
                    dom.window.document.body.insertAdjacentHTML('beforeend', `<div role="dialog">
                        <h2>Sorgulama Başarılı (YÖKSİS Verileri Dolduruldu)</h2>
                        <p>Başvuru sorgulama başarılı.</p>
                        <p>YÖKSİS veritabanından öğrencinin aktif öğrenim bilgileri bulundu ve form otomatik dolduruldu.</p>
                        <button>Tamam</button></div>`);
                    dom.window.document.querySelector('[role="dialog"] button').addEventListener('click', () => {
                        acknowledged += 1;
                        dom.window.document.querySelector('[role="dialog"]').remove();
                    });
                }, 15));
                return { success: false, error: 'form_click_no_response' };
            }
            return { success: false, error: 'form_value_no_response' };
        }
    });
    const originalSetTimeout = dom.window.setTimeout.bind(dom.window);
    dom.window.setTimeout = (fn, delay, ...args) => {
        waitTimeouts.push(delay);
        return originalSetTimeout(fn, delay, ...args);
    };
    try {
        const lateDialogResult = await sendQueryMessage(listener, {
            action: 'YOKSIS_GOCNET_QUERY', phase: 'form', requestId: 'form-click-late-ok', portalTabId: 4,
            attemptId: '3e2c0615-f60a-4f11-bb87-eccbfce1c5aa', applicationNumber: '2099-12-99999999'
        });
        assert.equal(waitTimeouts.includes(55_000), true);
        assert.deepEqual(lateDialogResult.response, { requestId: 'form-click-late-ok', state: 'student_data_filled' });
        assert.equal(acknowledged, 1);

        const valueTimeoutResult = await sendQueryMessage(listener, {
            action: 'YOKSIS_GOCNET_QUERY', phase: 'form', requestId: 'form-val-fail', portalTabId: 4,
            attemptId: '3e2c0615-f60a-4f11-bb87-eccbfce1c5aa', applicationNumber: '2099-12-99999999'
        });
        assert.deepEqual(valueTimeoutResult.response, {
            requestId: 'form-val-fail', state: 'unknown', reason: 'form_value_no_response'
        });
    } finally {
        for (const timer of timers) clearTimeout(timer);
        dom.window.close();
    }
});
