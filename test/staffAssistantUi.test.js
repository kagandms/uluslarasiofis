import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { PDFDocument } from 'pdf-lib';
import { initializeStaffAssistant } from '../src/staff/staffAssistant.js';

async function readWorkspaceFile(relativePath) {
    return readFile(resolve(process.cwd(), relativePath), 'utf8');
}

function createJsonResponse(payload, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
            return payload;
        }
    };
}

async function flushPromises() {
    await new Promise((resolveTick) => setTimeout(resolveTick, 10));
    await new Promise((resolveTick) => setImmediate(resolveTick));
}

function createStaffDom(context, { authenticated = true } = {}) {
    const html = `<!doctype html>
<html lang="tr">
<head><title>Yetkili</title></head>
<body>
    <div id="login-overlay" ${authenticated ? 'hidden' : ''}></div>
    <div id="app-content" ${authenticated ? '' : 'hidden'}>
        <nav class="workspace-nav">
            <button type="button" data-workspace-view="applications">İkamet Başvuruları</button>
            <button type="button" data-workspace-view="ykn">YKN</button>
            <button type="button" data-workspace-view="teblig">Tebliğ Bul</button>
            <button type="button" data-workspace-view="documents">Belgeler</button>
            <button type="button" data-workspace-view="work-hours">Çalışma Saatleri</button>
        </nav>
        <section id="view-ykn">
            <input id="ykn-passport-input" type="text" value="">
            <button id="btn-ykn-search" type="button">Ara</button>
            <button id="btn-read-acceptance" type="button">Kabul Mektubu</button>
            <button id="btn-copy" type="button">Bilgileri Al</button>
        </section>
        <section id="view-teblig">
            <div id="tebligat-search-toggle"></div>
            <div id="tebligat-search-body" style="display: none;">
                <input id="tebligat-search-input" type="text" value="">
            </div>
        </section>
    </div>
</body>
</html>`;

    const dom = new JSDOM(html, { url: 'https://portal.test/yetkili/' });
    context.after(() => dom.window.close());
    return { dom, window: dom.window, doc: dom.window.document };
}

test('yetkili/index.html loads staffAssistant.css and staff/main.js initializes after staffAuthReady', async () => {
    const [html, mainSource] = await Promise.all([
        readWorkspaceFile('yetkili/index.html'),
        readWorkspaceFile('src/staff/main.js')
    ]);

    assert.match(
        html,
        /<link\s+rel="stylesheet"\s+href="\/src\/staff\/staffAssistant\.css"\s*\/?>/,
        'yetkili/index.html must include staffAssistant.css stylesheet link'
    );
    assert.match(
        mainSource,
        /import\s+\{\s*initializeStaffAssistant\s*\}\s+from\s+['"]\.\/staffAssistant\.js['"]/,
        'src/staff/main.js must import initializeStaffAssistant'
    );

    const authCheckIndex = mainSource.indexOf('if (!await staffAuthReady) return;');
    const initCallIndex = mainSource.indexOf('initializeStaffAssistant(');
    assert.ok(authCheckIndex !== -1, 'staffAuthReady check must exist in main.js');
    assert.ok(initCallIndex > authCheckIndex, 'initializeStaffAssistant must run after staffAuthReady check');
});

test('panel is not rendered when staff session is not active', (context) => {
    const { doc } = createStaffDom(context, { authenticated: false });

    const controller = initializeStaffAssistant({ root: doc });

    assert.equal(controller, null);
    assert.equal(doc.getElementById('staff-assistant-root'), null);
    assert.equal(doc.getElementById('staff-assistant-launcher'), null);
    assert.equal(doc.getElementById('staff-assistant-panel'), null);
});

test('panel opens, sends on Enter, closes on Esc restoring focus, and exposes aria-live log', async (context) => {
    const { window, doc } = createStaffDom(context, { authenticated: true });
    const requests = [];
    const fetcher = async (url, options) => {
        requests.push({ url, options, body: JSON.parse(options.body) });
        return createJsonResponse({
            reply: 'Yardımcı olabilirim.',
            state: 'understood'
        });
    };

    const controller = initializeStaffAssistant({ root: doc, fetcher });
    assert.ok(controller);
    context.after(() => controller.destroy());

    const launcher = doc.getElementById('staff-assistant-launcher');
    const panel = doc.getElementById('staff-assistant-panel');
    const log = panel.querySelector('[role="log"]');
    const input = doc.getElementById('staff-assistant-input');

    assert.ok(launcher);
    assert.ok(panel);
    assert.equal(panel.hidden, true);
    assert.equal(launcher.getAttribute('aria-expanded'), 'false');
    assert.equal(log.getAttribute('aria-live'), 'polite');

    launcher.click();
    assert.equal(panel.hidden, false);
    assert.equal(launcher.getAttribute('aria-expanded'), 'true');
    assert.equal(doc.activeElement, input);

    input.value = 'Merhaba Topi';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushPromises();

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/staff/assistant');
    assert.equal(requests[0].options.credentials, 'same-origin');
    assert.equal(requests[0].body.message, 'Merhaba Topi');
    assert.deepEqual(requests[0].body.history, []);
    assert.match(log.textContent, /Yardımcı olabilirim\./);

    doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(panel.hidden, true);
    assert.equal(launcher.getAttribute('aria-expanded'), 'false');
    assert.equal(doc.activeElement, launcher);
});

test('history is capped at the last 6 turns in outgoing assistant requests', async (context) => {
    const { window, doc } = createStaffDom(context, { authenticated: true });
    const requests = [];
    const fetcher = async (url, options) => {
        const body = JSON.parse(options.body);
        requests.push(body);
        return createJsonResponse({
            reply: `Yanıt ${requests.length}`,
            state: 'understood'
        });
    };

    const controller = initializeStaffAssistant({ root: doc, fetcher });
    context.after(() => controller.destroy());
    controller.open();

    const input = doc.getElementById('staff-assistant-input');
    for (let turn = 1; turn <= 5; turn += 1) {
        input.value = `Mesaj ${turn}`;
        input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await flushPromises();
    }

    assert.equal(requests.length, 5);
    assert.equal(requests[4].history.length, 6);
    assert.deepEqual(requests[4].history, [
        { role: 'user', content: 'Mesaj 2' },
        { role: 'assistant', content: 'Yanıt 2' },
        { role: 'user', content: 'Mesaj 3' },
        { role: 'assistant', content: 'Yanıt 3' },
        { role: 'user', content: 'Mesaj 4' },
        { role: 'assistant', content: 'Yanıt 4' }
    ]);
});

test('workHours.propose does not POST to /api/staff/work-hours until Kaydet is clicked; Vazgeç removes row', async (context) => {
    const { window, doc } = createStaffDom(context, { authenticated: true });
    const requests = [];
    const fetcher = async (url, options) => {
        requests.push({ url, options, body: JSON.parse(options.body) });
        if (url === '/api/staff/assistant') {
            return createJsonResponse({
                reply: 'Kaydetmek için onaylayın.',
                state: 'checking',
                action: {
                    type: 'workHours.propose',
                    person: 'kagan_samet',
                    minutes: 390,
                    label: '6,5 saat · Kağan Samet · bugün'
                }
            });
        }
        return createJsonResponse({ ok: true }, 200);
    };

    const controller = initializeStaffAssistant({ root: doc, fetcher });
    context.after(() => controller.destroy());
    controller.open();

    const input = doc.getElementById('staff-assistant-input');
    input.value = 'Kağan için 6,5 saat';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushPromises();

    // No POST to /api/staff/work-hours before Kaydet is clicked.
    assert.equal(requests.filter((entry) => entry.url === '/api/staff/work-hours').length, 0);

    const confirmRow = doc.querySelector('.staff-assistant-confirm-row');
    assert.ok(confirmRow);
    assert.match(confirmRow.textContent, /6,5 saat · Kağan Samet · bugün/);

    const saveBtn = confirmRow.querySelector('.staff-assistant-confirm-save');
    assert.ok(saveBtn);
    saveBtn.click();
    await flushPromises();

    const workHourRequests = requests.filter((entry) => entry.url === '/api/staff/work-hours');
    assert.equal(workHourRequests.length, 1);
    assert.equal(workHourRequests[0].options.method, 'POST');
    assert.equal(workHourRequests[0].options.credentials, 'same-origin');
    assert.deepEqual(workHourRequests[0].body, { person: 'kagan_samet', minutes: 390 });

    // Second proposal: Vazgeç removes the row without posting.
    input.value = 'Kağan için tekrar 6,5 saat';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushPromises();

    const rows = doc.querySelectorAll('.staff-assistant-confirm-row');
    const secondRow = rows[rows.length - 1];
    const cancelBtn = secondRow.querySelector('.staff-assistant-confirm-cancel');
    assert.ok(cancelBtn);
    cancelBtn.click();

    assert.equal(secondRow.isConnected, false);
    assert.equal(requests.filter((entry) => entry.url === '/api/staff/work-hours').length, 1);
});

test('ykn.run navigates to ykn, only dispatches ykn:auto-run, never touches YKN DOM, and reflects ykn:auto-flow-status', async (context) => {
    const { window, doc } = createStaffDom(context, { authenticated: true });
    let yknNavClicked = 0;
    let yknButtonClicks = 0;
    const dispatchedEvents = [];

    doc.querySelector('button[data-workspace-view="ykn"]').addEventListener('click', () => {
        yknNavClicked += 1;
    });
    for (const id of ['btn-ykn-search', 'btn-read-acceptance', 'btn-copy']) {
        doc.getElementById(id).addEventListener('click', () => {
            yknButtonClicks += 1;
        });
    }
    window.addEventListener('ykn:auto-run', (event) => {
        dispatchedEvents.push(event.detail);
    });

    const fetcher = async () => createJsonResponse({
        reply: 'YKN zinciri başlatılıyor.',
        state: 'checking',
        action: { type: 'ykn.run', passportNo: 'AB123456' }
    });

    const controller = initializeStaffAssistant({ root: doc, fetcher });
    context.after(() => controller.destroy());
    controller.open();

    const input = doc.getElementById('staff-assistant-input');
    input.value = 'AB123456 pasaportunu YKN ye ver';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushPromises();

    assert.equal(yknNavClicked, 1);
    assert.deepEqual(dispatchedEvents, [{ passportNo: 'AB123456' }]);
    assert.equal(yknButtonClicks, 0);
    assert.equal(doc.getElementById('ykn-passport-input').value, '');

    // ykn:auto-flow-status updates panel log and Topi state.
    window.dispatchEvent(new window.CustomEvent('ykn:auto-flow-status', {
        detail: { state: 'SEARCHED', message: 'Öğrenci bulundu, kabul mektubu okunuyor.', level: 'info' }
    }));
    const headerTopi = doc.querySelector('.staff-assistant-header svg.mascot-cat');
    assert.ok(headerTopi.classList.contains('is-checking'));
    assert.match(doc.querySelector('[role="log"]').textContent, /Öğrenci bulundu, kabul mektubu okunuyor\./);

    window.dispatchEvent(new window.CustomEvent('ykn:auto-flow-status', {
        detail: { state: 'DONE', message: 'Aktarım tamamlandı.', level: 'success' }
    }));
    assert.ok(headerTopi.classList.contains('is-understood'));

    window.dispatchEvent(new window.CustomEvent('ykn:auto-flow-status', {
        detail: { state: 'STOPPED', message: 'Pasaport sayfası doğrulanamadı.', level: 'error' }
    }));
    assert.ok(headerTopi.classList.contains('is-confused'));
});

test('invalid action and invalid passportNo from server are ignored with a neutral message', async (context) => {
    const { window, doc } = createStaffDom(context, { authenticated: true });
    const yknEvents = [];
    let navClicks = 0;

    window.addEventListener('ykn:auto-run', (event) => yknEvents.push(event.detail));
    doc.querySelector('button[data-workspace-view="ykn"]').addEventListener('click', () => {
        navClicks += 1;
    });

    const responses = [
        { reply: 'Başlatıyorum.', state: 'checking', action: { type: 'ykn.run', passportNo: 'a b' } },
        { reply: 'Siliyorum.', state: 'understood', action: { type: 'delete.all', target: 'applications' } }
    ];
    let index = 0;
    const fetcher = async () => createJsonResponse(responses[index++]);

    const controller = initializeStaffAssistant({ root: doc, fetcher });
    context.after(() => controller.destroy());
    controller.open();

    const input = doc.getElementById('staff-assistant-input');
    input.value = 'geçersiz pasaport';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushPromises();

    input.value = 'geçersiz eylem';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushPromises();

    assert.equal(yknEvents.length, 0);
    assert.equal(navClicks, 0);
    assert.match(doc.querySelector('[role="log"]').textContent, /uygulanmadı/i);
});

test('tebligat.search opens collapsed toggle, fills search input, and dispatches bubbling input event', async (context) => {
    const { window, doc } = createStaffDom(context, { authenticated: true });
    const toggle = doc.getElementById('tebligat-search-toggle');
    const body = doc.getElementById('tebligat-search-body');
    const searchInput = doc.getElementById('tebligat-search-input');

    let toggleClicks = 0;
    toggle.addEventListener('click', () => {
        toggleClicks += 1;
        body.style.display = 'block';
    });

    let bubbledInputValue = null;
    doc.getElementById('view-teblig').addEventListener('input', (event) => {
        if (event.target === searchInput) {
            bubbledInputValue = searchInput.value;
        }
    });

    const fetcher = async () => createJsonResponse({
        reply: 'Tebliğ araması açılıyor.',
        state: 'checking',
        action: { type: 'tebligat.search', query: 'AHMET YILMAZ' }
    });

    const controller = initializeStaffAssistant({ root: doc, fetcher });
    context.after(() => controller.destroy());
    controller.open();

    const input = doc.getElementById('staff-assistant-input');
    input.value = 'Ahmet Yılmaz tebliğ';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushPromises();

    assert.equal(toggleClicks, 1);
    assert.equal(searchInput.value, 'AHMET YILMAZ');
    assert.equal(bubbledInputValue, 'AHMET YILMAZ');
});

test('documents.print builds multi-copy PDF blob and opens print window, and reports unknown document ids', async (context) => {
    const { window, doc } = createStaffDom(context, { authenticated: true });
    const sampleDoc = await PDFDocument.create();
    sampleDoc.addPage([200, 300]);
    const sampleBytes = await sampleDoc.save();

    const openedUrls = [];
    let printCalled = 0;
    let focusCalled = 0;
    const revokedUrls = [];

    window.URL.createObjectURL = () => 'blob:https://portal.test/copies-pdf';
    window.URL.revokeObjectURL = (url) => {
        revokedUrls.push(url);
    };
    window.open = (url) => {
        openedUrls.push(url);
        return {
            addEventListener(type, handler) {
                if (type === 'load') handler();
            },
            focus() {
                focusCalled += 1;
            },
            print() {
                printCalled += 1;
            }
        };
    };

    const actions = [
        { type: 'documents.print', documentId: 'taksitlendirme-dilekcesi', copies: 3 },
        { type: 'documents.print', documentId: 'olmayan-belge', copies: 2 }
    ];
    let callCount = 0;
    const fetcher = async (url) => {
        if (url === '/api/staff/assistant') {
            return createJsonResponse({
                reply: 'Belge hazırlanıyor.',
                state: 'checking',
                action: actions[callCount++]
            });
        }
        return {
            ok: true,
            status: 200,
            async arrayBuffer() {
                return sampleBytes.buffer.slice(
                    sampleBytes.byteOffset,
                    sampleBytes.byteOffset + sampleBytes.byteLength
                );
            }
        };
    };

    const controller = initializeStaffAssistant({ root: doc, fetcher });
    context.after(() => controller.destroy());
    controller.open();

    const input = doc.getElementById('staff-assistant-input');
    input.value = '3 taksit dilekçesi';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushPromises();

    assert.deepEqual(openedUrls, ['blob:https://portal.test/copies-pdf']);
    assert.equal(focusCalled, 1);
    assert.equal(printCalled, 1);

    input.value = 'bilinmeyen belge';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushPromises();

    assert.equal(openedUrls.length, 1);
    assert.match(doc.querySelector('[role="log"]').textContent, /belge bulunamadı/i);

    controller.destroy();
    assert.deepEqual(revokedUrls, ['blob:https://portal.test/copies-pdf']);
});

test('results blocks render applications and yoksisAudit via textContent only with stale badge and total line', async (context) => {
    const { window, doc } = createStaffDom(context, { authenticated: true });
    const payloads = [
        {
            reply: 'Başvurular listelendi.',
            state: 'understood',
            results: {
                kind: 'applications',
                total: 12,
                items: [{
                    id: 'app-1',
                    referenceNumber: 'REF-2026-001',
                    studentNumber: '2600000001',
                    firstName: '<img src=x onerror=alert(1)>',
                    lastName: 'TEST',
                    passportNumber: 'P123456',
                    status: 'submitted',
                    submittedAt: '2026-11-23T10:00:00Z'
                }]
            }
        },
        {
            reply: 'YÖKSİS kayıtları listelendi.',
            state: 'understood',
            results: {
                kind: 'yoksisAudit',
                total: 3,
                lastImportAt: '2026-11-23 13:07',
                items: [{
                    applicationNumber: '2026-00-0000001',
                    studentNumber: '2600000001',
                    fullName: '<b>AYŞE</b> TEST',
                    applicationStatus: 'Eksik Belge İstendi',
                    statusCategory: 'missing_documents',
                    missingDocuments: [{ name: 'Öğrenci Belgesi', required: true, note: 'Güncel' }],
                    missingDeadline: '2026-12-01',
                    unit: 'Mühendislik',
                    scannedAt: '2026-11-23T10:00:00Z',
                    isStale: true
                }]
            }
        }
    ];
    let idx = 0;
    const fetcher = async () => createJsonResponse(payloads[idx++]);

    const controller = initializeStaffAssistant({ root: doc, fetcher });
    context.after(() => controller.destroy());
    controller.open();

    const input = doc.getElementById('staff-assistant-input');
    input.value = 'Başvuru ara';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushPromises();

    input.value = 'Eksik evrak ara';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushPromises();

    const log = doc.querySelector('[role="log"]');
    assert.equal(log.querySelector('img, b'), null);
    assert.match(log.textContent, /REF-2026-001/);
    assert.match(log.textContent, /<img src=x onerror=alert\(1\)>/);
    assert.match(log.textContent, /toplam 12/i);
    assert.match(log.textContent, /2026-00-0000001/);
    assert.match(log.textContent, /<b>AYŞE<\/b> TEST/);
    assert.match(log.textContent, /Öğrenci Belgesi/);
    assert.match(log.textContent, /2026-12-01/);
    assert.match(log.textContent, /Son yüklemede yok/);
    assert.match(log.textContent, /toplam 3/i);
});

test('503 and network errors show friendly Turkish unavailable message', async (context) => {
    const { window, doc } = createStaffDom(context, { authenticated: true });
    let attempt = 0;
    const fetcher = async () => {
        attempt += 1;
        if (attempt === 1) return createJsonResponse({ error: 'unavailable' }, 503);
        throw new Error('offline');
    };

    const controller = initializeStaffAssistant({ root: doc, fetcher });
    context.after(() => controller.destroy());
    controller.open();

    const input = doc.getElementById('staff-assistant-input');
    input.value = 'Deneme 1';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushPromises();

    input.value = 'Deneme 2';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushPromises();

    const errorMessages = [...doc.querySelectorAll('.staff-assistant-message-error')];
    assert.equal(errorMessages.length, 2);
    for (const el of errorMessages) {
        assert.match(el.textContent, /Asistan şu anda kullanılamıyor\./);
    }
});

test('workHours.propose dispatches staff-work-hours:changed and shows detailed success text only after response.ok', async (context) => {
    const { window, doc } = createStaffDom(context, { authenticated: true });
    const changedEvents = [];
    window.addEventListener('staff-work-hours:changed', (event) => {
        changedEvents.push(event.detail);
    });

    let saveAttempt = 0;
    const fetcher = async (url) => {
        if (url === '/api/staff/assistant') {
            return createJsonResponse({
                reply: 'Kaydetmek için onaylayın.',
                state: 'checking',
                action: {
                    type: 'workHours.propose',
                    person: 'kagan_samet',
                    minutes: 390,
                    label: '6,5 saat · Kağan Samet · bugün'
                }
            });
        }
        saveAttempt += 1;
        if (saveAttempt === 1) {
            return createJsonResponse({ error: { message: 'Sunucu hatası' } }, 500);
        }
        if (saveAttempt === 2) {
            throw new Error('network-failure');
        }
        return createJsonResponse({ ok: true }, 200);
    };

    const controller = initializeStaffAssistant({ root: doc, fetcher });
    context.after(() => controller.destroy());
    controller.open();

    const input = doc.getElementById('staff-assistant-input');
    input.value = 'Kağan 6,5 saat';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushPromises();

    const saveBtn = doc.querySelector('.staff-assistant-confirm-save');
    assert.ok(saveBtn);

    // 500 response: must not dispatch event and must re-enable save button.
    saveBtn.click();
    await flushPromises();
    assert.equal(changedEvents.length, 0);
    assert.equal(saveBtn.disabled, false);

    // Network failure: must not dispatch event and must re-enable save button.
    saveBtn.click();
    await flushPromises();
    assert.equal(changedEvents.length, 0);
    assert.equal(saveBtn.disabled, false);

    // 200 response: dispatches staff-work-hours:changed and displays detailed Turkish confirmation.
    saveBtn.click();
    await flushPromises();
    assert.deepEqual(changedEvents, [{ person: 'kagan_samet', minutes: 390 }]);
    const statusEl = doc.querySelector('.staff-assistant-confirm-status.is-success');
    assert.ok(statusEl);
    assert.equal(
        statusEl.textContent,
        'Kaydedildi: 6,5 saat · Kağan Samet · bugün. Çalışma Saatleri ekranı güncellendi.'
    );
});

test('application and yoksisAudit results render Turkish status labels and never show raw status codes', async (context) => {
    const { window, doc } = createStaffDom(context, { authenticated: true });

    const makeAppItem = (idx, status) => ({
        id: `app-${idx}`,
        referenceNumber: `REF-${idx}`,
        studentNumber: `123${idx}`,
        firstName: 'Öğrenci',
        lastName: `No${idx}`,
        passportNumber: `P0000${idx}`,
        status,
        submittedAt: '2026-11-23T10:00:00Z'
    });

    const makeYoksisItem = (idx, statusCategory) => ({
        applicationNumber: `2026-00-000000${idx}`,
        studentNumber: `260000000${idx}`,
        fullName: `Kişi ${idx}`,
        applicationStatus: `Özet ${idx}`,
        statusCategory,
        missingDocuments: [],
        missingDeadline: null,
        unit: 'Mühendislik',
        scannedAt: '2026-11-23T10:00:00Z',
        isStale: false
    });

    const payloads = [
        {
            reply: 'Başvurular 1.',
            state: 'understood',
            results: {
                kind: 'applications',
                total: 11,
                items: [
                    makeAppItem(1, 'draft'),
                    makeAppItem(2, 'submitted'),
                    makeAppItem(3, 'under_review'),
                    makeAppItem(4, 'resubmission_required'),
                    makeAppItem(5, 'approved_for_processing')
                ]
            }
        },
        {
            reply: 'Başvurular 2.',
            state: 'understood',
            results: {
                kind: 'applications',
                total: 11,
                items: [
                    makeAppItem(6, 'sent_to_migration'),
                    makeAppItem(7, 'migration_approved'),
                    makeAppItem(8, 'completed'),
                    makeAppItem(9, 'cancelled'),
                    makeAppItem(10, 'rejected')
                ]
            }
        },
        {
            reply: 'Başvurular 3.',
            state: 'understood',
            results: {
                kind: 'applications',
                total: 1,
                items: [makeAppItem(11, 'unknown_raw_status_code')]
            }
        },
        {
            reply: 'YÖKSİS 1.',
            state: 'understood',
            results: {
                kind: 'yoksisAudit',
                total: 7,
                lastImportAt: '2026-11-23 13:07',
                items: [
                    makeYoksisItem(1, 'successful'),
                    makeYoksisItem(2, 'pending'),
                    makeYoksisItem(3, 'missing_documents'),
                    makeYoksisItem(4, 'rejected'),
                    makeYoksisItem(5, 'unreadable')
                ]
            }
        },
        {
            reply: 'YÖKSİS 2.',
            state: 'understood',
            results: {
                kind: 'yoksisAudit',
                total: 2,
                lastImportAt: '2026-11-23 13:07',
                items: [
                    makeYoksisItem(6, 'other'),
                    makeYoksisItem(7, 'unknown_yoksis_category')
                ]
            }
        }
    ];

    let index = 0;
    const fetcher = async () => createJsonResponse(payloads[index++]);

    const controller = initializeStaffAssistant({ root: doc, fetcher });
    context.after(() => controller.destroy());
    controller.open();

    const input = doc.getElementById('staff-assistant-input');
    for (let i = 0; i < payloads.length; i += 1) {
        input.value = `Sorgu ${i + 1}`;
        input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await flushPromises();
    }

    const logText = doc.querySelector('[role="log"]').textContent;

    const expectedLabels = [
        'Taslak',
        'Gönderildi',
        'İncelemede',
        'Yeniden yükleme gerekli',
        'İşleme alınmak üzere onaylandı',
        'Göç İdaresine gönderildi',
        'Göç İdaresi onayladı',
        'Tamamlandı',
        'İptal edildi',
        'Reddedildi',
        'Bilinmeyen durum',
        'İşlem tamamlandı',
        'Beklemede',
        'Eksik evrak',
        'Okunamadı',
        'Diğer'
    ];
    for (const label of expectedLabels) {
        assert.ok(logText.includes(label), `Expected Turkish status label "${label}" to be rendered`);
    }

    const forbiddenRawCodes = [
        'draft',
        'submitted',
        'under_review',
        'resubmission_required',
        'approved_for_processing',
        'sent_to_migration',
        'migration_approved',
        'completed',
        'cancelled',
        'rejected',
        'unknown_raw_status_code',
        'successful',
        'pending',
        'missing_documents',
        'unreadable',
        'other',
        'unknown_yoksis_category'
    ];
    for (const rawCode of forbiddenRawCodes) {
        assert.equal(logText.includes(rawCode), false, `Raw status code "${rawCode}" must not be rendered`);
    }
});

test('staff launcher mounts one aria-hidden playtime element, hides it while panel is open, and cleans up on destroy', (context) => {
    const { window, doc } = createStaffDom(context, { authenticated: true });
    const controller = initializeStaffAssistant({ root: doc });
    assert.ok(controller);
    context.after(() => controller.destroy());

    const root = doc.getElementById('staff-assistant-root');
    const launcher = doc.getElementById('staff-assistant-launcher');
    const playtimes = launcher.querySelectorAll('.topi-playtime');

    assert.equal(playtimes.length, 1);
    const playtime = playtimes[0];
    assert.equal(playtime.getAttribute('aria-hidden'), 'true');
    assert.equal(playtime.hidden, false);
    assert.equal(playtime.children.length, 1);

    const initialToy = playtime.firstElementChild;
    assert.equal(initialToy.className, 'topi-mouse');
    assert.equal(initialToy.getAttribute('aria-hidden'), 'true');
    assert.equal(initialToy.hidden, false);

    controller.open();
    assert.equal(root.classList.contains('is-panel-open'), true);
    assert.equal(playtime.hidden, true);
    assert.equal(initialToy.hidden, true);

    controller.close();
    assert.equal(root.classList.contains('is-panel-open'), false);
    assert.equal(playtime.hidden, false);
    assert.equal(initialToy.hidden, false);

    controller.destroy();
    initialToy.dispatchEvent(new window.Event('animationiteration'));
    assert.equal(playtime.firstElementChild, initialToy);
    assert.equal(doc.getElementById('staff-assistant-launcher'), null);
});

test('staff launcher omits playtime and toy elements when prefers-reduced-motion is active', (context) => {
    const { window, doc } = createStaffDom(context, { authenticated: true });
    window.matchMedia = (query) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener() {},
        removeEventListener() {}
    });

    const controller = initializeStaffAssistant({ root: doc });
    assert.ok(controller);
    context.after(() => controller.destroy());

    const root = doc.getElementById('staff-assistant-root');
    const launcher = doc.getElementById('staff-assistant-launcher');

    assert.equal(root.classList.contains('is-reduced-motion'), true);
    assert.equal(launcher.querySelector('.topi-playtime'), null);
    assert.equal(launcher.querySelector('.topi-mouse, .topi-yarn, .topi-ball, .topi-feather'), null);
});
