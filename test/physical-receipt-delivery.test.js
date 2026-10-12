import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { reservePhysicalReceiptPreview, deliverPhysicalReceiptPdf } from '../src/staff/physical-receipt-delivery.js';

test('reserves the preview before asynchronous work and removes its opener', () => {
    const preview = { opener: {}, document: { title: '', body: {} } };
    const browser = { open: (url, target) => { assert.equal(url, ''); assert.equal(target, '_blank'); return preview; } };

    const reserved = reservePhysicalReceiptPreview(browser);

    assert.equal(reserved, preview);
    assert.equal(preview.opener, null);
    assert.match(preview.document.body.textContent, /hazırlanıyor/);
});

test('opens and downloads the same authenticated PDF without navigating the workspace', () => {
    const dom = new JSDOM('<main>Preserved workspace</main>', { url: 'https://portal.test' });
    const document = dom.window.document;
    const downloads = [];
    dom.window.HTMLAnchorElement.prototype.click = function () { downloads.push({ href: this.href, filename: this.download }); };
    let opened;
    const preview = { closed: false, location: { replace: url => { opened = url; } } };

    const result = deliverPhysicalReceiptPdf({ document, preview, intake: { id: 'intake', tracking_reference: 'ITU-26-ABCDEFG' }, receipt: { id: 'receipt' } });

    assert.equal(opened, result.previewUrl);
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].filename, 'ITU-26-ABCDEFG.pdf');
    assert.ok(downloads[0].href.endsWith('/intake/receipts/receipt?download=1'));
    assert.equal(document.querySelector('main').textContent, 'Preserved workspace');
    assert.equal(document.querySelector('a'), null);
    dom.window.close();
});

test('a blocked PDF tab still downloads and returns a manual preview link', () => {
    const dom = new JSDOM('<main></main>', { url: 'https://portal.test' });
    let downloads = 0;
    dom.window.HTMLAnchorElement.prototype.click = () => { downloads++; };
    const preview = reservePhysicalReceiptPreview({ open: () => null });

    const result = deliverPhysicalReceiptPdf({ document: dom.window.document, preview, intake: { id: 'intake', tracking_reference: 'ITU-26-ABCDEFG' }, receipt: { id: 'receipt' } });

    assert.equal(result.hasPreview, false);
    assert.equal(downloads, 1);
    assert.ok(result.previewUrl.endsWith('?preview=1'));
    dom.window.close();
});

test('delivers instant in-memory blob URL to preview and download while returning durable server links', () => {
    const dom = new JSDOM('<main></main>', { url: 'https://portal.test' });
    const document = dom.window.document;
    const downloads = [];
    dom.window.HTMLAnchorElement.prototype.click = function () { downloads.push({ href: this.href, filename: this.download }); };
    let opened;
    const preview = { closed: false, location: { replace: url => { opened = url; } } };
    const blobUrl = 'blob:https://portal.test/synthetic-pdf';

    const result = deliverPhysicalReceiptPdf({
        document,
        preview,
        intake: { id: 'intake', tracking_reference: 'ITU-26-ABCDEFG' },
        receipt: { id: 'receipt' },
        blobUrl
    });

    assert.equal(opened, blobUrl);
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].href, blobUrl);
    assert.equal(downloads[0].filename, 'ITU-26-ABCDEFG.pdf');
    assert.ok(result.previewUrl.endsWith('/intake/receipts/receipt?preview=1'));
    assert.ok(result.downloadUrl.endsWith('/intake/receipts/receipt?download=1'));
    dom.window.close();
});
