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
    let messageHandler = null;
    let hasYoksisTab = options.hasYoksisTab !== false;
    const yoksisTab = {
        id: 42,
        url: 'https://yoksis.yok.gov.tr/student',
        active: true,
        windowId: 7
    };

    const chrome = {
        runtime: {
            lastError: null,
            onMessage: {
                addListener(handler) {
                    messageHandler = handler;
                }
            }
        },
        storage: {
            local: {
                set(_values, callback) {
                    callback();
                },
                get(_keys, callback) {
                    callback({});
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
                    callback(hasYoksisTab ? [yoksisTab] : []);
                    return;
                }
                callback([]);
            },
            create(createProperties, callback) {
                calls.push({ type: 'create-tab', createProperties });
                hasYoksisTab = true;
                callback({ ...yoksisTab, ...createProperties });
            },
            update(_tabId, updateProperties, callback) {
                calls.push({ type: 'update-tab', updateProperties });
                callback({ ...yoksisTab, ...updateProperties });
            },
            sendMessage(_tabId, message, callback) {
                calls.push({ type: 'message', message });
                chrome.runtime.lastError = null;
                if (message.action === 'PING') {
                    callback({ ready: true, pageKind: 'yoksis', url: yoksisTab.url });
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
            async update() {}
        }
    };

    vm.runInNewContext(backgroundSource, {
        chrome,
        URL,
        console,
        Promise,
        Date,
        Error,
        setTimeout,
        clearTimeout
    });

    return {
        calls,
        async send(request) {
            assert.ok(messageHandler, 'background message listener was not registered');
            return new Promise((resolveResponse) => {
                const isAsync = messageHandler(request, { tab: { id: 1 } }, resolveResponse);
                assert.equal(isAsync, true);
            });
        }
    };
}

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
    assert.ok(harness.calls.some((call) => call.type === 'update-tab'
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
