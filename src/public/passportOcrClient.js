import { PDFJS_VERSION } from '../config/pdfjs-version.js';

const MAX_IMAGE_DIMENSION = 2200;
const MAX_REENCODE_DIMENSION = 1600;
const MAX_OCR_IMAGE_BYTES = 10 * 1024 * 1024;
const OCR_IMAGE_TYPE = 'image/jpeg';
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function createCanvas() {
    if (!globalThis.document?.createElement) throw new Error('Image preparation is unavailable.');
    return globalThis.document.createElement('canvas');
}

function scaleDimensions(width, height, maxDimension = MAX_IMAGE_DIMENSION) {
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function canvasToJpeg(canvas, quality = 0.9) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('Image preparation failed.'));
                return;
            }
            resolve(blob);
        }, OCR_IMAGE_TYPE, quality);
    });
}

function clearCanvas(canvas) {
    canvas.width = 0;
    canvas.height = 0;
}

async function encodeBoundedJpeg(canvas, createCanvasImpl) {
    const prepared = await canvasToJpeg(canvas);
    if (prepared.size <= MAX_OCR_IMAGE_BYTES) return prepared;
    const resizedCanvas = createCanvasImpl();
    const dimensions = scaleDimensions(canvas.width, canvas.height, MAX_REENCODE_DIMENSION);
    resizedCanvas.width = dimensions.width;
    resizedCanvas.height = dimensions.height;
    try {
        resizedCanvas.getContext('2d', { alpha: false }).drawImage(canvas, 0, 0, dimensions.width, dimensions.height);
        const resized = await canvasToJpeg(resizedCanvas, 0.78);
        if (resized.size > MAX_OCR_IMAGE_BYTES) throw new Error('Prepared passport image exceeds the OCR size limit.');
        return resized;
    } finally {
        clearCanvas(resizedCanvas);
    }
}

/**
 * Decodes and bounds an image while keeping its temporary pixels in memory only.
 * @param {Blob} source Browser-held passport image.
 * @param {object} options Browser APIs overridden by focused tests.
 * @returns {Promise<Blob>} Bounded JPEG image bytes for the public OCR endpoint.
 */
export async function preparePassportImage(source, {
    createImageBitmapImpl = globalThis.createImageBitmap,
    createCanvasImpl = createCanvas
} = {}) {
    if (!SUPPORTED_IMAGE_TYPES.has(source.type)) throw new Error('Unsupported passport image type.');
    if (typeof createImageBitmapImpl !== 'function') throw new Error('Image decoding is unavailable.');
    const bitmap = await createImageBitmapImpl(source, { imageOrientation: 'from-image' });
    const canvas = createCanvasImpl();
    try {
        const dimensions = scaleDimensions(bitmap.width, bitmap.height);
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        canvas.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
        return await encodeBoundedJpeg(canvas, createCanvasImpl);
    } finally {
        bitmap.close?.();
        clearCanvas(canvas);
    }
}

async function loadPdfjs() {
    const [pdfjsLib, workerAsset] = await Promise.all([
        import('pdfjs-dist/legacy/build/pdf.mjs'),
        import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
    ]);
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerAsset.default;
    return pdfjsLib;
}

async function renderPdfPage(pdf, pageNumber, createCanvasImpl) {
    const page = await pdf.getPage(pageNumber);
    const initialViewport = page.getViewport({ scale: 1 });
    const dimensions = scaleDimensions(initialViewport.width, initialViewport.height);
    const scale = dimensions.width / initialViewport.width;
    const viewport = page.getViewport({ scale });
    const canvas = createCanvasImpl();
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    try {
        await page.render({
            canvasContext: canvas.getContext('2d', { alpha: false }),
            viewport,
            intent: 'display'
        }).promise;
        return await encodeBoundedJpeg(canvas, createCanvasImpl);
    } finally {
        clearCanvas(canvas);
        page.cleanup?.();
    }
}

function hasUsefulCandidates(fields) {
    return Object.values(fields || {}).some((value) => typeof value === 'string' && value.trim().length > 0);
}

async function recognizePdfPassport(source, recognizeImage, { loadPdfjsImpl, createCanvasImpl }) {
    const pdfjsLib = await loadPdfjsImpl();
    const document = await pdfjsLib.getDocument({
        data: new Uint8Array(await source.arrayBuffer()),
        cMapUrl: `/pdfjs-support/${PDFJS_VERSION}/cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `/pdfjs-support/${PDFJS_VERSION}/standard_fonts/`,
        isEvalSupported: false
    }).promise;
    let noFieldsError;
    try {
        const pageLimit = Math.min(document.numPages, 2);
        for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
            const image = await renderPdfPage(document, pageNumber, createCanvasImpl);
            try {
                const fields = await recognizeImage(image);
                if (hasUsefulCandidates(fields)) return fields;
                noFieldsError = Object.assign(new Error('Passport fields were not found.'), { code: 'OCR_NO_PASSPORT_FIELDS' });
            } catch (error) {
                if (error.code !== 'OCR_NO_PASSPORT_FIELDS') throw error;
                noFieldsError = error;
            }
        }
    } finally {
        await document.destroy?.();
    }
    throw noFieldsError || Object.assign(new Error('Passport fields were not found.'), { code: 'OCR_NO_PASSPORT_FIELDS' });
}

/**
 * Prepares one image or scans at most the first two pages of a PDF in the browser.
 * @param {File} source Finalized passport bytes held temporarily in memory.
 * @param {Function} recognizeImage Sends one prepared image to the owner-only API.
 * @param {object} options Browser APIs overridden by focused tests.
 * @returns {Promise<object>} First useful safe candidate set.
 */
export async function recognizePassportSource(source, recognizeImage, {
    loadPdfjsImpl = loadPdfjs,
    createImageBitmapImpl = globalThis.createImageBitmap,
    createCanvasImpl = createCanvas
} = {}) {
    if (source.type === 'application/pdf') {
        return recognizePdfPassport(source, recognizeImage, { loadPdfjsImpl, createCanvasImpl });
    }
    const image = await preparePassportImage(source, { createImageBitmapImpl, createCanvasImpl });
    return recognizeImage(image);
}
