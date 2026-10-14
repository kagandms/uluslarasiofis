import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const settle = async () => {
    for (let cycle = 0; cycle < 5; cycle += 1) await new Promise(resolve => setImmediate(resolve));
};

async function createPhoneFixture(context, testName) {
    const dom = new JSDOM(`<main><div class="transfer-status"><p id="status"></p></div>
        <button id="capture"></button><button id="choose"></button>
        <input id="camera" type="file"><input id="gallery" type="file">
        <button id="send"></button><div id="preview"></div><span id="photo-count"></span>
        <p id="preview-empty"></p></main>`, { url: 'https://portal.test/mobile-transfer/#claim-token' });
    const restoreGlobals = [];
    for (const [name, value] of Object.entries({ document: dom.window.document, location: dom.window.location,
        history: dom.window.history, sessionStorage: dom.window.sessionStorage, File: dom.window.File,
        Image: class { async decode() {} get naturalWidth() { return 100; } get naturalHeight() { return 100; } } })) {
        const previous = Object.getOwnPropertyDescriptor(globalThis, name);
        Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
        restoreGlobals.push(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
    }
    context.after(() => { for (const restore of restoreGlobals.reverse()) restore(); dom.window.close(); });
    context.mock.method(URL, 'createObjectURL', () => 'blob:photo');
    context.mock.method(URL, 'revokeObjectURL', () => {});
    let isPcImportConfirmed = false;
    let isTransferClosed = false;
    let uploadedPhotoId;
    const requests = [];
    context.mock.method(globalThis, 'fetch', async (path, options = {}) => {
        requests.push({ path, options });
        if (path.endsWith('/claim')) return Response.json({ id: 'transfer-1', expires_at: Math.floor(Date.now() / 1000) + 3600 });
        if (path.endsWith('/batch')) {
            if (isTransferClosed) return Response.json({ error: { code: 'TRANSFER_EXPIRED', message: 'Aktarım kapandı.' } }, { status: 410 });
            return Response.json({ batchId: 'batch-1', receivedPhotoIds: isPcImportConfirmed ? [uploadedPhotoId] : [] });
        }
        if (options.method === 'POST') {
            uploadedPhotoId = options.headers['X-Photo-Id'];
            return Response.json({ id: uploadedPhotoId, received: true });
        }
        throw new Error(`Unexpected request ${path}`);
    });
    const pollIntervals = [];
    const clearedIntervals = [];
    context.mock.method(globalThis, 'setInterval', callback => { pollIntervals.push(callback); return pollIntervals.length; });
    context.mock.method(globalThis, 'clearInterval', interval => clearedIntervals.push(interval));
    await import(`../src/mobile-transfer/main.js?test=${testName}`);
    await settle();
    return { dom, requests, pollIntervals, clearedIntervals,
        confirmImport: () => { isPcImportConfirmed = true; }, closeTransfer: () => { isTransferClosed = true; } };
}

test('camera photos upload immediately and show sent only after PC import confirmation', async (context) => {
    const fixture = await createPhoneFixture(context, 'auto-camera');
    const { dom, requests, pollIntervals } = fixture;
    const camera = dom.window.document.getElementById('camera');
    const photo = new dom.window.File([new Uint8Array([1, 2, 3])], 'passport.jpg', { type: 'image/jpeg' });
    Object.defineProperty(camera, 'files', { configurable: true, value: [photo] });
    camera.dispatchEvent(new dom.window.Event('change'));
    await settle();

    assert.equal(requests.some(request => request.options.method === 'POST' && request.path.endsWith('/photos')), true);
    assert.equal(dom.window.document.querySelector('#preview figcaption').textContent, '1. fotoğraf · PC alıyor…');
    assert.equal(dom.window.document.getElementById('send').hidden, true);
    const preview = dom.window.document.getElementById('preview');
    const originalImage = preview.querySelector('img');
    preview.scrollTop = 120;

    fixture.confirmImport();
    await pollIntervals[0]();
    await settle();

    assert.equal(dom.window.document.querySelector('#preview figcaption').textContent, '1. fotoğraf · Gönderildi');
    assert.equal(preview.querySelector('img'), originalImage);
    assert.equal(preview.scrollTop, 120);
    assert.match(dom.window.document.getElementById('status').textContent, /PC’ye gönderildi/);
});

test('a closed QR stops phone polling and requires pairing a new QR', async (context) => {
    const fixture = await createPhoneFixture(context, 'closed-transfer');
    const { dom, requests, pollIntervals, clearedIntervals } = fixture;
    const gallery = dom.window.document.getElementById('gallery');
    const selectedPhoto = new dom.window.File([new Uint8Array([1, 2, 3])], 'document.jpg', { type: 'image/jpeg' });
    Object.defineProperty(gallery, 'files', { configurable: true, value: [selectedPhoto] });
    gallery.dispatchEvent(new dom.window.Event('change'));

    fixture.closeTransfer();
    pollIntervals[0]();
    await settle();
    const closedRequestCount = requests.length;
    pollIntervals[0]();
    await settle();

    assert.deepEqual(clearedIntervals, [1]);
    assert.equal(requests.length, closedRequestCount);
    assert.equal(dom.window.sessionStorage.getItem('mobileDocumentTransfer'), null);
    assert.equal(dom.window.document.getElementById('capture').disabled, true);
    assert.equal(dom.window.document.getElementById('send').disabled, true);
    assert.equal(dom.window.document.querySelectorAll('#preview img').length, 1);
    assert.match(dom.window.document.getElementById('status').textContent, /yeni QR/);
});
