/**
 * @fileoverview Pasaport görüntüsünden baş + omuz paylı otomatik yüz kırpma kutusu hesaplayıcısı.
 */

const FACE_WIDTH_EXPANSION = 2.2;
const FACE_TOP_MARGIN_RATIO = 0.6;
const MIN_FACE_HEIGHT_MULTIPLIER = 1.8;
const DOMINANT_FACE_AREA_RATIO = 2.5;

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

    let cropW = fw * FACE_WIDTH_EXPANSION;
    let cropH = cropW / aspectRatio;

    const minHeight = fh * MIN_FACE_HEIGHT_MULTIPLIER;
    if (cropH < minHeight) {
        cropH = minHeight;
        cropW = cropH * aspectRatio;
    }

    if (cropW > imgWidth) {
        cropW = imgWidth;
        cropH = cropW / aspectRatio;
    }
    if (cropH > imgHeight) {
        cropH = imgHeight;
        cropW = cropH * aspectRatio;
    }

    let rawX = centerX - cropW / 2;
    let rawY = fy - fh * FACE_TOP_MARGIN_RATIO;

    rawX = Math.max(0, Math.min(rawX, imgWidth - cropW));
    rawY = Math.max(0, Math.min(rawY, imgHeight - cropH));

    let width = Math.max(1, Math.min(imgWidth, Math.round(cropW)));
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
    const y = Math.max(0, Math.min(Math.round(rawY), imgHeight - height));

    return { x, y, width, height };
}

/**
 * Pasaport fotoğrafında yüzü algılar ve `aspectRatio` oranına uygun, görüntü sınırları içinde
 * baş + omuz paylı piksel kırpma kutusu döndürür.
 *
 * @param {string} imageDataUrl - Pasaport sayfası görüntü data URL'i.
 * @param {number} aspectRatio - Hedef en/boy oranı (genişlik / yükseklik).
 * @param {{ detector?: { detect: (source: unknown) => Promise<Array<{ boundingBox: { x: number, y: number, width: number, height: number } }>> } | null, loadImage?: (dataUrl: string) => Promise<{ width: number, height: number, source: unknown }>, loadFallbackDetector?: () => Promise<{ detect: (source: unknown) => Promise<Array<{ boundingBox: { x: number, y: number, width: number, height: number } }>> } | null> }} [options={}] - Test amaçlı bağımlılık enjeksiyonu.
 * @returns {Promise<{ x: number, y: number, width: number, height: number } | { error: 'no-face' | 'multiple-faces' | 'unavailable' }>} Kırpma kutusu veya hata kodu.
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
        if (faces.length === 0) {
            return { error: 'no-face' };
        }

        const validBoxes = faces
            .map((face) => face?.boundingBox)
            .filter(isValidBoundingBox);

        if (validBoxes.length === 0) {
            return { error: 'unavailable' };
        }

        validBoxes.sort((a, b) => (b.width * b.height) - (a.width * a.height));

        if (validBoxes.length >= 2) {
            const largestArea = validBoxes[0].width * validBoxes[0].height;
            const secondLargestArea = validBoxes[1].width * validBoxes[1].height;
            if (largestArea < secondLargestArea * DOMINANT_FACE_AREA_RATIO) {
                return { error: 'multiple-faces' };
            }
        }

        return computeCropBox(validBoxes[0], imgWidth, imgHeight, aspectRatio);
    } catch {
        return { error: 'unavailable' };
    }
}
