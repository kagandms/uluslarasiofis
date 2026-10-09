import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import test from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const contentSource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/content.js'), 'utf8');
const zkControlsSource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/zk-form-controls.js'), 'utf8');
const backgroundSource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/background.js'), 'utf8');
const portalSecuritySource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/portal-security.js'), 'utf8');
const storageLifecycleSource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/storage-lifecycle.js'), 'utf8');

for (const [label, expected] of [['Female', 'Kadın'], ['Male', 'Erkek']]) {
    test(`Apply selected ${label} is authoritative despite a conflicting name and option code`, async () => {
        const harness = createContentHarness(`<input name="firstName" value="ALI"><input name="lastName" value="TESTOVA">
            <label for="gender">Gender</label><select id="gender"><option value="${expected === 'Kadın' ? '1' : '2'}" selected>${label}</option></select>`,
        'https://apply.topkapi.edu.tr/panel/student');

        try {
            const response = await harness.send({ action: 'copyData' });

            assert.equal(response.data.cinsiyet, expected);
        } finally { harness.close(); }
    });
}

for (const markup of ['', '<label for="gender">Gender</label><select id="gender"><option selected value="1">Select</option></select>']) {
    test(`Apply missing or undocumented coded gender never falls back to a name (${markup ? 'coded' : 'absent'})`, async () => {
        const harness = createContentHarness(`<input name="firstName" value="ALI"><input name="lastName" value="TESTOVA">${markup}`,
            'https://apply.topkapi.edu.tr/panel/student');

        try {
            const response = await harness.send({ action: 'copyData' });

            assert.equal(response.data.cinsiyet, '');
        } finally { harness.close(); }
    });
}

test('a populated prior YÖKSİS form cannot be replaced without explicit consent', async () => {
    const harness = createContentHarness(`<table><tr><td>Kabul Mektup ID</td><td><input title="Kabul Mektup ID"></td><td><button id="search">Kabul Mektup ID ile Ara</button></td></tr>
        <tr><td>Anne Adı</td><td><input value="PREVIOUS"></td></tr><tr><td>Belge No</td><td><input value="PREVIOUS"></td></tr></table>`, 'https://yoksis.yok.gov.tr/student');
    let searches = 0;
    harness.dom.window.confirm = () => false;
    harness.dom.window.document.getElementById('search').onclick = () => { searches += 1; };

    try {
        const response = await harness.send({ action: 'searchWithId', kabulId: 'NEW-123-ID', waitForForm: false });

        assert.equal(searches, 0);
        assert.equal(response.success, false);
        assert.equal(response.allowMainFallback, false);
        assert.match(response.message, /onay|korundu/i);
    } finally { harness.close(); }
});

test('approved new-record reset sends exactly one click before reacquiring the acceptance controls', async () => {
    const harness = createContentHarness(`<table><tr><td>Anne Adı</td><td><input value="PREVIOUS"></td></tr>
        <tr><td>Belge No</td><td><input value="PREVIOUS"></td></tr></table><button id="reset">Temizle</button>`, 'https://yoksis.yok.gov.tr/student');
    harness.dom.window.confirm = () => true;
    let resets = 0;
    harness.dom.window.document.getElementById('reset').onclick = () => {
        resets += 1;
        harness.dom.window.document.body.innerHTML = `<table><tr><td>Kabul Mektup ID</td><td><input id="fresh-code" title="Kabul Mektup ID"></td><td><button>Kabul Mektup ID ile Ara</button></td></tr></table>`;
    };

    try {
        const response = await harness.send({ action: 'searchWithId', kabulId: 'NEW-123-ID', waitForForm: false });

        assert.equal(resets, 1);
        assert.equal(harness.dom.window.document.getElementById('fresh-code').value, 'NEW-123-ID');
        assert.equal(response.searchTriggered, true);
    } finally { harness.close(); }
});

function installInnerText(window) {
    Object.defineProperty(window.Element.prototype, 'innerText', {
        configurable: true,
        get() {
            return this.textContent || '';
        },
        set(value) {
            this.textContent = value;
        }
    });
}

function createDataTransfer(window) {
    return class MockDataTransfer {
        constructor() {
            this.files = [];
            this.items = {
                add: (file) => this.files.push(file)
            };
        }
    };
}

function createContentHarness(markup, url, storedData = {}) {
    const dom = new JSDOM(markup, { url, runScripts: 'outside-only' });
    const { window } = dom;
    let messageHandler = null;
    const storage = { ...storedData };

    window.chrome = {
        runtime: {
            id: 'mock-extension',
            lastError: null,
            onMessage: {
                addListener(handler) {
                    messageHandler = handler;
                }
            },
            sendMessage(message, callback) {
                const response = message.action === 'YOKSIS_ZK_COMMAND' ? window.YknZkForm.execute(message.command) : Promise.resolve({ success: true });
                if (callback) void response.then(callback);
                return response;
            }
        },
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
    window.DataTransfer = createDataTransfer(window);
    window.PointerEvent = window.MouseEvent;
    installInnerText(window);
    window.eval(zkControlsSource);
    window.eval(contentSource);

    return {
        dom,
        close() {
            dom.window.close();
        },
        async send(request) {
            assert.ok(messageHandler, 'content message listener was not registered');
            return new Promise((resolveResponse) => {
                const isAsync = messageHandler(request, {}, resolveResponse);
                assert.equal(isAsync, true);
            });
        }
    };
}

function makeFileInputWritable(input) {
    Object.defineProperty(input, 'files', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: []
    });
}

function createBackgroundHarness(mainResult, searchResult, options = {}) {
    const calls = [];
    const timingLogs = [];
    let messageHandler = null;
    let verificationCount = 0;
    let hasYoksisTab = options.hasYoksisTab !== false;
    const storageValues = {};
    const yoksisTab = {
        id: 42,
        url: 'https://yoksis.yok.gov.tr/student',
        active: true,
        windowId: 7
    };
    const yoksisTabs = options.yoksisTabs || [yoksisTab];
    const createdYoksisTab = {
        id: options.createdYoksisTabId || 99,
        url: 'https://yoksis.yok.gov.tr/',
        active: false,
        windowId: 8
    };
    const sessionStorage = options.sessionStorage || {};

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
                set(_values, callback) {
                    Object.assign(storageValues, _values);
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
            async executeScript(options) {
                calls.push({ type: 'script', options });
                if (options.files?.includes('zk-form-controls.js')) return [];
                if (options.func?.name === 'executeYoksisZkCommand') return [{ result: { success: true, verified: true } }];
                if (options.world === 'MAIN') return [{ result: mainResult }];
                return [];
            }
        },
        tabs: {
            onUpdated: { addListener() {} },
            query(queryInfo, callback) {
                if (Array.isArray(queryInfo.url) || queryInfo.url === '*://yoksis.yok.gov.tr/*') {
                    callback(hasYoksisTab ? yoksisTabs : []);
                    return;
                }
                callback([]);
            },
            get(tabId, callback) {
                const tab = yoksisTabs.find((candidate) => candidate.id === tabId);
                chrome.runtime.lastError = tab ? null : { message: 'No tab with id' };
                callback(tab || null);
            },
            create(createProperties, callback) {
                calls.push({ type: 'create-tab', createProperties });
                hasYoksisTab = true;
                yoksisTabs.push({ ...createdYoksisTab, ...createProperties });
                callback({ ...createdYoksisTab, ...createProperties });
            },
            update(tabId, updateProperties, callback) {
                calls.push({ type: 'update-tab', tabId, updateProperties });
                const matchingTab = yoksisTabs.find((tab) => tab.id === tabId) || yoksisTab;
                callback({ ...matchingTab, ...updateProperties });
            },
            sendMessage(tabId, message, optionsOrCallback, maybeCallback) {
                const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
                calls.push({ type: 'message', tabId, message });
                chrome.runtime.lastError = null;
                if (message.action === 'PING') {
                    const targetTab = yoksisTabs.find((tab) => tab.id === tabId) || yoksisTab;
                    callback({ ready: true, pageKind: 'yoksis', url: targetTab.url });
                    return;
                }
                if (message.action === 'searchWithId') {
                    callback(searchResult);
                    return;
                }
                if (message.action === 'GET_YOKSIS_FORM_STATE') {
                    callback({ success: true, fingerprint: 'previous-student', domRevision: 7, hasPopulatedStudentForm: false });
                    return;
                }
                if (message.action === 'WAIT_YOKSIS_FORM') {
                    callback({ success: true, formReady: true });
                    return;
                }
                if (message.action === 'verifyYoksisFields') {
                    verificationCount += 1;
                    callback((verificationCount > 1 ? options.finalVerificationResult : null) || options.verificationResult || {
                        success: Array.isArray(mainResult?.filledFields) && mainResult.filledFields.length > 0,
                        filledFields: mainResult?.filledFields || [],
                        missingFields: mainResult?.missingFields || []
                    });
                    return;
                }
                if (message.action === 'fillRemainingData') {
                    callback(typeof options.contentResult === 'function'
                        ? options.contentResult(message)
                        : options.contentResult || { success: true, filledFields: [], missingFields: [] });
                    return;
                }
                callback({ success: true });
            }
        },
        windows: {
            async update(windowId, updateProperties) {
                calls.push({ type: 'focus-window', windowId, updateProperties });
            }
        }
    };

    const backgroundContext = vm.createContext({
        chrome,
        URL,
        console: {
            ...console,
            info(...args) {
                timingLogs.push(args);
            }
        },
        __YKN_DIAGNOSTICS_ENABLED__: options.diagnostics === true,
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
        timingLogs,
        async send(request) {
            assert.ok(messageHandler, 'background message listener was not registered');
            return new Promise((resolveResponse) => {
                const isAsync = messageHandler(request, {
                    tab: { id: 1, url: 'http://localhost:5173/yetkili/' }
                }, resolveResponse);
                assert.equal(isAsync, true);
            });
        },
        async sendFrom(request, senderUrl) {
            assert.ok(messageHandler, 'background message listener was not registered');
            return new Promise((resolveResponse) => {
                messageHandler(request, { tab: { id: 2, url: senderUrl } }, resolveResponse);
            });
        }
    };
}

test('extension rejects staff bridge messages from an untrusted page before running workflows', async () => {
    const harness = createBackgroundHarness(
        { inputFound: false, buttonFound: false },
        { success: true, searchTriggered: true, formReady: true }
    );

    const response = await harness.sendFrom({
        source: 'IKAMET_PORTAL',
        action: 'TRANSFER_TO_YOKSIS',
        requestId: 'untrusted-request',
        data: { yoksisId: 'AB-123-CD' }
    }, 'https://evil.example/yetkili/');

    assert.equal(response.success, false);
    assert.equal(response.error, 'İstek doğrulanamadı. Yetkili portalı yenileyip tekrar deneyin.');
    assert.equal(harness.calls.some((call) => call.type === 'message' && call.message.action === 'searchWithId'), false);
});

test('YÖKSİS search handles ZK-labelled controls and confirms delayed form readiness', async () => {
    const harness = createContentHarness(`
        <table>
            <tr><td>Kabul Mektup ID</td><td><input id="tGDP49-chdextr" class="z-textbox" title="Kabul Mektup Id veya YÖKSİS Id"></td><td><button id="tGDPa9" class="s-button s-button-submit z-button">Kabul Mektup ID ile Ara</button></td></tr>
        </table>
    `, 'https://yoksis.yok.gov.tr/student');
    let clickCount = 0;
    harness.dom.window.document.getElementById('tGDPa9').addEventListener('click', () => {
        clickCount += 1;
        setTimeout(() => {
            harness.dom.window.document.body.insertAdjacentHTML('beforeend', `
                <table id="student-form">
                    <tr><td>Anne Adı</td><td><input id="mother-name"></td></tr>
                    <tr><td>Belge No</td><td><input id="document-number"></td></tr>
                </table>
            `);
        }, 25);
    });

    try {
        const response = await harness.send({
            action: 'searchWithId',
            kabulId: 'AB-123-CD',
            requestId: 'workflow-1'
        });

        assert.equal(response.success, true);
        assert.equal(response.formReady, true);
        assert.equal(harness.dom.window.document.getElementById('tGDP49-chdextr').value, 'AB-123-CD');
        assert.ok(clickCount > 0);
    } finally {
        harness.close();
    }
});

test('YKN request navigation opens the menu once and activates the destination once', async () => {
    const harness = createContentHarness(`
        <nav>
            <a id="student-menu" class="z-menu" href="#">Öğrenci İşlemleri</a>
            <div id="student-menu-popup" style="display:none">
                <a id="ykn-request-entry" class="z-menu-item" href="#">Göç İdaresinden YKN Talebi V2</a>
            </div>
        </nav>
    `, 'https://yoksis.yok.gov.tr/');
    const document = harness.dom.window.document;
    const menu = document.getElementById('student-menu');
    const popup = document.getElementById('student-menu-popup');
    const entry = document.getElementById('ykn-request-entry');
    let menuOpenTransitions = 0;
    let navigationClicks = 0;
    menu.addEventListener('mouseover', () => {
        if (popup.style.display === 'none') menuOpenTransitions += 1;
        popup.style.display = 'block';
    });
    menu.addEventListener('click', (event) => {
        event.preventDefault();
        popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
    });
    entry.addEventListener('click', (event) => {
        event.preventDefault();
        navigationClicks += 1;
        document.body.innerHTML = `
            <table><tr><td>Kabul Mektup ID</td><td><input title="Kabul Mektup ID"></td>
            <td><button>Kabul Mektup ID ile Ara</button></td></tr></table>
        `;
    });

    try {
        const response = await harness.send({
            action: 'OPEN_YOKSIS_YKN_REQUEST',
            requestId: 'navigation-single-flight'
        });

        assert.equal(response.success, true);
        assert.equal(response.alreadyOpen, false);
        assert.equal(menuOpenTransitions, 1);
        assert.equal(navigationClicks, 1);
    } finally {
        harness.close();
    }
});

test('YKN request navigation reuses the already-open acceptance search screen', async () => {
    const harness = createContentHarness(`
        <table><tr>
            <td>Kabul Mektup ID</td>
            <td><input title="Kabul Mektup ID"></td>
            <td><button>Kabul Mektup ID ile Ara</button></td>
        </tr></table>
    `, 'https://yoksis.yok.gov.tr/student');

    try {
        const response = await harness.send({
            action: 'OPEN_YOKSIS_YKN_REQUEST',
            requestId: 'navigation-already-open'
        });

        assert.equal(response.success, true);
        assert.equal(response.alreadyOpen, true);
    } finally {
        harness.close();
    }
});

test('YKN navigation waits for a visible delayed entry instead of clicking a stale hidden one', async () => {
    const harness = createContentHarness(`
        <nav>
            <a id="student-menu" class="z-menu" href="#">Öğrenci İşlemleri</a>
            <div style="display:none"><a id="stale-entry" class="z-menu-item" href="#">Göç İdaresinden YKN Talebi V2</a></div>
            <div id="student-menu-popup" style="display:none"></div>
        </nav>
    `, 'https://yoksis.yok.gov.tr/');
    const document = harness.dom.window.document;
    const menu = document.getElementById('student-menu');
    const popup = document.getElementById('student-menu-popup');
    let staleClicks = 0;
    let visibleClicks = 0;
    document.getElementById('stale-entry').addEventListener('click', () => { staleClicks += 1; });
    menu.addEventListener('mouseover', () => {
        setTimeout(() => {
            popup.style.display = 'block';
            popup.innerHTML = '<a id="visible-entry" class="z-menu-item" href="#">Göç İdaresinden YKN Talebi V2</a>';
            popup.firstElementChild.addEventListener('click', (event) => {
                event.preventDefault();
                visibleClicks += 1;
                document.body.insertAdjacentHTML('beforeend', '<input title="Kabul Mektup ID"><button>Kabul Mektup ID ile Ara</button>');
            });
        }, 30);
    });

    try {
        const response = await harness.send({
            action: 'OPEN_YOKSIS_YKN_REQUEST',
            requestId: 'navigation-delayed-menu'
        });

        assert.equal(response.success, true);
        assert.equal(staleClicks, 0);
        assert.equal(visibleClicks, 1);
    } finally {
        harness.close();
    }
});

test('YÖKSİS search uses the ZK button cell beside the acceptance input once', async () => {
    const harness = createContentHarness(`
        <table>
            <tr>
                <td>Kabul Mektup Id</td>
                <td><input class="z-textbox" title="Kabul Mektup Id veya YÖKSİS ID"></td>
                <td class="z-button-cm"><table class="z-button"><tbody><tr><td><span>Kabul Mektup Id ile Ara</span></td></tr></tbody></table></td>
            </tr>
        </table>
    `, 'https://yoksis.yok.gov.tr/student');
    let clickCount = 0;
    const button = harness.dom.window.document.querySelector('table.z-button');
    button.addEventListener('click', () => {
        clickCount += 1;
        setTimeout(() => {
            harness.dom.window.document.body.insertAdjacentHTML('beforeend', `
                <table id="student-form">
                    <tr><td>Anne Adı</td><td><input id="mother-name"></td></tr>
                    <tr><td>Belge No</td><td><input id="document-number"></td></tr>
                </table>
            `);
        }, 25);
    });

    try {
        const response = await harness.send({
            action: 'searchWithId',
            kabulId: '821 EC2 34',
            requestId: 'workflow-zk-button'
        });

        assert.equal(response.success, true);
        assert.equal(response.searchTriggered, true);
        assert.equal(response.buttonFound, true);
        assert.equal(harness.dom.window.document.querySelector('input.z-textbox').value, '821-EC2-34');
        assert.equal(clickCount, 1);
    } finally {
        harness.close();
    }
});

test('YÖKSİS search ignores hidden controls left by the previous student', async () => {
    const harness = createContentHarness(`
        <table id="old-search" style="display: none">
            <tr><td>Kabul Mektup ID</td><td><input id="old-acceptance-id"></td><td><button id="old-search-button">Kabul Mektup ID ile Ara</button></td></tr>
        </table>
        <table id="current-search">
            <tr><td>Kabul Mektup ID</td><td><input id="current-acceptance-id"></td><td><button id="current-search-button">Kabul Mektup ID ile Ara</button></td></tr>
        </table>
    `, 'https://yoksis.yok.gov.tr/student');
    let oldSearchClicks = 0;
    let currentSearchClicks = 0;
    harness.dom.window.document.getElementById('old-search-button').addEventListener('click', () => {
        oldSearchClicks += 1;
    });
    harness.dom.window.document.getElementById('current-search-button').addEventListener('click', () => {
        currentSearchClicks += 1;
        setTimeout(() => {
            harness.dom.window.document.body.insertAdjacentHTML('beforeend', `
                <table id="new-student-form">
                    <tr><td>Anne Adı</td><td><input id="mother-name"></td></tr>
                    <tr><td>Belge No</td><td><input id="document-number"></td></tr>
                </table>
            `);
        }, 25);
    });

    try {
        const response = await harness.send({
            action: 'searchWithId',
            kabulId: 'ZX-987-KL',
            requestId: 'workflow-hidden-previous-student'
        });

        assert.equal(response.success, true);
        assert.equal(oldSearchClicks, 0);
        assert.ok(currentSearchClicks > 0);
        assert.equal(harness.dom.window.document.getElementById('current-acceptance-id').value, 'ZX-987-KL');
    } finally {
        harness.close();
    }
});

test('YÖKSİS araması, onChange sonrası yeniden oluşturulan kabul alanına kodu tekrar yazar', async () => {
    const harness = createContentHarness(`
        <div id="search-host">
            <table><tr><td>Kabul Mektup ID</td><td><input id="acceptance-id"></td><td><button id="search">Kabul Mektup ID ile Ara</button></td></tr></table>
        </div>
    `, 'https://yoksis.yok.gov.tr/student');
    const host = harness.dom.window.document.getElementById('search-host');
    let rerendered = false;
    let clickCount = 0;

    const bindSearchControls = () => {
        const input = harness.dom.window.document.getElementById('acceptance-id');
        const button = harness.dom.window.document.getElementById('search');
        input.addEventListener('change', () => {
            if (rerendered) return;
            rerendered = true;
            host.innerHTML = '<table><tr><td>Kabul Mektup ID</td><td><input id="acceptance-id"></td><td><button id="search">Kabul Mektup ID ile Ara</button></td></tr></table>';
            bindSearchControls();
        });
        button.addEventListener('click', () => {
            clickCount += 1;
            setTimeout(() => {
                harness.dom.window.document.body.insertAdjacentHTML('beforeend', `
                    <table id="student-form">
                        <tr><td>Anne Adı</td><td><input id="mother-name"></td></tr>
                        <tr><td>Belge No</td><td><input id="document-number"></td></tr>
                    </table>
                `);
            }, 25);
        });
    };
    bindSearchControls();

    try {
        const response = await harness.send({
            action: 'searchWithId',
            kabulId: 'AB-123-CD',
            requestId: 'workflow-zk-rerender'
        });

        assert.equal(response.success, true);
        assert.equal(harness.dom.window.document.getElementById('acceptance-id').value, 'AB-123-CD');
        assert.equal(clickCount, 1);
    } finally {
        harness.close();
    }
});

test('YÖKSİS ikinci aramada aynı parmak izli formun gerçekten yenilendiğini doğrular', async () => {
    const studentForm = `
        <table id="student-form">
            <tr><td>Anne Adı</td><td><input id="mother-name"></td></tr>
            <tr><td>Belge No</td><td><input id="document-number"></td></tr>
        </table>
    `;
    const harness = createContentHarness(`
        <table>
            <tr><td>Kabul Mektup ID</td><td><input id="acceptance-id"></td><td><button id="search">Kabul Mektup ID ile Ara</button></td></tr>
        </table>
        ${studentForm}
    `, 'https://yoksis.yok.gov.tr/student');
    const search = harness.dom.window.document.getElementById('search');
    search.addEventListener('click', () => {
        setTimeout(() => {
            // Yeni öğrencinin formu aynı id/etiketler ve boş değerlerle gelebilir.
            // Sadece fingerprint kullanan eski yaklaşım bunu önceki form sanıyordu.
            harness.dom.window.document.getElementById('student-form').outerHTML = studentForm;
        }, 25);
    });

    try {
        const response = await harness.send({
            action: 'searchWithId',
            kabulId: 'ZX-456-YW',
            requestId: 'workflow-second-student'
        });

        assert.equal(response.success, true);
        assert.equal(response.formReady, true);
        assert.equal(harness.dom.window.document.getElementById('acceptance-id').value, 'ZX-456-YW');
    } finally {
        harness.close();
    }
});

test('YÖKSİS hazır kontrolü önceki formu yeni aramanın sonucu saymaz', async () => {
    const harness = createContentHarness(`
        <table id="student-form">
            <tr><td>Anne Adı</td><td><input id="mother-name"></td></tr>
            <tr><td>Belge No</td><td><input id="document-number"></td></tr>
        </table>
    `, 'https://yoksis.yok.gov.tr/student');

    try {
        const state = await harness.send({ action: 'GET_YOKSIS_FORM_STATE', requestId: 'old-form-state' });
        const response = await harness.send({
            action: 'WAIT_YOKSIS_FORM',
            timeoutMs: 250,
            afterFingerprint: state.fingerprint,
            afterDomRevision: state.domRevision,
            requireFreshResult: true,
            requestId: 'must-not-accept-old-form'
        });

        assert.equal(response.success, false);
        assert.equal(response.formReady, false);
    } finally {
        harness.close();
    }
});

test('Apply pasaport araması, yan sekmedeki arama alanına tam Enter zincirini gönderir', async () => {
    const harness = createContentHarness(`
        <input class="inputDatatableSearch" type="search" placeholder="Tabloda ara">
        <table><tbody></tbody></table>
    `, 'https://apply.topkapi.edu.tr/panel/applications');
    const searchInput = harness.dom.window.document.querySelector('.inputDatatableSearch');
    const receivedEvents = [];
    for (const type of ['keydown', 'keypress', 'keyup']) {
        searchInput.addEventListener(type, (event) => receivedEvents.push([type, event.key]));
    }

    try {
        const response = await harness.send({
            action: 'SEARCH_IN_APPLY',
            passportNo: 'P123456',
            requestId: 'apply-enter-search'
        });
        await new Promise((resolve) => setTimeout(resolve, 100));

        assert.equal(response.success, true);
        assert.equal(searchInput.value, 'P123456');
        assert.deepEqual(receivedEvents, [
            ['keydown', 'Enter'],
            ['keypress', 'Enter'],
            ['keyup', 'Enter']
        ]);
    } finally {
        harness.close();
    }
});

test('YÖKSİS form readiness waits for a form that appears after the search response', async () => {
    const harness = createContentHarness('<div id="loading">Yükleniyor</div>', 'https://yoksis.yok.gov.tr/student');
    const formTimer = setTimeout(() => {
        harness.dom.window.document.body.innerHTML = `
            <table>
                <tr><td>Anne Adı</td><td><input id="mother-name"></td></tr>
                <tr><td>Belge No</td><td><input id="document-number"></td></tr>
            </table>
        `;
    }, 50);

    try {
        const response = await harness.send({
            action: 'WAIT_YOKSIS_FORM',
            timeoutMs: 1000,
            requestId: 'workflow-2'
        });

        assert.equal(response.success, true);
        assert.equal(response.formReady, true);
    } finally {
        clearTimeout(formTimer);
        harness.close();
    }
});

test('YÖKSİS fill reports photo upload truthfully and fills passport fields', async () => {
    const harness = createContentHarness(`
        <table>
            <tr><td>Adı</td><td><input id="first-name"></td></tr>
            <tr><td>Soyadı</td><td><input id="last-name"></td></tr>
            <tr><td>Anne Adı</td><td><input id="mother-name"></td></tr>
            <tr><td>Baba Adı</td><td><input id="father-name"></td></tr>
            <tr><td>Uyruğu</td><td><select id="nationality"><option>Türkiye</option></select></td></tr>
            <tr><td>Doğum Uyruğu</td><td><select id="birth-nationality"><option>Türkiye</option></select></td></tr>
            <tr><td>Doğum Yeri Ülkesi</td><td><select id="birth-country"><option>Türkiye</option></select></td></tr>
            <tr><td>Belgeyi Veren Ülke</td><td><select id="issue-country"><option>Türkiye</option></select></td></tr>
            <tr><td>Doğum Yeri Açıklaması</td><td><input id="birth-place"></td></tr>
            <tr><td>Belgeyi Veren Makam</td><td><input id="authority"></td></tr>
            <tr><td>Telefon No</td><td><input id="phone"></td></tr>
            <tr><td>Belge No</td><td><input id="document-number" placeholder="Belge No"></td></tr>
            <tr><td>Belge Düzenleme Tarihi</td><td><input id="issue-date"></td></tr>
            <tr><td>Belge Geçerlilik Tarihi</td><td><input id="expiry-date"></td></tr>
            <tr><td>Fotoğraf Adı</td><td><button id="photo-upload">Fotoğraf Yükle</button><input id="photo-file" type="file"></td></tr>
        </table>
    `, 'https://yoksis.yok.gov.tr/student');
    makeFileInputWritable(harness.dom.window.document.getElementById('photo-file'));

    try {
        const response = await harness.send({
            action: 'fillRemainingData',
            data: {
                firstName: 'TEST',
                lastName: 'STUDENT',
                anneAdi: 'ANNE',
                babaAdi: 'BABA',
                uyruk: 'Türkiye',
                dogumUlkesi: 'Türkiye',
                pasaportNo: 'P123456',
                birthPlace: 'ISTANBUL',
                issuingAuthority: 'NVI',
                issueDate: '2024-01-02',
                expiryDate: '2034-01-02',
                croppedPhotoBase64: 'data:image/jpeg;base64,AA==',
                photoFileName: 'student.jpg'
            }
        });

        assert.equal(response.success, true);
        assert.equal(response.photoUploaded, true);
        assert.equal(harness.dom.window.document.getElementById('first-name').value, 'TEST');
        assert.equal(harness.dom.window.document.getElementById('last-name').value, 'STUDENT');
        assert.equal(harness.dom.window.document.getElementById('mother-name').value, 'ANNE');
        assert.equal(harness.dom.window.document.getElementById('document-number').value, 'P123456');
        assert.equal(harness.dom.window.document.getElementById('issue-date').value, '02.01.2024');
        assert.equal(harness.dom.window.document.getElementById('expiry-date').value, '02.01.2034');
        assert.equal(harness.dom.window.document.getElementById('photo-file').files.length, 1);
    } finally {
        harness.close();
    }
});

test('photo-only MAIN result falls back to student fields and remains partial when a source field is still missing', async () => {
    const harness = createBackgroundHarness(
        { success: true, filledFields: [], missingFields: [], photoUploaded: true },
        { success: true, searchTriggered: true, formReady: true },
        {
            verificationResult: { success: false, filledFields: [], missingFields: ['Adı', 'Soyadı', 'Anne Adı', 'Baba Adı'] },
            finalVerificationResult: { success: false, filledFields: ['Adı', 'Soyadı', 'Anne Adı'], missingFields: ['Baba Adı'] },
            contentResult: {
                success: true,
                filledFields: ['Adı', 'Soyadı', 'Anne Adı'],
                missingFields: ['Baba Adı'],
                photoUploaded: false
            }
        }
    );
    const response = await harness.send({
        source: 'IKAMET_PORTAL',
        action: 'FILL_YOKSIS_FORM',
        requestId: 'photo-only-main-fallback',
        data: {
            yoksisReady: true,
            yoksisTabId: 42,
            yoksisTabUrl: 'https://yoksis.yok.gov.tr/student',
            firstName: 'TEST',
            lastName: 'STUDENT',
            anneAdi: 'ANNE',
            babaAdi: 'BABA',
            croppedPhotoBase64: 'data:image/jpeg;base64,AA=='
        }
    });

    const fallback = harness.calls.find((call) => call.type === 'message' && call.message.action === 'fillRemainingData');
    assert.ok(fallback);
    assert.equal(fallback.message.data.croppedPhotoBase64, '');
    assert.equal(fallback.message.data.firstName, 'TEST');
    assert.equal(response.success, true);
    assert.equal(response.partial, true);
    assert.equal(response.photoUploaded, true);
    assert.deepEqual(Array.from(response.missingFields), ['Baba Adı']);
    assert.equal(response.fieldResults.find(({ label }) => label === 'Adı').status, 'verified');
    assert.equal(response.fieldResults.find(({ label }) => label === 'Baba Adı').status, 'missing');
});

test('photo alone never counts as a successful student-field transfer', async () => {
    const harness = createBackgroundHarness(
        { success: false, filledFields: [], missingFields: [], photoUploaded: true },
        { success: true, searchTriggered: true, formReady: true },
        {
            verificationResult: { success: false, filledFields: [], missingFields: ['Adı', 'Soyadı'] },
            contentResult: { success: false, filledFields: [], missingFields: ['Adı', 'Soyadı'], photoUploaded: false }
        }
    );

    const response = await harness.send({
        source: 'IKAMET_PORTAL',
        action: 'FILL_YOKSIS_FORM',
        requestId: 'photo-is-not-data-success',
        data: {
            yoksisReady: true,
            yoksisTabId: 42,
            yoksisTabUrl: 'https://yoksis.yok.gov.tr/student',
            firstName: 'TEST',
            lastName: 'STUDENT',
            croppedPhotoBase64: 'data:image/jpeg;base64,AA=='
        }
    });

    assert.equal(response.success, false);
    assert.equal(response.partial, true);
    assert.equal(response.photoUploaded, true);
    assert.deepEqual(Array.from(response.missingFields), ['Adı', 'Soyadı']);
});

test('unsettled ZK verification fails closed without running a competing fallback', async () => {
    const harness = createBackgroundHarness(
        { success: true, filledFields: ['Adı'], missingFields: [], photoUploaded: true },
        { success: true, searchTriggered: true, formReady: true },
        {
            verificationResult: {
                success: false,
                filledFields: [],
                missingFields: ['Adı', 'Soyadı'],
                failedFields: ['Adı', 'Soyadı'],
                error: 'YÖKSİS güncellemesi zamanında tamamlanmadı; alanlar doğrulanamadı.'
            }
        }
    );

    const response = await harness.send({
        source: 'IKAMET_PORTAL',
        action: 'FILL_YOKSIS_FORM',
        requestId: 'zk-update-timeout',
        data: {
            yoksisReady: true,
            yoksisTabId: 42,
            yoksisTabUrl: 'https://yoksis.yok.gov.tr/student',
            firstName: 'TEST',
            lastName: 'STUDENT',
            croppedPhotoBase64: 'data:image/jpeg;base64,AA=='
        }
    });

    assert.equal(response.success, false);
    assert.equal(response.partial, true);
    assert.match(response.error, /zamanında tamamlanmadı/);
    assert.equal(harness.calls.some((call) => call.type === 'message' && call.message.action === 'fillRemainingData'), false);
});

test('YÖKSİS field verifier detects values removed by a simulated photo postback', async () => {
    const harness = createContentHarness(`
        <table>
            <tr><td>Adı</td><td><input id="first-name" value="TEST"></td></tr>
            <tr><td>Soyadı</td><td><input id="last-name" value="STUDENT"></td></tr>
            <tr><td>Anne Adı</td><td><input id="mother-name" value="ANNE"></td></tr>
        </table>
    `, 'https://yoksis.yok.gov.tr/student');
    const firstNameInput = harness.dom.window.document.getElementById('first-name');
    firstNameInput.value = '';

    try {
        const response = await harness.send({
            action: 'verifyYoksisFields',
            data: { firstName: 'TEST', lastName: 'STUDENT', anneAdi: 'ANNE' }
        });

        assert.equal(response.success, false);
        assert.deepEqual(Array.from(response.filledFields), ['Soyadı', 'Anne Adı']);
        assert.deepEqual(Array.from(response.missingFields), ['Adı']);
    } finally {
        harness.close();
    }
});

test('YÖKSİS field verification waits for an active ZK postback to finish', async () => {
    const harness = createContentHarness(`
        <table><tr><td>Adı</td><td><input id="first-name" value="TEST"></td></tr></table>
    `, 'https://yoksis.yok.gov.tr/student');
    harness.dom.window.zk = { processing: true };
    const finishPostback = setTimeout(() => { harness.dom.window.zk.processing = false; }, 120);
    const startedAt = Date.now();

    try {
        const response = await harness.send({
            action: 'verifyYoksisFields',
            data: { firstName: 'TEST', croppedPhotoBase64: 'data:image/jpeg;base64,AA==' }
        });

        assert.equal(response.success, true);
        assert.deepEqual(Array.from(response.filledFields), ['Adı']);
        assert.ok(Date.now() - startedAt >= 100);
    } finally {
        clearTimeout(finishPostback);
        harness.close();
    }
});

test('consecutive students update the open form without reloading the YÖKSİS page', async () => {
    const harness = createContentHarness(`
        <table>
            <tr><td>Adı</td><td><input id="first-name"></td></tr>
            <tr><td>Soyadı</td><td><input id="last-name"></td></tr>
        </table>
    `, 'https://yoksis.yok.gov.tr/student');

    try {
        await harness.send({ action: 'fillRemainingData', data: { firstName: 'ILK', lastName: 'OGRENCI' } });
        const secondResponse = await harness.send({ action: 'fillRemainingData', data: { firstName: 'IKINCI', lastName: 'OGRENCI' } });

        assert.equal(secondResponse.success, true);
        assert.equal(harness.dom.window.document.getElementById('first-name').value, 'IKINCI');
        assert.equal(harness.dom.window.document.getElementById('last-name').value, 'OGRENCI');
    } finally {
        harness.close();
    }
});

test('repeated YÖKSİS fill avoids duplicate field commits and duplicate photo assignment', async () => {
    const harness = createContentHarness(`
        <table>
            <tr><td>Adı</td><td><input id="first-name"></td></tr>
            <tr><td>Fotoğraf Adı</td><td><button id="photo-upload">Fotoğraf Yükle</button><input id="photo-file" type="file"></td></tr>
        </table>
    `, 'https://yoksis.yok.gov.tr/student');
    const firstNameInput = harness.dom.window.document.getElementById('first-name');
    const fileInput = harness.dom.window.document.getElementById('photo-file');
    makeFileInputWritable(fileInput);
    let fieldChanges = 0;
    let photoChanges = 0;
    firstNameInput.addEventListener('change', () => { fieldChanges += 1; });
    fileInput.addEventListener('change', () => { photoChanges += 1; });
    const data = {
        firstName: 'TEST',
        croppedPhotoBase64: 'data:image/jpeg;base64,AA==',
        photoFileName: 'student.jpg'
    };

    try {
        await harness.send({ action: 'fillRemainingData', data });
        const firstCounts = { fieldChanges, photoChanges };
        const repeatResponse = await harness.send({ action: 'fillRemainingData', data });

        assert.equal(repeatResponse.photoUploaded, true);
        assert.deepEqual({ fieldChanges, photoChanges }, firstCounts);
        assert.equal(fileInput.files.length, 1);
    } finally {
        harness.close();
    }
});

test('YÖKSİS form readiness recognizes Ana Adı and photo button immediately without 10s delay', async () => {
    const harness = createContentHarness(`
        <table>
            <tr><td>Ana Adı</td><td><input id="mother-name"></td></tr>
            <tr><td>Baba Adı</td><td><input id="father-name"></td></tr>
            <tr><td>Fotoğraf Adı</td><td><button id="photo-upload">Fotoğraf Yükle</button><input id="photo-file" type="file"></td></tr>
        </table>
    `, 'https://yoksis.yok.gov.tr/student');
    makeFileInputWritable(harness.dom.window.document.getElementById('photo-file'));

    const start = Date.now();
    try {
        const response = await harness.send({
            action: 'WAIT_YOKSIS_FORM',
            timeoutMs: 5000,
            requestId: 'test-fast-ana-adi'
        });

        const elapsed = Date.now() - start;
        assert.equal(response.success, true);
        assert.equal(response.formReady, true);
        assert.ok(elapsed < 1000, `Expected fast resolution under 1000ms, took ${elapsed}ms`);
    } finally {
        harness.close();
    }
});

test('YÖKSİS fillRemainingData fills open form immediately without 10s timeout', async () => {
    const harness = createContentHarness(`
        <table>
            <tr><td>Ana Adı</td><td><input id="mother-name"></td></tr>
            <tr><td>Baba Adı</td><td><input id="father-name"></td></tr>
            <tr><td>Belge No</td><td><input id="document-number" placeholder="Belge No"></td></tr>
            <tr><td>Fotoğraf Adı</td><td><button id="photo-upload">Fotoğraf Yükle</button><input id="photo-file" type="file"></td></tr>
        </table>
    `, 'https://yoksis.yok.gov.tr/student');
    makeFileInputWritable(harness.dom.window.document.getElementById('photo-file'));

    const start = Date.now();
    try {
        const response = await harness.send({
            action: 'fillRemainingData',
            data: {
                anneAdi: 'FATMA',
                babaAdi: 'MEHMET',
                pasaportNo: 'A12345678'
            }
        });

        const elapsed = Date.now() - start;
        assert.equal(response.success, true);
        assert.equal(harness.dom.window.document.getElementById('mother-name').value, 'FATMA');
        assert.equal(harness.dom.window.document.getElementById('father-name').value, 'MEHMET');
        assert.equal(harness.dom.window.document.getElementById('document-number').value, 'A12345678');
        assert.ok(elapsed < 1000, `Expected fast fill under 1000ms, took ${elapsed}ms`);
    } finally {
        harness.close();
    }
});

test('Apply document discovery returns real acceptance and passport candidates', async () => {
    const harness = createContentHarness(`
        <input name="mothersName" value="ANNE">
        <input name="fathersName" value="BABA">
        <input name="passportNumber" value="P123456">
        <input name="birthDate" value="02.01.2000">
        <label>Uyruk<select><option selected>Türkiye</option></select></label>
        <label>Doğduğunuz ülke<select><option selected>Türkiye</option></select></label>
        <div class="card"><h5 class="card-title">Oluşturulan Dosyalar</h5><a href="/uploads/acceptance-letters/letter.pdf">Resmi Kabul Mektubu</a></div>
        <div class="card"><h5 class="card-title">Yüklenen Dosyalar</h5><a href="/uploads/passport/passport.pdf">Pasaport</a></div>
    `, 'https://apply.topkapi.edu.tr/panel/applications/123');

    try {
        const response = await harness.send({
            action: 'GET_KABUL_CODE_OR_DOCUMENT',
            requestId: 'workflow-3'
        });

        assert.equal(response.success, true);
        assert.deepEqual(Array.from(response.acceptanceCandidates), ['https://apply.topkapi.edu.tr/uploads/acceptance-letters/letter.pdf']);
        assert.deepEqual(Array.from(response.passportCandidates), ['https://apply.topkapi.edu.tr/uploads/passport/passport.pdf']);
        assert.equal(response.data.pasaportNo, 'P123456');
        assert.equal(response.data.birthDate, '2000-01-02');
    } finally {
        harness.close();
    }
});

test('background transfer accepts only a fresh content-search result or a fresh MAIN-world fallback', async () => {
    const contentHarness = createBackgroundHarness(
        { inputFound: false, buttonFound: false },
        { success: true, searchTriggered: true, formReady: true }
    );
    const contentResponse = await contentHarness.send({
        source: 'IKAMET_PORTAL',
        action: 'TRANSFER_TO_YOKSIS',
        requestId: 'workflow-content',
        data: { yoksisId: 'AB-123-CD' }
    });

    assert.equal(contentResponse.success, true);
    assert.equal(contentResponse.formReady, true);
    assert.ok(!contentHarness.calls.some((call) => call.type === 'script' && call.options.world === 'MAIN'));

    const mainHarness = createBackgroundHarness(
        { inputFound: true, buttonFound: true, searchTriggered: true },
        { success: false, searchTriggered: false, formReady: false }
    );
    const mainResponse = await mainHarness.send({
        source: 'IKAMET_PORTAL',
        action: 'TRANSFER_TO_YOKSIS',
        requestId: 'workflow-main',
        data: { yoksisId: 'AB-123-CD' }
    });

    assert.equal(mainResponse.success, true);
    assert.equal(mainResponse.formReady, true);
    assert.ok(mainHarness.calls.some((call) => call.type === 'script' && call.options.world === 'MAIN'));
    assert.ok(mainHarness.calls.some((call) => call.type === 'message' && call.message.action === 'GET_YOKSIS_FORM_STATE'));
    const readinessCall = mainHarness.calls.find((call) => call.type === 'message' && call.message.action === 'WAIT_YOKSIS_FORM');
    assert.equal(readinessCall.message.requireFreshResult, true);
    assert.equal(readinessCall.message.afterFingerprint, 'previous-student');
});

test('YKN timing diagnostics report stage metrics without acceptance or student data', async () => {
    const harness = createBackgroundHarness(
        { inputFound: false, buttonFound: false },
        {
            success: true,
            searchTriggered: true,
            formReady: true,
            timing: {
                inputReadyDurationMs: 8,
                inputWriteDurationMs: 56,
                searchClickDurationMs: 2,
                formWaitDurationMs: 180
            }
        },
        { diagnostics: true }
    );

    const response = await harness.send({
        source: 'IKAMET_PORTAL',
        action: 'TRANSFER_TO_YOKSIS',
        requestId: 'diagnostics-no-personal-data',
        data: {
            yoksisId: 'PRIVATE-ACCEPTANCE-CODE',
            fullName: 'PRIVATE STUDENT NAME',
            passportNo: 'PRIVATE-PASSPORT'
        }
    });
    const logText = JSON.stringify(harness.timingLogs);

    assert.equal(response.success, true);
    assert.ok(logText.includes('acceptance-input-readiness'));
    assert.ok(logText.includes('search-trigger'));
    assert.ok(logText.includes('fresh-form-wait-content'));
    assert.ok(!logText.includes('PRIVATE-ACCEPTANCE-CODE'));
    assert.ok(!logText.includes('PRIVATE STUDENT NAME'));
    assert.ok(!logText.includes('PRIVATE-PASSPORT'));
});

test('background transfer waits for a delayed fresh form after the search click', async () => {
    const harness = createBackgroundHarness(
        { inputFound: false, buttonFound: false },
        {
            success: false,
            searchTriggered: true,
            formReady: false,
            formFingerprintBeforeSearch: 'previous-student',
            domRevisionBeforeSearch: 6
        }
    );

    const response = await harness.send({
        source: 'IKAMET_PORTAL',
        action: 'TRANSFER_TO_YOKSIS',
        requestId: 'workflow-delayed-form',
        data: { yoksisId: 'AB-123-CD' }
    });

    assert.equal(response.success, true);
    assert.equal(response.formReady, true);
    assert.ok(harness.calls.some((call) => call.type === 'message'
        && call.message.action === 'WAIT_YOKSIS_FORM'
        && call.message.requireFreshResult === true
        && call.message.afterFingerprint === 'previous-student'
        && call.message.afterDomRevision === 6));
    assert.ok(!harness.calls.some((call) => call.type === 'script' && call.options.world === 'MAIN'));
});

test('Tek Tık aktarımı açık YÖKSİS sekmesi yoksa güvenli biçimde yeni sekme açar', async () => {
    const harness = createBackgroundHarness(
        { inputFound: false, buttonFound: false },
        { success: true, searchTriggered: true, formReady: true },
        { hasYoksisTab: false }
    );

    const response = await harness.send({
        source: 'IKAMET_PORTAL',
        action: 'TRANSFER_TO_YOKSIS',
        requestId: 'workflow-open-yoksis',
        data: { yoksisId: 'AB-123-CD' }
    });

    assert.equal(response.success, true);
    assert.ok(harness.calls.some((call) => call.type === 'create-tab'
        && call.createProperties.url === 'https://yoksis.yok.gov.tr/'));
    assert.ok(harness.calls.some((call) => call.type === 'create-tab'
        && call.createProperties.active === false));
    assert.ok(!harness.calls.some((call) => call.type === 'update-tab'
        && call.updateProperties.active === true));
    assert.ok(!harness.calls.some((call) => call.type === 'focus-window'));
});

test('son YÖKSİS doldurma adımı sekmeyi öne alır', async () => {
    const harness = createBackgroundHarness(
        { success: true, filledFields: ['Ad'], missingFields: [], photoUploaded: false },
        { success: true, searchTriggered: true, formReady: true }
    );

    const response = await harness.send({
        source: 'IKAMET_PORTAL',
        action: 'FILL_YOKSIS_FORM',
        requestId: 'workflow-final-fill',
        data: {
            yoksisReady: true,
            yoksisTabId: 42,
            yoksisTabUrl: 'https://yoksis.yok.gov.tr/student',
            fullName: 'Test Student'
        }
    });

    assert.equal(response.success, true);
    assert.ok(harness.calls.some((call) => call.type === 'update-tab'
        && call.updateProperties.active === true));
    assert.ok(harness.calls.some((call) => call.type === 'focus-window'));
});

test('YÖKSİS hedef sekmesi service worker yeniden başladığında korunur', async () => {
    const sessionStorage = {};
    const tabs = [
        { id: 42, url: 'https://yoksis.yok.gov.tr/student', active: true, windowId: 7 },
        { id: 43, url: 'https://yoksis.yok.gov.tr/student', active: false, windowId: 7 }
    ];
    const searchWorker = createBackgroundHarness(
        { inputFound: false, buttonFound: false },
        { success: true, searchTriggered: true, formReady: true },
        { yoksisTabs: tabs, sessionStorage }
    );
    const searchResponse = await searchWorker.send({
        source: 'IKAMET_PORTAL',
        action: 'TRANSFER_TO_YOKSIS',
        requestId: 'worker-restart-search',
        data: { yoksisId: 'AB-123-CD' }
    });
    tabs[0].active = false;
    tabs[1].active = true;

    const restartedWorker = createBackgroundHarness(
        { success: true, filledFields: ['Ad'], missingFields: [], photoUploaded: false },
        { success: true, searchTriggered: true, formReady: true },
        { yoksisTabs: tabs, sessionStorage }
    );
    const fillResponse = await restartedWorker.send({
        source: 'IKAMET_PORTAL',
        action: 'FILL_YOKSIS_FORM',
        requestId: 'worker-restart-fill',
        data: {
            yoksisReady: true,
            yoksisTabId: searchResponse.yoksisTabId,
            yoksisTabUrl: searchResponse.yoksisTabUrl,
            fullName: 'Test Student'
        }
    });

    assert.equal(searchResponse.success, true);
    assert.equal(searchResponse.yoksisTabId, 42);
    assert.equal(searchResponse.yoksisTabUrl, 'https://yoksis.yok.gov.tr/student');
    assert.equal(fillResponse.success, true);
    assert.equal(sessionStorage.activeYoksisTabId, 42);
    assert.ok(restartedWorker.calls.some((call) => call.type === 'update-tab'
        && call.tabId === 42
        && call.updateProperties.active === true));
    assert.ok(restartedWorker.calls.some((call) => call.type === 'message'
        && call.tabId === 42
        && call.message.action === 'WAIT_YOKSIS_FORM'));
});

test('arama sekmesi kapalıysa doldurma başka açık YÖKSİS sekmesine düşmez', async () => {
    const sessionStorage = { activeYoksisTabId: 42 };
    const validTab = {
        id: 43,
        url: 'https://yoksis.yok.gov.tr/student',
        active: true,
        windowId: 7
    };
    const harness = createBackgroundHarness(
        { success: true, filledFields: ['Ad'], missingFields: [], photoUploaded: false },
        { success: true, searchTriggered: true, formReady: true },
        { yoksisTabs: [validTab], sessionStorage }
    );

    const response = await harness.send({
        source: 'IKAMET_PORTAL',
        action: 'FILL_YOKSIS_FORM',
        requestId: 'stale-tab-replaced',
        data: {
            yoksisReady: true,
            yoksisTabId: 42,
            yoksisTabUrl: 'https://yoksis.yok.gov.tr/student',
            fullName: 'Test Student'
        }
    });

    assert.equal(response.success, false);
    assert.match(response.error, /YÖKSİS sekmesi değişti veya kapandı/);
    assert.equal(sessionStorage.activeYoksisTabId, 42);
    assert.equal(harness.calls.some((call) => call.type === 'update-tab'), false);
    assert.equal(harness.calls.some((call) => call.type === 'message'
        && call.message.action === 'WAIT_YOKSIS_FORM'), false);
});

test('arama sekmesi kapalıysa doldurma için boş YÖKSİS sekmesi açılmaz', async () => {
    const sessionStorage = { activeYoksisTabId: 42 };
    const harness = createBackgroundHarness(
        { success: true, filledFields: ['Ad'], missingFields: [], photoUploaded: false },
        { success: true, searchTriggered: true, formReady: true },
        { hasYoksisTab: false, yoksisTabs: [], sessionStorage, createdYoksisTabId: 99 }
    );

    const response = await harness.send({
        source: 'IKAMET_PORTAL',
        action: 'FILL_YOKSIS_FORM',
        requestId: 'closed-tab-replaced',
        data: {
            yoksisReady: true,
            yoksisTabId: 42,
            yoksisTabUrl: 'https://yoksis.yok.gov.tr/student',
            fullName: 'Test Student'
        }
    });

    assert.equal(response.success, false);
    assert.match(response.error, /YÖKSİS sekmesi değişti veya kapandı/);
    assert.equal(sessionStorage.activeYoksisTabId, 42);
    assert.equal(harness.calls.some((call) => call.type === 'create-tab'), false);
    assert.equal(harness.calls.some((call) => call.type === 'update-tab'), false);
    assert.equal(harness.calls.some((call) => call.type === 'message'
        && call.message.action === 'WAIT_YOKSIS_FORM'), false);
});

test('arama sekmesi aynı kimlikle başka sayfaya yönlenmişse form doldurulmaz', async () => {
    const redirectedTab = {
        id: 42,
        url: 'https://yoksis.yok.gov.tr/another-page',
        active: true,
        windowId: 7
    };
    const harness = createBackgroundHarness(
        { success: true, filledFields: ['Ad'], missingFields: [], photoUploaded: false },
        { success: true, searchTriggered: true, formReady: true },
        { yoksisTabs: [redirectedTab] }
    );

    const response = await harness.send({
        source: 'IKAMET_PORTAL',
        action: 'FILL_YOKSIS_FORM',
        requestId: 'redirected-tab-fill',
        data: {
            yoksisReady: true,
            yoksisTabId: 42,
            yoksisTabUrl: 'https://yoksis.yok.gov.tr/student',
            fullName: 'Test Student'
        }
    });

    assert.equal(response.success, false);
    assert.match(response.error, /YÖKSİS sekmesi değişti veya kapandı/);
    assert.equal(harness.calls.some((call) => call.type === 'update-tab'), false);
    assert.equal(harness.calls.some((call) => call.type === 'message'
        && call.message.action === 'WAIT_YOKSIS_FORM'), false);
});

test('doğrulanmış arama sekmesi bilgisi olmadan form doldurma başlamaz', async () => {
    const harness = createBackgroundHarness(
        { success: true, filledFields: ['Ad'], missingFields: [], photoUploaded: false },
        { success: true, searchTriggered: true, formReady: true }
    );

    const response = await harness.send({
        source: 'IKAMET_PORTAL',
        action: 'FILL_YOKSIS_FORM',
        requestId: 'missing-target-fill',
        data: { yoksisReady: true, fullName: 'Test Student' }
    });

    assert.equal(response.success, false);
    assert.match(response.error, /Doğrulanmış YÖKSİS hedef sekmesi yok/);
    assert.equal(harness.calls.some((call) => call.type === 'create-tab'), false);
    assert.equal(harness.calls.some((call) => call.type === 'update-tab'), false);
    assert.equal(harness.calls.some((call) => call.type === 'message'
        && call.message.action === 'WAIT_YOKSIS_FORM'), false);
});

test('ardışık YÖKSİS aramaları requestId ile birbirine karışmaz', async () => {
    const harness = createBackgroundHarness(
        { inputFound: false, buttonFound: false },
        { success: true, searchTriggered: true, formReady: true }
    );

    const requests = Array.from({ length: 15 }, (_, index) => ({
        source: 'IKAMET_PORTAL',
        action: 'TRANSFER_TO_YOKSIS',
        requestId: `workflow-student-${index + 1}`,
        data: { yoksisId: `AB-${String(index + 123)}-${String.fromCharCode(67 + index)}D` }
    }));
    const responses = await Promise.all(requests.map((request) => harness.send(request)));

    assert.deepEqual(responses.map((response) => response.success), Array(15).fill(true));
    const searchMessages = harness.calls
        .filter((call) => call.type === 'message' && call.message.action === 'searchWithId')
        .map((call) => ({ requestId: call.message.requestId, kabulId: call.message.kabulId }));
    assert.deepEqual(searchMessages, requests.map((request) => ({
        requestId: request.requestId,
        kabulId: request.data.yoksisId
    })));
});

test('YÖKSİS popup araması da arka planda çalışır', async () => {
    const harness = createBackgroundHarness(
        { inputFound: false, buttonFound: false },
        { success: true, searchTriggered: true, formReady: true }
    );

    const response = await harness.send({
        action: 'SEARCH_YOKSIS_FROM_POPUP',
        requestId: 'popup-search-background',
        data: { yoksisId: 'EF-456-GH' }
    });

    assert.equal(response.success, true);
    assert.ok(!harness.calls.some((call) => call.type === 'update-tab'
        && call.updateProperties.active === true));
});

test('eklenti popup araması da Tek Tık ile aynı YÖKSİS aktarım yolunu kullanır', async () => {
    const harness = createBackgroundHarness(
        { inputFound: false, buttonFound: false },
        { success: true, searchTriggered: true, formReady: true },
        { hasYoksisTab: false }
    );

    const response = await harness.send({
        action: 'SEARCH_YOKSIS_FROM_POPUP',
        requestId: 'popup-search',
        data: { yoksisId: 'AB-123-CD' }
    });

    assert.equal(response.success, true);
    assert.ok(harness.calls.some((call) => call.type === 'create-tab'));
    assert.ok(harness.calls.some((call) => call.type === 'message'
        && call.message.action === 'searchWithId'));
});

test('three students search and receive fields/photo in the same page without F5 or old controls', async () => {
    const harness = createContentHarness('<div id="searches"></div><div id="forms"></div><button id="reset">Temizle</button>', 'https://yoksis.yok.gov.tr/student');
    const { window } = harness.dom;
    const codes = ['ONE-123-ID', 'TWO-123-ID', 'THR-123-ID'];
    const searches = [];
    const uploads = [];
    const usedInputs = [];
    let resets = 0;
    let approvals = 0;
    let index = 0;
    function appendSearch() {
        const host = window.document.getElementById('searches');
        host.insertAdjacentHTML('beforeend', `<table id="search-${index}"><tr><td>Kabul Mektup ID</td><td><input title="Kabul Mektup ID"></td><td><button>Kabul Mektup ID ile Ara</button></td></tr></table>`);
        const panel = host.lastElementChild;
        const input = panel.querySelector('input');
        usedInputs.push(input);
        panel.querySelector('button').onclick = () => {
            searches.push(input.value);
            window.document.getElementById('forms').insertAdjacentHTML('beforeend', `<table id="form-${index}">
                <tr><td>Adı</td><td><input value="TEST${index}"></td></tr><tr><td>Soyadı</td><td><input value="SYNTHETIC"></td></tr>
                <tr><td>Anne Adı</td><td><input></td></tr><tr><td>Belge No</td><td><input></td></tr>
                <tr><td>Fotoğraf Adı</td><td><button>Fotoğraf Yükle</button><input type="file"></td></tr></table>`);
            const photo = window.document.getElementById(`form-${index}`).querySelector('input[type="file"]');
            makeFileInputWritable(photo);
            photo.addEventListener('change', () => uploads.push(index));
        };
    }
    window.confirm = () => { approvals += 1; return true; };
    window.document.getElementById('reset').onclick = () => {
        resets += 1;
        window.document.getElementById(`search-${index}`).hidden = true;
        window.document.getElementById(`form-${index}`).hidden = true;
        index += 1;
        appendSearch();
    };
    appendSearch();

    try {
        for (const [studentIndex, code] of codes.entries()) {
            const student = { firstName: `TEST${studentIndex}`, lastName: 'SYNTHETIC', anneAdi: `MOTHER${studentIndex}`,
                passportNo: `FAKE${studentIndex}`, croppedPhotoBase64: 'data:image/jpeg;base64,AA==', photoFileName: 'synthetic.jpg' };

            const searched = await harness.send({ action: 'searchWithId', kabulId: code, requestId: `student-${studentIndex}`, expectedStudent: student });
            const bound = await harness.send({ action: 'WAIT_YOKSIS_FORM', requireBoundSearch: true, expectedKabulId: code, expectedStudent: student });
            const filled = await harness.send({ action: 'fillRemainingData', data: student, requestId: `student-${studentIndex}` });
            const repeated = await harness.send({ action: 'fillRemainingData', data: student, requestId: `student-${studentIndex}` });

            assert.equal(searched.formReady, true);
            assert.equal(bound.formReady, true);
            assert.equal(filled.photoUploaded, true);
            assert.equal(repeated.photoUploaded, true);
            assert.equal(window.document.getElementById(`form-${studentIndex}`).querySelector('input').value, student.firstName);
        }
        assert.deepEqual(searches, codes);
        assert.deepEqual(uploads, [0, 1, 2]);
        assert.equal(resets, 2);
        assert.equal(approvals, 2);
        assert.deepEqual(usedInputs.map((input) => input.value), codes);
    } finally { harness.close(); }
});

test('a restarted page/controller cannot fill a different student using stored old data or old form readiness', async () => {
    const harness = createContentHarness('<table><tr><td>Anne Adı</td><td><input value="OLD"></td></tr><tr><td>Belge No</td><td><input value="OLD-DOC"></td></tr></table>',
        'https://yoksis.yok.gov.tr/student', { studentData: { anneAdi: 'OLD', passportNo: 'OLD-DOC' } });

    try {
        const bound = await harness.send({ action: 'WAIT_YOKSIS_FORM', requireBoundSearch: true, expectedKabulId: 'NEW-123-ID' });
        const missingPayload = await harness.send({ action: 'fillRemainingData', requestId: 'new-workflow' });

        assert.equal(bound.formReady, false);
        assert.equal(missingPayload.success, false);
        assert.equal(harness.dom.window.document.querySelector('input').value, 'OLD');
    } finally { harness.close(); }
});

test('Apply selected radio label and disabled marital dropdown remain authoritative without option-code mapping', async () => {
    const harness = createContentHarness('<input name="firstName" value="SYNTHETIC"><input name="lastName" value="TEST">' +
        '<fieldset><label><input name="gender" type="radio" value="1" checked>Female</label><label><input name="gender" type="radio" value="2">Male</label></fieldset>' +
        '<label for="marital">Marital Status</label><select disabled id="marital"><option value="2" selected>Single</option></select>', 'https://apply.topkapi.edu.tr/panel/student');

    try {
        const result = await harness.send({ action: 'copyData' });

        assert.equal(result.data.cinsiyet, 'Kadın');
        assert.equal(result.data.genderSource, 'apply');
        assert.equal(result.data.medeniHali, 'Bekar');
        assert.equal(result.data.maritalSource, 'apply');
    } finally { harness.close(); }
});

test('fallback field claims are discarded when the final AU verification finds an empty form', async () => {
    const harness = createBackgroundHarness({ filledFields: [], photoUploaded: true }, {}, {
        verificationResult: { filledFields: [], missingFields: ['Adı'] },
        contentResult: { success: true, filledFields: ['Adı'], missingFields: [] },
        finalVerificationResult: { success: false, filledFields: [], missingFields: ['Adı'] }
    });

    const result = await harness.send({ source: 'IKAMET_PORTAL', action: 'FILL_YOKSIS_FORM', requestId: 'fallback-lost',
        data: { yoksisReady: true, yoksisTabId: 42, yoksisTabUrl: 'https://yoksis.yok.gov.tr/student', firstName: 'SYNTHETIC' } });

    assert.equal(result.success, false);
    assert.ok(result.missingFields.includes('Adı'));
});

test('unverified missing source demographics cannot be reported as a complete transfer', async () => {
    const harness = createBackgroundHarness({ success: true, filledFields: ['Adı'] }, {}, {
        verificationResult: { success: true, filledFields: ['Adı'], missingFields: [] },
        contentResult: { success: true, filledFields: ['Adı'], missingFields: [] }
    });

    const result = await harness.send({ source: 'IKAMET_PORTAL', action: 'FILL_YOKSIS_FORM', requestId: 'manual-required',
        data: { yoksisReady: true, yoksisTabId: 42, yoksisTabUrl: 'https://yoksis.yok.gov.tr/student', firstName: 'SYNTHETIC',
            cinsiyet: '', genderSource: 'unverified', medeniHali: '', maritalSource: 'unverified' } });

    assert.equal(result.partial, true);
    assert.ok(result.missingFields.includes('Cinsiyet'));
    assert.ok(result.missingFields.includes('Medeni Hali'));
});
