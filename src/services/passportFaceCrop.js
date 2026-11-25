/**
 * @fileoverview Pasaport görüntüsünden baş + omuz paylı otomatik yüz kırpma kutusu hesaplayıcısı.
 */

const CROP_HEIGHT_FACE_MULTIPLIER = 1.75;
const MIN_FACE_WIDTH_MULTIPLIER = 1.6;
const TOP_HAIR_MARGIN_RATIO = 0.45;
const MAX_BOTTOM_FACE_RATIO = 1.5;
const DOMINANT_FACE_AREA_RATIO = 2.5;
const TILE_GRID_SIZES = [2, 3];
const TILE_OVERLAP_RATIO = 0.3;
const TILE_MIN_LONG_SIDE = 640;
const TILE_MAX_UPSCALE = 3;
const TILE_BORDER_MARGIN_RATIO = 0.02;
const TILE_DUPLICATE_IOU_THRESHOLD = 0.3;
const ROTATION_SEARCH_ANGLES = [90, 270, 180];
const UPRIGHT_SCORE_TOLERANCE = 0.1;
// Toplam dedektör çağrısı üst sınırı:
// - tryRotations=false: en fazla 14 çağrı (1 tam dikey + en fazla 13 dikey karo [2x2 + 3x3]).
// - tryRotations=true: tam görüntüde her zaman en fazla 4 çağrı (0°, 90°, 270°, 180°);
//   hiçbir açıda tam görüntüde yüz bulunamazsa karo yedek aramasında en fazla 13 dikey + 3 x 13 döndürülmüş karo
//   olmak üzere toplam en fazla 56 çağrı (4 + 13 + 39).

function isValidBoundingBox(box) {
    return Boolean(
        box &&
        Number.isFinite(box.x) &&
        Number.isFinite(box.y) &&
        Number.isFinite(box.width) &&
        Number.isFinite(box.height) &&
        box.width > 0 &&
        box.height > 0
    );
}

/**
 * Tarayıcı ortamında data URL görüntüsünü yükler.
 *
 * @param {string} imageDataUrl - Görüntü data URL'i.
 * @returns {Promise<{ width: number, height: number, source: HTMLImageElement }>} Yüklenen görüntü boyutları ve kaynağı.
 */
function defaultLoadImage(imageDataUrl) {
    if (typeof Image !== 'function') {
        return Promise.reject(new Error('Image API unavailable'));
    }
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const width = img.naturalWidth || img.width;
            const height = img.naturalHeight || img.height;
            resolve({ width, height, source: img });
        };
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = imageDataUrl;
    });
}

async function defaultLoadFallbackDetector() {
    const { getSharedMediapipeFaceDetector } = await import('./mediapipeFaceDetector.js');
    return getSharedMediapipeFaceDetector();
}

async function resolveDetector(options) {
    if (options && Object.prototype.hasOwnProperty.call(options, 'detector')) {
        return options.detector || null;
    }
    if (typeof globalThis.FaceDetector === 'function') {
        return new globalThis.FaceDetector({ fastMode: false, maxDetectedFaces: 3 });
    }
    const loadFallbackDetector = typeof options?.loadFallbackDetector === 'function'
        ? options.loadFallbackDetector
        : defaultLoadFallbackDetector;
    return await loadFallbackDetector();
}

function computeCropBox(faceBox, imgWidth, imgHeight, aspectRatio) {
    const { x: fx, y: fy, width: fw, height: fh } = faceBox;
    const centerX = fx + fw / 2;

    let cropH = fh * CROP_HEIGHT_FACE_MULTIPLIER;
    let cropW = cropH * aspectRatio;

    const minWidth = fw * MIN_FACE_WIDTH_MULTIPLIER;
    if (cropW < minWidth) {
        cropW = minWidth;
        cropH = cropW / aspectRatio;
    }

    if (cropW > imgWidth) {
        cropW = imgWidth;
        cropH = cropW / aspectRatio;
    }
    if (cropH > imgHeight) {
        cropH = imgHeight;
        cropW = cropH * aspectRatio;
    }

    const maxBottom = fy + fh * MAX_BOTTOM_FACE_RATIO;
    let rawX = centerX - cropW / 2;
    let rawY = Math.min(fy - fh * TOP_HAIR_MARGIN_RATIO, maxBottom - cropH);

    rawX = Math.max(0, Math.min(rawX, imgWidth - cropW));
    rawY = Math.max(0, Math.min(rawY, imgHeight - cropH));

    let width = Math.max(1, Math.min(imgWidth, Math.round(cropW)));
    if (cropW >= minWidth && width < minWidth && Math.ceil(minWidth) <= imgWidth) {
        width = Math.ceil(minWidth);
    }
    let height = Math.max(1, Math.round(width / aspectRatio));

    if (height > imgHeight) {
        height = imgHeight;
        width = Math.max(1, Math.min(imgWidth, Math.floor(height * aspectRatio)));
    }
    if (width > imgWidth) {
        width = imgWidth;
        height = Math.max(1, Math.min(imgHeight, Math.floor(width / aspectRatio)));
    }

    const x = Math.max(0, Math.min(Math.round(rawX), imgWidth - width));
    const maxY = Math.floor(maxBottom - height);
    const y = Math.max(0, Math.min(Math.round(rawY), imgHeight - height, maxY));

    return { x, y, width, height };
}

/**
 * Bir karonun uzun kenarını en az 640 piksele çıkaracak ölçek faktörünü hesaplar (en fazla 3x).
 *
 * @param {number} tileWidth - Karonun piksel genişliği.
 * @param {number} tileHeight - Karonun piksel yüksekliği.
 * @returns {number} 1 ile 3 arasında ölçek çarpanı.
 */
function computeTileScale(tileWidth, tileHeight) {
    const longSide = Math.max(tileWidth, tileHeight);
    if (!Number.isFinite(longSide) || longSide <= 0) {
        return 1;
    }
    return Math.min(TILE_MAX_UPSCALE, Math.max(1, TILE_MIN_LONG_SIDE / longSide));
}

/**
 * Tek bir eksen boyunca verilen oranda örtüşen karo başlangıçlarını ve boyutunu üretir.
 *
 * @param {number} totalSize - Toplam eksen uzunluğu (piksel).
 * @param {number} gridSize - Eksen üzerindeki karo sayısı.
 * @param {number} overlapRatio - Bitişik karolar arasındaki örtüşme oranı.
 * @returns {Array<{ start: number, size: number }>} Eksen dilimleri.
 */
function buildAxisSlices(totalSize, gridSize, overlapRatio) {
    const divisor = 1 + (gridSize - 1) * (1 - overlapRatio);
    const tileSize = Math.max(1, Math.min(totalSize, Math.round(totalSize / divisor)));
    const maxStart = Math.max(0, totalSize - tileSize);

    const slices = [];
    for (let i = 0; i < gridSize; i += 1) {
        const start = i === gridSize - 1
            ? maxStart
            : Math.round((maxStart * i) / (gridSize - 1));
        slices.push({ start, size: tileSize });
    }
    return slices;
}

/**
 * Görüntüyü %30 örtüşen `gridSize x gridSize` karolara böler.
 *
 * @param {number} imgWidth - Tam görüntü genişliği.
 * @param {number} imgHeight - Tam görüntü yüksekliği.
 * @param {number} gridSize - Izgara boyutu (ör. 2 veya 3).
 * @returns {Array<{ sx: number, sy: number, sw: number, sh: number }>} Karo bölgeleri listesi.
 */
function buildGridTiles(imgWidth, imgHeight, gridSize) {
    const cols = buildAxisSlices(imgWidth, gridSize, TILE_OVERLAP_RATIO);
    const rows = buildAxisSlices(imgHeight, gridSize, TILE_OVERLAP_RATIO);
    const tiles = [];

    for (const row of rows) {
        for (const col of cols) {
            tiles.push({ sx: col.start, sy: row.start, sw: col.size, sh: row.size });
        }
    }

    return tiles;
}

/**
 * Kutunun, görüntünün dış kenarı olmayan bir karo sınırına %2 pay içinde değip değmediğini kontrol eder.
 *
 * @param {{ x: number, y: number, width: number, height: number }} box - Tam görüntü koordinatlarında yüz kutusu.
 * @param {{ sx: number, sy: number, sw: number, sh: number }} tile - Tam görüntü koordinatlarında karo bölgesi.
 * @param {number} imgWidth - Tam görüntü genişliği.
 * @param {number} imgHeight - Tam görüntü yüksekliği.
 * @returns {boolean} Kutu iç karo sınırına değiyorsa true.
 */
function isTouchingInteriorTileBorder(box, tile, imgWidth, imgHeight) {
    const marginX = tile.sw * TILE_BORDER_MARGIN_RATIO;
    const marginY = tile.sh * TILE_BORDER_MARGIN_RATIO;

    const touchesLeft = tile.sx > 0 && box.x <= tile.sx + marginX;
    const touchesTop = tile.sy > 0 && box.y <= tile.sy + marginY;
    const touchesRight = tile.sx + tile.sw < imgWidth && box.x + box.width >= tile.sx + tile.sw - marginX;
    const touchesBottom = tile.sy + tile.sh < imgHeight && box.y + box.height >= tile.sy + tile.sh - marginY;

    return touchesLeft || touchesTop || touchesRight || touchesBottom;
}

/**
 * İki sınırlayıcı kutunun kesişim / birleşim (IoU) oranını hesaplar.
 *
 * @param {{ x: number, y: number, width: number, height: number }} boxA - İlk kutu.
 * @param {{ x: number, y: number, width: number, height: number }} boxB - İkinci kutu.
 * @returns {number} 0 ile 1 arasında IoU değeri.
 */
function computeIoU(boxA, boxB) {
    const x1 = Math.max(boxA.x, boxB.x);
    const y1 = Math.max(boxA.y, boxB.y);
    const x2 = Math.min(boxA.x + boxA.width, boxB.x + boxB.width);
    const y2 = Math.min(boxA.y + boxA.height, boxB.y + boxB.height);

    const interWidth = Math.max(0, x2 - x1);
    const interHeight = Math.max(0, y2 - y1);
    const interArea = interWidth * interHeight;
    if (interArea <= 0) {
        return 0;
    }

    const areaA = boxA.width * boxA.height;
    const areaB = boxB.width * boxB.height;
    const unionArea = areaA + areaB - interArea;
    return unionArea > 0 ? interArea / unionArea : 0;
}

/**
 * IoU değeri eşiği aşan yinelenen yüz kutularını birleştirir ve her kümeden büyük olanı korur.
 *
 * @param {Array<{ x: number, y: number, width: number, height: number }>} boxes - Tam görüntü koordinatlarında kutular.
 * @returns {Array<{ x: number, y: number, width: number, height: number }>} Yinelenenleri temizlenmiş kutular.
 */
function mergeOverlappingBoxes(boxes) {
    const sorted = [...boxes].sort((a, b) => (b.width * b.height) - (a.width * a.height));
    const kept = [];

    for (const box of sorted) {
        const isDuplicate = kept.some((existing) => computeIoU(existing, box) > TILE_DUPLICATE_IOU_THRESHOLD);
        if (!isDuplicate) {
            kept.push(box);
        }
    }

    return kept;
}

/**
 * Varsayılan karo kaynağı üretimi için kullanılabilir bir canvas API'si olup olmadığını kontrol eder.
 *
 * @returns {boolean} OffscreenCanvas veya document.createElement mevcutsa true.
 */
function canCreateDefaultTileSource() {
    return (
        typeof OffscreenCanvas === 'function' ||
        (typeof document === 'object' && document !== null && typeof document.createElement === 'function')
    );
}

/**
 * Verilen boyutlarda 2D canvas ve bağlamını oluşturur.
 *
 * @param {number} width - Hedef genişlik (piksel).
 * @param {number} height - Hedef yükseklik (piksel).
 * @returns {{ canvas: OffscreenCanvas | HTMLCanvasElement, ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } | null} Oluşturulan canvas ve 2D bağlamı veya API yoksa null.
 */
function createCanvas2D(width, height) {
    let canvas = null;
    if (typeof OffscreenCanvas === 'function') {
        canvas = new OffscreenCanvas(width, height);
    } else if (typeof document === 'object' && document !== null && typeof document.createElement === 'function') {
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
    }

    if (!canvas || typeof canvas.getContext !== 'function') {
        return null;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx || typeof ctx.drawImage !== 'function') {
        canvas.width = 0;
        canvas.height = 0;
        return null;
    }

    return { canvas, ctx };
}

/**
 * Verilen görüntü bölgesini ölçekleyerek geçici bir 2D canvas üzerine çizer.
 *
 * @param {unknown} source - Çizilebilir kaynak görüntü.
 * @param {{ sx: number, sy: number, sw: number, sh: number, scale: number }} region - Kaynak karo bölgesi ve ölçek faktörü.
 * @returns {OffscreenCanvas | HTMLCanvasElement | null} Çizilmiş canvas veya 2D bağlam yoksa null.
 */
function createDefaultTileCanvas(source, { sx, sy, sw, sh, scale }) {
    const targetWidth = Math.max(1, Math.round(sw * scale));
    const targetHeight = Math.max(1, Math.round(sh * scale));
    const created = createCanvas2D(targetWidth, targetHeight);
    if (!created) {
        return null;
    }
    const { canvas, ctx } = created;

    try {
        ctx.drawImage(source, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
        return canvas;
    } catch (error) {
        canvas.width = 0;
        canvas.height = 0;
        throw error;
    }
}

/**
 * Kaynak görüntüyü saat yönünde `degrees` (90, 180 veya 270) döndürerek geçici bir 2D canvas üretir.
 *
 * @param {unknown} source - Çizilebilir kaynak görüntü.
 * @param {number} degrees - Saat yönünde döndürme açısı (90, 180 veya 270).
 * @returns {OffscreenCanvas | HTMLCanvasElement | null} Döndürülmüş canvas veya API yoksa null.
 */
function createDefaultRotatedCanvas(source, degrees) {
    const srcWidth = Math.floor(source?.naturalWidth || source?.width || 0);
    const srcHeight = Math.floor(source?.naturalHeight || source?.height || 0);
    if (!Number.isFinite(srcWidth) || !Number.isFinite(srcHeight) || srcWidth <= 0 || srcHeight <= 0) {
        return null;
    }

    const isQuarterTurn = degrees === 90 || degrees === 270;
    const targetWidth = isQuarterTurn ? srcHeight : srcWidth;
    const targetHeight = isQuarterTurn ? srcWidth : srcHeight;
    const created = createCanvas2D(targetWidth, targetHeight);
    if (!created) {
        return null;
    }
    const { canvas, ctx } = created;

    try {
        if (typeof ctx.translate === 'function') {
            ctx.translate(targetWidth / 2, targetHeight / 2);
        }
        if (typeof ctx.rotate === 'function') {
            ctx.rotate((degrees * Math.PI) / 180);
        }
        ctx.drawImage(source, -srcWidth / 2, -srcHeight / 2, srcWidth, srcHeight);
        return canvas;
    } catch (error) {
        canvas.width = 0;
        canvas.height = 0;
        throw error;
    }
}

/**
 * Tek bir karo üzerinde yüz algılama çalıştırır, sonuçları tam görüntü koordinatlarına taşır
 * ve iç karo sınırına değen kesik kutuları eler.
 *
 * @param {{ detect: (source: unknown) => Promise<Array<{ boundingBox: { x: number, y: number, width: number, height: number } }>> }} detector - Yüz algılayıcı.
 * @param {unknown} source - Tam kaynak görüntü.
 * @param {{ sx: number, sy: number, sw: number, sh: number }} tile - Tam görüntü koordinatlarında karo dikdörtgeni.
 * @param {number} imgWidth - Tam görüntü genişliği.
 * @param {number} imgHeight - Tam görüntü yüksekliği.
 * @param {((source: unknown, region: { sx: number, sy: number, sw: number, sh: number, scale: number }) => unknown) | null} createTileSource - Özel karo kaynağı üreticisi veya varsayılan için null.
 * @returns {Promise<{ boxes: Array<{ x: number, y: number, width: number, height: number }> } | { error: 'unavailable' }>} Geçerli tam görüntü kutuları veya hata.
 */
async function detectTileBoxes(detector, source, tile, imgWidth, imgHeight, createTileSource) {
    const scale = computeTileScale(tile.sw, tile.sh);
    const region = { sx: tile.sx, sy: tile.sy, sw: tile.sw, sh: tile.sh, scale };

    let tileFaces;
    if (createTileSource) {
        const tileSource = await createTileSource(source, region);
        if (!tileSource) {
            return { boxes: [] };
        }
        tileFaces = await detector.detect(tileSource);
    } else {
        const canvas = createDefaultTileCanvas(source, region);
        if (!canvas) {
            return { boxes: [] };
        }
        try {
            tileFaces = await detector.detect(canvas);
        } finally {
            canvas.width = 0;
            canvas.height = 0;
        }
    }

    if (!Array.isArray(tileFaces)) {
        return { error: 'unavailable' };
    }

    const boxes = [];
    for (const face of tileFaces) {
        const rawBox = face?.boundingBox;
        if (!isValidBoundingBox(rawBox)) {
            continue;
        }
        const mappedBox = {
            x: tile.sx + rawBox.x / scale,
            y: tile.sy + rawBox.y / scale,
            width: rawBox.width / scale,
            height: rawBox.height / scale
        };
        if (!isTouchingInteriorTileBorder(mappedBox, tile, imgWidth, imgHeight)) {
            boxes.push(mappedBox);
        }
    }

    return { boxes };
}

/**
 * Tam görüntüde yüz bulunamadığında 2x2 ve ardından 3x3 örtüşen karolar üzerinde
 * çok ölçekli yüz araması yapar.
 *
 * @param {{ detect: (source: unknown) => Promise<Array<{ boundingBox: { x: number, y: number, width: number, height: number } }>> }} detector - Yüz algılayıcı.
 * @param {unknown} source - Tam kaynak görüntü.
 * @param {number} imgWidth - Tam görüntü genişliği.
 * @param {number} imgHeight - Tam görüntü yüksekliği.
 * @param {{ createTileSource?: (source: unknown, region: { sx: number, sy: number, sw: number, sh: number, scale: number }) => unknown }} [options={}] - Karo kaynağı enjeksiyonu içeren seçenekler.
 * @returns {Promise<{ boxes: Array<{ x: number, y: number, width: number, height: number }> } | { error: 'unavailable' }>} Birleştirilmiş yüz kutuları veya hata.
 */
async function detectFacesInTiles(detector, source, imgWidth, imgHeight, options = {}) {
    const createTileSource = typeof options?.createTileSource === 'function' ? options.createTileSource : null;
    if (!createTileSource && !canCreateDefaultTileSource()) {
        return { boxes: [] };
    }

    for (const gridSize of TILE_GRID_SIZES) {
        const tiles = buildGridTiles(imgWidth, imgHeight, gridSize);
        const gridBoxes = [];

        for (const tile of tiles) {
            const result = await detectTileBoxes(detector, source, tile, imgWidth, imgHeight, createTileSource);
            if (result.error) {
                return { error: result.error };
            }
            gridBoxes.push(...result.boxes);
        }

        const merged = mergeOverlappingBoxes(gridBoxes);
        if (merged.length > 0) {
            return { boxes: merged };
        }
    }

    return { boxes: [] };
}

function extractValidFaces(faces) {
    const valid = [];
    for (const face of faces) {
        const box = face?.boundingBox;
        if (!isValidBoundingBox(box)) {
            continue;
        }
        const area = box.width * box.height;
        valid.push({
            box,
            area,
            score: Number.isFinite(face?.score) ? face.score : area
        });
    }
    return valid;
}

function resolveCropFromBoxes(boxes, imgWidth, imgHeight, aspectRatio) {
    const sorted = [...boxes].sort((a, b) => (b.width * b.height) - (a.width * a.height));

    if (sorted.length >= 2) {
        const largestArea = sorted[0].width * sorted[0].height;
        const secondLargestArea = sorted[1].width * sorted[1].height;
        if (largestArea < secondLargestArea * DOMINANT_FACE_AREA_RATIO) {
            return { error: 'multiple-faces' };
        }
    }

    return computeCropBox(sorted[0], imgWidth, imgHeight, aspectRatio);
}

function resolveRotatedDescriptor(created, degrees, imgWidth, imgHeight) {
    if (!created) {
        return null;
    }
    const isQuarterTurn = degrees === 90 || degrees === 270;
    const fallbackWidth = isQuarterTurn ? imgHeight : imgWidth;
    const fallbackHeight = isQuarterTurn ? imgWidth : imgHeight;

    const hasWrapper = typeof created === 'object' && 'source' in created && created.source != null;
    const rotSource = hasWrapper ? created.source : created;
    const rawWidth = Number(created.width);
    const rawHeight = Number(created.height);

    return {
        degrees,
        source: rotSource,
        width: Number.isFinite(rawWidth) && rawWidth > 0 ? Math.floor(rawWidth) : fallbackWidth,
        height: Number.isFinite(rawHeight) && rawHeight > 0 ? Math.floor(rawHeight) : fallbackHeight
    };
}

function summarizeOrientationCandidate(degrees, width, height, validFaces) {
    if (validFaces.length === 0) {
        return null;
    }

    let bestScore = validFaces[0].score;
    let largestArea = validFaces[0].area;
    const boxes = [];

    for (const face of validFaces) {
        boxes.push(face.box);
        if (face.score > bestScore) {
            bestScore = face.score;
        }
        if (face.area > largestArea) {
            largestArea = face.area;
        }
    }

    return { degrees, width, height, boxes, bestScore, largestArea };
}

function pickBestRotatedCandidate(rotatedCandidates) {
    let best = null;
    for (const candidate of rotatedCandidates) {
        if (
            !best ||
            candidate.bestScore > best.bestScore ||
            (candidate.bestScore === best.bestScore && candidate.largestArea > best.largestArea)
        ) {
            best = candidate;
        }
    }
    return best;
}

function selectWinningOrientationCandidate(uprightCandidate, rotatedCandidates) {
    const bestRotated = pickBestRotatedCandidate(rotatedCandidates);
    if (!uprightCandidate) {
        return bestRotated;
    }
    if (!bestRotated) {
        return uprightCandidate;
    }

    // Eşitlikte veya 0° skoru en iyi skora %10 yakınındayken dikey (0°) yönü koru.
    const uprightThreshold = bestRotated.bestScore * (1 - UPRIGHT_SCORE_TOLERANCE) - 1e-12;
    if (uprightCandidate.bestScore >= bestRotated.bestScore || uprightCandidate.bestScore >= uprightThreshold) {
        return uprightCandidate;
    }
    return bestRotated;
}

function formatOrientationCropResult(boxes, width, height, aspectRatio, degrees) {
    const cropOrError = resolveCropFromBoxes(boxes, width, height, aspectRatio);
    if (cropOrError.error) {
        return cropOrError;
    }
    return degrees === 0 ? cropOrError : { ...cropOrError, rotation: degrees };
}

/**
 * `tryRotations` etkinken dört yönün (0°, 90°, 270°, 180°) tamamında tam görüntü algılaması
 * çalıştırır; en iyi skora sahip yönü seçer (eşitlikte veya %10 yakında 0° tercih edilir).
 * Dört yönün hiçbiri tam görüntüde yüz bulamazsa 0° ardından döndürülmüş yönlerde karo yedek
 * aramasına geçer ve ilk geçerli bulguda durur.
 */
async function detectFaceCropWithRotations(
    detector,
    source,
    imgWidth,
    imgHeight,
    aspectRatio,
    options,
    uprightValidFaces
) {
    const customRotator = typeof options?.createRotatedSource === 'function' ? options.createRotatedSource : null;
    const canRotate = Boolean(customRotator || canCreateDefaultTileSource());

    const ownedCanvases = [];
    const rotatedEntries = [];

    try {
        const uprightCandidate = summarizeOrientationCandidate(0, imgWidth, imgHeight, uprightValidFaces);
        const rotatedCandidates = [];

        if (canRotate) {
            for (const degrees of ROTATION_SEARCH_ANGLES) {
                let descriptor = null;
                if (customRotator) {
                    const created = await customRotator(source, degrees);
                    descriptor = resolveRotatedDescriptor(created, degrees, imgWidth, imgHeight);
                } else {
                    const canvas = createDefaultRotatedCanvas(source, degrees);
                    if (canvas) {
                        ownedCanvases.push(canvas);
                        descriptor = resolveRotatedDescriptor(canvas, degrees, imgWidth, imgHeight);
                    }
                }

                if (!descriptor) {
                    continue;
                }
                rotatedEntries.push(descriptor);

                const faces = await detector.detect(descriptor.source);
                if (!Array.isArray(faces)) {
                    return { error: 'unavailable' };
                }

                const candidate = summarizeOrientationCandidate(
                    descriptor.degrees,
                    descriptor.width,
                    descriptor.height,
                    extractValidFaces(faces)
                );
                if (candidate) {
                    rotatedCandidates.push(candidate);
                }
            }
        }

        const winner = selectWinningOrientationCandidate(uprightCandidate, rotatedCandidates);
        if (winner) {
            return formatOrientationCropResult(
                winner.boxes,
                winner.width,
                winner.height,
                aspectRatio,
                winner.degrees
            );
        }

        // Tam görüntüde hiçbir açı yüz vermediyse karo yedek aramasına geç ve ilk bulguda dur.
        const tileEntries = [
            { degrees: 0, source, width: imgWidth, height: imgHeight },
            ...rotatedEntries
        ];

        for (const entry of tileEntries) {
            const tileResult = await detectFacesInTiles(
                detector,
                entry.source,
                entry.width,
                entry.height,
                options
            );
            if (tileResult.error) {
                return { error: tileResult.error };
            }
            if (tileResult.boxes.length > 0) {
                return formatOrientationCropResult(
                    tileResult.boxes,
                    entry.width,
                    entry.height,
                    aspectRatio,
                    entry.degrees
                );
            }
        }

        return { error: 'no-face' };
    } finally {
        for (const canvas of ownedCanvases) {
            canvas.width = 0;
            canvas.height = 0;
        }
    }
}

/**
 * Pasaport fotoğrafında yüzü algılar ve `aspectRatio` oranına uygun, görüntü sınırları içinde
 * baş + omuz paylı piksel kırpma kutusu döndürür.
 *
 * @param {string} imageDataUrl - Pasaport sayfası görüntü data URL'i.
 * @param {number} aspectRatio - Hedef en/boy oranı (genişlik / yükseklik).
 * @param {{ detector?: { detect: (source: unknown) => Promise<Array<{ boundingBox: { x: number, y: number, width: number, height: number }, score?: number }>> } | null, loadImage?: (dataUrl: string) => Promise<{ width: number, height: number, source: unknown }>, loadFallbackDetector?: () => Promise<{ detect: (source: unknown) => Promise<Array<{ boundingBox: { x: number, y: number, width: number, height: number }, score?: number }>> } | null>, createTileSource?: (source: unknown, region: { sx: number, sy: number, sw: number, sh: number, scale: number }) => unknown, tryRotations?: boolean, createRotatedSource?: (source: unknown, degrees: number) => unknown }} [options={}] - Test ve döndürme seçenekleri.
 * @returns {Promise<{ x: number, y: number, width: number, height: number, rotation?: number } | { error: 'no-face' | 'multiple-faces' | 'unavailable' }>} Kırpma kutusu veya hata kodu.
 */
export async function detectFaceCrop(imageDataUrl, aspectRatio, options = {}) {
    if (
        typeof imageDataUrl !== 'string' ||
        !imageDataUrl.trim() ||
        typeof aspectRatio !== 'number' ||
        !Number.isFinite(aspectRatio) ||
        aspectRatio <= 0
    ) {
        return { error: 'unavailable' };
    }

    try {
        const detector = await resolveDetector(options);
        if (!detector || typeof detector.detect !== 'function') {
            return { error: 'unavailable' };
        }

        const loader = typeof options?.loadImage === 'function' ? options.loadImage : defaultLoadImage;
        const loaded = await loader(imageDataUrl);
        const imgWidth = Math.floor(loaded?.width ?? 0);
        const imgHeight = Math.floor(loaded?.height ?? 0);

        if (!Number.isFinite(imgWidth) || !Number.isFinite(imgHeight) || imgWidth <= 0 || imgHeight <= 0) {
            return { error: 'unavailable' };
        }

        const faces = await detector.detect(loaded.source);
        if (!Array.isArray(faces)) {
            return { error: 'unavailable' };
        }

        const uprightValidFaces = extractValidFaces(faces);

        if (options?.tryRotations === true) {
            return await detectFaceCropWithRotations(
                detector,
                loaded.source,
                imgWidth,
                imgHeight,
                aspectRatio,
                options,
                uprightValidFaces
            );
        }

        let validBoxes = uprightValidFaces.map((f) => f.box);

        if (validBoxes.length === 0) {
            const tileResult = await detectFacesInTiles(detector, loaded.source, imgWidth, imgHeight, options);
            if (tileResult.error) {
                return { error: tileResult.error };
            }
            validBoxes = tileResult.boxes;
        }

        if (validBoxes.length > 0) {
            return resolveCropFromBoxes(validBoxes, imgWidth, imgHeight, aspectRatio);
        }

        return { error: 'no-face' };
    } catch {
        return { error: 'unavailable' };
    }
}
