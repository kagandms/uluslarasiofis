import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import test from 'node:test';
import { initD1UsageCounter } from '../src/ui/d1-usage-counter.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('usage counter is limited to the authenticated staff home and renders daily usage', async () => {
    const staffHtml = await readFile(resolve(repositoryRoot, 'yetkili/index.html'), 'utf8');
    const publicHtml = await readFile(resolve(repositoryRoot, 'index.html'), 'utf8');
    const document = new JSDOM(staffHtml).window.document;
    const publicDocument = new JSDOM(publicHtml).window.document;
    assert.equal(document.querySelector('#home-screen #d1-usage-counter') !== null, true);
    assert.equal(publicDocument.querySelector('#d1-usage-counter'), null);
    initD1UsageCounter({
        root: document,
        fetcher: async () => Response.json({ rowsRead: 12345, limit: 5_000_000, date: '2026-10-14' })
    });
    await new Promise((resolveRequest) => setImmediate(resolveRequest));

    assert.equal(document.querySelector('#d1-usage-value').textContent, '12.345 / 5.000.000');
    assert.equal(document.querySelector('#d1-usage-status').textContent, '2026-10-14 UTC');
    assert.equal(document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '12345');

});

test('staff counter shows unavailable instead of inventing zero usage', async () => {
    const document = new JSDOM('<!doctype html><html lang="tr"><body><aside id="d1-usage-counter"><span id="d1-usage-value"></span><span id="d1-usage-status"></span><span role="progressbar"></span></aside></body></html>').window.document;
    initD1UsageCounter({ root: document, fetcher: async () => new Response(null, { status: 503 }) });
    await new Promise((resolveRequest) => setImmediate(resolveRequest));

    assert.match(document.querySelector('#d1-usage-value').textContent, /^— \/ 5\.000\.000$/);
    assert.equal(document.querySelector('#d1-usage-status').textContent, 'Kullanım verisi alınamıyor');
});
