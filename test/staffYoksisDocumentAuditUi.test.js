import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initializeYoksisDocumentAuditManager } from '../src/managers/yoksisDocumentAuditManager.js';

const markup = `<!doctype html><html><body><section id="audit-root">
  <label><input id="audit-confirm" type="checkbox">YÖKSİS form seçimi değişebilir</label>
  <button id="audit-start" type="button">Taramayı başlat</button>
  <button id="audit-stop" type="button" hidden>Taramayı durdur</button>
  <p id="audit-status" role="status"></p><p id="audit-progress"></p>
  <table><thead><tr><th>Başvuru No</th><th>Ad Soyad</th><th>Öğrenci No</th><th>Telefon</th><th>Durum</th><th>Eksik Evrak</th><th>Sonuç</th></tr></thead><tbody id="audit-results"></tbody></table>
</section></body></html>`;

test('staff audit manager starts only after confirmation and renders YÖKSİS text as plain text', async () => {
    const dom = new JSDOM(markup, { url: 'https://portal.test/yetkili/' });
    const { window } = dom;
    const root = window.document.getElementById('audit-root');
    const requests = [];
    window.postMessage = (data) => {
        queueMicrotask(() => window.dispatchEvent(new window.MessageEvent('message', {
            source: window,
            origin: window.location.origin,
            data
        })));
    };
    initializeYoksisDocumentAuditManager(root);

    window.addEventListener('message', (event) => {
        if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== 'WEB_APP') return;
        const { action, requestId, scanId } = event.data.payload;
        requests.push(action);
        const response = action === 'CHECK_YOKSIS_DOCUMENT_AUDIT'
            ? { ready: true, queueCount: 1, yoksisTabId: 4 }
            : { success: true, scanId };
        window.postMessage({ source: 'EXTENSION', type: 'RESPONSE', action, requestId, response }, window.location.origin);
    });

    root.querySelector('#audit-start').click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    assert.equal(requests.length, 0);

    root.querySelector('#audit-confirm').checked = true;
    root.querySelector('#audit-start').click();
    await new Promise((resolve) => window.setTimeout(resolve, 10));
    assert.deepEqual(requests, ['CHECK_YOKSIS_DOCUMENT_AUDIT', 'START_YOKSIS_DOCUMENT_AUDIT']);

    const scanId = root.dataset.auditScanId;
    window.dispatchEvent(new window.MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: {
            source: 'EXTENSION', type: 'EVENT', action: 'YOKSIS_DOCUMENT_AUDIT_RECORD',
            requestId: root.dataset.auditRequestId, scanId,
            data: {
                type: 'record', index: 1, total: 1,
                entry: { applicationNumber: '2026-00-0000001', studentNumber: '2600000001' },
                result: {
                    status: 'verified',
                    identity: { applicationNumber: '2026-00-0000001', studentNumber: '2600000001', firstName: '<img src=x onerror=alert(1)>', lastName: 'TEST', phone: '5000000000' },
                    applicationStatus: 'Eksik Belge Bekliyor',
                    documents: [{ code: '99', name: '<b>Diğer Belge</b>', required: true, note: 'AKTİF ÖĞRENCİ BELGESİ', uploadStatus: 'Yüklenmedi' }]
                }
            }
        }
    }));

    const row = root.querySelector('#audit-results tr');
    assert.equal(row.querySelector('img, b'), null);
    assert.match(row.textContent, /<img src=x onerror=alert\(1\)>/);
    assert.match(row.textContent, /<b>Diğer Belge<\/b>/);
    window.close();
});

test('staff audit manager classifies completed, pending, and missing-document statuses separately', async () => {
    const dom = new JSDOM(markup, { url: 'https://portal.test/yetkili/' });
    const { window } = dom;
    const root = window.document.getElementById('audit-root');
    window.postMessage = (data) => {
        queueMicrotask(() => window.dispatchEvent(new window.MessageEvent('message', {
            source: window,
            origin: window.location.origin,
            data: { source: 'EXTENSION', type: 'RESPONSE', action: data.payload.action,
                requestId: data.payload.requestId,
                response: data.payload.action === 'CHECK_YOKSIS_DOCUMENT_AUDIT'
                    ? { ready: true, queueCount: 4, yoksisTabId: 4 }
                    : { success: true, yoksisTabId: 4 } }
        })));
    };
    initializeYoksisDocumentAuditManager(root);
    root.querySelector('#audit-confirm').checked = true;
    root.querySelector('#audit-start').click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const scanId = root.dataset.auditScanId;

    const statusLabels = ['İşlem Tamamlandı', 'İşlem Bekliyor', 'Eksik Belge Bekliyor', 'Başka Durum'];
    for (const [index, applicationStatus] of statusLabels.entries()) {
        window.dispatchEvent(new window.MessageEvent('message', {
            source: window,
            origin: window.location.origin,
            data: {
                source: 'EXTENSION',
                type: 'EVENT',
                action: 'YOKSIS_DOCUMENT_AUDIT_RECORD',
                scanId,
                requestId: root.dataset.auditRequestId,
                data: {
                    entry: { applicationNumber: `2026-00-000000${index + 1}`, studentNumber: `260000000${index + 1}` },
                    result: {
                        status: 'verified',
                        identity: { firstName: 'TEST', lastName: 'KAYIT', phone: '5000000000' },
                        applicationStatus,
                        documents: []
                    }
                }
            }
        }));
    }

    assert.deepEqual(
        Array.from(root.querySelectorAll('#audit-results tr'), (row) => row.cells[6]?.textContent),
        ['Başarılı', 'Beklemede', 'Başarısız', 'Sınıflandırılamadı']
    );
    assert.deepEqual(
        Array.from(root.querySelectorAll('#audit-results tr'), (row) => row.dataset.auditClassification),
        ['success', 'pending', 'failure', 'unclassified']
    );
    window.close();
});

test('staff audit manager surfaces a correlated extension bridge failure immediately', async () => {
    const dom = new JSDOM(markup, { url: 'https://portal.test/yetkili/' });
    const { window } = dom;
    const root = window.document.getElementById('audit-root');
    window.postMessage = (data) => {
        queueMicrotask(() => window.dispatchEvent(new window.MessageEvent('message', {
            source: window,
            origin: window.location.origin,
            data
        })));
    };
    initializeYoksisDocumentAuditManager(root);

    window.addEventListener('message', (event) => {
        if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== 'WEB_APP') return;
        const { requestId } = event.data.payload;
        window.postMessage({
            source: 'EXTENSION',
            type: 'EVENT',
            action: 'REQUEST_FAILED',
            requestId,
            code: 'EXTENSION_CONTEXT_INVALIDATED',
            error: 'Eklenti güncellendi veya yeniden yüklendi. Bu sayfayı yenileyin ve tekrar deneyin.'
        }, window.location.origin);
    });

    root.querySelector('#audit-confirm').checked = true;
    root.querySelector('#audit-start').click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    assert.equal(root.querySelector('#audit-status').textContent,
        'Eklenti güncellendi veya yeniden yüklendi. Bu sayfayı yenileyin ve tekrar deneyin.');
    assert.equal(root.querySelector('#audit-start').disabled, false);
    window.close();
});
