import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import test from 'node:test';

function setGlobal(name, value) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    return () => {
        if (original) Object.defineProperty(globalThis, name, original);
        else delete globalThis[name];
    };
}

test('stored history fields, IDs, dates, and search text render without executable markup', async () => {
    const dom = new JSDOM('<section id="history-panel"><header class="history-header"><span class="history-count"></span></header><div class="history-body"></div></section>', {
        url: 'https://portal.example.test/yetkili/'
    });
    const restoreDocument = setGlobal('document', dom.window.document);
    const restoreWindow = setGlobal('window', dom.window);
    const restoreLocalStorage = setGlobal('localStorage', dom.window.localStorage);
    const payload = '<img src=x onerror="window.__historyXss = true">';
    const { historyManager } = await import('../src/managers/historyManager.js');

    try {
        localStorage.setItem('ikamet-history', JSON.stringify([{
            id: 'entry" onmouseover="window.__historyXss = true',
            timestamp: new Date().toISOString(),
            date: payload,
            time: payload,
            action: 'pdf',
            fields: { adi: payload, soyadi: 'Student', basvuruNo: payload, uyrugu: payload }
        }]));

        historyManager.searchQuery = '';
        historyManager.render();

        const historyBody = document.querySelector('.history-body');
        assert.equal(historyBody.querySelector('img'), null);
        assert.equal(historyBody.querySelector('[onerror], [onmouseover]'), null);
        assert.match(historyBody.textContent, new RegExp(payload.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.equal(dom.window.__historyXss, undefined);

        historyManager.searchQuery = payload;
        historyManager.render();
        assert.equal(historyBody.querySelector('img'), null);
        assert.equal(historyBody.querySelector('[onerror], [onmouseover]'), null);
        assert.equal(dom.window.__historyXss, undefined);
    } finally {
        historyManager.searchQuery = '';
        restoreLocalStorage();
        restoreWindow();
        restoreDocument();
        dom.window.close();
    }
});
