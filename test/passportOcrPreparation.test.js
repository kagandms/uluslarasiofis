import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFJS_VERSION } from '../src/config/pdfjs-version.js';
import { preparePassportImage, recognizePassportSource } from '../src/public/passportOcrClient.js';

function createCanvas() {
    const calls = [];
    const dimensions = [];
    const canvas = {
        set width(value) { this.canvasWidth = value; dimensions.push([value, this.canvasHeight || 0]); },
        get width() { return this.canvasWidth || 0; },
        set height(value) { this.canvasHeight = value; dimensions.push([this.canvasWidth || 0, value]); },
        get height() { return this.canvasHeight || 0; },
        getContext: () => ({ drawImage: (...args) => calls.push(args), clearRect() {} }),
        toBlob(callback, type) { callback(new Blob(['bounded'], { type })); }
    };
    return { canvas, calls, dimensions };
}

test('image preparation respects decoded orientation dimensions and bounds the OCR image', async () => {
    const { canvas, calls, dimensions } = createCanvas();
    const bitmap = { width: 4400, height: 2200, closed: false, close() { this.closed = true; } };
    const source = new Blob(['original'], { type: 'image/png' });
    let decodeOptions;
    const prepared = await preparePassportImage(source, {
        createImageBitmapImpl: async (_source, options) => { decodeOptions = options; return bitmap; },
        createCanvasImpl: () => canvas
    });

    assert.ok(dimensions.some(([width, height]) => width === 2200 && height === 1100));
    assert.equal(prepared.type, 'image/jpeg');
    assert.deepEqual(calls[0].slice(1), [0, 0, 2200, 1100]);
    assert.equal(bitmap.closed, true);
    assert.deepEqual(decodeOptions, { imageOrientation: 'from-image' });
    assert.equal(canvas.width, 0);
    assert.equal(canvas.height, 0);
});

test('JPEG, PNG, and WebP sources each prepare one supported bounded OCR image', async () => {
    for (const mediaType of ['image/jpeg', 'image/png', 'image/webp']) {
        const bitmap = { width: 900, height: 1200, close() {} };
        const prepared = await preparePassportImage(new Blob(['original'], { type: mediaType }), {
            createImageBitmapImpl: async () => bitmap,
            createCanvasImpl: () => createCanvas().canvas
        });
        assert.equal(prepared.type, 'image/jpeg');
    }
});

test('oversized prepared images are recompressed before the 10 MiB server limit', async () => {
    let encodeCalls = 0;
    const makeCanvas = () => ({
        width: 2200,
        height: 1600,
        getContext: () => ({ drawImage() {}, clearRect() {} }),
        toBlob(callback, type, quality) {
            encodeCalls += 1;
            const size = quality > 0.8 ? 11 * 1024 * 1024 : 4 * 1024 * 1024;
            callback(new Blob([new Uint8Array(size)], { type }));
        }
    });
    const prepared = await preparePassportImage(new Blob(['original'], { type: 'image/jpeg' }), {
        createImageBitmapImpl: async () => ({ width: 2200, height: 1600, close() {} }),
        createCanvasImpl: makeCanvas
    });

    assert.equal(encodeCalls, 2);
    assert.ok(prepared.size <= 10 * 1024 * 1024);
});

test('PDF OCR loads page one first and page two only when page one has no fields', async () => {
    const renderCalls = [];
    const recognizeCalls = [];
    const optionsSeen = [];
    let wasDestroyed = false;
    let cleanupCount = 0;
    const pdf = {
        numPages: 4,
        async getPage(pageNumber) {
            renderCalls.push(pageNumber);
            return {
                getViewport: () => ({ width: 1200, height: 1600 }),
                cleanup() { cleanupCount += 1; },
                render: () => ({ promise: Promise.resolve() })
            };
        },
        async destroy() { wasDestroyed = true; }
    };
    const source = new Blob(['pdf'], { type: 'application/pdf' });

    const result = await recognizePassportSource(source, async (image) => {
        recognizeCalls.push(image.type);
        if (recognizeCalls.length === 1) throw Object.assign(new Error('empty'), { code: 'OCR_NO_PASSPORT_FIELDS' });
        return { passport_number: 'P123' };
    }, {
        loadPdfjsImpl: async () => ({ getDocument(options) {
            optionsSeen.push(options);
            return { promise: Promise.resolve(pdf) };
        } }),
        createCanvasImpl: () => createCanvas().canvas
    });

    assert.deepEqual(result, { passport_number: 'P123' });
    assert.deepEqual(renderCalls, [1, 2]);
    assert.deepEqual(recognizeCalls, ['image/jpeg', 'image/jpeg']);
    assert.equal(optionsSeen[0].isEvalSupported, false);
    assert.equal(optionsSeen[0].cMapUrl, `/pdfjs-support/${PDFJS_VERSION}/cmaps/`);
    assert.equal(optionsSeen[0].standardFontDataUrl, `/pdfjs-support/${PDFJS_VERSION}/standard_fonts/`);
    assert.equal(wasDestroyed, true);
    assert.equal(cleanupCount, 2);
});

test('PDF OCR stops after useful page one candidates and never renders later pages', async () => {
    const renderCalls = [];
    let wasDestroyed = false;
    const pdf = {
        numPages: 5,
        async getPage(pageNumber) {
            renderCalls.push(pageNumber);
            return { getViewport: () => ({ width: 1000, height: 1000 }), render: () => ({ promise: Promise.resolve() }) };
        },
        async destroy() { wasDestroyed = true; }
    };
    const result = await recognizePassportSource(new Blob(['pdf'], { type: 'application/pdf' }), async () => ({ first_name: 'ADA' }), {
        loadPdfjsImpl: async () => ({ getDocument: () => ({ promise: Promise.resolve(pdf) }) }),
        createCanvasImpl: () => createCanvas().canvas
    });

    assert.deepEqual(result, { first_name: 'ADA' });
    assert.deepEqual(renderCalls, [1]);
    assert.equal(wasDestroyed, true);
});
