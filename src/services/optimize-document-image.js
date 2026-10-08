import { DOCUMENT_IMAGE_LONG_EDGE, DOCUMENT_IMAGE_JPEG_QUALITY, MAX_TRANSFER_FILE_BYTES } from '../config/mobile-transfer-policy.js';

function encodeCanvas(canvas, quality) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => {
        if (!blob) return reject(new Error('Belge görseli oluşturulamadı.'));
        resolve(blob);
    }, 'image/jpeg', quality));
}

/**
 * Resizes a photo to at most an A4 long edge at 300 DPI, preserving aspect and color.
 * @param {Blob} original Original photo.
 * @returns {Promise<Blob>} JPEG document image.
 * @throws {Error} When the photo cannot be decoded or encoded.
 */
export async function optimizeDocumentImage(original) {
    const objectUrl = URL.createObjectURL(original);
    const image = new Image();
    const canvas = document.createElement('canvas');
    try {
        image.src = objectUrl;
        await image.decode();
        if (original.type === 'image/jpeg' && original.size <= MAX_TRANSFER_FILE_BYTES && Math.max(image.naturalWidth, image.naturalHeight) <= DOCUMENT_IMAGE_LONG_EDGE) return original;
        const scale = Math.min(1, DOCUMENT_IMAGE_LONG_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Görsel işleme bu cihazda kullanılamıyor.');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return await encodeCanvas(canvas, DOCUMENT_IMAGE_JPEG_QUALITY);
    } catch (error) {
        console.error('Document photo optimization failed.', { errorName: error.name });
        throw new Error('Fotoğraf işlenemedi; JPG veya PNG olarak tekrar seçin.', { cause: error });
    } finally {
        URL.revokeObjectURL(objectUrl);
        canvas.width = canvas.height = 0;
    }
}
