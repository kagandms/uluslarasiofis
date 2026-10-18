import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/server/worker.js';

test('recovery mode serves a no-store maintenance page without reaching assets', async () => {
    let assetFetchCalled = false;
    const response = await worker.fetch(new Request('https://portal.test/'), {
        RECOVERY_MODE: 'maintenance',
        ASSETS: { fetch: async () => { assetFetchCalled = true; return new Response('asset'); } }
    });

    assert.equal(response.status, 503);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('retry-after'), '120');
    assert.match(await response.text(), /Bakım çalışması/);
    assert.equal(assetFetchCalled, false);
});

test('recovery mode blocks application and scanner APIs without touching database bindings', async () => {
    const response = await worker.fetch(new Request('https://portal.test/api/public/applications', {
        method: 'POST',
        body: JSON.stringify({ student_number: 'test' })
    }), { RECOVERY_MODE: 'maintenance' });

    assert.equal(response.status, 503);
    assert.match(response.headers.get('content-type') || '', /application\/json/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).error.code, 'SERVICE_MAINTENANCE');
});

test('normal requests keep the existing asset path when recovery mode is unset', async () => {
    let assetFetchCalled = false;
    const response = await worker.fetch(new Request('https://portal.test/'), {
        ASSETS: { fetch: async () => { assetFetchCalled = true; return new Response('asset'); } }
    });

    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'asset');
    assert.equal(assetFetchCalled, true);
    assert.equal(typeof worker.scheduled, 'function');
});
