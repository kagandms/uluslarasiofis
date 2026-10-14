const THUMBNAIL_LONG_EDGE = 160;

function encodeThumbnail(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => {
        if (blob) return resolve(URL.createObjectURL(blob));
        reject(new Error('Belge önizlemesi oluşturulamadı.'));
    }, 'image/jpeg', .8));
}

async function renderImageThumbnail(file, canvas) {
    if (typeof createImageBitmap === 'function') {
        try {
            const image = await createImageBitmap(file);
            try { drawThumbnail(image, canvas, image.width, image.height); }
            finally { image.close(); }
            return;
        } catch (error) {
            console.warn('Thumbnail bitmap decoding failed; using image fallback.', { errorName: error.name });
        }
    }
    const originalUrl = URL.createObjectURL(file);
    const image = new Image();
    try {
        image.src = originalUrl;
        await image.decode();
        drawThumbnail(image, canvas, image.naturalWidth, image.naturalHeight);
    } finally { URL.revokeObjectURL(originalUrl); }
}

function drawThumbnail(image, canvas, width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Belge boyutları okunamadı.');
    const scale = Math.min(1, THUMBNAIL_LONG_EDGE / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Önizleme bu tarayıcıda kullanılamıyor.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
}

async function renderPdfThumbnail(file, canvas) {
    if (!window.pdfjsLib) await import('../staff/pdfjs-bootstrap.js');
    const task = window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    try {
        const pdf = await task.promise;
        const page = await pdf.getPage(1);
        const dimensions = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: THUMBNAIL_LONG_EDGE / Math.max(dimensions.width, dimensions.height) });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('PDF önizlemesi bu tarayıcıda kullanılamıyor.');
        await page.render({ canvasContext: context, viewport }).promise;
    } finally { await task.destroy(); }
}

/** Identifies PDF files without changing their bytes.
 * @param {File} file Local document. @returns {boolean} Whether it is a PDF. */
export function isPdfDocument(file) {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

async function createThumbnail(file) {
    const canvas = document.createElement('canvas');
    try {
        if (isPdfDocument(file)) await renderPdfThumbnail(file, canvas);
        else await renderImageThumbnail(file, canvas);
        return await encodeThumbnail(canvas);
    } finally { canvas.width = canvas.height = 0; }
}

function getPreview(state, file) {
    if (state.isDisposed) throw new Error('Önizleme penceresi kapatıldı.');
    if (!state.previews.has(file)) state.previews.set(file, { originalUrl: null, thumbnail: null, thumbnailUrl: null });
    return state.previews.get(file);
}

function getThumbnail(state, file) {
    const preview = getPreview(state, file);
    if (preview.thumbnail) return preview.thumbnail;
    const thumbnail = state.pendingThumbnail.then(async () => {
        if (state.isDisposed || state.previews.get(file) !== preview) return null;
        const url = await createThumbnail(file);
        if (state.isDisposed || state.previews.get(file) !== preview) { URL.revokeObjectURL(url); return null; }
        preview.thumbnailUrl = url;
        return url;
    });
    preview.thumbnail = thumbnail;
    state.pendingThumbnail = thumbnail.catch(error => {
        console.warn('Document thumbnail unavailable.', error.name, error.message);
    });
    return thumbnail;
}

function getOriginal(state, file) {
    const preview = getPreview(state, file);
    preview.originalUrl ||= URL.createObjectURL(isPdfDocument(file) && file.type !== 'application/pdf'
        ? new Blob([file], { type: 'application/pdf' }) : file);
    return preview.originalUrl;
}

function releasePreview(state, file) {
    const preview = state.previews.get(file);
    if (preview.originalUrl) URL.revokeObjectURL(preview.originalUrl);
    if (preview.thumbnailUrl) URL.revokeObjectURL(preview.thumbnailUrl);
    state.previews.delete(file);
}

function retainFiles(state, files) {
    const retained = new Set(files);
    for (const file of state.previews.keys()) if (!retained.has(file)) releasePreview(state, file);
}

/** Owns local preview URLs and serializes thumbnail decoding to bound memory use.
 * @returns {object} Thumbnail, full-preview, retain and disposal operations.
 * @throws {Error} Individual thumbnail promises reject when decoding fails. */
export function createDocumentPreviewStore() {
    const state = { previews: new Map(), isDisposed: false, pendingThumbnail: Promise.resolve() };
    return {
        getThumbnail: file => getThumbnail(state, file),
        getOriginal: file => getOriginal(state, file),
        retainFiles: files => retainFiles(state, files),
        dispose: () => { state.isDisposed = true; retainFiles(state, []); }
    };
}
