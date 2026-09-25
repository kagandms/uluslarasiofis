import { OFFICE_DOCUMENTS, DOCUMENT_CATEGORIES } from '../config/documentsConfig.js';
import { showToast } from './toastManager.js';

let activeCategory = 'all';
let searchQuery = '';
const thumbnailCache = new Map();
let isRenderingThumbnails = false;

function normalizeTurkish(text) {
    if (!text) return '';
    return String(text)
        .toLocaleLowerCase('tr-TR')
        .replace(/ı/g, 'i')
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c')
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * PDF dosyasını arka planda doğrudan sistemin yazdırma diyaloğuna gönderir.
 */
export function printDocumentPdf(fileUrl, title) {
    if (typeof showToast === 'function') {
        showToast(`${title || 'Belge'} yazdırma için hazırlanıyor...`, 'info');
    }

    let iframe = document.getElementById('documents-print-iframe');
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'documents-print-iframe';
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.setAttribute('aria-hidden', 'true');
        document.body.appendChild(iframe);
    }

    let printed = false;
    const triggerPrint = () => {
        if (printed) return;
        printed = true;
        try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
        } catch (err) {
            console.warn('Iframe print failed, falling back to window.open:', err);
            const win = window.open(fileUrl, '_blank');
            win?.focus();
        }
    };

    iframe.onload = () => {
        setTimeout(triggerPrint, 350);
    };

    iframe.src = fileUrl;

    // Bazı tarayıcılarda PDF iframe onload tetiklenmeyebilir, güvenli zamanlayıcı
    setTimeout(() => {
        if (!printed) triggerPrint();
    }, 1200);
}

/**
 * PDF dosyasını bilgisayara indirir.
 */
export function downloadDocumentPdf(fileUrl, fileName) {
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = fileName || 'belge.pdf';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (typeof showToast === 'function') {
        showToast(`${fileName || 'Belge'} indiriliyor...`, 'success');
    }
}

/**
 * PDF dosyasını yeni sekmede önizler.
 */
export function previewDocumentPdf(fileUrl) {
    window.open(fileUrl, '_blank');
}

function filterDocuments() {
    const normQuery = normalizeTurkish(searchQuery);

    return OFFICE_DOCUMENTS.filter(doc => {
        const matchesCategory = activeCategory === 'all' || doc.category === activeCategory;
        if (!matchesCategory) return false;

        if (!normQuery) return true;

        const titleNorm = normalizeTurkish(doc.title);
        const tagsNorm = normalizeTurkish((doc.tags || []).join(' '));
        const fileNorm = normalizeTurkish(doc.fileName);

        return titleNorm.includes(normQuery) ||
               tagsNorm.includes(normQuery) ||
               fileNorm.includes(normQuery);
    });
}

function renderCategoryButtons() {
    const container = document.getElementById('documents-categories');
    if (!container) return;

    container.innerHTML = DOCUMENT_CATEGORIES.map(cat => {
        const isActive = cat.id === activeCategory;
        const count = cat.id === 'all' 
            ? OFFICE_DOCUMENTS.length 
            : OFFICE_DOCUMENTS.filter(d => d.category === cat.id).length;

        return `
            <button type="button" 
                    class="documents-category-chip ${isActive ? 'is-active' : ''}" 
                    data-category-id="${cat.id}">
                <span>${cat.label}</span>
                <span class="documents-category-count">${count}</span>
            </button>
        `;
    }).join('');

    container.querySelectorAll('.documents-category-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            activeCategory = btn.dataset.categoryId;
            renderCategoryButtons();
            renderDocumentsGrid();
        });
    });
}

function drawCachedImage(canvas, box, dataUrl) {
    const img = new Image();
    img.onload = () => {
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
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
                const stored = sessionStorage.getItem('doc_thumb_' + url);
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
                // Keskin önizleme için genişliği 300px'e oranla
                const targetWidth = 300;
                const scale = targetWidth / unscaled.width;
                const viewport = page.getViewport({ scale });

                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const ctx = canvas.getContext('2d');

                await page.render({ canvasContext: ctx, viewport }).promise;

                canvas.dataset.rendered = 'true';
                box.classList.add('is-loaded');

                try {
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
                    thumbnailCache.set(url, dataUrl);
                    sessionStorage.setItem('doc_thumb_' + url, dataUrl);
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

function renderDocumentsGrid() {
    const grid = document.getElementById('documents-grid');
    const emptyState = document.getElementById('documents-empty-state');
    const countBadge = document.getElementById('documents-total-count');

    if (!grid) return;

    const filtered = filterDocuments();

    if (countBadge) {
        countBadge.textContent = `${filtered.length} belge`;
    }

    if (filtered.length === 0) {
        grid.innerHTML = '';
        if (emptyState) emptyState.hidden = false;
        return;
    }

    if (emptyState) emptyState.hidden = true;

    grid.innerHTML = filtered.map(doc => `
        <article class="documents-card glass-card" data-document-id="${doc.id}">
            <div class="documents-card-header">
                <h4 class="documents-card-title">${doc.title}</h4>
                <span class="documents-category-tag">${doc.categoryLabel || 'Belge'}</span>
            </div>
            
            <div class="documents-preview-box" data-action="preview" data-url="${doc.fileUrl}" title="${doc.title} - Önizlemek için tıklayın">
                <div class="documents-preview-skeleton" aria-hidden="true">
                    <div class="skeleton-line" style="width: 45%;"></div>
                    <div class="skeleton-line" style="width: 85%;"></div>
                    <div class="skeleton-line" style="width: 75%;"></div>
                    <div class="skeleton-line" style="width: 90%;"></div>
                    <div class="skeleton-line" style="width: 60%;"></div>
                </div>
                <canvas class="documents-preview-canvas" data-url="${doc.fileUrl}"></canvas>
                <div class="documents-preview-overlay">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                    <span>Önizle</span>
                </div>
            </div>

            <div class="documents-card-actions">
                <button type="button" class="btn btn-primary documents-btn-print" data-action="print" data-url="${doc.fileUrl}" data-title="${doc.title}">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <polyline points="6 9 6 2 18 2 18 9"></polyline>
                        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                        <rect x="6" y="14" width="12" height="8"></rect>
                    </svg>
                    <span>Yazdır (Hızlı Çıkar)</span>
                </button>
                <div class="documents-secondary-actions">
                    <button type="button" class="btn btn-outline documents-btn-preview" data-action="preview" data-url="${doc.fileUrl}" title="Önizle">
                        <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                        <span>Önizle</span>
                    </button>
                    <button type="button" class="btn btn-outline documents-btn-download" data-action="download" data-url="${doc.fileUrl}" data-filename="${doc.fileName}" title="İndir">
                        <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        <span>İndir</span>
                    </button>
                </div>
            </div>
        </article>
    `).join('');

    // Event listeners
    grid.querySelectorAll('[data-action="print"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            printDocumentPdf(btn.dataset.url, btn.dataset.title);
        });
    });

    grid.querySelectorAll('[data-action="preview"]').forEach(el => {
        el.addEventListener('click', () => {
            previewDocumentPdf(el.dataset.url);
        });
    });

    grid.querySelectorAll('[data-action="download"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            downloadDocumentPdf(btn.dataset.url, btn.dataset.filename);
        });
    });

    // Küçük önizlemeleri tetikle
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

/**
 * Belgeler çalışma alanı yöneticisini başlatır.
 */
export function initDocumentsManager() {
    const searchInput = document.getElementById('documents-search-input');
    const searchClear = document.getElementById('documents-search-clear');
    const resetFilterBtn = document.getElementById('documents-btn-reset-filters');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.trim();
            if (searchClear) {
                searchClear.style.display = searchQuery ? 'flex' : 'none';
            }
            renderDocumentsGrid();
        });
    }

    if (searchClear && searchInput) {
        searchClear.addEventListener('click', () => {
            searchInput.value = '';
            searchQuery = '';
            searchClear.style.display = 'none';
            searchInput.focus();
            renderDocumentsGrid();
        });
    }

    if (resetFilterBtn && searchInput) {
        resetFilterBtn.addEventListener('click', () => {
            activeCategory = 'all';
            searchQuery = '';
            searchInput.value = '';
            if (searchClear) searchClear.style.display = 'none';
            renderCategoryButtons();
            renderDocumentsGrid();
        });
    }

    if (typeof document !== 'undefined') {
        document.addEventListener('workspace:view-changed', (e) => {
            if (e.detail?.viewName === 'documents') {
                setTimeout(renderThumbnails, 60);
            }
        });
    }

    renderCategoryButtons();
    renderDocumentsGrid();
}
