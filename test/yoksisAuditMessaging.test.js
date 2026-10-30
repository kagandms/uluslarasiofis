import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const readerScript = new vm.Script(readFileSync(new URL('../ykn_eklenti-main/yoksis-document-audit.js', import.meta.url), 'utf8'));
const controllerScript = new vm.Script(readFileSync(new URL('../ykn_eklenti-main/yoksis-document-audit-controller.js', import.meta.url), 'utf8'));

function createHarness() {
    const markup = readFileSync(new URL('./fixtures/yoksis-document-audit/list.html', import.meta.url), 'utf8');
    const dom = new JSDOM(markup, { url: 'https://yoksis.yok.gov.tr/menu/menu.zul', runScripts: 'outside-only' });
    const listeners = [];
    dom.window.chrome = { runtime: { id: 'test-extension', onMessage: { addListener(listener) { listeners.push(listener); } } } };
    const container = dom.window.document.querySelector('.table-scroll');
    Object.defineProperties(container, { clientHeight: { value: 80 }, scrollHeight: { value: 80 } });
    dom.window.document.querySelector('tbody tr:nth-child(3)').remove();
    const context = dom.getInternalVMContext();
    readerScript.runInContext(context);
    controllerScript.runInContext(context);
    return { dom, context, listeners };
}

test('audit recovery can reinject classic scripts without redeclaration or duplicate listeners', () => {
    const harness = createHarness();
    try {
        readerScript.runInContext(harness.context);
        controllerScript.runInContext(harness.context);
        assert.equal(harness.listeners.length, 1);
        assert.equal(harness.dom.window.YoksisDocumentAudit.collectYoksisAuditQueue(harness.dom.window.document).entries.length, 2);
    } finally { harness.dom.window.close(); }
});

test('audit readiness answers the extension service worker without sender.frameId', async () => {
    const harness = createHarness();
    try {
        let response;
        const asynchronous = harness.listeners[0]({ action: 'YOKSIS_DOCUMENT_AUDIT_CHECK', scanId: 'scan-test' },
            { id: 'test-extension', url: 'chrome-extension://test-extension/background.js' }, (value) => { response = value; });
        assert.equal(asynchronous, true);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(response.ready, true);
        assert.equal(response.queueCount, 2);
    } finally { harness.dom.window.close(); }
});

test('audit messages reject foreign extensions, tab senders and invalid scan IDs', () => {
    const harness = createHarness();
    try {
        for (const [sender, scanId] of [
            [{ id: 'foreign-extension' }, 'scan-test'],
            [{ id: 'test-extension', tab: { id: 1 }, frameId: 0 }, 'scan-test'],
            [{ id: 'test-extension' }, '']
        ]) {
            let answered = false;
            assert.equal(harness.listeners[0]({ action: 'YOKSIS_DOCUMENT_AUDIT_CHECK', scanId }, sender,
                () => { answered = true; }), false);
            assert.equal(answered, false);
        }
    } finally { harness.dom.window.close(); }
});
