import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import test from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const backgroundSource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/background.js'), 'utf8');

test('YÖKSİS MAIN fallback görünür kabul alanını seçer, gizli eski alanı değiştirmez', async () => {
    const dom = new JSDOM(`
        <table id="old-search" style="display:none">
            <tr><td>Kabul Mektup ID</td><td><input id="old-acceptance-id" title="Kabul Mektup ID"></td><td><button id="old-search-button">Kabul Mektup ID ile Ara</button></td></tr>
        </table>
        <table id="current-search">
            <tr><td>Kabul Mektup ID</td><td><input id="current-acceptance-id" title="Kabul Mektup ID"></td><td><button id="current-search-button">Kabul Mektup ID ile Ara</button></td></tr>
        </table>
    `, { url: 'https://yoksis.yok.gov.tr/student' });
    const calls = [];
    let messageHandler = null;
    let currentSearchClicks = 0;
    const currentSearch = dom.window.document.getElementById('current-search');
    const initialCurrentInput = dom.window.document.getElementById('current-acceptance-id');
    initialCurrentInput.addEventListener('input', () => {
        currentSearch.innerHTML = '<tr><td>Kabul Mektup ID</td><td><input id="current-acceptance-id-new" title="Kabul Mektup ID"></td><td><button id="current-search-button-new">Kabul Mektup ID ile Ara</button></td></tr>';
        dom.window.document.getElementById('current-search-button-new').addEventListener('click', () => {
            currentSearchClicks += 1;
        });
    });
    const yoksisTab = { id: 42, url: 'https://yoksis.yok.gov.tr/student' };
    const sandbox = {
        URL,
        console,
        Promise,
        Date,
        Error,
        setTimeout,
        clearTimeout
    };

    const chrome = {
        runtime: {
            lastError: null,
            onMessage: { addListener(handler) { messageHandler = handler; } }
        },
        storage: { local: { set(_values, callback) { callback(); } } },
        tabs: {
            onUpdated: { addListener() {} },
            query(_queryInfo, callback) { callback([yoksisTab]); },
            sendMessage(_tabId, message, callback) {
                calls.push({ type: 'message', message });
                if (message.action === 'PING') {
                    callback({ ready: true, pageKind: 'yoksis', url: yoksisTab.url });
                } else if (message.action === 'searchWithId') {
                    callback({ success: false, searchTriggered: false, formReady: false });
                } else if (message.action === 'GET_YOKSIS_FORM_STATE') {
                    callback({ success: true, fingerprint: 'old-student', domRevision: 3 });
                } else if (message.action === 'WAIT_YOKSIS_FORM') {
                    callback({ success: true, formReady: true });
                } else {
                    callback({ success: true });
                }
            }
        },
        scripting: {
            async executeScript(options) {
                calls.push({ type: 'script', options });
                if (options.world !== 'MAIN') return [];
                Object.assign(sandbox, {
                    document: dom.window.document,
                    window: dom.window,
                    Event: dom.window.Event,
                    KeyboardEvent: dom.window.KeyboardEvent
                });
                return [{ result: await options.func(...(options.args || [])) }];
            }
        }
    };
    sandbox.chrome = chrome;
    vm.createContext(sandbox);
    vm.runInContext(backgroundSource, sandbox);

    try {
        const response = await new Promise((resolveResponse) => {
            assert.ok(messageHandler, 'background message listener kaydedilmeliydi');
            const isAsync = messageHandler({
                source: 'IKAMET_PORTAL',
                action: 'TRANSFER_TO_YOKSIS',
                requestId: 'fallback-visible-control',
                data: { yoksisId: 'AB-123-CD' }
            }, { tab: { id: 1 } }, resolveResponse);
            assert.equal(isAsync, true);
        });

        assert.equal(response.success, true);
        assert.equal(dom.window.document.getElementById('current-acceptance-id-new').value, 'AB-123-CD');
        assert.equal(dom.window.document.getElementById('old-acceptance-id').value, '');
        assert.equal(currentSearchClicks, 1);
    } finally {
        dom.window.close();
    }
});
