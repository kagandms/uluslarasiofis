import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import QRCode from 'qrcode';
import { mountMobileTransferPanel } from '../src/ui/mobile-transfer-panel.js';

const settle = () => new Promise(resolve => setImmediate(resolve));

function installPanelGlobals(context, browser) {
    for (const name of ['document', 'location', 'MutationObserver', 'AbortController']) {
        const previous = Object.getOwnPropertyDescriptor(globalThis, name);
        Object.defineProperty(globalThis, name, { configurable: true, value: browser[name], writable: true });
        context.after(() => {
            if (previous) Object.defineProperty(globalThis, name, previous);
            if (!previous) delete globalThis[name];
        });
    }
}

function installPanelTimers(context, fixture) {
    let nextInterval = 0;
    context.mock.method(Date, 'now', () => fixture.clock.now);
    context.mock.method(globalThis, 'setInterval', (callback, delay) => {
        fixture.intervals.set(++nextInterval, { callback, delay });
        return nextInterval;
    });
    context.mock.method(globalThis, 'clearInterval', id => fixture.intervals.delete(id));
}

function installPanelApi(context, fixture, seconds) {
    let generation = 0;
    context.mock.method(QRCode, 'toCanvas', async () => {});
    context.mock.method(globalThis, 'fetch', async (path, options = {}) => {
        fixture.requests.push({ path, method: options.method || 'GET' });
        if (options.method === 'POST') return Response.json({ id: `transfer-${++generation}`,
            claimToken: 'synthetic', expiresAt: fixture.clock.now / 1000 + seconds });
        if (options.method === 'DELETE') return Response.json({ closed: true });
        if (path.includes('/files/')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } });
        return Response.json({ files: [...fixture.photos] });
    });
}

function createPanelFixture(context, seconds = 3600) {
    const dom = new JSDOM('<main></main>', { url: 'https://portal.test' });
    installPanelGlobals(context, dom.window);
    const panel = dom.window.document.querySelector('main');
    const fixture = { dom, panel, clock: { now: 1_800_000_000_000 }, intervals: new Map(),
        requests: [], photos: [], imported: [] };
    installPanelTimers(context, fixture);
    installPanelApi(context, fixture, seconds);
    mountMobileTransferPanel(panel, files => fixture.imported.push(...files));
    context.after(async () => { panel.remove(); await settle(); dom.window.close(); });
    return { ...fixture, button: panel.querySelector('button'), countdown: panel.querySelector('.transfer-countdown') };
}

async function tick(fixture, delay) {
    for (const interval of [...fixture.intervals.values()]) {
        if (interval.delay === delay) interval.callback();
    }
    await settle();
}

test('countdown uses the returned deadline every second without adding server polling', async (context) => {
    const fixture = createPanelFixture(context);
    fixture.button.click();
    await settle();
    assert.equal(fixture.countdown.textContent, 'QR kalan süre: 60:00');

    fixture.clock.now += 18_000;
    await tick(fixture, 1000);

    assert.equal(fixture.countdown.textContent, 'QR kalan süre: 59:42');
    assert.equal(fixture.countdown.style.color, 'rgb(107, 114, 128)');
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.countdown.previousElementSibling.querySelectorAll('canvas').length, 1);
    assert.match(fixture.panel.textContent, /1 saat geçerli/);
    assert.doesNotMatch(fixture.panel.textContent, /15 dakika/);
});

test('an earlier server deadline is displayed and the final five minutes use a mild warning color', async (context) => {
    const fixture = createPanelFixture(context, 420);
    fixture.button.click();
    await settle();
    assert.equal(fixture.countdown.textContent, 'QR kalan süre: 07:00');

    fixture.clock.now += 120_000;
    await tick(fixture, 1000);

    assert.equal(fixture.countdown.textContent, 'QR kalan süre: 05:00');
    assert.equal(fixture.countdown.style.color, 'rgb(161, 98, 7)');
});

test('returning from a background tab immediately recomputes remaining time and expiry', async (context) => {
    const fixture = createPanelFixture(context);
    fixture.button.click();
    await settle();

    fixture.clock.now += 20 * 60_000;
    fixture.dom.window.document.dispatchEvent(new fixture.dom.window.Event('visibilitychange'));
    assert.equal(fixture.countdown.textContent, 'QR kalan süre: 40:00');
    fixture.clock.now += 40 * 60_000 + 20_000;
    fixture.dom.window.document.dispatchEvent(new fixture.dom.window.Event('visibilitychange'));
    await tick(fixture, 2000);

    assert.equal(fixture.countdown.textContent, 'QR süresi doldu');
    assert.equal(fixture.panel.querySelector('canvas'), null);
    assert.equal(fixture.button.disabled, false);
    assert.equal(fixture.requests.length, 1);
    assert.equal([...fixture.intervals.values()].some(interval => interval.delay === 1000), false);
});

test('expired QR can be regenerated while previously imported photos are retained', async (context) => {
    const fixture = createPanelFixture(context);
    fixture.button.click();
    await settle();
    fixture.photos.push({ id: 'photo-1' });
    await tick(fixture, 2000);
    assert.equal(fixture.imported.length, 1);
    assert.equal(fixture.requests.some(request => request.path.endsWith('/files/photo-1') && request.method === 'DELETE'), true);

    fixture.clock.now += 3600_000;
    await tick(fixture, 1000);
    assert.equal(fixture.button.textContent, '📱 Yeni QR oluştur');
    fixture.button.click();
    await settle();
    fixture.photos.length = 0;
    await tick(fixture, 2000);

    assert.equal(fixture.countdown.textContent, 'QR kalan süre: 60:00');
    assert.equal(fixture.button.disabled, true);
    assert.equal(fixture.panel.querySelectorAll('canvas').length, 1);
    assert.equal(fixture.imported.length, 1);
    assert.equal(fixture.requests.filter(request => request.method === 'POST').length, 2);
    assert.equal(fixture.requests.at(-1).path, '/api/staff/mobile-transfers/transfer-2');
    assert.equal([...fixture.intervals.values()].filter(interval => interval.delay === 1000).length, 1);
});

test('closing the panel releases all intervals and visibility/click listeners', async (context) => {
    const fixture = createPanelFixture(context);
    fixture.button.click();
    await settle();
    assert.equal(fixture.intervals.size, 2);
    const lastCountdown = fixture.countdown.textContent;

    fixture.panel.remove();
    await settle();
    const requestCount = fixture.requests.length;
    fixture.clock.now += 3600_000;
    fixture.dom.window.document.dispatchEvent(new fixture.dom.window.Event('visibilitychange'));
    fixture.button.click();
    await settle();

    assert.equal(fixture.intervals.size, 0);
    assert.equal(fixture.countdown.textContent, lastCountdown);
    assert.equal(fixture.requests.length, requestCount);
    assert.equal(fixture.requests.at(-1).method, 'DELETE');
});

test('a QR whose returned deadline has passed is never displayed as active', async (context) => {
    const fixture = createPanelFixture(context, -1);

    fixture.button.click();
    await settle();

    assert.equal(fixture.countdown.textContent, 'QR süresi doldu');
    assert.equal(fixture.panel.querySelector('canvas'), null);
    assert.equal(fixture.button.disabled, false);
    assert.equal([...fixture.intervals.values()].some(interval => interval.delay === 1000), false);
});
