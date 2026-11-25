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

const { readGocnetQueryResult } = globalThis.YoksisGocnetTransferController;

function normalizeCrossRealm(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function buildTransferDom(options = {}) {
    const phoneAttrs = options.plainPhoneInput ? '' : 'placeholder="5XXXXXXXXX" maxlength="10"';
    const html = `<!doctype html><html lang="tr"><body><main>
        <section>
            <h2>1. E-İkamet Başvuru Sorgulama</h2>
            <table><tbody><tr>
                <td><span class="z-label">E-İkamet Başvuru No:</span></td>
                <td><input type="text" data-fixture="query-input" value="${options.applicationNumber || ''}"></td>
                <td><button type="button" data-fixture="query-btn">Başvuru Sorgula</button></td>
            </tr></tbody></table>
        </section>
        <section>
            <h3>2. Öğrenci Bilgileri</h3>
            <table><tbody>
                <tr>
                    <td><span class="z-label">Başvuru Kayıt No:</span></td>
                    <td><input type="text" readonly value="16323286"></td>
                </tr>
                <tr>
                    <td><span class="z-label">Öğrenci No (*):</span></td>
                    <td><input type="text" value="250101001"></td>
                </tr>
                <tr>
                    <td><span class="z-label">Seyahat Belge No:</span></td>
                    <td><input type="text" value="P1234567"></td>
                </tr>
                <tr>
                    <td><span class="z-label">Adı:</span></td>
                    <td><input type="text" value="AYSE"></td>
                </tr>
                <tr>
                    <td><span class="z-label">Soyadı:</span></td>
                    <td><input type="text" value="DEMIR"></td>
                </tr>
                <tr>
                    <td><span class="z-label">Eğitim Kademesi (*):</span></td>
                    <td><select><option selected>Lisans</option></select></td>
                </tr>
                <tr>
                    <td><span class="z-label">Okul Kayıt Tarihi (*):</span></td>
                    <td><input type="text" value="01.09.2025"></td>
                </tr>
                <tr>
                    <td><span class="z-label">Tahmini Bitiş Tar. (*):</span></td>
                    <td><input type="text" value="01.09.2029"></td>
                </tr>
                <tr>
                    <td><span class="z-label">İrtibat Telefonu (*):</span></td>
                    <td><input type="text" ${phoneAttrs} value="" data-fixture="phone-input"></td>
                </tr>
            </tbody></table>
            <div>
                <span class="z-radio"><input type="radio" checked><label>1 = Yeni Kayıt</label></span>
            </div>
        </section>
        <section>
            <table><tbody>
                <tr>
                    <td><span class="z-label">Mevcut GöçNet İşlem Kayıt No:</span></td>
                    <td class="z-hbox-separator"><img alt=""></td>
                    <td><span class="z-label" data-fixture="islem-kayit-no">-(İşlem Henüz Başlatılmadı)-</span></td>
                </tr>
            </tbody></table>
            <button type="button" data-fixture="save-btn">İşlemi Başlat / Kaydet</button>
        </section>
    </main></body></html>`;
    const dom = new JSDOM(html, {
        url: 'https://yoksis.yok.gov.tr/menu/gocnet-iletim',
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const phoneInput = dom.window.document.querySelector('[data-fixture="phone-input"]');
    const phoneEvents = [];
    phoneInput.addEventListener('input', () => phoneEvents.push('input'));
    phoneInput.addEventListener('change', () => phoneEvents.push('change'));

    let saveClicks = 0;
    dom.window.document.querySelector('[data-fixture="save-btn"]').addEventListener('click', () => {
        saveClicks += 1;
        dom.window.document.querySelector('[data-fixture="islem-kayit-no"]').textContent = '91234';
        dom.window.document.body.insertAdjacentHTML('beforeend', `
            <div class="z-messagebox-window z-window z-window-highlighted">
                <div class="z-window-header">Başarılı</div>
                <div class="z-messagebox">İşlem kaydı GöçNet sistemine ve yerel veritabanına başarıyla kaydedildi. İşlem Kayıt No: 91234</div>
                <button type="button" class="z-messagebox-button z-button">Tamam</button>
            </div>`);
    });

    return {
        dom,
        phoneInput,
        phoneEvents,
        getSaveClicks: () => saveClicks
    };
}

function appendQueryDialog(document, html, onTamamClick) {
    document.body.insertAdjacentHTML('beforeend', html);
    const dialog = document.body.lastElementChild;
    const button = dialog?.querySelector('button');
    button?.addEventListener('click', () => {
        onTamamClick?.();
        dialog.remove();
    });
    return dialog;
}

function dispatchMessage(listener, message) {
    return new Promise((resolveResponse) => {
        let settled = false;
        let response;
        let returned = false;
        const asyncKeepOpen = listener(message, { id: 'test-extension-id' }, (value) => {
            settled = true;
            response = normalizeCrossRealm(value);
            if (returned) resolveResponse({ asyncKeepOpen, response });
        });
        returned = true;
        if (settled || !asyncKeepOpen) resolveResponse({ asyncKeepOpen, response });
    });
}

test('readGocnetQueryResult accepts both YÖKSİS success header spellings and the body text, and rejects non-success texts', () => {
    const { dom } = buildTransferDom({ applicationNumber: '2026-08-1234567' });
    const { document } = dom.window;

    const assertDialogState = (html, expectedState, label) => {
        const dialog = appendQueryDialog(document, html);
        try {
            assert.equal(readGocnetQueryResult(document, '2026-08-1234567'), expectedState, label);
        } finally {
            dialog.remove();
        }
    };

    assertDialogState(`<div class="z-messagebox-window">
        <div class="z-window-header">Sorgulama Başarılı (YÖKSİS Verileri Doldurudu)</div>
        <div class="z-messagebox">Başvuru sorgulama başarılı. YÖKSİS veritabanından öğrencinin aktif öğrenim bilgileri bulundu ve forma otomatik dolduruldu.</div>
        <button type="button">Tamam</button>
    </div>`, 'student_data_filled', 'live typo header + body');

    assertDialogState(`<div class="z-messagebox-window">
        <div class="z-window-header">Sorgulama Başarılı (YÖKSİS Verileri Dolduruldu)</div>
        <div class="z-messagebox">Başvuru sorgulama başarılı. YÖKSİS veritabanından öğrencinin aktif öğrenim bilgileri bulundu ve forma otomatik dolduruldu.</div>
        <button type="button">Tamam</button>
    </div>`, 'student_data_filled', 'standard header + body');

    assertDialogState(`<div class="z-messagebox-window">
        <div class="z-window-header">Sorgulama Başarılı (YÖKSİS Verileri Doldurudu)</div>
        <button type="button">Tamam</button>
    </div>`, 'unknown', 'live typo header alone');

    assertDialogState(`<div class="z-messagebox-window">
        <div class="z-window-header">Sorgulama Başarılı (YÖKSİS Verileri Dolduruldu)</div>
        <button type="button">Tamam</button>
    </div>`, 'unknown', 'standard header alone');

    assertDialogState(`<div class="z-messagebox-window">
        <div class="z-messagebox">Başvuru sorgulama başarılı. YÖKSİS veritabanından öğrencinin aktif öğrenim bilgileri bulundu ve forma otomatik dolduruldu.</div>
        <button type="button">Tamam</button>
    </div>`, 'unknown', 'body text alone');

    assertDialogState(`<div class="z-messagebox-window">
        <div class="z-window-header">Sorgulama Başarılı (DB Kaydı Yüklendi)</div>
        <div class="z-messagebox">Başvuru sorgulama başarılı. Öğrenci demografik bilgileri ve daha önceden kaydedilmiş veriler veritabanından forma yüklendi.</div>
        <button type="button">Tamam</button>
    </div>`, 'existing_record', 'existing_record preserved');

    assertDialogState(`<div class="z-messagebox-window">
        <div class="z-window-header">Sorgu Hatası</div>
        <div class="z-messagebox">Başvuru sorgulama başarısız! Hata Kodu: Veri Bulunamadı Detay: Kayıt bulunamadı</div>
        <button type="button">Tamam</button>
    </div>`, 'no_match', 'no_match preserved');

    assertDialogState(`<div class="z-messagebox-window">
        <div class="z-window-header">Sorgu Hatası</div>
        <div class="z-messagebox">Başvuru sorgulama başarısız! YÖKSİS veritabanından öğrencinin aktif öğrenim bilgileri forma doldurulamadı.</div>
        <button type="button">Tamam</button>
    </div>`, 'unknown', 'failure containing doldurulamadı rejected');

    assertDialogState(`<div class="z-messagebox-window">
        <div class="z-window-header">Sorgulama Başarılı</div>
        <button type="button">Tamam</button>
    </div>`, 'unknown', 'generic header without fill keys rejected');

    assertDialogState(`<div class="z-messagebox-window">
        <div class="z-window-header">Sorgulama Başarılı (YÖKSİS Verileri Bulunamadı)</div>
        <button type="button">Tamam</button>
    </div>`, 'unknown', 'non-fill success header rejected');

    assertDialogState(`<div class="z-messagebox-window">
        <div class="z-window-header">Sistem Uyarısı</div>
        <div class="z-messagebox">İşlem tamamlanamadı.</div>
        <button type="button">Tamam</button>
    </div>`, 'unknown', 'unrelated warning rejected');

    dom.window.close();
});

test('YOKSIS_GOCNET_QUERY recognises live Doldurudu success dialog and clicks Tamam', async () => {
    const { dom } = buildTransferDom();
    const { window } = dom;
    let messageListener = null;
    let tamamClicks = 0;

    window.chrome = {
        runtime: {
            id: 'test-extension-id',
            onMessage: { addListener(listener) { messageListener = listener; } },
            sendMessage: async (message) => {
                if (message?.action === 'YOKSIS_ZK_COMMAND' && message.command?.action === 'queryGocnetForm') {
                    window.document.querySelector('[data-fixture="query-input"]').value = message.command.applicationNumber;
                    appendQueryDialog(window.document, `<div class="z-messagebox-window z-window z-window-highlighted">
                        <div class="z-window-header">Sorgulama Başarılı (YÖKSİS Verileri Doldurudu)</div>
                        <div class="z-messagebox">Başvuru sorgulama başarılı. YÖKSİS veritabanından öğrencinin aktif öğrenim bilgileri bulundu ve forma otomatik dolduruldu.</div>
                        <button type="button" class="z-messagebox-button z-button">Tamam</button>
                    </div>`, () => { tamamClicks += 1; });
                    return { success: true, freshResponse: true };
                }
                return { success: false };
            }
        }
    };

    vm.runInContext(controllerSource, dom.getInternalVMContext());
    assert.ok(messageListener);

    const queryRes = await dispatchMessage(messageListener, {
        action: 'YOKSIS_GOCNET_QUERY',
        phase: 'form',
        requestId: 'query-doldurudu-1',
        portalTabId: 7,
        attemptId: '00000000-0000-4000-8000-000000000001',
        applicationNumber: '2026-08-1234567'
    });

    assert.equal(queryRes.asyncKeepOpen, true);
    assert.deepEqual(queryRes.response, {
        requestId: 'query-doldurudu-1',
        state: 'student_data_filled'
    });
    assert.equal(tamamClicks, 1);
    assert.equal(window.document.querySelector('.z-messagebox-window'), null);
    dom.window.close();
});

test('saveGocnetRecord writes and verifies a valid 10-digit national phone and rejects invalid or missing phones without writing or logging values', async () => {
    for (const plainPhoneInput of [false, true]) {
        const { dom, phoneInput, phoneEvents, getSaveClicks } = buildTransferDom({ plainPhoneInput });
        const { window } = dom;
        const logs = [];
        let messageListener = null;
        const attemptId = plainPhoneInput
            ? '00000000-0000-4000-8000-000000000002'
            : '00000000-0000-4000-8000-000000000003';

        window.console = {
            info: (...args) => logs.push(JSON.stringify(args)),
            warn: (...args) => logs.push(JSON.stringify(args)),
            error: (...args) => logs.push(JSON.stringify(args))
        };
        window.chrome = {
            runtime: {
                id: 'test-extension-id',
                onMessage: { addListener(listener) { messageListener = listener; } },
                sendMessage: async (message) => {
                    if (message?.action === 'YOKSIS_ZK_COMMAND' && message.command?.action === 'queryGocnetForm') {
                        window.document.querySelector('[data-fixture="query-input"]').value = message.command.applicationNumber;
                        appendQueryDialog(window.document, `<div class="z-messagebox-window">
                            <div class="z-window-header">Sorgulama Başarılı (YÖKSİS Verileri Doldurudu)</div>
                            <div class="z-messagebox">Başvuru sorgulama başarılı. YÖKSİS veritabanından öğrencinin aktif öğrenim bilgileri bulundu ve forma otomatik dolduruldu.</div>
                            <button type="button" class="z-messagebox-button">Tamam</button>
                        </div>`);
                        return { success: true, freshResponse: true };
                    }
                    return { success: false };
                }
            }
        };

        vm.runInContext(controllerSource, dom.getInternalVMContext());

        const queryRes = await dispatchMessage(messageListener, {
            action: 'YOKSIS_GOCNET_QUERY',
            phase: 'form',
            requestId: 'query-save-setup',
            portalTabId: 7,
            attemptId,
            applicationNumber: '2026-08-1234567'
        });
        assert.equal(queryRes.response.state, 'student_data_filled');

        for (const [badPhone, expectedReason] of [
            [undefined, 'phone_missing'],
            [null, 'phone_missing'],
            ['', 'phone_missing'],
            ['   ', 'phone_missing'],
            ['05321234567', 'phone_invalid'],
            ['+905321234567', 'phone_invalid'],
            ['12345', 'phone_invalid'],
            ['532abc4567', 'phone_invalid']
        ]) {
            const invalidRes = await dispatchMessage(messageListener, {
                action: 'YOKSIS_GOCNET_SAVE',
                requestId: `save-invalid-${expectedReason}`,
                portalTabId: 7,
                attemptId,
                applicationNumber: '2026-08-1234567',
                studentNumber: '250101001',
                passportNumber: 'P1234567',
                firstName: 'AYSE',
                lastName: 'DEMIR',
                phoneNational: badPhone
            });
            assert.deepEqual(invalidRes.response, {
                requestId: `save-invalid-${expectedReason}`,
                state: 'unknown',
                reason: expectedReason
            });
            assert.equal(phoneInput.value, '');
            assert.equal(phoneEvents.length, 0);
            assert.equal(getSaveClicks(), 0);
        }

        // Exercise direct DOM write and verification when chrome.runtime.sendMessage is absent.
        delete window.chrome.runtime.sendMessage;
        const saveRes = normalizeCrossRealm(await window.YoksisGocnetTransferController.saveGocnetRecord(window.document, {
            attemptId,
            applicationNumber: '2026-08-1234567',
            studentNumber: '250101001',
            passportNumber: 'P1234567',
            firstName: 'AYSE',
            lastName: 'DEMIR',
            phoneNational: '5321234567'
        }));

        assert.deepEqual(saveRes, { state: 'saved', recordId: '91234' });
        assert.equal(phoneInput.value, '5321234567');
        assert.deepEqual(phoneEvents, ['input', 'change']);
        assert.equal(getSaveClicks(), 1);

        const joinedLogs = logs.join('\n');
        for (const sensitive of ['5321234567', '05321234567', '+905321234567', '12345', '532abc4567',
            '2026-08-1234567', '250101001', 'P1234567', 'AYSE', 'DEMIR', '91234']) {
            assert.equal(joinedLogs.includes(sensitive), false);
        }
        dom.window.close();
    }
});

test('YOKSIS_GOCNET_SAVE sets and verifies phone through YOKSIS_ZK_COMMAND when empty, without logging values', async () => {
    const { dom, phoneInput, getSaveClicks } = buildTransferDom();
    const { window } = dom;
    const logs = [];
    let messageListener = null;
    const zkCommands = [];
    const attemptId = '00000000-0000-4000-8000-000000000004';

    window.console = {
        info: (...args) => logs.push(JSON.stringify(args)),
        warn: (...args) => logs.push(JSON.stringify(args)),
        error: (...args) => logs.push(JSON.stringify(args))
    };
    window.chrome = {
        runtime: {
            id: 'test-extension-id',
            onMessage: { addListener(listener) { messageListener = listener; } },
            sendMessage: async (message) => {
                zkCommands.push(message?.command);
                if (message?.action === 'YOKSIS_ZK_COMMAND' && message.command?.action === 'queryGocnetForm') {
                    window.document.querySelector('[data-fixture="query-input"]').value = message.command.applicationNumber;
                    appendQueryDialog(window.document, `<div class="z-messagebox-window">
                        <div class="z-window-header">Sorgulama Başarılı (YÖKSİS Verileri Doldurudu)</div>
                        <div class="z-messagebox">Başvuru sorgulama başarılı. YÖKSİS veritabanından öğrencinin aktif öğrenim bilgileri bulundu ve forma otomatik dolduruldu.</div>
                        <button type="button" class="z-messagebox-button">Tamam</button>
                    </div>`);
                    return { success: true, freshResponse: true };
                }
                if (message?.action === 'YOKSIS_ZK_COMMAND' && message.command?.action === 'setGocnetPhone') {
                    phoneInput.value = message.command.phoneNational;
                    return { success: true, verified: true };
                }
                return { success: false };
            }
        }
    };

    vm.runInContext(controllerSource, dom.getInternalVMContext());

    await dispatchMessage(messageListener, {
        action: 'YOKSIS_GOCNET_QUERY',
        phase: 'form',
        requestId: 'query-zk-phone',
        portalTabId: 7,
        attemptId,
        applicationNumber: '2026-08-1234567'
    });

    const saveRes = await dispatchMessage(messageListener, {
        action: 'YOKSIS_GOCNET_SAVE',
        requestId: 'save-zk-phone',
        portalTabId: 7,
        attemptId,
        applicationNumber: '2026-08-1234567',
        studentNumber: '250101001',
        passportNumber: 'P1234567',
        firstName: 'AYSE',
        lastName: 'DEMIR',
        phoneNational: '5321234567'
    });

    assert.deepEqual(saveRes.response, {
        requestId: 'save-zk-phone',
        state: 'saved',
        recordId: '91234'
    });
    assert.equal(phoneInput.value, '5321234567');
    assert.equal(getSaveClicks(), 1);
    assert.equal(zkCommands.some((cmd) => cmd?.action === 'setGocnetPhone'), true);
    assert.equal(logs.join('\n').includes('5321234567'), false);
    dom.window.close();
});

test('background SAVE_GOCNET_RECORD writes valid 10-digit phone, surfaces missing/invalid/write-failed reasons, and never logs values', async () => {
    const messageListeners = [];
    const sentTabMessages = [];
    const zkExecutedCommands = [];
    const logs = [];
    let nextPhoneVerified = true;

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
                    if (msg?.action === 'YOKSIS_GOCNET_QUERY') {
                        cb({ requestId: msg.requestId, state: 'no_match' });
                        return;
                    }
                    if (msg?.action === 'YOKSIS_GOCNET_SAVE') {
                        cb({ requestId: msg.requestId, state: 'saved', recordId: '91234' });
                        return;
                    }
                    cb({ success: false });
                }
            },
            scripting: {
                executeScript: async (injection) => {
                    if (injection?.files) return [];
                    const command = injection?.args?.[0];
                    zkExecutedCommands.push(command);
                    if (command?.action === 'setGocnetPhone') {
                        return [{ result: { success: nextPhoneVerified, verified: nextPhoneVerified } }];
                    }
                    return [{ result: { success: false, verified: false } }];
                }
            }
        }
    });
    context.globalThis = context;
    vm.runInContext(portalSecuritySource, context);
    vm.runInContext(storageLifecycleSource, context);
    vm.runInContext(backgroundSource, context);

    const listener = messageListeners[0];
    assert.equal(typeof listener, 'function');

    const dispatchFromPortal = (msg) => new Promise((resolveResponse) => {
        let settled = false;
        let response;
        let returned = false;
        const asyncKeepOpen = listener(
            msg,
            { tab: { id: 12, url: 'https://portal.example.edu/yetkili/' }, frameId: 0 },
            (value) => {
                settled = true;
                response = normalizeCrossRealm(value);
                if (returned) resolveResponse({ asyncKeepOpen, response });
            }
        );
        returned = true;
        if (settled || !asyncKeepOpen) resolveResponse({ asyncKeepOpen, response });
    });

    const basePayload = {
        source: 'IKAMET_PORTAL',
        action: 'SAVE_GOCNET_RECORD',
        targetTabId: 77,
        applicationNumber: '2026-08-1234567',
        studentNumber: '250101001',
        passportNumber: 'P1234567',
        firstName: 'AYSE',
        lastName: 'DEMIR'
    };

    const missingRes = await dispatchFromPortal({
        ...basePayload,
        requestId: 'bg-save-missing',
        attemptId: '00000000-0000-4000-8000-000000000011'
    });
    assert.deepEqual(missingRes.response, {
        success: false,
        requestId: 'bg-save-missing',
        state: 'unknown',
        reason: 'phone_missing'
    });

    const invalidRes = await dispatchFromPortal({
        ...basePayload,
        requestId: 'bg-save-invalid',
        attemptId: '00000000-0000-4000-8000-000000000012',
        phoneNational: '05321234567'
    });
    assert.deepEqual(invalidRes.response, {
        success: false,
        requestId: 'bg-save-invalid',
        state: 'unknown',
        reason: 'phone_invalid'
    });
    assert.equal(sentTabMessages.length, 0);
    assert.equal(zkExecutedCommands.length, 0);

    nextPhoneVerified = false;
    const writeFailedRes = await dispatchFromPortal({
        ...basePayload,
        requestId: 'bg-save-write-failed',
        attemptId: '00000000-0000-4000-8000-000000000013',
        phoneNational: '5321234567'
    });
    assert.deepEqual(writeFailedRes.response, {
        success: false,
        requestId: 'bg-save-write-failed',
        state: 'unknown',
        reason: 'phone_write_failed',
        yoksisTabId: 77
    });
    assert.equal(sentTabMessages.some((entry) => entry.msg?.action === 'YOKSIS_GOCNET_SAVE'), false);

    nextPhoneVerified = true;
    const okRes = await dispatchFromPortal({
        ...basePayload,
        requestId: 'bg-save-ok',
        attemptId: '00000000-0000-4000-8000-000000000014',
        phoneNational: '5321234567'
    });
    assert.deepEqual(okRes.response, {
        success: true,
        requestId: 'bg-save-ok',
        state: 'saved',
        recordId: '91234',
        yoksisTabId: 77
    });
    assert.equal(zkExecutedCommands.some((cmd) => cmd?.action === 'setGocnetPhone' && cmd.phoneNational === '5321234567'), true);
    assert.equal(sentTabMessages.some((entry) => entry.msg?.action === 'YOKSIS_GOCNET_SAVE'), true);

    const joinedLogs = logs.join('\n');
    for (const sensitive of ['5321234567', '05321234567', '2026-08-1234567', '250101001', 'P1234567', 'AYSE', 'DEMIR', '91234']) {
        assert.equal(joinedLogs.includes(sensitive), false);
    }
});
