/**
 * @fileoverview Self-hosted MediaPipe yüz algılayıcı ve derleme/başlık kaynak sözleşmesi testleri.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    MEDIAPIPE_SUPPORT_URL,
    MEDIAPIPE_TASKS_VISION_VERSION
} from '../src/config/mediapipe-version.js';
import {
    createMediapipeFaceDetector,
    getSharedMediapipeFaceDetector
} from '../src/services/mediapipeFaceDetector.js';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function createFakeVisionFactory({
    detections = [],
    onForVisionTasks = () => {},
    onCreateFromOptions = () => {},
    onClose = () => {}
} = {}) {
    let loadCount = 0;
    let closeCount = 0;
    const calls = {
        wasmBaseUrls: [],
        createOptions: [],
        detectedSources: []
    };

    const loadVision = async () => {
        loadCount += 1;
        return {
            FilesetResolver: {
                async forVisionTasks(wasmBaseUrl) {
                    calls.wasmBaseUrls.push(wasmBaseUrl);
                    onForVisionTasks(wasmBaseUrl);
                    return {
                        wasmLoaderPath: `${wasmBaseUrl}/vision_wasm_internal.js`,
                        wasmBinaryPath: `${wasmBaseUrl}/vision_wasm_internal.wasm`
                    };
                }
            },
            FaceDetector: {
                async createFromOptions(fileset, options) {
                    calls.createOptions.push({ fileset, options });
                    onCreateFromOptions(fileset, options);
                    return {
                        detect(imageSource) {
                            calls.detectedSources.push(imageSource);
                            return { detections };
                        },
                        close() {
                            closeCount += 1;
                            onClose();
                        }
                    };
                }
            }
        };
    };

    return {
        loadVision,
        calls,
        getLoadCount: () => loadCount,
        getCloseCount: () => closeCount
    };
}

test('mediapipe-version exports pinned version and self-hosted support URL', () => {
    assert.equal(MEDIAPIPE_TASKS_VISION_VERSION, '1.2.2');
    assert.equal(MEDIAPIPE_SUPPORT_URL, '/mediapipe-support/1.2.2');
});

test('createMediapipeFaceDetector converts MediaPipe boxes and builds wasm/model URLs from MEDIAPIPE_SUPPORT_URL', async () => {
    const fake = createFakeVisionFactory({
        detections: [
            {
                boundingBox: { originX: 120, originY: 80, width: 140, height: 160, angle: 0 },
                categories: [{ score: 0.94, index: 0, categoryName: '', displayName: '' }]
            },
            {
                boundingBox: { originX: 400, originY: 220, width: 50, height: 60 },
                categories: []
            },
            {
                boundingBox: null,
                categories: [{ score: 0.5 }]
            }
        ]
    });

    const detector = createMediapipeFaceDetector({ loadVision: fake.loadVision });
    assert.equal(fake.getLoadCount(), 0, 'MediaPipe must stay lazy until detect() is called');

    const fakeImage = { width: 800, height: 1000 };
    const faces = await detector.detect(fakeImage);

    assert.equal(fake.getLoadCount(), 1);
    assert.deepEqual(fake.calls.wasmBaseUrls, [`${MEDIAPIPE_SUPPORT_URL}/wasm`]);
    assert.equal(fake.calls.createOptions.length, 1);
    assert.deepEqual(fake.calls.createOptions[0].options, {
        baseOptions: {
            modelAssetPath: `${MEDIAPIPE_SUPPORT_URL}/models/blaze_face_short_range.tflite`,
            delegate: 'CPU'
        },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.5
    });
    assert.deepEqual(fake.calls.detectedSources, [fakeImage]);

    assert.deepEqual(faces, [
        { boundingBox: { x: 120, y: 80, width: 140, height: 160 }, score: 0.94 },
        { boundingBox: { x: 400, y: 220, width: 50, height: 60 }, score: 0 }
    ]);
});

test('createMediapipeFaceDetector initializes only once across concurrent and sequential detect calls', async () => {
    const fake = createFakeVisionFactory({
        detections: [
            {
                boundingBox: { originX: 10, originY: 20, width: 100, height: 120 },
                categories: [{ score: 0.88 }]
            }
        ]
    });

    const detector = createMediapipeFaceDetector({
        loadVision: fake.loadVision,
        baseUrl: '/custom-mp/'
    });

    const [first, second] = await Promise.all([
        detector.detect({ id: 1 }),
        detector.detect({ id: 2 })
    ]);
    const third = await detector.detect({ id: 3 });

    assert.equal(fake.getLoadCount(), 1);
    assert.deepEqual(fake.calls.wasmBaseUrls, ['/custom-mp/wasm']);
    assert.equal(
        fake.calls.createOptions[0].options.baseOptions.modelAssetPath,
        '/custom-mp/models/blaze_face_short_range.tflite'
    );
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(third.length, 1);
});

test('createMediapipeFaceDetector resets cached init promise on failure so subsequent calls retry', async () => {
    let attempts = 0;
    const fake = createFakeVisionFactory({
        detections: [
            {
                boundingBox: { originX: 50, originY: 60, width: 90, height: 110 },
                categories: [{ score: 0.91 }]
            }
        ]
    });

    const detector = createMediapipeFaceDetector({
        loadVision: async () => {
            attempts += 1;
            if (attempts === 1) {
                throw new Error('wasm load failed');
            }
            return fake.loadVision();
        }
    });

    await assert.rejects(() => detector.detect({ id: 'first' }), /wasm load failed/);
    const faces = await detector.detect({ id: 'second' });

    assert.equal(attempts, 2);
    assert.deepEqual(faces, [
        { boundingBox: { x: 50, y: 60, width: 90, height: 110 }, score: 0.91 }
    ]);
});

test('createMediapipeFaceDetector close releases underlying detector and allows clean re-init', async () => {
    const fake = createFakeVisionFactory({
        detections: [
            {
                boundingBox: { originX: 15, originY: 25, width: 70, height: 80 },
                categories: [{ score: 0.85 }]
            }
        ]
    });

    const detector = createMediapipeFaceDetector({ loadVision: fake.loadVision });
    detector.close(); // no-op before init

    await detector.detect({ id: 'a' });
    detector.close();
    await Promise.resolve();

    assert.equal(fake.getCloseCount(), 1);

    await detector.detect({ id: 'b' });
    assert.equal(fake.getLoadCount(), 2);
});

test('getSharedMediapipeFaceDetector returns a single cached instance', () => {
    const first = getSharedMediapipeFaceDetector();
    const second = getSharedMediapipeFaceDetector();

    assert.strictEqual(first, second);
    assert.equal(typeof first.detect, 'function');
    assert.equal(typeof first.close, 'function');
});

test('source contract: vite.config.js serves/emits MediaPipe assets and _headers caches /mediapipe-support/*', () => {
    const viteConfig = readFileSync(resolve(projectRoot, 'vite.config.js'), 'utf8');
    assert.match(viteConfig, /MEDIAPIPE_SUPPORT_URL/);
    assert.match(viteConfig, /vision_wasm_internal\.js/);
    assert.match(viteConfig, /vision_wasm_internal\.wasm/);
    assert.match(viteConfig, /blaze_face_short_range\.tflite/);
    assert.match(viteConfig, /application\/wasm/);
    assert.match(viteConfig, /text\/javascript/);
    assert.match(viteConfig, /application\/octet-stream/);

    const headers = readFileSync(resolve(projectRoot, 'public/_headers'), 'utf8');
    assert.match(
        headers,
        /\/mediapipe-support\/\*\s*\n\s*Cache-Control:\s*public,\s*max-age=31536000,\s*immutable/
    );

    const passportFaceCropSource = readFileSync(
        resolve(projectRoot, 'src/services/passportFaceCrop.js'),
        'utf8'
    );
    assert.doesNotMatch(
        passportFaceCropSource,
        /^\s*import\s+.*(@mediapipe\/tasks-vision|mediapipeFaceDetector)/m,
        'passportFaceCrop.js must not statically import MediaPipe at module top level'
    );
});
