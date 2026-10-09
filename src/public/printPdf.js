import { PDFDocument } from 'pdf-lib';

const MAX_BYTES = 10 * 1024 * 1024;

/** Create a bounded PDF containing exactly the zero-based selected source pages. */
export async function extractPdfPages(file, pageIndexes) {
    if (!Array.isArray(pageIndexes) || pageIndexes.length < 1 || pageIndexes.length > 20) {
        throw new Error('Bir yazdırma işi 1 ile 20 sayfa arasında olmalı.');
    }
    const sourcePdf = await PDFDocument.load(await file.arrayBuffer());
    const pageCount = sourcePdf.getPageCount();
    if (pageIndexes.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= pageCount)
        || new Set(pageIndexes).size !== pageIndexes.length) {
        throw new Error('PDF sayfa seçimi geçersiz.');
    }
    const outputPdf = await PDFDocument.create();
    const copiedPages = await outputPdf.copyPages(sourcePdf, pageIndexes);
    for (const page of copiedPages) outputPdf.addPage(page);
    const bytes = await outputPdf.save();
    if (bytes.byteLength > MAX_BYTES) throw new Error('Seçilen sayfaların PDF dosyası 10 MB sınırını aşıyor.');
    const baseName = file.name.replace(/\.pdf$/i, '');
    return new File([bytes], `${baseName}-sayfalar.pdf`, { type: 'application/pdf' });
}
