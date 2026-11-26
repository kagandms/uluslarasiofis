import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { PDFDocument } from 'pdf-lib';
import { test } from 'node:test';
import { initializeStaffApplicationsManager } from '../src/staff/applicationsManager.js';

const zkControlsSource = readFileSync(new URL('../ykn_eklenti-main/zk-form-controls.js', import.meta.url), 'utf8');
const controllerSource = readFileSync(new URL('../ykn_eklenti-main/gocnet-transfer-controller.js', import.meta.url), 'utf8');
const domContractHtml = readFileSync(new URL('./fixtures/gocnet-transfer/dom-contract.html', import.meta.url), 'utf8');

const SYNTHETIC_APPLICATION_NUMBER = '2099-01-0000001';
const SYNTHETIC_PORTAL_APP_NUMBER = '2026-01-0000001';
const SYNTHETIC_STUDENT_NUMBER = '99000000001';
const SYNTHETIC_RECORD_ID = '70001';
const SYNTHETIC_ATTEMPT_ID = '00000000-0000-4000-8000-000000000001';

function createExtensionHarness(html, { url = 'https://yoksis.yok.gov.tr/menu/gocnet-iletim' } = {}) {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    const { window } = dom;
    const observers = new Set();
    let filterEvents = 0;
    let listQueries = 0;
    let messageListener = null;

    const widgetFor = (element) => {
        if (!element) return null;
        if (element.getAttribute?.('placeholder') === 'Tüm veya kısmi no...') {
            return {
                value: element.value || '',
                setValue(value) { element.value = value; this.value = value; },
                getValue() { return this.value; },
                fire(name) {
                    if (name === 'onChange') {
                        filterEvents += 1;
                        for (const watcher of observers) watcher.onResponse();
                    }
                }
            };
        }
        if (element.tagName === 'BUTTON' && element.textContent?.includes('Kayıtları Listele')) {
            return {
                fire(name) {
                    if (name === 'onClick') {
                        listQueries += 1;
                        for (const watcher of observers) watcher.onResponse();
                    }
                }
            };
        }
        return null;
    };

    window.zk = { Widget: { $: widgetFor }, Desktop: { all: {} } };
    window.zAu = { processing: () => false, getAuRequests: () => [] };
    window.zWatch = {
        listen({ onResponse }) { observers.add(onResponse); },
        unlisten({ onResponse }) { observers.delete(onResponse); }
    };
    window.chrome = {
        runtime: {
            id: 'test-extension-id',
            onMessage: { addListener(listener) { messageListener = listener; } },
            sendMessage: async (message) => {
                if (message?.action === 'YOKSIS_ZK_COMMAND') {
                    return window.YknZkForm.execute(message.command);
                }
                return null;
            }
        }
    };

    vm.runInContext(zkControlsSource, dom.getInternalVMContext());
    vm.runInContext(controllerSource, dom.getInternalVMContext());

    return {
        dom,
        filterEvents: () => filterEvents,
        listQueries: () => listQueries,
        async sendHistoryQuery(requestId = 'guard-query-1') {
            assert.ok(messageListener, 'controller message listener was not registered');
            const response = await new Promise((resolve, reject) => {
                let isAsync;
                const sendResponse = (payload) => {
                    // Önce senkron dönüş değerini doğrulamak için yanıtı bir mikro-görev sonraya bırak.
                    queueMicrotask(() => {
                        if (isAsync !== true) reject(new Error(`Expected async messageListener response, got ${isAsync}`));
                        else resolve(payload);
                    });
                };
                isAsync = messageListener({
                    action: 'YOKSIS_GOCNET_QUERY',
                    phase: 'history',
                    requestId,
                    portalTabId: 7,
                    attemptId: SYNTHETIC_ATTEMPT_ID,
                    applicationNumber: SYNTHETIC_APPLICATION_NUMBER
                }, { id: 'test-extension-id' }, sendResponse);
                assert.equal(isAsync, true);
            });
            // Chrome IPC yanıtında olduğu gibi denetleyicinin .finally() temizliğinin tamamlanmasını bekle.
            await new Promise((resolve) => setTimeout(resolve, 0));
            return response;
        },
        close() {
            dom.window.close();
        }
    };
}

function assertNoSensitiveOrUrlDiagnostics(text) {
    assert.doesNotMatch(text, /https?:\/\//i);
    assert.doesNotMatch(text, /yoksis\.yok\.gov\.tr/i);
    assert.doesNotMatch(text, /\/menu\b/i);
    assert.doesNotMatch(text, /\[docs=/);
    assert.equal(text.includes(SYNTHETIC_APPLICATION_NUMBER), false);
    assert.equal(text.includes(SYNTHETIC_STUDENT_NUMBER), false);
    assert.equal(text.includes(SYNTHETIC_RECORD_ID), false);
}

async function createPortalHarness(onExtensionRequest) {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const pdfBytes = await pdf.save();
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
        url: 'https://portal.test/yetkili/',
        runScripts: 'outside-only'
    });
    const { window } = dom;
    const { document } = window;
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;

    if (!window.crypto?.randomUUID) {
        Object.defineProperty(window, 'crypto', { configurable: true, value: globalThis.crypto });
    }
    window.scrollTo = () => {};
    if (window.HTMLCanvasElement) {
        window.HTMLCanvasElement.prototype.getContext = () => ({});
    }
    window.pdfjsLib = {
        getDocument: () => ({
            promise: Promise.resolve({
                numPages: 1,
                getPage: async () => ({
                    // parser.js numara çıkarımı için etiketli başvuru numarası gerektirir; aksi halde JSDOM'da askıda kalan canvas.toBlob yoluna düşer.
                    getTextContent: async () => ({ items: [{ str: `Kayıt Numarası: ${SYNTHETIC_PORTAL_APP_NUMBER}` }] }),
                    getViewport: () => ({ width: 10, height: 10 }),
                    render: () => ({ promise: Promise.resolve() })
                })
            }),
            destroy: async () => {}
        })
    };

    globalThis.window = window;
    globalThis.document = document;

    const events = [];
    const api = {
        async queryApplications() {
            return {
                items: [{
                    id: 'app-1',
                    student_number: SYNTHETIC_STUDENT_NUMBER,
                    first_name: 'TEST',
                    last_name: 'STUDENT',
                    application_type: 'renewal',
                    status: 'sent_to_migration',
                    submitted_at: '2099-01-01T00:00:00Z',
                    updated_at: '2099-01-01T00:00:00Z'
                }],
                pagination: { page: 1, total_pages: 1, total_items: 1 }
            };
        },
        async readApplicationDetail(applicationId) {
            return {
                application: {
                    id: applicationId,
                    status: 'sent_to_migration',
                    submitted_at: '2099-01-01T00:00:00Z',
                    student_number: SYNTHETIC_STUDENT_NUMBER,
                    passport_number: 'SYNTH001',
                    first_name: 'TEST',
                    last_name: 'STUDENT',
                    phone: '+905551112233'
                },
                documents: [{
                    code: 'residence_application_form',
                    required: true,
                    access_available: true,
                    revision_number: 1,
                    scan_status: 'clean',
                    filename: 'form.pdf'
                }]
            };
        },
        async createArchiveManifest() {
            return {
                files: [{
                    code: 'residence_application_form',
                    expected_revision_number: 1,
                    object_identity: 'a'.repeat(64),
                    media_type: 'application/pdf',
                    byte_size: pdfBytes.byteLength,
                    entry_name: '01-residence_application_form.pdf'
                }]
            };
        },
        async readArchiveFile() {
            return new Response(pdfBytes, { status: 200, headers: { 'Content-Type': 'application/pdf' } });
        },
        async createGocnetAttempt(_applicationId, body) {
            return { attemptId: body.attemptId };
        },
        async recordGocnetEvent(_applicationId, _attemptId, body) {
            events.push(body);
            return { ok: true };
        }
    };

    window.addEventListener('message', (event) => {
        if (event.data?.source !== 'WEB_APP') return;
        const { action, requestId } = event.data.payload;
        const response = onExtensionRequest(event.data.payload);
        window.dispatchEvent(new window.MessageEvent('message', {
            data: { source: 'EXTENSION', requestId, type: 'RESPONSE', action, response },
            origin: window.location.origin,
            source: window
        }));
    });

    const root = document.getElementById('root');
    initializeStaffApplicationsManager(root, api);
    document.dispatchEvent(new window.CustomEvent('workspace:view-changed', { detail: { viewName: 'applications' } }));

    for (let attempt = 0; attempt < 50 && !root.querySelector('[data-action="gocnet-transfer"]'); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const button = root.querySelector('[data-action="gocnet-transfer"]');
    assert.ok(button, 'GöçNet transfer button should render in queue');

    return {
        events,
        async runGocnetTransfer() {
            button.click();
            for (let attempt = 0; attempt < 200; attempt += 1) {
                const status = root.querySelector('.staff-gocnet-transfer-status');
                const activeButton = root.querySelector('[data-action="gocnet-transfer"]');
                if (status && activeButton && !activeButton.disabled) return status.textContent;
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
            throw new Error('Timed out waiting for GöçNet transfer status');
        },
        close() {
            if (previousWindow === undefined) delete globalThis.window;
            else globalThis.window = previousWindow;
            if (previousDocument === undefined) delete globalThis.document;
            else globalThis.document = previousDocument;
            window.close();
        }
    };
}

test('correct GöçNet screen preserves existing query and history classification behavior', async () => {
    const harness = createExtensionHarness(domContractHtml);
    try {
        const result = await harness.sendHistoryQuery('correct-screen-1');
        assert.deepEqual(JSON.parse(JSON.stringify(result)), {
            requestId: 'correct-screen-1',
            state: 'existing_record'
        });
        assert.equal(harness.filterEvents(), 1);
        assert.equal(harness.listQueries(), 1);

        const records = harness.dom.window.document.querySelector('[data-fixture="records"]');
        records.querySelector('.fixture-records').replaceChildren();
        records.querySelector('.z-listbox-emptybody td').style.display = 'table-cell';
        const emptyResult = await harness.sendHistoryQuery('correct-screen-2');
        assert.deepEqual(JSON.parse(JSON.stringify(emptyResult)), {
            requestId: 'correct-screen-2',
            state: 'no_match'
        });
    } finally {
        harness.close();
    }
});

test('wrong YÖKSİS screen returns not_on_gocnet_screen as first token with clean diagnostics', async () => {
    const wrongScreenHtml = `<!doctype html><html lang="tr"><body>
        <main>
            <h2>YÖKSİS Ana Menü</h2>
            <p>Başvuru: ${SYNTHETIC_APPLICATION_NUMBER} Öğrenci: ${SYNTHETIC_STUDENT_NUMBER} Kayıt: ${SYNTHETIC_RECORD_ID}</p>
            <input value="${SYNTHETIC_APPLICATION_NUMBER}">
        </main>
    </body></html>`;
    const harness = createExtensionHarness(wrongScreenHtml, { url: 'https://yoksis.yok.gov.tr/menu/anasayfa' });
    try {
        const zkResult = await harness.dom.window.YknZkForm.execute({
            action: 'queryGocnetRecords',
            applicationNumber: SYNTHETIC_APPLICATION_NUMBER,
            requestId: 'wrong-screen-zk'
        });
        assert.equal(zkResult.success, false);
        assert.equal(zkResult.error.split(/\s+/)[0], 'not_on_gocnet_screen');
        assertNoSensitiveOrUrlDiagnostics(zkResult.error);

        const controllerResult = await harness.sendHistoryQuery('wrong-screen-ctrl');
        assert.equal(controllerResult.state, 'unknown');
        assert.equal(controllerResult.reason.split(/\s+/)[0], 'not_on_gocnet_screen');
        assert.match(controllerResult.reason, /belge: 1, başlık: 0, liste: 0, ekran başlığı: yok/);
        assert.ok(controllerResult.reason.length <= 160);
        assertNoSensitiveOrUrlDiagnostics(controllerResult.reason);
        assert.equal(harness.filterEvents(), 0);
        assert.equal(harness.listQueries(), 0);
    } finally {
        harness.close();
    }
});

test('GöçNet screen without history section returns history_section_missing as first token', async () => {
    const harness = createExtensionHarness(domContractHtml);
    try {
        const sections = harness.dom.window.document.querySelectorAll('section');
        sections[1].remove();

        const zkResult = await harness.dom.window.YknZkForm.execute({
            action: 'queryGocnetRecords',
            applicationNumber: SYNTHETIC_APPLICATION_NUMBER,
            requestId: 'missing-section-zk'
        });
        assert.equal(zkResult.success, false);
        assert.equal(zkResult.error.split(/\s+/)[0], 'history_section_missing');
        assertNoSensitiveOrUrlDiagnostics(zkResult.error);

        const controllerResult = await harness.sendHistoryQuery('missing-section-ctrl');
        assert.equal(controllerResult.state, 'unknown');
        assert.equal(controllerResult.reason.split(/\s+/)[0], 'history_section_missing');
        assert.match(controllerResult.reason, /belge: 1, başlık: 0, liste: 1, ekran başlığı: var/);
        assert.ok(controllerResult.reason.length <= 160);
        assertNoSensitiveOrUrlDiagnostics(controllerResult.reason);
        assert.equal(harness.filterEvents(), 0);
        assert.equal(harness.listQueries(), 0);
    } finally {
        harness.close();
    }
});

test('restricted filter on GöçNet screen keeps zk_command_failed prefix and readable diagnostics without old tag', async () => {
    const harness = createExtensionHarness(domContractHtml);
    try {
        harness.dom.window.document.querySelector('input[placeholder="Öğrenci no..."]').value = SYNTHETIC_STUDENT_NUMBER;
        const controllerResult = await harness.sendHistoryQuery('restricted-filter');
        assert.equal(controllerResult.state, 'unknown');
        assert.match(controllerResult.reason, /^zk_command_failed: GöçNet kayıt listesi belirsiz veya filtreleri kısıtlı\./);
        assert.match(controllerResult.reason, /belge: 1, başlık: 1, liste: 2, ekran başlığı: var/);
        assertNoSensitiveOrUrlDiagnostics(controllerResult.reason);
    } finally {
        harness.close();
    }
});

for (const reasonCode of ['not_on_gocnet_screen', 'history_section_missing']) {
    test(`portal maps history-phase ${reasonCode} to actionable screen-switch guidance`, async () => {
        const portal = await createPortalHarness((payload) => {
            assert.equal(payload.action, 'CHECK_GOCNET_TRANSFER');
            assert.equal(payload.phase, 'history');
            return {
                state: 'unknown',
                reason: `${reasonCode} (belge: 1, başlık: 0, liste: 0, ekran başlığı: ${reasonCode === 'history_section_missing' ? 'var' : 'yok'})`
            };
        });
        try {
            const statusText = await portal.runGocnetTransfer();
            assert.equal(statusText, 'Kayıt açılmadı. YÖKSİS sekmesini GöçNet iletim ekranına getirip tekrar deneyin.');
            assert.deepEqual(portal.events.map((event) => event.state), ['querying', 'failed']);
        } finally {
            portal.close();
        }
    });
}

test('portal keeps existing history message for unknown or legacy extension reasons (backward compatibility)', async () => {
    const legacyReason = 'zk_command_failed: GöçNet kayıt listesi belirsiz veya filtreleri kısıtlı. [docs=2/0 h0,h0]';
    const legacyPortal = await createPortalHarness(() => ({ state: 'unknown', reason: legacyReason }));
    try {
        const legacyStatus = await legacyPortal.runGocnetTransfer();
        assert.equal(legacyStatus, `Sonuç doğrulanamadı. YÖKSİS’i kontrol edin; otomatik tekrar yapılmadı. Neden: ${legacyReason}`);
    } finally {
        legacyPortal.close();
    }

    const noReasonPortal = await createPortalHarness(() => ({ state: 'unknown' }));
    try {
        const noReasonStatus = await noReasonPortal.runGocnetTransfer();
        assert.equal(noReasonStatus, 'Sonuç doğrulanamadı. YÖKSİS’i kontrol edin; otomatik tekrar yapılmadı.');
    } finally {
        noReasonPortal.close();
    }
});

test('portal record and upload phase failure messages remain unchanged', async () => {
    const saveFailurePortal = await createPortalHarness((payload) => {
        if (payload.action === 'CHECK_GOCNET_TRANSFER' && payload.phase === 'history') {
            return { state: 'no_match', yoksisTabId: 42 };
        }
        if (payload.action === 'CHECK_GOCNET_TRANSFER' && payload.phase === 'form') {
            return { state: 'student_data_filled', yoksisTabId: 42 };
        }
        if (payload.action === 'YOKSIS_GOCNET_AUTO_SAVE_UPLOAD') {
            return { state: 'unknown', reason: 'unavailable' };
        }
        if (payload.action === 'SAVE_GOCNET_RECORD') {
            return { state: 'unknown', reason: 'not_on_gocnet_screen' };
        }
        throw new Error(`Unexpected action ${payload.action}`);
    });
    try {
        const saveStatus = await saveFailurePortal.runGocnetTransfer();
        assert.equal(saveStatus, 'GöçNet kayıt sonucu belirsiz kaldı. YÖKSİS’te kontrol edin; otomatik tekrar yapılmadı.');
    } finally {
        saveFailurePortal.close();
    }

    const uploadFailurePortal = await createPortalHarness((payload) => {
        if (payload.action === 'CHECK_GOCNET_TRANSFER' && payload.phase === 'history') {
            return { state: 'no_match', yoksisTabId: 42 };
        }
        if (payload.action === 'CHECK_GOCNET_TRANSFER' && payload.phase === 'form') {
            return { state: 'student_data_filled', yoksisTabId: 42 };
        }
        if (payload.action === 'YOKSIS_GOCNET_AUTO_SAVE_UPLOAD') {
            return { state: 'unknown', reason: 'unavailable' };
        }
        if (payload.action === 'SAVE_GOCNET_RECORD') {
            return { state: 'saved', recordId: SYNTHETIC_RECORD_ID };
        }
        if (payload.action === 'ACK_GOCNET_SAVE') {
            return { success: true };
        }
        if (payload.action === 'UPLOAD_GOCNET_DOCUMENT') {
            return { state: 'unknown', reason: 'not_on_gocnet_screen' };
        }
        throw new Error(`Unexpected action ${payload.action}`);
    });
    try {
        const uploadStatus = await uploadFailurePortal.runGocnetTransfer();
        assert.equal(uploadStatus, 'Belge yükleme sonucu belirsiz; YÖKSİS’i kontrol edin ve otomatik tekrar yapmayın.');
    } finally {
        uploadFailurePortal.close();
    }
});
