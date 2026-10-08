import { optimizeDocumentImage } from './optimize-document-image.js';
import { PDFDocument, PageSizes } from 'pdf-lib';

const A4_PORTRAIT = PageSizes.A4; // [595.28, 841.89]
const A4_LANDSCAPE = [PageSizes.A4[1], PageSizes.A4[0]]; // [841.89, 595.28]
const PAGE_MARGIN = 20;

/**
 * Converts image bytes/blob into JPEG bytes using browser canvas.
 * Works seamlessly with JPEG, PNG, WEBP, and other image types.
 */
async function ensureJpegBytes(bytesOrBlob, mediaType = 'image/jpeg') {
    const blob = bytesOrBlob instanceof Blob ? bytesOrBlob : new Blob([bytesOrBlob], { type: mediaType });
    const optimized = await optimizeDocumentImage(blob);
    return new Uint8Array(await optimized.arrayBuffer());
}

/**
 * Adds an image as a new page in the PDF document, scaling to fit A4.
 */
async function appendImageToPdf(pdfDoc, imageBytes, mediaType) {
    const jpegBytes = await ensureJpegBytes(imageBytes, mediaType);
    let embeddedImage;
    try {
        embeddedImage = await pdfDoc.embedJpg(jpegBytes);
    } catch {
        // Fallback: try embedPng if jpeg failed
        try {
            embeddedImage = await pdfDoc.embedPng(imageBytes);
        } catch (embedErr) {
            throw new Error(`Görsel PDF'e gömülemedi: ${embedErr.message}`);
        }
    }

    const imgWidth = embeddedImage.width;
    const imgHeight = embeddedImage.height;
    const isLandscape = imgWidth > imgHeight;
    const pageSize = isLandscape ? A4_LANDSCAPE : A4_PORTRAIT;

    const [pageWidth, pageHeight] = pageSize;
    const maxWidth = pageWidth - (PAGE_MARGIN * 2);
    const maxHeight = pageHeight - (PAGE_MARGIN * 2);

    const scale = Math.min(maxWidth / imgWidth, maxHeight / imgHeight, 1);
    const drawWidth = imgWidth * scale;
    const drawHeight = imgHeight * scale;

    const x = (pageWidth - drawWidth) / 2;
    const y = (pageHeight - drawHeight) / 2;

    const page = pdfDoc.addPage(pageSize);
    page.drawImage(embeddedImage, {
        x,
        y,
        width: drawWidth,
        height: drawHeight
    });
}

/**
 * Merges a list of files (PDFs and images) into a single unified PDF.
 * @param {Array<{ name?: string, bytes: Uint8Array|ArrayBuffer|Blob, mediaType: string }>} files
 * @param {(progress: { current: number, total: number, message: string }) => void} [onProgress]
 * @returns {Promise<Uint8Array>} Merged PDF bytes
 */
export async function mergeDocumentsToPdf(files, onProgress) {
    if (!Array.isArray(files) || files.length === 0) {
        throw new Error('Birleştirilecek dosya bulunamadı.');
    }

    const mergedPdf = await PDFDocument.create();
    const total = files.length;

    for (let index = 0; index < total; index++) {
        const file = files[index];
        const current = index + 1;
        if (onProgress) {
            onProgress({
                current,
                total,
                message: `İşleniyor (${current}/${total}): ${file.name || 'Belge'}`
            });
        }

        let rawBytes = file.bytes;
        if (rawBytes instanceof Blob) {
            rawBytes = new Uint8Array(await rawBytes.arrayBuffer());
        } else if (rawBytes instanceof ArrayBuffer) {
            rawBytes = new Uint8Array(rawBytes);
        }

        const mediaType = (file.mediaType || '').toLowerCase();
        const isPdf = mediaType.includes('pdf') || (file.name && file.name.toLowerCase().endsWith('.pdf'));

        if (isPdf) {
            try {
                const sourcePdf = await PDFDocument.load(rawBytes, { ignoreEncryption: true });
                const pageIndices = sourcePdf.getPageIndices();
                const copiedPages = await mergedPdf.copyPages(sourcePdf, pageIndices);
                for (const page of copiedPages) {
                    mergedPdf.addPage(page);
                }
            } catch (pdfErr) {
                console.error('PDF input could not be read.', { errorName: pdfErr.name });
                throw new Error(`${file.name || 'PDF'} okunamadı; hiçbir belge atlanarak PDF oluşturulmadı.`, { cause: pdfErr });
            }
        } else {
            // Image file (JPEG, PNG, WEBP, etc.)
            try {
                await appendImageToPdf(mergedPdf, rawBytes, mediaType);
            } catch (imgErr) {
                console.error('Image input could not be read.', { errorName: imgErr.name });
                throw new Error(`${file.name || 'Görsel'} okunamadı; hiçbir belge atlanarak PDF oluşturulmadı.`, { cause: imgErr });
            }
        }
    }

    if (mergedPdf.getPageCount() === 0) {
        throw new Error('Hiçbir geçerli sayfa birleştirilemedi.');
    }

    if (onProgress) {
        onProgress({ current: total, total, message: 'PDF kaydediliyor ve optimize ediliyor...' });
    }

    return await mergedPdf.save({ useObjectStreams: true });
}

/**
 * Downloads a Uint8Array or Blob as a file in the browser.
 */
export function downloadPdfFile(pdfBytesOrBlob, filename = 'birlestirilmis_belgeler.pdf') {
    const blob = pdfBytesOrBlob instanceof Blob
        ? pdfBytesOrBlob
        : new Blob([pdfBytesOrBlob], { type: 'application/pdf' });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
