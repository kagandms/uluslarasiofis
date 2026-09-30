import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recognizeCurrentPassportImage } from '../src/public/applicationApi.js';

test('public passport OCR sends image bytes same-origin and supports cancellation', async () => {
    const image = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    const controller = new AbortController();
    const requests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
        requests.push(args);
        return Response.json({ fields: { first_name: 'ADA' } });
    };

    try {
        const result = await recognizeCurrentPassportImage(image, { signal: controller.signal });

        assert.deepEqual(result, { first_name: 'ADA' });
        assert.equal(requests[0][0], '/api/public/applications/current/passport/ocr');
        assert.equal(requests[0][1].method, 'POST');
        assert.equal(requests[0][1].credentials, 'same-origin');
        assert.equal(requests[0][1].headers['Content-Type'], 'image/jpeg');
        assert.equal(requests[0][1].body, image);
        assert.equal(requests[0][1].signal, controller.signal);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('public passport OCR converts safe server errors to their error envelope code', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ error: { code: 'OCR_UNAVAILABLE' } }, { status: 503 });

    try {
        await assert.rejects(recognizeCurrentPassportImage(new Blob(['x'], { type: 'image/png' })), { code: 'OCR_UNAVAILABLE', status: 503 });
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('public passport OCR rejects unsupported or oversized bodies before fetch', async () => {
    const originalFetch = globalThis.fetch;
    let requestCount = 0;
    globalThis.fetch = async () => { requestCount += 1; return Response.json({ fields: {} }); };

    try {
        await assert.rejects(recognizeCurrentPassportImage(new Blob(['x'], { type: 'application/pdf' })), { code: 'UNSUPPORTED_OCR_MEDIA_TYPE' });
        await assert.rejects(recognizeCurrentPassportImage(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/png' })), { code: 'REQUEST_TOO_LARGE' });
        assert.equal(requestCount, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
