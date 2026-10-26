const MAX_SOURCE_FILES = 20;
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_OUTPUT_PAGES = 100;
const PAGE_SIZE_A4 = Object.freeze([595.28, 841.89]);
const SUPPORTED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

/**
 * Combines files selected for one document requirement into a single PDF.
 * @param {File[]} files Files selected from the same requirement card.
 * @param {{maxByteSize: number, document?: Document}} options Current server size limit and browser document.
 * @returns {Promise<File>} A PDF whose pages follow the selection order.
 * @throws {Error} When input files are invalid, exceed bounds, or cannot be combined.
 */
export async function createMultiPageDocumentPdf(files, { maxByteSize, document = globalThis.document } = {}) {
    if (!Array.isArray(files) || files.length < 1 || files.length > MAX_SOURCE_FILES) {
        throw createUploadError(files?.length > MAX_SOURCE_FILES ? 'TOO_MANY_FILES' : 'INVALID_FILE');
    }
    if (!Number.isSafeInteger(maxByteSize) || maxByteSize < 1
        || files.some((file) => !file || !Number.isSafeInteger(file.size) || file.size < 1 || !SUPPORTED_TYPES.has(file.type))) {
        throw createUploadError('INVALID_FILE');
    }
    const totalSourceBytes = files.reduce((total, file) => total + file.size, 0);
    if (!Number.isSafeInteger(totalSourceBytes) || totalSourceBytes > MAX_SOURCE_BYTES
        || files.some((file) => file.size > maxByteSize)) {
        throw createUploadError('FILE_TOO_LARGE');
    }

    const { PDFDocument } = await import('pdf-lib');
    const combined = await PDFDocument.create();
    try {
        for (const file of files) {
            if (file.type === 'application/pdf') {
                const source = await PDFDocument.load(await file.arrayBuffer());
                const pages = await combined.copyPages(source, source.getPageIndices());
                pages.forEach((page) => combined.addPage(page));
            } else {
                const bytes = file.type === 'image/webp'
                    ? await convertWebpToJpeg(file, document)
                    : new Uint8Array(await file.arrayBuffer());
                const image = file.type === 'image/png'
                    ? await combined.embedPng(bytes)
                    : await combined.embedJpg(bytes);
                const page = combined.addPage(PAGE_SIZE_A4);
                const scale = Math.min(PAGE_SIZE_A4[0] / image.width, PAGE_SIZE_A4[1] / image.height);
                const width = image.width * scale;
                const height = image.height * scale;
                page.drawImage(image, {
                    x: (PAGE_SIZE_A4[0] - width) / 2,
                    y: (PAGE_SIZE_A4[1] - height) / 2,
                    width,
                    height
                });
            }
            if (combined.getPageCount() > MAX_OUTPUT_PAGES) throw createUploadError('TOO_MANY_FILES');
        }
        const bytes = await combined.save();
        if (bytes.byteLength > maxByteSize) throw createUploadError('FILE_TOO_LARGE');
        return new File([bytes], 'combined-document.pdf', { type: 'application/pdf' });
    } catch (error) {
        if (error?.code) throw error;
        throw createUploadError('MULTI_FILE_PROCESSING_FAILED', error);
    }
}

async function convertWebpToJpeg(file, document) {
    if (typeof createImageBitmap !== 'function' || !document) throw createUploadError('MULTI_FILE_PROCESSING_FAILED');
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
        const scale = Math.min(1, 2480 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw createUploadError('MULTI_FILE_PROCESSING_FAILED');
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
        if (!blob) throw createUploadError('MULTI_FILE_PROCESSING_FAILED');
        return new Uint8Array(await blob.arrayBuffer());
    } finally {
        bitmap.close();
    }
}

function createUploadError(code, cause) {
    return Object.assign(new Error(code), { code, cause });
}
