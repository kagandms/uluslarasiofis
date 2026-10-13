import { DOCUMENT_IMAGE_LONG_EDGE, DOCUMENT_IMAGE_JPEG_QUALITY, DOCUMENT_IMAGE_JPEG_PASSTHROUGH_BYTES } from '../config/mobile-transfer-policy.js';

function encodeCanvas(canvas, quality) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => {
        if (!blob) return reject(new Error('Belge görseli oluşturulamadı.'));
        resolve(blob);
    }, 'image/jpeg', quality));
}

/** @returns {void} */
function getImageDimensions(image) {
    return { width: image.width || image.naturalWidth, height: image.height || image.naturalHeight };
}

function drawDocumentImage(image, canvas) {
    const { width, height } = getImageDimensions(image);
    const scale = Math.min(1, DOCUMENT_IMAGE_LONG_EDGE / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Görsel işleme bu cihazda kullanılamıyor.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
}

async function decodeImage(original) {
    if (typeof globalThis.createImageBitmap === 'function') {
        try {
            const bitmap = await globalThis.createImageBitmap(original);
            return { image: bitmap, cleanup: () => bitmap.close() };
        } catch (error) {
            console.warn('Native image bitmap decoding failed; using image element fallback.', { errorName: error.name });
        }
    }
    const objectUrl = URL.createObjectURL(original);
    const image = new Image();
    try {
        image.src = objectUrl;
        await image.decode();
        return { image, cleanup: () => URL.revokeObjectURL(objectUrl) };
    } catch (error) {
        URL.revokeObjectURL(objectUrl);
        throw error;
    }
}

/**
 * Resizes photos to at most an A4 long edge at 300 DPI and compresses large JPEGs.
 * Keeps smaller JPEGs intact and avoids increasing their size at unchanged dimensions.
 * @param {Blob} original Original photo.
 * @returns {Promise<Blob>} JPEG document image.
 * @throws {Error} When the photo cannot be decoded or encoded.
 */
export async function optimizeDocumentImage(original) {
    const canvas = document.createElement('canvas');
    let decodedImage;
    try {
        decodedImage = await decodeImage(original);
        const image = decodedImage.image;
        const isJpeg = original.type === 'image/jpeg';
        const { width, height } = getImageDimensions(image);
        const longestEdge = Math.max(width, height);
        const isWithinDimensions = longestEdge <= DOCUMENT_IMAGE_LONG_EDGE;
        if (isJpeg && isWithinDimensions && original.size <= DOCUMENT_IMAGE_JPEG_PASSTHROUGH_BYTES) return original;
        drawDocumentImage(image, canvas);
        const optimized = await encodeCanvas(canvas, DOCUMENT_IMAGE_JPEG_QUALITY);
        return isJpeg && isWithinDimensions && optimized.size >= original.size ? original : optimized;
    } catch (error) {
        console.error('Document photo optimization failed.', { errorName: error.name });
        throw new Error('Fotoğraf işlenemedi; JPG veya PNG olarak tekrar seçin.', { cause: error });
    } finally {
        decodedImage?.cleanup();
        canvas.width = canvas.height = 0;
    }
}
