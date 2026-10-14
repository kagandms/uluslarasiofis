import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { initTebligatSearch, getNewestSheetNames } from '../src/ui/tebligatSearch.js';
import { createApplicationQueueTable } from '../src/staff/application-queue-table.js';
import { mergeDocumentsToPdf } from '../src/services/pdfMergerService.js';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

function installGlobal(context, name, value) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    context.after(() => {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
    });
}

test('Tebligat ignores a late old response even when the transport ignores abort', async context => {
    const dom = new JSDOM('<button id="tebligat-search-toggle"></button><div id="tebligat-search-body"></div><input id="tebligat-search-input"><select id="tebligat-year-select"><option>2026</option></select><div id="tebligat-search-results"></div>', { url: 'https://portal.test' });
    context.after(() => dom.window.close());
    installGlobal(context, 'window', dom.window);
    installGlobal(context, 'document', dom.window.document);
    installGlobal(context, 'localStorage', dom.window.localStorage);
    localStorage.setItem('tebligat_excel_cache', JSON.stringify([{ sayfa: '14.10.2026', isim: 'CACHE' }]));
    localStorage.setItem('tebligat_last_sync_time', String(Date.now()));
    const timers = [];
    context.mock.method(globalThis, 'setTimeout', (callback, delay) => { timers.push({ callback, delay }); return timers.length; });
    context.mock.method(globalThis, 'clearTimeout', () => {});
    let resolveOld;
    const oldPayload = new Promise(resolve => { resolveOld = resolve; });
    const signals = [];
    installGlobal(context, 'fetch', async (url, options) => {
        signals.push(options.signal);
        return { ok: true, json: () => url.includes('ALPHA') ? oldPayload
            : Promise.resolve({ results: [{ sayfa: '14.10.2026', isim: 'BETA', no: '2' }] }) };
    });
    initTebligatSearch();
    const input = document.querySelector('input');

    input.value = 'ALPHA';
    input.dispatchEvent(new dom.window.Event('input'));
    assert.equal(timers.at(-1).delay, 250);
    const oldSearch = timers.at(-1).callback();
    await Promise.resolve();
    input.value = 'BETA';
    input.dispatchEvent(new dom.window.Event('input'));
    await timers.at(-1).callback();
    resolveOld({ results: [{ sayfa: '14.10.2026', isim: 'ALPHA', no: '1' }] });
    await oldSearch;

    assert.equal(signals[0].aborted, true);
    assert.equal(document.querySelector('.tebligat-result-name').textContent, 'BETA');
});

test('ISO date-only sheet names keep their calendar order', () => {
    const sheets = getNewestSheetNames([{ sayfa: '2026-10-14' }, { sayfa: '13.10.2026' }], '2026', 1);

    assert.deepEqual([...sheets], ['2026-10-14']);
});

test('queue action prevents duplicate clicks and releases the button after rejection', async context => {
    const dom = new JSDOM();
    context.after(() => dom.window.close());
    let rejectAction;
    let attempts = 0;
    const table = createApplicationQueueTable(dom.window.document, [{}], { statusLabel: () => '', actions: () => [{
        label: 'Run', action: 'run', run: () => { attempts += 1; return new Promise((resolve, reject) => { rejectAction = reject; }); }
    }] });
    const button = table.querySelector('button');

    button.click();
    button.click();
    assert.equal(button.disabled, true);
    rejectAction(new Error('offline'));
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(attempts, 1);
    assert.equal(button.disabled, false);
});

test('unreadable PDFs abort the entire merge with the offending filename', async () => {
    const valid = await PDFDocument.create();
    valid.addPage();

    await assert.rejects(mergeDocumentsToPdf([
        { name: 'valid.pdf', bytes: await valid.save() },
        { name: 'broken.pdf', bytes: new TextEncoder().encode('broken') }
    ], undefined, { rasterizePdfs: false }), /broken\.pdf okunamadı/);
});

test('protected PDF rasterization failure reports the file and destroys the loading task', async context => {
    let destroyed = false;
    installGlobal(context, 'window', { pdfjsLib: { getDocument: () => ({
        promise: Promise.reject(Object.assign(new Error('password required'), { name: 'PasswordException' })),
        destroy: async () => { destroyed = true; }
    }) } });

    await assert.rejects(mergeDocumentsToPdf([{ name: 'protected.pdf', bytes: new Uint8Array([1]) }]), /protected\.pdf okunamadı/);

    assert.equal(destroyed, true);
});

test('extension parser tolerates missing OCR text and explicitly null profile options', async () => {
    const source = await readFile(new URL('../ykn_eklenti-main/document-parser.js', import.meta.url), 'utf8');
    const sandbox = {};
    runInNewContext(source, sandbox);

    const metadata = sandbox.YknDocumentParser.extractPassportMetadata(null, null);

    assert.equal(metadata.passportNumber, '');
    assert.equal(metadata.issueDate, '');
    assert.equal(metadata.issuingAuthority, '');
});

test('reopening the document cropper destroys its previous instance and resets fine rotation', async context => {
    const dom = new JSDOM('<div id="cropper-modal"></div><img id="cropper-image"><input id="rotation-slider" value="15">');
    context.after(() => dom.window.close());
    installGlobal(context, 'window', dom.window);
    installGlobal(context, 'document', dom.window.document);
    let destroyed = 0;
    dom.window.Cropper = class { destroy() { destroyed += 1; } };
    const { showCropperForFile, cleanupCropper } = await import('../src/ui/cropperModal.js');

    showCropperForFile({ src: 'first.jpg' });
    document.querySelector('input').value = '15';
    showCropperForFile({ src: 'second.jpg' });

    assert.equal(destroyed, 1);
    assert.equal(document.querySelector('input').value, '0');
    cleanupCropper();
});

test('reopening the passport cropper destroys its instance and clears the rotation slider', async context => {
    const dom = new JSDOM('<div id="passport-cropper-modal"></div><img id="passport-cropper-image"><input id="passport-rotation-slider" value="15"><span id="passport-rotation-angle-label"></span>');
    context.after(() => dom.window.close());
    installGlobal(context, 'window', dom.window);
    installGlobal(context, 'document', dom.window.document);
    installGlobal(context, 'CustomEvent', dom.window.CustomEvent);
    let destroyed = 0;
    dom.window.Cropper = class { destroy() { destroyed += 1; } };
    const { openPassportCropper, closePassportCropper } = await import('../src/ui/passportCropperModal.js');

    openPassportCropper({ imageSrc: 'first.jpg', studentData: null });
    document.querySelector('input').value = '15';
    openPassportCropper({ imageSrc: 'second.jpg' });

    assert.equal(destroyed, 1);
    assert.equal(document.querySelector('input').value, '0');
    assert.equal(document.querySelector('span').textContent, '0°');
    closePassportCropper();
});
