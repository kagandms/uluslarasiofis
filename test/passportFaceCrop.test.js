import assert from 'node:assert/strict';
import test from 'node:test';
import { detectFaceCrop } from '../src/services/passportFaceCrop.js';

const FAKE_DATA_URL = 'data:image/jpeg;base64,ZmFrZQ==';

function createFakeLoader(width, height) {
    return async () => ({ width, height, source: { width, height } });
}

function createFakeDetector(faces) {
    return {
        async detect() {
            return faces;
        }
    };
}

test('detectFaceCrop returns an integer head-and-shoulders box within image bounds matching aspectRatio within 2%', async () => {
    const aspectRatio = 35 / 45;
    const result = await detectFaceCrop(FAKE_DATA_URL, aspectRatio, {
        loadImage: createFakeLoader(1000, 1400),
        detector: createFakeDetector([
            { boundingBox: { x: 200, y: 300, width: 150, height: 180 } }
        ])
    });

    assert.equal('error' in result, false);
    assert.equal(Number.isInteger(result.x), true);
    assert.equal(Number.isInteger(result.y), true);
    assert.equal(Number.isInteger(result.width), true);
    assert.equal(Number.isInteger(result.height), true);

    assert.ok(result.x >= 0);
    assert.ok(result.y >= 0);
    assert.ok(result.x + result.width <= 1000);
    assert.ok(result.y + result.height <= 1400);

    // Expanded around the face for head + shoulders
    assert.ok(result.width > 150);
    assert.ok(result.height > 180);
    assert.ok(result.y < 300);

    const actualRatio = result.width / result.height;
    const relativeDiff = Math.abs(actualRatio - aspectRatio) / aspectRatio;
    assert.ok(relativeDiff <= 0.02, `Expected ratio ${actualRatio} within 2% of ${aspectRatio}`);
});

test('detectFaceCrop clamps and shrinks box inside small image bounds while preserving aspectRatio', async () => {
    const aspectRatio = 3 / 4;
    const result = await detectFaceCrop(FAKE_DATA_URL, aspectRatio, {
        loadImage: createFakeLoader(300, 250),
        detector: createFakeDetector([
            { boundingBox: { x: 20, y: 15, width: 200, height: 180 } }
        ])
    });

    assert.equal('error' in result, false);
    assert.equal(Number.isInteger(result.x), true);
    assert.equal(Number.isInteger(result.y), true);
    assert.equal(Number.isInteger(result.width), true);
    assert.equal(Number.isInteger(result.height), true);

    assert.ok(result.x >= 0);
    assert.ok(result.y >= 0);
    assert.ok(result.width > 0);
    assert.ok(result.height > 0);
    assert.ok(result.x + result.width <= 300);
    assert.ok(result.y + result.height <= 250);

    const actualRatio = result.width / result.height;
    const relativeDiff = Math.abs(actualRatio - aspectRatio) / aspectRatio;
    assert.ok(relativeDiff <= 0.02, `Expected ratio ${actualRatio} within 2% of ${aspectRatio}`);
});

test('detectFaceCrop returns no-face when detector finds zero faces', async () => {
    const result = await detectFaceCrop(FAKE_DATA_URL, 35 / 45, {
        loadImage: createFakeLoader(800, 1000),
        detector: createFakeDetector([])
    });

    assert.deepEqual(result, { error: 'no-face' });
});

test('detectFaceCrop returns multiple-faces when detector finds two or more faces', async () => {
    const result = await detectFaceCrop(FAKE_DATA_URL, 35 / 45, {
        loadImage: createFakeLoader(800, 1000),
        detector: createFakeDetector([
            { boundingBox: { x: 100, y: 100, width: 100, height: 120 } },
            { boundingBox: { x: 400, y: 100, width: 100, height: 120 } }
        ])
    });

    assert.deepEqual(result, { error: 'multiple-faces' });
});

test('detectFaceCrop ignores smaller ghost portrait when largest face area is at least 2.5x second largest', async () => {
    const aspectRatio = 35 / 45;
    const largeFace = { x: 150, y: 300, width: 160, height: 200 }; // area = 32000
    const ghostFace = { x: 750, y: 900, width: 80, height: 100 };  // area = 8000 (ratio = 4)

    const result = await detectFaceCrop(FAKE_DATA_URL, aspectRatio, {
        loadImage: createFakeLoader(1000, 1400),
        detector: createFakeDetector([
            { boundingBox: ghostFace },
            { boundingBox: largeFace }
        ])
    });

    assert.equal('error' in result, false);
    assert.ok(result.x <= largeFace.x);
    assert.ok(result.x + result.width >= largeFace.x + largeFace.width);
    assert.ok(result.y <= largeFace.y);
    assert.ok(result.y + result.height >= largeFace.y + largeFace.height);
    assert.ok(result.x + result.width < ghostFace.x);

    const actualRatio = result.width / result.height;
    const relativeDiff = Math.abs(actualRatio - aspectRatio) / aspectRatio;
    assert.ok(relativeDiff <= 0.02, `Expected ratio ${actualRatio} within 2% of ${aspectRatio}`);
});

test('detectFaceCrop returns multiple-faces when two faces have similar sizes (area ratio 1.3)', async () => {
    const result = await detectFaceCrop(FAKE_DATA_URL, 35 / 45, {
        loadImage: createFakeLoader(1000, 1400),
        detector: createFakeDetector([
            { boundingBox: { x: 100, y: 200, width: 130, height: 100 } }, // area = 13000
            { boundingBox: { x: 400, y: 200, width: 100, height: 100 } }  // area = 10000 (ratio = 1.3)
        ])
    });

    assert.deepEqual(result, { error: 'multiple-faces' });
});

test('detectFaceCrop returns unavailable when no detector is available', async () => {
    const result = await detectFaceCrop(FAKE_DATA_URL, 35 / 45, {
        loadImage: createFakeLoader(800, 1000),
        detector: null
    });

    assert.deepEqual(result, { error: 'unavailable' });
});

test('detectFaceCrop returns unavailable when detector or image loader throws', async () => {
    const detectorError = await detectFaceCrop(FAKE_DATA_URL, 35 / 45, {
        loadImage: createFakeLoader(800, 1000),
        detector: {
            async detect() {
                throw new Error('detector failed');
            }
        }
    });
    assert.deepEqual(detectorError, { error: 'unavailable' });

    const loaderError = await detectFaceCrop(FAKE_DATA_URL, 35 / 45, {
        loadImage: async () => {
            throw new Error('image failed');
        },
        detector: createFakeDetector([
            { boundingBox: { x: 100, y: 100, width: 100, height: 120 } }
        ])
    });
    assert.deepEqual(loaderError, { error: 'unavailable' });
});

test('detectFaceCrop prefers global FaceDetector over fallback MediaPipe detector when available', async () => {
    const originalFaceDetector = globalThis.FaceDetector;
    let globalDetectCalls = 0;
    let fallbackCalls = 0;

    globalThis.FaceDetector = class FakeGlobalFaceDetector {
        async detect() {
            globalDetectCalls += 1;
            return [{ boundingBox: { x: 200, y: 300, width: 150, height: 180 } }];
        }
    };

    try {
        const result = await detectFaceCrop(FAKE_DATA_URL, 35 / 45, {
            loadImage: createFakeLoader(1000, 1400),
            loadFallbackDetector: async () => {
                fallbackCalls += 1;
                return createFakeDetector([
                    { boundingBox: { x: 10, y: 10, width: 50, height: 50 } }
                ]);
            }
        });

        assert.equal('error' in result, false);
        assert.equal(globalDetectCalls, 1);
        assert.equal(fallbackCalls, 0);
    } finally {
        if (originalFaceDetector === undefined) {
            delete globalThis.FaceDetector;
        } else {
            globalThis.FaceDetector = originalFaceDetector;
        }
    }
});

test('detectFaceCrop falls back to shared MediaPipe detector when global FaceDetector is absent', async () => {
    const originalFaceDetector = globalThis.FaceDetector;
    let fallbackCalls = 0;
    delete globalThis.FaceDetector;

    try {
        const result = await detectFaceCrop(FAKE_DATA_URL, 35 / 45, {
            loadImage: createFakeLoader(1000, 1400),
            loadFallbackDetector: async () => {
                fallbackCalls += 1;
                return createFakeDetector([
                    { boundingBox: { x: 200, y: 300, width: 150, height: 180 }, score: 0.96 }
                ]);
            }
        });

        assert.equal('error' in result, false);
        assert.equal(fallbackCalls, 1);
        assert.equal(Number.isInteger(result.x), true);
        assert.equal(Number.isInteger(result.y), true);
        assert.equal(Number.isInteger(result.width), true);
        assert.equal(Number.isInteger(result.height), true);
    } finally {
        if (originalFaceDetector !== undefined) {
            globalThis.FaceDetector = originalFaceDetector;
        }
    }
});

test('detectFaceCrop returns unavailable when fallback MediaPipe detector fails to load or initialize', async () => {
    const originalFaceDetector = globalThis.FaceDetector;
    delete globalThis.FaceDetector;

    try {
        const loadFailure = await detectFaceCrop(FAKE_DATA_URL, 35 / 45, {
            loadImage: createFakeLoader(1000, 1400),
            loadFallbackDetector: async () => {
                throw new Error('mediapipe import failed');
            }
        });
        assert.deepEqual(loadFailure, { error: 'unavailable' });

        const initFailure = await detectFaceCrop(FAKE_DATA_URL, 35 / 45, {
            loadImage: createFakeLoader(1000, 1400),
            loadFallbackDetector: async () => ({
                async detect() {
                    throw new Error('wasm init failed');
                }
            })
        });
        assert.deepEqual(initFailure, { error: 'unavailable' });
    } finally {
        if (originalFaceDetector !== undefined) {
            globalThis.FaceDetector = originalFaceDetector;
        }
    }
});
