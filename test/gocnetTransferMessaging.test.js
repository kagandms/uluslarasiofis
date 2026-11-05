import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';

const controllerSource = new vm.Script(readFileSync(new URL('../ykn_eklenti-main/gocnet-transfer-controller.js', import.meta.url), 'utf8'));
const queryFixture = readFileSync(new URL('./fixtures/gocnet-transfer/query-form.html', import.meta.url), 'utf8');

function createHarness({ auditBusy = false } = {}) {
    const dom = new JSDOM(queryFixture, { url: 'https://yoksis.yok.gov.tr/menu/menu.zul', runScripts: 'outside-only' });
    const listeners = [];
    dom.window.chrome = { runtime: { id: 'test-extension', onMessage: { addListener(listener) { listeners.push(listener); } } } };
    if (auditBusy) dom.window.YoksisDocumentAuditController = { isActive: () => true };
    controllerSource.runInContext(dom.getInternalVMContext());
    return { dom, listener: listeners[0] };
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
    assert.equal(harness.dom.window.document.querySelector('input').value, '');
    harness.dom.window.close();
});
