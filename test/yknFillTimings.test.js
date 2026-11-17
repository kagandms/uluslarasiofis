import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const backgroundSource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/background.js'), 'utf8');
const portalSecuritySource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/portal-security.js'), 'utf8');
const storageLifecycleSource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/storage-lifecycle.js'), 'utf8');
const htmlTemplate = readFileSync(new URL('../yetkili/index.html', import.meta.url), 'utf8');

const FILL_PHASE_KEYS = [
    'tabPrepMs',
    'readyMs',
    'fieldsMs',
    'verifyFieldsMs',
    'photoMs',
    'verifyPhotoMs',
    'completeMs',
    'totalMs'
];

/**
 * YÖKSİS doldurma süre ölçümü testleri için yapay saatli Chrome uzantı bağlamı kurar.
 */
function createFillTimingHarness(options = {}) {
    let currentNowMs = 1_700_000_000_000;
    const advanceClock = (ms) => {
        if (Number.isFinite(ms) && ms > 0) currentNowMs += ms;
    };

    class FakeDate extends Date {
        constructor(...args) {
            if (args.length === 0) super(currentNowMs);
            else super(...args);
        }

        static now() {
            return currentNowMs;
        }
    }

    const delays = {
        tabUpdateMs: 0,
        windowFocusMs: 0,
        readyMs: 0,
        fieldsMs: 0,
        verifyFieldsMs: 0,
        photoMs: 0,
        verifyPhotoMs: 0,
        completeMs: 0,
        ...(options.delays || {})
    };

    const calls = [];
    let messageHandler = null;
    let verifyCallCount = 0;
    const portalWindowId = options.portalWindowId ?? 10;
    const portalTabId = options.portalTabId ?? 1;
    const yoksisWindowId = options.yoksisWindowId ?? 20;
    const storageValues = { ...(options.localStorage || {}) };
    const sessionStorage = { ...(options.sessionStorage || {}) };
    const windows = new Map([
        [portalWindowId, { id: portalWindowId, state: 'normal', focused: true }],
        [yoksisWindowId, { id: yoksisWindowId, state: 'normal', focused: false }]
    ]);
    const tabs = [
        { id: portalTabId, url: 'http://localhost:5173/yetkili/', active: true, windowId: portalWindowId },
        { id: 42, url: 'https://yoksis.yok.gov.tr/student', active: false, windowId: yoksisWindowId }
    ];

    const chrome = {
        runtime: {
            lastError: null,
            getManifest() {
                return {
                    content_scripts: [{ js: ['bridge.js'], matches: ['http://localhost/*', 'http://127.0.0.1/*'] }]
                };
            },
            onStartup: { addListener() {} },
            onInstalled: { addListener() {} },
            onMessage: {
                addListener(handler) {
                    messageHandler = handler;
                }
            }
        },
        storage: {
            session: {
                set(values, callback) {
                    Object.assign(sessionStorage, values);
                    callback();
                },
                get(key, callback) {
                    callback({ [key]: sessionStorage[key] });
                },
                remove(key, callback) {
                    delete sessionStorage[key];
                    callback();
                }
            },
            local: {
                set(values, callback) {
                    Object.assign(storageValues, values);
                    callback();
                },
                get(_keys, callback) {
                    callback(storageValues);
                },
                remove(keys, callback) {
                    for (const key of keys) delete storageValues[key];
                    callback();
                }
            }
        },
        scripting: {
            async executeScript(scriptOptions) {
                calls.push({ type: 'script', options: scriptOptions });
                const phase = scriptOptions?.args?.[1];
                if (phase === 'fields') {
                    advanceClock(delays.fieldsMs);
                    return [{
                        result: options.fieldsMainResult || {
                            success: true,
                            filledFields: ['Adı', 'Soyadı'],
                            missingFields: [],
                            photoUploaded: false
                        }
                    }];
                }
                if (phase === 'photo') {
                    advanceClock(delays.photoMs);
                    return [{
                        result: options.photoMainResult || {
                            success: true,
                            filledFields: [],
                            missingFields: [],
                            photoUploaded: true,
                            photoUploadDurationMs: delays.photoMs
                        }
                    }];
                }
                return [{ result: true }];
            }
        },
        tabs: {
            onUpdated: { addListener() {} },
            query(queryInfo, callback) {
                if (queryInfo.url === '*://yoksis.yok.gov.tr/*') {
                    callback(tabs.filter((tab) => tab.url.startsWith('https://yoksis.yok.gov.tr/')));
                    return;
                }
                callback(tabs);
            },
            get(tabId, callback) {
                const tab = tabs.find((candidate) => candidate.id === tabId) || null;
                chrome.runtime.lastError = tab ? null : { message: 'No tab with id' };
                callback(tab);
                chrome.runtime.lastError = null;
            },
            update(tabId, updateProperties, callback) {
                calls.push({ type: 'update-tab', tabId, updateProperties });
                advanceClock(delays.tabUpdateMs);
                const tab = tabs.find((candidate) => candidate.id === tabId) || { id: tabId };
                Object.assign(tab, updateProperties);
                callback({ ...tab });
            },
            sendMessage(tabId, message, optionsOrCallback, maybeCallback) {
                const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
                calls.push({ type: 'message', tabId, message });
                chrome.runtime.lastError = null;
                const targetTab = tabs.find((candidate) => candidate.id === tabId) || { url: 'https://yoksis.yok.gov.tr/student' };

                if (message.action === 'PING') {
                    callback({ ready: true, pageKind: 'yoksis', url: targetTab.url });
                    return;
                }
                if (message.action === 'WAIT_YOKSIS_FORM') {
                    advanceClock(delays.readyMs);
                    callback(options.waitFormResult || { success: true, formReady: true });
                    return;
                }
                if (message.action === 'verifyYoksisFields') {
                    verifyCallCount += 1;
                    if (verifyCallCount === 1) advanceClock(delays.verifyFieldsMs);
                    else if (verifyCallCount === 2) advanceClock(delays.verifyPhotoMs);

                    if (typeof options.onVerifyFields === 'function') {
                        callback(options.onVerifyFields(verifyCallCount, message));
                        return;
                    }
                    callback(options.verifyFieldsResult || {
                        success: true,
                        filledFields: ['Adı', 'Soyadı'],
                        missingFields: []
                    });
                    return;
                }
                if (message.action === 'fillRemainingData') {
                    advanceClock(delays.completeMs);
                    if (options.failFillRemainingData) {
                        chrome.runtime.lastError = { message: 'Kalan alan aktarımı başarısız oldu.' };
                        callback(undefined);
                        chrome.runtime.lastError = null;
                        return;
                    }
                    callback(options.fillRemainingResult || { success: true });
                    return;
                }
                callback({ success: true });
            }
        },
        windows: {
            async get(windowId) {
                const win = windows.get(windowId);
                if (!win) throw new Error(`No window with id ${windowId}`);
                return { ...win };
            },
            async update(windowId, updateProperties) {
                calls.push({ type: 'update-window', windowId, updateProperties });
                advanceClock(delays.windowFocusMs);
                const win = windows.get(windowId) || { id: windowId };
                Object.assign(win, updateProperties);
                windows.set(windowId, win);
                return { ...win };
            }
        }
    };

    const backgroundContext = vm.createContext({
        chrome,
        URL,
        console: {
            ...console,
            warn() {}
        },
        Promise,
        Date: FakeDate,
        Error,
        setTimeout,
        clearTimeout
    });
    backgroundContext.importScripts = (...scriptNames) => {
        const sourceByName = {
            'portal-security.js': portalSecuritySource,
            'storage-lifecycle.js': storageLifecycleSource
        };
        for (const scriptName of scriptNames) {
            vm.runInContext(sourceByName[scriptName], backgroundContext);
        }
    };
    vm.runInContext(backgroundSource, backgroundContext);

    return {
        calls,
        async sendFill(dataOverrides = {}, messageOverrides = {}) {
            assert.ok(messageHandler, 'background message listener was not registered');
            const senderTab = tabs[0];
            const request = {
                source: 'IKAMET_PORTAL',
                action: 'FILL_YOKSIS_FORM',
                requestId: `fill-req-${Math.random().toString(36).slice(2)}`,
                manualOverrideConfirmed: false,
                data: {
                    firstName: 'ORNEK',
                    lastName: 'OGRENCI',
                    yoksisId: 'SYNTH-123-AB',
                    yoksisReady: true,
                    yoksisTabId: 42,
                    yoksisTabUrl: 'https://yoksis.yok.gov.tr/student',
                    ...dataOverrides
                },
                ...messageOverrides
            };
            return new Promise((resolveResponse) => {
                messageHandler(request, { tab: senderTab }, resolveResponse);
            });
        }
    };
}

function assertValidFillPhaseMs(phaseMs) {
    assert.ok(phaseMs && typeof phaseMs === 'object', 'phaseMs nesnesi bulunmalı');
    assert.deepEqual(Object.keys(phaseMs).sort(), [...FILL_PHASE_KEYS].sort());
    for (const key of FILL_PHASE_KEYS) {
        assert.equal(Number.isInteger(phaseMs[key]), true, `${key} tamsayı olmalı`);
        assert.ok(phaseMs[key] >= 0, `${key} negatif olmamalı`);
    }
}

function installGlobal(context, name, value) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    context.after(() => {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
    });
}

function installFakeTimers(context) {
    const origSetTimeout = globalThis.setTimeout;
    const origClearTimeout = globalThis.clearTimeout;
    let nextId = 1;
    const timers = new Map();

    globalThis.setTimeout = (fn, ms = 0, ...args) => {
        const id = nextId++;
        timers.set(id, { fn, ms: Number(ms) || 0, args });
        return id;
    };
    globalThis.clearTimeout = (id) => {
        timers.delete(id);
    };

    context.after(() => {
        globalThis.setTimeout = origSetTimeout;
        globalThis.clearTimeout = origClearTimeout;
        timers.clear();
    });
}

async function createPortalHarness(context, suffix) {
    installFakeTimers(context);
    const dom = new JSDOM(htmlTemplate, { url: 'https://portal.test/yetkili/' });
    context.after(() => dom.window.close());

    dom.window.document.execCommand = () => true;
    dom.window.Cropper = class {
        destroy() {}
        rotateTo() {}
        getImageData() {
            return { rotate: 0 };
        }
        getCroppedCanvas() {
            return {
                toDataURL: () => 'data:image/jpeg;base64,AA==',
                toBlob: (cb) => cb(null)
            };
        }
    };

    const postedMessages = [];
    dom.window.postMessage = (payload) => {
        postedMessages.push(payload);
    };

    installGlobal(context, 'window', dom.window);
    installGlobal(context, 'document', dom.window.document);
    installGlobal(context, 'CustomEvent', dom.window.CustomEvent);
    installGlobal(context, 'MutationObserver', dom.window.MutationObserver);
    installGlobal(context, 'requestAnimationFrame', () => 0);
    installGlobal(context, 'fetch', async () => ({ ok: false }));

    const { initYknManager } = await import(`../src/managers/yknManager.js?fill-timing=${Date.now()}-${suffix}`);
    initYknManager();

    function dispatchExtensionMessage(data) {
        dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
            data: { source: 'EXTENSION', ...data },
            source: dom.window
        }));
    }

    // isValidYoksisId 2-4 karakterlik parçalar beklediği için geçerli yapay kod kullan.
    function startCroppedFillTransfer(yoksisId = 'SNT-456-CD') {
        const doc = dom.window.document;
        doc.getElementById('ykn-passport-input').value = 'SYNTH99887';
        doc.getElementById('btn-ykn-search').click();

        const searchMsg = [...postedMessages].reverse().find((m) => m?.payload?.action === 'SEARCH_STUDENT');
        assert.ok(searchMsg, 'SEARCH_STUDENT gönderilmeli');
        const searchRequestId = searchMsg.payload.requestId;

        dispatchExtensionMessage({
            type: 'EVENT',
            action: 'STUDENT_FOUND',
            requestId: searchRequestId,
            data: {
                fullName: 'ORNEK OGRENCI',
                passportNo: 'SYNTH99887',
                yoksisId,
                passportImageSrc: 'data:image/jpeg;base64,AA=='
            }
        });
        dispatchExtensionMessage({
            type: 'EVENT',
            action: 'STUDENT_DOCUMENTS_FOUND',
            requestId: searchRequestId,
            data: {
                fullName: 'ORNEK OGRENCI',
                passportNo: 'SYNTH99887',
                yoksisId,
                documentsReady: true,
                passportImageSrc: 'data:image/jpeg;base64,AA=='
            }
        });

        doc.getElementById('btn-ykn-background-search').click();
        const bgTransferMsg = [...postedMessages].reverse().find((m) => m?.payload?.action === 'TRANSFER_TO_YOKSIS');
        assert.ok(bgTransferMsg, 'TRANSFER_TO_YOKSIS gönderilmeli');

        dispatchExtensionMessage({
            type: 'RESPONSE',
            action: 'TRANSFER_TO_YOKSIS',
            requestId: bgTransferMsg.payload.requestId,
            response: {
                success: true,
                formReady: true,
                background: true,
                yoksisTabId: 42,
                yoksisTabUrl: 'https://yoksis.yok.gov.tr/student'
            }
        });

        dom.window.dispatchEvent(new dom.window.CustomEvent('ykn:photo-cropped', {
            detail: { dataUrl: 'data:image/jpeg;base64,AA==', fileName: 'ornek.jpg', autoTransfer: true }
        }));

        const fillMsg = [...postedMessages].reverse().find((m) => m?.payload?.action === 'FILL_YOKSIS_FORM');
        assert.ok(fillMsg, 'FILL_YOKSIS_FORM gönderilmeli');
        return fillMsg.payload.requestId;
    }

    return {
        document: dom.window.document,
        dispatchExtensionMessage,
        startCroppedFillTransfer
    };
}

test('FILL_YOKSIS_FORM başarı yanıtı tüm tamsayı phaseMs aşamalarını eksiksiz ölçer', async () => {
    const harness = createFillTimingHarness({
        delays: {
            tabUpdateMs: 110,
            windowFocusMs: 90,
            readyMs: 320,
            fieldsMs: 1200,
            verifyFieldsMs: 240,
            photoMs: 2500,
            verifyPhotoMs: 310,
            completeMs: 180
        },
        onVerifyFields(callIndex) {
            if (callIndex < 3) {
                return {
                    success: true,
                    filledFields: ['Adı', 'Soyadı'],
                    missingFields: ['Anne Adı']
                };
            }
            return {
                success: true,
                filledFields: ['Adı', 'Soyadı', 'Anne Adı'],
                missingFields: []
            };
        }
    });

    const response = await harness.sendFill({
        anneAdi: 'ORNEK ANNE',
        croppedPhotoBase64: 'data:image/jpeg;base64,AA=='
    });

    assert.equal(response.success, true);
    assert.equal(response.partial, false);
    assert.equal(response.photoUploaded, true);
    assertValidFillPhaseMs(response.phaseMs);
    assert.deepEqual(JSON.parse(JSON.stringify(response.phaseMs)), {
        tabPrepMs: 200,
        readyMs: 320,
        fieldsMs: 1200,
        verifyFieldsMs: 240,
        photoMs: 2500,
        verifyPhotoMs: 310,
        completeMs: 180,
        totalMs: 4950
    });
});

test('fotoğrafsız FILL_YOKSIS_FORM aktarımında photoMs ve verifyPhotoMs 0 döner', async () => {
    const harness = createFillTimingHarness({
        delays: {
            tabUpdateMs: 50,
            windowFocusMs: 30,
            readyMs: 140,
            fieldsMs: 700,
            verifyFieldsMs: 160,
            photoMs: 999,
            verifyPhotoMs: 888,
            completeMs: 777
        }
    });

    const response = await harness.sendFill({
        croppedPhotoBase64: ''
    });

    assert.equal(response.success, true);
    assert.equal(response.partial, false);
    assertValidFillPhaseMs(response.phaseMs);
    assert.equal(response.phaseMs.photoMs, 0);
    assert.equal(response.phaseMs.verifyPhotoMs, 0);
    assert.equal(response.phaseMs.completeMs, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(response.phaseMs)), {
        tabPrepMs: 80,
        readyMs: 140,
        fieldsMs: 700,
        verifyFieldsMs: 160,
        photoMs: 0,
        verifyPhotoMs: 0,
        completeMs: 0,
        totalMs: 1080
    });
    assert.equal(
        harness.calls.some((call) => call.type === 'script' && call.options?.args?.[1] === 'photo'),
        false
    );
});

test('FILL_YOKSIS_FORM nesne döndüren hata yollarında da phaseMs alanını korur', async () => {
    // 1. İlk alan doğrulama yanıtı bozuk/hata döndüğünde erken çıkış
    const earlyFailHarness = createFillTimingHarness({
        delays: {
            tabUpdateMs: 40,
            windowFocusMs: 20,
            readyMs: 150,
            fieldsMs: 600,
            verifyFieldsMs: 210,
            photoMs: 500,
            verifyPhotoMs: 300
        },
        verifyFieldsResult: { invalidResponse: true }
    });

    const earlyFailResponse = await earlyFailHarness.sendFill({
        croppedPhotoBase64: 'data:image/jpeg;base64,AA=='
    });

    assert.equal(earlyFailResponse.success, false);
    assert.equal(earlyFailResponse.partial, true);
    assert.match(earlyFailResponse.error, /doğrulama yanıtı alınamadı/);
    assertValidFillPhaseMs(earlyFailResponse.phaseMs);
    assert.deepEqual(JSON.parse(JSON.stringify(earlyFailResponse.phaseMs)), {
        tabPrepMs: 60,
        readyMs: 150,
        fieldsMs: 600,
        verifyFieldsMs: 210,
        photoMs: 0,
        verifyPhotoMs: 0,
        completeMs: 0,
        totalMs: 1020
    });

    // 2. Kalan alan tamamlama (completeMissingYoksisFields) hata döndüğünde
    const completeFailHarness = createFillTimingHarness({
        delays: {
            tabUpdateMs: 30,
            windowFocusMs: 10,
            readyMs: 100,
            fieldsMs: 400,
            verifyFieldsMs: 120,
            photoMs: 350,
            verifyPhotoMs: 130,
            completeMs: 270
        },
        fieldsMainResult: {
            success: false,
            filledFields: [],
            missingFields: ['Adı', 'Soyadı'],
            photoUploaded: false
        },
        photoMainResult: {
            success: false,
            filledFields: [],
            missingFields: [],
            photoUploaded: false
        },
        verifyFieldsResult: {
            success: true,
            filledFields: [],
            missingFields: ['Adı', 'Soyadı']
        },
        failFillRemainingData: true
    });

    const completeFailResponse = await completeFailHarness.sendFill({
        croppedPhotoBase64: 'data:image/jpeg;base64,AA=='
    });

    assert.equal(completeFailResponse.success, false);
    assert.equal(completeFailResponse.partial, true);
    assert.match(completeFailResponse.error, /Kalan alan aktarımı başarısız oldu/);
    assertValidFillPhaseMs(completeFailResponse.phaseMs);
    assert.deepEqual(JSON.parse(JSON.stringify(completeFailResponse.phaseMs)), {
        tabPrepMs: 40,
        readyMs: 100,
        fieldsMs: 400,
        verifyFieldsMs: 120,
        photoMs: 350,
        verifyPhotoMs: 130,
        completeMs: 270,
        totalMs: 1410
    });
});

test('portal FILL_YOKSIS_FORM yanıtında phaseMs varsa Türkçe virgüllü süre satırını yazar', async (context) => {
    const { document, dispatchExtensionMessage, startCroppedFillTransfer } = await createPortalHarness(context, 'fill-phase-present');
    const fillRequestId = startCroppedFillTransfer();

    dispatchExtensionMessage({
        type: 'RESPONSE',
        action: 'FILL_YOKSIS_FORM',
        requestId: fillRequestId,
        response: {
            success: true,
            partial: false,
            filledFields: ['Adı', 'Soyadı'],
            missingFields: [],
            photoUploaded: true,
            phaseMs: {
                tabPrepMs: 200,
                readyMs: 300,
                fieldsMs: 1400,
                verifyFieldsMs: 400,
                photoMs: 2600,
                verifyPhotoMs: 500,
                completeMs: 100,
                totalMs: 5500
            }
        }
    });

    const statusContainer = document.getElementById('ykn-status-container');
    const infoTexts = [...statusContainer.querySelectorAll('.ykn-status-item.is-info .ykn-status-text')]
        .map((el) => el.textContent);

    assert.ok(
        infoTexts.includes(
            'YÖKSİS aktarım süreleri: sekme hazırlığı 0,2 sn, hazırlık 0,3 sn, alanlar 1,4 sn, alan doğrulama 0,4 sn, fotoğraf 2,6 sn, foto doğrulama 0,5 sn, tamamlama 0,1 sn, toplam 5,5 sn.'
        ),
        `Beklenen aktarım süre satırı bulunamadı: ${JSON.stringify(infoTexts)}`
    );
    assert.match(statusContainer.textContent, /YÖKSİS formu dolduruldu\./);
});

test('portal FILL_YOKSIS_FORM yanıtında phaseMs yoksa süre satırı yazmaz', async (context) => {
    const { document, dispatchExtensionMessage, startCroppedFillTransfer } = await createPortalHarness(context, 'fill-phase-absent');
    const fillRequestId = startCroppedFillTransfer();

    dispatchExtensionMessage({
        type: 'RESPONSE',
        action: 'FILL_YOKSIS_FORM',
        requestId: fillRequestId,
        response: {
            success: true,
            partial: false,
            filledFields: ['Adı', 'Soyadı'],
            missingFields: [],
            photoUploaded: true
        }
    });

    const statusText = document.getElementById('ykn-status-container').textContent;
    assert.doesNotMatch(statusText, /YÖKSİS aktarım süreleri:/);
    assert.match(statusText, /YÖKSİS formu dolduruldu\./);
});
