import { optimizeDocumentImage } from './optimize-document-image.js';
import { PDFDocument, PageSizes } from 'pdf-lib';

const A4_PORTRAIT = PageSizes.A4;
const A4_LANDSCAPE = [PageSizes.A4[1], PageSizes.A4[0]];
const PAGE_MARGIN = 20;
const TARGET_RATIO = 0.4;
const COMPRESSION_PROFILES = [
    { dpi: 180, quality: 0.78 },
    { dpi: 160, quality: 0.68 },
    { dpi: 144, quality: 0.58 }
];

async function readBytes(input) {
    if (input instanceof Blob) return new Uint8Array(await input.arrayBuffer());
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    return new Uint8Array(input);
}

function getInputSize(file) {
    const input = file.bytes ?? file;
    if (Number.isSafeInteger(file.size)) return file.size;
    if (input instanceof Blob) return input.size;
    return input.byteLength ?? 0;
}

async function ensureJpegBytes(bytesOrBlob, mediaType = 'image/jpeg') {
    const blob = bytesOrBlob instanceof Blob ? bytesOrBlob : new Blob([bytesOrBlob], { type: mediaType });
    const optimized = await optimizeDocumentImage(blob);
    return new Uint8Array(await optimized.arrayBuffer());
}

function getPageSize(width, height) {
    const ratio = width / height;
    const isLandscape = ratio > 1;
    const [pageWidth, pageHeight] = isLandscape ? A4_LANDSCAPE : A4_PORTRAIT;
    const maxWidth = pageWidth - PAGE_MARGIN * 2;
    const maxHeight = pageHeight - PAGE_MARGIN * 2;
    const scale = Math.min(maxWidth / width, maxHeight / height, 1);
    return { pageWidth, pageHeight, drawWidth: width * scale, drawHeight: height * scale };
}

async function appendImageToPdf(pdfDoc, bytes, mediaType, isValidatedTransferPhoto) {
    const jpegBytes = isValidatedTransferPhoto ? bytes : await ensureJpegBytes(bytes, mediaType);
    const image = await pdfDoc.embedJpg(jpegBytes);
    const { pageWidth, pageHeight, drawWidth, drawHeight } = getPageSize(image.width, image.height);
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    page.drawImage(image, { x: (pageWidth - drawWidth) / 2, y: (pageHeight - drawHeight) / 2, width: drawWidth, height: drawHeight });
}

function getPdfJs() {
    const pdfjs = globalThis.window?.pdfjsLib;
    if (!pdfjs?.getDocument) throw new Error('PDF sıkıştırma bileşeni hazır değil. Sayfayı yenileyip tekrar deneyin.');
    return pdfjs;
}

async function appendRasterizedPdf(pdfDoc, bytes, fileName, profile, onProgress) {
    const pdfjs = getPdfJs();
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const sourcePdf = await loadingTask.promise;
    try {
        for (let pageNumber = 1; pageNumber <= sourcePdf.numPages; pageNumber += 1) {
            onProgress?.({ message: `${fileName}: sayfa ${pageNumber}/${sourcePdf.numPages} sıkıştırılıyor…` });
            await appendRasterPage(pdfDoc, sourcePdf, pageNumber, profile);
        }
    } finally {
        await loadingTask.destroy?.();
    }
}

async function appendRasterPage(pdfDoc, sourcePdf, pageNumber, profile) {
    const page = await sourcePdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: profile.dpi / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    try {
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const blob = await canvasToJpeg(canvas, profile.quality);
        const image = await pdfDoc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        const size = page.getViewport({ scale: 1 });
        const outputPage = pdfDoc.addPage([size.width, size.height]);
        outputPage.drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
    } finally {
        page.cleanup?.();
        canvas.width = 0;
        canvas.height = 0;
    }
}

async function appendVectorPdf(pdfDoc, bytes, fileName) {
    try {
        const sourcePdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await pdfDoc.copyPages(sourcePdf, sourcePdf.getPageIndices());
        pages.forEach(page => pdfDoc.addPage(page));
    } catch (error) {
        console.error('PDF input could not be read.', { errorName: error.name });
        throw new Error(`${fileName} okunamadı; hiçbir belge atlanarak PDF oluşturulmadı.`, { cause: error });
    }
}

function canvasToJpeg(canvas, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PDF sayfası görüntüye dönüştürülemedi.')), 'image/jpeg', quality);
    });
}

async function buildPdf(files, profile, onProgress) {
    const mergedPdf = await PDFDocument.create();
    for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const bytes = await readBytes(file.bytes ?? file);
        const mediaType = (file.mediaType || file.type || '').toLowerCase();
        const fileName = file.name || 'Belge';
        const isPdf = mediaType.includes('pdf') || fileName.toLowerCase().endsWith('.pdf');
        onProgress?.({ current: index + 1, total: files.length, message: `İşleniyor (${index + 1}/${files.length}): ${fileName}` });
        if (isPdf && profile) await appendRasterizedPdf(mergedPdf, bytes, fileName, profile, onProgress);
        else if (isPdf) await appendVectorPdf(mergedPdf, bytes, fileName);
        else await appendImageToPdf(mergedPdf, bytes, mediaType, file.isValidatedTransferPhoto === true);
    }
    if (mergedPdf.getPageCount() === 0) throw new Error('Hiçbir geçerli sayfa birleştirilemedi.');
    return mergedPdf.save({ useObjectStreams: true });
}

/**
 * Builds an ordered PDF and rasterizes source PDF pages to target roughly 40% of input bytes.
 * @param {Array<{ name?: string, bytes?: Uint8Array|ArrayBuffer|Blob, mediaType?: string, type?: string, size?: number, isValidatedTransferPhoto?: boolean }|Blob>} files
 * @param {(progress: { current?: number, total?: number, message: string }) => void} [onProgress]
 * @param {{ rasterizePdfs?: boolean }} [options]
 * @returns {Promise<{ bytes: Uint8Array, metrics: { inputBytes: number, outputBytes: number, ratio: number, targetReached: boolean, warning: string|null }>}>
 */
export async function mergeDocumentsToPdf(files, onProgress, options = {}) {
    if (!Array.isArray(files) || files.length === 0) throw new Error('Birleştirilecek dosya bulunamadı.');
    const inputBytes = files.reduce((total, file) => total + getInputSize(file), 0);
    const containsPdf = files.some(file => (file.mediaType || file.type || '').toLowerCase().includes('pdf')
        || (file.name || '').toLowerCase().endsWith('.pdf'));
    const profiles = !containsPdf || options.rasterizePdfs === false ? [null] : COMPRESSION_PROFILES;
    let bytes;
    for (const profile of profiles) {
        bytes = await buildPdf(files, profile, onProgress);
        if (!profile || bytes.byteLength <= inputBytes * TARGET_RATIO) break;
    }
    const ratio = inputBytes > 0 ? bytes.byteLength / inputBytes : 1;
    const targetReached = ratio <= TARGET_RATIO;
    return {
        bytes,
        metrics: {
            inputBytes,
            outputBytes: bytes.byteLength,
            ratio,
            targetReached,
            rasterizedPdfs: containsPdf && options.rasterizePdfs !== false,
            warning: targetReached ? null : 'Okunabilirlik için en düşük kalite korunmuştur; PDF %40 hedefe ulaşmadı. Kaydetmeden önce sayfaları kontrol edin.'
        }
    };
}

/** Downloads a Uint8Array or Blob as a file in the browser. */
export function downloadPdfFile(pdfBytesOrBlob, filename = 'birlestirilmis_belgeler.pdf') {
    const blob = pdfBytesOrBlob instanceof Blob ? pdfBytesOrBlob : new Blob([pdfBytesOrBlob], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
