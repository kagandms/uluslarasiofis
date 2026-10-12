import { createServer } from 'vite';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

const { chromium } = await import(process.env.RECEIPT_QA_PLAYWRIGHT_MODULE || 'playwright');
const outputDirectory = resolve(process.env.RECEIPT_QA_OUTPUT || 'docs/physical-receipt-local-evidence');
const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 5199, strictPort: true } });
server.middlewares.use('/receipt-qa', (_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html lang="tr"><head><title>Synthetic receipt QA</title></head><body><main id="receipt"></main></body></html>');
});
await server.listen();
const browser = await chromium.launch({ headless: true, channel: process.env.RECEIPT_QA_BROWSER || 'chrome' });
const results = [];
try {
    await mkdir(outputDirectory, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 1200 } });
    let fontRequests = 0;
    page.on('request', request => { if (request.url().endsWith('.ttf')) fontRequests++; });
    await page.goto('http://127.0.0.1:5199/receipt-qa');
    for (const variant of ['normal', 'long']) {
        const snapshot = { first_name: variant === 'long' ? 'ÖĞRENCİ Русский '.repeat(8).slice(0, 120) : 'Synthetic Öğrenci',
            last_name: variant === 'long' ? 'Türkmen Ýň العربية '.repeat(8).slice(0, 120) : 'Test Student',
            passport_number: variant === 'long' ? 'SYNTHETIC12345678'.repeat(4) : 'SYNTHETIC-TEST',
            created_at: '2026-10-12T00:00:00Z', application_date: '2026-10-12', tracking_reference: 'ITU-26-ABCDEFG', portal_origin: 'https://goc.topkapiuni.workers.dev' };
        const rendered = await page.evaluate(async snapshot => {
            const { renderPhysicalReceiptPdf } = await import('/src/services/physical-receipt-pdf.js');
            const { createPhysicalReceiptTemplate } = await import('/src/services/physical-receipt-template.js');
            const { loadDocumentLogos, waitDocumentAssets } = await import('/src/services/document-logo-loader.js');
            const bytes = await renderPhysicalReceiptPdf(snapshot);
            const root = createPhysicalReceiptTemplate(document, snapshot, await loadDocumentLogos());
            document.querySelector('main').replaceChildren(root);
            await waitDocumentAssets(root);
            return { bytes: Array.from(bytes), overflow: root.scrollHeight > root.clientHeight + 1,
                languages: [...root.querySelectorAll('section')].map(section => section.lang),
                logos: [...root.querySelectorAll('img')].map(image => ({ width: image.naturalWidth, source: image.src.slice(0, 22) })),
                arabicDirection: root.querySelector('[lang=ar]').dir };
        }, snapshot);
        const bytes = Uint8Array.from(rendered.bytes);
        const pdf = await PDFDocument.load(bytes);
        assert.equal(pdf.getPageCount(), 1);
        assert.deepEqual(pdf.getPage(0).getSize(), { width: 595.28, height: 841.89 });
        assert.equal(rendered.overflow, false);
        assert.deepEqual(rendered.languages, ['tr', 'en', 'ru', 'tk', 'ar']);
        assert.equal(rendered.arabicDirection, 'rtl');
        assert.ok(rendered.logos.every(logo => logo.width > 0 && logo.source.startsWith('data:image/')));
        await writeFile(resolve(outputDirectory, `receipt-${variant}-synthetic.pdf`), bytes);
        await page.locator('.physical-receipt-sheet').screenshot({ path: resolve(outputDirectory, `receipt-${variant}-synthetic.png`) });
        execFileSync('pdftoppm', ['-scale-to', '1200', '-png', '-singlefile', resolve(outputDirectory, `receipt-${variant}-synthetic.pdf`), resolve(outputDirectory, `receipt-${variant}-pdf-render`)]);
        const renderedPng = await readFile(resolve(outputDirectory, `receipt-${variant}-pdf-render.png`));
        const visibleLogos = await page.evaluate(async source => {
            const image = new Image(); image.src = source; await image.decode();
            const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let left = 0; let right = 0;
            for (let y = 0; y < canvas.height * 0.13; y++) {
                for (let x = 0; x < canvas.width; x++) {
                    const offset = (y * canvas.width + x) * 4;
                    if (pixels[offset] > 60 && pixels[offset] > pixels[offset + 1] * 1.5 && pixels[offset] > pixels[offset + 2] * 1.5) {
                        if (x < canvas.width * 0.25) left++;
                        if (x > canvas.width * 0.75) right++;
                    }
                }
            }
            return { left, right };
        }, `data:image/png;base64,${renderedPng.toString('base64')}`);
        assert.ok(visibleLogos.left > 20 && visibleLogos.right > 10, 'Both logos must survive the actual PDF raster, including a scrolled workspace');
        results.push({ variant, visiblePdfLogoPixels: visibleLogos, byteSize: bytes.length, pageCount: pdf.getPageCount(), languages: rendered.languages, arabicDirection: rendered.arabicDirection });
    }
    const missingAsset = await page.evaluate(async () => {
        const { renderPhysicalReceiptPdf } = await import('/src/services/physical-receipt-pdf.js');
        const original = window.fetch;
        window.fetch = async (...args) => String(args[0]).includes('goc_logo.png') ? new Response('', { status: 404 }) : original(...args);
        try {
            await renderPhysicalReceiptPdf({ first_name: 'Synthetic', last_name: 'Test', passport_number: 'TEST', created_at: '2026-10-12T00:00:00Z', application_date: '2026-10-12', tracking_reference: 'ITU-26-ABCDEFG', portal_origin: 'https://goc.topkapiuni.workers.dev' });
            return false;
        } catch { return true; }
        finally { window.fetch = original; }
    });
    assert.equal(missingAsset, true);
    const cover = await page.evaluate(async () => {
        const { getDocumentHtml } = await import('/src/services/pdfGenerator.js');
        const { prepareDocumentLogos } = await import('/src/services/document-logo-loader.js');
        const html2canvas = (await import('/node_modules/html2canvas/dist/html2canvas.esm.js')).default;
        const root = document.querySelector('main');
        root.innerHTML = getDocumentHtml('SYNTHETIC', '12.10.2026', '', 'SYNTHETIC', 'Synthetic', 'Student', 'TEST', '01.01.2000', 'İstanbul', 'TEST', 'TEST', 2026, '19.10.2026');
        await prepareDocumentLogos(root);
        const canvas = await html2canvas(root.querySelector('#pdf-canvas-content'), { scale: 2, logging: false });
        return { png: canvas.toDataURL('image/png'), logos: [...root.querySelectorAll('img')].map(image => image.naturalWidth) };
    });
    assert.ok(cover.logos.every(width => width > 0));
    const coverPdf = await PDFDocument.create();
    const coverImage = await coverPdf.embedPng(cover.png);
    coverPdf.addPage([595.28, 841.89]).drawImage(coverImage, { x: 0, y: 0, width: 595.28, height: 841.89 });
    await writeFile(resolve(outputDirectory, 'cover-synthetic.pdf'), await coverPdf.save());
    await writeFile(resolve(outputDirectory, 'cover-synthetic.png'), Buffer.from(cover.png.split(',')[1], 'base64'));
    const coverPrint = await page.evaluate(async () => {
        const { printDocument } = await import('/src/services/pdfGenerator.js');
        const wrapper = document.createElement('form');
        for (const [field, value] of [['adi', 'Synthetic'], ['soyadi', 'Student'], ['pasaport-no', 'SYNTHETIC'], ['teslim-tarihi', '12.10.2026']]) {
            const input = document.createElement('input'); input.dataset.field = field; input.value = value; wrapper.append(input);
        }
        document.body.append(wrapper);
        const button = document.createElement('button'); button.textContent = 'Kapak Yazdır';
        const printArea = document.createElement('div'); printArea.id = 'print-area'; document.body.append(printArea);
        let printCalls = 0; let decodedAtPrint = false;
        window.print = () => { printCalls++; decodedAtPrint = [...printArea.querySelectorAll('img')].every(image => image.naturalWidth > 0 && image.src.startsWith('data:')); };
        await printDocument(button, wrapper);
        const original = window.fetch;
        window.fetch = async (...args) => String(args[0]).includes('goc_logo.png') ? new Response('', { status: 404 }) : original(...args);
        try { await printDocument(button, wrapper); }
        finally { window.fetch = original; }
        return { printCalls, decodedAtPrint, restoredButton: button.textContent === 'Kapak Yazdır' };
    });
    assert.deepEqual(coverPrint, { printCalls: 1, decodedAtPrint: true, restoredButton: true });
    assert.equal(fontRequests, 2, 'Repeated receipts must reuse the two loaded font faces');
    await writeFile(resolve(outputDirectory, 'render-results.json'), JSON.stringify({ fontRequests, results, missingAssetFailsClosed: missingAsset, coverLogosDecoded: cover.logos, coverPrint }, null, 2));
} finally {
    await browser.close();
    await server.close();
}
