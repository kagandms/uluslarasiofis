import { PDFDocument } from 'pdf-lib';

const MAX_EDITABLE_PAGES = 300;

/**
 * Restores saved PDF pages as independent editor inputs without rasterizing text or barcodes.
 * @param {Uint8Array} bytes Saved PDF bytes.
 * @returns {Promise<Array<{name: string, bytes: Uint8Array}>>} Ordered single-page PDFs.
 * @throws {Error} When the PDF cannot be read or exceeds the page limit.
 */
export async function splitPdfPages(bytes) {
    try {
        const source = await PDFDocument.load(bytes, { updateMetadata: false });
        const pageCount = source.getPageCount();
        if (pageCount < 1 || pageCount > MAX_EDITABLE_PAGES) throw new Error('PDF sayfa sayısı geçersiz.');
        const pages = [];
        // Sequential copying bounds memory while processing a potentially large saved PDF.
        for (const pageIndex of source.getPageIndices()) {
            const pageDocument = await PDFDocument.create();
            const [page] = await pageDocument.copyPages(source, [pageIndex]);
            pageDocument.addPage(page);
            pages.push({ name: `Sayfa-${String(pageIndex + 1).padStart(3, '0')}.pdf`,
                bytes: await pageDocument.save({ useObjectStreams: true }) });
        }
        return pages;
    } catch (error) {
        console.error('Saved PDF could not be opened for editing.', { errorName: error.name });
        throw new Error('Mevcut PDF düzenleme için açılamadı. Kayıt korunuyor; yenileyip tekrar deneyin.', { cause: error });
    }
}
