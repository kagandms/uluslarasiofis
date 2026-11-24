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
