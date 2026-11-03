import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { initializeYoksisDocumentAuditManager } from '../src/managers/yoksisDocumentAuditManager.js';

const markup = `<!doctype html><html><body><section id="audit-root">
  <label><input id="audit-confirm" type="checkbox">YÖKSİS form seçimi değişebilir</label>
  <button id="audit-start" type="button">Taramayı başlat</button>
  <button id="audit-stop" type="button" hidden>Taramayı durdur</button>
  <p id="audit-status" role="status"></p><p id="audit-progress"></p>
  <label for="audit-search">Ad, öğrenci no veya pasaport no</label><input id="audit-search" type="search">
  <button id="audit-search-submit" type="button">Ara</button>
  <label for="audit-filter">Durum</label><select id="audit-filter"><option value="all">Tümü</option><option value="successful">Başarılı</option><option value="pending">Beklemede</option><option value="rejected">Reddedilen</option><option value="missing_documents">Eksik evrak</option><option value="unreadable">Okunamayan</option><option value="other">Diğer</option></select>
  <button id="audit-refresh" type="button">Ortak kayıtları yenile</button>
  <p id="audit-shared-count"></p><button id="audit-page-previous" type="button">Önceki</button><span id="audit-page"></span><button id="audit-page-next" type="button">Sonraki</button>
  <table><thead><tr><th>Başvuru No</th><th>Ad Soyad</th><th>Öğrenci No</th><th>Pasaport No</th><th>Telefon</th><th>Durum</th><th>Eksik Evrak</th><th>Sonuç</th></tr></thead><tbody id="audit-results"></tbody></table>
</section></body></html>`;

test('staff audit manager starts only after confirmation and renders YÖKSİS text as plain text', async () => {
    const dom = new JSDOM(markup, { url: 'https://portal.test/yetkili/' });
    const { window } = dom;
    const root = window.document.getElementById('audit-root');
    const requests = [];
    const savedRecords = [];
    window.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        if (url.endsWith('/records')) savedRecords.push(...body.records);
        return { ok: true, status: 200, json: async () => ({ total: 0, records: [] }) };
    };
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
        const response = { success: true, scanId, yoksisTabId: 4 };
        window.postMessage({ source: 'EXTENSION', type: 'RESPONSE', action, requestId, response }, window.location.origin);
    });

    root.querySelector('#audit-start').click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    assert.equal(requests.length, 0);

    root.querySelector('#audit-confirm').checked = true;
    root.querySelector('#audit-start').click();
    await new Promise((resolve) => window.setTimeout(resolve, 10));
    assert.deepEqual(requests, ['START_YOKSIS_DOCUMENT_AUDIT']);

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
                    identity: { applicationNumber: '2026-00-0000001', studentNumber: '2600000001', firstName: '<img src=x onerror=alert(1)>', lastName: 'TEST', passportNumber: 'U12345678', phone: '5000000000' },
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
    window.dispatchEvent(new window.MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: {
            source: 'EXTENSION', type: 'EVENT', action: 'YOKSIS_DOCUMENT_AUDIT_COMPLETE',
            requestId: root.dataset.auditRequestId, scanId,
            data: { status: 'complete', completed: 1, remaining: 0 }
        }
    }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    assert.equal(savedRecords.length, 1);
    assert.equal(savedRecords[0].result.identity.passportNumber, 'U12345678');
    window.close();
});

test('incomplete scans say that only their read results were saved', async () => {
    const dom = new JSDOM(markup, { url: 'https://portal.test/yetkili/' });
    const { window } = dom;
    const root = window.document.getElementById('audit-root');
    window.fetch = async (url) => ({
        ok: true,
        status: 200,
        json: async () => url.endsWith('/records') ? { storedCount: 1 } : { total: 0, records: [] }
    });
    window.postMessage = (message) => queueMicrotask(() => window.dispatchEvent(new window.MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: { source: 'EXTENSION', type: 'RESPONSE', requestId: message.payload.requestId,
            response: { success: true, yoksisTabId: 4 } }
    })));
    initializeYoksisDocumentAuditManager(root);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    root.querySelector('#audit-confirm').checked = true;
    root.querySelector('#audit-start').click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    const sendEvent = (action, data) => window.dispatchEvent(new window.MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: {
            source: 'EXTENSION', type: 'EVENT', action,
            requestId: root.dataset.auditRequestId,
            scanId: root.dataset.auditScanId,
            data
        }
    }));
    sendEvent('YOKSIS_DOCUMENT_AUDIT_RECORD', {
        type: 'record', index: 1, total: 1,
        entry: { applicationNumber: '2026-00-0000001', studentNumber: '2600000001' },
        result: {
            status: 'verified',
            identity: {
                applicationNumber: '2026-00-0000001', studentNumber: '2600000001',
                firstName: 'TEST', lastName: 'STUDENT', phone: '5000000000'
            },
            applicationStatus: 'İşlem Bekliyor',
            documents: []
        }
    });
    sendEvent('YOKSIS_DOCUMENT_AUDIT_COMPLETE', { status: 'incomplete', completed: 1, remaining: 0 });
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    assert.equal(root.querySelector('#audit-status').textContent,
        'Kuyruk tam doğrulanamadı; sonuçları eksiksiz kabul etmeyin. Okunan sonuçlar ortak depoya kaydedildi.');
    window.close();
});

test('staff audit manager loads the shared records and queries by passport, status and page', async () => {
    const dom = new JSDOM(markup, { url: 'https://portal.test/yetkili/' });
    const { window } = dom;
    const root = window.document.getElementById('audit-root');
    const requests = [];
    window.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        requests.push({ url, body });
        return {
            ok: true,
            status: 200,
            json: async () => ({
                total: 51,
                page: body.page,
                pageSize: body.pageSize,
                records: body.page === 1 ? [{
                    application_number: '2026-00-0000001', student_number: '2600000001',
                    first_name: 'AYŞE', last_name: 'TEST', passport_number: 'U12345678', phone: '5000000000',
                    application_status: 'İşlem Bekliyor', status_category: 'pending', result_status: 'verified',
                    documents: [], scanned_at: '2026-11-02T09:00:00.000Z'
                }] : []
            })
        };
    };
    initializeYoksisDocumentAuditManager(root);
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    assert.equal(requests[0].url, '/api/staff/yoksis-document-audit/query');
    assert.equal(root.querySelectorAll('#audit-results tr').length, 1);
    assert.match(root.querySelector('#audit-results').textContent, /U12345678/);
    assert.equal(root.querySelector('#audit-shared-count').textContent, '51 kayıt');

    root.querySelector('#audit-filter').value = 'rejected';
    root.querySelector('#audit-filter').dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    assert.equal(requests.at(-1).body.status, 'rejected');

    root.querySelector('#audit-search').value = 'U12345678';
    root.querySelector('#audit-search-submit').click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    assert.equal(requests.at(-1).body.q, 'U12345678');
    assert.equal(requests.at(-1).body.page, 1);

    root.querySelector('#audit-page-next').click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    assert.equal(requests.at(-1).body.page, 2);
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
                response: { success: true, yoksisTabId: 4 } }
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
        Array.from(root.querySelectorAll('#audit-results tr'), (row) => row.cells[7]?.textContent),
        ['Başarılı', 'Beklemede', 'Eksik Evrak', 'Diğer']
    );
    assert.deepEqual(
        Array.from(root.querySelectorAll('#audit-results tr'), (row) => row.dataset.auditClassification),
        ['successful', 'pending', 'missing_documents', 'other']
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

test('staff audit manager allows the controller preflight up to thirty seconds', async () => {
    const dom = new JSDOM(markup, { url: 'https://portal.test/yetkili/' });
    const { window } = dom;
    const root = window.document.getElementById('audit-root');
    const messages = [];
    const timeouts = [];
    window.setTimeout = (_callback, delay) => {
        timeouts.push(delay);
        return timeouts.length;
    };
    window.clearTimeout = () => {};
    window.postMessage = (data) => messages.push(data);
    initializeYoksisDocumentAuditManager(root);
    root.querySelector('#audit-confirm').checked = true;
    root.querySelector('#audit-start').click();

    assert.equal(messages[0].payload.action, 'START_YOKSIS_DOCUMENT_AUDIT');
    assert.equal(timeouts[0], 30_000);

    const dispatchResponse = (message, response) => window.dispatchEvent(new window.MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: {
            source: 'EXTENSION',
            type: 'RESPONSE',
            action: message.payload.action,
            requestId: message.payload.requestId,
            response
        }
    }));
    dispatchResponse(messages[0], { success: true, yoksisTabId: 4 });
    await new Promise((resolve) => setImmediate(resolve));

    assert.match(root.querySelector('#audit-status').textContent, /Tarama sürüyor/);
    dom.window.close();
});
