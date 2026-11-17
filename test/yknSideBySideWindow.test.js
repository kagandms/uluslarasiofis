import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import test from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const backgroundSource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/background.js'), 'utf8');
const portalSecuritySource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/portal-security.js'), 'utf8');
const storageLifecycleSource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/storage-lifecycle.js'), 'utf8');
const bridgeSource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/bridge.js'), 'utf8');
const popupHtmlSource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/popup.html'), 'utf8');
const popupJsSource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/popup.js'), 'utf8');

function createSideBySideBackgroundHarness(options = {}) {
    const calls = [];
    const warnings = [];
    let messageHandler = null;
    let nextWindowId = options.nextWindowId || 200;
    let nextTabId = options.nextTabId || 99;
    const portalWindowId = options.portalWindowId ?? 10;
    const portalTabId = options.portalTabId ?? 1;
    const storageValues = { ...(options.localStorage || {}) };
    const sessionStorage = { ...(options.sessionStorage || {}) };
    const windows = new Map(
        (options.windows || [
            { id: portalWindowId, state: 'maximized' },
            { id: 20, state: 'maximized' }
        ]).map((win) => [win.id, { ...win }])
    );
    const tabs = (options.initialTabs || [
        { id: portalTabId, url: 'http://localhost:5173/yetkili/', active: true, windowId: portalWindowId },
        ...(options.hasYoksisTab === false
            ? []
            : [{
                id: 42,
                url: 'https://yoksis.yok.gov.tr/student',
                active: true,
                windowId: options.yoksisWindowId ?? portalWindowId
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
                    callback({ success: true, alreadyOpen: true, durationMs: 5 });
                    return;
                }
                if (message.action === 'searchWithId') {
                    callback({ success: true, searchTriggered: true, formReady: true });
                    return;
                }
                callback({ success: true });
            }
        },
        windows: {
            async get(windowId) {
                calls.push({ type: 'get-window', windowId });
                if (options.throwOnWindowGet) throw new Error('windows.get failed');
                const win = windows.get(windowId);
                if (!win) throw new Error(`No window with id ${windowId}`);
                return { ...win };
            },
            async update(windowId, updateProperties) {
                calls.push({ type: 'update-window', windowId, updateProperties });
                if (options.throwOnWindowUpdate) throw new Error('windows.update failed');
                if (options.throwOnPlacementUpdate && !Object.hasOwn(updateProperties, 'focused')) {
                    throw new Error('windows.update bounds failed');
                }
                const win = windows.get(windowId) || { id: windowId };
                Object.assign(win, updateProperties);
                windows.set(windowId, win);
                return { ...win };
            },
            async create(createData) {
                calls.push({ type: 'create-window', createData });
                if (options.throwOnWindowCreate) throw new Error('windows.create failed');
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
        warnings,
        windows,
        tabs,
        storageValues,
        sessionStorage,
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
                requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                data: { yoksisId: 'SYNTH-123-AB', firstName: 'SYNTHETIC' },
                screenArea: { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1040 },
                yknViewOpen: true,
                ...overrides
            };
            return new Promise((resolveResponse) => {
                const isAsync = messageHandler(request, { tab: senderTab }, resolveResponse);
                assert.equal(isAsync, true);
            });
        }
    };
}

function getPlacementCalls(calls) {
    return calls.filter((call) =>
        call.type === 'create-window'
        || call.type === 'get-window'
        || (call.type === 'update-window' && !Object.hasOwn(call.updateProperties, 'focused'))
    );
}

test('tercih kapalıyken hiçbir yeni pencere yerleştirme çağrısı yapılmaz', async () => {
    const harness = createSideBySideBackgroundHarness({
        localStorage: { yoksisSideBySideEnabled: false },
        yoksisWindowId: 10,
        portalWindowId: 10
    });

    const response = await harness.sendTransfer();

    assert.equal(response.success, true);
    assert.deepEqual(getPlacementCalls(harness.calls), []);
    const focusCalls = harness.calls.filter(
        (call) => call.type === 'update-window' && call.updateProperties.focused === true
    );
    assert.equal(focusCalls.length, 2);
});

test('YÖKSİS ve portal aynı penceredeyse YÖKSİS sağ yarıya yeni pencereye taşınır ve portal sol yarıya alınır', async () => {
    const harness = createSideBySideBackgroundHarness({
        portalWindowId: 10,
        yoksisWindowId: 10
    });

    const response = await harness.sendTransfer({
        screenArea: { availLeft: 100, availTop: 40, availWidth: 1921, availHeight: 1000 }
    });

    assert.equal(response.success, true);
    const createdWinCall = harness.calls.find((call) => call.type === 'create-window');
    assert.ok(createdWinCall);
    assert.deepEqual(JSON.parse(JSON.stringify(createdWinCall.createData)), {
        tabId: 42,
        state: 'normal',
        focused: false,
        left: 1060,
        top: 40,
        width: 961,
        height: 1000
    });

    const portalUpdates = harness.calls.filter(
        (call) => call.type === 'update-window' && call.windowId === 10 && !Object.hasOwn(call.updateProperties, 'focused')
    );
    assert.deepEqual(JSON.parse(JSON.stringify(portalUpdates.map((call) => call.updateProperties))), [
        { state: 'normal' },
        { left: 100, top: 40, width: 960, height: 1000 }
    ]);

    assert.deepEqual(JSON.parse(JSON.stringify(harness.sessionStorage.yoksisSideBySideWindowState)), {
        yoksisWindowId: 200,
        portalWindowId: 10
    });

    const focusWindowIds = harness.calls
        .filter((call) => call.type === 'update-window' && call.updateProperties.focused === true)
        .map((call) => call.windowId);
    assert.deepEqual(focusWindowIds, [200, 10]);
});

test('ikinci aramada aynı pencere çifti tekrar taşınmaz', async () => {
    const harness = createSideBySideBackgroundHarness({
        portalWindowId: 10,
        yoksisWindowId: 10
    });

    const first = await harness.sendTransfer({ requestId: 'search-1' });
    assert.equal(first.success, true);
    assert.ok(getPlacementCalls(harness.calls).length > 0);

    harness.calls.length = 0;

    const second = await harness.sendTransfer({ requestId: 'search-2' });
    assert.equal(second.success, true);
    assert.deepEqual(getPlacementCalls(harness.calls), []);
    const focusCalls = harness.calls.filter(
        (call) => call.type === 'update-window' && call.updateProperties.focused === true
    );
    assert.deepEqual(focusCalls.map((call) => call.windowId), [200, 10]);
});

test('YÖKSİS sekmesi yoksa sağ yarıda yeni pencerede açılır ve arama akışı tamamlanır', async () => {
    const harness = createSideBySideBackgroundHarness({
        portalWindowId: 10,
        hasYoksisTab: false
    });

    const response = await harness.sendTransfer({
        requestId: 'open-new-window',
        screenArea: { availLeft: 0, availTop: 0, availWidth: 1600, availHeight: 900 }
    });

    assert.equal(response.success, true);
    assert.equal(response.formReady, true);
    assert.equal(harness.calls.some((call) => call.type === 'create-tab'), false);

    const createdWinCall = harness.calls.find((call) => call.type === 'create-window');
    assert.ok(createdWinCall);
    assert.deepEqual(JSON.parse(JSON.stringify(createdWinCall.createData)), {
        url: 'https://yoksis.yok.gov.tr/',
        focused: false,
        state: 'normal',
        left: 800,
        top: 0,
        width: 800,
        height: 900
    });

    const portalUpdates = harness.calls.filter(
        (call) => call.type === 'update-window' && call.windowId === 10 && !Object.hasOwn(call.updateProperties, 'focused')
    );
    assert.deepEqual(JSON.parse(JSON.stringify(portalUpdates.map((call) => call.updateProperties))), [
        { state: 'normal' },
        { left: 0, top: 0, width: 800, height: 900 }
    ]);

    assert.ok(harness.calls.some((call) => call.type === 'message' && call.message.action === 'searchWithId'));
});

test('yknViewOpen false veya screenArea yokken pencere yerleştirme çağrısı yapılmaz', async () => {
    for (const overrides of [
        { yknViewOpen: false },
        { screenArea: undefined, yknViewOpen: true },
        { screenArea: { availLeft: 0, availTop: 0, availWidth: 0, availHeight: 900 }, yknViewOpen: true }
    ]) {
        const harness = createSideBySideBackgroundHarness({
            portalWindowId: 10,
            yoksisWindowId: 10
        });

        const response = await harness.sendTransfer(overrides);

        assert.equal(response.success, true);
        assert.deepEqual(getPlacementCalls(harness.calls), []);
    }
});

test('windows API hatalarında uyarı loglanır ancak arama ve aktarım yine başarılı olur', async () => {
    for (const faultOption of [
        { throwOnWindowGet: true, yoksisWindowId: 20 },
        { throwOnPlacementUpdate: true, yoksisWindowId: 20 },
        { throwOnWindowCreate: true, yoksisWindowId: 10 },
        { throwOnWindowCreate: true, hasYoksisTab: false },
        { throwOnWindowUpdate: true, yoksisWindowId: 20 }
    ]) {
        const harness = createSideBySideBackgroundHarness({
            portalWindowId: 10,
            ...faultOption
        });

        const response = await harness.sendTransfer({ requestId: 'fault-tolerant' });

        assert.equal(response.success, true);
        assert.equal(response.formReady, true);
        assert.ok(harness.warnings.length > 0);
    }
});

test('bridge.js ekran alanını ve yknViewOpen durumunu sahteciliğe izin vermeden iletir', async () => {
    const dom = new JSDOM(`
        <section id="workspace-content">
            <section id="view-ykn"></section>
        </section>
    `, { url: 'http://localhost:5173/yetkili/', runScripts: 'outside-only' });

    const sentMessages = [];
    const { window } = dom;
    window.fetch = async () => ({ ok: true });
    Object.defineProperty(window, 'screen', {
        configurable: true,
        value: { availLeft: -1920, availTop: 0, availWidth: 1920, availHeight: 1080 }
    });
    window.chrome = {
        runtime: {
            id: 'mock-ext',
            lastError: null,
            sendMessage(message, callback) {
                sentMessages.push(message);
                callback({ success: true });
            },
            onMessage: { addListener() {} }
        }
    };
    window.eval(bridgeSource);

    const dispatchPortalMessage = async () => {
        window.dispatchEvent(new window.MessageEvent('message', {
            source: window,
            origin: 'http://localhost:5173',
            data: {
                source: 'WEB_APP',
                payload: {
                    action: 'TRANSFER_TO_YOKSIS',
                    requestId: 'bridge-test-1',
                    data: { yoksisId: 'SYNTH-1' },
                    yknViewOpen: true,
                    screenArea: { availLeft: 999, availTop: 999, availWidth: 100, availHeight: 100 }
                }
            }
        }));
        await new Promise((resolve) => setTimeout(resolve, 20));
    };

    try {
        await dispatchPortalMessage();
        assert.equal(sentMessages.length, 1);
        assert.equal(sentMessages[0].yknViewOpen, true);
        assert.deepEqual({ ...sentMessages[0].screenArea }, {
            availLeft: -1920,
            availTop: 0,
            availWidth: 1920,
            availHeight: 1080
        });

        window.document.getElementById('view-ykn').hidden = true;
        await dispatchPortalMessage();
        assert.equal(sentMessages.length, 2);
        assert.equal(sentMessages[1].yknViewOpen, false);

        window.document.getElementById('view-ykn').hidden = false;
        window.document.getElementById('workspace-content').hidden = true;
        await dispatchPortalMessage();
        assert.equal(sentMessages.length, 3);
        assert.equal(sentMessages[2].yknViewOpen, false);
    } finally {
        window.close();
    }
});

test('popup onay kutusu varsayılan olarak açıktır ve chrome.storage.local ile senkronlanır', async () => {
    for (const [initialStored, expectedInitialChecked] of [
        [{}, true],
        [{ yoksisSideBySideEnabled: false }, false],
        [{ yoksisSideBySideEnabled: true }, true]
    ]) {
        const dom = new JSDOM(popupHtmlSource, { url: 'https://example.invalid/popup.html', runScripts: 'outside-only' });
        const { window } = dom;
        const storage = { ...initialStored };
        window.chrome = {
            runtime: { lastError: null },
            storage: {
                local: {
                    get(_keys, callback) {
                        callback(storage);
                    },
                    set(values, callback) {
                        Object.assign(storage, values);
                        if (callback) callback();
                    }
                }
            }
        };
        window.eval(popupJsSource);
        window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

        try {
            const checkbox = window.document.getElementById('chk-yoksis-side-by-side');
            assert.ok(checkbox);
            assert.equal(checkbox.checked, expectedInitialChecked);

            checkbox.checked = !expectedInitialChecked;
            checkbox.dispatchEvent(new window.Event('change'));
            assert.equal(storage.yoksisSideBySideEnabled, !expectedInitialChecked);
        } finally {
            window.close();
        }
    }
});
