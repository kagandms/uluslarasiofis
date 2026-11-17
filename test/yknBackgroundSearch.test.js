import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const backgroundSource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/background.js'), 'utf8');
const portalSecuritySource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/portal-security.js'), 'utf8');
const storageLifecycleSource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/storage-lifecycle.js'), 'utf8');

/**
 * Arka plan YÖKSİS arama testleri için yalıtılmış Chrome uzantı bağlamı kurar.
 */
function createBackgroundSearchHarness(options = {}) {
    const calls = [];
    const warnings = [];
    let messageHandler = null;
    let nextWindowId = options.nextWindowId || 200;
    let nextTabId = options.nextTabId || 99;
    const portalWindowId = options.portalWindowId ?? 10;
    const portalTabId = options.portalTabId ?? 1;
    const yoksisWindowId = options.yoksisWindowId ?? 20;
    const storageValues = { ...(options.localStorage || {}) };
    const sessionStorage = { ...(options.sessionStorage || {}) };
    const windows = new Map(
        (options.windows || [
            { id: portalWindowId, state: 'normal', focused: true },
            { id: yoksisWindowId, state: 'normal', focused: false }
        ]).map((win) => [win.id, { ...win }])
    );
    const tabs = (options.initialTabs || [
        { id: portalTabId, url: 'http://localhost:5173/yetkili/', active: true, windowId: portalWindowId },
        ...(options.hasYoksisTab === false
            ? []
            : [{
                id: 42,
                url: 'https://yoksis.yok.gov.tr/student',
                active: false,
                windowId: yoksisWindowId
            }])
    ]).map((tab) => ({ ...tab }));

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
                return [{ result: options.mainSearchResult || { inputFound: false, buttonFound: false, searchTriggered: false } }];
            }
        },
        tabs: {
            onUpdated: { addListener() {} },
            query(queryInfo, callback) {
                if (queryInfo.url === '*://yoksis.yok.gov.tr/*') {
                    callback(tabs.filter((tab) => tab.url.startsWith('https://yoksis.yok.gov.tr/')));
                    return;
                }
                if (Number.isInteger(queryInfo.windowId)) {
                    callback(tabs.filter((tab) => tab.windowId === queryInfo.windowId));
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
            create(createProperties, callback) {
                calls.push({ type: 'create-tab', createProperties });
                const createdTab = {
                    id: nextTabId++,
                    url: createProperties.url || 'https://yoksis.yok.gov.tr/',
                    active: createProperties.active !== false,
                    windowId: createProperties.windowId ?? portalWindowId
                };
                tabs.push(createdTab);
                callback({ ...createdTab });
            },
            update(tabId, updateProperties, callback) {
                calls.push({ type: 'update-tab', tabId, updateProperties });
                if (options.throwOnTabUpdate) {
                    chrome.runtime.lastError = { message: 'tabs.update failed' };
                    callback(undefined);
                    chrome.runtime.lastError = null;
                    return;
                }
                const tab = tabs.find((candidate) => candidate.id === tabId) || { id: tabId };
                Object.assign(tab, updateProperties);
                callback({ ...tab });
            },
            sendMessage(tabId, message, optionsOrCallback, maybeCallback) {
                const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
                const messageOptions = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
                calls.push({ type: 'message', tabId, message, options: messageOptions });
                chrome.runtime.lastError = null;
                const targetTab = tabs.find((candidate) => candidate.id === tabId) || { url: 'https://yoksis.yok.gov.tr/student' };
                if (message.action === 'PING') {
                    callback({ ready: true, pageKind: 'yoksis', url: targetTab.url });
                    return;
                }
                if (message.action === 'OPEN_YOKSIS_YKN_REQUEST') {
                    callback(options.navigationResult || { success: true, alreadyOpen: true, durationMs: 5 });
                    return;
                }
                if (message.action === 'searchWithId') {
                    if (typeof options.onSearchWithId === 'function') {
                        options.onSearchWithId(message, callback);
                        return;
                    }
                    if (options.hangSearchWithId) {
                        return;
                    }
                    callback('searchResult' in options ? options.searchResult : { success: true, searchTriggered: true, formReady: true });
                    return;
                }
                if (message.action === 'GET_YOKSIS_FORM_STATE') {
                    if (typeof options.onGetFormState === 'function') {
                        options.onGetFormState(message, callback);
                        return;
                    }
                    callback('formState' in options ? options.formState : { success: true, fingerprint: 'fp-1', domRevision: 1, hasPopulatedStudentForm: false });
                    return;
                }
                if (message.action === 'WAIT_YOKSIS_FORM') {
                    if (typeof options.onWaitForm === 'function') {
                        options.onWaitForm(message, callback);
                        return;
                    }
                    callback(options.waitFormResult || { success: true, formReady: true });
                    return;
                }
                callback({ success: true });
            }
        },
        windows: {
            async get(windowId) {
                calls.push({ type: 'get-window', windowId });
                const win = windows.get(windowId);
                if (!win) throw new Error(`No window with id ${windowId}`);
                return { ...win };
            },
            async update(windowId, updateProperties) {
                calls.push({ type: 'update-window', windowId, updateProperties });
                if (options.throwOnWindowUpdate) {
                    throw new Error('windows.update failed');
                }
                const win = windows.get(windowId) || { id: windowId };
                Object.assign(win, updateProperties);
                windows.set(windowId, win);
                return { ...win };
            },
            async create(createData) {
                calls.push({ type: 'create-window', createData });
                const windowId = nextWindowId++;
                const newWindow = {
                    id: windowId,
                    state: createData.state || 'normal',
                    focused: Boolean(createData.focused),
                    left: createData.left,
                    top: createData.top,
                    width: createData.width,
                    height: createData.height,
                    tabs: []
                };
                if (Number.isInteger(createData.tabId)) {
                    const existingTab = tabs.find((candidate) => candidate.id === createData.tabId);
                    if (existingTab) {
                        existingTab.windowId = windowId;
                        newWindow.tabs.push({ ...existingTab });
                    }
                } else if (createData.url) {
                    const createdTab = {
                        id: nextTabId++,
                        url: createData.url,
                        active: true,
                        windowId
                    };
                    tabs.push(createdTab);
                    newWindow.tabs.push({ ...createdTab });
                }
                windows.set(windowId, newWindow);
                return newWindow;
            }
        }
    };

    const backgroundContext = vm.createContext({
        chrome,
        URL,
        console: {
            ...console,
            warn(...args) {
                warnings.push(args);
            }
        },
        Promise,
        Date,
        Error,
        // Uzun arama zaman aşımını testte beklememek için 20-50 sn aralığındaki zamanlayıcıyı hızlandır.
        setTimeout: options.fastSearchTimeout
            ? (fn, delay, ...args) => setTimeout(fn, delay >= 20_000 && delay <= 50_000 ? 0 : delay, ...args)
            : setTimeout,
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
        warnings,
        tabs,
        storageValues,
        portalSecurity: backgroundContext.YKN_PORTAL_SECURITY,
        waitForYoksisFormReady: backgroundContext.waitForYoksisFormReady,
        async sendTransfer(overrides = {}) {
            assert.ok(messageHandler, 'background message listener was not registered');
            const senderTab = tabs.find((candidate) => candidate.id === portalTabId) || {
                id: portalTabId,
                url: 'http://localhost:5173/yetkili/',
                windowId: portalWindowId
            };
            const request = {
                source: 'IKAMET_PORTAL',
                action: 'TRANSFER_TO_YOKSIS',
                requestId: `bg-req-${Math.random().toString(36).slice(2)}`,
                data: { yoksisId: 'SYNTH-123-AB', firstName: 'SYNTHETIC', lastName: 'STUDENT' },
                screenArea: { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1040 },
                yknViewOpen: true,
                ...overrides
            };
            return new Promise((resolveResponse) => {
                messageHandler(request, { tab: senderTab }, resolveResponse);
            });
        }
    };
}

test('arka plan araması başarılı olduğunda sekme/pencere odaklanmaz, geri dönüş yapılmaz ve surfaced false döner', async () => {
    const harness = createBackgroundSearchHarness({
        portalWindowId: 10,
        yoksisWindowId: 10
    });

    const response = await harness.sendTransfer({ background: true, requestId: 'bg-success-1' });

    assert.equal(response.success, true);
    assert.equal(response.formReady, true);
    assert.equal(response.background, true);
    assert.equal(response.surfaced, false);
    assert.equal('attentionReason' in response, false);
    assert.equal(response.yoksisTabId, 42);
    assert.equal(response.yoksisTabUrl, 'https://yoksis.yok.gov.tr/student');
    assert.equal(harness.storageValues.studentData.yoksisReady, true);
    assert.equal(harness.storageValues.studentData.yoksisTabId, 42);

    assert.equal(harness.calls.some((call) => call.type === 'update-tab'), false);
    assert.equal(harness.calls.some((call) => call.type === 'update-window'), false);
    assert.equal(harness.calls.some((call) => call.type === 'create-window'), false);
    assert.equal(harness.calls.some((call) => call.type === 'get-window'), false);
    assert.ok(harness.calls.some((call) => call.type === 'message' && call.message.action === 'searchWithId'));
});

test('arka plan modunda YÖKSİS sekmesi yoksa yeni pencere değil mevcut pencerede pasif sekme açılır', async () => {
    const harness = createBackgroundSearchHarness({
        hasYoksisTab: false,
        nextTabId: 77
    });

    const response = await harness.sendTransfer({ background: true, requestId: 'bg-create-tab-1' });

    assert.equal(response.success, true);
    assert.equal(response.formReady, true);
    assert.equal(response.background, true);
    assert.equal(response.surfaced, false);
    assert.equal(response.yoksisTabId, 77);

    const createTabCalls = harness.calls.filter((call) => call.type === 'create-tab');
    assert.equal(createTabCalls.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(createTabCalls[0].createProperties)), {
        url: 'https://yoksis.yok.gov.tr/',
        active: false
    });
    assert.equal(harness.calls.some((call) => call.type === 'create-window'), false);
    assert.equal(harness.calls.some((call) => call.type === 'update-tab'), false);
    assert.equal(harness.calls.some((call) => call.type === 'update-window'), false);
});

test('arka plan araması başarısız olursa YÖKSİS sekmesi öne getirilir ve search_failed döner', async () => {
    for (const faultScenario of [
        {
            name: 'doğrulanmamış form',
            options: { searchResult: { success: false, searchTriggered: true, formReady: false, manualOverrideAvailable: false } }
        },
        {
            name: 'menü açılamadı hatası',
            options: { navigationResult: { success: false, error: 'Menü açılmadı' } }
        }
    ]) {
        const harness = createBackgroundSearchHarness({
            portalWindowId: 10,
            yoksisWindowId: 20,
            ...faultScenario.options
        });

        const response = await harness.sendTransfer({ background: true, requestId: `bg-fail-${faultScenario.name}` });

        assert.equal(response.success, false, faultScenario.name);
        assert.equal(response.background, true, faultScenario.name);
        assert.equal(response.surfaced, true, faultScenario.name);
        assert.equal(response.attentionReason, 'search_failed', faultScenario.name);

        assert.deepEqual(
            JSON.parse(JSON.stringify(harness.calls.filter((call) => call.type === 'update-tab'))),
            [{ type: 'update-tab', tabId: 42, updateProperties: { active: true } }]
        );
        assert.deepEqual(
            JSON.parse(JSON.stringify(harness.calls.filter((call) => call.type === 'update-window'))),
            [{ type: 'update-window', windowId: 20, updateProperties: { focused: true } }]
        );
    }
});

test('arka plan aramasında manuel onay gerekirse YÖKSİS öne getirilir ve manual_confirmation döner', async () => {
    const harness = createBackgroundSearchHarness({
        portalWindowId: 10,
        yoksisWindowId: 20,
        searchResult: {
            success: true,
            searchTriggered: true,
            formReady: false,
            manualOverrideAvailable: true
        }
    });

    const response = await harness.sendTransfer({ background: true, requestId: 'bg-manual-1' });

    assert.equal(response.success, true);
    assert.equal(response.formReady, false);
    assert.equal(response.manualOverrideAvailable, true);
    assert.equal(response.background, true);
    assert.equal(response.surfaced, true);
    assert.equal(response.attentionReason, 'manual_confirmation');
    assert.equal(harness.storageValues.studentData.yoksisManualOverrideAvailable, true);

    assert.deepEqual(
        JSON.parse(JSON.stringify(harness.calls.filter((call) => call.type === 'update-tab'))),
        [{ type: 'update-tab', tabId: 42, updateProperties: { active: true } }]
    );
    assert.deepEqual(
        JSON.parse(JSON.stringify(harness.calls.filter((call) => call.type === 'update-window'))),
        [{ type: 'update-window', windowId: 20, updateProperties: { focused: true } }]
    );
});

test('arka plan öne çıkarma sırasında tab/window update hata verse bile yalnızca uyarı loglanır ve surfaced true döner', async () => {
    const harness = createBackgroundSearchHarness({
        portalWindowId: 10,
        yoksisWindowId: 20,
        throwOnTabUpdate: true,
        throwOnWindowUpdate: true,
        searchResult: {
            success: true,
            searchTriggered: true,
            formReady: false,
            manualOverrideAvailable: true
        }
    });

    const response = await harness.sendTransfer({ background: true, requestId: 'bg-surface-warn' });

    assert.equal(response.background, true);
    assert.equal(response.surfaced, true);
    assert.equal(response.attentionReason, 'manual_confirmation');
    assert.equal(harness.warnings.length, 2);
});

test('varsayılan akış (background yok veya false) sekme odaklama, yan yana yerleştirme ve portala dönüşü korur', async () => {
    for (const extraFields of [{}, { background: false }]) {
        const harness = createBackgroundSearchHarness({
            localStorage: { yoksisSideBySideEnabled: true },
            portalWindowId: 10,
            yoksisWindowId: 10
        });

        const response = await harness.sendTransfer({
            requestId: `default-path-${String(extraFields.background)}`,
            ...extraFields
        });

        assert.equal(response.success, true);
        assert.equal(response.formReady, true);
        assert.equal('background' in response, false);
        assert.equal('surfaced' in response, false);
        assert.equal('attentionReason' in response, false);

        assert.ok(harness.calls.some((call) => call.type === 'create-window'));
        const tabActivations = harness.calls
            .filter((call) => call.type === 'update-tab' && call.updateProperties.active === true)
            .map((call) => call.tabId);
        assert.deepEqual(tabActivations, [42, 1]);

        const focusCalls = harness.calls
            .filter((call) => call.type === 'update-window' && call.updateProperties.focused === true)
            .map((call) => call.windowId);
        assert.deepEqual(focusCalls, [200, 10]);
    }
});

test('portal-security TRANSFER_TO_YOKSIS doğrulaması boolean/yoksa kabul eder, geçersiz background tiplerini reddeder', async () => {
    const harness = createBackgroundSearchHarness();
    const baseMessage = {
        source: 'IKAMET_PORTAL',
        action: 'TRANSFER_TO_YOKSIS',
        requestId: 'sec-check-1',
        data: { yoksisId: 'SYNTH-123-AB' }
    };

    assert.equal(harness.portalSecurity.isValidPortalMessage(baseMessage), true);
    assert.equal(harness.portalSecurity.isValidPortalMessage({ ...baseMessage, background: true }), true);
    assert.equal(harness.portalSecurity.isValidPortalMessage({ ...baseMessage, background: false }), true);

    for (const invalidBackground of ['yes', 1, null, {}, []]) {
        assert.equal(
            harness.portalSecurity.isValidPortalMessage({ ...baseMessage, background: invalidBackground }),
            false
        );

        const rejected = await harness.sendTransfer({ background: invalidBackground, requestId: `reject-${String(invalidBackground)}` });
        assert.equal(rejected.success, false);
        assert.match(rejected.error, /İstek doğrulanamadı/);
    }
    assert.equal(harness.calls.some((call) => call.type === 'message' && call.message.action === 'searchWithId'), false);
});

test('content script zaman aşımında koruma hatasına Neden: YÖKSİS arama zaman aşımı eklenir', async () => {
    const harness = createBackgroundSearchHarness({
        portalWindowId: 10,
        yoksisWindowId: 20,
        hangSearchWithId: true,
        fastSearchTimeout: true,
        formState: null
    });

    const response = await harness.sendTransfer({ background: true, requestId: 'bg-timeout-1' });

    assert.equal(response.success, false);
    assert.equal(response.background, true);
    assert.equal(response.surfaced, true);
    assert.equal(response.attentionReason, 'search_failed');
    assert.equal(
        response.error,
        'YÖKSİS formunun mevcut durumu doğrulanamadı; önceki öğrenci formuna yazmamak için arama başlatılmadı. Sayfayı yenileyip tekrar deneyin. Neden: YÖKSİS arama zaman aşımı'
    );
    assert.equal(harness.warnings.length, 1);
});

test('content script success false ve mesaj döndürdüğünde koruma hatası bu nedeni gösterir', async () => {
    for (const scenario of [
        {
            requestId: 'bg-refusal-msg',
            searchResult: { success: false, searchTriggered: false, message: 'Yeni öğrenci onayı verilmedi' },
            expectedReason: 'Yeni öğrenci onayı verilmedi'
        },
        {
            requestId: 'bg-refusal-err',
            searchResult: { success: false, searchTriggered: false, error: 'YÖKSİS arama kontrolü hazır değil' },
            expectedReason: 'YÖKSİS arama kontrolü hazır değil'
        }
    ]) {
        const harness = createBackgroundSearchHarness({
            portalWindowId: 10,
            yoksisWindowId: 20,
            searchResult: scenario.searchResult,
            formState: { success: true, fingerprint: 'fp-busy', domRevision: 2, hasPopulatedStudentForm: true }
        });

        const response = await harness.sendTransfer({ background: true, requestId: scenario.requestId });

        assert.equal(response.success, false, scenario.requestId);
        assert.equal(response.background, true, scenario.requestId);
        assert.equal(response.surfaced, true, scenario.requestId);
        assert.equal(response.attentionReason, 'search_failed', scenario.requestId);
        assert.equal(
            response.error,
            `YÖKSİS formunun mevcut durumu doğrulanamadı; önceki öğrenci formuna yazmamak için arama başlatılmadı. Sayfayı yenileyip tekrar deneyin. Neden: ${scenario.expectedReason}`,
            scenario.requestId
        );
    }
});

test('ardışık aramalarda neden sızdırılmaz, 160 karakterle sınırlanır ve başarılı arama değişmez', async () => {
    let step = 0;
    const harness = createBackgroundSearchHarness({
        portalWindowId: 10,
        yoksisWindowId: 20,
        onSearchWithId(_message, callback) {
            step += 1;
            if (step === 1) {
                callback({
                    success: false,
                    searchTriggered: false,
                    message: `Kod SYNTH-123-AB ve pasaport SYNTHPASS99 işlenemedi: ${'detay '.repeat(40)}`
                });
                return;
            }
            if (step === 2) {
                callback({ success: true, searchTriggered: true, formReady: true });
                return;
            }
            callback({ success: false, searchTriggered: false });
        },
        onGetFormState(_message, callback) {
            callback({ success: true, fingerprint: 'fp-1', domRevision: 1, hasPopulatedStudentForm: true });
        }
    });

    const first = await harness.sendTransfer({
        background: true,
        requestId: 'bg-seq-1',
        data: { yoksisId: 'SYNTH-123-AB', pasaportNo: 'SYNTHPASS99', firstName: 'SYNTHETIC', lastName: 'STUDENT' }
    });
    assert.equal(first.success, false);
    assert.match(first.error, /Neden: /);
    assert.equal(first.error.includes('SYNTH-123-AB'), false);
    assert.equal(first.error.includes('SYNTHPASS99'), false);
    const reasonText = first.error.split('Neden: ')[1];
    assert.ok(reasonText.length > 0 && reasonText.length <= 160);

    const second = await harness.sendTransfer({ background: true, requestId: 'bg-seq-2' });
    assert.equal(second.success, true);
    assert.equal(second.formReady, true);
    assert.equal(second.surfaced, false);

    const third = await harness.sendTransfer({ background: true, requestId: 'bg-seq-3' });
    assert.equal(third.success, false);
    assert.equal(
        third.error,
        'YÖKSİS formunun mevcut durumu doğrulanamadı; önceki öğrenci formuna yazmamak için arama başlatılmadı. Sayfayı yenileyip tekrar deneyin.'
    );
});

test('arka plan modunda ilk form bekleme başarısız olup kısa öne almadan sonra ikinci bekleme başarılı olursa portala dönülür ve briefSurface true döner', async () => {
    let waitAttempt = 0;
    const waitMessages = [];
    const harness = createBackgroundSearchHarness({
        portalWindowId: 10,
        yoksisWindowId: 20,
        searchResult: {
            success: true,
            searchTriggered: true,
            formReady: false,
            formFingerprintBeforeSearch: 'fp-1',
            domRevisionBeforeSearch: 1
        },
        onWaitForm(message, callback) {
            waitAttempt += 1;
            waitMessages.push(message);
            if (waitAttempt === 1) {
                callback({
                    success: true,
                    formReady: false,
                    manualOverrideAvailable: true,
                    message: 'Gizli sekmede ZK formu henüz dolmadı'
                });
                return;
            }
            callback({ success: true, formReady: true });
        }
    });

    const response = await harness.sendTransfer({ background: true, requestId: 'bg-brief-surface-1' });

    assert.equal(waitAttempt, 2);
    assert.equal(waitMessages[0].timeoutMs, 2500);
    assert.equal(waitMessages[1].timeoutMs, 10000);
    assert.equal(waitMessages[1].afterFingerprint, waitMessages[0].afterFingerprint);
    assert.equal(waitMessages[1].afterDomRevision, waitMessages[0].afterDomRevision);
    assert.equal(waitMessages[1].requireFreshResult, waitMessages[0].requireFreshResult);
    assert.equal(waitMessages[1].expectedKabulId, waitMessages[0].expectedKabulId);

    assert.equal(response.success, true);
    assert.equal(response.transferred, true);
    assert.equal(response.searchTriggered, true);
    assert.equal(response.formReady, true);
    assert.equal(response.briefSurface, true);
    assert.equal(response.background, true);
    assert.equal(response.surfaced, false);
    assert.equal(response.yoksisTabId, 42);
    assert.equal(response.yoksisTabUrl, 'https://yoksis.yok.gov.tr/student');
    assert.equal(
        response.message,
        'Kabul mektup kodu YÖKSİS’e aktarıldı; form doğrulaması için sekme kısa süre öne alındı.'
    );

    const tabActivations = harness.calls
        .filter((call) => call.type === 'update-tab' && call.updateProperties.active === true)
        .map((call) => call.tabId);
    assert.deepEqual(tabActivations, [42, 1]);

    const windowFocusCalls = harness.calls
        .filter((call) => call.type === 'update-window' && call.updateProperties.focused === true)
        .map((call) => call.windowId);
    assert.deepEqual(windowFocusCalls, [20, 10]);
});

test('arka plan modunda her iki form bekleme de başarısız olursa portala dönülür, manualOverrideAvailable korunur ve 160 karakterle sınırlı Neden eklenir', async () => {
    let waitAttempt = 0;
    const longReason = `ZK formu ikinci beklemede de hazır olmadı: ${'ayrinti '.repeat(30)}`;
    const harness = createBackgroundSearchHarness({
        portalWindowId: 10,
        yoksisWindowId: 20,
        searchResult: {
            success: true,
            searchTriggered: true,
            formReady: false,
            formFingerprintBeforeSearch: 'fp-1',
            domRevisionBeforeSearch: 1
        },
        formState: {
            success: true,
            fingerprint: 'fp-2',
            domRevision: 2,
            hasPopulatedStudentForm: false
        },
        onWaitForm(_message, callback) {
            waitAttempt += 1;
            callback({
                success: true,
                formReady: false,
                manualOverrideAvailable: true,
                message: waitAttempt === 1 ? 'İlk deneme zaman aşımı' : longReason
            });
        }
    });

    const response = await harness.sendTransfer({ background: true, requestId: 'bg-brief-surface-fail-1' });

    assert.equal(waitAttempt, 2);
    assert.equal(response.success, true);
    assert.equal(response.formReady, false);
    assert.equal(response.manualOverrideAvailable, true);
    assert.equal(response.background, true);
    assert.equal(response.surfaced, true);
    assert.equal(response.attentionReason, 'manual_confirmation');
    assert.equal('briefSurface' in response, false);
    assert.ok(
        response.message.startsWith(
            'Kabul kodu aratıldı; form otomatik doğrulanamadı. YÖKSİS kaydını kontrol edip manuel aktarımı seçebilirsiniz. Neden: '
        )
    );
    const reasonText = response.message.split('Neden: ')[1];
    assert.equal(reasonText, longReason.replace(/\s+/g, ' ').trim().slice(0, 160));
    assert.equal(reasonText.length, 160);

    const tabActivations = harness.calls
        .filter((call) => call.type === 'update-tab' && call.updateProperties.active === true)
        .map((call) => call.tabId);
    assert.deepEqual(tabActivations, [42, 1, 42]);
});

test('arka plan dışındaki modda ilk form bekleme başarısız olursa ek öne alma, portala dönüş veya Neden eki yapılmaz', async () => {
    let waitAttempt = 0;
    const harness = createBackgroundSearchHarness({
        portalWindowId: 10,
        yoksisWindowId: 20,
        searchResult: {
            success: true,
            searchTriggered: true,
            formReady: false,
            formFingerprintBeforeSearch: 'fp-1',
            domRevisionBeforeSearch: 1
        },
        formState: {
            success: true,
            fingerprint: 'fp-2',
            domRevision: 2,
            hasPopulatedStudentForm: false
        },
        onWaitForm(_message, callback) {
            waitAttempt += 1;
            callback({
                success: true,
                formReady: false,
                manualOverrideAvailable: true,
                message: 'Ön plan form doğrulaması başarısız'
            });
        }
    });

    const response = await harness.sendTransfer({ background: false, requestId: 'fg-wait-fail-1' });

    assert.equal(waitAttempt, 1);
    assert.equal(response.success, true);
    assert.equal(response.formReady, false);
    assert.equal(response.manualOverrideAvailable, true);
    assert.equal('briefSurface' in response, false);
    assert.equal('background' in response, false);
    assert.equal(
        response.message,
        'Kabul kodu aratıldı; form otomatik doğrulanamadı. YÖKSİS kaydını kontrol edip manuel aktarımı seçebilirsiniz.'
    );

    const tabActivations = harness.calls
        .filter((call) => call.type === 'update-tab' && call.updateProperties.active === true)
        .map((call) => call.tabId);
    assert.deepEqual(tabActivations, [42]);
});

test('ön plan modunda ilk form bekleme 10000 ms zaman aşımını korur', async () => {
    const waitMessages = [];
    const harness = createBackgroundSearchHarness({
        portalWindowId: 10,
        yoksisWindowId: 20,
        searchResult: {
            success: true,
            searchTriggered: true,
            formReady: false,
            formFingerprintBeforeSearch: 'fp-1',
            domRevisionBeforeSearch: 1
        },
        onWaitForm(message, callback) {
            waitMessages.push(message);
            callback({ success: true, formReady: true });
        }
    });

    const response = await harness.sendTransfer({ background: false, requestId: 'fg-wait-timeout-1' });

    assert.equal(response.success, true);
    assert.equal(response.formReady, true);
    assert.equal(waitMessages.length, 1);
    assert.equal(waitMessages[0].timeoutMs, 10000);
});

test('waitForYoksisFormReady options.timeoutMs değerini 1000..10000 aralığına sınırlar', async () => {
    const waitMessages = [];
    const harness = createBackgroundSearchHarness({
        onWaitForm(message, callback) {
            waitMessages.push(message);
            callback({ success: true, formReady: true });
        }
    });

    await harness.waitForYoksisFormReady(42, 'clamp-low', { timeoutMs: 500 });
    await harness.waitForYoksisFormReady(42, 'clamp-high', { timeoutMs: 99999 });
    await harness.waitForYoksisFormReady(42, 'clamp-default');

    assert.deepEqual(
        waitMessages.map((msg) => msg.timeoutMs),
        [1000, 10000, 10000]
    );
});
