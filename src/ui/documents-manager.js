import { DOCUMENT_CATEGORIES, OFFICE_DOCUMENTS } from '../config/documents-config.js';

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

    const preview = document.createElement('iframe');
    preview.className = 'documents-card-preview';
    preview.src = `${documentRecord.fileUrl}#page=1&toolbar=0&navpanes=0`;
    preview.title = `${documentRecord.title} — ilk sayfa önizlemesi`;
    preview.loading = 'lazy';
    preview.setAttribute('aria-label', preview.title);

    const actions = document.createElement('div');
    actions.className = 'documents-card-actions';
    actions.append(
        createDocumentAction('Önizle', 'preview', documentRecord),
        createDocumentAction('İndir', 'download', documentRecord)
    );
    card.append(heading, category, badge, preview, actions);
    actions.prepend(createDocumentAction('Yazdır (Hızlı Çıkar)', 'print', documentRecord));
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
    render();
}
