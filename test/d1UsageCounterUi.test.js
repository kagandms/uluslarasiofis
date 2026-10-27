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
        fetcher: async () => Response.json({
            rowsRead: 12345,
            databases: [
                { databaseId: '74b45974-8665-4616-bce0-3380da71c22f', rowsRead: 12000 },
                { databaseId: '2ef78af7-be99-4a8d-bc63-0be2a9704e96', rowsRead: 345 }
            ],
            limit: 5_000_000,
            date: '2026-10-14'
        })
    });
    await new Promise((resolveRequest) => setImmediate(resolveRequest));

    assert.equal(document.querySelector('#d1-usage-value').textContent, '12.345 / 5.000.000');
    assert.equal(document.querySelector('#d1-usage-percent').textContent, '0,25%');
    assert.equal(document.querySelector('#d1-usage-status').textContent, '2026-10-14 UTC');
    assert.equal(document.querySelector('#d1-usage-breakdown').textContent, 'DB 74b45974: 12.000 · DB 2ef78af7: 345');
    assert.equal(document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '12345');

});

test('staff counter shows unavailable instead of inventing zero usage', async () => {
    const document = new JSDOM('<!doctype html><html lang="tr"><body><aside id="d1-usage-counter"><span id="d1-usage-value"></span><span id="d1-usage-percent"></span><span id="d1-usage-status"></span><span role="progressbar"></span></aside></body></html>').window.document;
    initD1UsageCounter({ root: document, fetcher: async () => new Response(null, { status: 503 }) });
    await new Promise((resolveRequest) => setImmediate(resolveRequest));

    assert.match(document.querySelector('#d1-usage-value').textContent, /^— \/ 5\.000\.000$/);
    assert.equal(document.querySelector('#d1-usage-status').textContent, 'Kullanım verisi alınamıyor');
    assert.equal(document.querySelector('#d1-usage-percent').textContent, '—');
});

test('staff counter rejects a zero limit instead of rendering an invalid percentage', async () => {
    const staffHtml = await readFile(resolve(repositoryRoot, 'yetkili/index.html'), 'utf8');
    const dom = new JSDOM(staffHtml);

    initD1UsageCounter({ root: dom.window.document, fetcher: async () => Response.json({ rowsRead: 12, limit: 0 }) });
    await new Promise((resolveRequest) => setImmediate(resolveRequest));

    assert.equal(dom.window.document.querySelector('#d1-usage-percent').textContent, '—');
    assert.equal(dom.window.document.querySelector('#d1-usage-status').textContent, 'Kullanım verisi alınamıyor');
    dom.window.close();
});

test('staff can hide the daily counter persistently and defer analytics until it is shown', async () => {
    const staffHtml = await readFile(resolve(repositoryRoot, 'yetkili/index.html'), 'utf8');
    const dom = new JSDOM(staffHtml, { url: 'https://portal.test/yetkili/' });
    const { document, localStorage } = dom.window;
    localStorage.setItem('d1-usage-counter-hidden', 'true');
    let requestCount = 0;
    initD1UsageCounter({
        root: document,
        fetcher: async () => {
            requestCount += 1;
            return Response.json({ rowsRead: 1, limit: 5_000_000, date: '2026-10-26' });
        }
    });

    const widget = document.querySelector('#d1-usage-counter');
    const toggle = document.querySelector('#d1-usage-toggle');
    assert.equal(widget.hidden, true);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(requestCount, 0);

    toggle.click();
    await new Promise((resolveRequest) => setImmediate(resolveRequest));
    assert.equal(widget.hidden, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(localStorage.getItem('d1-usage-counter-hidden'), 'false');
    assert.equal(requestCount, 1);
    dom.window.close();
});

test('hidden staff counter is not rendered despite the widget grid style', async () => {
    const staffHtml = await readFile(resolve(repositoryRoot, 'yetkili/index.html'), 'utf8');
    const homeCss = await readFile(resolve(repositoryRoot, 'src/staff/home.css'), 'utf8');
    const dom = new JSDOM(staffHtml, { url: 'https://portal.test/yetkili/' });
    const { document, localStorage, getComputedStyle } = dom.window;
    const style = document.createElement('style');
    style.textContent = homeCss;
    document.head.append(style);
    localStorage.setItem('d1-usage-counter-hidden', 'true');

    initD1UsageCounter({ root: document, fetcher: async () => Response.json({ rowsRead: 1, limit: 5_000_000, date: '2026-10-26' }) });

    assert.equal(document.querySelector('#d1-usage-counter').hidden, true);
    assert.equal(getComputedStyle(document.querySelector('#d1-usage-counter')).display, 'none');
    dom.window.close();
});

test('staff counter visibility button stays in the top-right header actions and hides its grid layout', async () => {
    const staffHtml = await readFile(resolve(repositoryRoot, 'yetkili/index.html'), 'utf8');
    const homeCss = await readFile(resolve(repositoryRoot, 'src/staff/home.css'), 'utf8');
    const dom = new JSDOM(staffHtml, { url: 'https://portal.test/yetkili/' });
    const { document, getComputedStyle } = dom.window;
    const style = document.createElement('style');
    style.textContent = homeCss;
    document.head.append(style);

    initD1UsageCounter({ root: document, fetcher: async () => Response.json({ rowsRead: 1, limit: 5_000_000, date: '2026-10-26' }) });

    const headerActions = document.querySelector('.header-actions');
    const widget = document.querySelector('#d1-usage-counter');
    const toggle = document.querySelector('#d1-usage-toggle');
    const icon = () => toggle.querySelector('svg path')?.getAttribute('d');

    assert.ok(headerActions);
    assert.equal(toggle.parentElement, headerActions);
    assert.ok(toggle.classList.contains('btn-header'));
    assert.ok(toggle.classList.contains('icon-only'));
    assert.equal(toggle.textContent.trim(), '');
    assert.equal(toggle.getAttribute('aria-label'), 'Sayacı gizle');
    assert.equal(icon(), 'M5 15 12 8 19 15');
    assert.equal(getComputedStyle(widget).display, 'grid');

    toggle.click();
    assert.equal(widget.hidden, true);
    assert.equal(getComputedStyle(widget).display, 'none');
    assert.equal(toggle.getAttribute('aria-label'), 'Sayacı göster');
    assert.equal(icon(), 'M5 9 12 16 19 9');

    toggle.click();
    assert.equal(widget.hidden, false);
    assert.equal(getComputedStyle(widget).display, 'grid');
    dom.window.close();
});

test('staff counter animates open and closed before changing its hidden state', async () => {
    const staffHtml = await readFile(resolve(repositoryRoot, 'yetkili/index.html'), 'utf8');
    const dom = new JSDOM(staffHtml, { url: 'https://portal.test/yetkili/' });
    const { document } = dom.window;
    const widget = document.querySelector('#d1-usage-counter');
    const animations = [];
    widget.animate = (keyframes, options) => {
        const animation = {
            keyframes,
            options,
            onfinish: null,
            cancel() {},
            finish() { this.onfinish?.(); }
        };
        animations.push(animation);
        return animation;
    };
    initD1UsageCounter({
        root: document,
        fetcher: async () => Response.json({ rowsRead: 1, limit: 5_000_000, date: '2026-10-26' })
    });

    const toggle = document.querySelector('#d1-usage-toggle');
    toggle.click();
    assert.equal(widget.hidden, false);
    assert.deepEqual(animations[0].keyframes, [
        { opacity: 1, transform: 'translateY(0) scale(1)' },
        { opacity: 0, transform: 'translateY(-8px) scale(0.98)' }
    ]);
    animations[0].finish();
    assert.equal(widget.hidden, true);

    toggle.click();
    assert.equal(widget.hidden, false);
    assert.deepEqual(animations[1].keyframes, [
        { opacity: 0, transform: 'translateY(-8px) scale(0.98)' },
        { opacity: 1, transform: 'translateY(0) scale(1)' }
    ]);
    animations[1].finish();
    assert.equal(widget.hidden, false);
    dom.window.close();
});
