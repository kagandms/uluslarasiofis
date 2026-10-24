import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import QRCode from 'qrcode';
import { mountMobileTransferPanel } from '../src/ui/mobile-transfer-panel.js';
import { createMobileTransferSession } from '../src/services/mobile-transfer-session.js';

const settle = () => new Promise(resolve => setImmediate(resolve));

function installGlobals(context, browser) {
    for (const name of ['document', 'location', 'MutationObserver', 'AbortController']) {
        const previous = Object.getOwnPropertyDescriptor(globalThis, name);
        Object.defineProperty(globalThis, name, { configurable: true, value: browser[name], writable: true });
        context.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
    }
}

function createFixture(context, seconds = 3600, options = {}) {
    const dom = new JSDOM('<main></main>', { url: 'https://portal.test' });
    installGlobals(context, dom.window);
    const panel = dom.window.document.querySelector('main');
    const fixture = { dom, panel, clock: { now: 1_800_000_000_000 }, intervals: new Map(), requests: [],
        timeouts: new Map(),
        photos: [], imported: [], downloadMetrics: { active: 0, max: 0 }, downloadDelays: new Map(),
        transferCount: 0, batchCount: 0, activeBatchId: null,
        wait: delay => new Promise(resolve => realSetTimeout(resolve, delay)),
        phonePaired: options.phonePaired === true, pending: options.pending === true };
    const realSetTimeout = globalThis.setTimeout.bind(globalThis);
    let timerId = 0;
    context.mock.method(Date, 'now', () => fixture.clock.now);
    context.mock.method(globalThis, 'setInterval', (callback, delay) => {
        fixture.intervals.set(++timerId, { callback, delay });
        return timerId;
    });
    context.mock.method(globalThis, 'clearInterval', id => fixture.intervals.delete(id));
    context.mock.method(globalThis, 'setTimeout', (callback, delay) => {
        fixture.timeouts.set(++timerId, { callback, delay });
        return timerId;
    });
    context.mock.method(globalThis, 'clearTimeout', id => fixture.timeouts.delete(id));
    context.mock.method(QRCode, 'toCanvas', async () => {});
    context.mock.method(globalThis, 'fetch', async (path, request = {}) => {
        const method = request.method || 'GET';
        fixture.requests.push({ path, method, body: request.body });
        if (path === '/api/staff/mobile-transfers' && method === 'POST') {
            fixture.transferCount += 1;
            return Response.json({ id: `transfer-${fixture.transferCount}`, claimToken: 'synthetic', expiresAt: fixture.clock.now / 1000 + seconds });
        }
        if (path.endsWith('/batches') && method === 'POST') {
            const body = JSON.parse(request.body);
            if (fixture.pending && body.discardPending !== true) {
                return Response.json({ error: { code: 'BATCH_PENDING_PHOTOS', message: 'Bekleyen fotoğraflar var.' } }, { status: 409 });
            }
            fixture.pending = false;
            fixture.batchCount += 1;
            fixture.activeBatchId = `batch-${fixture.batchCount}`;
            return Response.json({ batchId: fixture.activeBatchId });
        }
        if (path.endsWith('/close')) return Response.json({ closed: true });
        if (method === 'DELETE' && !path.includes('/files/')) {
            const closeStatus = options.closeStatuses?.shift() || (fixture.photos.length ? 409 : 200);
            if (closeStatus !== 200) return Response.json({ error: {
                code: closeStatus === 409 ? 'BATCH_PENDING_PHOTOS' : closeStatus === 410 ? 'TRANSFER_EXPIRED' : 'INTERNAL_ERROR',
                message: 'Bağlantı kapatılamadı.'
            } }, { status: closeStatus });
            return Response.json({ closed: true });
        }
        if (path.includes('/files/')) {
            if (method === 'GET') {
                const photoId = path.split('/').pop();
                fixture.downloadMetrics.active += 1;
                fixture.downloadMetrics.max = Math.max(fixture.downloadMetrics.max, fixture.downloadMetrics.active);
                try {
                    await new Promise(resolve => realSetTimeout(resolve, fixture.downloadDelays.get(photoId) || 0));
                    return new Response(new Uint8Array([1, 2, 3]));
                } finally { fixture.downloadMetrics.active -= 1; }
            }
            fixture.photos = fixture.photos.filter(photo => !path.endsWith(photo.id));
            return Response.json({ received: true });
        }
        return Response.json({ batchId: fixture.activeBatchId, phonePaired: fixture.phonePaired, files: [...fixture.photos] });
    });
    const session = createMobileTransferSession();
    mountMobileTransferPanel(panel, files => fixture.imported.push(...files), session);
    context.after(async () => { panel.remove(); await settle(); dom.window.close(); });
    return { ...fixture, button: panel.querySelector('button'), countdown: panel.querySelector('.transfer-countdown'), session };
}

async function tick(fixture, delay) {
    const callbacks = [...fixture.intervals.values()].filter(interval => interval.delay === delay).map(interval => interval.callback());
    await Promise.all(callbacks);
    await settle();
}

async function tickTimeout(fixture, delay) {
    const matching = [...fixture.timeouts.entries()].filter(([, timeout]) => timeout.delay === delay);
    for (const [id] of matching) fixture.timeouts.delete(id);
    for (const [, timeout] of matching) timeout.callback();
    for (let attempt = 0; attempt < 5; attempt += 1) await settle();
}

test('countdown uses the server deadline and updates locally', async (context) => {
    const fixture = createFixture(context);
    fixture.button.click();
    await settle();
    assert.equal(fixture.panel.querySelectorAll('button')[1].hidden, true);
    fixture.clock.now += 18_000;
    await tick(fixture, 1000);

    assert.equal(fixture.countdown.textContent, 'QR kalan süre: 59:42');
    assert.equal(fixture.requests.filter(request => request.path === '/api/staff/mobile-transfers').length, 1);
});

test('an unopened QR creates no photo polling request', async (context) => {
    const fixture = createFixture(context);
    await settle();

    assert.equal(fixture.timeouts.size, 0);
    assert.equal(fixture.requests.length, 0);
});

test('an earlier server deadline is shown and warns during its final five minutes', async (context) => {
    const fixture = createFixture(context, 420);
    fixture.button.click();
    await settle();
    fixture.clock.now += 120_000;
    await tick(fixture, 1000);

    assert.equal(fixture.countdown.textContent, 'QR kalan süre: 05:00');
    assert.equal(fixture.countdown.style.color, 'rgb(161, 98, 7)');
});

test('the paired transfer is reused and a new student batch opens on the next modal', async (context) => {
    const fixture = createFixture(context, 3600, { phonePaired: true });
    fixture.button.click();
    await settle();
    assert.ok([...fixture.timeouts.values()].some(timeout => timeout.delay === 3000));
    const transferId = fixture.session.getSnapshot().transfer.id;
    fixture.panel.remove();
    await settle();
    const nextPanel = fixture.dom.window.document.createElement('section');
    fixture.dom.window.document.body.append(nextPanel);
    mountMobileTransferPanel(nextPanel, () => {}, fixture.session);
    await settle();

    assert.equal(fixture.requests.filter(request => request.path === '/api/staff/mobile-transfers').length, 1);
    assert.equal(fixture.requests.filter(request => request.path.endsWith('/batches')).length, 2);
    assert.equal(fixture.session.getSnapshot().transfer.id, transferId);
    assert.equal(fixture.session.getSnapshot().batchId, 'batch-2');
    assert.match(nextPanel.textContent, /Telefon bağlı/);
    nextPanel.remove();
});

test('pending photos require an explicit discard before the next student batch opens', async (context) => {
    const fixture = createFixture(context, 3600, { pending: true });
    fixture.button.click();
    await settle();
    const discard = fixture.panel.querySelectorAll('button')[1];
    assert.equal(discard.hidden, false);
    discard.click();
    await settle();

    const requests = fixture.requests.filter(request => request.path.endsWith('/batches'));
    assert.equal(JSON.parse(requests[0].body).discardPending, false);
    assert.equal(JSON.parse(requests[1].body).discardPending, true);
    assert.ok(fixture.session.getSnapshot().batchId);
});

test('only active-batch photos are imported and acknowledged', async (context) => {
    const fixture = createFixture(context);
    fixture.button.click();
    await settle();
    fixture.photos.push({ id: 'photo-1', byte_size: 3 });
    assert.ok([...fixture.timeouts.values()].some(timeout => timeout.delay === 15000));
    await tickTimeout(fixture, 15000);
    await fixture.wait(30);

    assert.equal(fixture.imported.length, 1);
    assert.equal(fixture.imported[0].isValidatedTransferPhoto, true);
    assert.ok(fixture.requests.some(request => request.path.endsWith('/files/photo-1') && request.method === 'DELETE'));
});

test('pending photos download two at a time while the PC import order stays stable', async (context) => {
    const fixture = createFixture(context);
    fixture.button.click();
    await settle();
    fixture.photos.push({ id: 'photo-1', byte_size: 3 }, { id: 'photo-2', byte_size: 3 }, { id: 'photo-3', byte_size: 3 });
    fixture.downloadDelays.set('photo-1', 20);

    await tickTimeout(fixture, 15000);
    await fixture.wait(30);

    assert.equal(fixture.downloadMetrics.max, 2);
    assert.deepEqual(fixture.imported.map(file => file.name), [
        'Telefondan_photo-1.jpg', 'Telefondan_photo-2.jpg', 'Telefondan_photo-3.jpg'
    ]);
});

test('closing a modal closes its batch but preserves the unexpired transfer', async (context) => {
    const fixture = createFixture(context);
    fixture.button.click();
    await settle();
    const transferId = fixture.session.getSnapshot().transfer.id;
    const batchId = fixture.session.getSnapshot().batchId;
    fixture.panel.remove();
    await settle();

    assert.ok(fixture.requests.some(request => request.path.endsWith(`/batches/${batchId}/close`)));
    assert.equal(fixture.requests.some(request => request.path === `/api/staff/mobile-transfers/${transferId}` && request.method === 'DELETE'), false);
    assert.equal(fixture.session.getSnapshot().transfer.id, transferId);
    assert.equal(fixture.intervals.size, 0);
});

test('ending a transfer stops PC requests and requires a newly created QR', async (context) => {
    const fixture = createFixture(context, 3600, { phonePaired: true });
    fixture.button.click();
    await settle();
    const oldTransferId = fixture.session.getSnapshot().transfer.id;
    const endButton = fixture.panel.querySelector('[data-action="end-transfer"]');
    assert.equal(endButton.nextElementSibling.textContent, 'İşiniz bittiyse bağlantıyı kapatın.');
    assert.equal(endButton.nextElementSibling.hidden, false);

    endButton.click();
    await settle();
    const requestCount = fixture.requests.length;
    await tick(fixture, 3000);

    assert.equal(fixture.session.getSnapshot().transfer, null);
    assert.equal(fixture.requests.length, requestCount);
    assert.equal(endButton.hidden, true);
    assert.equal(endButton.nextElementSibling.hidden, true);
    assert.match(fixture.panel.textContent, /Yeniden bağlanmak için yeni QR/);
    fixture.button.click();
    await settle();
    assert.notEqual(fixture.session.getSnapshot().transfer.id, oldTransferId);
    assert.equal(fixture.requests.filter(request => request.path === '/api/staff/mobile-transfers').length, 2);
});

test('failed transfer closure preserves the session so staff can retry', async (context) => {
    const fixture = createFixture(context, 3600, { closeStatuses: [503, 200] });
    fixture.button.click();
    await settle();
    const transferId = fixture.session.getSnapshot().transfer.id;
    const endButton = fixture.panel.querySelector('[data-action="end-transfer"]');

    endButton.click();
    await settle();

    assert.equal(fixture.session.getSnapshot().transfer.id, transferId);
    assert.match(fixture.panel.textContent, /Bağlantı kapatılmadı/);
    assert.equal(endButton.disabled, false);
    endButton.click();
    await settle();
    assert.equal(fixture.session.getSnapshot().transfer, null);
});

test('ending a transfer preserves files already imported into the PC', async (context) => {
    const fixture = createFixture(context);
    fixture.button.click();
    await settle();
    fixture.photos.push({ id: 'photo-1', byte_size: 3 });
    await tickTimeout(fixture, 15000);
    await fixture.wait(10);
    const importedFile = fixture.imported[0];

    fixture.panel.querySelector('[data-action="end-transfer"]').click();
    await settle();

    assert.equal(fixture.session.getSnapshot().transfer, null);
    assert.equal(fixture.imported[0], importedFile);
});

test('pending server photos keep the QR connection open', async (context) => {
    const fixture = createFixture(context);
    fixture.button.click();
    await settle();
    const transferId = fixture.session.getSnapshot().transfer.id;
    fixture.photos.push({ id: 'photo-1', byte_size: 3 });

    fixture.panel.querySelector('[data-action="end-transfer"]').click();
    await settle();

    assert.equal(fixture.session.getSnapshot().transfer.id, transferId);
    assert.equal(fixture.photos.length, 1);
    assert.match(fixture.panel.textContent, /Bağlantı kapatılmadı/);
});

test('retrying after the server already ended a transfer clears the old connection', async (context) => {
    const fixture = createFixture(context, 3600, { closeStatuses: [410] });
    fixture.button.click();
    await settle();

    fixture.panel.querySelector('[data-action="end-transfer"]').click();
    await settle();

    assert.equal(fixture.session.getSnapshot().transfer, null);
    assert.match(fixture.button.textContent, /Yeni QR/);
});
