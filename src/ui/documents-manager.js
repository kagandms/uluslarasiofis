import { DOCUMENT_CATEGORIES, OFFICE_DOCUMENTS } from '../config/documents-config.js';

const thumbnailCache = new Map();
let isRenderingThumbnails = false;

function drawCachedImage(canvas, box, dataUrl) {
    if (typeof Image === 'undefined') return;
    const img = new Image();
    img.onload = () => {
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.drawImage(img, 0, 0);
        canvas.dataset.rendered = 'true';
        box.classList.add('is-loaded');
    };
    img.src = dataUrl;
}

/**
 * Belgelerin ilk sayfasını arka planda küçük önizleme olarak canvas üzerine çizer.
 */
async function renderThumbnails() {
    if (isRenderingThumbnails) return;
    if (typeof window === 'undefined' || !window.pdfjsLib) return;

    if (!window.pdfjsLib.GlobalWorkerOptions?.workerSrc) {
        try {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
        } catch (_) {}
    }

    const boxes = document.querySelectorAll('.documents-preview-box');
    if (!boxes.length) return;

    isRenderingThumbnails = true;

    try {
        for (const box of boxes) {
            const url = box.dataset.url;
            const canvas = box.querySelector('.documents-preview-canvas');
            if (!canvas || !url || canvas.dataset.rendered === 'true') continue;

            // 1. Bellek önbelleği
            if (thumbnailCache.has(url)) {
                drawCachedImage(canvas, box, thumbnailCache.get(url));
                continue;
            }

            // 2. SessionStorage önbelleği
            try {
                const stored = window.sessionStorage?.getItem('doc_thumb_' + url);
                if (stored) {
                    thumbnailCache.set(url, stored);
                    drawCachedImage(canvas, box, stored);
                    continue;
                }
            } catch (_) {}

            // 3. pdfjsLib ile ilk sayfayı render et
            try {
                const pdf = await window.pdfjsLib.getDocument({
                    url,
                    cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/cmaps/',
                    cMapPacked: true
                }).promise;

                const page = await pdf.getPage(1);
                const unscaled = page.getViewport({ scale: 1 });
                const targetWidth = 300;
                const scale = targetWidth / unscaled.width;
                const viewport = page.getViewport({ scale });

                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    await page.render({ canvasContext: ctx, viewport }).promise;
                }

                canvas.dataset.rendered = 'true';
                box.classList.add('is-loaded');

                try {
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
                    thumbnailCache.set(url, dataUrl);
                    window.sessionStorage?.setItem('doc_thumb_' + url, dataUrl);
                } catch (_) {}
            } catch (err) {
                console.warn(`[Belgeler] Önizleme oluşturulamadı (${url}):`, err);
                box.classList.add('is-error');
            }
        }
    } finally {
        isRenderingThumbnails = false;
    }
}

function createDocumentAction(label, action, documentRecord) {
    if (action === 'print') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-primary documents-card-print';
        button.dataset.action = action;
        button.textContent = label;
        button.setAttribute('aria-label', `${documentRecord.title}: ${label}`);
        button.addEventListener('click', () => {
            const printWindow = document.defaultView?.open(documentRecord.fileUrl, '_blank');
            if (!printWindow) return;
            printWindow.addEventListener('load', () => {
                printWindow.focus();
                printWindow.print();
            }, { once: true });
        });
        return button;
    }
    const link = document.createElement('a');
    link.className = 'btn btn-outline';
    link.dataset.action = action;
    link.href = documentRecord.fileUrl;
    link.rel = 'noopener';
    link.target = '_blank';
    link.textContent = label;
    link.setAttribute('aria-label', `${documentRecord.title}: ${label}`);
    if (action === 'download') link.download = documentRecord.fileName;
    return link;
}

function createDocumentCard(documentRecord) {
    const card = document.createElement('article');
    card.className = 'documents-card glass-card';
    card.dataset.documentId = documentRecord.id;

    const heading = document.createElement('h4');
    heading.className = 'documents-card-title';
    heading.textContent = documentRecord.title;

    const category = document.createElement('span');
    category.className = 'documents-category-tag';
    category.textContent = documentRecord.categoryLabel || 'Belge';

    const badge = document.createElement('p');
    badge.className = 'documents-card-badge';
    badge.textContent = documentRecord.badge;

    // Küçük Doğrudan Önizleme Alanı (Canvas Thumbnail + Skeleton Shimmer)
    const previewBox = document.createElement('div');
    previewBox.className = 'documents-preview-box';
    previewBox.dataset.url = documentRecord.fileUrl;
    previewBox.title = `${documentRecord.title} - Önizlemek için tıklayın`;
    previewBox.addEventListener('click', () => {
        if (typeof window !== 'undefined') {
            window.open(documentRecord.fileUrl, '_blank');
        }
    });

    const skeleton = document.createElement('div');
    skeleton.className = 'documents-preview-skeleton';
    skeleton.setAttribute('aria-hidden', 'true');
    skeleton.innerHTML = `
        <div class="skeleton-line" style="width: 45%;"></div>
        <div class="skeleton-line" style="width: 85%;"></div>
        <div class="skeleton-line" style="width: 75%;"></div>
        <div class="skeleton-line" style="width: 90%;"></div>
        <div class="skeleton-line" style="width: 60%;"></div>
    `;

    const canvas = document.createElement('canvas');
    canvas.className = 'documents-preview-canvas';
    canvas.dataset.url = documentRecord.fileUrl;

    const overlay = document.createElement('div');
    overlay.className = 'documents-preview-overlay';
    overlay.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
        </svg>
        <span>Önizle</span>
    `;

    previewBox.append(skeleton, canvas, overlay);

    const preview = document.createElement('iframe');
    preview.className = 'documents-card-preview';
    preview.src = `${documentRecord.fileUrl}#page=1&toolbar=0&navpanes=0`;
    preview.title = `${documentRecord.title} — ilk sayfa önizlemesi`;
    preview.loading = 'lazy';
    preview.setAttribute('aria-label', preview.title);
    preview.style.display = 'none';

    const actions = document.createElement('div');
    actions.className = 'documents-card-actions';
    actions.append(
        createDocumentAction('Önizle', 'preview', documentRecord),
        createDocumentAction('İndir', 'download', documentRecord)
    );
    actions.prepend(createDocumentAction('Yazdır (Hızlı Çıkar)', 'print', documentRecord));

    card.append(heading, category, badge, previewBox, preview, actions);
    return card;
}

function matchesDocument(documentRecord, searchTerm, categoryId) {
    if (categoryId !== 'all' && documentRecord.category !== categoryId) return false;
    if (!searchTerm) return true;
    const searchableText = [
        documentRecord.title,
        documentRecord.categoryLabel,
        documentRecord.fileName,
        ...documentRecord.tags
    ].join(' ').toLocaleLowerCase('tr-TR');
    return searchableText.includes(searchTerm);
}

function renderDocuments(grid, emptyState, countBadge, searchInput, categoryFilter) {
    const searchTerm = searchInput.value.trim().toLocaleLowerCase('tr-TR');
    const filteredDocuments = OFFICE_DOCUMENTS.filter((documentRecord) =>
        matchesDocument(documentRecord, searchTerm, categoryFilter.value)
    );
    const cards = filteredDocuments.map(createDocumentCard);
    grid.replaceChildren(...cards);
    emptyState.hidden = filteredDocuments.length > 0;
    countBadge.textContent = `${filteredDocuments.length} belge`;

    if (typeof window !== 'undefined' && window.pdfjsLib) {
        setTimeout(renderThumbnails, 20);
    } else if (typeof window !== 'undefined') {
        const interval = setInterval(() => {
            if (window.pdfjsLib) {
                clearInterval(interval);
                renderThumbnails();
            }
        }, 150);
        setTimeout(() => clearInterval(interval), 4000);
    }
}

function populateCategoryFilter(categoryFilter) {
    for (const category of DOCUMENT_CATEGORIES) {
        const option = document.createElement('option');
        option.value = category.id;
        option.textContent = category.label;
        categoryFilter.append(option);
    }
}

/** Initializes the searchable, staff-only office documents workspace. */
export function initDocumentsManager() {
    const grid = document.getElementById('documents-grid');
    const emptyState = document.getElementById('documents-empty-state');
    const countBadge = document.getElementById('documents-total-count');
    const searchInput = document.getElementById('documents-search-input');
    const categoryFilter = document.getElementById('documents-category-filter');
    if (!grid || !emptyState || !countBadge || !searchInput || !categoryFilter || grid.dataset.initialized) return;

    grid.dataset.initialized = 'true';
    populateCategoryFilter(categoryFilter);
    const render = () => renderDocuments(grid, emptyState, countBadge, searchInput, categoryFilter);
    searchInput.addEventListener('input', render);
    categoryFilter.addEventListener('change', render);

    if (typeof document !== 'undefined') {
        document.addEventListener('workspace:view-changed', (e) => {
            if (e.detail?.viewName === 'documents') {
                setTimeout(renderThumbnails, 60);
            }
        });
    }

    render();
}
