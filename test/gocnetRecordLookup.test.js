import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import test from 'node:test';
import '../ykn_eklenti-main/gocnet-transfer-controller.js';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(testDirectory, '../ykn_eklenti-main');
const portalSecuritySource = await readFile(resolve(extensionRoot, 'portal-security.js'), 'utf8');
const storageLifecycleSource = await readFile(resolve(extensionRoot, 'storage-lifecycle.js'), 'utf8');
const backgroundSource = await readFile(resolve(extensionRoot, 'background.js'), 'utf8');
const controllerSource = await readFile(resolve(extensionRoot, 'gocnet-transfer-controller.js'), 'utf8');

const { lookupGocnetRecord, parseIslemKayitNo } = globalThis.YoksisGocnetTransferController;

function evaluateSecurity() {
    const context = vm.createContext({ URL, Date, Set, Object, Number, String, Array });
    vm.runInContext(portalSecuritySource, context);
    return context.YKN_PORTAL_SECURITY;
}

function buildLookupDom(options = {}) {
    const basvuruRow = options.omitBasvuru ? '' : `
        <tr>
            <td><span class="z-label">Başvuru Kayıt No:</span></td>
            <td><input type="text" readonly value="${options.basvuruKayitNo || ''}"></td>
        </tr>
        ${options.duplicateBasvuru ? '<tr><td><span class="z-label">Başvuru Kayıt No:</span></td><td><input type="text" readonly value="999"></td></tr>' : ''}`;
    const islemRow = options.omitIslem ? '' : `
        <tr>
            <td><span class="z-label">Mevcut GöçNet İşlem Kayıt No:</span></td>
            <td class="z-hbox-separator"><img alt=""></td>
            <td><span class="z-label" data-fixture="islem-kayit-no">${options.islemText ?? '-(İşlem Henüz Başlatılmadı)-'}</span></td>
            ${options.duplicateIslem ? '<td><span class="z-label">Mevcut GöçNet İşlem Kayıt No:</span></td><td><span class="z-label">111</span></td>' : ''}
        </tr>`;
    const html = `<!doctype html><html lang="tr"><body><main>
        <section>
            <h2>1. E-İkamet Başvuru Sorgulama</h2>
            <table><tbody><tr>
                <td><span class="z-label">E-İkamet Başvuru No:</span></td>
                <td><input type="text" data-fixture="query-input" value=""></td>
                <td><button type="button" data-fixture="query-btn">Başvuru Sorgula</button></td>
            </tr></tbody></table>
        </section>
        <section>
            <h3>2. Öğrenci Bilgileri</h3>
            <table><tbody>
                ${basvuruRow}
                <tr>
                    <td><span class="z-label">İrtibat Telefonu (*):</span></td>
                    <td><input type="text" placeholder="5XXXXXXXXX" maxlength="10" value=""></td>
                </tr>
            </tbody></table>
        </section>
        <section>
            <table><tbody>${islemRow}</tbody></table>
            <button type="button" data-fixture="save-btn">İşlemi Başlat / Kaydet</button>
            <button type="button" data-fixture="upload-btn">Yükle</button>
            <input type="file" data-fixture="upload-input">
        </section>
    </main></body></html>`;
    const dom = new JSDOM(html, { url: options.url || 'https://yoksis.yok.gov.tr/menu/gocnet-iletim', runScripts: 'outside-only', pretendToBeVisual: true });
    let saveClicks = 0;
    let uploadClicks = 0;
    let uploadChanges = 0;
    dom.window.document.querySelector('[data-fixture="save-btn"]').addEventListener('click', () => { saveClicks += 1; });
    dom.window.document.querySelector('[data-fixture="upload-btn"]').addEventListener('click', () => { uploadClicks += 1; });
    dom.window.document.querySelector('[data-fixture="upload-input"]').addEventListener('change', () => { uploadChanges += 1; });
    return {
        dom,
        counts: () => ({ saveClicks, uploadClicks, uploadChanges })
    };
}

function appendDialogWithAutoClose(document, html) {
    document.body.insertAdjacentHTML('beforeend', html);
    const dialog = document.body.lastElementChild;
    const button = dialog?.querySelector('button');
    button?.addEventListener('click', () => dialog.remove());
    return dialog;
}

/** Normalize objects returned from a node:vm realm so deepStrictEqual compares values without realm-prototype mismatch. */
function normalizeCrossRealm(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

test('portal-security accepts only exact valid LOOKUP_GOCNET_RECORD payloads and rejects malformed or extra fields', () => {
    const security = evaluateSecurity();
    const valid = { action: 'LOOKUP_GOCNET_RECORD', requestId: 'lookup-1', applicationNumber: '2026-08-1234567' };
    assert.equal(security.isValidPortalMessage(valid), true);
    assert.equal(security.isValidPortalMessage({ ...valid, applicationNumber: '2026-08-12345' }), true);
    assert.equal(security.isValidPortalMessage({ ...valid, applicationNumber: '2026-08-12345678' }), true);
    assert.equal(security.isValidPortalMessage({
        ...valid,
        source: 'IKAMET_PORTAL',
        screenArea: { availLeft: 0, availTop: 0, availWidth: 1440, availHeight: 900 },
        yknViewOpen: true
    }), true);

    assert.equal(security.isValidPortalMessage({ ...valid, applicationNumber: '1999-01-1234567' }), false);
    assert.equal(security.isValidPortalMessage({ ...valid, applicationNumber: '2026-08-1234' }), false);
    assert.equal(security.isValidPortalMessage({ ...valid, applicationNumber: '2026-08-123456789' }), false);
    assert.equal(security.isValidPortalMessage({ ...valid, applicationNumber: '' }), false);
    assert.equal(security.isValidPortalMessage({ action: 'LOOKUP_GOCNET_RECORD', requestId: 'lookup-1' }), false);
    assert.equal(security.isValidPortalMessage({ ...valid, requestId: '' }), false);
    assert.equal(security.isValidPortalMessage({ ...valid, requestId: 123 }), false);

    assert.equal(security.isValidPortalMessage({ ...valid, phase: 'form' }), false);
    assert.equal(security.isValidPortalMessage({ ...valid, attemptId: '00000000-0000-4000-8000-000000000001' }), false);
    assert.equal(security.isValidPortalMessage({ ...valid, targetTabId: 42 }), false);
    assert.equal(security.isValidPortalMessage({ ...valid, extra: 'unexpected' }), false);
    assert.equal(security.isValidPortalMessage({ ...valid, source: 'OTHER_SOURCE' }), false);
});

test('parseIslemKayitNo extracts 1-12 digit record IDs strictly and returns null for unstarted or garbage text', () => {
    assert.equal(parseIslemKayitNo('85797 (TAMAMLANDI)'), '85797');
    assert.equal(parseIslemKayitNo('  70001 (İŞLEM KAYDEDİLDİ)  '), '70001');
    assert.equal(parseIslemKayitNo('85797'), '85797');
    assert.equal(parseIslemKayitNo('123456789012'), '123456789012');

    assert.equal(parseIslemKayitNo('-(İşlem Henüz Başlatılmadı)-'), null);
    assert.equal(parseIslemKayitNo('(İşlem Henüz Başlatılmadı)'), null);
    assert.equal(parseIslemKayitNo('garbage'), null);
    assert.equal(parseIslemKayitNo('85797 garbage'), null);
    assert.equal(parseIslemKayitNo('85797abc'), null);
    assert.equal(parseIslemKayitNo('85797-123'), null);
    assert.equal(parseIslemKayitNo('abc 85797'), null);
    assert.equal(parseIslemKayitNo('1234567890123 (TAMAMLANDI)'), null);
    assert.equal(parseIslemKayitNo(''), null);
    assert.equal(parseIslemKayitNo(null), null);
});

test('lookupGocnetRecord maps student_data_filled and existing_record to found, dismisses dialogs, and leaves save/upload untouched', async () => {
    const { dom, counts } = buildLookupDom();
    const { document } = dom.window;
    let queryClicks = 0;

    document.querySelector('[data-fixture="query-btn"]').addEventListener('click', () => {
        queryClicks += 1;
        const appNo = document.querySelector('[data-fixture="query-input"]').value;
        if (appNo === '2026-08-1234567') {
            document.querySelector('input[readonly]').value = '16323286';
            document.querySelector('[data-fixture="islem-kayit-no"]').textContent = '-(İşlem Henüz Başlatılmadı)-';
            appendDialogWithAutoClose(document, `<div role="dialog">
                <h2>Sorgulama Başarılı (YÖKSİS Verileri Dolduruldu)</h2>
                <p>Başvuru sorgulama başarılı.</p>
                <p>YÖKSİS veritabanından öğrencinin aktif öğrenim bilgileri bulundu ve forma otomatik dolduruldu.</p>
                <button type="button">Tamam</button>
            </div>`);
        } else {
            document.querySelector('input[readonly]').value = '16323286';
            document.querySelector('[data-fixture="islem-kayit-no"]').textContent = '85797 (TAMAMLANDI)';
            appendDialogWithAutoClose(document, `<div role="dialog">
                <h2>Sorgulama Başarılı (DB Kaydı Yüklendi)</h2>
                <p>Başvuru sorgulama başarılı. Öğrenci demografik bilgileri ve daha önceden kaydedilmiş veriler veritabanından forma yüklendi.</p>
                <button type="button">Tamam</button>
            </div>`);
        }
    });

    const first = await lookupGocnetRecord(document, '2026-08-1234567', { timeoutMs: 100 });
    assert.deepEqual(first, { state: 'found', basvuruKayitNo: '16323286' });
    assert.equal('islemKayitNo' in first, false);
    assert.equal(document.querySelector('[role="dialog"]'), null);

    const second = await lookupGocnetRecord(document, '2026-08-1234568', { timeoutMs: 100 });
    assert.deepEqual(second, { state: 'found', basvuruKayitNo: '16323286', islemKayitNo: '85797' });
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(queryClicks, 2);
    assert.deepEqual(counts(), { saveClicks: 0, uploadClicks: 0, uploadChanges: 0 });
    dom.window.close();
});

test('lookupGocnetRecord omits islemKayitNo on garbage info bar and maps no_match and unknown states safely', async () => {
    const { dom, counts } = buildLookupDom({ islemText: 'garbage text' });
    const { document } = dom.window;
    let mode = 'garbage';

    document.querySelector('[data-fixture="query-btn"]').addEventListener('click', () => {
        if (mode === 'garbage') {
            document.querySelector('input[readonly]').value = '16323286';
            appendDialogWithAutoClose(document, `<div role="dialog">
                <h2>Sorgulama Başarılı (DB Kaydı Yüklendi)</h2>
                <p>Başvuru sorgulama başarılı. Öğrenci demografik bilgileri ve daha önceden kaydedilmiş veriler veritabanından forma yüklendi.</p>
                <button type="button">Tamam</button>
            </div>`);
        } else if (mode === 'no_match') {
            appendDialogWithAutoClose(document, `<div role="dialog">
                <h2>Sorgu Hatası</h2>
                <p>Başvuru sorgulama başarısız!</p>
                <p>Hata Kodu: Veri Bulunamadı</p>
                <p>Detay: Kayıt bulunamadı</p>
                <button type="button">Tamam</button>
            </div>`);
        } else if (mode === 'unrecognized') {
            appendDialogWithAutoClose(document, '<div role="dialog"><h2>Beklenmeyen Hata</h2><p>Detay</p></div>');
        }
    });

    const garbageRes = await lookupGocnetRecord(document, '2026-08-1234567', { timeoutMs: 100 });
    assert.deepEqual(garbageRes, { state: 'found', basvuruKayitNo: '16323286' });
    assert.equal('islemKayitNo' in garbageRes, false);

    mode = 'no_match';
    const noMatchRes = await lookupGocnetRecord(document, '2099-12-99999999', { timeoutMs: 100 });
    assert.deepEqual(noMatchRes, { state: 'no_match' });
    assert.equal(document.querySelector('[role="dialog"]'), null);

    mode = 'unrecognized';
    const unrecognizedRes = await lookupGocnetRecord(document, '2099-12-99999998', { timeoutMs: 100 });
    assert.equal(unrecognizedRes.state, 'unknown');
    assert.match(unrecognizedRes.reason, /^form_result_unrecognized/);
    document.querySelector('[role="dialog"]').remove();

    mode = 'timeout';
    const timeoutRes = await lookupGocnetRecord(document, '2099-12-99999997', { timeoutMs: 30 });
    assert.deepEqual(timeoutRes, { state: 'unknown', reason: 'form_result_timeout' });

    assert.deepEqual(counts(), { saveClicks: 0, uploadClicks: 0, uploadChanges: 0 });
    dom.window.close();
});

test('lookupGocnetRecord returns unknown when Başvuru Kayıt No is missing, invalid, or ambiguous or on wrong page', async () => {
    const wrongDom = new JSDOM('<main><h2>YÖKSİS Ana Menü</h2></main>', { pretendToBeVisual: true });
    const wrongRes = await lookupGocnetRecord(wrongDom.window.document, '2026-08-1234567', { timeoutMs: 30 });
    assert.deepEqual(wrongRes, { state: 'unknown', reason: 'form_controls_missing' });
    wrongDom.window.close();

    for (const [label, opts, expectedReason] of [
        ['missing', { omitBasvuru: true }, 'basvuru_kayit_no_missing'],
        ['invalid', { basvuruKayitNo: 'ABC-123' }, 'basvuru_kayit_no_invalid'],
        ['duplicate basvuru', { basvuruKayitNo: '16323286', duplicateBasvuru: true }, 'ambiguous_fields'],
        ['duplicate islem', { basvuruKayitNo: '16323286', duplicateIslem: true }, 'ambiguous_fields']
    ]) {
        const { dom } = buildLookupDom(opts);
        dom.window.document.querySelector('[data-fixture="query-btn"]').addEventListener('click', () => {
            appendDialogWithAutoClose(dom.window.document, `<div role="dialog">
                <h2>Sorgulama Başarılı (YÖKSİS Verileri Dolduruldu)</h2>
                <p>Başvuru sorgulama başarılı.</p>
                <p>YÖKSİS veritabanından öğrencinin aktif öğrenim bilgileri bulundu ve forma otomatik dolduruldu.</p>
                <button type="button">Tamam</button>
            </div>`);
        });
        const res = await lookupGocnetRecord(dom.window.document, '2026-08-1234567', { timeoutMs: 100 });
        assert.equal(res.state, 'unknown', label);
        assert.equal(res.reason, expectedReason, label);
        dom.window.close();
    }
});

test('controller listener returns busy when a transfer context is active and never triggers save or upload', async () => {
    const { dom, counts } = buildLookupDom();
    const { window } = dom;
    let messageListener = null;
    const zkCommands = [];

    window.chrome = {
        runtime: {
            id: 'test-extension-id',
            onMessage: { addListener(listener) { messageListener = listener; } },
            sendMessage: async (message) => {
                zkCommands.push(message);
                if (message?.action === 'YOKSIS_ZK_COMMAND' && message.command?.action === 'queryGocnetForm') {
                    window.document.querySelector('[data-fixture="query-input"]').value = message.command.applicationNumber;
                    window.document.querySelector('input[readonly]').value = '16323286';
                    appendDialogWithAutoClose(window.document, `<div role="dialog">
                        <h2>Sorgulama Başarılı (YÖKSİS Verileri Dolduruldu)</h2>
                        <p>Başvuru sorgulama başarılı.</p>
                        <p>YÖKSİS veritabanından öğrencinin aktif öğrenim bilgileri bulundu ve forma otomatik dolduruldu.</p>
                        <button type="button">Tamam</button>
                    </div>`);
                    return { success: true, freshResponse: true };
                }
                return { success: false };
            }
        }
    };

    vm.runInContext(controllerSource, dom.getInternalVMContext());
    assert.ok(messageListener, 'controller listener should register');

    const dispatch = (msg) => new Promise((resolveResponse) => {
        let settled = false;
        let response;
        let returned = false;
        const asyncKeepOpen = messageListener(msg, { id: 'test-extension-id' }, (val) => {
            settled = true;
            response = val;
            if (returned) resolveResponse({ asyncKeepOpen, response });
        });
        returned = true;
        if (settled || !asyncKeepOpen) resolveResponse({ asyncKeepOpen, response });
    });

    const lookupOk = await dispatch({
        action: 'YOKSIS_GOCNET_LOOKUP',
        requestId: 'lookup-ok-1',
        portalTabId: 7,
        applicationNumber: '2026-08-1234567'
    });
    assert.equal(lookupOk.asyncKeepOpen, true);
    assert.deepStrictEqual(normalizeCrossRealm(lookupOk.response), {
        requestId: 'lookup-ok-1',
        state: 'found',
        basvuruKayitNo: '16323286'
    });

    await new Promise((r) => setTimeout(r, 0));

    // Start a transfer context via YOKSIS_GOCNET_QUERY (form phase)
    const queryRes = await dispatch({
        action: 'YOKSIS_GOCNET_QUERY',
        phase: 'form',
        requestId: 'transfer-q-1',
        portalTabId: 7,
        attemptId: '00000000-0000-4000-8000-000000000001',
        applicationNumber: '2026-08-1234567'
    });
    assert.equal(queryRes.response.state, 'student_data_filled');

    const busyRes = await dispatch({
        action: 'YOKSIS_GOCNET_LOOKUP',
        requestId: 'lookup-busy-1',
        portalTabId: 7,
        applicationNumber: '2026-08-1234568'
    });
    assert.equal(busyRes.asyncKeepOpen, false);
    assert.deepStrictEqual(normalizeCrossRealm(busyRes.response), {
        requestId: 'lookup-busy-1',
        state: 'unknown',
        reason: 'busy'
    });
    assert.equal(zkCommands.length, 2);
    assert.deepEqual(counts(), { saveClicks: 0, uploadClicks: 0, uploadChanges: 0 });
    dom.window.close();
});

test('background LOOKUP_GOCNET_RECORD enforces portal origin/payload, routes read-only lookup, and validates returned digits', async () => {
    const messageListeners = [];
    const sentTabMessages = [];
    const logs = [];
    let controllerReply = { requestId: 'req-1', state: 'found', basvuruKayitNo: '16323286', islemKayitNo: '85797' };

    const context = vm.createContext({
        URL, Date, Set, Map, Object, Number, String, Array, Promise,
        setTimeout, clearTimeout, setInterval, clearInterval,
        console: {
            info: (...args) => logs.push(JSON.stringify(args)),
            warn: (...args) => logs.push(JSON.stringify(args)),
            error: (...args) => logs.push(JSON.stringify(args))
        },
        chrome: {
            runtime: {
                lastError: null,
                onStartup: { addListener() {} },
                onInstalled: { addListener() {} },
                onMessage: { addListener(listener) { messageListeners.push(listener); } },
                getManifest: () => ({
                    content_scripts: [{
                        matches: ['https://portal.example.edu/*', 'http://localhost/*'],
                        js: ['portal-security.js', 'bridge.js']
                    }]
                }),
                getPlatformInfo: (cb) => cb?.({})
            },
            storage: {
                local: { get: (_k, cb) => cb?.({}), set: (_v, cb) => cb?.(), remove: (_k, cb) => cb?.() },
                session: { get: (_k, cb) => cb?.({}), set: (_v, cb) => cb?.(), remove: (_k, cb) => cb?.() }
            },
            tabs: {
                onUpdated: { addListener() {} },
                query: (_q, cb) => cb([{ id: 77, url: 'https://yoksis.yok.gov.tr/menu/gocnet.zul' }]),
                get: (tabId, cb) => cb({ id: tabId, url: 'https://yoksis.yok.gov.tr/menu/gocnet.zul' }),
                sendMessage: (tabId, msg, optionsOrCb, maybeCb) => {
                    const cb = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
                    sentTabMessages.push({ tabId, msg });
                    cb(controllerReply);
                }
            },
            scripting: { executeScript: async () => [] }
        }
    });
    context.globalThis = context;
    vm.runInContext(portalSecuritySource, context);
    vm.runInContext(storageLifecycleSource, context);
    vm.runInContext(backgroundSource, context);

    const listener = messageListeners[0];
    assert.equal(typeof listener, 'function');

    const dispatchFromPortal = (msg, senderUrl = 'https://portal.example.edu/yetkili/') => new Promise((resolveResponse) => {
        let settled = false;
        let response;
        let returned = false;
        const asyncKeepOpen = listener(
            msg,
            { tab: { id: 12, url: senderUrl }, frameId: 0 },
            (value) => {
                settled = true;
                response = normalizeCrossRealm(value);
                if (returned) resolveResponse({ asyncKeepOpen, response });
            }
        );
        returned = true;
        if (settled || !asyncKeepOpen) resolveResponse({ asyncKeepOpen, response });
    });

    const evilOrigin = await dispatchFromPortal({
        source: 'IKAMET_PORTAL',
        action: 'LOOKUP_GOCNET_RECORD',
        requestId: 'req-evil',
        applicationNumber: '2026-08-1234567'
    }, 'https://evil.example/yetkili/');
    assert.equal(evilOrigin.asyncKeepOpen, false);
    assert.equal(evilOrigin.response.success, false);
    assert.equal(sentTabMessages.length, 0);

    const extraField = await dispatchFromPortal({
        source: 'IKAMET_PORTAL',
        action: 'LOOKUP_GOCNET_RECORD',
        requestId: 'req-extra',
        applicationNumber: '2026-08-1234567',
        phase: 'form'
    });
    assert.equal(extraField.asyncKeepOpen, false);
    assert.equal(extraField.response.success, false);
    assert.equal(sentTabMessages.length, 0);

    const validFound = await dispatchFromPortal({
        source: 'IKAMET_PORTAL',
        action: 'LOOKUP_GOCNET_RECORD',
        requestId: 'req-1',
        applicationNumber: '2026-08-1234567',
        screenArea: { availLeft: 0, availTop: 0, availWidth: 1440, availHeight: 900 },
        yknViewOpen: false
    });
    assert.equal(validFound.asyncKeepOpen, true);
    assert.deepEqual(validFound.response, {
        success: true,
        requestId: 'req-1',
        state: 'found',
        basvuruKayitNo: '16323286',
        islemKayitNo: '85797'
    });
    assert.equal(sentTabMessages.length, 1);
    assert.deepStrictEqual(normalizeCrossRealm(sentTabMessages[0]), {
        tabId: 77,
        msg: {
            action: 'YOKSIS_GOCNET_LOOKUP',
            requestId: 'req-1',
            portalTabId: 12,
            applicationNumber: '2026-08-1234567'
        }
    });

    controllerReply = { requestId: 'req-2', state: 'no_match' };
    const noMatch = await dispatchFromPortal({
        source: 'IKAMET_PORTAL',
        action: 'LOOKUP_GOCNET_RECORD',
        requestId: 'req-2',
        applicationNumber: '2026-08-1234567'
    });
    assert.deepEqual(noMatch.response, { success: true, requestId: 'req-2', state: 'no_match' });

    controllerReply = { requestId: 'req-3', state: 'found', basvuruKayitNo: 'not-digits', islemKayitNo: '85797' };
    const badDigits = await dispatchFromPortal({
        source: 'IKAMET_PORTAL',
        action: 'LOOKUP_GOCNET_RECORD',
        requestId: 'req-3',
        applicationNumber: '2026-08-1234567'
    });
    assert.deepEqual(badDigits.response, {
        success: false,
        requestId: 'req-3',
        state: 'unknown',
        reason: 'basvuru_kayit_no_invalid'
    });

    assert.equal(logs.some((line) => line.includes('2026-08-1234567') || line.includes('16323286') || line.includes('85797')), false);
});
