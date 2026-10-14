import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createPdfMergerGallery } from '../src/ui/pdf-merger-gallery.js';
import { createDocumentPreviewDialog } from '../src/ui/document-preview-dialog.js';
import { createDocumentPreviewStore, isPdfDocument } from '../src/ui/document-preview-store.js';

const settle = () => new Promise(resolve => setImmediate(resolve));

function installBrowser(context) {
    const dom = new JSDOM('<main><section></section></main>', { pretendToBeVisual: true });
    for (const [name, value] of Object.entries({ document: dom.window.document, window: dom.window })) {
        const previous = Object.getOwnPropertyDescriptor(globalThis, name);
        Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
        context.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
    }
    context.after(() => dom.window.close());
    return dom;
}

function createGalleryFixture(context, options = {}) {
    const dom = installBrowser(context);
    const container = dom.window.document.querySelector('section');
    const files = [1, 2, 3].map(number => new File(['photo'], `Telefondan_similar-${number}.jpg`, { type: 'image/jpeg' }));
    const thumbnailReads = [];
    const opened = [];
    const previews = { getThumbnail: async file => { thumbnailReads.push(file); return `blob:${file.name}`; },
        retainFiles: () => {}, dispose: () => {} };
    const gallery = createPdfMergerGallery({ container, previews,
        previewDialog: { open: (...argumentsList) => opened.push(argumentsList), dispose: () => {} },
        canInteract: () => !options.isProcessing,
        onMove: (from, to) => { files.splice(to, 0, files.splice(from, 1)[0]); gallery.sync(files); },
        onRemove: index => { files.splice(index, 1); gallery.sync(files); } });
    gallery.sync(files);
    context.after(() => gallery.dispose());
    return { dom, container, files, gallery, thumbnailReads, opened };
}

function installThumbnailBrowser(context) {
    const dom = installBrowser(context);
    const draws = [];
    const revoked = [];
    let nextUrl = 0;
    context.mock.method(dom.window.HTMLCanvasElement.prototype, 'getContext', function () {
        return { fillRect: () => {}, drawImage: () => draws.push({ width: this.width, height: this.height }) };
    });
    context.mock.method(dom.window.HTMLCanvasElement.prototype, 'toBlob', callback => callback(new Blob(['thumbnail'])));
    context.mock.method(URL, 'createObjectURL', () => `blob:thumbnail-${++nextUrl}`);
    context.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
    return { dom, draws, revoked };
}

function installBitmapDecoder(context, decoder) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
    Object.defineProperty(globalThis, 'createImageBitmap', { value: decoder, configurable: true });
    context.after(() => previous ? Object.defineProperty(globalThis, 'createImageBitmap', previous) : delete globalThis.createImageBitmap);
}

test('reordering preserves photo identity, thumbnail nodes and list scroll position', async context => {
    const fixture = createGalleryFixture(context);
    await settle();
    const firstCard = fixture.container.firstElementChild;
    const image = firstCard.querySelector('img');
    fixture.container.scrollTop = 140;

    firstCard.querySelector('[aria-label="Fotoğraf 1 aşağı taşı"]').click();
    await settle();

    assert.equal(fixture.container.children[1], firstCard);
    assert.equal(firstCard.querySelector('img'), image);
    assert.equal(firstCard.querySelector('strong').textContent, 'Fotoğraf 1');
    assert.equal(firstCard.querySelector('.pdf-merger-file-position').textContent, '2');
    assert.equal(fixture.thumbnailReads.length, 3);
    assert.equal(fixture.container.scrollTop, 140);
});

test('dragging a photo to the start changes the file order and shows the insertion position', async context => {
    const fixture = createGalleryFixture(context);
    const source = fixture.container.children[2];
    const target = fixture.container.children[0];
    const draggedFile = fixture.files[2];

    source.dispatchEvent(new fixture.dom.window.Event('dragstart', { bubbles: true, cancelable: true }));
    target.dispatchEvent(new fixture.dom.window.MouseEvent('dragover', { bubbles: true, cancelable: true, clientY: -1 }));
    assert.equal(target.classList.contains('drop-before'), true);
    target.dispatchEvent(new fixture.dom.window.MouseEvent('drop', { bubbles: true, cancelable: true, clientY: -1 }));

    assert.equal(fixture.files[0], draggedFile);
    assert.equal(fixture.container.firstElementChild, source);
    assert.equal(fixture.container.querySelectorAll('.drop-before,.drop-after,.is-dragging').length, 0);
});

test('processing prevents a drag from changing document order', async context => {
    const options = { isProcessing: true };
    const fixture = createGalleryFixture(context, options);
    const originalOrder = [...fixture.files];

    const drag = new fixture.dom.window.Event('dragstart', { bubbles: true, cancelable: true });
    fixture.container.children[2].dispatchEvent(drag);
    fixture.container.children[0].dispatchEvent(new fixture.dom.window.MouseEvent('drop', { bubbles: true, cancelable: true }));

    assert.equal(drag.defaultPrevented, true);
    assert.deepEqual(fixture.files, originalOrder);
});

test('duplicate file objects keep separate cards and removal deletes the selected occurrence', async context => {
    const fixture = createGalleryFixture(context);
    const duplicate = fixture.files[0];
    fixture.files.push(duplicate);
    fixture.gallery.sync(fixture.files);
    const original = fixture.container.firstElementChild;
    const duplicateCard = fixture.container.lastElementChild;

    duplicateCard.querySelector('[aria-label$=" sil"]').click();

    assert.equal(fixture.files.length, 3);
    assert.equal(fixture.container.firstElementChild, original);
    assert.equal(fixture.container.contains(duplicateCard), false);
});

test('offscreen previews are lazy and remain cached when reordered', async context => {
    let reportVisibility;
    const observed = [];
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver');
    globalThis.IntersectionObserver = class {
        constructor(callback) { reportVisibility = callback; }
        observe(card) { observed.push(card); }
        unobserve() {}
        disconnect() {}
    };
    context.after(() => previous ? Object.defineProperty(globalThis, 'IntersectionObserver', previous) : delete globalThis.IntersectionObserver);
    const fixture = createGalleryFixture(context);

    assert.equal(fixture.thumbnailReads.length, 0);
    reportVisibility([{ target: observed[0], isIntersecting: true }]);
    await settle();
    fixture.container.firstElementChild.querySelector('[aria-label$=" aşağı taşı"]').click();
    await settle();

    assert.equal(fixture.thumbnailReads.length, 1);
});

test('the preview opens the selected local file without modifying it', async context => {
    const fixture = createGalleryFixture(context);
    const selected = fixture.files[1];

    fixture.container.children[1].querySelector('.pdf-merger-thumbnail').click();

    assert.equal(fixture.opened[0][0], selected);
    assert.equal(fixture.opened[0][1], 'Fotoğraf 2');
});

test('closing a large preview restores focus and leaves the merger open', context => {
    const dom = installBrowser(context);
    const modal = dom.window.document.querySelector('main');
    const trigger = dom.window.document.createElement('button');
    modal.append(trigger);
    const dialog = createDocumentPreviewDialog({ modal, canInteract: () => true,
        previews: { getOriginal: () => 'blob:original-photo' } });
    const photo = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });

    dialog.open(photo, 'Fotoğraf 1', trigger);
    const preview = modal.querySelector('.pdf-merger-preview');
    preview.querySelector('button').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    assert.equal(modal.isConnected, true);
    assert.equal(modal.querySelector('.pdf-merger-preview'), null);
    assert.equal(dom.window.document.activeElement, trigger);
    assert.equal(trigger.inert, undefined);
});

test('PDF identification accepts uppercase names when a MIME type is missing', () => {
    assert.equal(isPdfDocument(new File(['pdf'], 'SCAN.PDF')), true);
    assert.equal(isPdfDocument(new File(['image'], 'photo.png', { type: 'image/png' })), false);
});

test('local original URLs are reused and released when a file is removed or the modal closes', context => {
    installBrowser(context);
    const created = [];
    const revoked = [];
    context.mock.method(URL, 'createObjectURL', file => { created.push(file); return `blob:${created.length}`; });
    context.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
    const previews = createDocumentPreviewStore();
    const first = new File(['photo'], 'first.jpg', { type: 'image/jpeg' });
    const second = new File(['pdf'], 'second.PDF');

    assert.equal(previews.getOriginal(first), previews.getOriginal(first));
    previews.getOriginal(second);
    previews.retainFiles([second]);
    previews.dispose();

    assert.equal(created.length, 2);
    assert.equal(created[1].type, 'application/pdf');
    assert.deepEqual(revoked, ['blob:1', 'blob:2']);
});

test('a thumbnail is encoded once, preserves the full aspect ratio and releases its bitmap', async context => {
    const browser = installThumbnailBrowser(context);
    let decodes = 0;
    let closedBitmaps = 0;
    installBitmapDecoder(context, async () => { decodes++; return { width: 1200, height: 1800, close: () => closedBitmaps++ }; });
    const previews = createDocumentPreviewStore();
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });

    const first = await previews.getThumbnail(file);
    const second = await previews.getThumbnail(file);
    previews.dispose();

    assert.equal(first, second);
    assert.equal(decodes, 1);
    assert.equal(closedBitmaps, 1);
    assert.deepEqual(browser.draws, [{ width: 107, height: 160 }]);
    assert.deepEqual(browser.revoked, [first]);
});

test('thumbnail decodes are serialized and a modal closed mid-decode releases the late URL', async context => {
    const browser = installThumbnailBrowser(context);
    let releaseFirst;
    let decodes = 0;
    installBitmapDecoder(context, () => {
        decodes++;
        return new Promise(resolve => { releaseFirst = resolve; });
    });
    const previews = createDocumentPreviewStore();
    const first = previews.getThumbnail(new File(['a'], 'first.jpg'));
    const second = previews.getThumbnail(new File(['b'], 'second.jpg'));
    await settle();

    assert.equal(decodes, 1);
    previews.dispose();
    releaseFirst({ width: 160, height: 120, close: () => {} });

    assert.deepEqual(await Promise.all([first, second]), [null, null]);
    assert.equal(decodes, 1);
    assert.deepEqual(browser.revoked, ['blob:thumbnail-1']);
});

test('PDF thumbnails render only page one and destroy the PDF loading task', async context => {
    const browser = installThumbnailBrowser(context);
    const pagesRequested = [];
    let destroyedTasks = 0;
    browser.dom.window.pdfjsLib = { getDocument: () => ({
        promise: Promise.resolve({ getPage: async pageNumber => {
            pagesRequested.push(pageNumber);
            return { getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
                render: () => ({ promise: Promise.resolve() }) };
        } }), destroy: async () => { destroyedTasks++; }
    }) };
    const previews = createDocumentPreviewStore();

    const thumbnail = await previews.getThumbnail(new File(['pdf'], 'existing.PDF', { type: 'application/pdf' }));
    previews.dispose();

    assert.deepEqual(pagesRequested, [1]);
    assert.equal(destroyedTasks, 1);
    assert.equal(thumbnail, 'blob:thumbnail-1');
});

test('a failed thumbnail does not block the next document preview', async context => {
    const browser = installThumbnailBrowser(context);
    installBitmapDecoder(context, async () => ({ width: 120, height: 160, close: () => {} }));
    let encodes = 0;
    context.mock.method(browser.dom.window.HTMLCanvasElement.prototype, 'toBlob', callback => {
        callback(++encodes === 1 ? null : new Blob(['thumbnail']));
    });
    const previews = createDocumentPreviewStore();

    await assert.rejects(previews.getThumbnail(new File(['a'], 'first.jpg')), /oluşturulamadı/);
    const second = await previews.getThumbnail(new File(['b'], 'second.jpg'));
    previews.dispose();

    assert.equal(second, 'blob:thumbnail-1');
    assert.equal(encodes, 2);
});

test('processing blocks a large preview without hiding the existing merger', context => {
    const dom = installBrowser(context);
    const modal = dom.window.document.querySelector('main');
    const dialog = createDocumentPreviewDialog({ modal, canInteract: () => false,
        previews: { getOriginal: () => { throw new Error('Preview must not start during processing'); } } });

    dialog.open(new File(['photo'], 'photo.jpg'), 'Fotoğraf 1', null);

    assert.equal(modal.querySelector('.pdf-merger-preview'), null);
    assert.equal(modal.isConnected, true);
});
