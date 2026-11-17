import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import test from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const bridgeSource = await readFile(resolve(testDirectory, '../ykn_eklenti-main/bridge.js'), 'utf8');

function createBridgeHarness({ hasSession = true } = {}) {
    const dom = new JSDOM('<section id="workspace-content"><section id="view-ykn"></section></section>', {
        url: 'http://localhost:5173/yetkili/',
        runScripts: 'outside-only'
    });

    const { window } = dom;
    const postedMessages = [];
    const originalPostMessage = window.postMessage.bind(window);

    Object.defineProperty(window, 'postMessage', {
        configurable: true,
        writable: true,
        value: (message, targetOrigin, transfer) => {
            postedMessages.push({ message, targetOrigin });
            return originalPostMessage(message, targetOrigin, transfer);
        }
    });

    window.fetch = async () => ({ ok: hasSession });
    window.chrome = {
        runtime: {
            id: 'mock-ext',
            lastError: null,
            sendMessage(_message, callback) {
                if (callback) callback({ success: true });
            },
            onMessage: { addListener() {} }
        }
    };

    window.eval(bridgeSource);

    const dispatchPing = async (requestId) => {
        window.dispatchEvent(new window.MessageEvent('message', {
            source: window,
            origin: 'http://localhost:5173',
            data: {
                source: 'WEB_APP',
                payload: {
                    action: 'PING',
                    requestId
                }
            }
        }));
        await new Promise((resolve) => setTimeout(resolve, 20));
    };

    const waitForInitialHandshake = () => new Promise((resolve) => setTimeout(resolve, 20));

    return {
        window,
        postedMessages,
        dispatchPing,
        waitForInitialHandshake
    };
}

test('bridge.js yetkili oturumu varken ilk ve PING yanıtı PONG mesajlarında background_transfer özelliğini bildirir', async () => {
    const harness = createBridgeHarness({ hasSession: true });

    try {
        await harness.waitForInitialHandshake();

        const initialPongs = harness.postedMessages
            .map((entry) => entry.message)
            .filter((msg) => msg?.type === 'PONG');

        assert.equal(initialPongs.length, 1);
        assert.ok(Array.isArray(initialPongs[0].features));
        assert.ok(Object.isFrozen(initialPongs[0].features));
        assert.deepEqual(
            { ...initialPongs[0], features: [...initialPongs[0].features] },
            {
                source: 'EXTENSION',
                type: 'PONG',
                ready: true,
                features: ['background_transfer']
            }
        );

        await harness.dispatchPing('ping-req-1');

        const allPongs = harness.postedMessages
            .map((entry) => entry.message)
            .filter((msg) => msg?.type === 'PONG');

        assert.equal(allPongs.length, 2);
        const pingPong = allPongs[1];
        assert.ok(Array.isArray(pingPong.features));
        assert.ok(Object.isFrozen(pingPong.features));
        assert.deepEqual(
            { ...pingPong, features: [...pingPong.features] },
            {
                source: 'EXTENSION',
                type: 'PONG',
                ready: true,
                requestId: 'ping-req-1',
                features: ['background_transfer']
            }
        );
    } finally {
        harness.window.close();
    }
});

test('bridge.js yetkili oturumu yokken PONG üretmez', async () => {
    const harness = createBridgeHarness({ hasSession: false });

    try {
        await harness.waitForInitialHandshake();
        await harness.dispatchPing('ping-req-unauth');

        const pongs = harness.postedMessages
            .map((entry) => entry.message)
            .filter((msg) => msg?.type === 'PONG');

        assert.equal(pongs.length, 0);

        const failures = harness.postedMessages
            .map((entry) => entry.message)
            .filter((msg) => msg?.type === 'EVENT' && msg?.action === 'REQUEST_FAILED');

        assert.equal(failures.length, 1);
        assert.equal(failures[0].requestId, 'ping-req-unauth');
        assert.equal(failures[0].code, 'STAFF_SESSION_REQUIRED');
    } finally {
        harness.window.close();
    }
});
