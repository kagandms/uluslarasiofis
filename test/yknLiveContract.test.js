import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import test from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const contentSource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/content.js'), 'utf8');
const backgroundSource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/background.js'), 'utf8');
const portalSecuritySource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/portal-security.js'), 'utf8');
const storageLifecycleSource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/storage-lifecycle.js'), 'utf8');

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
            sendMessage(_message, callback) {
                if (callback) callback({ success: true });
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
                    callback({ success: true, fingerprint: 'previous-student', domRevision: 7 });
                    return;
                }
                if (message.action === 'WAIT_YOKSIS_FORM') {
                    callback({ success: true, formReady: true });
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
        assert.equal(harness.dom.window.document.getElementById('mother-name').value, 'ANNE');
        assert.equal(harness.dom.window.document.getElementById('document-number').value, 'P123456');
        assert.equal(harness.dom.window.document.getElementById('issue-date').value, '02.01.2024');
        assert.equal(harness.dom.window.document.getElementById('expiry-date').value, '02.01.2034');
        assert.equal(harness.dom.window.document.getElementById('photo-file').files.length, 1);
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
