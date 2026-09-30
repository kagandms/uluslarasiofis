import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/server/domain/errors.js';
import { recognizePublicPassportImage, recognizeStaffDocument } from '../src/server/services/ocrProvider.js';

const AZURE_ENVIRONMENT = {
    AZURE_VISION_ENDPOINT: 'https://vision.example.test/',
    AZURE_VISION_KEY: 'test-azure-key',
    GOOGLE_VISION_API_KEY: 'test-google-key'
};

function azureResponse() {
    return new Response(JSON.stringify({ readResult: { blocks: [{ lines: [{ text: 'passport text', words: [] }] }] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
}

async function withFetch(fetchMock, callback) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
        await callback();
    } finally {
        globalThis.fetch = originalFetch;
    }
}

test('staff OCR keeps Azure success as the existing annotation response contract', async () => {
    await withFetch(async () => azureResponse(), async () => {
        const result = await recognizeStaffDocument(new Uint8Array([1, 2, 3]), AZURE_ENVIRONMENT);

        assert.deepEqual(result, { responses: [{ textAnnotations: [{ description: 'passport text' }] }] });
    });
});

test('staff OCR retains Azure-to-Google fallback', async () => {
    const requestedUrls = [];
    await withFetch(async (url) => {
        requestedUrls.push(String(url));
        if (String(url).startsWith('https://vision.example.test')) return new Response('', { status: 503 });
        return new Response(JSON.stringify({ responses: [{ textAnnotations: [{ description: 'google text' }] }] }), { status: 200 });
    }, async () => {
        const result = await recognizeStaffDocument(new Uint8Array([1, 2, 3]), AZURE_ENVIRONMENT);

        assert.equal(result.responses[0].textAnnotations[0].description, 'google text');
        assert.equal(requestedUrls.length, 2);
        assert.match(requestedUrls[1], /^https:\/\/eu-vision\.googleapis\.com\//);
    });
});

test('public passport OCR fails safely when Azure is unavailable without calling Google', async () => {
    let providerCallCount = 0;
    await withFetch(async () => {
        providerCallCount += 1;
        return new Response('', { status: 503 });
    }, async () => {
        await assert.rejects(
            recognizePublicPassportImage(new Uint8Array([1, 2, 3]), AZURE_ENVIRONMENT),
            (error) => error instanceof ApiError && error.code === 'OCR_PROVIDER_FAILURE'
        );
    });

    assert.equal(providerCallCount, 1);
});

test('public passport OCR does not fall back to Google when Azure is unconfigured', async () => {
    let providerCallCount = 0;
    await withFetch(async () => {
        providerCallCount += 1;
        throw new Error('provider must not be called');
    }, async () => {
        await assert.rejects(
            recognizePublicPassportImage(new Uint8Array([1, 2, 3]), { GOOGLE_VISION_API_KEY: 'test-google-key' }),
            (error) => error instanceof ApiError && error.code === 'OCR_UNAVAILABLE'
        );
    });

    assert.equal(providerCallCount, 0);
});
