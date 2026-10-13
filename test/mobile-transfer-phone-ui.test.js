import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const settle = async () => {
    for (let cycle = 0; cycle < 5; cycle += 1) await new Promise(resolve => setImmediate(resolve));
};

test('camera photos upload immediately and show sent only after PC import confirmation', async (context) => {
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
    let uploadedPhotoId;
    const requests = [];
    context.mock.method(globalThis, 'fetch', async (path, options = {}) => {
        requests.push({ path, options });
        if (path.endsWith('/claim')) return Response.json({ id: 'transfer-1', expires_at: Math.floor(Date.now() / 1000) + 3600 });
        if (path.endsWith('/batch')) return Response.json({ batchId: 'batch-1', receivedPhotoIds: isPcImportConfirmed ? [uploadedPhotoId] : [] });
        if (options.method === 'POST') {
            uploadedPhotoId = options.headers['X-Photo-Id'];
            return Response.json({ id: uploadedPhotoId, received: true });
        }
        throw new Error(`Unexpected request ${path}`);
    });
    const pollIntervals = [];
    context.mock.method(globalThis, 'setInterval', callback => { pollIntervals.push(callback); return pollIntervals.length; });
    await import('../src/mobile-transfer/main.js?test=auto-camera');
    await settle();
    const camera = dom.window.document.getElementById('camera');
    const photo = new dom.window.File([new Uint8Array([1, 2, 3])], 'passport.jpg', { type: 'image/jpeg' });
    Object.defineProperty(camera, 'files', { configurable: true, value: [photo] });
    camera.dispatchEvent(new dom.window.Event('change'));
    await settle();

    assert.equal(requests.some(request => request.options.method === 'POST' && request.path.endsWith('/photos')), true);
    assert.equal(dom.window.document.querySelector('#preview figcaption').textContent, '1. fotoğraf · PC alıyor…');
    assert.equal(dom.window.document.getElementById('send').hidden, true);

    isPcImportConfirmed = true;
    await pollIntervals[0]();
    await settle();

    assert.equal(dom.window.document.querySelector('#preview figcaption').textContent, '1. fotoğraf · Gönderildi');
    assert.match(dom.window.document.getElementById('status').textContent, /PC’ye gönderildi/);
});
