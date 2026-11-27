import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import { readPdfMergerMessages } from '../src/public/i18n/pdf-merger-messages.js';
import { PDF_MERGER_DEFAULT_TEXT } from '../src/ui/pdf-merger-text.js';
import { SUPPORTED_LOCALES } from '../src/public/i18n/messages.js';

if (typeof nodeModule.registerHooks === 'function') {
    nodeModule.registerHooks({
        load(url, context, nextLoad) {
            if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
            return nextLoad(url, context);
        }
    });
} else {
    nodeModule.register(`data:text/javascript,${encodeURIComponent(
        'export async function load(url, context, nextLoad) { if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true }; return nextLoad(url, context); }'
    )}`);
}

const prevWindowForImport = globalThis.window;
const hadWindowForImport = 'window' in globalThis;
if (!globalThis.window) globalThis.window = {};
const { openPdfMergerModal } = await import('../src/ui/pdfMergerModal.js');
if (hadWindowForImport) globalThis.window = prevWindowForImport;
else delete globalThis.window;

function setupDom(lang = 'tr', dir = 'ltr') {
    const dom = new JSDOM(`<!doctype html><html lang="${lang}" dir="${dir}"><body></body></html>`, {
        url: 'https://portal.test/'
    });
    const activeTimers = new Set();
    const realSetTimeout = globalThis.setTimeout;
    const prev = {
        document: globalThis.document,
        window: globalThis.window,
        MutationObserver: globalThis.MutationObserver,
        IntersectionObserver: globalThis.IntersectionObserver,
        requestAnimationFrame: globalThis.requestAnimationFrame,
        setTimeout: globalThis.setTimeout,
        File: globalThis.File,
        Blob: globalThis.Blob,
        createObjectURL: URL.createObjectURL,
        revokeObjectURL: URL.revokeObjectURL
    };
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    globalThis.MutationObserver = dom.window.MutationObserver;
    if (typeof globalThis.IntersectionObserver !== 'function') {
        globalThis.IntersectionObserver = class {
            observe() {}
            unobserve() {}
            disconnect() {}
        };
    }
    globalThis.requestAnimationFrame = () => 0;
    globalThis.setTimeout = (fn, delay, ...args) => {
        const id = realSetTimeout(fn, delay, ...args);
        activeTimers.add(id);
        return id;
    };
    globalThis.File = dom.window.File;
    globalThis.Blob = dom.window.Blob;
    URL.createObjectURL = () => 'blob:mock-pdf';
    URL.revokeObjectURL = () => {};
    return {
        dom,
        document: dom.window.document,
        async cleanup() {
            dom.window.document.getElementById('pdf-merger-modal-overlay')?.remove();
            await new Promise((resolve) => realSetTimeout(resolve, 0));
            for (const id of activeTimers) clearTimeout(id);
            globalThis.document = prev.document;
            globalThis.window = prev.window;
            globalThis.MutationObserver = prev.MutationObserver;
            globalThis.IntersectionObserver = prev.IntersectionObserver;
            globalThis.requestAnimationFrame = prev.requestAnimationFrame;
            globalThis.setTimeout = prev.setTimeout;
            globalThis.File = prev.File;
            globalThis.Blob = prev.Blob;
            URL.createObjectURL = prev.createObjectURL;
            URL.revokeObjectURL = prev.revokeObjectURL;
            dom.window.close();
        }
    };
}

function addDummyFile(document) {
    const overlay = document.getElementById('pdf-merger-modal-overlay');
    const fileInput = overlay.querySelector('input[type="file"][multiple]');
    const file = new File(['dummy'], 'page-1.jpg', { type: 'image/jpeg' });
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
    fileInput.dispatchEvent(new document.defaultView.Event('change'));
}

function getFooterControls(document) {
    const overlay = document.getElementById('pdf-merger-modal-overlay');
    const footer = overlay.querySelector('.staff-modal-footer');
    return {
        overlay,
        progressMsg: footer.querySelector('span'),
        previewLink: footer.querySelector('a'),
        btnMerge: footer.querySelector('button'),
        clearBtn: [...overlay.querySelectorAll('button')].find((b) => b.textContent === readPdfMergerMessages('tr').clearAll || b.textContent === 'Tümünü Temizle')
    };
}

test('studentMode shows neutral preparing text and green success under 9 MiB', async () => {
    const { document, cleanup } = setupDom('tr');
    try {
        let releaseMerge;
        const smallBytes = new Uint8Array(1024);
        openPdfMergerModal({
            studentMode: true,
            text: readPdfMergerMessages('tr'),
            confirmLabel: 'PDF’i hazırla ve evraka yükle',
            onSave: async () => {},
            mergeDocumentsToPdf: async (_files, onProgress) => {
                onProgress({ message: 'Teknik sıkıştırma %40...' });
                return new Promise((resolve) => {
                    releaseMerge = () => resolve({
                        bytes: smallBytes,
                        metrics: { inputBytes: 2048, outputBytes: 1024, targetReached: true, compressionPercent: 40, rasterizedPdfs: true }
                    });
                });
            }
        });
        addDummyFile(document);
        const { progressMsg, previewLink, btnMerge } = getFooterControls(document);
        btnMerge.click();

        // Preparing must be neutral and must not show technical compression progress
        assert.ok(progressMsg.classList.contains('is-neutral'));
        assert.equal(progressMsg.classList.contains('is-success'), false);
        assert.equal(progressMsg.classList.contains('is-error'), false);
        assert.equal(progressMsg.textContent, 'PDF hazırlanıyor…');

        releaseMerge();
        await new Promise((resolve) => setImmediate(resolve));

        assert.ok(progressMsg.classList.contains('is-success'));
        assert.equal(progressMsg.textContent, '✅ PDF başarıyla oluşturuldu. Şimdi “PDF’i hazırla ve evraka yükle” düğmesine basın.');
        assert.doesNotMatch(progressMsg.textContent, /40%|KB|MB|görüntüye çevrildi/i);
        assert.equal(previewLink.hidden, false);
        assert.equal(btnMerge.disabled, false);
    } finally {
        await cleanup();
    }
});

test('studentMode allows confirming PDFs between 9 MiB and 10 MiB', async () => {
    const { document, cleanup } = setupDom('en');
    try {
        const between9And10MiB = new Uint8Array(9.5 * 1024 * 1024);
        let savedBytes = null;
        openPdfMergerModal({
            studentMode: true,
            text: readPdfMergerMessages('en'),
            confirmLabel: 'Prepare PDF and upload document',
            onSave: async (bytes) => { savedBytes = bytes; },
            mergeDocumentsToPdf: async () => ({
                bytes: between9And10MiB,
                metrics: {
                    inputBytes: 12 * 1024 * 1024,
                    outputBytes: between9And10MiB.byteLength,
                    targetReached: false,
                    warning: 'YÖKSİS 9 MiB uyarısı (hardcoded Turkish)',
                    compressionPercent: 95
                }
            })
        });
        addDummyFile(document);
        const { progressMsg, btnMerge } = getFooterControls(document);
        btnMerge.click();
        await new Promise((resolve) => setImmediate(resolve));

        assert.ok(progressMsg.classList.contains('is-success'));
        assert.equal(btnMerge.disabled, false);
        assert.doesNotMatch(progressMsg.textContent, /YÖKSİS|9 MiB/);

        btnMerge.click();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(savedBytes, between9And10MiB);
    } finally {
        await cleanup();
    }
});

test('studentMode shows red role=alert error and disables confirm when PDF is over 10 MB', async () => {
    const { document, cleanup } = setupDom('tr');
    try {
        const over10MiB = new Uint8Array(10 * 1024 * 1024 + 1);
        openPdfMergerModal({
            studentMode: true,
            text: readPdfMergerMessages('tr'),
            confirmLabel: 'PDF’i hazırla ve evraka yükle',
            onSave: async () => {},
            mergeDocumentsToPdf: async () => ({
                bytes: over10MiB,
                metrics: {
                    inputBytes: 15 * 1024 * 1024,
                    outputBytes: over10MiB.byteLength,
                    targetReached: false,
                    warning: 'Hardcoded Turkish 9 MiB warning'
                }
            })
        });
        addDummyFile(document);
        const { progressMsg, btnMerge } = getFooterControls(document);
        btnMerge.click();
        await new Promise((resolve) => setImmediate(resolve));

        assert.ok(progressMsg.classList.contains('is-error'));
        assert.equal(progressMsg.getAttribute('role'), 'alert');
        assert.equal(progressMsg.textContent, 'PDF 10 MB sınırını geçiyor. Sayfa sayısını azaltıp tekrar oluşturun.');
        assert.doesNotMatch(progressMsg.textContent, /Hardcoded Turkish/);
        assert.equal(btnMerge.disabled, true);
        assert.equal(btnMerge.title, 'PDF 10 MB altında olmalı.');
    } finally {
        await cleanup();
    }
});

test('studentMode clears message and success/error styles when page list changes', async () => {
    const { document, cleanup } = setupDom('tr');
    try {
        openPdfMergerModal({
            studentMode: true,
            text: readPdfMergerMessages('tr'),
            onSave: async () => {},
            mergeDocumentsToPdf: async () => ({
                bytes: new Uint8Array(100),
                metrics: { inputBytes: 200, outputBytes: 100, targetReached: true }
            })
        });
        addDummyFile(document);
        const { progressMsg, btnMerge } = getFooterControls(document);
        btnMerge.click();
        await new Promise((resolve) => setImmediate(resolve));
        assert.ok(progressMsg.classList.contains('is-success'));

        // Adding another file triggers renderList() and must clear status & classes
        addDummyFile(document);
        assert.equal(progressMsg.textContent, '');
        assert.equal(progressMsg.classList.contains('is-success'), false);
        assert.equal(progressMsg.classList.contains('is-error'), false);
        assert.equal(progressMsg.classList.contains('is-neutral'), false);
        assert.equal(progressMsg.getAttribute('role'), null);
    } finally {
        await cleanup();
    }
});

test('staff default mode keeps 9 MiB limit and technical size text unchanged', async () => {
    const { document, cleanup } = setupDom('tr');
    try {
        const between9And10MiB = new Uint8Array(9.5 * 1024 * 1024);
        openPdfMergerModal({
            mergeDocumentsToPdf: async () => ({
                bytes: between9And10MiB,
                metrics: {
                    inputBytes: 11 * 1024 * 1024,
                    outputBytes: between9And10MiB.byteLength,
                    targetReached: false,
                    warning: 'Boyut 9 MiB sınırının üstünde.',
                    compressionPercent: 95
                }
            })
        });
        addDummyFile(document);
        const { progressMsg, btnMerge } = getFooterControls(document);
        btnMerge.click();
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(progressMsg.classList.contains('pdf-merger-status'), false);
        assert.match(progressMsg.textContent, /Boyut 9 MiB sınırının üstünde/);
        assert.match(progressMsg.textContent, /%95/);
        assert.equal(btnMerge.disabled, true);
        assert.equal(btnMerge.title, 'PDF 9 MiB altında olmalı.');
    } finally {
        await cleanup();
    }
});

test('all studentMode composer strings exist in all 5 locales and merge label does not promise size', () => {
    assert.equal(PDF_MERGER_DEFAULT_TEXT.merge, 'PDF oluştur ve boyutu göster');
    for (const locale of SUPPORTED_LOCALES) {
        const msg = readPdfMergerMessages(locale);
        assert.ok(msg.merge, `${locale} missing merge`);
        assert.doesNotMatch(msg.merge, /boyut|size|размер|ölçeg|الحجم/i, `${locale} merge must not promise size`);
        assert.ok(msg.studentPreparing, `${locale} missing studentPreparing`);
        assert.ok(msg.studentReady, `${locale} missing studentReady`);
        assert.ok(msg.studentTooLarge, `${locale} missing studentTooLarge`);
        assert.ok(msg.studentMustBeSmall, `${locale} missing studentMustBeSmall`);
    }
});
