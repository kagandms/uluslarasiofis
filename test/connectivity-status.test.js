import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { initializeConnectivityStatus } from '../src/staff/connectivity-status.js';

function createStatusHarness(fetcher) {
    const dom = new JSDOM('<button id="btn-upload">Upload</button>', { url: 'https://portal.test/yetkili/' });
    Object.defineProperty(dom.window.navigator, 'onLine', { configurable: true, value: false });
    const notifications = [];
    const initialize = () => initializeConnectivityStatus({
        root: dom.window.document,
        fetcher,
        notify: (message, type) => notifications.push({ message, type })
    });
    return { dom, initialize, notifications };
}

test('portal reachability keeps upload enabled when navigator reports offline but the portal responds', async () => {
    const requests = [];
    const harness = createStatusHarness(async (url, options) => {
        requests.push({ url: String(url), options });
        return new Response(null, { status: 200 });
    });

    await harness.initialize();

    assert.equal(harness.dom.window.document.getElementById('btn-upload').disabled, false);
    assert.deepEqual(harness.notifications, []);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://portal.test/');
    assert.equal(requests[0].options.method, 'HEAD');
    assert.equal(requests[0].options.credentials, 'omit');
    harness.dom.window.close();
});

test('portal HTTP errors still count as reachable transport', async () => {
    const harness = createStatusHarness(async () => new Response(null, { status: 503 }));

    await harness.initialize();

    assert.equal(harness.dom.window.document.getElementById('btn-upload').disabled, false);
    assert.deepEqual(harness.notifications, []);
    harness.dom.window.close();
});

test('network changes during a pending probe trigger one fresh reachability check', async () => {
    let resolveInitialProbe;
    let requestCount = 0;
    const harness = createStatusHarness(() => {
        requestCount += 1;
        if (requestCount === 1) return new Promise((resolveRequest) => { resolveInitialProbe = resolveRequest; });
        return Promise.resolve(new Response(null, { status: 200 }));
    });

    const initialProbe = harness.initialize();
    harness.dom.window.dispatchEvent(new harness.dom.window.Event('online'));
    resolveInitialProbe(new Response(null, { status: 503 }));
    await initialProbe;
    await new Promise((resolveRequest) => setImmediate(resolveRequest));

    assert.equal(requestCount, 2);
    assert.equal(harness.dom.window.document.getElementById('btn-upload').disabled, false);
    assert.deepEqual(harness.notifications, []);
    harness.dom.window.close();
});

test('portal transport failure disables upload and a later reachable check restores it once', async () => {
    let isReachable = false;
    const harness = createStatusHarness(async () => {
        if (!isReachable) throw new TypeError('Network unavailable');
        return new Response(null, { status: 200 });
    });

    await harness.initialize();
    assert.equal(harness.dom.window.document.getElementById('btn-upload').disabled, true);
    assert.equal(harness.notifications.at(-1)?.type, 'warning');

    isReachable = true;
    harness.dom.window.dispatchEvent(new harness.dom.window.Event('online'));
    await new Promise((resolveRequest) => setImmediate(resolveRequest));

    assert.equal(harness.dom.window.document.getElementById('btn-upload').disabled, false);
    assert.equal(harness.notifications.at(-1)?.type, 'success');
    harness.dom.window.close();
});
