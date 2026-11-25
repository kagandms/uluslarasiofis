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

test('detectFaceCrop tightens 3:4 crop around head and upper shoulders without reaching MRZ area', async () => {
    const aspectRatio = 3 / 4;
    const face = { x: 200, y: 300, width: 150, height: 180 };
    const result = await detectFaceCrop(FAKE_DATA_URL, aspectRatio, {
        loadImage: createFakeLoader(1000, 1400),
        detector: createFakeDetector([{ boundingBox: face }])
    });

    assert.equal('error' in result, false);
    assert.equal(Number.isInteger(result.x), true);
    assert.equal(Number.isInteger(result.y), true);
    assert.equal(Number.isInteger(result.width), true);
    assert.equal(Number.isInteger(result.height), true);

    // Box fully contains the face
    assert.ok(result.x <= face.x);
    assert.ok(result.x + result.width >= face.x + face.width);
    assert.ok(result.y <= face.y);
    assert.ok(result.y + result.height >= face.y + face.height);

    // Horizontally centred on face centre x within 2 px
    const faceCenterX = face.x + face.width / 2;
    const boxCenterX = result.x + result.width / 2;
    assert.ok(Math.abs(boxCenterX - faceCenterX) <= 2);

    // Tight vertical bounds: head + hair top margin, bottom never lower than fy + 1.5*fh
    assert.ok(result.y <= face.y - face.height * 0.3);
    assert.ok(result.y + result.height <= face.y + face.height * 1.5);

    const actualRatio = result.width / result.height;
    const relativeDiff = Math.abs(actualRatio - aspectRatio) / aspectRatio;
    assert.ok(relativeDiff <= 0.02, `Expected ratio ${actualRatio} within 2% of ${aspectRatio}`);
});

test('detectFaceCrop keeps box inside image with face fully inside when face is near top edge', async () => {
    const aspectRatio = 3 / 4;
    const face = { x: 200, y: 15, width: 150, height: 180 };
    const result = await detectFaceCrop(FAKE_DATA_URL, aspectRatio, {
        loadImage: createFakeLoader(1000, 1400),
        detector: createFakeDetector([{ boundingBox: face }])
    });

    assert.equal('error' in result, false);
    assert.ok(result.x >= 0);
    assert.ok(result.y >= 0);
    assert.ok(result.x + result.width <= 1000);
    assert.ok(result.y + result.height <= 1400);

    assert.ok(result.x <= face.x);
    assert.ok(result.x + result.width >= face.x + face.width);
    assert.ok(result.y <= face.y);
    assert.ok(result.y + result.height >= face.y + face.height);

    const actualRatio = result.width / result.height;
    const relativeDiff = Math.abs(actualRatio - aspectRatio) / aspectRatio;
    assert.ok(relativeDiff <= 0.02, `Expected ratio ${actualRatio} within 2% of ${aspectRatio}`);
});

test('detectFaceCrop expands crop width to at least 1.6x face width for wide faces', async () => {
    const aspectRatio = 3 / 4;
    const face = { x: 200, y: 300, width: 216, height: 180 }; // fw = 1.2 * fh
    const result = await detectFaceCrop(FAKE_DATA_URL, aspectRatio, {
        loadImage: createFakeLoader(1000, 1400),
        detector: createFakeDetector([{ boundingBox: face }])
    });

    assert.equal('error' in result, false);
    assert.ok(result.width >= face.width * 1.6);
    assert.ok(result.x <= face.x);
    assert.ok(result.x + result.width >= face.x + face.width);
    assert.ok(result.y <= face.y);
    assert.ok(result.y + result.height >= face.y + face.height);
    assert.ok(result.y + result.height <= face.y + face.height * 1.5);

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

test('detectFaceCrop calls detect once and skips createTileSource when full image has a face', async () => {
    let detectCalls = 0;
    let tileSourceCalls = 0;

    const result = await detectFaceCrop(FAKE_DATA_URL, 35 / 45, {
        loadImage: createFakeLoader(1400, 1000),
        createTileSource() {
            tileSourceCalls += 1;
            return { isTile: true };
        },
        detector: {
            async detect() {
                detectCalls += 1;
                return [{ boundingBox: { x: 200, y: 250, width: 140, height: 180 } }];
            }
        }
    });

    assert.equal('error' in result, false);
    assert.equal(detectCalls, 1);
    assert.equal(tileSourceCalls, 0);
});

test('detectFaceCrop falls back to 2x2 tiles and maps tile coordinates back to full-image crop box', async () => {
    const aspectRatio = 3 / 4;
    const seenRegions = [];
    const expectedFace = { x: 600, y: 360, width: 80, height: 100 };

    const result = await detectFaceCrop(FAKE_DATA_URL, aspectRatio, {
        loadImage: createFakeLoader(900, 600),
        createTileSource(_source, region) {
            seenRegions.push(region);
            return { isTile: true, region };
        },
        detector: {
            async detect(source) {
                if (!source?.isTile) {
                    return [];
                }
                const { sx, sy, scale } = source.region;
                if (sx > 0 && sy > 0) {
                    return [{
                        boundingBox: {
                            x: (expectedFace.x - sx) * scale,
                            y: (expectedFace.y - sy) * scale,
                            width: expectedFace.width * scale,
                            height: expectedFace.height * scale
                        }
                    }];
                }
                return [];
            }
        }
    });

    assert.equal('error' in result, false);
    assert.equal(seenRegions.length, 4);
    assert.ok(seenRegions[3].scale > 1);
    assert.ok(Math.abs(seenRegions[3].scale - 640 / 529) < 1e-6);

    assert.ok(result.x <= expectedFace.x);
    assert.ok(result.x + result.width >= expectedFace.x + expectedFace.width);
    assert.ok(result.y <= expectedFace.y);
    assert.ok(result.y + result.height >= expectedFace.y + expectedFace.height);

    const faceCenterX = expectedFace.x + expectedFace.width / 2;
    const faceCenterY = expectedFace.y + expectedFace.height / 2;
    assert.ok(Math.abs((result.x + result.width / 2) - faceCenterX) <= 2);
    assert.ok(result.y < faceCenterY && faceCenterY < result.y + result.height);
});

test('detectFaceCrop discards tile detections touching an interior border while keeping outer image-edge detections', async () => {
    const interiorOnly = await detectFaceCrop(FAKE_DATA_URL, 3 / 4, {
        loadImage: createFakeLoader(1400, 1000),
        createTileSource(_source, region) {
            return { isTile: true, region };
        },
        detector: {
            async detect(source) {
                if (!source?.isTile) {
                    return [];
                }
                const { sx, sy } = source.region;
                if (sx === 0 && sy === 0) {
                    // Right border of tile (0,0) is interior (824 < 1400); x + width = 820 is within 2%
                    return [{ boundingBox: { x: 750, y: 150, width: 70, height: 90 } }];
                }
                return [];
            }
        }
    });
    assert.deepEqual(interiorOnly, { error: 'no-face' });

    const outerBorderFace = { x: 2, y: 150, width: 70, height: 90 };
    const keptOuterEdge = await detectFaceCrop(FAKE_DATA_URL, 3 / 4, {
        loadImage: createFakeLoader(1400, 1000),
        createTileSource(_source, region) {
            return { isTile: true, region };
        },
        detector: {
            async detect(source) {
                if (!source?.isTile) {
                    return [];
                }
                const { sx, sy } = source.region;
                if (sx === 0 && sy === 0) {
                    return [{ boundingBox: outerBorderFace }];
                }
                return [];
            }
        }
    });
    assert.equal('error' in keptOuterEdge, false);
    assert.ok(keptOuterEdge.x <= outerBorderFace.x);
    assert.ok(keptOuterEdge.x + keptOuterEdge.width >= outerBorderFace.x + outerBorderFace.width);
});

test('detectFaceCrop merges duplicate detections of the same face across overlapping tiles', async () => {
    const result = await detectFaceCrop(FAKE_DATA_URL, 3 / 4, {
        loadImage: createFakeLoader(1400, 1000),
        createTileSource(_source, region) {
            return { isTile: true, region };
        },
        detector: {
            async detect(source) {
                if (!source?.isTile) {
                    return [];
                }
                const { sx, sy } = source.region;
                if (sx === 0 && sy === 0) {
                    return [{ boundingBox: { x: 650, y: 200, width: 90, height: 110 } }];
                }
                if (sx > 0 && sy === 0) {
                    return [{ boundingBox: { x: 654 - sx, y: 202, width: 84, height: 106 } }];
                }
                return [];
            }
        }
    });

    assert.equal('error' in result, false);
    assert.ok(result.x <= 650);
    assert.ok(result.x + result.width >= 740);
    assert.ok(Math.abs((result.x + result.width / 2) - 695) <= 2);
});

test('detectFaceCrop returns no-face when no 2x2 or 3x3 tile finds a face (at most 13 fallback detect calls)', async () => {
    let detectCalls = 0;

    const result = await detectFaceCrop(FAKE_DATA_URL, 35 / 45, {
        loadImage: createFakeLoader(1400, 1000),
        createTileSource(_source, region) {
            return { isTile: true, region };
        },
        detector: {
            async detect() {
                detectCalls += 1;
                return [];
            }
        }
    });

    assert.deepEqual(result, { error: 'no-face' });
    assert.equal(detectCalls, 14);
});

test('detectFaceCrop skips tile fallback and returns no-face when createTileSource and canvas API are absent', async () => {
    const originalOffscreenCanvas = globalThis.OffscreenCanvas;
    const originalDocument = globalThis.document;
    delete globalThis.OffscreenCanvas;
    delete globalThis.document;

    let detectCalls = 0;
    try {
        const result = await detectFaceCrop(FAKE_DATA_URL, 35 / 45, {
            loadImage: createFakeLoader(1400, 1000),
            detector: {
                async detect() {
                    detectCalls += 1;
                    return [];
                }
            }
        });

        assert.deepEqual(result, { error: 'no-face' });
        assert.equal(detectCalls, 1);
    } finally {
        if (originalOffscreenCanvas !== undefined) {
            globalThis.OffscreenCanvas = originalOffscreenCanvas;
        }
        if (originalDocument !== undefined) {
            globalThis.document = originalDocument;
        }
    }
});

test('detectFaceCrop selects the larger real face over a smaller ghost portrait in tiles', async () => {
    const realFace = { x: 180, y: 200, width: 120, height: 150 };
    const ghostFace = { x: 950, y: 700, width: 50, height: 60 };

    const result = await detectFaceCrop(FAKE_DATA_URL, 35 / 45, {
        loadImage: createFakeLoader(1400, 1000),
        createTileSource(_source, region) {
            return { isTile: true, region };
        },
        detector: {
            async detect(source) {
                if (!source?.isTile) {
                    return [];
                }
                const { sx, sy } = source.region;
                if (sx === 0 && sy === 0) {
                    return [{ boundingBox: realFace }];
                }
                if (sx > 0 && sy > 0) {
                    return [{
                        boundingBox: {
                            x: ghostFace.x - sx,
                            y: ghostFace.y - sy,
                            width: ghostFace.width,
                            height: ghostFace.height
                        }
                    }];
                }
                return [];
            }
        }
    });

    assert.equal('error' in result, false);
    assert.ok(result.x <= realFace.x);
    assert.ok(result.x + result.width >= realFace.x + realFace.width);
    assert.ok(result.y <= realFace.y);
    assert.ok(result.y + result.height >= realFace.y + realFace.height);
    assert.ok(result.x + result.width < ghostFace.x);
});

test('detectFaceCrop falls back to 3x3 grid and caps tile upscaling at 3x', async () => {
    const seenRegions = [];
    const smallFace = { x: 160, y: 95, width: 40, height: 50 };

    const result = await detectFaceCrop(FAKE_DATA_URL, 3 / 4, {
        loadImage: createFakeLoader(360, 240),
        createTileSource(_source, region) {
            seenRegions.push(region);
            return { isTile: true, region };
        },
        detector: {
            async detect(source) {
                if (!source?.isTile) {
                    return [];
                }
                // Only match the center 3x3 tile (sw === 150)
                const { sx, sy, sw, scale } = source.region;
                if (sw === 150 && sx > 0 && sy > 0 && sx + sw < 360) {
                    return [{
                        boundingBox: {
                            x: (smallFace.x - sx) * scale,
                            y: (smallFace.y - sy) * scale,
                            width: smallFace.width * scale,
                            height: smallFace.height * scale
                        }
                    }];
                }
                return [];
            }
        }
    });

    assert.equal('error' in result, false);
    assert.equal(seenRegions.length, 13);
    assert.ok(seenRegions.every((region) => region.scale <= 3));
    assert.ok(result.x <= smallFace.x);
    assert.ok(result.x + result.width >= smallFace.x + smallFace.width);
    assert.ok(result.y <= smallFace.y);
    assert.ok(result.y + result.height >= smallFace.y + smallFace.height);
});

test('detectFaceCrop returns unavailable when tile fallback throws', async () => {
    const result = await detectFaceCrop(FAKE_DATA_URL, 35 / 45, {
        loadImage: createFakeLoader(1400, 1000),
        createTileSource() {
            throw new Error('tile render failed');
        },
        detector: createFakeDetector([])
    });

    assert.deepEqual(result, { error: 'unavailable' });
});

test('detectFaceCrop uses default OffscreenCanvas tile creator and frees canvas size afterwards', async () => {
    const originalOffscreenCanvas = globalThis.OffscreenCanvas;
    const createdCanvases = [];
    const drawCalls = [];

    globalThis.OffscreenCanvas = class FakeOffscreenCanvas {
        constructor(width, height) {
            this.width = width;
            this.height = height;
            createdCanvases.push(this);
        }

        getContext(type) {
            if (type !== '2d') {
                return null;
            }
            return {
                drawImage(...args) {
                    drawCalls.push(args);
                }
            };
        }
    };

    try {
        const result = await detectFaceCrop(FAKE_DATA_URL, 3 / 4, {
            loadImage: createFakeLoader(1400, 1000),
            detector: {
                async detect(source) {
                    if (!(source instanceof globalThis.OffscreenCanvas)) {
                        return [];
                    }
                    if (createdCanvases.length === 1) {
                        return [{ boundingBox: { x: 120, y: 150, width: 100, height: 120 } }];
                    }
                    return [];
                }
            }
        });

        assert.equal('error' in result, false);
        assert.equal(createdCanvases.length, 4);
        assert.equal(drawCalls.length, 4);
        assert.ok(createdCanvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
    } finally {
        if (originalOffscreenCanvas === undefined) {
            delete globalThis.OffscreenCanvas;
        } else {
            globalThis.OffscreenCanvas = originalOffscreenCanvas;
        }
    }
});

test('detectFaceCrop with tryRotations finds face only visible in 90-rotated fake source in rotated coordinates', async () => {
    const aspectRatio = 3 / 4;
    const seenRotations = [];
    // Original is 1400x1000 (landscape); rotated 90° becomes 1000x1400 (portrait)
    const rotatedFace = { x: 200, y: 300, width: 140, height: 180 };

    const result = await detectFaceCrop(FAKE_DATA_URL, aspectRatio, {
        tryRotations: true,
        loadImage: createFakeLoader(1400, 1000),
        createRotatedSource(_source, degrees) {
            seenRotations.push(degrees);
            return { isRotated: true, degrees };
        },
        detector: {
            async detect(source) {
                if (source?.isRotated && source.degrees === 90) {
                    return [{ boundingBox: rotatedFace, score: 0.92 }];
                }
                return [];
            }
        }
    });

    assert.deepEqual(seenRotations, [90, 270, 180]);
    assert.equal('error' in result, false);
    assert.equal(result.rotation, 90);
    assert.ok(result.x <= rotatedFace.x);
    assert.ok(result.x + result.width >= rotatedFace.x + rotatedFace.width);
    assert.ok(result.y <= rotatedFace.y);
    assert.ok(result.y + result.height >= rotatedFace.y + rotatedFace.height);
    assert.ok(result.x + result.width <= 1000);
    assert.ok(result.y + result.height <= 1400);
});

test('detectFaceCrop with tryRotations finds face only visible at 180 degrees', async () => {
    const rotatedFace = { x: 180, y: 240, width: 120, height: 150 };

    const result = await detectFaceCrop(FAKE_DATA_URL, 35 / 45, {
        tryRotations: true,
        loadImage: createFakeLoader(1000, 1400),
        createRotatedSource(_source, degrees) {
            return { isRotated: true, degrees };
        },
        detector: {
            async detect(source) {
                if (source?.isRotated && source.degrees === 180) {
                    return [{ boundingBox: rotatedFace, score: 0.88 }];
                }
                return [];
            }
        }
    });

    assert.equal('error' in result, false);
    assert.equal(result.rotation, 180);
    assert.ok(result.x <= rotatedFace.x);
    assert.ok(result.x + result.width >= rotatedFace.x + rotatedFace.width);
});

test('detectFaceCrop with tryRotations picks highest detector score across rotations and breaks ties by larger area', async () => {
    const scoreWinner = await detectFaceCrop(FAKE_DATA_URL, 3 / 4, {
        tryRotations: true,
        loadImage: createFakeLoader(1000, 1400),
        createRotatedSource(_source, degrees) {
            return { isRotated: true, degrees };
        },
        detector: {
            async detect(source) {
                if (!source?.isRotated) return [];
                if (source.degrees === 90) {
                    return [{ boundingBox: { x: 100, y: 100, width: 180, height: 220 }, score: 0.62 }];
                }
                if (source.degrees === 270) {
                    return [{ boundingBox: { x: 200, y: 220, width: 120, height: 150 }, score: 0.95 }];
                }
                if (source.degrees === 180) {
                    return [{ boundingBox: { x: 150, y: 150, width: 130, height: 160 }, score: 0.81 }];
                }
                return [];
            }
        }
    });
    assert.equal(scoreWinner.rotation, 270);

    const areaTieWinner = await detectFaceCrop(FAKE_DATA_URL, 3 / 4, {
        tryRotations: true,
        loadImage: createFakeLoader(1000, 1400),
        createRotatedSource(_source, degrees) {
            return { isRotated: true, degrees };
        },
        detector: {
            async detect(source) {
                if (!source?.isRotated) return [];
                if (source.degrees === 90) {
                    return [{ boundingBox: { x: 100, y: 100, width: 80, height: 100 }, score: 0.9 }];
                }
                if (source.degrees === 180) {
                    return [{ boundingBox: { x: 200, y: 220, width: 160, height: 200 }, score: 0.9 }];
                }
                return [];
            }
        }
    });
    assert.equal(areaTieWinner.rotation, 180);
});

test('detectFaceCrop with tryRotations falls back to tiles per rotation and stops at first hit', async () => {
    const tileRotationsSeen = [];
    const tileFace = { x: 120, y: 150, width: 90, height: 110 };

    const result = await detectFaceCrop(FAKE_DATA_URL, 3 / 4, {
        tryRotations: true,
        loadImage: createFakeLoader(1400, 1000),
        createRotatedSource(_source, degrees) {
            return { isRotated: true, degrees };
        },
        createTileSource(source, region) {
            if (source?.isRotated) {
                tileRotationsSeen.push(source.degrees);
            }
            return { isTile: true, degrees: source?.degrees, region };
        },
        detector: {
            async detect(source) {
                if (source?.isTile && source.degrees === 270 && source.region.sx === 0 && source.region.sy === 0) {
                    return [{
                        boundingBox: {
                            x: tileFace.x * source.region.scale,
                            y: tileFace.y * source.region.scale,
                            width: tileFace.width * source.region.scale,
                            height: tileFace.height * source.region.scale
                        }
                    }];
                }
                return [];
            }
        }
    });

    assert.equal('error' in result, false);
    assert.equal(result.rotation, 270);
    // 90° ran all 13 tiles (2x2 + 3x3), 270° stopped after 2x2 (4 tiles), 180° never ran tiles
    assert.equal(tileRotationsSeen.includes(90), true);
    assert.equal(tileRotationsSeen.includes(270), true);
    assert.equal(tileRotationsSeen.includes(180), false);
});

test('detectFaceCrop with tryRotations returns no-face when no rotation finds a face and caps detector calls', async () => {
    let detectCalls = 0;

    const result = await detectFaceCrop(FAKE_DATA_URL, 35 / 45, {
        tryRotations: true,
        loadImage: createFakeLoader(1400, 1000),
        createRotatedSource(_source, degrees) {
            return { isRotated: true, degrees };
        },
        createTileSource(_source, region) {
            return { isTile: true, region };
        },
        detector: {
            async detect() {
                detectCalls += 1;
                return [];
            }
        }
    });

    assert.deepEqual(result, { error: 'no-face' });
    // 1 upright full + 13 upright tiles + 3 rotated full + 3*13 rotated tiles = 56 total
    assert.equal(detectCalls, 56);
});

test('detectFaceCrop with tryRotations evaluates all 4 orientations without extra createRotatedSource calls and omits rotation on strong upright hit', async () => {
    let fullRotateCalls = 0;
    let detectCalls = 0;
    let tileCalls = 0;
    const seenRotations = [];

    const fullUpright = await detectFaceCrop(FAKE_DATA_URL, 3 / 4, {
        tryRotations: true,
        loadImage: createFakeLoader(1000, 1400),
        createRotatedSource(_source, degrees) {
            fullRotateCalls += 1;
            seenRotations.push(degrees);
            return { isRotated: true, degrees };
        },
        createTileSource() {
            tileCalls += 1;
            return { isTile: true };
        },
        detector: {
            async detect(source) {
                detectCalls += 1;
                if (!source?.isRotated) {
                    return [{ boundingBox: { x: 200, y: 300, width: 150, height: 180 }, score: 0.96 }];
                }
                if (source.degrees === 90) {
                    return [{ boundingBox: { x: 180, y: 240, width: 140, height: 170 }, score: 0.55 }];
                }
                return [];
            }
        }
    });
    assert.equal('error' in fullUpright, false);
    assert.equal('rotation' in fullUpright, false);
    assert.deepEqual(seenRotations, [90, 270, 180]);
    assert.equal(fullRotateCalls, 3);
    assert.equal(detectCalls, 4);
    assert.equal(tileCalls, 0);

    let tileRotateCalls = 0;
    const tileUpright = await detectFaceCrop(FAKE_DATA_URL, 3 / 4, {
        tryRotations: true,
        loadImage: createFakeLoader(1000, 1400),
        createRotatedSource(_source, degrees) {
            tileRotateCalls += 1;
            return { isRotated: true, degrees };
        },
        createTileSource(source, region) {
            return { isTile: true, isRotated: Boolean(source?.isRotated), region };
        },
        detector: {
            async detect(source) {
                if (source?.isTile && !source.isRotated && source.region.sx === 0 && source.region.sy === 0) {
                    return [{ boundingBox: { x: 100, y: 120, width: 80, height: 100 } }];
                }
                return [];
            }
        }
    });
    assert.equal('error' in tileUpright, false);
    assert.equal('rotation' in tileUpright, false);
    assert.equal(tileRotateCalls, 3);
});

test('detectFaceCrop with tryRotations chooses 90 when 0 has a low-score sideways face and 90 has a high-score upright face', async () => {
    let rotateCalls = 0;
    let detectCalls = 0;
    const rotatedFace = { x: 200, y: 300, width: 140, height: 180 };

    const result = await detectFaceCrop(FAKE_DATA_URL, 3 / 4, {
        tryRotations: true,
        loadImage: createFakeLoader(1400, 1000),
        createRotatedSource(_source, degrees) {
            rotateCalls += 1;
            return { isRotated: true, degrees };
        },
        detector: {
            async detect(source) {
                detectCalls += 1;
                if (!source?.isRotated) {
                    return [{ boundingBox: { x: 400, y: 200, width: 140, height: 140 }, score: 0.52 }];
                }
                if (source.degrees === 90) {
                    return [{ boundingBox: rotatedFace, score: 0.94 }];
                }
                return [];
            }
        }
    });

    assert.equal('error' in result, false);
    assert.equal(result.rotation, 90);
    assert.equal(rotateCalls, 3);
    assert.equal(detectCalls, 4);
    assert.ok(result.x <= rotatedFace.x);
    assert.ok(result.x + result.width >= rotatedFace.x + rotatedFace.width);
    assert.ok(result.y <= rotatedFace.y);
    assert.ok(result.y + result.height >= rotatedFace.y + rotatedFace.height);
    assert.ok(result.x + result.width <= 1000);
    assert.ok(result.y + result.height <= 1400);
});

test('detectFaceCrop with tryRotations prefers 0 degrees on tie or when 0-degree score is within 10% of best', async () => {
    const tieResult = await detectFaceCrop(FAKE_DATA_URL, 3 / 4, {
        tryRotations: true,
        loadImage: createFakeLoader(1000, 1400),
        createRotatedSource(_source, degrees) {
            return { isRotated: true, degrees };
        },
        detector: {
            async detect(source) {
                if (!source?.isRotated) {
                    return [{ boundingBox: { x: 200, y: 300, width: 120, height: 150 }, score: 0.9 }];
                }
                if (source.degrees === 90) {
                    return [{ boundingBox: { x: 100, y: 100, width: 180, height: 220 }, score: 0.9 }];
                }
                return [];
            }
        }
    });
    assert.equal('error' in tieResult, false);
    assert.equal('rotation' in tieResult, false);

    const nearTieResult = await detectFaceCrop(FAKE_DATA_URL, 3 / 4, {
        tryRotations: true,
        loadImage: createFakeLoader(1000, 1400),
        createRotatedSource(_source, degrees) {
            return { isRotated: true, degrees };
        },
        detector: {
            async detect(source) {
                if (!source?.isRotated) {
                    return [{ boundingBox: { x: 200, y: 300, width: 140, height: 180 }, score: 0.85 }];
                }
                if (source.degrees === 90) {
                    return [{ boundingBox: { x: 200, y: 300, width: 140, height: 180 }, score: 0.9 }];
                }
                return [];
            }
        }
    });
    assert.equal('error' in nearTieResult, false);
    assert.equal('rotation' in nearTieResult, false);

    const areaTieResult = await detectFaceCrop(FAKE_DATA_URL, 3 / 4, {
        tryRotations: true,
        loadImage: createFakeLoader(1000, 1400),
        createRotatedSource(_source, degrees) {
            return { isRotated: true, degrees };
        },
        detector: {
            async detect(source) {
                if (!source?.isRotated || source.degrees === 90) {
                    return [{ boundingBox: { x: 200, y: 300, width: 140, height: 180 } }];
                }
                return [];
            }
        }
    });
    assert.equal('error' in areaTieResult, false);
    assert.equal('rotation' in areaTieResult, false);

    const areaWinnerResult = await detectFaceCrop(FAKE_DATA_URL, 3 / 4, {
        tryRotations: true,
        loadImage: createFakeLoader(1400, 1000),
        createRotatedSource(_source, degrees) {
            return { isRotated: true, degrees };
        },
        detector: {
            async detect(source) {
                if (!source?.isRotated) {
                    return [{ boundingBox: { x: 400, y: 200, width: 60, height: 80 } }];
                }
                if (source.degrees === 90) {
                    return [{ boundingBox: { x: 200, y: 300, width: 140, height: 180 } }];
                }
                return [];
            }
        }
    });
    assert.equal('error' in areaWinnerResult, false);
    assert.equal(areaWinnerResult.rotation, 90);
});

test('detectFaceCrop with tryRotations false performs no rotation search at all', async () => {
    let rotateCalls = 0;
    let detectCalls = 0;

    const missResult = await detectFaceCrop(FAKE_DATA_URL, 35 / 45, {
        tryRotations: false,
        loadImage: createFakeLoader(1400, 1000),
        createRotatedSource() {
            rotateCalls += 1;
            return { isRotated: true };
        },
        createTileSource(_source, region) {
            return { isTile: true, region };
        },
        detector: {
            async detect() {
                detectCalls += 1;
                return [];
            }
        }
    });

    assert.deepEqual(missResult, { error: 'no-face' });
    assert.equal(rotateCalls, 0);
    assert.equal(detectCalls, 14);

    let hitRotateCalls = 0;
    let hitDetectCalls = 0;
    const hitResult = await detectFaceCrop(FAKE_DATA_URL, 35 / 45, {
        tryRotations: false,
        loadImage: createFakeLoader(1400, 1000),
        createRotatedSource() {
            hitRotateCalls += 1;
            return { isRotated: true };
        },
        detector: {
            async detect() {
                hitDetectCalls += 1;
                return [{ boundingBox: { x: 200, y: 300, width: 140, height: 180 }, score: 0.52 }];
            }
        }
    });

    assert.equal('error' in hitResult, false);
    assert.equal('rotation' in hitResult, false);
    assert.equal(hitRotateCalls, 0);
    assert.equal(hitDetectCalls, 1);
});

test('detectFaceCrop returns unavailable when createRotatedSource throws', async () => {
    const result = await detectFaceCrop(FAKE_DATA_URL, 35 / 45, {
        tryRotations: true,
        loadImage: createFakeLoader(1400, 1000),
        createTileSource(_source, region) {
            return { isTile: true, region };
        },
        createRotatedSource() {
            throw new Error('rotate failed');
        },
        detector: createFakeDetector([])
    });

    assert.deepEqual(result, { error: 'unavailable' });
});

test('detectFaceCrop with tryRotations uses default OffscreenCanvas rotator, swaps 90/270 dims, and frees canvases', async () => {
    const originalOffscreenCanvas = globalThis.OffscreenCanvas;
    const createdCanvases = [];

    globalThis.OffscreenCanvas = class FakeOffscreenCanvas {
        constructor(width, height) {
            this.width = width;
            this.height = height;
            this.initialWidth = width;
            this.initialHeight = height;
            this.rotations = [];
            createdCanvases.push(this);
        }

        getContext(type) {
            if (type !== '2d') return null;
            return {
                translate: () => {},
                rotate: (rad) => {
                    this.rotations.push(Math.round((rad * 180) / Math.PI));
                },
                drawImage: () => {}
            };
        }
    };

    try {
        const result = await detectFaceCrop(FAKE_DATA_URL, 3 / 4, {
            tryRotations: true,
            loadImage: createFakeLoader(1400, 1000),
            createTileSource() {
                return null;
            },
            detector: {
                async detect(source) {
                    if (source instanceof globalThis.OffscreenCanvas && source.rotations.includes(90)) {
                        return [{ boundingBox: { x: 200, y: 250, width: 120, height: 150 }, score: 0.91 }];
                    }
                    return [];
                }
            }
        });

        assert.equal(result.rotation, 90);
        // Created 3 rotated canvases: 90° (1000x1400), 270° (1000x1400), 180° (1400x1000)
        assert.equal(createdCanvases.length, 3);
        assert.deepEqual(
            createdCanvases.map((c) => [c.initialWidth, c.initialHeight]),
            [[1000, 1400], [1000, 1400], [1400, 1000]]
        );
        assert.ok(createdCanvases.every((c) => c.width === 0 && c.height === 0));
    } finally {
        if (originalOffscreenCanvas === undefined) {
            delete globalThis.OffscreenCanvas;
        } else {
            globalThis.OffscreenCanvas = originalOffscreenCanvas;
        }
    }
});

test('detectFaceCrop with tryRotations preserves multiple-faces error on rotated hit', async () => {
    const result = await detectFaceCrop(FAKE_DATA_URL, 35 / 45, {
        tryRotations: true,
        loadImage: createFakeLoader(1400, 1000),
        createRotatedSource(_source, degrees) {
            return { isRotated: true, degrees };
        },
        detector: {
            async detect(source) {
                if (source?.isRotated && source.degrees === 90) {
                    return [
                        { boundingBox: { x: 100, y: 100, width: 110, height: 130 }, score: 0.9 },
                        { boundingBox: { x: 400, y: 100, width: 100, height: 120 }, score: 0.88 }
                    ];
                }
                return [];
            }
        }
    });

    assert.deepEqual(result, { error: 'multiple-faces' });
});
