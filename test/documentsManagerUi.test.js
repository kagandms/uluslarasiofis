import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { initDocumentsManager } from '../src/ui/documents-manager.js';

test('office document cards show a first-page PDF preview with quick print, preview, and download actions', () => {
    const dom = new JSDOM('<!doctype html><html><body><input id="documents-search-input"><select id="documents-category-filter"></select><p id="documents-empty-state"></p><span id="documents-total-count"></span><main id="documents-grid"></main></body></html>');
    const { document } = dom.window;
    globalThis.document = document;
    try {
        initDocumentsManager();

        const card = document.querySelector('.documents-card');
        const preview = card.querySelector('iframe.documents-card-preview');
        const actions = [...card.querySelectorAll('[data-action]')];

        assert.match(preview.src, /\/documents\/[^#]+\.pdf#page=1/);
        assert.equal(actions.map(({ dataset }) => dataset.action).join(','), 'print,preview,download');
        assert.equal(actions[0].textContent, 'Yazdır (Hızlı Çıkar)');
        assert.equal(actions[2].download, 'uluslararasi_ogrenci_basvuru_formu.pdf');
    } finally {
        delete globalThis.document;
        dom.window.close();
    }
});
