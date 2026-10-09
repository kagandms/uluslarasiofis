import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optimizeDocumentImage } from '../src/services/optimize-document-image.js';
import {
    DOCUMENT_IMAGE_LONG_EDGE,
    DOCUMENT_IMAGE_JPEG_QUALITY,
    DOCUMENT_IMAGE_JPEG_PASSTHROUGH_BYTES
} from '../src/config/mobile-transfer-policy.js';

/** Installs browser image/canvas boundaries; returns recorded encoding and cleanup calls. */
function mockImageEnvironment(context, options = {}) {
    const calls = { encodings: [], dimensions: [], revoked: [] };
    const canvas = { width: 0, height: 0 };
    const drawingContext = { fillRect() {}, drawImage() {} };
    canvas.getContext = () => options.hasContext === false ? null : drawingContext;
    canvas.toBlob = (callback, type, quality) => {
        calls.encodings.push({ type, quality });
        calls.dimensions.push({ width: canvas.width, height: canvas.height });
        callback(options.hasEncoding === false ? null : new Blob([new Uint8Array(options.encodedBytes ?? 200_000)], { type }));
    };
    class BrowserImage {
        naturalWidth = options.width ?? 2480;
        naturalHeight = options.height ?? 3508;
        async decode() {
            if (options.hasDecodeError) throw new Error('Cannot decode');
        }
    }
    context.mock.method(globalThis.URL, 'createObjectURL', () => 'blob:test-image');
    context.mock.method(globalThis.URL, 'revokeObjectURL', url => calls.revoked.push(url));
    const originalImageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Image');
    const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: BrowserImage });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas } });
    context.after(() => {
        if (originalImageDescriptor) Object.defineProperty(globalThis, 'Image', originalImageDescriptor);
        else delete globalThis.Image;
        if (originalDocumentDescriptor) Object.defineProperty(globalThis, 'document', originalDocumentDescriptor);
        else delete globalThis.document;
    });
    return { calls, canvas };
}

test('keeps JPEGs at the passthrough size boundary without recompressing', async context => {
    const { calls } = mockImageEnvironment(context);
    const original = new Blob([new Uint8Array(DOCUMENT_IMAGE_JPEG_PASSTHROUGH_BYTES)], { type: 'image/jpeg' });

    const optimized = await optimizeDocumentImage(original);

    assert.equal(optimized, original);
    assert.deepEqual(calls.encodings, []);
    assert.deepEqual(calls.revoked, ['blob:test-image']);
});

test('compresses large JPEGs without reducing dimensions or changing the quality setting', async context => {
    const { calls, canvas } = mockImageEnvironment(context);
    const original = new Blob([new Uint8Array(DOCUMENT_IMAGE_JPEG_PASSTHROUGH_BYTES + 1)], { type: 'image/jpeg' });

    const optimized = await optimizeDocumentImage(original);

    assert.ok(optimized.size < original.size);
    assert.equal(optimized.type, 'image/jpeg');
    assert.deepEqual(calls.dimensions, [{ width: 2480, height: 3508 }]);
    assert.deepEqual(calls.encodings, [{ type: 'image/jpeg', quality: DOCUMENT_IMAGE_JPEG_QUALITY }]);
    assert.equal(canvas.width, 0);
    assert.equal(canvas.height, 0);
});

for (const extraBytes of [0, 1]) {
    test(`preserves the original JPEG when encoding adds ${extraBytes} bytes`, async context => {
        const originalBytes = DOCUMENT_IMAGE_JPEG_PASSTHROUGH_BYTES + 1;
        mockImageEnvironment(context, { encodedBytes: originalBytes + extraBytes });
        const original = new Blob([new Uint8Array(originalBytes)], { type: 'image/jpeg' });

        const optimized = await optimizeDocumentImage(original);

        assert.equal(optimized, original);
    });
}

test('still resizes oversized images even when they are below the passthrough byte limit', async context => {
    const { calls } = mockImageEnvironment(context, { width: 7016, height: 4960 });
    const original = new Blob([new Uint8Array(100_000)], { type: 'image/jpeg' });

    const optimized = await optimizeDocumentImage(original);

    assert.notEqual(optimized, original);
    assert.deepEqual(calls.dimensions, [{ width: DOCUMENT_IMAGE_LONG_EDGE, height: 2480 }]);
});

test('still converts small PNGs to JPEG', async context => {
    const { calls } = mockImageEnvironment(context, { width: 1200, height: 800 });
    const original = new Blob([new Uint8Array(100_000)], { type: 'image/png' });

    const optimized = await optimizeDocumentImage(original);

    assert.equal(optimized.type, 'image/jpeg');
    assert.deepEqual(calls.dimensions, [{ width: 1200, height: 800 }]);
});

for (const failure of [{ hasDecodeError: true }, { hasContext: false }, { hasEncoding: false }]) {
    test(`rejects failed image processing and releases resources: ${JSON.stringify(failure)}`, async context => {
        const { calls, canvas } = mockImageEnvironment(context, failure);
        context.mock.method(console, 'error', () => {});
        const original = new Blob([new Uint8Array(100_000)], { type: 'image/png' });

        await assert.rejects(optimizeDocumentImage(original), /Fotoğraf işlenemedi/);

        assert.deepEqual(calls.revoked, ['blob:test-image']);
        assert.equal(canvas.width, 0);
        assert.equal(canvas.height, 0);
    });
}
