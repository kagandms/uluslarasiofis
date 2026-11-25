import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { initializeStaffAssistant } from '../src/staff/staffAssistant.js';
import {
    initTebligatSearch,
    loadCacheIntoMemory,
    searchTebligatLocal,
    toTopiTebligatItem
} from '../src/ui/tebligatSearch.js';

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

async function flushImmediate(turns = 5) {
    for (let i = 0; i < turns; i += 1) {
        await new Promise((resolveTick) => setImmediate(resolveTick));
    }
}

function createStaffDom(context, { cachedRecords = null, withTebligatScreenDom = false } = {}) {
    const tebligatScreenMarkup = withTebligatScreenDom
        ? `
            <div id="tebligat-search-toggle"></div>
            <div id="tebligat-search-body" style="display: none;">
                <select id="tebligat-year-select"><option value="2026" selected>2026</option></select>
                <input id="tebligat-search-input" type="text" value="">
                <button id="tebligat-search-clear" type="button" style="display: none;"></button>
                <div id="tebligat-search-results"></div>
            </div>
        `
        : `
            <div id="tebligat-search-toggle"></div>
            <div id="tebligat-search-body" style="display: none;">
                <input id="tebligat-search-input" type="text" value="">
            </div>
        `;

    const html = `<!doctype html>
<html lang="tr">
<head><title>Yetkili</title></head>
<body>
    <div id="login-overlay" hidden></div>
    <div id="app-content">
        <nav class="workspace-nav">
            <button type="button" data-workspace-view="applications">İkamet Başvuruları</button>
            <button type="button" data-workspace-view="teblig">Tebliğ Bul</button>
        </nav>
        <section id="view-teblig">
            ${tebligatScreenMarkup}
        </section>
    </div>
</body>
</html>`;

    const dom = new JSDOM(html, { url: 'https://portal.test/yetkili/' });
    if (Array.isArray(cachedRecords)) {
        dom.window.localStorage.setItem('tebligat_excel_cache_v2', JSON.stringify(cachedRecords));
    }
    context.after(() => dom.window.close());
    return { dom, window: dom.window, doc: dom.window.document, storage: dom.window.localStorage };
}

function submitTopiMessage(window, doc, message) {
    const input = doc.getElementById('staff-assistant-input');
    input.value = message;
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

test('searchTebligatLocal loads cache, filters by year, ranks exact before fuzzy, and toTopiTebligatItem maps ref purely', (context) => {
    const { storage } = createStaffDom(context);
    const emptyResult = searchTebligatLocal('Ahmet', '2026', { storage });
    assert.deepEqual(emptyResult, { ready: false, records: [] });

    const records = [
        { isim: 'AHMET YILMAZ', sayfa: '24.11.2026', no: 12, isaretli: false },
        { isim: 'AHMET YILDIRIM', sayfa: '20.11.2025', no: 4, isaretli: true },
        { isim: 'AHMET KAYA', sayfa: '25.11.2026', no: 7, isaretli: false },
        { isim: 'AHMAT DEMİR', sayfa: '25.11.2026', no: 3, isaretli: false }
    ];
    storage.setItem('tebligat_excel_cache_v2', JSON.stringify(records));
    loadCacheIntoMemory(storage);

    const found2026 = searchTebligatLocal('Ahmet', '2026', { storage });
    assert.equal(found2026.ready, true);
    assert.deepEqual(found2026.records.map((entry) => entry.isim), [
        'AHMET KAYA',
        'AHMET YILMAZ',
        'AHMAT DEMİR'
    ]);

    const mapped = toTopiTebligatItem(found2026.records[0]);
    assert.deepEqual(mapped, {
        name: 'AHMET KAYA',
        sheet: '25.11.2026',
        number: '7',
        date: '25.11.2026',
        marked: false,
        ref: { sayfa: '25.11.2026', isim: 'AHMET KAYA', no: '7' }
    });
});

test('tebligat.lookup uses filled local cache immediately without network search or navigation and caps at 5 cards', async (context) => {
    const cachedRecords = [
        ...Array.from({ length: 7 }, (_, idx) => ({
            isim: `AHMET ÖĞRENCİ ${idx + 1}`,
            sayfa: `${String(10 + idx).padStart(2, '0')}.11.2026`,
            no: idx + 1,
            isaretli: idx === 6
        })),
        { isim: 'AHMET ESKİ', sayfa: '15.11.2025', no: 99, isaretli: false }
    ];
    const { window, doc } = createStaffDom(context, { cachedRecords });

    let tebligNavClicks = 0;
    let toggleClicks = 0;
    doc.querySelector('button[data-workspace-view="teblig"]').addEventListener('click', () => {
        tebligNavClicks += 1;
    });
    doc.getElementById('tebligat-search-toggle').addEventListener('click', () => {
        toggleClicks += 1;
    });

    const requests = [];
    const fetcher = async (url, options) => {
        requests.push({ url: String(url), method: options?.method || 'GET' });
        if (url === '/api/staff/assistant') {
            return createJsonResponse({
                reply: '"Ahmet" için tebliğ kayıtlarına bakıyorum.',
                state: 'understood',
                action: { type: 'tebligat.lookup', query: 'Ahmet' }
            });
        }
        throw new Error(`Unexpected fetch: ${url}`);
    };

    const controller = initializeStaffAssistant({
        root: doc,
        fetcher,
        now: () => Date.parse('2026-11-25T10:00:00.000Z')
    });
    context.after(() => controller.destroy());
    controller.open();

    submitTopiMessage(window, doc, 'Ahmet tebligat bul');
    await flushPromises();

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/staff/assistant');
    assert.equal(tebligNavClicks, 0);
    assert.equal(toggleClicks, 0);
    assert.equal(doc.getElementById('tebligat-search-input').value, '');

    const log = doc.querySelector('[role="log"]');
    const cards = log.querySelectorAll('.staff-assistant-result-item');
    assert.equal(cards.length, 5);
    assert.match(log.textContent, /"Ahmet" için 2026 yılında 7 kayıt buldum; ilk 5'ini gösteriyorum; adı ve soyadıyla daraltın\./);
    assert.match(log.textContent, /Toplam 7 \(ilk 5\)/);
    assert.match(cards[0].textContent, /AHMET ÖĞRENCİ 7/);
    assert.match(cards[0].textContent, /İşaretlendi/);
    assert.equal(log.textContent.includes('AHMET ESKİ'), false);
});

test('tebligat.lookup uses Europe/Istanbul year across UTC midnight boundary', async (context) => {
    const cachedRecords = [
        { isim: 'KAGAN SAMET', sayfa: '01.01.2027', no: 5, isaretli: false },
        { isim: 'KAGAN ESKI', sayfa: '30.12.2026', no: 2, isaretli: false }
    ];
    const { window, doc } = createStaffDom(context, { cachedRecords });

    const fetcher = async () => createJsonResponse({
        reply: '"Kagan" için tebliğ kayıtlarına bakıyorum.',
        state: 'understood',
        action: { type: 'tebligat.lookup', query: 'Kagan' }
    });

    // 2026-12-31T21:30:00Z is 2027-01-01T00:30:00+03:00 in Europe/Istanbul.
    const controller = initializeStaffAssistant({
        root: doc,
        fetcher,
        now: () => Date.parse('2026-12-31T21:30:00.000Z')
    });
    context.after(() => controller.destroy());
    controller.open();

    submitTopiMessage(window, doc, "Kagan'ın tebliğine bak");
    await flushPromises();

    const logText = doc.querySelector('[role="log"]').textContent;
    assert.match(logText, /"Kagan" için 2027 yılında 1 kayıt buldum\./);
    assert.match(logText, /KAGAN SAMET/);
    assert.equal(logText.includes('KAGAN ESKI'), false);
});

test('tebligat.lookup falls back to exactly one /api/search-tebligat request when cache is empty', async (context) => {
    const { window, doc, storage } = createStaffDom(context);
    storage.setItem('tebligat_marked_24.11.2026-<script>alert(1)</script> MEHMET-12', 'true');

    const requests = [];
    const fetcher = async (url) => {
        requests.push(String(url));
        if (url === '/api/staff/assistant') {
            return createJsonResponse({
                reply: '"Mehmet" için tebliğ kayıtlarına bakıyorum.',
                state: 'understood',
                action: { type: 'tebligat.lookup', query: 'Mehmet' }
            });
        }
        if (String(url).startsWith('/api/search-tebligat?')) {
            return createJsonResponse({
                success: true,
                results: [
                    { isim: '<script>alert(1)</script> MEHMET', sayfa: '24.11.2026', no: 12, isaretli: false },
                    { isim: 'MEHMET ESKİ', sayfa: '24.11.2025', no: 3, isaretli: false }
                ]
            });
        }
        throw new Error(`Unexpected URL: ${url}`);
    };

    const controller = initializeStaffAssistant({
        root: doc,
        fetcher,
        now: () => Date.parse('2026-11-25T10:00:00.000Z')
    });
    context.after(() => controller.destroy());
    controller.open();

    submitTopiMessage(window, doc, 'Mehmet tebligat bul');
    await flushPromises();

    const searchRequests = requests.filter((url) => url.startsWith('/api/search-tebligat?'));
    assert.equal(searchRequests.length, 1);
    assert.equal(searchRequests[0], '/api/search-tebligat?q=Mehmet&year=2026');

    const log = doc.querySelector('[role="log"]');
    assert.equal(log.querySelector('script'), null);
    assert.match(log.textContent, /Bulut verisi henüz yüklenmedi; canlı arama yapılıyor, biraz sürebilir\./);
    assert.match(log.textContent, /"Mehmet" için 2026 yılında 1 kayıt buldum\./);
    assert.match(log.textContent, /<script>alert\(1\)<\/script> MEHMET/);
    assert.match(log.textContent, /İşaretlendi/);
    assert.equal(log.textContent.includes('MEHMET ESKİ'), false);
});

test('tebligat.lookup shows calm error message without raw error details when network search fails', async (context) => {
    const { window, doc } = createStaffDom(context);

    const fetcher = async (url) => {
        if (url === '/api/staff/assistant') {
            return createJsonResponse({
                reply: '"Mehmet" için tebliğ kayıtlarına bakıyorum.',
                state: 'understood',
                action: { type: 'tebligat.lookup', query: 'Mehmet' }
            });
        }
        throw new Error('SECRET_NETWORK_ERROR https://internal.script.local');
    };

    const controller = initializeStaffAssistant({
        root: doc,
        fetcher,
        now: () => Date.parse('2026-11-25T10:00:00.000Z')
    });
    context.after(() => controller.destroy());
    controller.open();

    submitTopiMessage(window, doc, 'Mehmet tebligat bul');
    await flushPromises();

    const logText = doc.querySelector('[role="log"]').textContent;
    assert.match(logText, /Tebliğ verisine şu anda ulaşamadım; Tebliğ Bul ekranını deneyin\./);
    assert.equal(logText.includes('SECRET_NETWORK_ERROR'), false);
    assert.equal(logText.includes('internal.script.local'), false);
});

test('card mark and unmark confirmation flow requires Evet, disables buttons during flight, updates badge, and rolls back on failure', async (context) => {
    const cachedRecords = [
        { isim: 'AYŞE YILMAZ', sayfa: '24.11.2026', no: '19', isaretli: false }
    ];
    const { window, doc, storage } = createStaffDom(context, { cachedRecords });

    let nextMarkResult = createJsonResponse({ success: true });
    let resolvePendingFetch = null;
    const mutationRequests = [];

    const fetcher = async (url, options) => {
        if (url === '/api/staff/assistant') {
            return createJsonResponse({
                reply: '"Ayşe" için tebliğ kayıtlarına bakıyorum.',
                state: 'understood',
                action: { type: 'tebligat.lookup', query: 'Ayşe' }
            });
        }
        mutationRequests.push({ url, method: options?.method, body: JSON.parse(options?.body || '{}') });
        if (resolvePendingFetch) {
            return new Promise((resolve) => {
                resolvePendingFetch = resolve;
            });
        }
        return nextMarkResult;
    };

    const controller = initializeStaffAssistant({
        root: doc,
        fetcher,
        now: () => Date.parse('2026-11-25T10:00:00.000Z')
    });
    context.after(() => controller.destroy());
    controller.open();

    submitTopiMessage(window, doc, 'Ayşe tebligat bul');
    await flushPromises();

    const card = doc.querySelector('.staff-assistant-result-item');
    const toggleBtn = card.querySelector('.staff-assistant-tebligat-toggle');
    const statusBadge = card.querySelector('.staff-assistant-tebligat-status');
    assert.equal(toggleBtn.textContent, 'İşaretle');
    assert.match(toggleBtn.getAttribute('aria-label'), /AYŞE YILMAZ/);
    assert.equal(statusBadge.textContent, 'İşaretlenmedi');

    // Vazgeç does nothing
    toggleBtn.click();
    const confirmRow1 = card.querySelector('.staff-assistant-tebligat-confirm');
    assert.ok(confirmRow1);
    assert.match(confirmRow1.textContent, /AYŞE YILMAZ kaydı işaretlensin mi\?/);
    confirmRow1.querySelector('.staff-assistant-tebligat-confirm-no').click();
    assert.equal(card.querySelector('.staff-assistant-tebligat-confirm'), null);
    assert.equal(mutationRequests.length, 0);

    // Failure on Evet leaves card unchanged and rolls back localStorage
    nextMarkResult = createJsonResponse({ success: false }, 500);
    toggleBtn.click();
    const confirmRowFail = card.querySelector('.staff-assistant-tebligat-confirm');
    const yesFail = confirmRowFail.querySelector('.staff-assistant-tebligat-confirm-yes');
    const cancelFail = confirmRowFail.querySelector('.staff-assistant-tebligat-confirm-no');
    yesFail.click();
    await flushPromises();

    assert.equal(mutationRequests.length, 1);
    assert.equal(mutationRequests[0].url, '/api/update-tebligat');
    assert.equal(statusBadge.textContent, 'İşaretlenmedi');
    assert.equal(toggleBtn.textContent, 'İşaretle');
    assert.equal(toggleBtn.disabled, false);
    assert.equal(yesFail.disabled, false);
    assert.equal(cancelFail.disabled, false);
    assert.equal(storage.getItem('tebligat_marked_24.11.2026-AYŞE YILMAZ-19'), null);
    assert.match(doc.querySelector('[role="log"]').textContent, /İşaretleme tamamlanamadı\. Tekrar deneyin\./);

    // Retry Evet succeeds; verify buttons are disabled while pending
    resolvePendingFetch = true;
    yesFail.click();
    assert.equal(yesFail.disabled, true);
    assert.equal(cancelFail.disabled, true);
    assert.equal(toggleBtn.disabled, true);

    const pendingResolver = resolvePendingFetch;
    resolvePendingFetch = null;
    pendingResolver(createJsonResponse({ success: true }));
    await flushPromises();

    assert.equal(mutationRequests.length, 2);
    assert.deepEqual(mutationRequests[1], {
        url: '/api/update-tebligat',
        method: 'POST',
        body: { sayfa: '24.11.2026', isim: 'AYŞE YILMAZ', no: '19' }
    });
    assert.equal(statusBadge.textContent, 'İşaretlendi');
    assert.equal(statusBadge.classList.contains('is-marked'), true);
    assert.equal(toggleBtn.textContent, 'İşareti kaldır');
    assert.match(toggleBtn.getAttribute('aria-label'), /AYŞE YILMAZ/);
    assert.equal(toggleBtn.disabled, false);
    assert.equal(card.querySelector('.staff-assistant-tebligat-confirm'), null);
    assert.equal(storage.getItem('tebligat_marked_24.11.2026-AYŞE YILMAZ-19'), 'true');
    assert.match(doc.querySelector('[role="log"]').textContent, /İşaretlendi\./);

    // Unmark confirmation flow
    nextMarkResult = createJsonResponse({ success: true });
    toggleBtn.click();
    const unmarkConfirm = card.querySelector('.staff-assistant-tebligat-confirm');
    assert.match(unmarkConfirm.textContent, /AYŞE YILMAZ kaydının işareti kaldırılsın mı\?/);
    unmarkConfirm.querySelector('.staff-assistant-tebligat-confirm-yes').click();
    await flushPromises();

    assert.equal(mutationRequests.length, 3);
    assert.deepEqual(mutationRequests[2], {
        url: '/api/unmark-tebligat',
        method: 'POST',
        body: { sayfa: '24.11.2026', isim: 'AYŞE YILMAZ', no: '19' }
    });
    assert.equal(statusBadge.textContent, 'İşaretlenmedi');
    assert.equal(toggleBtn.textContent, 'İşaretle');
    assert.equal(storage.getItem('tebligat_marked_24.11.2026-AYŞE YILMAZ-19'), null);
    assert.match(doc.querySelector('[role="log"]').textContent, /İşaret kaldırıldı\./);
});

test('NL işaretle sends to server when no list exists, opens confirmation on 1 result, and asks which on 2+ results', async (context) => {
    const cachedRecords = [
        { isim: 'TEK KİŞİ', sayfa: '24.11.2026', no: '1', isaretli: false },
        { isim: 'İKİLİ BİR', sayfa: '24.11.2026', no: '2', isaretli: false },
        { isim: 'İKİLİ İKİ', sayfa: '24.11.2026', no: '3', isaretli: false }
    ];
    const { window, doc } = createStaffDom(context, { cachedRecords });

    const assistantCalls = [];
    const updateCalls = [];
    const fetcher = async (url, options) => {
        const body = JSON.parse(options?.body || '{}');
        if (url === '/api/staff/assistant') {
            assistantCalls.push(body.message);
            if (body.message.includes('Tek')) {
                return createJsonResponse({
                    reply: '"Tek" için tebliğ kayıtlarına bakıyorum.',
                    state: 'understood',
                    action: { type: 'tebligat.lookup', query: 'Tek' }
                });
            }
            if (body.message.includes('İkili')) {
                return createJsonResponse({
                    reply: '"İkili" için tebliğ kayıtlarına bakıyorum.',
                    state: 'understood',
                    action: { type: 'tebligat.lookup', query: 'İkili' }
                });
            }
            return createJsonResponse({
                reply: 'Bu işlemi yapamam.',
                state: 'confused'
            });
        }
        if (url === '/api/update-tebligat') {
            updateCalls.push(body);
            return createJsonResponse({ success: true });
        }
        throw new Error(`Unexpected URL: ${url}`);
    };

    const controller = initializeStaffAssistant({
        root: doc,
        fetcher,
        now: () => Date.parse('2026-11-25T10:00:00.000Z')
    });
    context.after(() => controller.destroy());
    controller.open();

    // 0) No result list yet -> goes to server
    submitTopiMessage(window, doc, 'bunu işaretle');
    await flushPromises();
    assert.deepEqual(assistantCalls, ['bunu işaretle']);

    // 1) Search yielding 1 result, then NL "işaretle" -> opens confirmation without server call
    submitTopiMessage(window, doc, 'Tek tebligat bul');
    await flushPromises();
    assert.equal(assistantCalls.length, 2);

    submitTopiMessage(window, doc, 'İşaretle');
    await flushPromises();
    assert.equal(assistantCalls.length, 2);
    assert.equal(updateCalls.length, 0);

    const confirmRow = doc.querySelector('.staff-assistant-tebligat-confirm');
    assert.ok(confirmRow);
    assert.match(confirmRow.textContent, /TEK KİŞİ kaydı işaretlensin mi\?/);
    assert.match(doc.querySelector('[role="log"]').textContent, /TEK KİŞİ kaydını işaretlemek için onaylayın\./);

    // 2) Search yielding 2 results, then NL "işaretle" -> asks which without server call
    submitTopiMessage(window, doc, 'İkili tebligat bul');
    await flushPromises();
    assert.equal(assistantCalls.length, 3);

    submitTopiMessage(window, doc, 'bunu işaretler misin');
    await flushPromises();
    assert.equal(assistantCalls.length, 3);
    assert.match(
        doc.querySelector('[role="log"]').textContent,
        /Hangisini işaretleyeyim\? Kartın altındaki İşaretle düğmesini kullanın\./
    );
});

test('Tebliğ Bul screen mark and unmark buttons still post the same requests and roll back on failure', async (context) => {
    context.mock.timers.enable({ apis: ['setTimeout'] });

    const cachedRecords = [
        { isim: 'EKRAN ÖĞRENCİ', sayfa: '24.11.2026', no: '42', isaretli: false }
    ];
    const { window, doc, storage } = createStaffDom(context, {
        cachedRecords,
        withTebligatScreenDom: true
    });
    storage.setItem('tebligat_last_sync_time_v2', String(Date.now()));

    const prevDocument = globalThis.document;
    const prevWindow = globalThis.window;
    const prevLocalStorage = globalThis.localStorage;
    const prevFetch = globalThis.fetch;
    const prevAlert = globalThis.alert;
    let globalsRestored = false;
    const restoreGlobals = () => {
        if (globalsRestored) return;
        globalsRestored = true;
        globalThis.document = prevDocument;
        globalThis.window = prevWindow;
        if (prevLocalStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = prevLocalStorage;
        globalThis.fetch = prevFetch;
        globalThis.alert = prevAlert;
        context.mock.timers.reset();
    };
    context.after(restoreGlobals);

    const postedRequests = [];
    let shouldFailNext = false;
    globalThis.document = doc;
    globalThis.window = window;
    globalThis.localStorage = storage;
    window.showToast = () => {};
    globalThis.alert = () => {};
    globalThis.fetch = async (url, options) => {
        if (String(url).startsWith('/api/search-tebligat')) {
            return createJsonResponse({ success: true, results: [] });
        }
        postedRequests.push({
            url: String(url),
            method: options?.method,
            headers: options?.headers,
            body: JSON.parse(options?.body || '{}')
        });
        if (shouldFailNext) {
            return createJsonResponse({ success: false }, 500);
        }
        return createJsonResponse({ success: true });
    };

    initTebligatSearch();

    const searchInput = doc.getElementById('tebligat-search-input');
    searchInput.value = 'EKRAN';
    searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));

    const markBtn = doc.querySelector('#tebligat-search-results .btn-mark-tebligat');
    const unmarkBtn = doc.querySelector('#tebligat-search-results .btn-unmark-tebligat');
    assert.ok(markBtn);
    assert.ok(unmarkBtn);

    markBtn.click();
    await flushImmediate();

    assert.equal(postedRequests.length, 1);
    assert.deepEqual(postedRequests[0], {
        url: '/api/update-tebligat',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { sayfa: '24.11.2026', isim: 'EKRAN ÖĞRENCİ', no: '42' }
    });
    assert.equal(markBtn.classList.contains('marked'), true);
    assert.equal(storage.getItem('tebligat_marked_24.11.2026-EKRAN ÖĞRENCİ-42'), 'true');

    // Failure on unmark rolls back to marked
    shouldFailNext = true;
    unmarkBtn.click();
    await flushImmediate();

    assert.equal(postedRequests.length, 2);
    assert.deepEqual(postedRequests[1], {
        url: '/api/unmark-tebligat',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { sayfa: '24.11.2026', isim: 'EKRAN ÖĞRENCİ', no: '42' }
    });
    assert.equal(markBtn.classList.contains('marked'), true);
    assert.equal(storage.getItem('tebligat_marked_24.11.2026-EKRAN ÖĞRENCİ-42'), 'true');

    // Success on unmark clears mark
    shouldFailNext = false;
    unmarkBtn.click();
    await flushImmediate();

    assert.equal(postedRequests.length, 3);
    assert.equal(markBtn.classList.contains('marked'), false);
    assert.equal(storage.getItem('tebligat_marked_24.11.2026-EKRAN ÖĞRENCİ-42'), null);

    // Fast-forward the 250 ms search debounce timer and drain its fetch/render chain before restoring globals
    context.mock.timers.tick(250);
    await flushImmediate();
    doc.getElementById('tebligat-search-clear')?.click();
    await flushImmediate();
    restoreGlobals();
});
