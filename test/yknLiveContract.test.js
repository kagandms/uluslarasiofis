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

function createBackgroundHarness(mainResult, searchResult) {
    const calls = [];
    let messageHandler = null;
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
                if (Array.isArray(queryInfo.url)) {
                    callback([yoksisTab]);
                    return;
                }
                callback([]);
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
            <tr><td>Kabul Mektup ID</td><td><input id="acceptance-id"></td><td><button id="search">Kabul Mektup ID ile Ara</button></td></tr>
        </table>
    `, 'https://yoksis.yok.gov.tr/student');
    let clickCount = 0;
    harness.dom.window.document.getElementById('search').addEventListener('click', () => {
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
        assert.equal(harness.dom.window.document.getElementById('acceptance-id').value, 'AB-123-CD');
        assert.ok(clickCount > 0);
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

test('background transfer confirms form readiness after MAIN-world or content fallback search', async () => {
    const mainHarness = createBackgroundHarness(
        { inputFound: true, buttonFound: false },
        { success: true, formReady: false }
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
    assert.ok(mainHarness.calls.some((call) => call.type === 'message' && call.message.action === 'searchWithId'));
    assert.ok(mainHarness.calls.some((call) => call.type === 'message' && call.message.action === 'WAIT_YOKSIS_FORM'));

    const fallbackHarness = createBackgroundHarness(
        { inputFound: false, buttonFound: false },
        { success: true, formReady: false }
    );
    const fallbackResponse = await fallbackHarness.send({
        source: 'IKAMET_PORTAL',
        action: 'TRANSFER_TO_YOKSIS',
        requestId: 'workflow-fallback',
        data: { yoksisId: 'AB-123-CD' }
    });

    assert.equal(fallbackResponse.success, true);
    assert.equal(fallbackResponse.formReady, true);
    assert.ok(fallbackHarness.calls.some((call) => call.type === 'message' && call.message.action === 'searchWithId'));
    assert.ok(fallbackHarness.calls.some((call) => call.type === 'message' && call.message.action === 'WAIT_YOKSIS_FORM'));
});
