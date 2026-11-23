/**
 * Builds a multi-copy PDF Blob from an existing office document PDF using `pdf-lib`.
 */

import { STAFF_ASSISTANT_MAX_COPIES } from '../shared/staff-assistant-contract.js';

const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

/**
 * Duplicates all pages of a source PDF `copies` times into a single PDF Blob.
 *
 * @param {string} fileUrl Relative or same-origin URL of the source PDF document.
 * @param {number} copies Integer copy count between 1 and 50 inclusive.
 * @param {{ fetcher?: typeof fetch, PDFDocument?: { load: Function, create: Function } }} [options]
 * @returns {Promise<Blob>} Generated PDF Blob with `sourcePages * copies` pages.
 */
export async function buildCopiesPdfBlob(fileUrl, copies, { fetcher = fetch, PDFDocument } = {}) {
    if (!Number.isInteger(copies) || copies < 1 || copies > STAFF_ASSISTANT_MAX_COPIES) {
        throw new Error('invalid-copies');
    }

    if (typeof fileUrl !== 'string' || fileUrl.trim().length === 0 || typeof fetcher !== 'function') {
        throw new Error('source-unavailable');
    }

    let response;
    try {
        response = await fetcher(fileUrl, { credentials: 'same-origin' });
    } catch {
        throw new Error('source-unavailable');
    }

    if (!response?.ok) {
        throw new Error('source-unavailable');
    }

    let sourceBuffer;
    try {
        sourceBuffer = await response.arrayBuffer();
    } catch {
        throw new Error('source-unavailable');
    }

    if (!sourceBuffer || sourceBuffer.byteLength === 0) {
        throw new Error('source-unavailable');
    }

    const PdfDocumentClass = PDFDocument || (await import('pdf-lib')).PDFDocument;

    let sourceDoc;
    try {
        sourceDoc = await PdfDocumentClass.load(sourceBuffer);
    } catch {
        throw new Error('source-unavailable');
    }

    const pageIndices = sourceDoc.getPageIndices();
    if (!Array.isArray(pageIndices) || pageIndices.length === 0) {
        throw new Error('source-unavailable');
    }

    const outputDoc = await PdfDocumentClass.create();
    for (let copyIndex = 0; copyIndex < copies; copyIndex += 1) {
        const copiedPages = await outputDoc.copyPages(sourceDoc, pageIndices);
        for (const page of copiedPages) {
            outputDoc.addPage(page);
        }
    }

    const outputBytes = await outputDoc.save();
    if (outputBytes.byteLength > MAX_OUTPUT_BYTES) {
        throw new Error('too-large');
    }

    return new Blob([outputBytes], { type: 'application/pdf' });
}
