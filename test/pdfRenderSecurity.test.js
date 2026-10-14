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

test('untrusted student fields remain text in generated PDF and print markup', async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://portal.example.test/yetkili/' });
    const restoreDocument = setGlobal('document', dom.window.document);
    const restoreWindow = setGlobal('window', dom.window);
    const payload = '<img src=x onerror="window.__pdfXss = true">';
    const { getDocumentHtml } = await import('../src/services/pdfGenerator.js');

    try {
        const markup = getDocumentHtml(
            payload, payload, payload, payload, payload, payload, payload, payload,
            payload, payload, payload, 2026, payload, false
        );
        const documentFragment = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`).window.document;

        assert.equal(documentFragment.querySelectorAll('img[onerror]').length, 0);
        assert.equal(documentFragment.querySelector('[onerror], [onload]'), null);
        assert.match(documentFragment.querySelector('#pdf-canvas-content').textContent, new RegExp(payload.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.equal(dom.window.__pdfXss, undefined);
    } finally {
        restoreWindow();
        restoreDocument();
        dom.window.close();
    }
});

test('cover markup preserves Cyrillic, Arabic and Turkish names in both PDF and print paths', async context => {
    const dom = new JSDOM('<html><body></body></html>');
    const restoreDocument = setGlobal('document', dom.window.document);
    const restoreWindow = setGlobal('window', dom.window);
    context.after(() => { restoreWindow(); restoreDocument(); dom.window.close(); });
    const { getDocumentHtml } = await import('../src/services/pdfGenerator.js');
    const names = 'Александр أحمد Çağrı';

    for (const isPrint of [false, true]) {
        const markup = getDocumentHtml('', '', '', '', names, names, '', '', '', '', '', 2026, '', isPrint);
        const output = new JSDOM(markup);

        assert.ok(output.window.document.body.textContent.includes(names));
        output.window.close();
    }
});
