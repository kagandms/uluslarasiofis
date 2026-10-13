import { PDFDocument } from 'pdf-lib';
import { ApiError } from '../domain/errors.js';
import { hashScannerValue } from '../domain/scanner-policy.js';
import { MAX_PHYSICAL_RECEIPT_PDF_BYTES } from '../../config/physical-document-limits.js';

/** Parses a real single-page portrait A4 PDF. @param {Uint8Array} bytes PDF. @returns {Promise<void>} Validation. @throws {ApiError} Invalid PDF. */
export async function validateReceiptPdf(bytes) {
    if (!bytes.length || bytes.length > MAX_PHYSICAL_RECEIPT_PDF_BYTES || new TextDecoder().decode(bytes.slice(0,5)) !== '%PDF-') throw new ApiError(400, 'INVALID_RECEIPT_PDF', 'Tek sayfalık A4 PDF gerekli.');
    try {
        const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
        if (pdf.getPageCount() !== 1) throw new Error('Single page required');
        const page = pdf.getPage(0);
        const size = page.getSize();
        if (Math.abs(size.width-595.28)>1 || Math.abs(size.height-841.89)>1 || page.getRotation().angle%360 !== 0) throw new Error('Portrait A4 required');
    } catch (error) {
        console.error('Receipt PDF validation failed.', { errorName: error.name });
        throw new ApiError(400, 'INVALID_RECEIPT_PDF', 'Şifresiz, tek sayfalık dikey A4 PDF gerekli.');
    }
}

/** Reads a bounded PDF stream without trusting content length. @param {Request} request PDF upload. @returns {Promise<Uint8Array>} Bytes. @throws {ApiError} Invalid size/type. */
export async function readReceiptPdfBody(request) {
    if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/pdf' || !request.body) throw new ApiError(415,'PDF_REQUIRED','PDF gerekli.');
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.length;
            if (size>MAX_PHYSICAL_RECEIPT_PDF_BYTES) { await reader.cancel(); throw new ApiError(413,'PDF_TOO_LARGE','PDF en fazla 10 MiB olabilir.'); }
            chunks.push(chunk.value);
        }
    } finally { reader.releaseLock(); }
    return new Uint8Array(await new Blob(chunks).arrayBuffer());
}

/** Gets immutable stored receipt bytes and verifies their digest. @param {object} environment R2 binding. @param {object} receipt Ready receipt.
 * @returns {Promise<Uint8Array>} Verified bytes. @throws {ApiError} Missing/changed artefact. */
export async function readStoredReceiptBytes(environment, receipt) {
    if (receipt.state !== 'ready') throw new ApiError(409,'RECEIPT_NOT_READY','A4 yeniden hazırlanmalı.');
    const object = await environment.DOCUMENTS.get(receipt.artefact_key);
    if (!object || object.size !== receipt.byte_size) throw new ApiError(409,'RECEIPT_NOT_READY','A4 dosyası bulunamadı.');
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (await hashScannerValue(bytes) !== receipt.sha256) throw new ApiError(409,'RECEIPT_CHANGED','A4 içeriği doğrulanamadı.');
    return bytes;
}

/** Writes once then binds; retries recover an R2/D1 interruption. @param {object} context Authorized bindings/repository. @param {object} receipt Snapshot. @param {Uint8Array} bytes Validated PDF.
 * @returns {Promise<object>} Winning immutable receipt. @throws {ApiError} Stale or unavailable content. */
export async function bindReceiptContent(context, receipt, bytes) {
    if (receipt.state === 'ready') return receipt;
    if (!JSON.parse(receipt.snapshot_json).portal_origin) throw new ApiError(503,'PORTAL_ORIGIN_INVALID','Portal adresi yapılandırılmalı.');
    if (receipt.state === 'purged') throw new ApiError(409,'RECEIPT_PURGED','Yeni A4 sürümü hazırlayın.');
    if (receipt.metadata_version !== context.intake.metadata_version) throw new ApiError(409,'RECEIPT_STALE','Bilgiler değişti; yeni A4 hazırlayın.');
    await validateReceiptPdf(bytes);
    const sha256 = await hashScannerValue(bytes);
    const key = `receipts/${receipt.id}/${sha256}.pdf`;
    await context.environment.DOCUMENTS.put(key, bytes, { onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/pdf' }, customMetadata: { sha256 } });
    const head = await context.environment.DOCUMENTS.head(key);
    const stored = await context.environment.DOCUMENTS.get(key);
    if (!head || head.size !== bytes.length || !stored || await hashScannerValue(new Uint8Array(await stored.arrayBuffer())) !== sha256) throw new ApiError(502,'RECEIPT_STORAGE_FAILED','A4 saklanamadı. Tekrar deneyin.');
    await context.receipts.bindContent({ id: receipt.id, key, sha256, byteSize: bytes.length });
    const saved = await context.receipts.receipt(receipt.id);
    if (saved.state !== 'ready') throw new ApiError(409,'RECEIPT_STALE','Bilgiler değişti; yeni A4 hazırlayın.');
    return saved;
}
