import { loadPdfJs } from './pdfjs-loader.js';
import { optimizeDocumentImage } from './optimize-document-image.js';
import { PDFDocument, PageSizes } from 'pdf-lib';
import { DOCUMENT_IMAGE_LONG_EDGE } from '../config/mobile-transfer-policy.js';

const A4_PORTRAIT = PageSizes.A4;
const A4_LANDSCAPE = [PageSizes.A4[1], PageSizes.A4[0]];
const PAGE_MARGIN = 20;
const YOKSIS_SAFE_LIMIT_BYTES = 9 * 1024 * 1024;
const INITIAL_COMPRESSION_PERCENT = 40;
const COMPRESSION_STEP_PERCENT = 5;
const MAX_COMPRESSION_PERCENT = 95;

function readCompressionProfile(compressionPercent) {
    const step = (compressionPercent - INITIAL_COMPRESSION_PERCENT) / COMPRESSION_STEP_PERCENT;
    return {
        dpi: Math.max(60, Math.round(180 * (0.9 ** step))),
        quality: Math.max(0.18, Number((0.72 - (step * 0.06)).toFixed(2)))
    };
}

async function readBytes(input) {
    if (input instanceof Blob) return new Uint8Array(await input.arrayBuffer());
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return new Uint8Array(input);
}

function getFilePayload(file) {
    if (file instanceof Blob) return file;
    const payload = file.bytes;
    if (payload instanceof Blob || payload instanceof ArrayBuffer || ArrayBuffer.isView(payload)) return payload;
    return file;
}

function getInputSize(file) {
    if (Number.isSafeInteger(file.size)) return file.size;
    const input = getFilePayload(file);
    if (input instanceof Blob) return input.size;
    return input.byteLength ?? 0;
}

async function ensureJpegBytes(bytesOrBlob, mediaType = 'image/jpeg', profile) {
    const blob = bytesOrBlob instanceof Blob ? bytesOrBlob : new Blob([bytesOrBlob], { type: mediaType });
    const longEdge = profile ? Math.round(DOCUMENT_IMAGE_LONG_EDGE * profile.dpi / 300) : DOCUMENT_IMAGE_LONG_EDGE;
    const optimized = await optimizeDocumentImage(blob, { longEdge, quality: profile?.quality, forceCompression: Boolean(profile) });
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

async function appendImageToPdf(pdfDoc, bytes, mediaType, profile) {
    const jpegBytes = await ensureJpegBytes(bytes, mediaType, profile);
    const image = await pdfDoc.embedJpg(jpegBytes);
    const { pageWidth, pageHeight, drawWidth, drawHeight } = getPageSize(image.width, image.height);
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    page.drawImage(image, { x: (pageWidth - drawWidth) / 2, y: (pageHeight - drawHeight) / 2, width: drawWidth, height: drawHeight });
}

async function appendRasterizedPdf(pdfDoc, bytes, fileName, profile, onProgress) {
    const pdfjs = await loadPdfJs();
    const loadingTask = pdfjs.getDocument({ data: bytes });
    try {
        const sourcePdf = await loadingTask.promise;
        for (let pageNumber = 1; pageNumber <= sourcePdf.numPages; pageNumber += 1) {
            onProgress?.({ message: `${fileName}: sayfa ${pageNumber}/${sourcePdf.numPages} sıkıştırılıyor…` });
            await appendRasterPage(pdfDoc, sourcePdf, pageNumber, profile);
        }
    } catch (error) {
        console.error('PDF input could not be rendered.', { errorName: error.name });
        throw new Error(`${fileName} okunamadı; hiçbir belge atlanarak PDF oluşturulmadı.`, { cause: error });
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

function isPdfFile(file) {
    return (file.mediaType || file.type || '').toLowerCase().includes('pdf') || (file.name || '').toLowerCase().endsWith('.pdf');
}

async function buildPdf(files, profile, onProgress, options) {
    const mergedPdf = await PDFDocument.create();
    for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const bytes = await readBytes(getFilePayload(file));
        const mediaType = (file.mediaType || file.type || '').toLowerCase();
        const fileName = file.name || 'Belge';
        const isPdf = isPdfFile(file);
        onProgress?.({ current: index + 1, total: files.length, message: `İşleniyor (${index + 1}/${files.length}): ${fileName}` });
        if (isPdf && profile && options.rasterizePdfs !== false) await appendRasterizedPdf(mergedPdf, bytes, fileName, profile, onProgress);
        else if (isPdf) await appendVectorPdf(mergedPdf, bytes, fileName);
        else await appendImageToPdf(mergedPdf, bytes, mediaType, profile);
    }
    if (mergedPdf.getPageCount() === 0) throw new Error('Hiçbir geçerli sayfa birleştirilemedi.');
    return mergedPdf.save({ useObjectStreams: true });
}

/**
 * Builds an ordered PDF, preserving source PDF pages unless staged compression is needed to meet the YÖKSİS size limit.
 * @param {Array<{ name?: string, bytes?: Uint8Array|ArrayBuffer|Blob, mediaType?: string, type?: string, size?: number, isValidatedTransferPhoto?: boolean }|Blob>} files
 * @param {(progress: { current?: number, total?: number, message: string }) => void} [onProgress]
 * @param {{ rasterizePdfs?: boolean }} [options]
 * @returns {Promise<{ bytes: Uint8Array, metrics: { inputBytes: number, outputBytes: number, ratio: number, targetReached: boolean, yoksisLimitReached: boolean, rasterizedPdfs: boolean, compressionPercent: number|null, warning: string|null }}>}
 */
export async function mergeDocumentsToPdf(files, onProgress, options = {}) {
    if (!Array.isArray(files) || files.length === 0) throw new Error('Birleştirilecek dosya bulunamadı.');
    const inputBytes = files.reduce((total, file) => total + getInputSize(file), 0);
    const containsPdf = files.some(isPdfFile);
    const containsImages = files.some(file => !isPdfFile(file));
    const initialProfile = containsImages ? readCompressionProfile(INITIAL_COMPRESSION_PERCENT) : null;
    const initialOptions = { ...options, rasterizePdfs: false };
    let bytes = null;
    let compressionPercent = containsImages ? INITIAL_COMPRESSION_PERCENT : null;
    try {
        onProgress?.({ message: containsImages
            ? `PDF hızlıca birleştiriliyor; görseller için %${INITIAL_COMPRESSION_PERCENT} kademesi uygulanıyor…`
            : 'PDF sayfaları korunarak hızlıca birleştiriliyor…' });
        bytes = await buildPdf(files, initialProfile, onProgress, initialOptions);
    } catch (error) {
        if (!containsPdf || options.rasterizePdfs === false) throw error;
    }
    let rasterizedPdfs = false;
    if (!bytes || bytes.byteLength > YOKSIS_SAFE_LIMIT_BYTES) {
        const canRasterizePdfs = options.rasterizePdfs !== false;
        const firstCompressionPercent = containsPdf && canRasterizePdfs
            ? INITIAL_COMPRESSION_PERCENT
            : INITIAL_COMPRESSION_PERCENT + COMPRESSION_STEP_PERCENT;
        for (let level = firstCompressionPercent; level <= MAX_COMPRESSION_PERCENT; level += COMPRESSION_STEP_PERCENT) {
            if (!containsImages && (!containsPdf || !canRasterizePdfs)) break;
            onProgress?.({ message: `PDF 10 MB sınırını aşıyor; %${level} sıkıştırma kademesi deneniyor…` });
            bytes = await buildPdf(files, readCompressionProfile(level), onProgress,
                { ...options, rasterizePdfs: canRasterizePdfs });
            rasterizedPdfs = containsPdf && canRasterizePdfs;
            compressionPercent = level;
            if (bytes.byteLength <= YOKSIS_SAFE_LIMIT_BYTES) break;
        }
    }
    if (!bytes) throw new Error('PDF oluşturulamadı.');
    const ratio = inputBytes > 0 ? bytes.byteLength / inputBytes : 1;
    const yoksisLimitReached = bytes.byteLength <= YOKSIS_SAFE_LIMIT_BYTES;
    const targetReached = yoksisLimitReached;
    const warning = targetReached ? null
        : `%${MAX_COMPRESSION_PERCENT} sıkıştırma kademesinde de PDF 10 MB sınırının altına inmedi. Sayfa sayısını azaltıp tekrar deneyin.`;
    return {
        bytes,
        metrics: {
            inputBytes,
            outputBytes: bytes.byteLength,
            ratio,
            targetReached,
            yoksisLimitReached,
            rasterizedPdfs,
            compressionPercent,
            warning
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
