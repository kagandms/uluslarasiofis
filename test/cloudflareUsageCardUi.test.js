import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import test from 'node:test';
import { initCloudflareUsageCard } from '../src/ui/cloudflare-usage-card.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tick = () => new Promise((done) => setTimeout(done, 5));

async function staffDocument() {
    const html = await readFile(resolve(repositoryRoot, 'yetkili/index.html'), 'utf8');
    return new JSDOM(html, { url: 'https://portal.test/yetkili/' }).window.document;
}

const metric = (key, value, limit, extra = {}) => ({ key, value, limit, period: 'day', status: value === null ? 'unavailable' : 'ok', ...extra });
const respond = (metrics) => async () => Response.json({ date: '2026-11-08', month: '2026-11', retrievedAt: '2026-11-08T10:00:00Z', metrics });

test('usage card lives only on the staff home, top-left, and the old counter is gone', async () => {
    const document = await staffDocument();
    const publicDocument = new JSDOM(await readFile(resolve(repositoryRoot, 'index.html'), 'utf8')).window.document;
    assert.ok(document.querySelector('#home-screen #cloudflare-usage-card'));
    assert.equal(document.querySelector('#d1-usage-counter'), null);
    assert.equal(document.querySelector('#d1-usage-toggle'), null);
    assert.equal(publicDocument.querySelector('#cloudflare-usage-card'), null);
    assert.equal(document.querySelector('#home-screen').firstElementChild.id, 'cloudflare-usage-card');
    const css = await readFile(resolve(repositoryRoot, 'src/staff/home.css'), 'utf8');
    // Desktop: pinned to the far top-left below the header; phones: anchored inside the home screen.
    assert.match(css, /\.cf-usage-card \{[^}]*position: fixed;[^}]*inset-inline-start: 0\.75rem/);
    assert.match(css, /max-width: 560px\) \{[^}]*\.cf-usage-card \{ position: absolute;/);
});

test('card stays collapsed and does not request data until opened', async () => {
    const document = await staffDocument();
    let requests = 0;
    initCloudflareUsageCard({ root: document, fetcher: async (...args) => { requests += 1; return respond([metric('d1_rows_written', 1, 100000)])(...args); } });
    await tick();
    const toggle = document.getElementById('cloudflare-usage-toggle');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(document.getElementById('cloudflare-usage-panel').hidden, true);
    assert.equal(requests, 0);
    toggle.click();
    await tick();
    assert.equal(requests, 1);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
});

test('opening renders progressbars with tr-TR numbers and the summary shows the highest metric', async () => {
    const document = await staffDocument();
    initCloudflareUsageCard({ root: document, fetcher: respond([
        metric('d1_rows_written', 50000, 100000), metric('workers_requests', 1000, 100000)
    ]) });
    document.getElementById('cloudflare-usage-toggle').click();
    await tick();
    const bars = document.querySelectorAll('#cloudflare-usage-list [role="progressbar"]');
    assert.equal(bars.length, 2);
    assert.equal(bars[0].getAttribute('aria-valuenow'), '50000');
    assert.equal(bars[0].getAttribute('aria-valuemax'), '100000');
    const text = document.getElementById('cloudflare-usage-list').textContent;
    assert.match(text, /50\.000 \/ 100\.000/);
    assert.match(text, /%50,00/);
    assert.match(document.getElementById('cloudflare-usage-summary').textContent, /D1 yazılan satır %50,00/);
});

test('threshold classes apply at 70 and 90 percent and overflow clamps the bar', async () => {
    const document = await staffDocument();
    initCloudflareUsageCard({ root: document, fetcher: respond([
        metric('workers_requests', 69999, 100000), metric('d1_rows_read', 70, 100), metric('d1_rows_written', 90, 100), metric('r2_class_a', 150, 100)
    ]) });
    document.getElementById('cloudflare-usage-toggle').click();
    await tick();
    const rows = [...document.querySelectorAll('.cf-usage-row')];
    assert.deepEqual(rows.map((r) => [r.classList.contains('is-warning'), r.classList.contains('is-danger')]),
        [[false, false], [true, false], [false, true], [false, true]]);
    assert.equal(rows[3].querySelector('.cf-usage-fill').style.width, '100%');
    assert.match(rows[3].textContent, /%150,00/);
});

test('unavailable metrics and fetch failures never show zero', async () => {
    const document = await staffDocument();
    initCloudflareUsageCard({ root: document, fetcher: respond([metric('workers_requests', null, 100000), metric('d1_rows_read', 5, 100)]) });
    document.getElementById('cloudflare-usage-toggle').click();
    await tick();
    assert.match(document.querySelector('.cf-usage-row.is-unavailable').textContent, /alınamıyor/);
    assert.equal(document.querySelector('.cf-usage-row.is-unavailable [role="progressbar"]').hasAttribute('aria-valuenow'), false);

    const failing = await staffDocument();
    initCloudflareUsageCard({ root: failing, fetcher: async () => new Response(null, { status: 503 }) });
    failing.getElementById('cloudflare-usage-toggle').click();
    await tick();
    assert.match(failing.getElementById('cloudflare-usage-retrieved').textContent, /alınamıyor/);
    assert.equal(failing.getElementById('cloudflare-usage-summary').textContent, 'alınamıyor');
});

test('storage preference failures do not break the card', async () => {
    const document = await staffDocument();
    Object.defineProperty(document.defaultView, 'localStorage', { get() { throw new Error('blocked'); } });
    initCloudflareUsageCard({ root: document, fetcher: respond([metric('r2_class_a', 1, 100)]) });
    document.getElementById('cloudflare-usage-toggle').click();
    await tick();
    assert.equal(document.querySelectorAll('.cf-usage-row').length, 1);
});
